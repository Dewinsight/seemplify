import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(import.meta.dirname, "..", "src");
const read = (...segments) =>
  fs.readFileSync(path.join(sourceRoot, ...segments), "utf8");
const client = read("lib", "journeyOrchestration.ts");
const page = read("pages", "JourneyOrchestrationPage.tsx");
const app = read("App.tsx");
const shell = read("components", "AppShell.tsx");
const routes = fs.readFileSync(
  path.resolve(
    sourceRoot,
    "..",
    "..",
    "backend",
    "src",
    "journeyOrchestrationRoutes.ts",
  ),
  "utf8",
);

test("orchestration is lazy routed and plan-gated in navigation and workspace", () => {
  assert.match(app, /const JourneyOrchestrationPage = lazy/u);
  assert.match(
    app,
    /<Route path="\/journey-orchestration"><JourneyOrchestrationPage \/><\/Route>/u,
  );
  assert.match(
    shell,
    /to: '\/journey-orchestration'.*feature: 'journeyOrchestration'/u,
  );
  assert.match(page, /useSessionFeature\(["']journeyOrchestration["']\)/u);
});

test("strict client covers every mounted orchestration contract without caller-supplied tenancy", () => {
  for (const resource of [
    "/workflows",
    "/access",
    "/simulations",
    "/approval",
    "/operator-status",
    "/operations",
    "/queue",
  ])
    assert.ok(client.includes(resource), resource);
  for (const action of [
    "createJourneyWorkflow",
    "readJourneyOrchestrationAccess",
    "reviseJourneyWorkflow",
    "publishJourneyWorkflow",
    "retireJourneyWorkflow",
    "simulateJourneyWorkflow",
    "listJourneyWorkflowRuns",
    "decideJourneyWorkflowAction",
    "readJourneyActionOperatorStatus",
    "readJourneyOperationsConsole",
    "listJourneyActionQueue",
    "retryJourneyActionQueueItem",
    "cancelJourneyActionQueueItem",
  ])
    assert.ok(client.includes(action), action);
  assert.ok((client.match(/\.strict\(\)/gu) || []).length >= 15);
  assert.match(client, /expectedRevision/u);
  assert.doesNotMatch(client, /spaceId: input|spaceId\?/u);
  assert.match(routes, /resolveRequestSpace\(request, user\.id\)/u);
});

test("manager lifecycle, simulation, approvals, member read-only and conflict recovery are explicit", () => {
  for (const action of [
    "Create draft",
    "Save revision",
    "Publish",
    "Retire",
    "Run simulation",
    "Approve",
    "Reject",
  ])
    assert.ok(page.includes(action), action);
  for (const phrase of [
    "Dry run",
    "Historical",
    "Safety gates",
    "Approval queue",
    "Read-only: workflow authoring",
    "This workflow changed elsewhere",
    "Loading journey orchestration",
    "No orchestration workflows have been created",
    'role="alert"',
  ])
    assert.ok(page.includes(phrase), phrase);
  assert.match(page, /session\.activeSpace\.role !== ["']member["']/u);
  assert.match(page, /canReview=\{canReview\}/u);
  assert.match(page, /requestedByUserId: run\.requestedByUserId/u);
  assert.match(page, /You requested this run\. Another user with journey review access must decide it\./u);
  assert.match(page, /You may independently review actions requested by another user\./u);
  assert.match(client, /requestedByUserId: z\.string\(\)\.nullable\(\)/u);
  assert.match(routes, /readJourneyOrchestrationAccess/u);
  assert.match(page, /reason instanceof ApiError && reason\.status === 409/u);
});

test("durable runtime truth and member-safe controls remain mobile scrollable", () => {
  for (const phrase of [
    "Action runtime",
    "durable reviewed-action worker is disabled",
    "Unavailable: provider idempotency required",
    "Lease / retry",
    "Read only",
  ])
    assert.ok(page.includes(phrase), phrase);
  assert.doesNotMatch(
    page,
    /Every approved action and outbox item remains held|Actions remain held with no dispatch/u,
  );
  assert.doesNotMatch(
    routes,
    /\/queue\/claim|complete-no-effect|\/queue\/:queueId\/fail/u,
  );
  assert.match(routes, /\/queue\/:queueId\/retry/u);
  assert.match(routes, /\/queue\/:queueId\/cancel/u);
  assert.match(page, /overflow-x-auto/u);
  assert.match(page, /min-w-\[680px\]/u);
  assert.match(page, /role="tablist"/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
});

test("operations console exposes bounded durable status without inventing feed controls", () => {
  for (const phrase of [
    "Operations console",
    "Stage survey feed",
    "Event intelligence feed",
    "Connector imports",
    "Privacy propagation",
    "Kill switches",
    "Oldest pending",
    "Stale leases",
    "Recent feed exceptions and retries",
    "Feed rows are diagnostic and read-only",
  ]) assert.ok(page.includes(phrase), phrase);
  assert.match(client, /const operationsConsole = z\.object/u);
  assert.match(client, /stageSurvey: operationsBase\.extend/u);
  assert.match(client, /connectors: operationsBase\.extend/u);
  assert.doesNotMatch(page, /retryStageSurvey|retryEventIntelligence|retryConnectorImport/u);
  assert.match(page, /href="\/journey-safety"/u);
});
