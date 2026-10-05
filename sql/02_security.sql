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
-- Phase 0: only "profiles" gets rules. Every other table stays locked
-- until the phase that uses it adds its rules to this file.
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
