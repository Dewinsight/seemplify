import { expect, test } from "@playwright/test";

const password = "Playwright-Test-Password-2026!";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@seemplify.local");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function createItem(
  page: import("@playwright/test").Page,
  input: {
    type: "pain_point" | "opportunity" | "initiative";
    title: string;
    description: string;
    outcome?: string;
  },
) {
  if (
    await page.getByRole("button", { name: input.title, exact: true }).count()
  )
    return;
  await page.getByRole("button", { name: "New item" }).first().click();
  await page.getByLabel("Type", { exact: true }).selectOption(input.type);
  await page.getByLabel("Title").fill(input.title);
  await page.getByLabel("Description").fill(input.description);
  if (input.outcome)
    await page
      .getByLabel(
        input.type === "initiative" ? "Expected outcome" : "Desired outcome",
      )
      .fill(input.outcome);
  await page.getByRole("button", { name: "Create item" }).click();
  await expect(
    page.getByRole("button", { name: input.title }).first(),
  ).toBeVisible();
}

test("journey portfolio supports canonical records, scoring and relationship views", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/journey-portfolio");
  await expect(
    page.getByRole("heading", { name: "Journey portfolio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New item" }).first(),
  ).toBeVisible();
  const savedViewName = `High priority work ${testInfo.project.name}`;
  if (
    !(await page
      .getByLabel("Saved view", { exact: true })
      .locator("option", { hasText: savedViewName })
      .count())
  ) {
    await page.getByLabel("Saved view name").fill(savedViewName);
    await page.getByRole("button", { name: "Save view" }).click();
  }
  await page
    .getByLabel("Saved view", { exact: true })
    .selectOption({ label: savedViewName });
  await page
    .getByRole("button", { name: "Set default", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Default", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset default", exact: true })
    .click();

  await createItem(page, {
    type: "pain_point",
    title: "Customers repeat their account details",
    description:
      "Support handoffs ask customers to provide the same account context again.",
  });
  await createItem(page, {
    type: "opportunity",
    title: "Carry verified context across handoffs",
    description: "Preserve authorised account context when ownership changes.",
    outcome: "Customers continue without repeating verified information.",
  });

  await page.getByRole("tab", { name: "Relationships" }).click();
  await expect(
    page.getByTestId("journey-portfolio-relationships"),
  ).toBeVisible();
  if (
    !(await page.getByText("Customer impact RICE", { exact: true }).count())
  ) {
    await page.getByLabel("Policy name").fill("Customer impact RICE");
    await page.getByRole("button", { name: "Create" }).click();
  }
  await expect(page.getByText("Customer impact RICE")).toBeVisible();
  const chainRow = page
    .locator("li")
    .filter({ hasText: "Customers repeat their account details" })
    .filter({ hasText: "Carry verified context across handoffs" });
  if (!(await chainRow.count())) {
    await page
      .getByLabel("Source item")
      .selectOption({ label: "Customers repeat their account details" });
    await page
      .getByLabel("Target item")
      .selectOption({ label: "Carry verified context across handoffs" });
    await page.getByRole("button", { name: "Link" }).click();
  }
  await expect(chainRow).toBeVisible();

  await page.getByRole("tab", { name: "Table" }).click();
  await page
    .getByRole("button", { name: "Carry verified context across handoffs" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Assess priority" }),
  ).toBeVisible();
  await page.getByLabel("reach").fill("120");
  await page.getByLabel("impact").fill("2");
  await page.getByLabel("confidence").fill("0.8");
  await page.getByLabel("effort").fill("4");
  await page.getByRole("button", { name: "Assess" }).click();
  await expect(page.getByRole("cell", { name: "48.00" }).first()).toBeVisible();
  await page.getByText("Close", { exact: true }).click();

  await page.getByRole("tab", { name: "Board" }).click();
  await expect(page.getByTestId("journey-portfolio-board")).toContainText(
    "Insights",
  );
  await expect(page.getByTestId("journey-portfolio-board")).toContainText(
    "Status reflects the canonical lifecycle",
  );
  await page.getByRole("tab", { name: "Priority matrix" }).click();
  await expect(page.getByTestId("journey-portfolio-matrix")).toContainText(
    "Carry verified context across handoffs",
  );
  await page.getByRole("tab", { name: "Executive report" }).click();
  await expect(
    page.getByTestId("journey-portfolio-executive-report"),
  ).toContainText(/do not establish causation/i);
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("initiative audit evidence is usable at desktop and mobile widths", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/journey-portfolio");
  await createItem(page, {
    type: "initiative",
    title: "Verify recovery outcome evidence",
    description: "Retain exact operational and metric records for audit.",
    outcome: "Show a comparable improvement without asserting causation.",
  });
  await page
    .getByRole("button", { name: "Verify recovery outcome evidence" })
    .first()
    .click();
  await expect(page.getByTestId("initiative-evidence")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Operational evidence" }),
  ).toBeVisible();
  await expect(page.getByLabel("Operational record ID")).toBeVisible();
  await expect(page.getByLabel("Baseline observation ID")).toBeVisible();
  await expect(page.getByLabel("After observation ID")).toBeVisible();
  await page
    .getByLabel("Operational record ID")
    .fill("missing-action-for-audit-test");
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/not found|unavailable/i);
  const evidence = page.getByTestId("initiative-evidence");
  await expect(evidence).toHaveCSS("overflow-x", "visible");
  await page.getByText("Close", { exact: true }).click();
  await page.getByRole("tab", { name: "Board" }).click();
  const move = page
    .locator(
      'select[aria-label="Request status for Verify recovery outcome evidence"]:has(option[value="cancelled"])',
    )
    .first();
  if (await move.count()) {
    const existing = page.getByText(/planned → cancelled · item revision/);
    if (!(await existing.count())) await move.selectOption("cancelled");
    await expect(
      page.getByRole("heading", { name: "Status requests" }),
    ).toBeVisible();
    await expect(
      page.getByText(/planned → cancelled · item revision/),
    ).toBeVisible();
    const initiativeGroup = page
      .getByTestId("journey-portfolio-board")
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Initiatives", exact: true }),
      })
      .first();
    const plannedColumn = initiativeGroup
      .getByRole("heading", { name: "planned", exact: true })
      .locator("xpath=ancestor::section[1]");
    await expect(plannedColumn).toContainText(
      "Verify recovery outcome evidence",
    );
  }
});

test("member portfolio remains read-only while private saved views stay available", async ({
  page,
}) => {
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.authenticated && body.activeSpace)
      body.activeSpace.role = "member";
    await route.fulfill({ response, json: body });
  });
  await signIn(page);
  await page.goto("/journey-portfolio");
  await expect(page.getByTestId("journey-portfolio-read-only")).toContainText(
    "private views",
  );
  await expect(page.getByRole("button", { name: "New item" })).toHaveCount(0);
  await expect(page.getByLabel("Saved view name")).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();
  await expect(
    page.locator('select[aria-label^="Request status for"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Status requests" }),
  ).toBeVisible();
});
