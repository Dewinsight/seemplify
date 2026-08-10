import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-07T12:00:00.000Z';
const spaceId = 'identity-space-fixture';

const profile = (profileId: string, kind: 'anonymous' | 'known', canonicalProfileId = profileId) => ({
  spaceId, profileId, kind, status: 'active' as const, createdAt: now, createdByCommandId: `observe-${profileId}`,
  ...(kind === 'known' ? { knownAt: now } : {}), canonicalProfileId
});
const profiles = [
  { ...profile('profile-alice', 'known'), identifierCount: 2, activeMembershipCount: 2, mergedIntoProfileId: null },
  { ...profile('profile-guest', 'anonymous'), identifierCount: 1, activeMembershipCount: 0, mergedIntoProfileId: null }
];
const sourceFact = {
  factId: 'fact-checkout', source: 'checkout-web', sourceRef: 'event-1001', occurredAt: now, spaceId,
  profileId: 'profile-alice', recordedByCommandId: 'identify-profile-alice'
};
const accountMembership = {
  membershipId: 'membership-account', spaceId, profileId: 'profile-alice', groupType: 'account' as const,
  groupId: 'account-acme', active: true, addedAt: now, addedByCommandId: 'membership-command-account'
};
const groupMembership = {
  membershipId: 'membership-group', spaceId, profileId: 'profile-alice', groupType: 'group' as const,
  groupId: 'group-research', active: true, addedAt: now, addedByCommandId: 'membership-command-group'
};
const binding = (kind: 'anonymous_id' | 'authenticated_user_id', namespace: string, value: string) => ({
  spaceId, identifier: { kind, namespace, value }, profileId: 'profile-alice', boundAt: now,
  boundByCommandId: `bind-${kind}`
});
const timelineEvent = {
  id: 'timeline-checkout', profileId: 'profile-alice', canonicalProfileId: 'profile-alice', eventKind: 'source_fact',
  occurredAt: now, title: 'Checkout completed', summary: 'Recorded checkout event from the production web source.',
  sourceType: 'source_fact', sourceId: 'fact-checkout', detail: { factId: 'fact-checkout' }, createdAt: now
};
const identitySession = {
  id: 'session-alice', spaceId, profileId: 'profile-alice', canonicalProfileId: 'profile-alice',
  identifierNamespace: 'web-session', identifierValue: 'opaque-session-41', startedAt: now, lastSeenAt: now,
  endedAt: null, eventCount: 4, sourceFactCount: 2, createdAt: now, updatedAt: now
};
const account = {
  id: 'account-acme', spaceId, groupType: 'account' as const, name: 'Acme Services', externalRef: 'CRM-ACME',
  status: 'active' as const, createdAt: now, updatedAt: now, createdByUserId: 'qa-user'
};
const researchGroup = {
  id: 'group-research', spaceId, groupType: 'group' as const, name: 'Research panel', externalRef: null,
  status: 'active' as const, createdAt: now, updatedAt: now, createdByUserId: 'qa-user'
};
const segment = {
  id: 'segment-known', spaceId, name: 'Known customers', description: 'Profiles with an exact known identity.',
  state: 'active' as const, activeVersionId: 'segment-version-1', activeVersionNumber: 1,
  materializedMemberCount: 1, createdByUserId: 'qa-user', createdAt: now, updatedAt: now
};
const segmentMembership = {
  id: 'segment-membership-1', segmentId: segment.id, segmentVersionId: segment.activeVersionId,
  profileId: 'profile-alice', canonicalProfileId: 'profile-alice', matchedAt: now
};
const purposeState = (purpose: 'analytics' | 'personalisation' | 'research_contact' | 'marketing', state: 'unknown' | 'granted' | 'denied' | 'suppressed') => ({
  profileId: 'profile-alice', purpose, state, lawfulBasis: state === 'granted' ? 'consent' : null,
  policyReference: state === 'granted' ? 'privacy-v3' : null, updatedAt: now, updatedByUserId: 'qa-user'
});

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function enableIdentityFeature(page: Page, role: 'owner' | 'member' = 'owner') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.spaces = (session.spaces || []).map((space: any) => ({ ...space, role }));
      session.subscription = {
        ...(session.subscription || { planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback' }),
        features: { ...(session.subscription?.features || {}), journeyConnected: true, journeyProfiles: true, journeyExports: true }
      };
    }
    await route.fulfill({ response, json: session });
  });
}

async function fixtureIdentity(page: Page, observed: { scoped: string[]; privacyWrites: unknown[]; exports: unknown[]; commands: any[] }) {
  const privacyStates = [purposeState('analytics', 'granted'), purposeState('personalisation', 'granted'),
    purposeState('research_contact', 'unknown'), purposeState('marketing', 'denied')];
  const merges: any[] = [];
  const correctionRuns: any[] = [{ run: { id: 'correction-1', spaceId, reason: 'identity_command', commandId: 'identify-profile-alice', profileIds: ['profile-alice'], state: 'completed', requestedByUserId: null, createdAt: now, completedAt: now }, result: { timelineEventCount: 1, sessionCount: 1, segmentMembershipCount: 1 } }];
  const audits: any[] = [{ auditId: 'audit-identify', policyVersion: 'journey.identity-policy.v1', commandId: 'identify-profile-alice', spaceId,
    actorId: 'qa-user', action: 'identify', outcome: 'accepted', code: 'profile_identified', explanation: 'Exact identity was recorded.',
    occurredAt: now, details: { profileId: 'profile-alice' } }];
  await page.route(/\/api\/journey-identities(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    observed.scoped.push(request.headers()['x-seemplify-space'] || '');
    if (path === '/api/journey-identities/profiles' && method === 'GET') return route.fulfill({ json: { profiles } });
    const detailMatch = path.match(/^\/api\/journey-identities\/profiles\/([^/]+)$/u);
    if (detailMatch && method === 'GET') {
      const selected = detailMatch[1] === 'profile-guest' ? profile('profile-guest', 'anonymous') : profile('profile-alice', 'known');
      return route.fulfill({ json: { profile: selected, bindings: selected.profileId === 'profile-alice' ? [binding('authenticated_user_id', 'crm', 'customer-1842'), binding('anonymous_id', 'web-session', 'opaque-session-41')] : [], sourceFacts: selected.profileId === 'profile-alice' ? [sourceFact] : [], memberships: selected.profileId === 'profile-alice' ? [accountMembership, groupMembership] : [], merges: merges.filter((merge) => merge.sourceProfileId === selected.profileId || merge.targetProfileId === selected.profileId), tombstone: null } });
    }
    const profileRoute = path.match(/^\/api\/journey-identities\/profiles\/([^/]+)\/(timeline|sessions|privacy|corrections|customer-360|export|privacy-jobs)$/u);
    if (profileRoute?.[2] === 'timeline' && method === 'GET') return route.fulfill({ json: { events: profileRoute[1] === 'profile-alice' ? [timelineEvent] : [] } });
    if (profileRoute?.[2] === 'sessions' && method === 'GET') return route.fulfill({ json: { sessions: profileRoute[1] === 'profile-alice' ? [identitySession] : [] } });
    if (profileRoute?.[2] === 'privacy' && method === 'GET') return route.fulfill({ json: { states: privacyStates } });
    if (profileRoute?.[2] === 'corrections' && method === 'GET') return route.fulfill({ json: { runs: correctionRuns } });
    if (profileRoute?.[2] === 'customer-360' && method === 'GET') {
      const purpose = url.searchParams.get('purpose');
      if (purpose === 'marketing') return route.fulfill({ status: 403, json: { error: 'Customer 360 access is blocked for this purpose by the profile privacy state.', code: 'JOURNEY_PROFILE_PRIVACY_BLOCKED', details: { purpose, state: 'denied' } } });
      return route.fulfill({ json: { profile: profile('profile-alice', 'known'), purpose, privacyState: privacyStates.find((row) => row.purpose === purpose), identitySummary: { identifierCount: 2, anonymousIdentifierCount: 1, knownIdentifierCount: 1 }, consentSummary: { purpose, states: [{ state: 'granted', count: 3 }], latestObservedAt: now }, memberships: { accounts: [accountMembership], groups: [groupMembership] }, segmentMemberships: [{ ...segmentMembership, segmentName: segment.name, segmentDescription: segment.description }], sessions: [identitySession], journeyInstances: [{ instanceId: 'journey-instance-1', journeyDefinitionId: 'journey-checkout', journeyName: 'Checkout', state: 'active', currentStageKey: 'complete', firstEventAt: now, latestEventAt: now, sourceId: 'checkout-web', environment: 'production' }], timeline: [timelineEvent] } });
    }
    if (profileRoute?.[2] === 'privacy' && method === 'PUT') { const body = request.postDataJSON(); observed.privacyWrites.push(body); const current = privacyStates.find((row) => row.purpose === body.purpose)!; Object.assign(current, { state: body.state, lawfulBasis: body.lawfulBasis || null, policyReference: body.policyReference || null }); return route.fulfill({ json: { state: current } }); }
    if (profileRoute?.[2] === 'export' && method === 'POST') { const body = request.postDataJSON(); observed.exports.push(body); return route.fulfill({ status: 201, json: { job: { id: 'export-1', spaceId, profileId: 'profile-alice', purpose: body.purpose, format: 'json', state: 'completed', requestedByUserId: 'qa-user', createdAt: now, completedAt: now }, export: { schema: 'seemplify.journey-profile-export/v1' } } }); }
    if (profileRoute?.[2] === 'privacy-jobs' && method === 'POST') { const body = request.postDataJSON(); return route.fulfill({ status: 201, json: { job: { id: 'privacy-job-1', spaceId, profileId: 'profile-alice', operation: body.operation, purpose: body.purpose || null, state: 'completed', requestedByUserId: 'qa-user', createdAt: now, completedAt: now }, result: { appliedPurposes: [body.purpose], pendingPropagationTargets: [] } } }); }
    if (path === '/api/journey-identities/groups' && method === 'GET') return route.fulfill({ json: { groups: [{ ...account, activeMemberCount: 1 }, { ...researchGroup, activeMemberCount: 1 }] } });
    const groupMatch = path.match(/^\/api\/journey-identities\/groups\/([^/]+)$/u);
    if (groupMatch && method === 'GET') { const selected = groupMatch[1] === account.id ? account : researchGroup; const membership = selected.groupType === 'account' ? accountMembership : groupMembership; return route.fulfill({ json: { group: selected, memberships: [membership], members: [{ ...profile('profile-alice', 'known'), membership }] } }); }
    if (path === `/api/journey-identities/accounts/${account.id}/customer-360` && method === 'GET') return route.fulfill({ json: { account, purpose: url.searchParams.get('purpose'), memberCount: 1, members: [{ ...profile('profile-alice', 'known'), membership: accountMembership }], segmentMemberships: [{ ...segmentMembership, segmentName: segment.name, segmentDescription: segment.description }], journeyInstances: [], timeline: [timelineEvent] } });
    if (path === '/api/journey-identities/segments' && method === 'GET') return route.fulfill({ json: { segments: [segment] } });
    if (path === `/api/journey-identities/segments/${segment.id}` && method === 'GET') return route.fulfill({ json: { segment, activeVersion: { id: segment.activeVersionId, segmentId: segment.id, versionNumber: 1, rule: { match: 'all', clauses: [{ field: 'profile.kind', op: 'eq', value: 'known' }] }, state: 'active', validationState: 'valid', createdByUserId: 'qa-user', createdAt: now }, memberships: [segmentMembership] } });
    if (path === '/api/journey-identities/audit' && method === 'GET') return route.fulfill({ json: { audit: audits } });
    if (path === '/api/journey-identities/commands' && method === 'POST') {
      const body = request.postDataJSON(); observed.commands.push(body);
      const mergeAuditId = body.type === 'merge' ? 'identity-merge:fixture:1' : body.mergeAuditId;
      const code = body.type === 'merge' ? 'profiles_merged' : 'merge_split';
      const audit = { auditId: `audit-${body.commandId}`, policyVersion: 'journey.identity-policy.v1', commandId: body.commandId,
        spaceId, actorId: 'qa-user', action: body.type, outcome: 'accepted', code,
        explanation: body.type === 'merge' ? 'Reviewed profiles were merged.' : 'Reviewed merge was split.', occurredAt: body.occurredAt,
        details: body.type === 'merge' ? { sourceProfileId: body.source.profileId, targetProfileId: body.target.profileId } : { mergeAuditId } };
      audits.unshift(audit);
      if (body.type === 'merge') merges.push({ mergeAuditId, spaceId, sourceProfileId: body.source.profileId,
        targetProfileId: body.target.profileId, canonicalTargetProfileId: body.target.profileId, reason: body.reason, active: true,
        mergedAt: body.occurredAt, mergedByCommandId: body.commandId });
      else { const merge = merges.find((row) => row.mergeAuditId === mergeAuditId); if (merge) Object.assign(merge, { active: false, splitAt: body.occurredAt, splitByCommandId: body.commandId }); }
      correctionRuns.unshift({ run: { id: `correction-${body.commandId}`, spaceId, reason: 'merge_command', commandId: body.commandId,
        profileIds: body.type === 'merge' ? [body.source.profileId, body.target.profileId] : [], state: 'completed', requestedByUserId: null,
        createdAt: body.occurredAt, completedAt: body.occurredAt }, result: { timelineEventCount: 1, sessionCount: 1,
          segmentMembershipCount: 1, activeProfileCount: 2, privacyPropagation: { schema: 'seemplify.journey-privacy-propagation/v1',
            status: body.type === 'merge' ? 'waiting' : 'operator_required', cursor: 3, updatedAt: body.occurredAt,
            targets: { stage_intelligence: { state: body.type === 'merge' ? 'waiting' : 'operator_required', affectedCount: 0,
              code: body.type === 'merge' ? 'leased_projection_waiting' : 'operator_review_required', updatedAt: body.occurredAt } },
            limitations: ['legal_hold_authority_not_modelled', 'backup_deletion_is_external_to_the_online_database',
              'regional_replica_deletion_is_external_to_the_online_database', 'append_only_audit_receipts_and_dispatch_evidence_are_preserved',
              'raw_identifier_erasure_requires_a_pseudonymous_reidentification_barrier'] } } });
      return route.fulfill({ status: 201, json: { state: {}, result: { policyVersion: 'journey.identity-policy.v1',
        stateVersion: 'journey.identity-state.v1', commandId: body.commandId, status: 'accepted', code,
        explanation: audit.explanation, audit, ...(body.type === 'merge' ? { resolvedProfileId: body.source.profileId,
          canonicalProfileId: body.target.profileId, mergeAuditId } : { mergeAuditId }) } } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected identity fixture route ${method} ${path}` } });
  });
}

test('customer 360 presents scoped identity facts, governed derived views, and responsive operations', async ({ page }, testInfo) => {
  const observed = { scoped: [] as string[], privacyWrites: [] as unknown[], exports: [] as unknown[], commands: [] as any[] };
  await enableIdentityFeature(page); await signIn(page); await fixtureIdentity(page, observed);
  await page.goto('/customer-360');
  await expect(page.getByRole('heading', { name: 'Customer identities' })).toBeVisible();
  await expect(page.getByTestId('journey-identity-profile-list')).toContainText('profile-alice');
  await expect(page.getByTestId('journey-identity-profile-detail')).toContainText('No inferred or probabilistic matches are shown');
  await expect(page.getByTestId('journey-identity-profile-detail')).toContainText('2 exact bindings');

  await page.getByRole('button', { name: 'profile-guest' }).click();
  await expect(page.getByTestId('journey-identity-profile-detail')).toContainText('profile-guest');
  await expect(page.getByText('No exact identifier bindings are recorded.')).toBeVisible();
  await page.getByRole('button', { name: 'profile-alice' }).click();

  await page.getByRole('tab', { name: 'Interactions' }).click();
  await expect(page.getByRole('cell', { name: 'Checkout completed' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await expect(page.getByRole('cell', { name: 'web-session' })).toBeVisible();
  await page.getByRole('tab', { name: 'Privacy and governance' }).click();
  await expect(page.getByText('Customer 360 derived view')).toBeVisible();
  await page.getByLabel('360 access purpose').selectOption('marketing');
  await expect(page.getByText(/denied, suppressed, or unavailable/u)).toBeVisible();
  await page.getByLabel('360 access purpose').selectOption('analytics');
  await expect(page.getByText('Customer 360 derived view')).toBeVisible();
  await page.getByLabel('Research contact privacy state').selectOption('granted');
  await expect.poll(() => observed.privacyWrites.length).toBe(1);
  await page.getByRole('button', { name: 'Create JSON export' }).click();
  await expect(page.getByText(/Latest profile export job:.*completed/u)).toBeVisible();
  expect(observed.exports).toEqual([{ purpose: 'analytics' }]);

  await page.getByRole('tab', { name: 'Accounts and groups' }).click();
  await page.getByRole('button', { name: 'Acme Services' }).click();
  await expect(page.getByText(/Purpose-allowed account 360: 1 members/u)).toBeVisible();
  await page.getByRole('tab', { name: 'Segments' }).click();
  await page.getByRole('button', { name: 'Known customers' }).click();
  await expect(page.getByText(/membership is a derived result/u)).toBeVisible();
  await expect(page.getByText('profile-alice').last()).toBeVisible();

  expect(observed.scoped.length).toBeGreaterThan(0);
  expect(observed.scoped.every(Boolean), 'identity requests must carry an authenticated active-space header').toBe(true);
  expect(new Set(observed.scoped).size, 'identity requests must remain in one active space').toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const tables = page.locator('div.max-w-full.overflow-x-auto');
  expect(await tables.count()).toBeGreaterThan(0);
  for (let index = 0; index < await tables.count(); index += 1) {
    await expect(tables.nth(index)).toHaveCSS('overflow-x', 'auto');
  }
  if (testInfo.project.name === 'mobile-chromium') {
    const visibleTable = page.locator('div.max-w-full.overflow-x-auto:visible').first();
    expect(await visibleTable.evaluate((node) => node.scrollWidth >= node.clientWidth)).toBe(true);
  }
});

test('manager compares profiles and tracks merge and split privacy propagation without claiming completion', async ({ page }) => {
  const observed = { scoped: [] as string[], privacyWrites: [] as unknown[], exports: [] as unknown[], commands: [] as any[] };
  await enableIdentityFeature(page); await signIn(page); await fixtureIdentity(page, observed);
  await page.goto('/customer-360');
  await page.getByLabel('Canonical target profile').selectOption('profile-guest');
  await expect(page.getByTestId('identity-merge-preflight')).toContainText('profile-alice');
  await expect(page.getByTestId('identity-merge-preflight')).toContainText('profile-guest');
  await page.getByLabel('Reviewed reason').fill('Support reviewed exact account evidence.');
  await page.getByLabel('Type MERGE to confirm').fill('MERGE');
  await page.getByLabel('Type MERGE to confirm').press('Enter');
  await expect(page.getByTestId('identity-command-outcome')).toContainText('Identity command accepted');
  await expect(page.getByTestId('identity-command-outcome')).toContainText('waiting for a downstream privacy target');
  await expect(page.getByTestId('identity-command-outcome')).not.toContainText('privacy propagation completed');
  await expect(page.getByText('Active merges')).toBeVisible();

  await page.getByLabel('Split reason').fill('Reviewed evidence shows two separate people.');
  await page.getByLabel('Type SPLIT to confirm').fill('SPLIT');
  await page.getByLabel('Type SPLIT to confirm').press('Enter');
  await expect(page.getByTestId('identity-command-outcome')).toContainText('operator-required privacy step');
  expect(observed.commands.map((command) => command.type)).toEqual(['merge', 'split']);
  expect(observed.commands[0].commandId).toMatch(/^merge-/u);
  expect(observed.commands[1].commandId).toMatch(/^split-/u);
});

test('member sees correction and audit state without merge or split controls', async ({ page }) => {
  const observed = { scoped: [] as string[], privacyWrites: [] as unknown[], exports: [] as unknown[], commands: [] as any[] };
  await enableIdentityFeature(page, 'member');
  await signIn(page);
  await fixtureIdentity(page, observed);
  await page.goto('/customer-360');
  await expect(page.getByTestId('identity-correction-workspace')).toContainText('Merge and split controls require an owner or administrator');
  await expect(page.getByTestId('identity-correction-workspace')).toContainText('Exact identity was recorded.');
  await expect(page.getByLabel('Canonical target profile')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Merge profiles' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Split profiles' })).toHaveCount(0);
  expect(observed.commands).toEqual([]);
});
