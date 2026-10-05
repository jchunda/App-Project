-- =====================================================================
-- Usambazi: 02_security.sql
-- Row Level Security (RLS): rules inside the database that decide who
-- can see or change each row. With RLS on and no rule for a table,
-- NOBODY can read or change it through the app. That is the safe
-- starting point.
--
-- This is why the anon (public) key in config.js is safe to share:
-- the key only lets people ask, and these rules decide the answer.
--
-- How to run: SQL Editor -> paste this whole file -> Run.
-- Run it after 01_tables.sql. Safe to run again.
--
-- Each phase adds the rules for the tables it uses. Tables without
-- rules yet (payments, requests, votes, loans, ...) stay fully locked.
--
-- Append-only rule: payments, loan_repayments, bank_deposits,
-- money_references and history will NEVER get update or delete rules.
-- Members will confirm or dispute payments through a database function
-- (Phase 2) that only changes the status, never the amount.
-- =====================================================================


-- Switch RLS on for every table.
alter table public.profiles          enable row level security;
alter table public.groups            enable row level security;
alter table public.group_members     enable row level security;
alter table public.requests          enable row level security;
alter table public.votes             enable row level security;
alter table public.payments          enable row level security;
alter table public.loans             enable row level security;
alter table public.loan_repayments   enable row level security;
alter table public.bank_deposits     enable row level security;
alter table public.money_references  enable row level security;
alter table public.history           enable row level security;


-- ---------------------------------------------------------------------
-- profiles
-- auth.uid() means "the id of the person who is logged in".
-- ---------------------------------------------------------------------

-- You can read your own profile.
drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- You can change your own name and phone (but not someone else's).
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert rule: the profile row is created by the sign-up trigger.
-- No delete rule: profiles are removed only if the login is deleted.


-- =====================================================================
-- Phase 1: groups, members and history
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions used by the rules below.
-- "security definer" lets them look at group_members without being
-- blocked by group_members' own rules (otherwise the rule would have to
-- check itself, forever).
-- ---------------------------------------------------------------------

-- Is the logged-in person a member of this group?
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

-- Is the logged-in person on this group's committee (any role except Member)?
create or replace function public.is_committee(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role <> 'member'
  );
$$;

-- Does the logged-in person have this role in this group? e.g. 'treasurer'
create or replace function public.has_role(gid uuid, wanted text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = wanted
  );
$$;

-- May the logged-in person see something about this member's money?
-- (Privacy rules, CLAUDE.md section 7.)
--   Yes if it is group-wide (no subject), or the group is a chilimba,
--   or they are on the committee, or it is about themselves.
create or replace function public.can_see_subject(gid uuid, subject uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select subject is null
      or exists (select 1 from public.groups where id = gid and type = 'chilimba')
      or public.is_committee(gid)
      or exists (select 1 from public.group_members where id = subject and user_id = auth.uid());
$$;


-- ---------------------------------------------------------------------
-- groups: you can see the groups you belong to.
-- Groups are created only through the create_group function
-- (03_functions.sql), which checks all the rules. So there is no
-- insert, update or delete rule here.
-- ---------------------------------------------------------------------
drop policy if exists "Members see their groups" on public.groups;
create policy "Members see their groups" on public.groups
  for select to authenticated
  using (public.is_group_member(id));


-- ---------------------------------------------------------------------
-- group_members: you can see everyone in your own groups.
-- Members are added by create_group and linked by join_group.
-- ---------------------------------------------------------------------
drop policy if exists "Members see fellow members" on public.group_members;
create policy "Members see fellow members" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));


-- ---------------------------------------------------------------------
-- history: you can see your group's history, except that ordinary
-- village banking members only see entries about the whole group or
-- about themselves. Nobody can add, edit or delete entries directly:
-- only database functions write history.
-- ---------------------------------------------------------------------
drop policy if exists "Members see group history" on public.history;
create policy "Members see group history" on public.history
  for select to authenticated
  using (public.is_group_member(group_id)
         and public.can_see_subject(group_id, subject_member));


-- =====================================================================
-- Phase 2: payments and bank deposits
-- =====================================================================

-- ---------------------------------------------------------------------
-- payments: in a chilimba, every member sees every payment. In village
-- banking, ordinary members see only their own; the committee sees all.
-- (can_see_subject, above, makes that choice.)
--
-- There are NO insert, update or delete rules. Payments are added only
-- through record_payment and correct_payment, and a member answers only
-- through answer_payment (03_functions.sql). Those functions check who
-- you are and what you are allowed to do, so the records can't be
-- changed any other way.
-- ---------------------------------------------------------------------
drop policy if exists "Members see allowed payments" on public.payments;
create policy "Members see allowed payments" on public.payments
  for select to authenticated
  using (public.is_group_member(group_id)
         and public.can_see_subject(group_id, member_id));


-- ---------------------------------------------------------------------
-- bank_deposits: money moved into the group bank account is group-wide
-- information, so every member sees it. Added only via record_deposit.
-- ---------------------------------------------------------------------
drop policy if exists "Members see bank deposits" on public.bank_deposits;
create policy "Members see bank deposits" on public.bank_deposits
  for select to authenticated
  using (public.is_group_member(group_id));


-- =====================================================================
-- Phase 3: requests and votes
-- =====================================================================

-- ---------------------------------------------------------------------
-- requests: every member sees the group's requests (payouts, spending,
-- type changes), so all decisions are visible. The one exception: in
-- village banking, an ordinary member sees only their OWN loan
-- requests (CLAUDE.md section 7).
-- Requests are added only by the request_... functions, and decided
-- only by vote_request, so there are no insert/update/delete rules.
-- ---------------------------------------------------------------------
drop policy if exists "Members see allowed requests" on public.requests;
create policy "Members see allowed requests" on public.requests
  for select to authenticated
  using (public.is_group_member(group_id)
         and public.can_see_subject(group_id, case when kind = 'loan' then requested_by end));


-- ---------------------------------------------------------------------
-- votes: you can see the votes on any request you are allowed to see.
-- (The rule on requests above is applied inside this check too.)
-- Votes are added only through vote_request.
-- ---------------------------------------------------------------------
drop policy if exists "Members see votes on visible requests" on public.votes;
create policy "Members see votes on visible requests" on public.votes
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));


-- =====================================================================
-- Phase 5: loans and repayments
-- =====================================================================

-- ---------------------------------------------------------------------
-- loans: the committee sees every loan; an ordinary member sees only
-- their own (CLAUDE.md section 7). Everyone still sees the total lent
-- out, through group_summary. Loans change only through the loan
-- functions in 03_functions.sql.
-- ---------------------------------------------------------------------
drop policy if exists "Members see allowed loans" on public.loans;
create policy "Members see allowed loans" on public.loans
  for select to authenticated
  using (public.is_group_member(group_id)
         and public.can_see_subject(group_id, member_id));


-- ---------------------------------------------------------------------
-- loan_repayments: visible to whoever can see the loan.
-- (The rule on loans above is applied inside this check too.)
-- ---------------------------------------------------------------------
drop policy if exists "Members see repayments of visible loans" on public.loan_repayments;
create policy "Members see repayments of visible loans" on public.loan_repayments
  for select to authenticated
  using (exists (select 1 from public.loans l where l.id = loan_id));
