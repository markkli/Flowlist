import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5511', browserName:'chromium', screenshot:'only-on-failure', trace:'retain-on-failure' },
  webServer: { command:'npm run dev -- --port 5511', url:'http://127.0.0.1:5511', reuseExistingServer:!process.env.CI },
});
