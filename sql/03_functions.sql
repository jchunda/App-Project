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

  -- A correction may keep the reference of the entry it corrects (same
  -- mobile money message, but the amount was typed wrongly).
  -- (to_jsonb is used because some tables have no corrects_id column.)
  if to_jsonb(new) ->> 'corrects_id' is not null then
    declare
      original_ref text;
    begin
      execute format('select reference from public.%I where id = $1', tg_table_name)
        into original_ref using (to_jsonb(new) ->> 'corrects_id')::uuid;
      if upper(regexp_replace(coalesce(original_ref, ''), '\s', '', 'g')) = clean_ref then
        return new;
      end if;
    end;
  end if;

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


-- =====================================================================
-- Phase 2: payments, confirmations, corrections, bank deposits
-- =====================================================================

-- ---------------------------------------------------------------------
-- More helpers for plain-words history
-- ---------------------------------------------------------------------

-- 'airtel' -> 'Airtel Money'
create or replace function public.method_label(method text)
returns text
language sql immutable set search_path = ''
as $$
  select case method
    when 'airtel' then 'Airtel Money'
    when 'mtn'    then 'MTN MoMo'
    when 'zamtel' then 'Zamtel Kwacha'
    when 'cash'   then 'Cash'
    when 'bank'   then 'Bank'
    else method end;
$$;

-- Month 4 of a cycle starting 1 Oct 2026 -> 'Month 4 (January 2027)'
create or replace function public.month_label(p_start date, p_month integer)
returns text
language sql immutable set search_path = ''
as $$
  select 'Month ' || p_month || ' (' ||
         to_char(p_start + make_interval(months => p_month - 1), 'FMMonth YYYY') || ')';
$$;

-- Today's date in Zambia (the database clock runs on world time, UTC).
create or replace function public.today_zm()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Africa/Lusaka')::date;
$$;

-- Which month of the cycle is it today? Month 1 is the start month.
create or replace function public.cycle_month(p_start date)
returns integer
language sql stable set search_path = ''
as $$
  select ((extract(year from public.today_zm()) - extract(year from p_start)) * 12
          + extract(month from public.today_zm()) - extract(month from p_start) + 1)::integer;
$$;


-- ---------------------------------------------------------------------
-- write_history: add one line to the history log. The "actor" is the
-- logged-in person, shown with the name they have in this group.
-- Only other database functions use this. The app can't call it, so
-- nobody can write fake history.
-- ---------------------------------------------------------------------
create or replace function public.write_history(p_group_id uuid, p_action text, p_subject uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.history (group_id, actor_user, actor_name, action, subject_member)
  values (
    p_group_id,
    auth.uid(),
    coalesce((select full_name from public.group_members
              where group_id = p_group_id and user_id = auth.uid()), 'Usambazi (automatic)'),
    p_action,
    p_subject
  );
end;
$$;


-- ---------------------------------------------------------------------
-- active_payments: a group's payments that count, which means every
-- payment except those replaced by a correction.
-- ---------------------------------------------------------------------
create or replace function public.active_payments(gid uuid)
returns setof public.payments
language sql stable security definer set search_path = ''
as $$
  select p.* from public.payments p
  where p.group_id = gid
    and not exists (select 1 from public.payments c where c.corrects_id = p.id);
$$;


-- ---------------------------------------------------------------------
-- group_holdings: where the group's money is right now.
--   Payments go to the place they were paid into (mobile money, cash or
--   the bank). Waiting and disputed payments count too, because the
--   money has been handed over. Bank deposits move money from mobile
--   money or cash into the bank. Approved payouts and spending take
--   money out of the places the treasurer chose. Loans leave from the
--   place they were sent from, and repayments come back to the place
--   they were paid into.
-- ---------------------------------------------------------------------
create or replace function public.group_holdings(gid uuid)
returns table (bank numeric, momo numeric, cash numeric)
language sql stable security definer set search_path = ''
as $$
  with moves as (
    select case when method in ('airtel', 'mtn', 'zamtel') then 'momo' else method end as place, amount
    from public.active_payments(gid)
    union all
    select 'bank', amount from public.bank_deposits where group_id = gid
    union all
    select from_place, -amount from public.bank_deposits where group_id = gid
    union all
    select 'bank', -from_bank from public.requests
    where group_id = gid and status = 'approved' and kind in ('payout', 'spending')
    union all
    select 'momo', -from_momo from public.requests
    where group_id = gid and status = 'approved' and kind in ('payout', 'spending')
    union all
    select 'cash', -from_cash from public.requests
    where group_id = gid and status = 'approved' and kind in ('payout', 'spending')
    union all
    select sent_from, -amount from public.loans
    where group_id = gid and sent_on is not null
    union all
    select case when rp.method in ('airtel', 'mtn', 'zamtel') then 'momo' else rp.method end, rp.amount
    from public.loan_repayments rp
    where rp.group_id = gid
      and not exists (select 1 from public.loan_repayments c where c.corrects_id = rp.id)
  )
  select coalesce(sum(amount) filter (where place = 'bank'), 0),
         coalesce(sum(amount) filter (where place = 'momo'), 0),
         coalesce(sum(amount) filter (where place = 'cash'), 0)
  from moves;
$$;


-- ---------------------------------------------------------------------
-- group_available: money the treasurer can still ask to use. It is
-- what the group holds, minus money already promised in requests that
-- are still waiting for approval. This stops the same money from being
-- asked for twice.
-- ---------------------------------------------------------------------
create or replace function public.group_available(gid uuid)
returns table (bank numeric, momo numeric, cash numeric)
language sql stable security definer set search_path = ''
as $$
  select h.bank - coalesce(sum(r.from_bank), 0),
         h.momo - coalesce(sum(r.from_momo), 0),
         h.cash - coalesce(sum(r.from_cash), 0)
  from public.group_holdings(gid) h
  left join public.requests r
    on r.group_id = gid and r.status = 'pending' and r.kind in ('payout', 'spending')
  group by h.bank, h.momo, h.cash;
$$;


-- ---------------------------------------------------------------------
-- group_summary: the group totals every member may see, even in village
-- banking where ordinary members can't see other people's payments
-- (CLAUDE.md section 7): where the money is, confirmed savings, this
-- month's progress, and who has paid this month (status only, no amounts).
-- ---------------------------------------------------------------------
create or replace function public.group_summary(gid uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_group  public.groups;
  v_month  integer;
  v_hold   record;
  v_avail  record;
begin
  if not public.is_group_member(gid) then
    raise exception 'You are not a member of this group.';
  end if;
  select * into v_group from public.groups where id = gid;

  -- This month of the cycle, kept between month 1 and the last month.
  v_month := greatest(1, least(public.cycle_month(v_group.start_month), v_group.cycle_months));
  select * into v_hold from public.group_holdings(gid);
  select * into v_avail from public.group_available(gid);

  return jsonb_build_object(
    'bank', v_hold.bank,
    'momo', v_hold.momo,
    'cash', v_hold.cash,
    -- Loans: still lent out, and interest received (group totals)
    'lent',              (select coalesce(sum(outstanding), 0) from public.loan_figures(gid)),
    'interest_received', public.group_interest_received(gid),
    -- What can still be asked for (not promised to a waiting request)
    'avail_bank', v_avail.bank,
    'avail_momo', v_avail.momo,
    'avail_cash', v_avail.cash,
    'paid_out',   (select coalesce(sum(amount), 0) from public.requests
                   where group_id = gid and status = 'approved' and kind = 'payout'),
    'spent',      (select coalesce(sum(amount), 0) from public.requests
                   where group_id = gid and status = 'approved' and kind = 'spending'),
    'month', v_month,
    'confirmed_savings', (select coalesce(sum(amount), 0) from public.active_payments(gid)
                          where kind = 'saving' and status = 'confirmed'),
    'waiting_savings',   (select coalesce(sum(amount), 0) from public.active_payments(gid)
                          where kind = 'saving' and status <> 'confirmed'),
    'fees_fines',        (select coalesce(sum(amount), 0) from public.active_payments(gid)
                          where kind in ('fee', 'fine') and status = 'confirmed'),
    'month_confirmed',   (select coalesce(sum(amount), 0) from public.active_payments(gid)
                          where kind = 'saving' and status = 'confirmed' and cycle_month = v_month),
    -- { member id: 'notpaid' | 'waiting' | 'disputed' | 'confirmed' } for this month
    'statuses', (
      select coalesce(jsonb_object_agg(m.id::text,
               case when s.total = 0     then 'notpaid'
                    when s.disputed > 0  then 'disputed'
                    when s.waiting > 0   then 'waiting'
                    else 'confirmed' end), '{}'::jsonb)
      from public.group_members m
      cross join lateral (
        select count(*) as total,
               count(*) filter (where p.status = 'disputed') as disputed,
               count(*) filter (where p.status = 'waiting')  as waiting
        from public.active_payments(gid) p
        where p.member_id = m.id and p.kind = 'saving' and p.cycle_month = v_month
      ) s
      where m.group_id = gid)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- record_payment: the treasurer records money a member paid in.
-- The member is then asked to confirm it.
-- ---------------------------------------------------------------------
create or replace function public.record_payment(
  p_group_id    uuid,
  p_member_id   uuid,
  p_kind        text,      -- 'saving', or in village banking also 'fee' or 'fine'
  p_amount      numeric,
  p_cycle_month integer,
  p_paid_on     date,
  p_method      text,      -- 'airtel', 'mtn', 'zamtel', 'cash' or 'bank'
  p_reference   text,
  p_note        text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_group   public.groups;
  v_member  public.group_members;
  v_amount  numeric := round(p_amount, 2);
  v_ref     text    := nullif(trim(coalesce(p_reference, '')), '');
  v_already numeric;
  v_id      uuid;
begin
  select * into v_group from public.groups where id = p_group_id;
  if not found or not public.has_role(p_group_id, 'treasurer') then
    raise exception 'Only the treasurer can record payments.';
  end if;

  select * into v_member from public.group_members where id = p_member_id and group_id = p_group_id;
  if not found then
    raise exception 'Choose who paid.';
  end if;

  if coalesce(p_kind, '') not in ('saving', 'fee', 'fine') then
    raise exception 'Choose what the payment is for.';
  end if;
  if v_group.type = 'chilimba' and p_kind <> 'saving' then
    raise exception 'In a chilimba, only the monthly payment is recorded.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount paid, for example 500.';
  end if;
  if p_cycle_month is null or p_cycle_month not between 1 and v_group.cycle_months then
    raise exception 'Choose a month between 1 and %.', v_group.cycle_months;
  end if;
  if p_paid_on is null then
    raise exception 'Choose the date the money was paid.';
  end if;
  if p_paid_on > public.today_zm() then
    raise exception 'The date paid cannot be in the future.';
  end if;

  if coalesce(p_method, '') not in ('airtel', 'mtn', 'zamtel', 'cash', 'bank') then
    raise exception 'Choose how they paid.';
  end if;
  if p_method in ('airtel', 'mtn', 'zamtel') and length(coalesce(v_ref, '')) < 6 then
    raise exception 'Enter the transaction reference from the mobile money message. It lets anyone trace the payment.';
  end if;
  if p_method = 'cash' then
    v_ref := null;   -- cash has no reference; the treasurer writes a receipt instead
  end if;

  -- Chilimba: nobody pays more than the fixed amount for one month.
  if v_group.type = 'chilimba' then
    select coalesce(sum(amount), 0) into v_already
    from public.active_payments(p_group_id)
    where member_id = p_member_id and cycle_month = p_cycle_month and kind = 'saving';

    if v_already + v_amount > v_group.monthly_amount then
      raise exception '% already has % recorded for Month %. Everyone pays % a month. If an entry is wrong, fix it with a correction instead.',
        v_member.full_name, public.fmt_k(v_already), p_cycle_month, public.fmt_k(v_group.monthly_amount);
    end if;
  end if;

  -- Save it. Triggers then check the reference is new and write the history.
  insert into public.payments (group_id, member_id, kind, amount, cycle_month, paid_on,
                               method, reference, note, recorded_by)
  values (p_group_id, p_member_id, p_kind, v_amount, p_cycle_month, p_paid_on,
          p_method, v_ref, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- answer_payment: the member who paid says "Yes, I paid this"
-- ('confirmed') or "This is wrong" ('disputed', with a reason).
-- Only that member can answer, and only while it is waiting.
-- ---------------------------------------------------------------------
create or replace function public.answer_payment(p_payment_id uuid, p_answer text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_payment public.payments;
  v_reason  text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found or not exists (select 1 from public.group_members
                              where id = v_payment.member_id and user_id = auth.uid()) then
    raise exception 'Only the member who paid can confirm or dispute this payment.';
  end if;
  if exists (select 1 from public.payments where corrects_id = p_payment_id) then
    raise exception 'This payment was replaced by a correction. Answer the correction instead.';
  end if;
  if v_payment.status <> 'waiting' then
    raise exception 'You have already answered for this payment.';
  end if;
  if p_answer not in ('confirmed', 'disputed') then
    raise exception 'Choose "Yes, I paid this" or "This is wrong".';
  end if;
  if p_answer = 'disputed' and length(coalesce(v_reason, '')) < 5 then
    raise exception 'Please explain what is wrong in a few words.';
  end if;

  update public.payments
  set status = p_answer,
      dispute_reason = case when p_answer = 'disputed' then v_reason end,
      answered_at = now()
  where id = p_payment_id;
end;
$$;


-- ---------------------------------------------------------------------
-- correct_payment: the treasurer fixes a mistake. The original stays
-- visible ("Replaced by a correction") and a new entry is added, which
-- the member must confirm. Only the corrected entry counts in totals.
-- ---------------------------------------------------------------------
create or replace function public.correct_payment(
  p_original_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text,
  p_reason      text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig    public.payments;
  v_group   public.groups;
  v_amount  numeric := round(p_amount, 2);
  v_ref     text    := nullif(trim(coalesce(p_reference, '')), '');
  v_reason  text    := nullif(trim(coalesce(p_reason, '')), '');
  v_others  numeric;
  v_id      uuid;
begin
  select * into v_orig from public.payments where id = p_original_id;
  if not found or not public.has_role(v_orig.group_id, 'treasurer') then
    raise exception 'Only the treasurer can add corrections.';
  end if;
  select * into v_group from public.groups where id = v_orig.group_id;

  if exists (select 1 from public.payments where corrects_id = p_original_id) then
    raise exception 'This payment has already been corrected. Correct the newest entry instead.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the correct amount.';
  end if;
  if coalesce(p_method, '') not in ('airtel', 'mtn', 'zamtel', 'cash', 'bank') then
    raise exception 'Choose how they paid.';
  end if;
  if p_method in ('airtel', 'mtn', 'zamtel') and length(coalesce(v_ref, '')) < 6 then
    raise exception 'Enter the transaction reference from the mobile money message.';
  end if;
  if p_method = 'cash' then
    v_ref := null;
  end if;
  if length(coalesce(v_reason, '')) < 5 then
    raise exception 'Explain why you are making this correction. The committee will read it.';
  end if;

  -- Chilimba: the corrected amount plus any other entries for that
  -- month still can't be more than the fixed amount.
  if v_group.type = 'chilimba' then
    select coalesce(sum(amount), 0) into v_others
    from public.active_payments(v_orig.group_id)
    where member_id = v_orig.member_id and cycle_month = v_orig.cycle_month
      and kind = 'saving' and id <> v_orig.id;
    if v_others + v_amount > v_group.monthly_amount then
      raise exception 'That would make % for Month %, but everyone pays % a month.',
        public.fmt_k(v_others + v_amount), v_orig.cycle_month, public.fmt_k(v_group.monthly_amount);
    end if;
  end if;

  insert into public.payments (group_id, member_id, kind, amount, cycle_month, paid_on,
                               method, reference, note, recorded_by, corrects_id, correction_reason)
  values (v_orig.group_id, v_orig.member_id, v_orig.kind, v_amount, v_orig.cycle_month, v_orig.paid_on,
          p_method, v_ref, v_orig.note, auth.uid(), v_orig.id, v_reason)
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- record_deposit: the treasurer moves money from mobile money or cash
-- into the group bank account. This makes money safer, so it needs no
-- approval, but it needs a deposit reference and is logged.
-- ---------------------------------------------------------------------
create or replace function public.record_deposit(
  p_group_id   uuid,
  p_from_place text,      -- 'momo' or 'cash'
  p_amount     numeric,
  p_reference  text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount numeric := round(p_amount, 2);
  v_ref    text    := nullif(trim(coalesce(p_reference, '')), '');
  v_hold   record;
  v_have   numeric;
  v_id     uuid;
begin
  if not public.has_role(p_group_id, 'treasurer') then
    raise exception 'Only the treasurer can record money moved to the bank.';
  end if;
  if coalesce(p_from_place, '') not in ('momo', 'cash') then
    raise exception 'Choose where the money is moved from.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount moved.';
  end if;
  if length(coalesce(v_ref, '')) < 3 then
    raise exception 'Enter the deposit slip or transaction number so the committee can check it.';
  end if;

  -- Money promised to a waiting request stays where it is.
  select * into v_hold from public.group_available(p_group_id);
  v_have := case when p_from_place = 'momo' then v_hold.momo else v_hold.cash end;
  if v_amount > v_have then
    raise exception 'Only % is held as %.', public.fmt_k(v_have),
      case when p_from_place = 'momo' then 'mobile money' else 'cash' end;
  end if;

  insert into public.bank_deposits (group_id, from_place, amount, reference, deposited_on, recorded_by)
  values (p_group_id, p_from_place, v_amount, v_ref, public.today_zm(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- protect_answered_record: payments can never be edited. The only
-- change ever allowed is the member's answer (status, reason, time),
-- and only while the payment is still waiting. This applies to
-- everyone, even someone using the Supabase website's Table Editor.
-- ---------------------------------------------------------------------
create or replace function public.protect_answered_record()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'dispute_reason' - 'answered_at')
     is distinct from (to_jsonb(old) - 'status' - 'dispute_reason' - 'answered_at') then
    raise exception 'Records can never be changed. Add a correction instead.';
  end if;
  if old.status <> 'waiting' then
    raise exception 'This has already been confirmed or disputed, so it can''t be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_payment on public.payments;
create trigger protect_payment
  before update on public.payments
  for each row execute function public.protect_answered_record();


-- ---------------------------------------------------------------------
-- History, written automatically by triggers, so nothing can be skipped.
-- ---------------------------------------------------------------------
create or replace function public.payments_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date;
  v_name  text;
  v_orig  public.payments;
  v_what  text;
begin
  select start_month into v_start from public.groups where id = new.group_id;
  select full_name into v_name from public.group_members where id = new.member_id;

  if tg_op = 'INSERT' and new.corrects_id is null then
    v_what := case new.kind when 'fee' then 'a fee of ' when 'fine' then 'a fine of ' else '' end;
    perform public.write_history(new.group_id,
      format('Recorded %s%s from %s for %s. Paid by %s%s.',
             v_what, public.fmt_k(new.amount), v_name, public.month_label(v_start, new.cycle_month),
             public.method_label(new.method),
             case when new.reference is not null then ', reference ' || new.reference else '' end),
      new.member_id);

  elsif tg_op = 'INSERT' then
    select * into v_orig from public.payments where id = new.corrects_id;
    perform public.write_history(new.group_id,
      format('Added a correction to %s''s Month %s payment: %s changed to %s. Reason: "%s". The original entry is kept.',
             v_name, new.cycle_month, public.fmt_k(v_orig.amount), public.fmt_k(new.amount), new.correction_reason),
      new.member_id);

  elsif new.status = 'confirmed' and old.status <> 'confirmed' then
    perform public.write_history(new.group_id,
      format('Confirmed that the %s payment for Month %s is correct.', public.fmt_k(new.amount), new.cycle_month),
      new.member_id);

  elsif new.status = 'disputed' and old.status <> 'disputed' then
    perform public.write_history(new.group_id,
      format('Said the %s payment recorded for Month %s is wrong: "%s"', public.fmt_k(new.amount), new.cycle_month, new.dispute_reason),
      new.member_id);
  end if;

  return new;
end;
$$;

drop trigger if exists payments_history on public.payments;
create trigger payments_history
  after insert or update of status on public.payments
  for each row execute function public.payments_history();


create or replace function public.deposits_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.write_history(new.group_id,
    format('Moved %s from %s to the group bank account. Deposit reference: %s.',
           public.fmt_k(new.amount),
           case when new.from_place = 'momo' then 'mobile money' else 'cash' end,
           new.reference),
    null);
  return new;
end;
$$;

drop trigger if exists deposits_history on public.bank_deposits;
create trigger deposits_history
  after insert on public.bank_deposits
  for each row execute function public.deposits_history();


-- ---------------------------------------------------------------------
-- Who may use the Phase 2 functions.
-- Inside helpers are closed to the app: nobody can call write_history
-- to write fake entries, or look at another group's totals.
-- ---------------------------------------------------------------------
revoke execute on function public.write_history(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.active_payments(uuid)           from public, anon, authenticated;
revoke execute on function public.group_holdings(uuid)            from public, anon, authenticated;

revoke execute on function public.group_summary(uuid) from public, anon;
revoke execute on function public.record_payment(uuid, uuid, text, numeric, integer, date, text, text, text) from public, anon;
revoke execute on function public.answer_payment(uuid, text, text) from public, anon;
revoke execute on function public.correct_payment(uuid, numeric, text, text, text) from public, anon;
revoke execute on function public.record_deposit(uuid, text, numeric, text) from public, anon;

grant execute on function public.group_summary(uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, text, numeric, integer, date, text, text, text) to authenticated;
grant execute on function public.answer_payment(uuid, text, text) to authenticated;
grant execute on function public.correct_payment(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.record_deposit(uuid, text, numeric, text) to authenticated;


-- =====================================================================
-- Phase 3: requests, voting, chilimba payouts, spending, type changes
-- =====================================================================

-- ---------------------------------------------------------------------
-- write_auto_history: like write_history, but for things Usambazi does
-- by itself (for example "Approved: ..." once enough people voted yes).
-- ---------------------------------------------------------------------
create or replace function public.write_auto_history(p_group_id uuid, p_action text, p_subject uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.history (group_id, actor_user, actor_name, action, subject_member)
  values (p_group_id, null, 'Usambazi (automatic)', p_action, p_subject);
$$;


-- ---------------------------------------------------------------------
-- request_title: a request in plain words, e.g.
-- 'Pay K4,000 to Mwila Banda (Month 4 receiver)'
-- ---------------------------------------------------------------------
create or replace function public.request_title(r public.requests)
returns text
language sql stable security definer set search_path = ''
as $$
  select case r.kind
    when 'payout' then format('Pay %s to %s (Month %s receiver)', public.fmt_k(r.amount),
                              (select full_name from public.group_members where id = r.payout_to), r.cycle_month)
    when 'spending' then format('Spend %s: %s', public.fmt_k(r.amount), r.description)
    when 'type_change' then format('Change the group type to %s',
                                   case when r.new_type = 'chilimba' then 'Chilimba' else 'Village Banking' end)
    when 'loan' then format('Loan of %s to %s for %s month%s', public.fmt_k(r.amount),
                            (select full_name from public.group_members where id = r.requested_by),
                            r.loan_months, case when r.loan_months = 1 then '' else 's' end)
    else 'Request' end;
$$;


-- ---------------------------------------------------------------------
-- check_sources: the parts taken from bank, mobile money and cash must
-- add up to the amount, and no place can go below zero.
-- ---------------------------------------------------------------------
create or replace function public.check_sources(gid uuid, p_amount numeric,
                                                p_bank numeric, p_momo numeric, p_cash numeric)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_avail record;
begin
  if p_bank < 0 or p_momo < 0 or p_cash < 0 then
    raise exception 'Amounts cannot be negative.';
  end if;
  if round(p_bank + p_momo + p_cash, 2) <> round(p_amount, 2) then
    raise exception 'The amounts you are taking add up to %, but the request is for %. They must match.',
      public.fmt_k(p_bank + p_momo + p_cash), public.fmt_k(p_amount);
  end if;

  select * into v_avail from public.group_available(gid);
  if p_bank > v_avail.bank then
    raise exception 'Only % is available in the group bank account.', public.fmt_k(v_avail.bank);
  end if;
  if p_momo > v_avail.momo then
    raise exception 'Only % is available in mobile money.', public.fmt_k(v_avail.momo);
  end if;
  if p_cash > v_avail.cash then
    raise exception 'Only % is available in cash.', public.fmt_k(v_avail.cash);
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- request_payout: (chilimba, treasurer) ask to pay this month's pot to
-- the member whose turn it is.
-- ---------------------------------------------------------------------
create or replace function public.request_payout(p_group_id uuid, p_amount numeric,
                                                 p_bank numeric, p_momo numeric, p_cash numeric)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_group    public.groups;
  v_month    integer;
  v_receiver public.group_members;
  v_me       uuid;
  v_id       uuid;
  v_amount   numeric := round(p_amount, 2);
begin
  select * into v_group from public.groups where id = p_group_id;
  if not found or not public.has_role(p_group_id, 'treasurer') then
    raise exception 'Only the treasurer can ask to pay out money.';
  end if;
  if v_group.type <> 'chilimba' then
    raise exception 'Payouts in turn are only for chilimbas.';
  end if;
  if public.cycle_month(v_group.start_month) < 1 then
    raise exception 'The cycle has not started yet.';
  end if;

  v_month := least(public.cycle_month(v_group.start_month), v_group.cycle_months);
  select * into v_receiver from public.group_members
  where group_id = p_group_id and rotation_position = v_month;

  if exists (select 1 from public.requests where group_id = p_group_id and kind = 'payout'
             and cycle_month = v_month and status <> 'rejected') then
    raise exception 'A payout for Month % has already been asked for.', v_month;
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount.';
  end if;
  if v_amount > v_group.monthly_amount * (select count(*) from public.group_members where group_id = p_group_id) then
    raise exception 'The payout cannot be more than the full pot.';
  end if;

  perform public.check_sources(p_group_id, v_amount, coalesce(p_bank, 0), coalesce(p_momo, 0), coalesce(p_cash, 0));

  select id into v_me from public.group_members where group_id = p_group_id and user_id = auth.uid();
  insert into public.requests (group_id, kind, requested_by, amount, payout_to, cycle_month,
                               from_bank, from_momo, from_cash)
  values (p_group_id, 'payout', v_me, v_amount, v_receiver.id, v_month,
          round(coalesce(p_bank, 0), 2), round(coalesce(p_momo, 0), 2), round(coalesce(p_cash, 0), 2))
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- request_spending: (treasurer) ask to spend group money on something,
-- for example a bank charge.
-- ---------------------------------------------------------------------
create or replace function public.request_spending(p_group_id uuid, p_amount numeric, p_reason text,
                                                   p_bank numeric, p_momo numeric, p_cash numeric)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me     uuid;
  v_id     uuid;
  v_amount numeric := round(p_amount, 2);
  v_reason text    := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_role(p_group_id, 'treasurer') then
    raise exception 'Only the treasurer can ask to pay out money.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount.';
  end if;
  if length(coalesce(v_reason, '')) < 4 then
    raise exception 'Give a clear reason for the spending.';
  end if;

  perform public.check_sources(p_group_id, v_amount, coalesce(p_bank, 0), coalesce(p_momo, 0), coalesce(p_cash, 0));

  select id into v_me from public.group_members where group_id = p_group_id and user_id = auth.uid();
  insert into public.requests (group_id, kind, requested_by, amount, description,
                               from_bank, from_momo, from_cash)
  values (p_group_id, 'spending', v_me, v_amount, v_reason,
          round(coalesce(p_bank, 0), 2), round(coalesce(p_momo, 0), 2), round(coalesce(p_cash, 0), 2))
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- request_type_change: (any member) ask to change Chilimba <-> Village
-- Banking. If approved, it starts with the next cycle.
-- ---------------------------------------------------------------------
create or replace function public.request_type_change(p_group_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_group  public.groups;
  v_me     uuid;
  v_id     uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_group from public.groups where id = p_group_id;
  select id into v_me from public.group_members where group_id = p_group_id and user_id = auth.uid();
  if v_me is null then
    raise exception 'You are not a member of this group.';
  end if;
  if exists (select 1 from public.requests where group_id = p_group_id
             and kind = 'type_change' and status = 'pending') then
    raise exception 'A request to change the type is already waiting for approval.';
  end if;
  if length(coalesce(v_reason, '')) < 5 then
    raise exception 'Please give a reason. The committee will read it before voting.';
  end if;

  insert into public.requests (group_id, kind, requested_by, description, new_type)
  values (p_group_id, 'type_change', v_me, v_reason,
          case when coalesce(v_group.next_type, v_group.type) = 'chilimba' then 'village' else 'chilimba' end)
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- vote_request: a committee member votes yes or no, then the rules from
-- CLAUDE.md section 6 decide the request:
--   Approved when at least 2 committee members say yes, and at least
--     one of them is the Chairperson or Vice Chairperson.
--   Rejected when the Chairperson says no, or more than half of the
--     eligible committee members say no.
--   The person who asked can't vote, and each person votes only once.
-- The counting happens here in the database, so it can't be skipped.
-- ---------------------------------------------------------------------
create or replace function public.vote_request(p_request_id uuid, p_vote text, p_reason text)
returns text   -- the request's status after the vote
language plpgsql security definer set search_path = ''
as $$
declare
  v_req       public.requests;
  v_me        public.group_members;
  v_eligible  integer;
  v_yes       integer;
  v_no        integer;
  v_lead_yes  boolean;
  v_chair_no  boolean;
  v_avail     record;
begin
  -- Lock the request, so two people voting at the same moment are counted one after the other.
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then
    raise exception 'This request no longer exists.';
  end if;

  select * into v_me from public.group_members
  where group_id = v_req.group_id and user_id = auth.uid();
  if not found or v_me.role = 'member' then
    raise exception 'Only committee members can vote.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;
  if v_me.id = v_req.requested_by then
    raise exception 'You asked for this, so you can''t vote on it.';
  end if;
  if exists (select 1 from public.votes where request_id = p_request_id and member_id = v_me.id) then
    raise exception 'You have already voted on this request.';
  end if;
  if p_vote not in ('yes', 'no') then
    raise exception 'Choose Approve or Reject.';
  end if;

  insert into public.votes (request_id, member_id, vote, reason)
  values (p_request_id, v_me.id, p_vote, nullif(trim(coalesce(p_reason, '')), ''));

  -- Count the votes
  select count(*) into v_eligible from public.group_members
  where group_id = v_req.group_id and role <> 'member' and id <> v_req.requested_by;

  select count(*) filter (where v.vote = 'yes'),
         count(*) filter (where v.vote = 'no'),
         coalesce(bool_or(v.vote = 'yes' and m.role in ('chair', 'vice')), false),
         coalesce(bool_or(v.vote = 'no'  and m.role = 'chair'), false)
  into v_yes, v_no, v_lead_yes, v_chair_no
  from public.votes v join public.group_members m on m.id = v.member_id
  where v.request_id = p_request_id;

  if v_chair_no or v_no * 2 > v_eligible then
    update public.requests set status = 'rejected', decided_at = now() where id = p_request_id;
    if v_req.kind = 'loan' then
      update public.loans set status = 'rejected' where request_id = p_request_id;
    end if;
    return 'rejected';
  end if;

  if v_yes >= 2 and v_lead_yes then
    -- Safety check: the money must still be there.
    if v_req.kind in ('payout', 'spending') then
      select * into v_avail from public.group_holdings(v_req.group_id);
      if v_req.from_bank > v_avail.bank or v_req.from_momo > v_avail.momo or v_req.from_cash > v_avail.cash then
        raise exception 'The group no longer holds enough money in the places this request takes it from. The treasurer should ask again.';
      end if;
    end if;
    -- A loan can't be larger than the money the group holds.
    if v_req.kind = 'loan' then
      select * into v_avail from public.group_available(v_req.group_id);
      if v_req.amount > v_avail.bank + v_avail.momo + v_avail.cash then
        raise exception 'The group only has % available, which is less than this loan.',
          public.fmt_k(v_avail.bank + v_avail.momo + v_avail.cash);
      end if;
    end if;

    update public.requests set status = 'approved', decided_at = now() where id = p_request_id;

    if v_req.kind = 'type_change' then
      update public.groups set next_type = v_req.new_type where id = v_req.group_id;
    end if;
    if v_req.kind = 'loan' then
      update public.loans set status = 'approved' where request_id = p_request_id;
    end if;
    return 'approved';
  end if;

  return 'pending';
end;
$$;


-- ---------------------------------------------------------------------
-- protect_request: a request can never be edited. The only change
-- allowed is its decision (pending -> approved or rejected), made by
-- vote_request.
-- ---------------------------------------------------------------------
create or replace function public.protect_request()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'decided_at') is distinct from (to_jsonb(old) - 'status' - 'decided_at') then
    raise exception 'Requests can never be changed.';
  end if;
  if old.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_request on public.requests;
create trigger protect_request
  before update on public.requests
  for each row execute function public.protect_request();


-- ---------------------------------------------------------------------
-- History for requests and votes, written by triggers.
-- A loan request's history is about the borrower (privacy rules).
-- ---------------------------------------------------------------------
create or replace function public.requests_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title   text := public.request_title(new);
  v_subject uuid := case when new.kind = 'loan' then new.requested_by end;
begin
  if tg_op = 'INSERT' then
    perform public.write_history(new.group_id,
      format('Asked for approval: %s.%s', v_title,
             case when new.kind in ('type_change', 'loan') then ' Reason: "' || new.description || '"' else '' end),
      v_subject);
  elsif new.status = 'approved' then
    perform public.write_auto_history(new.group_id,
      format('Approved: %s. %s', v_title,
             case new.kind
               when 'type_change' then 'It will start with the next cycle.'
               when 'loan'        then 'The treasurer can now send the money.'
               else 'The money is now counted as paid out.' end),
      v_subject);
  elsif new.status = 'rejected' then
    perform public.write_auto_history(new.group_id,
      format('Rejected: %s.%s', v_title, case when new.kind = 'type_change' then '' else ' No money was moved.' end),
      v_subject);
  end if;
  return new;
end;
$$;

drop trigger if exists requests_history on public.requests;
create trigger requests_history
  after insert or update of status on public.requests
  for each row execute function public.requests_history();


create or replace function public.votes_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_req public.requests;
begin
  select * into v_req from public.requests where id = new.request_id;
  perform public.write_history(v_req.group_id,
    format('Voted %s on: %s.%s', new.vote, public.request_title(v_req),
           case when new.reason is not null then ' Reason: "' || new.reason || '"' else '' end),
    case when v_req.kind = 'loan' then v_req.requested_by end);
  return new;
end;
$$;

drop trigger if exists votes_history on public.votes;
create trigger votes_history
  after insert on public.votes
  for each row execute function public.votes_history();


-- ---------------------------------------------------------------------
-- Who may use the Phase 3 functions.
-- ---------------------------------------------------------------------
revoke execute on function public.write_auto_history(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.group_available(uuid)                from public, anon, authenticated;
revoke execute on function public.check_sources(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.request_title(public.requests)        from public, anon, authenticated;

revoke execute on function public.request_payout(uuid, numeric, numeric, numeric, numeric)        from public, anon;
revoke execute on function public.request_spending(uuid, numeric, text, numeric, numeric, numeric) from public, anon;
revoke execute on function public.request_type_change(uuid, text)                                 from public, anon;
revoke execute on function public.vote_request(uuid, text, text)                                  from public, anon;

grant execute on function public.request_payout(uuid, numeric, numeric, numeric, numeric)        to authenticated;
grant execute on function public.request_spending(uuid, numeric, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.request_type_change(uuid, text)                                 to authenticated;
grant execute on function public.vote_request(uuid, text, text)                                  to authenticated;


-- =====================================================================
-- Phase 4: village banking share-out
-- =====================================================================

-- ---------------------------------------------------------------------
-- group_interest_received: loan interest the group has received, from
-- confirmed repayments. This first version is zero; the Phase 5 section
-- below replaces it with the real sum (it needs loan_figures, which is
-- defined there).
-- ---------------------------------------------------------------------
create or replace function public.group_interest_received(gid uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select 0::numeric;
$$;


-- ---------------------------------------------------------------------
-- shareout: "if the share-out happened today" (CLAUDE.md section 8).
--
--   Money to share = confirmed savings
--                  + confirmed loan interest received
--                  + fees and fines
--                  - approved group spending
--   A member's share = (their confirmed savings / total confirmed
--                       savings) x money to share, rounded to the ngwee.
--
-- Only confirmed savings count. Payments replaced by a correction
-- don't count.
--
-- Privacy (CLAUDE.md section 7): every member gets the group totals, so
-- they can check the numbers add up. The committee gets everyone's
-- share; an ordinary member gets only their own.
-- ---------------------------------------------------------------------
create or replace function public.shareout(gid uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_group     public.groups;
  v_me        public.group_members;
  v_savings   numeric;
  v_interest  numeric;
  v_fees      numeric;
  v_spent     numeric;
  v_to_share  numeric;
  v_rows      jsonb;
  v_total_rnd numeric;
begin
  select * into v_me from public.group_members where group_id = gid and user_id = auth.uid();
  if not found then
    raise exception 'You are not a member of this group.';
  end if;
  select * into v_group from public.groups where id = gid;
  if v_group.type <> 'village' then
    raise exception 'The share-out is only for village banking groups.';
  end if;

  -- The four parts of "money to share"
  select coalesce(sum(amount), 0) into v_savings
  from public.active_payments(gid) where kind = 'saving' and status = 'confirmed';

  select coalesce(sum(amount), 0) into v_fees
  from public.active_payments(gid) where kind in ('fee', 'fine') and status = 'confirmed';

  v_interest := public.group_interest_received(gid);

  select coalesce(sum(amount), 0) into v_spent
  from public.requests where group_id = gid and kind = 'spending' and status = 'approved';

  v_to_share := v_savings + v_interest + v_fees - v_spent;

  -- Every member's savings and share
  with saved as (
    select m.id, m.full_name,
           coalesce((select sum(p.amount) from public.active_payments(gid) p
                     where p.member_id = m.id and p.kind = 'saving' and p.status = 'confirmed'), 0) as saved
    from public.group_members m
    where m.group_id = gid
  ),
  shares as (
    select id, full_name, saved,
           case when v_savings > 0 then round(saved / v_savings * v_to_share, 2) else 0 end as share
    from saved
  )
  select
    -- The check uses everyone's share, even when only one row is returned.
    (select coalesce(sum(share), 0) from shares),
    coalesce(jsonb_agg(jsonb_build_object('member_id', id, 'saved', saved, 'share', share)
                       order by saved desc, full_name)
             filter (where v_me.role <> 'member' or id = v_me.id), '[]'::jsonb)
  into v_total_rnd, v_rows
  from shares;

  return jsonb_build_object(
    'savings',        v_savings,
    'interest',       v_interest,
    'fees_fines',     v_fees,
    'spent',          v_spent,
    'money_to_share', v_to_share,
    'shares_total',   v_total_rnd,
    -- Savings not counted yet (waiting for the member or disputed)
    'waiting_all',    (select coalesce(sum(amount), 0) from public.active_payments(gid)
                       where kind = 'saving' and status <> 'confirmed'),
    'waiting_mine',   (select coalesce(sum(amount), 0) from public.active_payments(gid)
                       where kind = 'saving' and status <> 'confirmed' and member_id = v_me.id),
    'rows',           v_rows
  );
end;
$$;

revoke execute on function public.group_interest_received(uuid) from public, anon, authenticated;
revoke execute on function public.shareout(uuid) from public, anon;
grant  execute on function public.shareout(uuid) to authenticated;


-- =====================================================================
-- Phase 5: loans (village banking)
-- =====================================================================

-- ---------------------------------------------------------------------
-- loan_figures: the maths for every loan in a group (CLAUDE.md section 8).
--   Interest          = amount x rate x months (flat)
--   Total to repay    = amount + interest
--   Repaid so far     = all repayments that count (not replaced)
--   Interest received = the smaller of (confirmed repayments, interest)
--                       Repayments pay off the interest first.
--   Still lent out    = amount - the part of repayments above the interest
--   Due by the end of month (start month + months). Overdue when this
--   month is later than that and money is still owed.
-- ---------------------------------------------------------------------
create or replace function public.loan_figures(gid uuid)
returns table (
  loan_id           uuid,
  member_id         uuid,
  status            text,
  interest          numeric,
  total             numeric,
  paid              numeric,
  paid_confirmed    numeric,
  remaining         numeric,
  interest_received numeric,
  outstanding       numeric,
  due_month         integer,
  overdue           boolean
)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.member_id, l.status,
         x.interest,
         x.total,
         r.paid,
         r.paid_confirmed,
         greatest(0, x.total - r.paid),
         least(r.paid_confirmed, x.interest),
         case when l.sent_on is not null then greatest(0, l.amount - greatest(0, r.paid - x.interest)) else 0 end,
         l.start_month + l.months,
         (l.sent_on is not null and x.total - r.paid > 0
          and public.cycle_month(g.start_month) > l.start_month + l.months)
  from public.loans l
  join public.groups g on g.id = l.group_id
  cross join lateral (
    select round(l.amount * l.rate / 100 * l.months, 2) as interest,
           l.amount + round(l.amount * l.rate / 100 * l.months, 2) as total
  ) x
  cross join lateral (
    select coalesce(sum(rp.amount), 0) as paid,
           coalesce(sum(rp.amount) filter (where rp.status = 'confirmed'), 0) as paid_confirmed
    from public.loan_repayments rp
    where rp.loan_id = l.id
      and not exists (select 1 from public.loan_repayments c where c.corrects_id = rp.id)
  ) r
  where l.group_id = gid;
$$;


-- Now that loan_figures exists: the real interest received (replaces
-- the Phase 4 version that returned zero).
create or replace function public.group_interest_received(gid uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(interest_received), 0) from public.loan_figures(gid);
$$;


-- ---------------------------------------------------------------------
-- ask_loan: a village banking member asks to borrow. It becomes a loan
-- request that the committee votes on with the normal approval rules.
-- Rules (set when the group was created):
--   - at most loan_multiple x the member's confirmed savings
--   - at most loan_max_months to repay
--   - one open loan per member at a time
--   - not more than the money the group holds
-- ---------------------------------------------------------------------
create or replace function public.ask_loan(p_group_id uuid, p_amount numeric, p_months integer, p_purpose text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_group   public.groups;
  v_me      public.group_members;
  v_amount  numeric := round(p_amount, 2);
  v_purpose text    := nullif(trim(coalesce(p_purpose, '')), '');
  v_saved   numeric;
  v_limit   numeric;
  v_avail   record;
  v_req_id  uuid;
begin
  select * into v_group from public.groups where id = p_group_id;
  select * into v_me from public.group_members where group_id = p_group_id and user_id = auth.uid();
  if v_me.id is null then
    raise exception 'You are not a member of this group.';
  end if;
  if v_group.type <> 'village' then
    raise exception 'Loans are only for village banking groups.';
  end if;

  if exists (select 1 from public.loans where member_id = v_me.id
             and status in ('requested', 'approved', 'active')) then
    raise exception 'You already have a loan. You can ask again once it is fully repaid.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter how much you want to borrow.';
  end if;
  if p_months is null or p_months not between 1 and v_group.loan_max_months then
    raise exception 'Choose between 1 and % months to repay.', v_group.loan_max_months;
  end if;
  if length(coalesce(v_purpose, '')) < 4 then
    raise exception 'Say what the loan is for. The committee reads this before voting.';
  end if;

  select coalesce(sum(amount), 0) into v_saved
  from public.active_payments(p_group_id)
  where member_id = v_me.id and kind = 'saving' and status = 'confirmed';
  v_limit := round(v_saved * v_group.loan_multiple, 2);
  if v_amount > v_limit then
    raise exception 'The most you can borrow is % (% times your savings of %).',
      public.fmt_k(v_limit), public.fmt_num(v_group.loan_multiple), public.fmt_k(v_saved);
  end if;

  select * into v_avail from public.group_available(p_group_id);
  if v_amount > v_avail.bank + v_avail.momo + v_avail.cash then
    raise exception 'The group only has % available to lend right now.',
      public.fmt_k(v_avail.bank + v_avail.momo + v_avail.cash);
  end if;

  insert into public.requests (group_id, kind, requested_by, amount, description, loan_months)
  values (p_group_id, 'loan', v_me.id, v_amount, v_purpose, p_months)
  returning id into v_req_id;

  insert into public.loans (group_id, member_id, request_id, amount, months, rate, purpose)
  values (p_group_id, v_me.id, v_req_id, v_amount, p_months, v_group.loan_rate, v_purpose);

  return v_req_id;
end;
$$;


-- ---------------------------------------------------------------------
-- send_loan: (treasurer) record sending an approved loan: from which
-- place, and a reference. The loan starts in this month of the cycle.
-- ---------------------------------------------------------------------
create or replace function public.send_loan(p_loan_id uuid, p_from_place text, p_reference text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_loan  public.loans;
  v_group public.groups;
  v_ref   text := nullif(trim(coalesce(p_reference, '')), '');
  v_avail record;
  v_have  numeric;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not public.has_role(v_loan.group_id, 'treasurer') then
    raise exception 'Only the treasurer can send loans.';
  end if;
  if v_loan.status <> 'approved' then
    raise exception 'Only approved loans can be sent.';
  end if;
  if coalesce(p_from_place, '') not in ('bank', 'momo', 'cash') then
    raise exception 'Choose where the money is sent from.';
  end if;
  if length(coalesce(v_ref, '')) < 3 then
    raise exception 'Enter the transaction or slip number.';
  end if;

  select * into v_avail from public.group_available(v_loan.group_id);
  v_have := case p_from_place when 'bank' then v_avail.bank when 'momo' then v_avail.momo else v_avail.cash end;
  if v_loan.amount > v_have then
    raise exception 'Only % is available there. Choose another place.', public.fmt_k(v_have);
  end if;

  select * into v_group from public.groups where id = v_loan.group_id;
  update public.loans
  set status = 'active',
      sent_from = p_from_place,
      sent_reference = v_ref,
      sent_on = public.today_zm(),
      sent_by = auth.uid(),
      start_month = greatest(1, least(public.cycle_month(v_group.start_month), v_group.cycle_months))
  where id = p_loan_id;
end;
$$;


-- ---------------------------------------------------------------------
-- confirm_loan_received: the borrower confirms they got the money.
-- ---------------------------------------------------------------------
create or replace function public.confirm_loan_received(p_loan_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found or not exists (select 1 from public.group_members
                              where id = v_loan.member_id and user_id = auth.uid()) then
    raise exception 'Only the borrower can confirm receiving the loan.';
  end if;
  if v_loan.sent_on is null then
    raise exception 'The money has not been sent yet.';
  end if;
  if v_loan.received_at is not null then
    raise exception 'You have already confirmed receiving this loan.';
  end if;
  update public.loans set received_at = now() where id = p_loan_id;
end;
$$;


-- ---------------------------------------------------------------------
-- record_repayment: (treasurer) record money paid back on a loan.
-- The borrower then confirms or disputes it, like a payment.
-- ---------------------------------------------------------------------
create or replace function public.record_repayment(p_loan_id uuid, p_amount numeric, p_paid_on date,
                                                   p_method text, p_reference text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_loan   public.loans;
  v_fig    record;
  v_amount numeric := round(p_amount, 2);
  v_ref    text    := nullif(trim(coalesce(p_reference, '')), '');
  v_id     uuid;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found or not public.has_role(v_loan.group_id, 'treasurer') then
    raise exception 'Only the treasurer can record repayments.';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'Repayments can only be recorded for loans that are being repaid.';
  end if;

  select * into v_fig from public.loan_figures(v_loan.group_id) where loan_id = p_loan_id;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount repaid.';
  end if;
  if v_amount > v_fig.remaining then
    raise exception 'That is more than the % still to pay.', public.fmt_k(v_fig.remaining);
  end if;
  if p_paid_on is null or p_paid_on > public.today_zm() then
    raise exception 'Choose the date the money was paid (not in the future).';
  end if;
  if coalesce(p_method, '') not in ('airtel', 'mtn', 'zamtel', 'cash', 'bank') then
    raise exception 'Choose how they paid.';
  end if;
  if p_method in ('airtel', 'mtn', 'zamtel') and length(coalesce(v_ref, '')) < 6 then
    raise exception 'Enter the transaction reference from the mobile money message.';
  end if;
  if p_method = 'cash' then
    v_ref := null;
  end if;

  insert into public.loan_repayments (group_id, loan_id, amount, paid_on, method, reference, recorded_by)
  values (v_loan.group_id, p_loan_id, v_amount, p_paid_on, p_method, v_ref, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- mark_loan_if_repaid: when confirmed repayments cover the total to
-- repay, the loan is "Fully repaid".
-- ---------------------------------------------------------------------
create or replace function public.mark_loan_if_repaid(p_loan_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_loan public.loans;
  v_fig  record;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  select * into v_fig from public.loan_figures(v_loan.group_id) where loan_id = p_loan_id;
  if v_loan.status = 'active' and v_fig.paid_confirmed >= v_fig.total then
    update public.loans set status = 'repaid' where id = p_loan_id;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- answer_repayment: the borrower confirms or disputes a repayment.
-- ---------------------------------------------------------------------
create or replace function public.answer_repayment(p_repayment_id uuid, p_answer text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_rp     public.loan_repayments;
  v_loan   public.loans;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_rp from public.loan_repayments where id = p_repayment_id;
  select * into v_loan from public.loans where id = v_rp.loan_id;
  if v_rp.id is null or not exists (select 1 from public.group_members
                                    where id = v_loan.member_id and user_id = auth.uid()) then
    raise exception 'Only the borrower can confirm or dispute this repayment.';
  end if;
  if exists (select 1 from public.loan_repayments where corrects_id = p_repayment_id) then
    raise exception 'This repayment was replaced by a correction. Answer the correction instead.';
  end if;
  if v_rp.status <> 'waiting' then
    raise exception 'You have already answered for this repayment.';
  end if;
  if p_answer not in ('confirmed', 'disputed') then
    raise exception 'Choose "Yes, I paid this" or "This is wrong".';
  end if;
  if p_answer = 'disputed' and length(coalesce(v_reason, '')) < 5 then
    raise exception 'Please explain what is wrong in a few words.';
  end if;

  update public.loan_repayments
  set status = p_answer,
      dispute_reason = case when p_answer = 'disputed' then v_reason end,
      answered_at = now()
  where id = p_repayment_id;

  perform public.mark_loan_if_repaid(v_loan.id);
end;
$$;


-- ---------------------------------------------------------------------
-- correct_repayment: (treasurer) fix a repayment mistake. Same idea as
-- correct_payment: the original stays visible, the borrower confirms.
-- ---------------------------------------------------------------------
create or replace function public.correct_repayment(p_original_id uuid, p_amount numeric,
                                                    p_method text, p_reference text, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig   public.loan_repayments;
  v_fig    record;
  v_amount numeric := round(p_amount, 2);
  v_ref    text    := nullif(trim(coalesce(p_reference, '')), '');
  v_reason text    := nullif(trim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  select * into v_orig from public.loan_repayments where id = p_original_id;
  if not found or not public.has_role(v_orig.group_id, 'treasurer') then
    raise exception 'Only the treasurer can add corrections.';
  end if;
  if exists (select 1 from public.loan_repayments where corrects_id = p_original_id) then
    raise exception 'This repayment has already been corrected. Correct the newest entry instead.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the correct amount.';
  end if;
  select * into v_fig from public.loan_figures(v_orig.group_id) where loan_id = v_orig.loan_id;
  if v_amount > v_fig.remaining + v_orig.amount then
    raise exception 'That is more than the % still to pay.', public.fmt_k(v_fig.remaining + v_orig.amount);
  end if;
  if coalesce(p_method, '') not in ('airtel', 'mtn', 'zamtel', 'cash', 'bank') then
    raise exception 'Choose how they paid.';
  end if;
  if p_method in ('airtel', 'mtn', 'zamtel') and length(coalesce(v_ref, '')) < 6 then
    raise exception 'Enter the transaction reference from the mobile money message.';
  end if;
  if p_method = 'cash' then
    v_ref := null;
  end if;
  if length(coalesce(v_reason, '')) < 5 then
    raise exception 'Explain why you are making this correction. The committee will read it.';
  end if;

  insert into public.loan_repayments (group_id, loan_id, amount, paid_on, method, reference,
                                      recorded_by, corrects_id, correction_reason)
  values (v_orig.group_id, v_orig.loan_id, v_amount, v_orig.paid_on, p_method, v_ref,
          auth.uid(), v_orig.id, v_reason)
  returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- Records can never be edited: repayments use the same protection as
-- payments, and loans may only move forward through their steps.
-- ---------------------------------------------------------------------
drop trigger if exists protect_repayment on public.loan_repayments;
create trigger protect_repayment
  before update on public.loan_repayments
  for each row execute function public.protect_answered_record();

create or replace function public.protect_loan()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  changeable text[] := array['status', 'start_month', 'sent_from', 'sent_reference', 'sent_on', 'sent_by', 'received_at'];
begin
  if (to_jsonb(new) - changeable) is distinct from (to_jsonb(old) - changeable) then
    raise exception 'Loans can never be changed.';
  end if;
  -- Once sent or received, those details are fixed.
  if old.sent_on is not null and (to_jsonb(new) -> 'sent_reference', to_jsonb(new) -> 'sent_from', new.sent_on, new.start_month)
     is distinct from (to_jsonb(old) -> 'sent_reference', to_jsonb(old) -> 'sent_from', old.sent_on, old.start_month) then
    raise exception 'A sent loan can''t be changed.';
  end if;
  if old.received_at is not null and new.received_at is distinct from old.received_at then
    raise exception 'Receipt of this loan is already confirmed.';
  end if;
  if old.status in ('rejected', 'repaid') then
    raise exception 'This loan is closed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_loan on public.loans;
create trigger protect_loan
  before update on public.loans
  for each row execute function public.protect_loan();


-- ---------------------------------------------------------------------
-- History for loans and repayments, written by triggers. Every entry's
-- subject is the borrower, so in village banking only the borrower and
-- the committee see it (privacy rules).
-- ---------------------------------------------------------------------
create or replace function public.loans_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name  text;
  v_start date;
  v_place text;
begin
  select full_name into v_name from public.group_members where id = new.member_id;
  select start_month into v_start from public.groups where id = new.group_id;

  if old.sent_on is null and new.sent_on is not null then
    v_place := case new.sent_from when 'bank' then 'the group bank account'
                                  when 'momo' then 'mobile money' else 'cash' end;
    perform public.write_history(new.group_id,
      format('Sent the %s loan to %s from %s. Reference: %s. To be repaid by the end of %s.',
             public.fmt_k(new.amount), v_name, v_place, new.sent_reference,
             public.month_label(v_start, new.start_month + new.months)),
      new.member_id);
  end if;

  if old.received_at is null and new.received_at is not null then
    perform public.write_history(new.group_id,
      format('Confirmed receiving the %s loan.', public.fmt_k(new.amount)), new.member_id);
  end if;

  if old.status <> 'repaid' and new.status = 'repaid' then
    perform public.write_auto_history(new.group_id,
      format('%s''s loan of %s is fully repaid.', v_name, public.fmt_k(new.amount)), new.member_id);
  end if;
  return new;
end;
$$;

drop trigger if exists loans_history on public.loans;
create trigger loans_history
  after update on public.loans
  for each row execute function public.loans_history();


create or replace function public.repayments_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_loan public.loans;
  v_name text;
  v_orig public.loan_repayments;
begin
  select * into v_loan from public.loans where id = new.loan_id;
  select full_name into v_name from public.group_members where id = v_loan.member_id;

  if tg_op = 'INSERT' and new.corrects_id is null then
    perform public.write_history(new.group_id,
      format('Recorded a loan repayment of %s from %s. Paid by %s%s.',
             public.fmt_k(new.amount), v_name, public.method_label(new.method),
             case when new.reference is not null then ', reference ' || new.reference else '' end),
      v_loan.member_id);
  elsif tg_op = 'INSERT' then
    select * into v_orig from public.loan_repayments where id = new.corrects_id;
    perform public.write_history(new.group_id,
      format('Added a correction to %s''s loan repayment: %s changed to %s. Reason: "%s". The original entry is kept.',
             v_name, public.fmt_k(v_orig.amount), public.fmt_k(new.amount), new.correction_reason),
      v_loan.member_id);
  elsif new.status = 'confirmed' and old.status <> 'confirmed' then
    perform public.write_history(new.group_id,
      format('Confirmed the %s loan repayment is correct.', public.fmt_k(new.amount)), v_loan.member_id);
  elsif new.status = 'disputed' and old.status <> 'disputed' then
    perform public.write_history(new.group_id,
      format('Said the %s loan repayment is wrong: "%s"', public.fmt_k(new.amount), new.dispute_reason),
      v_loan.member_id);
  end if;
  return new;
end;
$$;

drop trigger if exists repayments_history on public.loan_repayments;
create trigger repayments_history
  after insert or update of status on public.loan_repayments
  for each row execute function public.repayments_history();


-- ---------------------------------------------------------------------
-- Who may use the Phase 5 functions.
-- ---------------------------------------------------------------------
revoke execute on function public.loan_figures(uuid)            from public, anon, authenticated;
revoke execute on function public.group_interest_received(uuid) from public, anon, authenticated;
revoke execute on function public.mark_loan_if_repaid(uuid)     from public, anon, authenticated;

revoke execute on function public.ask_loan(uuid, numeric, integer, text)                     from public, anon;
revoke execute on function public.send_loan(uuid, text, text)                               from public, anon;
revoke execute on function public.confirm_loan_received(uuid)                               from public, anon;
revoke execute on function public.record_repayment(uuid, numeric, date, text, text)         from public, anon;
revoke execute on function public.answer_repayment(uuid, text, text)                        from public, anon;
revoke execute on function public.correct_repayment(uuid, numeric, text, text, text)        from public, anon;

grant execute on function public.ask_loan(uuid, numeric, integer, text)                     to authenticated;
grant execute on function public.send_loan(uuid, text, text)                               to authenticated;
grant execute on function public.confirm_loan_received(uuid)                               to authenticated;
grant execute on function public.record_repayment(uuid, numeric, date, text, text)         to authenticated;
grant execute on function public.answer_repayment(uuid, text, text)                        to authenticated;
grant execute on function public.correct_repayment(uuid, numeric, text, text, text)        to authenticated;
