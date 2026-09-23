import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({timezoneId:'America/Chicago'});
const blockSession = {id:1,revision:0,task_title:'Ship the release',summary:'Reviewed the release notes.',actual_minutes:55,planned_minutes:55,completed:true,created_at:'2026-09-19T22:00:00',started_at:'2026-09-18T14:00:00',ended_at:'2026-09-18T16:00:00',
  blocks:[{id:1,started_at:'2026-09-18T14:00:00',ended_at:'2026-09-18T14:25:00'},{id:2,started_at:'2026-09-18T15:30:00',ended_at:'2026-09-18T16:00:00'}],
  attributions:[{id:42,task_id:null,task_title:'Deleted task snapshot',goal_title:'Release',completed:true}]};
const legacy = {id:2,revision:0,task_title:'Older focus',summary:'Preserved older notes',actual_minutes:12,created_at:'2026-09-17T16:00:00',started_at:null,ended_at:null,blocks:[],attributions:[]};
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-19T18:00:00Z'));
  const sessions=structuredClone([blockSession,legacy]);
  const updates:any[]=[];let taskWrites=0;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();let json:any={};
    if (path === '/api/config' || path === '/config') return route.fulfill({json:{auth_mode:'local'}});
    if(path==='/api/dashboard')json={queue:[],goals:[],stats:{current_streak:1,total_sessions:2,total_minutes:67},week_sessions:2,activity:[]};
    if(path==='/api/goals'||path==='/api/focus-options')json=[];
    if(path==='/api/history/week'){
      const start=url.searchParams.get('start')!;const selected=start==='2026-09-14'?sessions:[];
      json={sessions:selected,days:Array.from({length:7},(_,i)=>{const day=new Date(`${start}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+i);const date=day.toISOString().slice(0,10);return {date,minutes:selected.length?(i===4?55:i===3?12:0):0,seconds:0,session_ids:[]};})};
    }
    if(path==='/api/sessions')json=sessions;
    if(path==='/api/sessions/1'){
      if(method==='PATCH'){const body=route.request().postDataJSON();updates.push(body);sessions[0]={...sessions[0],revision:1,summary:body.summary,task_title:body.summary};}
      json=sessions[0];
    }
    if(path.startsWith('/api/tasks/')&&method==='PATCH')taskWrites++;
    if(path==='/api/history/task-options')json=[{id:5,title:'Already completed task',goal_id:1,goal_title:'Release',completed:true}];
    if(path==='/api/export')json={format:'flowlist',schema_version:1,goals:[],tasks:[],queue:[],sessions};
    await route.fulfill({json});
  });
  await page.goto('/#history');
  return {sessions,updates,getTaskWrites:()=>taskWrites};
}

test('weekly view shows real focus intervals and keeps legacy records outside the clock',async({page})=>{
  await setup(page);
  await expect(page.locator('.history-block')).toHaveCount(2);
  await expect(page.locator('#history-week-total')).toHaveText('67 min focused · 2 rituals');
  await expect(page.locator('#history-untimed-list')).toContainText('Older focus');
  await expect(page.locator('#history-untimed-list')).toContainText('block times unavailable');
  await expect(page.locator('.history-day').nth(4)).toContainText('9:00');
  await page.getByRole('button',{name:'Previous week'}).click();
  await expect(page.locator('.history-block')).toHaveCount(0);
  await page.getByRole('button',{name:'This week',exact:true}).click();
  await expect(page.locator('.history-block')).toHaveCount(2);
});

test('record editing preserves snapshots, includes completed tasks, and only updates history',async({page})=>{
  const {updates,getTaskWrites}=await setup(page);
  await page.locator('.history-block').first().click();
  const dialog=page.getByRole('dialog',{name:'Ship the release',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('whole ritual, not an individual block');
  await page.getByLabel('Reflection',{exact:true}).fill('Corrected reflection');
  await page.getByLabel('Finished Deleted task snapshot',{exact:true}).uncheck();
  await page.getByText('Add a task to this record',{exact:true}).click();
  await dialog.getByLabel('Find a task',{exact:true}).fill('completed');
  await page.getByRole('button',{name:'Add Already completed task to record'}).click();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(updates[0]).toEqual({revision:0,summary:'Corrected reflection',attributions:[{attribution_id:42,completed:false},{task_id:5,completed:false}]});
  expect(getTaskWrites()).toBe(0);
});

test('failed and conflicting edits preserve the draft and expose recovery',async({page})=>{
  await setup(page);
  await page.route('**/api/sessions/1',async route=>{await route.fulfill(route.request().method()==='PATCH'?{status:409,json:{detail:'This record changed in another window.'}}:{json:blockSession});});
  await page.locator('.history-block').first().click();
  await page.getByLabel('Reflection',{exact:true}).fill('Keep this draft');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByLabel('Reflection',{exact:true})).toHaveValue('Keep this draft');
  await expect(page.getByRole('button',{name:'Reload saved version'})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Reload saved version'}).click();
  await expect(page.getByLabel('Reflection',{exact:true})).toHaveValue(blockSession.summary);
  await page.keyboard.press('Escape');
  await expect(page.locator('#history-detail-overlay')).toBeHidden();
  await expect(page.locator('.history-block').first()).toBeFocused();
});

test('export downloads readable versioned data with all saved records',async({page})=>{
  await setup(page);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export data',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('flowlist-2026-09-19.json');
  const data=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(data.schema_version).toBe(1);expect(data.sessions).toHaveLength(2);expect(data.sessions[0].blocks).toHaveLength(2);
});

for(const width of [375,768,1440]) test(`history and record dialog fit both themes at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===768?375:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await setup(page);
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`week-${width}-${theme}.png`),fullPage:true});
    await page.locator('.history-block').first().click();
    await expect(page.getByLabel('Reflection',{exact:true})).toBeVisible();
    for(let i=0;i<7;i++){await page.keyboard.press('Tab');expect(await page.locator('#history-detail-overlay').evaluate(el=>el.contains(document.activeElement))).toBe(true);}
    await page.getByRole('button',{name:'Save changes',exact:true}).scrollIntoViewIfNeeded();
    const box=await page.getByRole('button',{name:'Save changes',exact:true}).boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({path:testInfo.outputPath(`record-${width}-${theme}.png`)});
    await page.keyboard.press('Escape');
  }
});

test('a daylight-saving week uses an agenda and distinguishes the clock offsets',async({page})=>{
  await setup(page);
  const session={...blockSession,actual_minutes:20,started_at:'2026-03-08T07:50:00Z',ended_at:'2026-03-08T08:10:00Z',blocks:[{id:1,started_at:'2026-03-08T07:50:00Z',ended_at:'2026-03-08T08:10:00Z'}]};
  await page.route('**/api/history/week?*',route=>route.fulfill({json:{sessions:[session],days:Array.from({length:7},(_,i)=>({date:`2026-03-${String(i+2).padStart(2,'0')}`,minutes:i===6?20:0,seconds:0,session_ids:i===6?[1]:[]}))}}));
  await page.clock.setFixedTime(new Date('2026-03-08T18:00:00Z'));
  await page.getByRole('button',{name:'This week',exact:true}).click();
  await expect(page.locator('.history-week-grid')).toHaveClass(/as-agenda/);
  await expect(page.locator('.history-time-axis')).toBeHidden();
  await expect(page.locator('.history-block')).toHaveAttribute('aria-label',/1:50 AM CST–3:10 AM CDT · 20 min/);
  await page.locator('.history-block').click();
  await expect(page.locator('.history-block-list')).toContainText('1:50 AM CST–3:10 AM CDT · 20 min');
});

test('24-hour scale is stable and seven-second sessions remain accessible without inflated blocks',async({page})=>{
  const {sessions}=await setup(page);
  sessions.push({...structuredClone(blockSession),id:3,task_title:'A brief check',actual_minutes:0,blocks:[{id:3,started_at:'2026-09-20T03:48:00',ended_at:'2026-09-20T03:48:07'}]});
  await page.getByRole('button',{name:'This week',exact:true}).click();
  await expect(page.locator('.history-time-axis > span')).toHaveCount(24);
  await expect(page.locator('.history-time-axis')).toContainText('00:00');
  await expect(page.locator('.history-time-axis')).toContainText('23:00');
  await expect(page.locator('.history-block')).toHaveCount(2);
  const heights=await page.locator('.history-block').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));
  expect(heights).toEqual([25,30]);
  await expect(page.locator('.history-day-body').first()).toHaveCSS('height','1440px');
  await page.locator('.history-brief-strip summary').click();
  await expect(page.getByRole('button',{name:/7s · A brief check/})).toBeVisible();
  await page.getByRole('button',{name:/7s · A brief check/}).click();
  await expect(page.getByRole('dialog',{name:'A brief check',exact:true})).toBeVisible();
});
