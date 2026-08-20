'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Clock, Landmark, Loader2, XCircle } from 'lucide-react';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';
import {
  getPayrollBankAccountTypes,
  getPayrollBankJurisdiction,
  NIGERIAN_BANK_OPTIONS,
  PAYROLL_BANK_JURISDICTIONS,
} from '@/lib/payrollBankJurisdictions.mjs';

type BankAccount = {
  country: string;
  countryCode: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  branchCode: string;
  routingNumber: string;
  iban: string;
  swiftCode: string;
  accountType: string;
  isVerified?: boolean;
};

type ChangeRequest = {
  _id: string;
  status: string;
  reason?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewComment?: string;
  proposedAccountSummary?: { bankName?: string; countryCode?: string; accountLast4?: string };
};

const emptyAccount = (country = 'USA'): BankAccount => ({
  country,
  countryCode: getPayrollBankJurisdiction(country).code,
  accountName: '',
  accountNumber: '',
  bankName: '',
  branchCode: '',
  routingNumber: '',
  iban: '',
  swiftCode: '',
  accountType: getPayrollBankAccountTypes(country)[0]?.value || 'checking',
});

const mask = (value = '') => value ? `•••• ${value.replace(/\s+/g, '').slice(-4)}` : 'Not set';

export default function BankingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<BankAccount | null>(null);
  const [pending, setPending] = useState<ChangeRequest | null>(null);
  const [history, setHistory] = useState<ChangeRequest[]>([]);
  const [form, setForm] = useState<BankAccount>(emptyAccount());
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const jurisdiction = useMemo(() => getPayrollBankJurisdiction(form.country), [form.country]);

  const load = useCallback(async () => {
    const response = await api.get('/payroll/banking/me');
    const activeAccount = response.data.account || null;
    setCurrent(activeAccount);
    setPending(response.data.pendingRequest || null);
    setHistory(response.data.history || []);
    if (!activeAccount && response.data.payrollCountryCode) {
      const match = PAYROLL_BANK_JURISDICTIONS.find((item: any) => item.code === response.data.payrollCountryCode);
      if (match) setForm(emptyAccount(match.value));
    }
  }, []);

  useEffect(() => {
    handleAuthCallback();
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    load().catch((requestError) => setError(requestError?.response?.data?.error || 'Unable to load banking details.'))
      .finally(() => setLoading(false));
  }, [load, router]);

  const setCountry = (country: string) => {
    setForm(emptyAccount(country));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.post('/payroll/banking/requests', { account: form, reason });
      await load();
      setEditing(false);
      setReason('');
      setForm(emptyAccount(form.country));
      setMessage('Your change request was sent to HR. Your current salary account remains active until approval.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Unable to submit the account change.');
    } finally {
      setSaving(false);
    }
  };

  const cancelPending = async () => {
    if (!pending) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/payroll/banking/requests/${pending._id}`);
      await load();
      setMessage('The pending request was cancelled.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Unable to cancel the request.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Banking and direct deposit</h1>
        <p className="mt-1 text-sm text-zinc-400">Your approved account is used for payroll payments.</p>
      </div>

      {message && <div role="status" className="border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}
      {error && <div role="alert" className="border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-white">Current salary account</h2>
            <p className="mt-1 text-sm text-zinc-500">Only an approved account is used in payroll.</p>
          </div>
          {current?.isVerified && <span className="inline-flex items-center gap-1 text-sm text-emerald-400"><CheckCircle className="h-4 w-4" /> Verified</span>}
        </div>
        {current ? (
          <dl className="mt-5 grid gap-4 border-t border-zinc-800 pt-5 sm:grid-cols-2">
            <div><dt className="text-xs text-zinc-500">Account holder</dt><dd className="mt-1 text-sm text-zinc-200">{current.accountName}</dd></div>
            <div><dt className="text-xs text-zinc-500">Bank</dt><dd className="mt-1 text-sm text-zinc-200">{current.bankName}</dd></div>
            <div><dt className="text-xs text-zinc-500">Account</dt><dd className="mt-1 font-mono text-sm text-zinc-200">{mask(current.accountNumber || current.iban)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Country</dt><dd className="mt-1 text-sm text-zinc-200">{current.country}</dd></div>
          </dl>
        ) : <p className="mt-5 border-t border-zinc-800 pt-5 text-sm text-zinc-400">No salary account has been approved yet.</p>}

        {!pending && !editing && (
          <button onClick={() => setEditing(true)} className="mt-5 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
            {current ? 'Request account change' : 'Add salary account'}
          </button>
        )}
      </section>

      {pending && (
        <section className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-5">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 text-amber-400" />
            <div className="flex-1">
              <h2 className="font-medium text-white">Change awaiting HR approval</h2>
              <p className="mt-1 text-sm text-zinc-400">
                {pending.proposedAccountSummary?.bankName || 'New bank'} · {mask(pending.proposedAccountSummary?.accountLast4)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Requested {new Date(pending.createdAt).toLocaleString()}</p>
            </div>
            <button onClick={cancelPending} disabled={saving} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50">
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          </div>
        </section>
      )}

      {editing && !pending && (
        <form onSubmit={submit} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="font-medium text-white">Proposed salary account</h2>
          <p className="mt-1 text-sm text-zinc-500">The existing account remains active until HR approves this request.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-zinc-300">Country
              <select value={form.country} onChange={(event) => setCountry(event.target.value)} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
                {PAYROLL_BANK_JURISDICTIONS.filter((item: any) => item.code !== 'OTHER').map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-zinc-300">Account holder name
              <input required value={form.accountName} onChange={(event) => setForm({ ...form, accountName: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white" />
            </label>
            {form.country === 'Nigeria' ? (
              <label className="text-sm text-zinc-300">Bank
                <select required value={form.branchCode} onChange={(event) => { const bank = NIGERIAN_BANK_OPTIONS.find((item: any) => item.code === event.target.value); setForm({ ...form, branchCode: event.target.value, bankName: bank?.name || '' }); }} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
                  <option value="">Select a bank</option>
                  {NIGERIAN_BANK_OPTIONS.map((bank: any) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="text-sm text-zinc-300">Bank name
                <input required value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white" />
              </label>
            )}
            {jurisdiction.requiresAccountNumber && <label className="text-sm text-zinc-300">{jurisdiction.accountNumberLabel || 'Account number'}
              <input required value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} placeholder={jurisdiction.accountNumberPlaceholder} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-white" />
            </label>}
            {jurisdiction.localField && form.country !== 'Nigeria' && <label className="text-sm text-zinc-300">{jurisdiction.localField.label}
              <input required={jurisdiction.localField.required} value={jurisdiction.localField.key === 'routingNumber' ? form.routingNumber : form.branchCode} onChange={(event) => setForm({ ...form, [jurisdiction.localField.key === 'routingNumber' ? 'routingNumber' : 'branchCode']: event.target.value })} placeholder={jurisdiction.localField.placeholder} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-white" />
            </label>}
            {jurisdiction.supportsIban && <label className="text-sm text-zinc-300">IBAN
              <input required={jurisdiction.requiresIban} value={form.iban} onChange={(event) => setForm({ ...form, iban: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono uppercase text-white" />
            </label>}
            {jurisdiction.supportsSwift && <label className="text-sm text-zinc-300">BIC / SWIFT
              <input required={jurisdiction.swiftRequired} value={form.swiftCode} onChange={(event) => setForm({ ...form, swiftCode: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono uppercase text-white" />
            </label>}
            <label className="text-sm text-zinc-300">Account type
              <select value={form.accountType} onChange={(event) => setForm({ ...form, accountType: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
                {getPayrollBankAccountTypes(form.country).map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-zinc-300 sm:col-span-2">Reason for change <span className="text-zinc-600">(optional)</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white" />
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <button type="submit" disabled={saving} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50">{saving ? 'Submitting…' : 'Send for HR approval'}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500">Cancel</button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="font-medium text-white">Request history</h2>
          <div className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {history.map((request) => <div key={request._id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-zinc-300">{request.proposedAccountSummary?.bankName || 'Salary account'} · {mask(request.proposedAccountSummary?.accountLast4)}</span><span className="capitalize text-zinc-500">{request.status}</span></div>)}
          </div>
        </section>
      )}
    </div>
  );
}
