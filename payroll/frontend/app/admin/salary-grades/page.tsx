'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';
import Link from 'next/link';
import {
    ArrowLeft,
    Plus,
    Edit2,
    Trash2,
    Loader2,
    DollarSign,
    Layers,
    X,
    Save
} from 'lucide-react';

interface SalaryGrade {
    _id: string;
    gradeCode: string;
    gradeName: string;
    gradeLevel: number;
    salaryRange: {
        currency: string;
        minimum: number;
        maximum: number;
        midpoint: number;
    };
    department?: string;
    isActive: boolean;
}

export default function SalaryGradesPage() {
    const router = useRouter();
    const { currencies } = usePayrollCurrencies();
    const [loading, setLoading] = useState(true);
    const [grades, setGrades] = useState<SalaryGrade[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingGrade, setEditingGrade] = useState<SalaryGrade | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        gradeCode: '',
        gradeName: '',
        gradeLevel: 1,
        currency: 'USD',
        minimum: 0,
        maximum: 0,
        department: ''
    });

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }
        fetchGrades();
    }, [router]);

    const fetchGrades = async () => {
        try {
            const res = await api.get('/payroll/salary-grades');
            setGrades(res.data);
        } catch (error) {
            console.error('Failed to fetch grades:', error);
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingGrade(null);
        setFormData({ gradeCode: '', gradeName: '', gradeLevel: 1, currency: 'USD', minimum: 0, maximum: 0, department: '' });
        setShowModal(true);
    };

    const openEditModal = (grade: SalaryGrade) => {
        setEditingGrade(grade);
        setFormData({
            gradeCode: grade.gradeCode,
            gradeName: grade.gradeName,
            gradeLevel: grade.gradeLevel,
            currency: grade.salaryRange.currency,
            minimum: grade.salaryRange.minimum,
            maximum: grade.salaryRange.maximum,
            department: grade.department || ''
        });
        setShowModal(true);
    };

    const handleSubmit = async () => {
        try {
            const payload = {
                gradeCode: formData.gradeCode,
                gradeName: formData.gradeName,
                gradeLevel: Number(formData.gradeLevel),
                salaryRange: {
                    currency: formData.currency,
                    minimum: Number(formData.minimum),
                    maximum: Number(formData.maximum),
                    midpoint: (Number(formData.minimum) + Number(formData.maximum)) / 2
                },
                department: formData.department || undefined
            };

            if (editingGrade) {
                await api.put(`/payroll/salary-grades/${editingGrade._id}`, payload);
            } else {
                await api.post('/payroll/salary-grades', payload);
            }

            setShowModal(false);
            fetchGrades();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to save grade');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to deactivate this grade?')) return;
        try {
            await api.delete(`/payroll/salary-grades/${id}`);
            fetchGrades();
        } catch (error) {
            alert('Failed to delete grade');
        }
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
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Link href="/dashboard" className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
                        </Link>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                            Salary Grades
                        </h1>
                        <p className="text-zinc-500">Define pay bands and compensation structures</p>
                    </div>
                    <button
                        onClick={openCreateModal}
                        className="flex items-center gap-2 bg-amber-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-amber-500 transition-all"
                    >
                        <Plus className="w-4 h-4" /> Add Grade
                    </button>
                </div>

                {/* Grades Table */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-zinc-800/50">
                            <tr>
                                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Code</th>
                                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Name</th>
                                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Level</th>
                                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Salary Range</th>
                                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Dept</th>
                                <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {grades.filter(g => g.isActive).map((grade) => (
                                <tr key={grade._id} className="hover:bg-zinc-800/30 transition-colors">
                                    <td className="px-5 py-4 font-mono text-amber-400">{grade.gradeCode}</td>
                                    <td className="px-5 py-4">{grade.gradeName}</td>
                                    <td className="px-5 py-4">
                                        <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs">L{grade.gradeLevel}</span>
                                    </td>
                                    <td className="px-5 py-4 font-mono text-emerald-400">
                                        {formatPayrollMoney(grade.salaryRange.minimum, grade.salaryRange.currency)} - {formatPayrollMoney(grade.salaryRange.maximum, grade.salaryRange.currency)}
                                    </td>
                                    <td className="px-5 py-4 text-zinc-500">{grade.department || '--'}</td>
                                    <td className="px-5 py-4 text-right">
                                        <button onClick={() => openEditModal(grade)} className="p-2 text-zinc-400 hover:text-amber-400 transition-colors">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => handleDelete(grade._id)} className="p-2 text-zinc-400 hover:text-red-400 transition-colors ml-2">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {grades.filter(g => g.isActive).length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                                        No salary grades defined yet. Click &quot;Add Grade&quot; to create one.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="payroll-dialog-shell" role="presentation">
                    <div className="payroll-dialog max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="salary-grade-title">
                        <div className="flex justify-between items-center mb-4">
                            <h2 id="salary-grade-title" className="payroll-dialog-title text-lg font-semibold">{editingGrade ? 'Edit Grade' : 'New Salary Grade'}</h2>
                            <button onClick={() => setShowModal(false)} className="payroll-dialog-close" aria-label="Close salary grade dialog">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="payroll-field-label">Grade Code</label>
                                    <input
                                        type="text"
                                        value={formData.gradeCode}
                                        onChange={(e) => setFormData({ ...formData, gradeCode: e.target.value })}
                                        className="payroll-field text-sm"
                                        placeholder="e.g. ENG-L1"
                                        disabled={!!editingGrade}
                                    />
                                </div>
                                <div>
                                    <label className="payroll-field-label">Level</label>
                                    <input
                                        type="number"
                                        value={formData.gradeLevel}
                                        onChange={(e) => setFormData({ ...formData, gradeLevel: Number(e.target.value) })}
                                        className="payroll-field text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="payroll-field-label">Grade Name</label>
                                <input
                                    type="text"
                                    value={formData.gradeName}
                                    onChange={(e) => setFormData({ ...formData, gradeName: e.target.value })}
                                    className="payroll-field text-sm"
                                    placeholder="e.g. Junior Engineer"
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="payroll-field-label">Currency</label>
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="payroll-field text-sm"
                                    >
                                        {currencies.map((currency) => (
                                            <option key={currency.code} value={currency.code}>
                                                {currency.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="payroll-field-label">Min Salary</label>
                                    <input
                                        type="number"
                                        value={formData.minimum}
                                        onChange={(e) => setFormData({ ...formData, minimum: Number(e.target.value) })}
                                        className="payroll-field text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="payroll-field-label">Max Salary</label>
                                    <input
                                        type="number"
                                        value={formData.maximum}
                                        onChange={(e) => setFormData({ ...formData, maximum: Number(e.target.value) })}
                                        className="payroll-field text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="payroll-field-label">Department (Optional)</label>
                                <input
                                    type="text"
                                    value={formData.department}
                                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                                    className="payroll-field text-sm"
                                    placeholder="e.g. Engineering"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setShowModal(false)} className="payroll-button-secondary">
                                Cancel
                            </button>
                            <button onClick={handleSubmit} className="payroll-button-primary">
                                <Save className="w-4 h-4" /> {editingGrade ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
