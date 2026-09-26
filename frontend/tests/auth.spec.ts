import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user={id:userId,email:'tester@example.com',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-09-21',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:'2026-09-21'};
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.test-signature`;
const dashboard={queue:[],goals:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0,activity:[]};

test.beforeEach(async({context})=>{
 await context.route('https://beta.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/otp')||path.endsWith('/logout')) return route.fulfill({json:{}});
  if(path.endsWith('/verify')||path.endsWith('/token')) return route.fulfill({json:{access_token:token(),refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user}});
  return route.fulfill({json:user});
 });
 await context.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/config') return route.fulfill({json:{auth_mode:'supabase',supabase_url:'https://beta.supabase.co',supabase_key:'sb_publishable_test',signup_enabled:false,google_enabled:true,email_enabled:true}});
  if(!route.request().headers().authorization) return route.fulfill({status:401,json:{detail:'Sign in'}});
  if(path==='/api/account') return route.fulfill({json:route.request().method()==='DELETE'?{deleted:true}:{id:userId,email:user.email,mode:'supabase',onboarding_version:1}});
  return route.fulfill({json:path==='/api/dashboard'?dashboard:[]});
 });
});
async function signIn(page:any){
 await page.goto('/');
 await page.getByLabel('Email address',{exact:true}).fill(user.email);
 await page.getByRole('button',{name:'Send sign-in code'}).click();
 await page.getByLabel('Email code',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
}

test('Google-only beta hides email sending and completes Google sign-in',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{auth_mode:'supabase',supabase_url:'https://beta.supabase.co',supabase_key:'sb_publishable_test',signup_enabled:false,google_enabled:true,email_enabled:false}}));
 let emailsSent=0;
 await page.route('https://beta.supabase.co/auth/v1/otp',route=>{emailsSent++;return route.fulfill({json:{}});});
 await mockGoogle(page);
 await page.goto('/');
 await expect(page.locator('#auth-beta-note')).toContainText('invited Google account');
 await expect(page.locator('#auth-form')).toBeHidden();
 await expect(page.locator('#auth-divider')).toBeHidden();
 await page.locator('#auth-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(emailsSent).toBe(0);
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
 expect(emailsSent).toBe(0);
});

test('missing provider flags hide email and explain unavailable sign-in',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{auth_mode:'supabase',supabase_url:'https://beta.supabase.co',supabase_key:'sb_publishable_test',signup_enabled:false}}));
 await page.goto('/');
 await expect(page.locator('#auth-error')).toContainText('Sign-in is not available');
 await expect(page.locator('#auth-form')).toBeHidden();
 await expect(page.locator('#auth-google-option')).toBeHidden();
 await expect(page.locator('.app-shell')).toBeHidden();
});

async function mockGoogle(page:any, outcome:'success'|'cancel'|'invalid' = 'success') {
 let challenge='';
 let exchanges=0;
 await page.route('https://beta.supabase.co/auth/v1/authorize**',async (route:any)=>{
  const url=new URL(route.request().url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');
  expect(url.searchParams.get('scopes')).toBe('openid email profile');
  expect(url.searchParams.get('prompt')).toBe('select_account');
  challenge=url.searchParams.get('code_challenge')!;
  expect(challenge.length).toBeGreaterThan(30);
  const callback=new URL(url.searchParams.get('redirect_to')!);
  expect(callback.origin).toBe(new URL(page.url()).origin);
  expect(callback.pathname+callback.search).toBe('/?auth=google');
  if(outcome==='cancel') callback.hash='error=access_denied&error_description=untrusted-provider-text';
  else callback.searchParams.set('code','one-use-test-code');
  callback.searchParams.set('next','https://untrusted.example');
  // WebKit's route mock cannot synthesize HTTP redirects. A provider document
  // performs the same cross-origin round trip without contacting real Google.
  await route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.replace(${JSON.stringify(callback.href)})</script>`});
 });
 await page.route('https://beta.supabase.co/auth/v1/token?grant_type=pkce',async (route:any)=>{
  exchanges++;
  const body=route.request().postDataJSON();
  expect(body.auth_code).toBe('one-use-test-code');
  expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
  if(outcome==='invalid') return route.fulfill({status:400,json:{error:'invalid_grant',error_description:'Code expired'}});
  return route.fulfill({json:{access_token:token(),refresh_token:'google-test-refresh',expires_in:3600,token_type:'bearer',user:{...user,app_metadata:{provider:'google',providers:['google']}}}});
 });
 return ()=>exchanges;
}

test('Google uses PKCE, verifies beta access, restores the view, and clears the one-use callback',async({page})=>{
 const exchanges=await mockGoogle(page);
 await page.goto('/#goals');
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
 await expect(page).toHaveURL(/\/#goals$/);
 expect(exchanges()).toBe(1);
 expect(await page.evaluate(()=>sessionStorage.getItem('flowlist-google-signin'))).toBeNull();
 await page.reload();
 await expect(page.locator('.app-shell')).toBeVisible();
 expect(exchanges()).toBe(1);
});

for(const outcome of ['cancel','invalid'] as const) test(`Google ${outcome} returns safely to sign-in with email fallback`,async({page})=>{
 await mockGoogle(page,outcome);
 await page.goto('/');
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.locator('#auth-error')).toContainText(outcome==='cancel'?'canceled':'could not be verified');
 await expect(page.locator('#auth-error')).not.toContainText('untrusted-provider-text');
 await expect(page.locator('.app-shell')).toBeHidden();
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Send sign-in code'})).toBeEnabled();
 expect(new URL(page.url()).search+new URL(page.url()).hash).toBe('');
 await page.getByLabel('Email address',{exact:true}).fill(user.email);
 await page.getByRole('button',{name:'Send sign-in code'}).click();
 await page.getByLabel('Email code',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
});

test('a Google session outside the beta allowlist cannot open the app',async({page})=>{
 await mockGoogle(page);
 await page.route('**/api/account',route=>route.fulfill({status:403,json:{detail:'This beta is invitation-only.'}}));
 await page.goto('/');
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.locator('#auth-error')).toContainText('invitation-only');
 await expect(page.locator('.app-shell')).toBeHidden();
});

test('unsolicited or expired Google callbacks never exchange a code',async({page})=>{
 let exchanges=0;
 page.on('request',r=>{if(r.url().includes('grant_type=pkce'))exchanges++;});
 await page.goto('/?auth=google&code=unsolicited');
 await expect(page.locator('#auth-error')).toContainText('expired');
 await page.evaluate(()=>sessionStorage.setItem('flowlist-google-signin',JSON.stringify({startedAt:Date.now()-3600000,view:'#goals'})));
 await page.goto('/?auth=google&code=expired');
 await expect(page.locator('#auth-error')).toContainText('expired');
 await expect(page.locator('.app-shell')).toBeHidden();
 expect(exchanges).toBe(0);
 expect(new URL(page.url()).search).toBe('');
});

test('Google stays hidden until provider setup is enabled',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{auth_mode:'supabase',supabase_url:'https://beta.supabase.co',supabase_key:'sb_publishable_test',signup_enabled:false,google_enabled:false,email_enabled:true}}));
 await page.goto('/');
 await expect(page.getByLabel('Email address',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeHidden();
});

test('a failed Google return does not silently reopen a previously signed-in account',async({page})=>{
 await signIn(page);
 await page.goto('/?auth=google&code=unsolicited');
 await expect(page.locator('#auth-error')).toContainText('expired');
 await expect(page.locator('.app-shell')).toBeHidden();
});

test('email sign-in gates private requests, attaches a token, and never claims legacy local drafts',async({page})=>{
 const requests:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&!r.url().endsWith('/config'))requests.push(r.headers().authorization||'missing');});
 await page.addInitScript(()=>localStorage.setItem('flowlist-ritual-v2',JSON.stringify({id:'local-secret',phase:'focus',elapsedSeconds:0,round:1,settings:{focus:25,break:5,rounds:4,longBreak:15},deadline:Date.now()+1500000,blockSeconds:1500,breakKind:'short',minimized:true,summary:'Private local note',selections:[]})));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Welcome to Flowlist'})).toBeVisible();
 await expect(page.locator('.app-shell')).toBeHidden();
 expect(requests).toEqual([]);
 await signIn(page);
 expect(requests.every(value=>value.startsWith('Bearer '))).toBe(true);
 await expect(page.locator('#timer-mini')).toBeHidden();
 await page.locator('#start-pomodoro').click();
 await expect(page.locator('#focus-overlay')).toBeVisible();
 expect(await page.evaluate(id=>!!localStorage.getItem(`flowlist-ritual-v2:${id}`),userId)).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('flowlist-ritual-v2')!).id)).toBe('local-secret');
 await page.reload();
 await expect(page.locator('#focus-overlay')).toBeVisible();
});

test('expired code and rejected beta access keep the app hidden and let the user retry',async({page})=>{
 await page.route('https://beta.supabase.co/auth/v1/verify',route=>route.fulfill({status:403,json:{message:'Token has expired or is invalid',code:'otp_expired'}}));
 await page.goto('/');
 await page.getByLabel('Email address',{exact:true}).fill(user.email);
 await page.getByRole('button',{name:'Send sign-in code'}).click();
 await page.getByLabel('Email code',{exact:true}).fill('111111');
 await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.locator('#auth-error')).toContainText('expired');
 await expect(page.locator('.app-shell')).toBeHidden();
 await page.unroute('https://beta.supabase.co/auth/v1/verify');
 await page.route('**/api/account',route=>route.fulfill({status:403,json:{detail:'This beta is invitation-only.'}}));
 await page.getByRole('button',{name:'Verify and continue'}).click();
 await expect(page.locator('#auth-error')).toContainText('invitation-only');
 await expect(page.locator('.app-shell')).toBeHidden();
});

test('cross-tab sign-out freezes timers and private UI without deleting the account draft',async({page,context})=>{
 await signIn(page);
 await page.locator('#start-pomodoro').click();
 await expect(page.locator('#focus-overlay')).toBeVisible();
 const other=await context.newPage();await other.goto('/');
 await expect(other.locator('.app-shell')).toBeVisible();
 await other.getByRole('button',{name:'Minimize timer'}).click();
 await other.locator('#account-controls > summary').click();
 other.on('dialog',dialog=>dialog.accept());
 await other.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.locator('.app-shell')).toBeHidden();
 await expect(page.locator('#focus-overlay')).toBeHidden();
 await expect(page.locator('#auth-error')).toContainText('signed out or changed accounts');
 expect(await page.evaluate(id=>!!localStorage.getItem(`flowlist-ritual-v2:${id}`),userId)).toBe(true);
});

test('account deletion requires typed confirmation and removes only this account’s drafts',async({page})=>{
 let deleted=false;
 await page.route('**/api/account',async route=>{
  if(route.request().method()==='DELETE') {expect(route.request().postDataJSON()).toEqual({confirmation:'DELETE'});deleted=true;return route.fulfill({json:{deleted:true}});}
  return route.fallback();
 });
 await signIn(page);
 await page.evaluate(id=>{localStorage.setItem(`flowlist-ritual-v2:${id}`,'own');localStorage.setItem('flowlist-ritual-v2:another-user','keep');},userId);
 await page.locator('#account-controls > summary').click();
 await page.locator('#account-controls details > summary').click();
 await page.getByRole('button',{name:'Delete my account'}).click();expect(deleted).toBe(false);
 await page.getByLabel('Type DELETE to confirm').fill('DELETE');
 await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Delete my account'}).click()]);
 await expect(page.getByRole('heading',{name:'Welcome to Flowlist'})).toBeVisible();
 expect(deleted).toBe(true);
 expect(await page.evaluate(id=>localStorage.getItem(`flowlist-ritual-v2:${id}`),userId)).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('flowlist-ritual-v2:another-user'))).toBe('keep');
});

for(const width of [375,768,1440]) test(`sign-in fits ${width}px in both modes`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await page.goto('/');
 await expect(page.getByLabel('Email address',{exact:true})).toBeVisible();
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`sign-in-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
 }
});
