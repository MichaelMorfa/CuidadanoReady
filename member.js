/* ==========================================================================
   Ciudadano Ready — Member area logic (dashboard.html + lesson.html)
   Reads real course content + progress from Supabase; no more hardcoded
   placeholder numbers. Loaded after app.js, which handles the auth guard.
   ========================================================================== */

const MODULE_NAMES = {
  1: 'Eligibility',
  2: 'N-400',
  3: 'Biometrics',
  4: 'English Test',
  5: 'Civics Test',
  6: 'Interview',
  7: 'Oath',
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    const label = small ? '' : `<span class="stamp-label">${escapeHtml(MODULE_NAMES[m])}</span>`;
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
      html += `<li style="padding:10px 24px; font-size:0.92rem; color:var(--slate);">${m}. ${escapeHtml(MODULE_NAMES[m])} <span class="small muted">— Coming soon</span></li>`;
      continue;
    }
    const allDone = moduleLessons.every((l) => completedIds.has(l.id));
    const isExpanded = expandLesson && expandLesson.module_number === m;
    const firstLesson = moduleLessons[0];
    html += `<li><a href="lesson.html?id=${firstLesson.id}" class="${isExpanded ? 'active' : ''}"><span class="check${allDone ? ' done' : ''}">${allDone ? '✓' : ''}</span>&nbsp;${m}. ${escapeHtml(MODULE_NAMES[m])}</a>`;
    if (isExpanded) {
      html += '<ul class="lesson-sub-list">';
      moduleLessons.forEach((l) => {
        const done = completedIds.has(l.id);
        const isCurrent = expandLesson.id === l.id;
        html += `<li><a href="lesson.html?id=${l.id}" class="${isCurrent ? 'current' : ''}"><span class="check${done ? ' done' : ''}">${done ? '✓' : ''}</span> ${escapeHtml(l.title)}</a></li>`;
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
  const choices = [['a', q.choice_a], ['b', q.choice_b], ['c', q.choice_c], ['d', q.choice_d]];
  const optionsHtml = choices.map(([key, text]) => `<button class="quiz-option" data-correct="${key === q.correct_choice ? 'true' : 'false'}">${escapeHtml(text)}</button>`).join('');
  return `<div class="quiz-box" data-question-id="${q.id}">
    <span class="badge" style="margin-bottom:12px; display:inline-block;">PRACTICE QUESTION</span>
    <h3 style="font-family:var(--font-sans); font-size:1.05rem;">${escapeHtml(q.question)}</h3>
    ${optionsHtml}
    <div class="quiz-feedback" data-correct-msg="Correct!" data-incorrect-msg="Not quite — review the highlighted answer."></div>
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

  const currentLesson = lessons.find((l) => !completedIds.has(l.id));
  if (currentLesson) {
    const moduleLessons = lessons.filter((l) => l.module_number === currentLesson.module_number);
    const idxInModule = moduleLessons.findIndex((l) => l.id === currentLesson.id) + 1;
    document.querySelector('#stat-current-stage').textContent = `Stage ${currentLesson.module_number}: ${MODULE_NAMES[currentLesson.module_number]}`;
    document.querySelector('#stat-current-lesson-count').textContent = `Lesson ${idxInModule} of ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-title').textContent = currentLesson.title;
    document.querySelector('#continue-lesson-meta').textContent = `Stage ${currentLesson.module_number}: ${MODULE_NAMES[currentLesson.module_number]} · Lesson ${idxInModule} of ${moduleLessons.length}`;
    document.querySelector('#continue-lesson-link').setAttribute('href', 'lesson.html?id=' + currentLesson.id);
  } else {
    document.querySelector('#stat-current-stage').textContent = 'Course complete! 🎉';
    document.querySelector('#stat-current-lesson-count').textContent = '';
    document.querySelector('#dashboard-continue-card').style.display = 'none';
  }

  renderStampPath('#dashboard-stamp-path', lessons, completedIds, currentLesson, false);
  renderModuleNav('#dashboard-module-nav', lessons, completedIds, null);
}

// ---- Lesson page --------------------------------------------------------
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

  document.querySelector('#lesson-stage-eyebrow').textContent = `STAGE ${lesson.module_number} OF 7`;
  document.querySelector('#lesson-stage-title').textContent = MODULE_NAMES[lesson.module_number];
  document.title = `Stage ${lesson.module_number}: ${MODULE_NAMES[lesson.module_number]} — Ciudadano Ready`;

  renderStampPath('#lesson-stamp-path', lessons, completedIds, lesson, true);

  const moduleLessons = lessons.filter((l) => l.module_number === lesson.module_number);
  const idxInModule = moduleLessons.findIndex((l) => l.id === lesson.id);
  document.querySelector('#lesson-badge').textContent = `LESSON ${idxInModule + 1} OF ${moduleLessons.length}`;
  document.querySelector('#lesson-title-h1').textContent = lesson.title;

  const videoWrap = document.querySelector('#lesson-video-wrap');
  if (lesson.video_url) {
    videoWrap.style.display = 'block';
    videoWrap.innerHTML = buildVideoEmbed(lesson.video_url);
  } else {
    videoWrap.style.display = 'none';
    videoWrap.innerHTML = '';
  }

  const contentEl = document.querySelector('#lesson-content');
  const paragraphs = (lesson.content || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  contentEl.innerHTML = paragraphs.length
    ? paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    : '<p class="small muted" style="margin:0;">No content yet for this lesson.</p>';

  const { data: quizQs } = await supabaseClient
    .from('quiz_questions')
    .select('*')
    .eq('module_number', lesson.module_number)
    .eq('published', true)
    .order('sort_order')
    .limit(1);

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

  const prevLink = document.querySelector('#lesson-prev-link');
  if (prevLesson) {
    prevLink.setAttribute('href', 'lesson.html?id=' + prevLesson.id);
    prevLink.style.visibility = 'visible';
  } else {
    prevLink.style.visibility = 'hidden';
  }

  const nextLink = document.querySelector('#lesson-next-link');
  const alreadyDone = completedIds.has(lesson.id);
  nextLink.textContent = nextLesson
    ? (alreadyDone ? 'Next Lesson →' : 'Mark Complete & Continue →')
    : (alreadyDone ? 'Back to Dashboard' : 'Mark Complete & Finish ✓');
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

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined') return;
  if (document.body.hasAttribute('data-dashboard-page')) initDashboard();
  if (document.body.hasAttribute('data-lesson-page')) initLessonPage();
});
