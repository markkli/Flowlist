import {test,expect} from '@playwright/test';

for (const width of [375,768,1440]) test(`public pages fit ${width}px without contacting the app server`, async({page}) => {
  await page.setViewportSize({width,height:960});
  const api:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))api.push(request.url());});
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Focus, from your menu bar.');
  await expect(page.getByRole('link',{name:'Download for Mac',exact:false}).first()).toHaveAttribute('href','/download/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/download/');
  await expect(page.locator('#release-status')).toContainText('being prepared');
  await expect(page.locator('#mac-download')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(api).toEqual([]);
});

test('download needs a trusted URL and checksum; published metadata is displayed as text',async({page})=>{
  const release={available:true,version:'0.5.0',minimumMacOS:'14.0',architecture:'Apple silicon',url:'https://github.com/markkli/Flowlist/releases/download/mac-v0.5.0/Flowlist-0.5.0-arm64.zip',sha256:'b'.repeat(64),bytes:12000000,widgetIncluded:false};
  await page.route('**/releases/mac.json',route=>route.fulfill({json:release}));
  await page.goto('/download/');
  await expect(page.locator('#mac-download')).toHaveAttribute('href',release.url);
  await expect(page.locator('#release-meta')).toContainText('Apple silicon · 12.0 MB');
  await page.getByText('Verify download',{exact:true}).click();
  await expect(page.locator('.download-checksum code')).toContainText(release.sha256);
  release.url='https://untrusted.example/Flowlist.zip';
  await page.reload();
  await expect(page.locator('#mac-download')).toBeHidden();
  await expect(page.locator('#release-status')).toContainText('could not be checked');
});

test('old workspace bookmarks stay on the same origin and open the app',async({page})=>{
  await page.route('**/api/config',route=>route.fulfill({json:{auth_mode:'local'}}));
  await page.route('**/api/goals**',route=>route.fulfill({json:[]}));
  await page.route('**/api/dashboard',route=>route.fulfill({json:{queue:[],goals:[],activity:[],stats:{current_streak:0,total_sessions:0,total_minutes:0},week_sessions:0}}));
  await page.goto('/#goals');
  await expect(page).toHaveURL(/\/app\/#goals$/);
  await expect(page.locator('#nav-goals')).toBeVisible();
});
