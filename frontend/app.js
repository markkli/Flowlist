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
const celebratedGoals = new Set();

async function loadTasks(goalId) {
  const tasks = await api(`/goals/${goalId}/tasks`);
  const list = document.querySelector(`section[data-goal-id="${goalId}"] .task-list`);
  list.innerHTML = "";
  const roots = tasks.filter((task) => task.parent_id === null);
  roots.forEach((task) => renderTask(task, tasks, list));
  checkGoalComplete(goalId, tasks);
}

function checkGoalComplete(goalId, tasks) {
  const leaves = tasks.filter(
    (task) => !tasks.some((other) => other.parent_id === task.id)
  );
  const isComplete = leaves.length > 0 && leaves.every((leaf) => leaf.completed);

  if (!isComplete) {
    celebratedGoals.delete(goalId);
    return;
  }
  if (celebratedGoals.has(goalId)) return;

  celebratedGoals.add(goalId);
  const goalTitle = document.querySelector(
    `section[data-goal-id="${goalId}"] .goal-title`
  ).textContent;
  showCelebration(goalTitle);
}

function showCelebration(goalTitle) {
  document.getElementById("celebration-goal-title").textContent = goalTitle;
  document.getElementById("celebration-overlay").classList.remove("hidden");
}

document.getElementById("celebration-dismiss").addEventListener("click", () => {
  document.getElementById("celebration-overlay").classList.add("hidden");
});

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
      title.classList.add("strike");
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
    addButton.addEventListener("click", () => subtaskForm.classList.toggle("show"));
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

const BREAK_SECONDS = 5 * 60;

const overlay = document.getElementById("focus-overlay");
const focusPhaseLabel = document.getElementById("focus-phase-label");
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

  focusPhaseLabel.textContent = "Focus";
  focusTaskTitle.textContent = task.title;
  focusTime.textContent = formatTime(secondsLeft);
  focusStop.textContent = "Stop session";
  overlay.classList.remove("hidden");

  const logSession = (completed) => {
    const actualMinutes = Math.round((plannedSeconds - secondsLeft) / 60) || task.estimated_minutes;
    api(`/tasks/${task.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({ actual_minutes: actualMinutes, completed }),
    }).then(loadStats);
  };

  focusStop.onclick = () => {
    clearInterval(timerHandle);
    overlay.classList.add("hidden");
    logSession(false);
  };

  timerHandle = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      focusTime.textContent = "00:00";
      clearInterval(timerHandle);
      logSession(true);
      startBreak();
      return;
    }
    focusTime.textContent = formatTime(secondsLeft);
  }, 1000);
}

function startBreak() {
  let secondsLeft = BREAK_SECONDS;

  focusPhaseLabel.textContent = "Break";
  focusTaskTitle.textContent = "Step away for a few minutes.";
  focusTime.textContent = formatTime(secondsLeft);
  focusStop.textContent = "Skip break";
  overlay.classList.remove("hidden");

  focusStop.onclick = () => {
    clearInterval(timerHandle);
    overlay.classList.add("hidden");
  };

  timerHandle = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(timerHandle);
      overlay.classList.add("hidden");
      return;
    }
    focusTime.textContent = formatTime(secondsLeft);
  }, 1000);
}

const sessionTemplate = document.getElementById("session-template");
const historyView = document.getElementById("history-view");

async function loadHistory() {
  const sessions = await api("/sessions");
  historyView.innerHTML = "";
  if (!sessions.length) {
    historyView.innerHTML = '<p class="text-muted">No focus sessions logged yet.</p>';
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
      status.classList.add("pill-success");
    } else {
      status.textContent = "Stopped early";
      status.classList.add("pill-warning");
    }
    historyView.appendChild(node);
  }
}

async function loadStats() {
  return api("/stats");
}

// --- Shared "dot-path" renderer: the one visual motif reused everywhere ---
// nodes: array of "filled" | "current" | "" booleans/strings, in order.
// connectors are drawn between consecutive nodes unless a gap is requested via null.
function renderDotPath(container, nodes) {
  container.innerHTML = "";
  nodes.forEach((state, index) => {
    if (state === "gap") {
      const gap = document.createElement("span");
      gap.className = "gap";
      container.appendChild(gap);
      return;
    }
    if (index > 0 && nodes[index - 1] !== "gap") {
      const connector = document.createElement("span");
      connector.className = "connector" + (state === "filled" || state === "current" ? " filled" : "");
      container.appendChild(connector);
    }
    const node = document.createElement("span");
    node.className = "node" + (state ? ` ${state}` : "");
    container.appendChild(node);
  });
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

// --- Dashboard: everything below is real data, no mocks ---

async function loadDashboard() {
  document.getElementById("dashboard-greeting").textContent = greetingForNow();

  const goals = await api("/goals");
  const goalsWithTasks = await Promise.all(
    goals.map(async (goal) => ({ goal, tasks: await api(`/goals/${goal.id}/tasks`) }))
  );

  renderWhatsNext(goalsWithTasks);
  renderActiveGoals(goalsWithTasks);
  const stats = await loadStats();
  await renderMomentum(stats);
}

function renderWhatsNext(goalsWithTasks) {
  const goalLabel = document.getElementById("whats-next-goal");
  const titleLabel = document.getElementById("whats-next-title");
  const stepsRow = document.getElementById("whats-next-steps");
  const actionSlot = document.getElementById("whats-next-action");
  actionSlot.innerHTML = "";
  stepsRow.innerHTML = "";

  for (const { goal, tasks } of goalsWithTasks) {
    const leaves = tasks
      .filter((t) => !tasks.some((o) => o.parent_id === t.id))
      .sort((a, b) => a.id - b.id);
    const nextIndex = leaves.findIndex((t) => !t.completed);
    if (nextIndex === -1) continue;
    const next = leaves[nextIndex];

    goalLabel.textContent = goal.title;
    titleLabel.textContent = next.title;

    const nodes = leaves.map((_, i) =>
      i === nextIndex ? "current" : i < nextIndex ? "filled" : ""
    );
    renderDotPath(stepsRow, nodes);
    const stepsText = document.createElement("span");
    stepsText.className = "next-steps-text";
    stepsText.textContent = `Step ${nextIndex + 1} of ${leaves.length}`;
    stepsRow.appendChild(stepsText);

    const button = document.createElement("button");
    button.className = "btn btn-primary";
    button.textContent = `Focus (${next.estimated_minutes} min)`;
    button.addEventListener("click", () => startFocus(next));
    actionSlot.appendChild(button);
    return;
  }

  goalLabel.textContent = "";
  titleLabel.textContent = "Nothing left to do";
  const empty = document.createElement("p");
  empty.className = "text-muted";
  empty.style.margin = "0";
  empty.textContent = "Add a goal or a task to get started.";
  actionSlot.appendChild(empty);
}

function renderActiveGoals(goalsWithTasks) {
  const container = document.getElementById("dashboard-goals");
  container.innerHTML = "";

  if (!goalsWithTasks.length) {
    const empty = document.createElement("p");
    empty.className = "text-muted";
    empty.textContent = "No goals yet.";
    container.appendChild(empty);
    return;
  }

  for (const { goal, tasks } of goalsWithTasks) {
    const leaves = tasks
      .filter((t) => !tasks.some((o) => o.parent_id === t.id))
      .sort((a, b) => a.id - b.id);
    const done = leaves.filter((l) => l.completed).length;

    const row = document.createElement("div");
    row.className = "goal-row";

    const name = document.createElement("span");
    name.className = "goal-row-name";
    name.textContent = goal.title;

    const right = document.createElement("div");
    right.style.cssText = "display:flex; align-items:center; gap:0.75rem;";
    const path = document.createElement("div");
    path.className = "dot-path";
    renderDotPath(path, leaves.map((l) => (l.completed ? "filled" : "")));
    const count = document.createElement("span");
    count.className = "goal-row-count";
    count.textContent = `${done}/${leaves.length}`;
    right.append(path, count);

    row.append(name, right);
    container.appendChild(row);
  }
}

async function renderMomentum(stats) {
  document.getElementById("streak-value").textContent = stats.current_streak;
  document.getElementById("momentum-totals").textContent =
    `${stats.total_sessions} sessions · ${stats.total_minutes} minutes focused, all time`;

  const sessions = await api("/sessions");
  const daysWithSessions = new Set(sessions.map((s) => s.created_at.slice(0, 10)));

  const today = new Date();
  const dateKey = (d) => d.toISOString().slice(0, 10);

  // Streak beads: last 7 days, today marked as "current" regardless of fill.
  const beadNodes = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const hadSession = daysWithSessions.has(dateKey(day));
    beadNodes.push(i === 0 ? (hadSession ? "current" : "current") : hadSession ? "filled" : "");
  }
  renderDotPath(document.getElementById("streak-beads"), beadNodes);

  // Weekly rhythm: last 8 weeks, each week a cluster of 7 day-dots.
  const rhythmContainer = document.getElementById("rhythm-strip");
  rhythmContainer.innerHTML = "";
  const totalWeeks = 8;
  const totalDays = totalWeeks * 7;
  const startOffset = totalDays - 1;

  for (let week = 0; week < totalWeeks; week++) {
    const weekGroup = document.createElement("div");
    weekGroup.className = "dot-path rhythm-week";
    const nodes = [];
    for (let dayInWeek = 0; dayInWeek < 7; dayInWeek++) {
      const i = startOffset - (week * 7 + dayInWeek);
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      nodes.push(daysWithSessions.has(dateKey(day)) ? "filled" : "");
    }
    renderDotPath(weekGroup, nodes);
    rhythmContainer.appendChild(weekGroup);
    if (week < totalWeeks - 1) {
      const gap = document.createElement("span");
      gap.className = "gap";
      rhythmContainer.appendChild(gap);
    }
  }
}

// --- Calendar: real date grid, illustrative (fake) entries only ---

function renderCalendarPreview() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  document.getElementById("calendar-month-label").textContent = today.toLocaleDateString(
    "en",
    { month: "long", year: "numeric" }
  );

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const exampleDays = new Set([5, 14, 22]);

  for (let i = 0; i < firstWeekday; i++) {
    grid.appendChild(document.createElement("div"));
  }
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    const label = document.createElement("div");
    label.textContent = dayNum;
    cell.appendChild(label);

    if (exampleDays.has(dayNum)) {
      const chip = document.createElement("div");
      chip.className = "calendar-chip";
      chip.textContent = "Example task";
      cell.appendChild(chip);
    }
    grid.appendChild(cell);
  }
}

// --- Nav ---

const views = ["dashboard", "goals", "history", "calendar", "explore"];

function switchView(name) {
  views.forEach((view) => {
    document.getElementById(`view-${view}`).classList.toggle("hidden", view !== name);
    document.getElementById(`nav-${view}`).classList.toggle("active", view === name);
  });
  if (name === "dashboard") loadDashboard();
  if (name === "goals") loadGoals();
  if (name === "history") loadHistory();
  if (name === "calendar") renderCalendarPreview();
}

views.forEach((name) => {
  document.getElementById(`nav-${name}`).addEventListener("click", () => switchView(name));
});

switchView("dashboard");
