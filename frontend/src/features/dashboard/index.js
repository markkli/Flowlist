import { api, timezoneQuery } from '../../shared/api';
import { escapeHtml } from '../../shared/dom';
export function initDashboard({ setDateCopy, showToast }) {
function leafTasks(tasks) {
  const parents = new Set(tasks.map(task => task.parent_id));
  const ordered = [];
  function visit(parentId) {
    tasks.filter(task => task.parent_id === parentId).sort((a,b) => a.position - b.position || a.id - b.id).forEach(task => { if (!parents.has(task.id)) ordered.push(task); else visit(task.id); });
  }
  visit(null); return ordered;
}
function localDateKey(date) { return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-'); }
function renderAgenda(goalsWithTasks) {
  const all = goalsWithTasks
    .flatMap(({ goal, tasks }) => leafTasks(tasks).map((task) => ({ task, goal })))
    .filter(({ task }) => !task.completed);
  const list = document.getElementById("today-agenda");
  list.innerHTML = "";
  all.forEach(({ task, goal }) => {
    const row = document.createElement("div");
    row.className = `agenda-item${task.completed ? " done" : ""}`;
    const context = goal.goal_type === "standalone" ? "Task" : goal.title;
    row.innerHTML = `<button class="task-check" aria-label="${task.completed ? "Reopen" : "Complete"} ${escapeHtml(task.title)}" aria-pressed="${task.completed}"></button><div class="agenda-copy"><span class="agenda-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span><span class="agenda-goal" title="${escapeHtml(context)}">${escapeHtml(context)}</span></div>`;
    row.querySelector(".task-check").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      await loadDashboard();
      showToast("Task completed.", false, {label:"Undo", run:async () => {
        await api(`/tasks/${task.id}`, {method:"PATCH",body:JSON.stringify({completed:false})});
        await loadDashboard();
      }});
      } catch(error) { button.disabled = false; showToast(error.message,true); }
    });
    list.appendChild(row);
  });
  if (!all.length) {
    list.innerHTML = '<p class="page-description">Nothing queued. Add a step from Plan.</p>';
  }
  const total = goalsWithTasks.flatMap(({ tasks }) => leafTasks(tasks));
  const done = total.filter(task => task.completed).length;
  document.getElementById("daily-progress-copy").textContent = all.length
    ? `${all.length} remaining`
    : "No tasks planned";
  document.getElementById("daily-progress-number").textContent = `${done} finished`;
  document.getElementById("daily-progress-value").style.width = `${total.length ? (done / total.length) * 100 : 0}%`;
}

function renderGoalsSummary(goalsWithTasks) {
  const container = document.getElementById("dashboard-goals");
  container.innerHTML = "";
  goalsWithTasks.filter(({ goal }) => goal.goal_type !== "standalone").slice(0, 4).forEach(({ goal, tasks }) => {
    const leaves = leafTasks(tasks);
    const done = leaves.filter((task) => task.completed).length;
    const percent = leaves.length ? (done / leaves.length) * 100 : 0;
    const row = document.createElement("div");
    row.className = "goal-line";
    const isTaskList = goal.goal_type === "standalone";
    const goalName = isTaskList ? "Tasks" : goal.title;
    const detail = leaves.length
      ? `${leaves.length - done} ${isTaskList ? "tasks" : "steps"} remaining`
      : isTaskList ? "No tasks yet" : "No steps yet";
    row.innerHTML = `<div><div class="goal-name">${escapeHtml(goalName)}</div><div class="goal-detail">${detail}</div></div><div class="mini-progress"><div class="progress-track"><div class="progress-value" style="width:${percent}%"></div></div><small>${done}/${leaves.length}</small></div>`;
    container.appendChild(row);
  });
  if (!goalsWithTasks.some(({goal}) => goal.goal_type !== "standalone")) {
    container.innerHTML = '<p class="page-description">No active goals.</p>';
  }
}

function renderActivityHeatmap(days) {
  const activity = new Map(days.map(day => [day.date, day]));
  const grid = document.getElementById("activity-heatmap");
  const months = document.getElementById("heatmap-months");
  grid.innerHTML = "";
  months.innerHTML = "";
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 15 * 7);
  let previousMonth = -1;
  for (let week = 0; week < 16; week += 1) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week * 7);
    const label = document.createElement("span");
    label.textContent = week === 0 || weekStart.getMonth() !== previousMonth
      ? weekStart.toLocaleDateString("en", { month: "short" })
      : "";
    months.appendChild(label);
    previousMonth = weekStart.getMonth();
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(weekStart);
      current.setDate(weekStart.getDate() + day);
      const key = localDateKey(current);
      const dayActivity = current > today ? null : activity.get(key);
      const count = dayActivity?.sessions || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
      const cell = document.createElement("span");
      cell.className = `heatmap-cell level-${level}${current > today ? " future" : ""}`;
      if (dayActivity) {
        const date = current.toLocaleDateString("en", { month: "short", day: "numeric" });
        const tooltip = `${date} · ${dayActivity.minutes} min · ${count} ${count === 1 ? "ritual" : "rituals"}`;
        cell.dataset.tooltip = tooltip;
        cell.setAttribute("aria-label", tooltip);
        cell.tabIndex = 0;
      } else {
        cell.setAttribute("aria-hidden", "true");
      }
      grid.appendChild(cell);
    }
  }
}

function renderMomentum(data) {
  const stats = data.stats;
  document.getElementById("stat-streak").textContent = stats.current_streak;
  document.getElementById("stat-sessions").textContent = stats.total_sessions;
  document.getElementById("stat-minutes").textContent = stats.total_minutes;
  document.getElementById("side-session-count").textContent = `${data.week_sessions} ${data.week_sessions === 1 ? "session" : "sessions"}`;
  renderActivityHeatmap(data.activity);
  document.getElementById("rhythm-copy").textContent = stats.current_streak ? `${stats.current_streak}-day focus streak` : "Log at least one focused minute to begin a streak.";
}
async function loadDashboard() {
  setDateCopy();
  const data = await api(`/dashboard?${timezoneQuery()}`);
  renderAgenda(data.goals);
  renderGoalsSummary(data.goals);
  renderMomentum(data);
}
return { loadDashboard };
}
