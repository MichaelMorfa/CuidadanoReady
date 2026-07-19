/* ==========================================================================
   Ciudadano Ready — Admin panel logic
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
  if (!iso) return '—';
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
  }

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
      list.innerHTML = '<p class="empty-state">No lessons yet — add your first one above.</p>';
      return;
    }
    let html = '';
    let currentModule = null;
    data.forEach((lesson) => {
      if (lesson.module_number !== currentModule) {
        currentModule = lesson.module_number;
        html += `<div class="module-heading">Module ${currentModule} — ${escapeHtml(MODULE_NAMES[currentModule] || '')}</div>`;
      }
      html += `
        <div class="card card-pad" style="margin-bottom:12px;" data-lesson-card="${lesson.id}">
          <div class="flex justify-between items-center">
            <div>
              <strong>${escapeHtml(lesson.title)}</strong>
              ${lesson.published ? '<span class="badge badge-forest" style="margin-left:8px;">Published</span>' : '<span class="badge" style="margin-left:8px;">Draft</span>'}
              ${lesson.video_url ? '<span class="badge" style="margin-left:6px;">Has Video</span>' : ''}
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
      document.querySelector('#lesson-published').checked = !!data.published;
      document.querySelector('#lesson-submit').textContent = 'Save Changes';
      lessonCancelBtn.style.display = 'inline-flex';
      lessonForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      list.innerHTML = '<p class="empty-state">No quiz questions yet — add your first one above.</p>';
      return;
    }
    let html = '';
    let currentModule = null;
    data.forEach((q) => {
      if (q.module_number !== currentModule) {
        currentModule = q.module_number;
        html += `<div class="module-heading">Module ${currentModule} — ${escapeHtml(MODULE_NAMES[currentModule] || '')}</div>`;
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
      choice_c: document.querySelector('#quiz-choice-c').value,
      choice_d: document.querySelector('#quiz-choice-d').value,
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
      quizForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      list.innerHTML = '<p class="empty-state">No flashcards in this set yet — add one above.</p>';
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
      flashcardForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (delBtn) {
      const id = delBtn.getAttribute('data-flashcard-delete');
      if (!confirm('Delete this flashcard? This cannot be undone.')) return;
      const { error } = await supabaseClient.from('flashcards').delete().eq('id', id);
      if (error) { alert('Could not delete: ' + error.message); return; }
      loadFlashcards();
    }
  });

  // ---- Support notes ------------------------------------------------
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
    list.innerHTML = data.map((t) => `
      <div class="card card-pad" style="margin-bottom:14px;" data-ticket-card="${t.id}">
        <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:10px;">
          <div>
            <strong>${escapeHtml(t.subject || 'No subject')}</strong>
            <span class="small muted" style="margin-left:8px;">${escapeHtml(t.name || '')} · ${escapeHtml(t.email || '')}</span>
          </div>
          <span class="small muted">${formatDate(t.created_at)}</span>
        </div>
        <p class="small" style="margin:10px 0;">${escapeHtml(t.message || '')}</p>
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
    `).join('');
  }

  document.querySelector('#support-list')?.addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-ticket-save]');
    if (!saveBtn) return;
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
  });

  // ---- Initial load -------------------------------------------------
  loadOverview();
});
