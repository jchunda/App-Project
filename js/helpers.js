/* =====================================================================
   Usambazi: js/helpers.js
   Small tools used everywhere: names of things, money and date
   formatting, icons, messages. Loaded before screens.js and app.js,
   so everything here is available to them.
   ===================================================================== */
'use strict';

/* ---------- Names of things ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ROLE = {
  chair: 'Chairperson', vice: 'Vice Chairperson', treasurer: 'Treasurer',
  comms: 'Communications', rep: 'Member representative', member: 'Member'
};
const ROLE_ORDER = ['chair', 'vice', 'treasurer', 'comms', 'rep', 'member'];
const TYPE = { chilimba: 'Chilimba', village: 'Village Banking' };

// Group rules from CLAUDE.md section 4 (the database checks them too).
const MAX_MEMBERS = { chilimba: 20, village: 35 };
const MIN_MEMBERS = 5;
const MIN_COMMITTEE = 4;

// Ways of paying. "place" is where the money ends up.
const METHODS = [
  { id: 'airtel', label: 'Airtel Money',  place: 'momo', needsRef: true,  hint: 'Copy it from the Airtel Money message, e.g. MP261003.0914.A47215' },
  { id: 'mtn',    label: 'MTN MoMo',      place: 'momo', needsRef: true,  hint: 'Copy it from the MTN MoMo message, e.g. 4471029385' },
  { id: 'zamtel', label: 'Zamtel Kwacha', place: 'momo', needsRef: true,  hint: 'Copy it from the Zamtel Kwacha message, e.g. ZK20481937' },
  { id: 'cash',   label: 'Cash',          place: 'cash', needsRef: false, hint: '' },
  { id: 'bank',   label: 'Bank',          place: 'bank', needsRef: false, hint: 'The number on the bank deposit slip (optional).' }
];
const method = (id) => METHODS.find((m) => m.id === id);

// What a village banking payment is for.
const KINDS = { saving: 'Saving', fee: 'Fee', fine: 'Fine' };

// "Month 4 (January 2027)"
const mLabel = (group, month) => 'Month ' + month + ' (' + monthLabel(group, month) + ')';


/* ---------- Text and numbers ---------- */

// Make text safe to put inside HTML (so a name like "<b>" can't break the page).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Round to the ngwee (2 decimal places).
const round2 = (n) => Math.round(n * 100) / 100;

// 4000 -> "K4,000", 1234.5 -> "K1,234.50"
function fmtK(n) {
  const v = round2(Number(n) || 0);
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + 'K' + a.toLocaleString('en-US',
    { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// plural(1, 'member', 'members') -> "1 member"
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);


/* ---------- Dates and the cycle ---------- */

const pad2 = (n) => String(n).padStart(2, '0');

// "2026-10-01" -> a Date for 1 October 2026 (read by hand so time zones can't shift it).
function parseDay(text) {
  const [y, m, d] = String(text).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A Date -> "2026-10-01", the way the database stores dates.
const toDayText = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

const fmtDate = (d) => d.getDate() + ' ' + SHORT_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
const fmtDateTime = (d) => fmtDate(d) + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

// Which month of the cycle is it today? Month 1 is the group's start month.
// Less than 1 means the cycle hasn't started yet.
function cycleMonth(group, today) {
  const start = parseDay(group.start_month);
  const now = today || new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
}

// Month 3 of a cycle starting October 2026 -> "December 2026"
function monthLabel(group, month) {
  const start = parseDay(group.start_month);
  const d = new Date(start.getFullYear(), start.getMonth() + month - 1, 1);
  return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// "Month 4 of 8, January 2027", or a note if it hasn't started or has ended.
function cycleText(group) {
  const m = cycleMonth(group);
  if (m < 1) return 'Starts in ' + monthLabel(group, 1);
  if (m > group.cycle_months) return 'Cycle ended in ' + monthLabel(group, group.cycle_months);
  return 'Month ' + m + ' of ' + group.cycle_months + ', ' + monthLabel(group, m);
}


/* ---------- Icons (simple line drawings, same as the prototype) ---------- */

const ICONS = {
  back:    '<path d="M15 5l-7 7 7 7"/>',
  lock:    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people:  '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6c2 .7 3.2 2.5 3.5 5.4"/>',
  home:    '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye:     '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = (name) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';


/* ---------- Status pills: always a symbol and words, never colour alone ---------- */

const PILLS = {
  joined:    ['ok',   '✓', 'Has joined'],
  notjoined: ['none', '–', 'Not joined yet'],
  confirmed: ['ok',   '✓', 'Confirmed'],
  waiting:   ['wait', '…', 'Waiting for confirmation'],
  disputed:  ['bad',  '!', 'Disputed'],
  notpaid:   ['none', '–', 'Not paid yet'],
  corrected: ['none', '↺', 'Replaced by a correction']
};

// A small note with an eye symbol, used to explain privacy rules.
const privacyNote = (text) => '<p class="lock-note">' + icon('eye') + '<span>' + esc(text) + '</span></p>';
function pill(kind, text) {
  const [cls, symbol, words] = PILLS[kind];
  return '<span class="pill ' + cls + '"><span aria-hidden="true">' + symbol + '</span>' +
         esc(text || words) + '</span>';
}


/* ---------- Messages ---------- */

// A short message at the bottom of the screen that disappears by itself.
let toastTimer = null;
function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

// Show a list of things to fix in a box (or clear the box if the list is empty).
function showErrors(boxId, list) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = list.length
    ? '<div class="errors" role="alert">Please fix ' + (list.length === 1 ? 'this' : 'these') +
      ' first:<ul>' + list.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>'
    : '';
  if (list.length) box.scrollIntoView({ block: 'center' });
}

// Turn Supabase's technical error messages into plain, helpful ones.
function friendlyError(error) {
  const msg = String((error && error.message) || error || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach Supabase. Check your internet connection. ' +
           'If the project has not been used for a week, it may be paused: restore it in the Supabase website.';
  }
  if (error && error.code === 'PGRST202') {
    return 'The database is missing a function. Run the latest sql/02_security.sql and sql/03_functions.sql in the Supabase SQL Editor.';
  }
  if (/invalid api key|no api key/i.test(msg)) return 'The key in config.js looks wrong. Open check.html to test it.';
  if (/invalid login credentials/i.test(msg)) return 'The email or password is wrong. Check both and try again.';
  if (/already registered|already been registered/i.test(msg)) return 'This email already has an account. Choose "Log in" instead.';
  if (/password.*at least/i.test(msg)) return 'The password is too short. Use at least 6 characters.';
  if (/email not confirmed/i.test(msg)) return 'This email has not been confirmed yet. Look for the confirmation email, or turn off "Confirm email" in Supabase for testing.';
  if (/invalid format|valid email/i.test(msg)) return 'That email address does not look right. Check it and try again.';
  if (/rate limit/i.test(msg)) return 'Too many tries in a short time. Wait a few minutes, then try again.';
  // Our own database functions already write plain messages, so show them as they are.
  return msg || 'Something went wrong. Please try again.';
}


/* ---------- Reading forms ---------- */

const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
const radioVal = (name) => { const e = document.querySelector('input[name="' + name + '"]:checked'); return e ? e.value : ''; };

// Mark a field red (bad = true) or normal (bad = false).
const markField = (id, bad) => { const e = document.getElementById(id); if (e) e.setAttribute('aria-invalid', bad ? 'true' : 'false'); };

// While waiting for the database: disable a button and change its words.
function setBusy(button, busyText) {
  if (!button) return () => {};
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => { button.disabled = false; button.textContent = oldText; };
}


/* ---------- Pop-up box (modal) ---------- */
// openModal shows a box over the screen with a Cancel and a Save button.
// onSave runs when Save is pressed. It may return (or resolve to) a
// message, which is shown in the box; otherwise the box closes.
let modalSave = null;
let modalLastFocus = null;

function openModal(title, bodyHtml, saveLabel, onSave, danger) {
  modalLastFocus = document.activeElement;
  modalSave = onSave;
  document.getElementById('modal-root').innerHTML =
    '<div class="overlay" data-action="modal-bg"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
    '<h2 id="modal-title">' + title + '</h2>' + bodyHtml + '<div id="modal-errors"></div>' +
    '<div class="dialog-actions"><button type="button" class="btn ghost" data-action="modal-close">Cancel</button>' +
    '<button type="button" class="btn' + (danger ? ' danger' : '') + '" data-action="modal-save">' + saveLabel + '</button></div>' +
    '</div></div>';
  const first = document.querySelector('#modal-root input:not([type=radio]), #modal-root textarea, #modal-root select');
  (first || document.querySelector('#modal-root .btn')).focus();
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  modalSave = null;
  if (modalLastFocus && document.body.contains(modalLastFocus)) modalLastFocus.focus();
}

async function saveModal(button) {
  if (!modalSave) return;
  const done = setBusy(button, 'Saving…');
  const problem = await modalSave();
  done();
  if (problem) {
    document.getElementById('modal-errors').innerHTML = '<div class="errors" role="alert">' + esc(problem) + '</div>';
  } else {
    closeModal();
  }
}

// Pressing Escape closes the box.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalSave) closeModal();
});
