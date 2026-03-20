import api from '@/lib/api';

export type TaxFieldOption = {
  value: string;
  label: string;
};

export type TaxFieldDefinition = {
  key: string;
  label: string;
  type: 'currency' | 'percent' | 'integer' | 'boolean' | 'select' | 'text' | 'date';
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  unit?: string;
  defaultValue?: any;
  options?: TaxFieldOption[];
};

export type TaxJurisdictionVersion = {
  _id: string;
  label: string;
  versionNumber: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  validationStatus?: 'draft' | 'validated' | 'needs_review';
  sourceLinks?: Array<{ label: string; url: string }>;
  fieldDefinitions?: TaxFieldDefinition[];
  taxYear?: { mode?: 'calendar' | 'uk_apr_6' | 'south_africa_mar_1' };
  constants?: Record<string, any>;
  incomeTax?: Record<string, any>;
  statutoryRules?: any[];
  notes?: string[];
  testCases?: any[];
};

export type TaxJurisdictionSummary = {
  _id: string;
  scope: 'global' | 'organization';
  organizationId?: string;
  countryCode: string;
  countryName: string;
  displayName: string;
  description?: string;
  publishedVersionId?: string | null;
  publishedVersion?: TaxJurisdictionVersion | null;
  versionCount?: number;
};

export type TaxJurisdictionDetail = TaxJurisdictionSummary & {
  status?: 'draft' | 'active' | 'archived';
  versions: TaxJurisdictionVersion[];
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

export async function previewTaxJurisdiction(payload: TaxRulePreviewRequest) {
  const response = await api.post('/payroll/tax/preview', payload);
  return response.data as TaxRulePreviewResponse;
}
