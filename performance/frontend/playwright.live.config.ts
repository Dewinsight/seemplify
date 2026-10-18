import { defineConfig, devices } from '@playwright/test';

// Unlike playwright.config.ts, this suite never intercepts product API requests.
export default defineConfig({
  testDir: './e2e-live', fullyParallel: false, workers: 1, retries: 0, timeout: 120_000,
  reporter: [['line'], ['html', { outputFolder: 'playwright-report/live', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5015', channel: 'chrome', headless: true, actionTimeout: 10_000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'real-api-chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node ../backend/tests/helpers/liveJourneyServer.js', url: 'http://127.0.0.1:5014/__test/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npx next dev --webpack -p 5015 -H 127.0.0.1', url: 'http://127.0.0.1:5015/login', reuseExistingServer: !process.env.CI, timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:5014/api', NEXT_PUBLIC_WS_URL: 'ws://127.0.0.1:5014/ws' } },
  ],
});
