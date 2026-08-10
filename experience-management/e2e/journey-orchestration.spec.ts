import { expect, test, type Page, type Route } from "@playwright/test";

const password = "Playwright-Test-Password-2026!";
const createdAt = "2026-08-07T10:00:00.000Z";
const baseDraft = {
  id: "workflow-recovery",
  spaceId: "space-e2e",
  name: "Checkout recovery",
  state: "draft" as const,
  revision: 1,
  trigger: {
    type: "event" as const,
    eventName: "checkout.abandoned",
    sourceId: "web-prod",
  },
  conditions: [],
  actions: [
    {
      key: "notify-owner",
      adapter: "internal_notification" as const,
      purpose: "Notify the journey owner",
      recipientScope: "journey-owner",
    },
  ],
  automationPolicy: { mode: "human_approval" as const },
  createdAt,
  updatedAt: createdAt,
};
const gates = [
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
];
const trace = [
  {
    kind: "trigger",
    key: "event",
    decision: "allow",
    reason: "TRIGGER_MATCHED",
  },
  ...gates.map((key) => ({
    kind: "gate",
    key,
    decision: "allow",
    reason: "GATE_ALLOWED",
  })),
  {
    kind: "approval",
    key: "notify-owner",
    decision: "unknown",
    reason: "HUMAN_APPROVAL_REQUIRED",
  },
  {
    kind: "decision",
    key: "notify-owner",
    decision: "deny",
    reason: "APPROVAL_PENDING",
  },
];
function summary(state: "draft" | "published" | "retired", revision: number) {
  return {
    id: baseDraft.id,
    spaceId: "space-e2e",
    name: baseDraft.name,
    state,
    revision,
    currentVersionId: state === "draft" ? null : "version-1",
    currentVersionNumber: state === "draft" ? null : 1,
    paused: false,
    retiredAt: state === "retired" ? "2026-08-07T12:00:00.000Z" : null,
    createdAt,
    updatedAt: createdAt,
  };
}
function detail(state: "draft" | "published" | "retired", revision: number) {
  return {
    ...summary(state, revision),
    draft: {
      ...baseDraft,
      name: baseDraft.name,
      revision,
      updatedAt: createdAt,
    },
  };
}
const version = {
  id: "version-1",
  workflowId: baseDraft.id,
  spaceId: "space-e2e",
  versionNumber: 1,
  name: baseDraft.name,
  trigger: baseDraft.trigger,
  conditions: [],
  actions: baseDraft.actions,
  automationPolicy: baseDraft.automationPolicy,
  contentSha256: "a".repeat(64),
  publishedByUserId: "qa-user",
  publishedAt: createdAt,
};
function run() {
  const resultAction = {
    actionKey: "notify-owner",
    adapter: "internal_notification",
    allowed: false,
    approvalRequired: true,
    idempotencyKey: "idem-1",
    trace,
  };
  return {
    id: "run-1",
    workflowId: baseDraft.id,
    workflowVersionId: version.id,
    mode: "dry_run",
    requestedByUserId: "requester-user",
    triggerFingerprintSha256: "b".repeat(64),
    subjectRefSha256: "c".repeat(64),
    result: {
      mode: "dry_run",
      workflowVersionId: version.id,
      workflowContentSha256: version.contentSha256,
      actions: [resultAction],
    },
    createdAt,
    actions: [
      {
        id: "action-1",
        actionKey: resultAction.actionKey,
        adapter: resultAction.adapter,
        idempotencyKey: resultAction.idempotencyKey,
        approvalRequired: true,
        trace,
        decision: "pending_approval",
        createdAt,
      },
    ],
  };
}
function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
function queueItem(
  state: "dead_letter" | "ready" = "dead_letter",
  revision = 2,
) {
  return {
    id: "queue-1",
    actionId: "action-1",
    workflowId: baseDraft.id,
    adapter: "internal_notification",
    idempotencyKey: "idem-1",
    state,
    holdReasonCode: null,
    attemptCount: 2,
    maxAttempts: 5,
    availableAt: createdAt,
    fencingToken: revision,
    leaseExpiresAt: null,
    terminalAt: state === "dead_letter" ? createdAt : null,
    lastErrorCode: state === "dead_letter" ? "PROVIDER_TIMEOUT" : null,
    revision,
    createdAt,
    updatedAt: createdAt,
    outcome: {
      kind: null,
      providerReferenceSha256: null,
      responseSha256: null,
      receiptFencingToken: null,
    },
    provider: { state: null, status: null, attemptCount: null },
    lastAttempt: { outcome: "retry_scheduled", errorCode: "PROVIDER_TIMEOUT" },
  };
}
const operatorStatus = {
  worker: { enabled: false, mode: "disabled" },
  adapters: [
    "service_recovery_ticket",
    "assistant_action",
    "internal_notification",
    "signed_webhook",
  ]
    .map((adapter) => ({
      adapter,
      enabled: false,
      reasonCode: "WORKER_DISABLED",
    }))
    .concat([
      {
        adapter: "survey_invitation",
        enabled: false,
        reasonCode: "PROVIDER_DURABLE_IDEMPOTENCY_REQUIRED",
      },
    ]),
};
const operations = {
  generatedAt: createdAt,
  operator: operatorStatus,
  actionQueue: {
    availability: "available", counts: [{ state: "dead_letter", count: 1 }],
    oldestPendingAt: null, staleLeaseCount: 0, items: [],
  },
  stageSurvey: {
    availability: "available", counts: [{ state: "retry_wait", count: 1 }],
    oldestPendingAt: createdAt, staleLeaseCount: 0,
    items: [{ id: "survey-outbox-safe", operation: "upsert", state: "retry_wait", availableAt: createdAt,
      leaseExpiresAt: null, attemptCount: 2, lastErrorCode: "PROVIDER_RETRY", createdAt, updatedAt: createdAt }],
  },
  eventIntelligence: {
    availability: "available", counts: [{ state: "blocked", count: 1 }],
    oldestPendingAt: null, staleLeaseCount: 0,
    items: [{ id: "event-outbox-safe", state: "blocked", blockReason: "privacy_suppression",
      retentionExpiresAt: "2026-09-07T10:00:00.000Z", createdAt }],
  },
  connectors: {
    availability: "available", counts: [{ state: "failed", count: 1 }],
    oldestPendingAt: null, staleLeaseCount: 0,
    items: [{ id: "connector-run-safe", connectorId: "connector-safe", state: "failed", attemptCount: 3,
      retryAt: null, acceptedCount: 4, rejectedCount: 1, tombstoneCount: 0,
      lastErrorCode: "CHECKPOINT_FAILED", createdAt, updatedAt: createdAt }],
  },
  privacy: {
    availability: "available", counts: [{ state: "queued", count: 2 }],
    oldestPendingAt: createdAt, staleLeaseCount: 0, items: [],
  },
  killSwitches: { availability: "available", disabledCount: 1, activePauses: 1 },
};

async function signIn(page: Page, role: "manager" | "member" | "reviewer") {
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.authenticated && body.subscription?.features) {
      body.subscription.features.journeyOrchestration = true;
      if (body.user)
        body.user.id = role === "manager" ? "requester-user" : role === "reviewer" ? "reviewer-user" : "member-user";
      if (body.activeSpace)
        body.activeSpace.role = role === "manager" ? "owner" : "member";
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@seemplify.local");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function installFixtures(page: Page, mode: "manager" | "member" | "reviewer") {
  let lifecycle: "draft" | "published" | "retired" =
    mode === "member" ? "published" : "draft";
  if (mode === "reviewer") lifecycle = "published";
  let revision = mode === "manager" ? 1 : 2;
  let exists = mode !== "manager";
  let runs = mode === "manager" ? [] : [run()];
  let queued = queueItem();
  await page.route(/\/api\/journey-orchestration\/(?:.*)$/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path.endsWith("/access") && method === "GET")
      return json(route, { canManage: mode === "manager", canReview: mode !== "member" });
    if (path.endsWith("/operations") && method === "GET")
      return json(route, operations);
    if (path.endsWith("/operator-status") && method === "GET")
      return json(route, operatorStatus);
    if (path.endsWith("/queue") && method === "GET")
      return json(route, { queue: [queued] });
    if (path.endsWith("/queue/queue-1/retry") && method === "POST") {
      queued = queueItem("ready", queued.revision + 1);
      const { outcome, provider, lastAttempt, ...item } = queued;
      return json(route, { item });
    }
    if (path.endsWith("/queue/queue-1/cancel") && method === "POST") {
      const { outcome, provider, lastAttempt, ...item } = {
        ...queued,
        state: "cancelled",
        revision: queued.revision + 1,
        terminalAt: createdAt,
      };
      return json(route, { item });
    }
    if (path.endsWith("/workflows") && method === "GET")
      return json(route, {
        workflows: exists ? [summary(lifecycle, revision)] : [],
      });
    if (path.endsWith("/workflows") && method === "POST") {
      exists = true;
      lifecycle = "draft";
      revision = 1;
      return json(route, { workflow: detail(lifecycle, revision) }, 201);
    }
    if (path.endsWith(`/${baseDraft.id}`) && method === "GET")
      return json(route, { workflow: detail(lifecycle, revision) });
    if (path.endsWith(`/${baseDraft.id}`) && method === "PATCH") {
      revision += 1;
      return json(route, { workflow: detail(lifecycle, revision) });
    }
    if (path.endsWith("/publish") && method === "POST") {
      lifecycle = "published";
      revision += 1;
      return json(route, { workflow: detail(lifecycle, revision), version });
    }
    if (path.endsWith("/retire") && method === "POST") {
      lifecycle = "retired";
      revision += 1;
      return json(route, { workflow: detail(lifecycle, revision) });
    }
    if (path.endsWith("/simulations") && method === "GET")
      return json(route, { runs });
    if (path.endsWith("/simulations") && method === "POST") {
      runs = [run()];
      return json(route, { run: runs[0] }, 201);
    }
    if (path.endsWith("/approval") && method === "POST")
      return json(
        route,
        {
          approval: {
            id: "approval-1",
            actionId: "action-1",
            decision: "approved",
            reason: "Evidence reviewed and policy satisfied.",
            requesterUserId: "requester-user",
            reviewerUserId: mode === "reviewer" ? "reviewer-user" : "requester-user",
            createdAt,
          },
        },
        201,
      );
    return json(
      route,
      {
        error: `Unhandled orchestration fixture: ${method} ${path}`,
        code: "FIXTURE_UNHANDLED",
      },
      500,
    );
  });
}

test("manager authors, reviews and operates a durable journey workflow", async ({
  page,
}) => {
  await installFixtures(page, "manager");
  await signIn(page, "manager");
  await page.goto("/journey-orchestration");
  await expect(
    page.getByRole("heading", { name: "Journey orchestration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Action runtime" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations console" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Stage survey feed" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Privacy propagation" })).toBeVisible();
  await page.getByText("Recent feed exceptions and retries").click();
  await expect(page.getByRole("cell", { name: "PROVIDER_RETRY" })).toBeVisible();
  await expect(
    page.getByText(/durable reviewed-action worker is disabled/),
  ).toBeVisible();
  await expect(
    page.getByText("Unavailable: provider idempotency required"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /Dead Letter Attempt 2\/5/ })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("cell", { name: /Ready Attempt 2\/5/ })).toBeVisible();
  await expect(
    page.getByText("No orchestration workflows have been created."),
  ).toBeVisible();
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByLabel("Workflow name").fill("Checkout recovery");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Draft · revision 1" }),
  ).toBeVisible();
  await page.getByLabel("Workflow name").fill("Checkout recovery v2");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Draft · revision 2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Published · revision 3" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Simulations" }).click();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(
    page.getByRole("cell", { name: "Pending Approval" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Approvals" }).click();
  await expect(page.getByText(/You requested this run/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await page.getByRole("button", { name: "Retire" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Retired · revision 4" }),
  ).toBeVisible();
});

test("delegated reviewer independently decides another user's action", async ({ page }) => {
  await installFixtures(page, "reviewer");
  await signIn(page, "reviewer");
  await page.goto("/journey-orchestration");
  await expect(page.getByText(/You may independently review actions/)).toBeVisible();
  await page.getByRole("tab", { name: "Approvals" }).click();
  await expect(page.getByText("requester-user", { exact: true })).toBeVisible();
  await expect(page.getByText("reviewer-user", { exact: true })).toBeVisible();
  await page.getByLabel("Decision reason").fill("Independent evidence and policy review completed.");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/1 decision recorded in this session/)).toBeVisible();
});

test("member receives a useful read-only orchestration workspace on narrow and wide screens", async ({
  page,
}) => {
  await installFixtures(page, "member");
  await signIn(page, "member");
  await page.goto("/journey-orchestration");
  await expect(page.getByText(/Read-only: workflow authoring/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations console" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kill switches" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Read only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Workflow name")).toBeDisabled();
  await page.getByRole("tab", { name: "Simulations" }).click();
  await expect(
    page.getByRole("button", { name: "Run simulation" }),
  ).toBeDisabled();
  await expect(page.getByText("Pending Approval")).toBeVisible();
  await page.getByRole("tab", { name: "Approvals" }).click();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(
    page.getByTestId("journey-orchestration-workspace"),
  ).toBeVisible();
});
