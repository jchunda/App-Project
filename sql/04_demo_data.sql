-- =====================================================================
-- Usambazi: 04_demo_data.sql
-- Demo data for the presentation (CLAUDE.md section 11).
--
-- Creates two groups, with months of history:
--   * Kalingalinga Women's Chilimba: 8 members, K500 a month, in Month 4
--     of an 8-month cycle. Months 1-3 fully paid and paid out. Month 4:
--     some confirmed, two waiting, one disputed (recorded K300, member
--     says she paid K500), one not paid. The treasurer holds most of the
--     money, so the warning shows. A small spending request is waiting.
--   * Matero Village Savings: 10 members, different amounts, in Month 6
--     of a 12-month cycle. Registration fees and late fines, one
--     approved and one rejected spending request, one fully repaid
--     loan, two loans being repaid, one overdue loan, and one loan
--     request waiting for approval.
--
-- The dates are worked out from today, so the demo is always "in"
-- Month 4 and Month 6, whenever you run it.
--
-- DEMO LOGINS
--   First sign up these accounts in the app ("Create an account"),
--   using any password (for example Usambazi2026 for all of them):
--
--     Chilimba:        mwila@example.com   (Mwila Banda, Chairperson)
--                      chanda@example.com  (Chanda Phiri, Treasurer)
--                      bwalya@example.com  (Bwalya Mulenga, ordinary member)
--     Village Banking: kelvin@example.com  (Kelvin Chanda, Chairperson)
--                      agnes@example.com   (Agnes Mwale, Treasurer)
--                      joseph@example.com  (Joseph Tembo, ordinary member)
--
--   Then run this file. It links each account to that person.
--   If Supabase refuses an email, use another one and change it in the
--   two lists marked "DEMO EMAILS" below.
--
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Run 01, 02 and 03 first. Safe to run again: it deletes the two demo
-- groups (only those two) and creates them fresh.
-- =====================================================================

begin;

-- Start fresh: remove the two demo groups and everything in them.
delete from public.groups where name in ('Kalingalinga Women''s Chilimba', 'Matero Village Savings');

-- While loading old records, the automatic history triggers are paused,
-- so the history can be written with the real (past) dates instead of
-- today's date. They are switched back on at the end of this file.
alter table public.payments        disable trigger payments_history;
alter table public.requests        disable trigger requests_history;
alter table public.votes           disable trigger votes_history;
alter table public.loan_repayments disable trigger repayments_history;
alter table public.bank_deposits   disable trigger deposits_history;
alter table public.loans           disable trigger loans_history;


-- ---------------------------------------------------------------------
-- Small helpers, only for this file. "pg_temp" means they disappear
-- when you close the SQL Editor.
-- ---------------------------------------------------------------------

-- A moment in the cycle: month m, day, hour, minute (Zambia time).
-- Never later than now, in case you run this early in a month.
create or replace function pg_temp.demo_ts(p_start date, p_month integer, p_day integer, p_hour integer, p_min integer)
returns timestamptz language sql as $$
  select least(
    ((p_start + make_interval(months => p_month - 1, days => p_day - 1, hours => p_hour, mins => p_min))::timestamp
      at time zone 'Africa/Lusaka'),
    now() - interval '5 minutes');
$$;

-- A realistic-looking transaction reference.
create or replace function pg_temp.demo_ref(p_method text, p_ts timestamptz)
returns text language sql volatile as $$
  select case p_method
    when 'airtel' then 'MP' || to_char(p_ts at time zone 'Africa/Lusaka', 'YYMMDD.HH24MI') || '.'
                      || substr('ABCDEFGHJK', 1 + floor(random() * 10)::int, 1)
                      || lpad(floor(random() * 100000)::int::text, 5, '0')
    when 'mtn'    then (1 + floor(random() * 9)::int)::text || lpad(floor(random() * 1000000000)::bigint::text, 9, '0')
    when 'zamtel' then 'ZK' || lpad(floor(random() * 100000000)::bigint::text, 8, '0')
    when 'bank'   then 'Slip ' || lpad(floor(random() * 1000000)::int::text, 6, '0')
    else null end;
$$;

-- One history line. p_actor is a member id (null = Usambazi automatic).
create or replace function pg_temp.demo_log(p_group uuid, p_actor uuid, p_text text, p_ts timestamptz, p_subject uuid)
returns void language sql as $$
  insert into public.history (group_id, actor_user, actor_name, action, subject_member, created_at)
  select p_group, m.user_id, coalesce(m.full_name, 'Usambazi (automatic)'), p_text, p_subject, p_ts
  from (select 1) one
  left join public.group_members m on m.id = p_actor;
$$;

-- One payment recorded by the treasurer, and the member's answer.
create or replace function pg_temp.demo_pay(p_group uuid, p_member uuid, p_kind text, p_amount numeric,
                                            p_month integer, p_ts timestamptz, p_method text,
                                            p_status text, p_answer_ts timestamptz, p_dispute text)
returns void language plpgsql as $$
declare
  v_t     public.group_members;
  v_m     public.group_members;
  v_start date;
  v_ref   text := pg_temp.demo_ref(p_method, p_ts);
begin
  select * into v_t from public.group_members where group_id = p_group and role = 'treasurer';
  select * into v_m from public.group_members where id = p_member;
  select start_month into v_start from public.groups where id = p_group;

  insert into public.payments (group_id, member_id, kind, amount, cycle_month, paid_on, method, reference,
                               status, dispute_reason, recorded_by, created_at, answered_at)
  values (p_group, p_member, p_kind, p_amount, p_month, (p_ts at time zone 'Africa/Lusaka')::date, p_method, v_ref,
          p_status, p_dispute, v_t.user_id, p_ts, case when p_status <> 'waiting' then p_answer_ts end);

  perform pg_temp.demo_log(p_group, v_t.id,
    format('Recorded %s%s from %s for %s. Paid by %s%s.',
           case p_kind when 'fee' then 'a fee of ' when 'fine' then 'a fine of ' else '' end,
           public.fmt_k(p_amount), v_m.full_name, public.month_label(v_start, p_month),
           public.method_label(p_method), case when v_ref is not null then ', reference ' || v_ref else '' end),
    p_ts, p_member);

  if p_status = 'confirmed' then
    perform pg_temp.demo_log(p_group, p_member,
      format('Confirmed that the %s payment for Month %s is correct.', public.fmt_k(p_amount), p_month),
      p_answer_ts, p_member);
  elsif p_status = 'disputed' then
    perform pg_temp.demo_log(p_group, p_member,
      format('Said the %s payment recorded for Month %s is wrong: "%s"', public.fmt_k(p_amount), p_month, p_dispute),
      p_answer_ts, p_member);
  end if;
end;
$$;

-- A committee member's vote, with its history line.
create or replace function pg_temp.demo_vote(p_request uuid, p_member uuid, p_vote text, p_ts timestamptz, p_reason text)
returns void language plpgsql as $$
declare
  v_r public.requests;
begin
  select * into v_r from public.requests where id = p_request;
  insert into public.votes (request_id, member_id, vote, reason, created_at)
  values (p_request, p_member, p_vote, p_reason, p_ts);
  perform pg_temp.demo_log(v_r.group_id, p_member,
    format('Voted %s on: %s.%s', p_vote, public.request_title(v_r),
           case when p_reason is not null then ' Reason: "' || p_reason || '"' else '' end),
    p_ts, case when v_r.kind = 'loan' then v_r.requested_by end);
end;
$$;

-- A payout or spending request (and its decision, if decided).
create or replace function pg_temp.demo_request(p_group uuid, p_kind text, p_amount numeric, p_description text,
                                                p_payout_to uuid, p_month integer,
                                                p_bank numeric, p_momo numeric, p_cash numeric,
                                                p_status text, p_ts timestamptz, p_decided_ts timestamptz)
returns uuid language plpgsql as $$
declare
  v_t  public.group_members;
  v_id uuid;
  v_r  public.requests;
begin
  select * into v_t from public.group_members where group_id = p_group and role = 'treasurer';
  insert into public.requests (group_id, kind, status, requested_by, amount, description, payout_to, cycle_month,
                               from_bank, from_momo, from_cash, created_at, decided_at)
  values (p_group, p_kind, p_status, v_t.id, p_amount, p_description, p_payout_to, p_month,
          p_bank, p_momo, p_cash, p_ts, case when p_status <> 'pending' then p_decided_ts end)
  returning id into v_id;
  select * into v_r from public.requests where id = v_id;
  perform pg_temp.demo_log(p_group, v_t.id, format('Asked for approval: %s.', public.request_title(v_r)), p_ts, null);
  return v_id;
end;
$$;

-- The automatic "Approved: ..." / "Rejected: ..." line.
create or replace function pg_temp.demo_decision(p_request uuid, p_ts timestamptz)
returns void language plpgsql as $$
declare
  v_r public.requests;
begin
  select * into v_r from public.requests where id = p_request;
  perform pg_temp.demo_log(v_r.group_id, null,
    case when v_r.status = 'approved'
         then format('Approved: %s. %s', public.request_title(v_r),
                     case when v_r.kind = 'loan' then 'The treasurer can now send the money.'
                          else 'The money is now counted as paid out.' end)
         else format('Rejected: %s. No money was moved.', public.request_title(v_r)) end,
    p_ts, case when v_r.kind = 'loan' then v_r.requested_by end);
end;
$$;

-- Move all mobile money and cash the treasurer holds into the bank.
create or replace function pg_temp.demo_deposit_all(p_group uuid, p_ts timestamptz)
returns void language plpgsql as $$
declare
  v_t    public.group_members;
  v_hold record;
  v_ref  text;
begin
  select * into v_t from public.group_members where group_id = p_group and role = 'treasurer';
  select * into v_hold from public.group_holdings(p_group);
  if v_hold.momo > 0 then
    v_ref := pg_temp.demo_ref('bank', p_ts);
    insert into public.bank_deposits (group_id, from_place, amount, reference, deposited_on, recorded_by, created_at)
    values (p_group, 'momo', v_hold.momo, v_ref, (p_ts at time zone 'Africa/Lusaka')::date, v_t.user_id, p_ts);
    perform pg_temp.demo_log(p_group, v_t.id,
      format('Moved %s from mobile money to the group bank account. Deposit reference: %s.', public.fmt_k(v_hold.momo), v_ref), p_ts, null);
  end if;
  if v_hold.cash > 0 then
    v_ref := pg_temp.demo_ref('bank', p_ts);
    insert into public.bank_deposits (group_id, from_place, amount, reference, deposited_on, recorded_by, created_at)
    values (p_group, 'cash', v_hold.cash, v_ref, (p_ts at time zone 'Africa/Lusaka')::date, v_t.user_id, p_ts + interval '25 minutes');
    perform pg_temp.demo_log(p_group, v_t.id,
      format('Moved %s from cash to the group bank account. Deposit reference: %s.', public.fmt_k(v_hold.cash), v_ref),
      p_ts + interval '25 minutes', null);
  end if;
end;
$$;

-- A whole loan story: request, votes, sending, receipt and repayments.
-- p_voters: committee members who said yes (2 = approved, 1 = still waiting).
-- p_pays:   [[month, day, amount, method], ...] confirmed repayments.
create or replace function pg_temp.demo_loan(p_group uuid, p_member uuid, p_amount numeric, p_months integer,
                                             p_purpose text, p_month integer, p_day integer,
                                             p_voters uuid[], p_pays jsonb)
returns void language plpgsql as $$
declare
  v_g        public.groups;
  v_t        public.group_members;
  v_m        public.group_members;
  v_req      uuid;
  v_loan     uuid;
  v_ts       timestamptz;
  v_send     timestamptz;
  v_approved boolean := coalesce(array_length(p_voters, 1), 0) >= 2;
  v_paid     numeric := 0;
  v_total    numeric;
  v_pay      jsonb;
  v_pts      timestamptz;
  v_ref      text;
  v_r        public.requests;
  i          integer;
begin
  select * into v_g from public.groups where id = p_group;
  select * into v_t from public.group_members where group_id = p_group and role = 'treasurer';
  select * into v_m from public.group_members where id = p_member;
  v_ts := pg_temp.demo_ts(v_g.start_month, p_month, p_day, 9, 30);
  v_send := pg_temp.demo_ts(v_g.start_month, p_month, p_day + 2, 11, 0);
  v_total := p_amount + round(p_amount * v_g.loan_rate / 100 * p_months, 2);
  for v_pay in select * from jsonb_array_elements(coalesce(p_pays, '[]'::jsonb)) loop
    v_paid := v_paid + (v_pay ->> 2)::numeric;
  end loop;

  -- The request
  insert into public.requests (group_id, kind, status, requested_by, amount, description, loan_months, created_at, decided_at)
  values (p_group, 'loan', case when v_approved then 'approved' else 'pending' end, p_member, p_amount, p_purpose,
          p_months, v_ts, case when v_approved then v_ts + interval '6 hours' end)
  returning id into v_req;
  select * into v_r from public.requests where id = v_req;
  perform pg_temp.demo_log(p_group, p_member,
    format('Asked for approval: %s. Reason: "%s"', public.request_title(v_r), p_purpose), v_ts, p_member);

  -- The loan, in its final state
  insert into public.loans (group_id, member_id, request_id, amount, months, rate, purpose, status,
                            start_month, sent_from, sent_reference, sent_on, sent_by, received_at, created_at)
  values (p_group, p_member, v_req, p_amount, p_months, v_g.loan_rate, p_purpose,
          case when not v_approved then 'requested' when v_paid >= v_total then 'repaid' else 'active' end,
          case when v_approved then p_month end,
          case when v_approved then 'bank' end,
          case when v_approved then pg_temp.demo_ref('bank', v_send) end,
          case when v_approved then (v_send at time zone 'Africa/Lusaka')::date end,
          case when v_approved then v_t.user_id end,
          case when v_approved then v_send + interval '2 hours' end,
          v_ts)
  returning id into v_loan;

  -- Votes
  for i in 1 .. coalesce(array_length(p_voters, 1), 0) loop
    perform pg_temp.demo_vote(v_req, p_voters[i], 'yes', v_ts + make_interval(hours => 3 * i), null);
  end loop;
  if not v_approved then
    return;
  end if;
  perform pg_temp.demo_decision(v_req, v_ts + interval '6 hours');

  -- Sent and received
  select sent_reference into v_ref from public.loans where id = v_loan;
  perform pg_temp.demo_log(p_group, v_t.id,
    format('Sent the %s loan to %s from the group bank account. Reference: %s. To be repaid by the end of %s.',
           public.fmt_k(p_amount), v_m.full_name, v_ref, public.month_label(v_g.start_month, p_month + p_months)),
    v_send, p_member);
  perform pg_temp.demo_log(p_group, p_member,
    format('Confirmed receiving the %s loan.', public.fmt_k(p_amount)), v_send + interval '2 hours', p_member);

  -- Repayments, each confirmed by the borrower
  for v_pay in select * from jsonb_array_elements(coalesce(p_pays, '[]'::jsonb)) loop
    v_pts := pg_temp.demo_ts(v_g.start_month, (v_pay ->> 0)::int, (v_pay ->> 1)::int, 10, 20);
    v_ref := pg_temp.demo_ref(v_pay ->> 3, v_pts);
    insert into public.loan_repayments (group_id, loan_id, amount, paid_on, method, reference, status,
                                        recorded_by, created_at, answered_at)
    values (p_group, v_loan, (v_pay ->> 2)::numeric, (v_pts at time zone 'Africa/Lusaka')::date, v_pay ->> 3, v_ref,
            'confirmed', v_t.user_id, v_pts, v_pts + interval '3 hours');
    perform pg_temp.demo_log(p_group, v_t.id,
      format('Recorded a loan repayment of %s from %s. Paid by %s%s.', public.fmt_k((v_pay ->> 2)::numeric),
             v_m.full_name, public.method_label(v_pay ->> 3),
             case when v_ref is not null then ', reference ' || v_ref else '' end),
      v_pts, p_member);
    perform pg_temp.demo_log(p_group, p_member,
      format('Confirmed the %s loan repayment is correct.', public.fmt_k((v_pay ->> 2)::numeric)),
      v_pts + interval '3 hours', p_member);
  end loop;

  if v_paid >= v_total then
    perform pg_temp.demo_log(p_group, null,
      format('%s''s loan of %s is fully repaid.', v_m.full_name, public.fmt_k(p_amount)),
      v_pts + interval '3 hours', p_member);
  end if;
end;
$$;

-- Link a demo login (by email) to a member, if that account exists.
create or replace function pg_temp.demo_link(p_member uuid, p_email text)
returns void language sql as $$
  update public.group_members gm
  set user_id = p.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where gm.id = p_member and p_email is not null and lower(u.email) = lower(p_email);
$$;


-- =====================================================================
-- 1. Kalingalinga Women's Chilimba
-- =====================================================================
do $$
declare
  v_start  date := (date_trunc('month', public.today_zm()) - interval '3 months')::date;   -- so today is Month 4
  v_g      uuid;
  names    text[] := array['Mwila Banda', 'Chanda Phiri', 'Bwalya Mulenga', 'Mutale Zulu',
                           'Thandiwe Lungu', 'Natasha Tembo', 'Precious Chileshe', 'Memory Sakala'];
  roles    text[] := array['chair', 'treasurer', 'member', 'vice', 'member', 'comms', 'rep', 'member'];
  phones   text[] := array['097 214 5521', '096 880 1290', '077 301 4478', '095 642 0913',
                           '097 559 2306', '096 118 7724', '076 903 5512', '095 270 3369'];
  -- DEMO EMAILS (Chilimba): chairperson, treasurer, ordinary member
  emails   text[] := array['mwila@example.com', 'chanda@example.com', 'bwalya@example.com', null,
                           null, null, null, null];
  how      text[] := array['mtn', 'cash', 'airtel', 'airtel', 'airtel', 'bank', 'mtn', 'zamtel'];
  -- Order for receiving the pot. The treasurer (Chanda) is last.
  rot      integer[] := array[7, 8, 4, 1, 6, 2, 5, 3];
  ids      uuid[] := '{}';
  v_id     uuid;
  v_req    uuid;
  v_ts     timestamptz;
  v_ans    timestamptz;
  i        integer;
  m        integer;
  v_second integer;
begin
  insert into public.groups (name, type, monthly_amount, cycle_months, start_month, invite_code, created_at)
  values ('Kalingalinga Women''s Chilimba', 'chilimba', 500, 8, v_start, public.new_invite_code(),
          (v_start - 4) + interval '16 hours')
  returning id into v_g;

  for i in 1 .. 8 loop
    insert into public.group_members (group_id, full_name, phone, role, rotation_position, joined_at)
    values (v_g, names[i], phones[i], roles[i], rot[i], (v_start - 4) + interval '16 hours')
    returning id into v_id;
    ids := ids || v_id;
    perform pg_temp.demo_link(v_id, emails[i]);
  end loop;
  update public.groups set created_by = (select user_id from public.group_members where id = ids[1]) where id = v_g;

  v_ts := (v_start - 4) + interval '16 hours 5 minutes';
  perform pg_temp.demo_log(v_g, ids[1], 'Created the group as a Chilimba: 8 members, K500 each per month, 8-month cycle.', v_ts, null);
  perform pg_temp.demo_log(v_g, ids[1], 'Set up a committee of 5: Mwila Banda (Chairperson), Mutale Zulu (Vice Chairperson), Chanda Phiri (Treasurer), Natasha Tembo (Communications), Precious Chileshe (Member representative).', v_ts + interval '4 minutes', null);
  perform pg_temp.demo_log(v_g, ids[1], 'Set the order for receiving the pot. The treasurer, Chanda Phiri, receives last.', v_ts + interval '7 minutes', null);

  -- Months 1 to 3: everyone paid K500 and confirmed; the pot of K4,000 was paid out.
  for m in 1 .. 3 loop
    for i in 1 .. 8 loop
      v_ts := pg_temp.demo_ts(v_start, m, 1 + ((i - 1) % 4), 7 + (i - 1), ((i - 1) * 13 + m * 7) % 60);
      v_ans := v_ts + make_interval(hours => 1 + ((i - 1) % 3), mins => 17);
      perform pg_temp.demo_pay(v_g, ids[i], 'saving', 500, m, v_ts, how[i], 'confirmed', v_ans, null);
    end loop;

    v_ts := pg_temp.demo_ts(v_start, m, 6, 15, 30);
    v_req := pg_temp.demo_request(v_g, 'payout', 4000, null, ids[array_position(rot, m)], m,
                                  500, 3000, 500, 'approved', v_ts, v_ts + interval '95 minutes');
    perform pg_temp.demo_vote(v_req, ids[1], 'yes', v_ts + interval '40 minutes', null);
    v_second := case m when 1 then 6 when 2 then 4 else 7 end;   -- Natasha, Mutale, Precious
    perform pg_temp.demo_vote(v_req, ids[v_second], 'yes', v_ts + interval '95 minutes', null);
    perform pg_temp.demo_decision(v_req, v_ts + interval '95 minutes');
  end loop;

  -- Month 4 (this month)
  perform pg_temp.demo_pay(v_g, ids[1], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 1, 8, 5),  how[1], 'confirmed', pg_temp.demo_ts(v_start, 4, 1, 10, 5), null);
  perform pg_temp.demo_pay(v_g, ids[2], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 1, 8, 40), how[2], 'confirmed', pg_temp.demo_ts(v_start, 4, 1, 10, 40), null);
  perform pg_temp.demo_pay(v_g, ids[4], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 2, 12, 15), how[4], 'confirmed', pg_temp.demo_ts(v_start, 4, 2, 14, 15), null);
  perform pg_temp.demo_pay(v_g, ids[6], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 2, 14, 2),  how[6], 'confirmed', pg_temp.demo_ts(v_start, 4, 2, 16, 2), null);
  perform pg_temp.demo_pay(v_g, ids[5], 'saving', 300, 4, pg_temp.demo_ts(v_start, 4, 2, 18, 22), how[5], 'disputed', pg_temp.demo_ts(v_start, 4, 2, 21, 22),
                           'I sent K500 on Airtel Money, not K300. My Airtel message shows K500.');
  perform pg_temp.demo_pay(v_g, ids[3], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 3, 9, 12),  how[3], 'waiting', null, null);
  perform pg_temp.demo_pay(v_g, ids[7], 'saving', 500, 4, pg_temp.demo_ts(v_start, 4, 3, 10, 40), how[7], 'waiting', null, null);
  -- Memory Sakala (ids[8]) has not paid yet.

  -- A small spending request, waiting for one more yes.
  v_ts := pg_temp.demo_ts(v_start, 4, 2, 17, 30);
  v_req := pg_temp.demo_request(v_g, 'spending', 60, 'Buy a receipt book and airtime for payment reminders', null, null,
                                0, 0, 60, 'pending', v_ts, null);
  perform pg_temp.demo_vote(v_req, ids[4], 'yes', pg_temp.demo_ts(v_start, 4, 2, 19, 5), null);
end;
$$;


-- =====================================================================
-- 2. Matero Village Savings
-- =====================================================================
do $$
declare
  v_start  date := (date_trunc('month', public.today_zm()) - interval '5 months')::date;   -- so today is Month 6
  v_g      uuid;
  names    text[] := array['Kelvin Chanda', 'Agnes Mwale', 'Joseph Tembo', 'Esther Banda', 'Moses Phiri',
                           'Ruth Zulu', 'Peter Lungu', 'Mercy Mulenga', 'Davies Bwalya', 'Brenda Musonda'];
  roles    text[] := array['chair', 'treasurer', 'member', 'vice', 'member', 'comms', 'member', 'rep', 'member', 'member'];
  phones   text[] := array['097 410 2287', '096 225 8013', '077 618 3390', '095 334 7125', '097 902 4461',
                           '096 571 0038', '076 248 9914', '095 863 2207', '097 137 5582', '096 690 4475'];
  -- DEMO EMAILS (Village Banking): chairperson, treasurer, ordinary member
  emails   text[] := array['kelvin@example.com', 'agnes@example.com', 'joseph@example.com', null, null,
                           null, null, null, null, null];
  how      text[] := array['bank', 'cash', 'mtn', 'airtel', 'mtn', 'zamtel', 'cash', 'bank', 'airtel', 'mtn'];
  base     integer[] := array[400, 300, 250, 500, 200, 350, 150, 600, 300, 200];
  vary     integer[] := array[0, 50, -50, 100, 0, 50];
  ids      uuid[] := '{}';
  v_id     uuid;
  v_req    uuid;
  v_ts     timestamptz;
  i        integer;
  m        integer;
  v_status text;
begin
  insert into public.groups (name, type, monthly_amount, cycle_months, start_month,
                             loan_rate, loan_multiple, loan_max_months, invite_code, created_at)
  values ('Matero Village Savings', 'village', 100, 12, v_start, 10, 3, 3, public.new_invite_code(),
          (v_start - 3) + interval '14 hours')
  returning id into v_g;

  for i in 1 .. 10 loop
    insert into public.group_members (group_id, full_name, phone, role, joined_at)
    values (v_g, names[i], phones[i], roles[i], (v_start - 3) + interval '14 hours')
    returning id into v_id;
    ids := ids || v_id;
    perform pg_temp.demo_link(v_id, emails[i]);
  end loop;
  update public.groups set created_by = (select user_id from public.group_members where id = ids[1]) where id = v_g;

  v_ts := (v_start - 3) + interval '14 hours';
  perform pg_temp.demo_log(v_g, ids[1], 'Created the group as Village Banking: 10 members, at least K100 saved each month, 12-month cycle. Loans: 10% interest a month, up to 3 times savings, repaid within 3 months.', v_ts, null);
  perform pg_temp.demo_log(v_g, ids[1], 'Set up a committee of 5: Kelvin Chanda (Chairperson), Esther Banda (Vice Chairperson), Agnes Mwale (Treasurer), Ruth Zulu (Communications), Mercy Mulenga (Member representative).', v_ts + interval '6 minutes', null);

  -- Registration fees: K50 from each member, paid into the bank in Month 1.
  for i in 1 .. 10 loop
    v_ts := pg_temp.demo_ts(v_start, 1, 2, 10, i);
    perform pg_temp.demo_pay(v_g, ids[i], 'fee', 50, 1, v_ts, 'bank', 'confirmed', v_ts + interval '2 hours', null);
  end loop;

  for m in 1 .. 6 loop
    -- Monthly savings (different amounts for each member)
    for i in 1 .. 10 loop
      continue when m = 6 and i = 7;   -- Peter Lungu has not paid this month
      v_ts := pg_temp.demo_ts(v_start, m, case when m = 6 then 1 + ((i - 1) % 3) else 1 + ((i - 1) % 5) end,
                              7 + (i - 1), ((i - 1) * 11 + m * 5) % 60);
      -- This month, Joseph and Davies have not confirmed yet.
      v_status := case when m = 6 and i in (3, 9) then 'waiting' else 'confirmed' end;
      perform pg_temp.demo_pay(v_g, ids[i], 'saving', greatest(100, base[i] + vary[((i - 1 + m) % 6) + 1]), m, v_ts,
                               how[i], v_status, v_ts + make_interval(hours => 2 + ((i - 1) % 4)), null);
    end loop;

    -- Late fines
    if m = 3 then
      v_ts := pg_temp.demo_ts(v_start, 3, 6, 11, 0);
      perform pg_temp.demo_pay(v_g, ids[7], 'fine', 100, 3, v_ts, 'cash', 'confirmed', v_ts + interval '1 hour', null);
      perform pg_temp.demo_pay(v_g, ids[10], 'fine', 100, 3, v_ts + interval '5 minutes', 'cash', 'confirmed', v_ts + interval '1 hour', null);
    end if;
    if m = 5 then
      v_ts := pg_temp.demo_ts(v_start, 5, 6, 11, 30);
      perform pg_temp.demo_pay(v_g, ids[5], 'fine', 150, 5, v_ts, 'cash', 'confirmed', v_ts + interval '1 hour', null);
    end if;

    -- Spending: one approved (Month 2), one rejected (Month 4)
    if m = 2 then
      v_ts := pg_temp.demo_ts(v_start, 2, 15, 9, 0);
      v_req := pg_temp.demo_request(v_g, 'spending', 120, 'Print member savings cards', null, null,
                                    120, 0, 0, 'approved', v_ts, pg_temp.demo_ts(v_start, 2, 15, 13, 45));
      perform pg_temp.demo_vote(v_req, ids[1], 'yes', pg_temp.demo_ts(v_start, 2, 15, 12, 10), null);
      perform pg_temp.demo_vote(v_req, ids[8], 'yes', pg_temp.demo_ts(v_start, 2, 15, 13, 45), null);
      perform pg_temp.demo_decision(v_req, pg_temp.demo_ts(v_start, 2, 15, 13, 45));
    end if;
    if m = 4 then
      v_ts := pg_temp.demo_ts(v_start, 4, 18, 16, 0);
      v_req := pg_temp.demo_request(v_g, 'spending', 1000, 'Lend money to a friend who is not a member', null, null,
                                    1000, 0, 0, 'rejected', v_ts, pg_temp.demo_ts(v_start, 4, 18, 19, 0));
      perform pg_temp.demo_vote(v_req, ids[4], 'no', pg_temp.demo_ts(v_start, 4, 18, 18, 20), 'We only lend to members.');
      perform pg_temp.demo_vote(v_req, ids[1], 'no', pg_temp.demo_ts(v_start, 4, 18, 19, 0), 'Our rules do not allow lending to non-members.');
      perform pg_temp.demo_decision(v_req, pg_temp.demo_ts(v_start, 4, 18, 19, 0));
    end if;

    -- Loans (sent from the bank)
    if m = 2 then   -- Esther: fully repaid
      perform pg_temp.demo_loan(v_g, ids[4], 2000, 2, 'Buy stock for my salon', 2, 10, array[ids[1], ids[6]],
                                '[[3, 5, 1200, "airtel"], [4, 5, 1200, "airtel"]]');
    end if;
    if m = 3 then   -- Peter: overdue (due by the end of Month 4)
      perform pg_temp.demo_loan(v_g, ids[7], 800, 1, 'Pay school fees for my son', 3, 12, array[ids[1], ids[8]],
                                '[[4, 6, 400, "cash"]]');
    end if;
    if m = 4 then   -- Moses: being repaid
      perform pg_temp.demo_loan(v_g, ids[5], 1000, 2, 'Buy seed and fertiliser', 4, 9, array[ids[4], ids[8]],
                                '[[5, 5, 600, "mtn"]]');
    end if;
    if m = 5 then   -- Joseph: being repaid
      perform pg_temp.demo_loan(v_g, ids[3], 1500, 3, 'Buy a second-hand sewing machine', 5, 10, array[ids[1], ids[6]],
                                '[[6, 2, 650, "mtn"]]');
    end if;

    -- End of Months 1 to 5: the treasurer banks all mobile money and cash.
    if m <= 5 then
      perform pg_temp.demo_deposit_all(v_g, pg_temp.demo_ts(v_start, m, 27, 10, 15));
    end if;
  end loop;

  -- Month 6: Davies asks for a loan; one committee member has said yes so far.
  perform pg_temp.demo_loan(v_g, ids[9], 1200, 2, 'Restock my shop', 6, 2, array[ids[6]], null);

  -- And a small spending request waiting for approval.
  perform pg_temp.demo_request(v_g, 'spending', 45, 'Monthly bank account charge', null, null,
                               45, 0, 0, 'pending', pg_temp.demo_ts(v_start, 6, 2, 16, 20), null);
end;
$$;


-- Switch the automatic history back on.
alter table public.payments        enable trigger payments_history;
alter table public.requests        enable trigger requests_history;
alter table public.votes           enable trigger votes_history;
alter table public.loan_repayments enable trigger repayments_history;
alter table public.bank_deposits   enable trigger deposits_history;
alter table public.loans           enable trigger loans_history;

commit;


-- Which demo logins were linked? (Shown below the editor after Run.)
select g.name as "group", m.full_name as "person", m.role as "role",
       case when m.user_id is null then 'not linked: sign up this email, then run this file again'
            else 'linked: ' || u.email end as "demo login"
from public.group_members m
join public.groups g on g.id = m.group_id
left join auth.users u on u.id = m.user_id
where g.name in ('Kalingalinga Women''s Chilimba', 'Matero Village Savings')
  and m.full_name in ('Mwila Banda', 'Chanda Phiri', 'Bwalya Mulenga', 'Kelvin Chanda', 'Agnes Mwale', 'Joseph Tembo')
order by g.name, m.role;
