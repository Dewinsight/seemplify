import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.RECRUITER_E2E_PORT || 5050);
const baseURL = process.env.RECRUITER_E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: process.env.RECRUITER_E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/playwright-web-server.mjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          NEXT_PUBLIC_API_BASE_URL: baseURL,
          NEXT_PUBLIC_WS_BASE_URL: baseURL.replace('http', 'ws'),
          NEXT_PUBLIC_IDP_URL: `${baseURL}/__mock-idp`,
          NEXT_PUBLIC_INACTIVITY_TIMEOUT: '3600000',
          NEXT_PUBLIC_INACTIVITY_WARNING_TIME: '300000',
        },
      },
});
