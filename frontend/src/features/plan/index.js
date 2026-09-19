import { api } from '../../shared/api';
import { escapeHtml, trapFocus, syncDialogs } from '../../shared/dom';
const MAX_DEPTH = 3;
function leafTasks(tasks) { const parents = new Set(tasks.map(task => task.parent_id)); return tasks.filter(task => !parents.has(task.id)); }
export function initPlan({ showToast }) {
const goalsContainer = document.getElementById("goals");
const goalTemplate = document.getElementById("goal-template");
const taskTemplate = document.getElementById("task-template");
const planIndexList = document.getElementById("plan-index-list");
const goalComposer = document.getElementById("goal-composer");
const completedDirections = document.getElementById("completed-directions");
const completedDirectionsList = document.getElementById("completed-directions-list");
const completedDirectionsCount = document.getElementById("completed-directions-count");
const COLLAPSED_TASKS_KEY = "flowlist-collapsed-plan-sections";
const COLLAPSED_GOALS_KEY = "flowlist-collapsed-directions";
let activeGoalCreateType = "project";
let planGoalsCache = [];
let learningWizardState = null;
let planSectionObserver = null;
let draggingTaskId = null;

function loadCollapsedTaskIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_TASKS_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

const collapsedTaskIds = loadCollapsedTaskIds();

function loadCollapsedGoalIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GOALS_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

const collapsedGoalIds = loadCollapsedGoalIds();

function saveCollapsedTaskIds() {
  localStorage.setItem(COLLAPSED_TASKS_KEY, JSON.stringify([...collapsedTaskIds]));
}

function saveCollapsedGoalIds() {
  localStorage.setItem(COLLAPSED_GOALS_KEY, JSON.stringify([...collapsedGoalIds]));
}

function setGoalComposerOpen(open, goalType = activeGoalCreateType) {
  activeGoalCreateType = goalType;
  goalComposer.classList.toggle("hidden", !open);
  document.querySelectorAll("[data-goal-create]").forEach((button) => {
    button.classList.toggle("active", open && button.dataset.goalCreate === goalType);
    button.setAttribute("aria-expanded", String(open && button.dataset.goalCreate === goalType));
  });
  const labels = {
    project: ["New project", "What are you building?", "e.g. Launch portfolio"],
    learning: ["New learning objective", "What do you want to understand?", "e.g. Learn AI engineering"],
    standalone: ["New task", "What needs doing?", "e.g. Pay electricity bill"],
  };
  const [kicker, heading, placeholder] = labels[goalType];
  document.getElementById("goal-composer-kicker").textContent = kicker;
  document.getElementById("goal-composer-heading").textContent = heading;
  document.getElementById("goal-title").placeholder = placeholder;
  if (open) requestAnimationFrame(() => document.getElementById("goal-title").focus());
}

document.querySelectorAll("[data-goal-create]").forEach((button) => {
  button.addEventListener("click", () => {
    const sameOpenType = !goalComposer.classList.contains("hidden")
      && activeGoalCreateType === button.dataset.goalCreate;
    setGoalComposerOpen(!sameOpenType, button.dataset.goalCreate);
  });
});
document.getElementById("cancel-goal-composer").addEventListener("click", () => setGoalComposerOpen(false));

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
    ? '<li class="suggestion-toolbar"><span><b class="beta-badge">AI draft</b> Keep only the milestones that fit your pace.</span><button class="secondary-btn suggestion-add-selected" type="button">Add selected</button></li>'
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
      for (const suggestion of selected) await api(`/goals/${goal.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: suggestion.title }),
      });
      goalSuggestions.style.display = "none";
      loadTasks(goal.id);
      showToast(`${selected.length} milestone${selected.length === 1 ? "" : "s"} added to the plan.`);
    } catch (error) {
      addButton.disabled = false;
      showToast("Could not add the selected milestones. Try again.", true);
    }
  });
}

function closeLearningWizard() {
  const previousTrigger = learningWizardState?.trigger;
  const returnTarget = learningWizardState?.returnTarget;
  learningWizardState = null;
  learningOverlay.classList.add("hidden");
  learningOverlay.removeAttribute("aria-busy");
  syncDialogs();
  if (previousTrigger?.isConnected) {
    previousTrigger.disabled = false;
    (returnTarget?.isConnected ? returnTarget : previousTrigger).focus();
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
  learningWizardNext.textContent = index === questions.length - 1 ? "Generate draft" : "Continue";
  requestAnimationFrame(() => learningAnswer.focus());
}

async function openLearningWizard(goal, trigger, goalSuggestions) {
  const state = {
    goal,
    trigger,
    returnTarget: trigger.closest("details")?.querySelector("summary") || trigger,
    goalSuggestions,
    questions: [],
    answers: [],
    index: 0,
  };
  learningWizardState = state;
  trigger.disabled = true;
  learningGoalName.textContent = goal.title;
  learningLoading.hidden = false;
  learningQuestion.hidden = true;
  learningOverlay.classList.remove("hidden");
  learningOverlay.setAttribute("aria-busy", "true");
  syncDialogs();
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
    showToast("AI draft ready. Keep only what fits.");
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
    ? '<li class="suggestion-toolbar"><span><b class="beta-badge">AI draft</b> Select every smaller step that actually helps.</span><button class="secondary-btn suggestion-add-selected" type="button">Add selected</button></li>'
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
      for (const suggestion of selected) await api(`/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: suggestion.title }),
      });
      loadTasks(task.goal_id);
      showToast(`${selected.length} step${selected.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      addButton.disabled = false;
      showToast("Could not add the selected steps. Try again.", true);
    }
  });
}

function goalTypeLabel(goalType) {
  if (goalType === "learning") return "Learning objective";
  if (goalType === "standalone") return "Tasks";
  return "Project";
}

function goalDisplayTitle(goal) {
  return goal.goal_type === "standalone" ? "Tasks" : goal.title;
}

function setPlanIndexActive(goalId) {
  planIndexList.querySelectorAll(".plan-index-item").forEach((item) => {
    const active = item.dataset.goalId === String(goalId);
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "location");
    else item.removeAttribute("aria-current");
  });
}

function renderPlanIndex(goals) {
  planIndexList.innerHTML = goals.length ? "" : '<p class="plan-index-empty">No directions yet.</p>';
  goals.forEach((goal, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "plan-index-item";
    item.dataset.goalId = goal.id;
    item.setAttribute("aria-label", `Jump to ${goalDisplayTitle(goal)}`);
    item.innerHTML = `<span class="plan-index-dot" aria-hidden="true"></span><span class="plan-index-label"><small>${escapeHtml(goalTypeLabel(goal.goal_type))}</small><strong>${escapeHtml(goalDisplayTitle(goal))}</strong></span>`;
    item.addEventListener("click", () => {
      document.querySelector(`article[data-goal-id="${goal.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPlanIndexActive(goal.id);
    });
    planIndexList.appendChild(item);
    if (index === 0) setPlanIndexActive(goal.id);
  });
}

function observePlanSections() {
  planSectionObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  planSectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setPlanIndexActive(visible.target.dataset.goalId);
  }, { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.2, 0.55] });
  goalsContainer.querySelectorAll("article[data-goal-id]").forEach((section) => planSectionObserver.observe(section));
}

function setStepComposer(form, open) {
  form.classList.toggle("hidden", !open);
  if (open) requestAnimationFrame(() => form.querySelector('input[type="text"]')?.focus());
}

function setupInlineEdit({ trigger, form, input, save }) {
  const close = () => {
    form.classList.add("hidden");
    trigger.classList.remove("hidden");
  };
  trigger.addEventListener("click", () => {
    trigger.classList.add("hidden");
    form.classList.remove("hidden");
    input.value = trigger.textContent.trim();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value || value === trigger.textContent.trim()) return close();
    input.disabled = true;
    try { await save(value); }
    catch(error) { showToast(error.message, true); }
    finally { input.disabled = false; if (input.isConnected) input.focus(); }
  });
  input.addEventListener("blur", () => {
    requestAnimationFrame(() => {
      if (!form.contains(document.activeElement) && input.value.trim() === trigger.textContent.trim()) close();
    });
  });
}

async function reorderGoals(sourceId, targetId) {
  const activeIds = planGoalsCache
    .filter((goal) => !goal.completed || goal.goal_type === "standalone")
    .map((goal) => goal.id);
  const from = activeIds.indexOf(sourceId);
  const to = activeIds.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return;
  activeIds.splice(to, 0, activeIds.splice(from, 1)[0]);
  let activeIndex = 0;
  const ids = planGoalsCache.map((goal) => (
    goal.completed && goal.goal_type !== "standalone"
      ? goal.id
      : activeIds[activeIndex++]
  ));
  await api("/goals/reorder", { method: "POST", body: JSON.stringify({ ordered_ids: ids }) });
  await loadGoals();
}

async function moveGoalBy(goalId, delta) {
  const activeIds = planGoalsCache
    .filter((goal) => !goal.completed || goal.goal_type === "standalone")
    .map((goal) => goal.id);
  const index = activeIds.indexOf(goalId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= activeIds.length) return;
  await reorderGoals(goalId, activeIds[target]);
}

function renderCompletedDirections(goals) {
  completedDirections.classList.toggle("hidden", goals.length === 0);
  completedDirectionsCount.textContent = String(goals.length);
  completedDirectionsList.innerHTML = "";
  goals.forEach((goal) => {
    const row = document.createElement("article");
    row.className = "completed-direction-row";
    row.innerHTML = `<span><small>${escapeHtml(goalTypeLabel(goal.goal_type))}</small><strong>${escapeHtml(goalDisplayTitle(goal))}</strong></span><button class="text-btn" type="button">Reopen</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      await api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify({ completed: false }) });
      await loadGoals();
      showToast("Direction reopened.");
    });
    completedDirectionsList.appendChild(row);
  });
}

async function loadGoals() {
  const goals = await api("/goals");
  planGoalsCache = goals;
  const activeGoals = goals.filter((goal) => !goal.completed || goal.goal_type === "standalone");
  const finishedGoals = goals.filter((goal) => goal.completed && goal.goal_type !== "standalone");
  goalsContainer.innerHTML = "";
  renderPlanIndex(activeGoals);
  renderCompletedDirections(finishedGoals);
  if (!activeGoals.length) {
    goalsContainer.innerHTML = '<section class="plan-empty panel"><p class="kicker">An open page</p><h2>Choose one direction to begin.</h2><p>Projects hold outcomes, learning holds a path, and Tasks catches everything smaller.</p></section>';
    return;
  }
  const taskLoads = [];
  for (const [goalIndex, goal] of activeGoals.entries()) {
    const node = goalTemplate.content.cloneNode(true);
    const section = node.querySelector("article");
    section.dataset.goalId = goal.id;
    section.dataset.goalType = goal.goal_type || "project";
    section.id = `goal-${goal.id}`;
    const goalType = node.querySelector(".goal-type-label");
    goalType.textContent = goalTypeLabel(goal.goal_type);
    goalType.classList.toggle("hidden", goal.goal_type === "standalone");
    const goalTitle = node.querySelector(".goal-title");
    const goalTitleForm = node.querySelector(".goal-title-form");
    const goalTitleInput = node.querySelector(".goal-edit-title");
    goalTitle.textContent = goalDisplayTitle(goal);
    if (goal.goal_type === "standalone") {
      goalTitle.disabled = true;
      goalTitleForm.remove();
    } else {
      setupInlineEdit({
        trigger: goalTitle,
        form: goalTitleForm,
        input: goalTitleInput,
        save: async (title) => {
          await api(`/goals/${goal.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
          await loadGoals();
          showToast("Direction renamed.");
        },
      });
    }
    const description = node.querySelector(".goal-description");
    description.textContent = goal.description || "";
    description.classList.toggle("hidden", !goal.description);

    const collapseGoal = node.querySelector(".goal-collapse");
    if (goal.goal_type === "standalone") {
      collapseGoal.remove();
    } else {
      const collapsed = collapsedGoalIds.has(goal.id);
      section.classList.toggle("is-collapsed", collapsed);
      collapseGoal.setAttribute("aria-expanded", String(!collapsed));
      collapseGoal.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${goalDisplayTitle(goal)}`);
      collapseGoal.addEventListener("click", () => {
        const willCollapse = !section.classList.contains("is-collapsed");
        section.classList.toggle("is-collapsed", willCollapse);
        collapseGoal.setAttribute("aria-expanded", String(!willCollapse));
        collapseGoal.setAttribute("aria-label", `${willCollapse ? "Expand" : "Collapse"} ${goalDisplayTitle(goal)}`);
        if (willCollapse) collapsedGoalIds.add(goal.id);
        else collapsedGoalIds.delete(goal.id);
        saveCollapsedGoalIds();
      });
    }

    const goalBreakdown = node.querySelector(".break-down-goal");
    const goalSuggestions = node.querySelector(".goal-suggestion-list");
    if (goal.goal_type !== "learning") {
      goalBreakdown.remove();
    } else {
      goalBreakdown.addEventListener("click", () => {
        openLearningWizard(goal, goalBreakdown, goalSuggestions);
      });
    }

    const taskForm = node.querySelector(".task-form");
    const goalAddStep = node.querySelector(".goal-add-step");
    if (goal.goal_type === "standalone") {
      goalAddStep.setAttribute("aria-label", "Add task");
      goalAddStep.querySelector(".goal-action-label").textContent = "Add task";
      taskForm.querySelector(".step-composer-label").textContent = "New task";
      taskForm.querySelector("input").placeholder = "What needs doing?";
    }
    goalAddStep.addEventListener("click", () => setStepComposer(taskForm, taskForm.classList.contains("hidden")));
    taskForm.querySelector(".cancel-step-composer").addEventListener("click", () => setStepComposer(taskForm, false));

    node.querySelector(".delete-goal").addEventListener("click", async () => {
      if (!window.confirm(`Remove “${goalDisplayTitle(goal)}” and every step inside it?`)) return;
      await api(`/goals/${goal.id}`, { method: "DELETE" });
      await loadGoals();
      showToast("Direction removed.");
    });

    const moveUp = node.querySelector(".goal-move-up");
    const moveDown = node.querySelector(".goal-move-down");
    moveUp.disabled = goalIndex === 0;
    moveDown.disabled = goalIndex === activeGoals.length - 1;
    moveUp.setAttribute("aria-label", `Move ${goalDisplayTitle(goal)} up`);
    moveDown.setAttribute("aria-label", `Move ${goalDisplayTitle(goal)} down`);
    const moveDirection = async (delta, trigger) => {
      const anchorTop = trigger.getBoundingClientRect().top;
      const selector = delta < 0 ? ".goal-move-up" : ".goal-move-down";
      moveUp.disabled = true;
      moveDown.disabled = true;
      try {
        await moveGoalBy(goal.id, delta);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const movedButton = document.querySelector(`article[data-goal-id="${goal.id}"] ${selector}`);
        if (movedButton) {
          const distance = movedButton.getBoundingClientRect().top - anchorTop;
          window.scrollBy(0, distance);
          movedButton.focus({ preventScroll: true });
        }
      } catch (error) {
        await loadGoals();
        showToast("Could not move this direction.", true);
      }
    };
    moveUp.addEventListener("click", (event) => moveDirection(-1, event.currentTarget));
    moveDown.addEventListener("click", (event) => moveDirection(1, event.currentTarget));

    taskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.target.querySelector('input[type="text"]');
      if (!input.value.trim()) return;
      await api(`/goals/${goal.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim() }),
      });
      input.value = "";
      setStepComposer(taskForm, false);
      await loadTasks(goal.id);
      showToast(goal.goal_type === "standalone" ? "Task added." : "Step added.");
    });
    goalsContainer.appendChild(node);
    taskLoads.push(loadTasks(goal.id));
  }
  observePlanSections();
  await Promise.all(taskLoads);
}

function childrenOf(task, allTasks) {
  return allTasks
    .filter((item) => item.parent_id === task.id)
    .sort((a, b) => (a.position - b.position) || (a.id - b.id));
}

function taskParentPath(task, allTasks) {
  const byId = new Map(allTasks.map((item) => [item.id, item]));
  const path = [];
  let parent = byId.get(task.parent_id);
  while (parent) {
    path.unshift(parent.title);
    parent = byId.get(parent.parent_id);
  }
  return path;
}

function siblingsOf(task, allTasks) {
  return allTasks
    .filter((item) => item.goal_id === task.goal_id && item.parent_id === task.parent_id)
    .sort((a, b) => (a.position - b.position) || (a.id - b.id));
}

async function reorderTasks(task, target, allTasks) {
  if (task.parent_id !== target.parent_id || task.goal_id !== target.goal_id) return;
  const ids = siblingsOf(task, allTasks).map((item) => item.id);
  const from = ids.indexOf(task.id);
  const to = ids.indexOf(target.id);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  await api("/tasks/reorder", { method: "POST", body: JSON.stringify({ ordered_ids: ids }) });
  await loadTasks(task.goal_id);
}

async function moveTaskBy(task, allTasks, delta) {
  const ids = siblingsOf(task, allTasks).map((item) => item.id);
  const index = ids.indexOf(task.id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await api("/tasks/reorder", { method: "POST", body: JSON.stringify({ ordered_ids: ids }) });
  await loadTasks(task.goal_id);
  document.querySelector(`[data-task-id="${task.id}"] .task-reorder-handle`)?.focus();
}

function renderCompletedTasks(section, tasks) {
  const completed = tasks
    .filter((task) => task.completed)
    .sort((a, b) => (a.depth - b.depth) || (a.position - b.position) || (a.id - b.id));
  const completedSection = section.querySelector(".completed-tasks");
  const completedList = section.querySelector(".completed-task-list");
  completedSection.classList.toggle("hidden", completed.length === 0);
  section.querySelector(".completed-count").textContent = String(completed.length);
  completedList.innerHTML = "";
  completed.forEach((task) => {
    const path = taskParentPath(task, tasks);
    const item = document.createElement("li");
    item.className = "completed-task-row";
    item.innerHTML = `<input type="checkbox" class="task-completed" checked aria-label="Reopen ${escapeHtml(task.title)}"><span class="completed-task-copy"><span>${escapeHtml(task.title)}</span>${path.length ? `<small>${path.map(escapeHtml).join('<i aria-hidden="true">/</i>')}</small>` : ""}</span><button class="row-action row-delete" type="button" aria-label="Remove ${escapeHtml(task.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-1 10H6L5 6m3 3v4m4-4v4"/></svg></button>`;
    item.querySelector(".task-completed").addEventListener("change", async () => {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: false }) });
      await loadTasks(task.goal_id);
    });
    item.querySelector(".row-delete").addEventListener("click", async () => {
      if (!window.confirm(`Remove “${task.title}”?`)) return;
      await api(`/tasks/${task.id}`, { method: "DELETE" });
      await loadTasks(task.goal_id);
      showToast("Task removed.");
    });
    completedList.appendChild(item);
  });
}

async function loadTasks(goalId) {
  const tasks = await api(`/goals/${goalId}/tasks`);
  const section = document.querySelector(`article[data-goal-id="${goalId}"]`);
  if (!section) return;
  const list = section.querySelector(".goal-task-list");
  list.innerHTML = "";
  tasks
    .filter((task) => task.parent_id === null && !task.completed)
    .sort((a, b) => (a.position - b.position) || (a.id - b.id))
    .forEach((task) => renderTask(task, tasks, list, section.dataset.goalType));
  const leaves = leafTasks(tasks);
  const completed = leaves.filter((task) => task.completed).length;
  const itemNoun = section.dataset.goalType === "standalone" ? "tasks" : "steps";
  section.querySelector(".goal-progress-copy").textContent = leaves.length
    ? completed === leaves.length && section.dataset.goalType !== "standalone"
      ? "All tasks finished · close the remaining sections"
      : `${completed} of ${leaves.length} ${itemNoun} complete`
    : section.dataset.goalType === "standalone" ? "No tasks yet" : "No steps yet";
  section.querySelector(".goal-progress-value").style.width = `${leaves.length ? (completed / leaves.length) * 100 : 0}%`;
  const activeRoots = tasks.filter((task) => task.parent_id === null && !task.completed);
  section.querySelector(".goal-empty-state").classList.toggle("hidden", activeRoots.length !== 0);
  renderCompletedTasks(section, tasks);
  const goalComplete = section.querySelector(".goal-complete");
  const goalType = section.dataset.goalType;
  const readyToClose = goalType !== "standalone"
    && tasks.some((task) => task.parent_id === null)
    && tasks.filter((task) => task.parent_id === null).every((task) => task.completed);
  goalComplete.classList.toggle("hidden", !readyToClose);
  if (readyToClose) {
    section.querySelector(".goal-progress-copy").textContent = "All tasks finished · ready to close this direction";
    goalComplete.onclick = async () => {
      const goal = planGoalsCache.find((item) => item.id === goalId);
      await api(`/goals/${goalId}`, { method: "PATCH", body: JSON.stringify({ completed: true }) });
      await loadGoals();
      document.getElementById("celebration-goal-title").textContent = goalDisplayTitle(goal);
      document.getElementById("celebration-overlay").classList.remove("hidden");
    };
  }
}

document.getElementById("celebration-dismiss").addEventListener("click", () => {
  document.getElementById("celebration-overlay").classList.add("hidden");
});

function renderTask(task, allTasks, container, goalType = "project") {
  const children = childrenOf(task, allTasks);
  const activeChildren = children.filter((child) => !child.completed);
  const isLeaf = children.length === 0;
  const readyToClose = !isLeaf && children.every((child) => child.completed);
  const node = taskTemplate.content.cloneNode(true);
  const taskNode = node.querySelector(".task-node");
  const taskRow = node.querySelector(".task-row");
  const checkbox = node.querySelector(".task-completed");
  const title = node.querySelector(".task-title");
  const progress = node.querySelector(".task-progress");
  const editForm = node.querySelector(".task-edit-form");
  const editInput = node.querySelector(".task-edit-title");
  const add = node.querySelector(".add-subtask");
  const breakdown = node.querySelector(".break-down");
  const subtaskForm = node.querySelector(".subtask-form");
  const subtaskList = node.querySelector(".subtask-list");
  const suggestions = node.querySelector(".suggestion-list");
  const remove = node.querySelector(".delete-task");
  const chevron = node.querySelector(".task-chevron");
  const reorderHandle = node.querySelector(".task-reorder-handle");

  taskNode.dataset.taskId = task.id;
  taskNode.dataset.parentId = task.parent_id ?? "root";
  taskNode.dataset.depth = task.depth;
  taskRow.classList.add(isLeaf ? "leaf-task-row" : "parent-task-row");
  taskRow.classList.toggle("ready-to-close", readyToClose);
  title.textContent = task.title;
  setupInlineEdit({
    trigger: title,
    form: editForm,
    input: editInput,
    save: async (editedTitle) => {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: editedTitle }),
      });
      await loadTasks(task.goal_id);
      showToast("Task renamed.");
    },
  });

  if (isLeaf || readyToClose) {
    checkbox.checked = false;
    checkbox.setAttribute("aria-label", `${readyToClose ? "Close section" : "Complete task"}: ${task.title}`);
    checkbox.addEventListener("change", async () => {
      if (!checkbox.checked) return;
      checkbox.disabled = true;
      taskRow.classList.add("is-completing");
      try {
      await new Promise((resolve) => setTimeout(resolve, 170));
      await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: true }) });
      await loadTasks(task.goal_id);
      showToast(readyToClose ? "Section closed." : "Task completed.", false, {
        label: "Undo",
        run: async () => {
          await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: false }) });
          await loadTasks(task.goal_id);
        },
      });
      } catch(error) { checkbox.checked = false; taskRow.classList.remove("is-completing"); showToast(error.message,true); }
      finally { checkbox.disabled = false; }
    });
  } else {
    checkbox.disabled = true;
    checkbox.setAttribute("aria-label", `Complete the smaller steps before closing ${task.title}`);
    checkbox.title = "Complete the smaller steps first";
  }

  if (isLeaf) {
    chevron.classList.remove("hidden");
    chevron.classList.add("is-placeholder");
    chevron.disabled = true;
    progress.remove();
  } else {
    const completedChildren = children.filter((child) => child.completed).length;
    progress.textContent = readyToClose ? "All steps complete" : `${completedChildren} of ${children.length}`;
    if (!activeChildren.length) {
      chevron.classList.remove("hidden");
      chevron.classList.add("is-placeholder");
      chevron.disabled = true;
    } else {
      chevron.classList.remove("hidden");
      const collapsed = collapsedTaskIds.has(task.id);
      taskNode.classList.toggle("is-collapsed", collapsed);
      chevron.setAttribute("aria-expanded", String(!collapsed));
      chevron.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${task.title}`);
      chevron.addEventListener("click", () => {
        const willCollapse = !taskNode.classList.contains("is-collapsed");
        taskNode.classList.toggle("is-collapsed", willCollapse);
        chevron.setAttribute("aria-expanded", String(!willCollapse));
        chevron.setAttribute("aria-label", `${willCollapse ? "Expand" : "Collapse"} ${task.title}`);
        if (willCollapse) collapsedTaskIds.add(task.id);
        else collapsedTaskIds.delete(task.id);
        saveCollapsedTaskIds();
      });
    }
  }

  remove.setAttribute("aria-label", `Remove ${task.title}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Remove “${task.title}”${children.length ? " and its smaller steps" : ""}?`)) return;
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    await loadTasks(task.goal_id);
    showToast("Task removed.");
  });

  if (task.depth >= MAX_DEPTH || goalType === "standalone") {
    add.remove();
    breakdown.remove();
    subtaskForm.remove();
  } else {
    add.setAttribute("aria-label", `Add a smaller step under ${task.title}`);
    add.addEventListener("click", () => setStepComposer(subtaskForm, subtaskForm.classList.contains("hidden")));
    subtaskForm.querySelector(".cancel-subtask").addEventListener("click", () => setStepComposer(subtaskForm, false));
    subtaskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = subtaskForm.querySelector('input[type="text"]');
      if (!input.value.trim()) return;
      await api(`/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim() }),
      });
      await loadTasks(task.goal_id);
      showToast("Substep added.");
    });
    breakdown.addEventListener("click", async () => {
      const originalMarkup = breakdown.innerHTML;
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
        breakdown.innerHTML = originalMarkup;
        breakdown.disabled = false;
      }
    });
  }

  reorderHandle.addEventListener("pointerdown", () => { taskNode.draggable = true; });
  reorderHandle.addEventListener("pointerup", () => { taskNode.draggable = false; });
  reorderHandle.addEventListener("keydown", async (event) => {
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    await moveTaskBy(task, allTasks, event.key === "ArrowUp" ? -1 : 1);
  });
  taskNode.addEventListener("dragstart", (event) => {
    draggingTaskId = task.id;
    event.dataTransfer.effectAllowed = "move";
    taskNode.classList.add("is-dragging");
  });
  taskNode.addEventListener("dragend", () => {
    draggingTaskId = null;
    taskNode.draggable = false;
    taskNode.classList.remove("is-dragging");
    document.querySelectorAll(".task-node.drag-target").forEach((item) => item.classList.remove("drag-target"));
  });
  taskRow.addEventListener("dragover", (event) => {
    const source = allTasks.find((item) => item.id === draggingTaskId);
    if (!source || source.parent_id !== task.parent_id) return;
    event.preventDefault();
    taskNode.classList.add("drag-target");
  });
  taskRow.addEventListener("dragleave", () => taskNode.classList.remove("drag-target"));
  taskRow.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    taskNode.classList.remove("drag-target");
    const source = allTasks.find((item) => item.id === draggingTaskId);
    if (source) await reorderTasks(source, task, allTasks);
  });

  container.appendChild(node);
  activeChildren.forEach((child) => renderTask(child, allTasks, subtaskList, goalType));
}

document.getElementById("goal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("goal-title");
  if (!input.value.trim()) return;
  const type = activeGoalCreateType;
  const submit = event.submitter;
  submit.disabled = true;
  try {
    if (type === "standalone") {
      await api("/standalone-tasks", {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim() }),
      });
    } else {
      await api("/goals", {
        method: "POST",
        body: JSON.stringify({ title: input.value.trim(), goal_type: type }),
      });
    }
    input.value = "";
    setGoalComposerOpen(false);
    await loadGoals();
    showToast(type === "standalone" ? "Task added." : "Goal added.");
  } catch (error) {
    showToast("Could not add this item.", true);
  } finally {
    submit.disabled = false;
  }
});


  return { loadGoals, handleKey(event) {
    if (learningOverlay.classList.contains('hidden')) return false;
    if (event.key === 'Escape') { event.preventDefault(); closeLearningWizard(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); learningWizardNext.click(); }
    else trapFocus(event, learningWizard);
    return true;
  }};
}
