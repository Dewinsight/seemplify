'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Clock, Landmark, Loader2, XCircle } from 'lucide-react';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';

type BankAccount = {
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  country?: string;
  countryCode?: string;
  branchCode?: string;
  routingNumber?: string;
  iban?: string;
  swiftCode?: string;
  accountType?: string;
};

type BankRequest = {
  _id: string;
  userName?: string;
  status: string;
  reason?: string;
  proposedAccount?: BankAccount;
  proposedAccountSummary?: { bankName?: string; countryCode?: string; accountLast4?: string };
  previousAccountSummary?: { bankName?: string; countryCode?: string; accountLast4?: string };
  reviewComment?: string;
  createdAt: string;
};

const mask = (last4 = '') => last4 ? `•••• ${last4.slice(-4)}` : 'Not set';

export default function BankingApprovalsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BankRequest[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/payroll/banking/requests', { params: { status: filter } });
      setRequests(response.data.requests || []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Unable to load bank account requests.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    handleAuthCallback();
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    load();
  }, [load, router]);

  const review = async (requestId: string, action: 'approve' | 'reject') => {
    const comment = action === 'reject' ? window.prompt('Reason for rejection:') : '';
    if (action === 'reject' && !comment) return;
    setProcessing(requestId);
    setError('');
    try {
      await api.post(`/payroll/banking/requests/${requestId}/action`, { action, comment });
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || `Unable to ${action} the request.`);
    } finally {
      setProcessing('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Bank account changes</h1>
        <p className="mt-1 text-sm text-zinc-400">Review employee requests before changing the salary account used by Payroll.</p>
      </div>

      <div className="flex gap-1 border-b border-zinc-800" role="tablist" aria-label="Bank request status">
        {['pending', 'approved', 'rejected', 'all'].map((status) => (
          <button key={status} role="tab" aria-selected={filter === status} onClick={() => setFilter(status)} className={`border-b-2 px-4 py-2 text-sm capitalize ${filter === status ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{status}</button>
        ))}
      </div>

      {error && <div role="alert" className="border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 px-6 py-12 text-center"><Landmark className="mx-auto h-8 w-8 text-zinc-600" /><p className="mt-3 text-sm text-zinc-500">No {filter === 'all' ? '' : filter} bank account requests.</p></div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900 text-zinc-500"><tr><th className="px-4 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Current</th><th className="px-4 py-3 font-medium">Proposed account</th><th className="px-4 py-3 font-medium">Requested</th><th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {requests.map((request) => (
                <tr key={request._id} className="align-top">
                  <td className="px-4 py-4"><div className="font-medium text-white">{request.userName || 'Employee'}</div>{request.reason && <div className="mt-1 max-w-xs text-xs text-zinc-500">{request.reason}</div>}</td>
                  <td className="px-4 py-4 text-zinc-400">{request.previousAccountSummary?.bankName || 'None'}<div className="mt-1 font-mono text-xs text-zinc-600">{mask(request.previousAccountSummary?.accountLast4)}</div></td>
                  <td className="px-4 py-4"><div className="text-zinc-200">{request.proposedAccount?.bankName || request.proposedAccountSummary?.bankName}</div><div className="mt-1 font-mono text-xs text-zinc-400">{mask(request.proposedAccountSummary?.accountLast4)} · {request.proposedAccount?.countryCode || request.proposedAccountSummary?.countryCode}</div><div className="mt-2 text-xs text-zinc-500">Holder: {request.proposedAccount?.accountName || '—'}{request.proposedAccount?.branchCode ? ` · Branch ${request.proposedAccount.branchCode}` : ''}{request.proposedAccount?.routingNumber ? ` · Routing ${request.proposedAccount.routingNumber}` : ''}</div></td>
                  <td className="px-4 py-4 text-zinc-500">{new Date(request.createdAt).toLocaleString()}<div className="mt-2 inline-flex items-center gap-1 capitalize"><Clock className="h-3.5 w-3.5" />{request.status}</div></td>
                  <td className="px-4 py-4 text-right">{request.status === 'pending' && <div className="flex justify-end gap-2"><button onClick={() => review(request._id, 'approve')} disabled={processing === request._id} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-500 disabled:opacity-50"><CheckCircle className="h-4 w-4" /> Approve</button><button onClick={() => review(request._id, 'reject')} disabled={processing === request._id} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-2 text-zinc-300 hover:border-zinc-500 disabled:opacity-50"><XCircle className="h-4 w-4" /> Reject</button></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
