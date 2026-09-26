import { test, expect } from '@playwright/test';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const emptyDashboard = { queue: [], goals: [], stats: { current_streak: 0, total_sessions: 0, total_minutes: 0 }, week_sessions: 0, activity: [] };

async function setup(page: any, { version = 0, failSave = false, id = owner, autoSignIn = true } = {}) {
  let savedVersion = version;
  const writes: string[] = [];
  const user = () => ({ id, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-09-21', app_metadata: {}, user_metadata: { flowlist_onboarding_version: savedVersion }, created_at: '2026-09-21' });
  const session = () => ({ access_token: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: user() });
  if (autoSignIn) await page.addInitScript(({session}: any) => { if (!localStorage.getItem('sb-beta-auth-token')) localStorage.setItem('sb-beta-auth-token', JSON.stringify(session)); }, {session: session()});
  await page.route('https://beta.supabase.co/**', (route: any) => {
    if (route.request().method() === 'PUT') {
      writes.push('preference');
      expect(route.request().postDataJSON().data).toEqual({ flowlist_onboarding_version: 1 });
      if (failSave) return route.fulfill({ status: 500, json: { message: 'Offline' } });
      savedVersion = 1;
    }
    return route.fulfill({ json: user() });
  });
  await page.route('**/api/**', (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (!['GET', 'HEAD'].includes(route.request().method())) writes.push(path);
    if (path === '/api/config') return route.fulfill({ json: { auth_mode: 'supabase', supabase_url: 'https://beta.supabase.co', supabase_key: 'sb_publishable_test', google_enabled: true, email_enabled: false } });
    if (path === '/api/account') return route.fulfill({ json: { id, email: user().email, onboarding_version: savedVersion, mode: 'supabase' } });
    return route.fulfill({ json: path === '/api/dashboard' ? emptyDashboard : [] });
  });
  return writes;
}

const guide = (page: any) => page.locator('#onboarding-overlay');

test('first sign-in teaches the workflow, saves the preference, and does not create work or start a timer', async ({page}) => {
  const writes = await setup(page);
  await page.goto('/');
  await expect(guide(page)).toBeVisible();
  await expect(page.locator('#onboarding-title')).toBeFocused();
  await expect(guide(page)).toContainText('something you want to build or learn');
  await page.getByRole('button', {name:'Next: Focus',exact:true}).click();
  await expect(guide(page)).toContainText('You do not need to select a task first');
  await page.getByRole('button', {name:'Back',exact:true}).click();
  await expect(page.locator('#onboarding-count')).toHaveText('Step 1 of 4');
  await page.getByRole('button', {name:'Next: Focus',exact:true}).click();
  await page.getByRole('button', {name:'Next: Review',exact:true}).click();
  await expect(guide(page)).toContainText('Check Finished only for work you completed');
  await page.getByRole('button', {name:'Next: History',exact:true}).click();
  await page.getByRole('button', {name:'Open Plan',exact:true}).click();
  await expect(guide(page)).toBeHidden();
  await expect(page).toHaveURL(/#goals$/);
  await expect.poll(() => writes).toEqual(['preference']);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('flowlist-ritual-v2')))).toBe(false);
  // Clear the local hint: server preference must still prevent a repeat on another browser.
  await page.evaluate(() => localStorage.removeItem('flowlist-onboarding-v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  await page.reload();
  await expect(page.locator('#help-toggle')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await page.getByRole('button', {name:'Help',exact:true}).click();
  await expect(guide(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name:'Help',exact:true})).toBeFocused();
  expect(writes).toEqual(['preference']);
});

test('Skip and Escape work, keyboard focus stays inside, and a failed sync does not trap the user', async ({page}) => {
  await setup(page, {failSave:true});
  await page.goto('/');
  await expect(guide(page)).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await guide(page).evaluate((node: HTMLElement) => node.contains(document.activeElement))).toBe(true);
  }
  await page.getByRole('button',{name:'Skip guide',exact:true}).click();
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('#app-toast')).toContainText('could not sync');
  await page.reload();
  await expect(page.locator('#help-toggle')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
});

test('a different account gets its own guide; sign-out in another tab closes it', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('flowlist-onboarding-v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seen'));
  await setup(page,{id:other});
  await page.goto('/');
  await expect(guide(page)).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('sb-beta-auth-token');
    const channel = new BroadcastChannel('sb-beta-auth-token');
    channel.postMessage({event:'SIGNED_OUT',session:null});
    channel.close();
  });
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('#auth-screen')).toBeVisible();
  await expect(page.locator('.app-shell')).toBeHidden();
});

test('guide never appears before authentication or over a restored timer', async ({page}) => {
  await setup(page,{autoSignIn:false});
  await page.goto('/');
  await expect(page.locator('#auth-google')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('flowlist-ritual-v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', JSON.stringify({id:'restored',phase:'focus',elapsedSeconds:0,round:1,settings:{focus:25,break:5,longBreak:15,rounds:4},deadline:Date.now()+600000,blockSeconds:1500,breakKind:'short',minimized:false,summary:'',selections:[],startedAt:Date.now(),blocks:[]})));
  await page.reload();
  await expect(page.locator('#focus-overlay')).toBeVisible();
  await expect(guide(page)).toBeHidden();
});

for (const [width,height] of [[375,812],[812,375],[1440,900]]) {
  test(`guide fits ${width}×${height} in light and dark; all steps remain reachable`, async ({page}, testInfo) => {
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    await setup(page);
    await page.goto('/');
    await expect(guide(page)).toBeVisible();
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const name of ['01Plan','02Focus','03Review','04History']) {
        const step = page.locator('.guide-steps button').filter({hasText:name.slice(2)});
        await step.click();
        await expect(step).toHaveAttribute('aria-current','step');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await page.locator('.guide-modal').evaluate(node => {
          const box = node.getBoundingClientRect();
          return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,overflow:node.scrollWidth-node.clientWidth};
        });
        expect(metrics.left).toBeGreaterThanOrEqual(0);
        expect(metrics.right).toBeLessThanOrEqual(width);
        expect(metrics.top).toBeGreaterThanOrEqual(0);
        expect(metrics.bottom).toBeLessThanOrEqual(height);
        expect(metrics.overflow).toBeLessThanOrEqual(1);
        if (name === '01Plan') await page.screenshot({path:testInfo.outputPath(`guide-${width}-${theme}.png`)});
      }
    }
    await expect(page.getByRole('button',{name:'Open Plan',exact:true})).toBeInViewport();
    await page.getByRole('button',{name:'Go to Today',exact:true}).click();
    await expect(page).toHaveURL(/#dashboard$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
