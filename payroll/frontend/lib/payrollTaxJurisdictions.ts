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
    description: 'Published 2026/27 PAYE and National Insurance platform pack.',
  },
  {
    code: 'US',
    label: 'United States',
    mode: 'builtin',
    description: 'Published federal withholding and FICA platform pack. State and local companions remain separately configured.',
  },
  {
    code: 'NG',
    label: 'Nigeria',
    mode: 'builtin',
    description: 'Published Nigeria PAYE and pension platform pack.',
  },
  {
    code: 'GH',
    label: 'Ghana',
    mode: 'builtin',
    description: 'Published Ghana PAYE and SSNIT platform pack.',
  },
  {
    code: 'KE',
    label: 'Kenya',
    mode: 'builtin',
    description: 'Published Kenya PAYE and statutory-contribution platform pack.',
  },
  {
    code: 'ZA',
    label: 'South Africa',
    mode: 'builtin',
    description: 'Published South Africa PAYE, UIF and SDL platform pack.',
  },
  {
    code: 'CM',
    label: 'Cameroon',
    mode: 'builtin',
    description: 'Published Cameroon IRPP and statutory-contribution platform pack.',
  },
  {
    code: 'MZ',
    label: 'Mozambique',
    mode: 'builtin',
    description: 'Published Mozambique IRPS and INSS platform pack.',
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
