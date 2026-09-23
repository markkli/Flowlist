import { test, expect, type Page } from '@playwright/test';

const project = {id: 1, title: 'Release Flowlist', goal_type: 'project', completed: false, position: 1};
const learning = {id: 2, title: 'Learn typography', goal_type: 'learning', completed: false, position: 2};
const tasks = [
  {id: 10, goal_id: 1, parent_id: null, depth: 1, title: 'Ship the release', completed: false, position: 0},
  {id: 11, goal_id: 1, parent_id: 10, depth: 2, title: 'Review changes', completed: false, position: 0},
  {id: 12, goal_id: 1, parent_id: 10, depth: 2, title: 'Publish release notes', completed: false, position: 1},
  {id: 20, goal_id: 2, parent_id: null, depth: 1, title: 'Study spacing', completed: false, position: 0},
];

async function openCheckout(page: Page, selections: {task_id: number; completed: boolean}[] = []) {
  const sessionBodies: any[] = [];
  const completedIds = new Set<number>();
  await page.addInitScript(({selections}) => {
    if (localStorage.getItem('flowlist-ritual-v2')) return;
    localStorage.setItem('flowlist-ritual-v2', JSON.stringify({
      id: 'hierarchy-ritual', phase: 'awaiting-attribution', elapsedSeconds: 1500, round: 1,
      settings: {focus: 25, break: 5, rounds: 4, longBreak: 15}, deadline: Date.now(), blockSeconds: 1500,
      breakKind: 'short', minimized: false, summary: 'A focused release session', selections,
      draftTask: '', draftDestination: '__tasks__', draftGroup: '', draftGroupType: 'project',
    }));
  }, {selections});
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config' || path === '/config') return route.fulfill({json:{auth_mode:'local'}});
    let json: any = {};
    const currentTasks = tasks.map(task => ({...task, completed: completedIds.has(task.id)}));
    if (path === '/api/goals') json = [project, learning];
    if (path === '/api/goals/1/tasks') json = currentTasks.filter(task => task.goal_id === 1);
    if (path === '/api/goals/2/tasks') json = currentTasks.filter(task => task.goal_id === 2);
    if (path === '/api/queue') json = [];
    if (path === '/api/dashboard') json = {
      queue: [], goals: [project, learning].map(goal => ({goal, tasks: currentTasks.filter(task => task.goal_id === goal.id)})),
      stats: {current_streak: 0, total_sessions: sessionBodies.length, total_minutes: sessionBodies.length * 25}, week_sessions: 0, activity: [],
    };
    if (path === '/api/focus-options') json = currentTasks.filter(task => !task.completed).map(task => ({
      ...task, goal_title: task.goal_id === 1 ? project.title : learning.title,
      goal_type: task.goal_id === 1 ? project.goal_type : learning.goal_type,
      has_children: tasks.some(child => child.parent_id === task.id), last_focused_at: null,
    }));
    if (path === '/api/sessions') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        sessionBodies.push(body);
        body.tasks.filter((task: any) => task.completed).forEach((task: any) => completedIds.add(task.task_id));
        json = {id: sessionBodies.length};
      } else json = [];
    }
    await route.fulfill({json});
  });
  await page.goto('/');
  await expect(page.getByRole('dialog', {name: 'Where did this focus go?'})).toBeVisible();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).toBeVisible();
  return sessionBodies;
}

async function expectDraft(page: Page, selections: {task_id: number; completed: boolean}[]) {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('flowlist-ritual-v2')!).selections)).toEqual(selections);
}

test('finishing a parent includes its subtasks, survives refresh, and saves one ritual', async ({page}) => {
  const bodies = await openCheckout(page);
  await expect(page.locator('.attribution-group-heading h3')).toHaveText(['Release Flowlist', 'Learn typography']);
  await expect(page.locator('.attribution-task-row').first()).toHaveAttribute('data-task-id', '10');
  await expect(page.locator('.attribution-task-row[data-task-id="11"]')).toHaveClass(/is-subtask/);
  await page.getByLabel('Finished Ship the release', {exact: true}).check();
  for (const title of ['Ship the release', 'Review changes', 'Publish release notes']) {
    await expect(page.getByLabel(`Finished ${title}`, {exact: true})).toBeChecked();
    await expect(page.getByLabel(`Worked on ${title}`, {exact: true})).toBeChecked();
  }
  await expect(page.getByLabel('Finished Study spacing', {exact: true})).not.toBeChecked();
  const selections = [{task_id: 10, completed: true}, {task_id: 11, completed: true}, {task_id: 12, completed: true}];
  await expectDraft(page, selections);
  await page.reload();
  await expect(page.getByLabel('Finished Review changes', {exact: true})).toBeChecked();
  await page.getByRole('button', {name: 'Save ritual', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Where did this focus go?'})).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].tasks).toEqual(selections);
  expect(bodies[0].actual_minutes).toBe(25);
  expect(bodies[0].summary).toBe('A focused release session');
});

test('finishing every subtask leaves the parent task open', async ({page}) => {
  const bodies = await openCheckout(page);
  await page.getByLabel('Finished Review changes', {exact: true}).check();
  await page.getByLabel('Finished Publish release notes', {exact: true}).check();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Worked on Ship the release', {exact: true})).not.toBeChecked();
  await page.getByRole('button', {name: 'Save ritual', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Where did this focus go?'})).toBeHidden();
  expect(bodies[0].tasks).toEqual([{task_id: 11, completed: true}, {task_id: 12, completed: true}]);
});

test('reopening one subtask clears parent Finished and retains the other selections', async ({page}) => {
  await openCheckout(page);
  await page.getByLabel('Finished Ship the release', {exact: true}).check();
  await page.getByLabel('Finished Review changes', {exact: true}).uncheck();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Worked on Ship the release', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Worked on Review changes', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Finished Publish release notes', {exact: true})).toBeChecked();
  await expectDraft(page, [{task_id: 10, completed: false}, {task_id: 11, completed: false}, {task_id: 12, completed: true}]);
  await page.reload();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Finished Review changes', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Finished Publish release notes', {exact: true})).toBeChecked();
});

test('clearing the parent selection preserves the subtasks and supports separate work attribution', async ({page}) => {
  await openCheckout(page);
  await page.getByLabel('Finished Ship the release', {exact: true}).check();
  await page.getByLabel('Finished Ship the release', {exact: true}).uncheck();
  await expect(page.getByLabel('Finished Review changes', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Finished Publish release notes', {exact: true})).toBeChecked();
  await page.getByLabel('Worked on Review changes', {exact: true}).uncheck();
  await expect(page.getByLabel('Finished Review changes', {exact: true})).not.toBeChecked();
  await page.getByLabel('Worked on Study spacing', {exact: true}).check();
  await expectDraft(page, [{task_id: 10, completed: false}, {task_id: 12, completed: true}, {task_id: 20, completed: false}]);
});

test('Worked on remains independent and deselecting a subtask also reopens its parent', async ({page}) => {
  await openCheckout(page);
  await page.getByLabel('Worked on Ship the release', {exact: true}).check();
  await expect(page.getByLabel('Worked on Review changes', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).not.toBeChecked();
  await page.getByLabel('Finished Ship the release', {exact: true}).check();
  await page.getByLabel('Worked on Review changes', {exact: true}).uncheck();
  await expect(page.getByLabel('Finished Ship the release', {exact: true})).not.toBeChecked();
  await expect(page.getByLabel('Worked on Ship the release', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Finished Review changes', {exact: true})).not.toBeChecked();
  await expectDraft(page, [{task_id: 10, completed: false}, {task_id: 12, completed: true}]);
});

test('restoring an older parent-only draft reconciles all descendants before save', async ({page}) => {
  await page.setViewportSize({width: 375, height: 812});
  await openCheckout(page, [{task_id: 10, completed: true}]);
  await expect(page.getByLabel('Finished Review changes', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Finished Publish release notes', {exact: true})).toBeChecked();
  await expectDraft(page, [{task_id: 10, completed: true}, {task_id: 11, completed: true}, {task_id: 12, completed: true}]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
