import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { audit } from "./audit.js";
import { config, secret } from "./config.js";
import { db, now } from "./database.js";
import type { EventEnvelope, SessionActor } from "./domain.js";

function encryptionKey() {
  const raw = secret("WEBHOOK_ENCRYPTION_KEY", config.nodeEnv === "production");
  if (!raw) return crypto.createHash("sha256").update("automation-hub-development-webhook-key").digest();
  return crypto.createHash("sha256").update(raw).digest();
}

function seal(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function open(value: string) {
  const [prefix, version, iv, tag, encrypted] = value.split(":");
  if (prefix !== "enc" || version !== "v1" || !iv || !tag || !encrypted) throw new Error("Webhook signing material is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function listSubscriptions(actor: SessionActor) {
  return db.prepare("SELECT id,name,event_pattern,target_url,status,created_by,created_at FROM event_subscriptions WHERE organization_id=? ORDER BY created_at DESC")
    .all(actor.organizationId);
}

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertSafeTarget(target: URL) {
  if (config.nodeEnv === "test") return;
  if (target.protocol !== "https:" || target.username || target.password || target.port && target.port !== "443") {
    throw Object.assign(new Error("Webhook targets must use public HTTPS on port 443."), { status: 400, code: "WEBHOOK_TARGET_DENIED" });
  }
  if (["localhost", "localhost.localdomain"].includes(target.hostname.toLowerCase())) throw Object.assign(new Error("Private webhook targets are not allowed."), { status: 400, code: "WEBHOOK_TARGET_DENIED" });
  let addresses: Array<{ address: string }>;
  try { addresses = await dns.lookup(target.hostname, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error("Webhook target DNS could not be verified."), { status: 400, code: "WEBHOOK_TARGET_UNRESOLVED" }); }
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) {
    throw Object.assign(new Error("Private webhook targets are not allowed."), { status: 400, code: "WEBHOOK_TARGET_DENIED" });
  }
}

export async function createSubscription(actor: SessionActor, input: { name: string; eventPattern: string; targetUrl: string }) {
  let target: URL;
  try { target = new URL(input.targetUrl); } catch { throw Object.assign(new Error("Enter a valid HTTPS webhook URL."), { status: 400 }); }
  if (config.nodeEnv === "production" && target.protocol !== "https:") throw Object.assign(new Error("Production subscriptions require HTTPS."), { status: 400 });
  await assertSafeTarget(target);
  if (!input.eventPattern.trim()) throw Object.assign(new Error("Choose an event pattern."), { status: 400 });
  const signingSecret = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO event_subscriptions
    (id,organization_id,name,event_pattern,target_url,secret_cipher_ref,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,'active',?,?)`)
    .run(id, actor.organizationId, input.name.trim().slice(0, 120), input.eventPattern.trim(), target.toString(), seal(signingSecret), actor.id, now());
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "event_subscription.created", targetType: "event_subscription", targetId: id, metadata: { eventPattern: input.eventPattern, targetOrigin: target.origin } });
  return { id, signingSecret };
}

export function revokeSubscription(actor: SessionActor, id: string) {
  const result = db.prepare("UPDATE event_subscriptions SET status='revoked' WHERE id=? AND organization_id=?").run(id, actor.organizationId);
  if (!result.changes) throw Object.assign(new Error("Subscription not found."), { status: 404 });
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "event_subscription.revoked", targetType: "event_subscription", targetId: id });
}

function matches(pattern: string, eventName: string) {
  return pattern === "*" || pattern === eventName || (pattern.endsWith(".*") && eventName.startsWith(pattern.slice(0, -1)));
}

async function deliver(subscription: any, envelope: EventEnvelope, attempt: number) {
  const body = JSON.stringify(envelope);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", open(subscription.secret_cipher_ref)).update(`${timestamp}.${body}`).digest("hex");
  const deliveryId = crypto.randomUUID();
  const at = now();
  db.prepare(`INSERT INTO webhook_deliveries
    (id,subscription_id,event_id,attempt,status,created_at,updated_at)
    VALUES (?,?,?,?, 'pending',?,?)`).run(deliveryId, subscription.id, envelope.id, attempt, at, at);
  try {
    await assertSafeTarget(new URL(subscription.target_url));
    const response = await fetch(subscription.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Seemplify-Event-Id": envelope.id,
        "X-Seemplify-Webhook-Timestamp": timestamp,
        "X-Seemplify-Webhook-Signature": `sha256=${signature}`,
      },
      body,
      redirect: "error",
    });
    if (!response.ok) throw Object.assign(new Error(`Webhook returned ${response.status}.`), { responseStatus: response.status });
    db.prepare("UPDATE webhook_deliveries SET status='delivered',response_status=?,updated_at=? WHERE id=?").run(response.status, now(), deliveryId);
  } catch (error) {
    const responseStatus = Number((error as any)?.responseStatus || 0) || null;
    const dead = attempt >= 5;
    const nextAttempt = dead ? null : new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempt * 30_000)).toISOString();
    db.prepare("UPDATE webhook_deliveries SET status=?,response_status=?,next_attempt_at=?,updated_at=? WHERE id=?")
      .run(dead ? "dead" : "failed", responseStatus, nextAttempt, now(), deliveryId);
  }
}

export async function deliverSubscriptions(envelope: EventEnvelope) {
  const subscriptions = db.prepare("SELECT * FROM event_subscriptions WHERE organization_id=? AND status='active'").all(envelope.organizationId) as any[];
  for (const subscription of subscriptions.filter((item) => matches(item.event_pattern, envelope.name))) {
    const attempt = Number((db.prepare("SELECT MAX(attempt) value FROM webhook_deliveries WHERE subscription_id=? AND event_id=?").get(subscription.id, envelope.id) as any)?.value || 0) + 1;
    await deliver(subscription, envelope, attempt);
  }
}

export async function retryDueDeliveries() {
  const rows = db.prepare(`SELECT d.event_id,d.subscription_id,s.*,e.envelope_json
    FROM webhook_deliveries d JOIN event_subscriptions s ON s.id=d.subscription_id JOIN event_inbox e ON e.id=d.event_id
    WHERE d.status='failed' AND d.next_attempt_at<=? AND s.status='active'
    AND d.attempt=(SELECT MAX(d2.attempt) FROM webhook_deliveries d2 WHERE d2.subscription_id=d.subscription_id AND d2.event_id=d.event_id)`).all(now()) as any[];
  for (const row of rows) {
    const envelope = JSON.parse(row.envelope_json) as EventEnvelope;
    await deliver(row, envelope, Number((db.prepare("SELECT MAX(attempt) value FROM webhook_deliveries WHERE subscription_id=? AND event_id=?").get(row.subscription_id, row.event_id) as any).value || 0) + 1);
  }
}

export function listDeliveries(actor: SessionActor) {
  return db.prepare(`SELECT d.id,d.event_id,d.attempt,d.status,d.response_status,d.next_attempt_at,d.created_at,d.updated_at,s.name subscription_name
    FROM webhook_deliveries d JOIN event_subscriptions s ON s.id=d.subscription_id
    WHERE s.organization_id=? ORDER BY d.created_at DESC LIMIT 200`).all(actor.organizationId);
}
