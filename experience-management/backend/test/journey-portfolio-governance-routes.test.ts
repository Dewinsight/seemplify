import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import request from "supertest";
import { signupVerifyAndOnboard } from "./authTestHelper.js";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-governance-"));
for (const [name, value] of [
  ["admin", "Portfolio-Governance-Password-2026!"],
  ["session", "portfolio-governance-session-secret-long-enough"],
  ["terra", "portfolio-governance-terra-secret-long-enough"],
  ["x", Buffer.alloc(32, 71).toString("base64url")],
  ["esign-key", Buffer.alloc(32, 72).toString("base64url")],
])
  fs.writeFileSync(path.join(root, name), value);
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, "db.sqlite"),
  UPLOAD_DIR: path.join(root, "uploads"),
  FRONTEND_DIST: path.join(root, "frontend"),
  PUBLIC_URL: "http://127.0.0.1:5412",
  ADMIN_EMAIL: "portfolio-governance@local.test",
  ADMIN_PASSWORD_FILE: path.join(root, "admin"),
  SESSION_SECRET_FILE: path.join(root, "session"),
  TERRA_GATEWAY_SHARED_SECRET_FILE: path.join(root, "terra"),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, "terra"),
  EMAIL_MODE: "log",
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: path.join(root, "x"),
  ESIGN_STORAGE_DIR: path.join(root, "esign"),
  ESIGN_ENCRYPTION_KEY_FILE: path.join(root, "esign-key"),
});
const { app } = await import("../src/app.js");
const { db } = await import("../src/database.js");
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
const owner = request.agent(app);
await owner
  .post("/api/auth/login")
  .send({
    email: "portfolio-governance@local.test",
    password: "Portfolio-Governance-Password-2026!",
  })
  .expect(200);
const session = await owner.get("/api/auth/session").expect(200),
  spaceId = String(session.body.activeSpace.id),
  ownerId = String(session.body.user.id);
db.prepare(
  "UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?",
).run(spaceId);
async function collaborator(role: "admin" | "member", suffix: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: `Portfolio ${role}`,
    email: `portfolio-gov-${role}-${suffix}@test.local`,
    password: "Portfolio-Governance-Member-2026!",
    spaceName: `Home ${suffix}`,
  });
  const own = await agent.get("/api/auth/session").expect(200);
  const id = String(own.body.user.id),
    home = String(own.body.activeSpace.id),
    at = new Date().toISOString();
  db.prepare(
    "UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?",
  ).run(home);
  db.prepare(
    "INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)",
  ).run(spaceId, id, role, at, at);
  await agent.post(`/api/spaces/${spaceId}/select`).expect(200);
  return { agent, id, home };
}
const reviewer = await collaborator("admin", "reviewer"),
  member = await collaborator("member", "member");
const configuration = {
  presentation: "board",
  filters: { priority: "high", search: "=formula" },
  sort: "priority",
  columns: ["item", "state", "priority"],
};
test("member-owned saved views are revised with CAS and default/reset is durable", async () => {
  const created = await member.agent
    .post("/api/journey-portfolio/saved-views")
    .send({
      name: "=My queue",
      configuration,
      makeDefault: true,
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(201);
  const list = await member.agent
    .get("/api/journey-portfolio/saved-views")
    .expect(200);
  assert.equal(list.body.views.length, 1);
  assert.equal(list.body.defaultViewId, created.body.viewId);
  assert.equal(list.body.views[0].versionNumber, 1);
  await member.agent
    .patch(`/api/journey-portfolio/saved-views/${created.body.viewId}`)
    .send({
      expectedRevision: 99,
      configuration,
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(409);
  await member.agent
    .patch(`/api/journey-portfolio/saved-views/${created.body.viewId}`)
    .send({
      expectedRevision: 1,
      name: "=Revised queue",
      configuration: { ...configuration, presentation: "table" },
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(200);
  const revised = await member.agent
    .get("/api/journey-portfolio/saved-views")
    .expect(200);
  assert.equal(revised.body.views[0].versionNumber, 2);
  await member.agent
    .put("/api/journey-portfolio/saved-views/default")
    .send({
      viewId: null,
      expectedRevision: 1,
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(200);
  const csv = await member.agent
    .get("/api/journey-portfolio/saved-views.csv")
    .expect(200);
  assert.match(csv.text, /'=Revised queue/u);
  assert.doesNotMatch(csv.text, /^=formula/mu);
  await owner
    .patch(`/api/journey-portfolio/saved-views/${created.body.viewId}`)
    .send({
      expectedRevision: 2,
      configuration,
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(404);
});
test("requested lifecycle is exact, approval-gated, two-person and tenant-safe", async () => {
  const draft = {
    kind: "initiative",
    title: "Governed move",
    description: "Exact requested target",
    lifecycle: "draft",
    ownerUserId: null,
    ownerTeamId: null,
    priority: "high",
    risk: "medium",
    severity: null,
    frequency: null,
    desiredOutcome: null,
    hypothesis: null,
    constraints: [],
    estimatedEffort: null,
    estimatedCost: null,
    expectedOutcome: "Stop the initiative safely.",
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    dueDate: null,
    progressPercent: 0,
    reviewCadenceDays: null,
    targetMetrics: [],
    evidenceLinkIds: [],
    tags: [],
  };
  const item = (
    await owner
      .post("/api/journey-portfolio/items")
      .send({ draft, idempotencyKey: crypto.randomUUID() })
      .expect(201)
  ).body.item;
  const requested = await owner
    .post("/api/journey-portfolio/transition-requests")
    .send({
      itemId: item.id,
      expectedItemRevision: item.revision,
      targetLifecycle: "cancelled",
      reason: "Portfolio owner requests cancellation.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(201);
  assert.equal(
    (await owner.get(`/api/journey-portfolio/items/${item.id}`).expect(200))
      .body.item.lifecycle,
    "draft",
  );
  await owner
    .post(
      `/api/journey-portfolio/transition-requests/${requested.body.request.id}/decision`,
    )
    .send({
      expectedRevision: 1,
      decision: "approve",
      reason: "Self review must fail.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(409);
  await member.agent
    .post(
      `/api/journey-portfolio/transition-requests/${requested.body.request.id}/decision`,
    )
    .send({
      expectedRevision: 1,
      decision: "approve",
      reason: "Member cannot approve.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(403);
  const approved = await reviewer.agent
    .post(
      `/api/journey-portfolio/transition-requests/${requested.body.request.id}/decision`,
    )
    .send({
      expectedRevision: 1,
      decision: "approve",
      reason: "Independent manager approved the exact target.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(200);
  assert.equal(approved.body.request.status, "applied");
  const current = (
    await owner.get(`/api/journey-portfolio/items/${item.id}`).expect(200)
  ).body.item;
  assert.equal(current.lifecycle, "cancelled");
  assert.equal(current.revision, 2);
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) count FROM journey_portfolio_transition_events WHERE request_id=?",
        )
        .get(requested.body.request.id) as any
    ).count,
    2,
  );
  await reviewer.agent
    .post(
      `/api/journey-portfolio/transition-requests/${requested.body.request.id}/decision`,
    )
    .send({
      expectedRevision: 1,
      decision: "reject",
      reason: "Replay after application.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(404);
  const cancellableItem = (
    await owner
      .post("/api/journey-portfolio/items")
      .send({
        draft: { ...draft, title: "Requester cancellation" },
        idempotencyKey: crypto.randomUUID(),
      })
      .expect(201)
  ).body.item;
  const cancellable = await owner
    .post("/api/journey-portfolio/transition-requests")
    .send({
      itemId: cancellableItem.id,
      expectedItemRevision: cancellableItem.revision,
      targetLifecycle: "cancelled",
      reason: "This request may be withdrawn before review.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(201);
  await reviewer.agent
    .post(
      `/api/journey-portfolio/transition-requests/${cancellable.body.request.id}/cancel`,
    )
    .send({
      expectedRevision: 1,
      reason: "A different manager cannot withdraw it.",
      idempotencyKey: crypto.randomUUID(),
    })
    .expect(403);
  const cancelKey = crypto.randomUUID();
  const cancelled = await owner
    .post(
      `/api/journey-portfolio/transition-requests/${cancellable.body.request.id}/cancel`,
    )
    .send({
      expectedRevision: 1,
      reason: "The requester withdrew this proposed status.",
      idempotencyKey: cancelKey,
    })
    .expect(200);
  assert.equal(cancelled.body.request.status, "cancelled");
  assert.equal(cancelled.body.request.revision, 2);
  assert.equal(
    (
      await owner
        .post(
          `/api/journey-portfolio/transition-requests/${cancellable.body.request.id}/cancel`,
        )
        .send({
          expectedRevision: 1,
          reason: "The requester withdrew this proposed status.",
          idempotencyKey: cancelKey,
        })
        .expect(200)
    ).body.replayed,
    true,
  );
  assert.throws(() =>
    db
      .prepare(
        "DELETE FROM journey_portfolio_transition_requests WHERE id=? AND space_id=?",
      )
      .run(cancellable.body.request.id, spaceId),
  );
  assert.equal(
    (await owner.get(`/api/journey-portfolio/items/${cancellableItem.id}`))
      .body.item.lifecycle,
    "draft",
  );
  await reviewer.agent.post(`/api/spaces/${reviewer.home}/select`).expect(200);
  const isolated = await reviewer.agent
    .get("/api/journey-portfolio/transition-requests")
    .expect(200);
  assert.deepEqual(isolated.body.requests, []);
});
