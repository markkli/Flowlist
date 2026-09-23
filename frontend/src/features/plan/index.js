import { accountKey } from '../../shared/account';
import { api } from '../../shared/api';
import { escapeHtml, syncDialogs } from '../../shared/dom';
import './plan.css';
const MAX_DEPTH = 2;
function leafTasks(tasks) { const parents = new Set(tasks.map(task => task.parent_id)); return tasks.filter(task => !parents.has(task.id)); }
export function initPlan({ showToast }) {
const goalsContainer = document.getElementById("goals");
const goalTemplate = document.getElementById("goal-template");
const taskTemplate = document.getElementById("task-template");
const planIndexList = document.getElementById("plan-index-list");
const planIndex = planIndexList.closest('.plan-index');
const planView = document.getElementById('view-goals');
document.querySelector('.app-shell').append(planIndex);
const indexTooltip = document.createElement('span');
indexTooltip.className = 'plan-index-tooltip hidden';
indexTooltip.setAttribute('aria-hidden','true');
planIndex.append(indexTooltip);
const goalComposer = document.getElementById("goal-composer");
const completedDirections = document.getElementById("completed-directions");
const completedDirectionsList = document.getElementById("completed-directions-list");
const completedDirectionsCount = document.getElementById("completed-directions-count");
const COLLAPSED_TASKS_KEY = accountKey("flowlist-collapsed-plan-sections");
const COLLAPSED_GOALS_KEY = accountKey("flowlist-collapsed-directions");
let activeGoalCreateType = "project";
let planGoalsCache = [];
let draggingTaskId = null;
let menuSequence = 0;
let queuedTaskIds = new Set();
const planTasks = new Map();

function updatePlanOverview() {
  const activeGoals = planGoalsCache.filter(goal => !goal.completed);
  const directions = activeGoals.filter(goal => goal.goal_type !== 'standalone').length;
  const open = [...planTasks.values()].flat().filter(task => !task.completed).length;
  document.getElementById('plan-overview').textContent = `${directions} ${directions === 1 ? 'project' : 'projects'} · ${open} open ${open === 1 ? 'task' : 'tasks'}`;
}

function updatePlanNavigation() {
  const visible = !planView.classList.contains('hidden') && planIndexList.children.length > 1
    && document.documentElement.scrollHeight > innerHeight + 100;
  planIndex.classList.toggle('hidden', !visible);
  planView.classList.toggle('has-plan-index', visible);
  if (!visible) return;
  const sections = [...goalsContainer.querySelectorAll('article[data-goal-id]')];
  const anchor = innerHeight * .3;
  const current = sections.filter(item => item.getBoundingClientRect().top <= anchor).at(-1) || sections[0];
  if (current) setPlanIndexActive(current.dataset.goalId);
}
let navigationFrame;
function scheduleNavigationUpdate() {
  cancelAnimationFrame(navigationFrame);
  navigationFrame = requestAnimationFrame(updatePlanNavigation);
}
new ResizeObserver(scheduleNavigationUpdate).observe(planView);
new MutationObserver(scheduleNavigationUpdate).observe(planView, {attributes:true,attributeFilter:['class']});
window.addEventListener('resize', scheduleNavigationUpdate);
window.addEventListener('scroll', scheduleNavigationUpdate, {passive:true});

function setupMenu(trigger, menu, label) {
  menu.id = `plan-menu-${++menuSequence}`;
  trigger.setAttribute('aria-label', `Actions for ${label}`);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', `Actions for ${label}`);
  const items = () => [...menu.querySelectorAll('button:not(:disabled)')];
  const open = () => {
    menu.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 12))}px`;
    trigger.setAttribute('aria-expanded', 'true');
    items()[0]?.focus();
  };
  trigger.addEventListener('click', () => menu.matches(':popover-open') ? menu.hidePopover() : open());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
  });
  menu.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open'))));
  menu.addEventListener('keydown', event => {
    const buttons = items();
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); menu.hidePopover(); trigger.focus();
    }
  });
  // Close before the action runs so composers and dialogs can claim focus.
  menu.addEventListener('click', event => {
    if (!event.target.closest('button')) return;
    menu.hidePopover(); trigger.focus();
  }, true);
}

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
    project: ["New project", "What would you like to work toward?", "e.g. Learn photography or launch a website"],
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

function goalTypeLabel(goalType) {
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
  planIndexList.innerHTML = goals.length ? "" : '<p class="plan-index-empty">No projects yet.</p>';
  goals.forEach((goal, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "plan-index-item";
    item.dataset.goalId = goal.id;
    item.setAttribute("aria-label", `Jump to ${goalDisplayTitle(goal)}`);
    item.innerHTML = `<span class="plan-index-dot" aria-hidden="true"></span><span class="plan-index-label"><small>${escapeHtml(goalTypeLabel(goal.goal_type))}</small><strong>${escapeHtml(goalDisplayTitle(goal))}</strong></span>`;
    const showLabel = () => {
      indexTooltip.textContent = goalDisplayTitle(goal);
      indexTooltip.style.top = `${item.getBoundingClientRect().top - planIndex.getBoundingClientRect().top + 22}px`;
      indexTooltip.classList.remove('hidden');
    };
    item.addEventListener('mouseenter', showLabel);
    item.addEventListener('focus', showLabel);
    item.addEventListener('mouseleave', () => indexTooltip.classList.add('hidden'));
    item.addEventListener('blur', () => indexTooltip.classList.add('hidden'));
    item.addEventListener("click", () => {
      document.querySelector(`article[data-goal-id="${goal.id}"]`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: "start" });
      setPlanIndexActive(goal.id);
    });
    planIndexList.appendChild(item);
    if (index === 0) setPlanIndexActive(goal.id);
  });
}

function setStepComposer(form, open) {
  form.classList.toggle("hidden", !open);
  if (open) requestAnimationFrame(() => form.querySelector('input[type="text"]')?.focus());
}

function setupInlineEdit({ trigger, form, input, save }) {
  const close = (restoreFocus = true) => {
    form.classList.add("hidden");
    trigger.classList.remove("hidden");
    if (restoreFocus) trigger.focus({ preventScroll: true });
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
      if (!form.contains(document.activeElement) && input.value.trim() === trigger.textContent.trim()) close(false);
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
      showToast("Project reopened.");
    });
    completedDirectionsList.appendChild(row);
  });
}

async function loadGoals() {
  const [goals, queue] = await Promise.all([api("/goals"), api("/queue")]);
  queuedTaskIds = new Set(Array.isArray(queue) ? queue.map(({task}) => task.id) : []);
  planGoalsCache = goals;
  planTasks.clear();
  updatePlanOverview();
  const activeGoals = goals.filter((goal) => !goal.completed || goal.goal_type === "standalone");
  const finishedGoals = goals.filter((goal) => goal.completed && goal.goal_type !== "standalone");
  goalsContainer.innerHTML = "";
  renderPlanIndex(activeGoals);
  renderCompletedDirections(finishedGoals);
  if (!activeGoals.length) {
    goalsContainer.innerHTML = '<section class="plan-empty panel"><p class="kicker">An open page</p><h2>Start with a project or a task.</h2><p>Projects give an idea room for tasks and subtasks. Tasks is a simple list for everything else.</p></section>';
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
          document.querySelector(`#goal-${goal.id} .goal-title`)?.focus();
          showToast("Project renamed.");
        },
      });
    }
    const description = node.querySelector(".goal-description");
    description.textContent = goal.description || "";
    description.classList.toggle("hidden", !goal.description);

    setupMenu(node.querySelector('.goal-more'), node.querySelector('.goal-menu'), goalDisplayTitle(goal));
    const renameGoal = node.querySelector('.rename-goal');
    if (goal.goal_type === 'standalone') renameGoal.remove();
    else renameGoal.addEventListener('click', () => goalTitle.click());
    const collapseGoal = node.querySelector(".goal-collapse");
    section.querySelector('.goal-body').id = `goal-body-${goal.id}`;
    collapseGoal.setAttribute('aria-controls', `goal-body-${goal.id}`);
    const expandGoal = () => {
      section.classList.remove('is-collapsed');
      collapseGoal.setAttribute('aria-expanded', 'true');
      collapseGoal.setAttribute('aria-label', `Collapse ${goalDisplayTitle(goal)}`);
      collapsedGoalIds.delete(goal.id);
      saveCollapsedGoalIds();
    };
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

    const taskForm = node.querySelector(".task-form");
    const goalAddStep = node.querySelector(".goal-add-step");
    if (goal.goal_type === "standalone") {
      goalAddStep.setAttribute("aria-label", "Add task");
      goalAddStep.querySelector(".goal-action-label").textContent = "Add task";
      taskForm.querySelector(".step-composer-label").textContent = "New task";
      taskForm.querySelector("input").placeholder = "What needs doing?";
    }
    goalAddStep.addEventListener("click", () => {
      expandGoal();
      setStepComposer(taskForm, taskForm.classList.contains("hidden"));
    });
    taskForm.querySelector(".cancel-step-composer").addEventListener("click", () => { setStepComposer(taskForm, false); goalAddStep.focus(); });

    node.querySelector(".delete-goal").addEventListener("click", async () => {
      if (!window.confirm(`Remove “${goalDisplayTitle(goal)}” and every step inside it?`)) return;
      await api(`/goals/${goal.id}`, { method: "DELETE" });
      await loadGoals();
      showToast("Project removed.");
    });

    const moveUp = node.querySelector(".goal-move-up");
    const moveDown = node.querySelector(".goal-move-down");
    moveUp.disabled = goalIndex === 0;
    moveDown.disabled = goalIndex === activeGoals.length - 1;
    moveUp.setAttribute("aria-label", `Move ${goalDisplayTitle(goal)} up`);
    moveDown.setAttribute("aria-label", `Move ${goalDisplayTitle(goal)} down`);
    const moveDirection = async (delta, trigger) => {
      const anchorTop = section.querySelector(".goal-more").getBoundingClientRect().top;
      const selector = ".goal-more";
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
        showToast("Could not move this project.", true);
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
      goalAddStep.focus();
      showToast(goal.goal_type === "standalone" ? "Task added." : "Step added.");
    });
    goalsContainer.appendChild(node);
    taskLoads.push(loadTasks(goal.id));
  }
  scheduleNavigationUpdate();
  await Promise.all(taskLoads);
  scheduleNavigationUpdate();
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
  const siblings = siblingsOf(task, allTasks);
  const activeIds = siblings.filter(item => !item.completed).map(item => item.id);
  const index = activeIds.indexOf(task.id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= activeIds.length) return;
  [activeIds[index], activeIds[target]] = [activeIds[target], activeIds[index]];
  let activeIndex = 0;
  const ids = siblings.map(item => item.completed ? item.id : activeIds[activeIndex++]);
  await api("/tasks/reorder", { method: "POST", body: JSON.stringify({ ordered_ids: ids }) });
  await loadTasks(task.goal_id);
  document.querySelector(`[data-task-id="${task.id}"] .task-more`)?.focus();
}

function renderCompletedTasks(section, tasks) {
  const completed = tasks
    .filter(task => {
      if (!task.completed) return false;
      let parent = tasks.find(item => item.id === task.parent_id);
      while (parent) {
        if (!parent.completed) return false; // Finished children stay beside their active parent.
        parent = tasks.find(item => item.id === parent.parent_id);
      }
      return true;
    })
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
  planTasks.set(goalId, tasks);
  updatePlanOverview();
  const section = document.querySelector(`article[data-goal-id="${goalId}"]`);
  if (!section) return;
  const list = section.querySelector(".goal-task-list");
  list.innerHTML = "";
  tasks
    .filter((task) => task.parent_id === null && !task.completed)
    .sort((a, b) => (a.position - b.position) || (a.id - b.id))
    .forEach((task) => renderTask(task, tasks, list, section.dataset.goalType));
  const leaves = leafTasks(tasks);
  const completed = tasks.filter((task) => task.completed).length;
  const itemNoun = section.dataset.goalType === "standalone" ? "tasks" : "steps";
  section.querySelector(".goal-progress-copy").textContent = tasks.length
    ? `${completed} / ${tasks.length} complete`
    : `No ${itemNoun} yet`;
  const activeRoots = tasks.filter((task) => task.parent_id === null && !task.completed);
  section.querySelector(".goal-empty-state").classList.toggle("hidden", activeRoots.length !== 0);
  renderCompletedTasks(section, tasks);
  const goalComplete = section.querySelector(".goal-complete");
  const goalType = section.dataset.goalType;
  const readyToClose = goalType !== "standalone"
    && tasks.some((task) => task.parent_id === null)
    && tasks.filter((task) => task.parent_id === null).every((task) => task.completed);
  goalComplete.classList.toggle("hidden", !readyToClose);
  const allLeavesDone = leaves.length > 0 && leaves.every(task => task.completed) && goalType !== 'standalone';
  section.querySelector('.goal-status').classList.toggle('hidden', !allLeavesDone);
  section.querySelector('.goal-status-copy').textContent = readyToClose ? 'Everything is complete.' : 'Subtasks finished. Check each parent task when it feels complete.';
  section.querySelector('.goal-empty-state').textContent = tasks.length ? 'All clear. Add another step whenever you need one.' : goalType === 'standalone' ? 'A place for the small things. Add your first task.' : 'Add a step when you’re ready to begin.';
  if (readyToClose) {
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
  const subtaskForm = node.querySelector(".subtask-form");
  const subtaskList = node.querySelector(".subtask-list");
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
      document.querySelector(`[data-task-id="${task.id}"] .task-title`)?.focus();
      showToast("Task renamed.");
    },
  });

  taskRow.classList.toggle('task-is-complete', task.completed);
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `${task.completed ? 'Reopen task' : 'Complete task'}: ${task.title}`);
  if (!isLeaf) checkbox.title = 'Completing this task also completes its subtasks';
  checkbox.addEventListener('change', async () => {
    const completing = checkbox.checked;
    const visibleControls = [...document.querySelectorAll(`#goal-${task.goal_id} .goal-task-list .task-completed`)].filter(control => control.offsetParent !== null);
    const previousIndex = visibleControls.indexOf(checkbox);
    const restoreFocus = () => {
      const section = document.getElementById(`goal-${task.goal_id}`);
      const replacement = section?.querySelector(`[data-task-id="${task.id}"] > .task-row .task-completed`);
      const remaining = [...(section?.querySelectorAll('.goal-task-list .task-completed') || [])].filter(control => control.offsetParent !== null);
      const target = replacement && replacement.offsetParent !== null ? replacement : remaining[Math.min(previousIndex,remaining.length - 1)] || section?.querySelector('.goal-add-step');
      target?.focus({preventScroll:true});
    };
    const subtreeIds = new Set([task.id]);
    const collectChildren = parent => childrenOf(parent, allTasks).forEach(child => { subtreeIds.add(child.id); collectChildren(child); });
    collectChildren(task);
    const previouslyOpenIds = allTasks.filter(item => subtreeIds.has(item.id) && !item.completed).map(item => item.id);
    checkbox.disabled = true;
    taskRow.classList.add('is-completing');
    try {
      await api(`/tasks/${task.id}`, {method:'PATCH', body:JSON.stringify({completed:completing})});
      await loadTasks(task.goal_id);
      restoreFocus();
      showToast(completing ? (isLeaf ? 'Task completed.' : 'Task and subtasks completed.') : 'Task reopened.', false, {
        label:'Undo',
        run: async () => {
          if (completing) {
            for (const id of previouslyOpenIds) await api(`/tasks/${id}`, {method:'PATCH',body:JSON.stringify({completed:false})});
          } else await api(`/tasks/${task.id}`, {method:'PATCH',body:JSON.stringify({completed:true})});
          await loadTasks(task.goal_id);
          restoreFocus();
        },
      });
    } catch(error) { checkbox.checked = task.completed; taskRow.classList.remove('is-completing'); showToast(error.message,true); }
    finally { checkbox.disabled = false; }
  });

  if (isLeaf) {
    chevron.remove();
    progress.remove();
  } else {
    const completedChildren = children.filter(child => child.completed).length;
    progress.textContent = `${completedChildren} / ${children.length} subtasks complete`;
    chevron.classList.remove('hidden');
    subtaskList.id = `task-children-${task.id}`;
    chevron.setAttribute('aria-controls', subtaskList.id);
    const collapsed = collapsedTaskIds.has(task.id);
    taskNode.classList.toggle('is-collapsed', collapsed);
    chevron.setAttribute('aria-expanded', String(!collapsed));
    chevron.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${task.title}`);
    chevron.addEventListener('click', () => {
      const willCollapse = !taskNode.classList.contains('is-collapsed');
      taskNode.classList.toggle('is-collapsed', willCollapse);
      chevron.setAttribute('aria-expanded', String(!willCollapse));
      chevron.setAttribute('aria-label', `${willCollapse ? 'Expand' : 'Collapse'} ${task.title}`);
      if (willCollapse) collapsedTaskIds.add(task.id); else collapsedTaskIds.delete(task.id);
      saveCollapsedTaskIds();
    });
  }

  remove.setAttribute("aria-label", `Remove ${task.title}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Remove “${task.title}”${children.length ? " and its smaller steps" : ""}?`)) return;
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    await loadTasks(task.goal_id);
    showToast("Task removed.");
  });

  if (task.depth >= MAX_DEPTH || goalType === "standalone" || task.completed) {
    add.remove();
    subtaskForm.remove();
  } else {
    add.setAttribute("aria-label", `Add a smaller step under ${task.title}`);
    add.addEventListener("click", () => {
      taskNode.classList.remove('is-collapsed'); collapsedTaskIds.delete(task.id); saveCollapsedTaskIds();
      chevron.setAttribute('aria-expanded','true'); chevron.setAttribute('aria-label', `Collapse ${task.title}`);
      setStepComposer(subtaskForm, subtaskForm.classList.contains("hidden"));
    });
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
  }

  setupMenu(node.querySelector('.task-more'), node.querySelector('.task-menu'), task.title);
  node.querySelector('.rename-task').addEventListener('click', () => title.click());
  const queueButton = node.querySelector('.queue-task');
  if (!isLeaf || task.completed) queueButton.remove();
  else {
    const updateQueueLabel = () => { queueButton.textContent = queuedTaskIds.has(task.id) ? 'Remove from focus queue' : 'Add to focus queue'; };
    updateQueueLabel();
    queueButton.addEventListener('click', async () => {
      const removing = queuedTaskIds.has(task.id);
      queueButton.disabled = true;
      try {
        const queue = await api(`/queue/${task.id}`, {method: removing ? 'DELETE' : 'POST'});
        queuedTaskIds = new Set(queue.map(({task}) => task.id));
        updateQueueLabel();
        showToast(removing ? 'Removed from your focus queue. Task kept in Plan.' : 'Added to your focus queue. Find it on Today.');
      } catch(error) { showToast(error.message,true); }
      finally { queueButton.disabled = false; }
    });
  }
  const siblings = siblingsOf(task, allTasks).filter(item => !item.completed);
  for (const [selector, delta] of [['.task-move-up', -1], ['.task-move-down', 1]]) {
    const button = node.querySelector(selector);
    const target = siblings.findIndex(item => item.id === task.id) + delta;
    button.disabled = task.completed || target < 0 || target >= siblings.length;
    button.addEventListener('click', () => moveTaskBy(task, allTasks, delta));
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
  children.forEach((child) => renderTask(child, allTasks, subtaskList, goalType));
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


  return { loadGoals, handleKey() { return false; }};
}
