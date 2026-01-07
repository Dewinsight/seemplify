'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { authApi, isAuthenticated } from '@/lib/api';
import Link from 'next/link';
import {
    Search,
    Users,
    Briefcase,
    DollarSign,
    ChevronRight,
    Filter,
    ArrowLeft,
    Loader2,
    UserPlus,
    AlertCircle
} from 'lucide-react';

export default function EmployeesPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [employees, setEmployees] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }

        const fetchEmployees = async () => {
            try {
                // Fetch all profiles for the organization
                // Note: We need a new backend endpoint for this or reuse an existing one
                // For now, let's assume GET /api/payroll/profiles exists and returns list
                // If not, we might need to add it to routes/payroll.js
                const res = await api.get('/payroll/profiles');
                setEmployees(res.data.profiles || []);
            } catch (error) {
                console.error('Failed to fetch employees:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchEmployees();
    }, [router]);

    const filteredEmployees = employees.filter(emp =>
        emp.employeeInfo?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.employeeInfo?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.employeeInfo?.department?.toLowerCase().includes(searchQuery.toLowerCase())
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
            {/* Header */}
            <div className="max-w-6xl mx-auto mb-8">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back to Dashboard
                </Link>
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                            Employee Management
                        </h1>
                        <p className="text-zinc-500 mt-1">Manage payroll profiles, salaries, and tax configurations</p>
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 flex items-center gap-2">
                        <div className="px-3 py-1.5 bg-zinc-800 rounded text-xs font-medium text-zinc-300">
                            Total: {employees.length}
                        </div>
                        <div className="px-3 py-1.5 rounded text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                            Active: {employees.filter(e => e.isActive).length}
                        </div>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="max-w-6xl mx-auto mb-6 flex gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-2.5 w-5 h-5 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Search employees by name, email, or department..."
                        className="w-full bg-zinc-900 border border-zinc-700/50 rounded-xl pl-10 pr-4 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500/50 transition-all placeholder:text-zinc-600"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <button className="px-4 py-2.5 bg-zinc-900 border border-zinc-700/50 rounded-xl text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    Filters
                </button>
            </div>

            {/* Employees Grid */}
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredEmployees.map((employee) => {
                    const needsOnboarding = !employee.basicSalary || employee.basicSalary === 0;

                    return (
                        <div
                            key={employee._id}
                            className="group bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5 hover:bg-zinc-900 hover:border-amber-500/30 transition-all"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20 group-hover:border-amber-500/40">
                                        <span className="font-semibold text-amber-500">
                                            {employee.employeeInfo?.name?.charAt(0) || 'U'}
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors">
                                            {employee.employeeInfo?.name || 'Unknown'}
                                        </h3>
                                        <p className="text-xs text-zinc-500">{employee.employeeInfo?.designation || 'No Designation'}</p>
                                    </div>
                                </div>
                                {needsOnboarding && (
                                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                        <AlertCircle className="w-3 h-3" />
                                        Needs Setup
                                    </span>
                                )}
                            </div>

                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <Briefcase className="w-3.5 h-3.5" /> Department
                                    </span>
                                    <span className="text-zinc-300">{employee.employeeInfo?.department || '--'}</span>
                                </div>

                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <DollarSign className="w-3.5 h-3.5" /> Basic Salary
                                    </span>
                                    <span className={`font-mono font-medium ${needsOnboarding ? 'text-zinc-500' : 'text-emerald-400'}`}>
                                        {needsOnboarding ? 'Not Set' : `${employee.currency || '$'}${employee.basicSalary?.toLocaleString()}`}
                                    </span>
                                </div>

                                <div className="pt-3 mt-3 border-t border-zinc-800/50 flex items-center justify-between">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${employee.isActive
                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                        : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                                        }`}>
                                        {employee.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                    <div className="flex gap-2">
                                        {needsOnboarding ? (
                                            <Link
                                                href={`/admin/employees/onboard/${employee.userId}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                            >
                                                <UserPlus className="w-3.5 h-3.5" />
                                                Onboard
                                            </Link>
                                        ) : (
                                            <Link
                                                href={`/admin/employees/${employee.userId}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                                            >
                                                View
                                                <ChevronRight className="w-3.5 h-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
