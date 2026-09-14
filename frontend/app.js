const API_BASE = "http://127.0.0.1:8000";
const MAX_DEPTH = 3;
const ACTIVE_TIMER_KEY = "flowlist-active-focus";
const TIMER_SETTINGS_KEY = "flowlist-timer-settings";
const DEFAULT_TIMER_SETTINGS = { focus: 25, break: 5 };

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

function dateKey(date) {
  return date.toISOString().slice(0, 10);
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

const timerSettingsWrap = document.querySelector(".timer-settings-wrap");
const timerSettingsToggle = document.getElementById("timer-settings-toggle");
const timerSettingsForm = document.getElementById("timer-settings-form");
const focusMinutesSetting = document.getElementById("focus-minutes-setting");
const breakMinutesSetting = document.getElementById("break-minutes-setting");
const heroTime = document.getElementById("hero-time");

function loadTimerSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY));
    const focus = Number(saved?.focus);
    const rest = Number(saved?.break);
    if (focus >= 5 && focus <= 120 && rest >= 1 && rest <= 60) {
      return { focus, break: rest };
    }
  } catch (error) {
    localStorage.removeItem(TIMER_SETTINGS_KEY);
  }
  return { ...DEFAULT_TIMER_SETTINGS };
}

let timerSettings = loadTimerSettings();

function renderTimerSettings() {
  focusMinutesSetting.value = timerSettings.focus;
  breakMinutesSetting.value = timerSettings.break;
  document.getElementById("timer-settings-label").textContent = `${timerSettings.focus} / ${timerSettings.break}`;
  document.getElementById("timer-summary").textContent = `${timerSettings.focus} min focus · ${timerSettings.break} min break`;
  heroTime.innerHTML = `${String(timerSettings.focus).padStart(2, "0")}:00<span>Focus</span>`;
  document.getElementById("pomodoro-heading").textContent = `Protect the next ${timerSettings.focus} minutes.`;
}

function setTimerSettingsOpen(open) {
  timerSettingsForm.classList.toggle("hidden", !open);
  timerSettingsToggle.setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => focusMinutesSetting.focus());
}

timerSettingsToggle.addEventListener("click", () => {
  setTimerSettingsOpen(timerSettingsForm.classList.contains("hidden"));
});
document.getElementById("timer-settings-cancel").addEventListener("click", () => {
  renderTimerSettings();
  setTimerSettingsOpen(false);
});
timerSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const focus = Number(focusMinutesSetting.value);
  const rest = Number(breakMinutesSetting.value);
  if (focus < 5 || focus > 120 || rest < 1 || rest > 60) {
    showToast("Use 5–120 focus minutes and 1–60 break minutes.", true);
    return;
  }
  timerSettings = { focus, break: rest };
  localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(timerSettings));
  renderTimerSettings();
  setTimerSettingsOpen(false);
  showToast("Pomodoro settings saved.");
});
document.addEventListener("click", (event) => {
  if (!timerSettingsWrap.contains(event.target)) setTimerSettingsOpen(false);
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
  section.querySelector(".goal-progress-copy").textContent = leaves.length
    ? `${leaves.filter((task) => task.completed).length} of ${leaves.length} steps complete`
    : "No steps yet";
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
    if (task.completed) title.style.textDecoration = "line-through";
    checkbox.addEventListener("change", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      loadTasks(task.goal_id);
    });
  } else {
    checkbox.remove();
    progress.textContent = `${children.filter((child) => child.completed).length}/${children.length}`;
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
  activeTimer = {
    phase: "focus",
    planned_minutes: plannedMinutes,
    planned_seconds: plannedSeconds,
    deadline,
    remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  };
  saveActiveTimer(activeTimer);
  focusPhaseLabel.innerHTML = "<i></i>Focus";
  focusTaskTitle.textContent = "Focus session";
  focusGoalTitle.textContent = "Stay with the work. You can assign it afterward.";
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

function startBreak(restored = null) {
  clearInterval(timerHandle);
  const plannedMinutes = restored?.planned_minutes || timerSettings.break;
  const plannedSeconds = restored?.planned_seconds || plannedMinutes * 60;
  const deadline = restored?.deadline || Date.now() + plannedSeconds * 1000;
  activeTimer = {
    phase: "break",
    planned_minutes: plannedMinutes,
    planned_seconds: plannedSeconds,
    deadline,
    remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  };
  saveActiveTimer(activeTimer);
  focusPhaseLabel.innerHTML = "<i></i>Break";
  focusTaskTitle.textContent = "Take a real break.";
  focusGoalTitle.textContent = "Stand up, look away, and let your attention reset.";
  focusCycleCopy.textContent = `${plannedMinutes} minute interval`;
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
  const elapsedSeconds = activeTimer.planned_seconds - activeTimer.remaining_seconds;
  const actualMinutes = completed
    ? activeTimer.planned_minutes
    : Math.max(0, Math.min(activeTimer.planned_minutes, Math.round(elapsedSeconds / 60)));
  pendingSession = {
    planned_minutes: activeTimer.planned_minutes,
    actual_minutes: actualMinutes,
    completed,
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
    else if (saved.phase === "break") startBreak(saved);
  } catch (error) {
    clearActiveTimer();
  }
}

const attributionOverlay = document.getElementById("session-attribution-overlay");
const attributionModal = attributionOverlay.querySelector(".attribution-modal");
const attributionOptions = document.getElementById("attribution-options");
const completeAttributedTask = document.getElementById("complete-attributed-task");
const attributionError = document.getElementById("attribution-error");
const saveSessionButton = document.getElementById("save-session");

function renderAttributionOptions(options) {
  attributionOptions.innerHTML = "";
  options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "attribution-option";
    label.innerHTML = `<input type="radio" name="attribution-task" value="${option.id}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(option.goal_title)}</small></span>${index === 0 ? `<em>${option.last_focused_at ? "Recent" : "Next"}</em>` : ""}`;
    attributionOptions.appendChild(label);
  });
  const general = document.createElement("label");
  general.className = "attribution-option general-option";
  general.innerHTML = `<input type="radio" name="attribution-task" value="" ${options.length ? "" : "checked"}><span><strong>General focus</strong><small>Save without linking a task</small></span>`;
  attributionOptions.appendChild(general);
  completeAttributedTask.disabled = !options.length;
  completeAttributedTask.checked = false;
}

async function openAttributionModal() {
  if (!pendingSession) return;
  document.getElementById("attribution-status").textContent = pendingSession.completed
    ? "Focus complete"
    : "Session ended";
  document.getElementById("attribution-minutes").textContent = `${pendingSession.actual_minutes} ${pendingSession.actual_minutes === 1 ? "minute" : "minutes"}`;
  saveSessionButton.textContent = pendingSession.completed ? "Save & start break" : "Save session";
  saveSessionButton.disabled = true;
  completeAttributedTask.disabled = true;
  completeAttributedTask.checked = false;
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

attributionOptions.addEventListener("change", () => {
  const selected = attributionOptions.querySelector('input[name="attribution-task"]:checked');
  const hasTask = Boolean(selected?.value);
  completeAttributedTask.disabled = !hasTask;
  if (!hasTask) completeAttributedTask.checked = false;
});

document.getElementById("session-attribution-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingSession) return;
  const selected = attributionOptions.querySelector('input[name="attribution-task"]:checked');
  if (!selected) {
    attributionError.textContent = "Choose a task or General focus.";
    return;
  }
  const session = pendingSession;
  const taskId = selected.value ? Number(selected.value) : null;
  saveSessionButton.disabled = true;
  saveSessionButton.textContent = "Saving…";
  attributionError.textContent = "";
  try {
    await api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        ...session,
        task_id: taskId,
        complete_task: taskId ? completeAttributedTask.checked : false,
      }),
    });
    pendingSession = null;
    attributionOverlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
    loadDashboard();
    showToast("Focus session saved.");
    if (session.completed) startBreak();
  } catch (error) {
    saveSessionButton.disabled = false;
    saveSessionButton.textContent = session.completed ? "Save & start break" : "Save session";
    attributionError.textContent = "Flowlist could not save this session. Try again.";
  }
});

document.getElementById("discard-session").addEventListener("click", () => {
  const shouldBreak = pendingSession?.completed;
  pendingSession = null;
  attributionOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (shouldBreak) startBreak();
});

async function loadHistory() {
  const sessions = await api("/sessions");
  const history = document.getElementById("history-view");
  history.innerHTML = sessions.length ? "" : '<p class="page-description">No focus sessions recorded yet.</p>';
  sessions.forEach((session) => {
    const node = document.getElementById("session-template").content.cloneNode(true);
    node.querySelector(".session-title").textContent = session.task_title;
    node.querySelector(".session-meta").textContent = `${session.actual_minutes} of ${session.planned_minutes} minutes · ${new Date(session.created_at).toLocaleString()}`;
    const status = node.querySelector(".session-status");
    status.textContent = session.completed ? "Completed" : "Ended early";
    status.classList.add(session.completed ? "pill-success" : "pill-warning");
    history.appendChild(node);
  });
}

function renderAgenda(goalsWithTasks) {
  const all = goalsWithTasks
    .flatMap(({ goal, tasks }) => leafTasks(tasks).map((task) => ({ task, goal })))
    .sort((a, b) => (a.task.completed - b.task.completed) || (a.task.id - b.task.id));
  const list = document.getElementById("today-agenda");
  list.innerHTML = "";
  const display = all.slice(0, 5);
  display.forEach(({ task, goal }) => {
    const row = document.createElement("div");
    row.className = `agenda-item${task.completed ? " done" : ""}`;
    row.innerHTML = `<button class="task-check" aria-label="Mark ${escapeHtml(task.title)} complete"></button><div><span class="agenda-title">${escapeHtml(task.title)}</span><span class="agenda-goal">${escapeHtml(goal.title)}</span></div>`;
    row.querySelector(".task-check").addEventListener("click", async () => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      loadDashboard();
    });
    list.appendChild(row);
  });
  if (!display.length) {
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
    const key = session.created_at.slice(0, 10);
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
      const key = dateKey(current);
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
