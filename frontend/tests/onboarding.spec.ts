import { test, expect } from '@playwright/test';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const emptyDashboard = { queue: [], goals: [], stats: { current_streak: 0, total_sessions: 0, total_minutes: 0 }, week_sessions: 0, activity: [] };

async function setup(page: any, { version = 0, failSave = false, id = owner, autoSignIn = true } = {}) {
  let savedVersion = version;
  const sample={id:50,title:'Learn Flowlist',goal_type:'project',completed:false,position:1,is_example:true,tasks:[{id:501,goal_id:50,title:'Understand Pomodoro',parent_id:null,depth:1,position:0,completed:false},{id:502,goal_id:50,title:'Customize the timer',parent_id:501,depth:2,position:0,completed:false}]};
  let seeded=false,queued=false;
  const writes: string[] = [];
  const user = () => ({ id, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-09-21', app_metadata: {}, user_metadata: { flowlist_onboarding_version: savedVersion }, created_at: '2026-09-21' });
  const session = () => ({ access_token: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: user() });
  if (autoSignIn) await page.addInitScript(({session}: any) => { if (!localStorage.getItem('sb-beta-auth-token')) localStorage.setItem('sb-beta-auth-token', JSON.stringify(session)); }, {session: session()});
  await page.route('https://beta.supabase.co/**', (route: any) => {
    if (route.request().method() === 'PUT') {
      writes.push('preference');
      expect(route.request().postDataJSON().data).toEqual({ flowlist_onboarding_version: 3 });
      if (failSave) return route.fulfill({ status: 500, json: { message: 'Offline' } });
      savedVersion = 3;
    }
    return route.fulfill({ json: user() });
  });
  await page.route('**/api/**', (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (!['GET', 'HEAD'].includes(route.request().method())) writes.push(path);
    if(path==='/api/guide/example'){seeded=true;return route.fulfill({json:sample});}
    if(path==='/api/guide/example/50'){seeded=false;queued=false;return route.fulfill({json:{deleted:true}});}
    if(path==='/api/goals')return route.fulfill({json:seeded?[sample]:[]});
    if(path==='/api/goals/50/tasks')return route.fulfill({json:sample.tasks});
    if(path==='/api/queue/501')queued=route.request().method()==='POST';
    if(path.startsWith('/api/queue'))return route.fulfill({json:queued?[{task:sample.tasks[0],goal:sample}]:[]});
    if (path === '/api/config') return route.fulfill({ json: { auth_mode: 'supabase', supabase_url: 'https://beta.supabase.co', supabase_key: 'sb_publishable_test', google_enabled: true, email_enabled: false } });
    if (path === '/api/account') return route.fulfill({ json: { id, email: user().email, onboarding_version: savedVersion, mode: 'supabase' } });
    if(path==='/api/history/week') { const start=new URL(route.request().url()).searchParams.get('start'); return route.fulfill({json:{sessions:[],days:Array.from({length:7},(_,i)=>{const d=new Date(`${start}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),minutes:0,seconds:0,session_ids:[]};})}}); }
    return route.fulfill({ json: path === '/api/dashboard' ? emptyDashboard : [] });
  });
  return writes;
}

const guide = (page: any) => page.locator('#onboarding-overlay');

const targets=['.plan-create-actions','.guide-priority-anchor','#start-pomodoro','#timer-settings-toggle','#guide-demo-session-summary','#guide-example-progress','.history-week-navigation'];
async function nextStep(page:any){await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('button',{name:/^(Next|Finish guide)$/})).toBeEnabled();}
async function finishGuide(page:any){while(await page.getByRole('button',{name:'Next',exact:true}).count())await nextStep(page);await page.getByRole('button',{name:'Finish guide',exact:true}).click();}

test('first sign-in requires the complete guide, uses safe examples, and persists completion',async({page})=>{
 const writes=await setup(page);await page.goto('/');
 await expect(guide(page)).toBeVisible();await expect(page.locator('#onboarding-title')).toBeFocused();
 await expect(page.getByRole('button',{name:'Close guide',exact:true})).toBeHidden();
 await page.keyboard.press('Escape');await expect(guide(page)).toBeVisible();expect(writes.filter(path=>path!=='/api/guide/example')).toEqual([]);
 await nextStep(page);
 await page.getByRole('button',{name:'Prioritize Understand Pomodoro',exact:true}).click();
 await expect(page.locator('.guide-live-priority')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#guide-priority-preview')).toContainText('Priority tasks');
 for(let i=0;i<3;i++)await nextStep(page);
 await expect(page.locator('#onboarding-count')).toHaveText('5 / 7');
 await page.locator('#guide-demo-session-summary').fill('A practice note');
 await expect(page.locator('#session-summary')).toHaveValue('');
 await nextStep(page);
 await expect(page.locator('#guide-demo-session-summary')).toHaveValue('A practice note');
 await page.getByRole('checkbox',{name:'Finished example task',exact:true}).check();
 await expect(page.getByRole('checkbox',{name:'Worked on example task',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Worked on example task',exact:true}).uncheck();
 await expect(page.getByRole('checkbox',{name:'Finished example task',exact:true})).not.toBeChecked();
 await page.locator('#guide-demo-save-session').click();
 await expect(page.locator('#onboarding-count')).toHaveText('7 / 7');
 expect(writes).toEqual(['/api/guide/example','/api/queue/501']);
 await page.getByRole('button',{name:'Finish guide',exact:true}).click();
 await expect(guide(page)).toBeHidden();await expect.poll(()=>writes).toEqual(['/api/guide/example','/api/queue/501','preference']);
 expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('flowlist-ritual-v2')))).toBe(false);
 await page.evaluate(()=>localStorage.removeItem('flowlist-onboarding-v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
 await page.reload();await expect(page.locator('#help-toggle')).toBeVisible();await expect(guide(page)).toBeHidden();
 await page.getByRole('button',{name:'Guide',exact:true}).click();await expect(guide(page)).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Guide',exact:true})).toBeFocused();expect(writes.filter(path=>path==='preference')).toHaveLength(1);
});

test('reload resumes a required guide without treating partial progress as completion',async({page})=>{
 const writes=await setup(page);await page.goto('/');await nextStep(page);await nextStep(page);
 await expect(page.locator('#onboarding-count')).toHaveText('3 / 7');await page.reload();
 await expect(page.locator('#onboarding-count')).toHaveText('3 / 7');await expect(page.getByRole('button',{name:'Next',exact:true})).toBeEnabled();
 await page.keyboard.press('Escape');await expect(guide(page)).toBeVisible();expect(writes.filter(path=>path!=='/api/guide/example')).toEqual([]);
 await finishGuide(page);await expect(guide(page)).toBeHidden();
});

test('keyboard focus stays inside and a failed completion sync is remembered locally',async({page})=>{
 await setup(page,{failSave:true});await page.goto('/');await expect(guide(page)).toBeVisible();
 for(let i=0;i<12;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');expect(await guide(page).evaluate((node:HTMLElement)=>node.contains(document.activeElement))).toBe(true);}
 await finishGuide(page);await expect(guide(page)).toBeHidden();await expect(page.locator('#app-toast')).toContainText('could not sync');
 await page.reload();await expect(page.locator('#help-toggle')).toBeVisible();await expect(guide(page)).toBeHidden();
});

test('previous users can replay the expanded guide without being forced through it',async({page})=>{
 await setup(page,{version:1});await page.goto('/');await expect(page.locator('#help-toggle')).toBeVisible();await expect(guide(page)).toBeHidden();
 await page.getByRole('button',{name:'Guide',exact:true}).click();await expect(page.locator('#onboarding-count')).toHaveText('1 / 7');
 await page.getByRole('button',{name:'Close guide',exact:true}).click();await expect(guide(page)).toBeHidden();
});

test('another account requires its own guide; sign-out closes it and its examples',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('flowlist-onboarding-v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','complete'));
 await setup(page,{id:other});await page.goto('/');await nextStep(page);await expect(page.locator('.guide-live-priority')).toBeVisible();
 await page.evaluate(()=>{localStorage.removeItem('sb-beta-auth-token');const channel=new BroadcastChannel('sb-beta-auth-token');channel.postMessage({event:'SIGNED_OUT',session:null});channel.close();});
 await expect(guide(page)).toBeHidden();await expect(page.locator('#auth-screen')).toBeVisible();await expect(page.locator('.app-shell')).toBeHidden();
});

test('guide waits for authentication and a restored timer, then starts when it is saved',async({page})=>{
 await setup(page,{autoSignIn:false});await page.goto('/');await expect(page.locator('#auth-google')).toBeVisible();await expect(guide(page)).toBeHidden();
 await setup(page);
 await page.addInitScript(()=>localStorage.setItem('flowlist-ritual-v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',JSON.stringify({id:'restored',phase:'focus',elapsedSeconds:0,round:1,settings:{focus:25,break:5,longBreak:15,rounds:4},deadline:Date.now()+600000,blockSeconds:1500,breakKind:'short',minimized:false,summary:'',selections:[],startedAt:Date.now(),blocks:[]})));
 await page.reload();await expect(page.locator('#focus-overlay')).toBeVisible();await expect(guide(page)).toBeHidden();
 await page.evaluate(()=>{localStorage.removeItem('flowlist-ritual-v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');document.getElementById('focus-overlay')!.classList.add('hidden');});
 await expect(guide(page)).toBeVisible();
});

for(const [width,height] of [[375,812],[812,375],[1440,900]])test(`guide fits ${width}×${height}, tracks each target and exposes all steps`,async({page},testInfo)=>{
 await page.setViewportSize({width,height});await setup(page);await page.goto('/');await expect(guide(page)).toBeVisible();
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  if(theme==='dark')for(let i=0;i<6;i++)await page.getByRole('button',{name:'Back',exact:true}).click();
  for(const [i,selector] of targets.entries()) {
   if(i>0)await nextStep(page);
   await expect(page.locator('#onboarding-count')).toHaveText(`${i+1} / 7`);
   await expect(page.getByRole('button',{name:/^(Next|Finish guide)$/})).toBeEnabled();
   const target=page.locator(selector),ring=page.locator('#guide-spotlight');
   await expect.poll(async()=>{const a=(await target.boundingBox())!,b=(await ring.boundingBox())!;return Math.abs(b.x-(a.x-3))+Math.abs(b.y-(a.y-3))+Math.abs(b.width-(a.width+6))+Math.abs(b.height-(a.height+6));}).toBeLessThan(2);
   const a=(await target.boundingBox())!,b=(await page.locator('.guide-modal').boundingBox())!;
   expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);
   expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(height);
   expect(Math.max(0,Math.min(b.x+b.width,a.x+a.width)-Math.max(b.x,a.x))*Math.max(0,Math.min(b.y+b.height,a.y+a.height)-Math.max(b.y,a.y))).toBe(0);
   expect(a.y).toBeGreaterThanOrEqual(0);expect(a.y+a.height).toBeLessThanOrEqual(height);
   await page.screenshot({animations:'disabled',path:testInfo.outputPath(`guide-${i}-${theme}.png`)});
  }
 }
 await page.getByRole('button',{name:'Finish guide',exact:true}).click();await expect(guide(page)).toBeHidden();
});

test('highlight follows movement without a resize and adapts after viewport resizing',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByRole('button',{name:'Next',exact:true})).toBeEnabled();
 await page.locator('.plan-create-actions').evaluate(node=>(node as HTMLElement).style.transform='translate(9px, 13px)');
 await expect.poll(async()=>{const a=(await page.locator('.plan-create-actions').boundingBox())!,b=(await page.locator('#guide-spotlight').boundingBox())!;return Math.abs(b.x-(a.x-3))+Math.abs(b.y-(a.y-3));}).toBeLessThan(1);
 await page.setViewportSize({width:375,height:812});
 await expect.poll(async()=>{const a=(await page.locator('.plan-create-actions').boundingBox())!,b=(await page.locator('#guide-spotlight').boundingBox())!;return Math.abs(b.x-(a.x-3))+Math.abs(b.y-(a.y-3));}).toBeLessThan(1);
});


test('Remove example deletes only the marked sample after the guide',async({page})=>{
 const writes=await setup(page);await page.goto('/');
 for(let i=0;i<6;i++)await nextStep(page);
 await page.getByRole('radio',{name:'Remove example',exact:true}).check();
 await page.getByRole('button',{name:'Finish guide',exact:true}).click();await expect(guide(page)).toBeHidden();
 expect(writes).toEqual(['/api/guide/example','/api/guide/example/50','preference']);
});

test('sample creation and removal failures remain recoverable',async({page})=>{
 await setup(page);await page.route('**/api/guide/example',route=>route.fulfill({status:503,json:{detail:'Offline'}}));await page.goto('/');
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();
 await page.unroute('**/api/guide/example');await page.getByRole('button',{name:'Retry',exact:true}).click();
 for(let i=0;i<6;i++)await nextStep(page);
 await page.route('**/api/guide/example/50',route=>route.fulfill({status:503,json:{detail:'Offline'}}));
 await page.getByRole('radio',{name:'Remove example',exact:true}).check();await page.getByRole('button',{name:'Finish guide',exact:true}).click();
 await expect(page.locator('#guide-error')).toContainText('Could not remove');
 await page.getByRole('radio',{name:'Keep example',exact:true}).check();await page.getByRole('button',{name:'Finish guide',exact:true}).click();await expect(guide(page)).toBeHidden();
});
