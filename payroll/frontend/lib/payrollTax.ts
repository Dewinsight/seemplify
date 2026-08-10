import api from '@/lib/api';

export type TaxFieldOption = {
  value: string;
  label: string;
};

export type TaxFieldDefinition = {
  key: string;
  label: string;
  type: 'currency' | 'percent' | 'integer' | 'boolean' | 'select' | 'text' | 'date';
  currencyScope?: 'calculation_currency' | 'payroll_currency';
  currencyCode?: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  unit?: string;
  defaultValue?: any;
  options?: TaxFieldOption[];
};

export function resolveTaxFieldCurrencyCode(
  field: TaxFieldDefinition,
  currencies: { calculationCurrency?: string; payrollCurrency?: string }
) {
  if (field.type !== 'currency') return '';
  const explicitCode = String(field.currencyCode || '').trim().toUpperCase();
  if (explicitCode) return explicitCode;
  return field.currencyScope === 'payroll_currency'
    ? String(currencies.payrollCurrency || '').trim().toUpperCase()
    : String(currencies.calculationCurrency || '').trim().toUpperCase();
}

export function describeTaxFieldCurrency(
  field: TaxFieldDefinition,
  currencies: { calculationCurrency?: string; payrollCurrency?: string }
) {
  if (field.type !== 'currency') return '';
  const code = resolveTaxFieldCurrencyCode(field, currencies);
  const payrollCurrency = String(currencies.payrollCurrency || '').trim().toUpperCase();
  if (field.currencyCode) {
    return `Enter this value in ${code || 'the configured field currency'}.`;
  }
  if (field.currencyScope === 'payroll_currency') {
    return `Enter this value in the employee payroll currency${code ? ` (${code})` : ''}.`;
  }
  const differentPayrollCurrency = code && payrollCurrency && code !== payrollCurrency
    ? ` The employee is paid in ${payrollCurrency}; do not convert this field to payroll currency.`
    : '';
  return `Enter this value in the tax pack calculation currency${code ? ` (${code})` : ''}.${differentPayrollCurrency}`;
}

export type TaxJurisdictionVersion = {
  _id: string;
  packKey?: string;
  contentHash?: string;
  label: string;
  versionNumber: number;
  status?: 'draft' | 'published' | 'archived';
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceDate?: string | null;
  validationStatus?: 'draft' | 'validated' | 'needs_review';
  calculationStatus?: 'runnable' | 'preview_only' | 'blocked';
  calculationCurrency?: string;
  coverage?: {
    level?: 'national' | 'federal' | 'subdivision' | 'local' | 'organization_override' | 'template';
    modules?: string[];
    exclusions?: string[];
    supportedSubdivisions?: string[];
  };
  reviewedBy?: {
    userId?: string;
    name?: string;
    reviewedAt?: string | null;
  };
  authoredBy?: { userId?: string; name?: string };
  legalOpenIssues?: string[];
  automatedTechnicalReviews?: Array<{
    _id?: string;
    runReference: string;
    contentHash: string;
    origin: 'deterministic' | 'ai_assisted';
    generatedByAI: boolean;
    engine?: {
      provider?: string;
      model?: string;
      promptVersion?: string;
      outputDigestSha256?: string;
    };
    objectiveStatus: 'passed' | 'failed';
    productionApproval: false;
    humanReviewRequired: true;
    checks: Array<{ code: string; status: 'passed' | 'failed'; details?: string[] }>;
    unresolvedLegalContradictions?: string[];
    summary?: string;
    completedAt?: string;
  }>;
  sourceLinks?: Array<{
    label: string;
    url: string;
    authorityType?: 'legislation' | 'tax_authority' | 'social_security_authority' | 'official_guidance' | 'court_or_ruling' | 'secondary';
    isPrimary?: boolean;
    publishedAt?: string | null;
    checkedAt?: string | null;
    retrievedAt?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    contentDigestSha256?: string;
    archiveReference?: string;
  }>;
  certificationReviews?: TaxCertificationReview[];
  certification?: TaxCertificationStatus;
  fieldDefinitions?: TaxFieldDefinition[];
  taxYear?: { mode?: 'calendar' | 'uk_apr_6' | 'south_africa_mar_1' };
  constants?: Record<string, any>;
  incomeTax?: Record<string, any>;
  statutoryRules?: any[];
  notes?: string[];
  testCases?: any[];
};

export type TaxCertificationReviewRole = 'tax_law' | 'payroll_calculation' | 'independent_qa';
export type TaxCertificationReview = {
  _id?: string;
  role: TaxCertificationReviewRole;
  decision: 'approved' | 'changes_requested' | 'rejected';
  contentHash: string;
  reviewer: {
    userId: string;
    name: string;
    credentialType?: TaxReviewerAuthorization['credentialType'];
    credentialReference?: string;
    authorizationId?: string | null;
  };
  sourceReferences?: string[];
  fixtureRunReference?: string;
  notes?: string;
  reviewedAt?: string;
};
export type TaxCertificationStatus = {
  contentHash: string;
  ready: boolean;
  requiredRoles: TaxCertificationReviewRole[];
  approvedRoles: TaxCertificationReviewRole[];
  reviews: TaxCertificationReview[];
  staleReviewCount: number;
  authorizationInvalidReviewCount?: number;
  problems: string[];
};
export type TaxReviewerAuthorization = {
  _id: string;
  userId: string;
  name: string;
  roles: TaxCertificationReviewRole[];
  credentialType: 'professional_license' | 'professional_membership' | 'engagement' | 'internal_appointment';
  credentialReference: string;
  verifiedBy: { userId: string; name: string };
  verifiedAt: string;
  expiresAt?: string | null;
  status: 'active' | 'revoked';
  revokedBy?: { userId?: string; name?: string };
  revokedAt?: string | null;
  revocationReason?: string;
  notes?: string;
};

export type TaxJurisdictionSummary = {
  _id: string;
  scope: 'global' | 'organization';
  organizationId?: string;
  countryCode: string;
  countryName: string;
  subdivisionCode?: string;
  subdivisionName?: string;
  localityCode?: string;
  localityName?: string;
  jurisdictionLevel?: 'national' | 'federal' | 'subdivision' | 'local' | 'organization_override' | 'template';
  displayName: string;
  description?: string;
  publishedVersionId?: string | null;
  publishedVersion?: TaxJurisdictionVersion | null;
  versionCount?: number;
  creationProvenance?: {
    kind: 'manual' | 'rollout_backlog' | 'clone' | 'legacy_import' | 'system_seed';
    reference?: string;
    backlogGroupId?: string;
    backlogEntryCode?: string;
    sourceUrl?: string;
    sourceLabel?: string;
    clonedFromVersionId?: string | null;
    recordedAt?: string;
    recordedBy?: { userId?: string; name?: string };
  };
};

export type TaxJurisdictionBacklogEntry = {
  code: string;
  name: string;
  implementationStatus: 'not_implemented' | 'certification_candidate';
  payrollRunnable: false;
  countryCode: string;
  countryName: string;
  subdivisionCode?: string;
  subdivisionName?: string;
  localityCode?: string;
  localityName?: string;
  jurisdictionLevel: 'national' | 'subdivision';
  displayName: string;
  existingDraft?: {
    jurisdictionId: string;
    displayName: string;
    status: 'draft' | 'active' | 'archived';
  } | null;
};

export type TaxJurisdictionBacklogGroup = {
  id: string;
  label: string;
  source: string;
  additionalScope: string;
  entries: TaxJurisdictionBacklogEntry[];
};

export type TaxJurisdictionDetail = TaxJurisdictionSummary & {
  status?: 'draft' | 'active' | 'archived';
  versions: TaxJurisdictionVersion[];
  reviewTeam?: TaxReviewerAuthorization[];
};

export type TaxCertificationReviewContext = {
  jurisdiction: Pick<TaxJurisdictionSummary, '_id' | 'countryCode' | 'countryName' | 'displayName' | 'description'>;
  version: TaxJurisdictionVersion;
  authorizations: TaxReviewerAuthorization[];
  certification: TaxCertificationStatus;
};

export type TaxRulePreviewRequest = {
  grossPay: number;
  taxableIncome: number;
  basicSalary: number;
  preTaxDeductions?: number;
  payFrequency: string;
  paymentDate?: string;
  employeeInfo?: Record<string, any>;
  statutoryContributions?: Record<string, any>;
  ytdGrossPay?: number;
  ytdTaxableIncome?: number;
  taxConfig: Record<string, any>;
  versionDefinition?: Record<string, any>;
  configDefinition?: Record<string, any>;
};

export type TaxRulePreviewResponse = {
  validationErrors?: string[];
  payrollRunnable?: boolean;
  blockingErrors?: string[];
  compliance?: {
    calculationStatus?: 'runnable' | 'preview_only' | 'blocked';
    validationStatus?: 'draft' | 'validated' | 'needs_review';
    calculationCurrency?: string;
    coverage?: TaxJurisdictionVersion['coverage'];
  };
  source?: {
    packKey?: string;
    contentHash?: string;
    sourceDate?: string | null;
    sourceLinks?: Array<{ label: string; url: string }>;
  };
  incomeTax?: Record<string, any>;
  statutoryContributions?: Record<string, any>;
  jurisdictionConfig?: TaxJurisdictionSummary;
  jurisdictionVersion?: TaxJurisdictionVersion | null;
};

export async function listTaxJurisdictions() {
  const response = await api.get('/payroll/tax/jurisdictions');
  return response.data?.jurisdictions as TaxJurisdictionSummary[];
}

export async function getTaxJurisdiction(id: string) {
  const response = await api.get(`/payroll/tax/jurisdictions/${id}`);
  return response.data?.jurisdiction as TaxJurisdictionDetail;
}

export async function createTaxJurisdiction(payload: Record<string, any>) {
  const response = await api.post('/payroll/tax/jurisdictions', payload);
  return response.data?.jurisdiction as TaxJurisdictionSummary;
}

export async function updateTaxJurisdiction(id: string, payload: Record<string, any>) {
  const response = await api.put(`/payroll/tax/jurisdictions/${id}`, payload);
  return response.data?.jurisdiction as TaxJurisdictionDetail;
}

export async function createTaxJurisdictionVersion(id: string, payload: Record<string, any>) {
  const response = await api.post(`/payroll/tax/jurisdictions/${id}/versions`, payload);
  return response.data?.version as TaxJurisdictionVersion;
}

export async function publishTaxJurisdictionVersion(id: string, versionId: string) {
  const response = await api.post(`/payroll/tax/jurisdictions/${id}/publish`, { versionId });
  return response.data?.jurisdiction as TaxJurisdictionDetail;
}

export async function listTaxJurisdictionBacklog() {
  const response = await api.get('/payroll/tax/jurisdiction-backlog');
  return response.data?.groups as TaxJurisdictionBacklogGroup[];
}

export async function getTaxCertificationReviewContext(id: string, versionId: string) {
  const response = await api.get(
    `/payroll/tax/jurisdictions/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/review-context`
  );
  return response.data as TaxCertificationReviewContext;
}

export async function submitTaxCertificationReview(
  id: string,
  versionId: string,
  payload: {
    role: TaxCertificationReviewRole;
    decision: 'approved' | 'changes_requested' | 'rejected';
    sourceReferences?: string[];
    fixtureRunReference?: string;
    notes?: string;
  }
) {
  const response = await api.post(`/payroll/tax/jurisdictions/${id}/versions/${versionId}/reviews`, payload);
  return response.data as { success: true; version: TaxJurisdictionVersion; certification: TaxCertificationStatus };
}

export async function runTaxAutomatedTechnicalReview(
  id: string,
  versionId: string,
  payload: {
    summary?: string;
    aiAssessment?: {
      provider: string;
      model: string;
      promptVersion?: string;
      outputDigestSha256: string;
      summary?: string;
      unresolvedLegalContradictions?: string[];
    };
  } = {}
) {
  const response = await api.post(
    `/payroll/tax/jurisdictions/${id}/versions/${versionId}/automated-review`,
    payload
  );
  return response.data as {
    success: true;
    evidence: NonNullable<TaxJurisdictionVersion['automatedTechnicalReviews']>[number];
    certification: TaxCertificationStatus;
  };
}

export async function authorizeTaxReviewer(
  id: string,
  payload: {
    userId: string;
    roles: TaxCertificationReviewRole[];
    credentialType: TaxReviewerAuthorization['credentialType'];
    credentialReference: string;
    expiresAt?: string | null;
    notes?: string;
  }
) {
  const response = await api.post(`/payroll/tax/jurisdictions/${id}/reviewers`, payload);
  return response.data as { success: true; reviewTeam: TaxReviewerAuthorization[] };
}

export async function revokeTaxReviewer(id: string, authorizationId: string) {
  const response = await api.post(`/payroll/tax/jurisdictions/${id}/reviewers/${authorizationId}/revoke`);
  return response.data as { success: true; reviewTeam: TaxReviewerAuthorization[] };
}

export async function previewTaxJurisdiction(payload: TaxRulePreviewRequest) {
  const response = await api.post('/payroll/tax/preview', payload);
  return response.data as TaxRulePreviewResponse;
}
