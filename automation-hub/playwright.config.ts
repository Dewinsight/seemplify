import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5420", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run e2e:server",
    url: "http://127.0.0.1:5420/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
