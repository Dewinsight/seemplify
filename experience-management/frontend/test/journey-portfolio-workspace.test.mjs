import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(import.meta.dirname, "..", "src");
const read = (...segments) =>
  fs.readFileSync(path.join(sourceRoot, ...segments), "utf8");
const client = read("lib", "journeyPortfolio.ts");
const page = read("pages", "JourneyPortfolioPage.tsx");
const app = read("App.tsx");
const shell = read("components", "AppShell.tsx");
const backendRoutes = fs.readFileSync(
  path.resolve(
    sourceRoot,
    "..",
    "..",
    "backend",
    "src",
    "journeyPortfolioRoutes.ts",
  ),
  "utf8",
);
const backendRepository = fs.readFileSync(
  path.resolve(sourceRoot, "..", "..", "backend", "src", "journeyPortfolio.ts"),
  "utf8",
);

test("the entitled portfolio route is lazy loaded and hidden from plans without the feature", () => {
  assert.match(app, /const JourneyPortfolioPage = lazy/u);
  assert.match(
    app,
    /<Route path="\/journey-portfolio"><JourneyPortfolioPage \/><\/Route>/u,
  );
  assert.match(
    shell,
    /to: '\/journey-portfolio', label: 'Journey portfolio'.*feature: 'journeyPortfolio'/u,
  );
  assert.match(page, /useSessionFeature\(["']journeyPortfolio["']\)/u);
  assert.match(page, /if \(!enabled\) return null/u);
});

test("the portfolio client covers canonical records, graph links, dependencies, policies and assessments", () => {
  for (const resource of [
    "/items",
    "/relationships",
    "/dependencies",
    "/policies",
    "/assessments",
    "/operational-links",
    "/baselines",
    "/outcomes",
    "/executive-report",
    "/saved-views",
    "/transition-requests",
  ]) {
    assert.ok(
      client.includes(`/api/journey-portfolio${resource}`),
      `missing portfolio client resource ${resource}`,
    );
  }
  assert.match(client, /crypto\.randomUUID\(\)/u);
  assert.match(client, /expectedRevision: item\.revision/u);
  assert.match(client, /expectedRevision: link\.revision/u);
  assert.doesNotMatch(
    client,
    /spaceId\??:/u,
    "space identity must come from the authenticated boundary",
  );
});

test("members receive a read-only workspace while managers can use every exposed mutation", () => {
  assert.match(
    page,
    /const canManage[\s\S]{0,160}activeSpace[\s\S]{0,120}role !== ["']member["']/u,
  );
  assert.match(page, /Portfolio items and status requests are read-only/u);
  for (const mutation of [
    "createJourneyPortfolioItem",
    "updateJourneyPortfolioItem",
    "createJourneyPortfolioRelationship",
    "deleteJourneyPortfolioRelationship",
    "createJourneyPortfolioDependency",
    "deleteJourneyPortfolioDependency",
    "createJourneyPortfolioPolicy",
    "assessJourneyPortfolioItem",
    "createJourneyPortfolioOperationalLink",
    "updateJourneyPortfolioOperationalOutcome",
    "captureJourneyPortfolioBaseline",
    "createJourneyPortfolioOutcome",
  ])
    assert.ok(
      page.includes(mutation),
      `missing workspace mutation ${mutation}`,
    );
  assert.match(
    backendRepository,
    /function assertManager[\s\S]*?role === ["']member["']/u,
  );
  assert.match(backendRoutes, /JourneyPortfolioError/u);
});

test("initiative details expose exact operational and metric evidence without inventing values", () => {
  for (const phrase of [
    "Operational evidence",
    "Exact record ID",
    "Before and after measurement",
    "Exact persisted observation ID",
    "Immutable baseline",
    "non-causation language",
  ]) {
    assert.ok(
      page.includes(phrase),
      `missing governed initiative evidence UI: ${phrase}`,
    );
  }
  for (const marker of ["initiative-evidence", "Operational evidence links"])
    assert.ok(page.includes(marker));
  assert.match(page, /reason instanceof ApiError && reason\.status === 409/u);
  assert.match(page, /private views/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
});

test("table, board, matrix and graph views expose evidence, usage, scoring and accessible alternatives", () => {
  for (const testId of [
    "journey-portfolio-table",
    "journey-portfolio-board",
    "journey-portfolio-matrix",
    "journey-portfolio-relationships",
    "journey-portfolio-executive-report",
  ])
    assert.ok(
      page.includes(`data-testid="${testId}"`),
      `missing portfolio view ${testId}`,
    );
  for (const phrase of [
    "Evidence and usage",
    "Assessment history",
    "Improvement chain",
    "Initiative dependencies",
    "Scoring policies",
    "It is a prioritisation aid, not an automated decision.",
  ])
    assert.ok(
      page.includes(phrase),
      `missing portfolio product language ${phrase}`,
    );
  assert.match(
    page,
    /<caption className="sr-only">Journey portfolio items<\/caption>/u,
  );
  assert.match(
    page,
    /<caption className="sr-only">\s*Priority assessment history\s*<\/caption>/u,
  );
  assert.match(page, /role="tablist"[\s\S]{0,80}aria-label="Portfolio views"/u);
  assert.match(page, /Status reflects the canonical lifecycle/u);
  assert.match(
    page,
    /requested status never changes the item until a different\s+authorised\s+manager approves/u,
  );
  for (const phrase of [
    "Saved view name",
    "Save revision",
    "Set default",
    "Reset default",
    "Status requests",
    "Approve exact move",
    "Cancel request",
  ])
    assert.ok(
      page.includes(phrase),
      `missing runtime46 portfolio governance UI: ${phrase}`,
    );
  for (const call of [
    "createJourneyPortfolioSavedView",
    "reviseJourneyPortfolioSavedView",
    "setJourneyPortfolioDefaultView",
    "requestJourneyPortfolioTransition",
    "decideJourneyPortfolioTransition",
    "cancelJourneyPortfolioTransition",
  ])
    assert.ok(page.includes(call), call);
  assert.match(page, /report\.interpretation\.statement/u);
  assert.match(page, /downloadJourneyPortfolioExecutiveReport/u);
  assert.doesNotMatch(
    page,
    /gradient|backdrop-blur|rounded-\[2/iu,
    "the portfolio workspace stays within the established calm product language",
  );
});

test("the workspace represents truthful loading, empty, failure and bounded-result states", () => {
  assert.match(page, /Loading portfolio…/u);
  assert.match(page, /No portfolio items found/u);
  assert.match(page, /role="alert"/u);
  assert.match(
    page,
    /Showing the first \{items\.length\} of \{page\.total\} items/u,
  );
  assert.match(page, /Refine filters\s+to narrow the result/u);
  assert.doesNotMatch(page, /mock|sample data|demo item/iu);
});
