/* =====================================================================
   Usambazi: check.js
   Connection check page (check.html). Use it to troubleshoot
   the Supabase setup. The real app is index.html.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Small helpers ---------- */

  const $ = (id) => document.getElementById(id);

  // Show the result of one check: kind is 'ok', 'bad' or 'wait'.
  function setCheck(id, kind, label, detail) {
    const row = $(id);
    const symbol = { ok: '✓', bad: '✗', wait: '…' }[kind];
    const pill = row.querySelector('.pill');
    pill.className = 'pill ' + kind;
    pill.textContent = symbol + ' ' + label;
    row.querySelector('.detail').textContent = detail || '';
  }

  // Show a message under the login form. kind is 'ok', 'bad' or 'info'.
  function showMessage(kind, text) {
    const box = $('auth-message');
    box.className = 'note ' + kind;
    box.textContent = text;
  }

  // Turn Supabase's technical error messages into plain, helpful ones.
  function friendlyError(error) {
    const msg = String((error && error.message) || error || '');
    if (/failed to fetch|network|load failed/i.test(msg)) {
      return 'Could not reach Supabase. Check your internet connection and the URL in config.js. ' +
             'If the project has not been used for a week, it may be paused: restore it in the Supabase website.';
    }
    if (/invalid api key|no api key|jwt/i.test(msg)) {
      return 'The key in config.js looks wrong. Copy the publishable (or anon public) key again from Supabase.';
    }
    if (/invalid login credentials/i.test(msg)) return 'The email or password is wrong. Check both and try again.';
    if (/already registered|already been registered/i.test(msg)) return 'This email already has an account. Press "Log in" instead.';
    if (/password.*at least/i.test(msg)) return 'The password is too short. Use at least 6 characters.';
    if (/email not confirmed/i.test(msg)) return 'This email has not been confirmed. Turn off "Confirm email" in Supabase for testing, then sign up again with a new email.';
    if (/invalid format|valid email/i.test(msg)) return 'That email address does not look right. Check it and try again.';
    if (/rate limit/i.test(msg)) return 'Too many tries in a short time. Wait a few minutes, then try again.';
    return 'Something went wrong: ' + msg;
  }


  /* ---------- Check 1: are the keys filled in? ---------- */

  function checkKeys() {
    if (typeof window.supabase === 'undefined') {
      setCheck('check-keys', 'bad', 'Problem',
        'The Supabase library did not load. Check your internet connection, then refresh the page.');
      return false;
    }
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_KEY === 'undefined') {
      setCheck('check-keys', 'bad', 'Problem', 'config.js did not load. Make sure it is in the same folder as index.html.');
      return false;
    }
    if (/PASTE-YOUR/.test(SUPABASE_URL) || /PASTE-YOUR/.test(SUPABASE_KEY)) {
      setCheck('check-keys', 'bad', 'Not filled in',
        'Open config.js and paste your Project URL and public key from Supabase.');
      return false;
    }
    if (/\.supabase\.co\/.+/i.test(SUPABASE_URL.trim())) {
      setCheck('check-keys', 'bad', 'Problem',
        'The URL in config.js has extra text after ".supabase.co" (for example /rest/v1/). Delete everything after ".supabase.co".');
      return false;
    }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL.trim())) {
      setCheck('check-keys', 'bad', 'Problem',
        'The URL in config.js looks wrong. It should look like https://abcdefghijkl.supabase.co');
      return false;
    }
    if (/service_role|sb_secret_/i.test(SUPABASE_KEY)) {
      setCheck('check-keys', 'bad', 'Wrong key',
        'This is the secret key. Remove it now and use the publishable (or anon public) key instead.');
      return false;
    }
    setCheck('check-keys', 'ok', 'Keys found', 'config.js has a URL and a public key.');
    return true;
  }

  if (!checkKeys()) {
    setCheck('check-db', 'bad', 'Not checked', 'Fix the keys first.');
    setCheck('check-login', 'bad', 'Not checked', 'Fix the keys first.');
    $('auth-section').classList.add('hidden');
    return;
  }

  // The connection to Supabase, used everywhere in the app.
  const db = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim());


  /* ---------- Check 2: does the database answer? ---------- */

  async function checkDatabase() {
    const { data, error } = await db.rpc('usambazi_ping');
    if (error) {
      if (error.code === 'PGRST202') {
        setCheck('check-db', 'bad', 'Not set up', 'The database answered, but the test function is missing. Run sql/03_functions.sql in the SQL Editor.');
      } else {
        setCheck('check-db', 'bad', 'Problem', friendlyError(error));
      }
      return;
    }
    if (data === 'ok') setCheck('check-db', 'ok', 'Database connected', 'The database answered.');
    else setCheck('check-db', 'bad', 'Problem', 'The database gave an unexpected answer.');
  }


  /* ---------- Check 3: login ---------- */

  // Show the right section for the logged-in person (or nobody).
  async function showUser(user) {
    if (!user) {
      $('user-section').classList.add('hidden');
      $('auth-section').classList.remove('hidden');
      setCheck('check-login', 'wait', 'Not logged in', 'Sign up or log in below to test it.');
      return;
    }

    $('auth-section').classList.add('hidden');
    $('user-section').classList.remove('hidden');

    // Read your own profile. This also tests the security rules:
    // you can only ever read your own row.
    const { data: profile, error } = await db
      .from('profiles').select('full_name').eq('id', user.id).maybeSingle();

    const name = profile && profile.full_name ? profile.full_name : '(no name)';
    $('user-info').textContent = 'Logged in as ' + name + ' (' + user.email + ').';

    if (error) {
      setCheck('check-login', 'bad', 'Problem', friendlyError(error));
    } else if (!profile) {
      setCheck('check-login', 'bad', 'No profile',
        'You are logged in, but no profile row was made. Run sql/03_functions.sql, then sign up again with a new email.');
    } else {
      setCheck('check-login', 'ok', 'Login works', 'Your profile was found in the database.');
    }
  }

  // Read the form and check it before sending anything.
  function readForm(isSignUp) {
    const email = $('email').value.trim();
    const password = $('password').value;
    const fullName = $('full-name').value.trim();
    if (isSignUp && fullName.length < 2) return { problem: 'Type your full name to sign up.' };
    if (!email) return { problem: 'Type your email address.' };
    if (password.length < 6) return { problem: 'The password must have at least 6 characters.' };
    return { email, password, fullName };
  }

  function setBusy(busy) {
    $('login-btn').disabled = busy;
    $('signup-btn').disabled = busy;
  }

  // Log in
  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = readForm(false);
    if (form.problem) return showMessage('bad', form.problem);

    setBusy(true);
    showMessage('info', 'Logging in…');
    const { error } = await db.auth.signInWithPassword({ email: form.email, password: form.password });
    setBusy(false);
    if (error) showMessage('bad', friendlyError(error));
    else $('auth-message').className = 'note hidden';
  });

  // Sign up
  $('signup-btn').addEventListener('click', async () => {
    const form = readForm(true);
    if (form.problem) return showMessage('bad', form.problem);

    setBusy(true);
    showMessage('info', 'Creating your account…');
    const { data, error } = await db.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.fullName } }   // used by the profile trigger
    });
    setBusy(false);

    if (error) return showMessage('bad', friendlyError(error));
    if (!data.session) {
      // Supabase made the account but wants the email confirmed first.
      showMessage('info', 'Account created, but Supabase wants the email confirmed first. ' +
        'For testing, turn off "Confirm email" in Supabase, then sign up again with a different email.');
      return;
    }
    $('auth-message').className = 'note hidden';
  });

  // Log out
  $('logout-btn').addEventListener('click', async () => {
    await db.auth.signOut();
  });

  // Runs whenever someone logs in or out (and once when the page opens).
  // setTimeout lets Supabase finish its own work before we ask it more.
  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => showUser(session ? session.user : null), 0);
  });


  /* ---------- Start ---------- */
  checkDatabase();
})();
