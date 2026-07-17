/* ==========================================================================
   Cuidadano Ready — shared front-end behavior
   Language toggle, mobile nav, accordion, quiz interactions.
   ========================================================================== */

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
  try { localStorage.setItem('cuidadanoready-lang', lang); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang-btn')));
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
      if (!session) window.location.href = 'login.html';
    });
  }

  // ---- Admin guard (admin/index.html only) -------------------------------
  // Signed-out visitors bounce to login; signed-in non-admins bounce to
  // their own dashboard instead of seeing the admin panel.
  // Absolute paths here on purpose — this page lives one folder deep at /admin.
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
  const contactForm = document.querySelector('#contact-form');
  if (contactForm && typeof supabaseClient !== 'undefined') {
    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = document.querySelector('#contact-submit');
      const errorEl = document.querySelector('#contact-error');
      const original = submitBtn.textContent;
      if (errorEl) errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

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
  options.forEach((opt) => {
    opt.addEventListener('click', () => {
      options.forEach((o) => (o.disabled = true));
      const isCorrect = opt.getAttribute('data-correct') === 'true';
      opt.classList.add(isCorrect ? 'correct' : 'incorrect');
      if (!isCorrect) {
        const correctOpt = box.querySelector('.quiz-option[data-correct="true"]');
        if (correctOpt) correctOpt.classList.add('correct');
      }
      if (feedback) {
        feedback.textContent = isCorrect
          ? (feedback.getAttribute('data-correct-msg') || 'Correct!')
          : (feedback.getAttribute('data-incorrect-msg') || 'Not quite — review the highlighted answer.');
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Signup (real Supabase auth account + simulated payment) -----------
// Card fields are never sent anywhere — no real payment processor is
// connected yet. The email/password ARE real and create a real account.
document.addEventListener('DOMContentLoaded', () => {
  const signupForm = document.querySelector('#signup-form');
  if (!signupForm || typeof supabaseClient === 'undefined') return;

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = document.querySelector('#signup-submit');
    const errorEl = document.querySelector('#signup-error');
    const original = btn.textContent;
    if (errorEl) errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Processing…';

    const name = document.querySelector('#signup-name').value;
    const email = document.querySelector('#signup-email').value;
    const password = document.querySelector('#signup-password').value;
    const selectedPlan = document.querySelector('.plan-option.selected');
    const plan = selectedPlan ? selectedPlan.getAttribute('data-plan') : 'monthly';

    const { data, error } = await supabaseClient.auth.signUp({ email, password });

    if (error) {
      btn.disabled = false;
      btn.textContent = original;
      if (errorEl) {
        errorEl.textContent = error.message || 'Something went wrong creating your account.';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (data.user) {
      await supabaseClient.from('profiles').upsert({
        id: data.user.id,
        full_name: name,
        plan: plan,
      });
    }

    btn.disabled = false;
    btn.textContent = original;

    const successMsg = document.querySelector('#signup-success-message');
    if (successMsg && !data.session) {
      successMsg.textContent = 'Your account is set up. Check your email to confirm your address, then log in to start Stage 1: Eligibility.';
    }

    goToStep(3);
  });
});
