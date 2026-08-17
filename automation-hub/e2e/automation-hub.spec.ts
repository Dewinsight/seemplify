import { expect, test, type Page } from "@playwright/test";

async function useAndPublish(page: Page, templateName: string) {
  await page.getByRole("button", { name: "Templates" }).click();
  const template = page.locator(".template-row").filter({ hasText: templateName });
  await template.getByRole("button", { name: "Use template" }).click();
  const workflow = page.locator(".table-row").filter({ hasText: templateName }).first();
  await workflow.getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Workflow editor" })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published");
  await page.getByRole("button", { name: "Close" }).click();
}

test("complete governed internal and Nango-connected automation journey", async ({ page, request }) => {
  await request.post("/api/test/reset");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as workflow owner" }).click();
  await expect(page.getByText("Morgan Maker")).toBeVisible();

  await useAndPublish(page, "Reaction to Board task");
  await useAndPublish(page, "Payroll review and finalization");
  await useAndPublish(page, "Leave review and team update");

  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Message reaction" }).click();
  await expect(page.locator(".table-row.runs").filter({ hasText: "Reaction to Board task" }).first()).toContainText("succeeded");
  await page.getByRole("button", { name: "Payroll ready" }).click();
  await expect(page.locator(".table-row.runs").filter({ hasText: "Payroll review and finalization" }).first()).toContainText("waiting approval");
  await page.getByRole("button", { name: "Leave submitted" }).click();
  await expect(page.locator(".table-row.runs").filter({ hasText: "Leave review and team update" }).first()).toContainText("waiting approval");

  await page.getByRole("button", { name: "Approvals" }).click();
  const payrollApproval = page.locator(".table-row.approvals").filter({ hasText: "Finalize this exact payroll run revision" });
  await payrollApproval.getByRole("button").first().click();
  await expect(page.getByText("payroll.finalize_run.v1")).toBeVisible();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await page.getByLabel("Decision rationale").fill("Creator should not be allowed");
  await page.getByRole("button", { name: "Approve exact action" }).click();
  await expect(page.getByText(/Maker-checker policy/i)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.getByRole("button", { name: "Continue as independent reviewer" }).click();
  await page.getByRole("button", { name: "Approvals" }).click();
  await page.locator(".table-row.approvals").filter({ hasText: "Finalize this exact payroll run revision" }).getByRole("button").first().click();
  await page.getByLabel("Decision rationale").fill("Totals and pay period independently verified");
  await page.getByRole("button", { name: "Approve exact action" }).click();
  await expect(page.locator(".table-row.approvals").filter({ hasText: "Finalize this exact payroll run revision" })).toContainText("approved");

  await page.locator(".table-row.approvals").filter({ hasText: "Decide this exact leave request revision" }).getByRole("button").first().click();
  await page.getByLabel("Decision rationale").fill("Mandatory coverage conflict");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.locator(".table-row.approvals").filter({ hasText: "Decide this exact leave request revision" })).toContainText("rejected");
  const sourceState = await (await request.get("http://127.0.0.1:5430/__state")).json();
  expect(sourceState.payroll["payroll-aug-2026"].status).toBe("exported");
  expect(sourceState.leave["leave-100"].status).toBe("rejected");
  expect(sourceState.actions.some((item: any) => item.action === "time.block_expected_absence")).toBe(false);

  await request.post("http://127.0.0.1:5430/__control/fail-next?action=boards.create_card");
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Message reaction" }).click();
  const failedRun = page.locator(".table-row.runs").filter({ hasText: "Reaction to Board task" }).first();
  await expect(failedRun).toContainText("failed");
  await failedRun.getByRole("button").first().click();
  await page.getByRole("button", { name: "Retry safe failure" }).click();
  await expect(page.getByText("Retry completed.")).toBeVisible();
  await expect(page.locator(".drawer").getByText("succeeded", { exact: true }).first()).toBeVisible();
  await page.locator(".drawer").getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Connections" }).click();
  const gmail = page.locator(".connection-row").filter({ hasText: "Gmail" });
  await gmail.getByRole("button", { name: "Enable" }).click();
  await gmail.getByRole("button", { name: "Connect account" }).click();
  await expect(page.getByRole("heading", { name: "Mock Nango authorization" })).toBeVisible();
  await page.getByRole("link", { name: "Authorize connection" }).click();
  await expect(page.getByRole("heading", { name: /Confirm google-mail connection/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirm connection" }).click();
  await expect(page.getByText("google-mail workspace")).toBeVisible();

  const drive = page.locator(".connection-row").filter({ hasText: "Google Drive" });
  await drive.getByRole("button", { name: "Enable" }).click();
  await drive.getByRole("button", { name: "Connect account" }).click();
  await page.getByRole("link", { name: "Authorize connection" }).click();
  await page.getByRole("button", { name: "Confirm connection" }).click();
  await expect(page.getByText("google-drive workspace")).toBeVisible();

  await page.getByRole("button", { name: "Commands" }).click();
  const internalCommand = page.locator(".command-row").filter({ hasText: "/create-task" });
  await internalCommand.getByRole("button", { name: "Run test" }).click();
  await expect(page.locator(".notice")).toContainText("Outcome");
  const gmailCommand = page.locator(".command-row").filter({ hasText: "/gmail-send" });
  await gmailCommand.getByRole("button", { name: "Run test" }).click();
  await expect(page.locator(".notice")).toContainText("gmail-message");

  await page.getByRole("button", { name: "Templates" }).click();
  const pageTemplate = page.locator(".template-row").filter({ hasText: "Published Page to Google Drive" });
  await pageTemplate.getByRole("button", { name: "Use template" }).click();
  await page.locator(".table-row").filter({ hasText: "Published Page to Google Drive" }).getByRole("button").first().click();
  await page.getByRole("combobox", { name: "Connection" }).selectOption({ label: "google-drive workspace" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Webhooks" }).click();
  const incomingForm = page.locator("form").filter({ hasText: "Incoming webhook" });
  await incomingForm.getByLabel("Name").fill("Browser intake");
  await incomingForm.getByRole("button", { name: "Create incoming webhook" }).click();
  const oneTime = await page.locator(".secret-once").innerText();
  const incomingUrl = oneTime.match(/http[^\s]+/u)?.[0];
  expect(incomingUrl).toBeTruthy();
  const inbound = await request.post(String(incomingUrl), { data: { id: crypto.randomUUID(), type: "ticket.created", subjectId: "ticket-browser", data: { title: "Browser event" } } });
  expect(inbound.status()).toBe(202);
  const outgoingForm = page.locator("form").filter({ hasText: "Event subscription" });
  await outgoingForm.getByLabel("Name").fill("Browser page receiver");
  await outgoingForm.getByLabel("Target URL").fill("http://127.0.0.1:5430/webhook-receiver");
  await outgoingForm.getByRole("button", { name: "Create subscription" }).click();
  await expect(page.getByText("Browser page receiver")).toBeVisible();

  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Page published" }).click();
  await expect(page.locator(".table-row.runs").filter({ hasText: "Published Page to Google Drive" }).first()).toContainText("succeeded");
  await page.getByRole("button", { name: "Webhooks" }).click();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  const deliveryHistory = page.getByRole("heading", { name: "Delivery history" }).locator("..");
  await expect(deliveryHistory.locator(".activity-list").filter({ hasText: "Browser page receiver" })).toContainText("delivered");

  await page.getByRole("button", { name: "Connections" }).click();
  const connectedGmail = page.locator(".connection-row").filter({ hasText: "Gmail" });
  await connectedGmail.getByRole("button", { name: "Revoke google-mail workspace" }).click();
  await expect(page.locator(".notice")).toContainText("revoked in Nango");
  await expect(connectedGmail).toContainText("revoked");
  await page.getByRole("button", { name: "Commands" }).click();
  await expect(page.locator(".command-row").filter({ hasText: "/gmail-send" })).toHaveCount(0);

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByText("workflow.published").first()).toBeVisible();
  await expect(page.getByText("connection.confirmed").first()).toBeVisible();
  await expect(page.getByText("connection.revoked").first()).toBeVisible();
  await expect(page.getByText("approval.approved").first()).toBeVisible();
});
