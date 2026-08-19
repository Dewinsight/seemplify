import http from 'node:http';

const port = 5006;
const requests = [];
const compensationRequests = [];

const readiness = (mode, issues) => ({
  payrollRunnable: mode === 'runnable',
  mode,
  blockingIssues: issues,
  taxPack: {
    label: mode === 'runnable' ? 'Published statutory pack' : '2026 independently tested preview',
    calculationStatus: mode,
    contentHash: `e2e-${mode}-content-hash`,
  },
});

const baselineEntities = [
  {
    _id: 'entity-ng',
    organizationId: 'org-e2e',
    code: 'NG-HQ',
    legalName: 'Seemplify Nigeria Limited (synthetic)',
    employerType: 'company',
    countryCode: 'NG',
    jurisdictionCode: 'NG-LA',
    defaultCurrency: 'NGN',
    status: 'active',
    taxJurisdictionConfigId: 'tax-ng',
    taxJurisdictionVersionId: 'tax-ng-v1',
    taxAdapterCandidateId: 'NG_2026_WAVE_1',
    taxRegistrations: [],
    payrollReadiness: readiness('preview_only', [
      'Nigeria adapter remains non-postable pending jurisdiction registration and legal certification.',
    ]),
  },
  {
    _id: 'entity-uk',
    organizationId: 'org-e2e',
    code: 'UK-SUB',
    legalName: 'Seemplify UK Subsidiary Limited (synthetic)',
    employerType: 'subsidiary',
    countryCode: 'GB',
    jurisdictionCode: 'GB',
    defaultCurrency: 'GBP',
    status: 'active',
    taxJurisdictionConfigId: 'tax-gb',
    taxJurisdictionVersionId: 'tax-gb-v1',
    taxAdapterCandidateId: 'GB_2026_27_WAVE_1',
    taxRegistrations: [],
    payrollReadiness: readiness('preview_only', [
      'UK PAYE adapter remains non-postable pending full statutory coverage and certification.',
    ]),
  },
];

const entities = structuredClone(baselineEntities);

const candidates = [
  {
    id: 'NG_2026_WAVE_1',
    countryCode: 'NG',
    jurisdictionCode: 'NG-LA',
    displayName: 'Nigeria 2026 Wave 1 (preview)',
    currency: 'NGN',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'preview_only',
    blockers: ['Legal certification required'],
  },
  {
    id: 'GB_2026_27_WAVE_1',
    countryCode: 'GB',
    jurisdictionCode: 'GB',
    displayName: 'United Kingdom PAYE 2026/27 (preview)',
    currency: 'GBP',
    effectiveFrom: '2026-04-06',
    effectiveTo: '2027-04-05',
    releaseStatus: 'preview_only',
    blockers: ['Full statutory certification required'],
  },
];

const baselineJurisdictions = [
  {
    _id: 'tax-ng',
    scope: 'organization',
    status: 'draft',
    countryCode: 'NG',
    countryName: 'Nigeria',
    displayName: 'Nigeria 2026',
    publishedVersion: {
      _id: 'tax-ng-v1',
      versionNumber: 1,
      label: 'Nigeria 2026 preview',
      calculationStatus: 'preview_only',
      calculationCurrency: 'NGN',
    },
    versions: [{
      _id: 'tax-ng-draft-v2',
      versionNumber: 2,
      status: 'draft',
      label: 'Nigeria configurable draft',
      effectiveFrom: '2026-01-01',
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      calculationCurrency: 'NGN',
      coverage: { level: 'national', modules: ['income_tax', 'statutory_contributions'], exclusions: ['draft_changes'] },
      fieldDefinitions: [],
      sourceLinks: [{ label: 'Nigeria Tax Act 2025', url: 'https://example.invalid/nigeria-tax-act', authorityType: 'legislation', isPrimary: true, checkedAt: '2026-08-01', retrievedAt: '2026-08-01', contentDigestSha256: 'a'.repeat(64) }],
      constants: { periodsPerYear: 12, pensionRate: 8 },
      incomeTax: { strategy: 'progressive_bands', taxableAnnualFormula: 'annualizedTaxableIncome', brackets: [{ min: 0, max: null, rate: 0 }], annualTaxAfterFormula: 'annualTaxBeforeAdjustments' },
      statutoryRules: [{ strategy: 'flat_percent', type: 'social_security', name: 'Pension employee', liabilityCode: 'NG_PENSION_EMPLOYEE', payer: 'employee', rate: 8, baseFormula: 'grossPay', whenFormula: 'true' }],
      notes: [],
      testCases: [{ name: 'Ordinary monthly payroll', category: 'ordinary_period', inputs: { grossPay: 100000 }, expected: { taxAmount: 0 } }],
      legalOpenIssues: ['draft_changes'],
      certification: { ready: false, requiredRoles: ['tax_law', 'payroll_calculation', 'independent_qa'], approvedRoles: [], reviews: [], staleReviewCount: 0, problems: ['Draft changes require certification.'] },
    }],
    reviewTeam: [],
  },
  {
    _id: 'tax-gb',
    countryCode: 'GB',
    countryName: 'United Kingdom',
    displayName: 'United Kingdom 2026/27',
    publishedVersion: {
      _id: 'tax-gb-v1',
      versionNumber: 1,
      label: 'UK PAYE 2026/27 preview',
      calculationStatus: 'preview_only',
      calculationCurrency: 'GBP',
    },
  },
  {
    _id: 'tax-ng-platform',
    scope: 'global',
    status: 'active',
    countryCode: 'NG',
    countryName: 'Nigeria',
    displayName: 'Nigeria statutory platform release',
    publishedVersionId: 'tax-ng-platform-v2',
    versions: [{
      _id: 'tax-ng-platform-v2',
      versionNumber: 2,
      status: 'published',
      label: 'Nigeria statutory platform release V2',
      effectiveFrom: '2026-01-01',
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      calculationCurrency: 'NGN',
      coverage: { level: 'national', modules: ['income_tax', 'statutory_contributions'], exclusions: [] },
      fieldDefinitions: [],
      sourceLinks: [{ label: 'Nigeria Tax Act 2025', url: 'https://example.invalid/nigeria-tax-act', authorityType: 'legislation', isPrimary: true, checkedAt: '2026-08-19', retrievedAt: '2026-08-19', contentDigestSha256: 'b'.repeat(64) }],
      constants: { periodsPerYear: 12 },
      incomeTax: { strategy: 'progressive_bands' },
      statutoryRules: [],
      notes: [],
      testCases: [],
      legalOpenIssues: [],
      platformRelease: {
        releaseId: 'platform:NG-2026-NTA:2026-08-19',
        channel: 'production',
        releasedAt: '2026-08-19T12:00:00.000Z',
        evidenceReference: 'PAYROLL-NG-2026-RELEASE',
        fixtureSuite: 'Nigeria2026OfficialFixtures',
      },
      automatedTechnicalReviews: [{
        runReference: 'ci:payroll-ng-release',
        contentHash: 'b'.repeat(64),
        origin: 'deterministic',
        generatedByAI: false,
        objectiveStatus: 'passed',
        productionApproval: true,
        humanReviewRequired: false,
        checks: [{ code: 'official_fixtures', status: 'passed' }],
        unresolvedLegalContradictions: [],
      }],
      certification: {
        contentHash: 'b'.repeat(64),
        ready: true,
        certificationMode: 'platform_release',
        platformRelease: {
          releaseId: 'platform:NG-2026-NTA:2026-08-19',
          channel: 'production',
          releasedAt: '2026-08-19T12:00:00.000Z',
          evidenceReference: 'PAYROLL-NG-2026-RELEASE',
          fixtureSuite: 'Nigeria2026OfficialFixtures',
        },
        requiredRoles: [],
        approvedRoles: ['platform_release'],
        reviews: [],
        staleReviewCount: 0,
        problems: [],
      },
    }],
    reviewTeam: [],
  },
  {
    _id: 'tax-ca-candidate',
    scope: 'global',
    status: 'active',
    countryCode: 'CA',
    countryName: 'Canada',
    displayName: 'Canada 2026 implementation template',
    publishedVersion: {
      _id: 'tax-ca-candidate-v1',
      versionNumber: 1,
      status: 'published',
      label: 'Ontario certification candidate',
      validationStatus: 'needs_review',
      calculationStatus: 'blocked',
      calculationCurrency: 'CAD',
      coverage: { level: 'federal', modules: [], exclusions: ['uncertified_provinces'] },
    },
    versions: [],
  },
  {
    _id: 'tax-eu-template',
    scope: 'global',
    status: 'active',
    countryCode: 'EU',
    countryName: 'European Union',
    displayName: 'EU country-pack template',
    publishedVersion: {
      _id: 'tax-eu-template-v1',
      versionNumber: 1,
      status: 'published',
      label: 'Country selection required',
      validationStatus: 'needs_review',
      calculationStatus: 'blocked',
      calculationCurrency: 'EUR',
      coverage: { level: 'template', modules: [], exclusions: ['all_national_payroll_taxes'] },
    },
    versions: [],
  },
];

const jurisdictions = structuredClone(baselineJurisdictions);

const idpMembers = [
  {
    id: 'member-ng',
    sub: 'user-ng',
    name: 'Ada Nigeria (synthetic)',
    email: 'ada.ng@example.invalid',
    employeeId: 'SYN-NG-001',
    designation: 'Operations Analyst',
    departmentName: 'Operations',
    onboardingStatus: 'completed',
    teamIds: ['team-operations'],
    teamNames: ['Operations'],
  },
  {
    id: 'member-uk',
    sub: 'user-uk',
    name: 'Ben United Kingdom (synthetic)',
    email: 'ben.uk@example.invalid',
    employeeId: 'SYN-UK-001',
    designation: 'Product Manager',
    departmentName: 'Product',
    onboardingStatus: 'completed',
    teamIds: ['team-product'],
    teamNames: ['Product'],
  },
  {
    id: 'member-unconfigured',
    sub: 'user-unconfigured',
    name: 'Chidi Existing IDP Member (synthetic)',
    email: 'chidi.idp@example.invalid',
    employeeId: 'SYN-NG-002',
    designation: 'Customer Operations Specialist',
    departmentName: 'Operations',
    onboardingStatus: 'completed',
    teamIds: ['team-operations'],
    teamNames: ['Operations'],
  },
  {
    id: 'member-onboarding-new',
    sub: 'user-onboarding-new',
    name: 'Dayo New Hire (synthetic)',
    email: 'dayo.new-hire@example.invalid',
    employeeId: 'SYN-NG-003',
    designation: 'People Operations Associate',
    departmentId: 'department-operations',
    departmentName: 'Operations',
    onboardingStatus: 'completed',
    teamIds: ['team-operations'],
    teamNames: ['Operations'],
    peopleTransition: null,
  },
  {
    id: 'member-onboarding-active',
    sub: 'user-onboarding-active',
    name: 'Imani Active Transition (synthetic)',
    email: 'imani.transition@example.invalid',
    employeeId: 'SYN-NG-004',
    designation: 'Implementation Specialist',
    departmentId: 'department-product',
    departmentName: 'Product',
    onboardingStatus: 'not_started',
    teamIds: ['team-product'],
    teamNames: ['Product'],
    peopleTransition: {
      subjectId: 'member-onboarding-active',
      status: 'in_progress',
      processType: 'onboarding',
      transitionId: 'transition-onboarding-active',
      activeTransitionCount: 1,
      pendingTaskCount: 3,
      deepLink: 'https://app.seemplifyai.com/people-transitions/tasks?transitionId=transition-onboarding-active',
    },
  },
  {
    id: 'member-retiring',
    sub: 'user-retiring',
    name: 'Ravi Retirement Closeout (synthetic)',
    email: 'ravi.retirement@example.invalid',
    employeeId: 'SYN-UK-002',
    designation: 'Principal Engineer',
    departmentId: 'department-product',
    departmentName: 'Product',
    onboardingStatus: 'completed',
    teamIds: ['team-product'],
    teamNames: ['Product'],
    peopleTransition: {
      subjectId: 'member-retiring',
      status: 'in_progress',
      processType: 'retirement',
      transitionId: 'transition-retirement-active',
      activeTransitionCount: 1,
      pendingTaskCount: 2,
      deepLink: 'https://app.seemplifyai.com/people-transitions/tasks?transitionId=transition-retirement-active',
    },
  },
];

const profiles = {
  'employee-ng': {
    _id: 'employee-ng',
    userId: 'user-ng',
    employeeInfo: {
      name: 'Ada Nigeria (synthetic)',
      email: 'ada.ng@example.invalid',
      employeeId: 'SYN-NG-001',
      designation: 'Operations Analyst',
      department: 'Operations',
      employmentType: 'full_time',
      dateOfJoining: '2026-01-01',
      country: 'Nigeria',
    },
    basicSalary: 1_000_000,
    currency: 'NGN',
    payFrequency: 'monthly',
    isActive: true,
    employerEntityId: 'entity-ng',
    taxAssignment: {
      workCountryCode: 'NG',
      workJurisdictionCode: 'NG-LA',
      taxJurisdictionCode: 'NG-LA',
      determinationReason: 'Employed and paid by the Nigerian legal employer.',
      evidenceReference: 'SYN-NG-CONTRACT-001',
      effectiveFrom: '2026-01-01',
    },
    payrollFlags: {
      includeInNextRun: false,
      excludeFromNextRun: false,
      holdPayment: false,
      requiresReview: true,
      reviewReason: 'Automatic payroll setup: The selected country tax pack is preview only.',
    },
    allowances: [],
    benefitItems: [],
    recurringDeductions: [],
    bankAccounts: [],
    statutoryContributions: {},
    taxConfig: { jurisdictionCode: 'NG', jurisdictionConfigId: 'tax-ng' },
  },
  'employee-uk': {
    _id: 'employee-uk',
    userId: 'user-uk',
    employeeInfo: {
      name: 'Ben United Kingdom (synthetic)',
      email: 'ben.uk@example.invalid',
      employeeId: 'SYN-UK-001',
      designation: 'Product Manager',
      department: 'Product',
      employmentType: 'full_time',
      dateOfJoining: '2026-04-06',
      country: 'United Kingdom',
    },
    basicSalary: 5_000,
    currency: 'GBP',
    payFrequency: 'monthly',
    isActive: true,
    employerEntityId: 'entity-uk',
    taxAssignment: {
      workCountryCode: 'GB',
      workJurisdictionCode: 'GB',
      taxJurisdictionCode: 'GB',
      determinationReason: 'Employed and paid by the UK subsidiary under UK PAYE.',
      evidenceReference: 'SYN-UK-CONTRACT-001',
      effectiveFrom: '2026-04-06',
    },
    payrollFlags: { includeInNextRun: true, excludeFromNextRun: false, holdPayment: false },
    allowances: [],
    benefitItems: [],
    recurringDeductions: [],
    bankAccounts: [],
    statutoryContributions: {},
    taxConfig: { jurisdictionCode: 'GB', jurisdictionConfigId: 'tax-gb' },
  },
  'employee-retiring': {
    _id: 'employee-retiring',
    userId: 'user-retiring',
    employeeInfo: {
      name: 'Ravi Retirement Closeout (synthetic)',
      email: 'ravi.retirement@example.invalid',
      employeeId: 'SYN-UK-002',
      designation: 'Principal Engineer',
      department: 'Product',
      employmentType: 'full_time',
      dateOfJoining: '2018-03-12',
      country: 'United Kingdom',
    },
    basicSalary: 8_000,
    currency: 'GBP',
    payFrequency: 'monthly',
    isActive: true,
    employerEntityId: 'entity-uk',
    payrollFlags: { includeInNextRun: true, excludeFromNextRun: false, holdPayment: false },
    allowances: [],
    benefitItems: [],
    recurringDeductions: [],
    bankAccounts: [],
    statutoryContributions: {},
    taxConfig: { jurisdictionCode: 'GB', jurisdictionConfigId: 'tax-gb' },
  },
};

const baselineProfiles = structuredClone(profiles);
const runStates = {
  'run-ng': { status: 'calculated' },
  'run-uk': { status: 'calculated' },
};

function json(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5007',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 204, {});

  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const body = await readBody(request);

  if (path === '/__e2e__/health') return json(response, 200, { ok: true });
  if (path === '/__e2e__/requests') {
    if (request.method === 'DELETE') {
      requests.splice(0, requests.length);
      compensationRequests.splice(0, compensationRequests.length);
      entities.splice(0, entities.length, ...structuredClone(baselineEntities));
      jurisdictions.splice(0, jurisdictions.length, ...structuredClone(baselineJurisdictions));
      for (const key of Object.keys(profiles)) delete profiles[key];
      Object.assign(profiles, structuredClone(baselineProfiles));
      runStates['run-ng'] = { status: 'calculated' };
      runStates['run-uk'] = { status: 'calculated' };
      return json(response, 200, { ok: true });
    }
    return json(response, 200, { requests });
  }

  requests.push({ method: request.method, path, body, query: Object.fromEntries(url.searchParams) });

  if (path === '/auth/me') {
    const organization = { id: 'org-e2e', name: 'Seemplify Test Organization', role: 'owner', isCurrent: true };
    return json(response, 200, {
      user: {
        id: 'owner-e2e',
        sub: 'owner-e2e',
        name: 'Payroll Test Owner',
        email: 'payroll-owner@example.invalid',
        organizations: [organization],
        teams: [],
      },
      currentOrganizationId: organization.id,
      currentOrganization: organization,
    });
  }

  if (path === '/payroll/employer-entities/adapter-candidates') {
    return json(response, 200, { candidates });
  }
  if (path === '/payroll/idp/members') {
    return json(response, 200, {
      organizationId: 'org-e2e',
      members: idpMembers,
      syncAvailable: true,
    });
  }
  if (path === '/payroll/idp/teams') {
    return json(response, 200, {
      organizationId: 'org-e2e',
      teams: [
        { id: 'team-operations', name: 'Operations', department: { id: 'department-operations', name: 'Operations' } },
        { id: 'team-product', name: 'Product', department: { id: 'department-product', name: 'Product' } },
      ],
      syncAvailable: true,
    });
  }
  if (path === '/payroll/idp/onboarding/assign' && request.method === 'POST') {
    return json(response, 201, {
      success: true,
      transitionId: 'transition-onboarding-created',
      status: 'pending',
      deepLink: 'https://app.seemplifyai.com/people-transitions/tasks?transitionId=transition-onboarding-created',
    });
  }
  if (/^\/payroll\/idp\/onboarding\/members\/[^/]+\/reminder$/.test(path) && request.method === 'POST') {
    return json(response, 200, { success: true, reminded: true });
  }
  if (path === '/payroll/employer-entities' && request.method === 'GET') {
    const status = url.searchParams.get('status');
    return json(response, 200, { entities: status ? entities.filter((entity) => entity.status === status) : entities });
  }
  if (path === '/payroll/employer-entities' && request.method === 'POST') {
    const entity = {
      _id: `entity-created-${entities.length + 1}`,
      organizationId: 'org-e2e',
      ...body,
      payrollReadiness: readiness('blocked', ['Tax registration requires independent review.']),
    };
    entities.push(entity);
    return json(response, 201, { entity });
  }
  const employerEntityMatch = path.match(/^\/payroll\/employer-entities\/([^/]+)$/);
  if (employerEntityMatch && request.method === 'PUT') {
    const entity = entities.find((row) => row._id === employerEntityMatch[1]);
    if (!entity) return json(response, 404, { error: 'Legal employer not found' });
    Object.assign(entity, body);
    if (body.status === 'inactive') entity.payrollReadiness = readiness('blocked', ['Legal employer is not active.']);
    return json(response, 200, { entity });
  }
  if (path === '/payroll/tax/jurisdictions' && request.method === 'GET') return json(response, 200, { jurisdictions });
  if (path === '/payroll/tax/jurisdictions' && request.method === 'POST') {
    const source = body.cloneFromId ? jurisdictions.find((entry) => entry._id === body.cloneFromId) : null;
    const sequence = jurisdictions.length + 1;
    const created = source ? {
      ...structuredClone(source),
      _id: `tax-clone-${sequence}`,
      scope: 'organization',
      status: 'draft',
      displayName: body.displayName || `${source.displayName} Override`,
      publishedVersion: null,
      publishedVersionId: null,
      versions: (source.versions || []).slice(0, 1).map((version, index) => ({
        ...version,
        _id: `tax-clone-${sequence}-v${index + 1}`,
        versionNumber: index + 1,
        status: 'draft',
        validationStatus: 'draft',
        calculationStatus: 'blocked',
        platformRelease: undefined,
        certification: { ready: false, requiredRoles: ['tax_law', 'payroll_calculation', 'independent_qa'], approvedRoles: [], reviews: [], staleReviewCount: 0, problems: ['Organization certification required.'] },
      })),
      reviewTeam: [],
    } : {
      _id: `tax-created-${sequence}`,
      scope: 'organization',
      status: 'draft',
      countryCode: body.countryCode || body.backlogReference?.entryCode || 'OTHER',
      countryName: body.countryName || (body.backlogReference?.entryCode === 'JP' ? 'Japan' : 'Custom jurisdiction'),
      displayName: body.displayName,
      description: body.description,
      jurisdictionLevel: body.jurisdictionLevel || 'national',
      versions: [{ _id: `tax-created-${sequence}-v1`, versionNumber: 1, status: 'draft', validationStatus: 'draft', calculationStatus: 'blocked', ...(body.version || {}) }],
      reviewTeam: [],
    };
    jurisdictions.push(created);
    return json(response, 201, { jurisdiction: created });
  }
  if (path === '/payroll/tax/jurisdiction-backlog') return json(response, 200, { groups: [{
    id: 'GLOBAL_COUNTRY_OR_TERRITORY_PACKS',
    label: 'Remaining country and territory payroll-tax systems',
    source: 'https://unstats.un.org/unsd/methodology/m49/',
    requiredModules: ['national income-tax withholding'],
    additionalScope: 'Governed country setup coverage.',
    entries: [{ code: 'JP', name: 'Japan', displayName: 'Japan payroll', countryCode: 'JP', countryName: 'Japan', jurisdictionLevel: 'national', implementationStatus: 'dynamic_pack_backlog', payrollRunnable: false }],
  }] });
  const taxJurisdictionMatch = path.match(/^\/payroll\/tax\/jurisdictions\/([^/]+)$/);
  if (taxJurisdictionMatch && request.method === 'GET') {
    const jurisdiction = jurisdictions.find((entry) => entry._id === taxJurisdictionMatch[1]);
    return jurisdiction ? json(response, 200, { jurisdiction }) : json(response, 404, { error: 'Tax jurisdiction not found' });
  }
  if (taxJurisdictionMatch && request.method === 'PUT') {
    const jurisdiction = jurisdictions.find((entry) => entry._id === taxJurisdictionMatch[1]);
    return jurisdiction ? json(response, 200, { jurisdiction }) : json(response, 404, { error: 'Tax jurisdiction not found' });
  }
  if (path === '/currencies' || path === '/payroll/currencies') {
    const currencyRows = [
      { code: 'NGN', name: 'Nigerian Naira', label: 'NGN - Nigerian Naira', enabled: true, paymentEnabled: true, statutoryEligible: true, kind: 'fiat' },
      { code: 'GBP', name: 'Pound Sterling', label: 'GBP - Pound Sterling', enabled: true, paymentEnabled: true, statutoryEligible: true, kind: 'fiat' },
    ];
    return json(response, 200, { currencies: currencyRows });
  }
  if (path === '/payroll/profiles' && request.method === 'GET') {
    return json(response, 200, { profiles: Object.values(profiles), total: Object.keys(profiles).length });
  }
  if (path === '/compensation/team' && request.method === 'GET') {
    return json(response, 200, compensationRequests);
  }
  if (path === '/compensation/request' && request.method === 'POST') {
    const record = {
      _id: `compensation-${compensationRequests.length + 1}`,
      ...body,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    compensationRequests.push(record);
    return json(response, 201, record);
  }
  if (path === '/compensation/approvals' && request.method === 'GET') {
    return json(response, 200, compensationRequests);
  }
  if (path === '/payroll/profiles/sync-from-idp' && request.method === 'POST') {
    const member = idpMembers.find((row) => row.sub === body?.userId || row.id === body?.userId);
    if (!member) return json(response, 404, { error: 'Employee not found in IDP organization members' });
    const existing = Object.values(profiles).find((profile) => profile.userId === member.sub);
    if (existing) return json(response, 200, { success: true, profile: existing, existed: true });
    const profile = {
      _id: `profile-${member.sub}`,
      userId: member.sub,
      organizationId: 'org-e2e',
      employeeInfo: {
        name: member.name,
        email: member.email,
        employeeId: member.employeeId,
        designation: member.designation,
        department: member.departmentName,
      },
      basicSalary: 0,
      currency: 'NGN',
      payFrequency: 'monthly',
      isActive: true,
      payrollFlags: { includeInNextRun: false, excludeFromNextRun: false, requiresReview: true },
      allowances: [],
      benefitItems: [],
      recurringDeductions: [],
      bankAccounts: [],
      statutoryContributions: {},
      taxConfig: {},
    };
    profiles[member.sub] = profile;
    return json(response, 201, { success: true, profile, existed: false, identitySource: 'identity_provider' });
  }
  const profileMatch = path.match(/^\/payroll\/profiles\/([^/]+)$/);
  if (profileMatch && request.method === 'GET') {
    const profile = profiles[profileMatch[1]]
      || Object.values(profiles).find((row) => row.userId === profileMatch[1]);
    return profile
      ? json(response, 200, profile)
      : json(response, 404, { error: 'Payroll configuration not found' });
  }
  if (profileMatch && request.method === 'PUT') {
    profiles[profileMatch[1]] = { ...(profiles[profileMatch[1]] || {}), ...body };
    return json(response, 200, { success: true, profile: profiles[profileMatch[1]] });
  }
  if (/^\/payroll\/profiles\/[^/]+\/tax-preview$/.test(path)) {
    return json(response, 200, {
      payrollRunnable: false,
      compliance: { calculationStatus: 'preview_only', calculationCurrency: body?.currency || 'NGN' },
      incomeTax: { employeeTax: body?.currency === 'GBP' ? 418.33 : 138230 },
      blockingErrors: ['Preview-only tax pack cannot finalize payroll.'],
    });
  }
  if (path === '/payroll/runs' && request.method === 'POST') {
    const entity = entities.find((row) => row._id === body?.employerEntityId) || entities[0];
    const runId = entity._id === 'entity-uk' ? 'run-uk' : 'run-ng';
    runStates[runId] = { status: 'calculated' };
    return json(response, 201, {
      run: {
        _id: runId,
        runNumber: `SYN-${entity.code}-2026-08`,
        status: 'calculated',
        employerEntityId: entity._id,
        employerEntitySnapshot: {
          legalName: entity.legalName,
          jurisdictionCode: entity.jurisdictionCode,
          currency: entity.defaultCurrency,
          payrollRunnableAtCreation: false,
        },
      },
    });
  }
  const retractMatch = path.match(/^\/payroll\/runs\/(run-ng|run-uk)\/retract$/);
  if (retractMatch && request.method === 'POST') {
    runStates[retractMatch[1]] = {
      status: 'cancelled',
      retractedAt: '2026-08-19T12:38:33.000Z',
      retractedByName: 'Payroll Test Owner',
      retractionReason: body?.comments,
    };
    return json(response, 500, { error: 'Simulated ambiguous post-commit response' });
  }
  const runMatch = path.match(/^\/payroll\/runs\/(run-ng|run-uk)\/payslips$/);
  if (runMatch) {
    const entity = runMatch[1] === 'run-uk' ? entities[1] : entities[0];
    const profile = runMatch[1] === 'run-uk' ? profiles['employee-uk'] : profiles['employee-ng'];
    const runState = runStates[runMatch[1]];
    return json(response, 200, {
      run: {
        _id: runMatch[1],
        runNumber: `SYN-${entity.code}-2026-08`,
        ...runState,
        month: 8,
        year: 2026,
        workInputs: [],
        employees: [{ userId: profile.userId, employeeName: profile.employeeInfo.name, status: 'calculated' }],
        summary: { currency: entity.defaultCurrency, grossPay: profile.basicSalary, netPay: profile.basicSalary },
        employerEntitySnapshot: {
          legalName: entity.legalName,
          jurisdictionCode: entity.jurisdictionCode,
          currency: entity.defaultCurrency,
          payrollRunnableAtCreation: false,
        },
      },
      payslips: [],
    });
  }

  return json(response, 200, request.method === 'GET' ? {} : { success: true });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Payroll E2E mock API listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
