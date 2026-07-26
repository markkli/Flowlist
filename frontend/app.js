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

async function loadTasks(goalId) {
  const tasks = await api(`/goals/${goalId}/tasks`);
  const list = document.querySelector(`section[data-goal-id="${goalId}"] .task-list`);
  list.innerHTML = "";
  for (const task of tasks) {
    const node = taskTemplate.content.cloneNode(true);
    const checkbox = node.querySelector(".task-completed");
    const title = node.querySelector(".task-title");
    checkbox.checked = task.completed;
    title.textContent = task.title;
    node.querySelector(".task-minutes-label").textContent = `${task.estimated_minutes} min`;
    if (task.completed) title.classList.add("line-through", "text-teal-700/50");

    checkbox.addEventListener("change", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      loadTasks(goalId);
    });

    node.querySelector(".delete-task").addEventListener("click", async () => {
      await api(`/tasks/${task.id}`, { method: "DELETE" });
      loadTasks(goalId);
    });

    node.querySelector(".start-focus").addEventListener("click", () => {
      startFocus(task);
    });

    list.appendChild(node);
  }
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

loadGoals();
