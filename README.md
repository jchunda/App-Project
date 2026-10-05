# Usambazi

A free web app that helps savings groups in Zambia (chilimbas and village banking groups) keep transparent, accurate records of their money.

**The problem:** many groups depend on one person, usually the treasurer, to track everyone's money in a notebook or on WhatsApp. Members can't see where their money is, the maths is done by hand, and records can be changed without anyone noticing.

**The idea:** no single person controls the records.

1. The treasurer records each payment, with its mobile money reference. The same reference can never be used twice.
2. The member who paid confirms it, or marks it as wrong.
3. Records can never be edited or deleted. Mistakes are fixed with a visible correction.
4. Money only leaves the group after committee approval: 2 yes votes, including the chairperson or vice chairperson.
5. Every action is written to a permanent history log.

## What it does

- **Both group types:** Chilimba (fixed amount, the pot goes to one member each month, and the treasurer always receives last) and Village Banking (different savings, loans, share-out at the end of the cycle).
- **"Where is the money?":** the group's money split into the bank account, the treasurer's mobile money, cash and loans. A warning appears when the treasurer holds too much.
- **Approvals:** payouts, spending, loans and group type changes, decided by committee votes counted in the database.
- **Village banking:** loans with a live calculator (flat interest, repayments pay the interest first), and a share-out worked out step by step in plain words.
- **Privacy:** in village banking, ordinary members see only their own money, plus the group totals so they can check the numbers add up.
- **No AI and no paid services.** All calculations are plain maths.

## How it is built

- Plain HTML, CSS and JavaScript, with no build step. Open `index.html` straight from your computer, or host it for free on GitHub Pages or Netlify.
- [Supabase](https://supabase.com) (free plan) for the database and email/password login.
- All the rules are enforced inside the database (Row Level Security, database functions and triggers), so they can't be skipped by changing the app.

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `js/` | The app |
| `config.js` | Supabase project URL and public (publishable) key |
| `check.html` | Connection check page, for troubleshooting |
| `sql/01_tables.sql` | Tables |
| `sql/02_security.sql` | Row Level Security rules |
| `sql/03_functions.sql` | Database functions and triggers |
| `sql/04_demo_data.sql` | Demo groups for presentations |
| `reference/prototype.html` | The original clickable prototype |

## Set up

1. Create a free Supabase project.
2. In the SQL Editor, run `sql/01_tables.sql`, `02_security.sql` and `03_functions.sql`, in that order.
3. In Authentication, keep Email login on. For testing, turn off "Confirm email".
4. Put your Project URL and publishable key in `config.js`. Never use the secret / service_role key.
5. Open `index.html`.

### Demo data

1. In the app, sign up the demo accounts listed at the top of `sql/04_demo_data.sql`. There is a chairperson, a treasurer and an ordinary member for each group.
2. Run that file in the SQL Editor.
3. Log in as any of them to see the app from that person's point of view.

## Next steps (not in this version)

- Automatic payment checking through mobile money APIs (needs business approval from the providers)
- Real SMS or WhatsApp reminders (these cost money)
- USSD access for basic phones
- Late payment penalties on loans
- Printable monthly statements
- Local languages (Bemba, Nyanja, Tonga, Lozi and others)
