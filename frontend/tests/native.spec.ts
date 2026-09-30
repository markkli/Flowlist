import {test,expect,Page} from '@playwright/test';

async function installBridge(page:Page, notifications='granted') {
  await page.addInitScript(({notifications})=>{
    const settings={focus:25,break:5,rounds:4,longBreak:15};
    const task={id:-2,goal_id:-1,parent_id:null,depth:1,title:'Outline the idea',completed:false,position:0};
    const child={...task,id:-3,parent_id:-2,depth:2,title:'Collect references',position:1};
    const goal={id:-1,title:'Build a portfolio',goal_type:'project',completed:false,position:0,tasks:[task,child]};
    const host:any={account:null,onboarding:{version:3},timer:null,settings,preferences:{appearance:{preset:'coast',focusArtwork:true,planArtwork:true},theme:'dark'},notifications,sound:true,reminderPromptSeen:false};
    const calls:any[]=[];
    (window as any).__nativeHost=host;(window as any).__nativeCalls=calls;
    const emit=()=>window.dispatchEvent(new CustomEvent('flowlist:native-state',{detail:structuredClone(host)}));
    (window as any).__emitNative=emit;
    (window as any).webkit={messageHandlers:{flowlist:{postMessage:async(message:any)=>{
      calls.push(structuredClone(message));
      const reply=(value:any)=>({ok:true,value:structuredClone(value)});
      if(message.op==='bootstrap')return reply(host);
      if(message.op==='ready')return reply(null);
      if(message.op==='api') {
        const path=message.path.split('?')[0];
        if(path==='/dashboard')return reply({queue:[{task,goal}],goals:[{goal,tasks:[task,child]}],stats:{current_streak:3,total_sessions:12,total_minutes:300},week_sessions:4,activity:[]});
        if(path==='/history/week'){const start=new URLSearchParams(message.path.split('?')[1]).get('start') || '2026-09-22';return reply({days:Array.from({length:7},(_,index)=>{const date=new Date(start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+index);return {date:date.toISOString().slice(0,10),minutes:0,seconds:0,session_ids:[]};}),sessions:[]});}
        if(path==='/goals')return reply([goal]);
        if(path==='/queue')return reply([{task,goal}]);
        if(path==='/focus-options'||path==='/history/task-options')return reply([task,child].map(item=>({...item,goal_title:goal.title,goal_type:'project'})));
        if(path==='/sessions'&&message.method==='POST'){
          (window as any).__savedDraft=structuredClone(host.timer);
          host.timer=null;emit();return reply({saved:true});
        }
        return reply([]);
      }
      if(message.op==='timer') {
        if((window as any).__rejectNativeAction===message.action)return {ok:false,error:'Could not save on this Mac.',status:503};
        if(message.action==='settings')host.settings=message.settings;
        if(message.action==='start')host.timer={id:'d54f3dd0-10d5-4aee-a32e-531c27f0f431',phase:'focus',nativePhase:'focus',paused:false,remainingSeconds:1500,startedAt:Date.now(),endedAt:Date.now()+7000,elapsedSeconds:7,round:1,settings:host.settings,deadline:Date.now()+1500000,blockSeconds:1500,breakKind:'short',minimized:true,blocks:[],summary:'',selections:[],draftTask:'',draftGroup:'',draftDestination:'__tasks__',draftGroupType:'project'};
        if(message.action==='pause')host.timer.paused=true;
        if(message.action==='resume')host.timer.paused=false;
        if(message.action==='finish'){host.timer.phase='awaiting-attribution';host.timer.nativePhase='review';}
        if(message.action==='draft'){host.timer.summary=message.summary;host.timer.selections=message.selections;}
        if(message.action==='discard')host.timer=null;
        emit();return reply(host.timer);
      }
      if(message.op==='appearance'){host.preferences={appearance:message.appearance || host.preferences.appearance,theme:message.theme || host.preferences.theme};emit();return reply(null);}
      if(message.op==='reminders'){
        if(message.action==='dismiss')host.reminderPromptSeen=true;
        if(message.action==='enable')host.notifications='granted';
        if(message.action==='sound')host.sound=message.sound;
        emit();return reply(null);
      }
      if(message.op==='outbox'){if(message.action==='general'){(window as any).__generalRecord=structuredClone(host.pendingRecords.find((record:any)=>record.id===message.id));host.pendingRecords=[];emit();}return reply(null);}
      if(message.op==='account'||message.op==='download')return reply(null);
      return {ok:false,error:'Unknown test operation'};
    }}}};
  },{notifications});
  await page.route('**/api/**',route=>route.abort());
}

test('Mac uses all approved dashboard cards and saves timer settings through native host',async({page})=>{
  await installBridge(page);await page.goto('/app/');
  await expect(page.locator('.focus-card')).toBeVisible();
  for(const title of ['Priority tasks','Activity','Active goals'])await expect(page.getByRole('heading',{name:title})).toBeVisible();
  await expect(page.locator('#stat-minutes')).toHaveText('300');
  await expect(page.locator('html')).toHaveAttribute('data-appearance','coast');
  await page.locator('#timer-settings-toggle').click();
  await page.locator('#focus-minutes-setting').fill('40');
  await page.getByRole('button',{name:'Save cycle'}).click();
  await expect(page.locator('#hero-time')).toHaveText('40:00');
  expect(await page.evaluate(()=>localStorage.getItem('flowlist-timer-settings:local-mac'))).toBeNull();
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await expect(page.locator('.plan-cover')).toBeVisible();
  await expect(page.getByText('Collect references',{exact:true})).toBeVisible();
});

test('Mac status includes pending Plan changes and gives sync errors precedence', async ({page}) => {
  await installBridge(page);
  await page.goto('/app/');
  await expect(page.locator('#connection-label')).toHaveText('On this Mac');
  await page.evaluate(() => {
    Object.assign((window as any).__nativeHost, {planPendingCount: 2, pendingCount: 1});
    (window as any).__emitNative();
  });
  await expect(page.locator('#connection-label')).toHaveText('3 to sync');
  await page.evaluate(() => {
    (window as any).__nativeHost.error = 'The server may have received this item.';
    (window as any).__emitNative();
  });
  await expect(page.locator('#connection-label')).toHaveText('Sync needs attention');
  await expect(page.locator('#connection-label')).toHaveAttribute('title', 'The server may have received this item.');
});

test('Mac timer has one native authority, pause/resume and durable review before save',async({page})=>{
  await installBridge(page);await page.goto('/app/');
  await page.locator('#start-pomodoro').click();
  await expect(page.getByRole('dialog',{name:'Pomodoro timer'})).toBeVisible();
  await page.locator('#focus-native-primary').click();
  await expect(page.locator('#focus-native-primary')).toHaveText('Resume');
  await page.locator('#focus-native-primary').click();
  await expect(page.locator('#focus-native-primary')).toHaveText('Pause');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.includes('ritual')))).toEqual([]);
  await page.locator('#focus-exit').click();
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeVisible();
  await page.locator('#session-summary').fill('The last keystroke must be saved.');
  await page.getByLabel('Finished Outline the idea',{exact:true}).check();
  await expect(page.getByLabel('Finished Collect references',{exact:true})).toBeChecked();
  await page.locator('#save-session').click();
  await expect(page.locator('#session-attribution-overlay')).toBeHidden();
  const saved=await page.evaluate(()=>(window as any).__savedDraft);
  expect(saved.summary).toBe('The last keystroke must be saved.');
  expect(saved.selections).toEqual([{task_id:-2,completed:true},{task_id:-3,completed:true}]);
  const calls=await page.evaluate(()=>(window as any).__nativeCalls);
  expect(calls.filter((call:any)=>call.op==='timer'&&call.action==='start')).toHaveLength(1);
  expect(calls.filter((call:any)=>call.op==='reminders'&&call.action==='enable')).toHaveLength(0);
});

test('menu timer events render ready state and finish opens full review',async({page})=>{
  await installBridge(page);await page.goto('/app/');
  await page.locator('#start-pomodoro').click();
  await page.locator('#focus-minimize').click();
  await page.evaluate(()=>{
    const host=(window as any).__nativeHost;
    host.timer.nativePhase='ready';host.timer.phase='break';host.timer.remainingSeconds=1500;
    (window as any).__emitNative();
  });
  await expect(page.getByRole('dialog',{name:'Pomodoro timer'})).toBeHidden();
  await page.locator('#timer-mini-open').click();
  await expect(page.locator('#focus-native-primary')).toHaveText('Start focus');
  await expect(page.locator('#focus-skip')).toBeDisabled();
  await page.evaluate(()=>{
    const host=(window as any).__nativeHost;host.timer.nativePhase='review';host.timer.phase='awaiting-attribution';
    (window as any).__emitNative();
  });
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeVisible();
  await page.locator('#attribution-later').click();
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('flowlist:native-open-timer')));
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeVisible();
});

test('native notifications offered once and saved permission is respected',async({page})=>{
  await installBridge(page,'default');await page.goto('/app/');
  await page.locator('#start-pomodoro').click();
  await expect(page.locator('#reminder-invitation')).toBeVisible();
  await page.locator('#reminder-invitation-later').click();
  await page.locator('#focus-minimize').click();
  await page.locator('#timer-mini-open').click();
  await expect(page.locator('#reminder-invitation')).toBeHidden();
  await page.locator('#focus-minimize').click();
  await page.locator('#timer-settings-toggle').click();
  await page.locator('#desktop-reminders-toggle').click();
  await expect(page.locator('#desktop-reminders-toggle')).toHaveText('Notifications enabled');
});


test('failed native draft and discard preserve the review for retry',async({page})=>{
  await installBridge(page);await page.goto('/app/');
  await page.locator('#start-pomodoro').click();await page.locator('#focus-exit').click();
  await page.locator('#session-summary').fill('Keep this work safe.');
  await page.evaluate(()=>{(window as any).__rejectNativeAction='draft';});
  await page.locator('#save-session').click();
  await expect(page.locator('#attribution-error')).toContainText('Could not save on this Mac.');
  await expect(page.locator('#session-summary')).toHaveValue('Keep this work safe.');
  expect(await page.evaluate(()=>(window as any).__nativeCalls.filter((call:any)=>call.op==='api'&&call.path==='/sessions'&&call.method==='POST'))).toHaveLength(0);
  await page.evaluate(()=>{(window as any).__rejectNativeAction='discard';});
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#discard-session').click();
  await expect(page.getByRole('dialog',{name:'Save your progress'})).toBeVisible();
  await page.evaluate(()=>{(window as any).__rejectNativeAction=null;});
  await page.locator('#save-session').click();
  await expect(page.locator('#session-attribution-overlay')).toBeHidden();
});

test('elapsed browser time never advances the native timer independently',async({page})=>{
  await installBridge(page);await page.clock.install();await page.goto('/app/');
  await page.locator('#start-pomodoro').click();
  await page.clock.fastForward(35*60*1000);
  await expect(page.locator('#focus-phase-label')).toHaveText('Focus');
  expect(await page.evaluate(()=>(window as any).__nativeCalls.filter((call:any)=>call.op==='timer'&&['start','skip','finish'].includes(call.action)))).toHaveLength(1);
});


test('offline session remains visible in History and explicit recovery preserves time and note',async({page})=>{
  await installBridge(page);await page.goto('/app/#history');
  await page.evaluate(()=>{
    (window as any).__nativeHost.pendingRecords=[{id:'3d8f03f1-36fb-4231-9d3e-44890e93a9c1',title:'Portfolio work',seconds:1500,endedAt:'2026-09-28T15:00:00Z',note:'The first draft is ready.',error:'A task was removed.',errorCode:404}];
    (window as any).__emitNative();
  });
  const pending=page.getByRole('region',{name:'Sessions waiting to sync'});
  await expect(pending).toContainText('The first draft is ready.');
  await expect(pending).toContainText('Saved on this Mac');
  await page.evaluate(()=>{(window as any).__pendingNode=document.querySelector('.native-pending-records article');(window as any).__emitNative();});
  expect(await page.evaluate(()=>(window as any).__pendingNode===document.querySelector('.native-pending-records article'))).toBe(true);
  await pending.getByRole('button',{name:'Retry sync'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await pending.getByRole('button',{name:'Save as General focus'}).click();
  await expect(pending).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__nativeCalls.filter((call:any)=>call.op==='outbox'&&call.action==='general'))).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept());
  await pending.getByRole('button',{name:'Save as General focus'}).click();
  await expect(pending).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__generalRecord)).toMatchObject({seconds:1500,note:'The first draft is ready.'});
});

test('signed-in Mac Guide works when the deployed beta lacks the example endpoint',async({page},testInfo)=>{
 await installBridge(page);
 await page.addInitScript(()=>{
  const host=(window as any).__nativeHost;
  host.account={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'tester@example.invalid'};
  host.onboarding.version=0;
  const handler=(window as any).webkit.messageHandlers.flowlist,original=handler.postMessage;
  handler.postMessage=async(message:any)=>message.op==='api'&&message.path==='/guide/example'
    ? {ok:false,error:'Not Found',status:404}:original(message);
 });
 await page.goto('/app/');await expect(page.locator('#onboarding-title')).toHaveText('Make a plan');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Prioritize example task',exact:true}).click();
 await expect(page.locator('#guide-priority-preview')).toContainText('Understand Pomodoro');
 const star=await page.locator('#guide-demo-priority svg').boundingBox();
 expect(star?.width).toBeGreaterThanOrEqual(18);expect(star?.height).toBeGreaterThanOrEqual(18);
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('guide-practice.png')});
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Finish guide',exact:true}).click();
 await expect(page.locator('#onboarding-overlay')).toBeHidden();
 await page.locator('#nav-dashboard').click();await expect(page.locator('#timer-settings-toggle')).toBeVisible();
});

test('a fresh Mac prompts for sign-in before Guide and offers an explicit local choice',async({page},testInfo)=>{
 await installBridge(page);
 await page.addInitScript(()=>{(window as any).__nativeHost.needsSignIn=true;});
 await page.goto('/app/');
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true}).first()).toBeVisible();
 await expect(page.locator('#auth-beta-note')).toContainText('Save on this Mac');
 await page.screenshot({animations:'disabled',path:testInfo.outputPath('first-launch.png')});
 await expect(page.locator('#onboarding-overlay')).toBeHidden();
 await page.getByRole('button',{name:'Continue as guest',exact:true}).click();
 await expect(page.locator('#auth-screen')).toBeHidden();
 await expect(page.locator('#start-pomodoro')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__nativeCalls.some((call:any)=>call.op==='account'&&call.action==='continueLocal'))).toBe(true);
});

test('guest entry works while cloud sign-in is unavailable; Mac setup follows the Guide and runs once',async({page})=>{
 await installBridge(page);
 await page.addInitScript(()=>{
   const host=(window as any).__nativeHost, handler=(window as any).webkit.messageHandlers.flowlist;
   host.needsSignIn=!localStorage.getItem('test-welcome');
   host.macSetup={version:Number(localStorage.getItem('test-setup')||0),menuEnabled:true,widgetIncluded:false};
   const prior=handler.postMessage;
   handler.postMessage=async(message:any)=>{
     if(message.op==='account'&&message.action==='providers')return new Promise(()=>{});
     if(message.op==='account'&&message.action==='continueLocal')localStorage.setItem('test-welcome','true');
     if(message.op==='macSetup'){localStorage.setItem('test-setup','1');localStorage.setItem('test-menu',String(message.menuEnabled));return {ok:true,value:{version:1}};}
     return prior(message);
   };
 });
 await page.goto('/app/');
 await expect(page.getByRole('dialog',{name:'Keep focus within reach'})).toBeHidden();
 await page.getByRole('button',{name:'Continue as guest'}).click();
 // This fixture already completed Guide; a new device still gets setup.
 await expect(page.getByRole('dialog',{name:'Keep focus within reach'})).toBeVisible();
 await expect(page.locator('#mac-widget-copy')).toContainText('not included');
 await page.locator('#mac-menu-enabled').uncheck();
 await page.getByRole('button',{name:'Start using Flowlist'}).click();
 expect(await page.evaluate(()=>localStorage.getItem('test-menu'))).toBe('false');
 await page.reload();
 await expect(page.locator('#start-pomodoro')).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Keep focus within reach'})).toBeHidden();
});

test('native email appears only when enabled and submits a code through the host',async({page})=>{
 await installBridge(page);
 await page.addInitScript(()=>{
   (window as any).__nativeHost.needsSignIn=true;
   const handler=(window as any).webkit.messageHandlers.flowlist,prior=handler.postMessage;
   handler.postMessage=async(message:any)=>{
     if(message.op==='account'&&message.action==='providers')return {ok:true,value:{google:true,email:true}};
     if(message.op==='account'&&message.action==='emailVerify')return {ok:false,error:'That code expired. Request a new code.'};
     return prior(message);
   };
 });
 await page.goto('/app/');
 await page.getByLabel('Email address',{exact:true}).fill('tester@example.invalid');
 await page.getByRole('button',{name:'Send sign-in code'}).click();
 await expect(page.locator('#auth-status')).toContainText('tester@example.invalid');
 await page.getByLabel('Email code',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.locator('#auth-error')).toContainText('That code expired');
 await expect(page.getByRole('button',{name:'Continue as guest'})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).__nativeCalls.some((m:any)=>m.op==='account'&&m.action==='emailSend'&&m.email==='tester@example.invalid'))).toBe(true);
});

test('a new guest completes Guide before the Mac setup appears',async({page})=>{
 await installBridge(page);
 await page.addInitScript(()=>{
   const host=(window as any).__nativeHost,handler=(window as any).webkit.messageHandlers.flowlist,prior=handler.postMessage;
   Object.assign(host,{needsSignIn:true,onboarding:{version:null},macSetup:{version:0,menuEnabled:true,widgetIncluded:false}});
   handler.postMessage=async(message:any)=>{
     if(message.op==='account'&&message.action==='providers')return {ok:true,value:{google:true,email:false}};
     if(message.op==='api'&&message.path==='/guide/example')return {ok:true,value:{id:-1,title:'Learn Flowlist',goal_type:'project',completed:false,tasks:[]}};
     return prior(message);
   };
 });
 await page.goto('/app/');
 await page.getByRole('button',{name:'Continue as guest'}).click();
 await expect(page.locator('#onboarding-overlay')).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Keep focus within reach'})).toBeHidden();
 for(let step=1;step<=7;step++){
   await expect(page.locator('#onboarding-count')).toHaveText(`${step} / 7`);
   await page.locator('#onboarding-next').click();
 }
 await expect(page.locator('#onboarding-overlay')).toBeHidden();
 await expect(page.getByRole('dialog',{name:'Keep focus within reach'})).toBeVisible();
});
