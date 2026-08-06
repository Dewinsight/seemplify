import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-04T12:00:00.000Z';

const source = {
  id: 'source-checkout-production', spaceId: 'space-fixture', name: 'Checkout production',
  environment: 'production', status: 'active', validationMode: 'enforce', allowedOrigins: [], allowedBundleIds: [],
  eventsPerMinute: 5_000, bytesPerMinute: 10_000_000, credentialCount: 1, activeSchemaCount: 2,
  revision: 1, createdByUserId: 'qa-user', createdAt: now, updatedAt: now
};

const schemas = [{
  id: 'schema-checkout-completed', sourceId: source.id, spaceId: source.spaceId, eventName: 'checkout_completed',
  createdByUserId: 'qa-user', createdAt: now, updatedAt: now,
  versions: [{
    id: 'schema-version-checkout-v1', schemaId: 'schema-checkout-completed', sourceId: source.id,
    spaceId: source.spaceId, version: '1.0.0', state: 'published',
    properties: [
      { name: 'order_value', type: 'number', required: true, dataClass: 'operational', description: 'Order value.' },
      { name: 'customer_email', type: 'string', required: true, dataClass: 'personal', description: 'Customer email.' }
    ],
    compatibility: { compatible: true, issues: [] }, contentSha256: 'a'.repeat(64), createdAt: now,
    publishedAt: now, deprecatedAt: null, createdByUserId: 'qa-user', publishedByUserId: 'qa-user', deprecatedByUserId: null
  }]
}, {
  id: 'schema-checkout-started', sourceId: source.id, spaceId: source.spaceId, eventName: 'checkout_started',
  createdByUserId: 'qa-user', createdAt: now, updatedAt: now,
  versions: [{
    id: 'schema-version-started-v1', schemaId: 'schema-checkout-started', sourceId: source.id,
    spaceId: source.spaceId, version: '1.0.0', state: 'published', properties: [],
    compatibility: { compatible: true, issues: [] }, contentSha256: 'b'.repeat(64), createdAt: now,
    publishedAt: now, deprecatedAt: null, createdByUserId: 'qa-user', publishedByUserId: 'qa-user', deprecatedByUserId: null
  }]
}];

async function enableConnectedFeature(page: Page, role: 'owner' | 'member' = 'owner') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = {
        ...(session.subscription || {
          planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
        }),
        features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyConnected: true }
      };
    }
    await route.fulfill({ response, json: session });
  });
}

async function stageRuleFixtures(page: Page) {
  let rules: any[] = [];
  let conflictNext = false;
  let simulationBody: any = null;

  await page.route(/\/api\/journey-event-control-plane(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.replace('/api/journey-event-control-plane', '');
    if (route.request().method() === 'GET' && relative === '/sources') {
      await route.fulfill({ json: { sources: [source], quota: { used: 1, limit: 10, remaining: 9 } } }); return;
    }
    if (route.request().method() === 'GET' && relative === `/sources/${source.id}/schemas`) {
      await route.fulfill({ json: { schemas } }); return;
    }
    await route.fulfill({ status: 404, json: { error: 'Unexpected control-plane fixture route.' } });
  });

  await page.route(/\/api\/journey-stage-rules\/[^?]+/u, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url());
    const segments = url.pathname.replace('/api/journey-stage-rules/', '').split('/');
    const definitionId = segments[0]!; const suffix = segments.slice(1); const method = request.method();
    const limits = { rules: 500, predicates: 20, priorEvents: 20, history: 10_000 };
    if (method === 'GET' && suffix.length === 0) { await route.fulfill({ json: { rules, limits } }); return; }
    if (method === 'GET' && suffix[0] === 'aggregates') {
      await route.fulfill({ json: { total: 1, byState: { succeeded: 1 }, byStage: { 's01-activate': 1 } } }); return;
    }
    if (method === 'GET' && suffix[0] === 'instances' && suffix.length === 1) {
      await route.fulfill({ json: { instances: [{
        id: 'anonymous-instance-1', sourceId: source.id, environment: source.environment, subjectKind: 'anonymous',
        state: 'succeeded', currentStageKey: 's01-activate', firstEventAt: now, latestEventAt: now,
        latestEventId: 'event-observed-1', latestVisitId: 'visit-1', revision: 2, createdAt: now, updatedAt: now
      }] } }); return;
    }
    if (method === 'GET' && suffix[0] === 'instances' && suffix[1] === 'anonymous-instance-1') {
      await route.fulfill({ json: {
        instance: {
          id: 'anonymous-instance-1', sourceId: source.id, environment: source.environment, subjectKind: 'anonymous',
          state: 'succeeded', currentStageKey: 's01-activate', firstEventAt: now, latestEventAt: now,
          latestEventId: 'event-observed-1', latestVisitId: 'visit-1', revision: 2, createdAt: now, updatedAt: now
        },
        visits: [{
          id: 'visit-1', decisionId: 'decision-1', eventId: 'event-observed-1', journeyMapVersionId: 'published-map-version',
          stageKey: 's01-activate', role: 'success', ruleDefinitionId: 'rule-observed', ruleVersionId: 'rule-version-observed',
          ruleVersionNumber: 2, eventOccurredAt: now, visitedAt: now, isLate: false, isOutOfOrder: false,
          appliedToCurrent: false, nonApplicationReason: 'terminal_absorbing', priorStageKey: 's01-activate'
        }]
      } }); return;
    }
    if (method === 'GET' && suffix[0] === 'decisions' && suffix[1] === 'decision-1') {
      await route.fulfill({ json: { decision: {
        id: 'decision-1', eventId: 'event-observed-1', journeyDefinitionId: definitionId,
        journeyMapVersionId: 'published-map-version', outcome: 'matched', matchedRuleDefinitionId: 'rule-observed',
        matchedRuleVersionId: 'rule-version-observed', matchedRuleVersionNumber: 2, stageKey: 's01-activate', role: 'success',
        eventOccurredAt: now, evaluatedAt: now, isLate: false, isOutOfOrder: false, ruleSetSha256: 'c'.repeat(64),
        trace: { reasons: ['rule_matched'] }, provenance: {
          schemaVersionId: 'schema-version-checkout-v1', sourceId: source.id, environment: source.environment,
          journeyDefinitionId: definitionId, journeyMapVersionId: 'published-map-version', ruleSetSha256: 'c'.repeat(64),
          processor: 'journey-stage', processorVersion: '1', subjectKind: 'anonymous', eventOccurredAt: now, evaluatedAt: now
        }, processor: 'journey-stage', processorVersion: '1'
      } } }); return;
    }
    if (method === 'POST' && suffix[0] === 'rules' && suffix.length === 1) {
      const draft = request.postDataJSON();
      const version = {
        id: 'draft-version-1', ruleDefinitionId: 'rule-1', journeyDefinitionId: definitionId,
        versionNumber: 1, state: 'draft', revision: 1, contentSha256: 'd'.repeat(64),
        createdByUserId: 'qa-user', publishedByUserId: null, createdAt: now, updatedAt: now, publishedAt: null, ...draft
      };
      const rule = { id: 'rule-1', journeyDefinitionId: definitionId, name: draft.name, revision: 1,
        draftVersionId: version.id, publishedVersionId: null, createdByUserId: 'qa-user', createdAt: now,
        updatedAt: now, versions: [version] };
      rules = [rule]; await route.fulfill({ status: 201, json: { rule } }); return;
    }
    if (method === 'PUT' && suffix[0] === 'rules' && suffix[2] === 'draft') {
      const body = request.postDataJSON(); const current = rules[0];
      if (conflictNext) {
        conflictNext = false;
        rules = [{ ...current, name: 'Remote rule title', revision: current.revision + 1,
          versions: current.versions.map((version: any) => version.id === current.draftVersionId
            ? { ...version, name: undefined, updatedAt: now } : version) }];
        await route.fulfill({ status: 409, json: { error: 'The stage rule changed; refresh before saving.', code: 'JOURNEY_STAGE_RULE_REVISION_CONFLICT' } }); return;
      }
      const nextVersion = { ...current.versions.find((version: any) => version.id === current.draftVersionId), ...body.draft, updatedAt: now };
      const rule = { ...current, name: body.draft.name, revision: current.revision + 1, updatedAt: now,
        versions: current.versions.map((version: any) => version.id === current.draftVersionId ? nextVersion : version) };
      rules = [rule]; await route.fulfill({ json: { rule } }); return;
    }
    if (method === 'POST' && suffix[0] === 'rules' && suffix[2] === 'publish') {
      const current = rules[0]; const publishedId = current.draftVersionId;
      const rule = { ...current, revision: current.revision + 1, draftVersionId: null, publishedVersionId: publishedId,
        versions: current.versions.map((version: any) => version.id === publishedId
          ? { ...version, state: 'published', publishedAt: now, publishedByUserId: 'qa-user' } : version) };
      rules = [rule]; await route.fulfill({ json: { rule, replayed: false } }); return;
    }
    if (method === 'POST' && suffix[0] === 'simulate') {
      simulationBody = request.postDataJSON(); const rule = rules[0]; const version = rule?.versions[0];
      await route.fulfill({ json: { eventMessageId: simulationBody.event.messageId, matches: [{
        ruleId: rule?.id || 'rule-1', ruleVersion: version?.versionNumber || 1, definitionId,
        stageKey: 's01-activate', role: 'entry', matched: true, assignmentKey: 'assignment-1',
        reasons: ['predicate_matched:order_value:at_least', 'rule_matched'], specificity: 2, priority: 100
      }], traces: [{
        ruleId: rule?.id || 'rule-1', ruleVersion: version?.versionNumber || 1, definitionId,
        stageKey: 's01-activate', role: 'entry', matched: true, assignmentKey: 'assignment-1',
        reasons: ['predicate_matched:order_value:at_least', 'rule_matched'], specificity: 2, priority: 100
      }] } }); return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected stage-rule fixture route ${method} ${suffix.join('/')}` } });
  });

  return {
    conflictOnNextSave() { conflictNext = true; },
    simulationBody() { return simulationBody; }
  };
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function publishedMap(page: Page, name: string) {
  await page.goto('/journey-maps');
  await page.getByTestId('new-map-name').fill(name); await page.getByTestId('create-map').click();
  await expect(page.getByTestId('journey-map-name')).toHaveText(name);
  await page.getByTestId('new-stage-name').fill('Activate'); await expect(page.getByTestId('add-stage')).toBeEnabled();
  await page.getByTestId('add-stage').click(); await expect(page.getByTestId('stage-header-s01-activate')).toBeVisible();
  await page.getByTestId('publish-map').click(); await expect(page.getByTestId('journey-version')).toContainText('v2');
  await page.getByTestId('tab-event-rules').click(); await expect(page.getByTestId('journey-stage-rules-workspace')).toBeVisible();
  for (const closeToast of await page.getByRole('button', { name: 'Close toast' }).all()) await closeToast.click();
}

test('an owner builds, conflict-recovers, simulates, publishes, and inspects a connected stage rule', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The complete management contract runs once on desktop.');
  await enableConnectedFeature(page); const fixture = await stageRuleFixtures(page); await signIn(page);
  await publishedMap(page, `Stage rules ${Date.now()}`);

  await page.getByTestId('new-stage-rule').focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('stage-rule-name')).toBeVisible();
  await page.getByTestId('stage-rule-name').fill('Checkout activates journey');
  const sourceCheck = page.getByLabel(new RegExp(source.name, 'u'));
  await sourceCheck.focus(); await page.keyboard.press('Space'); await expect(sourceCheck).toBeChecked();
  const productionCheck = page.getByLabel('Production', { exact: true });
  await productionCheck.focus(); await page.keyboard.press('Space'); await expect(productionCheck).toBeChecked();
  await page.getByTestId('stage-rule-event').selectOption('checkout_completed');
  await expect(page.getByTestId('selected-schema-bindings')).toContainText('schema-version-checkout-v1');
  await page.getByTestId('add-predicate').click();
  await page.locator('#predicate-operator-0').selectOption('at_least');
  await page.locator('#predicate-value-0').fill('100');
  await page.getByTestId('add-prior-event').click();
  await page.locator('#prior-event-0').selectOption('checkout_started');
  await page.locator('#prior-window-0').fill('3600');
  await page.getByTestId('save-stage-rule').click();
  const saveError = page.getByTestId('stage-rule-error');
  if (await saveError.isVisible()) throw new Error(`Stage-rule draft was rejected: ${await saveError.textContent()}`);
  await expect(page.getByTestId('stage-rule-save-state')).toContainText('Draft saved.');

  await page.getByTestId('stage-rule-name').fill('Locally reviewed checkout rule');
  fixture.conflictOnNextSave(); await page.getByTestId('save-stage-rule').click();
  await expect(page.getByTestId('stage-rule-conflict')).toBeVisible();
  await expect(page.getByTestId('stage-rule-name')).toHaveValue('Locally reviewed checkout rule');
  await expect(page.getByTestId('stage-rule-save-state')).toContainText('Local draft retained');
  await page.getByTestId('save-stage-rule').click();
  await expect(page.getByTestId('stage-rule-save-state')).toContainText('Draft saved.');

  await page.getByTestId('stage-simulator-tab').click();
  await page.getByTestId('sim-source').selectOption(source.id); await page.getByTestId('sim-event').selectOption('checkout_completed');
  await page.locator('#sim-property-order_value').fill('150');
  await page.getByTestId('add-sim-history').click();
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByTestId('simulation-trace')).toContainText('predicate_matched:order_value:at_least');
  expect(fixture.simulationBody().event).toMatchObject({ sourceId: source.id, environment: 'production', properties: { order_value: 150 } });
  expect(JSON.stringify(fixture.simulationBody())).not.toContain('customer_email');

  await page.getByTestId('stage-rules-tab').click();
  page.once('dialog', (dialog) => dialog.accept()); await page.getByTestId('publish-stage-rule').click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  await page.getByTestId('stage-observed-tab').click(); await expect(page.getByText('Total anonymous instances')).toBeVisible();
  await page.getByTestId('inspect-instance-anonymous-instance-1').click();
  await expect(page.getByTestId('instance-inspector')).toContainText('terminal state');
  await page.getByRole('button', { name: 'Explain decision' }).click();
  await expect(page.getByTestId('decision-explanation')).toContainText('schema-version-checkout-v1');
  await expect(page.getByTestId('decision-explanation')).toContainText('journey-stage / 1');
});

test('mobile contains connected-rule navigation and canonical selectors without document overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The responsive alternative runs once on mobile.');
  await enableConnectedFeature(page); await stageRuleFixtures(page); await signIn(page);
  await publishedMap(page, `Mobile stage rules ${Date.now()}`);
  await page.getByTestId('new-stage-rule').click(); await page.getByTestId('stage-rule-name').fill('Mobile rule');
  await page.getByLabel(new RegExp(source.name, 'u')).check(); await page.getByLabel('Production', { exact: true }).check();
  await page.getByTestId('stage-rule-event').selectOption('checkout_completed');
  await expect(page.getByTestId('selected-schema-bindings')).toContainText('schema-version-checkout-v1');
  await page.getByTestId('stage-simulator-tab').click(); await expect(page.getByTestId('sim-source')).toBeVisible();
  await page.getByTestId('stage-observed-tab').click(); await expect(page.getByText('Total anonymous instances')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) {
    const layout = await page.evaluate(() => {
      const describe = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return { tag: element.tagName, testId: element.dataset.testid || '', className: element.className,
        left: Math.round(bounds.left), right: Math.round(bounds.right), width: Math.round(bounds.width),
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX };
      };
      const offenders = [...document.querySelectorAll<HTMLElement>('body *')].map(describe)
        .filter((item) => item.right > innerWidth + 1 || item.left < -1).slice(0, 12);
      const chain: ReturnType<typeof describe>[] = [];
      let current = document.querySelector<HTMLElement>('table.min-w-\\[760px\\]');
      while (current && chain.length < 8) { chain.push(describe(current)); current = current.parentElement; }
      return { offenders, chain };
    });
    throw new Error(`Mobile document overflowed by ${overflow}px: ${JSON.stringify(layout)}`);
  }
});
