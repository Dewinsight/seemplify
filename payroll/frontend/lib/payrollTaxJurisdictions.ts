export type PayrollTaxJurisdictionOption = {
  code: string;
  label: string;
  mode: 'builtin' | 'manual_only';
  description: string;
};

export const payrollTaxJurisdictions: PayrollTaxJurisdictionOption[] = [
  {
    code: 'GB',
    label: 'United Kingdom',
    mode: 'builtin',
    description: 'Review-only 2026/27 PAYE and National Insurance preview; final payroll is not yet certified.',
  },
  {
    code: 'US',
    label: 'United States',
    mode: 'builtin',
    description: 'Review-only federal withholding and FICA preview. State and local tax adapters are not implemented.',
  },
  {
    code: 'NG',
    label: 'Nigeria',
    mode: 'builtin',
    description: 'Review-only Nigeria PAYE and pension preview; final payroll remains blocked pending certification.',
  },
  {
    code: 'GH',
    label: 'Ghana',
    mode: 'builtin',
    description: 'Review-only Ghana PAYE and SSNIT preview; final payroll remains blocked pending certification.',
  },
  {
    code: 'KE',
    label: 'Kenya',
    mode: 'builtin',
    description: 'Review-only Kenya PAYE preview; final payroll remains blocked until certification is complete.',
  },
  {
    code: 'ZA',
    label: 'South Africa',
    mode: 'builtin',
    description: 'Review-only South Africa PAYE, UIF and SDL preview; final payroll remains blocked pending certification.',
  },
  {
    code: 'CM',
    label: 'Cameroon',
    mode: 'builtin',
    description: 'Review-only IRPP and statutory-contribution preview; final payroll remains blocked pending current-law review.',
  },
  {
    code: 'MZ',
    label: 'Mozambique',
    mode: 'builtin',
    description: 'Review-only 2026 IRPS and INSS preview; final payroll remains blocked pending legal transition review.',
  },
  {
    code: 'CA',
    label: 'Canada',
    mode: 'manual_only',
    description: 'CRA, province or territory, and Quebec payroll adapters are not yet certified.',
  },
  {
    code: 'EU',
    label: 'European Union member state',
    mode: 'manual_only',
    description: 'There is no single EU-wide payroll tax table. Configure the member-state rule manually.',
  },
  {
    code: 'OTHER',
    label: 'Other / custom jurisdiction',
    mode: 'manual_only',
    description: 'Use manual tax setup for unsupported countries or special cases.',
  },
];

export const ukTaxSubdivisionOptions = [
  { value: 'standard', label: 'England, Wales or Northern Ireland' },
  { value: 'scotland', label: 'Scotland' },
];

export const residencyStatusOptions = [
  { value: 'resident', label: 'Resident' },
  { value: 'non_resident', label: 'Non-resident' },
];

export const manualTaxModeOptions = [
  { value: 'none', label: 'No tax withholding' },
  { value: 'flat', label: 'Flat percentage' },
  { value: 'progressive', label: 'Progressive brackets' },
];

export const filingStatusOptions = [
  { value: 'single', label: 'Single' },
  { value: 'married_filing_jointly', label: 'Married filing jointly' },
  { value: 'married_filing_separately', label: 'Married filing separately' },
  { value: 'head_of_household', label: 'Head of household' },
];

export function isManualOnlyJurisdiction(code: string) {
  const option = payrollTaxJurisdictions.find((item) => item.code === code);
  return option?.mode === 'manual_only';
}
