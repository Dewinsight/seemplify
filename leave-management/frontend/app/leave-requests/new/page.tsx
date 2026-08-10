'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { leaveBalancesApi, leavePoliciesApi, leaveRequestsApi } from '@/lib/api';
import { getLeaveTypeLabel } from '@/lib/utils';
import { LeaveBalance, LeavePolicy } from '@/types';

export default function NewLeaveRequestPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [policy, setPolicy] = useState<LeavePolicy | null>(null);
  const [leaveType, setLeaveType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [teamId, setTeamId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const teams = useMemo(() => (user?.teams || []).filter(
    (team) => team.organizationId === user?.currentOrganization?.id
  ), [user]);
  const leaveTypes = useMemo(() => (policy?.leaveTypes || [])
    .filter((definition) => definition.active)
    .sort((left, right) => left.order - right.order), [policy]);
  const selectedEntitlement = balance?.entitlements?.find((entry) => entry.leaveTypeKey === leaveType);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([leaveBalancesApi.getMyBalance(), leavePoliciesApi.get()])
      .then(([balanceResponse, policyResponse]) => {
        if (cancelled) return;
        setBalance(balanceResponse.balance);
        setPolicy(policyResponse.policy);
        const first = (policyResponse.policy.leaveTypes || []).find((definition: { active: boolean }) => definition.active);
        setLeaveType(first?.key || '');
        if (teams.length === 1) setTeamId(teams[0].id);
      })
      .catch((requestError) => setError(requestError.response?.data?.error || 'Unable to load leave options.'))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [isAuthenticated, teams]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!leaveType || !startDate || !endDate) {
      setError('Choose a leave type and both dates.');
      return;
    }
    setSubmitting(true);
    try {
      await leaveRequestsApi.create({ leaveType, startDate, endDate, reason, teamId: teamId || undefined });
      setSubmitted(true);
      window.setTimeout(() => router.push('/leave-requests'), 1200);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to submit this leave request.');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return <Layout><div className="py-16 text-center text-sm text-muted-foreground">Loading your leave options…</div></Layout>;
  }

  if (submitted) {
    return (
      <Layout>
        <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-4 text-xl font-semibold">Leave request submitted</h1>
          <p className="mt-2 text-sm text-muted-foreground">You can follow its approval status from My Requests.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link href="/leave-requests" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> My requests
          </Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Request leave</h1>
          <p className="mt-1 text-sm text-muted-foreground">Select from the leave types configured for your organization.</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="text-sm font-medium">Leave type</span>
              <select
                value={leaveType}
                onChange={(event) => setLeaveType(event.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={leaveTypes.length === 0}
              >
                {leaveTypes.map((definition) => {
                  const entitlement = balance?.entitlements?.find((entry) => entry.leaveTypeKey === definition.key);
                  return (
                    <option key={definition.key} value={definition.key}>
                      {definition.name} · {entitlement?.available ?? definition.defaultDays} days available
                    </option>
                  );
                })}
              </select>
            </label>

            <label>
              <span className="text-sm font-medium">Start date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label>
              <span className="text-sm font-medium">End date</span>
              <input type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </label>

            {teams.length > 1 && (
              <label className="md:col-span-2">
                <span className="text-sm font-medium">Team</span>
                <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Choose your team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
            )}

            <label className="md:col-span-2">
              <span className="text-sm font-medium">Reason <span className="font-normal text-muted-foreground">(optional)</span></span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={1000} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Add useful context for your approver." />
            </label>
          </div>

          {selectedEntitlement && (
            <div className="mt-5 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              <span className="font-medium">{getLeaveTypeLabel(leaveType, selectedEntitlement.leaveTypeName)}</span>
              <span className="text-muted-foreground"> · {selectedEntitlement.used} used · {selectedEntitlement.pending} pending · {selectedEntitlement.available} available</span>
            </div>
          )}
          {leaveTypes.length === 0 && <p className="mt-4 text-sm text-amber-700">Your organization has no active leave types. Contact an administrator.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" disabled={submitting || leaveTypes.length === 0}>{submitting ? 'Submitting…' : 'Submit request'}</Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
