import { api, timezoneQuery } from '../../shared/api';
import { escapeHtml } from '../../shared/dom';
import { initQueue } from './queue';
export function initDashboard({ setDateCopy, showToast, openHistory }) {
function localDateKey(date) { return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-'); }

function renderGoalsSummary(goalsWithTasks) {
  const container = document.getElementById("dashboard-goals");
  container.innerHTML = "";
  goalsWithTasks.filter(({ goal }) => goal.goal_type !== "standalone").slice(0, 4).forEach(({ goal, tasks }) => {
    const done = tasks.filter((task) => task.completed).length;
    const percent = tasks.length ? (done / tasks.length) * 100 : 0;
    const row = document.createElement("div");
    row.className = "goal-line";
    const detail = tasks.length ? `${tasks.length - done} steps remaining` : "No steps yet";
    row.innerHTML = `<div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">${detail}</div></div><div class="mini-progress"><div class="progress-track"><div class="progress-value" style="width:${percent}%"></div></div><small>${done}/${tasks.length}</small></div>`;
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
      const cell = document.createElement(current > today ? "span" : "button");
      cell.className = `heatmap-cell level-${level}${current > today ? " future" : ""}`;
      if (current <= today) {
        const date = current.toLocaleDateString("en", { month: "short", day: "numeric" });
        const tooltip = `${date} · ${dayActivity?.minutes || 0} min · ${count} ${count === 1 ? "session" : "sessions"}`;
        cell.dataset.tooltip = tooltip;
        cell.setAttribute("aria-label", tooltip);
        cell.type = 'button'; cell.tabIndex = key===localDateKey(today) ? 0 : -1;
        cell.addEventListener('click', () => openHistory(key));
      } else {
        cell.setAttribute("aria-hidden", "true");
      }
      grid.appendChild(cell);
    }
  }
}

const heatmap = document.getElementById('activity-heatmap');
heatmap.addEventListener('focusin', event => {
  heatmap.querySelectorAll('button').forEach(cell=>cell.tabIndex=cell===event.target ? 0 : -1);
});
heatmap.addEventListener('keydown', event => {
  const moves={ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7};
  if (!(event.key in moves) && !['Home','End'].includes(event.key)) return;
  const cells=[...heatmap.querySelectorAll('button')], index=cells.indexOf(event.target);
  if(index<0)return;
  event.preventDefault();
  const target=event.key==='Home'?0:event.key==='End'?cells.length-1:Math.max(0,Math.min(cells.length-1,index+moves[event.key]));
  cells[target].focus();
});

function renderMomentum(data) {
  const stats = data.stats;
  document.getElementById("stat-streak").textContent = stats.current_streak;
  document.getElementById("stat-sessions").textContent = stats.total_sessions;
  document.getElementById("stat-minutes").textContent = stats.total_minutes;
  document.getElementById("side-session-count").textContent = `${data.week_sessions} ${data.week_sessions === 1 ? "session" : "sessions"}`;
  renderActivityHeatmap(data.activity);
}
async function loadDashboard() {
  setDateCopy();
  const data = await api(`/dashboard?${timezoneQuery()}`);
  queue.setData(data);
  renderGoalsSummary(data.goals);
  renderMomentum(data);
}
const queue = initQueue({ showToast, onChange: loadDashboard });
return { loadDashboard };
}
