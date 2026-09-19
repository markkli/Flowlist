import { api } from '../../shared/api';
import { syncDialogs, trapFocus } from '../../shared/dom';
import './queue.css';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
}

function taskContext({ task, goal, tasks = [] }) {
  const byId = new Map(tasks.map(item => [item.id, item]));
  const path = [goal.goal_type === 'standalone' ? 'Tasks' : goal.title];
  const visited = new Set([task.id]);
  let parent = byId.get(task.parent_id);
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    path.splice(1, 0, parent.title);
    parent = byId.get(parent.parent_id);
  }
  return path.join(' / ');
}

function eligibleTasks(goals) {
  return goals.filter(({ goal }) => !goal.completed).flatMap(({ goal, tasks }) => {
    const parents = new Set(tasks.map(task => task.parent_id));
    const ordered = [];
    const visited = new Set();
    function visit(parentId) {
      tasks.filter(task => task.parent_id === parentId)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .forEach(task => {
          if (visited.has(task.id)) return;
          visited.add(task.id);
          if (task.completed) return;
          if (parents.has(task.id)) visit(task.id);
          else ordered.push({ task, goal, tasks });
        });
    }
    visit(null);
    return ordered;
  });
}

/** A persistent shortlist. Membership remains until edited or the work is finished. */
export function initQueue({ showToast, onChange }) {
  const agenda = document.getElementById('today-agenda');
  const panel = agenda.closest('.agenda-panel');
  panel.classList.add('queue-panel');
  const heading = panel.querySelector('.panel-heading');
  const planLink = document.getElementById('open-roadmap');
  const headingActions = element('div', 'queue-heading-actions');
  const editButton = button('Choose tasks', 'secondary-btn queue-edit');
  editButton.id = 'edit-queue';
  editButton.setAttribute('aria-haspopup', 'dialog');
  editButton.setAttribute('aria-controls', 'queue-picker-overlay');
  headingActions.append(editButton, planLink);
  heading.append(headingActions);
  panel.querySelector('.progress-line').classList.add('queue-summary');
  document.getElementById('daily-progress-value').closest('.progress-track').hidden = true;

  const overlay = element('div', 'overlay queue-picker-overlay hidden');
  overlay.id = 'queue-picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'queue-picker-title');
  overlay.setAttribute('aria-describedby', 'queue-picker-description');
  overlay.innerHTML = `
    <section class="queue-picker" tabindex="-1">
      <header class="queue-picker-header">
        <div><p class="kicker">Your shortlist</p><h2 id="queue-picker-title">Choose what comes next</h2></div>
        <button class="queue-icon-button queue-picker-close" type="button" aria-label="Close task picker"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
      </header>
      <p class="queue-picker-description" id="queue-picker-description">Keep a few tasks close at hand. Your queue stays until you change it; the rest remains in Plan.</p>
      <label class="queue-search-label" for="queue-search">Find a task</label>
      <input class="field queue-search" id="queue-search" type="search" placeholder="Search tasks or projects" autocomplete="off">
      <details class="queue-draft">
        <summary><span>Queue order <b id="queue-draft-count">0</b></span><span class="queue-draft-hint">Review & reorder</span></summary>
        <ol class="queue-draft-list"></ol>
      </details>
      <div class="queue-options" aria-label="Available tasks"></div>
      <p class="field-error queue-picker-error" role="alert"></p>
      <footer class="queue-picker-footer">
        <span class="queue-selection-count" role="status" aria-live="polite">0 selected</span>
        <div><button class="text-btn queue-picker-cancel" type="button">Cancel</button><button class="primary-btn queue-picker-save" type="button">Save queue</button></div>
      </footer>
    </section>`;
  document.body.append(overlay);
  const dialog = overlay.querySelector('.queue-picker');
  const search = overlay.querySelector('#queue-search');
  const options = overlay.querySelector('.queue-options');
  const draftList = overlay.querySelector('.queue-draft-list');
  const error = overlay.querySelector('.queue-picker-error');
  const saveButton = overlay.querySelector('.queue-picker-save');
  const rowMenu = element('div', 'queue-row-menu hidden');
  rowMenu.setAttribute('role', 'group');
  rowMenu.setAttribute('aria-label', 'Queue task actions');
  document.body.append(rowMenu);

  let entries = [];
  let candidates = [];
  let draftIds = [];
  let returnFocus = editButton;
  let menuTrigger = null;
  let saving = false;
  let mutating = false;

  function closeMenu(restoreFocus = false) {
    rowMenu.classList.add('hidden');
    menuTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus();
    menuTrigger = null;
  }

  function closePicker() {
    if (saving) return;
    overlay.classList.add('hidden');
    editButton.setAttribute('aria-expanded', 'false');
    syncDialogs();
    if (returnFocus?.isConnected) returnFocus.focus();
    else editButton.focus();
  }

  function openPicker(trigger = editButton) {
    closeMenu();
    returnFocus = trigger;
    draftIds = entries.map(({ task }) => task.id);
    search.value = '';
    error.textContent = '';
    overlay.querySelector('.queue-draft').open = false;
    renderDraft();
    renderOptions();
    overlay.classList.remove('hidden');
    editButton.setAttribute('aria-expanded', 'true');
    syncDialogs();
    requestAnimationFrame(() => search.focus());
  }

  function renderDraft() {
    const selected = new Map(candidates.map(entry => [entry.task.id, entry]));
    document.getElementById('queue-draft-count').textContent = String(draftIds.length);
    overlay.querySelector('.queue-selection-count').textContent = `${draftIds.length} selected`;
    draftList.replaceChildren();
    if (!draftIds.length) {
      draftList.append(element('li', 'queue-draft-empty', 'Select tasks below to build your queue.'));
      return;
    }
    draftIds.forEach((id, index) => {
      const entry = selected.get(id);
      if (!entry) return;
      const row = element('li', 'queue-draft-row');
      const title = element('span', 'queue-draft-title', entry.task.title);
      title.title = entry.task.title;
      const controls = element('div', 'queue-draft-controls');
      [['Move up', -1], ['Move down', 1]].forEach(([label, delta]) => {
        const control = button('', 'queue-icon-button queue-stroke-icon');
        control.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${delta < 0 ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'}"/></svg>`;
        control.setAttribute('aria-label', `${label}: ${entry.task.title}`);
        control.title = label;
        control.dataset.queueDraftId = String(id);
        control.dataset.direction = String(delta);
        control.disabled = index + delta < 0 || index + delta >= draftIds.length;
        control.addEventListener('click', () => {
          const target = index + delta;
          [draftIds[index], draftIds[target]] = [draftIds[target], draftIds[index]];
          renderDraft();
          const replacement = draftList.querySelector(`[data-queue-draft-id="${id}"][data-direction="${delta}"]`);
          if (!replacement?.disabled) replacement?.focus();
          else draftList.querySelector(`[data-queue-draft-id="${id}"]:not(:disabled)`)?.focus();
        });
        controls.append(control);
      });
      const remove = button('', 'queue-icon-button queue-stroke-icon');
      remove.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>';
      remove.setAttribute('aria-label', `Unselect ${entry.task.title}`);
      remove.title = 'Remove from selection';
      remove.addEventListener('click', () => {
        draftIds = draftIds.filter(taskId => taskId !== id);
        renderDraft();
        renderOptions();
        const remaining = draftList.querySelectorAll('.queue-draft-row');
        if (remaining.length) remaining[Math.min(index, remaining.length - 1)].querySelector('button:not(:disabled)')?.focus();
        else overlay.querySelector('.queue-draft summary').focus();
      });
      controls.append(remove);
      row.append(title, controls);
      draftList.append(row);
    });
  }

  function renderOptions() {
    options.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const matches = candidates.filter(entry => `${entry.task.title} ${taskContext(entry)}`.toLocaleLowerCase().includes(query));
    if (!matches.length) {
      const empty = element('div', 'queue-picker-empty');
      empty.append(element('strong', '', query ? 'No matching tasks' : 'No unfinished tasks yet'));
      empty.append(element('p', '', query ? 'Try another task or project name.' : 'Add a task in Plan, then choose it here.'));
      options.append(empty);
      return;
    }
    const groups = new Map();
    matches.forEach(entry => {
      if (!groups.has(entry.goal.id)) groups.set(entry.goal.id, []);
      groups.get(entry.goal.id).push(entry);
    });
    groups.forEach(group => {
      const fieldset = element('fieldset', 'queue-option-group');
      const goal = group[0].goal;
      fieldset.append(element('legend', '', goal.goal_type === 'standalone' ? 'Tasks' : goal.title));
      group.forEach(entry => {
        const row = element('label', 'queue-option');
        const input = element('input');
        input.type = 'checkbox';
        input.checked = draftIds.includes(entry.task.id);
        input.value = String(entry.task.id);
        const copy = element('span', 'queue-option-copy');
        copy.append(element('span', 'queue-option-title', entry.task.title));
        if (entry.task.parent_id !== null) copy.append(element('small', 'queue-option-context', taskContext(entry)));
        input.addEventListener('change', () => {
          draftIds = input.checked ? [...draftIds, entry.task.id] : draftIds.filter(id => id !== entry.task.id);
          renderDraft();
        });
        row.append(input, copy);
        fieldset.append(row);
      });
      options.append(fieldset);
    });
  }

  async function refreshDashboard() {
    try { await onChange(); }
    catch (refreshError) { showToast(`Changes saved. ${refreshError.message}`, true); }
  }

  function renderQueue() {
    closeMenu();
    agenda.replaceChildren();
    editButton.textContent = entries.length ? 'Edit queue' : 'Choose tasks';
    document.getElementById('daily-progress-copy').textContent = entries.length
      ? 'Your next steps, in your order' : 'A little less to think about';
    document.getElementById('daily-progress-number').textContent = `${entries.length} ${entries.length === 1 ? 'task' : 'tasks'}`;
    if (!entries.length) {
      const empty = element('div', 'queue-empty');
      const mark = element('span', 'queue-empty-mark');
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v4H9zm0 9h6m-6 4h4"/></svg>';
      empty.append(mark, element('h3', '', 'Make room for what matters.'), element('p', '', 'Choose a few tasks from Plan. They’ll stay here until you finish or remove them.'));
      const choose = button('Choose tasks', 'secondary-btn');
      choose.addEventListener('click', () => openPicker(choose));
      empty.append(choose);
      agenda.append(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const { task, goal } = entry;
      const row = element('div', 'agenda-item queue-item');
      row.dataset.queueTaskId = String(task.id);
      const complete = button('', 'task-check');
      complete.setAttribute('aria-label', `Complete ${task.title}`);
      complete.setAttribute('aria-pressed', 'false');
      complete.disabled = mutating;
      complete.addEventListener('click', async () => {
        if (mutating) return;
        mutating = true;
        editButton.disabled = true;
        complete.disabled = true;
        try {
          await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true }) });
          entries = entries.filter(item => item.task.id !== task.id);
          renderQueue();
          await refreshDashboard();
          showToast('Task completed.', false, { label: 'Undo', run: async () => {
            try {
              await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: false }) });
              await refreshDashboard();
            } catch (undoError) { showToast(undoError.message, true); }
          } });
          mutating = false;
          editButton.disabled = false;
          agenda.querySelectorAll('.task-check, .queue-more').forEach(control => { control.disabled = false; });
          const remaining = agenda.querySelectorAll('.queue-item');
          if (remaining.length) remaining[Math.min(index, remaining.length - 1)].querySelector('.task-check').focus();
          else editButton.focus();
        } catch (completionError) { showToast(completionError.message, true); }
        finally { mutating = false; editButton.disabled = false; agenda.querySelectorAll('.task-check, .queue-more').forEach(control => { control.disabled = false; }); }
      });
      const copy = element('div', 'agenda-copy');
      const title = element('span', 'agenda-title', task.title);
      title.title = task.title;
      const context = goal.goal_type === 'standalone' ? 'Tasks' : goal.title;
      const detail = element('span', 'agenda-goal', context);
      detail.title = context;
      copy.append(title, detail);
      const more = button('', 'queue-icon-button queue-more');
      more.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg>';
      more.setAttribute('aria-label', `Queue options for ${task.title}`);
      more.setAttribute('aria-expanded', 'false');
      more.disabled = mutating;
      more.addEventListener('click', () => openRowMenu(entry, index, more));
      row.append(complete, copy, more);
      agenda.append(row);
    });
  }

  function openRowMenu(entry, index, trigger) {
    if (menuTrigger === trigger) return closeMenu(true);
    closeMenu();
    menuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    rowMenu.replaceChildren();
    const taskId = entry.task.id;
    const actions = [
      { label: 'Move up', disabled: index === 0, run: async () => {
        const ids = entries.map(({ task }) => task.id);
        [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
        await api('/queue', { method: 'PUT', body: JSON.stringify({ ordered_ids: ids }) });
        const byId = new Map(entries.map(item => [item.task.id, item]));
        entries = ids.map(id => byId.get(id));
      } },
      { label: 'Move down', disabled: index === entries.length - 1, run: async () => {
        const ids = entries.map(({ task }) => task.id);
        [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
        await api('/queue', { method: 'PUT', body: JSON.stringify({ ordered_ids: ids }) });
        const byId = new Map(entries.map(item => [item.task.id, item]));
        entries = ids.map(id => byId.get(id));
      } },
      { label: 'Remove from queue', run: async () => {
        await api(`/queue/${taskId}`, { method: 'DELETE' });
        entries = entries.filter(item => item.task.id !== taskId);
      } },
    ];
    actions.forEach(action => {
      const control = button(action.label);
      control.disabled = action.disabled || false;
      control.addEventListener('click', async () => {
        if (mutating) return;
        mutating = true;
        editButton.disabled = true;
        rowMenu.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          await action.run();
          renderQueue();
          await refreshDashboard();
          const restore = agenda.querySelector(`[data-queue-task-id="${taskId}"] .queue-more`) || agenda.querySelector('.queue-more') || editButton;
          mutating = false;
          editButton.disabled = false;
          agenda.querySelectorAll('.task-check, .queue-more').forEach(item => { item.disabled = false; });
          restore.focus();
          if (action.label === 'Remove from queue') showToast('Removed from your queue. The task is still in Plan.');
        } catch (actionError) { closeMenu(true); showToast(actionError.message, true); }
        finally { mutating = false; editButton.disabled = false; }
      });
      rowMenu.append(control);
    });
    rowMenu.classList.remove('hidden');
    positionRowMenu();
    rowMenu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }

  function positionRowMenu() {
    if (!menuTrigger) return;
    const rect = menuTrigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return closeMenu();
    const menuRect = rowMenu.getBoundingClientRect();
    rowMenu.style.left = `${Math.max(8, Math.min(rect.right - menuRect.width, innerWidth - menuRect.width - 8))}px`;
    rowMenu.style.top = `${rect.bottom + menuRect.height + 8 > innerHeight ? Math.max(8, rect.top - menuRect.height - 5) : rect.bottom + 5}px`;
  }

  function setData(nextData) {
    candidates = eligibleTasks(nextData.goals || []);
    entries = (nextData.queue || []).filter(({ task }) => !task.completed);
    renderQueue();
  }

  editButton.addEventListener('click', () => openPicker());
  search.addEventListener('input', renderOptions);
  overlay.querySelector('.queue-picker-close').addEventListener('click', closePicker);
  overlay.querySelector('.queue-picker-cancel').addEventListener('click', closePicker);
  overlay.addEventListener('click', event => { if (event.target === overlay) closePicker(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); }
    else if (event.key === 'Tab') { event.stopPropagation(); trapFocus(event, dialog); }
  });
  rowMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const controls = [...rowMenu.querySelectorAll('button:not(:disabled)')];
      const current = controls.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
      controls[next]?.focus();
    }
  });
  rowMenu.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!rowMenu.contains(document.activeElement) && document.activeElement !== menuTrigger) closeMenu();
  }));
  document.addEventListener('pointerdown', event => {
    if (!rowMenu.contains(event.target) && !menuTrigger?.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('scroll', positionRowMenu, true);
  saveButton.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    error.textContent = '';
    saveButton.textContent = 'Saving…';
    dialog.setAttribute('aria-busy', 'true');
    overlay.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    try {
      await api('/queue', { method: 'PUT', body: JSON.stringify({ ordered_ids: draftIds }) });
      const byId = new Map(candidates.map(entry => [entry.task.id, entry]));
      entries = draftIds.map(id => byId.get(id)).filter(Boolean);
      renderQueue();
      saving = false;
      closePicker();
      await refreshDashboard();
      showToast(entries.length ? 'Your queue is ready.' : 'Queue cleared. Your tasks are still in Plan.');
    } catch (saveError) { error.textContent = saveError.message; }
    finally {
      saving = false;
      dialog.removeAttribute('aria-busy');
      saveButton.textContent = 'Save queue';
      overlay.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
      renderDraft();
      if (!overlay.classList.contains('hidden')) saveButton.focus();
    }
  });

  return { setData, openPicker };
}
