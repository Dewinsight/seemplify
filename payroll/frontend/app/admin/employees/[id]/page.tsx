'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, handleAuthCallback } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import {
    getPayrollBankAccountTypes,
    getPayrollBankJurisdiction,
    getPayrollCountryDefaults,
    getPayrollDefaultBankAccountType,
    NIGERIAN_BANK_OPTIONS,
    normalizePayrollBankCountry,
    PAYROLL_BANK_JURISDICTIONS,
} from '@/lib/payrollBankJurisdictions.mjs';
import {
    TaxFieldDefinition,
    TaxJurisdictionSummary,
    describeTaxFieldCurrency,
    listTaxJurisdictions,
    resolveTaxFieldCurrencyCode,
} from '@/lib/payrollTax';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';
import { listPayrollEmployerEntities, PayrollEmployerEntity } from '@/lib/payrollEmployerEntities';
import Link from 'next/link';
import {
    ArrowLeft,
    Save,
    DollarSign,
    FileText,
    CreditCard,
    Loader2,
    Plus,
    Trash2,
    PiggyBank
} from 'lucide-react';

function toDateInputValue(value: any): string {
    if (!value) return '';
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function hasText(value: any): boolean {
    return String(value || '').trim().length > 0;
}

function hasAnyBankingValue(account: any = {}): boolean {
    return [
        account?.bankName,
        account?.accountNumber,
        account?.routingNumber,
        account?.sortCode,
        account?.iban,
        account?.bicSwift,
        account?.bankCode
    ].some(hasText);
}

function normalizePayrollBankAccountType(country: string, accountType: string): 'checking' | 'savings' | 'current' {
    const rawType = String(accountType || '').trim().toLowerCase();
    if (rawType === 'checking' || rawType === 'savings' || rawType === 'current') {
        return rawType;
    }
    if (rawType === 'salary') {
        return 'current';
    }
    const defaultType = getPayrollDefaultBankAccountType(country, { preferSalary: false });
    if (defaultType === 'current' || defaultType === 'savings') {
        return defaultType;
    }
    if (country === 'UK' || country === 'Nigeria' || country === 'Ghana' || country === 'Kenya' || country === 'South Africa' || country === 'EU') {
        return 'current';
    }
    return 'checking';
}

function getDefaultSetupData() {
    return {
        name: '',
        designation: '',
        employeeId: '',
        personalInfo: {
            dateOfBirth: '',
            mailingAddress: {
                street: '',
                street2: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'USA'
            },
            phoneNumbers: {
                mobile: '',
                home: '',
                work: ''
            },
            emergencyContact: {
                name: '',
                relationship: '',
                phone: '',
                email: ''
            }
        },
        dependentsDeclarationStatus: 'pending'
    };
}

function getDefaultTaxConfig() {
    return {
        taxId: '',
        calculationMode: 'configured',
        jurisdictionConfigId: '',
        jurisdictionCode: 'OTHER',
        jurisdictionName: '',
        employeeTaxInputs: {} as Record<string, any>,
        taxValidation: {
            status: 'unknown',
            messages: [] as string[],
            validatedAt: null as string | null,
        },
        taxSubdivision: 'standard',
        residencyStatus: 'resident',
        filingStatus: 'single',
        dependents: 0,
        additionalWithholding: 0,
        manualCalculationType: 'progressive',
        manualTaxFreeAllowance: 0,
        flatTaxRate: 0,
        otherIncome: 0,
        deductionsAdjustment: 0,
        taxCredits: 0,
        multipleJobs: false,
        socialSecurityRate: 0,
        socialSecurityCap: 0,
        customBrackets: [] as Array<{ min: number; max: number | ''; rate: number }>
    };
}

type StatutoryProfile = {
    code: string;
    intro: string;
    socialTitle: string;
    socialOptInLabel: string;
    socialIdentifierLabel: string;
    socialIdentifierPlaceholder: string;
    manualRateLabel: string;
    manualCapLabel: string;
    manualOverrideHelpText: string;
    socialEnabled: boolean;
    manualOverrideEnabled: boolean;
    retirementTitle: string;
    retirementDescription: string;
    retirementOptInLabel: string;
    retirementIdentifierLabel: string;
    retirementIdentifierPlaceholder: string;
    retirementIsStatutory: boolean;
    defaultEmployeePensionPercent: number;
    defaultEmployerPensionPercent: number;
};

const PAYROLL_STATUTORY_PROFILES: Record<string, StatutoryProfile> = {
    GB: {
        code: 'GB',
        intro: 'UK payroll uses National Insurance, not U.S.-style social security labels.',
        socialTitle: 'National Insurance',
        socialOptInLabel: 'National Insurance Opt-In',
        socialIdentifierLabel: 'National Insurance Number',
        socialIdentifierPlaceholder: 'QQ 12 34 56 C',
        manualRateLabel: 'Manual National Insurance Rate (%)',
        manualCapLabel: 'Manual Annual National Insurance Cap',
        manualOverrideHelpText: 'Use the manual override only when you need a payroll-specific NI exception.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Pension Reference',
        retirementIdentifierPlaceholder: 'Enter pension reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    US: {
        code: 'US',
        intro: 'U.S. payroll uses FICA for Social Security and Medicare. Retirement plans stay separate.',
        socialTitle: 'FICA / Social Security',
        socialOptInLabel: 'FICA / Social Security Opt-In',
        socialIdentifierLabel: 'Social Security Number',
        socialIdentifierPlaceholder: '123-45-6789',
        manualRateLabel: 'Manual Social Security Rate (%)',
        manualCapLabel: 'Manual Annual Social Security Cap',
        manualOverrideHelpText: 'Use the manual override only if you need a local payroll exception to the built-in FICA rules.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Retirement Plan Reference',
        retirementIdentifierPlaceholder: 'Enter retirement plan reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    NG: {
        code: 'NG',
        intro: 'Nigeria payroll should use the Contributory Pension Scheme. This is pension/RSA-based, not U.S.-style social security.',
        socialTitle: '',
        socialOptInLabel: '',
        socialIdentifierLabel: '',
        socialIdentifierPlaceholder: '',
        manualRateLabel: '',
        manualCapLabel: '',
        manualOverrideHelpText: '',
        socialEnabled: false,
        manualOverrideEnabled: false,
        retirementTitle: 'Contributory Pension Scheme',
        retirementDescription: 'Set the employee and employer pension rates for the RSA-backed pension contribution.',
        retirementOptInLabel: 'Pension Scheme Opt-In',
        retirementIdentifierLabel: 'RSA PIN / Pension Account Number',
        retirementIdentifierPlaceholder: 'PEN1234567890',
        retirementIsStatutory: true,
        defaultEmployeePensionPercent: 8,
        defaultEmployerPensionPercent: 10,
    },
    GH: {
        code: 'GH',
        intro: 'Ghana payroll uses SSNIT for statutory employee contribution withholding.',
        socialTitle: 'SSNIT',
        socialOptInLabel: 'SSNIT Opt-In',
        socialIdentifierLabel: 'SSNIT Number',
        socialIdentifierPlaceholder: 'Enter SSNIT number',
        manualRateLabel: 'Manual SSNIT Rate (%)',
        manualCapLabel: 'Manual Annual SSNIT Cap',
        manualOverrideHelpText: 'Use the manual override only when you need a payroll exception to the built-in SSNIT rate.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Pension Reference',
        retirementIdentifierPlaceholder: 'Enter pension reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    KE: {
        code: 'KE',
        intro: 'Kenya PAYE is available as a review-only preview while the remaining statutory edge cases are being certified. It cannot finalize payroll yet.',
        socialTitle: 'Statutory Contribution Override',
        socialOptInLabel: 'Enable Manual Statutory Contribution',
        socialIdentifierLabel: 'Statutory Reference Number',
        socialIdentifierPlaceholder: 'Enter statutory reference',
        manualRateLabel: 'Manual Statutory Rate (%)',
        manualCapLabel: 'Manual Annual Statutory Cap',
        manualOverrideHelpText: 'This manual override is for country-specific statutory deductions that are not yet modeled separately.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Retirement Plan Reference',
        retirementIdentifierPlaceholder: 'Enter retirement plan reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    ZA: {
        code: 'ZA',
        intro: 'South Africa PAYE is built in. Use manual statutory overrides only if you need an additional payroll deduction that is not yet modeled separately.',
        socialTitle: 'Statutory Contribution Override',
        socialOptInLabel: 'Enable Manual Statutory Contribution',
        socialIdentifierLabel: 'Statutory Reference Number',
        socialIdentifierPlaceholder: 'Enter statutory reference',
        manualRateLabel: 'Manual Statutory Rate (%)',
        manualCapLabel: 'Manual Annual Statutory Cap',
        manualOverrideHelpText: 'This manual override is for country-specific statutory deductions that are not yet modeled separately.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Retirement Plan Reference',
        retirementIdentifierPlaceholder: 'Enter retirement plan reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    EU: {
        code: 'EU',
        intro: 'EU payroll rules vary by member state, so statutory contributions should be configured manually.',
        socialTitle: 'Manual Statutory Contribution',
        socialOptInLabel: 'Enable Manual Statutory Contribution',
        socialIdentifierLabel: 'Statutory Reference Number',
        socialIdentifierPlaceholder: 'Enter statutory reference',
        manualRateLabel: 'Manual Statutory Rate (%)',
        manualCapLabel: 'Manual Annual Statutory Cap',
        manualOverrideHelpText: 'There is no single EU-wide statutory payroll rule, so configure the member-state contribution manually here.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Retirement Plan Reference',
        retirementIdentifierPlaceholder: 'Enter retirement plan reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
    OTHER: {
        code: 'OTHER',
        intro: 'Use manual statutory fields for countries that are not built in yet.',
        socialTitle: 'Manual Statutory Contribution',
        socialOptInLabel: 'Enable Manual Statutory Contribution',
        socialIdentifierLabel: 'Statutory Reference Number',
        socialIdentifierPlaceholder: 'Enter statutory reference',
        manualRateLabel: 'Manual Statutory Rate (%)',
        manualCapLabel: 'Manual Annual Statutory Cap',
        manualOverrideHelpText: 'Configure the exact statutory rate and cap manually for unsupported jurisdictions.',
        socialEnabled: true,
        manualOverrideEnabled: true,
        retirementTitle: 'Pension / Retirement Plan',
        retirementDescription: 'Optional retirement deductions can still be run through payroll when needed.',
        retirementOptInLabel: 'Retirement Plan Opt-In',
        retirementIdentifierLabel: 'Retirement Plan Reference',
        retirementIdentifierPlaceholder: 'Enter retirement plan reference',
        retirementIsStatutory: false,
        defaultEmployeePensionPercent: 0,
        defaultEmployerPensionPercent: 0,
    },
};

function getStatutoryProfile(jurisdictionCode: string): StatutoryProfile {
    return PAYROLL_STATUTORY_PROFILES[String(jurisdictionCode || 'OTHER').toUpperCase()] || PAYROLL_STATUTORY_PROFILES.OTHER;
}

function normalizeStatutoryContributionsForJurisdiction(raw: any = {}, jurisdictionCode = 'OTHER') {
    const profile = getStatutoryProfile(jurisdictionCode);
    const next = {
        socialSecurityOptIn: raw?.socialSecurityOptIn !== false,
        socialSecurityNumber: String(raw?.socialSecurityNumber || ''),
        pensionOptIn: !!raw?.pensionOptIn,
        pensionAccountNumber: String(raw?.pensionAccountNumber || ''),
        pensionContributionPercent: Number(raw?.pensionContributionPercent || 0),
        employerPensionPercent: Number(raw?.employerPensionPercent || 0)
    };

    if (profile.code === 'NG') {
        next.pensionOptIn = raw?.pensionOptIn !== false;
        if (next.pensionContributionPercent <= 0 && next.employerPensionPercent <= 0) {
            next.pensionContributionPercent = profile.defaultEmployeePensionPercent;
            next.employerPensionPercent = profile.defaultEmployerPensionPercent;
        }
    }

    return next;
}

const COUNTRY_CODE_HINTS: Record<string, string> = {
    UK: 'GB',
    'UNITED KINGDOM': 'GB',
    ENGLAND: 'GB',
    SCOTLAND: 'GB',
    WALES: 'GB',
    'NORTHERN IRELAND': 'GB',
    US: 'US',
    USA: 'US',
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
    NIGERIA: 'NG',
    GHANA: 'GH',
    KENYA: 'KE',
    'SOUTH AFRICA': 'ZA',
    CANADA: 'CA',
    CAMEROON: 'CM',
    MOZAMBIQUE: 'MZ',
    'EUROPEAN UNION': 'EU',
};

function normalizeJurisdictionCode(value: any): string {
    const raw = String(value || '').trim().toUpperCase();
    return COUNTRY_CODE_HINTS[raw] || raw;
}

function findAutomaticEmployerForCountry(entities: PayrollEmployerEntity[] = [], countryCode = '') {
    const candidates = entities.filter((entity) => (
        entity.status !== 'inactive' && entity.countryCode === countryCode
    ));
    const active = candidates.filter((entity) => entity.status === 'active');
    if (active.length === 1) return active[0];
    if (active.length === 0 && candidates.length === 1) return candidates[0];
    return null;
}

function applyCountryDefaultsToPayrollForm(
    current: any,
    countryValue: string,
    jurisdictions: TaxJurisdictionSummary[],
    entities: PayrollEmployerEntity[]
) {
    const country = getPayrollCountryDefaults(countryValue);
    if (!country || country.code === 'OTHER') {
        return {
            ...current,
            employerEntityId: '',
            taxAssignment: { ...current.taxAssignment, workCountryCode: '', workJurisdictionCode: '', taxJurisdictionCode: '' },
            bankAccount: { ...current.bankAccount, country: country?.value || 'Other' },
        };
    }
    const employer = findAutomaticEmployerForCountry(entities, country.code);
    const jurisdiction = findJurisdictionById(jurisdictions, String(employer?.taxJurisdictionConfigId || ''))
        || findJurisdictionByCode(jurisdictions, country.code);
    const currentCountryCode = normalizeJurisdictionCode(current.taxConfig?.jurisdictionCode || '');
    const countryChanged = currentCountryCode !== country.code;
    const nextTaxConfig = syncTaxConfigWithJurisdiction({
        ...current.taxConfig,
        jurisdictionConfigId: jurisdiction?._id ? String(jurisdiction._id) : '',
        jurisdictionCode: country.code,
        jurisdictionName: jurisdiction?.displayName || jurisdiction?.countryName || country.label,
        employeeTaxInputs: countryChanged ? {} : current.taxConfig?.employeeTaxInputs,
    }, jurisdiction);
    const nextBankCountry = country.value;
    const bankCountryChanged = current.bankAccount?.country !== nextBankCountry;

    return {
        ...current,
        employerEntityId: employer?._id || '',
        currency: employer?.defaultCurrency || country.currency || current.currency,
        taxAssignment: {
            ...current.taxAssignment,
            workCountryCode: country.code,
            workJurisdictionCode: employer?.jurisdictionCode || country.code,
            taxJurisdictionCode: employer?.jurisdictionCode || country.code,
            determinationReason: `Automatically determined from the employee payroll country (${country.label}).`,
        },
        taxConfig: nextTaxConfig,
        statutoryContributions: normalizeStatutoryContributionsForJurisdiction(
            current.statutoryContributions,
            country.code
        ),
        bankAccount: {
            ...current.bankAccount,
            country: nextBankCountry,
            accountType: getPayrollDefaultBankAccountType(nextBankCountry, { preferSalary: false }),
            ...(bankCountryChanged ? { routingNumber: '', sortCode: '', bankCode: '', iban: '', bicSwift: '' } : {}),
        },
    };
}

function withoutJurisdictionVersionPin(rawTaxConfig: Record<string, any> = {}) {
    const {
        jurisdictionVersionId: _legacyJurisdictionVersionId,
        versionId: _legacyVersionId,
        ...unpinnedTaxConfig
    } = rawTaxConfig || {};
    return unpinnedTaxConfig;
}

function findJurisdictionById(jurisdictions: TaxJurisdictionSummary[] = [], jurisdictionId: string) {
    const normalizedId = String(jurisdictionId || '').trim();
    if (!normalizedId) return null;
    return jurisdictions.find((jurisdiction) => String(jurisdiction._id) === normalizedId) || null;
}

function findJurisdictionByCode(jurisdictions: TaxJurisdictionSummary[] = [], code: string) {
    const normalizedCode = normalizeJurisdictionCode(code || 'OTHER') || 'OTHER';
    const candidates = jurisdictions.filter((jurisdiction) => normalizeJurisdictionCode(jurisdiction.countryCode) === normalizedCode);
    return candidates.find((jurisdiction) => jurisdiction.scope === 'organization' && jurisdiction.publishedVersion)
        || candidates.find((jurisdiction) => !!jurisdiction.publishedVersion)
        || candidates.find((jurisdiction) => jurisdiction.scope === 'organization')
        || candidates[0]
        || null;
}

function findJurisdictionByName(jurisdictions: TaxJurisdictionSummary[] = [], name: string) {
    const normalizedName = String(name || '').trim().toLowerCase();
    if (!normalizedName) return null;
    return jurisdictions.find((jurisdiction) => String(jurisdiction.displayName || '').trim().toLowerCase() === normalizedName)
        || jurisdictions.find((jurisdiction) => String(jurisdiction.countryName || '').trim().toLowerCase() === normalizedName)
        || null;
}

function hydrateEmployeeTaxInputs(
    fieldDefinitions: TaxFieldDefinition[] = [],
    rawInputs: Record<string, any> = {},
    rawTaxConfig: Record<string, any> = {}
) {
    const hydrated: Record<string, any> = { ...(rawInputs || {}) };

    for (const field of fieldDefinitions || []) {
        if (hydrated[field.key] !== undefined) continue;
        if (rawTaxConfig[field.key] !== undefined) {
            hydrated[field.key] = rawTaxConfig[field.key];
            continue;
        }
        hydrated[field.key] = field.defaultValue !== undefined
            ? field.defaultValue
            : (field.type === 'boolean' ? false : '');
    }

    return hydrated;
}

function syncTaxConfigWithJurisdiction(rawTaxConfig: Record<string, any> = {}, jurisdiction: TaxJurisdictionSummary | null) {
    const unpinnedTaxConfig = withoutJurisdictionVersionPin(rawTaxConfig);
    const publishedVersion = jurisdiction?.publishedVersion || null;
    const employeeTaxInputs = hydrateEmployeeTaxInputs(
        Array.isArray(publishedVersion?.fieldDefinitions) ? publishedVersion.fieldDefinitions : [],
        (rawTaxConfig?.employeeTaxInputs && typeof rawTaxConfig.employeeTaxInputs === 'object') ? rawTaxConfig.employeeTaxInputs : {},
        rawTaxConfig
    );

    return {
        ...getDefaultTaxConfig(),
        ...unpinnedTaxConfig,
        calculationMode: 'configured',
        jurisdictionConfigId: jurisdiction?._id ? String(jurisdiction._id) : String(rawTaxConfig?.jurisdictionConfigId || ''),
        jurisdictionCode: jurisdiction?.countryCode || normalizeJurisdictionCode(rawTaxConfig?.jurisdictionCode || 'OTHER') || 'OTHER',
        jurisdictionName: jurisdiction?.displayName || rawTaxConfig?.jurisdictionName || jurisdiction?.countryName || '',
        employeeTaxInputs,
        taxValidation: {
            status: publishedVersion ? 'ready' : 'needs_configuration',
            messages: publishedVersion ? [] : ['The selected tax jurisdiction does not have a published rule yet.'],
            validatedAt: rawTaxConfig?.taxValidation?.validatedAt || null,
        },
    };
}

function resolveEmployeeTaxConfig(
    rawTaxConfig: Record<string, any> = {},
    jurisdictions: TaxJurisdictionSummary[] = [],
    countryHints: string[] = []
) {
    let jurisdiction = findJurisdictionById(jurisdictions, String(rawTaxConfig?.jurisdictionConfigId || rawTaxConfig?.configId || ''));

    if (!jurisdiction) {
        jurisdiction = findJurisdictionByCode(jurisdictions, String(rawTaxConfig?.jurisdictionCode || ''));
    }

    if (!jurisdiction && rawTaxConfig?.jurisdictionName) {
        jurisdiction = findJurisdictionByName(jurisdictions, rawTaxConfig.jurisdictionName);
    }

    if (!jurisdiction) {
        for (const hint of countryHints) {
            const byCode = findJurisdictionByCode(jurisdictions, hint);
            if (byCode) {
                jurisdiction = byCode;
                break;
            }
            const byName = findJurisdictionByName(jurisdictions, hint);
            if (byName) {
                jurisdiction = byName;
                break;
            }
        }
    }

    if (!jurisdiction) {
        jurisdiction = findJurisdictionByCode(jurisdictions, 'OTHER');
    }

    return syncTaxConfigWithJurisdiction(rawTaxConfig, jurisdiction);
}

function mapTaxConfigForForm(raw: any = {}) {
    const defaults = getDefaultTaxConfig();
    const jurisdictionCode = normalizeJurisdictionCode(raw?.jurisdictionCode || raw?.jurisdictionCountry || '') || defaults.jurisdictionCode;
    const unpinnedTaxConfig = withoutJurisdictionVersionPin(raw);

    return {
        ...defaults,
        ...unpinnedTaxConfig,
        calculationMode: 'configured',
        jurisdictionConfigId: String(raw?.jurisdictionConfigId || raw?.configId || ''),
        jurisdictionCode,
        jurisdictionName: raw?.jurisdictionName || '',
        employeeTaxInputs: (raw?.employeeTaxInputs && typeof raw.employeeTaxInputs === 'object') ? raw.employeeTaxInputs : {},
        taxValidation: {
            status: String(raw?.taxValidation?.status || defaults.taxValidation.status),
            messages: Array.isArray(raw?.taxValidation?.messages) ? raw.taxValidation.messages : [],
            validatedAt: raw?.taxValidation?.validatedAt || null,
        },
        taxSubdivision: raw?.taxSubdivision || 'standard',
        residencyStatus: raw?.residencyStatus || 'resident',
        filingStatus: raw?.filingStatus || 'single',
        dependents: Number(raw?.dependents || 0),
        additionalWithholding: Number(raw?.additionalWithholding || 0),
        manualCalculationType: raw?.manualCalculationType || 'progressive',
        manualTaxFreeAllowance: Number(raw?.manualTaxFreeAllowance || 0),
        flatTaxRate: Number(raw?.flatTaxRate || 0),
        otherIncome: Number(raw?.otherIncome || 0),
        deductionsAdjustment: Number(raw?.deductionsAdjustment || 0),
        taxCredits: Number(raw?.taxCredits || 0),
        multipleJobs: !!raw?.multipleJobs,
        socialSecurityRate: Number(raw?.socialSecurityRate || 0),
        socialSecurityCap: Number(raw?.socialSecurityCap || 0),
        customBrackets: Array.isArray(raw?.customBrackets)
            ? raw.customBrackets.map((bracket: any) => ({
                min: Number(bracket?.min || 0),
                max: bracket?.max === null || bracket?.max === undefined ? '' : Number(bracket.max || 0),
                rate: Number(bracket?.rate || 0)
            }))
            : defaults.customBrackets
    };
}

function serializeCustomBrackets(brackets: Array<{ min: number; max: number | ''; rate: number }>) {
    return (Array.isArray(brackets) ? brackets : [])
        .filter((bracket) => Number(bracket?.rate || 0) > 0 || Number(bracket?.max || 0) > 0 || Number(bracket?.min || 0) > 0)
        .map((bracket) => ({
            min: Number(bracket.min || 0),
            max: bracket.max === '' ? null : Number(bracket.max || 0),
            rate: Number(bracket.rate || 0)
        }));
}

function formatCurrencyAmount(amount: any, currency = 'USD') {
    return formatPayrollMoney(amount, currency);
}

type PayComponentTaxTreatment = 'jurisdiction_default' | 'taxable' | 'non_taxable' | 'partially_taxable';

const taxTreatmentLabels: Record<PayComponentTaxTreatment, string> = {
    jurisdiction_default: 'Use jurisdiction rule',
    taxable: 'Taxable',
    non_taxable: 'Non-taxable',
    partially_taxable: 'Partially taxable',
};

const STATUTORILY_TAXABLE_CLASSIFICATIONS = new Set([
    'cash_allowance',
    'housing_allowance',
    'transport_allowance',
    'cash_bonus',
    'company_car',
    'housing_benefit',
    'cheap_loan',
    'phone_benefit',
    'benefit_in_kind',
]);

function isStatutorilyTaxableClassification(value: any): boolean {
    return STATUTORILY_TAXABLE_CLASSIFICATIONS.has(String(value || '').trim().toLowerCase());
}

const allowanceClassificationByType: Record<string, string> = {
    hra: 'housing_allowance',
    transport: 'transport_allowance',
    meal: 'cash_allowance',
    phone: 'cash_allowance',
    medical: 'cash_allowance',
    education: 'cash_allowance',
    special: 'cash_allowance',
    other: 'cash_allowance',
};

const createNewAllowance = () => ({
    type: 'hra',
    name: '',
    amount: 0,
    classificationCode: 'housing_allowance',
    paymentKind: 'cash',
    taxTreatment: 'jurisdiction_default' as PayComponentTaxTreatment,
    taxablePercentage: 100,
    taxAuthorityReason: '',
    taxEvidenceReference: '',
    effectiveFrom: '',
    effectiveTo: ''
});

const createNewBenefit = () => ({
    classificationCode: 'benefit_in_kind',
    name: '',
    fairValue: 0,
    cashPayable: false,
    employerPaidAmount: 0,
    taxTreatment: 'jurisdiction_default' as PayComponentTaxTreatment,
    taxablePercentage: 100,
    taxAuthorityReason: '',
    taxEvidenceReference: '',
    effectiveFrom: '',
    effectiveTo: '',
    overridePeriodKey: '',
    overrideTaxTreatment: 'taxable' as Exclude<PayComponentTaxTreatment, 'jurisdiction_default'>,
    overrideTaxablePercentage: 100,
    overrideAuthorityReason: '',
    overrideEvidenceReference: ''
});

export default function EmployeeEditPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { currencies, paymentCurrencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [setupData, setSetupData] = useState<any>(getDefaultSetupData());
    const [profileCompletion, setProfileCompletion] = useState<any>(null);
    const [idpSyncWarning, setIdpSyncWarning] = useState('');
    const [canSyncIdpProfile, setCanSyncIdpProfile] = useState(false);
    const [taxJurisdictions, setTaxJurisdictions] = useState<TaxJurisdictionSummary[]>([]);
    const [employerEntities, setEmployerEntities] = useState<PayrollEmployerEntity[]>([]);
    const [taxPreview, setTaxPreview] = useState<any>(null);
    const [taxPreviewLoading, setTaxPreviewLoading] = useState(false);
    const [taxPreviewError, setTaxPreviewError] = useState('');

    // Form State
    const [formData, setFormData] = useState<any>({
        employerEntityId: '',
        taxAssignment: {
            workCountryCode: '',
            workJurisdictionCode: '',
            taxJurisdictionCode: '',
            determinationReason: '',
            evidenceReference: '',
            effectiveFrom: ''
        },
        basicSalary: 0,
        currency: 'USD',
        workTerms: {
            payBasis: 'salary',
            rate: 0,
            standardHoursPerWeek: 40,
            standardHoursPerDay: 8,
            contractStartDate: '',
            contractEndDate: '',
            contractReference: '',
            contractAmount: 0,
            contractAmountFrequency: 'contract_total'
        },
        isActive: true,
        allowances: [] as any[],
        benefitItems: [] as any[],
        payrollFlags: {
            includeInNextRun: true,
            excludeFromNextRun: false,
            holdPayment: false,
            holdReason: ''
        },
        taxConfig: getDefaultTaxConfig(),
        statutoryContributions: {
            socialSecurityOptIn: true,
            socialSecurityNumber: '',
            pensionAccountNumber: '',
            pensionOptIn: false,
            pensionContributionPercent: 0,
            employerPensionPercent: 0
        },
        bankAccount: {
            country: 'USA',
            bankName: '',
            accountHolderName: '',
            accountNumber: '',
            routingNumber: '',
            sortCode: '',
            iban: '',
            bicSwift: '',
            bankCode: '',
            accountType: 'checking'
        },
        recurringDeductions: [] as any[]
    });

    // Deduction Form State
    const [newDeduction, setNewDeduction] = useState({
        name: '',
        type: 'other',
        amount: 0,
        isPercentage: false,
        percentage: 0,
        isPreTax: false,
        isLoan: false,
        totalLoanAmount: 0
    });

    // Allowance Form State
    const [newAllowance, setNewAllowance] = useState(createNewAllowance());
    const [newBenefit, setNewBenefit] = useState(createNewBenefit());

    const selectablePaymentCurrencies = useMemo(() => {
        const currentCurrency = currencies.find((currency) => currency.code === formData.currency);
        return currentCurrency && !paymentCurrencies.some((currency) => currency.code === currentCurrency.code)
            ? [currentCurrency, ...paymentCurrencies]
            : paymentCurrencies;
    }, [currencies, formData.currency, paymentCurrencies]);

    useEffect(() => {
        handleAuthCallback();

        const fetchProfile = async () => {
            try {
                const me = await authApi.getMe();
                const currentOrg =
                    me.user?.organizations?.find((organization: any) => organization.id === me.currentOrganizationId)
                    || me.user?.organizations?.[0];

                if (!currentOrg || !['owner', 'admin', 'hr_manager'].includes(currentOrg.role)) {
                    router.push('/dashboard');
                    return;
                }

                const res = await api.get(`/payroll/profiles/${params.id}`);
                setProfile(res.data);

                let jurisdictionSummaries: TaxJurisdictionSummary[] = [];
                try {
                    jurisdictionSummaries = await listTaxJurisdictions();
                } catch (taxJurisdictionError) {
                    console.error('Failed to load tax jurisdictions:', taxJurisdictionError);
                }
                setTaxJurisdictions(jurisdictionSummaries);
                try {
                    setEmployerEntities(await listPayrollEmployerEntities());
                } catch (employerError) {
                    console.error('Failed to load legal employers:', employerError);
                }

                const idpSync = res.data?.idpSync || null;
                const payrollSync = idpSync?.payrollSync || {};
                const syncedBankAccount = payrollSync?.banking?.accounts?.[0] || {};
                const payrollBankAccount = res.data.bankAccounts?.[0] || {};
                const resolvedCountry = normalizePayrollBankCountry(
                    payrollSync?.personalInfo?.mailingAddress?.country
                    || res.data?.employeeInfo?.countryCode
                    || res.data?.employeeInfo?.countryName
                    || syncedBankAccount?.country
                    || payrollSync?.banking?.country
                    || payrollBankAccount?.country
                    || 'USA'
                );
                const resolvedBankJurisdiction = getPayrollBankJurisdiction(resolvedCountry);
                const dependentsCount = Number(payrollSync?.dependentsCount || 0);
                const nextDependentsStatus = dependentsCount > 0
                    ? 'provided'
                    : (payrollSync?.profileCompletion?.hasDeclaredNoDependents ? 'none' : 'pending');

                setProfileCompletion(payrollSync?.profileCompletion || null);
                setCanSyncIdpProfile(!!idpSync);
                setIdpSyncWarning(idpSync ? '' : 'Identity Provider profile sync is unavailable right now. Payroll values can still be saved, but employee setup details will not push back to IDP until sync is restored.');
                setSetupData({
                    name: idpSync?.name || res.data?.employeeInfo?.name || '',
                    designation: idpSync?.designation || res.data?.employeeInfo?.designation || '',
                    employeeId: idpSync?.employeeId || res.data?.employeeInfo?.employeeId || '',
                    personalInfo: {
                        dateOfBirth: toDateInputValue(payrollSync?.personalInfo?.dateOfBirth || res.data?.employeeInfo?.dateOfBirth),
                        mailingAddress: {
                            street: payrollSync?.personalInfo?.mailingAddress?.street || '',
                            street2: payrollSync?.personalInfo?.mailingAddress?.street2 || '',
                            city: payrollSync?.personalInfo?.mailingAddress?.city || '',
                            state: payrollSync?.personalInfo?.mailingAddress?.state || '',
                            zipCode: payrollSync?.personalInfo?.mailingAddress?.zipCode || '',
                            country: payrollSync?.personalInfo?.mailingAddress?.country || 'USA'
                        },
                        phoneNumbers: {
                            mobile: payrollSync?.personalInfo?.phoneNumbers?.mobile || '',
                            home: payrollSync?.personalInfo?.phoneNumbers?.home || '',
                            work: payrollSync?.personalInfo?.phoneNumbers?.work || ''
                        },
                        emergencyContact: {
                            name: payrollSync?.emergencyContact?.name || '',
                            relationship: payrollSync?.emergencyContact?.relationship || '',
                            phone: payrollSync?.emergencyContact?.phone || '',
                            email: payrollSync?.emergencyContact?.email || ''
                        }
                    },
                    dependentsDeclarationStatus: nextDependentsStatus
                });

                const nextTaxConfig = resolveEmployeeTaxConfig(
                    mapTaxConfigForForm(res.data.taxConfig),
                    jurisdictionSummaries,
                    [
                        payrollSync?.personalInfo?.mailingAddress?.country,
                        syncedBankAccount?.country,
                        payrollSync?.banking?.country,
                        payrollBankAccount?.country,
                        res.data?.employeeInfo?.country,
                    ]
                );
                const nextStatutoryContributions = normalizeStatutoryContributionsForJurisdiction(
                    res.data.statutoryContributions,
                    nextTaxConfig.jurisdictionCode
                );

                // Initialize form
                setFormData({
                    employerEntityId: res.data.employerEntityId || '',
                    taxAssignment: {
                        workCountryCode: res.data.taxAssignment?.workCountryCode || '',
                        workJurisdictionCode: res.data.taxAssignment?.workJurisdictionCode || '',
                        taxJurisdictionCode: res.data.taxAssignment?.taxJurisdictionCode || nextTaxConfig.jurisdictionCode || '',
                        determinationReason: res.data.taxAssignment?.determinationReason || '',
                        evidenceReference: res.data.taxAssignment?.evidenceReference || '',
                        effectiveFrom: toDateInputValue(res.data.taxAssignment?.effectiveFrom)
                    },
                    basicSalary: res.data.basicSalary || 0,
                    currency: res.data.currency || 'USD',
                    workTerms: {
                        payBasis: res.data.workTerms?.payBasis || 'salary',
                        rate: res.data.workTerms?.rate || 0,
                        standardHoursPerWeek: res.data.workTerms?.standardHoursPerWeek || 40,
                        standardHoursPerDay: res.data.workTerms?.standardHoursPerDay || 8,
                        contractStartDate: toDateInputValue(res.data.workTerms?.contractStartDate),
                        contractEndDate: toDateInputValue(res.data.workTerms?.contractEndDate),
                        contractReference: res.data.workTerms?.contractReference || '',
                        contractAmount: res.data.workTerms?.contractAmount || 0,
                        contractAmountFrequency: res.data.workTerms?.contractAmountFrequency || 'contract_total'
                    },
                    isActive: res.data.isActive !== false,
                    allowances: res.data.allowances || [],
                    benefitItems: res.data.benefitItems || [],
                    payrollFlags: {
                        includeInNextRun: res.data.payrollFlags?.includeInNextRun !== false,
                        excludeFromNextRun: res.data.payrollFlags?.excludeFromNextRun === true,
                        holdPayment: !!res.data.payrollFlags?.holdPayment,
                        holdReason: res.data.payrollFlags?.holdReason || ''
                    },
                    taxConfig: nextTaxConfig,
                    statutoryContributions: nextStatutoryContributions,
                    bankAccount: {
                        country: resolvedCountry,
                        bankName: syncedBankAccount?.bankName || payrollBankAccount?.bankName || '',
                        accountHolderName: syncedBankAccount?.accountHolderName || payrollBankAccount?.accountName || res.data?.employeeInfo?.name || '',
                        accountNumber: syncedBankAccount?.accountNumber || payrollBankAccount?.accountNumber || '',
                        routingNumber: syncedBankAccount?.routingNumber || payrollBankAccount?.routingNumber || '',
                        sortCode: syncedBankAccount?.sortCode || (resolvedBankJurisdiction?.localField?.key === 'sortCode' ? (payrollBankAccount?.branchCode || '') : ''),
                        iban: syncedBankAccount?.iban || payrollBankAccount?.iban || '',
                        bicSwift: syncedBankAccount?.bicSwift || payrollBankAccount?.swiftCode || '',
                        bankCode: syncedBankAccount?.bankCode || (resolvedBankJurisdiction?.localField?.key === 'bankCode' ? (payrollBankAccount?.branchCode || '') : ''),
                        accountType: syncedBankAccount?.accountType || payrollBankAccount?.accountType || getPayrollDefaultBankAccountType(resolvedCountry, { preferSalary: false })
                    },
                    recurringDeductions: res.data.recurringDeductions || []
                });
            } catch (error: any) {
                console.error('Failed to fetch profile:', error);
                if (error?.response?.status === 401) {
                    router.push('/login');
                    return;
                }
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, [params.id, router]);

    const taxPreviewInputKey = JSON.stringify({
        basicSalary: formData.basicSalary,
        currency: formData.currency,
        payFrequency: profile?.payFrequency || 'monthly',
        allowances: formData.allowances,
        benefitItems: formData.benefitItems,
        recurringDeductions: formData.recurringDeductions,
        taxConfig: formData.taxConfig,
        statutoryContributions: formData.statutoryContributions,
        dateOfBirth: setupData.personalInfo?.dateOfBirth || profile?.employeeInfo?.dateOfBirth || null
    });

    useEffect(() => {
        if (loading || !profile?._id) {
            return;
        }

        let cancelled = false;
        const timeoutId = window.setTimeout(async () => {
            setTaxPreviewLoading(true);
            setTaxPreviewError('');

            try {
                const previewRes = await api.post(`/payroll/profiles/${params.id}/tax-preview`, {
                    basicSalary: Number(formData.basicSalary || 0),
                    currency: formData.currency,
                    payFrequency: profile?.payFrequency || 'monthly',
                    allowances: formData.allowances,
                    benefitItems: formData.benefitItems,
                    recurringDeductions: formData.recurringDeductions,
                    taxConfig: {
                        ...withoutJurisdictionVersionPin(formData.taxConfig),
                        calculationMode: 'configured',
                        jurisdictionCode: formData.taxConfig.jurisdictionCode,
                        jurisdictionName: formData.taxConfig.jurisdictionName,
                        employeeTaxInputs: formData.taxConfig.employeeTaxInputs || {},
                        taxValidation: formData.taxConfig.taxValidation || { status: 'unknown', messages: [] },
                        dependents: Number(formData.taxConfig.dependents || 0),
                        additionalWithholding: Number(formData.taxConfig.additionalWithholding || 0),
                        flatTaxRate: Number(formData.taxConfig.flatTaxRate || 0),
                        manualTaxFreeAllowance: Number(formData.taxConfig.manualTaxFreeAllowance || 0),
                        otherIncome: Number(formData.taxConfig.otherIncome || 0),
                        deductionsAdjustment: Number(formData.taxConfig.deductionsAdjustment || 0),
                        taxCredits: Number(formData.taxConfig.taxCredits || 0),
                        socialSecurityRate: Number(formData.taxConfig.socialSecurityRate || 0),
                        socialSecurityCap: Number(formData.taxConfig.socialSecurityCap || 0),
                        multipleJobs: !!formData.taxConfig.multipleJobs,
                        customBrackets: serializeCustomBrackets(formData.taxConfig.customBrackets || [])
                    },
                    statutoryContributions: {
                        ...formData.statutoryContributions,
                        pensionContributionPercent: Number(formData.statutoryContributions.pensionContributionPercent || 0),
                        employerPensionPercent: Number(formData.statutoryContributions.employerPensionPercent || 0)
                    },
                    employeeInfo: {
                        ...(profile?.employeeInfo || {}),
                        dateOfBirth: setupData.personalInfo?.dateOfBirth || profile?.employeeInfo?.dateOfBirth || null
                    }
                });

                if (!cancelled) {
                    setTaxPreview(previewRes.data);
                }
            } catch (error: any) {
                if (!cancelled) {
                    console.error('Failed to preview tax configuration:', error);
                    setTaxPreview(null);
                    setTaxPreviewError(error?.response?.data?.error || 'Failed to preview tax calculation');
                }
            } finally {
                if (!cancelled) {
                    setTaxPreviewLoading(false);
                }
            }
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [
        loading,
        params.id,
        profile?._id,
        profile?.employeeInfo,
        profile?.payFrequency,
        formData.allowances,
        formData.basicSalary,
        formData.benefitItems,
        formData.currency,
        formData.recurringDeductions,
        formData.statutoryContributions,
        formData.taxConfig,
        setupData.personalInfo?.dateOfBirth,
        taxPreviewInputKey
    ]);

    const handleSubmit = async (e?: React.SyntheticEvent) => {
        e?.preventDefault?.();
        setSaving(true);

        try {
            const bankCountry = normalizePayrollBankCountry(formData.bankAccount?.country || 'USA');
            const bankJurisdiction = getPayrollBankJurisdiction(bankCountry);
            const localFieldKey = bankJurisdiction?.localField?.key || '';
            const localFieldValue = localFieldKey === 'sortCode'
                ? String(formData.bankAccount?.sortCode || '').trim()
                : localFieldKey === 'bankCode'
                    ? String(formData.bankAccount?.bankCode || '').trim()
                    : String(formData.bankAccount?.routingNumber || '').trim();
            const bankName = String(formData.bankAccount?.bankName || '').trim();
            const accountHolderName = String(formData.bankAccount?.accountHolderName || '').trim();
            const accountNumber = String(formData.bankAccount?.accountNumber || '').trim();
            const routingNumber = String(formData.bankAccount?.routingNumber || '').trim();
            const sortCode = String(formData.bankAccount?.sortCode || '').trim();
            const iban = String(formData.bankAccount?.iban || '').trim();
            const bicSwift = String(formData.bankAccount?.bicSwift || '').trim();
            const bankCode = String(formData.bankAccount?.bankCode || '').trim();
            const accountType = String(formData.bankAccount?.accountType || '').trim();
            const effectivePayrollAccountNumber = accountNumber || iban;
            const hasBankingDetails = hasAnyBankingValue(formData.bankAccount);
            const canUpdateDependentsDeclaration = Number(profileCompletion?.dependentsCount || 0) === 0;

            let bankAccounts: any[] = [];
            if (!hasBankingDetails) {
                bankAccounts = [];
            } else if (!bankName || !effectivePayrollAccountNumber) {
                alert('Bank name and account number are required if you want to save bank details.');
                setSaving(false);
                return;
            } else if (bankJurisdiction?.localField?.required && !localFieldValue) {
                alert(`${bankJurisdiction.localField.label} is required for ${bankJurisdiction.label}.`);
                setSaving(false);
                return;
            } else if (bankJurisdiction?.requiresIban && !iban) {
                alert(`IBAN is required for ${bankJurisdiction.label}.`);
                setSaving(false);
                return;
            } else {
                bankAccounts = [
                    {
                        country: bankCountry,
                        countryCode: bankJurisdiction.code,
                        bankName,
                        accountNumber: effectivePayrollAccountNumber,
                        routingNumber: routingNumber || undefined,
                        branchCode: (localFieldKey === 'sortCode' ? sortCode : localFieldKey === 'bankCode' ? bankCode : '') || undefined,
                        swiftCode: bicSwift || undefined,
                        iban: iban || undefined,
                        accountType: normalizePayrollBankAccountType(bankCountry, accountType),
                        isPrimary: true,
                        accountName: accountHolderName || setupData.name || profile?.employeeInfo?.name || 'Primary'
                    }
                ];
            }

            const idpProfileSyncPayload = canSyncIdpProfile ? {
                name: setupData.name,
                designation: setupData.designation,
                employeeId: setupData.employeeId,
                personalInfo: {
                    dateOfBirth: setupData.personalInfo?.dateOfBirth || null,
                    mailingAddress: {
                        ...(setupData.personalInfo?.mailingAddress || {})
                    },
                    phoneNumbers: {
                        ...(setupData.personalInfo?.phoneNumbers || {})
                    },
                    emergencyContact: {
                        ...(setupData.personalInfo?.emergencyContact || {})
                    }
                },
                taxInfo: {
                    taxId: formData.taxConfig.taxId || ''
                },
                banking: {
                    country: bankCountry,
                    account: hasBankingDetails ? {
                        bankName,
                        accountHolderName: accountHolderName || setupData.name || profile?.employeeInfo?.name || '',
                        accountNumber,
                        routingNumber,
                        sortCode,
                        iban,
                        bicSwift,
                        bankCode,
                        accountType,
                        percentage: 100,
                        isActive: true
                    } : {}
                },
                ...(canUpdateDependentsDeclaration ? {
                    dependentsDeclaration: {
                        status: Number(formData.taxConfig.dependents || 0) > 0
                            ? 'provided'
                            : setupData.dependentsDeclarationStatus,
                        count: Number(formData.taxConfig.dependents || 0)
                    }
                } : {})
            } : undefined;

            await api.put(`/payroll/profiles/${params.id}`, {
                employerEntityId: formData.employerEntityId || null,
                taxAssignment: {
                    ...formData.taxAssignment,
                    effectiveFrom: formData.taxAssignment?.effectiveFrom || null,
                },
                basicSalary: Number(formData.basicSalary),
                currency: formData.currency,
                workTerms: {
                    ...formData.workTerms,
                    rate: Number(formData.workTerms?.rate || 0),
                    standardHoursPerWeek: Number(formData.workTerms?.standardHoursPerWeek || 0),
                    standardHoursPerDay: Number(formData.workTerms?.standardHoursPerDay || 0),
                    contractAmount: Number(formData.workTerms?.contractAmount || 0),
                    contractStartDate: formData.workTerms?.contractStartDate || null,
                    contractEndDate: formData.workTerms?.contractEndDate || null
                },
                isActive: formData.isActive,
                allowances: formData.allowances,
                benefitItems: formData.benefitItems,
                payrollFlags: formData.payrollFlags,
                taxConfig: {
                    ...withoutJurisdictionVersionPin(formData.taxConfig),
                    calculationMode: 'configured',
                    jurisdictionCode: selectedJurisdiction?.countryCode || formData.taxConfig.jurisdictionCode,
                    jurisdictionName: selectedJurisdiction?.displayName || formData.taxConfig.jurisdictionName,
                    employeeTaxInputs: formData.taxConfig.employeeTaxInputs || {},
                    taxValidation: formData.taxConfig.taxValidation || { status: 'unknown', messages: [] },
                    dependents: Number(formData.taxConfig.dependents || 0),
                    additionalWithholding: Number(formData.taxConfig.additionalWithholding || 0),
                    flatTaxRate: Number(formData.taxConfig.flatTaxRate || 0),
                    manualTaxFreeAllowance: Number(formData.taxConfig.manualTaxFreeAllowance || 0),
                    otherIncome: Number(formData.taxConfig.otherIncome || 0),
                    deductionsAdjustment: Number(formData.taxConfig.deductionsAdjustment || 0),
                    taxCredits: Number(formData.taxConfig.taxCredits || 0),
                    socialSecurityRate: formData.taxConfig.jurisdictionCode === 'NG'
                        ? 0
                        : Number(formData.taxConfig.socialSecurityRate || 0),
                    socialSecurityCap: formData.taxConfig.jurisdictionCode === 'NG'
                        ? 0
                        : Number(formData.taxConfig.socialSecurityCap || 0),
                    multipleJobs: !!formData.taxConfig.multipleJobs,
                    customBrackets: serializeCustomBrackets(formData.taxConfig.customBrackets || [])
                },
                employeeInfo: {
                    ...profile?.employeeInfo,
                    name: setupData.name,
                    designation: setupData.designation,
                    employeeId: setupData.employeeId,
                    dateOfBirth: setupData.personalInfo?.dateOfBirth || null
                },
                statutoryContributions: {
                    ...formData.statutoryContributions,
                    pensionAccountNumber: String(formData.statutoryContributions.pensionAccountNumber || '').trim(),
                    pensionContributionPercent: Number(formData.statutoryContributions.pensionContributionPercent || 0),
                    employerPensionPercent: Number(formData.statutoryContributions.employerPensionPercent || 0)
                },
                bankAccounts,
                recurringDeductions: formData.recurringDeductions,
                idpProfileSync: idpProfileSyncPayload
            });

            alert('Profile updated successfully');
            router.push('/admin/employees');
        } catch (error: any) {
            alert(error?.response?.data?.error || 'Failed to update profile');
            console.error(error);
        } finally {
            setSaving(false);
        }
    };

    const addAllowance = () => {
        const amount = Number(newAllowance.amount || 0);
        const classificationCode = newAllowance.classificationCode || allowanceClassificationByType[newAllowance.type] || 'cash_allowance';
        const treatmentLocked = isStatutorilyTaxableClassification(classificationCode);
        const selectedTreatment = treatmentLocked ? 'jurisdiction_default' : newAllowance.taxTreatment;
        if (!newAllowance.type) {
            alert('Please select an allowance type');
            return;
        }
        if (!(amount > 0)) {
            alert('Please enter a valid allowance amount');
            return;
        }
        if (selectedTreatment !== 'jurisdiction_default'
            && (!hasText(newAllowance.taxAuthorityReason) || !hasText(newAllowance.taxEvidenceReference))) {
            alert('A legal reason and evidence reference are required when overriding the jurisdiction tax rule.');
            return;
        }
        if (selectedTreatment === 'partially_taxable'
            && !(Number(newAllowance.taxablePercentage) > 0 && Number(newAllowance.taxablePercentage) < 100)) {
            alert('Enter a taxable percentage greater than 0 and less than 100.');
            return;
        }

        const defaultNameByType: Record<string, string> = {
            hra: 'Housing Allowance',
            transport: 'Transport Allowance',
            meal: 'Meal Allowance',
            phone: 'Phone Allowance',
            medical: 'Medical Allowance',
            education: 'Education Allowance',
            special: 'Special Allowance',
            other: 'Allowance',
        };

        const name = String(newAllowance.name || '').trim() || defaultNameByType[newAllowance.type] || 'Allowance';

        const payload: any = {
            type: newAllowance.type,
            name,
            amount,
            classificationCode,
            paymentKind: newAllowance.paymentKind,
            taxTreatment: selectedTreatment,
            taxablePercentage: Number(newAllowance.taxablePercentage || 0),
            taxAuthorityReason: newAllowance.taxAuthorityReason.trim(),
            taxEvidenceReference: newAllowance.taxEvidenceReference.trim(),
            isTaxable: selectedTreatment !== 'non_taxable',
            isActive: true,
        };

        if (newAllowance.effectiveFrom) payload.effectiveFrom = newAllowance.effectiveFrom;
        if (newAllowance.effectiveTo) payload.effectiveTo = newAllowance.effectiveTo;

        setFormData({
            ...formData,
            allowances: [...(formData.allowances || []), payload],
        });

        setNewAllowance(createNewAllowance());
    };

    const removeAllowance = (index: number) => {
        const updated = [...(formData.allowances || [])];
        updated.splice(index, 1);
        setFormData({ ...formData, allowances: updated });
    };

    const addBenefit = () => {
        const fairValue = Number(newBenefit.fairValue || 0);
        const treatmentLocked = isStatutorilyTaxableClassification(newBenefit.classificationCode);
        const selectedTreatment = treatmentLocked ? 'jurisdiction_default' : newBenefit.taxTreatment;
        if (!hasText(newBenefit.name) || !hasText(newBenefit.classificationCode) || !(fairValue > 0)) {
            alert('Benefit name, classification, and a fair value greater than zero are required.');
            return;
        }
        if (selectedTreatment !== 'jurisdiction_default'
            && (!hasText(newBenefit.taxAuthorityReason) || !hasText(newBenefit.taxEvidenceReference))) {
            alert('A legal reason and evidence reference are required when overriding the jurisdiction tax rule.');
            return;
        }
        if (selectedTreatment === 'partially_taxable'
            && !(Number(newBenefit.taxablePercentage) > 0 && Number(newBenefit.taxablePercentage) < 100)) {
            alert('Enter a taxable percentage greater than 0 and less than 100.');
            return;
        }
        if (!treatmentLocked && newBenefit.overridePeriodKey
            && (!hasText(newBenefit.overrideAuthorityReason) || !hasText(newBenefit.overrideEvidenceReference))) {
            alert('A month-specific tax rule requires a legal reason and evidence reference.');
            return;
        }
        if (!treatmentLocked && newBenefit.overridePeriodKey && newBenefit.overrideTaxTreatment === 'partially_taxable'
            && !(Number(newBenefit.overrideTaxablePercentage) > 0 && Number(newBenefit.overrideTaxablePercentage) < 100)) {
            alert('Enter a month-specific taxable percentage greater than 0 and less than 100.');
            return;
        }

        const payload: any = {
            classificationCode: newBenefit.classificationCode.trim().toLowerCase(),
            name: newBenefit.name.trim(),
            fairValue,
            cashPayable: !!newBenefit.cashPayable,
            employerPaidAmount: Number(newBenefit.employerPaidAmount || 0),
            taxTreatment: selectedTreatment,
            taxablePercentage: Number(newBenefit.taxablePercentage || 0),
            taxAuthorityReason: newBenefit.taxAuthorityReason.trim(),
            taxEvidenceReference: newBenefit.taxEvidenceReference.trim(),
            isActive: true,
            taxTreatmentOverrides: !treatmentLocked && newBenefit.overridePeriodKey ? [{
                periodKey: newBenefit.overridePeriodKey,
                taxTreatment: newBenefit.overrideTaxTreatment,
                taxablePercentage: Number(newBenefit.overrideTaxablePercentage || 0),
                authorityReason: newBenefit.overrideAuthorityReason.trim(),
                evidenceReference: newBenefit.overrideEvidenceReference.trim(),
            }] : [],
        };
        if (newBenefit.effectiveFrom) payload.effectiveFrom = newBenefit.effectiveFrom;
        if (newBenefit.effectiveTo) payload.effectiveTo = newBenefit.effectiveTo;

        setFormData({
            ...formData,
            benefitItems: [...(formData.benefitItems || []), payload],
        });
        setNewBenefit(createNewBenefit());
    };

    const removeBenefit = (index: number) => {
        const updated = [...(formData.benefitItems || [])];
        updated.splice(index, 1);
        setFormData({ ...formData, benefitItems: updated });
    };

    const addDeduction = () => {
        if (!newDeduction.name || (newDeduction.amount <= 0 && newDeduction.percentage <= 0)) {
            alert('Please enter valid deduction details');
            return;
        }

        const deductionPayload: any = {
            name: newDeduction.name,
            type: newDeduction.isLoan ? 'loan_repayment' : newDeduction.type,
            amount: Number(newDeduction.amount),
            isPercentage: newDeduction.isPercentage,
            percentage: Number(newDeduction.percentage),
            isPreTax: newDeduction.isPreTax,
            isActive: true
        };

        if (newDeduction.isLoan) {
            deductionPayload.type = 'loan_repayment';
            deductionPayload.totalAmount = Number(newDeduction.totalLoanAmount);
            deductionPayload.remainingAmount = Number(newDeduction.totalLoanAmount);
        }

        setFormData({
            ...formData,
            recurringDeductions: [...formData.recurringDeductions, deductionPayload]
        });

        // Reset form
        setNewDeduction({
            name: '',
            type: 'other',
            amount: 0,
            isPercentage: false,
            percentage: 0,
            isPreTax: false,
            isLoan: false,
            totalLoanAmount: 0
        });
    };

    const removeDeduction = (index: number) => {
        const updated = [...formData.recurringDeductions];
        updated.splice(index, 1);
        setFormData({ ...formData, recurringDeductions: updated });
    };

    const updateTaxConfig = (patch: Record<string, any>) => {
        setFormData({
            ...formData,
            taxConfig: {
                ...formData.taxConfig,
                ...patch,
            }
        });
    };

    const handlePayrollCountryChange = (countryValue: string) => {
        const country = getPayrollCountryDefaults(countryValue);
        setSetupData((current: any) => ({
            ...current,
            personalInfo: {
                ...current.personalInfo,
                mailingAddress: {
                    ...current.personalInfo.mailingAddress,
                    country: country.value,
                },
            },
        }));
        setFormData((current: any) => applyCountryDefaultsToPayrollForm(
            current,
            country.value,
            taxJurisdictions,
            employerEntities
        ));
    };

    const handleEmployerEntityChange = (employerEntityId: string) => {
        const employer = employerEntities.find((entity) => entity._id === employerEntityId) || null;
        if (!employer) {
            setFormData((current: any) => ({ ...current, employerEntityId: '' }));
            return;
        }
        const country = getPayrollCountryDefaults(employer.countryCode);
        const jurisdiction = findJurisdictionById(taxJurisdictions, String(employer.taxJurisdictionConfigId || ''))
            || findJurisdictionByCode(taxJurisdictions, employer.countryCode);
        setSetupData((current: any) => ({
            ...current,
            personalInfo: {
                ...current.personalInfo,
                mailingAddress: { ...current.personalInfo.mailingAddress, country: country.value },
            },
        }));
        setFormData((current: any) => {
            const countryDefaults = applyCountryDefaultsToPayrollForm(
                current,
                country.value,
                taxJurisdictions,
                employerEntities
            );
            return {
                ...countryDefaults,
                employerEntityId: employer._id,
                currency: employer.defaultCurrency,
                taxAssignment: {
                    ...countryDefaults.taxAssignment,
                    workCountryCode: employer.countryCode,
                    workJurisdictionCode: employer.jurisdictionCode,
                    taxJurisdictionCode: employer.jurisdictionCode,
                },
                taxConfig: syncTaxConfigWithJurisdiction(countryDefaults.taxConfig, jurisdiction),
            };
        });
    };

    const updateEmployeeTaxInput = (field: TaxFieldDefinition, value: any) => {
        updateTaxConfig({
            employeeTaxInputs: {
                ...(formData.taxConfig.employeeTaxInputs || {}),
                [field.key]: value,
            },
        });
    };

    const selectedJurisdiction = useMemo(
        () => findJurisdictionById(taxJurisdictions, formData.taxConfig.jurisdictionConfigId)
            || findJurisdictionByCode(taxJurisdictions, formData.taxConfig.jurisdictionCode)
            || null,
        [formData.taxConfig.jurisdictionCode, formData.taxConfig.jurisdictionConfigId, taxJurisdictions]
    );
    const selectedJurisdictionVersion = selectedJurisdiction?.publishedVersion || null;
    const selectedJurisdictionLabel = selectedJurisdiction?.displayName
        || formData.taxConfig.jurisdictionName
        || formData.taxConfig.jurisdictionCode
        || 'Unconfigured';
    const selectedTaxFields = Array.isArray(selectedJurisdictionVersion?.fieldDefinitions)
        ? selectedJurisdictionVersion.fieldDefinitions
        : [];
    const taxValidationMessages = Array.from(new Set([
        ...(Array.isArray(formData.taxConfig.taxValidation?.messages) ? formData.taxConfig.taxValidation.messages : []),
        ...(Array.isArray(taxPreview?.validationErrors) ? taxPreview.validationErrors : []),
    ].filter(Boolean)));
    const statutoryProfile = getStatutoryProfile(selectedJurisdiction?.countryCode || formData.taxConfig.jurisdictionCode);
    const showLegacyStatutoryRateOverrides = !selectedJurisdictionVersion;
    const hasRetirementConfig = statutoryProfile.retirementIsStatutory
        || formData.statutoryContributions.pensionOptIn
        || Number(formData.statutoryContributions.pensionContributionPercent || 0) > 0
        || Number(formData.statutoryContributions.employerPensionPercent || 0) > 0
        || hasText(formData.statutoryContributions.pensionAccountNumber);
    const nigeriaPensionEmployeeRate = Number(formData.statutoryContributions.pensionContributionPercent || 0);
    const nigeriaPensionEmployerRate = Number(formData.statutoryContributions.employerPensionPercent || 0);
    const nigeriaPensionMeetsMinimum = statutoryProfile.code !== 'NG'
        || !formData.statutoryContributions.pensionOptIn
        || nigeriaPensionEmployerRate >= 18
        || (
            nigeriaPensionEmployeeRate >= 8
            && nigeriaPensionEmployerRate >= 10
            && (nigeriaPensionEmployeeRate + nigeriaPensionEmployerRate) >= 18
        );
    const newAllowanceClassification = newAllowance.classificationCode
        || allowanceClassificationByType[newAllowance.type]
        || 'cash_allowance';
    const newAllowanceTreatmentLocked = isStatutorilyTaxableClassification(newAllowanceClassification);
    const newBenefitTreatmentLocked = isStatutorilyTaxableClassification(newBenefit.classificationCode);
    const automaticCountryDefaults = getPayrollCountryDefaults(setupData.personalInfo?.mailingAddress?.country || 'Other');
    const automaticEmployer = employerEntities.find((entity) => entity._id === formData.employerEntityId);

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 px-6 py-8 pb-20 2xl:px-10">
            <div className="mx-auto w-full max-w-[1600px]">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Link
                            href="/admin/employees"
                            className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4 mr-1" />
                            Back to Employees
                        </Link>
                        <h1 className="text-3xl font-bold text-zinc-100">
                            {profile?.employeeInfo?.name || 'Edit Employee'}
                        </h1>
                        <p className="text-zinc-500">
                            {profile?.employeeInfo?.designation || '--'} - {profile?.employeeInfo?.department || '--'}
                        </p>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="flex items-center gap-2 bg-amber-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-amber-500 transition-all disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </div>

                {idpSyncWarning && (
                    <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        {idpSyncWarning}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[280px_minmax(0,1fr)]">
                    {/* Sidebar Info */}
                    <div className="space-y-6">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
                            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                                Setup Status
                            </h3>
                            <div className="space-y-3">
                                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                                    <p className="text-sm font-medium text-zinc-200">
                                        {profileCompletion?.completedCount || 0} of {profileCompletion?.totalSteps || 3} required profile sections completed
                                    </p>
                                    <p className="mt-1 text-xs text-zinc-500">
                                        {profileCompletion?.nextIncompleteStep
                                            ? `Next required step: ${profileCompletion.nextIncompleteStep.label}`
                                            : 'Profile setup is complete for payroll-required sections.'}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(profileCompletion?.steps || []).map((step: any) => (
                                        <span
                                            key={step.key}
                                            className={`rounded-full border px-2.5 py-1 text-xs ${
                                                step.complete
                                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                                    : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
                            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                                Identity Info
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-zinc-500">Email</label>
                                    <p className="text-zinc-200 break-all">{profile?.employeeInfo?.email}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-zinc-500">Employee ID</label>
                                    <p className="text-zinc-200">{profile?.employeeInfo?.employeeId || '--'}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-zinc-500">Joined Date</label>
                                    <p className="text-zinc-200">
                                        {profile?.employeeInfo?.dateOfJoining ? new Date(profile.employeeInfo.dateOfJoining).toLocaleDateString() : '--'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                                Account Status
                            </h3>
                            <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-lg">
                                <span className="text-zinc-300">Active Status</span>
                                <div
                                    onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                                    className={`w-12 h-6 rounded-full cursor-pointer transition-colors relative ${formData.isActive ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${formData.isActive ? 'left-7' : 'left-1'}`} />
                                </div>
                            </div>

                            <div className="mt-4 bg-zinc-800/30 border border-zinc-700/60 rounded-xl p-4">
                                <p className="text-sm font-semibold text-zinc-200">{selectedJurisdictionLabel}</p>
                                <p className="text-xs text-zinc-500 mt-1">
                                    {selectedJurisdiction?.description || 'Automatic tax calculation depends on the selected rule below.'}
                                </p>
                                {selectedJurisdictionVersion ? (
                                    <p className="text-xs text-zinc-500 mt-2">
                                        Currently published: {selectedJurisdictionVersion.label} (v{selectedJurisdictionVersion.versionNumber}). Payroll selects the pay-date effective version automatically.
                                    </p>
                                ) : (
                                    <p className="text-xs text-amber-300 mt-2">
                                        This employee still needs a published tax rule before automatic payroll withholding can run cleanly.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                                Payroll Flags
                            </h3>

                            <div className="space-y-3">
                                <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                    <span className="text-zinc-300 text-sm">Include in Next Run</span>
                                    <input
                                        type="checkbox"
                                        checked={formData.payrollFlags?.includeInNextRun !== false}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            payrollFlags: {
                                                ...formData.payrollFlags,
                                                includeInNextRun: e.target.checked,
                                                excludeFromNextRun: !e.target.checked
                                            }
                                        })}
                                        className="rounded bg-zinc-900 border-zinc-700"
                                    />
                                </label>

                                <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                    <span className="text-zinc-300 text-sm">Hold Payment</span>
                                    <input
                                        type="checkbox"
                                        checked={!!formData.payrollFlags?.holdPayment}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            payrollFlags: {
                                                ...formData.payrollFlags,
                                                holdPayment: e.target.checked
                                            }
                                        })}
                                        className="rounded bg-zinc-900 border-zinc-700"
                                    />
                                </label>

                                {formData.payrollFlags?.holdPayment && (
                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1.5">Hold Reason</label>
                                        <input
                                            type="text"
                                            value={formData.payrollFlags?.holdReason || ''}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                payrollFlags: {
                                                    ...formData.payrollFlags,
                                                    holdReason: e.target.value
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 outline-none"
                                            placeholder="e.g. On leave without pay clarification"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Main Form */}
                    <div className="min-w-0 space-y-6">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Employee Setup</h3>
                                    <p className="text-sm text-zinc-500">Complete payroll-required employee details and sync them back to IDP</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Full Name</label>
                                    <input
                                        type="text"
                                        value={setupData.name}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            name: e.target.value
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Designation</label>
                                    <input
                                        type="text"
                                        value={setupData.designation}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            designation: e.target.value
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Employee ID</label>
                                    <input
                                        type="text"
                                        value={setupData.employeeId}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            employeeId: e.target.value
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date of Birth</label>
                                    <input
                                        type="date"
                                        value={setupData.personalInfo?.dateOfBirth || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                dateOfBirth: e.target.value
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Mobile Phone</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.phoneNumbers?.mobile || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                phoneNumbers: {
                                                    ...setupData.personalInfo.phoneNumbers,
                                                    mobile: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Payroll Country</label>
                                    <select
                                        value={normalizePayrollBankCountry(setupData.personalInfo?.mailingAddress?.country || 'Other')}
                                        onChange={(e) => handlePayrollCountryChange(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    >
                                        {PAYROLL_BANK_JURISDICTIONS.map((countryOption: any) => (
                                            <option key={countryOption.value} value={countryOption.value}>{countryOption.label}</option>
                                        ))}
                                    </select>
                                    <p className="mt-1.5 text-xs text-zinc-500">
                                        {automaticCountryDefaults.label} sets {automaticCountryDefaults.currency || 'the local currency'}, the matching tax rules, statutory defaults, and local bank fields. {automaticEmployer ? `Employer: ${automaticEmployer.legalName}.` : 'A safe draft employer setup will be created when you save.'}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Street Address</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.street || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    street: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Address Line 2</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.street2 || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    street2: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">City</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.city || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    city: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">State / Region</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.state || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    state: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Postal Code</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.zipCode || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    zipCode: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                                <h4 className="text-sm font-semibold text-zinc-200 mb-3">Emergency Contact</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Name</label>
                                        <input
                                            type="text"
                                            value={setupData.personalInfo?.emergencyContact?.name || ''}
                                            onChange={(e) => setSetupData({
                                                ...setupData,
                                                personalInfo: {
                                                    ...setupData.personalInfo,
                                                    emergencyContact: {
                                                        ...setupData.personalInfo.emergencyContact,
                                                        name: e.target.value
                                                    }
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Relationship</label>
                                        <input
                                            type="text"
                                            value={setupData.personalInfo?.emergencyContact?.relationship || ''}
                                            onChange={(e) => setSetupData({
                                                ...setupData,
                                                personalInfo: {
                                                    ...setupData.personalInfo,
                                                    emergencyContact: {
                                                        ...setupData.personalInfo.emergencyContact,
                                                        relationship: e.target.value
                                                    }
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Phone</label>
                                        <input
                                            type="text"
                                            value={setupData.personalInfo?.emergencyContact?.phone || ''}
                                            onChange={(e) => setSetupData({
                                                ...setupData,
                                                personalInfo: {
                                                    ...setupData.personalInfo,
                                                    emergencyContact: {
                                                        ...setupData.personalInfo.emergencyContact,
                                                        phone: e.target.value
                                                    }
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Email</label>
                                        <input
                                            type="email"
                                            value={setupData.personalInfo?.emergencyContact?.email || ''}
                                            onChange={(e) => setSetupData({
                                                ...setupData,
                                                personalInfo: {
                                                    ...setupData.personalInfo,
                                                    emergencyContact: {
                                                        ...setupData.personalInfo.emergencyContact,
                                                        email: e.target.value
                                                    }
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4">
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Dependents Declaration</label>
                                <select
                                    value={setupData.dependentsDeclarationStatus}
                                    onChange={(e) => setSetupData({
                                        ...setupData,
                                        dependentsDeclarationStatus: e.target.value
                                    })}
                                    disabled={Number(profileCompletion?.dependentsCount || 0) > 0}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none disabled:opacity-60"
                                >
                                    <option value="pending">Still needs dependents confirmation</option>
                                    <option value="none">No dependents to add</option>
                                    {Number(profileCompletion?.dependentsCount || 0) > 0 && (
                                        <option value="provided">Dependents already provided</option>
                                    )}
                                </select>
                                <p className="mt-2 text-xs text-zinc-500">
                                    {Number(profileCompletion?.dependentsCount || 0) > 0
                                        ? `This employee already has ${profileCompletion?.dependentsCount} dependent(s) on record in IDP.`
                                        : 'Use "No dependents to add" when HR has confirmed there is nothing else to collect.'}
                                </p>
                            </div>
                        </div>

                        {/* Compensation */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                    <DollarSign className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Compensation</h3>
                                    <p className="text-sm text-zinc-500">Define how regular pay is earned and audited</p>
                                </div>
                            </div>

                            <div className="mb-5 border border-zinc-800 bg-zinc-950/40 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h4 className="text-sm font-semibold text-zinc-200">Legal employer and tax presence</h4>
                                        <p className="mt-1 text-xs text-zinc-500">The company or registered branch that employs this person controls the statutory jurisdiction and payroll currency.</p>
                                    </div>
                                    <Link href="/admin/settings/employer-entities" className="inline-flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-amber-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">Manage</Link>
                                </div>
                                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <label className="text-sm text-zinc-400">
                                        Legal employer
                                        <select
                                            value={formData.employerEntityId || ''}
                                            onChange={(event) => handleEmployerEntityChange(event.target.value)}
                                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-200 focus:border-amber-500 focus:outline-none"
                                        >
                                            <option value="">Not assigned — excluded from payroll</option>
                                            {employerEntities.filter((entity) => entity.status !== 'inactive').map((entity) => (
                                                <option key={entity._id} value={entity._id}>{entity.legalName} — {entity.jurisdictionCode} / {entity.defaultCurrency}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="text-sm text-zinc-400">
                                        Determination evidence reference
                                        <input
                                            value={formData.taxAssignment?.evidenceReference || ''}
                                            onChange={(event) => setFormData((current: any) => ({ ...current, taxAssignment: { ...current.taxAssignment, evidenceReference: event.target.value } }))}
                                            placeholder="Employment contract or mobility review reference"
                                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-200 focus:border-amber-500 focus:outline-none"
                                        />
                                    </label>
                                    <label className="text-sm text-zinc-400 md:col-span-2">
                                        Why this tax jurisdiction applies
                                        <input
                                            value={formData.taxAssignment?.determinationReason || ''}
                                            onChange={(event) => setFormData((current: any) => ({ ...current, taxAssignment: { ...current.taxAssignment, determinationReason: event.target.value } }))}
                                            placeholder="Employee works for and is paid by the UK subsidiary under UK PAYE"
                                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-200 focus:border-amber-500 focus:outline-none"
                                        />
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Currency</label>
                                    <select
                                        value={formData.currency}
                                        disabled
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 opacity-80"
                                    >
                                        {selectablePaymentCurrencies.map((currency) => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.label}{currency.enabled === false ? ' (not enabled)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="mt-1.5 text-xs text-zinc-500">Derived from the payroll country or legal employer.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Pay basis</label>
                                    <select
                                        value={formData.workTerms?.payBasis || 'salary'}
                                        onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, payBasis: e.target.value } })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    >
                                        <option value="salary">Monthly salary</option>
                                        <option value="hourly">Hourly rate</option>
                                        <option value="daily">Daily rate</option>
                                        <option value="fixed_contract">Fixed contract</option>
                                    </select>
                                </div>
                                {formData.workTerms?.payBasis === 'salary' ? <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Basic monthly salary</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formData.basicSalary}
                                        onChange={(e) => setFormData({ ...formData, basicSalary: Number(e.target.value) })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div> : formData.workTerms?.payBasis === 'fixed_contract' ? <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Contract amount</label>
                                    <input type="number" min="0" value={formData.workTerms?.contractAmount || 0}
                                        onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, contractAmount: Number(e.target.value) } })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none" />
                                </div> : <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">{formData.workTerms?.payBasis === 'hourly' ? 'Hourly' : 'Daily'} rate</label>
                                    <input type="number" min="0" value={formData.workTerms?.rate || 0}
                                        onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, rate: Number(e.target.value) } })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none" />
                                </div>}
                            </div>
                            {(profile?.employeeInfo?.employmentType === 'contract' || formData.workTerms?.payBasis === 'fixed_contract') && (
                                <div className="mt-5 pt-5 border-t border-zinc-800">
                                    <div className="flex items-center justify-between mb-3">
                                        <div>
                                            <h4 className="text-sm font-medium text-zinc-200">Contract period</h4>
                                            <p className="text-xs text-zinc-500 mt-0.5">Staff are included only in payroll periods that overlap these dates.</p>
                                        </div>
                                        <span className="text-xs text-amber-400">{profile?.employeeInfo?.employmentType === 'contract' ? 'Contract staff' : 'Fixed-term pay'}</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <input type="text" placeholder="Contract reference" value={formData.workTerms?.contractReference || ''}
                                            onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, contractReference: e.target.value } })}
                                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 outline-none focus:border-amber-500" />
                                        <input type="date" value={formData.workTerms?.contractStartDate || ''}
                                            onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, contractStartDate: e.target.value } })}
                                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 outline-none focus:border-amber-500" />
                                        <input type="date" value={formData.workTerms?.contractEndDate || ''}
                                            onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, contractEndDate: e.target.value } })}
                                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 outline-none focus:border-amber-500" />
                                    </div>
                                    {formData.workTerms?.payBasis === 'fixed_contract' && (
                                        <label className="flex items-center gap-2 mt-3 text-sm text-zinc-400">
                                            <input type="checkbox" checked={formData.workTerms?.contractAmountFrequency === 'pay_period'}
                                                onChange={(e) => setFormData({ ...formData, workTerms: { ...formData.workTerms, contractAmountFrequency: e.target.checked ? 'pay_period' : 'contract_total' } })} />
                                            Pay this amount every payroll period (otherwise spread the total across the contract dates)
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Allowances */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500">
                                    <Plus className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Allowances</h3>
                                    <p className="text-sm text-zinc-500">Recurring allowances added to gross pay</p>
                                </div>
                            </div>

                            {/* List Existing */}
                            <div className="space-y-3 mb-6">
                                {(formData.allowances || []).map((allowance: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-zinc-200">{allowance.name}</span>
                                                <span className="text-[10px] bg-zinc-900/60 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50 uppercase">
                                                    {String(allowance.type || 'other')}
                                                </span>
                                                <span className="text-[10px] bg-zinc-900/60 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50">
                                                    {taxTreatmentLabels[(allowance.taxTreatment || (allowance.isTaxable === false ? 'non_taxable' : 'taxable')) as PayComponentTaxTreatment] || 'Review treatment'}
                                                </span>
                                                {allowance.isActive === false && (
                                                    <span className="text-[10px] bg-zinc-500/10 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-500/20">INACTIVE</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-zinc-500 mt-1">
                                                {formatCurrencyAmount(allowance.amount || 0, formData.currency)}
                                                {allowance.paymentKind === 'non_cash' && <span className="ml-2">Non-cash</span>}
                                                {allowance.taxTreatment === 'partially_taxable' && <span className="ml-2">{Number(allowance.taxablePercentage || 0)}% taxable</span>}
                                                {allowance.effectiveFrom && <span className="ml-2">From {new Date(allowance.effectiveFrom).toLocaleDateString()}</span>}
                                                {allowance.effectiveTo && <span className="ml-2">To {new Date(allowance.effectiveTo).toLocaleDateString()}</span>}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeAllowance(idx)}
                                            className="text-zinc-500 hover:text-red-400 p-2 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {(formData.allowances || []).length === 0 && (
                                    <p className="text-sm text-zinc-500 italic text-center py-2">No allowances configured</p>
                                )}
                            </div>

                            {/* Add New */}
                            <div className="bg-zinc-800/20 rounded-lg p-4 border border-zinc-700/50">
                                <h4 className="text-sm font-medium text-zinc-300 mb-3">Add Allowance</h4>

                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <select
                                        value={newAllowance.type}
                                        onChange={e => setNewAllowance({
                                            ...newAllowance,
                                            type: e.target.value,
                                            classificationCode: allowanceClassificationByType[e.target.value] || 'cash_allowance',
                                            taxTreatment: isStatutorilyTaxableClassification(allowanceClassificationByType[e.target.value] || 'cash_allowance')
                                                ? 'jurisdiction_default'
                                                : newAllowance.taxTreatment,
                                        })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    >
                                        <option value="hra">HRA</option>
                                        <option value="transport">Transport</option>
                                        <option value="meal">Meal</option>
                                        <option value="phone">Phone</option>
                                        <option value="medical">Medical</option>
                                        <option value="education">Education</option>
                                        <option value="special">Special</option>
                                        <option value="other">Other</option>
                                    </select>
                                    <input
                                        type="text"
                                        placeholder="Name (optional)"
                                        value={newAllowance.name}
                                        onChange={e => setNewAllowance({ ...newAllowance, name: e.target.value })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Amount"
                                        value={newAllowance.amount}
                                        onChange={e => setNewAllowance({ ...newAllowance, amount: Number(e.target.value) })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    />
                                    <select
                                        value={newAllowance.paymentKind}
                                        onChange={(e) => setNewAllowance({ ...newAllowance, paymentKind: e.target.value })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    >
                                        <option value="cash">Paid in cash</option>
                                        <option value="non_cash">Non-cash value</option>
                                    </select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Tax classification</label>
                                        <input
                                            value={newAllowance.classificationCode}
                                            onChange={(e) => {
                                                const classificationCode = e.target.value.toLowerCase();
                                                setNewAllowance({
                                                    ...newAllowance,
                                                    classificationCode,
                                                    taxTreatment: isStatutorilyTaxableClassification(classificationCode)
                                                        ? 'jurisdiction_default'
                                                        : newAllowance.taxTreatment,
                                                });
                                            }}
                                            placeholder="e.g. housing_allowance"
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Tax treatment</label>
                                        <select
                                            value={newAllowance.taxTreatment}
                                            onChange={(e) => setNewAllowance({ ...newAllowance, taxTreatment: e.target.value as PayComponentTaxTreatment })}
                                            disabled={newAllowanceTreatmentLocked}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        >
                                            {Object.entries(taxTreatmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                        </select>
                                        {newAllowanceTreatmentLocked && <p className="mt-1 text-xs text-zinc-500">This statutory classification is always taxable; change the controlled classification to correct a miscoding.</p>}
                                    </div>
                                </div>

                                {newAllowance.taxTreatment === 'partially_taxable' && (
                                    <div className="mb-3">
                                        <label className="text-xs text-zinc-500 block mb-1">Taxable percentage</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="99"
                                            value={newAllowance.taxablePercentage}
                                            onChange={(e) => setNewAllowance({ ...newAllowance, taxablePercentage: Number(e.target.value) })}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                    </div>
                                )}

                                {newAllowance.taxTreatment !== 'jurisdiction_default' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                        <div>
                                            <label className="text-xs text-zinc-400 block mb-1">Legal reason</label>
                                            <input
                                                value={newAllowance.taxAuthorityReason}
                                                onChange={(e) => setNewAllowance({ ...newAllowance, taxAuthorityReason: e.target.value })}
                                                placeholder="Why this treatment applies"
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-zinc-400 block mb-1">Evidence reference</label>
                                            <input
                                                value={newAllowance.taxEvidenceReference}
                                                onChange={(e) => setNewAllowance({ ...newAllowance, taxEvidenceReference: e.target.value })}
                                                placeholder="Policy, ruling, or document"
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Effective From (Optional)</label>
                                        <input
                                            type="date"
                                            value={newAllowance.effectiveFrom}
                                            onChange={e => setNewAllowance({ ...newAllowance, effectiveFrom: e.target.value })}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Effective To (Optional)</label>
                                        <input
                                            type="date"
                                            value={newAllowance.effectiveTo}
                                            onChange={e => setNewAllowance({ ...newAllowance, effectiveTo: e.target.value })}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={addAllowance}
                                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-zinc-200 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Allowance
                                </button>
                            </div>
                        </div>

                        {/* Taxable and non-taxable benefits */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-start gap-3 mb-6">
                                <FileText className="w-5 h-5 mt-0.5 text-amber-400" />
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Benefits and benefits in kind</h3>
                                    <p className="text-sm text-zinc-500 mt-1">Record fair value separately from cash pay and apply the jurisdiction rule or a documented override.</p>
                                </div>
                            </div>

                            <div className="space-y-3 mb-6">
                                {(formData.benefitItems || []).map((benefit: any, idx: number) => (
                                    <div key={benefit._id || `${benefit.classificationCode}-${idx}`} className="flex flex-col gap-3 bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-zinc-200">{benefit.name}</span>
                                                <span className="text-[10px] bg-zinc-900/60 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50">
                                                    {benefit.classificationCode || 'Unclassified'}
                                                </span>
                                                <span className="text-[10px] bg-zinc-900/60 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50">
                                                    {taxTreatmentLabels[(benefit.taxTreatment || 'jurisdiction_default') as PayComponentTaxTreatment] || 'Review treatment'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-zinc-500 mt-1">
                                                Fair value {formatCurrencyAmount(benefit.fairValue || 0, formData.currency)}
                                                <span className="ml-2">{benefit.cashPayable ? 'Included in cash pay' : 'Non-cash benefit'}</span>
                                                {Number(benefit.employerPaidAmount || 0) > 0 && <span className="ml-2">Employer paid {formatCurrencyAmount(benefit.employerPaidAmount, formData.currency)}</span>}
                                            </div>
                                            {benefit.taxTreatment === 'partially_taxable' && <p className="mt-1 text-xs text-zinc-500">{Number(benefit.taxablePercentage || 0)}% taxable</p>}
                                            {Array.isArray(benefit.taxTreatmentOverrides) && benefit.taxTreatmentOverrides.length > 0 ? (
                                                <p className="mt-1 text-xs text-amber-300">{benefit.taxTreatmentOverrides.length} month-specific tax rule{benefit.taxTreatmentOverrides.length === 1 ? '' : 's'}</p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeBenefit(idx)}
                                            className="self-end text-zinc-500 hover:text-red-400 p-2 transition-colors sm:self-auto"
                                            aria-label={`Remove ${benefit.name || 'benefit'}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {(formData.benefitItems || []).length === 0 && (
                                    <p className="text-sm text-zinc-500 text-center py-2">No benefits configured</p>
                                )}
                            </div>

                            <div className="bg-zinc-800/20 rounded-lg p-4 border border-zinc-700/50">
                                <h4 className="text-sm font-medium text-zinc-300 mb-3">Add benefit</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Name</label>
                                        <input
                                            value={newBenefit.name}
                                            onChange={(e) => setNewBenefit({ ...newBenefit, name: e.target.value })}
                                            placeholder="e.g. Company car"
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Tax classification</label>
                                        <input
                                            list="payroll-benefit-classifications"
                                            value={newBenefit.classificationCode}
                                            onChange={(e) => {
                                                const classificationCode = e.target.value.toLowerCase();
                                                setNewBenefit({
                                                    ...newBenefit,
                                                    classificationCode,
                                                    taxTreatment: isStatutorilyTaxableClassification(classificationCode)
                                                        ? 'jurisdiction_default'
                                                        : newBenefit.taxTreatment,
                                                    overridePeriodKey: isStatutorilyTaxableClassification(classificationCode)
                                                        ? ''
                                                        : newBenefit.overridePeriodKey,
                                                });
                                            }}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                        />
                                        <datalist id="payroll-benefit-classifications">
                                            <option value="benefit_in_kind" />
                                            <option value="company_car" />
                                            <option value="housing_benefit" />
                                            <option value="cheap_loan" />
                                            <option value="phone_benefit" />
                                            <option value="employer_medical_cover" />
                                            <option value="employer_meal" />
                                            <option value="business_expense_reimbursement" />
                                            <option value="statutory_reimbursement" />
                                        </datalist>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Fair value</label>
                                        <input type="number" min="0" step="0.01" value={newBenefit.fairValue}
                                            onChange={(e) => setNewBenefit({ ...newBenefit, fairValue: Number(e.target.value) })}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Employer-paid amount</label>
                                        <input type="number" min="0" step="0.01" value={newBenefit.employerPaidAmount}
                                            onChange={(e) => setNewBenefit({ ...newBenefit, employerPaidAmount: Number(e.target.value) })}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                                    </div>
                                    <label className="mt-5 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                                        <input type="checkbox" checked={newBenefit.cashPayable}
                                            onChange={(e) => setNewBenefit({ ...newBenefit, cashPayable: e.target.checked })}
                                            className="rounded bg-zinc-950 border-zinc-700" />
                                        Include in cash pay
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className="text-xs text-zinc-500 block mb-1">Tax treatment</label>
                                        <select value={newBenefit.taxTreatment}
                                            onChange={(e) => setNewBenefit({ ...newBenefit, taxTreatment: e.target.value as PayComponentTaxTreatment })}
                                            disabled={newBenefitTreatmentLocked}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                                            {Object.entries(taxTreatmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                        </select>
                                        {newBenefitTreatmentLocked && <p className="mt-1 text-xs text-zinc-500">This statutory classification is always taxable and cannot be reduced by an employee or monthly override.</p>}
                                    </div>
                                    {newBenefit.taxTreatment === 'partially_taxable' ? (
                                        <div>
                                            <label className="text-xs text-zinc-500 block mb-1">Taxable percentage</label>
                                            <input type="number" min="1" max="99" value={newBenefit.taxablePercentage}
                                                onChange={(e) => setNewBenefit({ ...newBenefit, taxablePercentage: Number(e.target.value) })}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                                        </div>
                                    ) : <div />}
                                </div>

                                {newBenefit.taxTreatment !== 'jurisdiction_default' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                        <div>
                                            <label className="text-xs text-zinc-400 block mb-1">Legal reason</label>
                                            <input value={newBenefit.taxAuthorityReason}
                                                onChange={(e) => setNewBenefit({ ...newBenefit, taxAuthorityReason: e.target.value })}
                                                placeholder="Why this treatment applies"
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-zinc-400 block mb-1">Evidence reference</label>
                                            <input value={newBenefit.taxEvidenceReference}
                                                onChange={(e) => setNewBenefit({ ...newBenefit, taxEvidenceReference: e.target.value })}
                                                placeholder="Policy, ruling, or document"
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                    <div><label className="text-xs text-zinc-500 block mb-1">Effective from (optional)</label><input type="date" value={newBenefit.effectiveFrom} onChange={(e) => setNewBenefit({ ...newBenefit, effectiveFrom: e.target.value })} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div>
                                    <div><label className="text-xs text-zinc-500 block mb-1">Effective to (optional)</label><input type="date" value={newBenefit.effectiveTo} onChange={(e) => setNewBenefit({ ...newBenefit, effectiveTo: e.target.value })} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div>
                                </div>

                                {!newBenefitTreatmentLocked && <details className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                                    <summary className="cursor-pointer text-sm font-medium text-zinc-300">Month-specific tax treatment</summary>
                                    <p className="mt-1 text-xs text-zinc-500">Optional. Use this when one payroll month has a different documented treatment.</p>
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div><label className="text-xs text-zinc-500 block mb-1">Payroll month</label><input type="month" value={newBenefit.overridePeriodKey} onChange={(e) => setNewBenefit({ ...newBenefit, overridePeriodKey: e.target.value })} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div>
                                        <div><label className="text-xs text-zinc-500 block mb-1">Treatment</label><select value={newBenefit.overrideTaxTreatment} onChange={(e) => setNewBenefit({ ...newBenefit, overrideTaxTreatment: e.target.value as Exclude<PayComponentTaxTreatment, 'jurisdiction_default'> })} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"><option value="taxable">Taxable</option><option value="non_taxable">Non-taxable</option><option value="partially_taxable">Partially taxable</option></select></div>
                                        {newBenefit.overrideTaxTreatment === 'partially_taxable' ? <div><label className="text-xs text-zinc-500 block mb-1">Taxable percentage</label><input type="number" min="1" max="99" value={newBenefit.overrideTaxablePercentage} onChange={(e) => setNewBenefit({ ...newBenefit, overrideTaxablePercentage: Number(e.target.value) })} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div> : <div />}
                                        <div className="md:col-span-1"><label className="text-xs text-zinc-500 block mb-1">Legal reason</label><input value={newBenefit.overrideAuthorityReason} onChange={(e) => setNewBenefit({ ...newBenefit, overrideAuthorityReason: e.target.value })} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div>
                                        <div className="md:col-span-2"><label className="text-xs text-zinc-500 block mb-1">Evidence reference</label><input value={newBenefit.overrideEvidenceReference} onChange={(e) => setNewBenefit({ ...newBenefit, overrideEvidenceReference: e.target.value })} className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" /></div>
                                    </div>
                                </details>}

                                <button type="button" onClick={addBenefit}
                                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-zinc-200 transition-colors flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" /> Add benefit
                                </button>
                            </div>
                        </div>

                        {/* Deductions Manager */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
                                    <PiggyBank className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Recurring Deductions</h3>
                                    <p className="text-sm text-zinc-500">Manage loans, insurance, and other deductions</p>
                                </div>
                            </div>

                            {/* List Existing */}
                            <div className="space-y-3 mb-6">
                                {formData.recurringDeductions.map((deduction: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-zinc-200">{deduction.name}</span>
                                                {deduction.type === 'loan_repayment' && (
                                                    <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20">LOAN</span>
                                                )}
                                                {deduction.isPreTax && (
                                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">PRE-TAX</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-zinc-500 mt-1">
                                                {deduction.isPercentage ? `${deduction.percentage}% of Gross` : `${formData.currency}${deduction.amount} Fixed`}
                                                {deduction.type === 'loan_repayment' && (
                                                    <span className="ml-2">
                                                        (Balance: {formData.currency}{deduction.remainingAmount} / {formData.currency}{deduction.totalAmount})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeDeduction(idx)}
                                            className="text-zinc-500 hover:text-red-400 p-2 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {formData.recurringDeductions.length === 0 && (
                                    <p className="text-sm text-zinc-500 italic text-center py-2">No active deductions</p>
                                )}
                            </div>

                            {/* Add New */}
                            <div className="bg-zinc-800/20 rounded-lg p-4 border border-zinc-700/50">
                                <h4 className="text-sm font-medium text-zinc-300 mb-3">Add New Deduction</h4>
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <input
                                        type="text"
                                        placeholder="Name (e.g. Gym, Health Ins.)"
                                        value={newDeduction.name}
                                        onChange={e => setNewDeduction({ ...newDeduction, name: e.target.value })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    />
                                    <select
                                        value={newDeduction.type}
                                        onChange={e => setNewDeduction({ ...newDeduction, type: e.target.value })}
                                        className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                    >
                                        <option value="other">Custom/Other</option>
                                        <option value="health_insurance">Health Insurance</option>
                                        <option value="pension">Pension</option>
                                        <option value="union_dues">Union Dues</option>
                                    </select>
                                </div>

                                <div className="flex items-center gap-4 mb-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="isLoan"
                                            checked={newDeduction.isLoan}
                                            onChange={e => setNewDeduction({ ...newDeduction, isLoan: e.target.checked })}
                                            className="rounded bg-zinc-900 border-zinc-700"
                                        />
                                        <label htmlFor="isLoan" className="text-sm text-zinc-400">Is Loan?</label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="isPreTax"
                                            checked={newDeduction.isPreTax}
                                            onChange={e => setNewDeduction({ ...newDeduction, isPreTax: e.target.checked })}
                                            className="rounded bg-zinc-900 border-zinc-700"
                                        />
                                        <label htmlFor="isPreTax" className="text-sm text-zinc-400">Pre-Tax?</label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="isPercentage"
                                            checked={newDeduction.isPercentage}
                                            onChange={e => setNewDeduction({ ...newDeduction, isPercentage: e.target.checked })}
                                            className="rounded bg-zinc-900 border-zinc-700"
                                        />
                                        <label htmlFor="isPercentage" className="text-sm text-zinc-400">% Based?</label>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    {newDeduction.isPercentage ? (
                                        <div>
                                            <label className="text-xs text-zinc-500 block mb-1">Percentage (%)</label>
                                            <input
                                                type="number"
                                                placeholder="e.g. 5"
                                                value={newDeduction.percentage}
                                                onChange={e => setNewDeduction({ ...newDeduction, percentage: Number(e.target.value) })}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                            />
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="text-xs text-zinc-500 block mb-1">Monthly Amount</label>
                                            <input
                                                type="number"
                                                placeholder="Amount"
                                                value={newDeduction.amount}
                                                onChange={e => setNewDeduction({ ...newDeduction, amount: Number(e.target.value) })}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                            />
                                        </div>
                                    )}

                                    {newDeduction.isLoan && (
                                        <div>
                                            <label className="text-xs text-zinc-500 block mb-1">Total Loan Amount</label>
                                            <input
                                                type="number"
                                                placeholder="Total Loan Value"
                                                value={newDeduction.totalLoanAmount}
                                                onChange={e => setNewDeduction({ ...newDeduction, totalLoanAmount: Number(e.target.value) })}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                            />
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={addDeduction}
                                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-zinc-200 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Deduction
                                </button>
                            </div>
                        </div>

                        {/* Bank Details */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                                    <CreditCard className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Bank Details</h3>
                                    <p className="text-sm text-zinc-500">Primary account for salary deposit</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Bank Country</label>
                                        <select
                                            value={formData.bankAccount.country}
                                            disabled
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 opacity-80"
                                        >
                                            {PAYROLL_BANK_JURISDICTIONS.map((countryOption: any) => (
                                                <option key={countryOption.value} value={countryOption.value}>{countryOption.label}</option>
                                            ))}
                                        </select>
                                        <p className="mt-1.5 text-xs text-zinc-500">Matches the employee payroll country automatically.</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Account Holder Name</label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.accountHolderName}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, accountHolderName: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Bank Name</label>
                                        {formData.bankAccount.country === 'Nigeria' ? (
                                            <select
                                                value={formData.bankAccount.bankCode || ''}
                                                onChange={(e) => {
                                                    const bank = NIGERIAN_BANK_OPTIONS.find((option: any) => option.code === e.target.value);
                                                    setFormData({
                                                        ...formData,
                                                        bankAccount: {
                                                            ...formData.bankAccount,
                                                            bankCode: bank?.code || '',
                                                            bankName: bank?.name || '',
                                                        },
                                                    });
                                                }}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            >
                                                <option value="">Select a bank</option>
                                                {formData.bankAccount.bankCode
                                                    && !NIGERIAN_BANK_OPTIONS.some((bank: any) => bank.code === formData.bankAccount.bankCode) ? (
                                                        <option value={formData.bankAccount.bankCode}>
                                                            {formData.bankAccount.bankName || `Existing bank (${formData.bankAccount.bankCode})`}
                                                        </option>
                                                    ) : null}
                                                {NIGERIAN_BANK_OPTIONS.map((bank: any) => (
                                                    <option key={bank.code} value={bank.code}>{bank.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={formData.bankAccount.bankName}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    bankAccount: { ...formData.bankAccount, bankName: e.target.value }
                                                })}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                placeholder="Bank name"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Account Type</label>
                                        <select
                                            value={formData.bankAccount.accountType}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, accountType: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        >
                                            {getPayrollBankAccountTypes(formData.bankAccount.country).map((accountTypeOption: any) => (
                                                <option key={accountTypeOption.value} value={accountTypeOption.value}>
                                                    {accountTypeOption.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                            {getPayrollBankJurisdiction(formData.bankAccount.country).accountNumberLabel || 'Account Number'}
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.accountNumber}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, accountNumber: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            placeholder={getPayrollBankJurisdiction(formData.bankAccount.country).accountNumberPlaceholder || 'Account number'}
                                        />
                                        {getPayrollBankJurisdiction(formData.bankAccount.country).accountNumberHint ? (
                                            <p className="mt-1.5 text-xs text-zinc-500">{getPayrollBankJurisdiction(formData.bankAccount.country).accountNumberHint}</p>
                                        ) : null}
                                    </div>
                                    {getPayrollBankJurisdiction(formData.bankAccount.country).localField ? (
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                                {getPayrollBankJurisdiction(formData.bankAccount.country).localField?.label}
                                            </label>
                                            <input
                                                type="text"
                                                value={
                                                    getPayrollBankJurisdiction(formData.bankAccount.country).localField?.key === 'sortCode'
                                                        ? formData.bankAccount.sortCode
                                                        : getPayrollBankJurisdiction(formData.bankAccount.country).localField?.key === 'bankCode'
                                                            ? formData.bankAccount.bankCode
                                                            : formData.bankAccount.routingNumber
                                                }
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    bankAccount: {
                                                        ...formData.bankAccount,
                                                        sortCode: getPayrollBankJurisdiction(formData.bankAccount.country).localField?.key === 'sortCode' ? e.target.value : formData.bankAccount.sortCode,
                                                        bankCode: getPayrollBankJurisdiction(formData.bankAccount.country).localField?.key === 'bankCode' ? e.target.value : formData.bankAccount.bankCode,
                                                        routingNumber: getPayrollBankJurisdiction(formData.bankAccount.country).localField?.key === 'routingNumber' ? e.target.value : formData.bankAccount.routingNumber
                                                    }
                                                })}
                                                disabled={formData.bankAccount.country === 'Nigeria'}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none disabled:cursor-not-allowed disabled:opacity-70"
                                                placeholder={getPayrollBankJurisdiction(formData.bankAccount.country).localField?.placeholder || 'Enter local bank code'}
                                            />
                                            <p className="text-xs text-zinc-500 mt-1.5">
                                                {formData.bankAccount.country === 'Nigeria'
                                                    ? 'Filled automatically from the selected Nigerian bank.'
                                                    : getPayrollBankJurisdiction(formData.bankAccount.country).localField?.hint}
                                            </p>
                                        </div>
                                    ) : null}
                                    {getPayrollBankJurisdiction(formData.bankAccount.country).supportsIban ? <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">IBAN</label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.iban}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, iban: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div> : null}
                                    {getPayrollBankJurisdiction(formData.bankAccount.country).supportsSwift ? <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">BIC / SWIFT</label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.bicSwift}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, bicSwift: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div> : null}
                                </div>
                            </div>
                        </div>

                        {/* Tax & Statutory */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Tax Configuration</h3>
                                    <p className="text-sm text-zinc-500">Configure tax calculation and statutory contributions</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Tax ID / SSN / TIN</label>
                                    <input
                                        type="text"
                                        value={formData.taxConfig.taxId}
                                        onChange={(e) => updateTaxConfig({ taxId: e.target.value })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        placeholder="e.g. XXX-XX-XXXX"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Employee Tax Rule</label>
                                    <div className="min-h-11 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200">
                                        {selectedJurisdictionLabel}
                                    </div>
                                    <p className="text-xs text-zinc-500 mt-1.5">
                                        Selected automatically from the payroll country and legal employer.
                                    </p>
                                </div>

                                <div className="md:col-span-2 rounded-xl border border-zinc-700/60 bg-zinc-800/30 p-4">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p className="text-sm font-semibold text-zinc-200">{selectedJurisdictionLabel}</p>
                                            <p className="text-xs text-zinc-500 mt-1">
                                                {selectedJurisdiction?.description || 'Pick a published tax rule to calculate withholding automatically.'}
                                            </p>
                                            {selectedJurisdictionVersion ? (
                                                <p className="text-xs text-zinc-500 mt-2">
                                                    Currently published: v{selectedJurisdictionVersion.versionNumber} · {selectedJurisdictionVersion.label}. Employee profiles do not pin a version.
                                                </p>
                                            ) : null}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                                                {selectedJurisdiction?.scope === 'organization' ? 'Org Rule' : 'Seeded Rule'}
                                            </span>
                                            <Link
                                                href="/admin/settings/tax"
                                                className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900/70 text-sm text-zinc-200 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
                                            >
                                                Manage Tax Rules
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {taxValidationMessages.length > 0 && (
                                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                                    <p className="text-xs uppercase tracking-wide text-amber-300 mb-2">Tax Rule Attention Needed</p>
                                    <div className="space-y-1 text-sm text-amber-100">
                                        {taxValidationMessages.map((message: string, index: number) => (
                                            <p key={`${message}-${index}`}>{message}</p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-4 rounded-xl border border-zinc-700/60 bg-zinc-950/40 p-4">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div>
                                        <h4 className="text-sm font-semibold text-zinc-200">Estimated Tax This Pay Period</h4>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            This preview uses the current salary, allowances, deductions, statutory settings, and the selected jurisdiction rule.
                                        </p>
                                    </div>
                                    <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                                        {selectedJurisdictionVersion ? 'Configured Rule' : 'Needs Configuration'}
                                    </span>
                                </div>

                                {taxPreviewLoading ? (
                                    <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Calculating preview...
                                    </div>
                                ) : taxPreviewError ? (
                                    <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                                        {taxPreviewError}
                                    </div>
                                ) : taxPreview ? (
                                    <>
                                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                                                <p className="text-xs uppercase tracking-wide text-zinc-500">Gross Pay</p>
                                                <p className="mt-1 text-lg font-semibold text-zinc-100">
                                                    {formatCurrencyAmount(taxPreview.summary?.grossPay, taxPreview.currency || formData.currency)}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                                                <p className="text-xs uppercase tracking-wide text-zinc-500">Income Tax</p>
                                                <p className="mt-1 text-lg font-semibold text-amber-300">
                                                    {formatCurrencyAmount(taxPreview.summary?.incomeTax, taxPreview.currency || formData.currency)}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                                                <p className="text-xs uppercase tracking-wide text-zinc-500">Statutory Deductions</p>
                                                <p className="mt-1 text-lg font-semibold text-zinc-100">
                                                    {formatCurrencyAmount(taxPreview.summary?.statutoryDeductions, taxPreview.currency || formData.currency)}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                                                <p className="text-xs uppercase tracking-wide text-zinc-500">Estimated Net Pay</p>
                                                <p className="mt-1 text-lg font-semibold text-emerald-300">
                                                    {formatCurrencyAmount(taxPreview.summary?.estimatedNetPay, taxPreview.currency || formData.currency)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                                                <h5 className="text-sm font-semibold text-zinc-200 mb-3">Calculation Breakdown</h5>
                                                <div className="space-y-2 text-sm">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Taxable earnings</span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.summary?.taxableEarnings, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Pre-tax recurring deductions</span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.summary?.recurringPreTaxDeductions, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">
                                                            {statutoryProfile.code === 'NG' ? 'Employee pension' : 'Employee retirement'}
                                                        </span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.summary?.employeePensionAmount, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">
                                                            {statutoryProfile.code === 'NG' ? 'Employer pension' : 'Employer retirement'}
                                                        </span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.summary?.employerPensionAmount, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Post-tax recurring deductions</span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.summary?.recurringPostTaxDeductions, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-2">
                                                        <span className="text-zinc-400">Estimated employee deductions</span>
                                                        <span className="font-medium text-zinc-100">{formatCurrencyAmount(taxPreview.summary?.estimatedEmployeeDeductions, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                                                <h5 className="text-sm font-semibold text-zinc-200 mb-3">Jurisdiction Detail</h5>
                                                <div className="space-y-2 text-sm">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Rule</span>
                                                        <span className="text-zinc-200">{taxPreview.incomeTax?.jurisdictionName || selectedJurisdictionLabel}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Method</span>
                                                        <span className="text-zinc-200">{taxPreview.incomeTax?.method || 'configured_rule'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Rule version</span>
                                                        <span className="text-zinc-200">
                                                            {taxPreview.jurisdictionVersion
                                                                ? `${taxPreview.jurisdictionVersion.label} (v${taxPreview.jurisdictionVersion.versionNumber})`
                                                                : (selectedJurisdictionVersion ? `${selectedJurisdictionVersion.label} (v${selectedJurisdictionVersion.versionNumber})` : 'Not published')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-zinc-500">Annualized taxable income</span>
                                                        <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.incomeTax?.annualizedTaxableIncome, taxPreview.currency || formData.currency)}</span>
                                                    </div>
                                                    {taxPreview.incomeTax?.details?.consolidatedReliefAllowance !== undefined && (
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-zinc-500">Consolidated relief allowance</span>
                                                            <span className="text-zinc-200">{formatCurrencyAmount(taxPreview.incomeTax.details.consolidatedReliefAllowance, taxPreview.currency || formData.currency)}</span>
                                                        </div>
                                                    )}
                                                    {taxPreview.pension?.enabled && (
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-zinc-500">Retirement source</span>
                                                            <span className="text-zinc-200">
                                                                {taxPreview.pension?.source === 'builtin_default' ? 'Built-in default' : 'Custom rate'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                {Array.isArray(taxPreview.statutoryContributions?.components) && taxPreview.statutoryContributions.components.length > 0 && (
                                                    <div className="mt-4 border-t border-zinc-800 pt-3">
                                                        <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Statutory Components</p>
                                                        <div className="space-y-2">
                                                            {taxPreview.statutoryContributions.components.map((component: any, index: number) => (
                                                                <div key={`${component.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                                                                    <span className="text-zinc-400">{component.name}</span>
                                                                    <span className="text-zinc-200">{formatCurrencyAmount(component.amount, taxPreview.currency || formData.currency)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {Array.isArray(taxPreview.incomeTax?.notes) && taxPreview.incomeTax.notes.length > 0 && (
                                            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
                                                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Calculation Notes</p>
                                                <div className="space-y-1 text-sm text-zinc-400">
                                                    {taxPreview.incomeTax.notes.map((note: string, index: number) => (
                                                        <p key={`${note}-${index}`}>{note}</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : null}
                            </div>

                            <div className="mt-4 space-y-4 border-t border-zinc-800/70 pt-6">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                        <h4 className="text-sm font-semibold text-zinc-300">Employee Tax Inputs</h4>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            These fields come from the selected jurisdiction rule. Currency values default to the pack calculation currency
                                            {selectedJurisdictionVersion?.calculationCurrency ? ` (${selectedJurisdictionVersion.calculationCurrency})` : ''}, not the employee payment currency, unless the field says otherwise.
                                        </p>
                                    </div>
                                    <Link
                                        href="/admin/settings/tax"
                                        className="text-sm text-amber-300 hover:text-amber-200 transition-colors"
                                    >
                                        Edit formulas and field schema
                                    </Link>
                                </div>

                                {!selectedJurisdictionVersion ? (
                                    <div className="rounded-lg border border-dashed border-zinc-700/70 p-4 text-sm text-zinc-500">
                                        Select a tax rule with a published version before payroll can calculate automatically for this employee.
                                    </div>
                                ) : selectedTaxFields.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-zinc-700/70 p-4 text-sm text-zinc-500">
                                        This jurisdiction rule does not require employee-specific tax inputs.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {selectedTaxFields.map((field) => {
                                            const currentValue = formData.taxConfig.employeeTaxInputs?.[field.key]
                                                ?? field.defaultValue
                                                ?? (field.type === 'boolean' ? false : '');
                                            const isNumericField = ['currency', 'percent', 'integer'].includes(field.type);
                                            const inputType = field.type === 'date'
                                                ? 'date'
                                                : (isNumericField ? 'number' : 'text');
                                            const fieldCurrencyCode = resolveTaxFieldCurrencyCode(field, {
                                                calculationCurrency: selectedJurisdictionVersion?.calculationCurrency,
                                                payrollCurrency: formData.currency,
                                            });
                                            const fieldCurrencyHelp = describeTaxFieldCurrency(field, {
                                                calculationCurrency: selectedJurisdictionVersion?.calculationCurrency,
                                                payrollCurrency: formData.currency,
                                            });

                                            if (field.type === 'boolean') {
                                                return (
                                                    <label
                                                        key={field.key}
                                                        className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50"
                                                    >
                                                        <div className="pr-4">
                                                            <span className="text-sm text-zinc-300">{field.label}</span>
                                                            {field.helpText ? <p className="text-xs text-zinc-500 mt-1">{field.helpText}</p> : null}
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            checked={!!currentValue}
                                                            onChange={(e) => updateEmployeeTaxInput(field, e.target.checked)}
                                                            className="rounded bg-zinc-900 border-zinc-700"
                                                        />
                                                    </label>
                                                );
                                            }

                                            return (
                                                <div key={field.key}>
                                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                                        {field.label}
                                                        {field.type === 'currency' && fieldCurrencyCode ? ` (${fieldCurrencyCode})` : null}
                                                        {field.required ? <span className="text-amber-400 ml-1">*</span> : null}
                                                    </label>
                                                    {field.type === 'select' ? (
                                                        <select
                                                            value={String(currentValue ?? '')}
                                                            onChange={(e) => updateEmployeeTaxInput(field, e.target.value)}
                                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                        >
                                                            <option value="">Select</option>
                                                            {(field.options || []).map((option) => (
                                                                <option key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            type={inputType}
                                                            value={currentValue}
                                                            placeholder={field.placeholder || ''}
                                                            step={field.type === 'integer' ? '1' : (isNumericField ? '0.01' : undefined)}
                                                            onChange={(e) => updateEmployeeTaxInput(
                                                                field,
                                                                isNumericField
                                                                    ? (e.target.value === '' ? '' : Number(e.target.value))
                                                                    : e.target.value
                                                            )}
                                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                        />
                                                    )}
                                                    {field.type === 'currency' ? <p className="text-xs text-amber-200/80 mt-1.5">{fieldCurrencyHelp}</p> : null}
                                                    {field.helpText ? <p className="text-xs text-zinc-500 mt-1.5">{field.helpText}</p> : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 pt-6 border-t border-zinc-800/70">
                                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Statutory Contributions</h4>
                                <p className="text-xs text-zinc-500 mb-4">
                                    {statutoryProfile.intro}
                                </p>
                                {statutoryProfile.socialEnabled && (
                                    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/30 p-4 mb-4">
                                        <h5 className="text-sm font-semibold text-zinc-200 mb-1">{statutoryProfile.socialTitle}</h5>
                                        <p className="text-xs text-zinc-500 mb-4">
                                            {showLegacyStatutoryRateOverrides
                                                ? statutoryProfile.manualOverrideHelpText
                                                : 'Statutory contribution rates come from the selected tax rule. Manage rate and cap changes in Tax Rules.'}
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                                <span className="text-sm text-zinc-300">{statutoryProfile.socialOptInLabel}</span>
                                                <input
                                                    type="checkbox"
                                                    checked={formData.statutoryContributions.socialSecurityOptIn}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            socialSecurityOptIn: e.target.checked
                                                        }
                                                    })}
                                                    className="rounded bg-zinc-900 border-zinc-700"
                                                />
                                            </label>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">{statutoryProfile.socialIdentifierLabel}</label>
                                                <input
                                                    type="text"
                                                    value={formData.statutoryContributions.socialSecurityNumber}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            socialSecurityNumber: e.target.value
                                                        }
                                                    })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                    placeholder={statutoryProfile.socialIdentifierPlaceholder}
                                                />
                                            </div>

                                            {statutoryProfile.manualOverrideEnabled && showLegacyStatutoryRateOverrides && (
                                                <>
                                                    <div>
                                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">{statutoryProfile.manualRateLabel}</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            step="0.01"
                                                            value={formData.taxConfig.socialSecurityRate}
                                                            onChange={(e) => updateTaxConfig({ socialSecurityRate: Number(e.target.value) })}
                                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                        />
                                                    </div>

                                                    <div>
                                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">{statutoryProfile.manualCapLabel}</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={formData.taxConfig.socialSecurityCap}
                                                            onChange={(e) => updateTaxConfig({ socialSecurityCap: Number(e.target.value) })}
                                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                        />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {(hasRetirementConfig || statutoryProfile.retirementIsStatutory) && (
                                    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/30 p-4">
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div>
                                                <h5 className="text-sm font-semibold text-zinc-200 mb-1">{statutoryProfile.retirementTitle}</h5>
                                                <p className="text-xs text-zinc-500">{statutoryProfile.retirementDescription}</p>
                                            </div>
                                            {statutoryProfile.retirementIsStatutory && (
                                                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-emerald-300">
                                                    Built In
                                                </span>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                                <span className="text-sm text-zinc-300">{statutoryProfile.retirementOptInLabel}</span>
                                                <input
                                                    type="checkbox"
                                                    checked={formData.statutoryContributions.pensionOptIn}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            pensionOptIn: e.target.checked
                                                        }
                                                    })}
                                                    className="rounded bg-zinc-900 border-zinc-700"
                                                />
                                            </label>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">{statutoryProfile.retirementIdentifierLabel}</label>
                                                <input
                                                    type="text"
                                                    value={formData.statutoryContributions.pensionAccountNumber}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            pensionAccountNumber: e.target.value
                                                        }
                                                    })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                    placeholder={statutoryProfile.retirementIdentifierPlaceholder}
                                                    disabled={!formData.statutoryContributions.pensionOptIn}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                                    {statutoryProfile.code === 'NG' ? 'Employee Pension (%)' : 'Employee Retirement (%)'}
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={formData.statutoryContributions.pensionContributionPercent}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            pensionContributionPercent: Number(e.target.value)
                                                        }
                                                    })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                    disabled={!formData.statutoryContributions.pensionOptIn}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                                    {statutoryProfile.code === 'NG' ? 'Employer Pension (%)' : 'Employer Retirement (%)'}
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={formData.statutoryContributions.employerPensionPercent}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        statutoryContributions: {
                                                            ...formData.statutoryContributions,
                                                            employerPensionPercent: Number(e.target.value)
                                                        }
                                                    })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                    disabled={!formData.statutoryContributions.pensionOptIn}
                                                />
                                            </div>
                                        </div>

                                        {statutoryProfile.code === 'NG' && formData.statutoryContributions.pensionOptIn && !nigeriaPensionMeetsMinimum && (
                                            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                                                Nigeria pension usually needs at least 8% employee and 10% employer, or the employer can fully fund at least 18%. Adjust the rates if this employee is not on a documented exception.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
