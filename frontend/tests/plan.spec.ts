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
    const method = route.request().method();
    let json:any = {};
    if(path === '/dashboard') json={queue:queue(),goals:goals.map(goal=>({goal,tasks:tasks.filter(t=>t.goal_id===goal.id)})),stats:{current_streak:0,total_sessions:0,total_minutes:0},activity:[],week_sessions:0};
    if(path === '/goals') json=goals;
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
    if(/^\/tasks\/\d+$/.test(path) && method==='PATCH') Object.assign(tasks.find(t=>t.id===Number(path.split('/')[2]))!,route.request().postDataJSON());
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
  await expect(menu.getByRole('menuitem',{name:'Add to focus queue',exact:true})).toBeFocused();
  const bounds=(await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem',{name:'Rename',exact:true})).toBeFocused();
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
  await expect(page.getByRole('menu',{name:'Actions for Pay bill',exact:true}).getByRole('menuitem',{name:'Add to focus queue',exact:true})).toBeFocused();
  await expect(page.locator('[data-task-id="4"] .task-edit-title')).toBeHidden();
});

test('drafting smaller steps shows visible progress outside the closed menu', async ({page}) => {
  let finish!: () => void;
  const pending=new Promise<void>(resolve=>{finish=resolve;});
  await page.route('**/api/tasks/2/breakdown',async route=>{await pending; await route.fulfill({json:[{title:'Review index design'}]});});
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Actions for Build an index',exact:true}).click();
  await page.getByRole('menu',{name:'Actions for Build an index',exact:true}).getByRole('menuitem',{name:/Draft smaller steps/}).click();
  await expect(page.getByText('Drafting smaller steps…',{exact:true})).toBeVisible();
  finish();
  await expect(page.getByText('Review index design',{exact:true})).toBeVisible();
  await expect(page.getByText('Drafting smaller steps…',{exact:true})).toBeHidden();
});

test('leaf tasks can join the queue from Plan and parents cannot', async ({page}) => {
  await page.goto('/#goals');
  await page.getByRole('button',{name:'Actions for Learn retrieval',exact:true}).click();
  await expect(page.getByRole('menu',{name:'Actions for Learn retrieval',exact:true}).getByRole('menuitem',{name:'Add to focus queue',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Actions for Build an index',exact:true}).click();
  await page.getByRole('menu',{name:'Actions for Build an index',exact:true}).getByRole('menuitem',{name:'Add to focus queue',exact:true}).click();
  await expect(page.locator('#app-toast')).toContainText('Added to your focus queue');
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(page.locator('.agenda-title')).toHaveText('Build an index');
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
