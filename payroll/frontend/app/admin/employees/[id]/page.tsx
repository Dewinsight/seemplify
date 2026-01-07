'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, isAuthenticated } from '@/lib/api';
import Link from 'next/link';
import {
    ArrowLeft,
    Save,
    User,
    DollarSign,
    Building2,
    FileText,
    CreditCard,
    Loader2,
    CheckCircle,
    Plus,
    Trash2,
    PiggyBank
} from 'lucide-react';

export default function EmployeeEditPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<any>(null);

    // Form State
    const [formData, setFormData] = useState({
        basicSalary: 0,
        currency: 'USD',
        isActive: true,
        socialSecurityNumber: '',
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
                    isActive: res.data.isActive,
                    socialSecurityNumber: res.data.statutoryContributions?.socialSecurityNumber || '',
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        try {
            await api.put(`/payroll/profiles/${params.id}`, {
                basicSalary: Number(formData.basicSalary),
                currency: formData.currency,
                isActive: formData.isActive,
                statutoryContributions: {
                    socialSecurityNumber: formData.socialSecurityNumber
                },
                bankAccounts: [
                    {
                        ...formData.bankAccount,
                        isPrimary: true,
                        accountName: profile?.employeeInfo?.name || 'Primary'
                    }
                ],
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
                            {profile?.employeeInfo?.designation} • {profile?.employeeInfo?.department}
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
                                        <option value="USD">USD ($)</option>
                                        <option value="EUR">EUR (€)</option>
                                        <option value="GBP">GBP (£)</option>
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
                                {formData.recurringDeductions.map((deduction, idx) => (
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

                        {/* Tax Info */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-zinc-200">Tax Configuration</h3>
                                    <p className="text-sm text-zinc-500">Statutory IDs and tax info</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Social Security Number (SSN)</label>
                                <input
                                    type="text"
                                    value={formData.socialSecurityNumber}
                                    onChange={(e) => setFormData({ ...formData, socialSecurityNumber: e.target.value })}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                                    placeholder="XXX-XX-XXXX"
                                />
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
