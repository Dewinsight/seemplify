import crypto from "node:crypto";
import { audit } from "./audit.js";
import { connectorCatalog } from "./catalog.js";
import { config, secret } from "./config.js";
import { db, json, now, stringify } from "./database.js";
import type { DataClass, SessionActor } from "./domain.js";

type NangoConnection = { id?: string; connection_id?: string; provider_config_key?: string; credentials?: unknown; metadata?: unknown };

function nangoHeaders() {
  return { Authorization: `Bearer ${secret("NANGO_SECRET_KEY", true)}`, "Content-Type": "application/json" };
}

async function nango(path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.nangoBaseUrl}${path}`, { ...init, headers: { ...nangoHeaders(), ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String((body.error as any)?.message || body.error || `Nango returned ${response.status}.`)), { code: "NANGO_REQUEST_FAILED", status: response.status });
  return body;
}

export function connectionAvailable(organizationId: string, provider: string, connectionId?: string) {
  const installed = db.prepare("SELECT enabled FROM connector_installations WHERE organization_id=? AND provider=?").get(organizationId, provider) as { enabled: number } | undefined;
  if (!installed?.enabled) return false;
  const query = connectionId
    ? "SELECT 1 ok FROM connections WHERE organization_id=? AND provider=? AND id=? AND status='connected'"
    : "SELECT 1 ok FROM connections WHERE organization_id=? AND provider=? AND status='connected' LIMIT 1";
  return Boolean(connectionId
    ? db.prepare(query).get(organizationId, provider, connectionId)
    : db.prepare(query).get(organizationId, provider));
}

export function listConnectors(actor: SessionActor) {
  return connectorCatalog.map((connector) => {
    const installation = db.prepare("SELECT * FROM connector_installations WHERE organization_id=? AND provider=?")
      .get(actor.organizationId, connector.provider) as any;
    const connections = db.prepare("SELECT id,provider,owner_type,owner_id,display_name,status,granted_scopes_json,last_verified_at,created_at FROM connections WHERE organization_id=? AND provider=? ORDER BY created_at DESC")
      .all(actor.organizationId, connector.provider) as any[];
    return {
      ...connector,
      enabled: Boolean(installation?.enabled),
      allowedDataClasses: json<DataClass[]>(installation?.allowed_data_classes_json, ["public", "internal"]),
      connections: connections.map((item) => ({ ...item, grantedScopes: json<string[]>(item.granted_scopes_json, []), granted_scopes_json: undefined })),
    };
  });
}

export function setConnectorEnabled(actor: SessionActor, provider: string, enabled: boolean, allowedDataClasses: DataClass[]) {
  const connector = connectorCatalog.find((item) => item.provider === provider);
  if (!connector) throw Object.assign(new Error("Unknown connector."), { status: 404 });
  if (enabled && !connector.reviewed) throw Object.assign(new Error("This connector is visible for planning but its scopes and actions have not completed review."), { status: 409, code: "CONNECTOR_NOT_REVIEWED" });
  const at = now();
  db.prepare(`INSERT INTO connector_installations
    (organization_id,provider,enabled,allowed_data_classes_json,installed_by,installed_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,provider) DO UPDATE SET
    enabled=excluded.enabled,allowed_data_classes_json=excluded.allowed_data_classes_json,
    installed_by=excluded.installed_by,installed_at=excluded.installed_at`)
    .run(actor.organizationId, provider, enabled ? 1 : 0, stringify(allowedDataClasses), actor.id, at);
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: enabled ? "connector.enabled" : "connector.disabled", targetType: "connector", targetId: provider, metadata: { allowedDataClasses } });
}

export async function createConnectSession(actor: SessionActor, provider: string, ownerType: "user" | "organization") {
  const installation = db.prepare("SELECT enabled FROM connector_installations WHERE organization_id=? AND provider=?")
    .get(actor.organizationId, provider) as { enabled: number } | undefined;
  if (!installation?.enabled) throw Object.assign(new Error("An administrator must enable this connector first."), { status: 409, code: "CONNECTOR_DISABLED" });
  const body = await nango("/connect/sessions", {
    method: "POST",
    body: stringify({
      tags: { organization_id: actor.organizationId, end_user_id: actor.id, owner_type: ownerType },
      allowed_integrations: [provider],
    }),
  });
  const data = (body.data || body) as Record<string, unknown>;
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "connection.session_created", targetType: "connector", targetId: provider });
  return { token: data.token, connectLink: data.connect_link, expiresAt: data.expires_at };
}

export async function confirmConnection(actor: SessionActor, input: { provider: string; nangoConnectionId: string; ownerType: "user" | "organization"; displayName?: string }) {
  const result = await nango(`/connections/${encodeURIComponent(input.nangoConnectionId)}?provider_config_key=${encodeURIComponent(input.provider)}`);
  const raw = (result.data || result) as NangoConnection;
  if (!raw || (!raw.id && !raw.connection_id)) throw Object.assign(new Error("Nango did not confirm the connection."), { status: 409 });
  const id = crypto.randomUUID();
  const at = now();
  const ownerId = input.ownerType === "organization" ? actor.organizationId : actor.id;
  db.prepare(`INSERT INTO connections
    (id,organization_id,provider,nango_connection_id,owner_type,owner_id,display_name,status,granted_scopes_json,last_verified_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(organization_id,provider,nango_connection_id) DO UPDATE SET
    owner_type=excluded.owner_type,owner_id=excluded.owner_id,display_name=excluded.display_name,status='connected',last_verified_at=excluded.last_verified_at,updated_at=excluded.updated_at`)
    .run(id, actor.organizationId, input.provider, input.nangoConnectionId, input.ownerType, ownerId,
      String(input.displayName || `${input.provider} connection`).slice(0, 120), "connected", "[]", at, at, at);
  const stored = db.prepare("SELECT id FROM connections WHERE organization_id=? AND provider=? AND nango_connection_id=?")
    .get(actor.organizationId, input.provider, input.nangoConnectionId) as { id: string };
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "connection.confirmed", targetType: "connection", targetId: stored.id, metadata: { provider: input.provider, ownerType: input.ownerType } });
  return stored;
}

export async function verifyConnection(actor: SessionActor, connectionId: string) {
  const row = db.prepare("SELECT * FROM connections WHERE id=? AND organization_id=?").get(connectionId, actor.organizationId) as any;
  if (!row) throw Object.assign(new Error("Connection not found."), { status: 404 });
  try {
    await nango(`/connections/${encodeURIComponent(row.nango_connection_id)}?provider_config_key=${encodeURIComponent(row.provider)}`);
    db.prepare("UPDATE connections SET status='connected',last_verified_at=?,updated_at=? WHERE id=?").run(now(), now(), row.id);
    return { connected: true };
  } catch (error) {
    db.prepare("UPDATE connections SET status='invalid',updated_at=? WHERE id=?").run(now(), row.id);
    throw error;
  }
}

export async function revokeConnection(actor: SessionActor, connectionId: string) {
  const row = db.prepare("SELECT * FROM connections WHERE id=? AND organization_id=?").get(connectionId, actor.organizationId) as any;
  if (!row) throw Object.assign(new Error("Connection not found."), { status: 404 });
  db.prepare("UPDATE connections SET status='invalid',updated_at=? WHERE id=?").run(now(), row.id);
  try {
    await nango(`/connections/${encodeURIComponent(row.nango_connection_id)}?provider_config_key=${encodeURIComponent(row.provider)}`, { method: "DELETE" });
    db.prepare("UPDATE connections SET status='revoked',updated_at=? WHERE id=?").run(now(), row.id);
    audit({ organizationId: actor.organizationId, actorId: actor.id, action: "connection.revoked", targetType: "connection", targetId: connectionId, metadata: { provider: row.provider } });
  } catch (error) {
    audit({ organizationId: actor.organizationId, actorId: actor.id, action: "connection.revocation_pending", targetType: "connection", targetId: connectionId, metadata: { provider: row.provider } });
    throw Object.assign(new Error("The connection is disabled locally, but Nango has not confirmed credential deletion. Retry revocation."), { status: 502, code: "CONNECTION_REVOCATION_PENDING", cause: error });
  }
}

export function readConnection(organizationId: string, connectionId: string, provider: string) {
  return db.prepare("SELECT * FROM connections WHERE id=? AND organization_id=? AND provider=? AND status='connected'")
    .get(connectionId, organizationId, provider) as any;
}

export async function nangoProxy(connection: any, endpoint: string, init: RequestInit = {}) {
  const response = await fetch(`${config.nangoBaseUrl}/proxy${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret("NANGO_SECRET_KEY", true)}`,
      "Provider-Config-Key": connection.provider,
      "Connection-Id": connection.nango_connection_id,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : {}; } catch { /* provider returned text */ }
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 429;
    throw Object.assign(new Error(`The provider returned ${response.status}.`), { code: uncertain ? "PROVIDER_OUTCOME_UNKNOWN" : "PROVIDER_REJECTED", status: response.status, uncertain, body });
  }
  return body as Record<string, unknown>;
}
