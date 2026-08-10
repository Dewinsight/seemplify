import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import request from "supertest";
import { signupVerifyAndOnboard } from "./authTestHelper.js";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "seemplify-orchestration-"));
for (const [name, value] of [
  ["admin-password", "Orchestration-Test-Password-2026!"],
  ["session-secret", "orchestration-session-secret-that-is-long-enough"],
  ["terra", "orchestration-terra-secret-that-is-long-enough"],
  ["x-key", Buffer.alloc(32, 41).toString("base64url")],
  ["esign-key", Buffer.alloc(32, 42).toString("base64url")],
  ["webhook-key", Buffer.alloc(32, 43).toString("base64url")],
])
  fs.writeFileSync(path.join(root, name), value);
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, "test.sqlite"),
  UPLOAD_DIR: path.join(root, "uploads"),
  FRONTEND_DIST: path.join(root, "frontend"),
  PUBLIC_URL: "http://127.0.0.1:5412",
  ADMIN_EMAIL: "orchestration@seemplify.local",
  ADMIN_PASSWORD_FILE: path.join(root, "admin-password"),
  SESSION_SECRET_FILE: path.join(root, "session-secret"),
  TERRA_GATEWAY_SHARED_SECRET_FILE: path.join(root, "terra"),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, "terra"),
  EMAIL_MODE: "log",
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: path.join(root, "x-key"),
  JOURNEY_WEBHOOK_ENCRYPTION_KEY_FILE: path.join(root, "webhook-key"),
  ESIGN_STORAGE_DIR: path.join(root, "esign"),
  ESIGN_ENCRYPTION_KEY_FILE: path.join(root, "esign-key"),
});
const { app } = await import("../src/app.js");
const { db } = await import("../src/database.js");
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function agent() {
  const value = request.agent(app);
  const server = (value as any).app;
  server?.on?.("listening", () => server.unref?.());
  return value;
}
async function identity() {
  const a = agent();
  await a
    .post("/api/auth/login")
    .send({
      email: "orchestration@seemplify.local",
      password: "Orchestration-Test-Password-2026!",
    })
    .expect(200);
  const session = await a.get("/api/auth/session").expect(200);
  const spaceId = String(session.body.activeSpace.id);
  const userId = String(session.body.user.id);
  db.prepare(
    "UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?",
  ).run(spaceId);
  return { a, spaceId, userId };
}
const owner = await identity();
const draft = {
  name: "Checkout recovery",
  trigger: {
    type: "event",
    eventName: "checkout.abandoned",
    sourceId: "web-prod",
  },
  conditions: [
    {
      key: "high-value",
      fact: "basket.value",
      operator: "greater_than",
      value: 100,
    },
  ],
  actions: [
    {
      key: "ticket",
      adapter: "service_recovery_ticket",
      purpose: "Recover checkout",
      recipientScope: "support-team",
      consequential: true,
      payload: {
        surveyId: "survey-checkout",
        title: "Recover checkout",
        priority: "high",
      },
    },
  ],
  automationPolicy: { mode: "human_approval" },
};
const gates = Object.fromEntries(
  [
    "consent",
    "suppression",
    "entitlement",
    "quota",
    "quiet_hours",
    "frequency_cap",
    "source_state",
    "platform_kill_switch",
    "space_kill_switch",
    "workflow_kill_switch",
    "adapter_kill_switch",
    "profile_kill_switch",
  ].map((key) => [key, "allow"]),
);
test("mounts strict draft, publish, simulation, replay and approval routes", async () => {
  await owner.a
    .post("/api/journey-orchestration/workflows")
    .send({ ...draft, extra: true })
    .expect(400);
  const created = await owner.a
    .post("/api/journey-orchestration/workflows")
    .send(draft)
    .expect(201);
  const workflow = created.body.workflow;
  await owner.a
    .patch(`/api/journey-orchestration/workflows/${workflow.id}`)
    .send({ expectedRevision: 99, name: "stale" })
    .expect(409);
  const published = await owner.a
    .post(`/api/journey-orchestration/workflows/${workflow.id}/publish`)
    .send({ expectedRevision: 1 })
    .expect(200);
  assert.match(published.body.version.contentSha256, /^[a-f0-9]{64}$/u);
  const nextDraft = await owner.a
    .patch(`/api/journey-orchestration/workflows/${workflow.id}`)
    .send({ expectedRevision: 2, name: "Checkout recovery v2" })
    .expect(200);
  const second = await owner.a
    .post(`/api/journey-orchestration/workflows/${workflow.id}/publish`)
    .send({ expectedRevision: 3 })
    .expect(200);
  assert.equal(second.body.version.versionNumber, 2);
  assert.notEqual(second.body.version.id, published.body.version.id);
  const simulation = {
    mode: "dry_run",
    triggerFingerprint: "trigger-1",
    triggerMatched: true,
    subjectId: "profile-secret",
    facts: { "basket.value": 150 },
    gates,
  };
  const first = await owner.a
    .post(`/api/journey-orchestration/workflows/${workflow.id}/simulations`)
    .send(simulation)
    .expect(201);
  assert.equal(first.body.run.actions[0].decision, "pending_approval");
  assert.doesNotMatch(
    JSON.stringify(first.body.run),
    /profile-secret|trigger-1/u,
  );
  const replay = await owner.a
    .post(`/api/journey-orchestration/workflows/${workflow.id}/simulations`)
    .send(simulation)
    .expect(201);
  assert.equal(replay.body.run.id, first.body.run.id);
  const selfReview = await owner.a
    .post(
      `/api/journey-orchestration/actions/${first.body.run.actions[0].id}/approval`,
    )
    .send({ decision: "approved", reason: "Reviewed against recovery policy." })
    .expect(403);
  assert.equal(
    selfReview.body.code,
    "WORKFLOW_APPROVAL_INDEPENDENT_REVIEW_REQUIRED",
  );
  assert.equal(selfReview.body.details.reason, "requester_is_reviewer");
  assert.equal(
    (db.prepare("SELECT COUNT(*) count FROM journey_workflow_approvals").get() as { count: number }).count,
    0,
    "a denied self-review must not create an approval record",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) count FROM journey_action_queue").get() as { count: number }).count,
    0,
    "a denied self-review must not enqueue an action",
  );

  const reviewer = agent();
  await signupVerifyAndOnboard(reviewer, {
    name: "Independent orchestration reviewer",
    email: "orch-reviewer@example.test",
    password: "Strong-orchestration-reviewer-password-2026!",
    spaceName: "Reviewer home",
  });
  const reviewerSession = await reviewer.get("/api/auth/session").expect(200);
  const reviewerId = String(reviewerSession.body.user.id);
  const reviewerHome = String(reviewerSession.body.activeSpace.id);
  const stamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)",
  ).run(owner.spaceId, reviewerId, stamp, stamp);
  db.prepare(`INSERT INTO journey_collaboration_role_assignments
    (id,space_id,scope_type,journey_definition_id,user_id,role,state,revision,assigned_by_user_id,assigned_at)
    VALUES (?,?,'space',NULL,?,'approver','active',1,?,?)`)
    .run("orchestration-independent-reviewer", owner.spaceId, reviewerId, owner.userId, stamp);
  await reviewer
    .post(
      `/api/journey-orchestration/actions/${first.body.run.actions[0].id}/approval`,
    )
    .send({ decision: "approved", reason: "Cross-space review attempt." })
    .expect(404);
  await reviewer.post(`/api/spaces/${owner.spaceId}/select`).expect(200);
  const access = await reviewer
    .get("/api/journey-orchestration/access")
    .expect(200);
  assert.deepEqual(access.body, { canManage: false, canReview: true });
  const approved = await reviewer
    .post(
      `/api/journey-orchestration/actions/${first.body.run.actions[0].id}/approval`,
    )
    .send({ decision: "approved", reason: "Independent policy review completed." })
    .expect(201);
  assert.equal(approved.body.approval.requesterUserId, owner.userId);
  assert.equal(approved.body.approval.reviewerUserId, reviewerId);
  assert.equal(
    (db.prepare("SELECT COUNT(*) count FROM journey_action_queue").get() as { count: number }).count,
    1,
    "an independent approval enters the existing durable action queue exactly once",
  );
  await reviewer
    .post(
      `/api/journey-orchestration/actions/${first.body.run.actions[0].id}/approval`,
    )
    .send({ decision: "approved", reason: "Duplicate independent review." })
    .expect(409);
  await reviewer.post(`/api/spaces/${reviewerHome}/select`).expect(200);
  await reviewer
    .post(
      `/api/journey-orchestration/actions/${first.body.run.actions[0].id}/approval`,
    )
    .send({ decision: "approved", reason: "Duplicate review." })
    .expect(404);
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) count FROM journey_workflow_outbox")
        .get() as { count: number }
    ).count,
    0,
    "approval records review but this tranche must not enqueue or dispatch an external effect",
  );
  assert.throws(
    () =>
      db
        .prepare("UPDATE journey_workflow_runs SET mode=? WHERE id=?")
        .run("historical", first.body.run.id),
    /append-only/u,
  );
});
test("operator status is truthful and recovery controls are fenced, audited and worker-only", async () => {
  const status = await owner.a
    .get("/api/journey-orchestration/operator-status")
    .expect(200);
  assert.equal(status.body.worker.enabled, false);
  assert.equal(status.body.worker.mode, "disabled");
  assert.equal(
    status.body.adapters.find(
      (item: any) => item.adapter === "survey_invitation",
    ).reasonCode,
    "PROVIDER_DURABLE_IDEMPOTENCY_REQUIRED",
  );
  await owner.a
    .post("/api/journey-orchestration/queue/claim")
    .send({ workerIdentity: "browser", leaseSeconds: 60 })
    .expect(404);
  await owner.a
    .post("/api/journey-orchestration/queue/not-a-queue/retry")
    .send({ expectedRevision: 1, reasonCode: "contains unsafe spaces" })
    .expect(400);
  const before = (
    await owner.a.get("/api/journey-orchestration/queue").expect(200)
  ).body.queue[0];
  db.prepare(
    "UPDATE journey_action_queue SET state='dead_letter',terminal_at=?,last_error_code='TEST_TERMINAL',revision=revision+1 WHERE id=?",
  ).run(new Date().toISOString(), before.id);
  const dead = (
    await owner.a.get("/api/journey-orchestration/queue").expect(200)
  ).body.queue[0];
  assert.equal(dead.state, "dead_letter");
  assert.deepEqual(
    Object.keys(dead.outcome).sort(),
    [
      "kind",
      "providerReferenceSha256",
      "receiptFencingToken",
      "responseSha256",
    ].sort(),
  );
  await owner.a
    .post(`/api/journey-orchestration/queue/${dead.id}/retry`)
    .send({
      expectedRevision: dead.revision - 1,
      reasonCode: "OPERATOR_RECOVERY",
    })
    .expect(409);
  const recovered = (
    await owner.a
      .post(`/api/journey-orchestration/queue/${dead.id}/retry`)
      .send({
        expectedRevision: dead.revision,
        reasonCode: "PROVIDER_RECOVERED",
      })
      .expect(200)
  ).body.item;
  assert.equal(recovered.state, "ready");
  assert.equal(recovered.fencingToken, dead.fencingToken + 1);
  const cancelled = (
    await owner.a
      .post(`/api/journey-orchestration/queue/${dead.id}/cancel`)
      .send({
        expectedRevision: recovered.revision,
        reasonCode: "OPERATOR_CANCEL",
      })
      .expect(200)
  ).body.item;
  assert.equal(cancelled.state, "cancelled");
  const audits = db
    .prepare(
      "SELECT action,detail_json FROM journey_workflow_audit WHERE target_id=? ORDER BY created_at",
    )
    .all(dead.id) as Array<{ action: string; detail_json: string }>;
  assert.ok(audits.some((row) => row.action === "workflow.action.recovered"));
  assert.ok(audits.some((row) => row.action === "workflow.action.cancelled"));
  const operatorAudits = audits.filter(
    (row) =>
      row.action === "workflow.action.recovered" ||
      row.action === "workflow.action.cancelled",
  );
  assert.doesNotMatch(
    JSON.stringify(operatorAudits),
    /payload|recipient|subject/iu,
  );
});

test("retired browser worker endpoints stay absent and cannot mutate queue state", async () => {
  const queue = (
    await owner.a.get("/api/journey-orchestration/queue").expect(200)
  ).body.queue[0];
  const before = db
    .prepare(
      "SELECT state,fencing_token,revision,attempt_count,lease_token,terminal_at,last_error_code FROM journey_action_queue WHERE id=?",
    )
    .get(queue.id);
  await owner.a
    .post("/api/journey-orchestration/queue/claim")
    .send({ workerIdentity: "browser-worker", leaseSeconds: 60 })
    .expect(404);
  await owner.a
    .post(`/api/journey-orchestration/queue/${queue.id}/fail`)
    .send({
      leaseToken: "00000000-0000-4000-8000-000000000000",
      fencingToken: queue.fencingToken,
      errorCode: "BROWSER_FAILURE",
    })
    .expect(404);
  await owner.a
    .post(`/api/journey-orchestration/queue/${queue.id}/complete-no-effect`)
    .send({
      leaseToken: "00000000-0000-4000-8000-000000000000",
      fencingToken: queue.fencingToken,
    })
    .expect(404);
  const after = db
    .prepare(
      "SELECT state,fencing_token,revision,attempt_count,lease_token,terminal_at,last_error_code FROM journey_action_queue WHERE id=?",
    )
    .get(queue.id);
  assert.deepEqual(
    after,
    before,
    "retired browser worker endpoints must not mutate queue state",
  );
});

test("operations console is bounded, tenant-derived and content-safe", async () => {
  await agent().get("/api/journey-orchestration/operations").expect(401);
  const at = new Date().toISOString();
  const old = new Date(Date.now() - 120_000).toISOString();
  for (const [id, spaceId, error] of [
    ...Array.from({ length: 25 }, (_, index) => [
      `survey-operation-owner-${String(index).padStart(2, "0")}`, owner.spaceId,
      index === 0 ? "unsafe customer@example.test" : "SAFE_RETRY_CODE",
    ]),
    ["survey-operation-foreign", "foreign-space-probe", "FOREIGN_SECRET_CODE"],
  ]) {
    db.prepare(`INSERT INTO journey_stage_survey_outbox
      (id,space_id,mapping_id,source_revision_id,operation,state,available_at,lease_owner,lease_token,lease_generation,
      lease_expires_at,attempt_count,last_error_code,terminal_at,created_at,updated_at)
      VALUES (?,?,?,NULL,'upsert','retry_wait',?,NULL,NULL,0,NULL,2,?,NULL,?,?)`)
      .run(id, spaceId, `private-mapping-${id}`, old, error, old, at);
  }
  const response = await owner.a.get("/api/journey-orchestration/operations").expect(200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.body.stageSurvey.availability, "available");
  assert.equal(response.body.stageSurvey.items.length, 20);
  assert.equal(response.body.stageSurvey.items[0].id, "survey-operation-owner-00");
  assert.equal(response.body.stageSurvey.items[0].lastErrorCode, "UNCLASSIFIED");
  assert.equal(response.body.operator.worker.mode, "disabled");
  assert.ok(response.body.stageSurvey.oldestPendingAt);
  assert.equal(response.body.connectors.items.length, 0);
  assert.deepEqual(response.body.privacy.items, []);
  assert.doesNotMatch(JSON.stringify(response.body), /private-mapping|FOREIGN_SECRET_CODE|customer@example|profile_id|subject_id/iu);
});

test("webhook destination routes are strict, tenant-derived and fail closed for private targets", async () => {
  await owner.a
    .get("/api/journey-orchestration/webhook-destinations")
    .expect(200)
    .expect(({ body }) => assert.deepEqual(body.destinations, []));
  await owner.a
    .post("/api/journey-orchestration/webhook-destinations")
    .send({
      name: "Unsafe",
      url: "https://127.0.0.1/hook",
      secret: "a-secret-that-is-long-enough-for-hmac-signing",
      extra: true,
    })
    .expect(400);
  await owner.a
    .post("/api/journey-orchestration/webhook-destinations")
    .send({
      name: "Unsafe",
      url: "https://127.0.0.1/hook",
      secret: "a-secret-that-is-long-enough-for-hmac-signing",
    })
    .expect(400);
});
test("members can read but cannot author and cross-space reads are 404", async () => {
  const member = agent();
  await signupVerifyAndOnboard(member, {
    name: "Orchestration member",
    email: "orch-member@example.test",
    password: "Strong-orchestration-password-2026!",
    spaceName: "Member home",
  });
  const session = await member.get("/api/auth/session").expect(200);
  const memberId = String(session.body.user.id);
  const home = String(session.body.activeSpace.id);
  db.prepare(
    "UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?",
  ).run(home);
  const stamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)",
  ).run(owner.spaceId, memberId, stamp, stamp);
  await member.post(`/api/spaces/${owner.spaceId}/select`).expect(200);
  const listed = await member
    .get("/api/journey-orchestration/workflows")
    .expect(200);
  assert.ok(listed.body.workflows.length);
  await member.get("/api/journey-orchestration/operator-status").expect(200);
  await member.get("/api/journey-orchestration/operations").expect(200);
  const memberQueue = (
    await member.get("/api/journey-orchestration/queue").expect(200)
  ).body.queue;
  await member
    .post(`/api/journey-orchestration/queue/${memberQueue[0].id}/cancel`)
    .send({
      expectedRevision: memberQueue[0].revision,
      reasonCode: "OPERATOR_CANCEL",
    })
    .expect(403);
  await member
    .post("/api/journey-orchestration/webhook-destinations")
    .send({
      name: "Forbidden",
      url: "https://hooks.example.test/path",
      secret: "a-secret-that-is-long-enough-for-hmac-signing",
    })
    .expect(403);
  await member
    .post("/api/journey-orchestration/workflows")
    .send(draft)
    .expect(403);
  await member
    .post(
      `/api/journey-orchestration/workflows/${listed.body.workflows[0].id}/simulations`,
    )
    .send({
      mode: "dry_run",
      triggerFingerprint: "member-write",
      triggerMatched: true,
      subjectId: "member-subject",
      facts: { "basket.value": 150 },
      gates,
    })
    .expect(403);
  await member.post(`/api/spaces/${home}/select`).expect(200);
  await member
    .get(`/api/journey-orchestration/workflows/${listed.body.workflows[0].id}`)
    .expect(404);
});
