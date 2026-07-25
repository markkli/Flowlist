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
      const input = event.target.querySelector("input");
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
  const list = document.querySelector(`section[data-goal-id="${goalId}"] .task-list`);
  list.innerHTML = "";
  for (const task of tasks) {
    const node = taskTemplate.content.cloneNode(true);
    const checkbox = node.querySelector(".task-completed");
    const title = node.querySelector(".task-title");
    checkbox.checked = task.completed;
    title.textContent = task.title;
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

loadGoals();
