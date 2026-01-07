'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, User, DollarSign, Building2, Save,
    CreditCard, Calendar, Percent, CheckCircle
} from 'lucide-react';

interface SalaryGrade {
    _id: string;
    name: string;
    level: number;
    minSalary: number;
    maxSalary: number;
    currency: string;
}

interface OnboardingData {
    userId: string;
    userName: string;
    userEmail: string;
    employeeInfo: {
        employeeId: string;
        department: string;
        designation: string;
        dateOfJoining: string;
    };
    salary: {
        basicSalary: number;
        currency: string;
        salaryGradeId: string;
        payFrequency: 'monthly' | 'bi-weekly' | 'weekly';
    };
    bankDetails: {
        bankName: string;
        accountNumber: string;
        accountHolderName: string;
        routingNumber: string;
    };
    taxConfig: {
        taxId: string;
        filingStatus: string;
    };
}

export default function OnboardPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [salaryGrades, setSalaryGrades] = useState<SalaryGrade[]>([]);
    const [existingProfile, setExistingProfile] = useState<any>(null);

    const [formData, setFormData] = useState<OnboardingData>({
        userId: '',
        userName: '',
        userEmail: '',
        employeeInfo: {
            employeeId: '',
            department: '',
            designation: '',
            dateOfJoining: new Date().toISOString().split('T')[0],
        },
        salary: {
            basicSalary: 0,
            currency: 'USD',
            salaryGradeId: '',
            payFrequency: 'monthly',
        },
        bankDetails: {
            bankName: '',
            accountNumber: '',
            accountHolderName: '',
            routingNumber: '',
        },
        taxConfig: {
            taxId: '',
            filingStatus: 'single',
        },
    });

    useEffect(() => {
        fetchData();
    }, [userId]);

    const fetchData = async () => {
        try {
            setLoading(true);

            // Fetch salary grades
            const gradesRes = await fetch('/api/payroll/salary-grades', { credentials: 'include' });
            if (gradesRes.ok) {
                const grades = await gradesRes.json();
                setSalaryGrades(grades);
            }

            // Check if profile already exists
            const profileRes = await fetch(`/api/payroll/profiles/${userId}`, { credentials: 'include' });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                setExistingProfile(profile);
                // Pre-fill form with existing data
                setFormData(prev => ({
                    ...prev,
                    userId: profile.userId,
                    userName: profile.employeeInfo?.name || '',
                    userEmail: profile.employeeInfo?.email || '',
                    employeeInfo: {
                        employeeId: profile.employeeInfo?.employeeId || '',
                        department: profile.employeeInfo?.department || '',
                        designation: profile.employeeInfo?.designation || '',
                        dateOfJoining: profile.employeeInfo?.dateOfJoining?.split('T')[0] || '',
                    },
                    salary: {
                        basicSalary: profile.salary?.basicSalary || 0,
                        currency: profile.salary?.currency || 'USD',
                        salaryGradeId: profile.salary?.salaryGradeId || '',
                        payFrequency: profile.salary?.payFrequency || 'monthly',
                    },
                    bankDetails: profile.bankDetails || prev.bankDetails,
                    taxConfig: profile.taxConfig || prev.taxConfig,
                }));
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);

            const payload = {
                userId,
                basicSalary: formData.salary.basicSalary,
                currency: formData.salary.currency,
                employeeInfo: {
                    ...formData.employeeInfo,
                    name: formData.userName,
                    email: formData.userEmail,
                },
                salary: formData.salary,
                bankDetails: formData.bankDetails,
                taxConfig: formData.taxConfig,
            };

            const method = existingProfile ? 'PUT' : 'POST';
            const url = existingProfile
                ? `/api/payroll/profiles/${userId}`
                : '/api/payroll/profiles';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save');
            }

            setSuccess(true);
            setTimeout(() => {
                router.push('/admin/employees');
            }, 2000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleGradeChange = (gradeId: string) => {
        const grade = salaryGrades.find(g => g._id === gradeId);
        if (grade) {
            setFormData(prev => ({
                ...prev,
                salary: {
                    ...prev.salary,
                    salaryGradeId: gradeId,
                    basicSalary: grade.minSalary,
                    currency: grade.currency,
                },
            }));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="p-4 rounded-full bg-green-500/20">
                    <CheckCircle className="h-12 w-12 text-green-400" />
                </div>
                <h2 className="text-xl font-semibold text-white">Employee Onboarded Successfully!</h2>
                <p className="text-zinc-400">Redirecting to employees list...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link
                    href="/admin/employees"
                    className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                    <ArrowLeft className="h-5 w-5 text-zinc-400" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-white">
                        {existingProfile ? 'Edit Payroll Profile' : 'Onboard Employee'}
                    </h1>
                    <p className="text-zinc-400 text-sm mt-1">
                        {existingProfile
                            ? 'Update employee salary and payment details'
                            : 'Set up salary, bank details, and tax configuration'
                        }
                    </p>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
                    {error}
                </div>
            )}

            {/* Form Sections */}
            <div className="space-y-6">
                {/* Basic Info */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                        <User className="h-5 w-5 text-amber-400" />
                        Employee Information
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Employee ID</label>
                            <input
                                type="text"
                                value={formData.employeeInfo.employeeId}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    employeeInfo: { ...prev.employeeInfo, employeeId: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="EMP-001"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Department</label>
                            <input
                                type="text"
                                value={formData.employeeInfo.department}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    employeeInfo: { ...prev.employeeInfo, department: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="Engineering"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Designation</label>
                            <input
                                type="text"
                                value={formData.employeeInfo.designation}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    employeeInfo: { ...prev.employeeInfo, designation: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="Software Engineer"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Date of Joining</label>
                            <input
                                type="date"
                                value={formData.employeeInfo.dateOfJoining}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    employeeInfo: { ...prev.employeeInfo, dateOfJoining: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            />
                        </div>
                    </div>
                </div>

                {/* Salary Info */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                        <DollarSign className="h-5 w-5 text-green-400" />
                        Salary Configuration
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Salary Grade</label>
                            <select
                                value={formData.salary.salaryGradeId}
                                onChange={(e) => handleGradeChange(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            >
                                <option value="">Select Grade</option>
                                {salaryGrades.map(grade => (
                                    <option key={grade._id} value={grade._id}>
                                        {grade.name} (Level {grade.level}) - {grade.currency} {grade.minSalary.toLocaleString()} - {grade.maxSalary.toLocaleString()}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Pay Frequency</label>
                            <select
                                value={formData.salary.payFrequency}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    salary: { ...prev.salary, payFrequency: e.target.value as any }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            >
                                <option value="monthly">Monthly</option>
                                <option value="bi-weekly">Bi-Weekly</option>
                                <option value="weekly">Weekly</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Basic Salary</label>
                            <input
                                type="number"
                                value={formData.salary.basicSalary}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    salary: { ...prev.salary, basicSalary: Number(e.target.value) }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Currency</label>
                            <select
                                value={formData.salary.currency}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    salary: { ...prev.salary, currency: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            >
                                <option value="USD">USD - US Dollar</option>
                                <option value="EUR">EUR - Euro</option>
                                <option value="GBP">GBP - British Pound</option>
                                <option value="NGN">NGN - Nigerian Naira</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Bank Details */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                        <CreditCard className="h-5 w-5 text-blue-400" />
                        Bank Details
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Bank Name</label>
                            <input
                                type="text"
                                value={formData.bankDetails.bankName}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    bankDetails: { ...prev.bankDetails, bankName: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="Chase Bank"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Account Holder Name</label>
                            <input
                                type="text"
                                value={formData.bankDetails.accountHolderName}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    bankDetails: { ...prev.bankDetails, accountHolderName: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Account Number</label>
                            <input
                                type="text"
                                value={formData.bankDetails.accountNumber}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    bankDetails: { ...prev.bankDetails, accountNumber: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="****1234"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Routing Number</label>
                            <input
                                type="text"
                                value={formData.bankDetails.routingNumber}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    bankDetails: { ...prev.bankDetails, routingNumber: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            />
                        </div>
                    </div>
                </div>

                {/* Tax Config */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
                        <Percent className="h-5 w-5 text-purple-400" />
                        Tax Configuration
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Tax ID / SSN</label>
                            <input
                                type="text"
                                value={formData.taxConfig.taxId}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    taxConfig: { ...prev.taxConfig, taxId: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                placeholder="XXX-XX-XXXX"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">Filing Status</label>
                            <select
                                value={formData.taxConfig.filingStatus}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    taxConfig: { ...prev.taxConfig, filingStatus: e.target.value }
                                }))}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            >
                                <option value="single">Single</option>
                                <option value="married_filing_jointly">Married Filing Jointly</option>
                                <option value="married_filing_separately">Married Filing Separately</option>
                                <option value="head_of_household">Head of Household</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3">
                    <Link
                        href="/admin/employees"
                        className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
                    >
                        Cancel
                    </Link>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-medium rounded-lg transition-all disabled:opacity-50"
                    >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving...' : existingProfile ? 'Update Profile' : 'Complete Onboarding'}
                    </button>
                </div>
            </div>
        </div>
    );
}
