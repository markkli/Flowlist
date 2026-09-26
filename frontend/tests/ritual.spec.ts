import { test, expect } from '@playwright/test';

const goal = {id:1,title:'Project',goal_type:'project',completed:false,position:1};
const task = {id:1,goal_id:1,parent_id:null,depth:1,title:'A task',completed:false,position:1};
const dashboard = {queue:[{task,goal}],goals:[{goal,tasks:[task]}],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]};
test.beforeEach(async ({page}) => {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config' || path === '/config') return route.fulfill({json:{auth_mode:'local'}});
    let json:any = {};
    if(path === '/api/dashboard') json=dashboard;
    if(path === '/api/goals') json=[goal];
    if(path === '/api/goals/1/tasks') json=[task];
    if(path === '/api/focus-options') json=[{...task,goal_title:goal.title}];
    if(path === '/api/sessions') json=[];
    await route.fulfill({json});
  });
});

test('refresh restores reflection and task selections; Escape keeps the draft', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  await page.getByRole('button',{name:'End session',exact:true}).first().click();
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeVisible();
  await page.getByLabel('What did you do?').fill('Kept my reflection');
  await page.getByLabel('Worked on A task', {exact:true}).check();
  await page.reload();
  await expect(page.getByLabel('What did you do?')).toHaveValue('Kept my reflection');
  await expect(page.getByLabel('Worked on A task',{exact:true})).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeHidden();
  await page.getByRole('button',{name:'Unsaved ritual · Review and save Open'}).click();
  await expect(page.getByLabel('What did you do?')).toHaveValue('Kept my reflection');
});

test('timer minimizes, retains plan navigation and restores after refresh', async ({page}) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  await expect(page.getByRole('dialog',{name:'Pomodoro timer'})).toBeVisible();
  await page.clock.fastForward(90000);
  await page.getByRole('button',{name:'Minimize timer'}).click();
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await expect(page).toHaveURL(/#goals$/);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Plan',exact:true})).toBeVisible();
  await expect(page.locator('#timer-mini')).toContainText(/23:[0-3][0-9]/);
  await page.locator('#timer-mini-open').click();
  await expect(page.getByRole('dialog',{name:'Pomodoro timer'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#timer-mini')).toBeVisible();
});

test('a failed save retries with the same ritual ID and keeps the reflection', async ({page}) => {
  const bodies:any[]=[];
  await page.route('**/api/sessions',async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill(bodies.length===1 ? {status:503,json:{detail:'Try again'}} : {json:{id:1}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  await page.locator('#focus-exit').click();
  await page.getByLabel('What did you do?').fill('Retry this safely');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('#attribution-error')).toContainText('Your ritual is saved on this device');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('#session-attribution-overlay')).toBeHidden();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[1].summary).toBe('Retry this safely');
});

test('quotes in titles remain text and do not create attributes', async ({page}) => {
  const title = 'Review "quoted" title" autofocus onfocus="alert(1)';
  await page.route('**/api/dashboard?*', route => route.fulfill({json:{...dashboard,queue:[{task:{...task,title},goal}],goals:[{goal,tasks:[{...task,title}]}]}}));
  await page.goto('/');
  await expect(page.locator('.agenda-title')).toHaveText(title);
  await expect(page.locator('.agenda-title')).toHaveAttribute('title',title);
  await expect(page.locator('[onfocus]')).toHaveCount(0);
});

test('deleted history can be restored with Undo', async ({page}) => {
  let removed = false;
  const session = {id:1,task_title:'Saved ritual',summary:'Notes',actual_minutes:25,created_at:'2026-09-19T10:00:00',attributions:[]};
  await page.route('**/api/sessions?*', route => route.fulfill({json:removed ? [] : [session]}));
  await page.route('**/api/sessions/1', route => { removed=true; return route.fulfill({json:{deleted:true}}); });
  await page.route('**/api/sessions/1/restore', route => { removed=false; return route.fulfill({json:session}); });
  await page.goto('/#history');
  await page.getByRole('button',{name:'All records',exact:true}).click();
  await page.getByRole('button',{name:'Delete Saved ritual'}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.session-title')).toHaveText('Saved ritual');
});

test('narrow layouts have no horizontal overflow', async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/#goals');
  await expect(page.getByRole('heading',{name:'Plan',exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('timer keyboard focus remains inside the dialog', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  for(let i=0;i<9;i++) {
    await page.keyboard.press('Tab');
    expect(await page.locator('#focus-overlay').evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
});

for(const width of [375,768,1024,1440]) {
  test(`dark and light layouts at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:width === 768 ? 375 : 900});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/#goals');
    await expect(page.getByRole('heading',{name:'Plan',exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Switch color theme'}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('attribution remains usable on a narrow screen with enlarged text', async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/');
  await page.addStyleTag({content:'body { font-size: 20px; }'});
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  await page.locator('#focus-exit').click();
  await page.getByLabel('What did you do?').fill('A note kept for later');
  await page.getByRole('button',{name:'Save later',exact:true}).click();
  await expect(page.locator('#timer-mini')).toContainText('Unsaved ritual');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('retired task drafts are preserved in the note without creating tasks', async ({page}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('flowlist-ritual-v2')) return;
    localStorage.setItem('flowlist-ritual-v2', JSON.stringify({
      id:'legacy-task-draft', phase:'awaiting-attribution', elapsedSeconds:1500, round:1,
      settings:{focus:25,break:5,rounds:4,longBreak:15}, deadline:Date.now(), blockSeconds:1500,
      breakKind:'short', minimized:false, summary:'Session notes', selections:[],
      draftTask:'Remember this', draftDestination:'__tasks__', draftGroup:'Website', draftGroupType:'project'
    }));
  });
  await page.goto('/');
  await expect(page.locator('#session-summary')).toHaveValue('Session notes\n\nUnadded task: Remember this (Website)');
  await expect(page.getByText('Add a missing task',{exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#session-summary')).toHaveValue('Session notes\n\nUnadded task: Remember this (Website)');
});

test('saved ritual includes actual focus intervals and excludes the break',async({page})=>{
  await page.clock.install({time:new Date('2026-09-19T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-09-19T12:00:00Z'));
  const bodies:any[]=[];
  await page.route('**/api/sessions',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({json:{id:1}});});
  await page.goto('/');
  await page.getByRole('button',{name:/Start a 25-minute/}).click();
  // Start acquires a browser lock asynchronously; wait for the running UI before advancing time.
  await expect(page.locator('#focus-overlay')).toBeVisible();
  await expect(page.locator('#focus-phase-label')).toHaveText('Focus');
  await page.clock.fastForward(70000);
  await page.locator('#focus-skip').click();
  await expect(page.locator('#focus-phase-label')).toHaveText('Short break');
  await page.clock.fastForward(30000);
  await page.locator('#focus-skip').click();
  await expect(page.locator('#focus-phase-label')).toHaveText('Focus');
  await page.clock.fastForward(65000);
  await page.locator('#focus-exit').click();
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('#session-attribution-overlay')).toBeHidden();
  expect(bodies[0].actual_minutes).toBe(2);
  expect(bodies[0].blocks).toHaveLength(2);
  const [first,second]=bodies[0].blocks;
  expect(Date.parse(first.ended_at)-Date.parse(first.started_at)).toBe(70000);
  expect(Date.parse(second.started_at)-Date.parse(first.ended_at)).toBe(30000);
  expect(Date.parse(second.ended_at)-Date.parse(second.started_at)).toBe(65000);
});
