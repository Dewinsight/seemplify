import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_EXTERNAL_URL;
const edgeIp = process.env.PLAYWRIGHT_EDGE_IP;
const localPort = Number(process.env.PLAYWRIGHT_PORT || 5412);
if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65_535) throw new Error('PLAYWRIGHT_PORT must be an integer between 1024 and 65535.');
const localBaseUrl = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: './e2e', timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: externalBaseUrl || localBaseUrl, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', launchOptions: edgeIp ? { args: [`--host-resolver-rules=MAP experience.aiinnigeria.com ${edgeIp}`] } : undefined },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ],
  webServer: externalBaseUrl ? undefined : { command: 'npm exec tsx backend/test/e2e-server.ts', url: `${localBaseUrl}/health`, reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe' },
  outputDir: 'test-results'
});
