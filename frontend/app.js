const API_BASE = "http://127.0.0.1:8000";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_DEPTH = 3;
const BREAK_SECONDS = 5 * 60;
const celebratedGoals = new Set();
let timerHandle = null;

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function greetingForNow() { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; }
function leafTasks(tasks) { return tasks.filter((task) => !tasks.some((other) => other.parent_id === task.id)).sort((a, b) => a.id - b.id); }
function dateKey(d) { return d.toISOString().slice(0, 10); }
function escapeHtml(value) { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; }

function setDateCopy() {
  const today = new Date();
  document.getElementById("dashboard-greeting").textContent = greetingForNow();
  document.getElementById("top-date").innerHTML = `<strong>${today.toLocaleDateString("en", { weekday: "long" })}</strong> · ${today.toLocaleDateString("en", { month: "long", day: "numeric" })}`;
  document.getElementById("today-date-stamp").textContent = today.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("flowlist-theme", theme);
  document.getElementById("theme-icon").innerHTML = theme === "dark"
    ? '<path d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
}
applyTheme(localStorage.getItem("flowlist-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
document.getElementById("theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

const goalsContainer = document.getElementById("goals");
const goalTemplate = document.getElementById("goal-template");
const taskTemplate = document.getElementById("task-template");
const suggestionTemplate = document.getElementById("suggestion-template");

async function loadGoals() {
  const goals = await api("/goals"); goalsContainer.innerHTML = "";
  for (const goal of goals) {
    const node = goalTemplate.content.cloneNode(true); const section = node.querySelector("article"); section.dataset.goalId = goal.id;
    node.querySelector(".goal-title").textContent = goal.title;
    node.querySelector(".delete-goal").addEventListener("click", async () => { await api(`/goals/${goal.id}`, { method: "DELETE" }); loadGoals(); });
    node.querySelector(".task-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = event.target.querySelector('input[type="text"]'); const minutes = event.target.querySelector(".task-minutes"); if (!input.value.trim()) return; await api(`/goals/${goal.id}/tasks`, { method: "POST", body: JSON.stringify({ title: input.value.trim(), estimated_minutes: Number(minutes.value) || 25 }) }); input.value = ""; loadGoals(); });
    goalsContainer.appendChild(node); loadTasks(goal.id);
  }
}

async function loadTasks(goalId) {
  const tasks = await api(`/goals/${goalId}/tasks`); const section = document.querySelector(`article[data-goal-id="${goalId}"]`); if (!section) return;
  const list = section.querySelector(".task-list"); list.innerHTML = ""; tasks.filter((task) => task.parent_id === null).forEach((task) => renderTask(task, tasks, list));
  const leaves = leafTasks(tasks); section.querySelector(".goal-progress-copy").textContent = leaves.length ? `${leaves.filter((task) => task.completed).length} of ${leaves.length} steps complete` : "Add the first meaningful step.";
  checkGoalComplete(goalId, tasks);
}

function checkGoalComplete(goalId, tasks) { const leaves = leafTasks(tasks); const complete = leaves.length > 0 && leaves.every((task) => task.completed); if (!complete) return celebratedGoals.delete(goalId); if (celebratedGoals.has(goalId)) return; celebratedGoals.add(goalId); const title = document.querySelector(`article[data-goal-id="${goalId}"] .goal-title`)?.textContent; document.getElementById("celebration-goal-title").textContent = title; document.getElementById("celebration-overlay").classList.remove("hidden"); }
document.getElementById("celebration-dismiss").addEventListener("click", () => document.getElementById("celebration-overlay").classList.add("hidden"));

function renderTask(task, allTasks, container) {
  const children = allTasks.filter((item) => item.parent_id === task.id); const isLeaf = children.length === 0; const node = taskTemplate.content.cloneNode(true);
  const checkbox = node.querySelector(".task-completed"), title = node.querySelector(".task-title"), progress = node.querySelector(".task-progress"), minutes = node.querySelector(".task-minutes-label"), focus = node.querySelector(".start-focus"), add = node.querySelector(".add-subtask"), breakdown = node.querySelector(".break-down"), subtaskForm = node.querySelector(".subtask-form"), subtaskList = node.querySelector(".subtask-list"), suggestions = node.querySelector(".suggestion-list");
  title.textContent = task.title;
  if (isLeaf) { checkbox.checked = task.completed; minutes.textContent = `${task.estimated_minutes} min`; if (task.completed) title.style.textDecoration = "line-through"; checkbox.addEventListener("change", async () => { await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: checkbox.checked }) }); loadTasks(task.goal_id); }); focus.addEventListener("click", () => startFocus(task)); }
  else { checkbox.remove(); minutes.remove(); focus.remove(); progress.textContent = `${children.filter((child) => child.completed).length}/${children.length}`; }
  node.querySelector(".delete-task").addEventListener("click", async () => { await api(`/tasks/${task.id}`, { method: "DELETE" }); loadTasks(task.goal_id); });
  if (task.depth >= MAX_DEPTH) { add.remove(); breakdown.remove(); subtaskForm.remove(); } else {
    add.addEventListener("click", () => { subtaskForm.style.display = subtaskForm.style.display === "none" ? "grid" : "none"; });
    subtaskForm.addEventListener("submit", async (event) => { event.preventDefault(); const input = subtaskForm.querySelector('input[type="text"]'); const estimate = subtaskForm.querySelector(".subtask-minutes"); if (!input.value.trim()) return; await api(`/tasks/${task.id}/subtasks`, { method: "POST", body: JSON.stringify({ title: input.value.trim(), estimated_minutes: Number(estimate.value) || 25 }) }); loadTasks(task.goal_id); });
    breakdown.addEventListener("click", async () => { breakdown.textContent = "Thinking…"; breakdown.disabled = true; try { const proposed = await api(`/tasks/${task.id}/breakdown`, { method: "POST" }); suggestions.innerHTML = ""; proposed.forEach((suggestion) => { const item = suggestionTemplate.content.cloneNode(true); item.querySelector(".suggestion-title").textContent = suggestion.title; item.querySelector(".suggestion-minutes").textContent = `${suggestion.estimated_minutes} min`; item.querySelector(".suggestion-add").addEventListener("click", async () => { await api(`/tasks/${task.id}/subtasks`, { method: "POST", body: JSON.stringify(suggestion) }); loadTasks(task.goal_id); }); suggestions.appendChild(item); }); } finally { breakdown.textContent = "Break down"; breakdown.disabled = false; } });
  }
  container.appendChild(node); children.forEach((child) => renderTask(child, allTasks, subtaskList));
}

document.getElementById("goal-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = document.getElementById("goal-title"); if (!input.value.trim()) return; await api("/goals", { method: "POST", body: JSON.stringify({ title: input.value.trim() }) }); input.value = ""; loadGoals(); });

const overlay = document.getElementById("focus-overlay"), focusPhaseLabel = document.getElementById("focus-phase-label"), focusTaskTitle = document.getElementById("focus-task-title"), focusGoalTitle = document.getElementById("focus-goal-title"), focusTime = document.getElementById("focus-time"), focusStop = document.getElementById("focus-stop");
function startFocus(task) { const planned = task.estimated_minutes * 60; let left = planned; focusPhaseLabel.innerHTML = "<i></i>Focus block"; focusTaskTitle.textContent = task.title; focusGoalTitle.textContent = "One task. One protected interval."; focusTime.innerHTML = `${formatTime(left)}<span>Stay with it</span>`; focusStop.textContent = "End session"; overlay.classList.remove("hidden"); const log = (completed) => api(`/tasks/${task.id}/sessions`, { method: "POST", body: JSON.stringify({ actual_minutes: Math.round((planned - left) / 60) || task.estimated_minutes, completed }) }).then(loadDashboard); focusStop.onclick = () => { clearInterval(timerHandle); overlay.classList.add("hidden"); log(false); }; timerHandle = setInterval(() => { left -= 1; focusTime.innerHTML = `${formatTime(Math.max(left, 0))}<span>Stay with it</span>`; if (left <= 0) { clearInterval(timerHandle); log(true); startBreak(); } }, 1000); }
function startBreak() { let left = BREAK_SECONDS; focusPhaseLabel.innerHTML = "<i></i>Rest block"; focusTaskTitle.textContent = "A little room to breathe."; focusGoalTitle.textContent = "Your attention will be ready again soon."; focusTime.innerHTML = `${formatTime(left)}<span>Unhurried pause</span>`; focusStop.textContent = "Skip break"; overlay.classList.remove("hidden"); focusStop.onclick = () => { clearInterval(timerHandle); overlay.classList.add("hidden"); }; timerHandle = setInterval(() => { left -= 1; focusTime.innerHTML = `${formatTime(Math.max(left, 0))}<span>Unhurried pause</span>`; if (left <= 0) { clearInterval(timerHandle); overlay.classList.add("hidden"); } }, 1000); }

async function loadHistory() { const sessions = await api("/sessions"); const history = document.getElementById("history-view"); history.innerHTML = sessions.length ? "" : '<p class="subtitle">No sessions yet. Your first focused block will live here.</p>'; sessions.forEach((session) => { const node = document.getElementById("session-template").content.cloneNode(true); node.querySelector(".session-title").textContent = session.task_title; node.querySelector(".session-meta").textContent = `${session.actual_minutes} of ${session.planned_minutes} minutes · ${new Date(session.created_at).toLocaleString()}`; const status = node.querySelector(".session-status"); status.textContent = session.completed ? "Completed" : "Ended early"; status.classList.add(session.completed ? "pill-success" : "pill-warning"); history.appendChild(node); }); }

function renderAgenda(goalsWithTasks) { const all = goalsWithTasks.flatMap(({ goal, tasks }) => leafTasks(tasks).map((task) => ({ task, goal }))); const list = document.getElementById("today-agenda"); list.innerHTML = ""; const active = all.filter((item) => !item.task.completed); const display = [...active, ...all.filter((item) => item.task.completed)].slice(0, 4); display.forEach(({ task, goal }) => { const row = document.createElement("div"); row.className = `agenda-item${task.completed ? " done" : ""}`; row.innerHTML = `<button class="task-check" aria-label="Mark ${escapeHtml(task.title)} complete"></button><div><span class="agenda-title">${escapeHtml(task.title)}</span><span class="agenda-goal">${escapeHtml(goal.title)}</span></div><span class="agenda-time">${task.estimated_minutes}m</span>`; row.querySelector(".task-check").addEventListener("click", async () => { await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: !task.completed }) }); loadDashboard(); }); list.appendChild(row); }); if (!display.length) list.innerHTML = '<p class="subtitle" style="font-size:13px">Your day is open. Add a next step in the roadmap.</p>'; const done = all.filter((item) => item.task.completed).length; document.getElementById("daily-progress-copy").textContent = all.length ? (done ? "A little momentum is building" : "Choose one thing to begin") : "A clear, open day"; document.getElementById("daily-progress-number").textContent = `${done} / ${all.length}`; document.getElementById("daily-progress-value").style.width = `${all.length ? (done / all.length) * 100 : 0}%`; }
function renderGoalsSummary(goalsWithTasks) { const container = document.getElementById("dashboard-goals"); container.innerHTML = ""; goalsWithTasks.slice(0, 4).forEach(({ goal, tasks }) => { const leaves = leafTasks(tasks), done = leaves.filter((task) => task.completed).length, percent = leaves.length ? (done / leaves.length) * 100 : 0; const row = document.createElement("div"); row.className = "goal-line"; row.innerHTML = `<div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">${leaves.length ? `${leaves.length - done} steps remaining` : "Awaiting a first step"}</div></div><div class="mini-progress"><div class="progress-track"><div class="progress-value" style="width:${percent}%"></div></div><small>${done}/${leaves.length}</small></div>`; container.appendChild(row); }); if (!goalsWithTasks.length) container.innerHTML = '<p class="subtitle" style="font-size:13px">A few future-facing goals will appear here.</p>'; }
function renderActivityHeatmap(sessions) {
  const counts = new Map();
  sessions.forEach((session) => { const key = session.created_at.slice(0, 10); counts.set(key, (counts.get(key) || 0) + 1); });
  const grid = document.getElementById("activity-heatmap"); const months = document.getElementById("heatmap-months"); grid.innerHTML = ""; months.innerHTML = "";
  const today = new Date(); const end = new Date(today); end.setDate(today.getDate() - today.getDay() + 6);
  const start = new Date(end); start.setDate(end.getDate() - 111);
  let previousMonth = -1;
  for (let week = 0; week < 16; week++) {
    const weekStart = new Date(start); weekStart.setDate(start.getDate() + week * 7);
    const label = document.createElement("span");
    label.textContent = week === 0 || weekStart.getMonth() !== previousMonth ? weekStart.toLocaleDateString("en", { month: "short" }) : "";
    months.appendChild(label); previousMonth = weekStart.getMonth();
    for (let day = 0; day < 7; day++) {
      const current = new Date(weekStart); current.setDate(weekStart.getDate() + day); const key = dateKey(current); const count = counts.get(key) || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
      const cell = document.createElement("span"); cell.className = `heatmap-cell level-${level}`; cell.title = `${current.toLocaleDateString("en", { month: "short", day: "numeric" })}: ${count} ${count === 1 ? "session" : "sessions"}`; cell.setAttribute("aria-label", cell.title); grid.appendChild(cell);
    }
  }
}

async function renderMomentum(stats) { const sessions = await api("/sessions"); document.getElementById("stat-streak").textContent = stats.current_streak; document.getElementById("stat-sessions").textContent = stats.total_sessions; document.getElementById("stat-minutes").textContent = stats.total_minutes; document.getElementById("side-session-count").textContent = `${stats.total_sessions} ${stats.total_sessions === 1 ? "session" : "sessions"}`; renderActivityHeatmap(sessions); document.getElementById("rhythm-copy").textContent = stats.current_streak ? `${stats.current_streak} day rhythm. Keep it gentle, keep it real.` : "A focused block is enough to make a mark."; }
function renderWhatsNext(goalsWithTasks) { const goalLabel = document.getElementById("whats-next-goal"), title = document.getElementById("whats-next-title"), action = document.getElementById("whats-next-action"), duration = document.getElementById("focus-duration"), time = document.getElementById("hero-time"); action.innerHTML = ""; for (const { goal, tasks } of goalsWithTasks) { const next = leafTasks(tasks).find((task) => !task.completed); if (!next) continue; goalLabel.textContent = goal.title; title.textContent = next.title; duration.textContent = `${next.estimated_minutes} MIN FOCUS`; time.innerHTML = `${String(next.estimated_minutes).padStart(2, "0")}:00<span>Focus block</span>`; const begin = document.createElement("button"); begin.className = "primary-btn"; begin.textContent = "Begin focus"; begin.addEventListener("click", () => startFocus(next)); const skip = document.createElement("button"); skip.className = "secondary-btn"; skip.textContent = "View roadmap"; skip.addEventListener("click", () => switchView("goals")); action.append(begin, skip); return; } goalLabel.textContent = "The next interval is open"; title.textContent = "Set a worthy direction for today."; duration.textContent = "OPEN DAY"; time.innerHTML = "—<span>Focus block</span>"; const roadmap = document.createElement("button"); roadmap.className = "primary-btn"; roadmap.textContent = "Set a direction"; roadmap.addEventListener("click", () => switchView("goals")); action.appendChild(roadmap); }
async function loadDashboard() { setDateCopy(); const goals = await api("/goals"); const goalsWithTasks = await Promise.all(goals.map(async (goal) => ({ goal, tasks: await api(`/goals/${goal.id}/tasks`) }))); renderWhatsNext(goalsWithTasks); renderAgenda(goalsWithTasks); renderGoalsSummary(goalsWithTasks); renderMomentum(await api("/stats")); }

const views = ["dashboard", "goals", "history"];
function switchView(name) { views.forEach((view) => { document.getElementById(`view-${view}`).classList.toggle("hidden", view !== name); document.getElementById(`nav-${view}`).classList.toggle("active", view === name); }); if (name === "dashboard") loadDashboard(); if (name === "goals") loadGoals(); if (name === "history") loadHistory(); window.scrollTo({ top: 0, behavior: "smooth" }); }
views.forEach((name) => document.getElementById(`nav-${name}`).addEventListener("click", () => switchView(name)));
document.getElementById("open-roadmap").addEventListener("click", () => switchView("goals")); document.getElementById("open-roadmap-2").addEventListener("click", () => switchView("goals"));
switchView("dashboard");
