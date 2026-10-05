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
    '<div style="display:flex;align-items:center;gap:12px">' + right + '</div>' +
    '</div></header>';
}


/* ---------- 1. Log in / sign up ---------- */
function loginScreen() {
  const signUp = S.authTab === 'signup';
  return `
  <h1 class="page-title">Welcome to Usambazi</h1>
  <p class="lede">Clear, shared records for your chilimba or village banking group. Every payment is recorded,
    confirmed by the person who paid, and checked by a committee. Nobody can secretly change the records.</p>

  <div class="seg" role="group" aria-label="Log in or create an account">
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


/* ---------- 5. A group (Phase 1 version) ---------- */
function groupScreen() {
  const { info: g, members, history } = S.group;
  const me = members.find((m) => m.user_id === S.user.id);
  const committee = me && me.role !== 'member';

  // Chilimba: show members in the order they receive the pot.
  // Village banking: committee first, in role order, then members by name.
  const sorted = members.slice().sort((a, b) =>
    g.type === 'chilimba'
      ? a.rotation_position - b.rotation_position
      : ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name));

  const memberRows = sorted.map((m) => {
    const turn = g.type === 'chilimba'
      ? `<div class="meta">Receives the pot in month ${m.rotation_position} (${esc(monthLabel(g, m.rotation_position))})</div>`
      : '';
    return `
    <div class="row">
      <div>
        <strong>${esc(m.full_name)}</strong>${m.id === (me && me.id) ? ' <span class="muted">(you)</span>' : ''}
        ${m.role !== 'member' ? `<span class="role-tag">${ROLE[m.role]}</span>` : ''}
        <div class="meta">${esc(m.phone || 'No phone given')}</div>
        ${turn}
      </div>
      <div class="right">${pill(m.user_id ? 'joined' : 'notjoined')}</div>
    </div>`;
  }).join('');

  const invite = committee ? `
  <div class="invite-card">
    <h2 style="font-size:19px">Invite code</h2>
    <p class="invite-code" aria-label="Invite code ${esc(g.invite_code.split('').join(' '))}">${esc(g.invite_code)}</p>
    <p style="margin-top:6px">Share this code with your members. Each person creates an account, presses
      "Join with an invite code", types the code and chooses their name.</p>
    <div class="form-actions" style="margin-top:12px">
      <button type="button" class="btn small" data-action="copy-code">Copy the code</button>
    </div>
  </div>` : '';

  const joined = members.filter((m) => m.user_id).length;

  const historyRows = history.map((h) => `
    <div class="hentry">
      <span class="when">${fmtDateTime(new Date(h.created_at))}</span>
      <span class="who-line">${esc(h.actor_name)}</span>
      <span>${esc(h.action)}</span>
    </div>`).join('');

  const rulesText = g.type === 'chilimba'
    ? `Everyone pays ${fmtK(g.monthly_amount)} every month. The pot is ${fmtK(g.monthly_amount)} × ${members.length} = ${fmtK(g.monthly_amount * members.length)}.`
    : `Members save at least ${fmtK(g.monthly_amount)} a month. Loans: ${Number(g.loan_rate)}% interest a month, up to ${Number(g.loan_multiple)} times savings, repaid within ${plural(g.loan_max_months, 'month', 'months')}.`;

  return `
  <button type="button" class="back" data-action="home">${icon('back')}All groups</button>
  <div class="group-head">
    <h1>${esc(g.name)}</h1>
    <p class="group-sub">
      <span class="type-badge">${icon('lock')}${TYPE[g.type]}</span>
      <span>${plural(members.length, 'member', 'members')}</span>
      <span>${esc(cycleText(g))}</span>
    </p>
    <p style="margin-top:10px">${esc(rulesText)}</p>
  </div>

  ${invite}

  <div class="screen-head"><h2>Members</h2></div>
  <p class="muted" style="margin-top:4px">${joined} of ${members.length} have joined with the invite code.${g.type === 'chilimba'
    ? ' The treasurer receives the pot last, so their own money stays in the group until everyone else has been paid.' : ''}</p>
  <div class="list">${memberRows}</div>

  <div class="screen-head"><h2>History</h2></div>
  <p class="muted" style="margin-top:4px">Every action in this group, newest first. Nobody can edit or remove anything here,
    not even the treasurer or chairperson.</p>
  <div class="list">${historyRows || '<p class="empty">Nothing yet.</p>'}</div>

  <p class="note info" style="margin-top:24px">Payments, approvals and the other group screens are coming in the next steps.</p>`;
}
