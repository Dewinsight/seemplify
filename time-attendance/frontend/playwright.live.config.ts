import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5111';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'live-attendance.spec.ts',
    outputDir: 'test-results/live',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 12_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report/live', open: 'never' }],
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        permissions: [],
    },
    projects: [
        {
            name: 'desktop-live-chromium',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
        },
        {
            name: 'mobile-live-chromium',
            use: { ...devices['Pixel 7'] },
        },
    ],
});
