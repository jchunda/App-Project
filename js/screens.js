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


/* ---------- Group menu and heading ---------- */
function groupNav(f) {
  const myWaiting = f.active.filter((p) => p.member_id === f.me.id && p.status === 'waiting').length;
  const items = [
    ['overview', 'Overview', 'home', 0],
    ['payments', 'Payments', 'receipt', myWaiting],
    ['members',  'Members',  'people', 0],
    ['history',  'History',  'clock', 0]
  ];
  const parent = { record: 'payments', move: 'overview' };
  const on = parent[S.screen] || S.screen;
  return `<nav class="nav" aria-label="Group menu" style="grid-template-columns:repeat(${items.length},1fr)">${items.map(([screen, label, ic, badge]) =>
    `<button type="button" data-action="go" data-screen="${screen}"${on === screen ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${
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

  const items = [];
  if (myWaiting) items.push(['bad', `You have ${plural(myWaiting, 'payment', 'payments')} to confirm`, 'Check it against your mobile money message.', 'payments', 'mine']);
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

  const totals = g.type === 'chilimba'
    ? `${fmtK(G.summary.confirmed_savings)} confirmed payments this cycle.`
    : `${fmtK(G.summary.confirmed_savings)} confirmed savings so far this cycle.`;

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
      <p class="meta">Changing the type changes how everyone's money is worked out, so it needs committee approval.</p></div></div>
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
