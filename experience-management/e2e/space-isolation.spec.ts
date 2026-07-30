import { expect, test, type Page } from '@playwright/test';

const password = 'Space-Isolation-2026!';

async function signUp(page: Page, values: { name: string; email: string; spaceName: string }) {
  await page.goto('/signup');
  await page.getByLabel('Name', { exact: true }).fill(values.name);
  await page.getByLabel('Email').fill(values.email);
  await page.getByLabel('Personal space name (optional)', { exact: true }).fill(values.spaceName);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function activeSpace(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/session');
    if (!response.ok) throw new Error(`Could not load session: ${response.status}`);
    return (await response.json()).activeSpace as { id: string; name: string; role: string };
  });
}

async function switchSpace(page: Page, spaceId: string) {
  const selector = page.locator('#active-space-desktop');
  await expect(selector).toBeVisible();
  await Promise.all([
    page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame()),
    selector.selectOption(spaceId)
  ]);
  await expect(page.locator('#active-space-desktop')).toHaveValue(spaceId);
}

test('spaces isolate surveys until invitation acceptance and revoke access after removal', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser exercises the complete multi-account flow.');

  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const accountA = {
    name: `Space Owner ${suffix}`,
    email: `space-owner-${suffix}@example.com`,
    spaceName: `Owner research ${suffix}`
  };
  const accountB = {
    name: `Invited Researcher ${suffix}`,
    email: `space-member-${suffix}@example.com`,
    spaceName: `Member private ${suffix}`
  };
  const surveyTitle = `Private research ${suffix}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await test.step('two signups receive separate personal spaces', async () => {
      await signUp(pageA, accountA);
      await signUp(pageB, accountB);

      const [spaceA, spaceB] = await Promise.all([activeSpace(pageA), activeSpace(pageB)]);
      expect(spaceA).toMatchObject({ name: accountA.spaceName, role: 'owner' });
      expect(spaceB).toMatchObject({ name: accountB.spaceName, role: 'owner' });
      expect(spaceA.id).not.toBe(spaceB.id);
    });

    let surveyId = '';
    let ownerSpaceId = '';
    let memberPersonalSpaceId = '';

    await test.step('account A creates a survey that account B cannot list or open', async () => {
      ownerSpaceId = (await activeSpace(pageA)).id;
      memberPersonalSpaceId = (await activeSpace(pageB)).id;

      await pageA.goto('/surveys/new');
      await pageA.getByRole('tab', { name: 'Start blank' }).click();
      await pageA.getByRole('button', { name: 'Create blank survey' }).click();
      await expect(pageA.getByRole('heading', { name: 'Untitled survey' })).toBeVisible();
      surveyId = new URL(pageA.url()).pathname.split('/').pop() || '';
      expect(surveyId).not.toBe('');

      await pageA.getByRole('tab', { name: 'Settings' }).click();
      await pageA.getByRole('tabpanel').locator('input').first().fill(surveyTitle);
      await pageA.getByRole('button', { name: 'Save changes' }).click();
      await expect(pageA.getByRole('heading', { name: surveyTitle })).toBeVisible();

      await pageA.goto('/surveys');
      await expect(pageA.getByText(surveyTitle, { exact: true })).toBeVisible();

      await pageB.goto('/surveys');
      await expect(pageB.getByText('Create your first survey')).toBeVisible();
      await expect(pageB.getByText(surveyTitle, { exact: true })).toHaveCount(0);

      const directAccess = await pageB.evaluate(async ({ surveyId, ownerSpaceId }) => {
        const ownSpace = await fetch(`/api/surveys/${surveyId}`);
        const forgedSpace = await fetch(`/api/surveys/${surveyId}`, {
          headers: { 'x-seemplify-space': ownerSpaceId }
        });
        return {
          ownSpaceStatus: ownSpace.status,
          forgedSpaceStatus: forgedSpace.status,
          forgedSpaceBody: await forgedSpace.json()
        };
      }, { surveyId, ownerSpaceId });
      expect(directAccess.ownSpaceStatus).toBe(404);
      expect(directAccess.forgedSpaceStatus).toBe(403);
      expect(directAccess.forgedSpaceBody).toMatchObject({ code: 'SPACE_ACCESS_DENIED' });
    });

    let inviteUrl = '';
    await test.step('account A invites B and B explicitly accepts access', async () => {
      await pageA.goto('/settings/space');
      await expect(pageA.getByRole('heading', { name: 'Space settings' })).toBeVisible();
      await pageA.getByLabel('Email address').fill(accountB.email);
      await pageA.getByLabel('Role').selectOption('member');
      await pageA.getByRole('button', { name: 'Invite', exact: true }).click();
      inviteUrl = await pageA.getByLabel('Share this invitation link').inputValue();
      expect(inviteUrl).toContain('/join/');

      await pageB.goto(inviteUrl);
      await expect(pageB.getByRole('heading', { name: `Join ${accountA.spaceName}` })).toBeVisible();
      await expect(pageB.getByText(`Signed in as ${accountB.email}`)).toBeVisible();
      await pageB.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(pageB.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
      await expect(pageB.locator('#active-space-desktop')).toHaveValue(ownerSpaceId);

      await pageB.goto('/surveys');
      await expect(pageB.getByText(surveyTitle, { exact: true })).toBeVisible();
      const sharedAccess = await pageB.evaluate(async (id) => {
        const response = await fetch(`/api/surveys/${id}`);
        return response.status;
      }, surveyId);
      expect(sharedAccess).toBe(200);
    });

    await test.step('B can return to the private personal space and shared data disappears', async () => {
      await switchSpace(pageB, memberPersonalSpaceId);
      await pageB.goto('/surveys');
      await expect(pageB.getByText('Create your first survey')).toBeVisible();
      await expect(pageB.getByText(surveyTitle, { exact: true })).toHaveCount(0);

      await switchSpace(pageB, ownerSpaceId);
      await pageB.goto('/surveys');
      await expect(pageB.getByText(surveyTitle, { exact: true })).toBeVisible();
    });

    await test.step('removing B revokes both UI and direct API access', async () => {
      await pageA.goto('/settings/space');
      pageA.once('dialog', (dialog) => dialog.accept());
      await pageA.getByRole('button', { name: `Remove ${accountB.name}` }).click();
      await expect(pageA.getByRole('button', { name: `Remove ${accountB.name}` })).toHaveCount(0);
      await expect(pageA.getByRole('region', { name: 'Members' }).getByText(accountB.email, { exact: true })).toHaveCount(0);

      await pageB.goto('/surveys');
      await expect(pageB.locator('#active-space-desktop')).toHaveValue(memberPersonalSpaceId);
      await expect(pageB.getByText('Create your first survey')).toBeVisible();
      await expect(pageB.getByText(surveyTitle, { exact: true })).toHaveCount(0);

      const revokedAccess = await pageB.evaluate(async ({ surveyId, ownerSpaceId }) => {
        const response = await fetch(`/api/surveys/${surveyId}`, {
          headers: { 'x-seemplify-space': ownerSpaceId }
        });
        return { status: response.status, body: await response.json() };
      }, { surveyId, ownerSpaceId });
      expect(revokedAccess.status).toBe(403);
      expect(revokedAccess.body).toMatchObject({ code: 'SPACE_ACCESS_DENIED' });
    });
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
