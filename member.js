/* ==========================================================================
   Ciudadano Ready | Member area logic (dashboard.html + lesson.html)
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

// A module's quiz (shown only on the last lesson of that module, see
// initLessonPage/renderLessonPage) must be passed at this ratio or better
// before the lesson can be marked complete. Weighted dashboard progress
// (computeWeightedProgress) uses the same "quiz counts as X characters
// worth of a lesson" and "video counts as Y characters worth" equivalences
// so that a short module with a real quiz/video isn't worth less progress
// than a long module with neither.
const MODULE_QUIZ_PASS_RATIO = 0.8;
const QUIZ_CHARS_PER_QUESTION = 700;
const VIDEO_CHARS_EQUIVALENT = 2500;

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

// ---- Content caching (localStorage, short TTL) -------------------------
// lessons / quiz_questions / flashcards / country_lessons only ever change
// when an admin edits them, every member page was re-fetching the full
// lessons table fresh from Postgres on every single load (it's needed for
// the sidebar nav on all of them), which is redundant work repeated by
// every visitor on every navigation. A 10-minute cache cuts that down
// substantially while staying well within an acceptable staleness window
// for admin-edited course content (nobody needs edits to appear
// instantly, a page refresh a few minutes later is fine). Progress data
// (lesson_progress, module_quiz_results, profiles, etc.) is NEVER cached
// this way, it's per-user and must always be current.
const CONTENT_CACHE_TTL_MS = 10 * 60 * 1000;
const CONTENT_CACHE_PREFIX = 'cr-cache:';

function getCachedContent(key) {
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() > parsed.expires) {
      localStorage.removeItem(CONTENT_CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch (e) {
    return null;
  }
}
function setCachedContent(key, data) {
  try {
    localStorage.setItem(CONTENT_CACHE_PREFIX + key, JSON.stringify({ data, expires: Date.now() + CONTENT_CACHE_TTL_MS }));
  } catch (e) { /* storage full/unavailable/private-browsing; just skip caching, not fatal */ }
}

// Replaces the ~8 identical `lessons` fetches spread across every member
// page's init function.
async function fetchPublishedLessons() {
  const cached = getCachedContent('lessons');
  if (cached) return cached;
  const { data } = await supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order');
  const lessons = data || [];
  setCachedContent('lessons', lessons);
  return lessons;
}

async function fetchCountryLessons() {
  const cached = getCachedContent('country_lessons');
  if (cached) return cached;
  const { data } = await supabaseClient.from('country_lessons').select('*').eq('published', true).order('lesson_number');
  const lessons = data || [];
  setCachedContent('country_lessons', lessons);
  return lessons;
}

// Flashcard banks are fetched on-demand (picking a test type), not on page
// load, but the full 100/128-card bank is the heaviest payload in the app
// and gets re-fetched every time someone starts a new session.
async function fetchFlashcardBank(testType) {
  const cacheKey = 'flashcards:' + testType;
  const cached = getCachedContent(cacheKey);
  if (cached) return { data: cached, error: null };
  const { data, error } = await supabaseClient.from('flashcards').select('*').eq('test_type', testType).eq('published', true).order('sort_order');
  if (error || !data) return { data: null, error };
  setCachedContent(cacheKey, data);
  return { data, error: null };
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
// already-escaped text, so it's safe, the * characters survive escapeHtml
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
// is rendered as a subheading instead of a paragraph, this lets longer,
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

// `linkable` turns each module circle into a click target that jumps to
// that module's first lesson, same destination the sidebar module nav
// already uses -- so numbers 1-7 on the Dashboard's "Your Path" row take
// you straight to that stage instead of being purely decorative. Locked
// modules stay non-interactive (matches renderModuleNav's lock treatment).
function renderStampPath(selector, lessons, completedIds, currentLesson, small, linkable) {
  const container = document.querySelector(selector);
  if (!container) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const lockedWord = lang === 'es' ? 'Bloqueado' : 'Locked';
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
    const unlocked = hasLessons && isModuleUnlocked(m, lessons, completedIds);
    let circleHtml;
    if (linkable && unlocked) {
      const firstLesson = moduleLessons[0];
      circleHtml = `<a href="lesson.html?id=${firstLesson.id}" class="stamp-circle${circleClass}" aria-label="${escapeHtml(moduleName(m))}">${m}</a>`;
    } else if (linkable && hasLessons) {
      circleHtml = `<span class="stamp-circle${circleClass} stamp-circle-locked" title="${lockedWord}" aria-label="${lockedWord}: ${escapeHtml(moduleName(m))}">${m}</span>`;
    } else {
      circleHtml = `<div class="stamp-circle${circleClass}">${m}</div>`;
    }
    html += `<div class="stamp-item">${circleHtml}${label}</div>`;
    if (m < TOTAL_MODULES) html += `<div class="stamp-connector${allDone ? ' done' : ''}"></div>`;
  }
  container.innerHTML = html;
}

// ---- Sequential module/lesson locking ----------------------------------
// A module is "complete" once every one of its lessons has a lesson_progress
// row. Because the module quiz already gates the final lesson of a module
// from being marked complete until it's passed (see initLessonPage), this
// single check also implies "that module's quiz was passed", no separate
// module_quiz_results lookup is needed just to decide lock state.
function isModuleComplete(moduleLessons, completedIds) {
  return moduleLessons.length > 0 && moduleLessons.every((l) => completedIds.has(l.id));
}

// Module 1 is always unlocked. Module m (m>1) unlocks once module m-1 is
// fully complete. A module with no lessons yet (not authored) doesn't block
// the next one.
function isModuleUnlocked(m, lessons, completedIds) {
  if (m <= 1) return true;
  const prevLessons = lessons.filter((l) => l.module_number === m - 1);
  if (!prevLessons.length) return true;
  return isModuleComplete(prevLessons, completedIds);
}

// Within an unlocked module, the first lesson is always unlocked; each
// subsequent lesson requires the immediately-preceding lesson (by
// sort_order) in that same module to be complete.
function isLessonUnlocked(lesson, lessons, completedIds) {
  if (!isModuleUnlocked(lesson.module_number, lessons, completedIds)) return false;
  const moduleLessons = lessons.filter((l) => l.module_number === lesson.module_number).sort((a, b) => a.sort_order - b.sort_order);
  const idx = moduleLessons.findIndex((l) => l.id === lesson.id);
  if (idx <= 0) return true;
  return completedIds.has(moduleLessons[idx - 1].id);
}

// Finds the first lesson (in overall module/sort_order) the learner hasn't
// finished yet, among lessons that are actually unlocked, used to redirect
// away from a locked lesson someone reached via a stale/typed-in URL.
function firstAvailableLesson(lessons, completedIds) {
  const sorted = lessons.slice().sort((a, b) => (a.module_number - b.module_number) || (a.sort_order - b.sort_order));
  return sorted.find((l) => !completedIds.has(l.id) && isLessonUnlocked(l, lessons, completedIds)) || null;
}

// Small line-art padlock (Feather-style) used for locked modules/lessons,
// swapped in for the 🔒 emoji, which read as tacky/out of place against the
// site's flat, minimal iconography. currentColor lets it inherit whatever
// muted color the surrounding locked badge/check already uses.
// aria-hidden since its meaning (locked) is always paired with a
// .sr-only text label wherever it's used below, real text a screen
// reader can announce rather than relying on the icon itself.
const LOCK_ICON_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

function renderModuleNav(selector, lessons, completedIds, expandLesson) {
  const nav = document.querySelector(selector);
  if (!nav) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const comingSoon = lang === 'es' ? 'Próximamente' : 'Coming soon';
  const lockedWord = lang === 'es' ? 'Bloqueado' : 'Locked';
  let html = '';
  for (let m = 1; m <= TOTAL_MODULES; m++) {
    const moduleLessons = lessons.filter((l) => l.module_number === m);
    if (!moduleLessons.length) {
      html += `<li style="padding:10px 24px; font-size:0.92rem; color:var(--slate);">${m}. ${escapeHtml(moduleName(m))} <span class="small muted">${comingSoon}</span></li>`;
      continue;
    }
    const allDone = moduleLessons.every((l) => completedIds.has(l.id));
    const unlocked = isModuleUnlocked(m, lessons, completedIds);
    const isExpanded = expandLesson && expandLesson.module_number === m;
    const firstLesson = moduleLessons[0];
    const lessonWord = lang === 'es' ? 'Lección' : 'Lesson';

    const doneWord = lang === 'es' ? 'Completado' : 'Completed';

    if (!unlocked) {
      html += `<li><span class="module-nav-link module-nav-locked" title="${lockedWord}"><span class="module-nav-badge locked">${LOCK_ICON_SVG}</span><span class="sr-only">${lockedWord}: </span>${escapeHtml(moduleName(m))}</span></li>`;
      continue;
    }

    html += `<li><a href="lesson.html?id=${firstLesson.id}" class="module-nav-link ${isExpanded ? 'active' : ''}"><span class="module-nav-badge${allDone ? ' done' : ''}" aria-hidden="true">${allDone ? '✓' : m}</span><span class="sr-only">${lang === 'es' ? 'Módulo' : 'Module'} ${m}${allDone ? ', ' + doneWord.toLowerCase() : ''}: </span>${escapeHtml(moduleName(m))}</a>`;
    if (isExpanded) {
      html += '<ul class="lesson-sub-list">';
      moduleLessons.forEach((l, i) => {
        const done = completedIds.has(l.id);
        const isCurrent = expandLesson.id === l.id;
        const lUnlocked = isLessonUnlocked(l, lessons, completedIds);
        if (!lUnlocked) {
          html += `<li><span class="lesson-sub-locked" title="${lockedWord}"><span class="check locked">${LOCK_ICON_SVG}</span><span class="lesson-sub-text"><span class="sr-only">${lockedWord}: </span><span class="lesson-sub-label">${lessonWord} ${i + 1}</span><span class="lesson-sub-title">${escapeHtml(localize(l, 'title'))}</span></span></span></li>`;
          return;
        }
        html += `<li><a href="lesson.html?id=${l.id}" class="${isCurrent ? 'current' : ''}"><span class="check${done ? ' done' : ''}" aria-hidden="true">${done ? '✓' : ''}</span><span class="lesson-sub-text"><span class="sr-only">${done ? doneWord + ': ' : ''}</span><span class="lesson-sub-label">${lessonWord} ${i + 1}</span><span class="lesson-sub-title">${escapeHtml(localize(l, 'title'))}</span></span></a></li>`;
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
  ].filter(([, text]) => text && String(text).trim()));
  const optionsHtml = choices.map(([key, text]) => `<button class="quiz-option" data-correct="${key === q.correct_choice ? 'true' : 'false'}">${escapeHtml(text)}</button>`).join('');
  const label = lang === 'es' ? 'PREGUNTA DE PRÁCTICA' : 'PRACTICE QUESTION';
  const correctMsg = lang === 'es' ? '¡Correcto!' : 'Correct!';
  const incorrectMsg = lang === 'es' ? 'No es correcto. Revisa la respuesta resaltada.' : 'Not quite. Review the highlighted answer.';
  return `<div class="quiz-box" data-question-id="${q.id}">
    <span class="badge" style="margin-bottom:12px; display:inline-block;">${label}</span>
    <h3 style="font-family:var(--font-sans); font-size:1.05rem;">${escapeHtml(localize(q, 'question'))}</h3>
    ${optionsHtml}
    <div class="quiz-feedback" data-correct-msg="${escapeHtml(correctMsg)}" data-incorrect-msg="${escapeHtml(incorrectMsg)}"></div>
  </div>`;
}

// ---- Billing / paywall banner (shown when a profile hasn't paid) -------
const BILLING_BANNER_LABELS = {
  en: {
    past_due: {
      eyebrow: 'PAYMENT ISSUE',
      title: "There's a problem with your payment",
      message: "We couldn't process your last payment. Update your billing details to keep your course access.",
    },
    canceled: {
      eyebrow: 'SUBSCRIPTION ENDED',
      title: 'Your plan has ended',
      message: 'Choose a plan below to pick up right where you left off.',
    },
    default: {
      eyebrow: 'FINISH SIGNING UP',
      title: 'One step left: choose a plan',
      message: "Your account is set up, but you haven't completed payment yet. Choose a plan to unlock the full course.",
    },
    yearly: '2-Year Plan – $199.99',
    monthly: 'Monthly – $19.99/mo',
    manage: 'Manage Billing',
  },
  es: {
    past_due: {
      eyebrow: 'PROBLEMA DE PAGO',
      title: 'Hay un problema con tu pago',
      message: 'No pudimos procesar tu último pago. Actualiza tus datos de facturación para conservar el acceso al curso.',
    },
    canceled: {
      eyebrow: 'SUSCRIPCIÓN FINALIZADA',
      title: 'Tu plan ha finalizado',
      message: 'Elige un plan abajo para retomar justo donde lo dejaste.',
    },
    default: {
      eyebrow: 'FALTA UN PASO',
      title: 'Un paso más: elige un plan',
      message: 'Tu cuenta ya está creada, pero aún no completaste el pago. Elige un plan para desbloquear el curso completo.',
    },
    yearly: 'Plan de 2 Años – $199.99',
    monthly: 'Mensual – $19.99/mes',
    manage: 'Administrar Facturación',
  },
};

// Kept so the banner can be re-rendered in the new language if the visitor
// toggles EN/ES while it's showing.
let billingBannerStatus = undefined;

function showBillingBanner(status) {
  billingBannerStatus = status;
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

  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const bl = BILLING_BANNER_LABELS[lang] || BILLING_BANNER_LABELS.en;
  const copy = (status === 'past_due' || status === 'canceled') ? bl[status] : bl.default;
  eyebrow.textContent = copy.eyebrow;
  title.textContent = copy.title;
  message.textContent = copy.message;

  if (status === 'past_due') {
    planButtons.style.display = 'none';
    manageBtn.style.display = 'inline-flex';
  } else {
    planButtons.style.display = 'flex';
    manageBtn.style.display = 'none';
  }

  const monthlyBtn = document.querySelector('#billing-choose-monthly');
  const yearlyBtn = document.querySelector('#billing-choose-2year');
  if (monthlyBtn) { monthlyBtn.textContent = bl.monthly; monthlyBtn.onclick = () => window.startCheckoutRedirect('monthly', monthlyBtn); }
  if (yearlyBtn) { yearlyBtn.textContent = bl.yearly; yearlyBtn.onclick = () => window.startCheckoutRedirect('2year', yearlyBtn); }
  if (manageBtn) { manageBtn.textContent = bl.manage; manageBtn.onclick = () => window.openBillingPortal(manageBtn); }
}

// Re-renders the billing banner in place (used on langchange) without
// touching which status it's showing.
function reshowBillingBannerIfVisible() {
  const banner = document.querySelector('#dashboard-billing-banner');
  if (banner && banner.style.display !== 'none' && billingBannerStatus !== undefined) {
    showBillingBanner(billingBannerStatus);
  }
}

const CHECKOUT_NOTICE_LABELS = {
  en: {
    success: {
      eyebrow: 'PAYMENT RECEIVED',
      title: 'Welcome in! 🎉',
      body: "Your payment went through. It can take a few seconds to unlock. Refresh if the course doesn't appear right away.",
    },
    cancelled: {
      eyebrow: 'CHECKOUT CANCELLED',
      title: 'No charge was made',
      body: "You can pick a plan below whenever you're ready.",
    },
  },
  es: {
    success: {
      eyebrow: 'PAGO RECIBIDO',
      title: '¡Bienvenido! 🎉',
      body: 'Tu pago se procesó correctamente. Puede tardar unos segundos en desbloquearse. Actualiza la página si el curso no aparece de inmediato.',
    },
    cancelled: {
      eyebrow: 'PAGO CANCELADO',
      title: 'No se realizó ningún cargo',
      body: 'Puedes elegir un plan abajo cuando estés listo.',
    },
  },
};

// Reads the ?checkout= URL param once, remembers the result in
// checkoutNoticeState, and cleans the URL so refreshing doesn't keep
// re-showing the banner. Call renderCheckoutNotice() to (re-)paint it.
function showCheckoutNotice() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (checkout === 'success' || checkout === 'cancelled') {
    checkoutNoticeState = checkout;
    window.history.replaceState({}, '', window.location.pathname);
  }
  renderCheckoutNotice();
}

// Paints #dashboard-checkout-notice from checkoutNoticeState in the
// current language. Safe to call repeatedly (e.g. on langchange).
function renderCheckoutNotice() {
  const notice = document.querySelector('#dashboard-checkout-notice');
  if (!notice || !checkoutNoticeState) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const cl = (CHECKOUT_NOTICE_LABELS[lang] || CHECKOUT_NOTICE_LABELS.en)[checkoutNoticeState];
  if (!cl) return;
  notice.style.display = 'block';
  notice.innerHTML = `<span class="eyebrow">${escapeHtml(cl.eyebrow)}</span><h3 style="margin-top:6px;">${escapeHtml(cl.title)}</h3><p class="small" style="margin:0;">${escapeHtml(cl.body)}</p>`;
}

// Progress % weighted by how much is actually in each module, instead of
// a flat "completed lessons / total lessons" ratio. A lesson's "weight" is
// its content length in characters (a genuine proxy for how much reading/
// study it represents), plus a fixed chunk of weight for that lesson's
// video (once it has one) and for its module's quiz (once published),
// both only counted as "earned" when the video's lesson is completed /
// the quiz is passed, not just because they exist.
async function computeWeightedProgress(userId, lessons, completedIds) {
  const [{ data: quizRows }, { data: passedRows }] = await Promise.all([
    supabaseClient.from('quiz_questions').select('module_number').eq('published', true),
    // module_quiz_attempts holds one row per attempt now (not one per
    // module), the Set below still collapses that fine, since we only
    // care whether a module has ANY passing attempt, ever.
    supabaseClient.from('module_quiz_attempts').select('module_number, passed').eq('user_id', userId),
  ]);

  const quizCountByModule = {};
  (quizRows || []).forEach((q) => {
    quizCountByModule[q.module_number] = (quizCountByModule[q.module_number] || 0) + 1;
  });
  const passedModules = new Set((passedRows || []).filter((r) => r.passed).map((r) => r.module_number));

  let totalWeight = 0;
  let doneWeight = 0;
  const modulesSeen = new Set();

  lessons.forEach((l) => {
    const contentWeight = Math.max((l.content || '').length, 1);
    const videoWeight = l.video_url ? VIDEO_CHARS_EQUIVALENT : 0;
    totalWeight += contentWeight + videoWeight;
    if (completedIds.has(l.id)) doneWeight += contentWeight + videoWeight;
    modulesSeen.add(l.module_number);
  });

  modulesSeen.forEach((m) => {
    const qCount = quizCountByModule[m] || 0;
    if (!qCount) return;
    const quizWeight = qCount * QUIZ_CHARS_PER_QUESTION;
    totalWeight += quizWeight;
    if (passedModules.has(m)) doneWeight += quizWeight;
  });

  return totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0;
}

// ---- Dashboard --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let dashboardCache = null;
// 'success' | 'cancelled' | null, set once from the ?checkout= URL param,
// kept around so the notice can be re-rendered in the new language if the
// visitor toggles EN/ES (the URL param itself gets stripped immediately).
let checkoutNoticeState = null;

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

  renderStampPath('#dashboard-stamp-path', lessons, completedIds, currentLesson, false, true);
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
          const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
          const original = resendBtn.textContent;
          resendBtn.disabled = true;
          resendBtn.textContent = lang === 'es' ? 'Enviando…' : 'Sending…';
          const { data: resendData, error: resendError } = await supabaseClient.rpc('resend_verification_email');
          resendBtn.disabled = false;
          if (resendError || !resendData || !resendData.ok) {
            resendBtn.textContent = original;
            const fallback = lang === 'es' ? 'No se pudo reenviar el correo.' : 'Could not resend email.';
            alert((resendData && resendData.error) || (resendError && resendError.message) || fallback);
          } else {
            resendBtn.textContent = lang === 'es' ? '¡Enviado!' : 'Sent!';
            setTimeout(() => { resendBtn.textContent = original; }, 4000);
          }
        };
      }
    }
  }

  const [lessons, { data: progressRows }] = await Promise.all([
    fetchPublishedLessons(),
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
  const pct = await computeWeightedProgress(userId, lessons, completedIds);

  document.querySelector('#stat-progress-pct').textContent = pct + '%';
  document.querySelector('#stat-progress-bar').style.width = pct + '%';

  const streak = (profile && profile.streak_count) || 0;
  dashboardCache = { lessons, completedIds, streak };
  renderDashboard();
}

// ---- Module quiz (submit-and-grade, shown only on the last lesson of a
// module, gates that lesson's "Mark Complete") -----------------------------
// Distinct from buildQuizBoxHtml (the older instant-feedback single-question
// widget still used elsewhere): this renders every quiz question for the
// whole module at once as a real form, only reveals right/wrong after the
// member submits, and requires MODULE_QUIZ_PASS_RATIO correct to pass.
const MODULE_QUIZ_LABELS = {
  en: {
    instructions: (n) => `Answer all ${n} question${n === 1 ? '' : 's'}, then submit. You need ${Math.round(MODULE_QUIZ_PASS_RATIO * 100)}% correct to pass and complete this module.`,
    submit: 'Submit Quiz', passTitle: (s, t) => `Passed! ${s}/${t} correct.`, failTitle: (s, t) => `Not quite: ${s}/${t} correct.`,
    failBody: 'Review the highlighted answers below, then try again.', retry: 'Retry Quiz', unanswered: 'Please answer every question before submitting.',
    completed: 'Completed', notPassing: 'Not yet passing', bestScore: 'Best Score', attempts: 'Attempts', lastPracticed: 'Last Practiced',
    reviewAnswers: 'Review Answers', retakeQuiz: 'Retake Quiz', yourAnswer: 'Your answer:', correctAnswer: 'Correct answer:',
    noAnswerDetail: "Answer detail wasn't recorded for this attempt.", back: '← Back',
    yourAnswerCorrect: 'Correct', yourAnswerIncorrect: 'Incorrect',
    optionCorrectMark: 'Correct answer', optionIncorrectMark: 'Your answer, incorrect',
  },
  es: {
    instructions: (n) => `Responde las ${n} preguntas y envía tus respuestas. Necesitas ${Math.round(MODULE_QUIZ_PASS_RATIO * 100)}% correctas para aprobar y completar este módulo.`,
    submit: 'Enviar Cuestionario', passTitle: (s, t) => `¡Aprobado! ${s}/${t} correctas.`, failTitle: (s, t) => `Aún no: ${s}/${t} correctas.`,
    failBody: 'Revisa las respuestas resaltadas abajo e inténtalo de nuevo.', retry: 'Reintentar Cuestionario', unanswered: 'Por favor responde todas las preguntas antes de enviar.',
    completed: 'Completado', notPassing: 'Aún no aprobado', bestScore: 'Mejor Puntaje', attempts: 'Intentos', lastPracticed: 'Última Práctica',
    reviewAnswers: 'Revisar Respuestas', retakeQuiz: 'Reintentar Cuestionario', yourAnswer: 'Tu respuesta:', correctAnswer: 'Respuesta correcta:',
    noAnswerDetail: 'No se registró el detalle de respuestas para este intento.', back: '← Volver',
    yourAnswerCorrect: 'Correcta', yourAnswerIncorrect: 'Incorrecta',
    optionCorrectMark: 'Respuesta correcta', optionIncorrectMark: 'Tu respuesta, incorrecta',
  },
};

function buildModuleQuizHtml(quizQs) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
  const questionsHtml = quizQs.map((q, i) => {
    // True/False questions only have 2 real answers, choice_c/choice_d are
    // left blank (null) for those rather than padded with a placeholder
    // like "N/A", so filter out any choice with no text before rendering.
    const choices = shuffleArray([
      ['a', localize(q, 'choice_a')],
      ['b', localize(q, 'choice_b')],
      ['c', localize(q, 'choice_c')],
      ['d', localize(q, 'choice_d')],
    ].filter(([, text]) => text && String(text).trim()));
    const optionsHtml = choices.map(([key, text]) => `
      <label class="module-quiz-option" data-key="${key}">
        <input type="radio" name="mq-${q.id}" value="${key}">
        <span>${escapeHtml(text)}</span>
        <span class="module-quiz-option-mark" aria-hidden="true"></span>
        <span class="sr-only module-quiz-option-mark-sr"></span>
      </label>`).join('');
    return `<div class="module-quiz-q" data-question-id="${q.id}" data-correct="${q.correct_choice}">
      <h4>${i + 1}. ${escapeHtml(localize(q, 'question'))}</h4>
      <div class="module-quiz-options">${optionsHtml}</div>
    </div>`;
  }).join('');

  return `<p class="small muted" style="margin-bottom:18px;">${ml.instructions(quizQs.length)}</p>
    <form id="module-quiz-form">${questionsHtml}
      <div id="module-quiz-result"></div>
      <button type="submit" class="btn btn-primary" id="module-quiz-submit-btn">${ml.submit}</button>
    </form>`;
}

// Wires the submit handler for a rendered module quiz, grades it client-side
// against each question's data-correct attribute, and inserts a new row into
// module_quiz_attempts (never upserts/overwrites, every submission is kept
// as its own historical attempt, with the actual choice picked for each
// question, so Review can show real answers later and a bad retake never
// erases a prior pass). Calls onGraded(passed) so the caller can unlock
// "Mark Complete".
function bindModuleQuiz(wrapEl, moduleNumber, userId, onGraded) {
  const form = wrapEl.querySelector('#module-quiz-form');
  if (!form) return;
  const submitBtn = form.querySelector('#module-quiz-submit-btn');
  const resultEl = form.querySelector('#module-quiz-result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
    const qBlocks = Array.from(form.querySelectorAll('.module-quiz-q'));

    const unanswered = qBlocks.some((block) => !form.querySelector(`input[name="mq-${block.getAttribute('data-question-id')}"]:checked`));
    if (unanswered) {
      resultEl.innerHTML = `<div class="module-quiz-result-banner fail">${escapeHtml(ml.unanswered)}</div>`;
      smoothScrollIntoView(resultEl, { block: 'center' });
      return;
    }

    let correctCount = 0;
    const answersPayload = [];
    qBlocks.forEach((block) => {
      const qid = block.getAttribute('data-question-id');
      const correctKey = block.getAttribute('data-correct');
      const checked = form.querySelector(`input[name="mq-${qid}"]:checked`);
      const isCorrect = checked && checked.value === correctKey;
      if (isCorrect) correctCount += 1;
      answersPayload.push({ question_id: qid, selected_choice: checked ? checked.value : null, correct: !!isCorrect });
      block.querySelectorAll('.module-quiz-option').forEach((opt) => {
        opt.classList.remove('correct', 'incorrect');
        const mark = opt.querySelector('.module-quiz-option-mark');
        const markSr = opt.querySelector('.module-quiz-option-mark-sr');
        // Correctness here is never color-only: each highlighted option
        // also gets a ✓/✗ glyph and a screen-reader-only label, so it
        // still reads correctly for colorblind users and screen readers.
        if (opt.getAttribute('data-key') === correctKey) {
          opt.classList.add('correct');
          if (mark) mark.textContent = '✓';
          if (markSr) markSr.textContent = ml.optionCorrectMark;
        } else if (checked && opt.getAttribute('data-key') === checked.value) {
          opt.classList.add('incorrect');
          if (mark) mark.textContent = '✗';
          if (markSr) markSr.textContent = ml.optionIncorrectMark;
        }
      });
      form.querySelectorAll(`input[name="mq-${qid}"]`).forEach((r) => { r.disabled = true; });
    });

    const total = qBlocks.length;
    const passed = correctCount >= Math.ceil(total * MODULE_QUIZ_PASS_RATIO);

    submitBtn.disabled = true;
    submitBtn.textContent = ml.retry;
    submitBtn.type = 'button';
    submitBtn.onclick = () => { renderLessonPage(); };

    resultEl.innerHTML = `<div class="module-quiz-result-banner ${passed ? 'pass' : 'fail'}">
      <strong>${passed ? ml.passTitle(correctCount, total) : ml.failTitle(correctCount, total)}</strong>
      ${passed ? '' : `<p style="margin:6px 0 0;">${escapeHtml(ml.failBody)}</p>`}
    </div>`;

    const { data: inserted } = await supabaseClient.from('module_quiz_attempts')
      .insert({ user_id: userId, module_number: moduleNumber, score: correctCount, total, passed, answers: answersPayload })
      .select().single();

    if (lessonCache) {
      const newAttempt = inserted || { module_number: moduleNumber, score: correctCount, total, passed, answers: answersPayload, created_at: new Date().toISOString() };
      lessonCache.moduleQuizAttempts = [...(lessonCache.moduleQuizAttempts || []), newAttempt];
      // onGraded() below triggers a re-render of the whole lesson page (to
      // unlock the "Mark Complete" button etc.), which would otherwise
      // immediately rebuild this quiz form from scratch, wiping out the
      // per-question right/wrong highlighting and pass/fail banner we just
      // set above the instant the member submits. This flag tells
      // renderLessonPage to leave the just-graded quiz DOM alone for that
      // one render pass instead of rebuilding it.
      lessonCache.quizJustGraded = true;
    }
    if (onGraded) onGraded(passed);
  });
}

// ---- Module quiz stats card + Review mode (shown once there's at least
// one prior attempt) --------------------------------------------------
// "Best" is ranked by percentage correct so quizzes with a different
// question count stay comparable; ties keep the earliest attempt.
function bestModuleQuizAttempt(attempts) {
  return attempts.reduce((best, a) => {
    const pct = a.total ? a.score / a.total : 0;
    const bestPct = best && best.total ? best.score / best.total : -1;
    return pct > bestPct ? a : best;
  }, null);
}

function buildModuleQuizStatsCardHtml(attempts, lang) {
  const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
  const latest = attempts[attempts.length - 1];
  const best = bestModuleQuizAttempt(attempts);
  const passed = attempts.some((a) => a.passed);
  const bestPct = best.total ? Math.round((best.score / best.total) * 100) : 0;
  const dateFmt = (iso) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `<div class="module-quiz-stats-card">
    <span class="badge ${passed ? 'badge-forest' : ''}" style="${passed ? '' : 'border-color:var(--danger); color:var(--danger);'}">${passed ? '✓ ' + escapeHtml(ml.completed) : escapeHtml(ml.notPassing)}</span>
    <div class="module-quiz-stats-grid">
      <div class="module-quiz-stat"><span class="module-quiz-stat-label">${escapeHtml(ml.bestScore)}</span><span class="module-quiz-stat-value">${best.score}/${best.total} (${bestPct}%)</span></div>
      <div class="module-quiz-stat"><span class="module-quiz-stat-label">${escapeHtml(ml.attempts)}</span><span class="module-quiz-stat-value">${attempts.length}</span></div>
      <div class="module-quiz-stat"><span class="module-quiz-stat-label">${escapeHtml(ml.lastPracticed)}</span><span class="module-quiz-stat-value">${dateFmt(latest.created_at)}</span></div>
    </div>
    <div class="flex gap-8" style="margin-top:16px; flex-wrap:wrap;">
      <button type="button" class="btn btn-ghost btn-sm" id="module-quiz-review-btn">${escapeHtml(ml.reviewAnswers)}</button>
      <button type="button" class="btn btn-primary btn-sm" id="module-quiz-retake-btn">${escapeHtml(ml.retakeQuiz)}</button>
    </div>
  </div>`;
}

// Read-only review of one attempt's actual selected answers, matched back
// against the live quiz_questions rows by id. Attempts migrated from the
// old score-only table (or any future edge case with no answers[]) fall
// back to a "not available" note instead of an empty list.
function buildModuleQuizReviewHtml(attempt, quizQs, lang) {
  const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
  const qById = {};
  quizQs.forEach((q) => { qById[q.id] = q; });
  const answers = attempt.answers || [];
  const itemsHtml = answers.length ? answers.map((a, i) => {
    const q = qById[a.question_id];
    if (!q) return '';
    const choiceText = (key) => (key ? localize(q, 'choice_' + key) : '');
    const isCorrect = a.selected_choice === q.correct_choice;
    return `<div class="module-quiz-review-item">
      <div class="module-quiz-review-icon ${isCorrect ? 'correct' : 'incorrect'}" aria-hidden="true">${isCorrect ? '✓' : '✗'}</div>
      <div>
        <p class="module-quiz-review-question"><span class="sr-only">${isCorrect ? ml.yourAnswerCorrect : ml.yourAnswerIncorrect}: </span>${i + 1}. ${escapeHtml(localize(q, 'question'))}</p>
        <p class="module-quiz-review-answer">${escapeHtml(ml.yourAnswer)} <strong>${escapeHtml(choiceText(a.selected_choice))}</strong></p>
        ${!isCorrect ? `<p class="module-quiz-review-answer correct-answer">${escapeHtml(ml.correctAnswer)} <strong>${escapeHtml(choiceText(q.correct_choice))}</strong></p>` : ''}
      </div>
    </div>`;
  }).join('') : `<p class="small muted">${escapeHtml(ml.noAnswerDetail)}</p>`;

  return `<div class="module-quiz-result-banner ${attempt.passed ? 'pass' : 'fail'}">
      <strong>${attempt.passed ? ml.passTitle(attempt.score, attempt.total) : ml.failTitle(attempt.score, attempt.total)}</strong>
    </div>
    ${itemsHtml}
    <div class="flex gap-8" style="margin-top:16px; flex-wrap:wrap;">
      <button type="button" class="btn btn-ghost btn-sm" id="module-quiz-review-back-btn">${escapeHtml(ml.back)}</button>
      <button type="button" class="btn btn-primary btn-sm" id="module-quiz-retake-btn">${escapeHtml(ml.retakeQuiz)}</button>
    </div>`;
}

function showModuleQuizStats(quizWrap, moduleQuizQs, moduleNumber, userId, attempts) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  quizWrap.innerHTML = buildModuleQuizStatsCardHtml(attempts, lang);
  const reviewBtn = quizWrap.querySelector('#module-quiz-review-btn');
  const retakeBtn = quizWrap.querySelector('#module-quiz-retake-btn');
  if (reviewBtn) reviewBtn.onclick = () => showModuleQuizReview(quizWrap, moduleQuizQs, moduleNumber, userId, attempts);
  if (retakeBtn) retakeBtn.onclick = () => {
    quizWrap.innerHTML = buildModuleQuizHtml(moduleQuizQs);
    bindModuleQuiz(quizWrap, moduleNumber, userId, () => renderLessonPage());
  };
}

function showModuleQuizReview(quizWrap, moduleQuizQs, moduleNumber, userId, attempts) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const latest = attempts[attempts.length - 1];
  quizWrap.innerHTML = buildModuleQuizReviewHtml(latest, moduleQuizQs, lang);
  const backBtn = quizWrap.querySelector('#module-quiz-review-back-btn');
  const retakeBtn = quizWrap.querySelector('#module-quiz-retake-btn');
  if (backBtn) backBtn.onclick = () => showModuleQuizStats(quizWrap, moduleQuizQs, moduleNumber, userId, attempts);
  if (retakeBtn) retakeBtn.onclick = () => {
    quizWrap.innerHTML = buildModuleQuizHtml(moduleQuizQs);
    bindModuleQuiz(quizWrap, moduleNumber, userId, () => renderLessonPage());
  };
}

// ---- Lesson page --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let lessonCache = null;

function renderLessonPage() {
  if (!lessonCache) return;
  const { lessons, lesson, completedIds, moduleQuizQs, moduleQuizAttempts, isLastLessonOfModule, userId } = lessonCache;
  const quizAttempts = moduleQuizAttempts || [];
  const quizViewActive = !!lessonCache.quizViewActive;

  const pageLang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const stageWord = pageLang === 'es' ? 'ETAPA' : 'STAGE';
  const ofWord = pageLang === 'es' ? 'DE' : 'OF';
  const lessonWord = pageLang === 'es' ? 'LECCIÓN' : 'LESSON';

  document.querySelector('#lesson-stage-eyebrow').textContent = `${stageWord} ${lesson.module_number} ${ofWord} ${TOTAL_MODULES}`;
  document.querySelector('#lesson-stage-title').textContent = moduleName(lesson.module_number);
  document.title = `Stage ${lesson.module_number}: ${moduleName(lesson.module_number)} | Ciudadano Ready`;

  renderStampPath('#lesson-stamp-path', lessons, completedIds, lesson, true);

  const moduleLessons = lessons.filter((l) => l.module_number === lesson.module_number);
  const idxInModule = moduleLessons.findIndex((l) => l.id === lesson.id);
  document.querySelector('#lesson-badge').textContent = `${lessonWord} ${idxInModule + 1} ${ofWord} ${moduleLessons.length}`;
  document.querySelector('#lesson-title-h1').textContent = localize(lesson, 'title');

  document.querySelector('#lesson-content').innerHTML = renderLessonBody(localize(lesson, 'content'));

  const requiresQuizPass = isLastLessonOfModule && moduleQuizQs && moduleQuizQs.length > 0;
  // Once passed, always passed, a later low-scoring practice retake never
  // un-completes the module (matches "never reset completion" below).
  const alreadyPassedQuiz = quizAttempts.some((a) => a.passed);

  // Reading view (video + Study Guide) and the quiz are two separate
  // "screens" of this page, never shown together, so a lesson with a
  // module quiz doesn't turn into one long scroll of content stacked on
  // top of a quiz. quizViewActive flips between them; see the "Take Module
  // Quiz" / "← Back to Lesson" wiring below.
  const readingView = document.querySelector('#lesson-reading-view');
  const showReading = !(requiresQuizPass && quizViewActive);
  readingView.style.display = showReading ? 'block' : 'none';

  if (showReading) {
    const videoWrap = document.querySelector('#lesson-video-wrap');
    const videoPlaceholder = document.querySelector('#lesson-video-placeholder');
    if (lesson.video_url) {
      videoWrap.style.display = 'block';
      videoWrap.innerHTML = buildVideoEmbed(lesson.video_url);
      videoPlaceholder.style.display = 'none';
    } else if (lesson.no_video) {
      // This lesson isn't getting a video at all (audio narration planned
      // instead), so skip the "coming soon" placeholder entirely rather
      // than promising something that isn't coming.
      videoWrap.style.display = 'none';
      videoWrap.innerHTML = '';
      videoPlaceholder.style.display = 'none';
    } else {
      videoWrap.style.display = 'none';
      videoWrap.innerHTML = '';
      videoPlaceholder.style.display = 'flex';
    }
  }

  const quizSection = document.querySelector('#lesson-quiz-section');
  const quizWrap = document.querySelector('#lesson-quiz-wrap');
  const quizBackLink = document.querySelector('#lesson-quiz-back-link');

  if (requiresQuizPass && quizViewActive) {
    quizSection.style.display = 'block';
    if (quizBackLink) {
      quizBackLink.onclick = (e) => { e.preventDefault(); lessonCache.quizViewActive = false; renderLessonPage(); smoothScrollTo({ top: 0 }); };
    }
    if (lessonCache.quizJustGraded) {
      // The quiz was just submitted, bindModuleQuiz already painted the
      // graded state (per-question correct/incorrect highlighting, the
      // pass/fail banner, disabled inputs) directly into quizWrap. Leave it
      // exactly as-is here instead of rebuilding, or that feedback vanishes
      // the instant the member sees it. Consumed once so the next render
      // (retry, back-to-lesson, revisit) rebuilds normally again.
      lessonCache.quizJustGraded = false;
    } else if (quizAttempts.length > 0) {
      // Prior attempt(s) exist, show the stats summary (best score,
      // attempt count, last practiced) with Review Answers / Retake Quiz,
      // instead of either a bare pass note or silently dropping them into
      // a blank quiz.
      showModuleQuizStats(quizWrap, moduleQuizQs, lesson.module_number, userId, quizAttempts);
    } else {
      quizWrap.innerHTML = buildModuleQuizHtml(moduleQuizQs);
      bindModuleQuiz(quizWrap, lesson.module_number, userId, () => renderLessonPage());
    }
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
  const statusLine = document.querySelector('#lesson-quiz-status-line');
  const alreadyDone = completedIds.has(lesson.id);
  // Three states for the bottom button when this lesson gates on a quiz:
  // not started yet (button becomes the entry point into quiz view),
  // actively taking it (button hides, the quiz form has its own submit),
  // or passed (button behaves exactly like a normal lesson's).
  const needsToTakeQuiz = requiresQuizPass && !alreadyPassedQuiz;
  const hideNextLink = needsToTakeQuiz && quizViewActive;
  const labels = {
    en: { next: 'Next Lesson →', markContinue: 'Mark Complete & Continue →', back: 'Back to Dashboard', markFinish: 'Mark Complete & Finish ✓', takeQuiz: 'Take Module Quiz →', intro: (n, pct) => `This module ends with a short quiz: ${n} questions, ${pct}% to pass.`, review: 'Review' },
    es: { next: 'Siguiente lección →', markContinue: 'Marcar completado y continuar →', back: 'Volver al panel', markFinish: 'Marcar completado y finalizar ✓', takeQuiz: 'Tomar Cuestionario del Módulo →', intro: (n, pct) => `Este módulo termina con un cuestionario corto: ${n} preguntas, ${pct}% para aprobar.`, review: 'Revisar' },
  };
  const l = labels[lang] || labels.en;

  nextLink.style.display = hideNextLink ? 'none' : 'inline-flex';
  if (!hideNextLink) {
    nextLink.textContent = needsToTakeQuiz ? l.takeQuiz : (nextLesson
      ? (alreadyDone ? l.next : l.markContinue)
      : (alreadyDone ? l.back : l.markFinish));
    nextLink.onclick = async (e) => {
      e.preventDefault();
      if (needsToTakeQuiz) {
        lessonCache.quizViewActive = true;
        renderLessonPage();
        smoothScrollTo({ top: 0 });
        return;
      }
      nextLink.setAttribute('aria-busy', 'true');
      if (!alreadyDone) {
        await supabaseClient.from('lesson_progress').upsert(
          { user_id: userId, lesson_id: lesson.id },
          { onConflict: 'user_id,lesson_id' }
        );
      }
      window.location.href = nextLesson ? ('lesson.html?id=' + nextLesson.id) : 'dashboard.html';
    };
  }

  if (statusLine) {
    if (requiresQuizPass && !quizViewActive) {
      statusLine.style.display = 'block';
      if (alreadyPassedQuiz) {
        const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
        const best = bestModuleQuizAttempt(quizAttempts);
        statusLine.innerHTML = `✓ ${escapeHtml(ml.passTitle(best.score, best.total))} · <a id="lesson-quiz-review-link">${escapeHtml(l.review)}</a>`;
        const reviewLink = statusLine.querySelector('#lesson-quiz-review-link');
        if (reviewLink) reviewLink.onclick = () => { lessonCache.quizViewActive = true; renderLessonPage(); smoothScrollTo({ top: 0 }); };
      } else {
        statusLine.textContent = l.intro(moduleQuizQs.length, Math.round(MODULE_QUIZ_PASS_RATIO * 100));
      }
    } else {
      statusLine.style.display = 'none';
      statusLine.innerHTML = '';
    }
  }

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

  const lessons = await fetchPublishedLessons();

  const emptyState = document.querySelector('#lesson-empty-state');
  const mainContent = document.querySelector('#lesson-main-content');

  if (!lessons || !lessons.length) {
    emptyState.style.display = 'block';
    mainContent.style.display = 'none';
    return;
  }

  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));

  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('id');
  let lesson = lessons.find((l) => l.id === requestedId);
  if (!lesson) {
    lesson = firstAvailableLesson(lessons, completedIds) || lessons[0];
    history.replaceState(null, '', 'lesson.html?id=' + lesson.id);
  } else if (!isLessonUnlocked(lesson, lessons, completedIds)) {
    // Reached a locked lesson directly via URL (stale link, typed-in id,
    // browser back/forward), bounce to the first lesson they're actually
    // allowed to work on instead of loading gated content.
    const fallback = firstAvailableLesson(lessons, completedIds);
    if (fallback) {
      window.location.href = 'lesson.html?id=' + fallback.id;
    } else {
      window.location.href = 'dashboard.html';
    }
    return;
  }

  mainContent.style.display = 'block';
  emptyState.style.display = 'none';

  // The module quiz is shown only on the last lesson of its module, it
  // covers every quiz question published for that module_number, not just
  // ones "assigned" to this specific lesson. Passing it (>= 80%) is what
  // gates marking that final lesson complete, which is how a whole module
  // gets marked done.
  const sortedModuleLessons = lessons
    .filter((l) => l.module_number === lesson.module_number)
    .sort((a, b) => a.sort_order - b.sort_order);
  const lessonIdxInModule = sortedModuleLessons.findIndex((l) => l.id === lesson.id);
  const isLastLessonOfModule = lessonIdxInModule === sortedModuleLessons.length - 1;

  let moduleQuizQs = [];
  let moduleQuizAttempts = [];
  if (isLastLessonOfModule) {
    const [{ data: quizQs }, { data: attemptRows }] = await Promise.all([
      supabaseClient.from('quiz_questions').select('*').eq('module_number', lesson.module_number).eq('published', true).order('sort_order'),
      supabaseClient.from('module_quiz_attempts').select('*').eq('user_id', userId).eq('module_number', lesson.module_number).order('created_at', { ascending: true }),
    ]);
    moduleQuizQs = quizQs || [];
    moduleQuizAttempts = attemptRows || [];
  }

  lessonCache = { lessons, lesson, completedIds, moduleQuizQs, moduleQuizAttempts, isLastLessonOfModule, userId, quizViewActive: false };
  renderLessonPage();
}

// ---- Flashcards page ----------------------------------------------------
// Study UI for the 3 official USCIS civics-test question banks
// (100-question 2008 version, 128-question 2025 version, 20-question
// 65/20 special-consideration subset). Purely client-side study tool;
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
  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#fc-page-module-nav', lessons || [], completedIds, null);

  // Picker: clicking a test-type card fetches that bank and starts the deck.
  document.querySelectorAll('.fc-picker-card').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const testType = btn.getAttribute('data-test-type');
      btn.setAttribute('aria-busy', 'true');
      const { data: cards, error } = await fetchFlashcardBank(testType);
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
  // role="button" + tabindex on the card itself (flashcards.html) needs its
  // own keydown handler for Enter/Space, in addition to the dedicated
  // "Flip Card" button below, so keyboard users can flip via the card too.
  document.querySelector('#fc-flip-card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!flashcardsCache) return;
      flashcardsCache.flipped = !flashcardsCache.flipped;
      renderFlashcardsStudy();
    }
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
// are oral Q&A (no multiple-choice options), grading is self-reported,
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
      failMsg: "You're not quite at the passing threshold yet. Review what you missed below and try again.",
    },
    es: {
      pass: 'APROBADO', fail: 'AÚN NO APRUEBA',
      passMsg: 'Respondiste correctamente lo suficiente para aprobar esta prueba en la entrevista real. ¡Sigue practicando para mantenerte al día!',
      failMsg: 'Todavía no alcanzas el umbral de aprobación. Revisa lo que fallaste abajo e inténtalo de nuevo.',
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
    const srCorrect = lang === 'es' ? (a.correct ? 'Correcta' : 'Incorrecta') : (a.correct ? 'Correct' : 'Incorrect');
    return `<div class="pq-review-item">
      <div class="pq-review-icon ${a.correct ? 'correct' : 'incorrect'}" aria-hidden="true">${a.correct ? '✓' : '✗'}</div>
      <div><span class="sr-only">${escapeHtml(srCorrect)}: </span>
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
    return `<div class="pq-history-row" data-attempt-id="${a.id}" role="button" tabindex="0">
      <div>
        <div class="pq-history-test">${escapeHtml(labelEntry[lang] || labelEntry.en)}</div>
        <div class="pq-history-meta">${dateFmt(a.created_at)}</div>
      </div>
      <span class="badge ${a.passed ? 'badge-forest' : ''}" style="${a.passed ? '' : 'border-color:var(--danger); color:var(--danger);'}">${a.score}/${a.total} · ${passText}</span>
    </div>`;
  }).join('');

  // These history rows are clickable divs (role="button" + tabindex above),
  // so they need both a click handler and a keydown handler for Enter/Space
  // to be operable via keyboard, matching native <button> behavior.
  listEl.querySelectorAll('[data-attempt-id]').forEach((row) => {
    const openAttempt = () => {
      const attempt = attempts.find((a) => a.id === row.getAttribute('data-attempt-id'));
      if (attempt) renderPracticeQuizResults(attempt);
    };
    row.addEventListener('click', openAttempt);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openAttempt();
      }
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

  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#pq-page-module-nav', lessons || [], completedIds, null);

  loadPracticeQuizHistory();

  async function beginQuiz(testType) {
    const config = PRACTICE_QUIZ_CONFIG[testType] || PRACTICE_QUIZ_CONFIG.test_100;
    const { data: cards, error } = await fetchFlashcardBank(testType);
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

// ---- Mock Interview (video-based interview simulation, placeholder content) --
// Each question is designed to eventually pair with a short video clip the
// founder records personally (video_url). Until real clips exist, video_url
// stays pointed at a placeholder path and the UI shows a clean placeholder
// panel instead of a broken <video> tag; drop in a real file path/URL later
// and the player switches over automatically, no other code changes needed
// (see renderMockVideo below). Multiple-choice and yes/no questions grade
// themselves against correct_answer; open-ended ones can't be graded by a
// script (same as a real interview, where a person, not a program, judges a
// spoken answer), so the member self-assesses after reading the explanation.
// This pass is front-end only, in-memory session state, no Supabase writes;
// see the TODO inside finishMockInterview() for where an attempts-table
// insert would go once real content ships.
const MOCK_INTERVIEW_QUESTIONS = [
  {
    id: 1, type: 'open_ended',
    question: 'Placeholder interview question 1: Tell me about yourself and why you want to become a U.S. citizen.',
    question_es: 'Pregunta de entrevista de ejemplo 1: Cuénteme sobre usted y por qué quiere convertirse en ciudadano estadounidense.',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: null,
    explanation: "Placeholder explanation: there's no single \"correct\" answer here. The officer is listening for a clear, honest, personal response.",
    explanation_es: 'Explicación de ejemplo: no hay una única respuesta "correcta" aquí. El oficial busca una respuesta clara, honesta y personal.',
  },
  {
    id: 2, type: 'yes_no',
    question: 'Placeholder interview question 2: Have you ever been arrested or convicted of a crime?',
    question_es: '¿Alguna vez ha sido arrestado o condenado por un delito? (pregunta de entrevista de ejemplo 2)',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: 'no',
    explanation: 'Placeholder explanation: this is a real N-400 background question. Answer truthfully; a "yes" doesn\'t automatically disqualify you, but it must be disclosed.',
    explanation_es: 'Explicación de ejemplo: esta es una pregunta real de antecedentes del N-400. Responda con la verdad; un "sí" no lo descalifica automáticamente, pero debe declararse.',
  },
  {
    id: 3, type: 'multiple_choice',
    question: 'Placeholder interview question 3: What is the supreme law of the land?',
    question_es: 'Pregunta de entrevista de ejemplo 3: ¿Cuál es la ley suprema del país?',
    video_url: '/placeholder-video.mp4',
    options: [
      { value: 'a', en: 'The Declaration of Independence', es: 'La Declaración de Independencia' },
      { value: 'b', en: 'The Constitution', es: 'La Constitución' },
      { value: 'c', en: 'The Bill of Rights', es: 'La Carta de Derechos' },
      { value: 'd', en: 'The Federalist Papers', es: 'Los Documentos Federalistas' },
    ],
    correct_answer: 'b',
    explanation: 'Placeholder explanation: a real 2025/2008 civics test question, taken from the official USCIS question bank.',
    explanation_es: 'Explicación de ejemplo: una pregunta real del examen cívico 2025/2008, tomada del banco oficial de preguntas de USCIS.',
  },
  {
    id: 4, type: 'open_ended',
    question: 'Placeholder interview question 4: Describe your current job or how you support yourself financially.',
    question_es: 'Pregunta de entrevista de ejemplo 4: Describa su trabajo actual o cómo se mantiene económicamente.',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: null,
    explanation: "Placeholder explanation: keep this factual and consistent with what's on your N-400. Officers often cross-check this against your application.",
    explanation_es: 'Explicación de ejemplo: mantenga esto factual y consistente con lo que aparece en su N-400. Los oficiales suelen verificar esto con su solicitud.',
  },
  {
    id: 5, type: 'yes_no',
    question: 'Placeholder interview question 5: Are you willing to take the full Oath of Allegiance to the United States?',
    question_es: 'Pregunta de entrevista de ejemplo 5: ¿Está dispuesto a prestar el Juramento de Lealtad completo a los Estados Unidos?',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: 'yes',
    explanation: 'Placeholder explanation: asked directly at the real interview, and again at the oath ceremony itself.',
    explanation_es: 'Explicación de ejemplo: se pregunta directamente en la entrevista real, y de nuevo en la ceremonia de juramentación.',
  },
  {
    id: 6, type: 'multiple_choice',
    question: 'Placeholder interview question 6: How many amendments does the Constitution have?',
    question_es: 'Pregunta de entrevista de ejemplo 6: ¿Cuántas enmiendas tiene la Constitución?',
    video_url: '/placeholder-video.mp4',
    options: [
      { value: 'a', en: '17', es: '17' },
      { value: 'b', en: '21', es: '21' },
      { value: 'c', en: '27', es: '27' },
      { value: 'd', en: '30', es: '30' },
    ],
    correct_answer: 'c',
    explanation: "Placeholder explanation: another real civics test question, worth memorizing exactly since it's a specific number.",
    explanation_es: 'Explicación de ejemplo: otra pregunta real del examen cívico, vale la pena memorizarla con exactitud porque es un número específico.',
  },
  {
    id: 7, type: 'open_ended',
    question: 'Placeholder interview question 7: Have you traveled outside the United States since becoming a permanent resident? Tell me about your trips.',
    question_es: 'Pregunta de entrevista de ejemplo 7: ¿Ha viajado fuera de los Estados Unidos desde que se convirtió en residente permanente? Cuénteme sobre sus viajes.',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: null,
    explanation: 'Placeholder explanation: have your dates ready. This ties directly to your continuous residence and physical presence eligibility.',
    explanation_es: 'Explicación de ejemplo: tenga sus fechas listas. Esto se relaciona directamente con su elegibilidad de residencia continua y presencia física.',
  },
  {
    id: 8, type: 'yes_no',
    question: 'Placeholder interview question 8: Have you registered with the Selective Service, if required?',
    question_es: 'Pregunta de entrevista de ejemplo 8: ¿Se ha registrado en el Servicio Selectivo, si se le requiere?',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: 'yes',
    explanation: 'Placeholder explanation: applies to most men who lived in the U.S. as permanent residents between ages 18 and 26.',
    explanation_es: 'Explicación de ejemplo: aplica a la mayoría de los hombres que vivieron en EE. UU. como residentes permanentes entre los 18 y los 26 años.',
  },
  {
    id: 9, type: 'multiple_choice',
    question: 'Placeholder interview question 9: What do we call the first ten amendments to the Constitution?',
    question_es: 'Pregunta de entrevista de ejemplo 9: ¿Cómo llamamos a las primeras diez enmiendas de la Constitución?',
    video_url: '/placeholder-video.mp4',
    options: [
      { value: 'a', en: 'The Preamble', es: 'El Preámbulo' },
      { value: 'b', en: 'The Bill of Rights', es: 'La Carta de Derechos' },
      { value: 'c', en: 'The Articles of Confederation', es: 'Los Artículos de la Confederación' },
      { value: 'd', en: 'The Emancipation Proclamation', es: 'La Proclamación de Emancipación' },
    ],
    correct_answer: 'b',
    explanation: 'Placeholder explanation: a frequently asked civics test question.',
    explanation_es: 'Explicación de ejemplo: una pregunta frecuente del examen cívico.',
  },
  {
    id: 10, type: 'open_ended',
    question: "Placeholder interview question 10: Is there anything else you'd like to add before we conclude?",
    question_es: 'Pregunta de entrevista de ejemplo 10: ¿Hay algo más que le gustaría agregar antes de concluir?',
    video_url: '/placeholder-video.mp4',
    options: [],
    correct_answer: null,
    explanation: 'Placeholder explanation: a closing question. Real officers often end this way to give you a final chance to speak.',
    explanation_es: 'Explicación de ejemplo: una pregunta de cierre. Los oficiales reales a menudo terminan así para darle una última oportunidad de hablar.',
  },
];

// Questions live in the mock_interview_questions table (editable from the
// admin panel), with the hardcoded array above as a fallback so the page
// still works if the fetch fails for some reason. Add real videos/content by
// editing rows in the admin panel, not by editing this file.
async function getMockInterviewQuestions() {
  const cached = getCachedContent('mock_interview_questions');
  if (cached) return cached;
  const { data, error } = await supabaseClient
    .from('mock_interview_questions')
    .select('*')
    .eq('published', true)
    .order('sort_order');
  if (error || !data || !data.length) return MOCK_INTERVIEW_QUESTIONS;
  setCachedContent('mock_interview_questions', data);
  return data;
}

const MOCK_INTERVIEW_LABELS = {
  en: {
    questionOf: (n, total) => `Question ${n} of ${total}`,
    videoLabel: 'Video Placeholder',
    videoSublabel: "The interview video for this question will appear here once it's recorded.",
    yourAnswer: 'Your answer',
    yes: 'YES', no: 'NO',
    correct: '✓ Correct', incorrect: '✗ Incorrect',
    bucketCorrect: 'Correct', bucketNotSure: 'Not sure', bucketIncorrect: 'Incorrect',
    continueNext: 'Continue →', viewSummary: 'View Summary →',
    resultLine: (correct, graded) => (graded > 0 ? `${correct} of ${graded} answers marked correct` : 'Session complete'),
    quitConfirm: "Quit this mock interview? Your progress won't be saved.",
  },
  es: {
    questionOf: (n, total) => `Pregunta ${n} de ${total}`,
    videoLabel: 'Marcador de Video',
    videoSublabel: 'El video de la entrevista para esta pregunta aparecerá aquí una vez grabado.',
    yourAnswer: 'Tu respuesta',
    yes: 'SÍ', no: 'NO',
    correct: '✓ Correcta', incorrect: '✗ Incorrecta',
    bucketCorrect: 'Correcta', bucketNotSure: 'No segura', bucketIncorrect: 'Incorrecta',
    continueNext: 'Continuar →', viewSummary: 'Ver Resumen →',
    resultLine: (correct, graded) => (graded > 0 ? `${correct} de ${graded} respuestas marcadas como correctas` : 'Sesión completada'),
    quitConfirm: '¿Salir de esta entrevista simulada? Tu progreso no se guardará.',
  },
};

// { questions, idx, answers: [{question_id, type, given, correct, self_grade}], pendingAnswer }
let mockInterviewCache = null;

function renderMockVideo(videoUrl) {
  const wrap = document.querySelector('#mi-video-wrap');
  if (!wrap) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;
  const isPlaceholder = !videoUrl || videoUrl.indexOf('/placeholder') === 0;
  if (isPlaceholder) {
    wrap.innerHTML = `<div class="mi-video-placeholder">
      <div class="mi-video-icon" aria-hidden="true">🎥</div>
      <div class="mi-video-label">${escapeHtml(l.videoLabel)}</div>
      <div class="mi-video-sublabel">${escapeHtml(l.videoSublabel)}</div>
    </div>`;
  } else {
    wrap.innerHTML = `<video controls playsinline src="${escapeHtml(videoUrl)}"></video>`;
  }
}

function buildMockAnswerArea(q) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;
  const area = document.querySelector('#mi-answer-area');
  const submitBtn = document.querySelector('#mi-submit-btn');
  submitBtn.disabled = true;

  if (q.type === 'open_ended') {
    area.innerHTML = `<textarea class="mi-textarea" id="mi-open-input" placeholder="${lang === 'es' ? 'Escribe tu respuesta…' : 'Type your answer…'}"></textarea>`;
    const input = document.querySelector('#mi-open-input');
    input.addEventListener('input', () => {
      mockInterviewCache.pendingAnswer = input.value;
      submitBtn.disabled = !input.value.trim();
    });
  } else if (q.type === 'multiple_choice') {
    const letters = ['A', 'B', 'C', 'D'];
    area.innerHTML = `<div class="mi-options">${q.options.map((opt, i) => `
      <button type="button" class="mi-option-btn" data-value="${escapeHtml(opt.value)}">
        <span class="mi-option-letter">${letters[i] || i + 1}</span>
        <span>${escapeHtml(lang === 'es' ? (opt.es || opt.en) : opt.en)}</span>
      </button>`).join('')}</div>`;
    area.querySelectorAll('.mi-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.mi-option-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        mockInterviewCache.pendingAnswer = btn.getAttribute('data-value');
        submitBtn.disabled = false;
      });
    });
  } else if (q.type === 'yes_no') {
    area.innerHTML = `<div class="mi-yesno-row">
      <button type="button" class="mi-yesno-btn" data-value="yes">${escapeHtml(l.yes)}</button>
      <button type="button" class="mi-yesno-btn" data-value="no">${escapeHtml(l.no)}</button>
    </div>`;
    area.querySelectorAll('.mi-yesno-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.mi-yesno-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        mockInterviewCache.pendingAnswer = btn.getAttribute('data-value');
        submitBtn.disabled = false;
      });
    });
  }
}

function mockOptionLabel(q, value) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const opt = (q.options || []).find((o) => o.value === value);
  if (!opt) return value;
  return lang === 'es' ? (opt.es || opt.en) : opt.en;
}

function renderMockInterviewQuestion() {
  if (!mockInterviewCache) return;
  const { questions, idx } = mockInterviewCache;
  const q = questions[idx];
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;

  mockInterviewCache.pendingAnswer = null;

  document.querySelector('#mi-progress-text').textContent = l.questionOf(idx + 1, questions.length);
  document.querySelector('#mi-progress-bar').style.width = Math.round((idx / questions.length) * 100) + '%';

  renderMockVideo(q.video_url);
  document.querySelector('#mi-question-text').textContent = localize(q, 'question');

  document.querySelector('#mi-answer-area').style.display = 'block';
  document.querySelector('#mi-submit-row').style.display = 'block';
  document.querySelector('#mi-review-area').style.display = 'none';
  buildMockAnswerArea(q);
}

function renderMockReview() {
  const { questions, idx, answers } = mockInterviewCache;
  const q = questions[idx];
  const a = answers[answers.length - 1];
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;

  document.querySelector('#mi-answer-area').style.display = 'none';
  document.querySelector('#mi-submit-row').style.display = 'none';
  document.querySelector('#mi-review-area').style.display = 'block';

  let answerText = a.given;
  if (q.type === 'multiple_choice') answerText = mockOptionLabel(q, a.given);
  if (q.type === 'yes_no') answerText = a.given === 'yes' ? l.yes : l.no;
  document.querySelector('#mi-review-answer-text').textContent = answerText;

  const autoGradeWrap = document.querySelector('#mi-auto-grade-wrap');
  const selfGradeWrap = document.querySelector('#mi-selfgrade-wrap');
  const continueBtn = document.querySelector('#mi-continue-btn');

  if (q.type === 'open_ended') {
    autoGradeWrap.innerHTML = '';
    selfGradeWrap.style.display = 'block';
    selfGradeWrap.querySelectorAll('.mi-selfgrade-btn').forEach((btn) => btn.classList.remove('selected'));
    continueBtn.disabled = true;
  } else {
    autoGradeWrap.innerHTML = `<span class="mi-auto-grade-badge ${a.correct ? 'correct' : 'incorrect'}">${a.correct ? l.correct : l.incorrect}</span>`;
    selfGradeWrap.style.display = 'none';
    continueBtn.disabled = false;
  }

  document.querySelector('#mi-explanation').textContent = localize(q, 'explanation');
  continueBtn.textContent = (idx + 1 >= questions.length) ? l.viewSummary : l.continueNext;
}

function submitMockAnswer() {
  if (!mockInterviewCache) return;
  const { questions, idx } = mockInterviewCache;
  const q = questions[idx];
  const given = mockInterviewCache.pendingAnswer;
  if (given === null || given === undefined || (typeof given === 'string' && !given.trim())) return;

  let correct = null;
  if (q.type === 'multiple_choice' || q.type === 'yes_no') {
    correct = given === q.correct_answer;
  }
  // question/question_es/options are copied onto the answer (not just
  // question_id) so a persisted attempt's history can render on its own
  // later even if that question is edited or removed from the admin panel.
  mockInterviewCache.answers.push({
    question_id: q.id, type: q.type, given, correct, self_grade: null,
    question: q.question, question_es: q.question_es || null, options: q.options || [],
  });
  renderMockReview();
}

function selectMockSelfGrade(grade) {
  if (!mockInterviewCache) return;
  const { answers } = mockInterviewCache;
  const a = answers[answers.length - 1];
  a.self_grade = grade;
  document.querySelectorAll('.mi-selfgrade-btn').forEach((b) => b.classList.toggle('selected', b.getAttribute('data-grade') === grade));
  document.querySelector('#mi-continue-btn').disabled = false;
}

function mockAnswerBucket(a) {
  if (a.type === 'open_ended') return a.self_grade || 'not_sure';
  return a.correct ? 'correct' : 'incorrect';
}

function continueMockInterview() {
  if (!mockInterviewCache) return;
  if (mockInterviewCache.idx + 1 >= mockInterviewCache.questions.length) {
    finishMockInterview();
  } else {
    mockInterviewCache.idx += 1;
    renderMockInterviewQuestion();
  }
}

// Best-effort save to mock_interview_attempts so the member can review past
// sessions later (see renderMockInterviewHistory). Session lookup happens
// here rather than being threaded through startMockInterview/
// continueMockInterview/finishMockInterview, since those functions are bound
// directly to button clicks with no user_id in scope.
async function persistMockInterviewAttempt(answers, counts) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    await supabaseClient.from('mock_interview_attempts').insert({
      user_id: session.user.id,
      completed_count: answers.length,
      correct_count: counts.correct,
      not_sure_count: counts.not_sure,
      incorrect_count: counts.incorrect,
      answers,
    });
    loadMockInterviewHistory(); // refresh the "Past Sessions" list on the intro view
  } catch (e) {
    // Not fatal; the summary screen already rendered from local state.
  }
}

// Holds whatever is currently on the summary view (a just-finished live
// session or a reopened history row) purely so a langchange re-render can
// redraw it without re-persisting or re-fetching anything. Shape:
// { answers, counts }.
let mockInterviewSummaryState = null;

function finishMockInterview() {
  const { answers } = mockInterviewCache;
  const counts = { correct: 0, not_sure: 0, incorrect: 0 };
  answers.forEach((a) => { counts[mockAnswerBucket(a)] += 1; });

  // Fire-and-forget: the summary below renders from local state either way,
  // so a failed save shouldn't block the member from seeing their results.
  persistMockInterviewAttempt(answers, counts);

  document.querySelector('#mi-interview-view').style.display = 'none';
  renderMockInterviewSummary(answers, counts);
}

// Reopens a previously saved mock_interview_attempts row in the same
// summary view used right after finishing a live session.
function renderMockInterviewAttempt(attempt) {
  const answers = attempt.answers || [];
  const counts = { correct: attempt.correct_count || 0, not_sure: attempt.not_sure_count || 0, incorrect: attempt.incorrect_count || 0 };
  document.querySelector('#mi-intro-view').style.display = 'none';
  document.querySelector('#mi-interview-view').style.display = 'none';
  renderMockInterviewSummary(answers, counts);
}

function renderMockInterviewSummary(answers, counts) {
  mockInterviewSummaryState = { answers, counts };
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;

  document.querySelector('#mi-summary-view').style.display = 'block';

  document.querySelector('#mi-stat-completed').textContent = answers.length;
  document.querySelector('#mi-stat-correct').textContent = counts.correct;
  document.querySelector('#mi-stat-notsure').textContent = counts.not_sure;
  document.querySelector('#mi-stat-incorrect').textContent = counts.incorrect;
  document.querySelector('#mi-summary-result').textContent = l.resultLine(counts.correct, counts.correct + counts.incorrect);

  document.querySelector('#mi-review-list').innerHTML = buildMockReviewListHtml(answers);
}

// Renders the "Review Your Session" list from answers alone (each answer
// already carries its own question/question_es/options, copied in at
// submit time), so this works both right after finishing a session and
// later when reopening a saved mock_interview_attempts row.
function buildMockReviewListHtml(answers) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;
  return answers.map((a) => {
    const bucket = mockAnswerBucket(a);
    const icon = bucket === 'correct' ? '✓' : (bucket === 'incorrect' ? '✗' : '?');
    let answerText = a.given;
    if (a.type === 'multiple_choice') answerText = mockOptionLabel(a, a.given);
    if (a.type === 'yes_no') answerText = a.given === 'yes' ? l.yes : l.no;
    const bucketLabel = bucket === 'correct' ? l.bucketCorrect : (bucket === 'incorrect' ? l.bucketIncorrect : l.bucketNotSure);
    return `<div class="mi-review-item">
      <div class="mi-review-icon ${bucket}" aria-hidden="true">${icon}</div>
      <div>
        <p class="mi-review-list-question"><span class="sr-only">${escapeHtml(bucketLabel)}: </span>${escapeHtml(localize(a, 'question'))}</p>
        <p class="mi-review-list-answer">${escapeHtml(answerText)}</p>
      </div>
    </div>`;
  }).join('');
}

async function startMockInterview() {
  const questions = await getMockInterviewQuestions();
  mockInterviewCache = { questions, idx: 0, answers: [], pendingAnswer: null };
  mockInterviewSummaryState = null;
  document.querySelector('#mi-intro-view').style.display = 'none';
  document.querySelector('#mi-summary-view').style.display = 'none';
  document.querySelector('#mi-interview-view').style.display = 'block';
  renderMockInterviewQuestion();
}

function renderMockInterviewStatic() {
  // Bound to the site-wide langchange event below, which fires on every
  // page, not just mock-interview.html — #mi-summary-view only exists
  // there, so bail out immediately anywhere else instead of crashing on
  // a null .style read (this was firing on every language toggle across
  // every member page; see client_error_log).
  if (!document.body.hasAttribute('data-mock-interview-page')) return;
  // Static intro/summary copy is handled by data-en/data-es via setLang();
  // this only needs to re-render JS-built content still on screen. Uses
  // renderMockInterviewSummary (not finishMockInterview) for the summary
  // case so toggling language never re-persists the attempt.
  renderMockInterviewHistoryList(mockInterviewHistoryCache);
  const summaryVisible = document.querySelector('#mi-summary-view').style.display !== 'none';
  if (summaryVisible && mockInterviewSummaryState) {
    renderMockInterviewSummary(mockInterviewSummaryState.answers, mockInterviewSummaryState.counts);
    return;
  }
  if (!mockInterviewCache) return;
  const interviewVisible = document.querySelector('#mi-interview-view').style.display !== 'none';
  const reviewShowing = document.querySelector('#mi-review-area') && document.querySelector('#mi-review-area').style.display !== 'none';
  if (interviewVisible && !reviewShowing) renderMockInterviewQuestion();
}
window.addEventListener('ciudadanoready:langchange', renderMockInterviewStatic);

async function initMockInterviewPage() {
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

  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#mi-page-module-nav', lessons || [], completedIds, null);

  document.querySelector('#mi-begin-btn').addEventListener('click', () => startMockInterview());
  document.querySelector('#mi-submit-btn').addEventListener('click', () => submitMockAnswer());
  document.querySelector('#mi-continue-btn').addEventListener('click', () => continueMockInterview());
  document.querySelectorAll('.mi-selfgrade-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectMockSelfGrade(btn.getAttribute('data-grade')));
  });
  document.querySelector('#mi-retake-btn').addEventListener('click', () => startMockInterview());
  document.querySelector('#mi-summary-back-btn').addEventListener('click', () => {
    mockInterviewSummaryState = null;
    document.querySelector('#mi-summary-view').style.display = 'none';
    document.querySelector('#mi-intro-view').style.display = 'block';
    loadMockInterviewHistory();
  });
  document.querySelector('#mi-quit-btn').addEventListener('click', () => {
    const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
    const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;
    if (!confirm(l.quitConfirm)) return;
    mockInterviewCache = null;
    mockInterviewSummaryState = null;
    document.querySelector('#mi-interview-view').style.display = 'none';
    document.querySelector('#mi-summary-view').style.display = 'none';
    document.querySelector('#mi-intro-view').style.display = 'block';
  });

  loadMockInterviewHistory();
}

// ---- Mock Interview history (past mock_interview_attempts rows) -----------
let mockInterviewHistoryCache = [];

async function loadMockInterviewHistory() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const { data } = await supabaseClient
    .from('mock_interview_attempts')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(25);
  mockInterviewHistoryCache = data || [];
  renderMockInterviewHistoryList(mockInterviewHistoryCache);
}

function renderMockInterviewHistoryList(attempts) {
  const emptyEl = document.querySelector('#mi-history-empty');
  const listEl = document.querySelector('#mi-history-list');
  if (!listEl) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const l = MOCK_INTERVIEW_LABELS[lang] || MOCK_INTERVIEW_LABELS.en;

  if (!attempts.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const dateFmt = (iso) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const questionsWord = lang === 'es' ? 'preguntas' : 'questions';
  listEl.innerHTML = attempts.map((a) => `
    <div class="pq-history-row" data-mi-attempt-id="${a.id}" role="button" tabindex="0">
      <div>
        <div class="pq-history-test">${l.resultLine(a.correct_count, a.correct_count + a.incorrect_count)}</div>
        <div class="pq-history-meta">${dateFmt(a.created_at)}</div>
      </div>
      <span class="badge">${a.completed_count} ${questionsWord}</span>
    </div>
  `).join('');

  // Clickable divs need both click and keydown (Enter/Space) handlers to be
  // keyboard-operable, same pattern used for the practice quiz and Know
  // Your Country history/lesson rows.
  listEl.querySelectorAll('[data-mi-attempt-id]').forEach((row) => {
    const openAttempt = () => {
      const attempt = attempts.find((a) => a.id === row.getAttribute('data-mi-attempt-id'));
      if (attempt) renderMockInterviewAttempt(attempt);
    };
    row.addEventListener('click', openAttempt);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openAttempt();
      }
    });
  });
}

// ---- Settings page --------------------------------------------------------
// Profile (name/email), password change, appearance (dark mode, the
// toggle buttons themselves are wired generically in app.js since they're
// shared with every member page's topbar), and a link out to the existing
// Stripe billing portal (window.openBillingPortal, already used by the
// dashboard's billing banner).
function showSettingsMsg(el, text, isError) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('success', 'error');
  el.classList.add(isError ? 'error' : 'success');
}

async function initSettingsPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, email, plan, subscription_status')
    .eq('id', userId)
    .single();

  const nameInput = document.querySelector('#settings-full-name');
  const emailInput = document.querySelector('#settings-email');
  const currentName = (profile && profile.full_name) || '';
  const currentEmail = (profile && profile.email) || session.user.email || '';
  if (nameInput) nameInput.value = currentName;
  if (emailInput) emailInput.value = currentEmail;
  const viewNameEl = document.querySelector('#profile-view-name');
  const viewEmailEl = document.querySelector('#profile-view-email');
  if (viewNameEl) viewNameEl.textContent = currentName || '–';
  if (viewEmailEl) viewEmailEl.textContent = currentEmail || '–';

  // Profile starts read-only; "Edit" reveals the form (pre-filled with
  // current values), "Cancel" discards any unsaved typing and reverts.
  const profileViewMode = document.querySelector('#profile-view-mode');
  const profileFormEl = document.querySelector('#profile-form');
  const profileEditBtn = document.querySelector('#profile-edit-btn');
  const profileCancelBtn = document.querySelector('#profile-cancel-btn');
  function enterProfileEditMode() {
    if (profileViewMode) profileViewMode.style.display = 'none';
    if (profileFormEl) profileFormEl.style.display = 'block';
    if (profileEditBtn) profileEditBtn.style.display = 'none';
  }
  function exitProfileEditMode() {
    if (profileViewMode) profileViewMode.style.display = 'block';
    if (profileFormEl) profileFormEl.style.display = 'none';
    if (profileEditBtn) profileEditBtn.style.display = 'inline-flex';
    const msg = document.querySelector('#profile-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  }
  if (profileEditBtn) profileEditBtn.addEventListener('click', enterProfileEditMode);
  if (profileCancelBtn) profileCancelBtn.addEventListener('click', () => {
    if (nameInput) nameInput.value = currentName;
    if (emailInput) emailInput.value = currentEmail;
    exitProfileEditMode();
  });

  const planNameEl = document.querySelector('#settings-plan-name');
  const planStatusEl = document.querySelector('#settings-plan-status');
  if (planNameEl) {
    const planLabels = { monthly: 'Monthly Plan', '2year': '2-Year Plan' };
    planNameEl.textContent = (profile && planLabels[profile.plan]) || (profile && profile.plan) || 'No active plan';
  }
  if (planStatusEl) {
    const statusLabels = { active: 'Active', trial: 'Trial', comp: 'Complimentary access', past_due: 'Payment issue', canceled: 'Canceled' };
    planStatusEl.textContent = (profile && statusLabels[profile.subscription_status]) || '';
  }
  const manageBillingBtn = document.querySelector('#settings-manage-billing-btn');
  if (manageBillingBtn) manageBillingBtn.onclick = () => window.openBillingPortal(manageBillingBtn);

  // Sidebar module nav, same as every other member page.
  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#settings-module-nav', lessons || [], completedIds, null);

  const profileForm = document.querySelector('#profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.querySelector('#profile-save-btn');
      const msg = document.querySelector('#profile-msg');
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      btn.disabled = true;

      const newName = nameInput.value.trim();
      const newEmail = emailInput.value.trim();
      const emailChanged = newEmail && newEmail !== session.user.email;

      const { error: profileError } = await supabaseClient
        .from('profiles')
        .update({ full_name: newName })
        .eq('id', userId);

      let authError = null;
      if (emailChanged) {
        const { error } = await supabaseClient.auth.updateUser({ email: newEmail });
        authError = error;
      }

      btn.disabled = false;
      if (profileError || authError) {
        showSettingsMsg(msg, (profileError && profileError.message) || (authError && authError.message) || 'Something went wrong.', true);
        return;
      }

      if (viewNameEl) viewNameEl.textContent = newName || '–';
      // Don't flip the displayed email until the confirmation link is
      // clicked, Supabase doesn't apply it until then, so showing the new
      // address now would be misleading.
      if (!emailChanged && viewEmailEl) viewEmailEl.textContent = newEmail || '–';

      if (emailChanged) {
        showSettingsMsg(msg, lang === 'es' ? 'Guardado. Revisa tu nuevo correo para confirmar el cambio de dirección.' : 'Saved. Check your new inbox to confirm the email change.', false);
      } else {
        exitProfileEditMode();
      }
    });
  }

  const passwordForm = document.querySelector('#password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.querySelector('#password-save-btn');
      const msg = document.querySelector('#password-msg');
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      const currentPw = document.querySelector('#settings-current-password').value;
      const newPw = document.querySelector('#settings-new-password').value;
      const confirmPw = document.querySelector('#settings-confirm-password').value;

      if (newPw !== confirmPw) {
        showSettingsMsg(msg, lang === 'es' ? 'Las contraseñas nuevas no coinciden.' : 'New passwords do not match.', true);
        return;
      }
      if (newPw.length < 6) {
        showSettingsMsg(msg, lang === 'es' ? 'La contraseña debe tener al menos 6 caracteres.' : 'Password must be at least 6 characters.', true);
        return;
      }

      btn.disabled = true;
      btn.textContent = lang === 'es' ? 'Verificando…' : 'Verifying…';

      // Confirm they actually know the current password before allowing a
      // change, signInWithPassword re-authenticates against it without
      // disturbing the existing session if it succeeds.
      const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
        email: session.user.email,
        password: currentPw,
      });

      if (verifyError) {
        btn.disabled = false;
        btn.textContent = lang === 'es' ? 'Actualizar Contraseña' : 'Update Password';
        showSettingsMsg(msg, lang === 'es' ? 'Tu contraseña actual es incorrecta.' : 'Your current password is incorrect.', true);
        return;
      }

      btn.textContent = lang === 'es' ? 'Actualizando…' : 'Updating…';
      const { error } = await supabaseClient.auth.updateUser({ password: newPw });
      btn.disabled = false;
      btn.textContent = lang === 'es' ? 'Actualizar Contraseña' : 'Update Password';

      if (error) {
        showSettingsMsg(msg, error.message || 'Could not update password.', true);
      } else {
        showSettingsMsg(msg, lang === 'es' ? 'Contraseña actualizada.' : 'Password updated.', false);
        passwordForm.reset();
      }
    });
  }
}

// ---- My Progress page ------------------------------------------------
// Pulls together stats that otherwise only lived on the dashboard (course
// completion) or were never surfaced at all (flashcard mastery, module quiz
// average, a composite "readiness score") into one dedicated page. Cached
// so a language toggle re-renders the bank labels / date formatting without
// a refetch.
let progressCache = null;

// Tier labels intentionally avoid any language implying this predicts a
// real USCIS interview outcome (e.g. no "Interview Ready"), see the
// disclaimer in progress.html's info popover for why.
const READINESS_TIERS = [
  { max: 39, tier: 1, en: 'Getting Started', es: 'Comenzando' },
  { max: 64, tier: 2, en: 'Building Confidence', es: 'Ganando Confianza' },
  { max: 84, tier: 3, en: 'Making Good Progress', es: 'Buen Progreso' },
  { max: 101, tier: 4, en: 'Excelling', es: 'Sobresaliente' },
];

function readinessTierFor(score) {
  return READINESS_TIERS.find((t) => score <= t.max) || READINESS_TIERS[READINESS_TIERS.length - 1];
}

function renderProgressPage() {
  if (!progressCache) return;
  const { courseCompletionPct, moduleQuizAvg, moduleQuizCount, streak, flashcardBanks, practiceAttempts, readinessScore } = progressCache;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';

  document.querySelector('#stat-course-pct').textContent = courseCompletionPct + '%';
  document.querySelector('#stat-course-bar').style.width = courseCompletionPct + '%';
  document.querySelector('#stat-course-sub').textContent = lang === 'es' ? 'Ponderado por el contenido de cada módulo' : 'Weighted by how much is in each module';

  const quizAvgEl = document.querySelector('#stat-quiz-avg');
  const quizSubEl = document.querySelector('#stat-quiz-sub');
  if (moduleQuizCount > 0) {
    quizAvgEl.textContent = moduleQuizAvg + '%';
    quizSubEl.textContent = moduleQuizCount === 1
      ? (lang === 'es' ? '1 cuestionario de módulo tomado' : '1 module quiz taken')
      : (lang === 'es' ? `${moduleQuizCount} cuestionarios de módulo tomados` : `${moduleQuizCount} module quizzes taken`);
  } else {
    quizAvgEl.textContent = '–';
    quizSubEl.textContent = lang === 'es' ? 'Aún no has tomado un cuestionario de módulo' : "You haven't taken a module quiz yet";
  }

  const streakEl = document.querySelector('#stat-streak');
  if (streakEl) streakEl.innerHTML = `${streak} <span style="font-size:1rem; font-weight:500;">${lang === 'es' ? (streak === 1 ? 'día' : 'días') : (streak === 1 ? 'day' : 'days')}</span>`;
  const streakSubEl = document.querySelector('#stat-streak-sub');
  if (streakSubEl) streakSubEl.textContent = streak > 0
    ? (lang === 'es' ? '¡Sigue así!' : 'Keep it going!')
    : (lang === 'es' ? 'Completa una lección para comenzar tu racha' : 'Complete a lesson to start your streak');

  const bankRowsEl = document.querySelector('#flashcard-mastery-rows');
  if (bankRowsEl) {
    if (!flashcardBanks.length) {
      bankRowsEl.innerHTML = `<p class="small muted">${lang === 'es' ? 'Toma una Entrevista de Práctica para empezar a registrar tu dominio.' : 'Take a Practice Interview to start tracking your mastery.'}</p>`;
    } else {
      bankRowsEl.innerHTML = flashcardBanks.map((b) => {
        const labelEntry = FLASHCARD_TEST_LABELS[b.testType] || FLASHCARD_TEST_LABELS.test_100;
        return `<div class="flashcard-bank-row"><span class="bank-name">${escapeHtml(labelEntry[lang] || labelEntry.en)}</span><span class="bank-score">${b.correct}/${b.total}</span></div>`;
      }).join('');
    }
  }

  const phSummaryEl = document.querySelector('#ph-summary');
  const phRowsEl = document.querySelector('#ph-history-rows');
  if (phSummaryEl) {
    if (!practiceAttempts.length) {
      phSummaryEl.textContent = lang === 'es' ? 'Aún no has tomado ninguna entrevista de práctica.' : "You haven't taken a practice interview yet.";
      if (phRowsEl) phRowsEl.innerHTML = '';
    } else {
      const passCount = practiceAttempts.filter((a) => a.passed).length;
      phSummaryEl.textContent = lang === 'es'
        ? `${practiceAttempts.length} intentos · ${passCount} aprobado(s)`
        : `${practiceAttempts.length} attempt${practiceAttempts.length === 1 ? '' : 's'} · ${passCount} passed`;
      const dateFmt = (iso) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      if (phRowsEl) {
        phRowsEl.innerHTML = practiceAttempts.slice(0, 5).map((a) => {
          const labelEntry = FLASHCARD_TEST_LABELS[a.test_type] || FLASHCARD_TEST_LABELS.test_100;
          const passText = a.passed ? (lang === 'es' ? 'Aprobado' : 'Passed') : (lang === 'es' ? 'No aprobado' : 'Not passing');
          return `<div class="ph-history-row">
            <div><div>${escapeHtml(labelEntry[lang] || labelEntry.en)}</div><div class="ph-history-meta">${dateFmt(a.created_at)}</div></div>
            <span class="badge ${a.passed ? 'badge-forest' : ''}" style="${a.passed ? '' : 'border-color:var(--danger); color:var(--danger);'}">${a.score}/${a.total} · ${passText}</span>
          </div>`;
        }).join('');
      }
    }
  }

  const circleEl = document.querySelector('#readiness-circle');
  const numEl = document.querySelector('#readiness-num');
  const labelEl = document.querySelector('#readiness-label');
  const tier = readinessTierFor(readinessScore);
  if (numEl) numEl.textContent = readinessScore;
  if (circleEl) circleEl.className = 'readiness-circle tier-' + tier.tier;
  if (labelEl) {
    labelEl.className = 'readiness-label tier-' + tier.tier;
    labelEl.textContent = lang === 'es' ? tier.es : tier.en;
  }

  // Info-icon popover: the disclaimer text lives here instead of as
  // permanent body copy on the hero. Bound once (dataset.bound guard) since
  // renderProgressPage re-runs on every language toggle.
  const infoBtn = document.querySelector('#readiness-info-btn');
  const infoPopover = document.querySelector('#readiness-info-popover');
  if (infoBtn && infoPopover && !infoBtn.dataset.bound) {
    infoBtn.dataset.bound = 'true';
    const closePopover = () => { infoPopover.setAttribute('hidden', ''); infoBtn.setAttribute('aria-expanded', 'false'); };
    const openPopover = () => { infoPopover.removeAttribute('hidden'); infoBtn.setAttribute('aria-expanded', 'true'); };
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (infoPopover.hasAttribute('hidden')) openPopover(); else closePopover();
    });
    document.addEventListener('click', (e) => {
      if (!infoPopover.hasAttribute('hidden') && !infoPopover.contains(e.target) && e.target !== infoBtn) closePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !infoPopover.hasAttribute('hidden')) closePopover();
    });
  }

  renderModuleNav('#progress-module-nav', progressCache.lessons, progressCache.completedIds, null);
}

async function initProgressPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('subscription_status, streak_count')
    .eq('id', userId)
    .single();
  const hasAccess = profile && ['active', 'trial', 'comp'].includes(profile.subscription_status);
  if (!hasAccess) {
    window.location.href = 'dashboard.html';
    return;
  }

  const [lessons, { data: progressRows }, { data: moduleQuizRows }, { data: practiceAttemptsRaw }, { data: flashcardRows }] = await Promise.all([
    fetchPublishedLessons(),
    supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId),
    supabaseClient.from('module_quiz_attempts').select('module_number, score, total').eq('user_id', userId),
    supabaseClient.from('practice_quiz_attempts').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    supabaseClient.from('flashcards').select('test_type').eq('published', true),
  ]);

  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  const courseCompletionPct = await computeWeightedProgress(userId, lessons || [], completedIds);

  // module_quiz_attempts holds one row per attempt (retakes included);
  // reduce to each module's BEST attempt so a practice retake that scored
  // lower never drags this average down, and "modules attempted" counts
  // distinct modules rather than every individual attempt.
  const quizRows = moduleQuizRows || [];
  const bestPctByModule = {};
  quizRows.forEach((r) => {
    const pct = r.total ? (r.score / r.total) * 100 : 0;
    if (!(r.module_number in bestPctByModule) || pct > bestPctByModule[r.module_number]) {
      bestPctByModule[r.module_number] = pct;
    }
  });
  const bestPcts = Object.values(bestPctByModule);
  const moduleQuizCount = bestPcts.length;
  const moduleQuizAvg = moduleQuizCount
    ? Math.round(bestPcts.reduce((sum, p) => sum + p, 0) / moduleQuizCount)
    : 0;

  // Flashcard "mastery": for each question bank, the most recent time each
  // card appeared in a Practice Interview attempt, was it graded correct?
  // Attempts are fetched oldest-first so a later attempt's grade overwrites
  // an earlier one for the same card.
  const bankTotals = {};
  (flashcardRows || []).forEach((f) => { bankTotals[f.test_type] = (bankTotals[f.test_type] || 0) + 1; });
  const latestGradeByCard = {}; // `${test_type}:${flashcard_id}` -> boolean
  const practiceAttempts = practiceAttemptsRaw || [];
  practiceAttempts.forEach((attempt) => {
    (attempt.answers || []).forEach((ans) => {
      latestGradeByCard[`${attempt.test_type}:${ans.flashcard_id}`] = !!ans.correct;
    });
  });
  const masteredCountByBank = {};
  Object.keys(latestGradeByCard).forEach((key) => {
    if (!latestGradeByCard[key]) return;
    const testType = key.split(':')[0];
    masteredCountByBank[testType] = (masteredCountByBank[testType] || 0) + 1;
  });
  const flashcardBanks = Object.keys(bankTotals)
    .sort((a, b) => bankTotals[b] - bankTotals[a])
    .map((testType) => ({ testType, correct: masteredCountByBank[testType] || 0, total: bankTotals[testType] }));

  // Most-recent-first for the history list and for "did they just pass".
  const practiceAttemptsDesc = practiceAttempts.slice().reverse();
  const practiceAvgPct = practiceAttempts.length
    ? Math.round(practiceAttempts.reduce((sum, a) => sum + (a.total ? (a.score / a.total) * 100 : 0), 0) / practiceAttempts.length)
    : 0;
  const primaryBank = flashcardBanks.find((b) => b.testType === 'test_128') || flashcardBanks[0];
  const flashcardPct = primaryBank && primaryBank.total ? Math.round((primaryBank.correct / primaryBank.total) * 100) : 0;

  // Composite readiness score: each component defaults to 0 if the member
  // hasn't done that kind of practice yet, so the score honestly reflects
  // what's still outstanding rather than politely ignoring gaps.
  const readinessScore = Math.round(
    courseCompletionPct * 0.35 +
    moduleQuizAvg * 0.25 +
    flashcardPct * 0.20 +
    practiceAvgPct * 0.20
  );

  progressCache = {
    lessons: lessons || [],
    completedIds,
    courseCompletionPct,
    moduleQuizAvg,
    moduleQuizCount,
    streak: (profile && profile.streak_count) || 0,
    flashcardBanks,
    practiceAttempts: practiceAttemptsDesc,
    readinessScore,
  };
  renderProgressPage();
}

// ==========================================================================
// "Know Your Country", 40-lesson narrative U.S. history section.
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
      return `<div class="kyc-lesson-row${isDone ? ' done' : ''}" data-lesson-number="${l.lesson_number}" role="button" tabindex="0">
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

  // Clickable divs (role="button" + tabindex above) need a keydown handler
  // for Enter/Space alongside the click handler to be keyboard-operable.
  listEl.querySelectorAll('[data-lesson-number]').forEach((row) => {
    const openRow = () => openKycLesson(parseInt(row.getAttribute('data-lesson-number'), 10));
    row.addEventListener('click', openRow);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openRow();
      }
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
// to whatever the site is currently displayed in, called every time a
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

  const courseLessons = await fetchPublishedLessons();
  const { data: courseProgress } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  renderModuleNav('#kyc-page-module-nav', courseLessons || [], new Set((courseProgress || []).map((p) => p.lesson_id)), null);

  const [kycLessons, { data: kycProgress }] = await Promise.all([
    fetchCountryLessons(),
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

  // Stop narration if the visitor navigates away or closes the tab;
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

// ---- Support (member-area contact form) --------------------------------
// support.html reuses the exact #contact-form markup/IDs from the public
// contact.html, so the shared submit handler in app.js (honeypot + timing
// spam checks, insert into contact_submissions) works here unmodified;
// this just pre-fills name/email from the signed-in member's profile and
// renders the sidebar module nav, same as every other member page.
async function initSupportPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single();

  const nameInput = document.querySelector('#contact-name');
  const emailInput = document.querySelector('#contact-email');
  if (nameInput) nameInput.value = (profile && profile.full_name) || '';
  if (emailInput) emailInput.value = (profile && profile.email) || session.user.email || '';

  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#support-module-nav', lessons || [], completedIds, null);
}

// ---- Reading & Writing (English literacy test prep) ---------------------
// Three practice tools for the reading/writing/spelling portion of the
// naturalization interview: read-aloud flashcards, a "hear it, write it"
// dictation exercise, and an alphabet keyboard for spelling practice.
// Content lives in reading_practice_items / writing_practice_items /
// alphabet_letters. audio_url starts NULL on every row (narration hasn't
// been recorded yet) -- every place that plays audio here checks for that
// and shows an "audio coming soon" state instead of a dead button, so this
// section can ship now and light up incrementally as audio gets added via
// the admin editor, with no code changes required later.

async function fetchReadingPracticeItems() {
  const cached = getCachedContent('reading_practice_items');
  if (cached) return cached;
  const { data } = await supabaseClient.from('reading_practice_items').select('*').eq('published', true).order('sort_order');
  const items = data || [];
  setCachedContent('reading_practice_items', items);
  return items;
}

async function fetchWritingPracticeItems() {
  const cached = getCachedContent('writing_practice_items');
  if (cached) return cached;
  const { data } = await supabaseClient.from('writing_practice_items').select('*').eq('published', true).order('sort_order');
  const items = data || [];
  setCachedContent('writing_practice_items', items);
  return items;
}

async function fetchAlphabetLetters() {
  const cached = getCachedContent('alphabet_letters');
  if (cached) return cached;
  const { data } = await supabaseClient.from('alphabet_letters').select('*').order('letter');
  const letters = data || [];
  setCachedContent('alphabet_letters', letters);
  return letters;
}

// One shared <audio> element reused by all three exercises so rapid
// clicking (especially on the alphabet keyboard) cuts off the previous
// clip instead of stacking overlapping sounds.
const rwAudioPlayer = (typeof Audio !== 'undefined') ? new Audio() : null;
function playRwAudio(url) {
  if (!rwAudioPlayer || !url) return;
  try {
    rwAudioPlayer.src = url;
    rwAudioPlayer.currentTime = 0;
    rwAudioPlayer.play().catch(() => {});
  } catch (e) { /* not fatal, just no sound this click */ }
}

// Builds the markup for a Play Audio button, or a muted "coming soon"
// badge when audio_url is still null. Delegated click handling (see
// initReadingWritingPage) reads the URL back off data-rw-play-audio, so
// this can be reused anywhere without wiring a fresh listener per card.
function buildRwAudioControl(audioUrl) {
  if (audioUrl) {
    return `<button type="button" class="btn btn-ghost rw-audio-btn" data-rw-play-audio="${escapeHtml(audioUrl)}">🔊 <span data-en="Play Audio" data-es="Reproducir Audio">Play Audio</span></button>`;
  }
  return `<span class="rw-audio-pending">🔇 <span data-en="Audio coming soon" data-es="Audio próximamente">Audio coming soon</span></span>`;
}

let readingPracticeCache = null; // { items, order, pos }
let writingPracticeCache = null; // { items, order, pos }
let alphabetLettersCache = [];
let rwSpellBuffer = '';
let rwActivePromptBtn = null;

// Landing page (picker) + three exercise views, one visible at a time.
// Reachable sections: 'picker' | 'reading' | 'writing' | 'alphabet'.
function showRwSection(section) {
  document.querySelector('#rw-picker-view').style.display = section === 'picker' ? 'block' : 'none';
  document.querySelector('#rw-reading-view').style.display = section === 'reading' ? 'block' : 'none';
  document.querySelector('#rw-writing-view').style.display = section === 'writing' ? 'block' : 'none';
  document.querySelector('#rw-alphabet-view').style.display = section === 'alphabet' ? 'block' : 'none';
}

function renderRwReadingCard() {
  if (!readingPracticeCache) return;
  const { items, order, pos } = readingPracticeCache;
  const item = items[order[pos]];
  if (!item) return;
  document.querySelector('#rw-read-sentence').textContent = item.sentence_text;
  document.querySelector('#rw-read-audio-slot').innerHTML = buildRwAudioControl(item.audio_url);
  document.querySelector('#rw-read-progress-text').textContent = `${pos + 1} / ${items.length}`;
  document.querySelector('#rw-read-prev-btn').disabled = pos === 0;
}

function renderRwWritingCard() {
  if (!writingPracticeCache) return;
  const { items, order, pos } = writingPracticeCache;
  const item = items[order[pos]];
  if (!item) return;
  document.querySelector('#rw-write-audio-slot').innerHTML = buildRwAudioControl(item.audio_url);
  document.querySelector('#rw-write-progress-text').textContent = `${pos + 1} / ${items.length}`;
  document.querySelector('#rw-write-prev-btn').disabled = pos === 0;
  document.querySelector('#rw-write-input').value = '';
  const resultEl = document.querySelector('#rw-write-result');
  resultEl.classList.remove('show', 'correct', 'incorrect');
}

// Lenient grading: real officers don't fail someone over a missing period
// or a capitalization slip, so comparison ignores case, punctuation, and
// extra whitespace. The "correct answer" shown back always displays the
// real sentence, exactly as written, regardless of how it was graded.
function normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkRwWritingAnswer() {
  if (!writingPracticeCache) return;
  const { items, order, pos } = writingPracticeCache;
  const item = items[order[pos]];
  if (!item) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const userAnswer = document.querySelector('#rw-write-input').value;
  const isCorrect = normalizeForCompare(userAnswer) === normalizeForCompare(item.sentence_text) && userAnswer.trim().length > 0;

  document.querySelector('#rw-write-user-answer').textContent = userAnswer.trim() || (lang === 'es' ? '(vacío)' : '(empty)');
  document.querySelector('#rw-write-correct-answer').textContent = item.sentence_text;
  const verdictEl = document.querySelector('#rw-write-verdict');
  verdictEl.textContent = isCorrect
    ? (lang === 'es' ? '✓ ¡Buen trabajo!' : '✓ Great job')
    : (lang === 'es' ? '✗ Sigue practicando' : '✗ Keep practicing');

  const resultEl = document.querySelector('#rw-write-result');
  resultEl.classList.add('show');
  resultEl.classList.toggle('correct', isCorrect);
  resultEl.classList.toggle('incorrect', !isCorrect);
}

function renderRwKeyboard() {
  const keyboardEl = document.querySelector('#rw-keyboard');
  if (!keyboardEl) return;
  keyboardEl.innerHTML = alphabetLettersCache.map((l) => {
    const hasAudio = !!l.audio_url;
    return `<button type="button" class="rw-key${hasAudio ? '' : ' no-audio'}" data-rw-letter="${l.letter}" data-rw-play-audio="${hasAudio ? escapeHtml(l.audio_url) : ''}" title="${hasAudio ? '' : 'Audio coming soon'}">${l.letter}</button>`;
  }).join('');
}

function updateRwSpellOutput() {
  const outputEl = document.querySelector('#rw-spell-output');
  if (outputEl) outputEl.textContent = rwSpellBuffer || ' ';
}

async function initReadingWritingPage() {
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

  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#rw-page-module-nav', lessons || [], completedIds, null);

  const [readingItems, writingItems, letters] = await Promise.all([
    fetchReadingPracticeItems(),
    fetchWritingPracticeItems(),
    fetchAlphabetLetters(),
  ]);

  // Shuffled fresh on every visit (not just when the Shuffle button is
  // clicked), so the order is different each time someone logs in.
  readingPracticeCache = { items: readingItems, order: shuffleArray(readingItems.map((_, i) => i)), pos: 0 };
  writingPracticeCache = { items: writingItems, order: shuffleArray(writingItems.map((_, i) => i)), pos: 0 };
  alphabetLettersCache = letters;

  renderRwReadingCard();
  renderRwWritingCard();
  renderRwKeyboard();
  showRwSection('picker');

  // Landing picker cards open a section; each section's back button
  // returns to the picker.
  document.querySelectorAll('.rw-picker-card').forEach((btn) => {
    btn.addEventListener('click', () => showRwSection(btn.getAttribute('data-rw-section')));
  });
  document.querySelectorAll('[data-rw-back]').forEach((btn) => {
    btn.addEventListener('click', () => showRwSection('picker'));
  });

  // Delegated audio-button handling, covers reading cards, writing cards,
  // and every alphabet key without binding a listener per element.
  document.querySelector('.app-content').addEventListener('click', (e) => {
    const audioBtn = e.target.closest('[data-rw-play-audio]');
    if (!audioBtn) return;
    const url = audioBtn.getAttribute('data-rw-play-audio');
    if (url) playRwAudio(url); // no-audio alphabet key just skips playback

    // Alphabet keys always append to the spelling buffer, whether or not
    // their sound has been recorded yet -- spelling practice shouldn't be
    // blocked on narration the same way hearing the letter is.
    const letter = audioBtn.getAttribute('data-rw-letter');
    if (letter) {
      rwSpellBuffer += letter;
      updateRwSpellOutput();
    }
  });

  // Reading controls
  document.querySelector('#rw-read-prev-btn').addEventListener('click', () => {
    if (!readingPracticeCache || readingPracticeCache.pos === 0) return;
    readingPracticeCache.pos -= 1;
    renderRwReadingCard();
  });
  document.querySelector('#rw-read-next-btn').addEventListener('click', () => {
    if (!readingPracticeCache) return;
    readingPracticeCache.pos = (readingPracticeCache.pos + 1) % readingPracticeCache.order.length;
    renderRwReadingCard();
  });
  document.querySelector('#rw-read-shuffle-btn').addEventListener('click', () => {
    if (!readingPracticeCache) return;
    readingPracticeCache.order = shuffleArray(readingPracticeCache.order);
    readingPracticeCache.pos = 0;
    renderRwReadingCard();
  });

  // Writing controls
  document.querySelector('#rw-write-prev-btn').addEventListener('click', () => {
    if (!writingPracticeCache || writingPracticeCache.pos === 0) return;
    writingPracticeCache.pos -= 1;
    renderRwWritingCard();
  });
  document.querySelector('#rw-write-next-btn').addEventListener('click', () => {
    if (!writingPracticeCache) return;
    writingPracticeCache.pos = (writingPracticeCache.pos + 1) % writingPracticeCache.order.length;
    renderRwWritingCard();
  });
  document.querySelector('#rw-write-shuffle-btn').addEventListener('click', () => {
    if (!writingPracticeCache) return;
    writingPracticeCache.order = shuffleArray(writingPracticeCache.order);
    writingPracticeCache.pos = 0;
    renderRwWritingCard();
  });
  document.querySelector('#rw-write-check-btn').addEventListener('click', checkRwWritingAnswer);
  document.querySelector('#rw-write-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); checkRwWritingAnswer(); }
  });

  // Alphabet / spelling controls
  document.querySelector('#rw-spell-space-btn').addEventListener('click', () => {
    rwSpellBuffer += ' ';
    updateRwSpellOutput();
  });
  document.querySelector('#rw-spell-backspace-btn').addEventListener('click', () => {
    rwSpellBuffer = rwSpellBuffer.slice(0, -1);
    updateRwSpellOutput();
  });
  document.querySelector('#rw-spell-clear-btn').addEventListener('click', () => {
    rwSpellBuffer = '';
    updateRwSpellOutput();
  });
  document.querySelectorAll('.rw-prompt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const alreadyActive = btn === rwActivePromptBtn;
      document.querySelectorAll('.rw-prompt-btn').forEach((b) => b.classList.remove('active'));
      const promptEl = document.querySelector('#rw-active-prompt');
      if (alreadyActive) {
        rwActivePromptBtn = null;
        promptEl.style.display = 'none';
        return;
      }
      btn.classList.add('active');
      rwActivePromptBtn = btn;
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      promptEl.textContent = lang === 'es' ? btn.getAttribute('data-rw-prompt-es') : btn.getAttribute('data-rw-prompt-en');
      promptEl.style.display = 'block';
      rwSpellBuffer = '';
      updateRwSpellOutput();
    });
  });
}

// ---- Documents (official USCIS reference materials) ---------------------
// Files live in Supabase Storage (official-documents bucket, public read,
// admin-only write) and are shown in an inline <iframe> on this page --
// never a direct download link, never linked out to uscis.gov or anywhere
// else. file_url is stored as a complete Storage URL (same convention as
// lesson video_url/audio_url), set by the admin panel's upload flow.
let officialDocumentsCache = [];
let openDocumentId = null;

async function fetchOfficialDocuments() {
  const cached = getCachedContent('official_documents');
  if (cached) return cached;
  const { data } = await supabaseClient.from('official_documents').select('*').eq('published', true).order('sort_order');
  const docs = data || [];
  setCachedContent('official_documents', docs);
  return docs;
}

// Line-art file icon (Feather-style, matches the site's other inline SVG
// icons like the module-lock icon) -- swapped in for the old plain-text
// "PDF" badge, which read as an unstyled placeholder rather than a
// deliberate icon.
const DOC_FILE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>';
const DOC_CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

function renderDocumentsList() {
  const listEl = document.querySelector('#doc-list');
  if (!listEl) return;
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const countEl = document.querySelector('#doc-count');
  if (countEl) {
    const n = officialDocumentsCache.length;
    countEl.textContent = n ? (lang === 'es' ? `${n} documento${n === 1 ? '' : 's'}` : `${n} document${n === 1 ? '' : 's'}`) : '';
  }
  if (!officialDocumentsCache.length) {
    listEl.innerHTML = '<p class="empty-state">No documents available yet.</p>';
    return;
  }
  listEl.innerHTML = officialDocumentsCache.map((d) => `
    <button class="card doc-card" data-doc-open="${d.id}">
      <span class="doc-card-icon" aria-hidden="true">${DOC_FILE_ICON_SVG}</span>
      <span class="doc-card-body">
        <h3>${escapeHtml(localize(d, 'title'))}</h3>
        ${d.description ? `<p class="small muted">${escapeHtml(localize(d, 'description'))}</p>` : ''}
      </span>
      <span class="doc-card-arrow">${DOC_CHEVRON_SVG}</span>
    </button>
  `).join('');
}

function openDocument(id) {
  const doc = officialDocumentsCache.find((d) => d.id === id);
  if (!doc) return;
  openDocumentId = id;
  document.querySelector('#doc-list-view').style.display = 'none';
  document.querySelector('#doc-viewer-view').style.display = 'block';
  document.querySelector('#doc-viewer-title').textContent = localize(doc, 'title');
  // #toolbar=0 hides the built-in PDF viewer toolbar in browsers that
  // honor it (Firefox, Chromium to a degree) -- there's no fully reliable
  // cross-browser way to stop someone using their browser's own save
  // function, but this at least removes our own download affordance and
  // the most visible built-in one.
  document.querySelector('#doc-viewer-frame').src = doc.file_url + '#toolbar=0';
}

function closeDocumentViewer() {
  openDocumentId = null;
  document.querySelector('#doc-viewer-view').style.display = 'none';
  document.querySelector('#doc-list-view').style.display = 'block';
  // 'about:blank', not '', actually clears the frame -- an empty string
  // src just resolves back to the current page URL.
  document.querySelector('#doc-viewer-frame').src = 'about:blank';
}

async function initDocumentsPage() {
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

  const lessons = await fetchPublishedLessons();
  const { data: progressRows } = await supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId);
  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  renderModuleNav('#documents-page-module-nav', lessons || [], completedIds, null);

  officialDocumentsCache = await fetchOfficialDocuments();
  renderDocumentsList();

  document.querySelector('#doc-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-doc-open]');
    if (!btn) return;
    openDocument(btn.getAttribute('data-doc-open'));
  });
  document.querySelector('#doc-back-btn')?.addEventListener('click', closeDocumentViewer);
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined') return;
  if (document.body.hasAttribute('data-dashboard-page')) initDashboard();
  if (document.body.hasAttribute('data-lesson-page')) initLessonPage();
  if (document.body.hasAttribute('data-flashcards-page')) initFlashcardsPage();
  if (document.body.hasAttribute('data-practice-quiz-page')) initPracticeQuizPage();
  if (document.body.hasAttribute('data-kyc-page')) initKycPage();
  if (document.body.hasAttribute('data-settings-page')) initSettingsPage();
  if (document.body.hasAttribute('data-progress-page')) initProgressPage();
  if (document.body.hasAttribute('data-support-page')) initSupportPage();
  if (document.body.hasAttribute('data-mock-interview-page')) initMockInterviewPage();
  if (document.body.hasAttribute('data-rw-page')) initReadingWritingPage();
  if (document.body.hasAttribute('data-documents-page')) initDocumentsPage();
});

// Re-render dynamic content in place when the visitor toggles EN/ES;
// no refetch needed since app.js's setLang() only changed which language
// is "current"; the underlying data we already loaded hasn't changed.
window.addEventListener('ciudadanoready:langchange', () => {
  if (document.body.hasAttribute('data-dashboard-page')) {
    renderDashboard();
    renderCheckoutNotice();
    reshowBillingBannerIfVisible();
  }
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
  if (document.body.hasAttribute('data-progress-page')) renderProgressPage();
  if (document.body.hasAttribute('data-rw-page')) {
    // Reading/writing sentences are English-only by design (it's a literacy
    // test), and the Play Audio / Audio coming soon labels already use
    // data-en/data-es spans that app.js's setLang() sweeps automatically --
    // no re-render needed here, and re-rendering would wipe out whatever
    // the member was mid-typing in the writing exercise. Only the alphabet
    // spelling prompt needs an explicit update, since its label text is
    // swapped via data-rw-prompt-en/es rather than the standard attributes.
    if (rwActivePromptBtn) {
      const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
      document.querySelector('#rw-active-prompt').textContent = lang === 'es'
        ? rwActivePromptBtn.getAttribute('data-rw-prompt-es')
        : rwActivePromptBtn.getAttribute('data-rw-prompt-en');
    }
  }
  if (document.body.hasAttribute('data-documents-page')) {
    renderDocumentsList();
    // Title is plain textContent (JS-rendered), so it needs an explicit
    // re-localize on language toggle; the iframe itself doesn't change.
    if (openDocumentId) {
      const doc = officialDocumentsCache.find((d) => d.id === openDocumentId);
      const titleEl = document.querySelector('#doc-viewer-title');
      if (doc && titleEl) titleEl.textContent = localize(doc, 'title');
    }
  }
});
