import { api } from '../../shared/api';
import { escapeHtml, trapFocus, syncDialogs as syncModal } from '../../shared/dom';
import { RITUAL_KEY, defaults, validSettings, freshRitual, readRitual, migrateLegacy, advance, remaining, payload } from './state';

export function initTimer({ showToast, loadGoals, loadDashboard }) {
const formatTime = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
const TIMER_SETTINGS_KEY = 'flowlist-timer-settings';
let timerSettings = {...defaults};
try { const saved = JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY)); if (validSettings(saved)) timerSettings = saved; } catch {}
let state = migrateLegacy(timerSettings);
let pendingSession = state && ['awaiting-attribution','saving'].includes(state.phase) ? payload(state) : null;
let saving = false;
let optionsReady = false;
let lastFocus = null;
const focusOverlay = document.getElementById('focus-overlay');
const focusModal = focusOverlay.querySelector('.timer-modal');
const focusAddPlan = document.getElementById('focus-add-plan');
const mini = document.getElementById('timer-mini');
const timerSettingsToggle = document.getElementById('timer-settings-toggle');
const timerSettingsOverlay = document.getElementById('timer-settings-overlay');
const timerSettingsModal = timerSettingsOverlay.querySelector('.settings-modal');
const timerSettingsForm = document.getElementById('timer-settings-form');
const focusMinutesSetting = document.getElementById('focus-minutes-setting');
const breakMinutesSetting = document.getElementById('break-minutes-setting');
const roundsSetting = document.getElementById('rounds-setting');
const longBreakMinutesSetting = document.getElementById('long-break-minutes-setting');
const timerSettingsError = document.getElementById('timer-settings-error');

async function mutate(change) {
  const work = () => {
    const latest = readRitual();
    const next = change(latest);
    if (next === undefined) { state = latest; return; }
    if (next) localStorage.setItem(RITUAL_KEY, JSON.stringify(next));
    else localStorage.removeItem(RITUAL_KEY);
    state = next;
  };
  if (navigator.locks) await navigator.locks.request('flowlist-ritual', work); else work();
  renderTimer();
}
function renderSettings() {
  focusMinutesSetting.value = timerSettings.focus;
  breakMinutesSetting.value = timerSettings.break;
  roundsSetting.value = timerSettings.rounds;
  longBreakMinutesSetting.value = timerSettings.longBreak;
  document.getElementById('timer-settings-label').textContent = `${timerSettings.focus} / ${timerSettings.break} · ${timerSettings.rounds} rounds`;
  document.getElementById('timer-summary').textContent = `${timerSettings.focus} focus · ${timerSettings.break} short break · ${timerSettings.longBreak} long break`;
  document.getElementById('long-break-copy').textContent = `Long break every ${timerSettings.rounds} rounds`;
  document.getElementById('hero-time').innerHTML = `${timerSettings.focus}:00<span>Start focus</span>`;
  document.getElementById('pomodoro-heading').textContent = `Protect the next ${timerSettings.focus} minutes.`;
  document.getElementById('pomodoro-round-copy').textContent = 'Begin with one focus interval';
  document.getElementById('start-pomodoro').setAttribute('aria-label', `Start a ${timerSettings.focus}-minute focus ritual`);
}
function setTimerSettingsOpen(open) {
  timerSettingsOverlay.classList.toggle('hidden', !open);
  timerSettingsToggle.setAttribute('aria-expanded', String(open));
  timerSettingsError.textContent = '';
  if (open) renderSettings();
  syncModal();
  if (open) timerSettingsModal.focus(); else timerSettingsToggle.focus();
}
timerSettingsToggle.addEventListener('click', () => setTimerSettingsOpen(true));
['timer-settings-close','timer-settings-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => setTimerSettingsOpen(false)));
timerSettingsForm.addEventListener('submit', event => {
  event.preventDefault();
  const next = { focus: Number(focusMinutesSetting.value), break: Number(breakMinutesSetting.value), rounds: Number(roundsSetting.value), longBreak: Number(longBreakMinutesSetting.value) };
  if (!validSettings(next)) { timerSettingsError.textContent = 'Use whole minutes within the limits shown, and 2–8 rounds.'; return; }
  timerSettings = next; localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(next));
  renderSettings(); setTimerSettingsOpen(false);
  showToast('Settings saved for your next ritual.');
});
function renderTimer() {
  const running = state && ['focus','break'].includes(state.phase);
  const pending = state && ['awaiting-attribution','saving'].includes(state.phase);
  mini.classList.toggle('hidden', !running && !pending);
  focusOverlay.classList.toggle('hidden', !running || state.minimized);
  document.getElementById('timer-mini-end').classList.toggle('hidden', !running);
  if (running) {
    const seconds = remaining(state);
    const label = state.phase === 'focus' ? 'Focus' : state.breakKind === 'long' ? 'Long break' : 'Short break';
    document.getElementById('focus-phase-label').textContent = label;
    document.getElementById('focus-task-title').textContent = `${label} · round ${state.round} of ${state.settings.rounds}`;
    document.getElementById('focus-goal-title').textContent = state.phase === 'focus' ? 'Stay with the work. Name it afterward.' : 'Step away for a moment. The next focus interval begins after this break.';
    document.getElementById('focus-cycle-copy').textContent = `${Math.floor(state.elapsedSeconds/60)} minutes accumulated`;
    document.getElementById('focus-time').innerHTML = `${formatTime(seconds)}<span>Remaining</span>`;
    document.getElementById('focus-orbit').style.setProperty('--timer-progress', String(seconds / state.blockSeconds));
    document.getElementById('focus-skip-label').textContent = state.phase === 'focus' ? 'Skip to break' : 'Skip to focus';
    document.getElementById('timer-mini-copy').textContent = `${label} · ${formatTime(seconds)} · Round ${state.round}`;
  } else if (pending) document.getElementById('timer-mini-copy').textContent = 'Unsaved ritual · Review and save';
  syncModal();
}
async function openTimer() {
  state = readRitual();
  if (state && ['awaiting-attribution','saving'].includes(state.phase)) { pendingSession = payload(state); await openAttributionModal(); return; }
  lastFocus = document.activeElement;
  await mutate(latest => latest && latest.phase !== 'saved' ? {...latest, minimized: false} : freshRitual(timerSettings));
  focusModal.focus();
}
async function minimizeTimer() {
  await mutate(latest => latest ? {...latest, minimized: true} : undefined);
  (lastFocus?.isConnected ? lastFocus : document.getElementById('start-pomodoro')).focus();
}
async function transition(end = false, expectedDeadline = null) {
  await mutate(latest => {
    if (!latest || !['focus','break'].includes(latest.phase) || (expectedDeadline !== null && latest.deadline !== expectedDeadline)) return undefined;
    return advance(latest, Date.now(), end);
  });
  if (state?.phase === 'awaiting-attribution') { pendingSession = payload(state); await openAttributionModal(); }
}
document.getElementById('start-pomodoro').addEventListener('click', openTimer);
document.getElementById('timer-mini-open').addEventListener('click', openTimer);
document.getElementById('focus-minimize').addEventListener('click', minimizeTimer);
document.getElementById('focus-exit').addEventListener('click', () => transition(true));
document.getElementById('timer-mini-end').addEventListener('click', () => transition(true));
document.getElementById('focus-skip').addEventListener('click', () => transition());
let ticking = false;
setInterval(async () => {
  renderTimer();
  if (ticking || !state || !['focus','break'].includes(state.phase) || remaining(state) > 0) return;
  ticking = true;
  try { await transition(false, state.deadline); } finally { ticking = false; }
}, 1000);
window.addEventListener('storage', event => {
  if (event.key !== RITUAL_KEY) return;
  state = readRitual();
  if (!state || state.phase === 'saved') {
    pendingSession = null; attributionOverlay.classList.add('hidden');
  } else if (['awaiting-attribution','saving'].includes(state.phase)) pendingSession = payload(state);
  renderTimer();
});
const planCaptureOverlay = document.getElementById("plan-capture-overlay");
const planCaptureModal = planCaptureOverlay.querySelector(".quick-plan-modal");
const planCaptureForm = document.getElementById("plan-capture-form");
const planCaptureName = document.getElementById("plan-capture-name");
const planCaptureDestination = document.getElementById("plan-capture-destination");
const planCaptureError = document.getElementById("plan-capture-error");

function renderPlanCaptureDestinations(goals) {
  const activeDirections = goals.filter(
    (goal) => goal.goal_type !== "standalone" && !goal.completed,
  );
  planCaptureDestination.innerHTML = [
    '<option value="__tasks__">Tasks · shared list</option>',
    ...activeDirections.map(
      (goal) => `<option value="${goal.id}">${escapeHtml(goal.title)} · ${goal.goal_type === "learning" ? "Learning" : "Project"}</option>`,
    ),
  ].join("");
}

async function setPlanCaptureOpen(open) {
  planCaptureOverlay.classList.toggle("hidden", !open);
  focusOverlay.setAttribute("aria-hidden", String(open));
  planCaptureError.textContent = "";
  if (open) {
    document.body.classList.add("modal-open");
    focusOverlay.inert = true;
    try {
      renderPlanCaptureDestinations(await api("/goals"));
    } catch (error) {
      renderPlanCaptureDestinations([]);
      planCaptureError.textContent = "Existing directions could not be loaded. You can still add to Tasks.";
    }
    requestAnimationFrame(() => planCaptureName.focus());
  } else {
    planCaptureForm.reset();
    if (focusOverlay.classList.contains("hidden")) document.body.classList.remove("modal-open");
    focusOverlay.inert = false;
    focusAddPlan.focus();
    syncModal();
  }
}

focusAddPlan.addEventListener("click", () => setPlanCaptureOpen(true));
document.getElementById("plan-capture-close").addEventListener("click", () => setPlanCaptureOpen(false));
document.getElementById("plan-capture-cancel").addEventListener("click", () => setPlanCaptureOpen(false));
planCaptureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = planCaptureName.value.trim();
  if (!title) {
    planCaptureError.textContent = "Give this item a name.";
    planCaptureName.focus();
    return;
  }
  const destination = planCaptureDestination.value;
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Adding…";
  try {
    if (destination === "__tasks__") {
      await api("/standalone-tasks", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    } else {
      await api(`/goals/${Number(destination)}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    }
    setPlanCaptureOpen(false);
    await loadGoals();
    showToast("Task added to your plan.");
  } catch (error) {
    planCaptureError.textContent = "Flowlist could not add this item. Try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Add task";
  }
});

const attributionOverlay = document.getElementById("session-attribution-overlay");
const attributionModal = attributionOverlay.querySelector(".attribution-modal");
const attributionOptions = document.getElementById("attribution-options");
const attributionError = document.getElementById("attribution-error");
const saveSessionButton = document.getElementById("save-session");
const sessionSummary = document.getElementById("session-summary");
const attributionTaskBuilder = document.getElementById("attribution-task-builder");
const attributionNewTask = document.getElementById("attribution-new-task");
const attributionTaskDestination = document.getElementById("attribution-task-destination");
const attributionNewGroup = document.getElementById("attribution-new-group");
const attributionNewGroupName = document.getElementById("attribution-new-group-name");
const attributionTaskError = document.getElementById("attribution-task-error");
const attributionAddTask = document.getElementById("attribution-add-task");

function currentAttributionSelections() {
  return new Map(
    [...attributionOptions.querySelectorAll(".attribution-task-row")].map((row) => [
      Number(row.dataset.taskId),
      {
        worked: row.querySelector(".attribution-worked-input").checked,
        finished: row.querySelector(".attribution-finished-input").checked,
      },
    ])
  );
}

function renderAttributionOptions(options, selections = new Map()) {
  attributionOptions.innerHTML = "";
  options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "attribution-task-row";
    row.dataset.taskId = option.id;
    row.innerHTML = `<div class="attribution-task-copy"><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(option.goal_title)}</small>${index === 0 ? `<em>${option.last_focused_at ? "Recent" : "Next"}</em>` : ""}</div><label class="attribution-toggle attribution-worked"><input class="attribution-worked-input" type="checkbox"><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span class="sr-only">Worked on ${escapeHtml(option.title)}</span></label><label class="attribution-toggle attribution-finished"><input class="attribution-finished-input" type="checkbox"><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span class="sr-only">Finished ${escapeHtml(option.title)}</span></label>`;
    const selected = selections.get(option.id);
    if (selected) {
      row.querySelector(".attribution-worked-input").checked = selected.worked;
      row.querySelector(".attribution-finished-input").checked = selected.finished;
      row.classList.toggle("selected", selected.worked);
      row.classList.toggle("finished", selected.finished);
    }
    attributionOptions.appendChild(row);
  });
  if (!options.length) {
    attributionOptions.innerHTML = '<p class="attribution-empty">No unfinished tasks are available. This session will be saved as General focus.</p>';
  }
}

function renderAttributionDestinations(goals) {
  const regularGoals = goals.filter((goal) => goal.goal_type !== "standalone" && !goal.completed);
  attributionTaskDestination.innerHTML = [
    '<option value="__tasks__">Tasks · simple list</option>',
    ...regularGoals.map((goal) => `<option value="${goal.id}">${escapeHtml(goal.title)} · ${goal.goal_type === "learning" ? "Learning" : "Project"}</option>`),
    '<option value="__new__">New project or learning objective…</option>',
  ].join("");
  attributionNewGroup.classList.add("hidden");
}

attributionTaskDestination.addEventListener("change", () => {
  const creatingGroup = attributionTaskDestination.value === "__new__";
  attributionNewGroup.classList.toggle("hidden", !creatingGroup);
  if (creatingGroup) attributionNewGroupName.focus();
});

attributionAddTask.addEventListener("click", async () => {
  const title = attributionNewTask.value.trim();
  if (!title) {
    attributionTaskError.textContent = "Name the task you want to add.";
    attributionNewTask.focus();
    return;
  }
  attributionTaskError.textContent = "";
  attributionAddTask.disabled = true;
  attributionAddTask.textContent = "Adding…";
  try {
    const destination = attributionTaskDestination.value;
    let createdTask;
    if (destination === "__tasks__") {
      createdTask = await api("/standalone-tasks", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    } else {
      let goalId = Number(destination);
      if (destination === "__new__") {
        const groupTitle = attributionNewGroupName.value.trim();
        if (!groupTitle) {
          attributionTaskError.textContent = "Name the new project or learning objective.";
          attributionNewGroupName.focus();
          return;
        }
        const groupType = document.querySelector('input[name="attribution-group-type"]:checked').value;
        const goal = await api("/goals", {
          method: "POST",
          body: JSON.stringify({ title: groupTitle, goal_type: groupType }),
        });
        goalId = goal.id;
      }
      createdTask = await api(`/goals/${goalId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    }
    const selections = currentAttributionSelections();
    selections.set(createdTask.id, { worked: true, finished: false });
    const [options, goals] = await Promise.all([api("/focus-options"), api("/goals")]);
    renderAttributionOptions(options, selections);
    renderAttributionDestinations(goals);
    attributionNewTask.value = "";
    attributionNewGroupName.value = "";
    attributionTaskBuilder.removeAttribute("open");
    await persistDraft();
    showToast("Task added and selected for this ritual.");
  } catch (error) {
    attributionTaskError.textContent = "Flowlist could not add that task. Try again.";
  } finally {
    attributionAddTask.disabled = false;
    attributionAddTask.textContent = "Add and select task";
  }
});

async function openAttributionModal() {
  if (!pendingSession) return;
  optionsReady = false;
  document.getElementById("attribution-status").textContent = "Ritual ended";
  document.getElementById("attribution-minutes").textContent = `${pendingSession.actual_minutes} ${pendingSession.actual_minutes === 1 ? "minute" : "minutes"}`;
  saveSessionButton.textContent = "Save ritual";
  saveSessionButton.disabled = true;
  attributionError.textContent = "";
  attributionTaskError.textContent = "";
  sessionSummary.value = state.summary;
  attributionNewTask.value = state.draftTask;
  attributionNewGroupName.value = state.draftGroup;
  attributionTaskBuilder.removeAttribute("open");
  attributionOptions.innerHTML = '<div class="attribution-loading"><span class="loading-ring" aria-hidden="true"></span><span>Finding your tasks…</span></div>';
  attributionOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  attributionModal.focus();
  syncModal();
  try {
    const [options, goals] = await Promise.all([api("/focus-options"), api("/goals")]);
    if (!pendingSession) return;
    optionsReady = true;
    const selected = new Map(state.selections.map(item => [item.task_id, {worked:true, finished:item.completed}]));
    renderAttributionOptions(options, selected);
    renderAttributionDestinations(goals);
    const missing = state.selections.filter(item => !options.some(option => option.id === item.task_id));
    if (missing.length) attributionError.textContent = 'Some selected tasks are no longer available. Review the selection before saving.';
    attributionTaskDestination.value = [...attributionTaskDestination.options].some(option => option.value === state.draftDestination) ? state.draftDestination : '__tasks__';
    attributionNewGroup.classList.toggle('hidden', attributionTaskDestination.value !== '__new__');
    document.querySelector(`input[name="attribution-group-type"][value="${state.draftGroupType === 'learning' ? 'learning' : 'project'}"]`).checked = true;
  } catch (error) {
    if (!pendingSession) return;
    renderAttributionOptions([]);
    renderAttributionDestinations([]);
    attributionError.textContent = state.selections.length ? 'Task suggestions are unavailable. Your previous selections are preserved; Save later and reopen to review them.' : 'Task suggestions are unavailable. You can still save this as general focus.';
  } finally {
    if (pendingSession) saveSessionButton.disabled = false;
  }
}

attributionOptions.addEventListener("change", (event) => {
  const row = event.target.closest(".attribution-task-row");
  if (!row) return;
  const worked = row.querySelector(".attribution-worked-input");
  const finished = row.querySelector(".attribution-finished-input");
  if (event.target === finished && finished.checked) worked.checked = true;
  if (event.target === worked && !worked.checked) finished.checked = false;
  row.classList.toggle("selected", worked.checked);
  row.classList.toggle("finished", finished.checked);
  persistDraft();
});


async function persistDraft() {
  if (!pendingSession || saving) return;
  const id = pendingSession.client_id;
  const tasks = !optionsReady ? (state?.selections || []) : [...currentAttributionSelections()].filter(([,value]) => value.worked).map(([task_id,value]) => ({task_id, completed:value.finished}));
  const draft = {summary: sessionSummary.value, selections:tasks, draftTask:attributionNewTask.value, draftDestination:attributionTaskDestination.value, draftGroup:attributionNewGroupName.value, draftGroupType:document.querySelector('input[name="attribution-group-type"]:checked').value};
  await mutate(latest => latest?.id === id && latest.phase !== 'saved' ? {...latest, ...draft} : undefined);
}
const attributionForm = document.getElementById('session-attribution-form');
attributionForm.addEventListener('input', persistDraft);
attributionForm.addEventListener('change', persistDraft);
function lockForm(locked) { attributionForm.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = locked; }); }
attributionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingSession || saving) return;
  await persistDraft();
  const id = pendingSession.client_id;
  saving = true; lockForm(true); saveSessionButton.textContent = 'Saving…'; attributionError.textContent = '';
  try {
    await mutate(latest => latest?.id === id ? {...latest, phase:'saving'} : undefined);
    if (!state || state.id !== id || state.phase === 'saved') throw new Error('This ritual changed in another window. Reopen it to continue.');
    await api('/sessions', {method:'POST', body:JSON.stringify(payload(state))});
    await mutate(latest => latest?.id === id ? {...latest, phase:'saved', summary:'', selections:[], draftTask:'', draftGroup:''} : undefined);
    pendingSession = null; attributionOverlay.classList.add('hidden'); syncModal();
    showToast('Focus ritual saved.');
    document.getElementById('start-pomodoro').focus();
    loadDashboard();
  } catch(error) {
    await mutate(latest => latest?.id === id && latest.phase !== 'saved' ? {...latest, phase:'awaiting-attribution'} : undefined);
    attributionError.textContent = `${error.message} Your ritual is saved on this device; retry when ready.`;
  } finally { saving = false; lockForm(false); saveSessionButton.textContent = 'Save ritual'; }
});
async function closeAttribution() {
  if (saving) return;
  await persistDraft(); attributionOverlay.classList.add('hidden'); syncModal();
  document.getElementById('timer-mini-open').focus();
}
document.getElementById('attribution-later').addEventListener('click', closeAttribution);
document.getElementById('discard-session').addEventListener('click', async () => {
  if (saving || !window.confirm('Discard this unsaved ritual and its reflection?')) return;
  const id = pendingSession?.client_id;
  await mutate(latest => latest?.id === id ? null : undefined);
  pendingSession = null; attributionOverlay.classList.add('hidden'); syncModal();
  document.getElementById('start-pomodoro').focus();
});
renderSettings(); renderTimer();
if (pendingSession) openAttributionModal();
return { handleKey(event) {
  const layers = [
    [planCaptureOverlay, planCaptureModal, () => setPlanCaptureOpen(false)],
    [timerSettingsOverlay, timerSettingsModal, () => setTimerSettingsOpen(false)],
    [attributionOverlay, attributionModal, closeAttribution],
    [focusOverlay, focusModal, minimizeTimer],
  ];
  for (const [overlay, modal, close] of layers) {
    if (overlay.classList.contains('hidden')) continue;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else trapFocus(event, modal);
    return true;
  }
  return false;
}};
}
