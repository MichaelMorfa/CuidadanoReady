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

// A module's quiz (shown only on the last lesson of that module — see
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
    const lessonWord = lang === 'es' ? 'Lección' : 'Lesson';
    html += `<li><a href="lesson.html?id=${firstLesson.id}" class="module-nav-link ${isExpanded ? 'active' : ''}"><span class="module-nav-badge${allDone ? ' done' : ''}">${allDone ? '✓' : m}</span>${escapeHtml(moduleName(m))}</a>`;
    if (isExpanded) {
      html += '<ul class="lesson-sub-list">';
      moduleLessons.forEach((l, i) => {
        const done = completedIds.has(l.id);
        const isCurrent = expandLesson.id === l.id;
        html += `<li><a href="lesson.html?id=${l.id}" class="${isCurrent ? 'current' : ''}"><span class="check${done ? ' done' : ''}">${done ? '✓' : ''}</span><span class="lesson-sub-text"><span class="lesson-sub-label">${lessonWord} ${i + 1}</span><span class="lesson-sub-title">${escapeHtml(localize(l, 'title'))}</span></span></a></li>`;
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

// Progress % weighted by how much is actually in each module, instead of
// a flat "completed lessons / total lessons" ratio. A lesson's "weight" is
// its content length in characters (a genuine proxy for how much reading/
// study it represents), plus a fixed chunk of weight for that lesson's
// video (once it has one) and for its module's quiz (once published) —
// both only counted as "earned" when the video's lesson is completed /
// the quiz is passed, not just because they exist.
async function computeWeightedProgress(userId, lessons, completedIds) {
  const [{ data: quizRows }, { data: passedRows }] = await Promise.all([
    supabaseClient.from('quiz_questions').select('module_number').eq('published', true),
    supabaseClient.from('module_quiz_results').select('module_number, passed').eq('user_id', userId),
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
  en: { instructions: (n) => `Answer all ${n} question${n === 1 ? '' : 's'}, then submit. You need ${Math.round(MODULE_QUIZ_PASS_RATIO * 100)}% correct to pass and complete this module.`, submit: 'Submit Quiz', passTitle: (s, t) => `Passed! ${s}/${t} correct.`, failTitle: (s, t) => `Not quite — ${s}/${t} correct.`, failBody: 'Review the highlighted answers below, then try again.', retry: 'Retry Quiz', unanswered: 'Please answer every question before submitting.' },
  es: { instructions: (n) => `Responde las ${n} preguntas y envía tus respuestas. Necesitas ${Math.round(MODULE_QUIZ_PASS_RATIO * 100)}% correctas para aprobar y completar este módulo.`, submit: 'Enviar Cuestionario', passTitle: (s, t) => `¡Aprobado! ${s}/${t} correctas.`, failTitle: (s, t) => `Aún no — ${s}/${t} correctas.`, failBody: 'Revisa las respuestas resaltadas abajo e inténtalo de nuevo.', retry: 'Reintentar Cuestionario', unanswered: 'Por favor responde todas las preguntas antes de enviar.' },
};

function buildModuleQuizHtml(quizQs) {
  const lang = window.getCurrentLang ? window.getCurrentLang() : 'en';
  const ml = MODULE_QUIZ_LABELS[lang] || MODULE_QUIZ_LABELS.en;
  const questionsHtml = quizQs.map((q, i) => {
    const choices = shuffleArray([
      ['a', localize(q, 'choice_a')],
      ['b', localize(q, 'choice_b')],
      ['c', localize(q, 'choice_c')],
      ['d', localize(q, 'choice_d')],
    ]);
    const optionsHtml = choices.map(([key, text]) => `
      <label class="module-quiz-option" data-key="${key}">
        <input type="radio" name="mq-${q.id}" value="${key}">
        <span>${escapeHtml(text)}</span>
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
// against each question's data-correct attribute, persists the attempt to
// module_quiz_results (upsert — retaking replaces the prior score), and
// calls onGraded(passed) so the caller can unlock "Mark Complete".
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
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    let correctCount = 0;
    qBlocks.forEach((block) => {
      const qid = block.getAttribute('data-question-id');
      const correctKey = block.getAttribute('data-correct');
      const checked = form.querySelector(`input[name="mq-${qid}"]:checked`);
      const isCorrect = checked && checked.value === correctKey;
      if (isCorrect) correctCount += 1;
      block.querySelectorAll('.module-quiz-option').forEach((opt) => {
        opt.classList.remove('correct', 'incorrect');
        if (opt.getAttribute('data-key') === correctKey) opt.classList.add('correct');
        else if (checked && opt.getAttribute('data-key') === checked.value) opt.classList.add('incorrect');
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

    await supabaseClient.from('module_quiz_results').upsert(
      { user_id: userId, module_number: moduleNumber, score: correctCount, total, passed },
      { onConflict: 'user_id,module_number' }
    );

    if (lessonCache) lessonCache.moduleQuizResult = { module_number: moduleNumber, score: correctCount, total, passed };
    if (onGraded) onGraded(passed);
  });
}

// ---- Lesson page --------------------------------------------------------
// Cached so a language toggle can re-render instantly without refetching.
let lessonCache = null;

function renderLessonPage() {
  if (!lessonCache) return;
  const { lessons, lesson, completedIds, moduleQuizQs, moduleQuizResult, isLastLessonOfModule, userId } = lessonCache;
  const quizViewActive = !!lessonCache.quizViewActive;

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

  const requiresQuizPass = isLastLessonOfModule && moduleQuizQs && moduleQuizQs.length > 0;
  const alreadyPassedQuiz = !!(moduleQuizResult && moduleQuizResult.passed);

  // Reading view (video + Study Guide) and the quiz are two separate
  // "screens" of this page — never shown together — so a lesson with a
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
      quizBackLink.onclick = (e) => { e.preventDefault(); lessonCache.quizViewActive = false; renderLessonPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    }
    if (alreadyPassedQuiz) {
      const lang2 = window.getCurrentLang ? window.getCurrentLang() : 'en';
      const ml = MODULE_QUIZ_LABELS[lang2] || MODULE_QUIZ_LABELS.en;
      quizWrap.innerHTML = `<div class="module-quiz-passed-note">
        <span>✓ ${escapeHtml(ml.passTitle(moduleQuizResult.score, moduleQuizResult.total))}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="module-quiz-retake-btn">${escapeHtml(ml.retakeLink)}</button>
      </div>`;
      const retakeBtn = quizWrap.querySelector('#module-quiz-retake-btn');
      if (retakeBtn) retakeBtn.onclick = () => {
        quizWrap.innerHTML = buildModuleQuizHtml(moduleQuizQs);
        bindModuleQuiz(quizWrap, lesson.module_number, userId, () => renderLessonPage());
      };
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
  // actively taking it (button hides — the quiz form has its own submit),
  // or passed (button behaves exactly like a normal lesson's).
  const needsToTakeQuiz = requiresQuizPass && !alreadyPassedQuiz;
  const hideNextLink = needsToTakeQuiz && quizViewActive;
  const labels = {
    en: { next: 'Next Lesson →', markContinue: 'Mark Complete & Continue →', back: 'Back to Dashboard', markFinish: 'Mark Complete & Finish ✓', takeQuiz: 'Take Module Quiz →', intro: (n, pct) => `This module ends with a short quiz — ${n} questions, ${pct}% to pass.`, review: 'Review' },
    es: { next: 'Siguiente lección →', markContinue: 'Marcar completado y continuar →', back: 'Volver al panel', markFinish: 'Marcar completado y finalizar ✓', takeQuiz: 'Tomar Cuestionario del Módulo →', intro: (n, pct) => `Este módulo termina con un cuestionario corto — ${n} preguntas, ${pct}% para aprobar.`, review: 'Revisar' },
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
        statusLine.innerHTML = `✓ ${escapeHtml(ml.passTitle(moduleQuizResult.score, moduleQuizResult.total))} · <a id="lesson-quiz-review-link">${escapeHtml(l.review)}</a>`;
        const reviewLink = statusLine.querySelector('#lesson-quiz-review-link');
        if (reviewLink) reviewLink.onclick = () => { lessonCache.quizViewActive = true; renderLessonPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
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

  // The module quiz is shown only on the last lesson of its module — it
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
  let moduleQuizResult = null;
  if (isLastLessonOfModule) {
    const [{ data: quizQs }, { data: resultRow }] = await Promise.all([
      supabaseClient.from('quiz_questions').select('*').eq('module_number', lesson.module_number).eq('published', true).order('sort_order'),
      supabaseClient.from('module_quiz_results').select('*').eq('user_id', userId).eq('module_number', lesson.module_number).maybeSingle(),
    ]);
    moduleQuizQs = quizQs || [];
    moduleQuizResult = resultRow || null;
  }

  lessonCache = { lessons, lesson, completedIds, moduleQuizQs, moduleQuizResult, isLastLessonOfModule, userId, quizViewActive: false };
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

// ---- Settings page --------------------------------------------------------
// Profile (name/email), password change, appearance (dark mode — the
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
  if (viewNameEl) viewNameEl.textContent = currentName || '—';
  if (viewEmailEl) viewEmailEl.textContent = currentEmail || '—';

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
  const { data: lessons } = await supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order');
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

      if (viewNameEl) viewNameEl.textContent = newName || '—';
      // Don't flip the displayed email until the confirmation link is
      // clicked — Supabase doesn't apply it until then, so showing the new
      // address now would be misleading.
      if (!emailChanged && viewEmailEl) viewEmailEl.textContent = newEmail || '—';

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
      // change — signInWithPassword re-authenticates against it without
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

const READINESS_TIERS = [
  { max: 39, tier: 1, en: 'Getting Started', es: 'Comenzando' },
  { max: 64, tier: 2, en: 'Building Confidence', es: 'Ganando Confianza' },
  { max: 84, tier: 3, en: 'Making Good Progress', es: 'Buen Progreso' },
  { max: 101, tier: 4, en: 'Interview Ready', es: 'Listo para la Entrevista' },
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
    quizAvgEl.textContent = '—';
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

  const [{ data: lessons }, { data: progressRows }, { data: moduleQuizRows }, { data: practiceAttemptsRaw }, { data: flashcardRows }] = await Promise.all([
    supabaseClient.from('lessons').select('*').eq('published', true).order('module_number').order('sort_order'),
    supabaseClient.from('lesson_progress').select('lesson_id').eq('user_id', userId),
    supabaseClient.from('module_quiz_results').select('score, total').eq('user_id', userId),
    supabaseClient.from('practice_quiz_attempts').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    supabaseClient.from('flashcards').select('test_type').eq('published', true),
  ]);

  const completedIds = new Set((progressRows || []).map((p) => p.lesson_id));
  const courseCompletionPct = await computeWeightedProgress(userId, lessons || [], completedIds);

  const quizRows = moduleQuizRows || [];
  const moduleQuizCount = quizRows.length;
  const moduleQuizAvg = moduleQuizCount
    ? Math.round(quizRows.reduce((sum, r) => sum + (r.total ? (r.score / r.total) * 100 : 0), 0) / moduleQuizCount)
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
  if (document.body.hasAttribute('data-settings-page')) initSettingsPage();
  if (document.body.hasAttribute('data-progress-page')) initProgressPage();
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
  if (document.body.hasAttribute('data-progress-page')) renderProgressPage();
});
