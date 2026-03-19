'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, isAuthenticated } from '@/lib/api';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';
import {
    filingStatusOptions,
    isManualOnlyJurisdiction,
    manualTaxModeOptions,
    payrollTaxJurisdictions,
    residencyStatusOptions,
    ukTaxSubdivisionOptions
} from '@/lib/payrollTaxJurisdictions';
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

function getDefaultTaxConfig() {
    return {
        taxId: '',
        calculationMode: 'manual',
        jurisdictionCode: 'OTHER',
        jurisdictionName: '',
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

function mapTaxConfigForForm(raw: any = {}) {
    const defaults = getDefaultTaxConfig();
    const jurisdictionCode = String(raw?.jurisdictionCode || raw?.jurisdictionCountry || '').toUpperCase();
    const legacyRegime = String(raw?.calculationRegime || '').toLowerCase();

    let calculationMode = raw?.calculationMode || '';
    let manualCalculationType = raw?.manualCalculationType || '';
    let resolvedJurisdictionCode = jurisdictionCode || defaults.jurisdictionCode;

    if (!calculationMode) {
        if (legacyRegime === 'progressive_us') {
            calculationMode = 'builtin';
            resolvedJurisdictionCode = 'US';
        } else if (legacyRegime === 'progressive_uk') {
            calculationMode = 'builtin';
            resolvedJurisdictionCode = 'GB';
        } else if (legacyRegime === 'flat') {
            calculationMode = 'manual';
            manualCalculationType = 'flat';
        } else if (legacyRegime === 'none') {
            calculationMode = 'manual';
            manualCalculationType = 'none';
        } else if (legacyRegime === 'progressive_generic') {
            calculationMode = 'manual';
            manualCalculationType = 'progressive';
        }
    }

    if (!calculationMode) {
        calculationMode = isManualOnlyJurisdiction(resolvedJurisdictionCode) ? 'manual' : 'builtin';
    }

    if (!manualCalculationType) {
        manualCalculationType = 'progressive';
    }

    return {
        ...defaults,
        ...raw,
        calculationMode,
        jurisdictionCode: resolvedJurisdictionCode,
        jurisdictionName: raw?.jurisdictionName || '',
        taxSubdivision: raw?.taxSubdivision || 'standard',
        residencyStatus: raw?.residencyStatus || 'resident',
        filingStatus: raw?.filingStatus || 'single',
        dependents: Number(raw?.dependents || 0),
        additionalWithholding: Number(raw?.additionalWithholding || 0),
        manualCalculationType,
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

export default function EmployeeEditPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { currencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<any>(null);

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
            pensionOptIn: false,
            pensionContributionPercent: 0,
            employerPensionPercent: 0
        },
        bankAccount: {
            bankName: '',
            accountNumber: '',
            routingNumber: ''
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
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }

        const fetchProfile = async () => {
            try {
                const res = await api.get(`/payroll/profiles/${params.id}`);
                setProfile(res.data);

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
                    taxConfig: mapTaxConfigForForm(res.data.taxConfig),
                    statutoryContributions: {
                        socialSecurityOptIn: res.data.statutoryContributions?.socialSecurityOptIn !== false,
                        socialSecurityNumber: res.data.statutoryContributions?.socialSecurityNumber || '',
                        pensionOptIn: !!res.data.statutoryContributions?.pensionOptIn,
                        pensionContributionPercent: res.data.statutoryContributions?.pensionContributionPercent || 0,
                        employerPensionPercent: res.data.statutoryContributions?.employerPensionPercent || 0
                    },
                    bankAccount: {
                        bankName: res.data.bankAccounts?.[0]?.bankName || '',
                        accountNumber: res.data.bankAccounts?.[0]?.accountNumber || '',
                        routingNumber: res.data.bankAccounts?.[0]?.routingNumber || ''
                    },
                    recurringDeductions: res.data.recurringDeductions || []
                });
            } catch (error) {
                console.error('Failed to fetch profile:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchProfile();
    }, [params.id, router]);

    const handleSubmit = async (e?: React.SyntheticEvent) => {
        e?.preventDefault?.();
        setSaving(true);

        try {
            const bankName = String(formData.bankAccount?.bankName || '').trim();
            const accountNumber = String(formData.bankAccount?.accountNumber || '').trim();
            const routingNumber = String(formData.bankAccount?.routingNumber || '').trim();

            let bankAccounts: any[] = [];
            if (!bankName && !accountNumber && !routingNumber) {
                bankAccounts = [];
            } else if (!bankName || !accountNumber) {
                alert('Bank name and account number are required if you want to save bank details.');
                setSaving(false);
                return;
            } else {
                bankAccounts = [
                    {
                        bankName,
                        accountNumber,
                        routingNumber: routingNumber || undefined,
                        isPrimary: true,
                        accountName: profile?.employeeInfo?.name || 'Primary'
                    }
                ];
            }

            await api.put(`/payroll/profiles/${params.id}`, {
                basicSalary: Number(formData.basicSalary),
                currency: formData.currency,
                isActive: formData.isActive,
                allowances: formData.allowances,
                payrollFlags: formData.payrollFlags,
                taxConfig: {
                    ...formData.taxConfig,
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
                bankAccounts,
                recurringDeductions: formData.recurringDeductions
            });

            alert('Profile updated successfully');
            router.push('/admin/employees');
        } catch (error) {
            alert('Failed to update profile');
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

    const setJurisdictionCode = (code: string) => {
        const manualOnly = isManualOnlyJurisdiction(code);
        updateTaxConfig({
            jurisdictionCode: code,
            calculationMode: manualOnly ? 'manual' : 'builtin',
            taxSubdivision: code === 'GB' ? (formData.taxConfig.taxSubdivision || 'standard') : '',
        });
    };

    const addManualBracket = () => {
        updateTaxConfig({
            customBrackets: [
                ...(formData.taxConfig.customBrackets || []),
                { min: 0, max: '', rate: 0 }
            ]
        });
    };

    const updateManualBracket = (index: number, key: 'min' | 'max' | 'rate', value: string) => {
        const next = [...(formData.taxConfig.customBrackets || [])];
        next[index] = {
            ...next[index],
            [key]: key === 'max' && value === '' ? '' : Number(value)
        };
        updateTaxConfig({ customBrackets: next });
    };

    const removeManualBracket = (index: number) => {
        const next = [...(formData.taxConfig.customBrackets || [])];
        next.splice(index, 1);
        updateTaxConfig({ customBrackets: next });
    };

    const selectedJurisdiction = payrollTaxJurisdictions.find((item) => item.code === formData.taxConfig.jurisdictionCode)
        || payrollTaxJurisdictions[payrollTaxJurisdictions.length - 1];
    const canUseBuiltInTax = selectedJurisdiction?.mode === 'builtin';
    const showUsTaxFields = canUseBuiltInTax && formData.taxConfig.jurisdictionCode === 'US' && formData.taxConfig.calculationMode === 'builtin';
    const showUkTaxFields = canUseBuiltInTax && formData.taxConfig.jurisdictionCode === 'GB' && formData.taxConfig.calculationMode === 'builtin';
    const showResidencyStatus = canUseBuiltInTax && ['GH', 'KE'].includes(formData.taxConfig.jurisdictionCode) && formData.taxConfig.calculationMode === 'builtin';
    const showManualTaxFields = formData.taxConfig.calculationMode === 'manual';

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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Sidebar Info */}
                    <div className="space-y-6">
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
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-200">{selectedJurisdiction.label}</p>
                                        <p className="text-xs text-zinc-500 mt-1">{selectedJurisdiction.description}</p>
                                    </div>
                                    {canUseBuiltInTax && (
                                        <div className="flex items-center gap-2 bg-zinc-900/70 p-1 rounded-lg border border-zinc-700/60">
                                            <button
                                                type="button"
                                                onClick={() => updateTaxConfig({ calculationMode: 'builtin' })}
                                                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${formData.taxConfig.calculationMode === 'builtin' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                                            >
                                                Built-In Rule
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateTaxConfig({ calculationMode: 'manual' })}
                                                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${formData.taxConfig.calculationMode === 'manual' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                                            >
                                                Manual Override
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {(showUkTaxFields || showResidencyStatus || showUsTaxFields || showManualTaxFields) && (
                                <div className="mt-4 space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {showUkTaxFields && (
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">UK Tax Region</label>
                                                <select
                                                    value={formData.taxConfig.taxSubdivision}
                                                    onChange={(e) => updateTaxConfig({ taxSubdivision: e.target.value })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                >
                                                    {ukTaxSubdivisionOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {showResidencyStatus && (
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Residency Status</label>
                                                <select
                                                    value={formData.taxConfig.residencyStatus}
                                                    onChange={(e) => updateTaxConfig({ residencyStatus: e.target.value })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                >
                                                    {residencyStatusOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {showUsTaxFields && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Filing Status</label>
                                                <select
                                                    value={formData.taxConfig.filingStatus}
                                                    onChange={(e) => updateTaxConfig({ filingStatus: e.target.value })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                >
                                                    {filingStatusOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Dependents (record only)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={formData.taxConfig.dependents}
                                                    onChange={(e) => updateTaxConfig({ dependents: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Other Income (W-4 Step 4a)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.otherIncome}
                                                    onChange={(e) => updateTaxConfig({ otherIncome: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Deductions Adjustment (W-4 Step 4b)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.deductionsAdjustment}
                                                    onChange={(e) => updateTaxConfig({ deductionsAdjustment: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Tax Credits (W-4 Step 3)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.taxCredits}
                                                    onChange={(e) => updateTaxConfig({ taxCredits: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                                <span className="text-sm text-zinc-300">Use IRS Multiple Jobs Table</span>
                                                <input
                                                    type="checkbox"
                                                    checked={!!formData.taxConfig.multipleJobs}
                                                    onChange={(e) => updateTaxConfig({ multipleJobs: e.target.checked })}
                                                    className="rounded bg-zinc-900 border-zinc-700"
                                                />
                                            </label>
                                        </div>
                                    )}
                                </div>
                            )}
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
                                                {formData.currency} {Number(allowance.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                <div className="grid grid-cols-2 gap-4">
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
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Routing Number</label>
                                        <input
                                            type="text"
                                            value={formData.bankAccount.routingNumber}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                bankAccount: { ...formData.bankAccount, routingNumber: e.target.value }
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
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Employee Tax Jurisdiction</label>
                                    <select
                                        value={formData.taxConfig.jurisdictionCode}
                                        onChange={(e) => setJurisdictionCode(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    >
                                        {payrollTaxJurisdictions.map((jurisdiction) => (
                                            <option key={jurisdiction.code} value={jurisdiction.code}>
                                                {jurisdiction.label}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-zinc-500 mt-1.5">
                                        Payroll tax follows the employee&apos;s tax jurisdiction, not the company&apos;s country.
                                    </p>
                                </div>

                                {(formData.taxConfig.jurisdictionCode === 'EU' || formData.taxConfig.jurisdictionCode === 'OTHER') && (
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Jurisdiction Name</label>
                                        <input
                                            type="text"
                                            value={formData.taxConfig.jurisdictionName}
                                            onChange={(e) => updateTaxConfig({ jurisdictionName: e.target.value })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            placeholder="e.g. France, Germany, Rwanda"
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Additional Withholding</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={formData.taxConfig.additionalWithholding}
                                        onChange={(e) => updateTaxConfig({ additionalWithholding: Number(e.target.value) })}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="mt-4 bg-zinc-800/30 border border-zinc-700/60 rounded-xl p-4">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <p className="text-sm font-semibold text-zinc-200">{selectedJurisdiction.label}</p>
                                        <p className="text-xs text-zinc-500 mt-1">{selectedJurisdiction.description}</p>
                                    </div>
                                    {canUseBuiltInTax && (
                                        <div className="flex items-center gap-2 bg-zinc-900/70 p-1 rounded-lg border border-zinc-700/60">
                                            <button
                                                type="button"
                                                onClick={() => updateTaxConfig({ calculationMode: 'builtin' })}
                                                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${formData.taxConfig.calculationMode === 'builtin' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                                            >
                                                Built-In Rule
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateTaxConfig({ calculationMode: 'manual' })}
                                                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${formData.taxConfig.calculationMode === 'manual' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                                            >
                                                Manual Override
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {(showUkTaxFields || showResidencyStatus || showUsTaxFields) && (
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {showUkTaxFields && (
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1.5">UK Tax Region</label>
                                            <select
                                                value={formData.taxConfig.taxSubdivision}
                                                onChange={(e) => updateTaxConfig({ taxSubdivision: e.target.value })}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            >
                                                {ukTaxSubdivisionOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {showResidencyStatus && (
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Residency Status</label>
                                            <select
                                                value={formData.taxConfig.residencyStatus}
                                                onChange={(e) => updateTaxConfig({ residencyStatus: e.target.value })}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            >
                                                {residencyStatusOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {showUsTaxFields && (
                                        <>
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Filing Status</label>
                                                <select
                                                    value={formData.taxConfig.filingStatus}
                                                    onChange={(e) => updateTaxConfig({ filingStatus: e.target.value })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                >
                                                    {filingStatusOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Dependents (record only)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={formData.taxConfig.dependents}
                                                    onChange={(e) => updateTaxConfig({ dependents: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Other Income (W-4 Step 4a)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.otherIncome}
                                                    onChange={(e) => updateTaxConfig({ otherIncome: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Deductions Adjustment (W-4 Step 4b)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.deductionsAdjustment}
                                                    onChange={(e) => updateTaxConfig({ deductionsAdjustment: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Tax Credits (W-4 Step 3)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.taxCredits}
                                                    onChange={(e) => updateTaxConfig({ taxCredits: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>

                                            <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                                <span className="text-sm text-zinc-300">Use IRS Multiple Jobs Table</span>
                                                <input
                                                    type="checkbox"
                                                    checked={!!formData.taxConfig.multipleJobs}
                                                    onChange={(e) => updateTaxConfig({ multipleJobs: e.target.checked })}
                                                    className="rounded bg-zinc-900 border-zinc-700"
                                                />
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}

                            {showManualTaxFields && (
                                <div className="mt-4 space-y-4 border-t border-zinc-800/70 pt-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Manual Tax Mode</label>
                                            <select
                                                value={formData.taxConfig.manualCalculationType}
                                                onChange={(e) => updateTaxConfig({ manualCalculationType: e.target.value })}
                                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                            >
                                                {manualTaxModeOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {formData.taxConfig.manualCalculationType === 'flat' && (
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Flat Tax Rate (%)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={formData.taxConfig.flatTaxRate}
                                                    onChange={(e) => updateTaxConfig({ flatTaxRate: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>
                                        )}

                                        {formData.taxConfig.manualCalculationType === 'progressive' && (
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Annual Tax-Free Allowance</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={formData.taxConfig.manualTaxFreeAllowance}
                                                    onChange={(e) => updateTaxConfig({ manualTaxFreeAllowance: Number(e.target.value) })}
                                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {formData.taxConfig.manualCalculationType === 'progressive' && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h4 className="text-sm font-semibold text-zinc-300">Manual Tax Brackets</h4>
                                                    <p className="text-xs text-zinc-500">Enter annual bracket thresholds for unsupported countries or custom cases.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={addManualBracket}
                                                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-sm text-zinc-200 transition-colors"
                                                >
                                                    Add Bracket
                                                </button>
                                            </div>

                                            {(formData.taxConfig.customBrackets || []).length === 0 && (
                                                <div className="rounded-lg border border-dashed border-zinc-700/70 p-4 text-sm text-zinc-500">
                                                    No manual brackets configured yet.
                                                </div>
                                            )}

                                            {(formData.taxConfig.customBrackets || []).map((bracket: any, index: number) => (
                                                <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-zinc-800/20 border border-zinc-700/50 rounded-lg p-3">
                                                    <div>
                                                        <label className="text-xs text-zinc-500 block mb-1">Annual Min</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={bracket.min}
                                                            onChange={(e) => updateManualBracket(index, 'min', e.target.value)}
                                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-zinc-500 block mb-1">Annual Max</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={bracket.max}
                                                            onChange={(e) => updateManualBracket(index, 'max', e.target.value)}
                                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                                            placeholder="Leave blank for no upper limit"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-zinc-500 block mb-1">Rate (%)</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            step="0.01"
                                                            value={bracket.rate}
                                                            onChange={(e) => updateManualBracket(index, 'rate', e.target.value)}
                                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                                                        />
                                                    </div>
                                                    <div className="flex items-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => removeManualBracket(index)}
                                                            className="w-full py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-6 pt-6 border-t border-zinc-800/70">
                                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Statutory Contributions</h4>
                                <p className="text-xs text-zinc-500 mb-4">
                                    Built-in statutory deductions apply automatically for supported countries when possible. Manual rate and cap fields below override the preset if you need a local exception.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                        <span className="text-sm text-zinc-300">Social Security Opt-In</span>
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
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Social Security Number</label>
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
                                            placeholder="XXX-XX-XXXX"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Manual Social Security Rate (%)</label>
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
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Manual Annual Social Security Cap</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={formData.taxConfig.socialSecurityCap}
                                            onChange={(e) => updateTaxConfig({ socialSecurityCap: Number(e.target.value) })}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                        />
                                    </div>

                                    <label className="flex items-center justify-between bg-zinc-800/40 p-3 rounded-lg border border-zinc-700/50">
                                        <span className="text-sm text-zinc-300">Pension Opt-In</span>
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
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Employee Pension (%)</label>
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
                                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Employer Pension (%)</label>
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
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
