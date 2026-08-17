import fs from "node:fs";
import path from "node:path";
import { startMockSuite, TEST_SECRETS } from "./mock-suite.js";

const runtime = path.resolve("../.local-runtime/automation-hub-e2e");
fs.mkdirSync(runtime, { recursive: true });
Object.assign(process.env, {
  NODE_ENV: "test", TEST_AUTH_ENABLED: "true", PORT: "5420", PUBLIC_URL: "http://127.0.0.1:5420",
  DATABASE_PATH: path.join(runtime, "automation.sqlite"), NANGO_BASE_URL: "http://127.0.0.1:5430", NANGO_SECRET_KEY: TEST_SECRETS.nango,
  IDENTITY_API_URL: "http://127.0.0.1:5430", IDENTITY_HMAC_SECRET: TEST_SECRETS.identity,
  WORKSPACE_API_URL: "http://127.0.0.1:5430", WORKSPACE_HMAC_SECRET: TEST_SECRETS.workspace,
  PAYROLL_API_URL: "http://127.0.0.1:5430", PAYROLL_HMAC_SECRET: TEST_SECRETS.payroll,
  LEAVE_API_URL: "http://127.0.0.1:5430", LEAVE_HMAC_SECRET: TEST_SECRETS.leave,
  TIME_API_URL: "http://127.0.0.1:5430", TIME_HMAC_SECRET: TEST_SECRETS.time,
  LEARNING_API_URL: "http://127.0.0.1:5430", LEARNING_HMAC_SECRET: TEST_SECRETS.learning,
  WEBHOOK_ENCRYPTION_KEY: "webhook-encryption-test-secret-123456789",
});

const mock = await startMockSuite(5430);
const { createApp } = await import("../dist/server/app.js");
const server = createApp().listen(5420, "127.0.0.1", () => console.log("Automation Hub E2E runtime ready on 5420"));

async function close() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mock.close();
}
process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));
