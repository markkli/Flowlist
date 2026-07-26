const API_BASE = "http://127.0.0.1:8000";

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

const goalsContainer = document.getElementById("goals");
const goalTemplate = document.getElementById("goal-template");
const taskTemplate = document.getElementById("task-template");
const suggestionTemplate = document.getElementById("suggestion-template");

async function loadGoals() {
  const goals = await api("/goals");
  goalsContainer.innerHTML = "";
  for (const goal of goals) {
    const node = goalTemplate.content.cloneNode(true);
    const section = node.querySelector("section");
    section.dataset.goalId = goal.id;
    node.querySelector(".goal-title").textContent = goal.title;

    node.querySelector(".delete-goal").addEventListener("click", async () => {
      await api(`/goals/${goal.id}`, { method: "DELETE" });
      loadGoals();
    });

    node.querySelector(".task-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.target.querySelector('input[type="text"]');
      const minutesInput = event.target.querySelector(".task-minutes");
      if (!input.value.trim()) return;
      await api(`/goals/${goal.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: input.value.trim(),
          estimated_minutes: Number(minutesInput.value) || 25,
        }),
      });
      input.value = "";
      loadGoals();
    });

    goalsContainer.appendChild(node);
    loadTasks(goal.id);
  }
}

const MAX_DEPTH = 3;

async function loadTasks(goalId) {
  const tasks = await api(`/goals/${goalId}/tasks`);
  const list = document.querySelector(`section[data-goal-id="${goalId}"] .task-list`);
  list.innerHTML = "";
  const roots = tasks.filter((task) => task.parent_id === null);
  roots.forEach((task) => renderTask(task, tasks, list));
}

function renderTask(task, allTasks, container) {
  const children = allTasks.filter((t) => t.parent_id === task.id);
  const isLeaf = children.length === 0;

  const node = taskTemplate.content.cloneNode(true);
  const checkbox = node.querySelector(".task-completed");
  const title = node.querySelector(".task-title");
  const progress = node.querySelector(".task-progress");
  const minutesLabel = node.querySelector(".task-minutes-label");
  const focusButton = node.querySelector(".start-focus");
  const addButton = node.querySelector(".add-subtask");
  const breakDownButton = node.querySelector(".break-down");
  const subtaskForm = node.querySelector(".subtask-form");
  const subtaskList = node.querySelector(".subtask-list");
  const suggestionList = node.querySelector(".suggestion-list");

  title.textContent = task.title;

  if (isLeaf) {
    progress.remove();
    checkbox.checked = task.completed;
    minutesLabel.textContent = `${task.estimated_minutes} min`;
    if (task.completed) {
      title.classList.add("line-through", "text-teal-700/50");
      focusButton.remove();
    } else {
      focusButton.addEventListener("click", () => startFocus(task));
    }
    checkbox.addEventListener("change", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      loadTasks(task.goal_id);
    });
  } else {
    checkbox.remove();
    minutesLabel.remove();
    focusButton.remove();
    const done = children.filter((child) => child.completed).length;
    progress.textContent = `${done}/${children.length} done`;
  }

  node.querySelector(".delete-task").addEventListener("click", async () => {
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    loadTasks(task.goal_id);
  });

  if (task.depth >= MAX_DEPTH) {
    addButton.remove();
    subtaskForm.remove();
    breakDownButton.remove();
  } else {
    addButton.addEventListener("click", () => subtaskForm.classList.toggle("hidden"));
    subtaskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = subtaskForm.querySelector('input[type="text"]');
      const minutesInput = subtaskForm.querySelector(".subtask-minutes");
      if (!input.value.trim()) return;
      await api(`/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({
          title: input.value.trim(),
          estimated_minutes: Number(minutesInput.value) || 25,
        }),
      });
      loadTasks(task.goal_id);
    });

    breakDownButton.addEventListener("click", async () => {
      breakDownButton.textContent = "Thinking...";
      breakDownButton.disabled = true;
      const suggestions = await api(`/tasks/${task.id}/breakdown`, { method: "POST" });
      suggestionList.innerHTML = "";
      for (const suggestion of suggestions) {
        const suggestionNode = suggestionTemplate.content.cloneNode(true);
        suggestionNode.querySelector(".suggestion-title").textContent = suggestion.title;
        suggestionNode.querySelector(".suggestion-minutes").textContent =
          `${suggestion.estimated_minutes} min`;
        suggestionNode.querySelector(".suggestion-add").addEventListener("click", async () => {
          await api(`/tasks/${task.id}/subtasks`, {
            method: "POST",
            body: JSON.stringify({
              title: suggestion.title,
              estimated_minutes: suggestion.estimated_minutes,
            }),
          });
          loadTasks(task.goal_id);
        });
        suggestionList.appendChild(suggestionNode);
      }
      breakDownButton.textContent = "Break down";
      breakDownButton.disabled = false;
    });
  }

  container.appendChild(node);
  children.forEach((child) => renderTask(child, allTasks, subtaskList));
}

document.getElementById("goal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("goal-title");
  if (!input.value.trim()) return;
  await api("/goals", {
    method: "POST",
    body: JSON.stringify({ title: input.value.trim() }),
  });
  input.value = "";
  loadGoals();
});

const overlay = document.getElementById("focus-overlay");
const focusTaskTitle = document.getElementById("focus-task-title");
const focusTime = document.getElementById("focus-time");
const focusStop = document.getElementById("focus-stop");

let timerHandle = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startFocus(task) {
  const plannedSeconds = task.estimated_minutes * 60;
  let secondsLeft = plannedSeconds;

  focusTaskTitle.textContent = task.title;
  focusTime.textContent = formatTime(secondsLeft);
  overlay.classList.remove("hidden");

  const finish = async (completed) => {
    clearInterval(timerHandle);
    overlay.classList.add("hidden");
    const actualMinutes = Math.round((plannedSeconds - secondsLeft) / 60) || task.estimated_minutes;
    await api(`/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ actual_minutes: actualMinutes, completed }),
    });
    loadStats();
  };

  focusStop.onclick = () => finish(false);

  timerHandle = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      focusTime.textContent = "00:00";
      finish(true);
      return;
    }
    focusTime.textContent = formatTime(secondsLeft);
  }, 1000);
}

const goalsView = document.getElementById("goals-view");
const historyView = document.getElementById("history-view");
const navGoals = document.getElementById("nav-goals");
const navHistory = document.getElementById("nav-history");
const sessionTemplate = document.getElementById("session-template");

const activeTabClasses = ["bg-teal-600", "text-white"];
const inactiveTabClasses = ["bg-white", "text-teal-700", "border", "border-teal-200"];

function setActiveTab(activeButton, inactiveButton) {
  activeButton.classList.remove(...inactiveTabClasses);
  activeButton.classList.add(...activeTabClasses);
  inactiveButton.classList.remove(...activeTabClasses);
  inactiveButton.classList.add(...inactiveTabClasses);
}

navGoals.addEventListener("click", () => {
  goalsView.classList.remove("hidden");
  historyView.classList.add("hidden");
  setActiveTab(navGoals, navHistory);
});

navHistory.addEventListener("click", () => {
  goalsView.classList.add("hidden");
  historyView.classList.remove("hidden");
  setActiveTab(navHistory, navGoals);
  loadHistory();
});

async function loadHistory() {
  const sessions = await api("/sessions");
  historyView.innerHTML = "";
  if (!sessions.length) {
    historyView.innerHTML = '<p class="text-sm text-teal-700/60">No focus sessions logged yet.</p>';
    return;
  }
  for (const session of sessions) {
    const node = sessionTemplate.content.cloneNode(true);
    node.querySelector(".session-title").textContent = session.task_title;
    const when = new Date(session.created_at).toLocaleString();
    node.querySelector(".session-meta").textContent =
      `${session.actual_minutes}/${session.planned_minutes} min · ${when}`;
    const status = node.querySelector(".session-status");
    if (session.completed) {
      status.textContent = "Completed";
      status.classList.add("bg-teal-50", "text-teal-700");
    } else {
      status.textContent = "Stopped early";
      status.classList.add("bg-orange-50", "text-orange-700");
    }
    historyView.appendChild(node);
  }
}

async function loadStats() {
  const stats = await api("/stats");
  document.getElementById("stat-streak").textContent = stats.current_streak;
  document.getElementById("stat-sessions").textContent = stats.total_sessions;
  document.getElementById("stat-minutes").textContent = stats.total_minutes;
}

loadGoals();
loadStats();
