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
  back:   '<path d="M15 5l-7 7 7 7"/>',
  lock:   '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6c2 .7 3.2 2.5 3.5 5.4"/>'
};
const icon = (name) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';


/* ---------- Status pills: always a symbol and words, never colour alone ---------- */

const PILLS = {
  joined:    ['ok',   '✓', 'Has joined'],
  notjoined: ['none', '–', 'Not joined yet']
};
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
