import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: ['cloudflare.spec.ts', 'site.spec.ts'],
  outputDir: './test-results-cloudflare',
  fullyParallel: true,
  reporter: process.env.CI ? [['line'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5512',
    browserName: process.env.FLOWLIST_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'wrangler pages dev --ip 127.0.0.1 --port 5512',
    url: 'http://127.0.0.1:5512', reuseExistingServer: false,
    env: {WRANGLER_SEND_METRICS:'false'},
  },
});
