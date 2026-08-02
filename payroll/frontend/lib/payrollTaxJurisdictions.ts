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
    description: 'Uses current UK PAYE and National Insurance rules.',
  },
  {
    code: 'US',
    label: 'United States',
    mode: 'builtin',
    description: 'Uses federal withholding and FICA. State and local taxes stay manual.',
  },
  {
    code: 'NG',
    label: 'Nigeria',
    mode: 'builtin',
    description: 'Uses Nigeria PAYE with consolidated relief allowance, minimum-tax handling, and pension-led statutory setup.',
  },
  {
    code: 'GH',
    label: 'Ghana',
    mode: 'builtin',
    description: 'Uses Ghana PAYE and SSNIT employee contribution rules.',
  },
  {
    code: 'KE',
    label: 'Kenya',
    mode: 'builtin',
    description: 'Uses Kenya PAYE and resident personal relief.',
  },
  {
    code: 'ZA',
    label: 'South Africa',
    mode: 'builtin',
    description: 'Uses South Africa PAYE tables and age-based rebates.',
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
