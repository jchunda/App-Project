/* =====================================================================
   Usambazi: js/app.js
   The app's memory (S), drawing the right screen, and what happens when
   you press buttons. Screens themselves are drawn in js/screens.js.
   ===================================================================== */
'use strict';


/* ---------- The app's memory ---------- */
const S = {
  user: null,        // the logged-in person (from Supabase), or null
  profile: null,     // their name and phone (profiles table)
  screen: 'loading', // 'login', 'home', 'create', 'join', or a group screen (see GROUP_SCREENS)
  authTab: 'login',  // on the login screen: 'login' or 'signup'
  groups: [],        // "My groups" list (from my_groups)
  group: null,       // the open group: { info, members, history, payments, deposits, summary }
  draft: null,       // the "Create a group" form while you fill it in
  join: null,        // the "Join a group" form: { code, preview }
  payTab: 'mine',    // Payments screen: 'mine' or 'all'
  payMonth: 'all',   // Payments screen: which month to show under "All payments"
  reqKind: null      // "Ask to pay out money": 'payout' or 'spending'
};

// Screens inside a group, and the function that draws each one (js/screens.js).
const GROUP_SCREENS = {
  overview: () => overviewScreen(),
  payments: () => paymentsScreen(),
  record:   () => recordScreen(),
  members:  () => membersScreen(),
  history:  () => historyScreen(),
  move:     () => moveScreen(),
  approvals: () => approvalsScreen(),
  request:  () => requestScreen(),
  turns:    () => turnsScreen(),
  shareout: () => shareoutScreen(),
  loans:    () => loansScreen(),
  loanreq:  () => loanreqScreen()
};


/* ---------- Connect to Supabase ---------- */
// If the keys are missing, stop and point to the connection check page.
const keysOk = typeof window.supabase !== 'undefined' &&
  typeof SUPABASE_URL === 'string' && !/PASTE-YOUR/.test(SUPABASE_URL + SUPABASE_KEY);

const db = keysOk ? window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim()) : null;


/* ---------- Drawing ---------- */
const app = document.getElementById('app');

// Draw the current screen. keepScroll = stay at the same place on the page.
function render(keepScroll) {
  const y = window.scrollY;

  // Inside a group: the group menu plus the screen.
  if (S.group && GROUP_SCREENS[S.screen]) {
    app.innerHTML = topbar() + '<div class="layout has-nav">' + groupNav(groupFacts()) +
      '<main class="content" id="main" tabindex="-1">' + GROUP_SCREENS[S.screen]() + '</main></div>';
    window.scrollTo(0, keepScroll ? y : 0);
    return;
  }

  let html;
  switch (S.screen) {
    case 'login':  html = loginScreen(); break;
    case 'home':   html = homeScreen(); break;
    case 'create': html = createScreen(); break;
    case 'join':   html = joinScreen(); break;
    default:       html = '<p class="muted">Loading…</p>';
  }
  app.innerHTML = topbar() + '<div class="layout"><main class="content" id="main" tabindex="-1">' + html + '</main></div>';
  window.scrollTo(0, keepScroll ? y : 0);
}

// Go to another screen and move keyboard / screen reader focus to it.
function go(screen) {
  S.screen = screen;
  render(false);
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
}


/* ---------- Loading data ---------- */

async function loadProfile() {
  const { data } = await db.from('profiles').select('full_name, phone').eq('id', S.user.id).maybeSingle();
  S.profile = data || { full_name: '', phone: '' };
}

async function openHome() {
  const { data, error } = await db.rpc('my_groups');
  if (error) { toast(friendlyError(error)); S.groups = []; }
  else S.groups = data || [];
  S.group = null;
  go('home');
}

// Load everything about one group. The security rules decide what comes
// back: in village banking, ordinary members only get their own payments.
async function loadGroup(groupId) {
  const [g, m, h, p, d, s, r] = await Promise.all([
    db.from('groups').select('*').eq('id', groupId).single(),
    db.from('group_members').select('*').eq('group_id', groupId),
    db.from('history').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(200),
    db.from('payments').select('*').eq('group_id', groupId),
    db.from('bank_deposits').select('*').eq('group_id', groupId),
    db.rpc('group_summary', { gid: groupId }),
    db.from('requests').select('*').eq('group_id', groupId)
  ]);
  let error = g.error || m.error || h.error || p.error || d.error || s.error || r.error;
  if (error) { toast(friendlyError(error)); return false; }

  // Votes on the requests we can see.
  const ids = r.data.map((x) => x.id);
  let votes = [];
  if (ids.length) {
    const v = await db.from('votes').select('*').in('request_id', ids);
    if (v.error) { toast(friendlyError(v.error)); return false; }
    votes = v.data;
  }

  // Village banking: the share-out (worked out by the database), loans and repayments.
  let shareout = null, loans = [], repayments = [];
  if (g.data.type === 'village') {
    const [so, ln, rp] = await Promise.all([
      db.rpc('shareout', { gid: groupId }),
      db.from('loans').select('*').eq('group_id', groupId),
      db.from('loan_repayments').select('*').eq('group_id', groupId)
    ]);
    error = so.error || ln.error || rp.error;
    if (error) { toast(friendlyError(error)); return false; }
    shareout = so.data; loans = ln.data; repayments = rp.data;
  }

  S.group = { info: g.data, members: m.data, history: h.data, payments: p.data, deposits: d.data,
              summary: s.data, requests: r.data, votes, shareout, loans, repayments };
  return true;
}

async function openGroup(groupId, screen) {
  if (!(await loadGroup(groupId))) return;
  S.payTab = 'mine';
  S.payMonth = 'all';
  go(screen || 'overview');
}

// After a change: load the group again and stay on the screen you are on.
async function refreshGroup() {
  if (S.group && (await loadGroup(S.group.info.id))) render(true);
}


/* ---------- Logging in and out ---------- */

// Supabase tells us whenever someone logs in or out (and once when the page opens).
// setTimeout lets Supabase finish its own work before we ask it more.
if (db) {
  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => onLoginChange(session ? session.user : null), 0);
  });
} else {
  app.innerHTML = topbar() + '<main class="content"><h1 class="page-title">Almost ready</h1>' +
    '<p class="note bad">Usambazi can\'t connect yet. Open <a href="check.html">check.html</a> to see what to fix.</p></main>';
}

async function onLoginChange(user) {
  const sameUser = S.user && user && S.user.id === user.id;
  S.user = user;
  if (!user) {
    S.profile = null; S.groups = []; S.group = null;
    go('login');
    return;
  }
  if (sameUser && S.screen !== 'loading') return;   // e.g. a login refresh: stay where you are
  await loadProfile();
  await openHome();
}

async function submitAuth() {
  const signUp = S.authTab === 'signup';
  const email = val('au-email').trim();
  const password = val('au-password');
  const fullName = signUp ? val('au-name').trim() : '';
  const phone = signUp ? val('au-phone').trim() : '';

  const errs = [];
  if (signUp && fullName.length < 2) errs.push('Type your full name.');
  if (!email) errs.push('Type your email address.');
  if (password.length < 6) errs.push('The password must have at least 6 characters.');
  showErrors('auth-errors', errs);
  if (errs.length) return;

  const done = setBusy(document.getElementById('auth-submit'), signUp ? 'Creating your account…' : 'Logging in…');
  const result = signUp
    ? await db.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } })
    : await db.auth.signInWithPassword({ email, password });
  done();

  if (result.error) { showErrors('auth-errors', [friendlyError(result.error)]); return; }
  if (signUp && !result.data.session) {
    showErrors('auth-errors', ['Your account was made, but Supabase wants the email confirmed first. ' +
      'Check your email, or turn off "Confirm email" in Supabase for testing.']);
  }
  // If it worked, onLoginChange (above) opens "My groups" by itself.
}


/* ---------- Create a group ---------- */

function newDraft() {
  const now = new Date();
  // Suggested committee, as in the prototype. Member 1 is you, as chairperson.
  const roles = ['chair', 'vice', 'treasurer', 'comms', 'rep', 'member', 'member'];
  return {
    name: '', type: 'chilimba', amount: '500', cycle: '12', rate: '10', mult: '3', maxm: '3',
    start: toDayText(new Date(now.getFullYear(), now.getMonth(), 1)),
    members: roles.map((role, i) => ({
      full_name: i === 0 ? (S.profile.full_name || '') : '',
      phone:     i === 0 ? (S.profile.phone || '') : '',
      role,
      is_me: i === 0
    }))
  };
}

// Copy what is typed on the screen into S.draft, so nothing is lost when we redraw.
function syncDraft() {
  const d = S.draft;
  if (!d || !document.getElementById('cg-name')) return;
  d.name = val('cg-name');
  d.amount = val('cg-amount');
  d.start = val('cg-start');
  if (document.getElementById('cg-cycle')) {
    d.cycle = val('cg-cycle'); d.rate = val('cg-rate'); d.mult = val('cg-mult'); d.maxm = val('cg-maxm');
  }
  d.members.forEach((m, i) => {
    m.full_name = val('cm-name-' + i);
    m.phone = val('cm-phone-' + i);
    m.role = val('cm-role-' + i);
  });
}

// Check the form (CLAUDE.md section 4). The database checks the same rules again.
function checkDraft(d) {
  const errs = [];
  const ms = d.members.filter((m) => m.full_name.trim() || m.is_me);
  const max = MAX_MEMBERS[d.type];
  const count = (role) => ms.filter((m) => m.role === role).length;
  const committee = ms.filter((m) => m.role !== 'member').length;

  ['cg-name', 'cg-amount', 'cg-cycle', 'cg-rate', 'cg-mult', 'cg-maxm'].forEach((id) => markField(id, false));

  if (d.name.trim().length < 2) { errs.push('Give the group a name.'); markField('cg-name', true); }
  if (!(parseFloat(d.amount) > 0)) { errs.push('Enter the monthly amount, in Kwacha.'); markField('cg-amount', true); }
  if (ms.some((m) => m.is_me && m.full_name.trim().length < 2)) errs.push('Type your own name in member 1.');
  if (ms.some((m) => !m.is_me && m.full_name.trim().length < 2)) errs.push('Each member\'s name needs at least 2 letters.');
  if (ms.length < MIN_MEMBERS) errs.push(`Add at least ${MIN_MEMBERS} members. You have ${ms.length}.`);
  if (ms.length > max) errs.push(`A ${TYPE[d.type].toLowerCase()} can have up to ${max} members. You have ${ms.length}.`);
  if (count('chair') !== 1) errs.push('Choose exactly one chairperson.');
  if (count('treasurer') !== 1) errs.push('Choose exactly one treasurer.');
  if (count('vice') > 1) errs.push('Choose only one vice chairperson.');
  if (committee < MIN_COMMITTEE) errs.push(`The committee needs at least ${MIN_COMMITTEE} people. You have ${committee}.`);
  if (count('member') < 1) errs.push('Add at least one ordinary member.');

  if (d.type === 'village') {
    const cycle = Number(d.cycle), rate = Number(d.rate), mult = Number(d.mult), maxm = Number(d.maxm);
    if (!(Number.isInteger(cycle) && cycle >= 1 && cycle <= 24)) { errs.push('The cycle must be between 1 and 24 months.'); markField('cg-cycle', true); }
    if (!(d.rate !== '' && rate >= 0 && rate <= 50)) { errs.push('Loan interest must be between 0% and 50% a month.'); markField('cg-rate', true); }
    if (!(mult >= 1 && mult <= 10)) { errs.push('The borrowing limit must be between 1 and 10 times savings.'); markField('cg-mult', true); }
    if (!(Number.isInteger(maxm) && maxm >= 1 && maxm <= 12)) { errs.push('The longest repayment time must be between 1 and 12 months.'); markField('cg-maxm', true); }
  }
  return { errs, members: ms };
}

async function saveGroup(button) {
  syncDraft();
  const d = S.draft;
  const { errs, members } = checkDraft(d);
  showErrors('cg-errors', errs);
  if (errs.length) return;

  const done = setBusy(button, 'Creating the group…');
  const { data: groupId, error } = await db.rpc('create_group', {
    p_group: {
      name: d.name.trim(),
      type: d.type,
      monthly_amount: round2(parseFloat(d.amount)),
      start_month: d.start,
      cycle_months: d.type === 'village' ? Number(d.cycle) : null,
      loan_rate: d.type === 'village' ? Number(d.rate) : null,
      loan_multiple: d.type === 'village' ? Number(d.mult) : null,
      loan_max_months: d.type === 'village' ? Number(d.maxm) : null
    },
    p_members: members.map((m) => ({
      full_name: m.full_name.trim(), phone: m.phone.trim(), role: m.role, is_me: m.is_me
    }))
  });
  done();

  if (error) { showErrors('cg-errors', [friendlyError(error)]); return; }
  S.draft = null;
  await openGroup(groupId, 'members');
  toast(d.name.trim() + ' is ready. Share the invite code with your members.');
}


/* ---------- Join a group ---------- */

async function findInvite() {
  const code = val('jn-code').trim();
  S.join = { code, preview: null };
  if (!code) { showErrors('jn-errors', ['Type the invite code.']); return; }

  const done = setBusy(document.getElementById('join-find'), 'Looking…');
  const { data, error } = await db.rpc('invite_preview', { p_code: code });
  done();
  if (error) { render(true); showErrors('jn-errors', [friendlyError(error)]); return; }
  S.join.preview = data;
  render(true);
}

async function joinGroup(button) {
  const memberId = radioVal('jn-member');
  if (!memberId) { showErrors('jn-errors', ['Choose your name from the list.']); return; }

  const done = setBusy(button, 'Joining…');
  const { data: groupId, error } = await db.rpc('join_group', { p_code: S.join.preview.code, p_member_id: memberId });
  done();
  if (error) { showErrors('jn-errors', [friendlyError(error)]); return; }

  const name = S.join.preview.name;
  S.join = null;
  await openGroup(groupId);
  toast('Welcome to ' + name + '.');
}


/* ---------- Payments ---------- */

// Show or hide the reference box to suit the payment method.
function updateRefField(prefix, methodId) {
  const m = method(methodId);
  const wrap = document.getElementById(prefix + '-refwrap');
  if (!wrap) return;
  wrap.hidden = m.id === 'cash';
  document.getElementById(prefix + '-cashhint').hidden = m.id !== 'cash';
  document.getElementById(prefix + '-reflabel').textContent = m.needsRef ? 'Transaction reference' : 'Deposit slip number (optional)';
  document.getElementById(prefix + '-refhint').textContent = m.hint;
}

// Is this reference already used in a payment I can see? (The database checks
// every payment in every group; this check just gives a quicker message.)
const tidyRef = (r) => String(r || '').toUpperCase().replace(/\s+/g, '');
const refSeen = (ref, exceptId) => S.group.payments.some((p) => p.id !== exceptId && tidyRef(p.reference) === tidyRef(ref));

async function savePayment(button) {
  const f = groupFacts();
  const memberId = val('f-member');
  const kind = radioVal('f-kind') || 'saving';
  const amount = parseFloat(val('f-amount'));
  const month = Number(val('f-month'));
  const paidOn = val('f-date');
  const methodId = radioVal('f-method');
  const ref = val('f-ref').trim();
  const note = val('f-note').trim();
  const m = methodId ? method(methodId) : null;

  const errs = [];
  markField('f-member', !memberId); if (!memberId) errs.push('Choose who paid.');
  markField('f-amount', !(amount > 0)); if (!(amount > 0)) errs.push('Enter the amount paid, for example 500.');
  if (!paidOn) errs.push('Choose the date the money was paid.');
  else if (paidOn > toDayText(new Date())) errs.push('The date paid cannot be in the future.');
  if (!m) errs.push('Choose how they paid.');
  if (m && m.needsRef && ref.length < 6) {
    markField('f-ref', true);
    errs.push('Enter the transaction reference from the mobile money message. It lets anyone trace the payment.');
  } else if (m && m.id !== 'cash' && ref && refSeen(ref)) {
    markField('f-ref', true);
    errs.push('This reference is already used for another payment. Each mobile money payment has its own reference.');
  } else {
    markField('f-ref', false);
  }
  // Chilimba: no more than the fixed amount for one member in one month.
  if (memberId && amount > 0 && f.g.type === 'chilimba') {
    const already = round2(f.active.filter((p) => p.member_id === memberId && p.cycle_month === month && p.kind === 'saving')
                                   .reduce((t, p) => t + Number(p.amount), 0));
    if (already + amount > Number(f.g.monthly_amount)) {
      errs.push(`${memberName(memberId)} already has ${fmtK(already)} recorded for Month ${month}. ` +
                `Everyone pays ${fmtK(f.g.monthly_amount)} a month. If an entry is wrong, fix it with a correction instead.`);
    }
  }
  showErrors('rec-errors', errs);
  if (errs.length) return;

  const done = setBusy(button, 'Saving…');
  const { error } = await db.rpc('record_payment', {
    p_group_id: f.g.id, p_member_id: memberId, p_kind: kind, p_amount: round2(amount),
    p_cycle_month: month, p_paid_on: paidOn, p_method: methodId,
    p_reference: m.id === 'cash' ? null : ref, p_note: note
  });
  done();
  if (error) { showErrors('rec-errors', [friendlyError(error)]); return; }

  S.payTab = 'all';
  S.payMonth = 'all';
  S.screen = 'payments';
  await refreshGroup();
  window.scrollTo(0, 0);
  toast(`Payment saved. ${firstName(memberId)} will be asked to confirm it.`);
}

async function confirmPayment(paymentId, button) {
  const done = setBusy(button, 'Saving…');
  const { error } = await db.rpc('answer_payment', { p_payment_id: paymentId, p_answer: 'confirmed', p_reason: null });
  done();
  if (error) { toast(friendlyError(error)); return; }
  await refreshGroup();
  toast('Thank you. The payment is confirmed.');
}

function disputePayment(paymentId) {
  const p = S.group.payments.find((x) => x.id === paymentId);
  openModal('What is wrong with this payment?', disputeBody(p), 'Mark as wrong', async () => {
    const reason = val('m-reason').trim();
    if (reason.length < 5) return 'Please explain what is wrong in a few words.';
    const { error } = await db.rpc('answer_payment', { p_payment_id: paymentId, p_answer: 'disputed', p_reason: reason });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast('Marked as disputed. The committee can now see it.');
  }, true);
}

function correctPayment(paymentId) {
  const p = S.group.payments.find((x) => x.id === paymentId);
  openModal('Fix with a correction', correctionBody(p), 'Save correction', async () => {
    const amount = parseFloat(val('m-amount'));
    const methodId = radioVal('m-method');
    const ref = val('m-ref').trim();
    const reason = val('m-reason').trim();
    const m = methodId ? method(methodId) : null;
    if (!(amount > 0)) return 'Enter the correct amount.';
    if (!m) return 'Choose how they paid.';
    if (m.needsRef && ref.length < 6) return 'Enter the transaction reference from the mobile money message.';
    if (m.id !== 'cash' && ref && tidyRef(ref) !== tidyRef(p.reference) && refSeen(ref, p.id)) {
      return 'This reference is already used for another payment.';
    }
    if (reason.length < 5) return 'Explain why you are making this correction. The committee will read it.';

    const { error } = await db.rpc('correct_payment', {
      p_original_id: paymentId, p_amount: round2(amount), p_method: methodId,
      p_reference: m.id === 'cash' ? null : ref, p_reason: reason
    });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast(`Correction saved. ${firstName(p.member_id)} will be asked to confirm it.`);
  });
}

async function saveDeposit(button) {
  const f = groupFacts();
  const from = radioVal('mv-from');
  const amount = parseFloat(val('mv-amount'));
  const ref = val('mv-ref').trim();
  const have = Number(from === 'momo' ? f.G.summary.momo : f.G.summary.cash);

  const errs = [];
  if (!(amount > 0)) { errs.push('Enter the amount moved.'); markField('mv-amount', true); }
  else if (amount > have + 0.001) { errs.push(`Only ${fmtK(have)} is held as ${from === 'momo' ? 'mobile money' : 'cash'}.`); markField('mv-amount', true); }
  else markField('mv-amount', false);
  if (ref.length < 3) { errs.push('Enter the deposit slip or transaction number so the committee can check it.'); markField('mv-ref', true); }
  else markField('mv-ref', false);
  showErrors('mv-errors', errs);
  if (errs.length) return;

  const done = setBusy(button, 'Saving…');
  const { error } = await db.rpc('record_deposit', {
    p_group_id: f.g.id, p_from_place: from, p_amount: round2(amount), p_reference: ref
  });
  done();
  if (error) { showErrors('mv-errors', [friendlyError(error)]); return; }

  S.screen = 'overview';
  await refreshGroup();
  window.scrollTo(0, 0);
  toast('Deposit recorded. The money is now shown in the group bank account.');
}


/* ---------- Requests and votes ---------- */

async function saveRequest(button) {
  const f = groupFacts();
  const kind = S.reqKind;
  const amount = parseFloat(val('r-amount'));
  const reason = kind === 'spending' ? val('r-reason').trim() : '';
  const avail = { bank: Number(f.G.summary.avail_bank), momo: Number(f.G.summary.avail_momo), cash: Number(f.G.summary.avail_cash) };
  const src = {};
  let total = 0;

  const errs = [];
  markField('r-amount', !(amount > 0));
  if (!(amount > 0)) errs.push('Enter the amount.');
  if (kind === 'spending') {
    markField('r-reason', reason.length < 4);
    if (reason.length < 4) errs.push('Give a clear reason for the spending.');
  }
  if (kind === 'payout' && f.G.requests.some((r) => r.kind === 'payout' && r.cycle_month === f.month && r.status !== 'rejected')) {
    errs.push(`A payout for Month ${f.month} has already been asked for.`);
  }
  ['momo', 'cash', 'bank'].forEach((k) => {
    const v = parseFloat(val('src-' + k)) || 0;
    src[k] = round2(v);
    total += v;
    if (v < 0) errs.push('Amounts cannot be negative.');
    const tooMuch = v > avail[k] + 0.001;
    markField('src-' + k, tooMuch);
    if (tooMuch) errs.push(`Only ${fmtK(avail[k])} is available in ${placeName(f, k).toLowerCase()}.`);
  });
  total = round2(total);
  if (amount > 0 && Math.abs(total - amount) > 0.001) {
    errs.push(`The amounts you are taking add up to ${fmtK(total)}, but the request is for ${fmtK(amount)}. They must match.`);
  }
  showErrors('req-errors', errs);
  if (errs.length) return;

  const done = setBusy(button, 'Sending…');
  const { error } = kind === 'payout'
    ? await db.rpc('request_payout', { p_group_id: f.g.id, p_amount: round2(amount), p_bank: src.bank, p_momo: src.momo, p_cash: src.cash })
    : await db.rpc('request_spending', { p_group_id: f.g.id, p_amount: round2(amount), p_reason: reason, p_bank: src.bank, p_momo: src.momo, p_cash: src.cash });
  done();
  if (error) { showErrors('req-errors', [friendlyError(error)]); return; }

  S.screen = 'approvals';
  await refreshGroup();
  window.scrollTo(0, 0);
  toast('Request sent. It needs 2 committee members to say yes.');
}

// After a vote, say what happened.
const voteMessage = (status, vote) =>
  status === 'approved' ? 'Approved. The request now has enough yes votes.'
  : status === 'rejected' ? 'Request rejected. No money was moved.'
  : vote === 'yes' ? 'Your yes vote is recorded. It still needs more approval.'
  : 'Your no vote is recorded.';

async function voteYes(requestId, button) {
  const done = setBusy(button, 'Saving…');
  const { data: status, error } = await db.rpc('vote_request', { p_request_id: requestId, p_vote: 'yes', p_reason: null });
  done();
  if (error) { toast(friendlyError(error)); return; }
  await refreshGroup();
  toast(voteMessage(status, 'yes'));
}

function voteNo(requestId) {
  const r = S.group.requests.find((x) => x.id === requestId);
  openModal('Reject this request?', rejectBody(r), 'Reject request', async () => {
    const { data: status, error } = await db.rpc('vote_request',
      { p_request_id: requestId, p_vote: 'no', p_reason: val('m-reason').trim() });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast(voteMessage(status, 'no'));
  }, true);
}

function askTypeChange() {
  const g = S.group.info;
  openModal('Ask to change the group type', typeChangeBody(g), 'Send for approval', async () => {
    const reason = val('m-reason').trim();
    if (reason.length < 5) return 'Please give a reason. The committee will read it before voting.';
    const { error } = await db.rpc('request_type_change', { p_group_id: g.id, p_reason: reason });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast('Request sent. The committee can vote on it in Approvals.');
  });
}


/* ---------- Loans ---------- */

// The live calculator on "Ask for a loan".
function refreshLoanCalc() {
  const box = document.getElementById('ln-calc');
  if (box && S.group) box.innerHTML = loanCalcBox(S.group.info, val('ln-amount'), Number(val('ln-months')));
}

async function saveLoan(button) {
  const f = groupFacts();
  const saved = savedBy(f, f.me.id);
  const limit = round2(saved * Number(f.g.loan_multiple));
  const avail = round2(Number(f.G.summary.avail_bank) + Number(f.G.summary.avail_momo) + Number(f.G.summary.avail_cash));
  const amount = parseFloat(val('ln-amount'));
  const months = Number(val('ln-months'));
  const purpose = val('ln-purpose').trim();

  const errs = [];
  if (!(amount > 0)) { errs.push('Enter how much you want to borrow.'); markField('ln-amount', true); }
  else if (amount > limit + 0.001) { errs.push(`The most you can borrow is ${fmtK(limit)} (${Number(f.g.loan_multiple)} × your savings of ${fmtK(saved)}).`); markField('ln-amount', true); }
  else if (amount > avail + 0.001) { errs.push(`The group only has ${fmtK(avail)} available to lend right now.`); markField('ln-amount', true); }
  else markField('ln-amount', false);
  markField('ln-purpose', purpose.length < 4);
  if (purpose.length < 4) errs.push('Say what the loan is for. The committee reads this before voting.');
  showErrors('ln-errors', errs);
  if (errs.length) return;

  const done = setBusy(button, 'Sending…');
  const { error } = await db.rpc('ask_loan', { p_group_id: f.g.id, p_amount: round2(amount), p_months: months, p_purpose: purpose });
  done();
  if (error) { showErrors('ln-errors', [friendlyError(error)]); return; }

  S.screen = 'loans';
  await refreshGroup();
  window.scrollTo(0, 0);
  toast('Loan request sent to the committee.');
}

function sendLoan(loanId) {
  const f = groupFacts();
  const l = f.G.loans.find((x) => x.id === loanId);
  openModal(`Send ${fmtK(l.amount)} to ${esc(memberName(l.member_id))}`, sendLoanBody(f, l), 'Record as sent', async () => {
    const from = radioVal('sd-from');
    const ref = val('sd-ref').trim();
    const have = Number(f.G.summary['avail_' + from]);
    if (have < Number(l.amount) - 0.001) return `Only ${fmtK(have)} is in ${placeName(f, from).toLowerCase()}. Choose another place.`;
    if (ref.length < 3) return 'Enter the transaction or slip number.';
    const { error } = await db.rpc('send_loan', { p_loan_id: loanId, p_from_place: from, p_reference: ref });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast(`Loan recorded as sent. ${firstName(l.member_id)} will be asked to confirm.`);
  });
}

async function confirmLoanReceived(loanId, button) {
  const done = setBusy(button, 'Saving…');
  const { error } = await db.rpc('confirm_loan_received', { p_loan_id: loanId });
  done();
  if (error) { toast(friendlyError(error)); return; }
  await refreshGroup();
  toast('Thank you. Receipt of the loan is confirmed.');
}

function recordRepayment(loanId) {
  const f = groupFacts();
  const l = f.G.loans.find((x) => x.id === loanId);
  const c = loanCalc(f, l);
  openModal(`Record a repayment from ${esc(memberName(l.member_id))}`, repayBody(f, l), 'Save repayment', async () => {
    const amount = parseFloat(val('m-amount'));
    const paidOn = val('m-date');
    const methodId = radioVal('m-method');
    const ref = val('m-ref').trim();
    const m = methodId ? method(methodId) : null;
    if (!(amount > 0)) return 'Enter the amount repaid.';
    if (amount > c.remaining + 0.001) return `That is more than the ${fmtK(c.remaining)} still to pay.`;
    if (!paidOn) return 'Choose the date the money was paid.';
    if (!m) return 'Choose how they paid.';
    if (m.needsRef && ref.length < 6) return 'Enter the transaction reference from the mobile money message.';
    const { error } = await db.rpc('record_repayment', {
      p_loan_id: loanId, p_amount: round2(amount), p_paid_on: paidOn, p_method: methodId,
      p_reference: m.id === 'cash' ? null : ref
    });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast(`Repayment saved. ${firstName(l.member_id)} will be asked to confirm it.`);
  });
}

async function confirmRepayment(repaymentId, button) {
  const done = setBusy(button, 'Saving…');
  const { error } = await db.rpc('answer_repayment', { p_repayment_id: repaymentId, p_answer: 'confirmed', p_reason: null });
  done();
  if (error) { toast(friendlyError(error)); return; }
  await refreshGroup();
  const r = S.group.repayments.find((x) => x.id === repaymentId);
  const loan = r && S.group.loans.find((l) => l.id === r.loan_id);
  toast(loan && loan.status === 'repaid' ? 'Thank you. The loan is now fully repaid.' : 'Thank you. The repayment is confirmed.');
}

function disputeRepayment(repaymentId) {
  const r = S.group.repayments.find((x) => x.id === repaymentId);
  openModal('What is wrong with this repayment?', repaymentDisputeBody(r), 'Mark as wrong', async () => {
    const reason = val('m-reason').trim();
    if (reason.length < 5) return 'Please explain what is wrong in a few words.';
    const { error } = await db.rpc('answer_repayment', { p_repayment_id: repaymentId, p_answer: 'disputed', p_reason: reason });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast('Marked as disputed. The committee can now see it.');
  }, true);
}

function correctRepayment(repaymentId) {
  const r = S.group.repayments.find((x) => x.id === repaymentId);
  openModal('Fix with a correction', repaymentCorrectionBody(r), 'Save correction', async () => {
    const amount = parseFloat(val('m-amount'));
    const methodId = radioVal('m-method');
    const ref = val('m-ref').trim();
    const reason = val('m-reason').trim();
    const m = methodId ? method(methodId) : null;
    if (!(amount > 0)) return 'Enter the correct amount.';
    if (!m) return 'Choose how they paid.';
    if (m.needsRef && ref.length < 6) return 'Enter the transaction reference from the mobile money message.';
    if (reason.length < 5) return 'Explain why you are making this correction. The committee will read it.';
    const { error } = await db.rpc('correct_repayment', {
      p_original_id: repaymentId, p_amount: round2(amount), p_method: methodId,
      p_reference: m.id === 'cash' ? null : ref, p_reason: reason
    });
    if (error) return friendlyError(error);
    await refreshGroup();
    toast('Correction saved. The borrower will be asked to confirm it.');
  });
}


/* ---------- Buttons ---------- */

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || !db) return;
  const action = button.dataset.action;

  switch (action) {
    case 'home':
      if (S.user) await openHome();
      break;

    case 'logout':
      await db.auth.signOut();
      break;

    case 'auth-tab':
      S.authTab = button.dataset.tab;
      render(true);
      break;

    case 'open-group':
      await openGroup(button.dataset.id);
      break;

    case 'new-group':
      S.draft = newDraft();
      go('create');
      break;

    case 'cg-add': {
      syncDraft();
      if (S.draft.members.length >= MAX_MEMBERS[S.draft.type]) break;
      S.draft.members.push({ full_name: '', phone: '', role: 'member', is_me: false });
      render(true);
      const input = document.getElementById('cm-name-' + (S.draft.members.length - 1));
      if (input) input.focus();
      break;
    }

    case 'cg-remove':
      syncDraft();
      S.draft.members.splice(Number(button.dataset.i), 1);
      render(true);
      break;

    case 'save-group':
      await saveGroup(button);
      break;

    case 'join':
      S.join = { code: '', preview: null };
      go('join');
      break;

    case 'join-save':
      await joinGroup(button);
      break;

    // Group menu and links between group screens
    case 'go':
      if (button.dataset.tab) S.payTab = button.dataset.tab;
      if (button.dataset.screen === 'request') S.reqKind = null;
      go(button.dataset.screen);
      break;

    case 'pay-receiver':
      S.reqKind = 'payout';
      go('request');
      break;

    case 'save-request':
      await saveRequest(button);
      break;

    case 'vote-yes':
      await voteYes(button.dataset.id, button);
      break;

    case 'vote-no':
      voteNo(button.dataset.id);
      break;

    case 'ask-type':
      askTypeChange();
      break;

    // Loans
    case 'save-loan':
      await saveLoan(button);
      break;

    case 'loan-send':
      sendLoan(button.dataset.id);
      break;

    case 'loan-received':
      await confirmLoanReceived(button.dataset.id, button);
      break;

    case 'loan-repay':
      recordRepayment(button.dataset.id);
      break;

    case 'rp-confirm':
      await confirmRepayment(button.dataset.id, button);
      break;

    case 'rp-dispute':
      disputeRepayment(button.dataset.id);
      break;

    case 'rp-correct':
      correctRepayment(button.dataset.id);
      break;

    case 'pay-tab':
      S.payTab = button.dataset.tab;
      render(true);
      break;

    case 'save-payment':
      await savePayment(button);
      break;

    case 'pay-confirm':
      await confirmPayment(button.dataset.id, button);
      break;

    case 'pay-dispute':
      disputePayment(button.dataset.id);
      break;

    case 'pay-correct':
      correctPayment(button.dataset.id);
      break;

    case 'save-deposit':
      await saveDeposit(button);
      break;

    // Pop-up box
    case 'modal-close':
      closeModal();
      break;

    case 'modal-bg':
      if (event.target === button) closeModal();   // only a click on the dark background
      break;

    case 'modal-save':
      await saveModal(button);
      break;

    case 'copy-code':
      try {
        await navigator.clipboard.writeText(S.group.info.invite_code);
        toast('Invite code copied. Paste it into a WhatsApp message to your members.');
      } catch (e) {
        toast('Could not copy. The code is ' + S.group.info.invite_code + '.');
      }
      break;
  }
});

// Forms: pressing Enter or the main button.
document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'auth-form') submitAuth();
  if (event.target.id === 'join-form') findInvite();
});

// Choosing Chilimba or Village Banking redraws the form (the fields are different).
document.addEventListener('change', (event) => {
  const t = event.target;
  if (t.name === 'cg-type' && S.draft) {
    syncDraft();
    S.draft.type = t.value;
    render(true);
  }
  if (t.name === 'f-method') updateRefField('f', t.value);
  if (t.name === 'm-method') updateRefField('m', t.value);
  if (t.id === 'pay-month') { S.payMonth = t.value; render(true); }
  if (t.name === 'r-kind') { S.reqKind = t.value; render(true); }
  if (t.id === 'ln-months') refreshLoanCalc();
});

// Typing an amount on "Ask for a loan" updates the calculator straight away.
document.addEventListener('input', (event) => {
  if (event.target.id === 'ln-amount') refreshLoanCalc();
});
