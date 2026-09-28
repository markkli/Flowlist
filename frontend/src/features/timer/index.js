import { isNative, nativeCall, nativeState, onNativeState } from '../../shared/native';
import { accountKey, accountLocked } from '../../shared/account';
import { api } from '../../shared/api';
import { escapeHtml, trapFocus, syncDialogs as syncModal } from '../../shared/dom';
import { ritualKey, ritualDraftKey, defaults, validSettings, freshRitual, readRitual, migrateLegacy, advance, remaining, payload } from './state';
import './attribution.css';
import { workRowContent, groupWorkRows } from '../../shared/work-row';
import { initDestinationTree } from './destination-tree';
import { initReminders } from './reminders';

export function initTimer({ showToast, loadGoals, loadDashboard }) {
const native=isNative();
const reminders = initReminders({ showToast });
const formatTime = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
const TIMER_SETTINGS_KEY = accountKey('flowlist-timer-settings');
let timerSettings = {...defaults};
try { const saved = native ? nativeState()?.settings : JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY)); if (validSettings(saved)) timerSettings = saved; } catch {}
let state = native ? nativeState()?.timer || null : migrateLegacy(timerSettings);
let nativeMinimized=true;
let nativeDraftWrites=Promise.resolve();
let nativeCommandBusy=false;
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
  if (accountLocked()) return;
  if(native) throw new Error('Native timers must use the Mac timer controls.');
  const work = () => {
    if (accountLocked()) return;
    const latest = readRitual();
    const next = change(latest);
    if (next === undefined) { state = latest; return; }
    if (next) localStorage.setItem(ritualKey(), JSON.stringify(next));
    else localStorage.removeItem(ritualKey());
    state = next;
  };
  if (navigator.locks) await navigator.locks.request(accountKey('flowlist-ritual'), work); else work();
  renderTimer();
}
function renderSettings() {
  focusMinutesSetting.value = timerSettings.focus;
  breakMinutesSetting.value = timerSettings.break;
  roundsSetting.value = timerSettings.rounds;
  longBreakMinutesSetting.value = timerSettings.longBreak;
  document.getElementById('timer-settings-label').textContent = 'Settings';
  document.getElementById('hero-time').innerHTML = `<span>${timerSettings.focus}</span><span class="time-separator">:</span><span class="time-seconds">00</span>`;
  for(const [id,value] of [['cycle-focus',timerSettings.focus],['cycle-break',timerSettings.break],['cycle-rounds',timerSettings.rounds],['cycle-long-break',timerSettings.longBreak]])document.getElementById(id).textContent=value;
  document.getElementById('start-pomodoro').setAttribute('aria-label', `Start a ${timerSettings.focus}-minute focus ritual`);
}
function setTimerSettingsOpen(open) {
  timerSettingsOverlay.classList.toggle('hidden', !open);
  timerSettingsToggle.setAttribute('aria-expanded', String(open));
  timerSettingsError.textContent = '';
  if (open) { renderSettings(); reminders.render(); }
  syncModal();
  if (open) timerSettingsModal.focus(); else timerSettingsToggle.focus();
}
timerSettingsToggle.addEventListener('click', () => setTimerSettingsOpen(true));
['timer-settings-close','timer-settings-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => setTimerSettingsOpen(false)));
timerSettingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const next = { focus: Number(focusMinutesSetting.value), break: Number(breakMinutesSetting.value), rounds: Number(roundsSetting.value), longBreak: Number(longBreakMinutesSetting.value) };
  if (!validSettings(next)) { timerSettingsError.textContent = 'Use whole minutes within the limits shown, and 2–8 rounds.'; return; }
  try {
    if(native) await nativeCall('timer',{action:'settings',settings:next});
    else localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(next));
    timerSettings = next;
  } catch(error) {timerSettingsError.textContent=error.message;return;}
  renderSettings(); setTimerSettingsOpen(false);
  showToast('Settings saved for your next ritual.');
});
function renderTimer() {
  if (accountLocked()) return;
  const running = state && (['focus','break'].includes(state.phase) || state.nativePhase==='ready');
  const pending = state && ['awaiting-attribution','saving'].includes(state.phase);
  mini.classList.toggle('hidden', !running && !pending);
  focusOverlay.classList.toggle('hidden', !running || (native ? nativeMinimized : state.minimized));
  document.getElementById('timer-mini-end').classList.toggle('hidden', !running);
  if (running) {
    const seconds = native ? Math.ceil(state.remainingSeconds) : remaining(state);
    const label = native && state.nativePhase==='ready' ? 'Ready to focus' : native && state.paused ? 'Paused' : state.phase === 'focus' ? 'Focus' : state.breakKind === 'long' ? 'Long break' : 'Short break';
    document.getElementById('focus-phase-label').textContent = label;
    document.getElementById('focus-task-title').textContent = `Round ${state.round} of ${state.settings.rounds}`;
    document.getElementById('focus-cycle-copy').textContent = `${Math.floor(state.elapsedSeconds/60)} minutes accumulated`;
    document.getElementById('focus-time').innerHTML = formatTime(seconds);
    document.getElementById('focus-orbit').style.setProperty('--timer-progress', String(seconds / state.blockSeconds));
    document.getElementById('focus-skip-label').textContent = state.phase === 'focus' ? 'Skip to break' : 'Skip to focus';
    if(native) {
      document.getElementById('focus-native-primary').textContent=state.nativePhase==='ready'?'Start focus':state.paused?'Resume':'Pause';
      document.getElementById('focus-skip').disabled=state.nativePhase==='ready' || nativeCommandBusy;
      document.getElementById('focus-native-primary').disabled=nativeCommandBusy;
    }
    document.getElementById('timer-mini-copy').textContent = `${label} · ${formatTime(seconds)} · Round ${state.round}`;
  } else if (pending) document.getElementById('timer-mini-copy').textContent = 'Unsaved ritual · Review and save';
  syncModal();
}
async function openTimer() {
  reminders.prepareAudio();
  state = native ? nativeState()?.timer ?? null : readRitual();
  if (state && ['awaiting-attribution','saving'].includes(state.phase)) { pendingSession = payload(state); await openAttributionModal(); return; }
  lastFocus = document.activeElement;
  if(native) {
    nativeMinimized=false;
    if(!state || state.phase==='saved'){if(!await nativeCommand('start'))return;}
    else renderTimer();
  } else await mutate(latest => latest && latest.phase !== 'saved' ? {...latest, minimized: false} : freshRitual(timerSettings));
  reminders.offerNotifications();
  focusModal.focus();
}
async function minimizeTimer() {
  if(native){nativeMinimized=true;renderTimer();}
  else await mutate(latest => latest ? {...latest, minimized: true} : undefined);
  (lastFocus?.isConnected ? lastFocus : document.getElementById('start-pomodoro')).focus();
}
async function transition(end = false, expectedDeadline = null) {
  if(native) { await nativeCommand(end?'finish':'skip');return; }
  let completedInterval = null;
  await mutate(latest => {
    if (!latest || !['focus','break'].includes(latest.phase) || (expectedDeadline !== null && latest.deadline !== expectedDeadline)) return undefined;
    const next = advance(latest, Date.now(), end);
    if (!end && expectedDeadline !== null) completedInterval = [latest, next];
    return next;
  });
  if (completedInterval) reminders.notify(...completedInterval);
  if (state?.phase === 'awaiting-attribution') { pendingSession = payload(state); await openAttributionModal(); }
}
document.getElementById('start-pomodoro').addEventListener('click', openTimer);
document.getElementById('timer-mini-open').addEventListener('click', openTimer);
document.getElementById('focus-minimize').addEventListener('click', minimizeTimer);
document.getElementById('focus-exit').addEventListener('click', () => transition(true));
document.getElementById('timer-mini-end').addEventListener('click', () => transition(true));
document.getElementById('focus-skip').addEventListener('click', () => transition());
if(native) {
  const control=document.createElement('button');control.id='focus-native-primary';control.type='button';control.className='primary-btn native-focus-control';control.textContent='Pause';
  control.onclick=()=>nativeCommand(state?.nativePhase==='ready'?'start':state?.paused?'resume':'pause');
  document.getElementById('focus-skip').parentElement.before(control);
}
let ticking = false;
if(!native) setInterval(async () => {
  if (accountLocked()) return;
  renderTimer();
  if (ticking || !state || !['focus','break'].includes(state.phase) || remaining(state) > 0) return;
  ticking = true;
  try { await transition(false, state.deadline); } finally { ticking = false; }
}, 1000);
window.addEventListener('storage', event => {
  if (native || accountLocked() || event.key !== ritualKey()) return;
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
const planCaptureError = document.getElementById('plan-capture-error');
const planCaptureSubmit=planCaptureForm.querySelector('button[type="submit"]');
const destinationTree=initDestinationTree(document.getElementById('plan-capture-tree'));
let captureGeneration=0,captureSaving=false;

async function setPlanCaptureOpen(open) {
  if(captureSaving)return;
  planCaptureOverlay.classList.toggle("hidden", !open);
  focusOverlay.setAttribute("aria-hidden", String(open));
  planCaptureError.textContent = "";
  if (open) {
    document.body.classList.add("modal-open");
    focusOverlay.inert = true;
    const request=++captureGeneration;planCaptureSubmit.disabled=true;
    await destinationTree.load();
    if(request!==captureGeneration)return;
    planCaptureSubmit.disabled=false;
    requestAnimationFrame(() => planCaptureName.focus());
  } else {
    captureGeneration++;destinationTree.cancel();
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
  if(planCaptureSubmit.disabled||captureSaving)return;
  const title = planCaptureName.value.trim();
  if (!title) {
    planCaptureError.textContent = "Give this item a name.";
    planCaptureName.focus();
    return;
  }
  const destination=destinationTree.getSelection();
  if(destination.kind==='new'&&!destination.projectTitle){planCaptureError.textContent='Give the new project a name.';return;}
  const submit = planCaptureSubmit;
  captureSaving=true;destinationTree.setDisabled(true);
  planCaptureForm.querySelectorAll("input,select,button").forEach(control=>control.disabled=true);
  submit.textContent = "Adding…";
  try {
    if (destination.kind === "standalone") {
      await api("/standalone-tasks", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    } else if(destination.kind==='new') {
      await api('/goals/with-task',{method:'POST',body:JSON.stringify({title:destination.projectTitle,task:{title}})});
    } else {
      const endpoint=destination.kind==='subtask'?`/tasks/${destination.parentId}/subtasks`:`/goals/${destination.goalId}/tasks`;
      await api(endpoint,{method:'POST',body:JSON.stringify({title})});
    }
    captureSaving=false;
    setPlanCaptureOpen(false);
    await loadGoals();
    showToast("Task added to your plan.");
  } catch (error) {
    planCaptureError.textContent = "Flowlist could not add this item. Try again.";
  } finally {
    captureSaving=false;destinationTree.setDisabled(false);
    planCaptureForm.querySelectorAll("input,select,button").forEach(control=>control.disabled=false);
    submit.textContent = "Add task";
  }
});

const attributionOverlay = document.getElementById("session-attribution-overlay");
const attributionModal = attributionOverlay.querySelector(".attribution-modal");
const attributionOptions = document.getElementById("attribution-options");
const attributionError = document.getElementById("attribution-error");
const saveSessionButton = document.getElementById("save-session");
const sessionSummary = document.getElementById("session-summary");
let attributionTasks = new Map();
let attributionChildren = new Map();
const hierarchyNote = document.createElement('p');
hierarchyNote.id = 'attribution-hierarchy-note';
hierarchyNote.className = 'sr-only hidden';
hierarchyNote.textContent = 'Finishing a parent includes its subtasks. Finishing subtasks keeps the parent open.';
attributionOptions.before(hierarchyNote);
const selectionStatus = document.createElement('p');
selectionStatus.className = 'sr-only';
selectionStatus.setAttribute('role', 'status');
attributionOptions.after(selectionStatus);

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

function descendantTaskIds(taskId, visited = new Set()) {
  visited.add(taskId);
  const descendants = [];
  for (const child of attributionChildren.get(taskId) || []) {
    if (visited.has(child.id)) continue;
    descendants.push(child.id, ...descendantTaskIds(child.id, visited));
  }
  return descendants;
}

function clearAncestorFinished(taskId, selections) {
  const visited = new Set([taskId]);
  let parentId = attributionTasks.get(taskId)?.parent_id;
  while (parentId != null && !visited.has(parentId)) {
    visited.add(parentId);
    const selected = selections.get(parentId);
    if (selected) selections.set(parentId, {...selected, finished: false});
    parentId = attributionTasks.get(parentId)?.parent_id;
  }
}

function applyAttributionSelections(selections) {
  attributionOptions.querySelectorAll('.attribution-task-row').forEach(row => {
    const selected = selections.get(Number(row.dataset.taskId)) || {worked: false, finished: false};
    row.querySelector('.attribution-worked-input').checked = selected.worked || selected.finished;
    row.querySelector('.attribution-finished-input').checked = selected.finished;
    row.classList.toggle('selected', selected.worked || selected.finished);
    row.classList.toggle('finished', selected.finished);
  });
}

function renderAttributionOptions(options, selections = new Map()) {
  attributionOptions.innerHTML = '';
  selectionStatus.textContent = '';
  attributionTasks = new Map(options.map(option => [option.id, option]));
  attributionChildren = new Map();
  const groups = new Map();
  for (const option of options) {
    const groupKey = option.goal_id ?? option.goal_title;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(option);
    if (option.parent_id != null && attributionTasks.get(option.parent_id)?.goal_id === option.goal_id) {
      if (!attributionChildren.has(option.parent_id)) attributionChildren.set(option.parent_id, []);
      attributionChildren.get(option.parent_id).push(option);
    }
  }
  // A restored parent selection still includes any available descendants.
  const restoredSelections = new Map(selections);
  for (const [taskId, selected] of selections) {
    if (!selected.finished) continue;
    restoredSelections.set(taskId, {worked: true, finished: true});
    for (const childId of descendantTaskIds(taskId)) restoredSelections.set(childId, {worked: true, finished: true});
  }
  let groupIndex = 0;
  for (const group of groups.values()) {
    const first = group[0];
    const section = document.createElement('section');
    const headingId = `attribution-group-${groupIndex++}`;
    section.className = 'attribution-group';
    section.setAttribute('aria-labelledby', headingId);
    const kind = first.goal_type === 'standalone' ? 'Task list' : 'Project';
    section.innerHTML = `<header class="attribution-group-heading"><h3 id="${headingId}">${escapeHtml(first.goal_title)}</h3><span>${kind}</span></header><div class="attribution-group-tasks"></div>`;
    const list = section.querySelector('.attribution-group-tasks');
    const visited = new Set();
    const appendTask = option => {
      if (visited.has(option.id)) return;
      visited.add(option.id);
      const row = document.createElement('div');
      const parent = attributionTasks.get(option.parent_id);
      const children = attributionChildren.get(option.id) || [];
      const contextId = `attribution-context-${option.id}`;
      const context = parent ? `Subtask of ${parent.title}` : children.length ? `${children.length} ${children.length === 1 ? 'subtask' : 'subtasks'}` : '';
      row.className = `attribution-task-row${parent || option.parent_id != null ? ' is-subtask' : ''}`;
      row.dataset.taskId = option.id;
      if (option.parent_id != null) row.dataset.parentId = option.parent_id;
      const description = ['attribution-choice-help', headingId, context ? contextId : '', children.length ? hierarchyNote.id : ''].filter(Boolean).join(' ');
      row.innerHTML = workRowContent({title:option.title,context,contextId,describedBy:description});
      list.appendChild(row);
      children.forEach(appendTask);
    };
    group.filter(option => !attributionTasks.has(option.parent_id)).forEach(appendTask);
    // Retain every option even if an old draft refers to a missing parent.
    group.forEach(appendTask);
    groupWorkRows(list);
    attributionOptions.appendChild(section);
  }
  hierarchyNote.classList.toggle('hidden', attributionChildren.size === 0);
  applyAttributionSelections(restoredSelections);
  attributionOverlay.querySelector(".attribution-general-note").hidden = !options.length;
  attributionOverlay.querySelector(".attribution-summary").hidden = !options.length;
  if (!options.length) {
    attributionOptions.innerHTML = '<p class="attribution-empty"><strong>No tasks to update.</strong> Your time and note will be saved as General focus.</p>';
  }
}

async function openAttributionModal() {
  if (!pendingSession) return;
  optionsReady = false;
  document.getElementById("attribution-status").textContent = "Session complete";
  document.getElementById("attribution-minutes").textContent = state.elapsedSeconds < 60 ? `${Math.floor(state.elapsedSeconds)} ${Math.floor(state.elapsedSeconds) === 1 ? "second" : "seconds"}` : `${Math.floor(state.elapsedSeconds / 60)} min of focus`;
  saveSessionButton.textContent = "Save session";
  saveSessionButton.disabled = true;
  attributionError.textContent = "";
  // Keep any text typed into the retired task builder as a note in an old draft.
  sessionSummary.value = [state.summary, state.draftTask ? `Unadded task: ${state.draftTask}${state.draftGroup ? ` (${state.draftGroup})` : ''}` : ''].filter(Boolean).join('\n\n');
  attributionOptions.innerHTML = '<div class="attribution-loading"><span class="loading-ring" aria-hidden="true"></span><span>Finding your tasks…</span></div>';
  attributionOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  attributionModal.focus();
  syncModal();
  try {
    const options = await api("/focus-options");
    if (!pendingSession) return;
    optionsReady = true;
    const selected = new Map(state.selections.map(item => [item.task_id, {worked:true, finished:item.completed}]));
    renderAttributionOptions(options, selected);
    const missing = state.selections.filter(item => !options.some(option => option.id === item.task_id));
    if (missing.length) attributionError.textContent = 'Some selected tasks are no longer available. Review the selection before saving.';
    if (!missing.length) await persistDraft();
  } catch (error) {
    if (!pendingSession) return;
    renderAttributionOptions([]);
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
  const taskId = Number(row.dataset.taskId);
  const selections = currentAttributionSelections();
  selectionStatus.textContent = '';
  if (event.target === finished && finished.checked) {
    const descendants = descendantTaskIds(taskId);
    for (const id of [taskId, ...descendants]) selections.set(id, {worked: true, finished: true});
    if (descendants.length) selectionStatus.textContent = `${descendants.length} ${descendants.length === 1 ? 'subtask also marked' : 'subtasks also marked'} finished.`;
  } else if ((event.target === finished && !finished.checked) || (event.target === worked && !worked.checked)) {
    selections.set(taskId, {worked: worked.checked, finished: false});
    clearAncestorFinished(taskId, selections);
  }
  applyAttributionSelections(selections);
  persistDraft();
});


async function persistDraft(force=false) {
  if (!pendingSession || (saving && !force)) return;
  const id = pendingSession.client_id;
  const tasks = !optionsReady ? (state?.selections || []) : [...currentAttributionSelections()].filter(([,value]) => value.worked).map(([task_id,value]) => ({task_id, completed:value.finished}));
  const draft = {summary: sessionSummary.value, selections:tasks, draftTask:'', draftDestination:'__tasks__', draftGroup:'', draftGroupType:'project'};
  if (accountLocked()) return;
  if(native) {
    // Serialize snapshots so an older keystroke cannot overwrite a later draft.
    const write=nativeDraftWrites.catch(()=>{}).then(()=>nativeCall('timer',{action:'draft',id,summary:draft.summary,selections:draft.selections}));
    nativeDraftWrites=write;
    const updated=await write;
    if(state?.id===id && updated?.id===id)state=updated;
    return;
  }
  localStorage.setItem(ritualDraftKey(), JSON.stringify({ritualId:id, ...draft}));
  await mutate(latest => latest?.id === id && latest.phase !== 'saved' ? {...latest, ...draft} : undefined);
}
const attributionForm = document.getElementById('session-attribution-form');
const persistFormDraft = event => {
  if (!attributionOptions.contains(event.target)) persistDraft();
};
attributionForm.addEventListener('input', persistFormDraft);
attributionForm.addEventListener('change', persistFormDraft);
function lockForm(locked) { attributionForm.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = locked; }); }
attributionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingSession || saving) return;
  const id = pendingSession.client_id;
  saving = true; lockForm(true); saveSessionButton.textContent = 'Saving…'; attributionError.textContent = '';
  try {
    await persistDraft(true);
    if(!native) await mutate(latest => latest?.id === id ? {...latest, phase:'saving'} : undefined);
    if (!state || state.id !== id || state.phase === 'saved') throw new Error('This ritual changed in another window. Reopen it to continue.');
    await api('/sessions', {method:'POST', body:JSON.stringify(payload(state))});
    if(native) {state=null;renderTimer();}
    else await mutate(latest => latest?.id === id ? {...latest, phase:'saved', summary:'', selections:[], draftTask:'', draftGroup:''} : undefined);
    pendingSession = null; attributionOverlay.classList.add('hidden'); syncModal();
    showToast('Session saved.');
    document.getElementById('start-pomodoro').focus();
    loadDashboard();
  } catch(error) {
    if(!native) await mutate(latest => latest?.id === id && latest.phase !== 'saved' ? {...latest, phase:'awaiting-attribution'} : undefined);
    attributionError.textContent = `${error.message} Your ritual is saved on this device; retry when ready.`;
  } finally { saving = false; lockForm(false); saveSessionButton.textContent = 'Save session'; }
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
  if(native) {if(!await nativeCommand('discard'))return;}
  else await mutate(latest => latest?.id === id ? null : undefined);
  pendingSession = null; attributionOverlay.classList.add('hidden'); syncModal();
  document.getElementById('start-pomodoro').focus();
});
async function nativeCommand(action) {
  if(nativeCommandBusy) return false;
  nativeCommandBusy=true;
  try { applyNativeTimer(await nativeCall('timer',{action,id:state?.id}));return true; }
  catch(error) {showToast(error.message,true);return false;}
  finally {nativeCommandBusy=false;renderTimer();}
}
function applyNativeTimer(next) {
  const before=state;
  state=next;
  const reviewing=state && ['awaiting-attribution','saving'].includes(state.phase);
  if(reviewing) {
    pendingSession=payload(state);
    if(!saving && (!before || before.id!==state.id || !['awaiting-attribution','saving'].includes(before.phase))) openAttributionModal();
  } else if(!state) {
    pendingSession=null;attributionOverlay.classList.add('hidden');
  }
  renderTimer();
}
if(native)window.addEventListener('flowlist:native-open-timer',openTimer);
if(native) onNativeState(snapshot=>{
  if(validSettings(snapshot.settings) && JSON.stringify(snapshot.settings)!==JSON.stringify(timerSettings)) {
    timerSettings=snapshot.settings;
    // A menu-bar settings change updates the card, without overwriting an open settings draft.
    if(timerSettingsOverlay.classList.contains('hidden'))renderSettings();
  }
  applyNativeTimer(snapshot.timer);
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
