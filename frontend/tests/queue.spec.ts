import { test, expect, type Page } from '@playwright/test';

type Goal = { id: number; title: string; description: null; goal_type: string; completed: boolean; position: number };
type Task = { id: number; goal_id: number; parent_id: number | null; depth: number; title: string; completed: boolean; position: number };

/** Keep the fake server alive across reloads so persistence is actually checked. */
async function mockQueueApi(page: Page, initialQueue: number[] = []) {
  const goals: Goal[] = [
    { id: 1, title: 'Write thesis', description: null, goal_type: 'project', completed: false, position: 1 },
    { id: 2, title: 'Tasks', description: null, goal_type: 'standalone', completed: false, position: 2 },
    { id: 3, title: 'Closed project', description: null, goal_type: 'project', completed: true, position: 3 },
  ];
  const tasks: Task[] = [
    { id: 11, goal_id: 1, parent_id: null, depth: 1, title: 'Outline the chapter', completed: false, position: 1 },
    { id: 12, goal_id: 1, parent_id: null, depth: 1, title: 'Review the references', completed: false, position: 2 },
    { id: 13, goal_id: 1, parent_id: null, depth: 1, title: 'Research section', completed: false, position: 3 },
    { id: 14, goal_id: 1, parent_id: 13, depth: 2, title: 'Compare findings', completed: false, position: 1 },
    { id: 15, goal_id: 1, parent_id: null, depth: 1, title: 'Finished draft', completed: true, position: 4 },
    { id: 21, goal_id: 2, parent_id: null, depth: 1, title: 'Pay electricity bill', completed: false, position: 1 },
    { id: 31, goal_id: 3, parent_id: null, depth: 1, title: 'Hidden old task', completed: false, position: 1 },
  ];
  const state = {
    goals, tasks, queueIds: [...initialQueue], rejectNextSave: false,
    writes: [] as { method: string; path: string; body: any }[],
  };
  const queueItems = () => state.queueIds.flatMap(id => {
    const task = tasks.find(item => item.id === id);
    const goal = goals.find(item => item.id === task?.goal_id);
    return task && goal && !task.completed && !goal.completed && !tasks.some(item => item.parent_id === id)
      ? [{ task, goal }] : [];
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (path === '/api/config' || path === '/config') return route.fulfill({json:{auth_mode:'local'}});
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() : null;
    if (method !== 'GET') state.writes.push({ method, path, body });
    if (path === '/dashboard') {
      return route.fulfill({ json: {
        goals: goals.filter(goal => !goal.completed).map(goal => ({ goal, tasks: tasks.filter(task => task.goal_id === goal.id) })),
        queue: queueItems(), stats: { current_streak: 0, total_sessions: 0, total_minutes: 0 }, week_sessions: 0, activity: [],
      } });
    }
    if (path === '/queue' && method === 'PUT') {
      if (state.rejectNextSave) {
        state.rejectNextSave = false;
        return route.fulfill({ status: 503, json: { detail: 'Queue could not be saved. Try again.' } });
      }
      state.queueIds = [...body.ordered_ids];
      return route.fulfill({ json: queueItems() });
    }
    if (path === '/queue' && method === 'GET') return route.fulfill({ json: queueItems() });
    const queueMatch = path.match(/^\/queue\/(\d+)$/);
    if (queueMatch && method === 'DELETE') {
      state.queueIds = state.queueIds.filter(id => id !== Number(queueMatch[1]));
      return route.fulfill({ json: queueItems() });
    }
    const taskMatch = path.match(/^\/tasks\/(\d+)$/);
    if (taskMatch && method === 'PATCH') {
      const task = tasks.find(item => item.id === Number(taskMatch[1]));
      if (!task) return route.fulfill({ status: 404, json: { detail: 'Task not found' } });
      Object.assign(task, body);
      return route.fulfill({ json: task });
    }
    if (path === '/goals' && method === 'GET') return route.fulfill({ json: goals });
    const goalTasksMatch = path.match(/^\/goals\/(\d+)\/tasks$/);
    if (goalTasksMatch && method === 'GET') return route.fulfill({ json: tasks.filter(task => task.goal_id === Number(goalTasksMatch[1])) });
    if (path === '/health') return route.fulfill({ json: { ok: true, ai_breakdown_configured: false } });
    if (path === '/focus-options' || path === '/sessions') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: `Unmocked request: ${method} ${path}` } });
  });
  return state;
}

const queueTitles = (page: Page) => page.locator('#today-agenda .agenda-title');
const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose what comes next' });

test('picker offers parents and smaller steps and saves chosen tasks in a custom order that survives reload', async ({ page }) => {
  const state = await mockQueueApi(page);
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'What matters next?' })).toBeVisible();
  await page.locator('#edit-queue').click();
  await expect(picker(page).getByRole('checkbox', { name: 'Research section', exact: true })).toBeVisible();
  await expect(picker(page).getByRole('checkbox', { name: 'Finished draft', exact: true })).toHaveCount(0);
  await expect(picker(page).getByRole('checkbox', { name: 'Hidden old task', exact: true })).toHaveCount(0);
  await expect(picker(page).getByRole('checkbox', { name: /Compare findings/ })).toBeVisible();

  await picker(page).getByRole('checkbox', { name: 'Outline the chapter', exact: true }).check();
  await picker(page).getByRole('checkbox', { name: 'Review the references', exact: true }).check();
  await picker(page).getByRole('checkbox', { name: 'Pay electricity bill', exact: true }).check();
  await picker(page).locator('.queue-draft summary').click();
  await picker(page).getByRole('button', { name: 'Move up: Review the references', exact: true }).click();
  await picker(page).getByRole('button', { name: 'Unselect Pay electricity bill', exact: true }).click();
  await expect(picker(page).getByRole('status')).toHaveText('2 selected');
  await picker(page).getByRole('button', { name: 'Save priorities', exact: true }).click();

  await expect(picker(page)).toBeHidden();
  await expect(queueTitles(page)).toHaveText(['Review the references', 'Outline the chapter']);
  expect(state.queueIds).toEqual([12, 11]);
  expect(state.writes).toEqual([{ method: 'PUT', path: '/queue', body: { ordered_ids: [12, 11] } }]);
  await page.reload();
  await expect(queueTitles(page)).toHaveText(['Review the references', 'Outline the chapter']);
  await page.locator('#edit-queue').click();
  await expect(picker(page).getByRole('checkbox', { name: 'Outline the chapter', exact: true })).toBeChecked();
  await expect(picker(page).getByRole('checkbox', { name: 'Pay electricity bill', exact: true })).not.toBeChecked();
});

test('queue menu reorders and removes membership while keeping the task in Plan', async ({ page }) => {
  const state = await mockQueueApi(page, [11, 12, 21]);
  await page.goto('/#dashboard');
  await page.getByRole('button', { name: 'Queue options for Outline the chapter', exact: true }).click();
  await page.getByRole('group', { name: 'Queue task actions' }).getByRole('button', { name: 'Move down', exact: true }).click();
  await expect(queueTitles(page)).toHaveText(['Review the references', 'Outline the chapter', 'Pay electricity bill']);
  await page.getByRole('button', { name: 'Queue options for Outline the chapter', exact: true }).click();
  await page.getByRole('button', { name: 'Remove priority', exact: true }).click();
  await expect(queueTitles(page)).toHaveText(['Review the references', 'Pay electricity bill']);
  expect(state.queueIds).toEqual([12, 21]);
  expect(state.tasks.find(task => task.id === 11)?.completed).toBe(false);
  expect(state.writes).toEqual([
    { method: 'PUT', path: '/queue', body: { ordered_ids: [12, 11, 21] } },
    { method: 'DELETE', path: '/queue/11', body: null },
  ]);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.locator('[data-task-id="11"] .task-title')).toHaveText('Outline the chapter');
});

test('completing a queued task and Undo restores its position', async ({ page }) => {
  const state = await mockQueueApi(page, [12, 11]);
  await page.goto('/#dashboard');
  await page.getByRole('button', { name: 'Complete Review the references', exact: true }).click();
  await expect(queueTitles(page)).toHaveText(['Outline the chapter']);
  expect(state.tasks.find(task => task.id === 12)?.completed).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(queueTitles(page)).toHaveText(['Review the references', 'Outline the chapter']);
  expect(state.tasks.find(task => task.id === 12)?.completed).toBe(false);
  expect(state.queueIds).toEqual([12, 11]);
  expect(state.writes).toEqual([
    { method: 'PATCH', path: '/tasks/12', body: { completed: true } },
    { method: 'PATCH', path: '/tasks/12', body: { completed: false } },
  ]);
});

test('Cancel and Escape discard picker changes and restore focus to the opener', async ({ page }) => {
  const state = await mockQueueApi(page, [11]);
  await page.goto('/#dashboard');
  const opener = page.locator('#edit-queue');
  await opener.click();
  await picker(page).getByRole('checkbox', { name: 'Review the references', exact: true }).check();
  await picker(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker(page)).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(queueTitles(page)).toHaveText(['Outline the chapter']);

  await opener.click();
  await expect(picker(page).getByRole('checkbox', { name: 'Review the references', exact: true })).not.toBeChecked();
  await picker(page).getByRole('checkbox', { name: 'Outline the chapter', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await expect(opener).toBeFocused();
  expect(state.writes).toEqual([]);
  expect(state.queueIds).toEqual([11]);
  await opener.click();
  await expect(picker(page).getByRole('checkbox', { name: 'Outline the chapter', exact: true })).toBeChecked();
});

test('failed save keeps selections and allows a safe retry', async ({ page }) => {
  const state = await mockQueueApi(page, [11]);
  state.rejectNextSave = true;
  await page.goto('/#dashboard');
  await page.locator('#edit-queue').click();
  await picker(page).getByLabel('Find a task').fill('references');
  await picker(page).getByRole('checkbox', { name: 'Review the references', exact: true }).check();
  await picker(page).getByRole('button', { name: 'Save priorities', exact: true }).click();
  await expect(picker(page).getByRole('alert')).toContainText('Queue could not be saved. Try again.');
  await expect(picker(page).getByRole('checkbox', { name: 'Review the references', exact: true })).toBeChecked();
  expect(state.queueIds).toEqual([11]);
  await picker(page).getByRole('button', { name: 'Save priorities', exact: true }).click();
  await expect(picker(page)).toBeHidden();
  await expect(queueTitles(page)).toHaveText(['Outline the chapter', 'Review the references']);
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
});

test('queue rows, action menu, and picker fit a narrow mobile viewport', async ({ page }) => {
  const state = await mockQueueApi(page, [11, 12, 21]);
  state.tasks[0].title = 'Review the chapter about very long task titles and their presentation on a small phone screen';
  state.goals[0].title = 'A project with an unusually long name that should still fit a mobile screen';
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#dashboard');
  await expect(queueTitles(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.queue-item').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
  await page.getByRole('button', { name: `Queue options for ${state.tasks[0].title}`, exact: true }).click();
  const menu = page.getByRole('group', { name: 'Queue task actions' });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('#edit-queue').click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole('button', { name: 'Save priorities', exact: true })).toBeInViewport();
  expect(await page.locator('.queue-picker').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('queue picker remains scrollable and save is reachable in short landscape windows', async ({page}) => {
  await mockQueueApi(page, [11,12,21]);
  await page.setViewportSize({width:768,height:375});
  await page.goto('/#dashboard');
  await page.locator('#edit-queue').click();
  const modal=page.locator('.queue-picker');
  expect(await modal.evaluate(node=>{
    const bounds=node.getBoundingClientRect();
    return bounds.top>=0 && bounds.bottom<=innerHeight && node.scrollWidth<=node.clientWidth;
  })).toBe(true);
  const save=picker(page).getByRole('button',{name:'Save priorities',exact:true});
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(picker(page)).toBeHidden();
});

test('empty queue offers one Choose priorities action', async ({page}) => {
  await mockQueueApi(page, []);
  await page.goto('/#dashboard');
  await expect(page.getByRole('button',{name:'Choose priorities',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Choose priorities',exact:true}).click();
  await expect(picker(page)).toBeVisible();
});
