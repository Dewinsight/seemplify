const { defineConfig } = require('@playwright/test');

// API-level e2e for the migrated Postgres auth path. Uses Playwright's `request`
// fixture only (no browsers), so no `playwright install` is required.
module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off' },
});
