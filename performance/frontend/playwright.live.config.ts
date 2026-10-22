import { defineConfig, devices } from '@playwright/test';

const productionServer = Boolean(process.env.CI || process.env.PERFORMANCE_E2E_PRODUCTION);

// This suite uses real product API responses and persistence. The keyboard
// regression holds an unchanged HTTP response to reproduce a network race.
export default defineConfig({
  testDir: './e2e-live', fullyParallel: false, workers: 1, retries: 0, timeout: 120_000,
  reporter: [['line'], ['html', { outputFolder: 'playwright-report/live', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5015', channel: 'chrome', headless: true, actionTimeout: 10_000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'real-api-chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node ../backend/tests/helpers/liveJourneyServer.js', url: 'http://127.0.0.1:5014/__test/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: productionServer ? 'npm run build && npx next start -p 5015 -H 127.0.0.1' : 'npx next dev --webpack -p 5015 -H 127.0.0.1', url: 'http://127.0.0.1:5015/login', reuseExistingServer: !productionServer, timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:5014/api', NEXT_PUBLIC_WS_URL: 'ws://127.0.0.1:5014/ws' } },
  ],
});
