import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => {
  const goals = [
    {id:1,title:'AI engineering',goal_type:'learning',completed:false,position:1},
    {id:2,title:'Responsive QA',goal_type:'project',completed:false,position:2},
    {id:3,title:'Tasks',goal_type:'standalone',completed:false,position:3},
  ];
  const tasks = [
    {id:1,goal_id:1,parent_id:null,depth:1,title:'Learn retrieval',completed:false,position:1},
    {id:2,goal_id:1,parent_id:1,depth:2,title:'Build an index',completed:false,position:1},
    {id:3,goal_id:1,parent_id:1,depth:2,title:'Evaluate results',completed:false,position:2},
    {id:4,goal_id:3,parent_id:null,depth:1,title:'Pay bill',completed:false,position:1},
    {id:5,goal_id:3,parent_id:null,depth:1,title:'Read notes',completed:false,position:3},
    {id:6,goal_id:3,parent_id:null,depth:1,title:'Archived sibling',completed:true,position:2},
  ];
  let queueIds:number[] = [];
  const queue = () => queueIds.map(id => ({task:tasks.find(t=>t.id===id),goal:goals.find(g=>g.id===tasks.find(t=>t.id===id)?.goal_id)}));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api','');
    if (path === '/api/config' || path === '/config') return route.fulfill({json:{auth_mode:'local'}});
    const method = route.request().method();
    let json:any = {};
    if(path === '/dashboard') json={queue:queue(),goals:goals.map(goal=>({goal,tasks:tasks.filter(t=>t.goal_id===goal.id)})),stats:{current_streak:0,total_sessions:0,total_minutes:0},activity:[],week_sessions:0};
    if(path === '/goals') json=new URL(route.request().url()).searchParams.has('include_tasks') ? goals.map(goal=>({...goal,tasks:tasks.filter(t=>t.goal_id===goal.id)})) : goals;
    if(/^\/goals\/\d+\/tasks$/.test(path)) {
      const id=Number(path.split('/')[2]);
      if(method==='POST') tasks.push({id:tasks.length+1,goal_id:id,parent_id:null,depth:1,title:route.request().postDataJSON().title,completed:false,position:9});
      json=tasks.filter(t=>t.goal_id===id);
    }
    if(path==='/queue') json=queue();
    if(/^\/queue\/\d+$/.test(path)) {
      const id=Number(path.split('/')[2]);
      queueIds = method==='POST' ? [...new Set([...queueIds,id])] : queueIds.filter(i=>i!==id);
      json=queue();
    }
    if(path==='/tasks/reorder') {
      route.request().postDataJSON().ordered_ids.forEach((id:number, i:number)=>{tasks.find(t=>t.id===id)!.position=i;});
    }
    if(/^\/tasks\/\d+$/.test(path) && method==='PATCH') {
      const target=tasks.find(t=>t.id===Number(path.split('/')[2]))!;
      const changes=route.request().postDataJSON();
      Object.assign(target,changes);
      if(changes.completed===true) {
        const complete=(id:number)=>tasks.filter(t=>t.parent_id===id).forEach(t=>{t.completed=true;complete(t.id);});
        complete(target.id);
      }
      if(changes.completed===false) {
        let parent=tasks.find(t=>t.id===target.parent_id);
        while(parent) {parent.completed=false;parent=tasks.find(t=>t.id===parent!.parent_id);}
      }
    }
    if(path==='/focus-options' || path==='/sessions') json=[];
    await route.fulfill({json});
  });
});

test('collapsed sections stay compact; Add expands before focusing the composer', async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/#goals');
  const section=page.locator('#goal-1');
  await section.getByRole('button',{name:'Collapse AI engineering',exact:true}).click();
  expect((await section.boundingBox())!.height).toBeLessThan(120);
  await section.getByRole('button',{name:'Add step',exact:true}).click();
  await expect(section.getByLabel('New task',{exact:true})).toBeFocused();
  await section.getByLabel('New task',{exact:true}).fill('Build a prototype');
  await section.getByRole('button',{name:'Add',exact:true}).click();
  await expect(section.getByRole('button',{name:'Build a prototype',exact:true})).toBeVisible();
});

test('flat tasks have no hierarchy placeholders or second action row', async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/#goals');
  const row=page.locator('[data-task-id="4"] > .task-row');
  await expect(row.getByRole('button',{name:'Pay bill',exact:true})).toBeVisible();
  await expect(row.locator('.task-chevron')).toHaveCount(0);
  const metrics=await row.evaluate(el=>{
    const row=el.getBoundingClientRect(),title=el.querySelector('.task-title')!.getBoundingClientRect();
    return {height:row.height,indent:title.left-row.left};
  });
  expect(metrics.height).toBeLessThan(60);
  expect(metrics.indent).toBeLessThan(52);
});

test('menus stay in viewport, support arrows and Escape, and return focus after rename cancel', async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto('/#goals');
  const trigger=page.getByRole('button',{name:'Actions for Pay bill',exact:true});
  await trigger.click();
  const menu=page.getByRole('menu',{name:'Actions for Pay bill',exact:true});
  await expect(menu.getByRole('menuitem',{name:'Rename',exact:true})).toBeFocused();
  const bounds=(await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem',{name:'Move down',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused(); await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await expect(page.locator('[data-task-id="4"] .task-edit-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Pay bill',exact:true})).toBeFocused();
});

test('task menu reorder persists and leaves focus on the moved task', async ({page}) => {
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Actions for Read notes',exact:true}).click();
  await page.getByRole('menu',{name:'Actions for Read notes',exact:true}).getByRole('menuitem',{name:'Move up',exact:true}).click();
  await expect(page.locator('#goal-3 .task-title')).toHaveText(['Read notes','Pay bill']);
  await expect(page.getByRole('button',{name:'Actions for Read notes',exact:true})).toBeFocused();
  await page.reload();
  await expect(page.locator('#goal-3 .task-title')).toHaveText(['Read notes','Pay bill']);
});

test('leaving an unchanged title does not steal focus from its action menu', async ({page}) => {
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Pay bill',exact:true}).click();
  await expect(page.locator('[data-task-id="4"] .task-edit-title')).toBeFocused();
  await page.getByRole('button',{name:'Actions for Pay bill',exact:true}).click();
  await expect(page.getByRole('menu',{name:'Actions for Pay bill',exact:true}).getByRole('menuitem',{name:'Rename',exact:true})).toBeFocused();
  await expect(page.locator('[data-task-id="4"] .task-edit-title')).toBeHidden();
});

test('Plan has two creation choices and no AI drafting actions', async ({page}) => {
  await page.goto('/#goals');
  await expect(page.locator('[data-goal-create]')).toHaveCount(2);
  await expect(page.locator('.goal-type-label').first()).toHaveText('Project');
  await page.getByRole('button',{name:'Actions for Learn retrieval',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:/Draft/})).toHaveCount(0);
  await expect(page.getByRole('menuitem',{name:'Add a smaller step under Learn retrieval',exact:true})).toBeVisible();
});

test('stars prioritize parents and smaller steps, and unstar keeps the task', async ({page}) => {
  await page.goto('/#goals');
  const star=page.getByRole('button',{name:'Prioritize Learn retrieval',exact:true});
  await star.click();
  await expect(page.getByRole('button',{name:'Unstar Learn retrieval',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Prioritize Build an index',exact:true}).click();
  await expect(page.locator('#app-toast')).toContainText('Prioritized');
  await page.reload();
  await expect(page.getByRole('button',{name:'Unstar Learn retrieval',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Unstar Learn retrieval',exact:true}).click();
  await expect(page.getByRole('button',{name:'Prioritize Learn retrieval',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'Learn retrieval',exact:true})).toBeVisible();
});

test('each task keeps a checkbox; completing children leaves the parent open with its disclosure', async ({page}) => {
  await page.goto('/#goals');
  const parent=page.getByRole('checkbox',{name:'Complete task: Learn retrieval',exact:true});
  await expect(parent).toBeVisible();
  await expect(page.getByRole('button',{name:'Collapse Learn retrieval',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Complete task: Build an index',exact:true}).check();
  await expect(page.getByRole('checkbox',{name:'Reopen task: Build an index',exact:true})).toBeFocused();
  await page.getByRole('checkbox',{name:'Complete task: Evaluate results',exact:true}).check();
  await expect(parent).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Reopen task: Build an index',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Reopen task: Evaluate results',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Collapse Learn retrieval',exact:true}).click();
  await expect(parent).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Reopen task: Build an index',exact:true})).toBeHidden();
});

test('completing a parent cascades down and Undo preserves previously finished children', async ({page}) => {
  await page.goto('/#goals');
  await page.getByRole('checkbox',{name:'Complete task: Build an index',exact:true}).check();
  await page.getByRole('checkbox',{name:'Complete task: Learn retrieval',exact:true}).check();
  await expect(page.locator('#goal-1 .goal-task-list > .task-node')).toHaveCount(0);
  await expect(page.locator('#goal-1 .completed-count')).toHaveText('3');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Complete task: Learn retrieval',exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Complete task: Learn retrieval',exact:true})).toBeFocused();
  await expect(page.getByRole('checkbox',{name:'Reopen task: Build an index',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Complete task: Evaluate results',exact:true})).not.toBeChecked();
});

test('a subtask cannot create a third level', async ({page}) => {
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Actions for Build an index',exact:true}).click();
  const menu=page.getByRole('menu',{name:'Actions for Build an index',exact:true});
  await expect(menu.getByRole('menuitem',{name:/Add a smaller step|Draft smaller steps/})).toHaveCount(0);
});

test('floating navigation stays fixed, uses minimal space, and hides on short plans and other views', async ({page}) => {
  await page.setViewportSize({width:768,height:600});
  await page.goto('/#goals');
  const rail=page.getByRole('navigation',{name:'Jump to a project'});
  await expect(rail).toBeVisible();
  const initial=(await rail.boundingBox())!;
  expect(initial.width).toBeLessThanOrEqual(44);
  await page.evaluate(()=>window.scrollBy(0,220));
  await expect.poll(async()=>Math.abs((await rail.boundingBox())!.y-initial.y)).toBeLessThan(2);
  await page.getByRole('button',{name:'Jump to Tasks',exact:true}).focus();
  await expect(page.locator('.plan-index-tooltip')).toHaveText('Tasks');
  await expect(page.locator('.plan-index-tooltip')).toBeVisible();
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(rail).toBeHidden();
  await page.setViewportSize({width:1440,height:1600});
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await expect(rail).toBeHidden();
});

test('a tall direction stays active until the next direction reaches the reading position', async ({page}) => {
  await page.setViewportSize({width:768,height:600});
  await page.route('**/api/goals?*',async route=>{const goals=[{id:1,title:'AI engineering',goal_type:'project',completed:false,position:1,tasks:[] as any[]},{id:2,title:'Responsive QA',goal_type:'project',completed:false,position:2,tasks:[]}];goals[0].tasks=Array.from({length:35},(_,i)=>({id:100+i,goal_id:1,parent_id:null,depth:1,title:`Step ${i+1}`,completed:false,position:i}));await route.fulfill({json:goals});});
  await page.goto('/#goals');
  await expect(page.locator('#goal-1 .task-row')).toHaveCount(35);
  await page.locator('#goal-1').evaluate(el=>{const box=el.getBoundingClientRect();window.scrollTo(0,scrollY+box.bottom-500);});
  await expect(page.getByRole('button',{name:'Jump to AI engineering',exact:true})).toHaveAttribute('aria-current','location');
  expect((await page.locator('#goal-2').boundingBox())!.y).toBeGreaterThan(180);
});

test('an overflowing navigator can reach its first and last direction', async ({page}) => {
  await page.setViewportSize({width:768,height:600});
  await page.route('**/api/goals?*',route=>route.fulfill({json:Array.from({length:20},(_,i)=>({id:i+1,title:`Direction ${i+1}`,goal_type:'project',completed:false,position:i}))}));
  await page.goto('/#goals');
  const rail=page.getByRole('navigation',{name:'Jump to a project'});
  await expect(rail).toBeVisible();
  const first=rail.getByRole('button',{name:'Jump to Direction 1',exact:true});
  expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual((await rail.boundingBox())!.y);
  const last=rail.getByRole('button',{name:'Jump to Direction 20',exact:true});
  await last.scrollIntoViewIfNeeded();
  const box=(await last.boundingBox())!,container=(await rail.boundingBox())!;
  expect(box.y+box.height).toBeLessThanOrEqual(container.y+container.height);
});

for (const width of [375,768,1440]) {
  test(`nested outline stays readable at ${width}px in both themes`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/#goals');
    await expect(page.getByRole('button',{name:'Build an index',exact:true})).toBeVisible();
    for(let i=0;i<2;i++) {
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const title=await page.getByRole('button',{name:'Build an index',exact:true}).boundingBox();
      expect(title!.width).toBeGreaterThan(100);
      await page.getByRole('button',{name:'Switch color theme'}).click();
    }
  });
}

test('Plan batches task loading and rolls back a rejected priority click', async ({page}) => {
  const taskReads:string[]=[];
  page.on('request',request=>{if(request.method()==='GET' && /\/goals\/\d+\/tasks/.test(request.url()))taskReads.push(request.url());});
  await page.route('**/api/queue/1',async route=>{
    await new Promise(resolve=>setTimeout(resolve,250));
    await route.fulfill({status:503,json:{detail:'Could not save priority'}});
  });
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Prioritize Learn retrieval',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unstar Learn retrieval',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#app-toast')).toContainText('Could not save priority');
  await expect(page.getByRole('button',{name:'Prioritize Learn retrieval',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(taskReads).toEqual([]);
});
