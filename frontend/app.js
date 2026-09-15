const API_BASE = "http://127.0.0.1:8000";
const MAX_DEPTH = 3;
const ACTIVE_TIMER_KEY = "flowlist-active-focus";
const TIMER_SETTINGS_KEY = "flowlist-timer-settings";
const CYCLE_STATE_KEY = "flowlist-pomodoro-cycle";
const DEFAULT_TIMER_SETTINGS = { focus: 25, break: 5, rounds: 4, longBreak: 15 };

const celebratedGoals = new Set();
let timerHandle = null;
let toastTimer = null;
let activeTimer = null;
let pendingSession = null;
let learningWizardState = null;

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const error = new Error(`${options.method || "GET"} ${path} failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function greetingForNow() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

function leafTasks(tasks) {
  return tasks
    .filter((task) => !tasks.some((other) => other.parent_id === task.id))
    .sort((a, b) => a.id - b.id);
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseApiDate(value) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function showToast(message, isError = false) {
  const toast = document.getElementById("app-toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function trapFocus(event, container) {
  if (event.key !== "Tab") return;
  const focusable = [...container.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setDateCopy() {
  const today = new Date();
  document.getElementById("dashboard-greeting").textContent = greetingForNow();
  document.getElementById("top-date").innerHTML = `<strong>${today.toLocaleDateString("en", { weekday: "long" })}</strong> · ${today.toLocaleDateString("en", { month: "long", day: "numeric" })}`;
  document.getElementById("today-date-stamp").textContent = today.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("flowlist-theme", theme);
  document.getElementById("theme-icon").innerHTML = theme === "dark"
    ? '<path d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
}

applyTheme(
  localStorage.getItem("flowlist-theme")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
document.getElementById("theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

const goalsContainer = document.getElementById("goals");
const goalTemplate = document.getElementById("goal-template");
const taskTemplate = document.getElementById("task-template");

const timerSettingsToggle = document.getElementById("timer-settings-toggle");
const timerSettingsOverlay = document.getElementById("timer-settings-overlay");
const timerSettingsModal = timerSettingsOverlay.querySelector(".settings-modal");
const timerSettingsForm = document.getElementById("timer-settings-form");
const focusMinutesSetting = document.getElementById("focus-minutes-setting");
const breakMinutesSetting = document.getElementById("break-minutes-setting");
const roundsSetting = document.getElementById("rounds-setting");
const longBreakMinutesSetting = document.getElementById("long-break-minutes-setting");
const timerSettingsError = document.getElementById("timer-settings-error");
const heroTime = document.getElementById("hero-time");

function loadTimerSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY));
    const focus = Number(saved?.focus);
    const rest = Number(saved?.break);
    const rounds = Number(saved?.rounds ?? DEFAULT_TIMER_SETTINGS.rounds);
    const longBreak = Number(saved?.longBreak ?? DEFAULT_TIMER_SETTINGS.longBreak);
    if (
      focus >= 5 && focus <= 120
      && rest >= 1 && rest <= 60
      && rounds >= 2 && rounds <= 8
      && longBreak >= 5 && longBreak <= 90
    ) {
      return { focus, break: rest, rounds, longBreak };
    }
  } catch (error) {
    localStorage.removeItem(TIMER_SETTINGS_KEY);
  }
  return { ...DEFAULT_TIMER_SETTINGS };
}

let timerSettings = loadTimerSettings();

function loadCycleState() {
  try {
    const saved = JSON.parse(localStorage.getItem(CYCLE_STATE_KEY));
    const completedRounds = Number(saved?.completedRounds);
    if (Number.isInteger(completedRounds) && completedRounds >= 0) {
      return { completedRounds: Math.min(completedRounds, timerSettings.rounds - 1) };
    }
  } catch (error) {
    localStorage.removeItem(CYCLE_STATE_KEY);
  }
  return { completedRounds: 0 };
}

let cycleState = loadCycleState();

function saveCycleState() {
  localStorage.setItem(CYCLE_STATE_KEY, JSON.stringify(cycleState));
}

function renderCycleState() {
  const currentRound = Math.min(cycleState.completedRounds + 1, timerSettings.rounds);
  document.getElementById("pomodoro-round-copy").textContent = `Round ${currentRound} of ${timerSettings.rounds}`;
  document.getElementById("pomodoro-cycle-dots").innerHTML = Array.from(
    { length: timerSettings.rounds },
    (_, index) => `<i class="${index < cycleState.completedRounds ? "complete" : index === currentRound - 1 ? "current" : ""}"></i>`
  ).join("");
}

function renderTimerSettings() {
  focusMinutesSetting.value = timerSettings.focus;
  breakMinutesSetting.value = timerSettings.break;
  roundsSetting.value = timerSettings.rounds;
  longBreakMinutesSetting.value = timerSettings.longBreak;
  document.getElementById("timer-settings-label").textContent = `${timerSettings.focus} / ${timerSettings.break} · ${timerSettings.rounds} rounds`;
  document.getElementById("timer-summary").textContent = `${timerSettings.focus} focus · ${timerSettings.break} short break · ${timerSettings.longBreak} long break`;
  document.getElementById("long-break-copy").textContent = `Long break after round ${timerSettings.rounds}`;
  heroTime.innerHTML = `${String(timerSettings.focus).padStart(2, "0")}:00<span>Start focus</span>`;
  document.getElementById("pomodoro-heading").textContent = `Protect the next ${timerSettings.focus} minutes.`;
  document.getElementById("start-pomodoro").setAttribute(
    "aria-label",
    `Start round ${cycleState.completedRounds + 1} of ${timerSettings.rounds}, ${timerSettings.focus} minutes`
  );
  renderCycleState();
}

function setTimerSettingsOpen(open) {
  timerSettingsOverlay.classList.toggle("hidden", !open);
  timerSettingsToggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("modal-open", open);
  timerSettingsError.textContent = "";
  if (open) {
    renderTimerSettings();
    requestAnimationFrame(() => timerSettingsModal.focus());
  } else {
    timerSettingsToggle.focus();
  }
}

timerSettingsToggle.addEventListener("click", () => setTimerSettingsOpen(true));
document.getElementById("timer-settings-close").addEventListener("click", () => setTimerSettingsOpen(false));
document.getElementById("timer-settings-cancel").addEventListener("click", () => {
  setTimerSettingsOpen(false);
});
timerSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const focus = Number(focusMinutesSetting.value);
  const rest = Number(breakMinutesSetting.value);
  const rounds = Number(roundsSetting.value);
  const longBreak = Number(longBreakMinutesSetting.value);
  if (
    focus < 5 || focus > 120
    || rest < 1 || rest > 60
    || rounds < 2 || rounds > 8
    || longBreak < 5 || longBreak > 90
  ) {
    timerSettingsError.textContent = "Use 5–120 focus minutes, 1–60 short-break minutes, 2–8 rounds, and a 5–90 minute long break.";
    return;
  }
  timerSettings = { focus, break: rest, rounds, longBreak };
  if (cycleState.completedRounds >= rounds) cycleState.completedRounds = 0;
  localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(timerSettings));
  saveCycleState();
  renderTimerSettings();
  setTimerSettingsOpen(false);
  showToast("Pomodoro settings saved.");
});
renderTimerSettings();

const learningOverlay = document.getElementById("learning-path-overlay");
const learningWizard = learningOverlay.querySelector(".learning-wizard");
const learningLoading = document.getElementById("learning-wizard-loading");
const learningQuestion = document.getElementById("learning-wizard-question");
const learningGoalName = document.getElementById("learning-goal-name");
const learningQuestionCount = document.getElementById("learning-question-count");
const learningProgressPercent = document.getElementById("learning-progress-percent");
const learningProgressFill = document.getElementById("learning-progress-fill");
const learningWizardTitle = document.getElementById("learning-wizard-title");
const learningAnswer = document.getElementById("learning-wizard-answer");
const learningWizardError = document.getElementById("learning-wizard-error");
const learningWizardBack = document.getElementById("learning-wizard-back");
const learningWizardNext = document.getElementById("learning-wizard-next");
const learningWizardClose = document.getElementById("learning-wizard-close");

function renderLearningSuggestions(goal, proposed, goalSuggestions) {
  goalSuggestions.innerHTML = proposed.length
    ? '<li class="suggestion-toolbar"><span>Select the milestones that belong in this roadmap.</span><button class="secondary-btn suggestion-add-selected" type="button">Add selected</button></li>'
    : "";
  goalSuggestions.style.display = proposed.length ? "grid" : "none";
  proposed.forEach((suggestion, index) => {
    const item = document.createElement("li");
    item.className = "task-row suggestion-row";
    item.innerHTML = `<input type="checkbox" class="suggestion-select" data-index="${index}" aria-label="Select ${escapeHtml(suggestion.title)}"><span class="task-title">${escapeHtml(suggestion.title)}</span>`;
    goalSuggestions.appendChild(item);
  });
  goalSuggestions.querySelector(".suggestion-add-selected")?.addEventListener("click", async () => {
    const selected = [...goalSuggestions.querySelectorAll(".suggestion-select:checked")]
      .map((input) => proposed[Number(input.dataset.index)]);
    if (!selected.length) {
      showToast("Select at least one milestone first.", true);
      return;
    }
    const addButton = goalSuggestions.querySelector(".suggestion-add-selected");
    addButton.disabled = true;
    try {
      await Promise.all(selected.map((suggestion) => api(`/goals/${goal.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: suggestion.title }),
      })));
      goalSuggestions.style.display = "none";
      loadTasks(goal.id);
      showToast(`${selected.length} milestone${selected.length === 1 ? "" : "s"} added to the roadmap.`);
    } catch (error) {
      addButton.disabled = false;
      showToast("Could not add the selected milestones. Try again.", true);
    }
  });
}

function closeLearningWizard() {
  const previousTrigger = learningWizardState?.trigger;
  learningWizardState = null;
  learningOverlay.classList.add("hidden");
  learningOverlay.removeAttribute("aria-busy");
  document.body.classList.remove("modal-open");
  if (previousTrigger?.isConnected) {
    previousTrigger.disabled = false;
    previousTrigger.focus();
  }
}

function renderLearningQuestion() {
  if (!learningWizardState) return;
  const { questions, answers, index } = learningWizardState;
  const question = questions[index];
  const percent = Math.round(((index + 1) / questions.length) * 100);
  learningLoading.hidden = true;
  learningQuestion.hidden = false;
  learningOverlay.removeAttribute("aria-busy");
  learningQuestionCount.textContent = `Question ${index + 1} of ${questions.length}`;
  learningProgressPercent.textContent = `${percent}%`;
  learningProgressFill.style.transform = `scaleX(${percent / 100})`;
  learningWizardTitle.textContent = question.question;
  learningAnswer.value = answers[index] || "";
  learningAnswer.removeAttribute("aria-invalid");
  learningWizardError.textContent = "";
  learningWizardBack.disabled = index === 0;
  learningWizardNext.disabled = false;
  learningWizardNext.textContent = index === questions.length - 1 ? "Generate path" : "Continue";
  requestAnimationFrame(() => learningAnswer.focus());
}

async function openLearningWizard(goal, trigger, goalSuggestions) {
  const state = { goal, trigger, goalSuggestions, questions: [], answers: [], index: 0 };
  learningWizardState = state;
  trigger.disabled = true;
  learningGoalName.textContent = goal.title;
  learningLoading.hidden = false;
  learningQuestion.hidden = true;
  learningOverlay.classList.remove("hidden");
  learningOverlay.setAttribute("aria-busy", "true");
  document.body.classList.add("modal-open");
  learningWizard.focus();
  try {
    const questions = await api(`/goals/${goal.id}/breakdown/questions`, { method: "POST" });
    if (learningWizardState !== state) return;
    if (!questions.length) throw new Error("No clarification questions returned");
    state.questions = questions;
    state.answers = Array(questions.length).fill("");
    renderLearningQuestion();
  } catch (error) {
    if (learningWizardState !== state) return;
    closeLearningWizard();
    showToast(
      error.status === 503
        ? "AI breakdown needs an OPENAI_API_KEY."
        : "Could not prepare the questions. Try again.",
      true
    );
  }
}

learningWizardNext.addEventListener("click", async () => {
  if (!learningWizardState) return;
  const state = learningWizardState;
  const answer = learningAnswer.value.trim();
  if (!answer) {
    learningWizardError.textContent = "Add an answer before continuing.";
    learningAnswer.setAttribute("aria-invalid", "true");
    learningAnswer.focus();
    return;
  }
  state.answers[state.index] = answer;
  if (state.index < state.questions.length - 1) {
    state.index += 1;
    renderLearningQuestion();
    return;
  }
  learningWizardNext.disabled = true;
  learningWizardNext.textContent = "Generating…";
  learningOverlay.setAttribute("aria-busy", "true");
  try {
    const answers = state.questions.map((question, index) => ({
      id: question.id,
      answer: state.answers[index],
    }));
    const proposed = await api(`/goals/${state.goal.id}/breakdown`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
    if (learningWizardState !== state) return;
    renderLearningSuggestions(state.goal, proposed, state.goalSuggestions);
    closeLearningWizard();
    showToast("Learning path ready. Choose the milestones you want to keep.");
  } catch (error) {
    if (learningWizardState !== state) return;
    learningOverlay.removeAttribute("aria-busy");
    learningWizardError.textContent = error.status === 503
      ? "The AI service is not configured."
      : "Flowlist could not generate the path. Check your connection and try again.";
    learningWizardNext.disabled = false;
    learningWizardNext.textContent = "Try again";
  }
});

learningWizardBack.addEventListener("click", () => {
  if (!learningWizardState || learningWizardState.index === 0) return;
  learningWizardState.answers[learningWizardState.index] = learningAnswer.value.trim();
  learningWizardState.index -= 1;
  renderLearningQuestion();
});
learningAnswer.addEventListener("input", () => {
  learningWizardError.textContent = "";
  learningAnswer.removeAttribute("aria-invalid");
});
learningWizardClose.addEventListener("click", closeLearningWizard);
learningOverlay.addEventListener("click", (event) => {
  if (event.target === learningOverlay) closeLearningWizard();
});

function renderTaskSuggestions(task, proposed, suggestions) {
  suggestions.innerHTML = proposed.length
    ? '<li class="suggestion-toolbar"><span>Select all the steps you want to add.</span><button class="secondary-btn suggestion-add-selected" type="button">Add selected</button></li>'
    : "";
  proposed.forEach((suggestion, index) => {
    const item = document.createElement("li");
    item.className = "task-row suggestion-row";
    item.innerHTML = `<input type="checkbox" class="suggestion-select" data-index="${index}" aria-label="Select ${escapeHtml(suggestion.title)}"><span class="task-title">${escapeHtml(suggestion.title)}</span>`;
    suggestions.appendChild(item);
  });
  suggestions.querySelector(".suggestion-add-selected")?.addEventListener("click", async () => {
    const selected = [...suggestions.querySelectorAll(".suggestion-select:checked")]
      .map((input) => proposed[Number(input.dataset.index)]);
    if (!selected.length) {
      showToast("Select at least one step first.", true);
      return;
    }
    const addButton = suggestions.querySelector(".suggestion-add-selected");
    addButton.disabled = true;
    try {
      await Promise.all(selected.map((suggestion) => api(`/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: suggestion.title }),
      })));
      loadTasks(task.goal_id);
      showToast(`${selected.length} step${selected.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      addButton.disabled = false;
      showToast("Could not add the selected steps. Try again.", true);
    }
  });
}

async function loadGoals() {
  const goals = await api("/goals");
  goalsContainer.innerHTML = "";
  for (const goal of goals) {
    const node = goalTemplate.content.cloneNode(true);
    const section = node.querySelector("article");
    section.dataset.goalId = goal.id;
    section.dataset.goalType = goal.goal_type || "project";
    node.querySelector(".goal-type-label").textContent = goal.goal_type === "learning"
      ? "Learning objective"
      : "Project";
    node.querySelector(".goal-title").textContent = goal.title;
    node.querySelector(".goal-description").textContent = goal.description || "";

    const goalBreakdown = node.querySelector(".break-down-goal");
    const goalSuggestions = node.querySelector(".goal-suggestion-list");
    if (goal.goal_type !== "learning") goalBreakdown.remove();
    else {
      goalBreakdown.addEventListener("click", () => {
        openLearningWizard(goal, goalBreakdown, goalSuggestions);
      });
    }

    const goalEdit = node.querySelector(".goal-edit-form");
    const goalMenu = node.querySelector(".goal-menu");
    goalEdit.querySelector(".goal-edit-title").value = goal.title;
    goalEdit.querySelector(".goal-edit-description").value = goal.description || "";
    goalEdit.querySelector(".goal-edit-type").value = goal.goal_type || "project";
    node.querySelector(".edit-goal").addEventListener("click", () => {
      goalMenu.removeAttribute("open");
      goalEdit.style.display = goalEdit.style.display === "none" ? "grid" : "none";
    });
    goalEdit.querySelector(".goal-edit-cancel").addEventListener("click", () => {
      goalEdit.style.display = "none";
    });
    goalEdit.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = goalEdit.querySelector(".goal-edit-title").value.trim();
      if (!title) return;
      try {
        await api(`/goals/${goal.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            description: goalEdit.querySelector(".goal-edit-description").value.trim() || null,
            goal_type: goalEdit.querySelector(".goal-edit-type").value,
          }),
        });
        loadGoals();
        showToast("Goal updated");
      } catch (error) {
        showToast("Could not update this goal.", true);
      }
    });
    node.querySelector(".delete-goal").addEventListener("click", async () => {
      await api(`/goals/${goal.id}`, { method: "DELETE" });
      loadGoals();
    });
    node.querySelector(".task-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.target.querySelector('input[type="text"]');
      if (!input.value.trim()) return;
      await api(`/goals/${goal.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim() }),
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
  const section = document.querySelector(`article[data-goal-id="${goalId}"]`);
  if (!section) return;
  const list = section.querySelector(".goal-task-list");
  list.innerHTML = "";
  tasks
    .filter((task) => task.parent_id === null)
    .sort((a, b) => a.id - b.id)
    .forEach((task) => renderTask(task, tasks, list));
  const leaves = leafTasks(tasks);
  const completed = leaves.filter((task) => task.completed).length;
  section.querySelector(".goal-progress-copy").textContent = leaves.length
    ? `${completed} of ${leaves.length} steps complete`
    : "No steps yet";
  section.querySelector(".goal-progress-value").style.width = `${leaves.length ? (completed / leaves.length) * 100 : 0}%`;
  checkGoalComplete(goalId, tasks);
}

function checkGoalComplete(goalId, tasks) {
  const leaves = leafTasks(tasks);
  const complete = leaves.length > 0 && leaves.every((task) => task.completed);
  if (!complete) return celebratedGoals.delete(goalId);
  if (celebratedGoals.has(goalId)) return;
  celebratedGoals.add(goalId);
  const title = document.querySelector(`article[data-goal-id="${goalId}"] .goal-title`)?.textContent;
  document.getElementById("celebration-goal-title").textContent = title;
  document.getElementById("celebration-overlay").classList.remove("hidden");
}

document.getElementById("celebration-dismiss").addEventListener("click", () => {
  document.getElementById("celebration-overlay").classList.add("hidden");
});

function renderTask(task, allTasks, container) {
  const children = allTasks
    .filter((item) => item.parent_id === task.id)
    .sort((a, b) => a.id - b.id);
  const isLeaf = children.length === 0;
  const node = taskTemplate.content.cloneNode(true);
  const taskNode = node.querySelector(".task-node");
  const taskRow = node.querySelector(".task-row");
  const checkbox = node.querySelector(".task-completed");
  const title = node.querySelector(".task-title");
  const progress = node.querySelector(".task-progress");
  const edit = node.querySelector(".edit-task");
  const editForm = node.querySelector(".task-edit-form");
  const add = node.querySelector(".add-subtask");
  const breakdown = node.querySelector(".break-down");
  const menu = node.querySelector(".task-menu");
  const subtaskForm = node.querySelector(".subtask-form");
  const subtaskList = node.querySelector(".subtask-list");
  const suggestions = node.querySelector(".suggestion-list");

  taskNode.dataset.depth = task.depth;
  taskRow.classList.add(isLeaf ? "leaf-task-row" : "parent-task-row");
  title.textContent = task.title;
  editForm.querySelector(".task-edit-title").value = task.title;
  edit.addEventListener("click", () => {
    menu.removeAttribute("open");
    editForm.style.display = editForm.style.display === "none" ? "grid" : "none";
  });
  editForm.querySelector(".task-edit-cancel").addEventListener("click", () => {
    editForm.style.display = "none";
  });
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editedTitle = editForm.querySelector(".task-edit-title").value.trim();
    if (!editedTitle) return;
    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: editedTitle }),
      });
      loadTasks(task.goal_id);
      showToast("Task updated");
    } catch (error) {
      showToast("Could not update this task.", true);
    }
  });

  if (isLeaf) {
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `${task.completed ? "Reopen" : "Complete"} ${task.title}`);
    taskRow.classList.toggle("task-is-complete", task.completed);
    checkbox.addEventListener("change", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      loadTasks(task.goal_id);
    });
  } else {
    checkbox.remove();
    const branchMarker = document.createElement("span");
    branchMarker.className = "task-branch-marker";
    branchMarker.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12m0-6h8m-3-3 3 3-3 3"/></svg>';
    taskRow.insertBefore(branchMarker, title);
    progress.textContent = `${children.filter((child) => child.completed).length}/${children.length} complete`;
  }

  node.querySelector(".delete-task").addEventListener("click", async () => {
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    loadTasks(task.goal_id);
  });

  if (task.depth >= MAX_DEPTH) {
    add.remove();
    breakdown.remove();
    subtaskForm.remove();
  } else {
    add.addEventListener("click", () => {
      menu.removeAttribute("open");
      subtaskForm.style.display = subtaskForm.style.display === "none" ? "grid" : "none";
    });
    subtaskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = subtaskForm.querySelector('input[type="text"]');
      if (!input.value.trim()) return;
      await api(`/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim() }),
      });
      loadTasks(task.goal_id);
    });
    breakdown.addEventListener("click", async () => {
      menu.removeAttribute("open");
      breakdown.textContent = "Generating…";
      breakdown.disabled = true;
      try {
        const proposed = await api(`/tasks/${task.id}/breakdown`, { method: "POST" });
        renderTaskSuggestions(task, proposed, suggestions);
      } catch (error) {
        showToast(
          error.status === 503
            ? "AI breakdown needs an OPENAI_API_KEY."
            : "Could not generate steps.",
          true
        );
      } finally {
        breakdown.textContent = "Generate steps";
        breakdown.disabled = false;
      }
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
    body: JSON.stringify({
      title: input.value.trim(),
      goal_type: document.getElementById("goal-type").value,
    }),
  });
  input.value = "";
  loadGoals();
});

const focusOverlay = document.getElementById("focus-overlay");
const focusPhaseLabel = document.getElementById("focus-phase-label");
const focusTaskTitle = document.getElementById("focus-task-title");
const focusGoalTitle = document.getElementById("focus-goal-title");
const focusCycleCopy = document.getElementById("focus-cycle-copy");
const focusTime = document.getElementById("focus-time");
const focusOrbit = document.getElementById("focus-orbit");
const focusStop = document.getElementById("focus-stop");

function setOrbitProgress(orbit, remainingSeconds, plannedSeconds) {
  const progress = plannedSeconds ? Math.max(0, Math.min(1, remainingSeconds / plannedSeconds)) : 0;
  orbit.style.setProperty("--timer-progress", progress);
}

function saveActiveTimer(timer) {
  localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(timer));
}

function clearActiveTimer() {
  localStorage.removeItem(ACTIVE_TIMER_KEY);
}

function closeTimerOverlay() {
  clearInterval(timerHandle);
  timerHandle = null;
  activeTimer = null;
  clearActiveTimer();
  focusOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function startFocus(restored = null) {
  clearInterval(timerHandle);
  const plannedMinutes = restored?.planned_minutes || timerSettings.focus;
  const plannedSeconds = restored?.planned_seconds || plannedMinutes * 60;
  const deadline = restored?.deadline || Date.now() + plannedSeconds * 1000;
  const roundNumber = restored?.round_number || cycleState.completedRounds + 1;
  const roundGoal = restored?.round_goal || timerSettings.rounds;
  activeTimer = {
    phase: "focus",
    planned_minutes: plannedMinutes,
    planned_seconds: plannedSeconds,
    round_number: roundNumber,
    round_goal: roundGoal,
    deadline,
    remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  };
  saveActiveTimer(activeTimer);
  focusPhaseLabel.innerHTML = "<i></i>Focus";
  focusTaskTitle.textContent = `Round ${roundNumber} of ${roundGoal}`;
  focusGoalTitle.textContent = "Stay with the work. You can name it afterward.";
  focusCycleCopy.textContent = `${plannedMinutes} minute interval`;
  focusStop.textContent = "End session";
  focusOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  focusStop.onclick = () => finishFocusSession(false);

  const tick = () => {
    if (!activeTimer || activeTimer.phase !== "focus") return;
    activeTimer.remaining_seconds = Math.max(0, Math.ceil((activeTimer.deadline - Date.now()) / 1000));
    focusTime.innerHTML = `${formatTime(activeTimer.remaining_seconds)}<span>Remaining</span>`;
    setOrbitProgress(focusOrbit, activeTimer.remaining_seconds, activeTimer.planned_seconds);
    if (activeTimer.remaining_seconds <= 0) finishFocusSession(true);
  };
  tick();
  if (activeTimer?.phase === "focus") timerHandle = setInterval(tick, 1000);
}

function startBreak(kind = "short", restored = null) {
  clearInterval(timerHandle);
  const breakKind = restored?.break_kind || kind;
  const plannedMinutes = restored?.planned_minutes
    || (breakKind === "long" ? timerSettings.longBreak : timerSettings.break);
  const plannedSeconds = restored?.planned_seconds || plannedMinutes * 60;
  const deadline = restored?.deadline || Date.now() + plannedSeconds * 1000;
  activeTimer = {
    phase: "break",
    break_kind: breakKind,
    planned_minutes: plannedMinutes,
    planned_seconds: plannedSeconds,
    deadline,
    remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  };
  saveActiveTimer(activeTimer);
  const isLong = breakKind === "long";
  focusPhaseLabel.innerHTML = `<i></i>${isLong ? "Long break" : "Short break"}`;
  focusTaskTitle.textContent = isLong ? "The cycle is complete." : "Step away for a moment.";
  focusGoalTitle.textContent = isLong
    ? "Take the longer reset before beginning a new cycle."
    : "Stand up, look away, and let your attention reset.";
  focusCycleCopy.textContent = `${plannedMinutes} minute break`;
  focusStop.textContent = "Skip break";
  focusOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  focusStop.onclick = closeTimerOverlay;

  const tick = () => {
    if (!activeTimer || activeTimer.phase !== "break") return;
    activeTimer.remaining_seconds = Math.max(0, Math.ceil((activeTimer.deadline - Date.now()) / 1000));
    focusTime.innerHTML = `${formatTime(activeTimer.remaining_seconds)}<span>Remaining</span>`;
    setOrbitProgress(focusOrbit, activeTimer.remaining_seconds, activeTimer.planned_seconds);
    if (activeTimer.remaining_seconds <= 0) closeTimerOverlay();
  };
  tick();
  if (activeTimer?.phase === "break") timerHandle = setInterval(tick, 1000);
}

function finishFocusSession(completed) {
  if (!activeTimer || activeTimer.phase !== "focus") return;
  clearInterval(timerHandle);
  timerHandle = null;
  const finishedTimer = activeTimer;
  const elapsedSeconds = finishedTimer.planned_seconds - finishedTimer.remaining_seconds;
  const actualMinutes = completed
    ? finishedTimer.planned_minutes
    : Math.max(0, Math.min(finishedTimer.planned_minutes, Math.ceil(elapsedSeconds / 60)));
  const nextBreak = completed
    ? (finishedTimer.round_number >= finishedTimer.round_goal ? "long" : "short")
    : null;
  if (completed) {
    cycleState.completedRounds = nextBreak === "long" ? 0 : finishedTimer.round_number;
    saveCycleState();
    renderTimerSettings();
  }
  pendingSession = {
    planned_minutes: finishedTimer.planned_minutes,
    actual_minutes: actualMinutes,
    completed,
    next_break: nextBreak,
  };
  activeTimer = null;
  clearActiveTimer();
  focusOverlay.classList.add("hidden");
  openAttributionModal();
}

document.getElementById("start-pomodoro").addEventListener("click", () => startFocus());

function restoreSavedTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_TIMER_KEY));
    if (!saved?.phase || !saved?.deadline) return;
    if (saved.phase === "focus") startFocus(saved);
    else if (saved.phase === "break") startBreak(saved.break_kind || "short", saved);
  } catch (error) {
    clearActiveTimer();
  }
}

const attributionOverlay = document.getElementById("session-attribution-overlay");
const attributionModal = attributionOverlay.querySelector(".attribution-modal");
const attributionOptions = document.getElementById("attribution-options");
const attributionError = document.getElementById("attribution-error");
const saveSessionButton = document.getElementById("save-session");

function renderAttributionOptions(options) {
  attributionOptions.innerHTML = "";
  options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "attribution-task-row";
    row.dataset.taskId = option.id;
    row.innerHTML = `<div class="attribution-task-copy"><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(option.goal_title)}</small>${index === 0 ? `<em>${option.last_focused_at ? "Recent" : "Next"}</em>` : ""}</div><label class="attribution-toggle attribution-worked"><input class="attribution-worked-input" type="checkbox"><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span class="sr-only">Worked on ${escapeHtml(option.title)}</span></label><label class="attribution-toggle attribution-finished"><input class="attribution-finished-input" type="checkbox"><span class="toggle-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg></span><span class="sr-only">Finished ${escapeHtml(option.title)}</span></label>`;
    attributionOptions.appendChild(row);
  });
  if (!options.length) {
    attributionOptions.innerHTML = '<p class="attribution-empty">No unfinished tasks are available. This session will be saved as General focus.</p>';
  }
}

async function openAttributionModal() {
  if (!pendingSession) return;
  document.getElementById("attribution-status").textContent = pendingSession.completed
    ? "Focus complete"
    : "Session ended";
  document.getElementById("attribution-minutes").textContent = `${pendingSession.actual_minutes} ${pendingSession.actual_minutes === 1 ? "minute" : "minutes"}`;
  saveSessionButton.textContent = pendingSession.completed ? "Save & start break" : "Save session";
  saveSessionButton.disabled = true;
  attributionError.textContent = "";
  attributionOptions.innerHTML = '<div class="attribution-loading"><span class="loading-ring" aria-hidden="true"></span><span>Finding your tasks…</span></div>';
  attributionOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  attributionModal.focus();
  try {
    const options = await api("/focus-options");
    if (!pendingSession) return;
    renderAttributionOptions(options);
  } catch (error) {
    if (!pendingSession) return;
    renderAttributionOptions([]);
    attributionError.textContent = "Task suggestions are unavailable. You can still save this as general focus.";
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
});

document.getElementById("session-attribution-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingSession) return;
  const session = pendingSession;
  const tasks = [...attributionOptions.querySelectorAll(".attribution-task-row")]
    .filter((row) => row.querySelector(".attribution-worked-input").checked)
    .map((row) => ({
      task_id: Number(row.dataset.taskId),
      completed: row.querySelector(".attribution-finished-input").checked,
    }));
  saveSessionButton.disabled = true;
  saveSessionButton.textContent = "Saving…";
  attributionError.textContent = "";
  try {
    await api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        planned_minutes: session.planned_minutes,
        actual_minutes: session.actual_minutes,
        completed: session.completed,
        tasks,
      }),
    });
    pendingSession = null;
    attributionOverlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
    loadDashboard();
    showToast("Focus session saved.");
    if (session.next_break) startBreak(session.next_break);
  } catch (error) {
    saveSessionButton.disabled = false;
    saveSessionButton.textContent = session.completed ? "Save & start break" : "Save session";
    attributionError.textContent = "Flowlist could not save this session. Try again.";
  }
});

document.getElementById("discard-session").addEventListener("click", () => {
  const nextBreak = pendingSession?.next_break;
  pendingSession = null;
  attributionOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (nextBreak) startBreak(nextBreak);
});

async function loadHistory() {
  const sessions = await api("/sessions");
  const history = document.getElementById("history-view");
  history.innerHTML = sessions.length ? "" : '<p class="page-description">No focus sessions recorded yet.</p>';
  sessions.forEach((session) => {
    const node = document.getElementById("session-template").content.cloneNode(true);
    node.querySelector(".session-title").textContent = session.task_title;
    const attributionSummary = node.querySelector(".session-attributions");
    if (session.attributions.length) {
      session.attributions.forEach((item) => {
        const label = document.createElement("span");
        label.textContent = `${item.completed ? "Finished" : "Worked on"}: ${item.task_title}`;
        attributionSummary.appendChild(label);
      });
    } else {
      const label = document.createElement("span");
      label.textContent = "General focus";
      attributionSummary.appendChild(label);
    }
    const status = node.querySelector(".session-status");
    status.textContent = session.completed ? "Completed" : "Ended early";
    status.classList.add(session.completed ? "pill-success" : "pill-warning");
    const deleteButton = node.querySelector(".session-delete");
    const sessionDate = parseApiDate(session.created_at);
    node.querySelector(".session-meta").textContent = `${session.actual_minutes} of ${session.planned_minutes} minutes · ${sessionDate.toLocaleString()}`;
    deleteButton.setAttribute("aria-label", `Delete focus record from ${sessionDate.toLocaleDateString()}`);
    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        await api(`/sessions/${session.id}`, { method: "DELETE" });
        await loadHistory();
        await renderMomentum(await api("/stats"));
        showToast("Focus record deleted.");
      } catch (error) {
        deleteButton.disabled = false;
        showToast("Could not delete this focus record.", true);
      }
    });
    history.appendChild(node);
  });
}

function renderAgenda(goalsWithTasks) {
  const all = goalsWithTasks
    .flatMap(({ goal, tasks }) => leafTasks(tasks).map((task) => ({ task, goal })))
    .sort((a, b) => (a.task.completed - b.task.completed) || (a.task.id - b.task.id));
  const list = document.getElementById("today-agenda");
  list.innerHTML = "";
  all.forEach(({ task, goal }) => {
    const row = document.createElement("div");
    row.className = `agenda-item${task.completed ? " done" : ""}`;
    row.innerHTML = `<button class="task-check" aria-label="${task.completed ? "Reopen" : "Complete"} ${escapeHtml(task.title)}" aria-pressed="${task.completed}"></button><div><span class="agenda-title">${escapeHtml(task.title)}</span><span class="agenda-goal">${escapeHtml(goal.title)}</span></div>`;
    row.querySelector(".task-check").addEventListener("click", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      loadDashboard();
    });
    list.appendChild(row);
  });
  if (!all.length) {
    list.innerHTML = '<p class="page-description">Nothing queued. Add a step from Roadmap.</p>';
  }
  const done = all.filter((item) => item.task.completed).length;
  document.getElementById("daily-progress-copy").textContent = all.length
    ? `${all.length - done} remaining`
    : "No tasks planned";
  document.getElementById("daily-progress-number").textContent = `${done} / ${all.length}`;
  document.getElementById("daily-progress-value").style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
}

function renderGoalsSummary(goalsWithTasks) {
  const container = document.getElementById("dashboard-goals");
  container.innerHTML = "";
  goalsWithTasks.slice(0, 4).forEach(({ goal, tasks }) => {
    const leaves = leafTasks(tasks);
    const done = leaves.filter((task) => task.completed).length;
    const percent = leaves.length ? (done / leaves.length) * 100 : 0;
    const row = document.createElement("div");
    row.className = "goal-line";
    row.innerHTML = `<div><div class="goal-name">${escapeHtml(goal.title)}</div><div class="goal-detail">${leaves.length ? `${leaves.length - done} steps remaining` : "No steps yet"}</div></div><div class="mini-progress"><div class="progress-track"><div class="progress-value" style="width:${percent}%"></div></div><small>${done}/${leaves.length}</small></div>`;
    container.appendChild(row);
  });
  if (!goalsWithTasks.length) {
    container.innerHTML = '<p class="page-description">No active goals.</p>';
  }
}

function renderActivityHeatmap(sessions) {
  const counts = new Map();
  sessions.forEach((session) => {
    const key = localDateKey(parseApiDate(session.created_at));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const grid = document.getElementById("activity-heatmap");
  const months = document.getElementById("heatmap-months");
  grid.innerHTML = "";
  months.innerHTML = "";
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 111);
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
      const count = counts.get(key) || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
      const cell = document.createElement("span");
      cell.className = `heatmap-cell level-${level}`;
      cell.title = `${current.toLocaleDateString("en", { month: "short", day: "numeric" })}: ${count} ${count === 1 ? "session" : "sessions"}`;
      cell.setAttribute("aria-label", cell.title);
      grid.appendChild(cell);
    }
  }
}

async function renderMomentum(stats) {
  const sessions = await api("/sessions");
  document.getElementById("stat-streak").textContent = stats.current_streak;
  document.getElementById("stat-sessions").textContent = stats.total_sessions;
  document.getElementById("stat-minutes").textContent = stats.total_minutes;
  document.getElementById("side-session-count").textContent = `${stats.total_sessions} ${stats.total_sessions === 1 ? "session" : "sessions"}`;
  renderActivityHeatmap(sessions);
  document.getElementById("rhythm-copy").textContent = stats.current_streak
    ? `${stats.current_streak}-day focus streak`
    : "Complete a session to start your activity record.";
}

async function loadDashboard() {
  setDateCopy();
  renderTimerSettings();
  renderActivityHeatmap([]);
  const goals = await api("/goals");
  const goalsWithTasks = await Promise.all(goals.map(async (goal) => ({
    goal,
    tasks: await api(`/goals/${goal.id}/tasks`),
  })));
  renderAgenda(goalsWithTasks);
  renderGoalsSummary(goalsWithTasks);
  await renderMomentum(await api("/stats"));
}

const views = ["dashboard", "goals", "history"];

function switchView(name) {
  views.forEach((view) => {
    document.getElementById(`view-${view}`).classList.toggle("hidden", view !== name);
    document.getElementById(`nav-${view}`).classList.toggle("active", view === name);
  });
  if (name === "dashboard") loadDashboard();
  if (name === "goals") loadGoals();
  if (name === "history") loadHistory();
  window.scrollTo({
    top: 0,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

views.forEach((name) => {
  document.getElementById(`nav-${name}`).addEventListener("click", () => switchView(name));
});
document.getElementById("open-roadmap").addEventListener("click", () => switchView("goals"));
document.getElementById("open-roadmap-2").addEventListener("click", () => switchView("goals"));
document.addEventListener("click", (event) => {
  document.querySelectorAll("details.context-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
document.addEventListener("keydown", (event) => {
  if (!timerSettingsOverlay.classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      setTimerSettingsOpen(false);
      return;
    }
    trapFocus(event, timerSettingsModal);
    return;
  }
  if (!learningOverlay.classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLearningWizard();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      learningWizardNext.click();
      return;
    }
    trapFocus(event, learningWizard);
    return;
  }
  if (!attributionOverlay.classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      document.getElementById("discard-session").click();
      return;
    }
    trapFocus(event, attributionModal);
  }
});

switchView("dashboard");
restoreSavedTimer();
