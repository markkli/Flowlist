import {test,expect, type Page} from '@playwright/test';

async function fakeNotifications(page:Page, permission='default', result='granted', background=false) {
  await page.addInitScript(({permission,result,background})=>{
    const log={requests:0,messages:[] as {title:string,options:NotificationOptions}[]};
    (window as any).__reminders=log;
    if(background) Object.defineProperty(document,'hasFocus',{value:()=>false});
    Object.defineProperty(window,'Notification',{configurable:true,value:class {
      static permission=permission;
      static async requestPermission(){log.requests++;this.permission=result;return result;}
      constructor(title:string,options:NotificationOptions){log.messages.push({title,options});}
    }});
  },{permission,result,background});
}

test.beforeEach(async({context})=>{
  await context.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/config' ? {auth_mode:'local'} : new URL(route.request().url()).pathname==='/api/dashboard' ? {queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]} : []}));
});

async function startMinimized(page:Page) {
  await page.goto('/');
  await page.locator('#start-pomodoro').click();
  await expect(page.locator('#focus-overlay')).toBeVisible();
  await page.getByRole('button',{name:'Minimize timer'}).click();
  await page.getByRole('button',{name:'Plan',exact:true}).click();
}

test('every automatic interval gets a quiet notice without opening the timer or requesting permission',async({page})=>{
  await fakeNotifications(page);
  await page.clock.install();
  await startMinimized(page);
  await page.getByRole('button',{name:'Project',exact:true}).click();
  await page.locator('#goal-title').fill('An uninterrupted draft');
  await expect(page.locator('#goal-title')).toBeFocused();
  for(let round=1;round<=4;round++) {
    await page.clock.fastForward(25*60000);
    await expect(page.locator('#interval-reminder')).toContainText(round===4?'Cycle complete. Long break started · 15 minutes.':`Focus round ${round} complete. Short break started · 5 minutes.`);
    await expect(page.locator('#focus-overlay')).toBeHidden();
    await expect(page.locator('#goal-title')).toBeFocused();
    await expect(page.locator('#goal-title')).toHaveValue('An uninterrupted draft');
    await page.clock.fastForward((round===4?15:5)*60000);
    await expect(page.locator('#interval-reminder')).toContainText(`${round===4?'Long':'Short'} break complete. Focus round ${round===4?1:round+1} of 4 started`);
    await expect(page).toHaveURL(/#goals$/);
  }
  expect(await page.evaluate(()=>(window as any).__reminders)).toEqual({requests:0,messages:[]});
});

test('desktop reminders require opt-in, persist, remain silent and can be turned off',async({page})=>{
  await fakeNotifications(page,'granted','granted',true);
  await page.clock.install();
  await page.goto('/');
  await page.locator('#timer-settings-toggle').click();
  await page.getByRole('button',{name:'Enable desktop reminders'}).click();
  await expect(page.locator('#desktop-reminders-toggle')).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await startMinimized(page);
  await page.clock.fastForward(25*60000);
  await expect.poll(()=>page.evaluate(()=>(window as any).__reminders.messages.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__reminders.messages[0])).toMatchObject({title:'Focus round 1 complete',options:{silent:true,requireInteraction:false,tag:'flowlist-interval'}});
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await page.locator('#timer-settings-toggle').click();
  await page.getByRole('button',{name:'Turn off desktop reminders'}).click();
  await page.getByRole('button',{name:'Close timer settings'}).click();
  await page.clock.fastForward(5*60000);
  await expect(page.locator('#interval-reminder')).toContainText('Short break complete');
  expect(await page.evaluate(()=>(window as any).__reminders.messages.length)).toBe(1);
});

for(const permission of ['denied','default']) test(`permission ${permission} keeps in-app reminders usable`,async({page})=>{
  await fakeNotifications(page,permission,'denied');
  await page.clock.install();
  await page.goto('/');
  await page.locator('#timer-settings-toggle').click();
  if(permission==='default') await page.getByRole('button',{name:'Enable desktop reminders'}).click();
  await expect(page.locator('#desktop-reminders-status')).toContainText('Notifications are blocked');
  await expect(page.locator('#desktop-reminders-toggle')).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).__reminders.requests)).toBe(permission==='default'?1:0);
  await page.getByRole('button',{name:'Close timer settings'}).click();
  await startMinimized(page);
  await page.clock.fastForward(25*60000);
  await expect(page.locator('#interval-reminder')).toContainText('Focus round 1 complete');
});

test('manual skip and end do not send completion reminders',async({page})=>{
  await fakeNotifications(page,'granted');
  await page.goto('/');
  await page.locator('#start-pomodoro').click();
  await page.getByRole('button',{name:'Skip to break',exact:true}).click();
  await expect(page.locator('#focus-phase-label')).toHaveText('Short break');
  await expect(page.locator('#interval-reminder')).toBeHidden();
  await page.locator('#focus-exit').click();
  await expect(page.locator('#session-attribution-overlay')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__reminders.messages)).toEqual([]);
});

test('two tabs advance a shared interval once and emit one desktop notice',async({page,context})=>{
  const other=await context.newPage();
  // Playwright's clock is shared by every page in the browser context.
  await page.clock.install({time:new Date('2026-09-20T12:00:00Z')});
  for(const tab of [page,other]) {
    await fakeNotifications(tab,'granted','granted',true);
  }
  await page.goto('/');
  await page.locator('#timer-settings-toggle').click();
  await page.getByRole('button',{name:'Enable desktop reminders'}).click();
  await page.getByRole('button',{name:'Close timer settings'}).click();
  await startMinimized(page);
  await other.goto('/');
  await page.clock.fastForward(25*60000);
  for(const tab of [page,other]) await expect(tab.locator('#timer-mini-copy')).toContainText('Short break');
  const counts=await Promise.all([page,other].map(tab=>tab.evaluate(()=>(window as any).__reminders.messages.length)));
  expect(counts[0]+counts[1]).toBe(1);
});

for(const width of [375,768,1440]) test(`reminder settings fit at ${width}px without notification support`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===768?375:960});
  await page.addInitScript(()=>{delete (window as any).Notification;});
  await page.goto('/');
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.locator('#timer-settings-toggle').click();
    await expect(page.locator('#desktop-reminders-status')).toContainText('in-app reminders only');
    await expect(page.locator('#desktop-reminders-toggle')).toBeDisabled();
    await page.getByRole('button',{name:'Save cycle',exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'Save cycle',exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`reminders-${width}-${theme}.png`)});
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
});

test('chime is on by default, fires at a boundary, and can be muted without hiding reminders',async({page},testInfo)=>{
 await fakeNotifications(page);
 await page.addInitScript(()=>{
  (window as any).__tones=0;
  Object.defineProperty(window,'AudioContext',{value:class {
   state='suspended';currentTime=0;destination={};
   async resume(){this.state='running';}
   createOscillator(){return {frequency:{value:0},type:'sine',connect(){},disconnect(){},start(){(window as any).__tones++;},stop(){},onended:null};}
   createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }});
 });
 await page.clock.install();
 await startMinimized(page);
 await page.clock.fastForward(25*60000);
 await expect(page.locator('#interval-reminder')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__tones)).toBe(2);
 await page.screenshot({path:testInfo.outputPath('interval-popup.png')});
 await page.getByRole('button',{name:'Got it',exact:true}).click();
 await expect(page.locator('#interval-reminder')).toBeHidden();
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.locator('#timer-settings-toggle').click();
 await expect(page.getByRole('checkbox',{name:'Gentle chime',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Gentle chime',exact:true}).uncheck();
 await page.getByRole('button',{name:'Close timer settings'}).click();
 await page.clock.fastForward(5*60000);
 await expect(page.locator('#interval-reminder')).toContainText('Time to focus');
 expect(await page.evaluate(()=>(window as any).__tones)).toBe(2);
 await page.reload();
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.locator('#timer-settings-toggle').click();
 await expect(page.getByRole('checkbox',{name:'Gentle chime',exact:true})).not.toBeChecked();
});
