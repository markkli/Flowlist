import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-27T18:00:00Z'));
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  let json:any=[];
  if(path==='/api/config')json={auth_mode:'local'};
  if(path==='/api/dashboard')json={queue:[],goals:[],stats:{current_streak:1,total_sessions:1,total_minutes:25},week_sessions:1,activity:[{date:'2026-09-18',minutes:25,sessions:1}]};
  if(path==='/api/history/week') {
   const start=url.searchParams.get('start');
   json={sessions:[],days:Array.from({length:7},(_,i)=>{const d=new Date(`${start}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i);return{date:d.toISOString().slice(0,10),minutes:0,seconds:0,session_ids:[]};})};
  }
  return route.fulfill({json});
 });
});

test('unregistered URL fragments fall back to Home without blanking the workspace',async({page})=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 for(const fragment of ['constructor','toString','not-a-view']) {
  await page.goto(`/app/#${fragment}`);
  await expect(page.locator('#view-dashboard')).toBeVisible();
  await expect(page.getByRole('button',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('#hero-time')).toHaveText('25:00');
  await expect(page.locator('#connection-error')).toBeHidden();
  await expect(page.locator('#app-toast')).not.toHaveClass(/visible/);
 }
 expect(errors).toEqual([]);
});

test('heatmap shows details on hover and opens the matching week by click or keyboard',async({page})=>{
 await page.goto('/app/');
 const day=page.getByRole('button',{name:'Sep 18 · 25 min · 1 session',exact:true});
 await expect(day).toHaveCSS('cursor','pointer');
 await day.hover();
 await expect.poll(()=>day.evaluate(node=>getComputedStyle(node,'::after').opacity)).toBe('1');
 await day.click();
 await expect(page).toHaveURL(/#history$/);
 await expect(page.locator('#history-week-label')).toContainText('Sep 12');
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await expect(page).toHaveURL(/#dashboard$/);
 await expect(page.locator('#activity-heatmap button[tabindex="0"]')).toHaveAttribute('aria-label',/^Sep 27/);
 await page.locator('#activity-heatmap button[tabindex="0"]').focus();
 await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('Enter');
 await expect(page.locator('#history-week-label')).toContainText('Sep 14');
});

for(const width of [375,1440])test(`Home has one clear timer and priority action at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto('/app/');
 const focus=page.locator('.focus-card'),priorities=page.locator('.agenda-panel');
 await expect(focus.getByRole('button')).toHaveCount(2);
 await expect(focus.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 await expect(priorities.getByRole('button')).toHaveCount(1);
 await expect(priorities).not.toContainText('Your shortlist');
 await expect(priorities).not.toContainText('What matters next');
 await expect(focus).not.toContainText('Protect the next');
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.heatmap-grid').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(200);
  await page.screenshot({path:testInfo.outputPath(`today-${theme}.png`),fullPage:true,animations:"disabled"});
 }
 await page.locator('#timer-settings-toggle').click();
 for(const id of ['focus-minutes-setting','break-minutes-setting','rounds-setting','long-break-minutes-setting'])await expect(page.locator(`#${id}`)).toBeVisible();
 await page.getByRole('button',{name:'Close timer settings'}).click();
 await page.locator('#start-pomodoro').click();
 await expect(page.locator('#focus-overlay')).toBeVisible();
 await expect(page.locator('#focus-overlay')).not.toContainText('Name it afterward');
});

test('cycle summary follows saved timer settings and survives reload',async({page})=>{
 await page.goto('/app/');await page.locator('#timer-settings-toggle').click();
 for(const [id,value] of [['focus-minutes-setting','45'],['break-minutes-setting','10'],['rounds-setting','3'],['long-break-minutes-setting','20']])await page.locator(`#${id}`).fill(value);
 await page.getByRole('button',{name:'Save cycle',exact:true}).click();
 for(let i=0;i<2;i++) {
  await expect(page.locator('#hero-time')).toHaveText('45:00');
  await expect(page.locator('#cycle-focus')).toHaveText('45');await expect(page.locator('#cycle-break')).toHaveText('10');
  await expect(page.locator('#cycle-rounds')).toHaveText('3');await expect(page.locator('#cycle-long-break')).toHaveText('20');
  if(!i)await page.reload();
 }
});
