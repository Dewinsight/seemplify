import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { startMockSuite, TEST_SECRETS, type MockState } from "./mock-suite.js";

let baseUrl = "";
let mockUrl = "";
let mockState: MockState;
let closeHub: () => Promise<void>;
let closeMock: () => Promise<void>;

type Client = { cookie: string; csrf: string; actor: string };

async function request(route: string, options: { method?: string; body?: unknown; client?: Client; expected?: number } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.client ? { cookie: options.client.cookie, "x-seemplify-csrf": options.client.csrf } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (options.expected !== undefined) assert.equal(response.status, options.expected, `${route}: ${text}`);
  else assert.ok(response.ok, `${route} returned ${response.status}: ${text}`);
  return { response, body };
}

async function login(actor: string): Promise<Client> {
  const result = await request("/auth/test-login", { method: "POST", body: { actor } });
  const cookie = String(result.response.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^seemplify_automation_session=/u);
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  const body = await session.json() as any;
  assert.equal(body.authenticated, true);
  return { cookie, csrf: body.csrfToken, actor };
}

async function createAndPublish(client: Client, templateId: string) {
  const created = (await request(`/api/workflows/from-template/${templateId}`, { method: "POST", client })).body as any;
  const published = (await request(`/api/workflows/${created.id}/publish`, { method: "POST", client })).body as any;
  assert.equal(published.status, "published");
  return published;
}

function event(name: string, overrides: Record<string, unknown>) {
  return { id: crypto.randomUUID(), name, schemaVersion: 1, occurredAt: new Date().toISOString(), correlationId: crypto.randomUUID(), ...overrides };
}

before(async () => {
  const mock = await startMockSuite();
  mockUrl = mock.url; mockState = mock.state; closeMock = mock.close;
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "seemplify-automation-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test", TEST_AUTH_ENABLED: "true", DATABASE_PATH: path.join(runtime, "automation.sqlite"),
    PUBLIC_URL: "http://127.0.0.1:5420", NANGO_BASE_URL: mockUrl, NANGO_SECRET_KEY: TEST_SECRETS.nango,
    IDENTITY_API_URL: mockUrl, IDENTITY_HMAC_SECRET: TEST_SECRETS.identity,
    WORKSPACE_API_URL: mockUrl, WORKSPACE_HMAC_SECRET: TEST_SECRETS.workspace,
    PAYROLL_API_URL: mockUrl, PAYROLL_HMAC_SECRET: TEST_SECRETS.payroll,
    LEAVE_API_URL: mockUrl, LEAVE_HMAC_SECRET: TEST_SECRETS.leave,
    TIME_API_URL: mockUrl, TIME_HMAC_SECRET: TEST_SECRETS.time,
    LEARNING_API_URL: mockUrl, LEARNING_HMAC_SECRET: TEST_SECRETS.learning,
    WEBHOOK_ENCRYPTION_KEY: "webhook-encryption-test-secret-123456789",
  });
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Hub test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeHub = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

after(async () => { await closeHub?.(); await closeMock?.(); });

test("OIDC accepts the canonical current organization claim", async () => {
  const { actorFromClaims, combineIdentityClaims } = await import("../src/auth.js");
  const claims = combineIdentityClaims({
    sub: "identity-user-1",
    email: "member@example.test",
    email_verified: true,
    name: "Member One",
  }, {
    current_organization: {
      id: "org-current",
      name: "Current Org",
      role: "admin",
      appAccess: { mode: "selected", appIds: ["automation-hub"] },
    },
  });
  const actor = actorFromClaims(claims);

  assert.equal(actor.organizationId, "org-current");
  assert.equal(actor.role, "admin");
});

test("compiler rejects unsafe and nonsensical workflows", async () => {
  const { compileWorkflow } = await import("../src/compiler.js");
  const exactApprovalMissing = compileWorkflow({
    name: "Unsafe payroll", description: "", trigger: { eventId: "payroll.run_ready_for_review.v1" }, enabled: true, maximumRunsPerHour: 5,
    steps: [{ id: "finalize", type: "action", actionId: "payroll.finalize_run.v1", input: { runId: "$event.payload.runId", runRevision: "$event.payload.runRevision", totalsHash: "$event.payload.totalsHash", approvalId: "missing" } }],
  });
  assert.equal(exactApprovalMissing.valid, false);
  assert.ok(exactApprovalMissing.issues.some((issue) => issue.code === "EXACT_APPROVAL_REQUIRED"));
  const incompatible = compileWorkflow({
    name: "Bad subject", description: "", trigger: { eventId: "leave.request_submitted.v1" }, enabled: true, maximumRunsPerHour: 5,
    steps: [{ id: "card", type: "action", actionId: "boards.create_card.v1", input: { boardId: "x", title: "x", description: "x", sourceUrl: "x" } }],
  });
  assert.ok(incompatible.issues.some((issue) => issue.code === "SUBJECT_INCOMPATIBLE"));
});

test("signed Identity activation starts the onboarding flow exactly once", async () => {
  const maker = await login("maker");
  await createAndPublish(maker, "employee-onboarding");
  const payload = {
    eventId: crypto.randomUUID(),
    event: "organization.member.added",
    occurredAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    data: {
      userId: "employee-identity-100",
      organizationId: "org-e2e",
      organization: {
        id: "org-e2e",
        name: "Seemplify E2E",
        member: {
          employeeId: "EMP-100",
          name: "Avery Employee",
          email: "avery@example.test",
          onboardingTemplateId: "standard",
        },
      },
      role: "staff",
      action: "added",
    },
  };
  const body = JSON.stringify(payload);
  const deliveryTimestamp = new Date().toISOString();
  const signature = crypto.createHmac("sha256", TEST_SECRETS.identity).update(`${deliveryTimestamp}\n${body}`).digest("hex");
  const send = () => fetch(`${baseUrl}/hooks/identity`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-idp-delivery-timestamp": deliveryTimestamp,
      "x-idp-signature-v2": signature,
    },
    body,
  });
  const before = mockState.actions.length;
  const accepted = await send();
  const acceptedBody = await accepted.json() as any;
  assert.equal(accepted.status, 202);
  assert.equal(acceptedBody.received, true);
  assert.equal(acceptedBody.runIds.length, 1);
  assert.equal(mockState.actions.length - before, 4);
  assert.deepEqual(mockState.actions.slice(-4).map((item) => item.action), [
    "workspace.setup_employee_channels",
    "boards.create_onboarding_board",
    "pages.create_onboarding_page",
    "learning.assign_required_courses",
  ]);

  const replay = await send();
  const replayBody = await replay.json() as any;
  assert.equal(replay.status, 202);
  assert.equal(replayBody.duplicate, true);
  assert.equal(mockState.actions.length - before, 4);
});

test("reaction workflow executes internal actions once and safely retries failures", async () => {
  let maker = await login("maker");
  await request("/api/test/reset", { method: "POST", client: maker, expected: 204 });
  maker = await login("maker");
  await createAndPublish(maker, "reaction-to-board-task");
  const envelope = event("workspace.message_reaction_added.v1", {
    subjectType: "workspace_message", subjectId: "message-100", subjectRevision: "2", dataClass: "internal",
    payload: { messageId: "message-100", channelId: "channel-project", permalink: "https://workspace.test/messages/100", excerpt: "Prepare launch checklist", reaction: "eyes", actorId: "user-maker" },
  });
  const accepted = (await request("/api/events/test", { method: "POST", client: maker, body: envelope, expected: 202 })).body as any;
  assert.equal(accepted.runIds.length, 1);
  const run = (await request(`/api/runs/${accepted.runIds[0]}`, { client: maker })).body as any;
  assert.equal(run.status, "succeeded");
  assert.deepEqual(run.attempts.map((item: any) => item.step_id), ["create-card", "reply"]);
  const beforeDuplicate = mockState.actions.length;
  const duplicate = (await request("/api/events/test", { method: "POST", client: maker, body: envelope, expected: 202 })).body as any;
  assert.equal(duplicate.duplicate, true); assert.equal(mockState.actions.length, beforeDuplicate);

  mockState.failNext.add("boards.create_card");
  const failedEvent = { ...envelope, id: crypto.randomUUID(), correlationId: crypto.randomUUID(), subjectId: "message-retry" };
  const failedAccepted = (await request("/api/events/test", { method: "POST", client: maker, body: failedEvent, expected: 202 })).body as any;
  let failedRun = (await request(`/api/runs/${failedAccepted.runIds[0]}`, { client: maker })).body as any;
  assert.equal(failedRun.status, "failed");
  failedRun = (await request(`/api/runs/${failedRun.id}/retry`, { method: "POST", client: maker })).body as any;
  assert.equal(failedRun.status, "succeeded");

  mockState.unknownNext.add("boards.create_card");
  const uncertainEvent = { ...envelope, id: crypto.randomUUID(), correlationId: crypto.randomUUID(), subjectId: "message-unknown" };
  const uncertainAccepted = (await request("/api/events/test", { method: "POST", client: maker, body: uncertainEvent, expected: 202 })).body as any;
  const uncertain = (await request(`/api/runs/${uncertainAccepted.runIds[0]}`, { client: maker })).body as any;
  assert.equal(uncertain.status, "reconcile");
  await request(`/api/runs/${uncertain.id}/retry`, { method: "POST", client: maker, expected: 409 });
});

test("payroll exact approval enforces maker-checker and reaches authoritative outcome", async () => {
  const maker = await login("maker"); const reviewer = await login("reviewer");
  await createAndPublish(maker, "payroll-review");
  const accepted = (await request("/api/events/test", { method: "POST", client: maker, body: event("payroll.run_ready_for_review.v1", {
    subjectType: "payroll_run", subjectId: "payroll-aug-2026", subjectRevision: "7", dataClass: "restricted",
    payload: { runId: "payroll-aug-2026", runRevision: "7", totalsHash: "sha256-e2e-payroll-total", period: "2026-08", currency: "NGN", total: 48125000, reviewerId: "user-reviewer" },
  }), expected: 202 })).body as any;
  const waiting = (await request(`/api/runs/${accepted.runIds[0]}`, { client: maker })).body as any;
  assert.equal(waiting.status, "waiting_approval"); assert.equal(waiting.approvals[0].subject_revision, "7");
  await request(`/api/approvals/${waiting.approvals[0].id}/decision`, { method: "POST", client: maker, body: { decision: "approved", rationale: "I made this run" }, expected: 403 });
  const approved = (await request(`/api/approvals/${waiting.approvals[0].id}/decision`, { method: "POST", client: reviewer, body: { decision: "approved", rationale: "Totals independently checked" } })).body as any;
  assert.equal(approved.status, "succeeded"); assert.equal(mockState.payroll["payroll-aug-2026"].status, "exported");
});

test("leave rejection is recorded in Leave and blocks downstream side effects", async () => {
  const maker = await login("maker"); const reviewer = await login("reviewer");
  await createAndPublish(maker, "leave-review");
  const accepted = (await request("/api/events/test", { method: "POST", client: maker, body: event("leave.request_submitted.v1", {
    subjectType: "leave_request", subjectId: "leave-100", subjectRevision: "3", dataClass: "restricted",
    payload: { requestId: "leave-100", requestRevision: "3", employeeId: "employee-100", approverId: "user-reviewer", leaveType: "annual", startsAt: "2026-08-24", endsAt: "2026-08-28", teamChannelId: "channel-people" },
  }), expected: 202 })).body as any;
  const waiting = (await request(`/api/runs/${accepted.runIds[0]}`, { client: reviewer })).body as any;
  const decided = (await request(`/api/approvals/${waiting.approvals[0].id}/decision`, { method: "POST", client: reviewer, body: { decision: "rejected", rationale: "Dates conflict with mandatory coverage" } })).body as any;
  assert.equal(decided.status, "rejected"); assert.equal(mockState.leave["leave-100"].status, "rejected");
  assert.equal(mockState.actions.some((call) => call.action === "time.block_expected_absence" && call.body.subjectId === "leave-100"), false);
});

test("Nango-gated Gmail, Drive, incoming hooks, and signed outgoing events work", async () => {
  const maker = await login("maker");
  let commands = (await request("/api/commands", { client: maker })).body as any[];
  assert.equal(commands.some((item) => item.command === "/gmail-send"), false);
  await request("/api/connectors/slack", { method: "PUT", client: maker, body: { enabled: true, allowedDataClasses: ["public", "internal"] }, expected: 409 });
  await request("/api/connectors/google-mail", { method: "PUT", client: maker, body: { enabled: true, allowedDataClasses: ["public", "internal"] } });
  const gmail = (await request("/api/connectors/google-mail/confirm", { method: "POST", client: maker, body: { nangoConnectionId: "gmail-e2e", ownerType: "organization", displayName: "E2E Gmail" }, expected: 201 })).body as any;
  commands = (await request("/api/commands", { client: maker })).body as any[];
  assert.equal(commands.some((item) => item.command === "/gmail-send"), true);
  const sent = (await request("/api/commands/execute", { method: "POST", client: maker, body: { command: "/gmail-send", connectionId: gmail.id, context: { to: "recipient@example.test", subject: "E2E", text: "Sent through Nango proxy" } } })).body as any;
  assert.match(sent.outcomeId, /^gmail-message-/u);

  await request("/api/connectors/google-drive", { method: "PUT", client: maker, body: { enabled: true, allowedDataClasses: ["public", "internal"] } });
  const drive = (await request("/api/connectors/google-drive/confirm", { method: "POST", client: maker, body: { nangoConnectionId: "drive-e2e", ownerType: "organization", displayName: "E2E Drive" }, expected: 201 })).body as any;
  const draft = (await request("/api/workflows/from-template/page-to-drive", { method: "POST", client: maker })).body as any;
  draft.draft.steps[0].connectionId = drive.id;
  await request(`/api/workflows/${draft.id}`, { method: "PUT", client: maker, body: draft.draft });
  await request(`/api/workflows/${draft.id}/publish`, { method: "POST", client: maker });
  await request("/api/event-subscriptions", { method: "POST", client: maker, body: { name: "Page receiver", eventPattern: "pages.*", targetUrl: `${mockUrl}/webhook-receiver` }, expected: 201 });
  const pageAccepted = (await request("/api/events/test", { method: "POST", client: maker, body: event("pages.page_published.v1", {
    subjectType: "page", subjectId: "page-100", subjectRevision: "5", dataClass: "internal",
    payload: { pageId: "page-100", revision: "5", title: "Launch brief", content: "Approved launch content", classification: "internal", folderId: "drive-folder" },
  }), expected: 202 })).body as any;
  const pageRun = (await request(`/api/runs/${pageAccepted.runIds[0]}`, { client: maker })).body as any;
  assert.equal(pageRun.status, "succeeded"); assert.equal(mockState.webhooks.length, 1);
  assert.match(String(mockState.webhooks[0].headers["x-seemplify-webhook-signature"]), /^sha256=[a-f0-9]{64}$/u);

  const incoming = (await request("/api/incoming-webhooks", { method: "POST", client: maker, body: { name: "Ticket intake", allowedEventType: "ticket.created" }, expected: 201 })).body as any;
  const externalDraft = (await request("/api/workflows", { method: "POST", client: maker, body: {
    name: "Ticket to Board", description: "Create a task from a scoped webhook", trigger: { eventId: "external.webhook_received.v1" }, enabled: true, maximumRunsPerHour: 10,
    steps: [{ id: "card", type: "action", actionId: "boards.create_card.v1", input: { boardId: "support", title: "External ticket", description: "Created from incoming webhook", sourceUrl: "https://tickets.example.test/100" } }],
  }, expected: 201 })).body as any;
  await request(`/api/workflows/${externalDraft.id}/publish`, { method: "POST", client: maker });
  const hookResponse = await fetch(`${baseUrl}${new URL(incoming.url).pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: crypto.randomUUID(), type: "ticket.created", subjectId: "ticket-100", data: { title: "Customer request" } }) });
  assert.equal(hookResponse.status, 202);
  const audit = (await request("/api/audit", { client: maker })).body as any[];
  assert.ok(audit.some((item) => item.action === "incoming_webhook.received"));
  assert.ok(audit.some((item) => item.action === "command.executed"));
  await request(`/api/connections/${gmail.id}`, { method: "DELETE", client: maker, expected: 204 });
  assert.equal(mockState.connections.has("gmail-e2e"), false);
  commands = (await request("/api/commands", { client: maker })).body as any[];
  assert.equal(commands.some((item) => item.command === "/gmail-send"), false);
});

test("organization session and CSRF boundaries fail closed", async () => {
  const maker = await login("maker");
  const noCsrf = await fetch(`${baseUrl}/api/workflows`, { method: "POST", headers: { cookie: maker.cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(noCsrf.status, 403);
  const anonymous = await fetch(`${baseUrl}/api/workflows`); assert.equal(anonymous.status, 401);
});
