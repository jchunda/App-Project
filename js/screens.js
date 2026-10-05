/* =====================================================================
   Usambazi: js/screens.js
   Each function here builds the HTML for one screen, using the data in
   S (the app's memory, see js/app.js). They only draw. What happens
   when you press a button is in js/app.js.

   Buttons carry data-action="..." so app.js knows what to do.
   ===================================================================== */
'use strict';


/* ---------- Top bar ---------- */
function topbar() {
  const right = S.user
    ? '<span class="who">' + esc(S.profile && S.profile.full_name ? S.profile.full_name : S.user.email) + '</span>' +
      '<button type="button" class="btn-bar" data-action="logout">Log out</button>'
    : '';
  return '<header class="topbar"><div class="topbar-inner">' +
    '<button type="button" class="brand" data-action="home">Usambazi</button>' +
    '<div class="top-right">' + right + '</div>' +
    '</div></header>';
}


/* ---------- 1. Log in / sign up ---------- */
function loginScreen() {
  const signUp = S.authTab === 'signup';
  return `
  <h1 class="page-title">Welcome to Usambazi</h1>
  <p class="lede">Clear, shared records for your chilimba or village banking group. Every payment is recorded,
    confirmed by the person who paid, and checked by a committee. Nobody can secretly change the records.</p>

  <div class="switch" role="group" aria-label="Log in or create an account">
    <button type="button" data-action="auth-tab" data-tab="login" aria-pressed="${!signUp}">Log in</button>
    <button type="button" data-action="auth-tab" data-tab="signup" aria-pressed="${signUp}">Create an account</button>
  </div>

  <div id="auth-errors"></div>
  <form class="formcard" id="auth-form" novalidate>
    ${signUp ? `
    <div class="field">
      <label for="au-name">Your full name</label>
      <input type="text" id="au-name" autocomplete="name" placeholder="For example: Mwila Banda">
    </div>
    <div class="field">
      <label for="au-phone">Phone number</label>
      <input type="tel" id="au-phone" autocomplete="tel" placeholder="097 000 0000">
      <p class="hint">Your group can see this, so they can reach you.</p>
    </div>` : ''}
    <div class="field">
      <label for="au-email">Email</label>
      <input type="email" id="au-email" autocomplete="email">
    </div>
    <div class="field">
      <label for="au-password">Password</label>
      <input type="password" id="au-password" autocomplete="${signUp ? 'new-password' : 'current-password'}">
      ${signUp ? '<p class="hint">At least 6 characters. Choose one that others can\'t guess.</p>' : ''}
    </div>
    <div class="form-actions">
      <button type="submit" class="btn block" id="auth-submit">${signUp ? 'Create my account' : 'Log in'}</button>
    </div>
  </form>`;
}


/* ---------- 2. My groups ---------- */
function homeScreen() {
  const rows = S.groups.map((g) => `
    <button type="button" class="grow" data-action="open-group" data-id="${g.id}">
      <span>
        <span class="grow-name">${esc(g.name)}</span>
        <span class="grow-meta">${TYPE[g.type]}, ${plural(Number(g.member_count), 'member', 'members')}. ${esc(cycleText(g))}.</span>
        <span class="meta">You are ${g.my_role === 'member' ? 'a member' : 'the ' + ROLE[g.my_role].toLowerCase()}</span>
      </span>
      <span class="grow-amt num"><small>Confirmed savings</small>${fmtK(g.confirmed_savings)}</span>
    </button>`).join('');

  return `
  <h1 class="page-title">My groups</h1>
  <p class="lede">Every payment is recorded, confirmed by the person who paid, and checked by a committee.
    Nobody can secretly change the records.</p>
  <div class="list">${rows || '<p class="empty">You are not in any group yet. Create one, or join with the invite code from your chairperson.</p>'}</div>
  <div class="form-actions">
    <button type="button" class="btn" data-action="new-group">Create a group</button>
    <button type="button" class="btn ghost" data-action="join">Join with an invite code</button>
  </div>`;
}


/* ---------- 3. Create a group ---------- */
function createScreen() {
  const d = S.draft;
  const chilimba = d.type === 'chilimba';
  const max = MAX_MEMBERS[d.type];
  const atMax = d.members.length >= max;

  // The first month: this month or one of the next two.
  const now = new Date();
  const startOptions = [0, 1, 2].map((k) => {
    const first = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const value = toDayText(first);
    return `<option value="${value}"${d.start === value ? ' selected' : ''}>${MONTHS[first.getMonth()]} ${first.getFullYear()}</option>`;
  }).join('');

  const memberRows = d.members.map((m, i) => `
    <div class="mrow">
      <div>
        <label for="cm-name-${i}">Member ${i + 1} name${m.is_me ? ' (you)' : ''}</label>
        <input type="text" id="cm-name-${i}" value="${esc(m.full_name)}" autocomplete="off">
      </div>
      <div>
        <label for="cm-phone-${i}">Phone</label>
        <input type="tel" id="cm-phone-${i}" value="${esc(m.phone)}" placeholder="097 000 0000">
      </div>
      <div>
        <label for="cm-role-${i}">Role</label>
        <select id="cm-role-${i}">${ROLE_ORDER.map((r) =>
          `<option value="${r}"${m.role === r ? ' selected' : ''}>${ROLE[r]}</option>`).join('')}</select>
      </div>
      <div>${d.members.length > MIN_MEMBERS && !m.is_me
        ? `<button type="button" class="btn small ghost x" data-action="cg-remove" data-i="${i}" aria-label="Remove member ${i + 1}">Remove</button>`
        : ''}</div>
    </div>`).join('');

  const villageFields = chilimba
    ? '<p class="hint">In a chilimba, the cycle is one month per member, so it is set for you.</p>'
    : `
    <div class="field">
      <label for="cg-cycle">Cycle length (months)</label>
      <input type="number" id="cg-cycle" inputmode="numeric" min="1" max="24" value="${esc(d.cycle)}">
      <p class="hint">The share-out happens at the end of the cycle.</p>
    </div>
    <div class="field">
      <label for="cg-rate">Loan interest (% per month)</label>
      <input type="number" id="cg-rate" inputmode="decimal" min="0" max="50" value="${esc(d.rate)}">
      <p class="hint">Charged on the amount borrowed, for each month of the loan.</p>
    </div>
    <div class="field">
      <label for="cg-mult">Members can borrow up to this many times their savings</label>
      <input type="number" id="cg-mult" inputmode="numeric" min="1" max="10" value="${esc(d.mult)}">
    </div>
    <div class="field">
      <label for="cg-maxm">Longest time to repay a loan (months)</label>
      <input type="number" id="cg-maxm" inputmode="numeric" min="1" max="12" value="${esc(d.maxm)}">
    </div>`;

  return `
  <button type="button" class="back" data-action="home">${icon('back')}All groups</button>
  <h1 class="page-title">Create a group</h1>
  <p class="lede">Choose the type carefully. After the group is created, the type is locked and changing it needs committee approval.</p>
  <div id="cg-errors"></div>

  <div class="formcard">
    <div class="field">
      <label for="cg-name">Group name</label>
      <input type="text" id="cg-name" value="${esc(d.name)}" placeholder="For example: Chawama Market Chilimba">
    </div>

    <div class="field">
      <span class="label" id="cg-type-label">Type of group</span>
      <div class="typecards" role="radiogroup" aria-labelledby="cg-type-label">
        <label class="typecard"><input type="radio" name="cg-type" value="chilimba"${chilimba ? ' checked' : ''}>
          <span class="tc"><strong>Chilimba</strong><span>Everyone pays the same amount every month. Each month, one member receives the whole pot, in turn. Up to 20 members.</span></span></label>
        <label class="typecard"><input type="radio" name="cg-type" value="village"${!chilimba ? ' checked' : ''}>
          <span class="tc"><strong>Village Banking</strong><span>Members save different amounts and can take loans. At the end of the cycle, money is shared out by how much each person saved. Up to 35 members.</span></span></label>
      </div>
    </div>

    <div class="field">
      <label for="cg-amount">${chilimba ? 'Amount each member pays every month (K)' : 'Minimum saving each month (K)'}</label>
      <input type="number" id="cg-amount" inputmode="decimal" min="0" step="0.01" value="${esc(d.amount)}">
    </div>
    ${villageFields}

    <div class="field">
      <label for="cg-start">First month</label>
      <select id="cg-start">${startOptions}</select>
    </div>

    <div class="field">
      <span class="label">Members and roles (${d.members.length} of up to ${max})</span>
      <p class="hint" style="margin:0 0 4px">You need at least ${MIN_MEMBERS} members. The committee must have at least
        ${MIN_COMMITTEE} people, including one chairperson and one treasurer. Suggested committee: chairperson,
        vice chairperson, treasurer, communications, and a member representative.${chilimba
        ? ' Members receive the pot in this order, but Usambazi always puts the treasurer last.' : ''}</p>
      ${memberRows}
      <button type="button" class="btn small ghost" data-action="cg-add" style="margin-top:8px"${atMax ? ' disabled' : ''}>Add another member</button>
      ${atMax ? `<p class="hint">A ${TYPE[d.type].toLowerCase()} can have up to ${max} members.</p>` : ''}
    </div>

    <div class="form-actions">
      <button type="button" class="btn" data-action="save-group">Create group</button>
      <button type="button" class="btn ghost" data-action="home">Cancel</button>
    </div>
  </div>`;
}


/* ---------- 4. Join with an invite code ---------- */
function joinScreen() {
  const j = S.join;
  const p = j.preview;   // filled in after the code is found

  let step2 = '';
  if (p) {
    const choices = p.members.map((m) => `
      <label class="typecard"><input type="radio" name="jn-member" value="${m.id}">
        <span class="tc"><strong>${esc(m.full_name)}</strong><span>${ROLE[m.role]}</span></span></label>`).join('');

    step2 = `
    <div class="formcard">
      <h2 style="font-size:21px;margin-top:12px">${esc(p.name)}</h2>
      <p class="meta" style="margin-top:4px">${TYPE[p.type]}</p>
      ${p.members.length ? `
      <div class="field">
        <span class="label" id="jn-member-label">Which one is you?</span>
        <p class="hint" style="margin:0 0 8px">Your chairperson added these names. Choose your own name.</p>
        <div class="typecards" role="radiogroup" aria-labelledby="jn-member-label">${choices}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="join-save">Join this group</button>
      </div>`
      : `<p class="note info">Everyone on this group's list has already joined. If your name is missing,
          ask your chairperson to add you.</p>`}
    </div>`;
  }

  return `
  <button type="button" class="back" data-action="home">${icon('back')}All groups</button>
  <h1 class="page-title">Join a group</h1>
  <p class="lede">Your chairperson has a 6-character invite code for your group. Type it here.</p>
  <div id="jn-errors"></div>

  <form class="formcard" id="join-form" novalidate>
    <div class="field">
      <label for="jn-code">Invite code</label>
      <input type="text" id="jn-code" value="${esc(j.code)}" autocomplete="off" autocapitalize="characters"
             spellcheck="false" placeholder="For example: K7Q2MX" style="text-transform:uppercase;letter-spacing:.08em">
    </div>
    <div class="form-actions">
      <button type="submit" class="btn${p ? ' ghost' : ''}" id="join-find">Find the group</button>
    </div>
  </form>
  ${step2}`;
}


/* =====================================================================
   Inside a group
   ===================================================================== */

/* ---------- Facts about the open group, used by every group screen ---------- */
function groupFacts() {
  const G = S.group;
  const g = G.info;
  const me = G.members.find((m) => m.user_id === S.user.id);

  // A payment counts unless a correction replaced it.
  const replaced = new Set(G.payments.filter((p) => p.corrects_id).map((p) => p.corrects_id));
  const active = G.payments.filter((p) => !replaced.has(p.id));

  return {
    G, g, me, replaced, active,
    isT: me.role === 'treasurer',
    committee: me.role !== 'member',
    // Village banking: ordinary members only see their own money.
    priv: g.type === 'village' && me.role === 'member',
    month: G.summary.month,
    treasurer: G.members.find((m) => m.role === 'treasurer')
  };
}

// May I vote on this request? Committee only, not on my own request, only once.
function canVote(f, r) {
  return r.status === 'pending' && f.committee && r.requested_by !== f.me.id &&
    !f.G.votes.some((v) => v.request_id === r.id && v.member_id === f.me.id);
}

// A request in plain words (the database writes the same words in the history).
function requestTitle(r) {
  if (r.kind === 'payout') return `Pay ${fmtK(r.amount)} to ${memberName(r.payout_to)} (Month ${r.cycle_month} receiver)`;
  if (r.kind === 'spending') return `Spend ${fmtK(r.amount)}: ${r.description}`;
  if (r.kind === 'type_change') return `Change the group type to ${TYPE[r.new_type]}`;
  if (r.kind === 'loan') return `Loan of ${fmtK(r.amount)} to ${memberName(r.requested_by)}`;
  return 'Request';
}

// The maths for one loan (CLAUDE.md section 8; the database uses the same formulas).
function loanCalc(f, loan) {
  const reps = f.G.repayments.filter((r) => r.loan_id === loan.id);
  const replaced = new Set(reps.filter((r) => r.corrects_id).map((r) => r.corrects_id));
  const counted = reps.filter((r) => !replaced.has(r.id));
  const amount = Number(loan.amount);
  const interest = round2(amount * (Number(loan.rate) / 100) * loan.months);   // flat interest
  const total = round2(amount + interest);
  const monthly = round2(total / loan.months);
  const paid = round2(counted.reduce((t, r) => t + Number(r.amount), 0));
  const paidConfirmed = round2(counted.filter((r) => r.status === 'confirmed').reduce((t, r) => t + Number(r.amount), 0));
  const remaining = round2(Math.max(0, total - paid));
  // Repayments pay off the interest first, then the amount borrowed.
  const outstanding = loan.sent_on ? round2(Math.max(0, amount - Math.max(0, paid - interest))) : 0;
  const dueMonth = loan.start_month ? loan.start_month + loan.months : null;
  const overdue = loan.status === 'active' && remaining > 0 && cycleMonth(f.g) > dueMonth;
  return { interest, total, monthly, paid, paidConfirmed, remaining, outstanding, dueMonth, overdue, reps };
}

// The loan calculator steps, in plain words.
function loanSteps(g, amount, months, you) {
  const rate = Number(g.loan_rate);
  const perMonth = round2(amount * rate / 100);
  const interest = round2(perMonth * months);
  const total = round2(amount + interest);
  const monthly = round2(total / months);
  const w = you ? 'You' : 'They';
  return `<ol class="steps">
    <li>${w} borrow <strong>${fmtK(amount)}</strong>.</li>
    <li>Interest is ${rate}% of ${fmtK(amount)} for each month: <strong>${fmtK(perMonth)} a month</strong>.</li>
    <li>For ${plural(months, 'month', 'months')}, that is ${fmtK(perMonth)} × ${months} = <strong>${fmtK(interest)} interest</strong>.</li>
    <li>${w} pay back ${fmtK(amount)} + ${fmtK(interest)} = <strong>${fmtK(total)}</strong>.</li>
    <li>That is <strong>${fmtK(monthly)} a month</strong> for ${plural(months, 'month', 'months')}.</li></ol>`;
}

// Where the money is taken from, in words.
function placeName(f, place) {
  const t = f.treasurer ? f.treasurer.full_name : 'the treasurer';
  return { bank: 'Group bank account', momo: t + "'s mobile money", cash: 'Cash kept by ' + t }[place];
}

const memberById = (id) => S.group.members.find((m) => m.id === id);
const memberName = (id) => (memberById(id) || {}).full_name || 'Someone';
const firstName = (id) => memberName(id).split(' ')[0];

// Who recorded something? recorded_by is a login, so find that person's name in this group.
function recorderName(userId) {
  const m = S.group.members.find((x) => x.user_id === userId);
  return m ? m.full_name : 'the treasurer';
}

// Savings confirmed for one member (only from the payments you are allowed to see).
const savedBy = (f, memberId) =>
  round2(f.active.filter((p) => p.member_id === memberId && p.kind === 'saving' && p.status === 'confirmed')
                 .reduce((t, p) => t + Number(p.amount), 0));


/* ---------- Loan things that need me ---------- */
// As the borrower: confirm receiving the money, or confirm a repayment.
// As the treasurer: send an approved loan.
function borrowerMustConfirm(f, l) {
  if (l.member_id !== f.me.id) return false;
  const waitingRepayment = loanCalc(f, l).reps.some((r) =>
    r.status === 'waiting' && !f.G.repayments.some((x) => x.corrects_id === r.id));
  return (l.sent_on && !l.received_at) || waitingRepayment;
}
function myLoanTodo(f) {
  return (f.G.loans || []).filter((l) => borrowerMustConfirm(f, l) || (f.isT && l.status === 'approved')).length;
}


/* ---------- Group menu and heading ---------- */
function groupNav(f) {
  const myWaiting = f.active.filter((p) => p.member_id === f.me.id && p.status === 'waiting').length;
  const myVotes = f.G.requests.filter((r) => canVote(f, r)).length;
  const items = f.g.type === 'chilimba'
    ? [['overview', 'Overview', 'home', 0],
       ['payments', 'Payments', 'receipt', myWaiting],
       ['members',  'Members',  'people', 0],
       ['turns',    'Turns',    'cycle', 0],
       ['approvals', 'Approvals', 'shield', myVotes],
       ['history',  'History',  'clock', 0]]
    : [['overview', 'Overview', 'home', 0],
       ['payments', 'Payments', 'receipt', myWaiting],
       ['loans',    'Loans',    'hand', myLoanTodo(f)],
       ['shareout', 'Share-out', 'pie', 0],
       ['approvals', 'Approvals', 'shield', myVotes],
       ['members',  'Members',  'people', 0, true],   // true = only in the side menu on larger screens
       ['history',  'History',  'clock', 0]];
  const parent = { record: 'payments', move: 'overview', request: 'approvals', loanreq: 'loans' };
  const on = parent[S.screen] || S.screen;
  const phoneCount = items.filter((i) => !i[4]).length;
  return `<nav class="nav" aria-label="Group menu" style="grid-template-columns:repeat(${phoneCount},1fr)">${items.map(([screen, label, ic, badge, desk]) =>
    `<button type="button"${desk ? ' class="desk"' : ''} data-action="go" data-screen="${screen}"${on === screen ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${
      badge ? `<span class="badge" aria-label="${badge} waiting for you">${badge}</span>` : ''}</button>`).join('')}</nav>`;
}

function groupHead(f) {
  return `
  <button type="button" class="back" data-action="home">${icon('back')}All groups</button>
  <div class="group-head">
    <h1>${esc(f.g.name)}</h1>
    <p class="group-sub">
      <span class="type-badge">${icon('lock')}${TYPE[f.g.type]}</span>
      <span>${plural(f.G.members.length, 'member', 'members')}</span>
      <span>${esc(cycleText(f.g))}</span>
    </p>
  </div>`;
}

const backTo = (screen, label) =>
  `<button type="button" class="back" data-action="go" data-screen="${screen}">${icon('back')}${label}</button>`;


/* ---------- "Where is the money?" ---------- */
function moneyCard(f) {
  const s = f.G.summary;
  const tName = f.treasurer ? f.treasurer.full_name : 'the treasurer';
  const bank = Number(s.bank), momo = Number(s.momo), cash = Number(s.cash), lent = Number(s.lent);
  const total = round2(bank + momo + cash + lent);
  const treasurerHolds = round2(momo + cash);
  const share = total > 0 ? treasurerHolds / total : 0;

  const parts = [
    ['sw-bank', bank, 'Group bank account'],
    ['sw-momo', momo, tName + "'s mobile money"],
    ['sw-cash', cash, 'Cash kept by ' + tName]
  ];
  if (f.g.type === 'village') parts.push(['sw-lent', lent, 'Lent out to members (being repaid)']);

  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const bar = parts.map(([cls, v]) => (v > 0 ? `<span class="${cls}" style="width:${(v / total) * 100}%"></span>` : '')).join('');
  const legend = parts.map(([cls, v, label]) =>
    `<li><span class="sw ${cls}"></span><span>${esc(label)}</span><span class="amt">${fmtK(v)}<span class="pct">${pct(v)}%</span></span></li>`).join('');

  // Gentle warning: the treasurer holds more than half the money AND more than K1,000.
  let warn = '';
  if (share > 0.5 && treasurerHolds > 1000) {
    warn = `<div class="warn">
      <p><strong>${esc(tName)} is holding ${fmtK(treasurerHolds)}, which is ${Math.round(share * 100)}% of the group's money.</strong></p>
      <p>It is safer to keep most of it in the group bank account, where taking money out needs more than one signature.</p>
      ${f.isT ? '<button type="button" class="btn small" data-action="go" data-screen="move">Move money to the bank</button>' : ''}
    </div>`;
  } else if (f.isT && treasurerHolds > 0) {
    warn = '<div style="margin-top:12px"><button type="button" class="btn small ghost" data-action="go" data-screen="move">Move money to the bank</button></div>';
  }

  return `
  <section class="money" aria-labelledby="money-h">
    <h2 id="money-h">Where is the money?</h2>
    <p class="money-total">${fmtK(total)}</p>
    <p class="money-sub">${total > 0 ? 'belongs to the group right now' : 'No money is held yet.'}</p>
    ${total > 0 ? `<div class="mbar" aria-hidden="true">${bar}</div><ul class="legend">${legend}</ul>` : ''}
    ${warn}
  </section>`;
}


/* ---------- Overview ---------- */
function overviewScreen() {
  const f = groupFacts();
  const { G, g, me, active, priv, month } = f;
  const statuses = G.summary.statuses;

  // "Needs attention"
  const myWaiting = active.filter((p) => p.member_id === me.id && p.status === 'waiting').length;
  const disputed = active.filter((p) => p.status === 'disputed').length;
  const othersWaiting = active.filter((p) => p.status === 'waiting' && p.member_id !== me.id).length;
  const notPaid = G.members.filter((m) => statuses[m.id] === 'notpaid');

  const pending = G.requests.filter((r) => r.status === 'pending');
  const myVotes = pending.filter((r) => canVote(f, r)).length;

  const items = [];
  if (myWaiting) items.push(['bad', `You have ${plural(myWaiting, 'payment', 'payments')} to confirm`, 'Check it against your mobile money message.', 'payments', 'mine']);
  if (myVotes) items.push(['bad', `${plural(myVotes, 'request needs', 'requests need')} your vote`, 'Money cannot leave the group until the committee approves it.', 'approvals']);
  if (pending.length && !myVotes) items.push(['wait', `${plural(pending.length, 'request is', 'requests are')} waiting for committee approval`, '', 'approvals']);
  if (g.type === 'village') {
    const loans = G.loans || [];
    const mineTodo = loans.filter((l) => borrowerMustConfirm(f, l)).length;
    const toSend = f.isT ? loans.filter((l) => l.status === 'approved').length : 0;
    const overdue = loans.filter((l) => loanCalc(f, l).overdue && (f.committee || l.member_id === me.id));
    if (mineTodo) items.push(['bad', 'Your loan needs you to confirm something', 'Check the money you received or repaid.', 'loans']);
    if (toSend) items.push(['bad', `${plural(toSend, 'approved loan is', 'approved loans are')} waiting for you to send`, '', 'loans']);
    if (overdue.length) items.push(['bad', `${plural(overdue.length, 'loan is', 'loans are')} overdue`,
      f.committee ? overdue.map((l) => memberName(l.member_id)).join(', ') : 'Please repay as soon as you can.', 'loans']);
  }
  if (!priv) {
    if (disputed) items.push(['bad', `${plural(disputed, 'payment is', 'payments are')} disputed`,
      f.isT ? 'Check with the member and fix it with a correction.' : 'Everyone can see these until the treasurer adds a correction.', 'payments', 'all']);
    if (othersWaiting) items.push(['wait', `${plural(othersWaiting, 'payment is', 'payments are')} waiting for members to confirm`, '', 'payments', 'all']);
  }
  if (cycleMonth(g) >= 1 && notPaid.length) {
    items.push(['wait', `${plural(notPaid.length, 'member has', 'members have')} not paid for Month ${month} yet`,
      notPaid.map((m) => m.full_name).join(', '), 'members']);
  }
  const attention = items.length
    ? items.map(([dot, title, sub, screen, tab]) =>
        `<button type="button" class="att" data-action="go" data-screen="${screen}"${tab ? ` data-tab="${tab}"` : ''}>
          <span class="dot ${dot}"></span><span><strong>${esc(title)}</strong>${sub ? `<span class="meta">${esc(sub)}</span>` : ''}</span></button>`).join('')
    : '<div class="att" style="cursor:default"><span class="dot ok"></span><span><strong>Nothing needs attention right now</strong></span></div>';

  // "This month"
  const confirmed = Number(G.summary.month_confirmed);
  let monthCard;
  if (g.type === 'chilimba') {
    const pot = Number(g.monthly_amount) * G.members.length;
    const receiver = G.members.find((m) => m.rotation_position === month);
    monthCard = `
      <div class="month-head"><span class="big">${fmtK(confirmed)} <span class="muted" style="font-size:17px;font-weight:600">of ${fmtK(pot)} confirmed</span></span></div>
      <div class="progress" role="img" aria-label="${Math.round((confirmed / pot) * 100)}% of the pot confirmed"><span style="width:${Math.min(100, (confirmed / pot) * 100)}%"></span></div>
      <p class="meta" style="margin-top:8px">The pot is ${fmtK(g.monthly_amount)} × ${G.members.length} members = ${fmtK(pot)}.
        This month it goes to <strong style="color:var(--ink)">${esc(receiver ? receiver.full_name : 'nobody yet')}</strong>.</p>`;
  } else {
    const paid = G.members.filter((m) => statuses[m.id] !== 'notpaid').length;
    monthCard = `
      <div class="month-head"><span class="big">${fmtK(confirmed)} <span class="muted" style="font-size:17px;font-weight:600">saved and confirmed this month</span></span></div>
      <p class="meta" style="margin-top:6px">${paid} of ${G.members.length} members have paid. The minimum saving is ${fmtK(g.monthly_amount)}.</p>`;
  }

  const rows = G.members.map((m) => {
    const showAmount = !priv || m.id === me.id;
    const recorded = round2(active.filter((p) => p.member_id === m.id && p.kind === 'saving' && p.cycle_month === month)
                                  .reduce((t, p) => t + Number(p.amount), 0));
    return `<div class="row"><span>${esc(m.full_name)}${m.id === me.id ? ' <span class="muted">(you)</span>' : ''}${showAmount
      ? `<span class="meta" style="display:block">${recorded ? fmtK(recorded) + ' recorded' : 'Nothing recorded'}</span>` : ''}</span>${pill(statuses[m.id] || 'notpaid')}</div>`;
  }).join('');

  const payouts = G.requests.filter((r) => r.kind === 'payout' && r.status === 'approved');
  const totals = g.type === 'chilimba'
    ? `${fmtK(G.summary.paid_out)} paid out so far to ${plural(payouts.length, 'member', 'members')}.`
    : `${fmtK(G.summary.confirmed_savings)} confirmed savings and ${fmtK(G.summary.interest_received)} loan interest received so far this cycle.`;

  // Group type: locked. Anyone can ask to change it; the committee decides.
  const typePending = pending.some((r) => r.kind === 'type_change');
  let typeAction;
  if (typePending) typeAction = '<p class="meta" style="margin-top:6px"><strong>A request to change the type is waiting for approval.</strong></p>';
  else typeAction = '<button type="button" class="linkbtn" data-action="ask-type">Ask to change the type</button>';
  const nextType = g.next_type && g.next_type !== g.type
    ? `<p class="meta" style="margin-top:6px"><strong>Approved: from the next cycle, this group will be ${TYPE[g.next_type]}.</strong></p>` : '';

  const committeeRows = G.members.filter((m) => m.role !== 'member')
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((m) => `<div class="row"><span><strong>${esc(m.full_name)}</strong>${m.id === me.id ? ' <span class="muted">(you)</span>' : ''}</span><span class="meta">${ROLE[m.role]}</span></div>`).join('');

  const notStarted = cycleMonth(g) < 1
    ? `<p class="infobox">The cycle starts in ${esc(monthLabel(g, 1))}. Payments for Month 1 can already be recorded.</p>` : '';

  return groupHead(f) + notStarted + moneyCard(f) + `
  <section class="section"><h2>Needs attention</h2><div class="list">${attention}</div></section>

  <section class="section"><h2>This month: ${esc(mLabel(g, month))}</h2><p class="sub">${esc(totals)}</p>
    <div class="formcard" style="padding:16px">${monthCard}</div>
    <div class="list">${rows}</div>
    ${priv ? privacyNote("You can see who has paid, but only the committee can see other members' amounts.") : ''}
  </section>

  <section class="section"><h2>Committee</h2>
    <p class="sub">The committee checks the records and approves any money leaving the group.</p>
    <div class="list">${committeeRows}</div>
  </section>

  <section class="section"><h2>Group type</h2>
    <div class="typelock">${icon('lock')}<div><strong>${TYPE[g.type]}, locked</strong>
      <p class="meta">Changing the type changes how everyone's money is worked out, so it needs committee approval.</p>
      ${nextType}${typeAction}</div></div>
  </section>`;
}


/* ---------- One payment, as shown in the Payments list ---------- */
function paymentEntry(f, p) {
  const replacedBy = f.G.payments.find((x) => x.corrects_id === p.id);
  const original = p.corrects_id ? f.G.payments.find((x) => x.id === p.corrects_id) : null;
  const status = replacedBy ? 'corrected' : p.status;
  const who = p.member_id === f.me.id;

  let notes = '';
  if (p.status === 'disputed' && p.dispute_reason) {
    notes += `<p class="note bad"><strong>${esc(firstName(p.member_id))} says:</strong> "${esc(p.dispute_reason)}"</p>`;
  }
  if (p.corrects_id) {
    notes += `<p class="note info">This corrects the ${original ? fmtK(original.amount) + ' ' : ''}entry from ${
      original ? fmtDate(new Date(original.created_at)) : 'earlier'}. Reason: "${esc(p.correction_reason)}"</p>`;
  }
  if (replacedBy) {
    notes += `<p class="note plain">Replaced by a correction on ${fmtDate(new Date(replacedBy.created_at))}. It stays here so everyone can see what changed.</p>`;
  }
  if (p.note) notes += `<p class="note plain">Note: ${esc(p.note)}</p>`;

  let actions = '';
  if (!replacedBy && who && p.status === 'waiting') {
    actions += `<button type="button" class="btn small" data-action="pay-confirm" data-id="${p.id}">Yes, I paid this</button>
                <button type="button" class="btn small danger-ghost" data-action="pay-dispute" data-id="${p.id}">This is wrong</button>`;
  }
  if (!replacedBy && f.isT) {
    actions += `<button type="button" class="btn small ghost" data-action="pay-correct" data-id="${p.id}">Fix with a correction</button>`;
  }

  const kind = p.kind === 'saving' ? '' : ' · ' + KINDS[p.kind];
  return `
  <article class="entry${replacedBy ? ' superseded' : ''}">
    <div class="entry-top">
      <div><strong>${esc(memberName(p.member_id))}</strong>${who ? ' <span class="muted">(you)</span>' : ''}
        <div class="meta">${esc(mLabel(f.g, p.cycle_month))}${kind}</div></div>
      <div class="amt">${fmtK(p.amount)}</div>
    </div>
    <p class="meta">${esc(method(p.method).label)}${p.reference ? ', ref ' + esc(p.reference) : ''}. Paid on ${fmtDate(parseDay(p.paid_on))}.
      Recorded by ${esc(recorderName(p.recorded_by))} on ${fmtDateTime(new Date(p.created_at))}.</p>
    <div class="entry-status">${pill(status)}</div>
    ${notes}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </article>`;
}


/* ---------- Payments ---------- */
function paymentsScreen() {
  const f = groupFacts();
  const { G, g, me, priv } = f;
  if (priv) S.payTab = 'mine';

  const sorted = G.payments.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  let list, top = '';

  if (S.payTab === 'mine') {
    list = sorted.filter((p) => p.member_id === me.id);
    const waiting = list.filter((p) => p.status === 'waiting' && !f.replaced.has(p.id)).length;
    if (waiting) {
      top = '<div class="infobox">Before you confirm, check each payment against the message from your mobile money provider or your cash receipt.</div>';
    }
  } else {
    list = S.payMonth === 'all' ? sorted : sorted.filter((p) => p.cycle_month === Number(S.payMonth));
    const options = ['<option value="all">All months</option>'].concat(
      Array.from({ length: g.cycle_months }, (_, i) =>
        `<option value="${i + 1}"${String(i + 1) === String(S.payMonth) ? ' selected' : ''}>${esc(mLabel(g, i + 1))}</option>`));
    top = `<div class="filter"><label for="pay-month">Show</label><select id="pay-month">${options.join('')}</select></div>`;
    if (!f.isT) top += '<p class="hint">Only the treasurer can record payments. You can confirm or dispute your own.</p>';
  }

  const tabs = priv
    ? privacyNote("In village banking, you see only your own payments. The committee sees everyone's, and the group totals are on the Overview.")
    : `<div class="tabs" role="tablist">
        <button type="button" role="tab" data-action="pay-tab" data-tab="mine" aria-selected="${S.payTab === 'mine'}">My payments</button>
        <button type="button" role="tab" data-action="pay-tab" data-tab="all" aria-selected="${S.payTab === 'all'}">All payments</button>
      </div>`;

  return groupHead(f) + `
  <div class="screen-head"><h2>Payments</h2>${f.isT ? '<button type="button" class="btn" data-action="go" data-screen="record">Record a payment</button>' : ''}</div>
  ${tabs}${top}
  <div class="list">${list.length ? list.map((p) => paymentEntry(f, p)).join('') : '<p class="empty">No payments to show.</p>'}</div>`;
}


/* ---------- Parts of payment forms ---------- */
function methodChips(name, selected) {
  return `<div class="chips" role="radiogroup">${METHODS.map((m) =>
    `<label class="chip"><input type="radio" name="${name}" value="${m.id}"${selected === m.id ? ' checked' : ''}><span>${m.label}</span></label>`).join('')}</div>`;
}

// The reference box changes with the payment method (see updateRefField in app.js).
function refField(prefix, methodId, value) {
  const m = methodId ? method(methodId) : null;
  const isCash = m && m.id === 'cash';
  return `
  <div class="field" id="${prefix}-refwrap"${isCash ? ' hidden' : ''}>
    <label for="${prefix}-ref" id="${prefix}-reflabel">${m && !m.needsRef ? 'Deposit slip number (optional)' : 'Transaction reference'}</label>
    <input type="text" id="${prefix}-ref" autocomplete="off" value="${esc(value || '')}">
    <p class="hint" id="${prefix}-refhint">${m ? esc(m.hint) : 'Needed for mobile money. It lets anyone trace the payment.'}</p>
  </div>
  <p class="hint" id="${prefix}-cashhint"${isCash ? '' : ' hidden'}>For cash, write the member a receipt as well.</p>`;
}


/* ---------- Record a payment (treasurer) ---------- */
function recordScreen() {
  const f = groupFacts();
  const { G, g, month } = f;
  if (!f.isT) return groupHead(f) + '<p class="infobox">Only the treasurer can record payments.</p>';

  const kindChips = g.type === 'village' ? `
    <div class="field"><span class="label">What is it for?</span>
      <div class="chips" role="radiogroup">${Object.keys(KINDS).map((k) =>
        `<label class="chip"><input type="radio" name="f-kind" value="${k}"${k === 'saving' ? ' checked' : ''}><span>${KINDS[k]}</span></label>`).join('')}</div>
      <p class="hint">Fees (for example registration) and fines go into the money shared out at the end, not into the member's savings.</p>
    </div>` : '';

  const members = G.members.slice().sort((a, b) => a.full_name.localeCompare(b.full_name));

  return backTo('payments', 'Payments') + `
  <h1 class="page-title">Record a payment</h1>
  <p class="lede">The member will be asked to confirm it. Once saved, a payment cannot be edited or deleted.
    Mistakes are fixed with a correction that the committee can see.</p>
  <div id="rec-errors"></div>
  <div class="formcard">
    <div class="field"><label for="f-member">Who paid?</label>
      <select id="f-member"><option value="">Choose a member</option>${members.map((m) =>
        `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select></div>
    ${kindChips}
    <div class="field"><label for="f-amount">Amount (K)</label>
      <input type="number" id="f-amount" inputmode="decimal" min="0" step="0.01" value="${g.type === 'chilimba' ? Number(g.monthly_amount) : ''}">
      ${g.type === 'chilimba'
        ? `<p class="hint">Everyone in this chilimba pays ${fmtK(g.monthly_amount)} a month.</p>`
        : `<p class="hint">The minimum saving is ${fmtK(g.monthly_amount)}. Loan repayments will be recorded on the Loans screen.</p>`}</div>
    <div class="field"><label for="f-month">For which month?</label>
      <select id="f-month">${Array.from({ length: g.cycle_months }, (_, i) =>
        `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${esc(mLabel(g, i + 1))}</option>`).join('')}</select></div>
    <div class="field"><label for="f-date">Date paid</label>
      <input type="date" id="f-date" value="${toDayText(new Date())}" max="${toDayText(new Date())}"></div>
    <div class="field"><span class="label">How did they pay?</span>${methodChips('f-method', '')}</div>
    ${refField('f', '')}
    <div class="field"><label for="f-note">Note (optional)</label>
      <input type="text" id="f-note" placeholder="For example: paid at the meeting"></div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="save-payment">Save payment</button>
      <button type="button" class="btn ghost" data-action="go" data-screen="payments">Cancel</button>
    </div>
  </div>`;
}


/* ---------- Move money to the bank (treasurer) ---------- */
function moveScreen() {
  const f = groupFacts();
  if (!f.isT) return groupHead(f) + '<p class="infobox">Only the treasurer can record money moved to the bank.</p>';
  const s = f.G.summary;

  return backTo('overview', 'Overview') + `
  <h1 class="page-title">Move money to the bank</h1>
  <p class="lede">Putting money into the group bank account makes it safer, so it does not need approval. It is still recorded in the history.</p>
  <div id="mv-errors"></div>
  <div class="formcard">
    <div class="field"><span class="label">Move from</span>
      <div class="chips" role="radiogroup">
        <label class="chip"><input type="radio" name="mv-from" value="momo" checked><span>Mobile money (${fmtK(s.momo)})</span></label>
        <label class="chip"><input type="radio" name="mv-from" value="cash"><span>Cash (${fmtK(s.cash)})</span></label>
      </div></div>
    <div class="field"><label for="mv-amount">Amount (K)</label>
      <input type="number" id="mv-amount" inputmode="decimal" min="0" step="0.01" value="${Number(s.momo) > 0 ? Number(s.momo) : ''}"></div>
    <div class="field"><label for="mv-ref">Deposit slip or transaction number</label>
      <input type="text" id="mv-ref" autocomplete="off">
      <p class="hint">This lets the committee check the deposit with the bank.</p></div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="save-deposit">Record the deposit</button>
      <button type="button" class="btn ghost" data-action="go" data-screen="overview">Cancel</button>
    </div>
  </div>`;
}


/* ---------- Members ---------- */
function membersScreen() {
  const f = groupFacts();
  const { G, g, me, priv, month } = f;
  const statuses = G.summary.statuses;

  // Chilimba: in the order they receive the pot. Village banking: committee first, then by name.
  const sorted = G.members.slice().sort((a, b) =>
    g.type === 'chilimba'
      ? a.rotation_position - b.rotation_position
      : ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name));

  const rows = sorted.map((m) => {
    const showAmount = !priv || m.id === me.id;
    const turn = g.type === 'chilimba'
      ? `, receives the pot in Month ${m.rotation_position} (${monthLabel(g, m.rotation_position)})` : '';
    return `
    <div class="row">
      <div><strong>${esc(m.full_name)}</strong>${m.id === me.id ? ' <span class="muted">(you)</span>' : ''}${
        m.role !== 'member' ? `<span class="role-tag">${ROLE[m.role]}</span>` : ''}
        <div class="meta">${esc((m.phone || 'No phone given') + turn)}</div>
        <div class="meta">${m.user_id ? '✓ Has joined' : '– Not joined yet'}</div>
      </div>
      <div class="right">${showAmount
        ? `<span class="num" style="font-weight:700">${fmtK(savedBy(f, m.id))}</span><span class="meta">${g.type === 'village' ? 'saved' : 'paid'} this cycle</span>` : ''}
        ${pill(statuses[m.id] || 'notpaid', statuses[m.id] === 'notpaid' ? 'Not paid this month' : null)}</div>
    </div>`;
  }).join('');

  const joined = G.members.filter((m) => m.user_id).length;

  const invite = f.committee ? `
  <div class="invite-card">
    <h2 style="font-size:19px">Invite code</h2>
    <p class="invite-code" aria-label="Invite code ${esc(g.invite_code.split('').join(' '))}">${esc(g.invite_code)}</p>
    <p style="margin-top:6px">Share this code with your members. Each person creates an account, presses
      "Join with an invite code", types the code and chooses their name. ${joined} of ${G.members.length} have joined.</p>
    <div class="form-actions" style="margin-top:12px">
      <button type="button" class="btn small" data-action="copy-code">Copy the code</button>
    </div>
  </div>` : '';

  return groupHead(f) + invite + `
  <div class="screen-head"><h2>Members</h2></div>
  <p class="sub muted" style="margin-top:4px">Up to ${MAX_MEMBERS[g.type]} members in a ${TYPE[g.type].toLowerCase()}. Status shows ${esc(mLabel(g, month))}.${
    g.type === 'chilimba' ? ' The treasurer receives the pot last, so their own money stays in the group until everyone else has been paid.' : ''}</p>
  <div class="list">${rows}</div>
  ${priv ? privacyNote("You can see your own savings. Other members' savings are only visible to the committee.") : ''}`;
}


/* ---------- History ---------- */
function historyScreen() {
  const f = groupFacts();
  const rows = f.G.history.map((h) => {
    const m = f.G.members.find((x) => x.user_id && x.user_id === h.actor_user);
    return `
    <div class="hentry">
      <span class="when">${fmtDateTime(new Date(h.created_at))}</span>
      <span class="who-line">${esc(h.actor_name)}${m && m.role !== 'member' ? `<span class="role-tag">${ROLE[m.role]}</span>` : ''}</span>
      <span>${esc(h.action)}</span>
    </div>`;
  }).join('');

  return groupHead(f) + `
  <div class="screen-head"><h2>History</h2></div>
  <p class="muted" style="margin-top:4px">Every action in this group, newest first. Nobody can edit or remove anything here,
    not even the treasurer or chairperson.</p>
  ${f.priv ? privacyNote("You see group-wide actions and everything about your own money. Entries about other members' money are visible to the committee only.") : ''}
  <div class="list">${rows || '<p class="empty">Nothing yet.</p>'}</div>`;
}


/* ---------- Pop-up boxes for payments ---------- */
function disputeBody(p) {
  return `<p class="meta">${fmtK(p.amount)} for ${esc(mLabel(S.group.info, p.cycle_month))}, recorded by ${esc(recorderName(p.recorded_by))}.</p>
  <div class="field"><label for="m-reason">Explain what is wrong</label>
    <textarea id="m-reason" placeholder="For example: I sent K500, not K300. My message shows K500."></textarea>
    <p class="hint">The committee will see this until it is fixed.</p></div>`;
}

function correctionBody(p) {
  return `<p class="meta">The original ${fmtK(p.amount)} entry stays visible. Your correction is added as a new entry,
    and ${esc(firstName(p.member_id))} will be asked to confirm it.</p>
  ${p.dispute_reason ? `<p class="note bad"><strong>${esc(firstName(p.member_id))} said:</strong> "${esc(p.dispute_reason)}"</p>` : ''}
  <div class="field"><label for="m-amount">Correct amount (K)</label>
    <input type="number" id="m-amount" inputmode="decimal" min="0" step="0.01" value="${Number(p.amount)}"></div>
  <div class="field"><span class="label">How did they pay?</span>${methodChips('m-method', p.method)}</div>
  ${refField('m', p.method, p.reference)}
  <div class="field"><label for="m-reason">Reason for the correction</label>
    <textarea id="m-reason" placeholder="For example: I typed K300 by mistake. The Airtel message shows K500."></textarea></div>`;
}


/* ---------- Approvals ---------- */
function approvalsScreen() {
  const f = groupFacts();
  const { G, me } = f;

  const sorted = G.requests.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const pending = sorted.filter((r) => r.status === 'pending');
  const decided = sorted.filter((r) => r.status !== 'pending');

  const card = (r) => {
    const votes = G.votes.filter((v) => v.request_id === r.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((v) => {
        const voter = memberById(v.member_id) || {};
        return v.vote === 'yes'
          ? `<li><span class="v-yes" aria-hidden="true">✓</span><span>${esc(voter.full_name)} (${ROLE[voter.role]}) said yes, ${fmtDateTime(new Date(v.created_at))}</span></li>`
          : `<li><span class="v-no" aria-hidden="true">✕</span><span>${esc(voter.full_name)} (${ROLE[voter.role]}) said no${v.reason ? ': "' + esc(v.reason) + '"' : ''}</span></li>`;
      }).join('');

    const sources = ['bank', 'momo', 'cash']
      .filter((k) => Number(r['from_' + k]) > 0)
      .map((k) => `${fmtK(r['from_' + k])} from ${placeName(f, k).toLowerCase()}`).join(', ');

    // Loan requests: the purpose and the maths, so the committee can decide.
    let loanInfo = '';
    if (r.kind === 'loan') {
      const loan = (G.loans || []).find((l) => l.request_id === r.id);
      if (loan) {
        const c = loanCalc(f, loan);
        const saved = savedBy(f, loan.member_id);
        loanInfo = `<p class="meta">Reason: "${esc(loan.purpose)}". Interest ${fmtK(c.interest)}, total to repay ${fmtK(c.total)}
          (${fmtK(c.monthly)} a month).${f.committee ? ` ${esc(firstName(loan.member_id))}'s savings: ${fmtK(saved)},
          so the limit is ${fmtK(saved * Number(f.g.loan_multiple))}.` : ''}</p>`;
      }
    }

    let actions = '';
    if (canVote(f, r)) {
      actions = `<div class="actions">
        <button type="button" class="btn small" data-action="vote-yes" data-id="${r.id}">Approve</button>
        <button type="button" class="btn small danger-ghost" data-action="vote-no" data-id="${r.id}">Reject</button></div>`;
    } else if (r.status === 'pending' && r.requested_by === me.id) {
      actions = '<p class="note plain">You asked for this, so the committee must approve it.</p>';
    } else if (r.status === 'pending' && f.committee) {
      actions = '<p class="note plain">You have already voted.</p>';
    }

    return `
    <article class="req">
      <div class="req-top"><h3>${esc(requestTitle(r))}</h3>${pill(r.status)}</div>
      <p class="meta" style="margin-top:4px">Asked by ${esc(memberName(r.requested_by))} on ${fmtDateTime(new Date(r.created_at))}.${
        r.kind === 'type_change' && r.description ? ' Reason: "' + esc(r.description) + '"' : ''}</p>
      ${sources ? `<p class="meta">Taken from: ${esc(sources)}.</p>` : ''}
      ${loanInfo}
      ${r.status === 'pending' ? `<p class="rule">${RULE_TEXT}</p>` : ''}
      ${votes ? `<ul class="votes">${votes}</ul>` : '<p class="meta" style="margin-top:8px">No votes yet.</p>'}
      ${actions}
    </article>`;
  };

  return groupHead(f) + `
  <div class="screen-head"><h2>Approvals</h2>${f.isT ? '<button type="button" class="btn" data-action="go" data-screen="request">Ask to pay out money</button>' : ''}</div>
  <p class="muted" style="margin-top:4px">Money only leaves the group after 2 committee members say yes, including the chairperson
    or vice chairperson. ${f.committee ? '' : 'Ordinary members can see every decision, but only the committee votes.'}</p>
  ${f.priv ? privacyNote('Loan requests from other members are private to the committee.') : ''}
  <section class="section"><h2>Waiting for approval</h2>
    <div class="list">${pending.length ? pending.map(card).join('') : '<p class="empty">Nothing is waiting for approval.</p>'}</div></section>
  <section class="section"><h2>Decided</h2>
    <div class="list">${decided.length ? decided.map(card).join('') : '<p class="empty">No decisions yet.</p>'}</div></section>`;
}


/* ---------- Ask to pay out money (treasurer) ---------- */

// Fill in where the money comes from: mobile money first, then cash, then the bank.
function fillSources(amount, avail) {
  const out = { bank: 0, momo: 0, cash: 0 };
  let left = round2(amount);
  ['momo', 'cash', 'bank'].forEach((k) => {
    const take = Math.min(left, Math.max(0, avail[k]));
    out[k] = round2(take);
    left = round2(left - take);
  });
  return out;
}

function requestScreen() {
  const f = groupFacts();
  const { G, g, month } = f;
  if (!f.isT) return groupHead(f) + '<p class="infobox">Only the treasurer can ask to pay out money.</p>';

  const kinds = g.type === 'chilimba'
    ? [['payout', "Pay this month's receiver"], ['spending', 'Other group spending']]
    : [['spending', 'Group spending']];
  if (!kinds.some((k) => k[0] === S.reqKind)) S.reqKind = kinds[0][0];

  const avail = { bank: Number(G.summary.avail_bank), momo: Number(G.summary.avail_momo), cash: Number(G.summary.avail_cash) };
  const totalAvail = round2(avail.bank + avail.momo + avail.cash);
  let top = '';
  let amount = '';

  if (S.reqKind === 'payout') {
    const receiver = G.members.find((m) => m.rotation_position === month);
    const pot = Number(g.monthly_amount) * G.members.length;
    const existing = G.requests.find((r) => r.kind === 'payout' && r.cycle_month === month && r.status !== 'rejected');
    const notConfirmed = G.members.filter((m) => G.summary.statuses[m.id] !== 'confirmed');

    top = `<div class="infobox">This month's receiver is <strong>${esc(receiver ? receiver.full_name : 'nobody')}</strong>. The full pot is ${fmtK(pot)}.</div>`;
    if (cycleMonth(g) < 1) top += '<div class="errors">The cycle has not started yet, so there is no payout this month.</div>';
    if (existing) top += `<div class="errors">A payout for ${esc(mLabel(g, month))} has already been ${existing.status === 'pending' ? 'asked for and is waiting for approval' : 'approved'}.</div>`;
    if (notConfirmed.length) {
      top += `<div class="warnbox"><strong>${plural(notConfirmed.length, 'payment is', 'payments are')} not confirmed yet for this month:</strong>
        ${esc(notConfirmed.map((m) => m.full_name).join(', '))}. You can still ask, but the committee may want to wait.</div>`;
    }
    amount = Math.min(pot, totalAvail);
  }
  const src = amount ? fillSources(amount, avail) : { bank: 0, momo: 0, cash: 0 };

  return backTo('approvals', 'Approvals') + `
  <h1 class="page-title">Ask to pay out money</h1>
  <p class="lede">Your request goes to the committee. The money is only counted as paid out once it is approved.</p>
  <div id="req-errors"></div>${top}
  <div class="formcard">
    <div class="field"><span class="label">What is the money for?</span>
      <div class="chips" role="radiogroup">${kinds.map(([k, l]) =>
        `<label class="chip"><input type="radio" name="r-kind" value="${k}"${S.reqKind === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    ${S.reqKind === 'spending' ? `
    <div class="field"><label for="r-reason">Reason</label>
      <input type="text" id="r-reason" placeholder="For example: bank account charge">
      <p class="hint">Be specific. The committee will read this before voting.</p></div>` : ''}
    <div class="field"><label for="r-amount">Amount (K)</label>
      <input type="number" id="r-amount" inputmode="decimal" min="0" step="0.01" value="${amount || ''}"></div>
    <div class="field"><span class="label">Take the money from</span>
      <p class="hint" style="margin:0 0 6px">Filled in for you. You can change the amounts. They must add up to the amount above.</p>
      ${['momo', 'cash', 'bank'].map((k) => `
      <div class="srcrow"><label for="src-${k}" style="font-weight:400">${esc(placeName(f, k))}<span class="meta" style="display:block">Available: ${fmtK(avail[k])}</span></label>
        <input type="number" id="src-${k}" inputmode="decimal" min="0" step="0.01" value="${src[k] || ''}"></div>`).join('')}
    </div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="save-request">Send for approval</button>
      <button type="button" class="btn ghost" data-action="go" data-screen="approvals">Cancel</button>
    </div>
  </div>`;
}


/* ---------- Turns (chilimba) ---------- */
function turnsScreen() {
  const f = groupFacts();
  const { G, g, me, month } = f;
  if (g.type !== 'chilimba') return overviewScreen();

  const pot = Number(g.monthly_amount) * G.members.length;
  const confirmed = Number(G.summary.month_confirmed);
  const rotation = G.members.slice().sort((a, b) => a.rotation_position - b.rotation_position);
  const receiver = rotation.find((m) => m.rotation_position === month);
  const next = rotation.find((m) => m.rotation_position === month + 1);
  const started = cycleMonth(g) >= 1;

  const items = rotation.map((m) => {
    const n = m.rotation_position;
    const payout = G.requests.find((r) => r.kind === 'payout' && r.cycle_month === n && r.status !== 'rejected');
    let cls = '';
    let info;
    if (payout && payout.status === 'approved') {
      cls = 'done';
      info = pill('approved', `Received ${fmtK(payout.amount)} on ${fmtDate(new Date(payout.decided_at))}`);
    } else if (payout) {
      cls = n === month ? 'now' : '';
      info = pill('pending', 'Payout waiting for approval');
    } else if (started && n === month) {
      cls = 'now';
      info = `<span class="meta">This month. ${fmtK(confirmed)} of ${fmtK(pot)} confirmed so far.</span>`;
    } else if (started && n < month) {
      info = pill('rejected', 'Not paid out');
    } else {
      info = '<span class="meta">Upcoming</span>';
    }
    return `<li class="${cls}"><span class="n">${n}</span><div>
      <div class="rname">${esc(m.full_name)}${m.id === me.id ? ' <span class="muted">(you)</span>' : ''}</div>
      <div class="rinfo"><span class="meta">${esc(monthLabel(g, n))}</span>${info}</div></div></li>`;
  }).join('');

  const t = f.treasurer;
  const treasurerLast = t && t.rotation_position === G.members.length;
  const payButton = f.isT && started
    ? '<div style="margin-top:12px"><button type="button" class="btn small" data-action="pay-receiver">Ask to pay this month&rsquo;s receiver</button></div>'
    : '';

  return groupHead(f) + `
  <section class="hero">
    <h2>${started ? 'This month the pot goes to' : 'The first pot goes to'}</h2>
    <p class="who-big">${esc(receiver ? receiver.full_name : '')}</p>
    <p style="margin-top:8px">Everyone pays ${fmtK(g.monthly_amount)}, so the full pot is ${fmtK(g.monthly_amount)} × ${G.members.length}
      = <strong>${fmtK(pot)}</strong>. ${fmtK(confirmed)} is confirmed so far.</p>
    ${next ? `<p class="meta" style="margin-top:4px">Next: ${esc(next.full_name)} in ${esc(monthLabel(g, month + 1))}.</p>` : ''}
    ${payButton}
  </section>
  <section class="section"><h2>Order for receiving the pot</h2>
    <p class="sub">Changing this order needs committee approval.</p>
    <ol class="rot">${items}</ol>
    ${treasurerLast ? `<div class="infobox"><strong>Why the treasurer is last:</strong> ${esc(t.full_name)} receives the pot in the final month.
      The treasurer's own money stays in the group until everyone else has been paid, which makes running away with the money far less tempting.</div>` : ''}
  </section>`;
}


/* ---------- Share-out (village banking) ---------- */
function shareoutScreen() {
  const f = groupFacts();
  const { G, g, me, priv } = f;
  if (g.type !== 'village' || !G.shareout) return overviewScreen();

  const s = G.shareout;
  const total = Number(s.savings);
  const toShare = Number(s.money_to_share);
  const lent = Number(G.summary.lent);
  const pct = (saved) => (total > 0 ? (saved / total) * 100 : 0);

  // The maths for one person, step by step.
  const steps = (row, you) => {
    const saved = Number(row.saved);
    const who = you ? 'You' : firstName(row.member_id);
    if (total <= 0) {
      return `<ol class="steps"><li>Nobody has confirmed savings yet, so there is nothing to share yet.</li></ol>`;
    }
    return `<ol class="steps">
      <li>${who} saved <strong>${fmtK(saved)}</strong>. The whole group saved <strong>${fmtK(total)}</strong>.</li>
      <li>${you ? 'Your' : esc(who) + "'s"} part of the savings is ${fmtK(saved)} ÷ ${fmtK(total)}, which is about <strong>${pct(saved).toFixed(1)}%</strong>.</li>
      <li>The group has <strong>${fmtK(toShare)}</strong> to share.</li>
      <li>So ${you ? 'you receive' : esc(who) + ' receives'} ${fmtK(saved)} ÷ ${fmtK(total)} × ${fmtK(toShare)} = <strong>${fmtK(row.share)}</strong>.</li>
    </ol>`;
  };

  const mine = s.rows.find((r) => r.member_id === me.id);

  // Is the cycle finished, or is this "if the share-out happened today"?
  const ended = cycleMonth(g) > g.cycle_months;
  const intro = ended
    ? `The cycle ended in Month ${g.cycle_months} (${esc(monthLabel(g, g.cycle_months))}). These are the share-out amounts.`
    : `The cycle ends in Month ${g.cycle_months} (${esc(monthLabel(g, g.cycle_months))}). These figures show what would be shared if the share-out happened today.`;

  const waiting = Number(priv ? s.waiting_mine : s.waiting_all);
  const waitBox = waiting > 0
    ? `<div class="warnbox">${fmtK(waiting)} of ${priv ? 'your ' : ''}savings is still waiting for confirmation or disputed, so it is not counted yet.</div>` : '';

  let everyone;
  if (priv) {
    everyone = `<section class="section">${privacyNote("Only the committee can see everyone's share-out. You can always see yours, and the group totals above, so you can check that the money to share adds up.")}</section>`;
  } else {
    const list = s.rows.map((r) => `
      <details class="share">
        <summary>
          <span><strong>${esc(memberName(r.member_id))}</strong>${r.member_id === me.id ? ' <span class="muted">(you)</span>' : ''}
            <span class="pct" style="display:block">Saved ${fmtK(r.saved)}, ${pct(Number(r.saved)).toFixed(1)}% of savings</span></span>
          <span class="get">${fmtK(r.share)}<span class="open-hint" style="display:block">See the maths</span></span>
        </summary>
        <div class="body">${steps(r, r.member_id === me.id)}</div>
      </details>`).join('');

    // Check: do all the shares add up to the money to share?
    const sharesTotal = Number(s.shares_total);
    const diff = round2(Math.abs(sharesTotal - toShare));
    const check = `Check: all shares added together come to ${fmtK(sharesTotal)}` +
      (diff > 0 ? `, a difference of ${fmtK(diff)} from rounding to the ngwee.` : ', the same as the money to share.');

    everyone = `<section class="section"><h2>Everyone's share-out</h2>
      <p class="sub">Visible to the committee only. Tap a name to see how the amount is worked out.</p>
      <div class="list">${list}</div>
      <p class="meta" style="margin-top:10px">${check}</p></section>`;
  }

  return groupHead(f) + `
  <div class="screen-head"><h2>Share-out</h2></div>
  <p class="muted" style="margin-top:4px">${intro} Only confirmed savings and confirmed loan repayments are counted.</p>
  ${waitBox}
  <section class="section"><h2>Money to share</h2>
    <ul class="calc">
      <li><span>Confirmed savings</span><span class="v">${fmtK(s.savings)}</span></li>
      <li><span>Plus loan interest received</span><span class="v">+ ${fmtK(s.interest)}</span></li>
      <li><span>Plus fees and fines collected</span><span class="v">+ ${fmtK(s.fees_fines)}</span></li>
      <li><span>Minus approved group spending</span><span class="v">− ${fmtK(s.spent)}</span></li>
      <li class="total"><span>Money to share</span><span class="v">${fmtK(toShare)}</span></li>
    </ul>
    ${lent > 0 ? `<p class="hint">${fmtK(lent)} is still lent out to members. All loans must be fully repaid before the share-out.</p>`
               : '<p class="hint">All loans must be fully repaid before the share-out.</p>'}
  </section>
  ${mine ? `<section class="hero"><h2>Your share-out today</h2><p class="who-big">${fmtK(mine.share)}</p>${steps(mine, true)}</section>` : ''}
  ${everyone}`;
}


/* ---------- Pop-up boxes for requests ---------- */
function rejectBody(r) {
  return `<p>${esc(requestTitle(r))}</p>
  <div class="field"><label for="m-reason">Reason (optional)</label>
    <textarea id="m-reason" placeholder="For example: this is not allowed by our group rules"></textarea></div>`;
}

function typeChangeBody(g) {
  const now = g.next_type || g.type;
  const other = now === 'chilimba' ? 'village' : 'chilimba';
  return `<p>The group is a <strong>${TYPE[g.type]}</strong>. You are asking to change it to <strong>${TYPE[other]}</strong>.
    This needs committee approval, and it would start with the next cycle so that no one's current money is affected.</p>
  <div class="field"><label for="m-reason">Why do you want to change it?</label><textarea id="m-reason"></textarea></div>`;
}


/* ---------- One loan, as a card ---------- */
function loanCard(f, l) {
  const { g, me } = f;
  const c = loanCalc(f, l);
  const own = l.member_id === me.id;
  const replaced = new Set(c.reps.filter((r) => r.corrects_id).map((r) => r.corrects_id));

  let status;
  if (l.status === 'requested') status = pill('pending', 'Waiting for committee approval');
  else if (l.status === 'rejected') status = pill('rejected');
  else if (l.status === 'approved') status = pill('tosend');
  else if (l.status === 'repaid') status = pill('repaid');
  else status = c.overdue ? pill('overdue', `Overdue since ${monthLabel(g, c.dueMonth)}`) : pill('repaying');

  const due = c.dueMonth ? `by the end of ${monthLabel(g, c.dueMonth)}` : `${plural(l.months, 'month', 'months')} after it is sent`;

  const repayments = c.reps.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((r) => {
    const isReplaced = replaced.has(r.id);
    let acts = '';
    if (!isReplaced && own && r.status === 'waiting') {
      acts += `<button type="button" class="btn small" data-action="rp-confirm" data-id="${r.id}">Yes, I paid this</button>
               <button type="button" class="btn small danger-ghost" data-action="rp-dispute" data-id="${r.id}">This is wrong</button>`;
    }
    if (!isReplaced && f.isT && l.status === 'active') {
      acts += `<button type="button" class="btn small ghost" data-action="rp-correct" data-id="${r.id}">Fix with a correction</button>`;
    }
    return `<div class="rp">
      <span><strong class="num"${isReplaced ? ' style="text-decoration:line-through;color:var(--muted)"' : ''}>${fmtK(r.amount)}</strong>
        <span class="meta">on ${fmtDate(parseDay(r.paid_on))}, ${esc(method(r.method).label)}${r.reference ? ', ref ' + esc(r.reference) : ''}</span>
        ${r.dispute_reason ? `<span class="meta" style="display:block">"${esc(r.dispute_reason)}"</span>` : ''}
        ${r.correction_reason ? `<span class="meta" style="display:block">Correction: "${esc(r.correction_reason)}"</span>` : ''}</span>
      ${pill(isReplaced ? 'corrected' : r.status)}
      ${acts ? `<span class="actions" style="margin:0">${acts}</span>` : ''}
    </div>`;
  }).join('');

  let actions = '';
  if (f.isT && l.status === 'approved') actions += `<button type="button" class="btn small" data-action="loan-send" data-id="${l.id}">Send the money</button>`;
  if (f.isT && l.status === 'active') actions += `<button type="button" class="btn small" data-action="loan-repay" data-id="${l.id}">Record a repayment</button>`;
  if (own && l.sent_on && !l.received_at) actions += `<button type="button" class="btn small" data-action="loan-received" data-id="${l.id}">Yes, I received ${fmtK(l.amount)}</button>`;

  const sentText = l.sent_on
    ? `Sent on ${fmtDate(parseDay(l.sent_on))} (ref ${esc(l.sent_reference)}). ${l.received_at
        ? 'Receipt confirmed by ' + esc(firstName(l.member_id)) + '.' : 'Not yet confirmed as received.'} `
    : '';

  return `
  <article class="loan">
    <div class="loan-top">
      <div><h3>${esc(memberName(l.member_id))}${own ? ' <span class="muted" style="font-size:15px;font-weight:400">(you)</span>' : ''}</h3>
        <p class="meta">"${esc(l.purpose)}", asked on ${fmtDate(new Date(l.created_at))}</p></div>
      ${status}
    </div>
    <ul class="calc">
      <li><span>Borrowed</span><span class="v">${fmtK(l.amount)}</span></li>
      <li><span>Interest (${Number(l.rate)}% a month × ${plural(l.months, 'month', 'months')})</span><span class="v">+ ${fmtK(c.interest)}</span></li>
      <li class="total"><span>Total to repay</span><span class="v">${fmtK(c.total)}</span></li>
      <li><span>Each month</span><span class="v">${fmtK(c.monthly)}</span></li>
      ${l.sent_on ? `<li><span>Repaid so far</span><span class="v">${fmtK(c.paid)}</span></li>
                     <li><span>Still to pay</span><span class="v">${fmtK(c.remaining)}</span></li>` : ''}
    </ul>
    ${l.sent_on ? `<div class="progress" role="img" aria-label="${Math.round((c.paid / c.total) * 100)}% repaid"><span style="width:${Math.min(100, (c.paid / c.total) * 100)}%"></span></div>` : ''}
    <p class="meta" style="margin-top:8px">${sentText}Repay ${due}.</p>
    ${repayments ? `<div style="margin-top:8px">${repayments}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </article>`;
}


/* ---------- Loans (village banking) ---------- */
function loansScreen() {
  const f = groupFacts();
  const { G, g, me } = f;
  if (g.type !== 'village') return overviewScreen();

  const loans = G.loans || [];
  const activeCount = loans.filter((l) => l.status === 'active').length;
  const order = { approved: 0, requested: 1, active: 2, repaid: 3, rejected: 4 };
  const all = loans.slice().sort((a, b) =>
    (order[a.status] - order[b.status]) ||
    (Number(loanCalc(f, b).overdue) - Number(loanCalc(f, a).overdue)) ||
    (new Date(b.created_at) - new Date(a.created_at)));
  const mine = all.filter((l) => l.member_id === me.id);

  const rules = `
  <div class="rules">
    <div class="rule-item"><strong>${Number(g.loan_rate)}% a month</strong><span>Interest on the amount borrowed, for each month of the loan.</span></div>
    <div class="rule-item"><strong>${Number(g.loan_multiple)} × your savings</strong><span>The most you can borrow.</span></div>
    <div class="rule-item"><strong>Up to ${plural(g.loan_max_months, 'month', 'months')}</strong><span>Time to repay. One loan at a time.</span></div>
  </div>
  <p class="hint" style="margin-top:8px">Repayments pay off the interest first, then the amount borrowed. All interest goes to the group
    and is shared out at the end of the cycle, so borrowers also get a share of it. Changing these rules needs committee approval.</p>`;

  const summary = `<div class="formcard" style="padding:16px"><span class="big">${fmtK(G.summary.lent)}</span>
    <span class="muted">lent out right now${f.committee ? ` to ${plural(activeCount, 'member', 'members')}` : ''}.
    ${fmtK(G.summary.interest_received)} interest received so far.</span></div>`;

  const body = f.committee
    ? `<section class="section"><h2>All loans</h2><p class="sub">Visible to the committee only.</p>
        <div class="list">${all.length ? all.map((l) => loanCard(f, l)).join('') : '<p class="empty">No loans yet.</p>'}</div></section>`
    : `<section class="section"><h2>My loans</h2>
        <div class="list">${mine.length ? mine.map((l) => loanCard(f, l)).join('') : '<p class="empty">You have not borrowed from the group yet.</p>'}</div>
        ${privacyNote("Other members' loans are only visible to the committee. Everyone can see the total lent out.")}</section>`;

  return groupHead(f) + `
  <div class="screen-head"><h2>Loans</h2><button type="button" class="btn" data-action="go" data-screen="loanreq">Ask for a loan</button></div>
  ${summary}
  <section class="section"><h2>Group loan rules</h2>${rules}</section>
  ${body}`;
}


/* ---------- Ask for a loan ---------- */
function loanCalcBox(g, amount, months) {
  const a = parseFloat(amount);
  if (!(a > 0)) return '<h3>How the loan works out</h3><p class="meta" style="margin-top:6px">Enter an amount to see the calculation.</p>';
  return `<h3>How the loan works out</h3>${loanSteps(g, round2(a), months, true)}
    <p class="meta">The interest goes to the group, and you get a share of it back at share-out.</p>`;
}

function loanreqScreen() {
  const f = groupFacts();
  const { G, g, me } = f;
  if (g.type !== 'village') return overviewScreen();

  const saved = savedBy(f, me.id);
  const limit = round2(saved * Number(g.loan_multiple));
  const avail = round2(Number(G.summary.avail_bank) + Number(G.summary.avail_momo) + Number(G.summary.avail_cash));
  const open = (G.loans || []).find((l) => l.member_id === me.id && ['requested', 'approved', 'active'].includes(l.status));
  const amount = Math.min(1000, limit) || '';
  const months = Math.min(2, g.loan_max_months);

  const block = open
    ? `<div class="warnbox"><strong>You already have a loan ${open.status === 'active' ? 'being repaid' : 'waiting'}.</strong>
        The group allows one loan at a time, so you can ask again once it is fully repaid.
        You can still use the calculator below to see how a loan would work.</div>` : '';

  return backTo('loans', 'Loans') + `
  <h1 class="page-title">Ask for a loan</h1>
  <p class="lede">The committee will look at your request. The calculation below shows exactly what you would pay back.</p>
  <div id="ln-errors"></div>${block}
  <div class="infobox">Your confirmed savings are <strong>${fmtK(saved)}</strong>, so you can borrow up to
    <strong>${fmtK(limit)}</strong> (${Number(g.loan_multiple)} × your savings).</div>
  <div class="formcard">
    <div class="field"><label for="ln-amount">How much do you want to borrow? (K)</label>
      <input type="number" id="ln-amount" inputmode="decimal" min="0" step="1" value="${amount}"></div>
    <div class="field"><label for="ln-months">How many months to repay?</label>
      <select id="ln-months">${Array.from({ length: g.loan_max_months }, (_, i) =>
        `<option value="${i + 1}"${i + 1 === months ? ' selected' : ''}>${plural(i + 1, 'month', 'months')}</option>`).join('')}</select></div>
    <div class="calcbox" id="ln-calc" aria-live="polite">${loanCalcBox(g, amount, months)}</div>
    <div class="field"><label for="ln-purpose">What is the loan for?</label>
      <input type="text" id="ln-purpose" placeholder="For example: buy stock for my shop">
      <p class="hint">The committee reads this before voting.</p></div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="save-loan"${open ? ' disabled' : ''}>Send loan request</button>
      <button type="button" class="btn ghost" data-action="go" data-screen="loans">Cancel</button>
    </div>
    <p class="hint">The group has ${fmtK(avail)} available to lend right now.</p>
  </div>`;
}


/* ---------- Pop-up boxes for loans ---------- */
function sendLoanBody(f, l) {
  const avail = { bank: Number(f.G.summary.avail_bank), momo: Number(f.G.summary.avail_momo), cash: Number(f.G.summary.avail_cash) };
  const firstOk = ['bank', 'momo', 'cash'].find((k) => avail[k] >= Number(l.amount)) || 'bank';
  return `<p class="meta">The loan is approved. Record where the money came from, so the committee can trace it.
    ${esc(firstName(l.member_id))} will be asked to confirm receiving it.</p>
  <div class="field"><span class="label">Send from</span>
    <div class="chips" role="radiogroup">${['bank', 'momo', 'cash'].map((k) =>
      `<label class="chip"><input type="radio" name="sd-from" value="${k}"${k === firstOk ? ' checked' : ''}><span>${esc(placeName(f, k))} (${fmtK(avail[k])})</span></label>`).join('')}</div></div>
  <div class="field"><label for="sd-ref">Transaction or withdrawal slip number</label>
    <input type="text" id="sd-ref" autocomplete="off">
    <p class="hint">For cash, write the receipt number.</p></div>`;
}

function repayBody(f, l) {
  const c = loanCalc(f, l);
  const last = c.reps[c.reps.length - 1];
  const lastMethod = last ? last.method : '';
  return `<p class="meta">Still to pay: ${fmtK(c.remaining)}. The monthly amount is ${fmtK(c.monthly)}.</p>
  <div class="field"><label for="m-amount">Amount repaid (K)</label>
    <input type="number" id="m-amount" inputmode="decimal" min="0" step="0.01" value="${Math.min(c.monthly, c.remaining)}"></div>
  <div class="field"><label for="m-date">Date paid</label>
    <input type="date" id="m-date" value="${toDayText(new Date())}" max="${toDayText(new Date())}"></div>
  <div class="field"><span class="label">How did they pay?</span>${methodChips('m-method', lastMethod)}</div>
  ${refField('m', lastMethod)}`;
}

function repaymentDisputeBody(r) {
  return `<p class="meta">${fmtK(r.amount)} recorded on ${fmtDate(parseDay(r.paid_on))}.</p>
  <div class="field"><label for="m-reason">Explain what is wrong</label>
    <textarea id="m-reason" placeholder="For example: I paid K600, not K400."></textarea>
    <p class="hint">The committee will see this until it is fixed.</p></div>`;
}

function repaymentCorrectionBody(r) {
  return `<p class="meta">The original ${fmtK(r.amount)} entry stays visible. Your correction is added as a new entry,
    and the borrower will be asked to confirm it.</p>
  ${r.dispute_reason ? `<p class="note bad"><strong>The borrower said:</strong> "${esc(r.dispute_reason)}"</p>` : ''}
  <div class="field"><label for="m-amount">Correct amount (K)</label>
    <input type="number" id="m-amount" inputmode="decimal" min="0" step="0.01" value="${Number(r.amount)}"></div>
  <div class="field"><span class="label">How did they pay?</span>${methodChips('m-method', r.method)}</div>
  ${refField('m', r.method, r.reference)}
  <div class="field"><label for="m-reason">Reason for the correction</label><textarea id="m-reason"></textarea></div>`;
}
