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
