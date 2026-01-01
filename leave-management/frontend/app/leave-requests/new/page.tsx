'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import { leaveRequestsApi, leaveBalancesApi, leavePoliciesApi } from '@/lib/api';
import { LeaveType, LeaveBalance, LeavePolicy, Team } from '@/types';
import { getLeaveTypeLabel } from '@/lib/utils';
import { Calendar, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export default function NewLeaveRequestPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [policy, setPolicy] = useState<LeavePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [teamId, setTeamId] = useState('');

  // User's teams
  const userTeams = (user?.teams || []).filter(t =>
    t.organizationId === user?.currentOrganization?.id
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated) return;

      try {
        setLoading(true);
        const [balanceRes, policyRes] = await Promise.all([
          leaveBalancesApi.getMyBalance(),
          leavePoliciesApi.get(),
        ]);

        setBalance(balanceRes.balance);
        setPolicy(policyRes.policy);

        // Set default team if user has one
        if (userTeams.length === 1) {
          setTeamId(userTeams[0].id);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError('Please select start and end dates');
      return;
    }

    try {
      setSubmitting(true);
      await leaveRequestsApi.create({
        leaveType,
        startDate,
        endDate,
        reason,
        teamId: teamId || undefined,
      });

      setSuccess(true);
      setTimeout(() => {
        router.push('/leave-requests');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create leave request');
    } finally {
      setSubmitting(false);
    }
  };

  const getAvailableBalance = (type: LeaveType) => {
    if (!balance) return 0;
    const typeBalance = balance[type];
    return typeBalance ? typeBalance.remaining - typeBalance.pending : 0;
  };

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    );
  }

  if (success) {
    return (
      <Layout>
        <div className="w-full">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-8 text-center shadow-lg">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-emerald-900 mb-2">
              Leave Request Submitted
            </h2>
            <p className="text-emerald-800">
              Your leave request has been submitted for approval.
            </p>
            <p className="text-sm text-emerald-700 mt-2">
              Redirecting to your requests...
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="mb-2 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-lg">
            <Link
              href="/leave-requests"
              className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-4 font-medium"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Requests
            </Link>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
                  Request Leave
                </h1>
                <p className="text-slate-600 mt-2">Fill out the form below to submit a leave request</p>
              </div>
              {userTeams.length > 0 && (
                <Badge variant="secondary" className="bg-slate-100 border-slate-200 text-slate-700">
                  {userTeams.length} team{userTeams.length === 1 ? '' : 's'} linked
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <Alert variant="danger" className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">{error}</div>
          </Alert>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-6 space-y-6"
          >
          {/* Leave Type */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Leave Type
            </label>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {(['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'] as LeaveType[]).map((type) => (
                <option key={type} value={type}>
                  {getLeaveTypeLabel(type)} ({getAvailableBalance(type)} days available)
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Start Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                End Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || new Date().toISOString().split('T')[0]}
                  className="w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>
            </div>
          </div>

          {/* Team Selection (if multiple teams) */}
          {userTeams.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Team (for approval routing)
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Select a team</option>
                {userTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.hierarchyPath?.join(' > ') || team.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Your line manager from this team will be assigned to approve your request
              </p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Provide additional details about your leave request..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="mt-2 text-xs text-slate-500">{reason.length}/1000 characters</p>
          </div>

          {/* Submit button */}
          <div className="flex justify-end gap-4">
            <Link href="/leave-requests">
              <Button variant="outline" className="rounded-xl">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={submitting}
              className="rounded-xl px-6 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
          </form>

          {/* Side panel (desktop) */}
          <div className="space-y-6">
            <Card className="rounded-2xl border-slate-200/50 bg-white/80 backdrop-blur-sm shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Balance</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Selected type</span>
                  <Badge variant="secondary" className="bg-slate-100 border-slate-200 text-slate-700">
                    {getLeaveTypeLabel(leaveType)}
                  </Badge>
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-slate-600">Available</div>
                  <div className="text-2xl font-bold text-slate-900">{getAvailableBalance(leaveType)} days</div>
                </div>
                {!balance && (
                  <p className="text-xs text-slate-500">Balance info unavailable.</p>
                )}
              </CardContent>
            </Card>

            {policy && (
              <Card className="rounded-2xl border-slate-200/50 bg-white/80 backdrop-blur-sm shadow-lg">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Leave Policy</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-slate-700">
                  <ul className="space-y-2">
                    {policy.advanceNoticeDays > 0 && (
                      <li>
                        <span className="font-semibold text-slate-800">Advance notice:</span>{' '}
                        {policy.advanceNoticeDays} day(s)
                      </li>
                    )}
                    {policy.maxConsecutiveDays && (
                      <li>
                        <span className="font-semibold text-slate-800">Max consecutive:</span>{' '}
                        {policy.maxConsecutiveDays} day(s)
                      </li>
                    )}
                    {policy.requiresApproval && (
                      <li>
                        <span className="font-semibold text-slate-800">Approval:</span> Manager required
                      </li>
                    )}
                    {policy.advanceNoticeDays === 0 && (
                      <li>
                        <span className="font-semibold text-slate-800">Advance notice:</span> None
                      </li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
