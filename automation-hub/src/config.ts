import fs from "node:fs";
import path from "node:path";

function value(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

export function secret(name: string, required = false) {
  const file = value(`${name}_FILE`);
  const direct = value(name);
  let resolved = direct;
  if (file) {
    try { resolved = fs.readFileSync(file, "utf8").trim(); }
    catch { throw new Error(`${name}_FILE could not be read.`); }
  }
  if (required && resolved.length < 24) throw new Error(`${name} must be configured with at least 24 characters.`);
  return resolved;
}

const nodeEnv = value("NODE_ENV", "development");
const publicUrl = value("PUBLIC_URL", "http://127.0.0.1:5421").replace(/\/$/u, "");
const testAuthEnabled = nodeEnv === "test" && value("TEST_AUTH_ENABLED") === "true";

if (nodeEnv === "production") {
  for (const name of ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_REDIRECT_URI"]) {
    if (!value(name)) throw new Error(`${name} is required in production.`);
  }
  secret("OIDC_CLIENT_SECRET", true);
  secret("SESSION_SECRET", true);
}

export const config = Object.freeze({
  nodeEnv,
  port: Math.max(1, Number(value("PORT", "5420"))),
  publicUrl,
  databasePath: path.resolve(value("DATABASE_PATH", "../.local-runtime/automation-hub/automation.sqlite")),
  testAuthEnabled,
  oidc: {
    issuerUrl: value("OIDC_ISSUER_URL"),
    clientId: value("OIDC_CLIENT_ID", "automation-hub"),
    redirectUri: value("OIDC_REDIRECT_URI", `${publicUrl}/auth/callback`),
  },
  nangoBaseUrl: value("NANGO_BASE_URL", "http://127.0.0.1:3003").replace(/\/$/u, ""),
  products: {
    workspace: { url: value("WORKSPACE_API_URL"), secretName: "WORKSPACE_HMAC_SECRET" },
    payroll: { url: value("PAYROLL_API_URL"), secretName: "PAYROLL_HMAC_SECRET" },
    leave: { url: value("LEAVE_API_URL"), secretName: "LEAVE_HMAC_SECRET" },
    time: { url: value("TIME_API_URL"), secretName: "TIME_HMAC_SECRET" },
    identity: { url: value("IDENTITY_API_URL"), secretName: "IDENTITY_HMAC_SECRET" },
    learning: { url: value("LEARNING_API_URL"), secretName: "LEARNING_HMAC_SECRET" },
  },
});
