'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';
import Link from 'next/link';

export default function TeamCompensation() {
  const router = useRouter();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    userId: '',
    userName: '',
    type: 'bonus',
    amount: '',
    reason: '',
    effectiveDate: new Date().toISOString().split('T')[0]
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Handle SSO callback
    handleAuthCallback();

    // Check auth
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    fetchRequests();
  }, [router]);

  const fetchRequests = () => {
    api.get('/compensation/team')
      .then(res => {
        setRequests(res.data.requests || res.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch requests:', err);
        setLoading(false);
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/compensation/request', formData);
      setShowForm(false);
      setFormData({
        userId: '',
        userName: '',
        type: 'bonus',
        amount: '',
        reason: '',
        effectiveDate: new Date().toISOString().split('T')[0]
      });
      fetchRequests();
      alert('Request submitted successfully!');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-indigo-400 rounded-2xl opacity-20 blur-xl animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-[3px] border-blue-100 border-t-blue-500 animate-spin" />
            </div>
          </div>
          <p className="text-slate-400 font-medium">Loading team data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Team Compensation</h1>
                <p className="text-slate-500 text-sm">Manage bonuses and compensation requests for your team</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-medium text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Dashboard
              </Link>

              <button
                onClick={() => setShowForm(!showForm)}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  showForm
                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5'
                }`}
              >
                {showForm ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    New Request
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
        {/* New Request Form */}
        {showForm && (
          <div className="mb-8 max-w-xl">
            <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/30 overflow-hidden shadow-lg shadow-blue-500/5">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Create Compensation Request</h3>
                    <p className="text-blue-100 text-sm">Submit a new request for your team member</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Employee ID</label>
                    <input
                      type="text"
                      value={formData.userId}
                      onChange={e => setFormData({...formData, userId: e.target.value})}
                      placeholder="e.g. user-123"
                      required
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Employee Name</label>
                    <input
                      type="text"
                      value={formData.userName}
                      onChange={e => setFormData({...formData, userName: e.target.value})}
                      placeholder="e.g. John Doe"
                      required
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
                    <select
                      value={formData.type}
                      onChange={e => setFormData({...formData, type: e.target.value})}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    >
                      <option value="bonus">Bonus</option>
                      <option value="salary_revision">Salary Revision</option>
                      <option value="overtime">Overtime</option>
                      <option value="commission">Commission</option>
                      <option value="incentive">Incentive</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Amount ($)</label>
                    <input
                      type="number"
                      value={formData.amount}
                      onChange={e => setFormData({...formData, amount: e.target.value})}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      required
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Reason / Justification</label>
                  <input
                    type="text"
                    value={formData.reason}
                    onChange={e => setFormData({...formData, reason: e.target.value})}
                    placeholder="e.g. Q1 Performance Achievement"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Effective Date</label>
                  <input
                    type="date"
                    value={formData.effectiveDate}
                    onChange={e => setFormData({...formData, effectiveDate: e.target.value})}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Submitting...
                    </span>
                  ) : (
                    'Submit Request'
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Stats Summary */}
        {requests.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Total Requests</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{requests.length}</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Pending</span>
              </div>
              <p className="text-2xl font-bold text-amber-600">{requests.filter(r => r.status === 'pending').length}</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Approved</span>
              </div>
              <p className="text-2xl font-bold text-emerald-600">{requests.filter(r => r.status === 'approved' || r.status === 'processed').length}</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Rejected</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{requests.filter(r => r.status === 'rejected').length}</p>
            </div>
          </div>
        )}

        {/* Requests List */}
        <div className="space-y-4">
          {requests.map(req => (
            <div
              key={req._id}
              className="group rounded-2xl border border-slate-100 bg-white p-6 hover:shadow-lg hover:shadow-slate-200/50 hover:border-slate-200 transition-all duration-300"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${
                    req.status === 'approved' || req.status === 'processed'
                      ? 'bg-gradient-to-br from-emerald-500 to-green-500 shadow-emerald-500/20'
                      : req.status === 'rejected'
                      ? 'bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/20'
                      : 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/20'
                  }`}>
                    <span className="text-white font-semibold text-lg">
                      {req.userName?.charAt(0) || '?'}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-semibold text-slate-900 text-lg">{req.userName}</h3>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium capitalize">
                        {req.type?.replace(/_/g, ' ')}
                      </span>
                      <span>•</span>
                      <span>{req.reason}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Requested by {req.requesterName}
                      <span>•</span>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(req.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-bold text-2xl text-slate-900">
                      ${parseFloat(req.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${
                    req.status === 'processed' || req.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-700'
                      : req.status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {req.status === 'processed' || req.status === 'approved' ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : req.status === 'rejected' ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {req.status}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Empty State */}
          {requests.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm">
                <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">No Compensation Requests</h3>
              <p className="text-slate-500 max-w-md mx-auto leading-relaxed mb-6">
                Create a new request to start managing your team bonuses and compensation adjustments.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create First Request
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
