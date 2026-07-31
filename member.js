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

const TOTAL_MODULES = 7;

const MODULE_NAMES = {
  1: { en: 'Welcome', es: 'Bienvenida' },
  2: { en: 'Eligibility', es: 'Elegibilidad' },
  3: { en: 'N-400 Application', es: 'Solicitud N-400' },
  4: { en: 'Biometrics', es: 'Datos Biométricos' },
  5: { en: 'Interview & Exam Prep', es: 'Preparación para la Entrevista y el Examen' },
  6: { en: 'The Interview', es: 'La Entrevista' },
  7: { en: 'Oath Ceremony', es: 'Ceremonia de Juramentación' },
};

// Bilingual words used inside JS-generated dashboard strings (e.g.
// "Stage 3: N-400 Application · Lesson 1 of 2") that data-en/data-es
// attributes can't reach since they're built at render time, not
// present in the static HTML.
const DASHBOARD_LABELS = {
  en: { stage: 'Stage', lesson: 'Lesson', of: 'of', complete: 'Course complete! 🎉', keepGoing: 'Keep it going!', startStreak: 'Complete a lesson to start your streak' },
  es: { stage: 'Etapa', lesson: 'Lección', of: 'de', complete: '¡Curso completado! 🎉', keepGoing: '¡Sigue así!', startStreak: 'Completa una lección para comenzar tu racha' },
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

// Turns any http(s) URLs in already-escaped text into clickable links.
// Runs after escapeHtml, so it's safe to match on the escaped string directly.
function linkifyEscaped(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// Converts **bold** and *italic* markers (Markdown-style, as used in the
// "Know Your Country" history content) into <strong>/<em>. Runs on
// already-escaped text, so it's safe — the * characters survive escapeHtml
// untouched. Bold is matched before italic so "**word**" isn't mistaken
// for two separate italic spans.
function boldItalicEscaped(escapedText) {
  return escapedText
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

// Renders lesson body text into paragraphs, turning consecutive lines that
// start with "•" into a proper bulleted list instead of running them all
// together on one line. A block that's a single line starting with "## "
// is rendered as a subheading instead of a paragraph — this lets longer,
// multi-section lessons (like a step-by-step process overview) have real
// visual structure instead of one long wall of text.
function renderLessonBody(text) {
  const blocks = (text || '').split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return '<p class="small muted" style="margin:0;">No content yet for this lesson.</p>';

  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

    if (lines.length === 1 && lines[0].startsWith('## ')) {
      return `<h4 class="lesson-subhead">${boldItalicEscaped(escapeHtml(lines[0].slice(3)))}</h4>`;
    }

    const isBulletBlock = lines.length > 0 && lines.every((l) => l.startsWith('•'));
    if (isBulletBlock) {
      const items = lines.map((l) => `<li>${boldItalicEscaped(linkifyEscaped(escapeHtml(l.replace(/^•\s*/, ''))))}</li>`).join('');
      return `<ul class="lesson-list">${items}</ul>`;
    }
    return `<p>${boldItalicEscaped(linkifyEscaped(escapeHtml(block).replace(/\n/g, '<br>')))}</p>`;
  }).join('');
}

function renderStampPath(selector, lessons, completedIds, currentLesson, small) {
  const container = document.querySelector(selector);
  if (!container) return;
  let html = '';
  for (let m = 1; m <= TOTAL_MODULES; m++) {
    const moduleLessons = lessons.filter((l) => l.module_number === m);
    const hasLessons = moduleLessons.length > 0;
    const allDone = hasLessons && moduleLessons.every((l) => completedIds.has(l.id));
    const isCurrent = currentLesson && currentLesson.module_number === m;
    let circleClass = '';
    if (allDone) circleClass = ' done';
    else if (isCurrent) circleClass = ' current';
    const label = small ? '' : `<span class="stamp-label">${escapeHtml(moduleName(m))}</span>`;
    html += `<div class="stamp-item"><div class="stamp-circle${circleClass}">${m}</div>${label}</div>`;
    if (m < TOTAL_MODULES) html += `<div class="stamp-connector${allDone ? ' done' : ''}"></div>`;
  }
  container.innerHTML = html;
}

function renderModuleNav(selector, lessons, completedIds, expandLesson) {
  const nav = document.querySelector(selector);
  if (!nav) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const comingSoon = lang === 'es' ? 'Próximamente' : 'Coming soon';
  let html = '';
  for (let m = 1; m <= TOTAL_MODULES; m++) {
    const moduleLessons = lessons.filter((l) => l.module_number === m);
    if (!moduleLessons.length) {
      html += `<li style="padding:10px 24px; font-size:0.92rem; color:var(--slate);">${m}. ${escapeHtml(moduleName(m))} <span class="small muted">— ${comingSoon}</span></li>`;
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

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuizBoxHtml(q) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const choices = shuffleArray([
    ['a', localize(q, 'choice_a')],
    ['b', localize(q, 'choice_b')],
    ['c', localize(q, 'choice_c')],
    ['d', localize(q, 'choice_d')],
  ]);
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
  const { lessons, completedIds, streak } = dashboardCache;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const dl = (DASHBOARD_LABELS[lang] || DASHBOARD_LABELS.en);

  const currentLesson = lessons.find((l) => !completedIds.has(l.id));
  if (currentLesson) {
    const moduleLessons = lessons.filter((l) => l.module_number === currentLesson.module_number);
    const idxInModule = moduleLessons.findIndex((l) => l.id === currentLesson.id) + 1;
    document.querySelector('#stat-current-stage').textContent = `${dl.stage} ${currentLesson.module_number}: ${moduleName(currentLesson.module_number)}`;
    document.querySelector('#stat-current-lesson-count').textContent = `${dl.lesson} ${idxInModule} ${dl.of} ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-title').textContent = localize(currentLesson, 'title');
    document.querySelector('#continue-lesson-meta').textContent = `${dl.stage} ${currentLesson.module_number}: ${moduleName(currentLesson.module_number)} · ${dl.lesson} ${idxInModule} ${dl.of} ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-link').setAttribute('href', 'lesson.html?id=' + currentLesson.id);
    document.querySelector('#dashboard-continue-card').style.display = 'block';
  } else {
    document.querySelector('#stat-current-stage').textContent = dl.complete;
    document.querySelector('#stat-current-lesson-count').textContent = '';
    document.querySelector('#dashboard-continue-card').style.display = 'none';
  }

  if (typeof streak === 'number') {
    const dayWord = lang === 'es' ? 'días' : (streak === 1 ? 'day' : 'days');
    const streakEl = document.querySelector('#stat-streak');
    if (streakEl) streakEl.textContent = streak + ' ' + dayWord;
    const streakNote = document.querySelector('#stat-streak-note');
    if (streakNote) streakNote.textContent = streak > 0 ? dl.keepGoing : dl.startStreak;
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
  dashboardCache = { lessons, completedIds, streak };
  renderDashboard();
}

// ---- Lesson page --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let lessonCache = null;

function renderLessonPage() {
  if (!lessonCache) return;
  const { lessons, lesson, completedIds, quizQs, userId } = lessonCache;

  const pageLang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const stageWord = pageLang === 'es' ? 'ETAPA' : 'STAGE';
  const ofWord = pageLang === 'es' ? 'DE' : 'OF';
  const lessonWord = pageLang === 'es' ? 'LECCIÓN' : 'LESSON';

  document.querySelector('#lesson-stage-eyebrow').textContent = `${stageWord} ${lesson.module_number} ${ofWord} ${TOTAL_MODULES}`;
  document.querySelector('#lesson-stage-title').textContent = moduleName(lesson.module_number);
  document.title = `Stage ${lesson.module_number}: ${moduleName(lesson.module_number)} — Ciudadano Ready`;

  renderStampPath('#lesson-stamp-path', lessons, completedIds, lesson, true);

  const moduleLessons = lessons.filter((l) => l.module_number === lesson.module_number);
  const idxInModule = moduleLessons.findIndex((l) => l.id === lesson.id);
  document.querySelector('#lesson-badge').textContent = `${lessonWord} ${idxInModule + 1} ${ofWord} ${moduleLessons.length}`;
  document.querySelector('#lesson-title-h1').textContent = localize(lesson, 'title');

  document.querySelector('#lesson-content').innerHTML = renderLessonBody(localize(lesson, 'content'));

  const quizSection = document.querySelector('#lesson-quiz-section');
  const quizWrap = document.querySelector('#lesson-quiz-wrap');
  if (quizQs && quizQs.length) {
    quizSection.style.display = 'block';
    quizWrap.innerHTML = quizQs.map((q) => buildQuizBoxHtml(q)).join('<div style="height:16px;"></div>');
    quizWrap.querySelectorAll('.quiz-box').forEach((box) => window.bindQuizBox(box));
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

  // Quiz questions don't have their own lesson_id column — instead each
  // lesson "owns" every quiz question in its module whose sort_order falls
  // between its own sort_order and the next lesson's sort_order (or, if
  // it's the last lesson in the module, everything from its sort_order
  // onward). This lets a single lesson carry more than one quiz question
  // (e.g. a 2-question quiz at the end of one long lesson) while still
  // keeping each lesson's quiz distinct when a module has one quiz per
  // lesson.
  const sortedModuleLessons = lessons
    .filter((l) => l.module_number === lesson.module_number)
    .sort((a, b) => a.sort_order - b.sort_order);
  const lessonIdxInModule = sortedModuleLessons.findIndex((l) => l.id === lesson.id);
  const nextModuleLesson = sortedModuleLessons[lessonIdxInModule + 1];

  let quizQuery = supabaseClient
    .from('quiz_questions')
    .select('*')
    .eq('module_number', lesson.module_number)
    .eq('published', true)
    .gte('sort_order', lesson.sort_order);
  if (nextModuleLesson) quizQuery = quizQuery.lt('sort_order', nextModuleLesson.sort_order);
  const { data: quizQs } = await quizQuery.order('sort_order');

  lessonCache = { lessons, lesson, completedIds, quizQs, userId };
  renderLessonPage();
}

// ---- Flashcards page ----------------------------------------------------
// Study UI for the 3 official USCIS civics-test question banks
// (100-question 2008 version, 128-question 2025 version, 20-question
// 65/20 special-consideration subset). Purely client-side study tool —
// no progress is written to the database, just an in-memory deck with
// flip / next / prev / shuffle. Cached so a language toggle re-renders
// the current card in place instead of losing your spot in the deck.
const FLASHCARD_TEST_LABELS = {
  test_100: { en: '100-QUESTION TEST', es: 'PRUEBA DE 100 PREGUNTAS' },
  test_128: { en: '128-QUESTION TEST', es: 'PRUEBA DE 128 PREGUNTAS' },
  test_20: { en: '20-QUESTION TEST (65/20)', es: 'PRUEBA DE 20 PREGUNTAS (65/20)' },
};

let flashcardsCache = null; // { testType, cards, order: [idx...], pos, flipped }

function renderFlashcardsStudy() {
  if (!flashcardsCache) return;
  const { testType, cards, order, pos, flipped } = flashcardsCache;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const card = cards[order[pos]];

  const badge = document.querySelector('#fc-active-test-badge');
  if (badge) {
    const labelEntry = FLASHCARD_TEST_LABELS[testType] || FLASHCARD_TEST_LABELS.test_100;
    badge.textContent = labelEntry[lang] || labelEntry.en;
  }
  const progressText = document.querySelector('#fc-progress-text');
  if (progressText) progressText.textContent = `${pos + 1} / ${order.length}`;

  document.querySelector('#fc-question-text').textContent = localize(card, 'question');

  const answerList = document.querySelector('#fc-answer-list');
  if (answerList) {
    const answerLines = (localize(card, 'answer') || '').split('\n').map((l) => l.trim()).filter(Boolean);
    answerList.innerHTML = answerLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  }

  const flipEl = document.querySelector('#fc-flip-card');
  if (flipEl) flipEl.classList.toggle('flipped', !!flipped);

  const prevBtn = document.querySelector('#fc-prev-btn');
  if (prevBtn) prevBtn.disabled = pos === 0;
  const nextBtn = document.querySelector('#fc-next-btn');
  if (nextBtn) nextBtn.textContent = ''; // rebuilt below with bilingual span, so just clear stale text nodes
  if (nextBtn) {
    const label = lang === 'es' ? 'Siguiente' : 'Next';
    nextBtn.innerHTML = `<span data-en="Next" data-es="Siguiente">${escapeHtml(label)}</span> →`;
  }
}

function startFlashcardsDeck(testType, cards) {
  const order = cards.map((_, i) => i);
  flashcardsCache = { testType, cards, order, pos: 0, flipped: false };
  document.querySelector('#fc-picker-view').style.display = 'none';
  document.querySelector('#fc-study-view').style.display = 'block';
  renderFlashcardsStudy();
}

async function initFlashcardsPage() {
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

  // Sidebar module nav, same as dashboard/lesson pages.
  const { data: lessons } = await supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order');
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#fc-page-module-nav', lessons || [], completedIds, null);

  // Picker: clicking a test-type card fetches that bank and starts the deck.
  document.querySelectorAll('.fc-picker-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const testType = btn.getAttribute('data-test-type');
      btn.setAttribute('aria-busy', 'true');
      const { data: cards, error } = await supabaseClient
        .from('flashcards')
        .select('*')
        .eq('test_type', testType)
        .eq('published', true)
        .order('sort_order');
      btn.removeAttribute('aria-busy');
      if (error || !cards || !cards.length) {
        alert('Could not load flashcards. Please try again.');
        return;
      }
      history.replaceState(null, '', 'flashcards.html?type=' + testType);
      startFlashcardsDeck(testType, cards);
    });
  });

  document.querySelector('#fc-back-to-picker').addEventListener('click', () => {
    flashcardsCache = null;
    history.replaceState(null, '', 'flashcards.html');
    document.querySelector('#fc-study-view').style.display = 'none';
    document.querySelector('#fc-picker-view').style.display = 'block';
  });

  document.querySelector('#fc-flip-card').addEventListener('click', () => {
    if (!flashcardsCache) return;
    flashcardsCache.flipped = !flashcardsCache.flipped;
    renderFlashcardsStudy();
  });
  document.querySelector('#fc-flip-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!flashcardsCache) return;
    flashcardsCache.flipped = !flashcardsCache.flipped;
    renderFlashcardsStudy();
  });
  document.querySelector('#fc-prev-btn').addEventListener('click', () => {
    if (!flashcardsCache || flashcardsCache.pos === 0) return;
    flashcardsCache.pos -= 1;
    flashcardsCache.flipped = false;
    renderFlashcardsStudy();
  });
  document.querySelector('#fc-next-btn').addEventListener('click', () => {
    if (!flashcardsCache) return;
    flashcardsCache.pos = (flashcardsCache.pos + 1) % flashcardsCache.order.length;
    flashcardsCache.flipped = false;
    renderFlashcardsStudy();
  });
  document.querySelector('#fc-shuffle-btn').addEventListener('click', () => {
    if (!flashcardsCache) return;
    flashcardsCache.order = shuffleArray(flashcardsCache.order);
    flashcardsCache.pos = 0;
    flashcardsCache.flipped = false;
    renderFlashcardsStudy();
  });

  // Deep-link support: flashcards.html?type=test_128 jumps straight into that deck.
  const requestedType = new URLSearchParams(window.location.search).get('type');
  if (requestedType && FLASHCARD_TEST_LABELS[requestedType]) {
    const matchingBtn = document.querySelector(`.fc-picker-card[data-test-type="${requestedType}"]`);
    if (matchingBtn) matchingBtn.click();
  }
}

// ---- Practice Interview (randomized, graded practice test) --------------
// Simulates the real USCIS interview: a random draw of questions from
// whichever bank the member is studying, using the real official counts
// and passing thresholds (100-set: 10 asked / 6 to pass; 128-set: 20
// asked / 12 to pass; 20-set: 10 asked / 6 to pass). Since flashcards
// are oral Q&A (no multiple-choice options), grading is self-reported —
// same as the real interview, where the officer listens to a spoken
// answer and marks it right or wrong. Every attempt is saved to
// practice_quiz_attempts (score, pass/fail, and each question with the
// member's self-grade) so they can revisit and review it later, not just
// immediately after finishing.
const PRACTICE_QUIZ_CONFIG = {
  test_100: { ask: 10, pass: 6 },
  test_128: { ask: 20, pass: 12 },
  test_20: { ask: 10, pass: 6 },
};

let practiceQuizCache = null; // { testType, questions, idx, answers, revealed }
let practiceResultsCache = null; // last-rendered attempt, kept for re-render on langchange

function renderPracticeQuizQuestion() {
  if (!practiceQuizCache) return;
  const { testType, questions, idx, revealed } = practiceQuizCache;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const q = questions[idx];

  const badge = document.querySelector('#pq-active-test-badge');
  if (badge) {
    const labelEntry = FLASHCARD_TEST_LABELS[testType] || FLASHCARD_TEST_LABELS.test_100;
    badge.textContent = labelEntry[lang] || labelEntry.en;
  }
  document.querySelector('#pq-progress-text').textContent = `${idx + 1} / ${questions.length}`;
  document.querySelector('#pq-progress-bar').style.width = Math.round((idx / questions.length) * 100) + '%';

  document.querySelector('#pq-question-text').textContent = localize(q, 'question');
  const answerList = document.querySelector('#pq-answer-list');
  const answerLines = (localize(q, 'answer') || '').split('\n').map((l) => l.trim()).filter(Boolean);
  answerList.innerHTML = answerLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');

  document.querySelector('#pq-answer-reveal').classList.toggle('show', !!revealed);
  document.querySelector('#pq-reveal-row').style.display = revealed ? 'none' : 'block';
  document.querySelector('#pq-grade-row').style.display = revealed ? 'flex' : 'none';
}

function startPracticeQuiz(testType, questions) {
  practiceQuizCache = { testType, questions, idx: 0, answers: [], revealed: false };
  document.querySelector('#pq-picker-view').style.display = 'none';
  document.querySelector('#pq-results-view').style.display = 'none';
  document.querySelector('#pq-quiz-view').style.display = 'block';
  renderPracticeQuizQuestion();
}

function renderPracticeQuizResults(attempt) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  practiceResultsCache = attempt;

  document.querySelector('#pq-quiz-view').style.display = 'none';
  document.querySelector('#pq-picker-view').style.display = 'none';
  document.querySelector('#pq-results-view').style.display = 'block';

  const circle = document.querySelector('#pq-score-circle');
  const frac = document.querySelector('#pq-score-frac');
  const passBadge = document.querySelector('#pq-pass-badge');
  const msg = document.querySelector('#pq-results-message');

  frac.textContent = `${attempt.score}/${attempt.total}`;
  circle.classList.remove('pass', 'fail');
  circle.classList.add(attempt.passed ? 'pass' : 'fail');
  passBadge.classList.remove('pass', 'fail');
  passBadge.classList.add(attempt.passed ? 'pass' : 'fail');

  const labels = {
    en: {
      pass: 'PASSED', fail: 'NOT YET PASSING',
      passMsg: 'You answered enough correctly to pass this test at the real interview. Keep practicing to stay sharp!',
      failMsg: "You're not quite at the passing threshold yet — review what you missed below and try again.",
    },
    es: {
      pass: 'APROBADO', fail: 'AÚN NO APRUEBA',
      passMsg: 'Respondiste correctamente lo suficiente para aprobar esta prueba en la entrevista real. ¡Sigue practicando para mantenerte al día!',
      failMsg: 'Todavía no alcanzas el umbral de aprobación — revisa lo que fallaste abajo e inténtalo de nuevo.',
    },
  };
  const l = labels[lang] || labels.en;
  passBadge.textContent = attempt.passed ? l.pass : l.fail;
  msg.textContent = attempt.passed ? l.passMsg : l.failMsg;

  const reviewList = document.querySelector('#pq-review-list');
  reviewList.innerHTML = (attempt.answers || []).map((a) => {
    const qText = (lang === 'es' && a.question_es) ? a.question_es : a.question;
    const aText = (lang === 'es' && a.answer_es) ? a.answer_es : a.answer;
    const firstLine = (aText || '').split('\n')[0];
    return `<div class="pq-review-item">
      <div class="pq-review-icon ${a.correct ? 'correct' : 'incorrect'}">${a.correct ? '✓' : '✗'}</div>
      <div>
        <p class="pq-review-question">${escapeHtml(qText)}</p>
        <p class="pq-review-answer">${escapeHtml(firstLine)}</p>
      </div>
    </div>`;
  }).join('');
}

async function finishPracticeQuiz(userId) {
  const { testType, answers } = practiceQuizCache;
  const score = answers.filter((a) => a.correct).length;
  const total = answers.length;
  const passed = score >= (PRACTICE_QUIZ_CONFIG[testType] || {}).pass;
  const payload = { user_id: userId, test_type: testType, score, total, passed, answers };

  const { data, error } = await supabaseClient.from('practice_quiz_attempts').insert(payload).select().single();
  practiceQuizCache = null;
  const attempt = (!error && data) ? data : payload;
  renderPracticeQuizResults(attempt);
  loadPracticeQuizHistory();
}

function renderPracticeQuizHistory(attempts) {
  const emptyEl = document.querySelector('#pq-history-empty');
  const listEl = document.querySelector('#pq-history-list');
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  if (!attempts || !attempts.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (listEl) listEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  const dateFmt = (iso) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  listEl.innerHTML = attempts.map((a) => {
    const labelEntry = FLASHCARD_TEST_LABELS[a.test_type] || FLASHCARD_TEST_LABELS.test_100;
    const passText = a.passed ? (lang === 'es' ? 'Aprobado' : 'Passed') : (lang === 'es' ? 'No aprobado' : 'Not passing');
    return `<div class="pq-history-row" data-attempt-id="${a.id}">
      <div>
        <div class="pq-history-test">${escapeHtml(labelEntry[lang] || labelEntry.en)}</div>
        <div class="pq-history-meta">${dateFmt(a.created_at)}</div>
      </div>
      <span class="badge ${a.passed ? 'badge-forest' : ''}" style="${a.passed ? '' : 'border-color:var(--danger); color:var(--danger);'}">${a.score}/${a.total} · ${passText}</span>
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-attempt-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const attempt = attempts.find((a) => a.id === row.getAttribute('data-attempt-id'));
      if (attempt) renderPracticeQuizResults(attempt);
    });
  });
}

let practiceQuizHistoryCache = [];

async function loadPracticeQuizHistory() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { data } = await supabaseClient
    .from('practice_quiz_attempts')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(25);
  practiceQuizHistoryCache = data || [];
  renderPracticeQuizHistory(practiceQuizHistoryCache);
}

async function initPracticeQuizPage() {
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
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#pq-page-module-nav', lessons || [], completedIds, null);

  loadPracticeQuizHistory();

  async function beginQuiz(testType) {
    const config = PRACTICE_QUIZ_CONFIG[testType] || PRACTICE_QUIZ_CONFIG.test_100;
    const { data: cards, error } = await supabaseClient
      .from('flashcards')
      .select('*')
      .eq('test_type', testType)
      .eq('published', true);
    if (error || !cards || !cards.length) {
      alert('Could not load practice questions. Please try again.');
      return;
    }
    const chosen = shuffleArray(cards).slice(0, Math.min(config.ask, cards.length));
    startPracticeQuiz(testType, chosen);
  }

  document.querySelectorAll('.pq-picker-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-busy', 'true');
      beginQuiz(btn.getAttribute('data-test-type')).finally(() => btn.removeAttribute('aria-busy'));
    });
  });

  document.querySelector('#pq-reveal-btn').addEventListener('click', () => {
    if (!practiceQuizCache) return;
    practiceQuizCache.revealed = true;
    renderPracticeQuizQuestion();
  });

  function gradeCurrent(isCorrect) {
    if (!practiceQuizCache) return;
    const { questions, idx } = practiceQuizCache;
    const q = questions[idx];
    practiceQuizCache.answers.push({
      flashcard_id: q.id,
      question: q.question,
      answer: q.answer,
      question_es: q.question_es || null,
      answer_es: q.answer_es || null,
      correct: isCorrect,
    });
    if (idx + 1 >= questions.length) {
      finishPracticeQuiz(userId);
    } else {
      practiceQuizCache.idx += 1;
      practiceQuizCache.revealed = false;
      renderPracticeQuizQuestion();
    }
  }
  document.querySelector('#pq-grade-right').addEventListener('click', () => gradeCurrent(true));
  document.querySelector('#pq-grade-wrong').addEventListener('click', () => gradeCurrent(false));

  document.querySelector('#pq-quit-btn').addEventListener('click', () => {
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const confirmMsg = lang === 'es' ? '¿Salir de esta prueba de práctica? Tu progreso no se guardará.' : 'Quit this practice test? Your progress won\'t be saved.';
    if (!confirm(confirmMsg)) return;
    practiceQuizCache = null;
    document.querySelector('#pq-quiz-view').style.display = 'none';
    document.querySelector('#pq-picker-view').style.display = 'block';
  });

  document.querySelector('#pq-retake-btn').addEventListener('click', () => {
    const lastType = (practiceResultsCache && practiceResultsCache.test_type) || 'test_128';
    beginQuiz(lastType);
  });
  document.querySelector('#pq-results-back-btn').addEventListener('click', () => {
    practiceResultsCache = null;
    document.querySelector('#pq-results-view').style.display = 'none';
    document.querySelector('#pq-picker-view').style.display = 'block';
    loadPracticeQuizHistory();
  });
}

// ==========================================================================
// "Know Your Country" — 40-lesson narrative U.S. history section.
// Separate from the 7-stage naturalization process modules: this is
// supplementary background reading (the "why" behind the civics
// questions), not a required sequential step, so it lives on its own page
// with its own simple read/unread tracking (country_lesson_progress),
// browsable in any order.
// ==========================================================================

const KYC_LABELS = {
  en: { unit: 'Unit', lesson: 'Lesson', progress: (done, total) => `${done} / ${total}` },
  es: { unit: 'Unidad', lesson: 'Lección', progress: (done, total) => `${done} / ${total}` },
};

let kycCache = null; // { lessons: [...], completedNums: Set, currentLessonNumber }

// ---- "Know Your Country" audio narration (pre-generated audio files) -----
// Each lesson has a professionally generated narration file (same narrator,
// English and Spanish) stored in Supabase Storage and referenced via the
// audio_url_en / audio_url_es columns on country_lessons. Playback is a
// single shared <audio> element we point at the right file per lesson/lang.
const kycAudioState = { lang: 'en', playing: false, paused: false };
let kycAudioEl = null;
let kycSeeking = false; // true while the user is actively dragging the seek bar

function formatKycTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Keeps the seek slider + time labels in sync with actual playback. Skipped
// while the user has the slider grabbed so their drag isn't fought/overwritten.
function updateKycSeekUI() {
  const seek = document.querySelector('#kyc-audio-seek');
  const curEl = document.querySelector('#kyc-audio-current-time');
  const durEl = document.querySelector('#kyc-audio-duration');
  if (!seek) return;
  const el = kycAudioEl;
  const duration = (el && isFinite(el.duration) && el.duration > 0) ? el.duration : 0;
  const current = el ? el.currentTime : 0;
  seek.disabled = !duration;
  seek.max = duration || 0;
  if (!kycSeeking) seek.value = current || 0;
  if (curEl) curEl.textContent = formatKycTime(current);
  if (durEl) durEl.textContent = formatKycTime(duration);
}

function getKycAudioEl() {
  if (!kycAudioEl) {
    kycAudioEl = document.createElement('audio');
    kycAudioEl.id = 'kyc-audio-player';
    kycAudioEl.preload = 'none';
    kycAudioEl.style.display = 'none';
    document.body.appendChild(kycAudioEl);
    kycAudioEl.addEventListener('ended', () => { kycAudioState.playing = false; kycAudioState.paused = false; updateKycAudioUI(); });
    kycAudioEl.addEventListener('error', () => { kycAudioState.playing = false; kycAudioState.paused = false; updateKycAudioUI(); });
    kycAudioEl.addEventListener('loadedmetadata', updateKycSeekUI);
    kycAudioEl.addEventListener('timeupdate', updateKycSeekUI);
  }
  return kycAudioEl;
}

function currentKycAudioUrl() {
  if (!kycCache || kycCache.currentLessonNumber == null) return null;
  const lesson = kycCache.lessons.find((l) => l.lesson_number === kycCache.currentLessonNumber);
  if (!lesson) return null;
  return kycAudioState.lang === 'es' ? (lesson.audio_url_es || null) : (lesson.audio_url_en || null);
}

function updateKycAudioUI() {
  const bar = document.querySelector('#kyc-audio-bar');
  if (!bar) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  bar.querySelectorAll('[data-audio-lang]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-audio-lang') === kycAudioState.lang);
  });
  const icon = document.querySelector('#kyc-audio-play-icon');
  const label = document.querySelector('#kyc-audio-play-label');
  const stopBtn = document.querySelector('#kyc-audio-stop-btn');
  const status = document.querySelector('#kyc-audio-status');
  const playBtn = document.querySelector('#kyc-audio-play-btn');
  const hasAudio = !!currentKycAudioUrl();

  if (playBtn) playBtn.disabled = !hasAudio;
  updateKycSeekUI();

  if (!hasAudio) {
    icon.textContent = '▶';
    label.textContent = lang === 'es' ? 'Escuchar' : 'Listen';
    stopBtn.style.display = 'none';
    status.textContent = lang === 'es' ? 'Audio no disponible' : 'Audio not available';
    status.classList.remove('speaking');
  } else if (kycAudioState.playing && !kycAudioState.paused) {
    icon.textContent = '⏸';
    label.textContent = lang === 'es' ? 'Pausar' : 'Pause';
    stopBtn.style.display = 'inline-flex';
    status.textContent = lang === 'es' ? 'Reproduciendo…' : 'Playing…';
    status.classList.add('speaking');
  } else if (kycAudioState.playing && kycAudioState.paused) {
    icon.textContent = '▶';
    label.textContent = lang === 'es' ? 'Reanudar' : 'Resume';
    stopBtn.style.display = 'inline-flex';
    status.textContent = lang === 'es' ? 'Pausado' : 'Paused';
    status.classList.remove('speaking');
  } else {
    icon.textContent = '▶';
    label.textContent = lang === 'es' ? 'Escuchar' : 'Listen';
    stopBtn.style.display = 'none';
    status.textContent = '';
    status.classList.remove('speaking');
  }
}

function stopKycAudio() {
  const el = getKycAudioEl();
  el.pause();
  el.currentTime = 0;
  kycAudioState.playing = false;
  kycAudioState.paused = false;
  updateKycAudioUI();
}

// Jumps playback to a specific point (0-duration seconds), used by the
// draggable seek bar to scrub forward/back or restart from the beginning.
function seekKycAudio(seconds) {
  const el = getKycAudioEl();
  if (!isFinite(el.duration) || el.duration <= 0) return;
  el.currentTime = Math.max(0, Math.min(seconds, el.duration));
  updateKycSeekUI();
}

function speakKycLesson() {
  const url = currentKycAudioUrl();
  if (!url) { updateKycAudioUI(); return; }

  const el = getKycAudioEl();
  if (el.src !== url) el.src = url;

  kycAudioState.playing = true;
  kycAudioState.paused = false;
  el.play().catch(() => {
    kycAudioState.playing = false;
    kycAudioState.paused = false;
    updateKycAudioUI();
  });
  updateKycAudioUI();
}

function toggleKycAudioPlayPause() {
  const el = getKycAudioEl();
  if (!kycAudioState.playing) {
    speakKycLesson();
  } else if (kycAudioState.paused) {
    el.play();
    kycAudioState.paused = false;
    updateKycAudioUI();
  } else {
    el.pause();
    kycAudioState.paused = true;
    updateKycAudioUI();
  }
}

function setKycAudioLang(lang) {
  if (kycAudioState.lang === lang) return;
  const wasPlaying = kycAudioState.playing && !kycAudioState.paused;
  stopKycAudio();
  if (!wasPlaying && kycAudioEl) kycAudioEl.removeAttribute('src'); // reset seek bar/duration to 0:00 until they press play again
  kycAudioState.lang = lang;
  updateKycAudioUI();
  if (wasPlaying) speakKycLesson(); // switch narration language mid-listen by restarting the lesson in the new language
}

function renderKycPicker() {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const kl = KYC_LABELS[lang];
  if (!kycCache) return;
  const { lessons, completedNums } = kycCache;

  const total = lessons.length;
  const done = lessons.filter((l) => completedNums.has(l.lesson_number)).length;
  document.querySelector('#kyc-progress-count').textContent = kl.progress(done, total);
  document.querySelector('#kyc-progress-fill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';

  const units = [];
  lessons.forEach((l) => {
    let u = units.find((x) => x.unit_number === l.unit_number);
    if (!u) { u = { unit_number: l.unit_number, unit_title: l.unit_title, unit_title_es: l.unit_title_es, lessons: [] }; units.push(u); }
    u.lessons.push(l);
  });
  units.sort((a, b) => a.unit_number - b.unit_number);

  const listEl = document.querySelector('#kyc-units-list');
  listEl.innerHTML = units.map((u) => {
    const unitTitle = (lang === 'es' && u.unit_title_es) ? u.unit_title_es : u.unit_title;
    const rows = u.lessons.map((l) => {
      const isDone = completedNums.has(l.lesson_number);
      const title = localize(l, 'title');
      return `<div class="kyc-lesson-row${isDone ? ' done' : ''}" data-lesson-number="${l.lesson_number}">
        <span class="kyc-lesson-check">${isDone ? '✓' : ''}</span>
        <span class="kyc-lesson-num">${l.lesson_number}</span>
        <span class="kyc-lesson-title">${escapeHtml(title)}</span>
      </div>`;
    }).join('');
    return `<div class="kyc-unit-block">
      <div class="kyc-unit-heading">
        <span class="kyc-unit-num">${kl.unit} ${u.unit_number}</span>
        <h3>${escapeHtml(unitTitle)}</h3>
      </div>
      ${rows}
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-lesson-number]').forEach((row) => {
    row.addEventListener('click', () => {
      openKycLesson(parseInt(row.getAttribute('data-lesson-number'), 10));
    });
  });
}

function renderKycReading() {
  if (!kycCache || kycCache.currentLessonNumber == null) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const kl = KYC_LABELS[lang];
  const { lessons, currentLessonNumber } = kycCache;
  const lesson = lessons.find((l) => l.lesson_number === currentLessonNumber);
  if (!lesson) return;

  document.querySelector('#kyc-lesson-badge').textContent = `${kl.unit.toUpperCase()} ${lesson.unit_number} · ${kl.lesson.toUpperCase()} ${lesson.lesson_number}`;
  document.querySelector('#kyc-lesson-title').textContent = localize(lesson, 'title');
  document.querySelector('#kyc-lesson-content').innerHTML = renderLessonBody(localize(lesson, 'content'));

  const idx = lessons.findIndex((l) => l.lesson_number === currentLessonNumber);
  const prevBtn = document.querySelector('#kyc-prev-lesson-btn');
  const nextBtn = document.querySelector('#kyc-next-lesson-btn');
  prevBtn.disabled = idx <= 0;
  nextBtn.textContent = idx >= lessons.length - 1 ? (lang === 'es' ? 'Terminado ✓' : 'Done ✓') : `${lang === 'es' ? 'Siguiente' : 'Next'} →`;

  markKycLessonRead(currentLessonNumber);
  updateKycAudioUI();
}

// Stops any in-progress narration and defaults the audio player's language
// to whatever the site is currently displayed in — called every time a
// different lesson is opened so audio never carries over between lessons.
function resetKycAudioForNewLesson() {
  stopKycAudio();
  if (kycAudioEl) kycAudioEl.removeAttribute('src'); // clear old lesson's file so seek bar/duration reset to 0:00
  kycAudioState.lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  updateKycAudioUI();
}

async function markKycLessonRead(lessonNumber) {
  if (!kycCache || kycCache.completedNums.has(lessonNumber)) return;
  kycCache.completedNums.add(lessonNumber);
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  await supabaseClient.from('country_lesson_progress').upsert(
    { user_id: session.user.id, lesson_number: lessonNumber },
    { onConflict: 'user_id,lesson_number' }
  );
}

function openKycLesson(lessonNumber) {
  if (!kycCache) return;
  kycCache.currentLessonNumber = lessonNumber;
  document.querySelector('#kyc-picker-view').style.display = 'none';
  document.querySelector('#kyc-reading-view').style.display = 'block';
  window.scrollTo(0, 0);
  resetKycAudioForNewLesson();
  renderKycReading();
}

async function initKycPage() {
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

  const { data: courseLessons } = await supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order');
  const { data: courseProgress } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  renderModuleNav('#kyc-page-module-nav', courseLessons || [], new Set((courseProgress || []).map((p) => p.lesson_id)), null);

  const [{ data: kycLessons }, { data: kycProgress }] = await Promise.all([
    supabaseClient.from('country_lessons').select('*').eq('published', true).order('lesson_number'),
    supabaseClient.from('country_lesson_progress').select('lesson_number').eq('user_id', userId),
  ]);

  kycCache = {
    lessons: kycLessons || [],
    completedNums: new Set((kycProgress || []).map((p) => p.lesson_number)),
    currentLessonNumber: null,
  };
  renderKycPicker();

  document.querySelector('#kyc-back-to-list').addEventListener('click', () => {
    stopKycAudio();
    kycCache.currentLessonNumber = null;
    document.querySelector('#kyc-reading-view').style.display = 'none';
    document.querySelector('#kyc-picker-view').style.display = 'block';
    renderKycPicker();
  });

  document.querySelector('#kyc-prev-lesson-btn').addEventListener('click', () => {
    const { lessons, currentLessonNumber } = kycCache;
    const idx = lessons.findIndex((l) => l.lesson_number === currentLessonNumber);
    if (idx > 0) {
      kycCache.currentLessonNumber = lessons[idx - 1].lesson_number;
      window.scrollTo(0, 0);
      resetKycAudioForNewLesson();
      renderKycReading();
    }
  });
  document.querySelector('#kyc-next-lesson-btn').addEventListener('click', () => {
    const { lessons, currentLessonNumber } = kycCache;
    const idx = lessons.findIndex((l) => l.lesson_number === currentLessonNumber);
    if (idx < lessons.length - 1) {
      kycCache.currentLessonNumber = lessons[idx + 1].lesson_number;
      window.scrollTo(0, 0);
      resetKycAudioForNewLesson();
      renderKycReading();
    } else {
      stopKycAudio();
      kycCache.currentLessonNumber = null;
      document.querySelector('#kyc-reading-view').style.display = 'none';
      document.querySelector('#kyc-picker-view').style.display = 'block';
      renderKycPicker();
    }
  });

  document.querySelector('#kyc-audio-play-btn').addEventListener('click', toggleKycAudioPlayPause);
  document.querySelector('#kyc-audio-stop-btn').addEventListener('click', stopKycAudio);

  const kycSeekInput = document.querySelector('#kyc-audio-seek');
  if (kycSeekInput) {
    // Dragging updates playback position live; we suppress the normal
    // timeupdate-driven UI sync while the user has the handle grabbed so
    // their drag isn't overwritten mid-gesture.
    const beginKycSeekDrag = () => { kycSeeking = true; };
    const endKycSeekDrag = () => { kycSeeking = false; seekKycAudio(parseFloat(kycSeekInput.value) || 0); };
    kycSeekInput.addEventListener('pointerdown', beginKycSeekDrag);
    kycSeekInput.addEventListener('pointerup', endKycSeekDrag);
    kycSeekInput.addEventListener('touchstart', beginKycSeekDrag, { passive: true });
    kycSeekInput.addEventListener('touchend', endKycSeekDrag);
    kycSeekInput.addEventListener('input', () => {
      // Live-scrub as the user drags, and update the time label immediately.
      kycSeeking = true;
      seekKycAudio(parseFloat(kycSeekInput.value) || 0);
      const curEl = document.querySelector('#kyc-audio-current-time');
      if (curEl) curEl.textContent = formatKycTime(parseFloat(kycSeekInput.value) || 0);
    });
    kycSeekInput.addEventListener('change', endKycSeekDrag);
  }

  document.querySelectorAll('#kyc-audio-bar [data-audio-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setKycAudioLang(btn.getAttribute('data-audio-lang')));
  });

  // Stop narration if the visitor navigates away or closes the tab —
  // speechSynthesis otherwise keeps talking after the page unloads on some browsers.
  window.addEventListener('beforeunload', stopKycAudio);
  window.addEventListener('pagehide', stopKycAudio);

  // Deep link support: know-your-country.html?lesson=12
  const params = new URLSearchParams(window.location.search);
  const deepLinkLesson = parseInt(params.get('lesson'), 10);
  if (deepLinkLesson && kycCache.lessons.some((l) => l.lesson_number === deepLinkLesson)) {
    openKycLesson(deepLinkLesson);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined') return;
  if (document.body.hasAttribute('data-dashboard-page')) initDashboard();
  if (document.body.hasAttribute('data-lesson-page')) initLessonPage();
  if (document.body.hasAttribute('data-flashcards-page')) initFlashcardsPage();
  if (document.body.hasAttribute('data-practice-quiz-page')) initPracticeQuizPage();
  if (document.body.hasAttribute('data-kyc-page')) initKycPage();
});

// Re-render dynamic content in place when the visitor toggles EN/ES —
// no refetch needed since app.js's setLang() only changed which language
// is "current"; the underlying data we already loaded hasn't changed.
window.addEventListener('ciudadanoready:langchange', () => {
  if (document.body.hasAttribute('data-dashboard-page')) renderDashboard();
  if (document.body.hasAttribute('data-lesson-page')) renderLessonPage();
  if (document.body.hasAttribute('data-flashcards-page')) renderFlashcardsStudy();
  if (document.body.hasAttribute('data-practice-quiz-page')) {
    if (practiceQuizCache) renderPracticeQuizQuestion();
    if (practiceResultsCache) renderPracticeQuizResults(practiceResultsCache);
    renderPracticeQuizHistory(practiceQuizHistoryCache);
  }
  if (document.body.hasAttribute('data-kyc-page') && kycCache) {
    if (kycCache.currentLessonNumber != null) renderKycReading(); else renderKycPicker();
  }
});
