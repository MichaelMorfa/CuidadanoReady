/* ==========================================================================
   Ciudadano Ready | Admin panel logic
   Only loaded on admin/index.html. Assumes supabaseClient + the
   data-admin-required guard in app.js have already run.
   ========================================================================== */

const MODULE_NAMES = {
  1: 'Welcome',
  2: 'Eligibility',
  3: 'N-400 Application',
  4: 'Biometrics',
  5: 'Interview & Exam Prep',
  6: 'The Interview',
  7: 'Oath Ceremony',
};

const FLASHCARD_TEST_NAMES = {
  test_100: '100-Question Test (2008 version)',
  test_128: '128-Question Test (2025 version)',
  test_20: '20-Question Test (65/20)',
};

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined') return;
  const panelTitles = {
    overview: 'Analytics',
    users: 'Users',
    lessons: 'Course Editor',
    quizzes: 'Quiz Editor',
    flashcards: 'Flashcards Editor',
    'country-lessons': 'Know Your Country Editor',
    'mock-interview': 'Mock Interview Editor',
    'reading-writing': 'Reading & Writing Editor',
    documents: 'Documents Editor',
    revenue: 'Payments',
    support: 'Support',
  };

  // ---- Panel switching -----------------------------------------------
  const panelLinks = document.querySelectorAll('[data-panel-link]');
  const panels = document.querySelectorAll('.admin-panel');
  const titleEl = document.querySelector('#admin-panel-title');

  function showPanel(name) {
    panels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === name));
    panelLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('data-panel-link') === name));
    if (titleEl) titleEl.textContent = panelTitles[name] || name;
    if (name === 'overview') loadOverview();
    if (name === 'users') loadUsers();
    if (name === 'lessons') loadLessons();
    if (name === 'quizzes') loadQuizzes();
    if (name === 'flashcards') loadFlashcards();
    if (name === 'country-lessons') loadCountryLessons();
    if (name === 'mock-interview') loadMockInterview();
    if (name === 'reading-writing') loadReadingWritingEditor();
    if (name === 'documents') loadDocuments();
    if (name === 'revenue') loadRevenue();
    if (name === 'support') loadSupport();
  }

  panelLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(link.getAttribute('data-panel-link'));
    });
  });

  // ---- Overview / analytics --------------------------------------------
  async function loadOverview() {
    const setStat = (id, value) => {
      const el = document.querySelector(id);
      if (el) el.textContent = value;
    };

    const { count: totalUsers } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true });
    setStat('#stat-total-users', totalUsers ?? 0);

    const { count: activeSubs } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active');
    setStat('#stat-active-subs', activeSubs ?? 0);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: newWeek } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo);
    setStat('#stat-new-week', newWeek ?? 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { count: newMonth } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString());
    setStat('#stat-new-month', newMonth ?? 0);

    const { count: openTickets } = await supabaseClient.from('contact_submissions').select('*', { count: 'exact', head: true }).eq('status', 'open');
    setStat('#stat-open-tickets', openTickets ?? 0);

    const { count: publishedLessons } = await supabaseClient.from('lessons').select('*', { count: 'exact', head: true }).eq('published', true);
    setStat('#stat-lessons', publishedLessons ?? 0);

    const { data: quizStats } = await supabaseClient.from('quiz_questions').select('times_correct, times_incorrect');
    if (quizStats && quizStats.length) {
      const correct = quizStats.reduce((sum, q) => sum + (q.times_correct || 0), 0);
      const incorrect = quizStats.reduce((sum, q) => sum + (q.times_incorrect || 0), 0);
      const total = correct + incorrect;
      setStat('#stat-quiz-accuracy', total > 0 ? Math.round((correct / total) * 100) + '%' : 'No attempts yet');
    } else {
      setStat('#stat-quiz-accuracy', 'No attempts yet');
    }

    // In-house error log (see app.js's window.onerror/unhandledrejection
    // handlers), surfaces real breakage here instead of only via support
    // emails. Only unresolved errors count toward the headline stat —
    // that's the number that should actually need your attention.
    const weekAgoErrors = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: errorCount } = await supabaseClient.from('client_error_log').select('*', { count: 'exact', head: true }).eq('resolved', false).gte('created_at', weekAgoErrors);
    setStat('#stat-client-errors', errorCount ?? 0);

    await loadClientErrors();

    // Public-site FAQ chat widget (see app.js), every question a visitor
    // types is logged, matched or not. Unmatched questions are the useful
    // signal here: real gaps in site_faq_entries coverage, worth adding as
    // new entries (or, later, feeding into a real-AI version's context).
    const weekAgoFaq = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: faqQueries } = await supabaseClient
      .from('faq_bot_queries')
      .select('matched')
      .gte('created_at', weekAgoFaq);
    const faqTotal = (faqQueries || []).length;
    const faqUnmatched = (faqQueries || []).filter((q) => !q.matched).length;
    setStat('#stat-faq-bot', faqTotal ? `${faqUnmatched} / ${faqTotal}` : '0');

    const faqListEl = document.querySelector('#faq-bot-unmatched-list');
    if (faqListEl) {
      const { data: recentUnmatched, error: faqErr } = await supabaseClient
        .from('faq_bot_queries')
        .select('*')
        .eq('matched', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (faqErr) {
        faqListEl.innerHTML = `<p class="empty-state">Could not load queries: ${escapeHtml(faqErr.message)}</p>`;
      } else if (!recentUnmatched || !recentUnmatched.length) {
        faqListEl.innerHTML = '<p class="empty-state">No unanswered questions. 🎉</p>';
      } else {
        faqListEl.innerHTML = recentUnmatched.map((q) => `
          <div style="padding:10px 0; border-top:1px solid var(--line);">
            <div class="flex justify-between items-center" style="gap:10px;">
              <span class="small">${escapeHtml(q.question_text || '')}</span>
              <span class="small muted" style="white-space:nowrap;">${formatDate(q.created_at)}</span>
            </div>
          </div>
        `).join('');
      }
    }
  }

  // ---- Recent errors list (resolve/hide so fixed bugs stop cluttering it) -
  async function loadClientErrors() {
    const errorsListEl = document.querySelector('#client-errors-list');
    if (!errorsListEl) return;
    const showResolved = document.querySelector('#client-errors-show-resolved')?.checked;

    let query = supabaseClient.from('client_error_log').select('*').order('created_at', { ascending: false }).limit(20);
    if (!showResolved) query = query.eq('resolved', false);
    const { data: recentErrors, error: errorsErr } = await query;

    if (errorsErr) {
      errorsListEl.innerHTML = `<p class="empty-state">Could not load errors: ${escapeHtml(errorsErr.message)}</p>`;
    } else if (!recentErrors || !recentErrors.length) {
      errorsListEl.innerHTML = showResolved
        ? '<p class="empty-state">No errors reported. 🎉</p>'
        : '<p class="empty-state">No unresolved errors. 🎉</p>';
    } else {
      errorsListEl.innerHTML = recentErrors.map((e) => `
        <div style="padding:10px 0; border-top:1px solid var(--line); opacity:${e.resolved ? '0.6' : '1'};">
          <div class="flex justify-between items-center" style="gap:10px;">
            <strong class="small" style="color:${e.resolved ? 'var(--muted)' : 'var(--danger)'};">${escapeHtml(e.message || 'Unknown error')}</strong>
            <div class="flex items-center gap-8" style="white-space:nowrap;">
              <span class="small muted">${formatDate(e.created_at)}</span>
              ${e.resolved
                ? `<button class="btn btn-ghost btn-sm" data-error-unresolve="${e.id}">Unresolve</button>`
                : `<button class="btn btn-ghost btn-sm" data-error-resolve="${e.id}">Mark Fixed</button>`}
            </div>
          </div>
          <div class="small muted">${escapeHtml(e.page || '')}${e.source ? ' · ' + escapeHtml(e.source) + (e.lineno ? ':' + e.lineno : '') : ''}</div>
        </div>
      `).join('');
    }
  }

  document.querySelector('#client-errors-show-resolved')?.addEventListener('change', loadClientErrors);

  document.querySelector('#client-errors-list')?.addEventListener('click', async (e) => {
    const resolveBtn = e.target.closest('[data-error-resolve]');
    const unresolveBtn = e.target.closest('[data-error-unresolve]');
    if (resolveBtn) {
      const id = resolveBtn.getAttribute('data-error-resolve');
      resolveBtn.disabled = true;
      await supabaseClient.from('client_error_log').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id);
      await loadClientErrors();
    } else if (unresolveBtn) {
      const id = unresolveBtn.getAttribute('data-error-unresolve');
      unresolveBtn.disabled = true;
      await supabaseClient.from('client_error_log').update({ resolved: false, resolved_at: null }).eq('id', id);
      await loadClientErrors();
    }
  });

  // ---- Users -------------------------------------------------------------
  let allUsers = [];

  async function loadUsers() {
    const tbody = document.querySelector('#users-tbody');
    const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Could not load users: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    allUsers = data || [];
    renderUsers(allUsers);
  }

  function renderUsers(users) {
    const tbody = document.querySelector('#users-tbody');
    const countEl = document.querySelector('#user-count');
    if (countEl) countEl.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users yet.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map((u) => `
      <tr data-user-row="${u.id}">
        <td><strong>${escapeHtml(u.full_name || '(no name)')}</strong><br><span class="small muted">${escapeHtml(u.email || '')}</span></td>
        <td>
          <select data-user-field="plan" data-user-id="${u.id}">
            <option value="monthly" ${u.plan === 'monthly' ? 'selected' : ''}>Monthly</option>
            <option value="2year" ${u.plan === '2year' ? 'selected' : ''}>2-Year</option>
          </select>
        </td>
        <td>
          <select data-user-field="subscription_status" data-user-id="${u.id}">
            <option value="active" ${u.subscription_status === 'active' ? 'selected' : ''}>Active</option>
            <option value="incomplete" ${u.subscription_status === 'incomplete' ? 'selected' : ''}>Incomplete (unpaid)</option>
            <option value="trial" ${u.subscription_status === 'trial' ? 'selected' : ''}>Trial</option>
            <option value="past_due" ${u.subscription_status === 'past_due' ? 'selected' : ''}>Past Due</option>
            <option value="canceled" ${u.subscription_status === 'canceled' ? 'selected' : ''}>Canceled</option>
            <option value="comp" ${u.subscription_status === 'comp' ? 'selected' : ''}>Comp (Free)</option>
          </select>
        </td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-ocean' : ''}">${escapeHtml(u.role || 'student')}</span></td>
        <td class="small">${formatDate(u.created_at)}</td>
        <td>
          <div class="flex gap-8 items-center">
            <button class="btn btn-ghost btn-sm" data-user-save="${u.id}">Save</button>
            <button class="btn btn-ghost btn-sm" data-user-reset="${u.id}" data-user-email="${escapeHtml(u.email || '')}">Reset PW</button>
            <button class="btn btn-ghost btn-sm" data-user-reset-progress="${u.id}" data-user-email="${escapeHtml(u.email || '')}" style="color:var(--danger); border-color:var(--danger);">Reset Progress</button>
            <span class="row-save-msg" data-user-msg="${u.id}">Saved ✓</span>
          </div>
        </td>
      </tr>
    `).join('');
  }

  document.querySelector('#user-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderUsers(allUsers); return; }
    renderUsers(allUsers.filter((u) =>
      (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    ));
  });

  document.querySelector('#users-tbody')?.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-user-save]');
    const resetBtn = e.target.closest('[data-user-reset]');
    const resetProgressBtn = e.target.closest('[data-user-reset-progress]');

    if (saveBtn) {
      const id = saveBtn.getAttribute('data-user-save');
      const row = saveBtn.closest('tr');
      const plan = row.querySelector('[data-user-field="plan"]').value;
      const subscription_status = row.querySelector('[data-user-field="subscription_status"]').value;
      saveBtn.disabled = true;
      const { error } = await supabaseClient.from('profiles').update({ plan, subscription_status }).eq('id', id);
      saveBtn.disabled = false;
      const msg = row.querySelector(`[data-user-msg="${id}"]`);
      if (!error && msg) {
        msg.classList.add('show');
        setTimeout(() => msg.classList.remove('show'), 2000);
      }
    }

    if (resetBtn) {
      const email = resetBtn.getAttribute('data-user-email');
      if (!email) return;
      resetBtn.disabled = true;
      resetBtn.textContent = 'Sending…';
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
      resetBtn.disabled = false;
      resetBtn.textContent = error ? 'Failed' : 'Sent ✓';
      setTimeout(() => { resetBtn.textContent = 'Reset PW'; }, 2500);
    }

    if (resetProgressBtn) {
      const id = resetProgressBtn.getAttribute('data-user-reset-progress');
      const email = resetProgressBtn.getAttribute('data-user-email') || 'this user';
      const confirmed = confirm(
        `Reset ALL progress for ${email}?\n\n` +
        `This permanently deletes:\n` +
        `• Main course lesson completions & module quiz scores\n` +
        `• Know Your Country read progress (all 40 lessons)\n` +
        `• Practice Interview attempt history\n\n` +
        `Their plan, subscription, and login are not affected. This cannot be undone.`
      );
      if (!confirmed) return;

      resetProgressBtn.disabled = true;
      resetProgressBtn.textContent = 'Resetting…';
      const results = await Promise.all([
        supabaseClient.from('lesson_progress').delete().eq('user_id', id),
        supabaseClient.from('module_quiz_attempts').delete().eq('user_id', id),
        supabaseClient.from('country_lesson_progress').delete().eq('user_id', id),
        supabaseClient.from('practice_quiz_attempts').delete().eq('user_id', id),
      ]);
      const failed = results.some((r) => r.error);
      resetProgressBtn.disabled = false;
      resetProgressBtn.textContent = failed ? 'Failed' : 'Reset ✓';
      setTimeout(() => { resetProgressBtn.textContent = 'Reset Progress'; }, 2500);
    }
  });

  // ---- Lessons (course editor) -------------------------------------------
  let editingLessonId = null;

  async function loadLessons() {
    const list = document.querySelector('#lessons-list');
    const { data, error } = await supabaseClient.from('lessons').select('*').order('module_number').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load lessons: ${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!data || !data.length) {
      list.innerHTML = '<p class="empty-state">No lessons yet. Add your first one above.</p>';
      return;
    }
    let html = '';
    let currentModule = null;
    data.forEach((lesson) => {
      if (lesson.module_number !== currentModule) {
        currentModule = lesson.module_number;
        html += `<div class="module-heading">Module ${currentModule}: ${escapeHtml(MODULE_NAMES[currentModule] || '')}</div>`;
      }
      html += `
        <div class="card card-pad" style="margin-bottom:12px;" data-lesson-card="${lesson.id}">
          <div class="flex justify-between items-center">
            <div>
              <strong>${escapeHtml(lesson.title)}</strong>
              ${lesson.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
              ${lesson.video_url ? '<span class="badge" style="margin-left:6px;">Has Video</span>' : ''}
              ${!lesson.video_url && lesson.no_video ? '<span class="badge badge-ocean" style="margin-left:6px;">No Video (Audio Instead)</span>' : ''}
            </div>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" data-lesson-edit="${lesson.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-lesson-delete="${lesson.id}">Delete</button>
            </div>
          </div>
          ${lesson.content ? `<p class="small" style="margin-top:10px; margin-bottom:0;">${escapeHtml(lesson.content).slice(0, 180)}${lesson.content.length > 180 ? '…' : ''}</p>` : ''}
        </div>
      `;
    });
    list.innerHTML = html;
  }

  const lessonForm = document.querySelector('#lesson-form');
  const lessonCancelBtn = document.querySelector('#lesson-cancel-edit');

  function resetLessonForm() {
    editingLessonId = null;
    lessonForm.reset();
    document.querySelector('#lesson-submit').textContent = 'Add Lesson';
    lessonCancelBtn.style.display = 'none';
  }

  lessonCancelBtn?.addEventListener('click', resetLessonForm);

  lessonForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      module_number: Number(document.querySelector('#lesson-module').value),
      module_name: MODULE_NAMES[Number(document.querySelector('#lesson-module').value)],
      sort_order: Number(document.querySelector('#lesson-sort').value) || 1,
      title: document.querySelector('#lesson-title').value,
      content: document.querySelector('#lesson-content').value,
      title_es: document.querySelector('#lesson-title-es').value || null,
      content_es: document.querySelector('#lesson-content-es').value || null,
      video_url: document.querySelector('#lesson-video').value || null,
      no_video: document.querySelector('#lesson-no-video').checked,
      published: document.querySelector('#lesson-published').checked,
    };
    const submitBtn = document.querySelector('#lesson-submit');
    submitBtn.disabled = true;
    let error;
    if (editingLessonId) {
      ({ error } = await supabaseClient.from('lessons').update(payload).eq('id', editingLessonId));
    } else {
      ({ error } = await supabaseClient.from('lessons').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save lesson: ' + error.message); return; }
    resetLessonForm();
    loadLessons();
  });

  document.querySelector('#lessons-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-lesson-edit]');
    const delBtn = e.target.closest('[data-lesson-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-lesson-edit');
      const { data } = await supabaseClient.from('lessons').select('*').eq('id', id).single();
      if (!data) return;
      editingLessonId = id;
      document.querySelector('#lesson-module').value = data.module_number;
      document.querySelector('#lesson-sort').value = data.sort_order;
      document.querySelector('#lesson-title').value = data.title;
      document.querySelector('#lesson-content').value = data.content || '';
      document.querySelector('#lesson-title-es').value = data.title_es || '';
      document.querySelector('#lesson-content-es').value = data.content_es || '';
      document.querySelector('#lesson-video').value = data.video_url || '';
      document.querySelector('#lesson-no-video').checked = !!data.no_video;
      document.querySelector('#lesson-published').checked = !!data.published;
      document.querySelector('#lesson-submit').textContent = 'Save Changes';
      lessonCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(lessonForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-lesson-delete');
      if (!confirm('Delete this lesson? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('lessons').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadLessons();
    }
  });

  // ---- Quiz questions ------------------------------------------------
  let editingQuizId = null;

  async function loadQuizzes() {
    const list = document.querySelector('#quizzes-list');
    const { data, error } = await supabaseClient.from('quiz_questions').select('*').order('module_number').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load questions: ${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!data || !data.length) {
      list.innerHTML = '<p class="empty-state">No quiz questions yet. Add your first one above.</p>';
      return;
    }
    let html = '';
    let currentModule = null;
    data.forEach((q) => {
      if (q.module_number !== currentModule) {
        currentModule = q.module_number;
        html += `<div class="module-heading">Module ${currentModule}: ${escapeHtml(MODULE_NAMES[currentModule] || '')}</div>`;
      }
      const total = (q.times_correct || 0) + (q.times_incorrect || 0);
      const accuracy = total > 0 ? Math.round((q.times_correct / total) * 100) : null;
      html += `
        <div class="card card-pad" style="margin-bottom:12px;" data-quiz-card="${q.id}">
          <div class="flex justify-between items-center">
            <div>
              <strong>${escapeHtml(q.question)}</strong>
              ${q.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
              ${accuracy !== null ? `<span class="accuracy-pill ${accuracy < 70 ? 'low' : ''}" style="margin-left:6px;">${accuracy}% correct (${total} attempts)</span>` : '<span class="accuracy-pill" style="margin-left:6px;">No attempts yet</span>'}
            </div>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" data-quiz-edit="${q.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-quiz-delete="${q.id}">Delete</button>
            </div>
          </div>
          <p class="small" style="margin-top:10px; margin-bottom:0;">Correct answer: <strong>${escapeHtml(q['choice_' + q.correct_choice])}</strong></p>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  const quizForm = document.querySelector('#quiz-form');
  const quizCancelBtn = document.querySelector('#quiz-cancel-edit');

  function resetQuizForm() {
    editingQuizId = null;
    quizForm.reset();
    document.querySelector('#quiz-submit').textContent = 'Add Question';
    quizCancelBtn.style.display = 'none';
  }

  quizCancelBtn?.addEventListener('click', resetQuizForm);

  quizForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      module_number: Number(document.querySelector('#quiz-module').value),
      sort_order: Number(document.querySelector('#quiz-sort').value) || 1,
      question: document.querySelector('#quiz-question').value,
      choice_a: document.querySelector('#quiz-choice-a').value,
      choice_b: document.querySelector('#quiz-choice-b').value,
      // Left blank for True/False questions (only 2 real answers), stored
      // as null rather than a placeholder string like "N/A" so the member
      // pages know to render only the choices that actually exist.
      choice_c: document.querySelector('#quiz-choice-c').value.trim() || null,
      choice_d: document.querySelector('#quiz-choice-d').value.trim() || null,
      question_es: document.querySelector('#quiz-question-es').value || null,
      choice_a_es: document.querySelector('#quiz-choice-a-es').value || null,
      choice_b_es: document.querySelector('#quiz-choice-b-es').value || null,
      choice_c_es: document.querySelector('#quiz-choice-c-es').value || null,
      choice_d_es: document.querySelector('#quiz-choice-d-es').value || null,
      correct_choice: document.querySelector('#quiz-correct').value,
      published: document.querySelector('#quiz-published').checked,
    };
    const submitBtn = document.querySelector('#quiz-submit');
    submitBtn.disabled = true;
    let error;
    if (editingQuizId) {
      ({ error } = await supabaseClient.from('quiz_questions').update(payload).eq('id', editingQuizId));
    } else {
      ({ error } = await supabaseClient.from('quiz_questions').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save question: ' + error.message); return; }
    resetQuizForm();
    loadQuizzes();
  });

  document.querySelector('#quizzes-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-quiz-edit]');
    const delBtn = e.target.closest('[data-quiz-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-quiz-edit');
      const { data } = await supabaseClient.from('quiz_questions').select('*').eq('id', id).single();
      if (!data) return;
      editingQuizId = id;
      document.querySelector('#quiz-module').value = data.module_number;
      document.querySelector('#quiz-sort').value = data.sort_order;
      document.querySelector('#quiz-question').value = data.question;
      document.querySelector('#quiz-choice-a').value = data.choice_a;
      document.querySelector('#quiz-choice-b').value = data.choice_b;
      document.querySelector('#quiz-choice-c').value = data.choice_c;
      document.querySelector('#quiz-choice-d').value = data.choice_d;
      document.querySelector('#quiz-question-es').value = data.question_es || '';
      document.querySelector('#quiz-choice-a-es').value = data.choice_a_es || '';
      document.querySelector('#quiz-choice-b-es').value = data.choice_b_es || '';
      document.querySelector('#quiz-choice-c-es').value = data.choice_c_es || '';
      document.querySelector('#quiz-choice-d-es').value = data.choice_d_es || '';
      document.querySelector('#quiz-correct').value = data.correct_choice;
      document.querySelector('#quiz-published').checked = !!data.published;
      document.querySelector('#quiz-submit').textContent = 'Save Changes';
      quizCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(quizForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-quiz-delete');
      if (!confirm('Delete this question? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('quiz_questions').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadQuizzes();
    }
  });

  // ---- Flashcards editor ------------------------------------------------
  let editingFlashcardId = null;
  let allFlashcards = [];

  async function loadFlashcards() {
    const list = document.querySelector('#flashcards-list');
    const { data, error } = await supabaseClient.from('flashcards').select('*').order('test_type').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load flashcards: ${escapeHtml(error.message)}</p>`;
      return;
    }
    allFlashcards = data || [];
    renderFlashcardsList();
  }

  function renderFlashcardsList() {
    const list = document.querySelector('#flashcards-list');
    const countEl = document.querySelector('#flashcard-count');
    const filter = document.querySelector('#flashcard-filter')?.value || 'test_128';
    const rows = filter === 'all' ? allFlashcards : allFlashcards.filter((c) => c.test_type === filter);

    if (countEl) countEl.textContent = `${rows.length} card${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      list.innerHTML = '<p class="empty-state">No flashcards in this set yet. Add one above.</p>';
      return;
    }

    let html = '';
    let currentType = null;
    rows.forEach((c) => {
      if (filter === 'all' && c.test_type !== currentType) {
        currentType = c.test_type;
        html += `<div class="module-heading">${escapeHtml(FLASHCARD_TEST_NAMES[currentType] || currentType)}</div>`;
      }
      html += `
        <div class="card card-pad" style="margin-bottom:12px;" data-flashcard-card="${c.id}">
          <div class="flex justify-between items-center">
            <div>
              <span class="small muted" style="font-family:var(--font-mono);">#${c.sort_order}</span>
              <strong style="margin-left:6px;">${escapeHtml(c.question)}</strong>
              ${c.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
            </div>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" data-flashcard-edit="${c.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-flashcard-delete="${c.id}">Delete</button>
            </div>
          </div>
          <p class="small" style="margin-top:10px; margin-bottom:0;">${escapeHtml((c.answer || '').split('\n').join(' · '))}</p>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  document.querySelector('#flashcard-filter')?.addEventListener('change', renderFlashcardsList);

  const flashcardForm = document.querySelector('#flashcard-form');
  const flashcardCancelBtn = document.querySelector('#flashcard-cancel-edit');

  function resetFlashcardForm() {
    editingFlashcardId = null;
    flashcardForm.reset();
    document.querySelector('#flashcard-published').checked = true;
    document.querySelector('#flashcard-submit').textContent = 'Add Flashcard';
    flashcardCancelBtn.style.display = 'none';
  }

  flashcardCancelBtn?.addEventListener('click', resetFlashcardForm);

  flashcardForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      test_type: document.querySelector('#flashcard-test-type').value,
      sort_order: Number(document.querySelector('#flashcard-sort').value) || 1,
      question: document.querySelector('#flashcard-question').value,
      answer: document.querySelector('#flashcard-answer').value,
      question_es: document.querySelector('#flashcard-question-es').value || null,
      answer_es: document.querySelector('#flashcard-answer-es').value || null,
      published: document.querySelector('#flashcard-published').checked,
    };
    const submitBtn = document.querySelector('#flashcard-submit');
    submitBtn.disabled = true;
    let error;
    if (editingFlashcardId) {
      ({ error } = await supabaseClient.from('flashcards').update(payload).eq('id', editingFlashcardId));
    } else {
      ({ error } = await supabaseClient.from('flashcards').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save flashcard: ' + error.message); return; }
    resetFlashcardForm();
    loadFlashcards();
  });

  document.querySelector('#flashcards-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-flashcard-edit]');
    const delBtn = e.target.closest('[data-flashcard-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-flashcard-edit');
      const { data } = await supabaseClient.from('flashcards').select('*').eq('id', id).single();
      if (!data) return;
      editingFlashcardId = id;
      document.querySelector('#flashcard-test-type').value = data.test_type;
      document.querySelector('#flashcard-sort').value = data.sort_order;
      document.querySelector('#flashcard-question').value = data.question;
      document.querySelector('#flashcard-answer').value = data.answer || '';
      document.querySelector('#flashcard-question-es').value = data.question_es || '';
      document.querySelector('#flashcard-answer-es').value = data.answer_es || '';
      document.querySelector('#flashcard-published').checked = !!data.published;
      document.querySelector('#flashcard-submit').textContent = 'Save Changes';
      flashcardCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(flashcardForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-flashcard-delete');
      if (!confirm('Delete this flashcard? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('flashcards').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadFlashcards();
    }
  });

  // ---- "Know Your Country" (history background) editor ------------------
  let editingCountryLessonId = null;
  let allCountryLessons = [];

  async function loadCountryLessons() {
    const list = document.querySelector('#country-lessons-list');
    const { data, error } = await supabaseClient.from('country_lessons').select('*').order('lesson_number');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load lessons: ${escapeHtml(error.message)}</p>`;
      return;
    }
    allCountryLessons = data || [];
    renderCountryLessonsList();
  }

  function renderCountryLessonsList() {
    const list = document.querySelector('#country-lessons-list');
    const countEl = document.querySelector('#cl-count');
    if (countEl) countEl.textContent = `${allCountryLessons.length} lesson${allCountryLessons.length === 1 ? '' : 's'}`;
    if (!allCountryLessons.length) {
      list.innerHTML = '<p class="empty-state">No lessons yet. Add one above.</p>';
      return;
    }

    let html = '';
    let currentUnit = null;
    allCountryLessons.forEach((l) => {
      if (l.unit_number !== currentUnit) {
        currentUnit = l.unit_number;
        html += `<div class="module-heading">Unit ${l.unit_number}: ${escapeHtml(l.unit_title)}</div>`;
      }
      html += `
        <div class="card card-pad" style="margin-bottom:12px;" data-country-lesson-card="${l.id}">
          <div class="flex justify-between items-center">
            <div>
              <span class="small muted" style="font-family:var(--font-mono);">#${l.lesson_number}</span>
              <strong style="margin-left:6px;">${escapeHtml(l.title)}</strong>
              ${l.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
              ${l.content_es ? '<span class="badge badge-ocean" style="margin-left:8px;">ES ready</span>' : ''}
            </div>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" data-country-lesson-edit="${l.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-country-lesson-delete="${l.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  const countryLessonForm = document.querySelector('#country-lesson-form');
  const countryLessonCancelBtn = document.querySelector('#cl-cancel-edit');

  function resetCountryLessonForm() {
    editingCountryLessonId = null;
    countryLessonForm.reset();
    document.querySelector('#cl-published').checked = true;
    document.querySelector('#cl-submit').textContent = 'Add Lesson';
    countryLessonCancelBtn.style.display = 'none';
  }

  countryLessonCancelBtn?.addEventListener('click', resetCountryLessonForm);

  countryLessonForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      unit_number: Number(document.querySelector('#cl-unit-number').value) || 1,
      unit_title: document.querySelector('#cl-unit-title').value,
      lesson_number: Number(document.querySelector('#cl-lesson-number').value) || 1,
      title: document.querySelector('#cl-title').value,
      content: document.querySelector('#cl-content').value,
      unit_title_es: document.querySelector('#cl-unit-title-es').value || null,
      title_es: document.querySelector('#cl-title-es').value || null,
      content_es: document.querySelector('#cl-content-es').value || null,
      published: document.querySelector('#cl-published').checked,
    };
    const submitBtn = document.querySelector('#cl-submit');
    submitBtn.disabled = true;
    let error;
    if (editingCountryLessonId) {
      ({ error } = await supabaseClient.from('country_lessons').update(payload).eq('id', editingCountryLessonId));
    } else {
      ({ error } = await supabaseClient.from('country_lessons').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save lesson: ' + error.message); return; }
    resetCountryLessonForm();
    loadCountryLessons();
  });

  document.querySelector('#country-lessons-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-country-lesson-edit]');
    const delBtn = e.target.closest('[data-country-lesson-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-country-lesson-edit');
      const { data } = await supabaseClient.from('country_lessons').select('*').eq('id', id).single();
      if (!data) return;
      editingCountryLessonId = id;
      document.querySelector('#cl-unit-number').value = data.unit_number;
      document.querySelector('#cl-lesson-number').value = data.lesson_number;
      document.querySelector('#cl-unit-title').value = data.unit_title;
      document.querySelector('#cl-title').value = data.title;
      document.querySelector('#cl-content').value = data.content || '';
      document.querySelector('#cl-unit-title-es').value = data.unit_title_es || '';
      document.querySelector('#cl-title-es').value = data.title_es || '';
      document.querySelector('#cl-content-es').value = data.content_es || '';
      document.querySelector('#cl-published').checked = !!data.published;
      document.querySelector('#cl-submit').textContent = 'Save Changes';
      countryLessonCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(countryLessonForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-country-lesson-delete');
      if (!confirm('Delete this lesson? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('country_lessons').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadCountryLessons();
    }
  });

  // ---- Mock Interview questions editor -----------------------------------
  let editingMockInterviewId = null;

  const miTypeSelect = document.querySelector('#mi-type');
  const miOptionsWrap = document.querySelector('#mi-options-wrap');
  const miCorrectMcWrap = document.querySelector('#mi-correct-mc-wrap');
  const miCorrectYnWrap = document.querySelector('#mi-correct-yn-wrap');

  function syncMockInterviewFormToType() {
    const type = miTypeSelect ? miTypeSelect.value : 'open_ended';
    if (miOptionsWrap) miOptionsWrap.style.display = type === 'multiple_choice' ? 'block' : 'none';
    if (miCorrectMcWrap) miCorrectMcWrap.style.display = type === 'multiple_choice' ? 'block' : 'none';
    if (miCorrectYnWrap) miCorrectYnWrap.style.display = type === 'yes_no' ? 'block' : 'none';
  }
  miTypeSelect?.addEventListener('change', syncMockInterviewFormToType);
  syncMockInterviewFormToType();

  async function loadMockInterview() {
    const list = document.querySelector('#mi-questions-list');
    const { data, error } = await supabaseClient.from('mock_interview_questions').select('*').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load mock interview questions: ${escapeHtml(error.message)}</p>`;
      return;
    }
    renderMockInterviewList(data || []);
  }

  const MI_TYPE_LABELS = { open_ended: 'Open-ended', multiple_choice: 'Multiple choice', yes_no: 'Yes / No' };

  function renderMockInterviewList(rows) {
    const list = document.querySelector('#mi-questions-list');
    const countEl = document.querySelector('#mi-count');
    if (countEl) countEl.textContent = `${rows.length} question${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      list.innerHTML = '<p class="empty-state">No mock interview questions yet. Add one above.</p>';
      return;
    }
    list.innerHTML = rows.map((q) => {
      const hasRealVideo = q.video_url && q.video_url !== '/placeholder-video.mp4';
      return `
        <div class="card card-pad" style="margin-bottom:12px;" data-mi-card="${q.id}">
          <div class="flex justify-between items-center">
            <div>
              <span class="small muted" style="font-family:var(--font-mono);">#${q.sort_order}</span>
              <span class="accuracy-pill" style="margin-left:6px;">${escapeHtml(MI_TYPE_LABELS[q.type] || q.type)}</span>
              <strong style="margin-left:6px;">${escapeHtml(q.question)}</strong>
              ${q.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
              ${hasRealVideo ? '<span class="badge badge-ocean" style="margin-left:8px;">Video attached</span>' : '<span class="badge" style="margin-left:8px;">Placeholder video</span>'}
            </div>
            <div class="flex gap-8">
              <button class="btn btn-ghost btn-sm" data-mi-edit="${q.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-mi-delete="${q.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const mockInterviewForm = document.querySelector('#mi-form');
  const mockInterviewCancelBtn = document.querySelector('#mi-cancel-edit');

  function resetMockInterviewForm() {
    editingMockInterviewId = null;
    mockInterviewForm.reset();
    document.querySelector('#mi-published').checked = true;
    document.querySelector('#mi-submit').textContent = 'Add Question';
    mockInterviewCancelBtn.style.display = 'none';
    syncMockInterviewFormToType();
  }

  mockInterviewCancelBtn?.addEventListener('click', resetMockInterviewForm);

  function buildMockInterviewOptions() {
    const pairs = [
      ['a', '#mi-opt-a-en', '#mi-opt-a-es'],
      ['b', '#mi-opt-b-en', '#mi-opt-b-es'],
      ['c', '#mi-opt-c-en', '#mi-opt-c-es'],
      ['d', '#mi-opt-d-en', '#mi-opt-d-es'],
    ];
    return pairs
      .map(([value, enSel, esSel]) => ({
        value,
        en: (document.querySelector(enSel)?.value || '').trim(),
        es: (document.querySelector(esSel)?.value || '').trim(),
      }))
      .filter((o) => o.en);
  }

  mockInterviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.querySelector('#mi-type').value;
    let correctAnswer = null;
    if (type === 'multiple_choice') correctAnswer = document.querySelector('#mi-correct-mc').value;
    if (type === 'yes_no') correctAnswer = document.querySelector('#mi-correct-yn').value;

    const payload = {
      sort_order: Number(document.querySelector('#mi-sort').value) || 1,
      type,
      question: document.querySelector('#mi-question').value,
      question_es: document.querySelector('#mi-question-es').value || null,
      video_url: document.querySelector('#mi-video-url').value || '/placeholder-video.mp4',
      options: type === 'multiple_choice' ? buildMockInterviewOptions() : [],
      correct_answer: correctAnswer,
      explanation: document.querySelector('#mi-explanation').value || null,
      explanation_es: document.querySelector('#mi-explanation-es').value || null,
      published: document.querySelector('#mi-published').checked,
    };
    const submitBtn = document.querySelector('#mi-submit');
    submitBtn.disabled = true;
    let error;
    if (editingMockInterviewId) {
      ({ error } = await supabaseClient.from('mock_interview_questions').update(payload).eq('id', editingMockInterviewId));
    } else {
      ({ error } = await supabaseClient.from('mock_interview_questions').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save question: ' + error.message); return; }
    resetMockInterviewForm();
    loadMockInterview();
  });

  document.querySelector('#mi-questions-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-mi-edit]');
    const delBtn = e.target.closest('[data-mi-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-mi-edit');
      const { data } = await supabaseClient.from('mock_interview_questions').select('*').eq('id', id).single();
      if (!data) return;
      editingMockInterviewId = id;
      document.querySelector('#mi-sort').value = data.sort_order;
      document.querySelector('#mi-type').value = data.type;
      document.querySelector('#mi-question').value = data.question;
      document.querySelector('#mi-question-es').value = data.question_es || '';
      document.querySelector('#mi-video-url').value = (data.video_url && data.video_url !== '/placeholder-video.mp4') ? data.video_url : '';
      document.querySelector('#mi-explanation').value = data.explanation || '';
      document.querySelector('#mi-explanation-es').value = data.explanation_es || '';
      document.querySelector('#mi-published').checked = !!data.published;

      const opts = Array.isArray(data.options) ? data.options : [];
      ['a', 'b', 'c', 'd'].forEach((value) => {
        const opt = opts.find((o) => o.value === value) || { en: '', es: '' };
        const enEl = document.querySelector(`#mi-opt-${value}-en`);
        const esEl = document.querySelector(`#mi-opt-${value}-es`);
        if (enEl) enEl.value = opt.en || '';
        if (esEl) esEl.value = opt.es || '';
      });

      if (data.type === 'multiple_choice') document.querySelector('#mi-correct-mc').value = data.correct_answer || 'a';
      if (data.type === 'yes_no') document.querySelector('#mi-correct-yn').value = data.correct_answer || 'yes';
      syncMockInterviewFormToType();

      document.querySelector('#mi-submit').textContent = 'Save Changes';
      mockInterviewCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(mockInterviewForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-mi-delete');
      if (!confirm('Delete this mock interview question? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('mock_interview_questions').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadMockInterview();
    }
  });

  // ---- Reading & Writing editor -----------------------------------------
  // Three content sets for the English literacy portion of the interview:
  // reading_practice_items and writing_practice_items are near-identical
  // shape (sort_order, sentence_text, audio_url, published), so their
  // editors are handled together below; alphabet_letters is a fixed set of
  // 26 rows (no add/delete, just an audio URL per letter).

  function loadReadingWritingEditor() {
    loadReadingItems();
    loadWritingItems();
    loadAlphabetLetters();
  }

  function rwAudioBadge(audioUrl) {
    return audioUrl
      ? '<span class="badge badge-forest" style="margin-left:8px;">Audio attached</span>'
      : '<span class="badge" style="margin-left:8px;">Audio coming soon</span>';
  }

  // -- Reading items --
  let editingReadingItemId = null;
  let allReadingItems = [];

  async function loadReadingItems() {
    const list = document.querySelector('#reading-items-list');
    const { data, error } = await supabaseClient.from('reading_practice_items').select('*').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load reading sentences: ${escapeHtml(error.message)}</p>`;
      return;
    }
    allReadingItems = data || [];
    renderReadingItemsList();
  }

  function renderReadingItemsList() {
    const list = document.querySelector('#reading-items-list');
    const countEl = document.querySelector('#reading-item-count');
    if (countEl) countEl.textContent = `${allReadingItems.length} sentence${allReadingItems.length === 1 ? '' : 's'}`;
    if (!allReadingItems.length) {
      list.innerHTML = '<p class="empty-state">No reading sentences yet. Add one above.</p>';
      return;
    }
    list.innerHTML = allReadingItems.map((r) => `
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="flex justify-between items-center">
          <div>
            <span class="small muted" style="font-family:var(--font-mono);">#${r.sort_order}</span>
            <strong style="margin-left:6px;">${escapeHtml(r.sentence_text)}</strong>
            ${r.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
            ${rwAudioBadge(r.audio_url)}
          </div>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-sm" data-reading-edit="${r.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-reading-delete="${r.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  const readingItemForm = document.querySelector('#reading-item-form');
  const readingItemCancelBtn = document.querySelector('#reading-item-cancel-edit');

  function resetReadingItemForm() {
    editingReadingItemId = null;
    readingItemForm.reset();
    document.querySelector('#reading-item-published').checked = true;
    document.querySelector('#reading-item-submit').textContent = 'Add Sentence';
    readingItemCancelBtn.style.display = 'none';
  }

  readingItemCancelBtn?.addEventListener('click', resetReadingItemForm);

  readingItemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      sort_order: Number(document.querySelector('#reading-item-sort').value) || 1,
      sentence_text: document.querySelector('#reading-item-text').value,
      audio_url: document.querySelector('#reading-item-audio').value || null,
      published: document.querySelector('#reading-item-published').checked,
    };
    const submitBtn = document.querySelector('#reading-item-submit');
    submitBtn.disabled = true;
    let error;
    if (editingReadingItemId) {
      ({ error } = await supabaseClient.from('reading_practice_items').update(payload).eq('id', editingReadingItemId));
    } else {
      ({ error } = await supabaseClient.from('reading_practice_items').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save sentence: ' + error.message); return; }
    resetReadingItemForm();
    loadReadingItems();
  });

  document.querySelector('#reading-items-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-reading-edit]');
    const delBtn = e.target.closest('[data-reading-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-reading-edit');
      const item = allReadingItems.find((r) => r.id === id);
      if (!item) return;
      editingReadingItemId = id;
      document.querySelector('#reading-item-sort').value = item.sort_order;
      document.querySelector('#reading-item-text').value = item.sentence_text;
      document.querySelector('#reading-item-audio').value = item.audio_url || '';
      document.querySelector('#reading-item-published').checked = !!item.published;
      document.querySelector('#reading-item-submit').textContent = 'Save Changes';
      readingItemCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(readingItemForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-reading-delete');
      if (!confirm('Delete this reading sentence? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('reading_practice_items').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadReadingItems();
    }
  });

  // -- Writing items --
  let editingWritingItemId = null;
  let allWritingItems = [];

  async function loadWritingItems() {
    const list = document.querySelector('#writing-items-list');
    const { data, error } = await supabaseClient.from('writing_practice_items').select('*').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load writing sentences: ${escapeHtml(error.message)}</p>`;
      return;
    }
    allWritingItems = data || [];
    renderWritingItemsList();
  }

  function renderWritingItemsList() {
    const list = document.querySelector('#writing-items-list');
    const countEl = document.querySelector('#writing-item-count');
    if (countEl) countEl.textContent = `${allWritingItems.length} sentence${allWritingItems.length === 1 ? '' : 's'}`;
    if (!allWritingItems.length) {
      list.innerHTML = '<p class="empty-state">No writing sentences yet. Add one above.</p>';
      return;
    }
    list.innerHTML = allWritingItems.map((w) => `
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="flex justify-between items-center">
          <div>
            <span class="small muted" style="font-family:var(--font-mono);">#${w.sort_order}</span>
            <strong style="margin-left:6px;">${escapeHtml(w.sentence_text)}</strong>
            ${w.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
            ${rwAudioBadge(w.audio_url)}
          </div>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-sm" data-writing-edit="${w.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-writing-delete="${w.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  const writingItemForm = document.querySelector('#writing-item-form');
  const writingItemCancelBtn = document.querySelector('#writing-item-cancel-edit');

  function resetWritingItemForm() {
    editingWritingItemId = null;
    writingItemForm.reset();
    document.querySelector('#writing-item-published').checked = true;
    document.querySelector('#writing-item-submit').textContent = 'Add Sentence';
    writingItemCancelBtn.style.display = 'none';
  }

  writingItemCancelBtn?.addEventListener('click', resetWritingItemForm);

  writingItemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      sort_order: Number(document.querySelector('#writing-item-sort').value) || 1,
      sentence_text: document.querySelector('#writing-item-text').value,
      audio_url: document.querySelector('#writing-item-audio').value || null,
      published: document.querySelector('#writing-item-published').checked,
    };
    const submitBtn = document.querySelector('#writing-item-submit');
    submitBtn.disabled = true;
    let error;
    if (editingWritingItemId) {
      ({ error } = await supabaseClient.from('writing_practice_items').update(payload).eq('id', editingWritingItemId));
    } else {
      ({ error } = await supabaseClient.from('writing_practice_items').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save sentence: ' + error.message); return; }
    resetWritingItemForm();
    loadWritingItems();
  });

  document.querySelector('#writing-items-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-writing-edit]');
    const delBtn = e.target.closest('[data-writing-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-writing-edit');
      const item = allWritingItems.find((w) => w.id === id);
      if (!item) return;
      editingWritingItemId = id;
      document.querySelector('#writing-item-sort').value = item.sort_order;
      document.querySelector('#writing-item-text').value = item.sentence_text;
      document.querySelector('#writing-item-audio').value = item.audio_url || '';
      document.querySelector('#writing-item-published').checked = !!item.published;
      document.querySelector('#writing-item-submit').textContent = 'Save Changes';
      writingItemCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(writingItemForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-writing-delete');
      if (!confirm('Delete this writing sentence? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('writing_practice_items').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadWritingItems();
    }
  });

  // -- Alphabet letters (fixed 26 rows, audio-only editing) --
  async function loadAlphabetLetters() {
    const list = document.querySelector('#alphabet-letters-list');
    const { data, error } = await supabaseClient.from('alphabet_letters').select('*').order('letter');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load letters: ${escapeHtml(error.message)}</p>`;
      return;
    }
    list.innerHTML = (data || []).map((l) => `
      <div class="card card-pad" style="margin-bottom:10px;">
        <div class="flex items-center gap-16" style="flex-wrap:wrap;">
          <strong style="font-family:var(--font-serif); font-size:1.3rem; min-width:28px;">${escapeHtml(l.letter)}</strong>
          <input type="text" data-letter-audio="${l.letter}" value="${escapeHtml(l.audio_url || '')}" placeholder="Leave blank until narration is recorded" style="flex:1; min-width:220px;">
          ${rwAudioBadge(l.audio_url)}
          <button class="btn btn-ghost btn-sm" data-letter-save="${l.letter}">Save</button>
          <span class="row-save-msg" data-letter-msg="${l.letter}">Saved ✓</span>
        </div>
      </div>
    `).join('');
  }

  document.querySelector('#alphabet-letters-list')?.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-letter-save]');
    if (!saveBtn) return;
    const letter = saveBtn.getAttribute('data-letter-save');
    const input = document.querySelector(`[data-letter-audio="${letter}"]`);
    saveBtn.disabled = true;
    const { error } = await supabaseClient.from('alphabet_letters').update({ audio_url: input.value || null }).eq('letter', letter);
    saveBtn.disabled = false;
    if (error) { alert('Could not save: ' + error.message); return; }
    const msg = document.querySelector(`[data-letter-msg="${letter}"]`);
    if (msg) {
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2000);
    }
    // Update the badge in place instead of reloading the whole list, so the
    // "Saved" confirmation above doesn't get wiped out by its own re-render.
    const badge = input.closest('.flex').querySelector('.badge');
    if (badge) badge.outerHTML = rwAudioBadge(input.value || null);
  });

  // ---- Documents editor ---------------------------------------------
  // PDFs upload straight from this browser session into the
  // official-documents bucket via supabaseClient.storage -- the admin's
  // own authenticated session already satisfies the admin-only storage
  // RLS policy, so this never needs a service-role key or a separate
  // upload endpoint. Members only ever see these embedded on-page, never
  // as a direct download link (see documents.html / member.js).
  let editingDocumentId = null;
  let allDocuments = [];

  function slugifyFilename(name) {
    return String(name || 'file').toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  }

  async function loadDocuments() {
    const list = document.querySelector('#documents-list');
    const { data, error } = await supabaseClient.from('official_documents').select('*').order('sort_order');
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load documents: ${escapeHtml(error.message)}</p>`;
      return;
    }
    allDocuments = data || [];
    renderDocumentsAdminList();
  }

  function renderDocumentsAdminList() {
    const list = document.querySelector('#documents-list');
    const countEl = document.querySelector('#document-count');
    if (countEl) countEl.textContent = `${allDocuments.length} document${allDocuments.length === 1 ? '' : 's'}`;
    if (!allDocuments.length) {
      list.innerHTML = '<p class="empty-state">No documents yet. Add one above.</p>';
      return;
    }
    list.innerHTML = allDocuments.map((d) => `
      <div class="card card-pad" style="margin-bottom:12px;">
        <div class="flex justify-between items-center">
          <div>
            <span class="small muted" style="font-family:var(--font-mono);">#${d.sort_order}</span>
            <strong style="margin-left:6px;">${escapeHtml(d.title)}</strong>
            ${d.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
          </div>
          <div class="flex gap-8">
            <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.file_url)}" target="_blank" rel="noopener">Preview</a>
            <button class="btn btn-ghost btn-sm" data-document-edit="${d.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-document-delete="${d.id}">Delete</button>
          </div>
        </div>
        ${d.description ? `<p class="small" style="margin-top:10px; margin-bottom:0;">${escapeHtml(d.description)}</p>` : ''}
      </div>
    `).join('');
  }

  const documentForm = document.querySelector('#document-form');
  const documentCancelBtn = document.querySelector('#document-cancel-edit');

  function resetDocumentForm() {
    editingDocumentId = null;
    documentForm.reset();
    document.querySelector('#document-published').checked = true;
    document.querySelector('#document-submit').textContent = 'Add Document';
    document.querySelector('#document-file-current').style.display = 'none';
    documentCancelBtn.style.display = 'none';
  }

  documentCancelBtn?.addEventListener('click', resetDocumentForm);

  documentForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.querySelector('#document-submit');
    const fileInput = document.querySelector('#document-file');
    const file = fileInput.files[0];

    if (!editingDocumentId && !file) {
      alert('Choose a PDF file to upload.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = file ? 'Uploading…' : 'Saving…';

    let fileUrl = null;
    if (file) {
      const path = `${Date.now()}-${slugifyFilename(file.name)}.pdf`;
      const { error: uploadErr } = await supabaseClient.storage
        .from('official-documents')
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (uploadErr) {
        submitBtn.disabled = false;
        submitBtn.textContent = editingDocumentId ? 'Save Changes' : 'Add Document';
        alert('Could not upload file: ' + uploadErr.message);
        return;
      }
      const { data: publicUrlData } = supabaseClient.storage.from('official-documents').getPublicUrl(path);
      fileUrl = publicUrlData && publicUrlData.publicUrl;
    }

    const payload = {
      sort_order: Number(document.querySelector('#document-sort').value) || 1,
      title: document.querySelector('#document-title').value,
      title_es: document.querySelector('#document-title-es').value || null,
      description: document.querySelector('#document-description').value || null,
      description_es: document.querySelector('#document-description-es').value || null,
      published: document.querySelector('#document-published').checked,
    };
    if (fileUrl) payload.file_url = fileUrl;

    let error;
    if (editingDocumentId) {
      ({ error } = await supabaseClient.from('official_documents').update(payload).eq('id', editingDocumentId));
    } else {
      ({ error } = await supabaseClient.from('official_documents').insert(payload));
    }
    submitBtn.disabled = false;
    if (error) { alert('Could not save document: ' + error.message); return; }
    resetDocumentForm();
    loadDocuments();
  });

  document.querySelector('#documents-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-document-edit]');
    const delBtn = e.target.closest('[data-document-delete]');

    if (editBtn) {
      const id = editBtn.getAttribute('data-document-edit');
      const doc = allDocuments.find((d) => d.id === id);
      if (!doc) return;
      editingDocumentId = id;
      document.querySelector('#document-sort').value = doc.sort_order;
      document.querySelector('#document-title').value = doc.title;
      document.querySelector('#document-title-es').value = doc.title_es || '';
      document.querySelector('#document-description').value = doc.description || '';
      document.querySelector('#document-description-es').value = doc.description_es || '';
      document.querySelector('#document-published').checked = !!doc.published;
      const currentFileEl = document.querySelector('#document-file-current');
      currentFileEl.textContent = 'Current file stays unless you choose a new one to replace it.';
      currentFileEl.style.display = 'block';
      document.querySelector('#document-submit').textContent = 'Save Changes';
      documentCancelBtn.style.display = 'inline-flex';
      smoothScrollIntoView(documentForm, { block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-document-delete');
      if (!confirm('Delete this document? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('official_documents').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadDocuments();
    }
  });

  // ---- Revenue / Refunds ---------------------------------------------
  // Charges are fetched live from Stripe per customer (via admin-list-charges)
  // rather than mirrored into Supabase, Stripe stays the single source of
  // truth for payment history, this is just a convenience window into it.
  let revenueUsersCache = [];
  let currentRevenueUserId = null;

  function formatMoney(cents, currency) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() });
  }

  async function loadRevenue() {
    const resultsEl = document.querySelector('#revenue-user-results');
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false });
    if (error) {
      resultsEl.innerHTML = `<p class="empty-state">Could not load users: ${escapeHtml(error.message)}</p>`;
      return;
    }
    revenueUsersCache = data || [];
    renderRevenueUsers(revenueUsersCache);
  }

  function renderRevenueUsers(users) {
    const resultsEl = document.querySelector('#revenue-user-results');
    if (!users.length) {
      resultsEl.innerHTML = '<p class="empty-state">No paying customers yet. Nobody has a Stripe customer ID on file.</p>';
      return;
    }
    resultsEl.innerHTML = `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>User</th><th>Plan</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td><strong>${escapeHtml(u.full_name || '(no name)')}</strong><br><span class="small muted">${escapeHtml(u.email || '')}</span></td>
          <td>${escapeHtml(u.plan || '')}</td>
          <td><span class="badge ${u.subscription_status === 'active' ? 'badge-forest' : ''}">${escapeHtml(u.subscription_status || '')}</span></td>
          <td><button class="btn btn-ghost btn-sm" data-revenue-view="${u.id}">View Charges</button></td>
        </tr>`).join('')}
      </tbody></table></div></div>`;
  }

  document.querySelector('#revenue-user-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderRevenueUsers(revenueUsersCache); return; }
    renderRevenueUsers(revenueUsersCache.filter((u) =>
      (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    ));
  });

  async function loadChargesForUser(userId, userLabel) {
    currentRevenueUserId = userId;
    const panel = document.querySelector('#revenue-charges-panel');
    const labelEl = document.querySelector('#revenue-charges-user-label');
    const listEl = document.querySelector('#revenue-charges-list');
    panel.style.display = 'block';
    if (labelEl && userLabel) labelEl.textContent = userLabel;
    listEl.innerHTML = '<p class="empty-state">Loading charges…</p>';
    smoothScrollIntoView(panel, { block: 'nearest' });

    const { data, error } = await supabaseClient.functions.invoke('admin-list-charges', { body: { user_id: userId } });
    if (error || !data || !data.ok) {
      listEl.innerHTML = `<p class="empty-state">Could not load charges: ${escapeHtml((data && data.error) || (error && error.message) || 'Unknown error')}</p>`;
      return;
    }
    if (!data.charges.length) {
      listEl.innerHTML = '<p class="empty-state">No charges found for this customer in Stripe.</p>';
      return;
    }
    listEl.innerHTML = data.charges.map((c) => {
      const remaining = c.amount - c.amount_refunded;
      const fullyRefunded = remaining <= 0;
      return `<div class="card card-pad" style="margin-bottom:10px;" data-charge-card="${c.id}">
        <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:8px;">
          <div>
            <strong>${formatMoney(c.amount, c.currency)}</strong>
            <span class="small muted" style="margin-left:8px;">${formatDate(c.created_at)} · ${escapeHtml(c.status)}${c.amount_refunded > 0 ? ' · Refunded ' + formatMoney(c.amount_refunded, c.currency) : ''}</span>
          </div>
          ${fullyRefunded
            ? '<span class="badge">Fully Refunded</span>'
            : `<button class="btn btn-ghost btn-sm" data-refund-open="${c.id}">Refund</button>`}
        </div>
        <div class="refund-form" data-refund-form="${c.id}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid var(--line);">
          <label style="margin-bottom:4px;">Refund Amount (USD)</label>
          <input type="number" step="0.01" min="0.01" max="${(remaining / 100).toFixed(2)}" data-refund-amount="${c.id}" value="${(remaining / 100).toFixed(2)}">
          <div class="flex gap-8">
            <button class="btn btn-sm" style="background:var(--danger); border-color:var(--danger); color:var(--white);" data-refund-confirm="${c.id}">Confirm Refund</button>
            <button class="btn btn-ghost btn-sm" data-refund-cancel="${c.id}">Cancel</button>
          </div>
          <p class="small" style="color:var(--danger); display:none; margin-top:8px;" data-refund-error="${c.id}"></p>
        </div>
      </div>`;
    }).join('');
  }

  document.querySelector('#revenue-user-results')?.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-revenue-view]');
    if (!viewBtn) return;
    const id = viewBtn.getAttribute('data-revenue-view');
    const user = revenueUsersCache.find((u) => u.id === id);
    loadChargesForUser(id, user ? `${user.full_name || '(no name)'} – ${user.email || ''}` : 'Charges');
  });

  document.querySelector('#revenue-charges-list')?.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-refund-open]');
    const cancelBtn = e.target.closest('[data-refund-cancel]');
    const confirmBtn = e.target.closest('[data-refund-confirm]');

    if (openBtn) {
      const id = openBtn.getAttribute('data-refund-open');
      document.querySelector(`[data-refund-form="${id}"]`).style.display = 'block';
      openBtn.style.display = 'none';
    }
    if (cancelBtn) {
      const id = cancelBtn.getAttribute('data-refund-cancel');
      document.querySelector(`[data-refund-form="${id}"]`).style.display = 'none';
      const openBtnEl = document.querySelector(`[data-refund-open="${id}"]`);
      if (openBtnEl) openBtnEl.style.display = 'inline-flex';
    }
    if (confirmBtn) {
      const id = confirmBtn.getAttribute('data-refund-confirm');
      const amountInput = document.querySelector(`[data-refund-amount="${id}"]`);
      const errorEl = document.querySelector(`[data-refund-error="${id}"]`);
      const amountUsd = parseFloat(amountInput.value);
      if (errorEl) errorEl.style.display = 'none';
      if (!amountUsd || amountUsd <= 0) {
        if (errorEl) { errorEl.textContent = 'Enter a valid amount.'; errorEl.style.display = 'block'; }
        return;
      }
      const confirmed = confirm(`Refund ${amountUsd.toFixed(2)} USD? This charges back to the customer's original payment method and cannot be undone.`);
      if (!confirmed) return;

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Refunding…';
      const { data, error } = await supabaseClient.functions.invoke('admin-refund-charge', {
        body: { charge_id: id, amount_cents: Math.round(amountUsd * 100) },
      });
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Refund';

      if (error || !data || !data.ok) {
        if (errorEl) {
          errorEl.textContent = 'Refund failed: ' + ((data && data.error) || (error && error.message) || 'Unknown error');
          errorEl.style.display = 'block';
        }
        return;
      }
      if (currentRevenueUserId) {
        const user = revenueUsersCache.find((u) => u.id === currentRevenueUserId);
        loadChargesForUser(currentRevenueUserId, user ? `${user.full_name || '(no name)'} – ${user.email || ''}` : 'Charges');
      }
    }
  });

  // ---- Support notes ------------------------------------------------
  // Replies are sent straight from here (via the reply_to_contact_submission
  // RPC, which emails the customer through Resend and logs the reply) so an
  // admin doesn't have to switch to a separate mail client mid-ticket.
  async function loadSupport() {
    const list = document.querySelector('#support-list');
    const { data, error } = await supabaseClient.from('contact_submissions').select('*').order('created_at', { ascending: false });
    if (error) {
      list.innerHTML = `<p class="empty-state">Could not load support messages: ${escapeHtml(error.message)}</p>`;
      return;
    }
    if (!data || !data.length) {
      list.innerHTML = '<p class="empty-state">No support messages yet.</p>';
      return;
    }

    const ids = data.map((t) => t.id);
    const { data: repliesData } = await supabaseClient
      .from('contact_replies')
      .select('*')
      .in('submission_id', ids)
      .order('created_at', { ascending: true });
    const repliesBySubmission = {};
    (repliesData || []).forEach((r) => {
      (repliesBySubmission[r.submission_id] = repliesBySubmission[r.submission_id] || []).push(r);
    });

    list.innerHTML = data.map((t) => {
      const replies = repliesBySubmission[t.id] || [];
      const repliesHtml = replies.map((r) => `
        <div class="ticket-reply-row" style="margin-top:8px; padding:10px 12px; background:var(--paper-dim); border-radius:var(--radius-sm);">
          <div class="small muted" style="margin-bottom:4px;">You replied · ${formatDate(r.created_at)}</div>
          <p class="small" style="margin:0; white-space:pre-wrap;">${escapeHtml(r.message)}</p>
        </div>
      `).join('');

      return `
      <div class="card card-pad" style="margin-bottom:14px;" data-ticket-card="${t.id}">
        <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:10px;">
          <div>
            <strong>${escapeHtml(t.subject || 'No subject')}</strong>
            <span class="small muted" style="margin-left:8px;">${escapeHtml(t.name || '')} · ${escapeHtml(t.email || '')}</span>
          </div>
          <span class="small muted">${formatDate(t.created_at)}</span>
        </div>
        <p class="small" style="margin:10px 0;">${escapeHtml(t.message || '')}</p>
        ${repliesHtml}
        <label style="margin-bottom:4px; margin-top:14px;">Reply to Customer</label>
        <textarea data-ticket-reply-text="${t.id}" placeholder="Type a reply. It will be emailed to ${escapeHtml(t.email || 'the customer')}…"></textarea>
        <div class="flex gap-16 items-center" style="flex-wrap:wrap; margin-bottom:14px;">
          <button class="btn btn-primary btn-sm" data-ticket-reply-send="${t.id}">Send Reply</button>
          <span class="row-save-msg" data-ticket-reply-msg="${t.id}">Sent ✓</span>
        </div>
        <label style="margin-bottom:4px;">Admin Notes</label>
        <textarea data-ticket-notes="${t.id}" placeholder="Internal notes…">${escapeHtml(t.admin_notes || '')}</textarea>
        <div class="flex gap-16 items-center" style="flex-wrap:wrap;">
          <select data-ticket-status="${t.id}" style="max-width:180px;">
            <option value="open" ${t.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
          <button class="btn btn-ghost btn-sm" data-ticket-save="${t.id}">Save</button>
          <span class="row-save-msg" data-ticket-msg="${t.id}">Saved ✓</span>
        </div>
      </div>
    `;
    }).join('');
  }

  document.querySelector('#support-list')?.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-ticket-save]');
    const replySendBtn = e.target.closest('[data-ticket-reply-send]');

    if (saveBtn) {
      const id = saveBtn.getAttribute('data-ticket-save');
      const card = saveBtn.closest('[data-ticket-card]');
      const status = card.querySelector(`[data-ticket-status="${id}"]`).value;
      const admin_notes = card.querySelector(`[data-ticket-notes="${id}"]`).value;
      saveBtn.disabled = true;
      const { error } = await supabaseClient.from('contact_submissions').update({ status, admin_notes }).eq('id', id);
      saveBtn.disabled = false;
      const msg = card.querySelector(`[data-ticket-msg="${id}"]`);
      if (!error && msg) {
        msg.classList.add('show');
        setTimeout(() => msg.classList.remove('show'), 2000);
      }
    }

    if (replySendBtn) {
      const id = replySendBtn.getAttribute('data-ticket-reply-send');
      const card = replySendBtn.closest('[data-ticket-card]');
      const textarea = card.querySelector(`[data-ticket-reply-text="${id}"]`);
      const message = (textarea.value || '').trim();
      if (!message) { textarea.focus(); return; }

      replySendBtn.disabled = true;
      replySendBtn.textContent = 'Sending…';
      const { data: result, error } = await supabaseClient.rpc('reply_to_contact_submission', {
        p_submission_id: id,
        p_message: message,
      });
      replySendBtn.disabled = false;
      replySendBtn.textContent = 'Send Reply';

      if (error || !result || !result.ok) {
        alert('Could not send reply: ' + (error ? error.message : (result && result.error) || 'Unknown error'));
        return;
      }

      textarea.value = '';
      loadSupport();
    }
  });

  // ---- Initial load -------------------------------------------------
  loadOverview();
});
