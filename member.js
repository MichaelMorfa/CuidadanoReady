/* ==========================================================================
   Ciudadano Ready — Member area logic (dashboard.html + lesson.html)
   Reads real course content + progress from Supabase; no more hardcoded
   placeholder numbers. Loaded after app.js, which handles the auth guard.

   Bilingual course content: lessons/quiz_questions carry English fields
   (title/content/question/choice_a..d) plus optional _es counterparts.
   getCurrentLang() (from app.js) says which one to show; a 'localize()'
   helper picks the right field with an English fallback if a translation
   hasn't been entered yet. Language changes re-render from cached data
   (no refetch) via the 'ciudadanoready:langchange' event app.js fires.
   ========================================================================== */

const MODULE_NAMES = {
  1: { en: 'Eligibility', es: 'Elegibilidad' },
  2: { en: 'N-400', es: 'N-400' },
  3: { en: 'Biometrics', es: 'Datos Biométricos' },
  4: { en: 'English Test', es: 'Examen de Inglés' },
  5: { en: 'Civics Test', es: 'Examen Cívico' },
  6: { en: 'Interview', es: 'Entrevista' },
  7: { en: 'Oath', es: 'Juramento' },
};

function moduleName(m) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const entry = MODULE_NAMES[m];
  if (!entry) return '';
  return entry[lang] || entry.en;
}

// Picks obj[field + '_es'] when the site is in Spanish and a translation
// exists; otherwise falls back to the English obj[field].
function localize(obj, field) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  if (lang === 'es' && obj && obj[field + '_es']) return obj[field + '_es'];
  return obj ? obj[field] : '';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renders lesson body text into paragraphs, turning consecutive lines that
// start with "•" into a proper bulleted list instead of running them all
// together on one line.
function renderLessonBody(text) {
  const blocks = (text || '').split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return '<p class="small muted" style="margin:0;">No content yet for this lesson.</p>';

  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const isBulletBlock = lines.length > 0 && lines.every((l) => l.startsWith('•'));
    if (isBulletBlock) {
      const items = lines.map((l) => `<li>${escapeHtml(l.replace(/^•\s*/, ''))}</li>`).join('');
      return `<ul class="lesson-list">${items}</ul>`;
    }
    return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function renderStampPath(selector, lessons, completedIds, currentLesson, small) {
  const container = document.querySelector(selector);
  if (!container) return;
  let html = '';
  for (let m = 1; m <= 7; m++) {
    const moduleLessons = lessons.filter((l) => l.module_number === m);
    const hasLessons = moduleLessons.length > 0;
    const allDone = hasLessons && moduleLessons.every((l) => completedIds.has(l.id));
    const isCurrent = currentLesson && currentLesson.module_number === m;
    let circleClass = '';
    if (allDone) circleClass = ' done';
    else if (isCurrent) circleClass = ' current';
    const label = small ? '' : `<span class="stamp-label">${escapeHtml(moduleName(m))}</span>`;
    html += `<div class="stamp-item"><div class="stamp-circle${circleClass}">${m}</div>${label}</div>`;
    if (m < 7) html += `<div class="stamp-connector${allDone ? ' done' : ''}"></div>`;
  }
  container.innerHTML = html;
}

function renderModuleNav(selector, lessons, completedIds, expandLesson) {
  const nav = document.querySelector(selector);
  if (!nav) return;
  let html = '';
  for (let m = 1; m <= 7; m++) {
    const moduleLessons = lessons.filter((l) => l.module_number === m);
    if (!moduleLessons.length) {
      html += `<li style="padding:10px 24px; font-size:0.92rem; color:var(--slate);">${m}. ${escapeHtml(moduleName(m))} <span class="small muted">— Coming soon</span></li>`;
      continue;
    }
    const allDone = moduleLessons.every((l) => completedIds.has(l.id));
    const isExpanded = expandLesson && expandLesson.module_number === m;
    const firstLesson = moduleLessons[0];
    html += `<li><a href="lesson.html?id=${firstLesson.id}" class="${isExpanded ? 'active' : ''}"><span class="check${allDone ? ' done' : ''}">${allDone ? '✓' : ''}</span>&nbsp;${m}. ${escapeHtml(moduleName(m))}</a>`;
    if (isExpanded) {
      html += '<ul class="lesson-sub-list">';
      moduleLessons.forEach((l) => {
        const done = completedIds.has(l.id);
        const isCurrent = expandLesson.id === l.id;
        html += `<li><a href="lesson.html?id=${l.id}" class="${isCurrent ? 'current' : ''}"><span class="check${done ? ' done' : ''}">${done ? '✓' : ''}</span> ${escapeHtml(localize(l, 'title'))}</a></li>`;
      });
      html += '</ul>';
    }
    html += '</li>';
  }
  nav.innerHTML = html;
}

function buildVideoEmbed(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="Lesson video"></iframe>`;
  const vim = url.match(/vimeo\.com\/(\d+)/);
  if (vim) return `<iframe src="https://player.vimeo.com/video/${vim[1]}" allowfullscreen loading="lazy" title="Lesson video"></iframe>`;
  return `<div style="width:100%;height:100%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#fff;font-family:var(--font-mono);font-size:0.85rem;">▶ Watch Video</a></div>`;
}

function buildQuizBoxHtml(q) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const choices = [
    ['a', localize(q, 'choice_a')],
    ['b', localize(q, 'choice_b')],
    ['c', localize(q, 'choice_c')],
    ['d', localize(q, 'choice_d')],
  ];
  const optionsHtml = choices.map(([key, text]) => `<button class="quiz-option" data-correct="${key === q.correct_choice ? 'true' : 'false'}">${escapeHtml(text)}</button>`).join('');
  const label = lang === 'es' ? 'PREGUNTA DE PRÁCTICA' : 'PRACTICE QUESTION';
  const correctMsg = lang === 'es' ? '¡Correcto!' : 'Correct!';
  const incorrectMsg = lang === 'es' ? 'No es correcto — revisa la respuesta resaltada.' : 'Not quite — review the highlighted answer.';
  return `<div class="quiz-box" data-question-id="${q.id}">
    <span class="badge" style="margin-bottom:12px; display:inline-block;">${label}</span>
    <h3 style="font-family:var(--font-sans); font-size:1.05rem;">${escapeHtml(localize(q, 'question'))}</h3>
    ${optionsHtml}
    <div class="quiz-feedback" data-correct-msg="${escapeHtml(correctMsg)}" data-incorrect-msg="${escapeHtml(incorrectMsg)}"></div>
  </div>`;
}

// ---- Billing / paywall banner (shown when a profile hasn't paid) -------
function showBillingBanner(status) {
  const banner = document.querySelector('#dashboard-billing-banner');
  const eyebrow = document.querySelector('#billing-banner-eyebrow');
  const title = document.querySelector('#billing-banner-title');
  const message = document.querySelector('#billing-banner-message');
  const planButtons = document.querySelector('#billing-banner-plan-buttons');
  const manageBtn = document.querySelector('#billing-manage-link');
  if (!banner) return;

  document.querySelector('#dashboard-empty-state').style.display = 'none';
  document.querySelector('#dashboard-main-content').style.display = 'none';
  banner.style.display = 'block';

  if (status === 'past_due') {
    eyebrow.textContent = 'PAYMENT ISSUE';
    title.textContent = "There's a problem with your payment";
    message.textContent = "We couldn't process your last payment. Update your billing details to keep your course access.";
    planButtons.style.display = 'none';
    manageBtn.style.display = 'inline-flex';
  } else if (status === 'canceled') {
    eyebrow.textContent = 'SUBSCRIPTION ENDED';
    title.textContent = 'Your plan has ended';
    message.textContent = 'Choose a plan below to pick up right where you left off.';
    planButtons.style.display = 'flex';
    manageBtn.style.display = 'none';
  } else {
    eyebrow.textContent = 'FINISH SIGNING UP';
    title.textContent = 'One step left — choose a plan';
    message.textContent = "Your account is set up, but you haven't completed payment yet. Choose a plan to unlock the full course.";
    planButtons.style.display = 'flex';
    manageBtn.style.display = 'none';
  }

  const monthlyBtn = document.querySelector('#billing-choose-monthly');
  const yearlyBtn = document.querySelector('#billing-choose-2year');
  if (monthlyBtn) monthlyBtn.onclick = () => window.startCheckoutRedirect('monthly', monthlyBtn);
  if (yearlyBtn) yearlyBtn.onclick = () => window.startCheckoutRedirect('2year', yearlyBtn);
  if (manageBtn) manageBtn.onclick = () => window.openBillingPortal(manageBtn);
}

function showCheckoutNotice() {
  const notice = document.querySelector('#dashboard-checkout-notice');
  if (!notice) return;
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (checkout === 'success') {
    notice.style.display = 'block';
    notice.innerHTML = '<span class="eyebrow">PAYMENT RECEIVED</span><h3 style="margin-top:6px;">Welcome in! 🎉</h3><p class="small" style="margin:0;">Your payment went through — it can take a few seconds to unlock. Refresh if the course doesn\'t appear right away.</p>';
  } else if (checkout === 'cancelled') {
    notice.style.display = 'block';
    notice.innerHTML = '<span class="eyebrow">CHECKOUT CANCELLED</span><h3 style="margin-top:6px;">No charge was made</h3><p class="small" style="margin:0;">You can pick a plan below whenever you\'re ready.</p>';
  }
  if (checkout) {
    // Clean the URL so refreshing doesn't keep re-showing the banner.
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ---- Dashboard --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let dashboardCache = null;

function renderDashboard() {
  if (!dashboardCache) return;
  const { lessons, completedIds } = dashboardCache;

  const currentLesson = lessons.find((l) => !completedIds.has(l.id));
  if (currentLesson) {
    const moduleLessons = lessons.filter((l) => l.module_number === currentLesson.module_number);
    const idxInModule = moduleLessons.findIndex((l) => l.id === currentLesson.id) + 1;
    document.querySelector('#stat-current-stage').textContent = `Stage ${currentLesson.module_number}: ${moduleName(currentLesson.module_number)}`;
    document.querySelector('#stat-current-lesson-count').textContent = `Lesson ${idxInModule} of ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-title').textContent = localize(currentLesson, 'title');
    document.querySelector('#continue-lesson-meta').textContent = `Stage ${currentLesson.module_number}: ${moduleName(currentLesson.module_number)} · Lesson ${idxInModule} of ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-link').setAttribute('href', 'lesson.html?id=' + currentLesson.id);
    document.querySelector('#dashboard-continue-card').style.display = 'block';
  } else {
    document.querySelector('#stat-current-stage').textContent = 'Course complete! 🎉';
    document.querySelector('#stat-current-lesson-count').textContent = '';
    document.querySelector('#dashboard-continue-card').style.display = 'none';
  }

  renderStampPath('#dashboard-stamp-path', lessons, completedIds, currentLesson, false);
  renderModuleNav('#dashboard-module-nav', lessons, completedIds, null);
}

async function initDashboard() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  showCheckoutNotice();

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('subscription_status, streak_count, email, email_verified_at')
    .eq('id', userId)
    .single();

  const hasAccess = profile && ['active', 'trial', 'comp'].includes(profile.subscription_status);
  if (!hasAccess) {
    showBillingBanner(profile ? profile.subscription_status : 'incomplete');
    renderModuleNav('#dashboard-module-nav', [], new Set(), null);
    return;
  }
  document.querySelector('#dashboard-billing-banner').style.display = 'none';

  if (profile && !profile.email_verified_at) {
    const verifyBanner = document.querySelector('#verify-email-banner');
    const emailEl = document.querySelector('#verify-email-address');
    const resendBtn = document.querySelector('#verify-email-resend-btn');
    if (verifyBanner) {
      verifyBanner.style.display = 'block';
      if (emailEl) emailEl.textContent = profile.email || session.user.email || 'your email';
      if (resendBtn) {
        resendBtn.onclick = async () => {
          const original = resendBtn.textContent;
          resendBtn.disabled = true;
          resendBtn.textContent = 'Sending…';
          const { data: resendData, error: resendError } = await supabaseClient.rpc('resend_verification_email');
          resendBtn.disabled = false;
          if (resendError || !resendData || !resendData.ok) {
            resendBtn.textContent = original;
            alert((resendData && resendData.error) || (resendError && resendError.message) || 'Could not resend email.');
          } else {
            resendBtn.textContent = 'Sent!';
            setTimeout(() => { resendBtn.textContent = original; }, 4000);
          }
        };
      }
    }
  }

  const [{ data: lessons }, { data: progressRows }] = await Promise.all([
    supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order'),
    supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId),
  ]);

  const emptyState = document.querySelector('#dashboard-empty-state');
  const mainContent = document.querySelector('#dashboard-main-content');

  if (!lessons || !lessons.length) {
    emptyState.style.display = 'block';
    mainContent.style.display = 'none';
    renderModuleNav('#dashboard-module-nav', [], new Set(), null);
    return;
  }

  emptyState.style.display = 'none';
  mainContent.style.display = 'block';

  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  const total = lessons.length;
  const completedCount = lessons.filter((l) => completedIds.has(l.id)).length;
  const pct = total ? Math.round((completedCount / total) * 100) : 0;

  document.querySelector('#stat-progress-pct').textContent = pct + '%';
  document.querySelector('#stat-progress-bar').style.width = pct + '%';

  const streak = (profile && profile.streak_count) || 0;
  document.querySelector('#stat-streak').textContent = streak + (streak === 1 ? ' day' : ' days');
  document.querySelector('#stat-streak-note').textContent = streak > 0 ? 'Keep it going!' : 'Complete a lesson to start your streak';

  dashboardCache = { lessons, completedIds };
  renderDashboard();
}

// ---- Lesson page --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let lessonCache = null;

function renderLessonPage() {
  if (!lessonCache) return;
  const { lessons, lesson, completedIds, quizQs, userId } = lessonCache;

  document.querySelector('#lesson-stage-eyebrow').textContent = `STAGE ${lesson.module_number} OF 7`;
  document.querySelector('#lesson-stage-title').textContent = moduleName(lesson.module_number);
  document.title = `Stage ${lesson.module_number}: ${moduleName(lesson.module_number)} — Ciudadano Ready`;

  renderStampPath('#lesson-stamp-path', lessons, completedIds, lesson, true);

  const moduleLessons = lessons.filter((l) => l.module_number === lesson.module_number);
  const idxInModule = moduleLessons.findIndex((l) => l.id === lesson.id);
  document.querySelector('#lesson-badge').textContent = `LESSON ${idxInModule + 1} OF ${moduleLessons.length}`;
  document.querySelector('#lesson-title-h1').textContent = localize(lesson, 'title');

  document.querySelector('#lesson-content').innerHTML = renderLessonBody(localize(lesson, 'content'));

  const quizSection = document.querySelector('#lesson-quiz-section');
  const quizWrap = document.querySelector('#lesson-quiz-wrap');
  if (quizQs && quizQs.length) {
    quizSection.style.display = 'block';
    quizWrap.innerHTML = buildQuizBoxHtml(quizQs[0]);
    window.bindQuizBox(quizWrap.querySelector('.quiz-box'));
  } else {
    quizSection.style.display = 'none';
    quizWrap.innerHTML = '';
  }

  const overallIdx = lessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = overallIdx > 0 ? lessons[overallIdx - 1] : null;
  const nextLesson = overallIdx < lessons.length - 1 ? lessons[overallIdx + 1] : null;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';

  const prevLink = document.querySelector('#lesson-prev-link');
  if (prevLesson) {
    prevLink.setAttribute('href', 'lesson.html?id=' + prevLesson.id);
    prevLink.style.visibility = 'visible';
  } else {
    prevLink.style.visibility = 'hidden';
  }

  const nextLink = document.querySelector('#lesson-next-link');
  const alreadyDone = completedIds.has(lesson.id);
  const labels = {
    en: { next: 'Next Lesson →', markContinue: 'Mark Complete & Continue →', back: 'Back to Dashboard', markFinish: 'Mark Complete & Finish ✓' },
    es: { next: 'Siguiente lección →', markContinue: 'Marcar completado y continuar →', back: 'Volver al panel', markFinish: 'Marcar completado y finalizar ✓' },
  };
  const l = labels[lang] || labels.en;
  nextLink.textContent = nextLesson
    ? (alreadyDone ? l.next : l.markContinue)
    : (alreadyDone ? l.back : l.markFinish);
  nextLink.onclick = async (e) => {
    e.preventDefault();
    nextLink.setAttribute('aria-busy', 'true');
    if (!alreadyDone) {
      await supabaseClient.from('lesson_progress').upsert(
        { user_id: userId, lesson_id: lesson.id },
        { onConflict: 'user_id,lesson_id' }
      );
    }
    window.location.href = nextLesson ? ('lesson.html?id=' + nextLesson.id) : 'dashboard.html';
  };

  renderModuleNav('#lesson-module-nav', lessons, completedIds, lesson);
}

async function initLessonPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('subscription_status')
    .eq('id', userId)
    .single();
  const hasAccess = profile && ['active', 'trial', 'comp'].includes(profile.subscription_status);
  if (!hasAccess) {
    window.location.href = 'dashboard.html';
    return;
  }

  const { data: lessons } = await supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order');

  const emptyState = document.querySelector('#lesson-empty-state');
  const mainContent = document.querySelector('#lesson-main-content');

  if (!lessons || !lessons.length) {
    emptyState.style.display = 'block';
    mainContent.style.display = 'none';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('id');
  let lesson = lessons.find((l) => l.id === requestedId);
  if (!lesson) {
    lesson = lessons[0];
    history.replaceState(null, '', 'lesson.html?id=' + lesson.id);
  }

  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));

  mainContent.style.display = 'block';
  emptyState.style.display = 'none';

  const { data: quizQs } = await supabaseClient
    .from('quiz_questions')
    .select('*')
    .eq('module_number', lesson.module_number)
    .eq('published', true)
    .order('sort_order')
    .limit(1);

  lessonCache = { lessons, lesson, completedIds, quizQs, userId };
  renderLessonPage();
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined') return;
  if (document.body.hasAttribute('data-dashboard-page')) initDashboard();
  if (document.body.hasAttribute('data-lesson-page')) initLessonPage();
});

// Re-render dynamic content in place when the visitor toggles EN/ES —
// no refetch needed since app.js's setLang() only changed which language
// is "current"; the underlying data we already loaded hasn't changed.
window.addEventListener('ciudadanoready:langchange', () => {
  if (document.body.hasAttribute('data-dashboard-page')) renderDashboard();
  if (document.body.hasAttribute('data-lesson-page')) renderLessonPage();
});
