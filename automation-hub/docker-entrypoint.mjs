import fs from "node:fs";

const secretNames = [
  "OIDC_CLIENT_SECRET",
  "SESSION_SECRET",
  "WEBHOOK_ENCRYPTION_KEY",
  "NANGO_SECRET_KEY",
  "IDENTITY_HMAC_SECRET",
  "WORKSPACE_HMAC_SECRET",
  "PAYROLL_HMAC_SECRET",
  "LEAVE_HMAC_SECRET",
  "TIME_HMAC_SECRET",
  "LEARNING_HMAC_SECRET",
];

if (process.getuid?.() === 0) {
  for (const name of secretNames) {
    const fileVariable = `${name}_FILE`;
    const file = String(process.env[fileVariable] || "").trim();
    if (!file) continue;
    process.env[name] = fs.readFileSync(file, "utf8").trim();
    delete process.env[fileVariable];
  }

  fs.chownSync("/app/data", 1000, 1000);
  process.setgid(1000);
  process.setuid(1000);
}

await import("./dist/server/server.js");
