'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { auditLogsApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { OrganizationAuditLog } from '@/types';

function actionLabel(action: string) {
  return action.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export default function LeaveAuditPanel() {
  const [logs, setLogs] = useState<OrganizationAuditLog[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    auditLogsApi.getAll({ page, limit: 50, ...(search ? { search } : {}), ...(action ? { action } : {}) })
      .then((response) => { setLogs(response.logs || []); setPages(response.pagination.pages || 1); })
      .catch((requestError) => setError(requestError.response?.data?.error || 'Unable to load audit history.'))
      .finally(() => setLoading(false));
  }, [page, search, action]);

  return (
    <section aria-labelledby="leave-audit-title" className="space-y-5">
      <div><h2 id="leave-audit-title" className="text-lg font-semibold">Audit history</h2><p className="mt-1 text-sm text-muted-foreground">A tenant-scoped record of leave policy, entitlement, and request changes.</p></div>
      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }} className="flex min-w-[260px] flex-1 gap-2"><label className="relative flex-1"><span className="sr-only">Search audit history</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" placeholder="Search person, administrator, or detail" /></label><Button type="submit" variant="outline">Search</Button></form>
        <select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">All activity</option><option value="leave_entitlement_adjusted">Entitlement changes</option><option value="leave_balances_initialized">Balance initialization</option><option value="leave_type_created">Leave type created</option><option value="leave_type_updated">Leave type updated</option><option value="leave_type_archived">Leave type archived</option><option value="leave_policy_updated">Policy updates</option><option value="leave_request_approved">Approvals</option></select>
      </div>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Performed by</th><th className="px-4 py-3">Details</th></tr></thead><tbody className="divide-y divide-border">{logs.map((log) => <tr key={log._id}><td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatDate(log.performedAt, 'MMM d, yyyy HH:mm')}</td><td className="px-4 py-4 font-medium">{actionLabel(log.action)}</td><td className="px-4 py-4">{log.performedByName || log.performedByEmail || log.performedBy}</td><td className="max-w-xl px-4 py-4 text-muted-foreground">{log.details || '—'}</td></tr>)}{!loading && logs.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No audit events matched.</td></tr>}{loading && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Loading audit history…</td></tr>}</tbody></table></div>
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="px-2 py-2 text-sm text-muted-foreground">Page {page} of {Math.max(pages, 1)}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
    </section>
  );
}
