import {test,expect} from '@playwright/test';
async function setup(page:any){
 const writes:any[]=[];
 const goals=[{id:1,title:'Release',goal_type:'project',completed:false,tasks:[{id:10,title:'Ship the release',parent_id:null,depth:1},{id:11,title:'Nested review',parent_id:10,depth:2}]},{id:2,title:'Reading',goal_type:'project',completed:false,tasks:[]}];
 await page.addInitScript(()=>localStorage.setItem('flowlist-ritual-v2',JSON.stringify({id:'capture-test',phase:'focus',elapsedSeconds:0,round:1,settings:{focus:25,break:5,longBreak:15,rounds:4},deadline:Date.now()+1500000,blockSeconds:1500,breakKind:'short',minimized:false,summary:'',selections:[],blocks:[],startedAt:Date.now()})));
 await page.route('**/api/**',(route:any)=>{const path=new URL(route.request().url()).pathname;if(route.request().method()==='POST')writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:path==='/api/config'?{auth_mode:'local'}:path==='/api/dashboard'?{queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]}:path==='/api/goals'?goals:[]});});
 await page.goto('/');await page.locator('#focus-add-plan').click();await expect(page.locator('#plan-capture-form button[type=submit]')).toBeEnabled();return writes;
}
for(const kind of ['standalone','project','subtask','new'])test(`tree capture creates a ${kind} destination`,async({page})=>{
 const writes=await setup(page);const modal=page.locator('#plan-capture-overlay');await modal.getByLabel('Task',{exact:true}).fill('Write a note');
 if(kind==='project'||kind==='subtask'){
  await modal.locator('summary').filter({hasText:'Release'}).click();
  await modal.getByRole('radio',{name:kind==='project'?'Directly in this project':/Ship the release/}).check();
  await expect(modal).toContainText('Nested review');await expect(modal.getByRole('radio',{name:/Nested review/})).toHaveCount(0);
 }
 if(kind==='new'){await modal.getByRole('radio',{name:'New project…'}).check();await modal.getByLabel('Project name',{exact:true}).fill('A new project');}
 await modal.getByRole('button',{name:'Add task',exact:true}).click();await expect(modal).toBeHidden();
 expect(writes).toEqual([{path:kind==='standalone'?'/api/standalone-tasks':kind==='project'?'/api/goals/1/tasks':kind==='subtask'?'/api/tasks/10/subtasks':'/api/goals/with-task',body:kind==='new'?{title:'A new project',task:{title:'Write a note'}}:{title:'Write a note'}}]);
 await expect(page.locator('#focus-overlay')).toBeVisible();
});
for(const width of [375,1440])test(`tree selection fits at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page);await page.locator('.destination-project summary').first().click();
 await page.getByRole('radio',{name:/Ship the release/}).check();await expect(page.locator('.destination-path')).toHaveText('Destination: Release → Ship the release');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({animations:'disabled',path:info.outputPath(`tree-${theme}.png`)});}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('failed tree load can retry without losing typed task',async({page})=>{
 await setup(page);await page.locator('#plan-capture-cancel').click();await page.route('**/api/goals?*',route=>route.fulfill({status:503,json:{detail:'Offline'}}));
 await page.locator('#focus-add-plan').click();await page.getByLabel('Task',{exact:true}).fill('Keep this');await expect(page.getByRole('button',{name:'Reload projects'})).toBeVisible();
 await page.unroute('**/api/goals?*');await page.getByRole('button',{name:'Reload projects'}).click();await expect(page.locator('.destination-project')).toHaveCount(2);await expect(page.getByLabel('Task',{exact:true})).toHaveValue('Keep this');
});
