/* ==========================================================================
   Ciudadano Ready | shared front-end behavior
   Language toggle, mobile nav, accordion, quiz interactions.
   ========================================================================== */

// ---- Reduced-motion-aware scrolling -------------------------------------
// CSS transitions already respect prefers-reduced-motion via the media
// query in styles.css, but the handful of places that trigger a JS-driven
// smooth scroll (window.scrollTo / el.scrollIntoView) pass behavior:'smooth'
// directly, which bypasses that CSS rule. These two helpers are drop-in
// replacements used across app.js/member.js/admin.js so every scroll site
// honors the same OS-level setting.
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function smoothScrollTo(opts) {
  window.scrollTo(Object.assign({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }, opts));
}
function smoothScrollIntoView(el, opts) {
  if (!el) return;
  el.scrollIntoView(Object.assign({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }, opts));
}
window.prefersReducedMotion = prefersReducedMotion;
window.smoothScrollTo = smoothScrollTo;
window.smoothScrollIntoView = smoothScrollIntoView;

// ---- Session-validity watchdog (single-session-per-account enforcement) --
// Pairs with the revoke-other-sessions edge function called at login: when
// an account signs in somewhere else, this session's refresh token gets
// invalidated there. auth.getUser() is a live round-trip to Supabase's
// server (unlike auth.getSession(), which just reads the local, possibly
// stale copy), so it's the one that actually notices a revoked session.
// Checked on load, on an interval, and whenever the tab regains focus, so
// a signed-out-elsewhere session gets bounced to login within a couple of
// minutes instead of silently failing at its next token refresh (which can
// take up to an hour).
function startSessionWatchdog() {
  const CHECK_INTERVAL_MS = 2 * 60 * 1000;
  let checking = false;
  async function check() {
    if (checking || typeof supabaseClient === 'undefined') return;
    checking = true;
    try {
      const { data, error } = await supabaseClient.auth.getUser();
      if (error || !data || !data.user) {
        await supabaseClient.auth.signOut();
        const loginPath = document.body.hasAttribute('data-admin-required') ? '/login.html' : 'login.html';
        window.location.href = loginPath + '?reason=session-revoked';
      }
    } catch (e) {
      // Network hiccup while checking is not evidence the session was
      // actually revoked, so this deliberately does nothing on error.
    } finally {
      checking = false;
    }
  }
  setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

// ---- Client-side error logging (in-house, no 3rd-party service) --------
// Catches uncaught errors and unhandled promise rejections on every page
// and logs them to client_error_log so problems surface in the admin
// panel instead of only being discovered when a user emails support.
// Fire-and-forget: never blocks or throws on top of the error it's
// reporting, and silently no-ops if it can't reach Supabase.
function logClientError(details) {
  try {
    if (typeof supabaseClient === 'undefined') return;
    supabaseClient.from('client_error_log').insert({
      page: location.pathname,
      message: String((details && details.message) || 'Unknown error').slice(0, 2000),
      source: String((details && details.source) || '').slice(0, 500),
      lineno: (details && details.lineno) || null,
      colno: (details && details.colno) || null,
      stack: String((details && details.stack) || '').slice(0, 4000),
      user_agent: (navigator.userAgent || '').slice(0, 500),
    }).then(() => {}, () => {});
  } catch (e) { /* never let logging itself throw */ }
}
window.addEventListener('error', (event) => {
  logClientError({
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error && event.error.stack,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  logClientError({
    message: (reason && reason.message) || String(reason),
    stack: reason && reason.stack,
  });
});

// ---- Language toggle -------------------------------------------------
// Every translatable element carries data-en="..." and data-es="...".
// Buttons with [data-lang-btn] switch which copy is shown.
function setLang(lang) {
  document.querySelectorAll('[data-en]').forEach((el) => {
    const text = el.getAttribute('data-' + lang);
    if (text !== null) el.textContent = text;
  });
  document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-lang-btn') === lang);
  });
  document.documentElement.setAttribute('lang', lang);
  try { localStorage.setItem('ciudadanoready-lang', lang); } catch (e) {}
  // Let dynamically-rendered content (lesson/quiz text pulled from the
  // database, built by member.js) know it should re-render in the new
  // language without needing a full page reload.
  window.dispatchEvent(new CustomEvent('ciudadanoready:langchange', { detail: { lang } }));
}

// Returns the currently active site language ('en' or 'es'), restoring
// whatever the visitor last picked so it persists across page loads.
function getCurrentLang() {
  try {
    const saved = localStorage.getItem('ciudadanoready-lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch (e) {}
  return 'en';
}
window.getCurrentLang = getCurrentLang;

// ---- Dark mode (member area) ------------------------------------------
// The actual "apply before paint" logic lives in a tiny inline script in
// each member page's <head> (avoids a flash of the light theme), this is
// just the toggle button wiring + shared helpers used after that.
function getStoredTheme() {
  try {
    const saved = localStorage.getItem('ciudadanoready-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch (e) {}
  return 'light';
}
window.getStoredTheme = getStoredTheme;

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  try { localStorage.setItem('ciudadanoready-theme', theme); } catch (e) {}
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });
  document.querySelectorAll('[data-theme-radio]').forEach((input) => {
    const isMatch = input.getAttribute('data-theme-radio') === theme;
    input.checked = isMatch;
    const wrap = input.closest('.theme-option-btn');
    if (wrap) wrap.classList.toggle('checked', isMatch);
  });
  window.dispatchEvent(new CustomEvent('ciudadanoready:themechange', { detail: { theme } }));
}
window.setTheme = setTheme;

function toggleTheme() {
  setTheme(getStoredTheme() === 'dark' ? 'light' : 'dark');
}
window.toggleTheme = toggleTheme;

// ---- Stripe checkout / billing portal helpers ---------------------------
// Used by dashboard.html's billing banner (resubscribe / upgrade), and now
// also by the signup flow below right after the new account is created;
// both paths land here once there's a real, signed-in Supabase session.
window.startCheckoutRedirect = async function startCheckoutRedirect(plan, buttonEl) {
  if (typeof supabaseClient === 'undefined') return;
  const original = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Redirecting to checkout…';
  }
  try {
    const { data, error } = await supabaseClient.functions.invoke('create-checkout-session', {
      body: { plan: plan },
    });
    if (error || !data || !data.url) {
      throw new Error((data && data.error) || (error && error.message) || 'Could not start checkout.');
    }
    window.location.href = data.url;
  } catch (err) {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
    alert((err && err.message) || 'Something went wrong starting checkout. Please try again.');
  }
};

window.openBillingPortal = async function openBillingPortal(buttonEl) {
  if (typeof supabaseClient === 'undefined') return;
  const original = buttonEl ? buttonEl.textContent : null;
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Opening billing portal…';
  }
  try {
    const { data, error } = await supabaseClient.functions.invoke('create-billing-portal-session', {});
    if (error || !data || !data.url) {
      throw new Error((data && data.error) || (error && error.message) || 'Could not open billing portal.');
    }
    window.location.href = data.url;
  } catch (err) {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
    alert((err && err.message) || 'Something went wrong opening the billing portal. Please try again.');
  }
};

// ---- Skip-to-content link (accessibility) ------------------------------
// Every page gets this injected as the very first element in <body>,
// rather than hand-added to 30+ HTML files: it's off-screen until it
// receives keyboard focus (see .skip-link in styles.css), then jumps
// into view so keyboard/screen-reader users can bypass the header or
// sidebar nav instead of tabbing through every link first. Also doubles
// as the one place that guarantees every page has a "main" landmark:
// member/admin pages already have a real <main>, but the public
// marketing pages don't wrap their content in one, so this adds
// role="main" to whichever content container it finds, only when there
// isn't a real <main> already on the page (never nest two main landmarks).
function insertSkipLink() {
  if (document.querySelector('.skip-link')) return;
  let target = document.querySelector('.app-content') || document.querySelector('main');
  if (!target) {
    const header = document.querySelector('header');
    target = (header && header.nextElementSibling) || document.querySelector('section') || document.body.firstElementChild;
  }
  if (!target) return;
  if (!target.id) target.id = 'main-content';
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  if (!target.closest('main') && !target.hasAttribute('role')) target.setAttribute('role', 'main');

  const link = document.createElement('a');
  link.href = '#' + target.id;
  link.className = 'skip-link';
  link.setAttribute('data-en', 'Skip to main content');
  link.setAttribute('data-es', 'Saltar al contenido principal');
  link.textContent = 'Skip to main content';
  document.body.insertBefore(link, document.body.firstChild);
}

document.addEventListener('DOMContentLoaded', () => {
  insertSkipLink();

  // Restore whichever language the visitor picked last time, so it
  // persists across pages instead of resetting to English on every load.
  setLang(getCurrentLang());

  document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang-btn')));
  });

  // ---- Dark mode toggle button(s) --------------------------------------
  // The <html data-theme> attribute is already set by the inline no-flash
  // script in <head> before this runs, just sync the button icon(s) to
  // match and wire clicks.
  if (document.querySelector('.theme-toggle-btn') || document.querySelector('[data-theme-radio]')) {
    setTheme(getStoredTheme());
  }
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });
  document.querySelectorAll('[data-theme-radio]').forEach((input) => {
    input.addEventListener('change', () => { if (input.checked) setTheme(input.getAttribute('data-theme-radio')); });
  });

  // ---- Mobile nav toggle ----------------------------------------------
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
    });
  }

  // ---- Mobile sidebar toggle (dashboard / course / admin) --------------
  const sidebarToggle = document.querySelector('.app-sidebar-toggle');
  const appSidebar = document.querySelector('.app-sidebar');
  const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
  const closeSidebar = () => {
    if (appSidebar) appSidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
  };
  if (sidebarToggle && appSidebar) {
    sidebarToggle.addEventListener('click', () => {
      appSidebar.classList.toggle('open');
      if (sidebarBackdrop) sidebarBackdrop.classList.toggle('open');
    });
  }
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
  if (appSidebar) {
    appSidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeSidebar));
  }

  // ---- Member-area auth guard (dashboard + lesson pages) ---------------
  // Any page marked data-auth-required bounces signed-out visitors to login.
  if (document.body.hasAttribute('data-auth-required') && typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = 'login.html';
        return;
      }
      startSessionWatchdog();
    });
  }

  // ---- Admin guard (admin/index.html only) -------------------------------
  // Signed-out visitors bounce to login; signed-in non-admins bounce to
  // their own dashboard instead of seeing the admin panel.
  // Absolute paths here on purpose, this page lives one folder deep at /admin.
  if (document.body.hasAttribute('data-admin-required') && typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login.html';
        return;
      }
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (!profile || profile.role !== 'admin') {
        window.location.href = '/dashboard.html';
      } else {
        startSessionWatchdog();
      }
    });
  }

  // ---- Dashboard auth guard (redirects to login if not signed in) -----
  const dashboardNameEl = document.querySelector('#dashboard-user-name');
  const logoutLink = document.querySelector('#logout-link');
  if (dashboardNameEl && typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = 'login.html';
        return;
      }
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .single();
      dashboardNameEl.textContent = (profile && profile.full_name) || session.user.email;
    });
  }
  if (logoutLink && typeof supabaseClient !== 'undefined') {
    logoutLink.addEventListener('click', async (event) => {
      event.preventDefault();
      await supabaseClient.auth.signOut();
      window.location.href = 'index.html';
    });
  }

  // ---- "Signed out elsewhere" notice (set by the session watchdog) -----
  const loginNoticeEl = document.querySelector('#login-notice');
  if (loginNoticeEl && new URLSearchParams(window.location.search).get('reason') === 'session-revoked') {
    loginNoticeEl.style.display = 'block';
  }

  // ---- Login (real Supabase auth) --------------------------------------
  const loginForm = document.querySelector('#login-form');
  if (loginForm && typeof supabaseClient !== 'undefined') {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const btn = document.querySelector('#login-submit');
      const errorEl = document.querySelector('#login-error');
      const original = btn.textContent;
      if (errorEl) errorEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Logging in…';

      const email = document.querySelector('#login-email').value;
      const password = document.querySelector('#login-password').value;
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        btn.disabled = false;
        btn.textContent = original;
        if (errorEl) {
          errorEl.textContent = error.message || 'Could not log in with those details.';
          errorEl.style.display = 'block';
        }
        return;
      }

      // One active session per account: signing in here silently signs the
      // account out everywhere else. Best-effort — if this call fails
      // (network hiccup, function briefly down) we still let this login
      // proceed rather than blocking the person from getting in.
      try {
        await supabaseClient.functions.invoke('revoke-other-sessions', { body: {} });
      } catch (revokeErr) {
        if (typeof logClientError === 'function') {
          logClientError({ message: 'revoke-other-sessions failed: ' + (revokeErr && revokeErr.message) });
        }
      }

      // Admins land in the admin panel; everyone else goes to their dashboard.
      let destination = 'dashboard.html';
      if (data && data.user) {
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .single();
        if (profile && profile.role === 'admin') destination = '/admin';
      }
      window.location.href = destination;
    });
  }

  // ---- Contact form (writes to Supabase contact_submissions) ----------
  // Two lightweight, no-external-service spam checks that run before the
  // real insert: a honeypot field a script filling every input will trip,
  // and a minimum time-on-page (a form submitted faster than a human could
  // plausibly read + type it is almost certainly automated). Both fail
  // silently, the bot sees the same "Sent ✓" a real visitor would, so
  // there's no error response telling it to adapt.
  const contactForm = document.querySelector('#contact-form');
  if (contactForm && typeof supabaseClient !== 'undefined') {
    const contactFormLoadedAt = Date.now();
    const MIN_SECONDS_BEFORE_SUBMIT = 3;

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = document.querySelector('#contact-submit');
      const errorEl = document.querySelector('#contact-error');
      const original = submitBtn.textContent;
      if (errorEl) errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      const honeypot = document.querySelector('#contact-company');
      const tooFast = (Date.now() - contactFormLoadedAt) / 1000 < MIN_SECONDS_BEFORE_SUBMIT;
      const looksLikeBot = (honeypot && honeypot.value.trim() !== '') || tooFast;

      if (looksLikeBot) {
        setTimeout(() => {
          submitBtn.textContent = 'Sent ✓';
          contactForm.reset();
        }, 400);
        return;
      }

      const { error } = await supabaseClient.from('contact_submissions').insert({
        name: document.querySelector('#contact-name').value,
        email: document.querySelector('#contact-email').value,
        subject: document.querySelector('#contact-subject').value,
        message: document.querySelector('#contact-message').value,
      });

      if (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
        if (errorEl) {
          errorEl.textContent = 'Something went wrong sending your message. Please try again.';
          errorEl.style.display = 'block';
        }
        return;
      }
      submitBtn.textContent = 'Sent ✓';
      contactForm.reset();
    });
  }

  // ---- Hero flag background (waves; fades out on scroll) ----------------
  const heroFlagBg = document.querySelector('.hero-flag-bg');
  const heroSection = document.querySelector('.hero');
  if (heroFlagBg && heroSection) {
    const baseOpacity = 0.16;
    const updateFlagOpacity = () => {
      const heroHeight = heroSection.offsetHeight;
      const scrolled = Math.min(Math.max(window.scrollY, 0), heroHeight);
      const ratio = 1 - scrolled / heroHeight;
      heroFlagBg.style.opacity = String(Math.max(ratio, 0) * baseOpacity);
    };
    updateFlagOpacity();
    window.addEventListener('scroll', updateFlagOpacity, { passive: true });
    window.addEventListener('resize', updateFlagOpacity);

    // Respect reduced-motion preference by freezing the SMIL wave animation.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      heroFlagBg.querySelectorAll('animate').forEach((anim) => {
        if (typeof anim.setAttribute === 'function') anim.setAttribute('repeatCount', '0');
      });
    }
  }

  // ---- Password show/hide toggle -----------------------------------------
  // Auto-applies to every password field on the page, no per-page markup needed.
  const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a20.5 20.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'password-field-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle-btn';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = EYE_ICON;
    wrap.appendChild(btn);

    btn.addEventListener('click', () => {
      const nowShowing = input.type === 'password';
      input.type = nowShowing ? 'text' : 'password';
      btn.innerHTML = nowShowing ? EYE_OFF_ICON : EYE_ICON;
      btn.setAttribute('aria-label', nowShowing ? 'Hide password' : 'Show password');
    });
  });

  // ---- Accordion (FAQ) --------------------------------------------------
  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      item.classList.toggle('open');
    });
  });

  // ---- Quiz options -------------------------------------------------------
  document.querySelectorAll('.quiz-box').forEach((box) => window.bindQuizBox(box));
});

// ---- Quiz binding (shared by static quiz-boxes and dynamically-inserted
// ones, e.g. the real quiz questions member.js loads on lesson.html) --------
// If a quiz-box carries data-question-id, the attempt is also logged to
// Supabase via the record_quiz_attempt RPC for the admin analytics panel.
window.bindQuizBox = function bindQuizBox(box) {
  const options = box.querySelectorAll('.quiz-option');
  const feedback = box.querySelector('.quiz-feedback');
  const questionId = box.getAttribute('data-question-id');
  // lang is read fresh inside each handler (not captured once here), since
  // this box can outlive a language toggle: on index.html it's static
  // markup that's bound once at page load and never rebuilt, so a stale
  // closure would keep grading in whatever language was active at bind
  // time instead of whatever the visitor has selected when they click.
  const markOption = (el, isRight) => {
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const correctMark = lang === 'es' ? 'Respuesta correcta' : 'Correct answer';
    const incorrectMark = lang === 'es' ? 'Tu respuesta, incorrecta' : 'Your answer, incorrect';
    // Correctness is never color-only here: whichever option(s) get
    // highlighted also get a ✓/✗ glyph plus an sr-only label appended,
    // so it still reads for colorblind users and screen readers, not
    // just the color change.
    el.insertAdjacentHTML('beforeend', `<span aria-hidden="true"> ${isRight ? '✓' : '✗'}</span><span class="sr-only"> (${isRight ? correctMark : incorrectMark})</span>`);
  };
  options.forEach((opt) => {
    opt.addEventListener('click', () => {
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      options.forEach((o) => (o.disabled = true));
      const isCorrect = opt.getAttribute('data-correct') === 'true';
      opt.classList.add(isCorrect ? 'correct' : 'incorrect');
      markOption(opt, isCorrect);
      if (!isCorrect) {
        const correctOpt = box.querySelector('.quiz-option[data-correct="true"]');
        if (correctOpt) { correctOpt.classList.add('correct'); markOption(correctOpt, true); }
      }
      if (feedback) {
        // -es attributes are optional: dynamically-built quiz boxes (see
        // buildQuizBoxHtml in member.js) bake the already-current-language
        // message straight into data-correct-msg/data-incorrect-msg with
        // no -es variant, so the fallback below covers them too.
        const correctAttr = lang === 'es' ? 'data-correct-msg-es' : 'data-correct-msg';
        const incorrectAttr = lang === 'es' ? 'data-incorrect-msg-es' : 'data-incorrect-msg';
        feedback.textContent = isCorrect
          ? (feedback.getAttribute(correctAttr) || feedback.getAttribute('data-correct-msg') || 'Correct!')
          : (feedback.getAttribute(incorrectAttr) || feedback.getAttribute('data-incorrect-msg') || 'Not quite. Review the highlighted answer.');
        feedback.classList.add(isCorrect ? 'correct' : 'incorrect');
      }
      if (questionId && typeof supabaseClient !== 'undefined') {
        supabaseClient.rpc('record_quiz_attempt', { p_question_id: questionId, p_correct: isCorrect });
      }
    });
  });
};

// ---- Step flow helper (used by account.html) ---------------------------
function goToStep(stepNumber) {
  document.querySelectorAll('[data-step]').forEach((panel) => {
    panel.style.display = Number(panel.getAttribute('data-step')) === stepNumber ? 'block' : 'none';
  });
  document.querySelectorAll('[data-step-stamp]').forEach((stamp) => {
    const n = Number(stamp.getAttribute('data-step-stamp'));
    stamp.classList.remove('current', 'done');
    if (n < stepNumber) stamp.classList.add('done');
    if (n === stepNumber) stamp.classList.add('current');
  });
  document.querySelectorAll('[data-connector]').forEach((c) => {
    const n = Number(c.getAttribute('data-connector'));
    c.classList.toggle('done', n < stepNumber);
  });
  smoothScrollTo({ top: 0 });
}

// ---- Signup (real Supabase auth account, then real Stripe Checkout) ----
document.addEventListener('DOMContentLoaded', () => {
  // Pre-select whichever plan the visitor clicked on the homepage/pricing
  // section (?plan=monthly or ?plan=2year), if they landed here that way.
  const planOptions = document.querySelectorAll('.plan-option');
  if (planOptions.length) {
    const requestedPlan = new URLSearchParams(window.location.search).get('plan');
    if (requestedPlan === 'monthly' || requestedPlan === '2year') {
      planOptions.forEach((p) => {
        p.classList.toggle('selected', p.getAttribute('data-plan') === requestedPlan);
      });
    }
  }

  const signupForm = document.querySelector('#signup-form');
  if (!signupForm || typeof supabaseClient === 'undefined') return;

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = document.querySelector('#signup-submit');
    const errorEl = document.querySelector('#signup-error');
    const original = btn.textContent;
    if (errorEl) errorEl.style.display = 'none';

    const name = document.querySelector('#signup-name').value;
    const email = document.querySelector('#signup-email').value;
    const password = document.querySelector('#signup-password').value;
    const selectedPlan = document.querySelector('.plan-option.selected');
    const plan = selectedPlan ? selectedPlan.getAttribute('data-plan') : 'monthly';

    btn.disabled = true;
    btn.textContent = 'Creating your account…';

    // The real Supabase account is created right here, password hashed by
    // Supabase immediately, no plaintext holding table involved, then we
    // sign in to get a working session, then reuse the same
    // create-checkout-session function the dashboard billing banner uses.
    // subscription_status stays 'incomplete' until the webhook confirms
    // payment, so if anything below fails after this step, the account
    // still exists and recoverably shows a "finish signing up" banner on
    // next login instead of being lost.
    const { data: createData, error: createError } = await supabaseClient.functions.invoke('create-account', {
      body: { full_name: name, email: email, password: password, plan: plan },
    });

    if (createError || !createData || !createData.ok) {
      btn.disabled = false;
      btn.textContent = original;
      if (errorEl) {
        errorEl.textContent = (createData && createData.error) || (createError && createError.message) || 'Something went wrong creating your account.';
        errorEl.style.display = 'block';
      }
      return;
    }

    btn.textContent = 'Redirecting to secure checkout…';

    const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (signInError) {
      btn.disabled = false;
      btn.textContent = original;
      if (errorEl) {
        errorEl.textContent = 'Your account was created, but we could not sign you in automatically. Please log in to finish payment.';
        errorEl.style.display = 'block';
      }
      return;
    }

    const { data, error } = await supabaseClient.functions.invoke('create-checkout-session', {
      body: { plan: plan },
    });

    if (error || !data || !data.url) {
      btn.disabled = false;
      btn.textContent = original;
      if (errorEl) {
        errorEl.textContent = 'Your account was created. Log in any time to finish payment and start your course.';
        errorEl.style.display = 'block';
      }
      return;
    }

    window.location.href = data.url;
  });
});

// ==========================================================================
// Public-site FAQ chat widget, bottom-right bubble, marketing pages only.
// ==========================================================================
// Shown only where neither data-auth-required (member area) nor
// data-admin-required (admin panel) is set on <body>, every public page
// already carries neither attribute, so this needs no per-page opt-in.
//
// Answers come from site_faq_entries, matched client-side against what the
// visitor types (see matchFaqEntry) rather than a real model call. This is
// intentionally a first version: matchFaqEntry and the fallback path are
// the only two places a future real-AI backend would plug in (swap the
// matching step for an edge-function call to an LLM grounded in the same
// site_faq_entries content), the widget UI itself wouldn't need to change.
// Every question typed is logged to faq_bot_queries, matched or not, so
// unanswered questions are visible in admin as real signal for what FAQ
// content is missing.

const FAQ_BOT_CACHE_KEY = 'cr-cache:faq-bot-entries';
const FAQ_BOT_CACHE_TTL_MS = 10 * 60 * 1000;

function getFaqBotCache() {
  try {
    const raw = localStorage.getItem(FAQ_BOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.expires || Date.now() > parsed.expires) {
      localStorage.removeItem(FAQ_BOT_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch (e) { return null; }
}
function setFaqBotCache(data) {
  try { localStorage.setItem(FAQ_BOT_CACHE_KEY, JSON.stringify({ data, expires: Date.now() + FAQ_BOT_CACHE_TTL_MS })); } catch (e) {}
}

const FAQ_BOT_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'can', 'i', 'my', 'me', 'to', 'of', 'for', 'and', 'or',
  'in', 'on', 'at', 'it', 'this', 'that', 'you', 'your', 'what', 'how', 'who', 'when', 'where', 'why',
  'with', 'be', 'have', 'has', 'if', 'so', 'will', 'would', 'there', 'about',
  'de', 'la', 'el', 'en', 'y', 'o', 'un', 'una', 'qué', 'como', 'cómo', 'quién', 'cuándo', 'dónde',
  'por', 'para', 'con', 'es', 'son', 'tengo', 'mi', 'me', 'se', 'su', 'hay', 'los', 'las',
]);

// Lowercases, strips accents (so "está" and "esta" match the same token)
// and punctuation, then drops short/stop words, leaves only the words
// carrying real meaning to compare between the visitor's question and a
// FAQ entry's question + keywords.
function tokenizeFaqText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FAQ_BOT_STOPWORDS.has(w));
}

// Scores every entry by how many of the visitor's significant words show
// up in that entry's question/keywords, returns the best match, or null
// if nothing shares even one meaningful word, which triggers the fallback
// "here's how to reach a real person" response instead of a wrong guess.
function matchFaqEntry(entries, userText) {
  const queryWords = new Set(tokenizeFaqText(userText));
  if (!queryWords.size) return null;
  let best = null;
  let bestScore = 0;
  entries.forEach((entry) => {
    const haystack = tokenizeFaqText([entry.question, entry.question_es, entry.keywords].filter(Boolean).join(' '));
    let score = 0;
    haystack.forEach((w) => { if (queryWords.has(w)) score += 1; });
    if (score > bestScore) { bestScore = score; best = entry; }
  });
  return bestScore > 0 ? best : null;
}

function logFaqBotQuery(questionText, matchedEntry, lang) {
  try {
    if (typeof supabaseClient === 'undefined') return;
    supabaseClient.from('faq_bot_queries').insert({
      question_text: String(questionText || '').slice(0, 1000),
      matched_entry_id: matchedEntry ? matchedEntry.id : null,
      matched: !!matchedEntry,
      lang: lang || 'en',
    }).then(() => {}, () => {});
  } catch (e) { /* logging never blocks the actual answer */ }
}

const FAQ_BOT_LABELS = {
  en: {
    title: 'Ask CiudadanoReady',
    subtitle: 'Browse a question below or type your own. For anything else, use Support.',
    placeholder: 'Type your question…',
    send: 'Send',
    greeting: 'Hi! Pick a question below, or type your own about the course, pricing, or how it works.',
    fallback: "I don't have an answer for that yet. Our team can help: reach out and we'll get back to you within 24–48 hours.",
    browseLoading: 'Loading questions…',
    contactCta: 'Contact Support',
  },
  es: {
    title: 'Pregúntale a CiudadanoReady',
    subtitle: 'Elige una pregunta abajo o escribe la tuya. Para todo lo demás, usa Soporte.',
    placeholder: 'Escribe tu pregunta…',
    send: 'Enviar',
    greeting: '¡Hola! Elige una pregunta abajo, o escribe la tuya sobre el curso, los precios o cómo funciona.',
    fallback: 'Aún no tengo una respuesta para eso. Nuestro equipo puede ayudarte: contáctanos y te responderemos en 24 a 48 horas.',
    browseLoading: 'Cargando preguntas…',
    contactCta: 'Contactar Soporte',
  },
};

const FAQ_BOT_CATEGORY_ORDER = ['General', 'Course Content', 'Pricing & Billing', 'Technical'];
const FAQ_BOT_CATEGORY_LABELS = {
  General: { en: 'General', es: 'General' },
  'Course Content': { en: 'Course Content', es: 'Contenido del Curso' },
  'Pricing & Billing': { en: 'Pricing & Billing', es: 'Precios y Facturación' },
  Technical: { en: 'Technical', es: 'Soporte Técnico' },
};

let faqBotEntriesCache = null;

async function fetchFaqBotEntries() {
  if (faqBotEntriesCache) return faqBotEntriesCache;
  const cached = getFaqBotCache();
  if (cached) { faqBotEntriesCache = cached; return cached; }
  const { data, error } = await supabaseClient.from('site_faq_entries').select('*').eq('published', true).order('sort_order');
  if (error || !data) return [];
  faqBotEntriesCache = data;
  setFaqBotCache(data);
  return data;
}

function initFaqBotWidget() {
  if (typeof supabaseClient === 'undefined') return;
  if (document.body.hasAttribute('data-auth-required') || document.body.hasAttribute('data-admin-required')) return;
  if (document.querySelector('#faq-bot-bubble')) return;

  const bubble = document.createElement('button');
  bubble.id = 'faq-bot-bubble';
  bubble.type = 'button';
  bubble.setAttribute('aria-label', 'Chat with CiudadanoReady');
  bubble.textContent = '💬';

  const panel = document.createElement('div');
  panel.id = 'faq-bot-panel';

  const header = document.createElement('div');
  header.id = 'faq-bot-header';
  const headerText = document.createElement('div');
  const titleEl = document.createElement('div');
  titleEl.id = 'faq-bot-title';
  const subtitleEl = document.createElement('div');
  subtitleEl.id = 'faq-bot-subtitle';
  subtitleEl.className = 'small';
  headerText.appendChild(titleEl);
  headerText.appendChild(subtitleEl);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'faq-bot-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';
  header.appendChild(headerText);
  header.appendChild(closeBtn);

  const messages = document.createElement('div');
  messages.id = 'faq-bot-messages';

  const suggestions = document.createElement('div');
  suggestions.id = 'faq-bot-suggestions';

  const form = document.createElement('form');
  form.id = 'faq-bot-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'faq-bot-input';
  input.autocomplete = 'off';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.id = 'faq-bot-send';
  form.appendChild(input);
  form.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(suggestions);
  panel.appendChild(form);

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  function addMessage(text, from) {
    const el = document.createElement('div');
    el.className = 'faq-bot-msg ' + (from === 'user' ? 'faq-bot-msg-user' : 'faq-bot-msg-bot');
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  let faqBotEntriesForWidget = null;

  function renderFaqBrowseList() {
    if (!faqBotEntriesForWidget || !faqBotEntriesForWidget.length) return;
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const groups = {};
    const groupOrder = [];
    faqBotEntriesForWidget.forEach((entry) => {
      const cat = entry.category || 'General';
      if (!groups[cat]) { groups[cat] = []; groupOrder.push(cat); }
      groups[cat].push(entry);
    });
    groupOrder.sort((a, b) => a.localeCompare(b));
    Object.keys(groups).forEach((cat) => groups[cat].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    const orderedCats = FAQ_BOT_CATEGORY_ORDER.filter((c) => groups[c]).concat(groupOrder.filter((c) => !FAQ_BOT_CATEGORY_ORDER.includes(c)));

    suggestions.innerHTML = '';
    orderedCats.forEach((cat) => {
      const catLabelObj = FAQ_BOT_CATEGORY_LABELS[cat];
      const catLabel = catLabelObj ? (catLabelObj[lang] || catLabelObj.en) : cat;
      const header = document.createElement('div');
      header.className = 'faq-bot-cat-header';
      header.textContent = catLabel;
      suggestions.appendChild(header);
      groups[cat].forEach((entry) => {
        const qText = (lang === 'es' && entry.question_es) ? entry.question_es : entry.question;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'faq-bot-suggestion';
        btn.textContent = qText;
        btn.addEventListener('click', () => submitQuestion(qText));
        suggestions.appendChild(btn);
      });
    });
  }

  function renderStatic() {
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const fl = FAQ_BOT_LABELS[lang] || FAQ_BOT_LABELS.en;
    titleEl.textContent = fl.title;
    subtitleEl.textContent = fl.subtitle;
    input.placeholder = fl.placeholder;
    sendBtn.textContent = fl.send;
    renderFaqBrowseList();
  }
  renderStatic();
  window.addEventListener('ciudadanoready:langchange', renderStatic);

  async function submitQuestion(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const fl = FAQ_BOT_LABELS[lang] || FAQ_BOT_LABELS.en;
    addMessage(trimmed, 'user');
    input.value = '';

    const entries = await fetchFaqBotEntries();
    const match = matchFaqEntry(entries, trimmed);
    logFaqBotQuery(trimmed, match, lang);

    if (match) {
      const answer = (lang === 'es' && match.answer_es) ? match.answer_es : match.answer;
      addMessage(answer, 'bot');
    } else {
      addMessage(fl.fallback, 'bot');
      const cta = document.createElement('a');
      cta.href = 'contact.html';
      cta.className = 'btn btn-primary btn-sm';
      cta.style.marginTop = '4px';
      cta.textContent = fl.contactCta;
      messages.appendChild(cta);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuestion(input.value);
  });

  let opened = false;
  bubble.addEventListener('click', async () => {
    opened = !opened;
    panel.classList.toggle('open', opened);
    bubble.classList.toggle('open', opened);
    if (opened) {
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      const fl = FAQ_BOT_LABELS[lang] || FAQ_BOT_LABELS.en;
      if (!messages.hasChildNodes()) {
        addMessage(fl.greeting, 'bot');
      }
      input.focus();
      if (!faqBotEntriesForWidget) {
        suggestions.innerHTML = '';
        const loadingEl = document.createElement('div');
        loadingEl.className = 'faq-bot-loading small';
        loadingEl.textContent = fl.browseLoading;
        suggestions.appendChild(loadingEl);
        const entries = await fetchFaqBotEntries();
        faqBotEntriesForWidget = entries;
        renderFaqBrowseList();
      }
    }
  });
  closeBtn.addEventListener('click', () => {
    opened = false;
    panel.classList.remove('open');
    bubble.classList.remove('open');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initFaqBotWidget();
});
