# Usambazi: project brief for Claude Code

You are helping me build **Usambazi**, a free web app for savings groups in Zambia. This is the final project of my bootcamp and I have very limited time. Read this whole file before writing any code, and follow it in every session.

A clickable prototype already exists at `reference/prototype.html`. It uses pretend data, but it shows the screens, wording, colours and behaviour I want. Match it as closely as possible, then connect it to a real database.

---

## 1. How to work with me

- I am a beginner. Explain everything in plain, clear English. Do not assume I know technical terms. When you must use one, explain it in a sentence.
- Before each phase, tell me in a few sentences what you are about to build and why. After each phase, tell me exactly how to test it.
- When I need to do something outside VS Code (for example in the Supabase website), give me numbered, click-by-click steps.
- I am on a **company computer and cannot install software** without IT. Do not ask me to install anything: no Node.js, no npm, no Python packages, no build tools, no command-line tools, no VS Code extensions. If something seems to need an installation, stop, tell me, and suggest a way that works without it.
- Keep the code simple and well commented. Prefer clear code over clever code.
- Work in the phases in section 12. Do not start a new phase until the current one works and I have tested it.

---

## 2. What the app is about

Usambazi helps savings groups such as **chilimbas** and **village banking groups** keep transparent, accurate records of their money.

**The problem.** Many groups depend on one person, usually the treasurer, to track everyone's money in a notebook or through WhatsApp messages. Members can't see where their money is. Payouts and share-outs are worked out by hand, so mistakes happen, and many members (especially in the informal sector) can't check the maths. Records can be changed without anyone noticing. Sometimes a treasurer uses the money or disappears with it, and members only find out on payout day.

**The core idea.** No single person controls the records:

1. The treasurer records each payment, with its mobile money transaction reference.
2. The member who paid confirms it, or marks it as wrong.
3. Records can never be edited or deleted. Mistakes are fixed with a visible correction.
4. Money can only leave the group after committee approval.
5. Every action is written to a permanent history log.

The app cannot physically stop someone from running away with cash. Its job is to make problems visible early, make the maths clear, and push groups toward safer habits (for example, keeping money in a group bank account).

**No AI.** The app must not use any AI or paid APIs. All calculations are plain maths written in code. It must stay free to host and run because it is mainly a pro-bono project.

---

## 3. Technology (no installation needed)

- **Front end:** plain HTML, CSS and JavaScript. No frameworks, no build step, no npm.
- Use **classic `<script src="...">` tags, not `type="module"`**, so the app works when I open `index.html` straight from my computer (file://) without a local server.
- **Database and login:** [Supabase](https://supabase.com), free plan. Everything is done in the Supabase website (Table Editor, SQL Editor, Authentication settings). Load the Supabase JavaScript library from a CDN:
  `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
- **Login:** email and password. Do not use magic links (they redirect to a web address and won't work from file://). Do not use phone/SMS login (SMS costs money). For testing, tell me how to turn off "Confirm email" in Supabase.
- **Hosting:** free static hosting, either **Netlify** (drag-and-drop the folder in the browser) or **GitHub Pages** (upload files on github.com). Give me click-by-click steps when we get there.
- **Fonts:** Google Fonts, "Bricolage Grotesque" for headings and "Atkinson Hyperlegible" for body text (it is designed to be easy to read), with system font fallbacks.
- **Keys:** put the Supabase project URL and the **anon (public) key** in `config.js`. The anon key is safe to be public only because Row Level Security is switched on for every table. **Never** put the `service_role` key in the app.
- Note: Supabase free projects pause after about a week without use. Tell me how to restore one if it happens.

Suggested files:

```
usambazi/
  CLAUDE.md
  index.html
  styles.css
  config.js        (Supabase URL and anon key)
  app.js           (or split into a few plain script files)
  sql/
    01_tables.sql
    02_security.sql
    03_functions.sql
    04_demo_data.sql
  reference/
    prototype.html
```

I will run the SQL files by pasting them into the Supabase SQL Editor.

---

## 4. Group types

When a group is created, the creator chooses **Chilimba** or **Village Banking**. After creation the type is **locked**. Changing it needs committee approval and only takes effect from the next cycle.

**Chilimba**
- Everyone pays the same fixed amount every month.
- Each month, one member receives the whole pot, in a fixed rotation order.
- The cycle length equals the number of members (one month per member).
- **The treasurer is always placed last in the rotation**, so the treasurer's own money stays in the group until everyone else has been paid.
- Maximum **20 members**.

**Village Banking**
- Members save different amounts each month, with a minimum monthly saving.
- Members can take loans (section 8).
- At the end of the cycle (for example 12 months) the money is shared out according to how much each member saved.
- Maximum **35 members**.

**Rules for both types**
- At least **5 members** in total.
- A committee of at least **4 people** (section 5), with exactly one Chairperson and exactly one Treasurer, at most one Vice Chairperson, and at least one ordinary Member.

---

## 5. Roles and permissions

| Role | Committee? | What they can do |
|---|---|---|
| Chairperson | Yes | See everything, vote on requests |
| Vice Chairperson | Yes | See everything, vote on requests |
| Treasurer | Yes | Record payments, corrections, loan transfers and repayments, bank deposits; ask for payouts and spending; see everything; vote (not on their own requests) |
| Communications | Yes | See everything, vote, send payment reminders |
| Member representative | Yes | An ordinary member elected to the committee to represent members. Sees everything, votes |
| Member | No | See their own records, confirm or dispute their own payments, ask for loans |

- Only committee members vote. Ordinary members can see every decision (except other members' loans in village banking).
- Payment reminders: in this version, a reminder is only recorded in the history log. Real SMS/WhatsApp reminders are a later feature because SMS costs money.
- Members join a group with an invite code that the chairperson shares. The chairperson assigns roles.

---

## 6. Accountability features (the most important part)

**Recording payments (treasurer only).** Each payment needs: member, amount, month of the cycle, date paid, payment method (Airtel Money, MTN MoMo, Zamtel Kwacha, Cash, Bank) and, for mobile money, the **transaction reference** from the SMS.
- The reference is required for mobile money, optional for bank (deposit slip number), and not used for cash (the app reminds the treasurer to write a receipt).
- **The same reference can never be used twice.** Enforce this in the database with a unique rule, not just in the app.
- In a chilimba, block recording more than the fixed amount for one member in one month and tell the treasurer to use a correction instead.

**Two-sided confirmation.** A new payment has status "Waiting for confirmation". The member who paid sees it and taps "Yes, I paid this" (status "Confirmed") or "This is wrong" with a written reason (status "Disputed"). Disputes stay visible to the committee until corrected.

**No editing or deleting.** Records are append-only. To fix a mistake, the treasurer adds a **correction**: a new entry linked to the original, with a reason. The original stays visible (shown crossed out as "Replaced by a correction") and the member must confirm the correction. Only the corrected version counts in totals. Enforce "no update/delete" with Row Level Security, except that a member may change the status of their own waiting payment to confirmed or disputed.

**Money leaving the group needs approval.** Payouts, spending, loans and type changes are requests with statuses Pending, Approved or Rejected.
- **Approved** when at least **2 committee members** say yes, and at least one of them is the Chairperson or Vice Chairperson.
- **Rejected** when the Chairperson says no, or more than half of the eligible committee members say no.
- The person who asked cannot vote on their own request.
- Each person can vote only once per request.
- Money is only counted as paid out once a request is approved.
- Do the vote counting in a **database function**, so the rules can't be skipped by changing the app code.

**"Where is the money?"** The overview shows the total that belongs to the group, split into: the group bank account, the treasurer's mobile money, cash kept by the treasurer, and (village banking) money lent out to members. Show a coloured bar and amounts with percentages.
- Show a gentle warning when the treasurer holds more than **50%** of the group's money **and** more than **K1,000**, encouraging a move to the group bank account.
- The treasurer can record moving money from mobile money or cash into the bank. This makes money safer, so it needs no approval, but it requires a deposit reference and is logged.

**History log.** Every action is recorded: who did it, what they did, and when, newest first. Nobody can edit or remove entries. Prefer database triggers to write history, so nothing can be skipped. Each entry can have a "subject" (the member whose money it concerns) for the privacy rules below.

---

## 7. Privacy rules

- **Chilimba:** everything is visible to all members (everyone pays the same amount, so there is nothing private to hide, and full visibility helps catch problems).
- **Village Banking:** ordinary members see **only their own** payments, savings, loans, repayments and share-out, each with a step-by-step explanation. The committee sees everyone's.
- Ordinary members can still see **group totals** (the "Where is the money?" card, total confirmed savings, total lent out, total money to share) so they can check the group's numbers add up.
- Ordinary members can see who has or hasn't paid this month (status only, not amounts).
- In the history log, ordinary village banking members see group-wide entries and entries about themselves only.
- Ordinary members see group spending requests, but not other members' loan requests.
- Enforce this with **Row Level Security**. Provide group totals through a secure database function, so members get totals without seeing individual rows.

---

## 8. Calculations

All amounts are in Zambian Kwacha (K). Round to the ngwee (2 decimal places). Always show calculations step by step in plain words.

**Chilimba pot**
- Pot = fixed amount × number of members. Example: K500 × 8 = K4,000.
- Show who receives it this month, who is next, and how much of this month's pot is confirmed.
- The treasurer asks for the payout to this month's receiver, choosing how much comes from bank, mobile money and cash (the app fills this in, the amounts must add up to the request, and no source can go below zero). It then needs approval.

**Village banking share-out**
- Money to share = confirmed savings + confirmed loan interest received + fees and fines − approved group spending.
- A member's share = (their confirmed savings ÷ total confirmed savings) × money to share.
- Only confirmed savings and confirmed repayments count. Show how much is still waiting.
- Before the end of the cycle, show it as "if the share-out happened today".
- Show a check that all shares add up to the money to share (mention any small rounding difference).
- Example wording: "You saved K2,400. The whole group saved K24,000. Your part is K2,400 ÷ K24,000, about 10%. The group has K30,000 to share. So you receive K2,400 ÷ K24,000 × K30,000 = K3,000."
- All loans must be fully repaid before the share-out.

**Loans (village banking only)**

Each group sets its loan rules when it is created (default values in brackets). Changing them later needs committee approval.
- Interest rate per month, flat (10%).
- Maximum loan = a multiple of the member's confirmed savings (3 times).
- Longest repayment time (3 months).
- One open loan per member at a time.
- A loan cannot be larger than the money the group currently holds.

Formulas:
- Interest = amount × rate × months. Example: K1,000 × 10% × 2 = K200.
- Total to repay = amount + interest = K1,200.
- Monthly payment = total ÷ months = K600.
- **Repayments pay off the interest first**, then the amount borrowed.
- Interest received = the smaller of (confirmed repayments, total interest). This goes into the share-out.
- Still lent out = amount − the part of repayments above the interest.
- Due by the end of month (start month + number of months). **Overdue** when the current month is later than that and money is still owed.

Loan flow:
1. Member asks for a loan: amount, months, purpose. A live calculator shows the steps above, the member's limit and their savings.
2. The committee votes, using the normal approval rules.
3. The treasurer records sending the money (from which place, and a reference).
4. The borrower confirms they received it.
5. The treasurer records each repayment (amount, method, reference). The borrower confirms or disputes it.
6. When everything is repaid, the loan is marked "Fully repaid".

**Current month of the cycle** is worked out from the group's start month and today's date.

---

## 9. Screens

Bottom navigation on phones, side menu on larger screens.

1. **Login / sign up**
2. **My groups:** each group with its type, member count, confirmed savings and a "things to check" badge. Button to create a group or join with an invite code.
3. **Create group:** name, type (two large choice cards), monthly amount, cycle length (village only), loan rules (village only), first month, and members with roles. Show "X of up to 20/35 members" and disable "Add member" at the limit.
4. **Overview:** "Where is the money?", "Needs attention" list (payments to confirm, votes needed, disputes, loans to send, overdue loans, members who haven't paid), this month's progress, the committee list, and the locked group type with "Ask to change the type".
5. **Payments:** "My payments" and (where allowed) "All payments" with a month filter. Confirm, dispute and correction buttons.
6. **Record a payment** (treasurer).
7. **Members:** role, phone, status this month, totals (where allowed), rotation month for chilimba, reminder buttons for Communications.
8. **Turns** (chilimba): who gets the pot this month, the full rotation with status, and an explanation of why the treasurer is last.
9. **Share-out** (village): money to share breakdown, "Your share-out today", and everyone's share-out for the committee.
10. **Loans** (village): group loan rules, total lent out, "My loans" for members, all loans for the committee, "Ask for a loan" with calculator.
11. **Approvals:** waiting and decided requests, with votes, the approval rule, and Approve/Reject buttons for eligible committee members.
12. **Move money to the bank** (treasurer).
13. **History:** the permanent log.

---

## 10. Design and wording

- Mobile first: must work well on cheap Android phones with limited data. Keep pages light.
- Plain, friendly English, short sentences, sentence case. Many users are not confident with numbers or technology.
- Large buttons (at least 44–48px tall). Clear labels on every form field. Error messages say exactly what to fix.
- Colours (light mode): background `#F1F5F1`, surface `#FFFFFF`, text `#13221B`, muted text `#53655B`, primary green `#0E5C43`, top bar `#0D4F3A`, copper accent `#A5561B`, copper background `#F5E6D8`. Provide a dark mode too. Copy the colour tokens from the prototype.
- Status colours, always with a text label and symbol, never colour alone: green for Confirmed/Approved/Fully repaid, orange for Waiting/Pending/Being repaid, red for Disputed/Rejected/Overdue, grey for Not paid / Replaced.
- The "Where is the money?" card is the visual centrepiece of the overview. Keep the rest calm.
- Accessible: visible keyboard focus, good contrast, works with screen readers.

---

## 11. Demo data (for my presentation)

Write `sql/04_demo_data.sql` (or a small seeding page) to create:

- **Kalingalinga Women's Chilimba:** 8 members, K500 a month, 4 months into an 8-month cycle. Months 1–3 fully paid and paid out. In month 4: some confirmed, some waiting, one disputed (recorded K300, member says she paid K500), one not paid. The treasurer is holding most of the money, so the warning shows. One small spending request waiting for approval.
- **Matero Village Savings:** 10 members saving different amounts, 6 months into a 12-month cycle, with registration fees and late fines, one approved and one rejected spending request, one fully repaid loan, two loans being repaid, one overdue loan and one loan request waiting for approval.
- Use common Zambian names (Mwila, Chanda, Bwalya, Mutale, Tembo, Phiri, Banda, Lungu, Mulenga, Zulu and so on) and realistic mobile money references.
- Use the same people and situations as in the prototype where possible.
- Explain how I can log in as different demo people (for example one treasurer, one chairperson, one ordinary member) for the presentation.

---

## 12. Build plan

I have very little time. At the end of each phase the app must work, so if time runs out I still have something complete to present. If we fall behind, stop after Phase 4 and treat the rest as "next steps" in my presentation.

**Phase 0: Setup.** Walk me through creating the Supabase project, running the SQL files, turning on Row Level Security, setting up email/password login, and filling in `config.js`. Check the connection works from `index.html`.

**Phase 1: Accounts and groups.** Sign up, log in, log out. Create a group with type, rules, members and roles (with all validation from section 4). Join with an invite code. My groups list.

**Phase 2: Payments and accountability.** Record payments with references, duplicate reference check, member confirm/dispute, corrections, history log, "Where is the money?", move money to the bank, overview "Needs attention".

**Phase 3: Approvals and chilimba.** Requests, voting with the approval rules in a database function, chilimba turns and payouts, group spending, type change requests.

**Phase 4: Village banking share-out and privacy.** Share-out calculations with explanations, privacy rules enforced with Row Level Security, secure group totals.

**Phase 5: Loans.** The full loan flow and calculator from section 8, loans in "Where is the money?" and the share-out.

**Phase 6: Finish.** Demo data, put the app online with Netlify or GitHub Pages, test on a real phone, fix any problems.

---

## 13. Not in this version (future ideas)

Mention these as next steps, but do not build them now:
- Automatic payment checking through mobile money APIs (needs business approval from providers).
- Real SMS or WhatsApp reminders (cost money).
- USSD access for basic phones.
- Late payment penalties on loans.
- Printable monthly statements.
- Local languages (Bemba, Nyanja, Tonga, Lozi and others).