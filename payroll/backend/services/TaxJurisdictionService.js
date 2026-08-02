const mongoose = require('mongoose');
const TaxJurisdictionConfig = require('../models/TaxJurisdictionConfig');
const formulaEngine = require('./FormulaEngine');

const PAY_PERIODS_PER_YEAR = {
  monthly: 12,
  'semi-monthly': 24,
  'bi-weekly': 26,
  weekly: 52,
};

const SOURCE_LINKS = Object.freeze({
  HMRC_2026: { label: 'HMRC 2026/27 rates and thresholds', url: 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027' },
  IRS_2026: { label: 'IRS Publication 15-T', url: 'https://www.irs.gov/publications/p15t' },
  NIGERIA_PITA: { label: 'Nigeria Personal Income Tax Act', url: 'https://old.firs.gov.ng/wp-content/uploads/2021/07/Personal-Income-Tax-Act.pdf' },
  GRA_PAYE: { label: 'Ghana Revenue Authority PAYE guidance', url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/' },
  KRA_PAYE: { label: 'Kenya Revenue Authority PAYE guidance', url: 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye' },
  SARS_2027: { label: 'SARS 2027 monthly PAYE deduction tables', url: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A03-Monthly-Tax-Deduction-Tables-2027-External-Annexure.pdf' },
});

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundRate(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 10000) / 10000;
}

function normalizeCode(value, fallback = '') {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  return normalized || fallback || '';
}

function normalizeDate(value, fallback = new Date()) {
  if ((value === null || value === undefined || value === '') && fallback === null) {
    return null;
  }
  const date = value ? new Date(value) : new Date(fallback);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }
  return fallback === null ? null : new Date(fallback);
}

function getPayPeriodsPerYear(payFrequency) {
  return PAY_PERIODS_PER_YEAR[String(payFrequency || 'monthly').trim()] || PAY_PERIODS_PER_YEAR.monthly;
}

function getPeriodAmount(annualAmount, periodsPerYear) {
  return roundMoney(toNumber(annualAmount) / Math.max(1, periodsPerYear));
}

function ageOnDate(dateOfBirth, referenceDate) {
  const dob = normalizeDate(dateOfBirth, null);
  if (!dob || Number.isNaN(dob.getTime())) return -1;

  const ref = normalizeDate(referenceDate);
  let age = ref.getFullYear() - dob.getFullYear();
  const monthDiff = ref.getMonth() - dob.getMonth();
  const dayDiff = ref.getDate() - dob.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : -1;
}

function calculateProgressiveTaxFromBands(amount, bands = []) {
  const taxable = Math.max(0, toNumber(amount));
  let total = 0;
  const components = [];

  for (const band of bands) {
    const min = Math.max(0, toNumber(band.min));
    const max = band.max === null || band.max === undefined ? Infinity : Math.max(min, toNumber(band.max));
    if (taxable <= min) {
      continue;
    }

    const taxableInBand = Math.min(taxable, max) - min;
    if (taxableInBand <= 0) {
      continue;
    }

    const amountInBand = roundMoney(taxableInBand * (toNumber(band.rate) / 100));
    total += amountInBand;
    components.push({
      min,
      max: Number.isFinite(max) ? max : null,
      rate: roundRate(band.rate),
      taxableAmount: roundMoney(taxableInBand),
      taxAmount: amountInBand,
    });
  }

  return {
    amount: roundMoney(total),
    components,
  };
}

function calculateBaseRateTax(amount, rows = []) {
  const annualAmount = Math.max(0, toNumber(amount));
  const row = rows.find((entry) => annualAmount >= toNumber(entry.min) && annualAmount < toNumber(entry.max, Infinity))
    || rows[rows.length - 1]
    || { min: 0, max: Infinity, baseTax: 0, rate: 0 };

  const excess = Math.max(0, annualAmount - toNumber(row.min));
  const tax = toNumber(row.baseTax) + (excess * (toNumber(row.rate) / 100));

  return {
    amount: roundMoney(tax),
    row: {
      min: toNumber(row.min),
      max: Number.isFinite(toNumber(row.max, Infinity)) ? toNumber(row.max) : null,
      baseTax: roundMoney(row.baseTax),
      rate: roundRate(row.rate),
    },
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildCountryName(code) {
  switch (normalizeCode(code)) {
    case 'GB': return 'United Kingdom';
    case 'US': return 'United States';
    case 'NG': return 'Nigeria';
    case 'GH': return 'Ghana';
    case 'KE': return 'Kenya';
    case 'ZA': return 'South Africa';
    case 'EU': return 'European Union member state';
    default: return 'Custom jurisdiction';
  }
}

function makeCurrencyField(key, label, helpText = '') {
  return {
    key,
    label,
    type: 'currency',
    defaultValue: 0,
    helpText,
  };
}

function makeSelectField(key, label, options = [], defaultValue = '') {
  return {
    key,
    label,
    type: 'select',
    required: true,
    defaultValue,
    options,
  };
}

function buildSeedDefinitions() {
  return [
    {
      countryCode: 'GB',
      countryName: 'United Kingdom',
      displayName: 'United Kingdom PAYE',
      description: 'Seeded UK PAYE and National Insurance rules for the 2026/27 tax year.',
      version: {
        label: '2026/27',
        effectiveFrom: new Date('2026-04-06T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.HMRC_2026],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeSelectField('taxSubdivision', 'UK Tax Region', [
            { value: 'standard', label: 'England, Wales or Northern Ireland' },
            { value: 'scotland', label: 'Scotland' },
          ], 'standard'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'uk_apr_6' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            personalAllowance: 'max(0, 12570 - floor(max(0, annualizedGrossPay - 100000) / 2))',
            additionalRateThreshold: 'max(37700, 125140 - personalAllowance)',
            scotlandTopThreshold: 'max(62430, 125140 - personalAllowance)',
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - personalAllowance)',
          bracketSetFormula: "if(employeeFields.taxSubdivision == 'scotland', 'scotland', 'standard')",
          bracketSets: {
            standard: [
              { min: 0, max: 37700, rate: 20 },
              { min: 37700, maxFormula: 'additionalRateThreshold', rate: 40 },
              { minFormula: 'additionalRateThreshold', max: null, rate: 45 },
            ],
            scotland: [
              { min: 0, max: 2827, rate: 19 },
              { min: 2827, max: 14921, rate: 20 },
              { min: 14921, max: 31092, rate: 21 },
              { min: 31092, max: 62430, rate: 42 },
              { min: 62430, maxFormula: 'scotlandTopThreshold', rate: 45 },
              { minFormula: 'scotlandTopThreshold', max: null, rate: 48 },
            ],
          },
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'annualizedGrossPay > 100000', text: 'Personal allowance taper was applied for earnings above GBP 100,000.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the UK PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'uk_ni',
            name: 'National Insurance',
            applyOptInField: 'socialSecurityOptIn',
          },
        ],
        testCases: [
          { name: 'UK standard seeded smoke test', inputs: { grossPay: 5000, taxableIncome: 5000, payFrequency: 'monthly', employeeTaxInputs: { taxSubdivision: 'standard', additionalWithholding: 0 } } },
        ],
      },
    },
    {
      countryCode: 'US',
      countryName: 'United States',
      displayName: 'United States Federal Withholding',
      description: 'Seeded US federal withholding and FICA rules based on IRS Publication 15-T.',
      version: {
        label: '2026',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.IRS_2026],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeSelectField('filingStatus', 'Filing Status', [
            { value: 'single', label: 'Single' },
            { value: 'married_filing_jointly', label: 'Married filing jointly' },
            { value: 'married_filing_separately', label: 'Married filing separately' },
            { value: 'head_of_household', label: 'Head of household' },
          ], 'single'),
          makeCurrencyField('otherIncome', 'Annual Other Income'),
          makeCurrencyField('deductionsAdjustment', 'Annual Deductions Adjustment'),
          makeCurrencyField('taxCredits', 'Annual Tax Credits'),
          {
            key: 'multipleJobs',
            label: 'Use Multiple Jobs Table',
            type: 'boolean',
            defaultValue: false,
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'base_plus_rate',
          derivedFormulas: {
            tableGroup: "if(employeeFields.multipleJobs, 'multipleJobs', 'standard')",
            standardDeductionOffset: "if(employeeFields.multipleJobs, 0, if(employeeFields.filingStatus == 'married_filing_jointly', 12900, 8600))",
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome + employeeFields.otherIncome - employeeFields.deductionsAdjustment - standardDeductionOffset)',
          tableGroupFormula: 'tableGroup',
          rowKeyFormula: 'employeeFields.filingStatus',
          annualTaxAfterFormula: 'max(0, annualBaseTax - employeeFields.taxCredits)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          tableSets: {
            standard: {
              married_filing_jointly: [
                { min: 0, max: 19300, baseTax: 0, rate: 0 },
                { min: 19300, max: 44100, baseTax: 0, rate: 10 },
                { min: 44100, max: 120100, baseTax: 2480, rate: 12 },
                { min: 120100, max: 230700, baseTax: 11600, rate: 22 },
                { min: 230700, max: 422850, baseTax: 35932, rate: 24 },
                { min: 422850, max: 531750, baseTax: 82048, rate: 32 },
                { min: 531750, max: 788000, baseTax: 116896, rate: 35 },
                { min: 788000, max: null, baseTax: 206583.5, rate: 37 },
              ],
              single: [
                { min: 0, max: 7500, baseTax: 0, rate: 0 },
                { min: 7500, max: 19900, baseTax: 0, rate: 10 },
                { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
                { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
                { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
                { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
                { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
                { min: 648100, max: null, baseTax: 192979.25, rate: 37 },
              ],
              married_filing_separately: [
                { min: 0, max: 7500, baseTax: 0, rate: 0 },
                { min: 7500, max: 19900, baseTax: 0, rate: 10 },
                { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
                { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
                { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
                { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
                { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
                { min: 648100, max: null, baseTax: 192979.25, rate: 37 },
              ],
              head_of_household: [
                { min: 0, max: 15550, baseTax: 0, rate: 0 },
                { min: 15550, max: 33250, baseTax: 0, rate: 10 },
                { min: 33250, max: 83000, baseTax: 1770, rate: 12 },
                { min: 83000, max: 121250, baseTax: 7740, rate: 22 },
                { min: 121250, max: 217300, baseTax: 16155, rate: 24 },
                { min: 217300, max: 271750, baseTax: 39207, rate: 32 },
                { min: 271750, max: 656150, baseTax: 56631, rate: 35 },
                { min: 656150, max: null, baseTax: 191171, rate: 37 },
              ],
            },
            multipleJobs: {
              married_filing_jointly: [
                { min: 0, max: 16100, baseTax: 0, rate: 0 },
                { min: 16100, max: 28500, baseTax: 0, rate: 10 },
                { min: 28500, max: 66500, baseTax: 1240, rate: 12 },
                { min: 66500, max: 121800, baseTax: 5800, rate: 22 },
                { min: 121800, max: 217875, baseTax: 17966, rate: 24 },
                { min: 217875, max: 272325, baseTax: 41024, rate: 32 },
                { min: 272325, max: 400450, baseTax: 58448, rate: 35 },
                { min: 400450, max: null, baseTax: 103291.75, rate: 37 },
              ],
              single: [
                { min: 0, max: 8050, baseTax: 0, rate: 0 },
                { min: 8050, max: 14250, baseTax: 0, rate: 10 },
                { min: 14250, max: 33250, baseTax: 620, rate: 12 },
                { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
                { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
                { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
                { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
                { min: 328350, max: null, baseTax: 96489.63, rate: 37 },
              ],
              married_filing_separately: [
                { min: 0, max: 8050, baseTax: 0, rate: 0 },
                { min: 8050, max: 14250, baseTax: 0, rate: 10 },
                { min: 14250, max: 33250, baseTax: 620, rate: 12 },
                { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
                { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
                { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
                { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
                { min: 328350, max: null, baseTax: 96489.63, rate: 37 },
              ],
              head_of_household: [
                { min: 0, max: 12075, baseTax: 0, rate: 0 },
                { min: 12075, max: 20925, baseTax: 0, rate: 10 },
                { min: 20925, max: 45800, baseTax: 885, rate: 12 },
                { min: 45800, max: 64925, baseTax: 3870, rate: 22 },
                { min: 64925, max: 112950, baseTax: 8077.5, rate: 24 },
                { min: 112950, max: 140175, baseTax: 19603.5, rate: 32 },
                { min: 140175, max: 332375, baseTax: 28315.5, rate: 35 },
                { min: 332375, max: null, baseTax: 95585.5, rate: 37 },
              ],
            },
          },
          noteRules: [
            { whenFormula: 'employeeFields.multipleJobs', text: 'IRS Step 2 multiple-jobs tables were used.' },
            { whenFormula: 'employeeFields.taxCredits > 0', text: 'Annual tax credits reduced the federal withholding amount.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after federal withholding.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'us_fica',
            name: 'FICA',
            applyOptInField: 'socialSecurityOptIn',
          },
        ],
      },
    },
    {
      countryCode: 'NG',
      countryName: 'Nigeria',
      displayName: 'Nigeria PAYE',
      description: 'Seeded Nigeria PAYE rules and CRA treatment.',
      version: {
        label: 'Default',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.NIGERIA_PITA],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            consolidatedReliefAllowance: 'max(200000, annualizedGrossPay * 0.01) + (annualizedGrossPay * 0.20)',
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - consolidatedReliefAllowance)',
          brackets: [
            { min: 0, max: 300000, rate: 7 },
            { min: 300000, max: 600000, rate: 11 },
            { min: 600000, max: 1100000, rate: 15 },
            { min: 1100000, max: 1600000, rate: 19 },
            { min: 1600000, max: 3200000, rate: 21 },
            { min: 3200000, max: null, rate: 24 },
          ],
          minimumTax: {
            whenFormula: 'annualizedGrossPay < 300000',
            annualTaxFormula: 'annualizedGrossPay * 0.01',
          },
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Nigeria PAYE calculation.' },
          ],
        },
        statutoryRules: [],
      },
    },
    {
      countryCode: 'GH',
      countryName: 'Ghana',
      displayName: 'Ghana PAYE',
      description: 'Seeded Ghana PAYE and SSNIT employee contribution rules.',
      version: {
        label: 'Default',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.GRA_PAYE],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeSelectField('residencyStatus', 'Residency Status', [
            { value: 'resident', label: 'Resident' },
            { value: 'non_resident', label: 'Non-resident' },
          ], 'resident'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'conditional',
          cases: [
            {
              whenFormula: "employeeFields.residencyStatus == 'non_resident'",
              strategyConfig: {
                strategy: 'flat_rate',
                taxableAnnualFormula: 'annualizedTaxableIncome',
                annualRateFormula: '25',
                annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
              },
            },
          ],
          defaultStrategyConfig: {
            strategy: 'progressive_bands',
            taxableAnnualFormula: 'annualizedTaxableIncome',
            brackets: [
              { min: 0, max: 5880, rate: 0 },
              { min: 5880, max: 7200, rate: 5 },
              { min: 7200, max: 8760, rate: 10 },
              { min: 8760, max: 46760, rate: 17.5 },
              { min: 46760, max: 238760, rate: 25 },
              { min: 238760, max: 605000, rate: 30 },
              { min: 605000, max: null, rate: 35 },
            ],
            annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
          },
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: "employeeFields.residencyStatus == 'non_resident'", text: 'Ghana non-resident employment income was taxed at the flat non-resident rate.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Ghana PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent',
            name: 'SSNIT Employee Contribution',
            applyOptInField: 'socialSecurityOptIn',
            rate: 5.5,
            baseFormula: 'basicSalary',
            reducesTaxableIncome: true,
          },
        ],
      },
    },
    {
      countryCode: 'KE',
      countryName: 'Kenya',
      displayName: 'Kenya PAYE',
      description: 'Seeded Kenya PAYE rules with resident personal relief.',
      version: {
        label: 'Default',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.KRA_PAYE],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeSelectField('residencyStatus', 'Residency Status', [
            { value: 'resident', label: 'Resident' },
            { value: 'non_resident', label: 'Non-resident' },
          ], 'resident'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            personalRelief: "if(employeeFields.residencyStatus == 'non_resident', 0, 28800)",
          },
          taxableAnnualFormula: 'annualizedTaxableIncome',
          brackets: [
            { min: 0, max: 288000, rate: 10 },
            { min: 288000, max: 388000, rate: 25 },
            { min: 388000, max: 6000000, rate: 30 },
            { min: 6000000, max: 9600000, rate: 32.5 },
            { min: 9600000, max: null, rate: 35 },
          ],
          annualTaxAfterFormula: 'max(0, annualTaxBeforeAdjustments - personalRelief)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: "employeeFields.residencyStatus != 'non_resident'", text: 'Kenya resident personal relief was applied.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Kenya PAYE calculation.' },
          ],
        },
        statutoryRules: [],
      },
    },
    {
      countryCode: 'ZA',
      countryName: 'South Africa',
      displayName: 'South Africa PAYE',
      description: 'Seeded South Africa PAYE rules and age-based rebates.',
      version: {
        label: '2027',
        effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.SARS_2027],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'south_africa_mar_1' },
        incomeTax: {
          strategy: 'base_plus_rate',
          derivedFormulas: {
            rebate: 'if(ageAtTaxYearEnd >= 75, 30834, if(ageAtTaxYearEnd >= 65, 27585, 17820))',
          },
          taxableAnnualFormula: 'annualizedTaxableIncome',
          tableSets: {
            default: {
              default: [
                { min: 0, max: 245100, baseTax: 0, rate: 18 },
                { min: 245100, max: 383100, baseTax: 44118, rate: 26 },
                { min: 383100, max: 530200, baseTax: 79998, rate: 31 },
                { min: 530200, max: 695800, baseTax: 125599, rate: 36 },
                { min: 695800, max: 887000, baseTax: 185215, rate: 39 },
                { min: 887000, max: 1878600, baseTax: 259783, rate: 41 },
                { min: 1878600, max: null, baseTax: 666339, rate: 45 },
              ],
            },
          },
          annualTaxAfterFormula: 'max(0, annualBaseTax - rebate)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'ageAtTaxYearEnd < 0', text: 'South Africa rebates were calculated using the primary rebate only because date of birth is missing.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the South Africa PAYE calculation.' },
          ],
        },
        statutoryRules: [],
      },
    },
    {
      countryCode: 'OTHER',
      countryName: 'Other / Custom jurisdiction',
      displayName: 'Custom Country Template',
      description: 'Blank template for unsupported countries. Clone this into an organization and configure formulas before using it.',
      version: {
        label: 'Template',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [],
        validationStatus: 'needs_review',
        fieldDefinitions: [
          {
            key: 'countryLabel',
            label: 'Country Label',
            type: 'text',
            required: true,
            defaultValue: '',
            placeholder: 'e.g. Rwanda Payroll',
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        constants: {
          requiresConfiguration: true,
        },
        incomeTax: {
          strategy: 'none',
          noteRules: [
            { whenFormula: 'true', text: 'This is a blank custom-country template and must be cloned and configured before it can calculate tax.' },
          ],
        },
        statutoryRules: [],
      },
    },
  ];
}

class TaxJurisdictionService {
  constructor() {
    this.seedDefinitions = buildSeedDefinitions();
  }

  buildTaxYearContext(version = {}, payDate = new Date()) {
    const date = normalizeDate(payDate);
    const mode = version?.taxYear?.mode || 'calendar';
    const year = date.getFullYear();

    if (mode === 'uk_apr_6') {
      const startYear = (date.getMonth() > 3 || (date.getMonth() === 3 && date.getDate() >= 6)) ? year : year - 1;
      const start = new Date(startYear, 3, 6);
      const end = new Date(startYear + 1, 3, 5, 23, 59, 59, 999);
      return {
        label: `${startYear}/${String(startYear + 1).slice(-2)}`,
        start,
        end,
        endReferenceDate: end,
      };
    }

    if (mode === 'south_africa_mar_1') {
      const startYear = (date.getMonth() > 1 || (date.getMonth() === 1 && date.getDate() >= 1)) ? year : year - 1;
      const start = new Date(startYear, 2, 1);
      const end = new Date(startYear + 1, 1, 28, 23, 59, 59, 999);
      return {
        label: `${startYear + 1}`,
        start,
        end,
        endReferenceDate: end,
      };
    }

    return {
      label: `${year}`,
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
      endReferenceDate: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  buildFormulaContext(payload = {}, version = {}) {
    const payDate = normalizeDate(payload.paymentDate);
    const periodsPerYear = getPayPeriodsPerYear(payload.payFrequency);
    const taxYear = this.buildTaxYearContext(version, payDate);
    const ageAtTaxYearEnd = ageOnDate(payload.employeeInfo?.dateOfBirth, taxYear.endReferenceDate);

    return {
      grossPay: roundMoney(payload.grossPay),
      taxableIncome: roundMoney(payload.taxableIncome),
      basicSalary: roundMoney(payload.basicSalary),
      preTaxDeductions: roundMoney(payload.preTaxDeductions),
      ytdGrossPay: roundMoney(payload.ytdGrossPay),
      ytdTaxableIncome: roundMoney(payload.ytdTaxableIncome),
      periodsPerYear,
      annualizedGrossPay: roundMoney(payload.grossPay * periodsPerYear),
      annualizedTaxableIncome: roundMoney(payload.taxableIncome * periodsPerYear),
      employeeFields: payload.employeeTaxInputs || {},
      employeeInfo: payload.employeeInfo || {},
      statutoryContributions: payload.statutoryContributions || {},
      constants: version.constants || {},
      payDate,
      taxYear,
      ageAtTaxYearEnd,
      validationErrors: payload.validationErrors || [],
    };
  }

  applyDerivedFormulas(target = {}, derivedFormulas = {}) {
    const nextTarget = target;
    for (const [key, formula] of Object.entries(derivedFormulas || {})) {
      nextTarget[key] = formulaEngine.evaluate(formula, nextTarget);
    }
    return nextTarget;
  }

  normalizeFieldValue(field, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return field?.defaultValue !== undefined ? field.defaultValue : (field?.type === 'boolean' ? false : '');
    }

    switch (field?.type) {
      case 'currency':
      case 'percent':
        return roundMoney(rawValue);
      case 'integer':
        return Math.max(0, Math.floor(toNumber(rawValue)));
      case 'boolean':
        return !!rawValue;
      case 'date':
        return rawValue ? new Date(rawValue).toISOString().slice(0, 10) : '';
      default:
        return rawValue;
    }
  }

  normalizeEmployeeTaxInputs(fieldDefinitions = [], rawInputs = {}) {
    const normalized = {};
    const validationErrors = [];

    for (const field of fieldDefinitions || []) {
      const nextValue = this.normalizeFieldValue(field, rawInputs?.[field.key]);
      normalized[field.key] = nextValue;

      const emptyValue = nextValue === '' || nextValue === null || nextValue === undefined;
      if (field.required && (emptyValue || (field.type === 'select' && !String(nextValue || '').trim()))) {
        validationErrors.push(`"${field.label}" is required.`);
      }
    }

    return { normalized, validationErrors };
  }

  mapLegacyInputs(fieldDefinitions = [], taxConfig = {}) {
    const legacyInputs = {
      ...((taxConfig && typeof taxConfig.employeeTaxInputs === 'object') ? taxConfig.employeeTaxInputs : {}),
    };

    for (const field of fieldDefinitions || []) {
      if (legacyInputs[field.key] !== undefined) {
        continue;
      }
      if (taxConfig[field.key] !== undefined) {
        legacyInputs[field.key] = taxConfig[field.key];
      }
    }

    return legacyInputs;
  }

  findVersion(config, versionId = null, payDate = new Date()) {
    const versions = Array.isArray(config?.versions) ? config.versions : [];
    if (versionId) {
      const explicitVersion = versions.find((version) => String(version._id) === String(versionId));
      if (explicitVersion) {
        return explicitVersion;
      }
    }

    const publishedVersion = config?.getPublishedVersion?.() || versions.find((version) => String(version._id) === String(config?.publishedVersionId));
    if (publishedVersion) {
      const effectiveFrom = normalizeDate(publishedVersion.effectiveFrom, null);
      const effectiveTo = normalizeDate(publishedVersion.effectiveTo, null);
      const normalizedPayDate = normalizeDate(payDate);
      if ((!effectiveFrom || normalizedPayDate >= effectiveFrom) && (!effectiveTo || normalizedPayDate <= effectiveTo)) {
        return publishedVersion;
      }
    }

    return publishedVersion || versions[versions.length - 1] || null;
  }

  async seedGlobalDefaults() {
    for (const seed of this.seedDefinitions) {
      const existing = await TaxJurisdictionConfig.findOne({
        scope: 'global',
        organizationId: '',
        countryCode: seed.countryCode,
        displayName: seed.displayName,
      });

      if (existing) {
        continue;
      }

      const versionId = new mongoose.Types.ObjectId();
      await TaxJurisdictionConfig.create({
        scope: 'global',
        organizationId: '',
        countryCode: seed.countryCode,
        countryName: seed.countryName,
        displayName: seed.displayName,
        description: seed.description,
        status: 'active',
        publishedVersionId: versionId,
        versions: [{
          _id: versionId,
          label: seed.version.label,
          versionNumber: 1,
          status: 'published',
          effectiveFrom: seed.version.effectiveFrom,
          effectiveTo: seed.version.effectiveTo || null,
          sourceDate: seed.version.sourceDate || null,
          sourceLinks: seed.version.sourceLinks || [],
          notes: seed.version.notes || [],
          validationStatus: seed.version.validationStatus || 'validated',
          fieldDefinitions: seed.version.fieldDefinitions || [],
          taxYear: seed.version.taxYear || { mode: 'calendar' },
          constants: seed.version.constants || {},
          incomeTax: seed.version.incomeTax || {},
          statutoryRules: seed.version.statutoryRules || [],
          testCases: seed.version.testCases || [],
        }],
        createdBy: {
          userId: 'system',
          name: 'Tax seed',
        },
        lastModifiedBy: {
          userId: 'system',
          name: 'Tax seed',
        },
      });
    }
  }

  async listJurisdictions(organizationId, options = {}) {
    const includeGlobal = options.includeGlobal !== false;
    const query = {
      status: { $ne: 'archived' },
    };

    if (includeGlobal) {
      query.$or = [
        { scope: 'global', organizationId: '' },
        { scope: 'organization', organizationId },
      ];
    } else {
      query.scope = 'organization';
      query.organizationId = organizationId;
    }

    const rows = await TaxJurisdictionConfig.find(query).sort({
      scope: 1,
      countryName: 1,
      displayName: 1,
    });

    return rows.map((row) => row.toSummary());
  }

  async getJurisdictionById(id, organizationId) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      $or: [
        { scope: 'global', organizationId: '' },
        { scope: 'organization', organizationId },
      ],
    });

    if (!row) {
      return null;
    }

    return row;
  }

  buildVersionPayload(currentCount = 0, payload = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      label: String(payload.label || `Version ${currentCount + 1}`).trim(),
      versionNumber: Math.max(1, currentCount + 1),
      status: 'draft',
      effectiveFrom: payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date(),
      effectiveTo: payload.effectiveTo ? new Date(payload.effectiveTo) : null,
      sourceDate: payload.sourceDate ? new Date(payload.sourceDate) : null,
      sourceLinks: Array.isArray(payload.sourceLinks) ? payload.sourceLinks : [],
      notes: Array.isArray(payload.notes) ? payload.notes : [],
      validationStatus: payload.validationStatus || 'draft',
      fieldDefinitions: Array.isArray(payload.fieldDefinitions) ? payload.fieldDefinitions : [],
      taxYear: payload.taxYear || { mode: 'calendar' },
      constants: payload.constants || {},
      incomeTax: payload.incomeTax || {},
      statutoryRules: Array.isArray(payload.statutoryRules) ? payload.statutoryRules : [],
      testCases: Array.isArray(payload.testCases) ? payload.testCases : [],
    };
  }

  async createJurisdiction(organizationId, payload = {}, actor = {}) {
    if (payload.cloneFromId) {
      const source = await this.getJurisdictionById(payload.cloneFromId, organizationId);
      if (!source) {
        throw new Error('Clone source was not found');
      }

      const clonedVersions = (source.versions || []).map((version, index) => ({
        ...(version.toObject ? version.toObject() : version),
        _id: new mongoose.Types.ObjectId(),
        status: index === (source.versions || []).length - 1 ? 'draft' : version.status,
      }));

      const publishedVersion = clonedVersions.find((version, index) => {
        const sourceVersion = source.versions?.[index];
        return String(sourceVersion?._id) === String(source.publishedVersionId);
      }) || null;

      return TaxJurisdictionConfig.create({
        scope: 'organization',
        organizationId,
        countryCode: normalizeCode(payload.countryCode || source.countryCode || 'OTHER'),
        countryName: String(payload.countryName || source.countryName || buildCountryName(payload.countryCode)).trim(),
        displayName: String(payload.displayName || `${source.displayName} Override`).trim(),
        description: String(payload.description || source.description || '').trim(),
        status: 'active',
        clonedFromId: source._id,
        publishedVersionId: publishedVersion?._id || null,
        versions: clonedVersions,
        createdBy: {
          userId: actor.userId || '',
          name: actor.name || '',
        },
        lastModifiedBy: {
          userId: actor.userId || '',
          name: actor.name || '',
        },
      });
    }

    const version = this.buildVersionPayload(0, payload.version || {});
    return TaxJurisdictionConfig.create({
      scope: 'organization',
      organizationId,
      countryCode: normalizeCode(payload.countryCode || 'OTHER'),
      countryName: String(payload.countryName || buildCountryName(payload.countryCode || 'OTHER')).trim(),
      displayName: String(payload.displayName || payload.countryName || 'Custom Tax Jurisdiction').trim(),
      description: String(payload.description || '').trim(),
      status: 'draft',
      versions: [version],
      createdBy: {
        userId: actor.userId || '',
        name: actor.name || '',
      },
      lastModifiedBy: {
        userId: actor.userId || '',
        name: actor.name || '',
      },
    });
  }

  async updateJurisdiction(id, organizationId, payload = {}, actor = {}) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    if (payload.countryCode !== undefined) row.countryCode = normalizeCode(payload.countryCode, row.countryCode);
    if (payload.countryName !== undefined) row.countryName = String(payload.countryName || '').trim() || row.countryName;
    if (payload.displayName !== undefined) row.displayName = String(payload.displayName || '').trim() || row.displayName;
    if (payload.description !== undefined) row.description = String(payload.description || '').trim();
    if (payload.status !== undefined) row.status = payload.status;

    if (payload.version && payload.versionId) {
      const version = row.versions.find((entry) => String(entry._id) === String(payload.versionId));
      if (!version) {
        throw new Error('Version was not found');
      }

      if (payload.version.label !== undefined) version.label = String(payload.version.label || '').trim() || version.label;
      if (payload.version.effectiveFrom !== undefined) version.effectiveFrom = payload.version.effectiveFrom ? new Date(payload.version.effectiveFrom) : version.effectiveFrom;
      if (payload.version.effectiveTo !== undefined) version.effectiveTo = payload.version.effectiveTo ? new Date(payload.version.effectiveTo) : null;
      if (payload.version.sourceDate !== undefined) version.sourceDate = payload.version.sourceDate ? new Date(payload.version.sourceDate) : null;
      if (payload.version.validationStatus !== undefined) version.validationStatus = payload.version.validationStatus;
      if (payload.version.sourceLinks !== undefined) version.sourceLinks = Array.isArray(payload.version.sourceLinks) ? payload.version.sourceLinks : [];
      if (payload.version.notes !== undefined) version.notes = Array.isArray(payload.version.notes) ? payload.version.notes : [];
      if (payload.version.fieldDefinitions !== undefined) version.fieldDefinitions = Array.isArray(payload.version.fieldDefinitions) ? payload.version.fieldDefinitions : [];
      if (payload.version.taxYear !== undefined) version.taxYear = payload.version.taxYear || { mode: 'calendar' };
      if (payload.version.constants !== undefined) version.constants = payload.version.constants || {};
      if (payload.version.incomeTax !== undefined) version.incomeTax = payload.version.incomeTax || {};
      if (payload.version.statutoryRules !== undefined) version.statutoryRules = Array.isArray(payload.version.statutoryRules) ? payload.version.statutoryRules : [];
      if (payload.version.testCases !== undefined) version.testCases = Array.isArray(payload.version.testCases) ? payload.version.testCases : [];
    }

    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return row;
  }

  async createVersion(id, organizationId, payload = {}, actor = {}) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    const version = this.buildVersionPayload(row.versions.length, payload);
    row.versions.push(version);
    row.status = 'active';
    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return version;
  }

  async publishVersion(id, versionId, organizationId, actor = {}) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    const version = row.versions.find((entry) => String(entry._id) === String(versionId));
    if (!version) {
      throw new Error('Version was not found');
    }

    version.status = 'published';
    row.publishedVersionId = version._id;
    row.status = 'active';
    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return row;
  }

  async findGlobalByCountryCode(countryCode) {
    return TaxJurisdictionConfig.findOne({
      scope: 'global',
      organizationId: '',
      countryCode: normalizeCode(countryCode),
      status: { $ne: 'archived' },
    });
  }

  async importLegacyManualConfig(organizationId, taxConfig = {}) {
    const fingerprint = stableStringify({
      jurisdictionCode: normalizeCode(taxConfig.jurisdictionCode || 'OTHER'),
      jurisdictionName: String(taxConfig.jurisdictionName || '').trim(),
      calculationMode: taxConfig.calculationMode || 'manual',
      manualCalculationType: taxConfig.manualCalculationType || 'progressive',
      manualTaxFreeAllowance: roundMoney(taxConfig.manualTaxFreeAllowance || 0),
      flatTaxRate: roundMoney(taxConfig.flatTaxRate || 0),
      additionalWithholding: roundMoney(taxConfig.additionalWithholding || 0),
      customBrackets: Array.isArray(taxConfig.customBrackets)
        ? taxConfig.customBrackets.map((bracket) => ({
          min: roundMoney(bracket.min || 0),
          max: bracket.max === null || bracket.max === undefined ? null : roundMoney(bracket.max),
          rate: roundMoney(bracket.rate || 0),
        }))
        : [],
      socialSecurityRate: roundMoney(taxConfig.socialSecurityRate || 0),
      socialSecurityCap: roundMoney(taxConfig.socialSecurityCap || 0),
    });

    const rows = await TaxJurisdictionConfig.find({
      scope: 'organization',
      organizationId,
      countryCode: normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER'),
      status: { $ne: 'archived' },
    });
    const existing = rows.find((row) => String(row.description || '').endsWith(`Legacy fingerprint: ${fingerprint}`));
    if (existing) {
      return existing;
    }

    const countryCode = normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER');
    const displayName = taxConfig.jurisdictionName
      ? `Imported ${taxConfig.jurisdictionName} Rule`
      : `Imported ${countryCode} Legacy Rule`;
    const versionId = new mongoose.Types.ObjectId();
    const strategy = taxConfig.manualCalculationType === 'flat'
      ? {
        strategy: 'flat_rate',
        taxableAnnualFormula: 'max(0, annualizedTaxableIncome - employeeFields.manualTaxFreeAllowance)',
        annualRateFormula: 'employeeFields.flatTaxRate',
        annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
      }
      : taxConfig.manualCalculationType === 'none'
        ? { strategy: 'none' }
        : {
          strategy: 'progressive_bands',
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - employeeFields.manualTaxFreeAllowance)',
          brackets: Array.isArray(taxConfig.customBrackets)
            ? taxConfig.customBrackets.map((bracket) => ({
              min: roundMoney(bracket.min || 0),
              max: bracket.max === null || bracket.max === undefined ? null : roundMoney(bracket.max),
              rate: roundMoney(bracket.rate || 0),
            }))
            : [],
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
        };

    return TaxJurisdictionConfig.create({
      scope: 'organization',
      organizationId,
      countryCode,
      countryName: String(taxConfig.jurisdictionName || buildCountryName(countryCode)).trim(),
      displayName,
      description: `Imported from legacy employee tax configuration. Legacy fingerprint: ${fingerprint}`,
      status: 'active',
      publishedVersionId: versionId,
      versions: [{
        _id: versionId,
        label: 'Imported Legacy Rule',
        versionNumber: 1,
        status: 'published',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        sourceDate: new Date(),
        sourceLinks: [],
        notes: ['Imported automatically from legacy employee tax settings.'],
        validationStatus: 'validated',
        fieldDefinitions: [
          makeCurrencyField('manualTaxFreeAllowance', 'Manual Tax-Free Allowance'),
          makeCurrencyField('flatTaxRate', 'Flat Tax Rate'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        constants: {
          importedFromLegacy: true,
        },
        incomeTax: {
          ...strategy,
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
        },
        statutoryRules: taxConfig.socialSecurityRate > 0 ? [{
          strategy: 'flat_percent',
          name: 'Social Security',
          rate: roundMoney(taxConfig.socialSecurityRate || 0),
          capFormula: toNumber(taxConfig.socialSecurityCap || 0) > 0 ? String(roundMoney(taxConfig.socialSecurityCap || 0)) : '',
          baseFormula: 'grossPay',
          reducesTaxableIncome: false,
        }] : [],
        testCases: [],
      }],
      createdBy: {
        userId: 'system',
        name: 'Legacy migration',
      },
      lastModifiedBy: {
        userId: 'system',
        name: 'Legacy migration',
      },
    });
  }

  async resolveJurisdictionConfig(input = {}) {
    const organizationId = String(input.organizationId || '').trim();
    const taxConfig = input.taxConfig || {};
    if (input.versionDefinition) {
      const version = input.versionDefinition;
      const fallbackConfig = input.configDefinition || {
        _id: taxConfig.jurisdictionConfigId || null,
        countryCode: normalizeCode(taxConfig.jurisdictionCode || input.configDefinition?.countryCode || 'OTHER', 'OTHER'),
        countryName: String(taxConfig.jurisdictionName || input.configDefinition?.countryName || buildCountryName(taxConfig.jurisdictionCode || 'OTHER')).trim(),
        displayName: String(input.configDefinition?.displayName || taxConfig.jurisdictionName || buildCountryName(taxConfig.jurisdictionCode || 'OTHER')).trim(),
      };
      const legacyInputs = this.mapLegacyInputs(version.fieldDefinitions || [], taxConfig);
      const { normalized, validationErrors } = this.normalizeEmployeeTaxInputs(version.fieldDefinitions || [], legacyInputs);
      return {
        config: fallbackConfig,
        version,
        employeeTaxInputs: normalized,
        validationErrors,
      };
    }

    const requestedConfigId = taxConfig.jurisdictionConfigId || taxConfig.configId;
    const requestedVersionId = taxConfig.jurisdictionVersionId || taxConfig.versionId;

    let config = null;
    if (requestedConfigId) {
      config = await this.getJurisdictionById(requestedConfigId, organizationId);
    }

    if (!config) {
      const countryCode = normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER');
      if (['GB', 'US', 'NG', 'GH', 'KE', 'ZA'].includes(countryCode)) {
        config = await this.findGlobalByCountryCode(countryCode);
      } else if (organizationId) {
        config = await this.importLegacyManualConfig(organizationId, taxConfig);
      } else {
        config = await this.findGlobalByCountryCode('OTHER');
      }
    }

    if (!config) {
      return { config: null, version: null, validationErrors: ['No tax jurisdiction configuration was found.'] };
    }

    const version = this.findVersion(config, requestedVersionId, input.paymentDate);
    if (!version) {
      return { config, version: null, validationErrors: ['The selected tax jurisdiction has no published rule version.'] };
    }

    const legacyInputs = this.mapLegacyInputs(version.fieldDefinitions || [], taxConfig);
    const { normalized, validationErrors } = this.normalizeEmployeeTaxInputs(version.fieldDefinitions || [], legacyInputs);

    return {
      config,
      version,
      employeeTaxInputs: normalized,
      validationErrors,
    };
  }

  resolveBands(rawBands = [], context = {}) {
    return (Array.isArray(rawBands) ? rawBands : []).map((band) => ({
      min: band.minFormula ? formulaEngine.evaluate(band.minFormula, context) : toNumber(band.min),
      max: band.maxFormula ? formulaEngine.evaluate(band.maxFormula, context) : (band.max === null || band.max === undefined ? null : toNumber(band.max)),
      rate: toNumber(band.rate),
    }));
  }

  buildNoteList(noteRules = [], context = {}) {
    const notes = [];
    for (const rule of noteRules || []) {
      try {
        if (!rule.whenFormula || formulaEngine.evaluate(rule.whenFormula, context)) {
          notes.push(rule.text);
        }
      } catch (error) {
        // Ignore note formula failures in favor of the main validation path.
      }
    }
    return notes;
  }

  evaluateIncomeTaxStrategy(strategyConfig = {}, context = {}, meta = {}) {
    const strategy = strategyConfig.strategy || 'none';

    if (strategy === 'none') {
      return {
        taxAmount: 0,
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: 0,
        notes: [],
        details: { method: 'none' },
        method: 'none',
      };
    }

    if (strategy === 'flat_rate') {
      const annualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
      context.taxableAnnualBase = annualBase;
      const annualRate = toNumber(formulaEngine.evaluate(strategyConfig.annualRateFormula || '0', context));
      const annualTaxBeforeAdjustments = roundMoney(annualBase * (annualRate / 100));
      context.annualTaxBeforeAdjustments = annualTaxBeforeAdjustments;
      const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualTaxBeforeAdjustments', context)));
      context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

      return {
        taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(annualBase),
        notes: [],
        details: {
          method: 'flat_rate',
          rate: roundRate(annualRate),
          annualTaxBeforeAdjustments,
          annualTaxAfterAdjustments,
        },
        method: 'flat_rate',
      };
    }

    if (strategy === 'base_plus_rate') {
      this.applyDerivedFormulas(context, strategyConfig.derivedFormulas);
      const taxableAnnualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
      context.taxableAnnualBase = taxableAnnualBase;
      const tableGroup = String(formulaEngine.evaluate(strategyConfig.tableGroupFormula || "'default'", context) || 'default');
      const rowKey = String(formulaEngine.evaluate(strategyConfig.rowKeyFormula || "'default'", context) || 'default');
      const rows = strategyConfig.tableSets?.[tableGroup]?.[rowKey]
        || strategyConfig.tableSets?.[tableGroup]?.default
        || strategyConfig.tableSets?.default?.[rowKey]
        || strategyConfig.tableSets?.default?.default
        || [];
      const annualBaseTax = calculateBaseRateTax(taxableAnnualBase, rows);
      context.annualBaseTax = annualBaseTax.amount;
      context.baseTaxRow = annualBaseTax.row;
      const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualBaseTax', context)));
      context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

      return {
        taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(taxableAnnualBase),
        notes: [],
        details: {
          method: 'base_plus_rate',
          annualTaxBeforeAdjustments: roundMoney(annualBaseTax.amount),
          annualTaxAfterAdjustments: roundMoney(annualTaxAfterAdjustments),
          row: annualBaseTax.row,
          tableGroup,
          rowKey,
        },
        method: meta.defaultMethod || 'base_plus_rate',
      };
    }

    if (strategy === 'conditional') {
      const cases = Array.isArray(strategyConfig.cases) ? strategyConfig.cases : [];
      for (const caseConfig of cases) {
        if (formulaEngine.evaluate(caseConfig.whenFormula || 'false', context)) {
          return this.evaluateIncomeTaxStrategy(caseConfig.strategyConfig || {}, context, meta);
        }
      }

      return this.evaluateIncomeTaxStrategy(strategyConfig.defaultStrategyConfig || { strategy: 'none' }, context, meta);
    }

    this.applyDerivedFormulas(context, strategyConfig.derivedFormulas);
    const taxableAnnualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
    context.taxableAnnualBase = taxableAnnualBase;
    const bracketSetKey = strategyConfig.bracketSetFormula
      ? String(formulaEngine.evaluate(strategyConfig.bracketSetFormula, context) || 'default')
      : 'default';
    const rawBands = strategyConfig.bracketSets?.[bracketSetKey] || strategyConfig.brackets || [];
    const bands = this.resolveBands(rawBands, context);
    const bracketTax = calculateProgressiveTaxFromBands(taxableAnnualBase, bands);
    context.bracketTax = bracketTax.amount;
    context.annualTaxBeforeAdjustments = bracketTax.amount;

    if (strategyConfig.minimumTax?.whenFormula && formulaEngine.evaluate(strategyConfig.minimumTax.whenFormula, context)) {
      const minimumTax = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.minimumTax.annualTaxFormula || '0', context)));
      if (minimumTax > context.annualTaxBeforeAdjustments) {
        context.annualTaxBeforeAdjustments = minimumTax;
      }
    }

    const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualTaxBeforeAdjustments', context)));
    context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

    return {
      taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
      annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
      taxableIncomeAfterReliefs: roundMoney(taxableAnnualBase),
      notes: [],
      details: {
        method: bracketSetKey !== 'default' ? `progressive_${bracketSetKey}` : 'progressive_bands',
        annualTaxBeforeAdjustments: roundMoney(context.annualTaxBeforeAdjustments),
        annualTaxAfterAdjustments: roundMoney(annualTaxAfterAdjustments),
        bracketBreakdown: bracketTax.components,
      },
      method: meta.defaultMethod || (bracketSetKey !== 'default' ? `progressive_${bracketSetKey}` : 'progressive_bands'),
    };
  }

  evaluateStatutoryRules(rules = [], context = {}) {
    const components = [];
    let totalAmount = 0;
    let reducesTaxableIncome = 0;

    for (const rule of rules || []) {
      if (rule.applyOptInField && context.statutoryContributions?.[rule.applyOptInField] === false) {
        continue;
      }

      if (rule.strategy === 'flat_percent') {
        const rate = rule.rate !== undefined ? toNumber(rule.rate) : toNumber(formulaEngine.evaluate(rule.rateFormula || '0', context));
        const cap = rule.capFormula ? Math.max(0, toNumber(formulaEngine.evaluate(rule.capFormula, context))) : 0;
        const baseAmount = Math.max(0, toNumber(formulaEngine.evaluate(rule.baseFormula || 'grossPay', context)));
        const ytdAmount = Math.max(0, toNumber(context.ytdGrossPay));
        let taxableAmount = baseAmount;
        let hitCap = false;

        if (cap > 0) {
          if (ytdAmount >= cap) {
            taxableAmount = 0;
            hitCap = true;
          } else if (ytdAmount + taxableAmount > cap) {
            taxableAmount = Math.max(0, cap - ytdAmount);
            hitCap = true;
          }
        }

        const amount = roundMoney(taxableAmount * (rate / 100));
        if (amount <= 0) {
          continue;
        }

        totalAmount = roundMoney(totalAmount + amount);
        if (rule.reducesTaxableIncome) {
          reducesTaxableIncome = roundMoney(reducesTaxableIncome + amount);
        }

        components.push({
          type: 'social_security',
          name: rule.name || 'Statutory Contribution',
          amount,
          rate: roundRate(rate),
          taxableAmount: roundMoney(taxableAmount),
          cap: cap || null,
          hitCap,
          reducesTaxableIncome: !!rule.reducesTaxableIncome,
          source: 'seeded_rule',
        });
        continue;
      }

      if (rule.strategy === 'uk_ni') {
        const earnings = Math.max(0, toNumber(context.grossPay));
        const primaryThreshold = 12570 / context.periodsPerYear;
        const upperEarningsLimit = 50270 / context.periodsPerYear;
        const firstBand = Math.max(0, Math.min(earnings, upperEarningsLimit) - primaryThreshold);
        const secondBand = Math.max(0, earnings - upperEarningsLimit);
        const amount = roundMoney((firstBand * 0.08) + (secondBand * 0.02));
        if (amount > 0) {
          totalAmount = roundMoney(totalAmount + amount);
          components.push({
            type: 'social_security',
            name: rule.name || 'National Insurance',
            amount,
            taxableAmount: roundMoney(earnings),
            thresholds: {
              primaryThreshold: roundMoney(primaryThreshold),
              upperEarningsLimit: roundMoney(upperEarningsLimit),
            },
            source: 'seeded_rule',
          });
        }
        continue;
      }

      if (rule.strategy === 'us_fica') {
        const earnings = Math.max(0, toNumber(context.grossPay));
        const ytdGrossPay = Math.max(0, toNumber(context.ytdGrossPay));
        const socialSecurityWageBase = 184500;
        const additionalMedicareThreshold = 200000;
        const remainingSocialSecurityBase = Math.max(0, socialSecurityWageBase - ytdGrossPay);
        const socialSecurityTaxable = Math.min(earnings, remainingSocialSecurityBase);
        const medicareTaxable = earnings;
        const additionalMedicareTaxable = Math.max(0, (ytdGrossPay + earnings) - additionalMedicareThreshold)
          - Math.max(0, ytdGrossPay - additionalMedicareThreshold);

        const socialSecurityAmount = roundMoney(socialSecurityTaxable * 0.062);
        const medicareAmount = roundMoney(medicareTaxable * 0.0145);
        const additionalMedicareAmount = roundMoney(Math.max(0, additionalMedicareTaxable) * 0.009);

        if (socialSecurityAmount > 0) {
          components.push({
            type: 'social_security',
            name: 'Social Security',
            amount: socialSecurityAmount,
            taxableAmount: roundMoney(socialSecurityTaxable),
            cap: socialSecurityWageBase,
            source: 'seeded_rule',
          });
        }
        if (medicareAmount > 0) {
          components.push({
            type: 'social_security',
            name: 'Medicare',
            amount: medicareAmount,
            taxableAmount: roundMoney(medicareTaxable),
            source: 'seeded_rule',
          });
        }
        if (additionalMedicareAmount > 0) {
          components.push({
            type: 'social_security',
            name: 'Additional Medicare',
            amount: additionalMedicareAmount,
            taxableAmount: roundMoney(additionalMedicareTaxable),
            threshold: additionalMedicareThreshold,
            source: 'seeded_rule',
          });
        }

        totalAmount = roundMoney(totalAmount + socialSecurityAmount + medicareAmount + additionalMedicareAmount);
      }
    }

    return {
      totalAmount,
      reducesTaxableIncome,
      components,
    };
  }

  async calculate(payload = {}) {
    const resolved = await this.resolveJurisdictionConfig(payload);
    const validationErrors = [...(resolved.validationErrors || [])];

    if (!resolved.config || !resolved.version) {
      return {
        jurisdictionConfig: resolved.config,
        jurisdictionVersion: resolved.version,
        validationErrors,
        incomeTax: {
          taxAmount: 0,
          details: {},
          notes: [],
          method: 'unconfigured',
        },
        statutoryContributions: {
          totalAmount: 0,
          reducesTaxableIncome: 0,
          components: [],
        },
      };
    }

    const context = this.buildFormulaContext({
      ...payload,
      employeeTaxInputs: resolved.employeeTaxInputs || {},
      validationErrors,
    }, resolved.version);

    this.applyDerivedFormulas(context, resolved.version.incomeTax?.derivedFormulas);
    const statutoryResult = this.evaluateStatutoryRules(resolved.version.statutoryRules || [], context);
    context.statutoryReducesTaxableIncome = statutoryResult.reducesTaxableIncome;
    context.taxableIncomeAfterStatutory = roundMoney(Math.max(0, context.taxableIncome - statutoryResult.reducesTaxableIncome));
    context.annualizedTaxableIncome = roundMoney(context.taxableIncomeAfterStatutory * context.periodsPerYear);

    const incomeTaxResult = this.evaluateIncomeTaxStrategy(resolved.version.incomeTax || { strategy: 'none' }, context, {
      defaultMethod: normalizeCode(resolved.config.countryCode) === 'US'
        ? 'us_federal_withholding'
        : normalizeCode(resolved.config.countryCode) === 'ZA'
          ? 'south_africa_paye'
          : normalizeCode(resolved.config.countryCode) === 'NG'
            ? 'nigeria_paye'
            : normalizeCode(resolved.config.countryCode) === 'GH'
              ? 'ghana_paye'
              : normalizeCode(resolved.config.countryCode) === 'KE'
                ? 'kenya_paye'
                : normalizeCode(resolved.config.countryCode) === 'GB'
                  ? (context.employeeFields.taxSubdivision === 'scotland' ? 'uk_scotland_paye' : 'uk_paye')
                  : 'configured_rule',
    });

    const additionalWithholding = roundMoney(toNumber(formulaEngine.evaluate(resolved.version.incomeTax?.additionalWithholdingFormula || '0', context)));
    const totalTaxAmount = roundMoney(incomeTaxResult.taxAmount + additionalWithholding);
    const notes = [
      ...this.buildNoteList(resolved.version.incomeTax?.noteRules, context),
      ...incomeTaxResult.notes,
    ];

    if (resolved.version.constants?.requiresConfiguration) {
      validationErrors.push('This jurisdiction is a blank template and must be cloned and configured before it can be used for payroll tax calculations.');
    }

    return {
      jurisdictionConfig: resolved.config,
      jurisdictionVersion: resolved.version,
      employeeTaxInputs: resolved.employeeTaxInputs || {},
      validationErrors,
      taxYear: context.taxYear,
      incomeTax: {
        taxAmount: totalTaxAmount,
        grossTaxableIncome: roundMoney(context.taxableIncome + context.preTaxDeductions),
        taxExemptIncome: roundMoney(statutoryResult.reducesTaxableIncome),
        deductionsBeforeTax: roundMoney(context.preTaxDeductions),
        netTaxableIncome: roundMoney(incomeTaxResult.taxableIncomeAfterReliefs),
        taxRate: context.taxableIncome > 0 ? roundRate((totalTaxAmount / context.taxableIncome) * 100) : 0,
        annualizedIncome: roundMoney(context.annualizedGrossPay),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(incomeTaxResult.taxableIncomeAfterReliefs),
        taxYearLabel: context.taxYear.label,
        jurisdictionCode: resolved.config.countryCode,
        jurisdictionName: resolved.config.displayName,
        calculationMode: 'configured',
        method: incomeTaxResult.method,
        notes,
        details: {
          ...incomeTaxResult.details,
          additionalWithholding,
          validationErrors,
        },
      },
      statutoryContributions: statutoryResult,
    };
  }
}

module.exports = new TaxJurisdictionService();
