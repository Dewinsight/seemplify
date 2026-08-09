import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 5011);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './e2e',
    testIgnore: 'live-attendance.spec.ts',
    outputDir: 'test-results',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        geolocation: { latitude: 51.5074, longitude: -0.1278 },
        permissions: ['geolocation'],
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
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
            command: 'npm run start',
            url: `${baseURL}/login`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                NEXT_PUBLIC_API_URL: 'http://localhost:5010/api',
                NEXT_PUBLIC_IDP_URL: 'http://localhost:4000',
            },
        },
});
