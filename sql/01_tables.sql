-- =====================================================================
-- Usambazi: 01_tables.sql
-- Creates all the tables (the "sheets" where the app keeps its data).
--
-- How to run: Supabase website -> SQL Editor -> New query -> paste this
-- whole file -> Run. Run it BEFORE 02_security.sql and 03_functions.sql.
--
-- It is safe to run again: "if not exists" skips tables that already exist.
-- Money is stored as numeric(12,2): exact Kwacha and ngwee, no rounding
-- surprises like you can get with normal decimal numbers.
-- =====================================================================


-- ---------------------------------------------------------------------
-- profiles: one row for every person who has a login.
-- Supabase keeps logins in its own "auth.users" table. This table adds
-- the person's name and phone. A row is created automatically when
-- someone signs up (see the trigger in 03_functions.sql).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- groups: one row for each savings group.
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 2 and 80),

  -- Chilimba or Village Banking. Locked after creation (changes go
  -- through an approved request and apply from the next cycle).
  type            text not null check (type in ('chilimba', 'village')),

  -- Chilimba: the fixed amount everyone pays each month.
  -- Village banking: the minimum monthly saving.
  monthly_amount  numeric(12,2) not null check (monthly_amount > 0),

  -- Number of months in the cycle. For a chilimba this equals the
  -- number of members.
  cycle_months    integer not null check (cycle_months between 1 and 36),

  -- The first month of the cycle, always stored as the 1st of the month.
  start_month     date not null check (extract(day from start_month) = 1),

  -- Loan rules (village banking only). Defaults come from CLAUDE.md.
  loan_rate       numeric(5,2) not null default 10 check (loan_rate >= 0 and loan_rate <= 100),  -- % per month, flat
  loan_multiple   numeric(5,2) not null default 3  check (loan_multiple > 0),                    -- max loan = savings x this
  loan_max_months integer      not null default 3  check (loan_max_months between 1 and 12),

  -- Short code the chairperson shares so members can join.
  invite_code     text not null unique default upper(substr(md5(random()::text), 1, 6)),

  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- group_members: who belongs to which group, and their role.
-- A member can be added by name before they have a login. When they
-- join with the invite code, user_id is filled in.
-- ---------------------------------------------------------------------
create table if not exists public.group_members (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  user_id           uuid references public.profiles (id),
  full_name         text not null check (length(trim(full_name)) >= 2),
  phone             text,
  role              text not null default 'member'
                    check (role in ('chair', 'vice', 'treasurer', 'comms', 'rep', 'member')),
  -- Chilimba only: which month of the rotation this member receives the pot.
  rotation_position integer check (rotation_position >= 1),
  joined_at         timestamptz not null default now(),

  unique (group_id, user_id),            -- a login can be in a group only once
  unique (group_id, rotation_position)   -- two people can't share a turn
);


-- ---------------------------------------------------------------------
-- requests: anything that needs committee approval
-- (payouts, spending, loans, type changes, loan rule changes).
-- ---------------------------------------------------------------------
create table if not exists public.requests (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups (id) on delete cascade,
  kind            text not null check (kind in ('payout', 'spending', 'loan', 'type_change', 'rule_change')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid not null references public.group_members (id),
  amount          numeric(12,2) check (amount > 0),
  description     text,

  -- Payouts and spending: who receives the money and where it comes from.
  -- The three parts must add up to the amount (checked in 03_functions).
  payout_to       uuid references public.group_members (id),
  cycle_month     integer check (cycle_month >= 1),
  from_bank       numeric(12,2) not null default 0 check (from_bank >= 0),
  from_momo       numeric(12,2) not null default 0 check (from_momo >= 0),
  from_cash       numeric(12,2) not null default 0 check (from_cash >= 0),

  -- Type change and rule change requests.
  new_type        text check (new_type in ('chilimba', 'village')),
  new_rules       jsonb,

  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);


-- ---------------------------------------------------------------------
-- votes: committee members' yes/no on a request. One vote per person.
-- ---------------------------------------------------------------------
create table if not exists public.votes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests (id) on delete cascade,
  member_id   uuid not null references public.group_members (id),
  vote        text not null check (vote in ('yes', 'no')),
  created_at  timestamptz not null default now(),
  unique (request_id, member_id)
);


-- ---------------------------------------------------------------------
-- payments: money members pay in (savings, and in village banking also
-- registration fees and late fines).
-- Append-only: never edited or deleted. Mistakes are fixed with a new
-- row whose corrects_id points at the old row.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups (id) on delete cascade,
  member_id          uuid not null references public.group_members (id),
  kind               text not null default 'saving' check (kind in ('saving', 'fee', 'fine')),
  amount             numeric(12,2) not null check (amount > 0),
  cycle_month        integer not null check (cycle_month >= 1),
  paid_on            date not null,
  method             text not null check (method in ('airtel', 'mtn', 'zamtel', 'cash', 'bank')),
  reference          text,
  status             text not null default 'waiting' check (status in ('waiting', 'confirmed', 'disputed')),
  dispute_reason     text,

  -- Corrections: the old payment this one replaces, and why.
  corrects_id        uuid unique references public.payments (id),
  correction_reason  text,

  recorded_by        uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  answered_at        timestamptz,   -- when the member confirmed or disputed

  -- Mobile money needs a reference. Cash never has one.
  check (method not in ('airtel', 'mtn', 'zamtel') or length(trim(coalesce(reference, ''))) > 0),
  check (method <> 'cash' or reference is null),
  -- A correction must say why.
  check (corrects_id is null or length(trim(coalesce(correction_reason, ''))) > 0),
  -- A dispute must say why.
  check (status <> 'disputed' or length(trim(coalesce(dispute_reason, ''))) > 0)
);


-- ---------------------------------------------------------------------
-- loans: village banking loans. Each loan starts as a request (kind
-- 'loan') that the committee votes on.
-- ---------------------------------------------------------------------
create table if not exists public.loans (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups (id) on delete cascade,
  member_id          uuid not null references public.group_members (id),
  request_id         uuid unique references public.requests (id),
  amount             numeric(12,2) not null check (amount > 0),
  months             integer not null check (months between 1 and 12),
  rate               numeric(5,2) not null check (rate >= 0),   -- copied from the group when asked
  purpose            text,
  status             text not null default 'requested'
                     check (status in ('requested', 'approved', 'rejected', 'active', 'repaid')),

  -- Filled in when the treasurer sends the money.
  start_month        integer check (start_month >= 1),
  sent_from          text check (sent_from in ('bank', 'momo', 'cash')),
  sent_reference     text,
  sent_on            date,
  sent_by            uuid references public.profiles (id),
  received_at        timestamptz,   -- when the borrower confirmed they got it

  created_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- loan_repayments: money paid back on a loan. Append-only, like payments.
-- ---------------------------------------------------------------------
create table if not exists public.loan_repayments (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups (id) on delete cascade,
  loan_id            uuid not null references public.loans (id),
  amount             numeric(12,2) not null check (amount > 0),
  paid_on            date not null,
  method             text not null check (method in ('airtel', 'mtn', 'zamtel', 'cash', 'bank')),
  reference          text,
  status             text not null default 'waiting' check (status in ('waiting', 'confirmed', 'disputed')),
  dispute_reason     text,
  corrects_id        uuid unique references public.loan_repayments (id),
  correction_reason  text,
  recorded_by        uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  answered_at        timestamptz,

  check (method not in ('airtel', 'mtn', 'zamtel') or length(trim(coalesce(reference, ''))) > 0),
  check (method <> 'cash' or reference is null),
  check (corrects_id is null or length(trim(coalesce(correction_reason, ''))) > 0),
  check (status <> 'disputed' or length(trim(coalesce(dispute_reason, ''))) > 0)
);


-- ---------------------------------------------------------------------
-- bank_deposits: the treasurer moving money from mobile money or cash
-- into the group bank account. No approval needed, but a reference is.
-- ---------------------------------------------------------------------
create table if not exists public.bank_deposits (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  from_place    text not null check (from_place in ('momo', 'cash')),
  amount        numeric(12,2) not null check (amount > 0),
  reference     text not null check (length(trim(reference)) > 0),
  deposited_on  date not null,
  recorded_by   uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- money_references: every transaction reference ever used, in one place.
-- Its primary key means the same reference can never be saved twice,
-- whether it was used for a payment, a repayment, a loan transfer or a
-- bank deposit. Filled automatically by triggers (03_functions.sql).
-- References are stored in capitals with spaces removed, so
-- "mp26 1003" and "MP261003" count as the same.
-- ---------------------------------------------------------------------
create table if not exists public.money_references (
  reference   text primary key,
  group_id    uuid references public.groups (id) on delete cascade,
  used_in     text not null,      -- which table, e.g. 'payments'
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- history: the permanent log of everything that happens.
-- Nobody can edit or delete entries.
-- subject_member = the member whose money the entry is about (used for
-- the village banking privacy rules). Empty means a group-wide entry.
-- ---------------------------------------------------------------------
create table if not exists public.history (
  id              bigint generated always as identity primary key,
  group_id        uuid not null references public.groups (id) on delete cascade,
  actor_user      uuid references public.profiles (id),
  actor_name      text not null default 'Usambazi',
  action          text not null,
  subject_member  uuid references public.group_members (id),
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- Indexes: these make common lookups faster (like an index in a book).
-- ---------------------------------------------------------------------
create index if not exists group_members_user_idx  on public.group_members (user_id);
create index if not exists payments_group_idx      on public.payments (group_id, cycle_month);
create index if not exists payments_member_idx     on public.payments (member_id);
create index if not exists requests_group_idx      on public.requests (group_id, status);
create index if not exists loans_group_idx         on public.loans (group_id);
create index if not exists repayments_loan_idx     on public.loan_repayments (loan_id);
create index if not exists deposits_group_idx      on public.bank_deposits (group_id);
create index if not exists history_group_idx       on public.history (group_id, created_at desc);
