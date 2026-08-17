import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

export const TEST_SECRETS = {
  identity: "identity-automation-test-secret-123456789",
  workspace: "workspace-automation-test-secret-12345678",
  payroll: "payroll-automation-test-secret-123456789",
  leave: "leave-automation-test-secret-12345678901",
  time: "time-automation-test-secret-1234567890123",
  learning: "learning-automation-test-secret-123456789",
  nango: "nango-test-api-key-12345678901234567890",
};

type ActionCall = { action: string; body: any; idempotencyKey: string };
export type MockState = {
  actions: ActionCall[];
  webhooks: Array<{ headers: http.IncomingHttpHeaders; body: any }>;
  failNext: Set<string>;
  unknownNext: Set<string>;
  connections: Set<string>;
  leave: Record<string, { revision: string; status: string }>;
  payroll: Record<string, { revision: string; totalsHash: string; status: string }>;
};

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return { raw, body: raw ? JSON.parse(raw) : {} }; } catch { return { raw, body: {} }; }
}

function secretForAction(action: string) {
  if (action.startsWith("payroll.")) return TEST_SECRETS.payroll;
  if (action.startsWith("leave.")) return TEST_SECRETS.leave;
  if (action.startsWith("time.")) return TEST_SECRETS.time;
  if (action.startsWith("learning.")) return TEST_SECRETS.learning;
  return TEST_SECRETS.workspace;
}

function verifySigned(request: IncomingMessage, path: string, body: unknown, secret: string) {
  const timestamp = String(request.headers["x-seemplify-automation-timestamp"] || "");
  const nonce = String(request.headers["x-seemplify-automation-nonce"] || "");
  const supplied = String(request.headers["x-seemplify-automation-signature"] || "").replace(/^sha256=/u, "");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.POST.${path}.${JSON.stringify(body || {})}`).digest("hex");
  return nonce.length >= 16 && Math.abs(Date.now() - Number(timestamp)) < 300_000 && supplied === expected;
}

export async function startMockSuite(port = 0) {
  const state: MockState = {
    actions: [], webhooks: [], failNext: new Set(), unknownNext: new Set(), connections: new Set(["gmail-e2e", "drive-e2e"]),
    leave: { "leave-100": { revision: "3", status: "pending" } },
    payroll: { "payroll-aug-2026": { revision: "7", totalsHash: "sha256-e2e-payroll-total", status: "pending_approval" } },
  };
  let publicUrl = "";
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", publicUrl || "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/__state") {
      return send(response, 200, { actions: state.actions, webhooks: state.webhooks, connections: [...state.connections], leave: state.leave, payroll: state.payroll });
    }
    if (request.method === "POST" && url.pathname === "/__control/fail-next") { state.failNext.add(String(url.searchParams.get("action"))); return send(response, 204, {}); }
    if (request.method === "POST" && url.pathname === "/__control/unknown-next") { state.unknownNext.add(String(url.searchParams.get("action"))); return send(response, 204, {}); }
    if (request.method === "POST" && url.pathname === "/webhook-receiver") {
      const parsed = await readBody(request); state.webhooks.push({ headers: request.headers, body: parsed.body }); return send(response, 202, { accepted: true });
    }
    if (request.method === "POST" && url.pathname === "/api/internal/automation/authorize") {
      const parsed = await readBody(request);
      if (!verifySigned(request, url.pathname, parsed.body, TEST_SECRETS.identity)) return send(response, 401, { allowed: false });
      if (parsed.body.userId === "inactive-user") return send(response, 403, { allowed: false, reason: "Membership inactive" });
      const role = parsed.body.userId === "user-reviewer" ? "admin" : "owner";
      return send(response, 200, { allowed: true, role, organizationRevision: "org-revision-e2e" });
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/automation/actions/")) {
      const parsed = await readBody(request); const action = url.pathname.slice("/api/automation/actions/".length);
      if (!verifySigned(request, url.pathname, parsed.body, secretForAction(action))) return send(response, 401, { error: "Invalid signature" });
      const call = { action, body: parsed.body, idempotencyKey: String(request.headers["idempotency-key"] || "") };
      state.actions.push(call);
      if (state.unknownNext.delete(action)) return send(response, 503, { error: "Simulated transport uncertainty" });
      if (state.failNext.delete(action)) return send(response, 409, { error: "Simulated safe rejection" });
      if (action === "payroll.finalize_run") {
        const run = state.payroll[String(parsed.body.input?.runId)];
        if (!run || run.revision !== String(parsed.body.input?.runRevision) || run.totalsHash !== String(parsed.body.input?.totalsHash)) return send(response, 409, { error: "Payroll revision changed" });
        if (parsed.body.actorId === "user-maker") return send(response, 403, { error: "Maker-checker" });
        run.status = "exported"; return send(response, 200, { outcomeId: `payroll:${parsed.body.subjectId}:exported`, state: "exported" });
      }
      if (action === "leave.record_decision") {
        const leave = state.leave[String(parsed.body.input?.requestId)];
        if (!leave || leave.revision !== String(parsed.body.input?.requestRevision) || leave.status !== "pending") return send(response, 409, { error: "Leave revision changed" });
        if (parsed.body.actorId === "user-maker") return send(response, 403, { error: "Maker-checker" });
        leave.status = String(parsed.body.input?.decision); return send(response, 200, { outcomeId: `leave:${parsed.body.subjectId}:${leave.status}`, state: leave.status });
      }
      if (action === "time.block_expected_absence") {
        if (String(parsed.body.input?.decisionOutcomeId) !== `leave:${parsed.body.subjectId}:approved`) return send(response, 409, { error: "Approved Leave outcome required" });
        return send(response, 200, { outcomeId: `time-leave:${parsed.body.subjectId}`, state: "blocked" });
      }
      const sequence = state.actions.filter((item) => item.action === action).length;
      return send(response, 200, { outcomeId: `${action}:${sequence}`, url: `${publicUrl}/outcomes/${encodeURIComponent(action)}/${sequence}` });
    }
    if (request.method === "POST" && url.pathname === "/connect/sessions") {
      if (request.headers.authorization !== `Bearer ${TEST_SECRETS.nango}`) return send(response, 401, { error: "bad key" });
      const parsed = await readBody(request); const provider = String(parsed.body.allowed_integrations?.[0] || "google-mail");
      return send(response, 201, { data: { token: `connect-${provider}`, connect_link: `${publicUrl}/connect?provider=${encodeURIComponent(provider)}`, expires_at: new Date(Date.now() + 300_000).toISOString() } });
    }
    if (request.method === "GET" && url.pathname === "/connect") {
      const provider = String(url.searchParams.get("provider") || "google-mail"); const connectionId = provider === "google-drive" ? "drive-e2e" : "gmail-e2e";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html><body><main><h1>Mock Nango authorization</h1><p>${provider}</p><a href="http://127.0.0.1:5420/?connected_provider=${encodeURIComponent(provider)}&connection_id=${connectionId}">Authorize connection</a></main></body></html>`);
    }
    if (request.method === "GET" && url.pathname.startsWith("/connections/")) {
      if (request.headers.authorization !== `Bearer ${TEST_SECRETS.nango}`) return send(response, 401, { error: "bad key" });
      const id = decodeURIComponent(url.pathname.slice("/connections/".length));
      if (!state.connections.has(id)) return send(response, 404, { error: "missing" });
      return send(response, 200, { id, connection_id: id, provider_config_key: url.searchParams.get("provider_config_key") });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/connections/")) {
      if (request.headers.authorization !== `Bearer ${TEST_SECRETS.nango}`) return send(response, 401, { error: "bad key" });
      const id = decodeURIComponent(url.pathname.slice("/connections/".length));
      if (!state.connections.delete(id)) return send(response, 404, { error: "missing" });
      return send(response, 200, { success: true });
    }
    if (request.method === "POST" && url.pathname === "/proxy/gmail/v1/users/me/messages/send") {
      await readBody(request); return send(response, 200, { id: `gmail-message-${state.actions.length + 1}`, threadId: "gmail-thread-e2e" });
    }
    if (["POST", "PATCH"].includes(String(request.method)) && url.pathname.startsWith("/proxy/upload/drive/v3/files")) {
      await readBody(request); return send(response, 200, { id: "drive-file-e2e", webViewLink: "https://drive.example.test/file-e2e" });
    }
    return send(response, 404, { error: "mock route not found", path: url.pathname });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock suite did not bind.");
  publicUrl = `http://127.0.0.1:${address.port}`;
  return { url: publicUrl, state, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
