import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Issuer, generators, type Client } from "openid-client";
import { config, secret } from "./config.js";
import { db, json, now, stringify } from "./database.js";
import type { SessionActor } from "./domain.js";

const cookieName = "seemplify_automation_session";
const stateCookieName = "seemplify_automation_oidc_state";
const sessionHours = 12;
let oidcClient: Promise<Client> | null = null;

function cookies(request: Request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";")
    .map((part) => part.trim().split("=")).filter((part) => part.length === 2)
    .map(([key, item]) => [decodeURIComponent(key), decodeURIComponent(item)]));
}

function cookie(name: string, value: string, maxAgeSeconds: number) {
  const secure = config.publicUrl.startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function tokenHash(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }

function safeReturnPath(value: unknown) {
  const path = String(value || "/");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function issueSession(response: Response, actor: SessionActor) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(24).toString("base64url");
  const created = now();
  const expiresAt = new Date(Date.now() + sessionHours * 3_600_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash,actor_json,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)")
    .run(tokenHash(token), stringify(actor), csrf, expiresAt, created);
  response.setHeader("Set-Cookie", cookie(cookieName, token, sessionHours * 3600));
  return csrf;
}

export function currentSession(request: Request) {
  const token = cookies(request)[cookieName];
  if (!token) return null;
  const row = db.prepare("SELECT actor_json,csrf_token,expires_at FROM sessions WHERE token_hash=?")
    .get(tokenHash(token)) as { actor_json: string; csrf_token: string; expires_at: string } | undefined;
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return { actor: json<SessionActor>(row.actor_json, null as never), csrfToken: row.csrf_token };
}

export function requireActor(request: Request, response: Response, next: NextFunction) {
  const session = currentSession(request);
  if (!session?.actor?.id || !session.actor.organizationId) return response.status(401).json({ error: "Sign in with Seemplify Identity." });
  (request as Request & { actor: SessionActor }).actor = session.actor;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const submitted = String(request.headers["x-seemplify-csrf"] || "");
    if (!submitted || submitted !== session.csrfToken) return response.status(403).json({ error: "The request could not be verified." });
  }
  next();
}

export function actor(request: Request) { return (request as Request & { actor: SessionActor }).actor; }

export function canManage(item: SessionActor) { return ["owner", "admin"].includes(item.role) || item.permissions.includes("automation.manage"); }

async function client() {
  if (!oidcClient) {
    oidcClient = Issuer.discover(config.oidc.issuerUrl).then((issuer) => new issuer.Client({
      client_id: config.oidc.clientId,
      client_secret: secret("OIDC_CLIENT_SECRET", config.nodeEnv === "production"),
      redirect_uris: [config.oidc.redirectUri],
      response_types: ["code"],
    }));
  }
  return oidcClient;
}

type OrganizationClaim = { id?: unknown; name?: unknown; role?: unknown; appAccess?: { mode?: unknown; appIds?: unknown } };

export function actorFromClaims(claims: Record<string, unknown>): SessionActor {
  const organizations = Array.isArray(claims.organizations) ? claims.organizations as OrganizationClaim[] : [];
  const current = (claims.current_organization || claims.currentOrganization) as OrganizationClaim | undefined;
  const currentId = String(current?.id || "").trim();
  const organization = organizations.find((item) => String(item.id || "") === currentId) || organizations[0] || current;
  const appAccess = organization?.appAccess;
  const appIds = Array.isArray(appAccess?.appIds) ? appAccess.appIds.map(String) : [];
  const selected = String(appAccess?.mode || "all").toLowerCase() === "selected";
  if (!organization?.id || !organization.name || (selected && !appIds.includes("automation-hub"))) {
    throw new Error("Your organization has not granted access to Automation Hub.");
  }
  const email = String(claims.email || "").trim().toLowerCase();
  if (!claims.sub || !email || claims.email_verified !== true) throw new Error("Seemplify Identity did not return a verified identity.");
  const sourceRole = String(current?.role || organization.role || "staff").toLowerCase();
  const role = sourceRole === "owner" || sourceRole === "admin"
    ? sourceRole
    : sourceRole === "hr_manager" ? "manager" : "member";
  return {
    id: String(claims.sub), email, name: String(claims.name || email),
    organizationId: String(organization.id), organizationName: String(organization.name), role,
    appIds, permissions: Array.isArray(claims.permissions) ? claims.permissions.map(String) : [],
  };
}

export async function startOidc(request: Request, response: Response) {
  if (!config.oidc.issuerUrl) return response.status(503).send("Seemplify Identity is not configured for this environment.");
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  const challenge = generators.codeChallenge(verifier);
  db.prepare("INSERT INTO oidc_states (state,verifier,nonce,return_path,expires_at) VALUES (?,?,?,?,?)")
    .run(state, verifier, nonce, safeReturnPath(request.query.returnTo), new Date(Date.now() + 10 * 60_000).toISOString());
  response.setHeader("Set-Cookie", cookie(stateCookieName, state, 600));
  const url = (await client()).authorizationUrl({ scope: "openid email profile organizations", state, nonce, code_challenge: challenge, code_challenge_method: "S256" });
  response.redirect(302, url);
}

export async function finishOidc(request: Request, response: Response) {
  const state = cookies(request)[stateCookieName];
  const row = state ? db.prepare("SELECT * FROM oidc_states WHERE state=?").get(state) as any : null;
  if (!row || Date.parse(row.expires_at) <= Date.now()) return response.status(400).send("The sign-in request expired. Start again.");
  try {
    const oidc = await client();
    const tokenSet = await oidc.callback(config.oidc.redirectUri, oidc.callbackParams(request), { state, nonce: row.nonce, code_verifier: row.verifier });
    const claims = tokenSet.claims() as Record<string, unknown>;
    const sessionActor = actorFromClaims(claims);
    issueSession(response, sessionActor);
    db.prepare("DELETE FROM oidc_states WHERE state=?").run(state);
    response.redirect(302, row.return_path);
  } catch (error) {
    response.status(403).send(error instanceof Error ? error.message : "Sign in failed.");
  }
}

const testActors: Record<string, SessionActor> = {
  maker: { id: "user-maker", email: "maker@seemplify.test", name: "Morgan Maker", organizationId: "org-e2e", organizationName: "Seemplify E2E", role: "owner", appIds: ["automation-hub", "messaging", "payroll-management", "leave-management", "time-attendance", "seemplify-learning"], permissions: ["automation.manage"] },
  reviewer: { id: "user-reviewer", email: "reviewer@seemplify.test", name: "Riley Reviewer", organizationId: "org-e2e", organizationName: "Seemplify E2E", role: "admin", appIds: ["automation-hub", "messaging", "payroll-management", "leave-management", "time-attendance", "seemplify-learning"], permissions: ["automation.manage", "automation.approve"] },
  member: { id: "user-member", email: "member@seemplify.test", name: "Mina Member", organizationId: "org-e2e", organizationName: "Seemplify E2E", role: "member", appIds: ["automation-hub", "messaging", "leave-management"], permissions: [] },
};

export function testLogin(request: Request, response: Response) {
  if (!config.testAuthEnabled) return response.status(404).end();
  const selected = testActors[String(request.body?.actor || "")];
  if (!selected) return response.status(400).json({ error: "Choose a test actor." });
  issueSession(response, selected);
  return response.json({ ok: true, actor: selected });
}

export function logout(request: Request, response: Response) {
  const token = cookies(request)[cookieName];
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
  response.setHeader("Set-Cookie", cookie(cookieName, "", 0));
  return response.status(204).end();
}

export function sessionResponse(request: Request, response: Response) {
  const session = currentSession(request);
  if (!session) return response.status(401).json({ authenticated: false, testAuthEnabled: config.testAuthEnabled });
  return response.json({ authenticated: true, actor: session.actor, csrfToken: session.csrfToken, testAuthEnabled: config.testAuthEnabled });
}
