import {test,expect} from '@playwright/test';

async function setup(page:any) {
 const writes:any[]=[];
 await page.addInitScript(()=>localStorage.setItem('flowlist-ritual-v2',JSON.stringify({id:'capture-test',phase:'focus',elapsedSeconds:0,round:1,settings:{focus:25,break:5,longBreak:15,rounds:4},deadline:Date.now()+1500000,blockSeconds:1500,breakKind:'short',minimized:false,summary:'',selections:[],blocks:[],startedAt:Date.now()})));
 await page.route('**/api/**',async(route:any)=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();
  if(method==='POST')writes.push({path,body:route.request().postDataJSON()});
  const json=path==='/api/config'?{auth_mode:'local'}:path==='/api/dashboard'?{queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]}:path==='/api/goals'?[{id:1,title:'Release',goal_type:'project',completed:false},{id:2,title:'Learning',goal_type:'project',completed:false}]:path==='/api/goals/1/tasks'?[{id:10,title:'Ship the release',parent_id:null,depth:1},{id:11,title:'Nested review',parent_id:10,depth:2},{id:12,title:'Archived root',parent_id:null,depth:1,completed:true}]:path==='/api/goals/2/tasks'?[{id:20,title:'Read a book',parent_id:null,depth:1}]:[];
  await route.fulfill({json});
 });
 await page.goto('/');await expect(page.locator('#focus-overlay')).toBeVisible();await page.locator('#focus-add-plan').click();
 await expect(page.locator('#plan-capture-destination')).toBeEnabled();
 return writes;
}

for(const destination of ['list','project','subtask'])test(`capture adds to the correct ${destination} location and keeps focus running`,async({page})=>{
 const writes=await setup(page);await page.getByLabel('Task',{exact:true}).fill('Write a note');
 if(destination!=='list'){
  await page.getByLabel('Add to',{exact:true}).selectOption('1');await expect(page.getByLabel('Placement',{exact:true})).toBeEnabled();
  await expect(page.locator('#plan-capture-parent option[value="11"]')).toHaveCount(0);
  if(destination==='subtask')await page.getByLabel('Placement',{exact:true}).selectOption('10');
 }
 await page.locator('#plan-capture-form').getByRole('button',{name:'Add task',exact:true}).click();
 await expect(page.locator('#plan-capture-overlay')).toBeHidden();await expect(page.locator('#focus-overlay')).toBeVisible();
 expect(writes).toEqual([{path:destination==='list'?'/api/standalone-tasks':destination==='project'?'/api/goals/1/tasks':'/api/tasks/10/subtasks',body:{title:'Write a note'}}]);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('flowlist-ritual-v2')!).phase)).toBe('focus');
});

test('switching projects clears the old parent and ignores a late response',async({page})=>{
 await setup(page);let release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/goals/1/tasks',async route=>{await held;await route.fulfill({json:[{id:10,title:'Old project task',parent_id:null,depth:1}]});});
 await page.getByLabel('Add to',{exact:true}).selectOption('1');await expect(page.getByLabel('Placement',{exact:true})).toBeDisabled();
 await page.getByLabel('Add to',{exact:true}).selectOption('2');await expect(page.getByLabel('Placement',{exact:true})).toBeEnabled();
 release();await expect(page.locator('#plan-capture-parent option[value="20"]')).toHaveCount(1);
 await expect(page.locator('#plan-capture-parent option[value="10"]')).toHaveCount(0);
 await page.getByLabel('Placement',{exact:true}).selectOption('20');await page.getByLabel('Add to',{exact:true}).selectOption('__tasks__');
 await expect(page.locator('#plan-capture-parent-field')).toBeHidden();await expect(page.getByRole('dialog',{name:'Add a task'})).toBeVisible();
});

for(const width of [375,1440])test(`nested task capture fits at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await setup(page);await page.getByLabel('Add to',{exact:true}).selectOption('1');
 await expect(page.getByLabel('Placement',{exact:true})).toBeEnabled();await page.getByLabel('Placement',{exact:true}).selectOption('10');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('capture.png')});
});


test('failed parent loading can retry without losing the task name',async({page})=>{
 await setup(page);await page.getByLabel('Task',{exact:true}).fill('Keep this draft');
 await page.route('**/api/goals/1/tasks',route=>route.fulfill({status:503,json:{detail:'Offline'}}));
 await page.getByLabel('Add to',{exact:true}).selectOption('1');
 await expect(page.locator('#plan-capture-retry')).toBeVisible();
 await page.unroute('**/api/goals/1/tasks');await page.locator('#plan-capture-retry').click();
 await expect(page.locator('#plan-capture-parent option[value="10"]')).toHaveCount(1);
 await expect(page.getByLabel('Task',{exact:true})).toHaveValue('Keep this draft');
});

test('capture locks its destination until the save finishes',async({page})=>{
 await setup(page);let release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/standalone-tasks',async route=>{await held;await route.fulfill({json:{id:30}});});
 await page.getByLabel('Task',{exact:true}).fill('One task');
 await page.locator('#plan-capture-form').getByRole('button',{name:'Add task',exact:true}).click();
 await expect(page.getByLabel('Add to',{exact:true})).toBeDisabled();
 await page.locator('#plan-capture-close').click();await expect(page.locator('#plan-capture-overlay')).toBeVisible();
 release();await expect(page.locator('#plan-capture-overlay')).toBeHidden();
});
