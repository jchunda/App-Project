-- =====================================================================
-- Usambazi: 03_functions.sql
-- Functions (small programs that live inside the database) and
-- triggers (functions that run automatically when a row is added).
--
-- How to run: SQL Editor -> paste this whole file -> Run.
-- Run it after 02_security.sql. Safe to run again: "create or replace"
-- updates a function, and each trigger is removed and re-added.
-- Later phases will add more functions to this file.
-- =====================================================================


-- ---------------------------------------------------------------------
-- usambazi_ping: answers "ok". The connection check on index.html
-- calls it to prove the app can reach the database.
-- ---------------------------------------------------------------------
create or replace function public.usambazi_ping()
returns text
language sql
stable
as $$
  select 'ok'::text;
$$;

grant execute on function public.usambazi_ping() to anon, authenticated;


-- ---------------------------------------------------------------------
-- handle_new_user: when someone signs up, create their profile row,
-- using the name and phone they typed on the sign-up form.
--
-- "security definer" means it runs with the database owner's rights,
-- so it can add the row even though normal users have no insert rule.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- claim_reference: stops the same transaction reference being used
-- twice, anywhere in the app. Runs automatically before a payment,
-- repayment, loan transfer or bank deposit is saved.
-- It tidies the reference (capitals, no spaces) and adds it to
-- money_references. If it is already there, the save is refused with
-- a clear message.
-- ---------------------------------------------------------------------
create or replace function public.claim_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref_column text := tg_argv[0];   -- which column holds the reference
  raw_ref    text;
  clean_ref  text;
begin
  raw_ref := to_jsonb(new) ->> ref_column;

  -- Nothing to check when there is no reference (for example cash).
  if raw_ref is null or length(trim(raw_ref)) = 0 then
    return new;
  end if;

  -- On an update, only check if the reference actually changed.
  if tg_op = 'UPDATE' and raw_ref is not distinct from (to_jsonb(old) ->> ref_column) then
    return new;
  end if;

  clean_ref := upper(regexp_replace(raw_ref, '\s', '', 'g'));

  begin
    insert into public.money_references (reference, group_id, used_in)
    values (clean_ref, new.group_id, tg_table_name);
  exception when unique_violation then
    raise exception 'The reference % has already been used. Check the message from the mobile money or bank and type the reference again.', raw_ref
      using errcode = 'P0001';
  end;

  return new;
end;
$$;

drop trigger if exists claim_payment_reference on public.payments;
create trigger claim_payment_reference
  before insert on public.payments
  for each row execute function public.claim_reference('reference');

drop trigger if exists claim_repayment_reference on public.loan_repayments;
create trigger claim_repayment_reference
  before insert on public.loan_repayments
  for each row execute function public.claim_reference('reference');

drop trigger if exists claim_deposit_reference on public.bank_deposits;
create trigger claim_deposit_reference
  before insert on public.bank_deposits
  for each row execute function public.claim_reference('reference');

-- A loan's reference is added later, when the money is sent, so this
-- one also runs when a loan row is updated.
drop trigger if exists claim_loan_reference on public.loans;
create trigger claim_loan_reference
  before insert or update of sent_reference on public.loans
  for each row execute function public.claim_reference('sent_reference');


-- =====================================================================
-- Phase 1: groups, members, invite codes
-- =====================================================================

-- ---------------------------------------------------------------------
-- Small helpers for writing history in plain words.
-- ---------------------------------------------------------------------

-- 500 -> 'K500', 1234.5 -> 'K1,234.50'
create or replace function public.fmt_k(amount numeric)
returns text
language sql immutable set search_path = ''
as $$
  select 'K' || case when amount = trunc(amount)
                     then to_char(amount, 'FM999,999,999,990')
                     else to_char(amount, 'FM999,999,999,990.00') end;
$$;

-- 10 -> '10', 2.5 -> '2.5' (for percentages and multiples)
create or replace function public.fmt_num(n numeric)
returns text
language sql immutable set search_path = ''
as $$
  select rtrim(rtrim(to_char(n, 'FM999,999,990.00'), '0'), '.');
$$;

-- 'treasurer' -> 'Treasurer'
create or replace function public.role_label(role text)
returns text
language sql immutable set search_path = ''
as $$
  select case role
    when 'chair'     then 'Chairperson'
    when 'vice'      then 'Vice Chairperson'
    when 'treasurer' then 'Treasurer'
    when 'comms'     then 'Communications'
    when 'rep'       then 'Member representative'
    else 'Member' end;
$$;

-- A new, unused 6-character invite code. Letters and numbers that are
-- easy to confuse (O and 0, I and 1) are left out.
create or replace function public.new_invite_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code    text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  return code;
end;
$$;


-- ---------------------------------------------------------------------
-- create_group: makes a new group with its members, checking every rule
-- from CLAUDE.md section 4. Because the checks are in the database, they
-- can't be skipped by changing the app.
--
-- p_group:   { name, type, monthly_amount, start_month ('2026-10-01'),
--              cycle_months, loan_rate, loan_multiple, loan_max_months }
-- p_members: [ { full_name, phone, role, is_me }, ... ] in rotation order.
--            Exactly one member has is_me = true: the person creating it.
-- Returns the new group's id.
-- ---------------------------------------------------------------------
create or replace function public.create_group(p_group jsonb, p_members jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid    := auth.uid();
  v_name       text    := trim(coalesce(p_group ->> 'name', ''));
  v_type       text    := p_group ->> 'type';
  v_amount     numeric := round((p_group ->> 'monthly_amount')::numeric, 2);
  v_start      date    := (p_group ->> 'start_month')::date;
  v_cycle      integer;
  v_rate       numeric := 10;
  v_mult       numeric := 3;
  v_maxm       integer := 3;
  v_count      integer;
  v_max        integer;
  v_committee  integer;
  v_group_id   uuid;
  v_member     jsonb;
  v_position   integer := 0;
  v_rotation   integer;
  v_me_name    text;
begin
  -- Who is asking?
  if v_uid is null then
    raise exception 'Please log in first.';
  end if;

  -- The group details
  if length(v_name) < 2 then
    raise exception 'Give the group a name.';
  end if;
  if v_type is null or v_type not in ('chilimba', 'village') then
    raise exception 'Choose the type of group: Chilimba or Village Banking.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the monthly amount.';
  end if;
  if v_start is null or extract(day from v_start) <> 1 then
    raise exception 'Choose the first month.';
  end if;

  -- The members
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Add the members of the group.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_members);
  v_max := case when v_type = 'chilimba' then 20 else 35 end;

  if v_count < 5 then
    raise exception 'Add at least 5 members.';
  end if;
  if v_count > v_max then
    raise exception 'A % can have up to % members. You have %.',
      case when v_type = 'chilimba' then 'chilimba' else 'village banking group' end, v_max, v_count;
  end if;
  if exists (select 1 from jsonb_array_elements(p_members) m
             where length(trim(coalesce(m ->> 'full_name', ''))) < 2) then
    raise exception 'Every member needs a name (at least 2 letters).';
  end if;
  if exists (select 1 from jsonb_array_elements(p_members) m
             where coalesce(m ->> 'role', '') not in ('chair', 'vice', 'treasurer', 'comms', 'rep', 'member')) then
    raise exception 'Choose a role for every member.';
  end if;
  if (select count(*) from jsonb_array_elements(p_members) m where m ->> 'role' = 'chair') <> 1 then
    raise exception 'Choose exactly one chairperson.';
  end if;
  if (select count(*) from jsonb_array_elements(p_members) m where m ->> 'role' = 'treasurer') <> 1 then
    raise exception 'Choose exactly one treasurer.';
  end if;
  if (select count(*) from jsonb_array_elements(p_members) m where m ->> 'role' = 'vice') > 1 then
    raise exception 'Choose only one vice chairperson.';
  end if;

  select count(*) into v_committee from jsonb_array_elements(p_members) m where m ->> 'role' <> 'member';
  if v_committee < 4 then
    raise exception 'The committee needs at least 4 people. You have %.', v_committee;
  end if;
  if not exists (select 1 from jsonb_array_elements(p_members) m where m ->> 'role' = 'member') then
    raise exception 'Add at least one ordinary member.';
  end if;
  if (select count(*) from jsonb_array_elements(p_members) m
      where coalesce((m ->> 'is_me')::boolean, false)) <> 1 then
    raise exception 'Mark which member is you.';
  end if;

  -- Cycle length and loan rules
  if v_type = 'chilimba' then
    v_cycle := v_count;   -- one month per member
  else
    v_cycle := (p_group ->> 'cycle_months')::integer;
    v_rate  := round(coalesce((p_group ->> 'loan_rate')::numeric, 10), 2);
    v_mult  := round(coalesce((p_group ->> 'loan_multiple')::numeric, 3), 2);
    v_maxm  := coalesce((p_group ->> 'loan_max_months')::integer, 3);
    if v_cycle is null or v_cycle not between 1 and 24 then
      raise exception 'The cycle must be between 1 and 24 months.';
    end if;
    if v_rate not between 0 and 50 then
      raise exception 'Loan interest must be between 0%% and 50%% a month.';
    end if;
    if v_mult not between 1 and 10 then
      raise exception 'The borrowing limit must be between 1 and 10 times savings.';
    end if;
    if v_maxm not between 1 and 12 then
      raise exception 'The longest repayment time must be between 1 and 12 months.';
    end if;
  end if;

  -- Everything is fine: save the group
  insert into public.groups (name, type, monthly_amount, cycle_months, start_month,
                             loan_rate, loan_multiple, loan_max_months, invite_code, created_by)
  values (v_name, v_type, v_amount, v_cycle, v_start,
          v_rate, v_mult, v_maxm, public.new_invite_code(), v_uid)
  returning id into v_group_id;

  -- Save the members in the order they were typed.
  -- Chilimba: that order is the rotation, but the treasurer always goes
  -- last, so their own money stays in the group until everyone is paid.
  for v_member in
    select e.value from jsonb_array_elements(p_members) with ordinality as e(value, idx) order by e.idx
  loop
    if v_type = 'chilimba' then
      if v_member ->> 'role' = 'treasurer' then
        v_rotation := v_count;
      else
        v_position := v_position + 1;
        v_rotation := v_position;
      end if;
    else
      v_rotation := null;
    end if;

    insert into public.group_members (group_id, user_id, full_name, phone, role, rotation_position)
    values (
      v_group_id,
      case when coalesce((v_member ->> 'is_me')::boolean, false) then v_uid end,
      trim(v_member ->> 'full_name'),
      nullif(trim(coalesce(v_member ->> 'phone', '')), ''),
      v_member ->> 'role',
      v_rotation
    );

    if coalesce((v_member ->> 'is_me')::boolean, false) then
      v_me_name := trim(v_member ->> 'full_name');
    end if;
  end loop;

  -- Write the history
  insert into public.history (group_id, actor_user, actor_name, action)
  values (v_group_id, v_uid, v_me_name,
    format('Created the group as %s: %s members, %s, %s-month cycle.%s',
      case when v_type = 'chilimba' then 'a Chilimba' else 'Village Banking' end,
      v_count,
      case when v_type = 'chilimba' then public.fmt_k(v_amount) || ' each per month'
           else 'at least ' || public.fmt_k(v_amount) || ' saved each month' end,
      v_cycle,
      case when v_type = 'village'
           then format(' Loans: %s%% interest a month, up to %s times savings, repaid within %s month%s.',
                       public.fmt_num(v_rate), public.fmt_num(v_mult),
                       v_maxm, case when v_maxm = 1 then '' else 's' end)
           else '' end));

  insert into public.history (group_id, actor_user, actor_name, action)
  select v_group_id, v_uid, v_me_name,
         format('Set up a committee of %s: %s.', count(*),
                string_agg(full_name || ' (' || public.role_label(role) || ')', ', '
                           order by array_position(array['chair', 'vice', 'treasurer', 'comms', 'rep'], role)))
  from public.group_members
  where group_id = v_group_id and role <> 'member';

  if v_type = 'chilimba' then
    insert into public.history (group_id, actor_user, actor_name, action)
    select v_group_id, v_uid, v_me_name,
           format('Set the order for receiving the pot. The treasurer, %s, receives last.', full_name)
    from public.group_members
    where group_id = v_group_id and role = 'treasurer';
  end if;

  return v_group_id;
end;
$$;


-- ---------------------------------------------------------------------
-- invite_preview: someone typed an invite code. Show which group it is
-- and the names on its member list that nobody has claimed yet, so the
-- person can pick their own name.
-- ---------------------------------------------------------------------
create or replace function public.invite_preview(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'Please log in first.';
  end if;
  if length(v_code) = 0 then
    raise exception 'Type the invite code.';
  end if;

  select * into v_group from public.groups where invite_code = v_code;
  if not found then
    raise exception 'No group has the invite code %. Check the code with your chairperson and try again.', v_code;
  end if;

  if exists (select 1 from public.group_members where group_id = v_group.id and user_id = auth.uid()) then
    raise exception 'You are already a member of %.', v_group.name;
  end if;

  return jsonb_build_object(
    'name',    v_group.name,
    'type',    v_group.type,
    'code',    v_code,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'role', role)
                       order by full_name)
      from public.group_members
      where group_id = v_group.id and user_id is null), '[]'::jsonb)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- join_group: link the logged-in person to their name on the member list.
-- Returns the group's id.
-- ---------------------------------------------------------------------
create or replace function public.join_group(p_code text, p_member_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_member public.group_members;
begin
  if v_uid is null then
    raise exception 'Please log in first.';
  end if;

  select m.* into v_member
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.id = p_member_id and g.invite_code = v_code;

  if not found then
    raise exception 'That name is not on this group''s list. Check the invite code and try again.';
  end if;
  if exists (select 1 from public.group_members where group_id = v_member.group_id and user_id = v_uid) then
    raise exception 'You are already a member of this group.';
  end if;

  -- "user_id is null" makes sure nobody else claimed the name a moment ago.
  update public.group_members set user_id = v_uid
  where id = v_member.id and user_id is null;
  if not found then
    raise exception 'Someone has already joined with the name %. If that was not you, tell your chairperson.', v_member.full_name;
  end if;

  insert into public.history (group_id, actor_user, actor_name, action)
  values (v_member.group_id, v_uid, v_member.full_name,
          format('Joined the group with the invite code, as %s.',
                 case when v_member.role = 'member' then 'a member'
                      else 'the ' || lower(public.role_label(v_member.role)) end));

  return v_member.group_id;
end;
$$;


-- ---------------------------------------------------------------------
-- my_groups: the groups the logged-in person belongs to, for the
-- "My groups" screen, with member count and confirmed savings.
-- Confirmed savings is a group total, so every member may see it
-- (CLAUDE.md section 7). Payments replaced by a correction don't count.
-- ---------------------------------------------------------------------
create or replace function public.my_groups()
returns table (
  id                 uuid,
  name               text,
  type               text,
  cycle_months       integer,
  start_month        date,
  member_count       bigint,
  my_role            text,
  confirmed_savings  numeric
)
language sql stable security definer set search_path = ''
as $$
  select g.id, g.name, g.type, g.cycle_months, g.start_month,
         (select count(*) from public.group_members x where x.group_id = g.id),
         me.role,
         coalesce((
           select sum(p.amount) from public.payments p
           where p.group_id = g.id and p.kind = 'saving' and p.status = 'confirmed'
             and not exists (select 1 from public.payments c where c.corrects_id = p.id)
         ), 0)
  from public.groups g
  join public.group_members me on me.group_id = g.id and me.user_id = auth.uid()
  order by g.created_at desc;
$$;


-- Only logged-in people may use these functions.
revoke execute on function public.create_group(jsonb, jsonb) from public, anon;
revoke execute on function public.invite_preview(text)       from public, anon;
revoke execute on function public.join_group(text, uuid)     from public, anon;
revoke execute on function public.my_groups()                from public, anon;
grant  execute on function public.create_group(jsonb, jsonb) to authenticated;
grant  execute on function public.invite_preview(text)       to authenticated;
grant  execute on function public.join_group(text, uuid)     to authenticated;
grant  execute on function public.my_groups()                to authenticated;
