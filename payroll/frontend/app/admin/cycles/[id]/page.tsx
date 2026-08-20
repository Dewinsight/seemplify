'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';

type Run = { _id: string; runNumber: string; status: string; summary?: { processedCount?: number; totalGrossPayroll?: number; totalDeductions?: number; totalNetPayroll?: number; totalEmployerCost?: number; currency?: string } };
type Child = { employerEntityId: string; legalName?: string; countryCode?: string; currency?: string; status: string; errorMessage?: string; payrollRunId?: Run };
type Cycle = { _id: string; cycleNumber: string; status: string; revision: number; currentApprovalLevel: number; payPeriod: { month: number; year: number; paymentDate: string }; childRuns: Child[]; approvals: Array<{ action: string; actorName?: string; level?: number; at: string; comments?: string }>; approvalPolicyId?: { name: string; levels: Array<{ name: string; roles: string[]; minimumApprovals: number }>; requireSeparationOfDuties: boolean }; reportingSummary?: { currency: string; available: boolean; totalGrossPayroll?: number; totalDeductions?: number; totalNetPayroll?: number; missingRates?: string[] }; deliveries?: Array<{ _id: string; recipientEmail: string; status: string; attemptCount: number; sentAt?: string; expiresAt: string }> };

const money = (currency: string, amount: number) => `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PayrollCyclePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setCycle((await api.get(`/payroll/cycles/${params.id}`)).data); setError(''); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Unable to load payroll cycle.'); }
    finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { handleAuthCallback(); if (!isAuthenticated()) { router.push('/login'); return; } load(); }, [load, router]);

  const action = async (name: string, path: string) => {
    setBusy(name); setError('');
    try { await api.post(`/payroll/cycles/${params.id}/${path}`, { comments }); setComments(''); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || `${name} failed.`); }
    finally { setBusy(''); }
  };
  const revokeDelivery = async (deliveryId: string) => {
    setBusy(deliveryId); setError('');
    try { await api.post(`/payroll/accounting-deliveries/${deliveryId}/revoke`); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Delivery link could not be revoked.'); }
    finally { setBusy(''); }
  };
  const resendAccounting = async () => {
    setBusy('Resend'); setError('');
    try {
      const idempotencyKey = `resend:${params.id}:${crypto.randomUUID()}`;
      await api.post(`/payroll/cycles/${params.id}/resend-accounting`, { idempotencyKey }, { headers: { 'Idempotency-Key': idempotencyKey } });
      await load();
    } catch (requestError: any) { setError(requestError?.response?.data?.error || 'Accounting delivery could not be resent.'); }
    finally { setBusy(''); }
  };

  if (loading) return <main className="min-h-screen bg-zinc-950 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></main>;
  if (!cycle) return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-200"><p>{error || 'Payroll cycle not found.'}</p></main>;
  const canSubmit = cycle.status === 'calculated';
  const canApprove = cycle.status === 'pending_approval';
  const canRecalculate = ['needs_attention', 'rejected'].includes(cycle.status);
  const canRetryRelease = cycle.status === 'release_failed';

  return <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200"><div className="mx-auto max-w-6xl">
    <Link href="/admin/cycles" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /> Payroll cycles</Link>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-zinc-100">{cycle.cycleNumber}</h1><p className="mt-1 text-sm text-zinc-500">Revision {cycle.revision} · payment {new Date(cycle.payPeriod.paymentDate).toLocaleDateString()}</p></div><span className="border border-zinc-700 px-3 py-1.5 text-sm capitalize text-zinc-300">{cycle.status.replaceAll('_', ' ')}</span></div>
    {error && <div role="alert" className="mt-5 border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{error}</div>}

    <section className="mt-6 overflow-hidden border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium text-zinc-100">Legal employer runs</h2><p className="mt-1 text-sm text-zinc-500">Totals remain in each employer’s native statutory currency.</p></div><div className="overflow-x-auto"><table className="min-w-[850px] w-full text-sm"><thead className="text-left text-zinc-500"><tr><th className="px-5 py-3 font-medium">Employer</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Employees</th><th className="px-4 py-3 text-right font-medium">Gross</th><th className="px-4 py-3 text-right font-medium">Deductions</th><th className="px-5 py-3 text-right font-medium">Net</th></tr></thead><tbody className="divide-y divide-zinc-800">{cycle.childRuns.map(child => { const run = child.payrollRunId; const currency = run?.summary?.currency || child.currency || '—'; return <tr key={child.employerEntityId}><td className="px-5 py-4"><div className="font-medium text-zinc-200">{child.legalName}</div>{run && <Link className="text-xs text-amber-400" href={`/admin/runs/${run._id}`}>{run.runNumber}</Link>}{child.errorMessage && <p className="mt-1 text-xs text-red-300">{child.errorMessage}</p>}</td><td className="px-4 py-4 capitalize text-zinc-400">{child.status.replaceAll('_', ' ')}</td><td className="px-4 py-4 text-right text-zinc-300">{run?.summary?.processedCount ?? '—'}</td><td className="px-4 py-4 text-right font-mono text-zinc-300">{run ? money(currency, run.summary?.totalGrossPayroll || 0) : '—'}</td><td className="px-4 py-4 text-right font-mono text-zinc-300">{run ? money(currency, run.summary?.totalDeductions || 0) : '—'}</td><td className="px-5 py-4 text-right font-mono text-emerald-400">{run ? money(currency, run.summary?.totalNetPayroll || 0) : '—'}</td></tr>; })}</tbody></table></div></section>

    {cycle.reportingSummary && <section className="mt-5 border border-zinc-800 bg-zinc-900/50 px-5 py-4"><h2 className="font-medium text-zinc-100">Consolidated reporting</h2>{cycle.reportingSummary.available ? <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm"><span>Gross <strong className="font-mono text-zinc-200">{money(cycle.reportingSummary.currency, cycle.reportingSummary.totalGrossPayroll || 0)}</strong></span><span>Deductions <strong className="font-mono text-zinc-200">{money(cycle.reportingSummary.currency, cycle.reportingSummary.totalDeductions || 0)}</strong></span><span>Net <strong className="font-mono text-emerald-400">{money(cycle.reportingSummary.currency, cycle.reportingSummary.totalNetPayroll || 0)}</strong></span></div> : <p className="mt-2 text-sm text-amber-300">Consolidated totals are unavailable until these payment-date exchange rates exist: {cycle.reportingSummary.missingRates?.join(', ') || 'missing rates'}.</p>}</section>}

    <section className="mt-5 border border-zinc-800 bg-zinc-900/50 p-5"><h2 className="font-medium text-zinc-100">Review and release</h2><p className="mt-1 text-sm text-zinc-500">Submitting locks this revision and totals hash. Final approval releases every successful statutory run automatically.</p>{cycle.approvalPolicyId && <p className="mt-2 text-xs text-zinc-500">Policy: {cycle.approvalPolicyId.name} · level {cycle.currentApprovalLevel} of {cycle.approvalPolicyId.levels.length} · self-approval {cycle.approvalPolicyId.requireSeparationOfDuties ? 'blocked' : 'allowed'}</p>}<label className="mt-4 block text-sm text-zinc-400">Review note<textarea value={comments} onChange={event => setComments(event.target.value)} className="mt-1 min-h-20 w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100" /></label><div className="mt-4 flex flex-wrap gap-3">
      {canRecalculate && <button onClick={() => action('Retry', 'recalculate-failed')} disabled={!!busy} className="min-h-11 border border-zinc-700 px-4 text-sm font-medium disabled:opacity-40">{busy === 'Retry' ? 'Retrying…' : 'Recalculate failed'}</button>}
      {canRetryRelease && <button onClick={() => action('Release', 'approve-and-release')} disabled={!!busy} className="min-h-11 border border-amber-500/50 px-4 text-sm font-medium text-amber-300 disabled:opacity-40">{busy === 'Release' ? 'Retrying…' : 'Retry release'}</button>}
      {canSubmit && <button onClick={() => action('Submit', 'submit')} disabled={!!busy} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">{busy === 'Submit' ? 'Submitting…' : 'Submit payroll'}</button>}
      {canApprove && <button onClick={() => action('Approve', 'approve-and-release')} disabled={!!busy} className="min-h-11 bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">{busy === 'Approve' ? 'Releasing…' : 'Approve and release'}</button>}
      {canApprove && <button onClick={() => action('Reject', 'reject')} disabled={!!busy || !comments.trim()} className="min-h-11 border border-red-500/50 px-4 text-sm font-medium text-red-300 disabled:opacity-40">Reject</button>}
    </div></section>

    <section className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4"><div><h2 className="font-medium text-zinc-100">Accounting delivery</h2><p className="mt-1 text-sm text-zinc-500">Private, expiring links with one native-currency register per legal employer.</p></div>{cycle.status === 'released' && <button onClick={resendAccounting} disabled={!!busy} className="border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40">Resend</button>}</div><div className="divide-y divide-zinc-800">{cycle.deliveries?.map(delivery => <div key={delivery._id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm"><span className="text-zinc-300">{delivery.recipientEmail}</span><span className="ml-auto capitalize text-zinc-500">{delivery.status} · {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? '' : 's'}</span>{delivery.status !== 'revoked' && <button onClick={() => revokeDelivery(delivery._id)} disabled={!!busy} className="text-xs text-red-300 disabled:opacity-40">Revoke</button>}</div>)}{!cycle.deliveries?.length && <p className="px-5 py-6 text-sm text-zinc-500">No delivery attempts yet.</p>}</div></section>
  </div></main>;
}
