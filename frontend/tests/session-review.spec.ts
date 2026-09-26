import {test,expect} from '@playwright/test';

for (const width of [375,768,1440]) for (const empty of [true,false]) {
 test(`session review ${empty?'empty':'with tasks'} is clear at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:850});
  const options=empty?[]:[{id:1,title:'Read the first chapter',goal_id:1,goal_title:'Learn something new',goal_type:'project',parent_id:null,depth:1},{id:2,title:'Try an exercise',goal_id:1,goal_title:'Learn something new',goal_type:'project',parent_id:null,depth:1}];
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   return route.fulfill({json:path==='/api/config'?{auth_mode:'local'}:path==='/api/dashboard'?{queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]}:path==='/api/focus-options'?options:[]});
  });
  await page.clock.install();
  await page.goto('/');
  await page.locator('#start-pomodoro').click();
  await page.clock.fastForward(7000);
  await page.locator('#focus-exit').click();
  const dialog=page.getByRole('dialog',{name:'Save your progress',exact:true});
  await expect(dialog).toBeVisible();
  await expect(page.locator('#attribution-minutes')).toHaveText('7 seconds');
  await expect(page.locator('#save-session')).toBeEnabled();
  await expect(page.locator('#session-summary')).toBeHidden();
  await expect(page.locator('.attribution-column-head')).toBeHidden();
  if(empty) {
   await expect(dialog).toContainText('No tasks to update');
   await expect(page.locator('.attribution-summary')).toBeHidden();
  } else {
   await page.getByLabel('Worked on Read the first chapter',{exact:true}).check();
   await page.getByLabel('Finished Read the first chapter',{exact:true}).check();
   await expect(page.getByLabel('Finished Try an exercise',{exact:true})).not.toBeChecked();
  }
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await expect(page.locator('#save-session')).toBeInViewport();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:testInfo.outputPath(`review-${theme}.png`)});
  }
 });
}
