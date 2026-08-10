import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tax',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-tax', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5007',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e-tax/mock-payroll-api.mjs',
      url: 'http://127.0.0.1:5006/api/__e2e__/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run start',
      url: 'http://127.0.0.1:5007/admin/settings/employer-entities',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
