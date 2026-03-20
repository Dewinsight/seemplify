'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, handleAuthCallback } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import {
    TaxFieldDefinition,
    TaxJurisdictionSummary,
    listTaxJurisdictions,
} from '@/lib/payrollTax';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';
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
        account?.accountHolderName,
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
    if (rawType === 'salary' || country === 'UK' || country === 'Nigeria') {
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
        jurisdictionVersionId: '',
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
        intro: 'Kenya PAYE is built in. Use manual statutory overrides only if you need an extra payroll withholding for local schemes.',
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
};

function normalizeJurisdictionCode(value: any): string {
    const raw = String(value || '').trim().toUpperCase();
    return COUNTRY_CODE_HINTS[raw] || raw;
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
    const publishedVersion = jurisdiction?.publishedVersion || null;
    const employeeTaxInputs = hydrateEmployeeTaxInputs(
        Array.isArray(publishedVersion?.fieldDefinitions) ? publishedVersion.fieldDefinitions : [],
        (rawTaxConfig?.employeeTaxInputs && typeof rawTaxConfig.employeeTaxInputs === 'object') ? rawTaxConfig.employeeTaxInputs : {},
        rawTaxConfig
    );

    return {
        ...getDefaultTaxConfig(),
        ...rawTaxConfig,
        calculationMode: 'configured',
        jurisdictionConfigId: jurisdiction?._id ? String(jurisdiction._id) : String(rawTaxConfig?.jurisdictionConfigId || ''),
        jurisdictionVersionId: publishedVersion?._id ? String(publishedVersion._id) : '',
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

    return {
        ...defaults,
        ...raw,
        calculationMode: 'configured',
        jurisdictionConfigId: String(raw?.jurisdictionConfigId || raw?.configId || ''),
        jurisdictionVersionId: String(raw?.jurisdictionVersionId || raw?.versionId || ''),
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

export default function EmployeeEditPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { currencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [setupData, setSetupData] = useState<any>(getDefaultSetupData());
    const [profileCompletion, setProfileCompletion] = useState<any>(null);
    const [idpSyncWarning, setIdpSyncWarning] = useState('');
    const [canSyncIdpProfile, setCanSyncIdpProfile] = useState(false);
    const [taxJurisdictions, setTaxJurisdictions] = useState<TaxJurisdictionSummary[]>([]);
    const [taxPreview, setTaxPreview] = useState<any>(null);
    const [taxPreviewLoading, setTaxPreviewLoading] = useState(false);
    const [taxPreviewError, setTaxPreviewError] = useState('');

    // Form State
    const [formData, setFormData] = useState<any>({
        basicSalary: 0,
        currency: 'USD',
        isActive: true,
        allowances: [] as any[],
        payrollFlags: {
            includeInNextRun: true,
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
    const [newAllowance, setNewAllowance] = useState({
        type: 'hra',
        name: '',
        amount: 0,
        isTaxable: true,
        effectiveFrom: '',
        effectiveTo: ''
    });

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

                const idpSync = res.data?.idpSync || null;
                const payrollSync = idpSync?.payrollSync || {};
                const syncedBankAccount = payrollSync?.banking?.accounts?.[0] || {};
                const payrollBankAccount = res.data.bankAccounts?.[0] || {};
                const resolvedCountry = String(
                    syncedBankAccount?.country
                    || payrollSync?.banking?.country
                    || 'USA'
                ).trim() || 'USA';
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
                    basicSalary: res.data.basicSalary || 0,
                    currency: res.data.currency || 'USD',
                    isActive: res.data.isActive !== false,
                    allowances: res.data.allowances || [],
                    payrollFlags: {
                        includeInNextRun: res.data.payrollFlags?.includeInNextRun !== false,
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
                        sortCode: syncedBankAccount?.sortCode || (resolvedCountry === 'UK' ? (payrollBankAccount?.branchCode || '') : ''),
                        iban: syncedBankAccount?.iban || payrollBankAccount?.iban || '',
                        bicSwift: syncedBankAccount?.bicSwift || payrollBankAccount?.swiftCode || '',
                        bankCode: syncedBankAccount?.bankCode || (resolvedCountry === 'Nigeria' ? (payrollBankAccount?.branchCode || '') : ''),
                        accountType: syncedBankAccount?.accountType || payrollBankAccount?.accountType || (resolvedCountry === 'USA' ? 'checking' : 'current')
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
                    recurringDeductions: formData.recurringDeductions,
                    taxConfig: {
                        ...formData.taxConfig,
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
            const bankCountry = String(formData.bankAccount?.country || 'USA').trim() || 'USA';
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
            } else {
                bankAccounts = [
                    {
                        bankName,
                        accountNumber: effectivePayrollAccountNumber,
                        routingNumber: routingNumber || undefined,
                        branchCode: (bankCountry === 'UK' ? sortCode : bankCountry === 'Nigeria' ? bankCode : '') || undefined,
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
                        status: setupData.dependentsDeclarationStatus
                    }
                } : {})
            } : undefined;

            await api.put(`/payroll/profiles/${params.id}`, {
                basicSalary: Number(formData.basicSalary),
                currency: formData.currency,
                isActive: formData.isActive,
                allowances: formData.allowances,
                payrollFlags: formData.payrollFlags,
                taxConfig: {
                    ...formData.taxConfig,
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
        if (!newAllowance.type) {
            alert('Please select an allowance type');
            return;
        }
        if (!(amount > 0)) {
            alert('Please enter a valid allowance amount');
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
            isTaxable: !!newAllowance.isTaxable,
            isActive: true,
        };

        if (newAllowance.effectiveFrom) payload.effectiveFrom = newAllowance.effectiveFrom;
        if (newAllowance.effectiveTo) payload.effectiveTo = newAllowance.effectiveTo;

        setFormData({
            ...formData,
            allowances: [...(formData.allowances || []), payload],
        });

        setNewAllowance({
            type: 'hra',
            name: '',
            amount: 0,
            isTaxable: true,
            effectiveFrom: '',
            effectiveTo: '',
        });
    };

    const removeAllowance = (index: number) => {
        const updated = [...(formData.allowances || [])];
        updated.splice(index, 1);
        setFormData({ ...formData, allowances: updated });
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

    const setJurisdictionConfig = (jurisdictionId: string) => {
        const nextJurisdiction = findJurisdictionById(taxJurisdictions, jurisdictionId)
            || findJurisdictionByCode(taxJurisdictions, jurisdictionId)
            || null;
        setFormData({
            ...formData,
            taxConfig: syncTaxConfigWithJurisdiction(formData.taxConfig, nextJurisdiction),
            statutoryContributions: normalizeStatutoryContributionsForJurisdiction(
                formData.statutoryContributions,
                nextJurisdiction?.countryCode || formData.taxConfig.jurisdictionCode
            )
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

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
            <div className="max-w-4xl mx-auto">
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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Sidebar Info */}
                    <div className="space-y-6">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
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

                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
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
                                        Active version: {selectedJurisdictionVersion.label} (v{selectedJurisdictionVersion.versionNumber})
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
                                                includeInNextRun: e.target.checked
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
                    <div className="md:col-span-2 space-y-6">
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
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Address Country</label>
                                    <input
                                        type="text"
                                        value={setupData.personalInfo?.mailingAddress?.country || ''}
                                        onChange={(e) => setSetupData({
                                            ...setupData,
                                            personalInfo: {
                                                ...setupData.personalInfo,
                                                mailingAddress: {
                                                    ...setupData.personalInfo.mailingAddress,
                                                    country: e.target.value
                                                }
                                            }
                                        })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        placeholder="e.g. Nigeria"
                                    />
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
                                    <p className="text-sm text-zinc-500">Set base salary and currency</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Currency</label>
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    >
                                        {currencies.map((currency) => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Basic Monthly Salary</label>
                                    <input
                                        type="number"
                                        value={formData.basicSalary}
                                        onChange={(e) => setFormData({ ...formData, basicSalary: Number(e.target.value) })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                            </div>
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
                                                {allowance.isTaxable === false && (
                                                    <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">NON-TAX</span>
                                                )}
                                                {allowance.isActive === false && (
                                                    <span className="text-[10px] bg-zinc-500/10 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-500/20">INACTIVE</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-zinc-500 mt-1">
                                                {formatCurrencyAmount(allowance.amount || 0, formData.currency)}
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
                                        onChange={e => setNewAllowance({ ...newAllowance, type: e.target.value })}
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
                                    <label className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                                        <input
                                            type="checkbox"
                                            checked={!!newAllowance.isTaxable}
                                            onChange={(e) => setNewAllowance({ ...newAllowance, isTaxable: e.target.checked })}
                                            className="rounded bg-zinc-950 border-zinc-700"
                                        />
                                        Taxable
                                    </label>
                                </div>

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
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: {
                                                    ...formData.bankAccount,
                                                    country: e.target.value,
                                                    accountType: e.target.value === 'USA' ? 'checking' : 'current'
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        >
                                            <option value="USA">USA</option>
                                            <option value="UK">UK</option>
                                            <option value="EU">EU</option>
                                            <option value="Nigeria">Nigeria</option>
                                            <option value="Other">Other</option>
                                        </select>
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
                                        <input
                                            type="text"
                                            value={formData.bankAccount.bankName}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, bankName: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            placeholder="e.g. Chase Bank"
                                        />
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
                                            {formData.bankAccount.country === 'USA' ? (
                                                <>
                                                    <option value="checking">Checking</option>
                                                    <option value="savings">Savings</option>
                                                </>
                                            ) : (
                                                <>
                                                    <option value="current">Current</option>
                                                    <option value="salary">Salary</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Account Number</label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.accountNumber}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, accountNumber: e.target.value }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                                            {formData.bankAccount.country === 'UK'
                                                ? 'Sort Code'
                                                : formData.bankAccount.country === 'Nigeria'
                                                    ? 'Bank Code'
                                                    : 'Routing Number'}
                                        </label>
                                        <input
                                            type="text"
                                            value={
                                                formData.bankAccount.country === 'UK'
                                                    ? formData.bankAccount.sortCode
                                                    : formData.bankAccount.country === 'Nigeria'
                                                        ? formData.bankAccount.bankCode
                                                        : formData.bankAccount.routingNumber
                                            }
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: {
                                                    ...formData.bankAccount,
                                                    sortCode: formData.bankAccount.country === 'UK' ? e.target.value : formData.bankAccount.sortCode,
                                                    bankCode: formData.bankAccount.country === 'Nigeria' ? e.target.value : formData.bankAccount.bankCode,
                                                    routingNumber: !['UK', 'Nigeria'].includes(formData.bankAccount.country) ? e.target.value : formData.bankAccount.routingNumber
                                                }
                                            })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>
                                    <div>
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
                                    </div>
                                    <div>
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
                                    </div>
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
                                    <select
                                        value={formData.taxConfig.jurisdictionConfigId || selectedJurisdiction?._id || ''}
                                        onChange={(e) => setJurisdictionConfig(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    >
                                        <option value="">Select a tax rule</option>
                                        {taxJurisdictions.map((jurisdiction) => (
                                            <option key={jurisdiction._id} value={jurisdiction._id}>
                                                {jurisdiction.scope === 'organization' ? '[Org] ' : '[Seeded] '}
                                                {jurisdiction.displayName}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-zinc-500 mt-1.5">
                                        Tax now follows the selected payroll jurisdiction rule. Manage formulas and country packs in Tax Rules.
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
                                                    Version {selectedJurisdictionVersion.versionNumber}: {selectedJurisdictionVersion.label}
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
                                            These fields come from the selected jurisdiction rule and are used directly in payroll tax formulas.
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
