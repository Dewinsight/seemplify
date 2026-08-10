import api from '@/lib/api';

export type PayrollTaxRegistration = {
  _id?: string;
  authorityCode: string;
  registrationType: string;
  registrationReference: string;
  evidenceReference: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: 'unverified' | 'reviewed' | 'revoked';
};

export type PayrollEmployerEntity = {
  _id: string;
  organizationId: string;
  code: string;
  legalName: string;
  employerType: 'company' | 'subsidiary' | 'registered_branch' | 'employer_of_record';
  countryCode: string;
  jurisdictionCode: string;
  defaultCurrency: string;
  status: 'draft' | 'active' | 'inactive';
  taxJurisdictionConfigId?: string | null;
  taxJurisdictionVersionId?: string | null;
  taxAdapterCandidateId?: string;
  taxRegistrations: PayrollTaxRegistration[];
  payrollReadiness: {
    payrollRunnable: boolean;
    mode: 'runnable' | 'preview_only' | 'blocked';
    blockingIssues: string[];
    taxPack?: {
      label?: string;
      calculationStatus?: string;
      contentHash?: string;
    } | null;
  };
};

export type TaxAdapterCandidate = {
  id: string;
  countryCode: string;
  jurisdictionCode: string;
  displayName: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string;
  releaseStatus: string;
  blockers: string[];
};

export type PayrollEmployerEntityPayload = Omit<PayrollEmployerEntity,
  '_id' | 'organizationId' | 'payrollReadiness'>;

export async function listPayrollEmployerEntities(status?: string) {
  const response = await api.get('/payroll/employer-entities', { params: status ? { status } : undefined });
  return (response.data?.entities || []) as PayrollEmployerEntity[];
}

export async function listTaxAdapterCandidates() {
  const response = await api.get('/payroll/employer-entities/adapter-candidates');
  return (response.data?.candidates || []) as TaxAdapterCandidate[];
}

export async function createPayrollEmployerEntity(payload: PayrollEmployerEntityPayload) {
  const response = await api.post('/payroll/employer-entities', payload);
  return response.data.entity as PayrollEmployerEntity;
}

export async function updatePayrollEmployerEntity(id: string, payload: Partial<PayrollEmployerEntityPayload>) {
  const response = await api.put(`/payroll/employer-entities/${id}`, payload);
  return response.data.entity as PayrollEmployerEntity;
}

export async function previewEmployerTaxAdapter(id: string, input: Record<string, unknown>) {
  const response = await api.post(`/payroll/employer-entities/${id}/preview`, input);
  return response.data.preview;
}
