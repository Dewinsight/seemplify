'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, UserRound, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { leaveBalancesApi } from '@/lib/api';
import { LeaveEntitlement, LeaveEntitlementAdjustment, LeaveMember } from '@/types';
import { formatDate, getEntitlementAdjustmentLabel } from '@/lib/utils';

type AdjustmentMode = 'add' | 'deduct' | 'set' | 'reset';

export default function PeopleEntitlementsPanel() {
  const [members, setMembers] = useState<LeaveMember[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<LeaveMember | null>(null);
  const [history, setHistory] = useState<LeaveEntitlementAdjustment[]>([]);
  const [adjusting, setAdjusting] = useState<LeaveEntitlement | null>(null);
  const [mode, setMode] = useState<AdjustmentMode>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadMembers() {
    setLoading(true);
    setError('');
    try {
      const response = await leaveBalancesApi.getMembers({ year, page, limit: 20, ...(search ? { search } : {}) });
      setMembers(response.members || []);
      setPages(response.pagination.pages || 1);
      setTotal(response.pagination.total || 0);
      if (selected) {
        const fresh = (response.members || []).find((member: LeaveMember) => member.userId === selected.userId);
        if (fresh) setSelected(fresh);
      }
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to load organization members.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMembers(); }, [year, page, search]);

  async function openMember(member: LeaveMember) {
    setSelected(member);
    setError('');
    try {
      const response = await leaveBalancesApi.getUserHistory(member.userId, year);
      setHistory(response.adjustments || []);
    } catch {
      setHistory([]);
    }
  }

  function openAdjustment(entitlement: LeaveEntitlement) {
    setAdjusting(entitlement);
    setMode('add');
    setAmount('');
    setReason('');
    setError('');
  }

  async function saveAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !adjusting) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        year,
        reason,
        operation: mode,
        expectedVersion: selected.balance.version,
        ...(mode === 'add' ? { delta: Math.abs(Number(amount)) } : {}),
        ...(mode === 'deduct' ? { delta: -Math.abs(Number(amount)) } : {}),
        ...(mode === 'set' ? { total: Number(amount) } : {}),
        ...(mode === 'reset' ? { resetToPolicy: true } : {}),
      };
      const response = await leaveBalancesApi.adjustEntitlement(selected.userId, adjusting.leaveTypeKey, payload);
      const updated = { ...selected, balance: response.balance || selected.balance };
      setSelected(updated);
      setMembers((current) => current.map((member) => member.userId === updated.userId ? updated : member));
      setAdjusting(null);
      const historyResponse = await leaveBalancesApi.getUserHistory(selected.userId, year);
      setHistory(historyResponse.adjustments || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to change this entitlement.');
    } finally {
      setSaving(false);
    }
  }

  async function initializeEveryone() {
    if (!window.confirm(`Initialize ${year} balances for every active organization member? Existing balances and overrides will be preserved.`)) return;
    setLoading(true);
    try {
      await leaveBalancesApi.initializeOrganization(year);
      await loadMembers();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to initialize organization balances.');
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="people-entitlements-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="people-entitlements-title" className="text-lg font-semibold">People and entitlements</h2><p className="mt-1 text-sm text-muted-foreground">Search the authoritative organization roster, review balances, and make audited exceptions.</p></div>
        <Button variant="outline" onClick={initializeEveryone}>Initialize all for {year}</Button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }} className="flex min-w-[260px] flex-1 gap-2">
          <label className="relative flex-1"><span className="sr-only">Search people</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" placeholder="Search name, email, employee ID, or role" /></label>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <label><span className="sr-only">Balance year</span><select value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(1); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{[-1, 0, 1].map((offset) => { const value = new Date().getFullYear() + offset; return <option key={value} value={value}>{value}</option>; })}</select></label>
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Entitlements</th><th className="px-4 py-3">Overrides</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-border">
            {members.map((member) => {
              const active = (member.balance?.entitlements || []).filter((entry) => entry.active);
              const overrides = active.filter((entry) => entry.source === 'override').length;
              return <tr key={member.userId}><td className="px-4 py-4"><div className="font-medium">{member.name}</div><div className="mt-1 text-xs text-muted-foreground">{member.email}{member.employeeId ? ` · ${member.employeeId}` : ''}</div></td><td className="px-4 py-4"><div className="capitalize">{member.role.replace(/_/g, ' ')}</div>{member.teamAssignments?.length ? <div className="mt-1 text-xs text-muted-foreground">{member.teamAssignments.map((team) => team.name).filter(Boolean).join(', ')}</div> : null}</td><td className="px-4 py-4">{active.length} types</td><td className="px-4 py-4">{overrides || 'None'}</td><td className="px-4 py-4 text-right"><Button size="sm" variant="outline" onClick={() => openMember(member)}>Manage leave</Button></td></tr>;
            })}
            {!loading && members.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No organization members matched this search.</td></tr>}
            {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading organization roster…</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{total} organization member{total === 1 ? '' : 's'}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button><span>Page {page} of {Math.max(pages, 1)}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-labelledby="member-balance-title">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted"><UserRound className="h-5 w-5" /></div><div><h3 id="member-balance-title" className="text-lg font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.email} · {year}</p></div></div><Button size="icon" variant="ghost" onClick={() => setSelected(null)} aria-label="Close"><X className="h-5 w-5" /></Button></div>
            <div className="mt-6 space-y-3">{(selected.balance?.entitlements || []).filter((entry) => entry.active).map((entry) => <div key={entry.leaveTypeKey} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">{entry.leaveTypeName}</p><p className="mt-1 text-xs text-muted-foreground">{entry.used} used · {entry.pending} pending · {entry.available} available</p></div><div className="text-right"><p className="font-semibold">{entry.total} days</p><p className="text-xs text-muted-foreground">{entry.source === 'override' ? `Override · default ${entry.policyDefault}` : 'Organization default'}</p></div><Button size="sm" variant="outline" onClick={() => openAdjustment(entry)}>Adjust</Button></div></div>)}</div>
            <div className="mt-8"><h4 className="font-semibold">Change history</h4><div className="mt-3 divide-y divide-border rounded-lg border border-border">{history.map((entry) => <div key={entry._id || `${entry.leaveTypeKey}-${entry.createdAt}`} className="p-4 text-sm"><div className="flex justify-between gap-4"><span className="font-medium">{entry.leaveTypeName}: {getEntitlementAdjustmentLabel(entry)} · {entry.previousTotal} → {entry.newTotal} days</span><span className="text-xs text-muted-foreground">{formatDate(entry.createdAt, 'MMM d, yyyy HH:mm')}</span></div><p className="mt-1 text-muted-foreground">{entry.reason}</p><p className="mt-1 text-xs text-muted-foreground">Changed by {entry.actorName || entry.actorEmail || 'Administrator'}</p></div>)}{history.length === 0 && <p className="p-4 text-sm text-muted-foreground">No entitlement changes recorded.</p>}</div></div>
          </div>
        </div>
      )}

      {adjusting && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="adjust-entitlement-title">
          <form onSubmit={saveAdjustment} className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            <h3 id="adjust-entitlement-title" className="text-lg font-semibold">Adjust {adjusting.leaveTypeName}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.name} currently has {adjusting.total} days.</p>
            <div className="mt-5 space-y-4"><label className="block"><span className="text-sm font-medium">Change</span><select value={mode} onChange={(event) => { setMode(event.target.value as AdjustmentMode); setAmount(''); }} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="add">Add days</option><option value="deduct">Deduct days</option><option value="set">Set exact total</option><option value="reset">Reset to organization default ({adjusting.policyDefault})</option></select></label>{mode !== 'reset' && <label className="block"><span className="text-sm font-medium">{mode === 'set' ? 'New total' : `Days to ${mode}`}</span><input required type="number" min={mode === 'set' ? 0 : 0.5} step="0.5" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>}{mode === 'reset' && <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">This removes the individual override and restores the {adjusting.policyDefault}-day organization default. Used, pending, and approved leave records are preserved.</p>}<label className="block"><span className="text-sm font-medium">Reason</span><textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Explain why this entitlement is changing." /></label></div>
            <div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setAdjusting(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'add' ? 'Add days' : mode === 'deduct' ? 'Deduct days' : mode === 'reset' ? 'Reset entitlement' : 'Set total'}</Button></div>
          </form>
        </div>
      )}
    </section>
  );
}
