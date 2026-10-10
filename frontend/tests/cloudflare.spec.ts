import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../cloudflare/browser-config.json',import.meta.url),'utf8'));

test('Use in browser stays on Cloudflare and opens sign-in without an upstream request', async ({page}) => {
  const external: string[] = [];
  page.on('request',request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:5512') external.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('link',{name:'Use in browser',exact:false}).click();
  await expect(page).toHaveURL('http://127.0.0.1:5512/app/');
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
  await expect(page.locator('#auth-loading')).toBeHidden();
  const response = await page.request.get('/api/config');
  expect(await response.json()).toMatchObject({...config,google_redirect_path:'/app/'});
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(external).toEqual([]);
});

test('the deployed app permits only its Supabase project and keeps OAuth on the app origin', async ({page}) => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const user = {id,email:'tester@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'google'},user_metadata:{},identities:[],created_at:'2026-10-10'};
  const token = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.test-signature`;
  let challenge = '', exchanges = 0, writes = 0;
  const goal = {id:1,title:'Example project',goal_type:'project',completed:false,position:1};
  const tasks: any[] = [];
  await page.route(`${config.supabase_url}/auth/v1/authorize**`, async route => {
    const url = new URL(route.request().url());
    challenge = url.searchParams.get('code_challenge')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    const callback = new URL(url.searchParams.get('redirect_to')!);
    expect(callback.href).toBe('http://127.0.0.1:5512/app/?auth=google');
    callback.searchParams.set('code','test-code');
    await route.fulfill({contentType:'text/html',body:`<script>location.replace(${JSON.stringify(callback.href)})</script>`});
  });
  await page.route(`${config.supabase_url}/auth/v1/token**`, async route => {
    exchanges++;
    const body = route.request().postDataJSON();
    expect(body.auth_code).toBe('test-code');
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
    await route.fulfill({json:{access_token:token,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user}});
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fallback(); // Real built Worker config.
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    if (path === '/api/account') return route.fulfill({json:{id,email:user.email,onboarding_version:999}});
    if (path === '/api/goals/1/tasks' && route.request().method() === 'POST') {
      writes++;
      tasks.push({id:1,goal_id:1,parent_id:null,depth:1,position:1,completed:false,title:route.request().postDataJSON().title});
      return route.fulfill({json:tasks[0]});
    }
    if (path === '/api/goals') return route.fulfill({json:[{...goal,tasks}]});
    if (path === '/api/goals/1/tasks') return route.fulfill({json:tasks});
    if (path === '/api/dashboard') return route.fulfill({json:{queue:[],goals:[{goal,tasks}],activity:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0}});
    return route.fulfill({json:[]});
  });
  const response = await page.goto('/app/#goals');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toContain(`connect-src 'self' ${config.supabase_url}`);
  expect(csp).not.toContain('onrender.com');
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5512/app/#goals');
  expect(exchanges).toBe(1);
  const section = page.locator('#goal-1');
  await section.getByRole('button',{name:'Add step',exact:true}).click();
  await section.getByLabel('New task',{exact:true}).fill('Write the draft');
  await section.getByRole('button',{name:'Add',exact:true}).click();
  await expect(section.getByRole('button',{name:'Write the draft',exact:true})).toBeVisible();
  expect(writes).toBe(1);
  await page.reload();
  await expect(page.getByRole('button',{name:'Write the draft',exact:true})).toBeVisible();
  expect(exchanges).toBe(1);
});
