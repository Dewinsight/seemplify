import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileSignature, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { esignStatusLabel } from '@/lib/esign';
import { formatDate } from '@/lib/utils';
import { Link } from '@/lib/router';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { RecipientDocumentLibrary } from '@/components/esign/RecipientDocumentLibrary';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ESignEnvelope } from '@/types';

function statusVariant(status: ESignEnvelope['status']) {
  if (status === 'completed') return 'success' as const;
  if (['declined', 'voided', 'expired', 'failed'].includes(status)) return 'destructive' as const;
  if (['sent', 'in_progress', 'finalizing'].includes(status)) return 'warning' as const;
  return 'secondary' as const;
}

export function AgreementsPage() {
  const [agreements, setAgreements] = useState<ESignEnvelope[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setAgreements(await api<ESignEnvelope[]>('/api/esign/envelopes')); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not load agreements.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);
  const visible = useMemo(() => agreements.filter((item) => `${item.title} ${item.subject} ${item.status}`.toLowerCase().includes(search.trim().toLowerCase())), [agreements, search]);

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="page-title">Agreements</h1><p className="page-description">Send agreements from this space and keep every document you have personally signed in one place.</p></div>
      <Button asChild><Link to="/agreements/new"><Plus />New agreement</Link></Button>
    </div>
    <Tabs defaultValue="sent">
      <TabsList aria-label="Agreement views">
        <TabsTrigger value="sent">Sent by this space</TabsTrigger>
        <TabsTrigger value="signed">Signed by me</TabsTrigger>
      </TabsList>
      <TabsContent value="sent">
        <div className="mb-5"><h2 className="text-base font-semibold">Sent by this space</h2><p className="mt-1 text-sm text-muted-foreground">Prepare documents, collect signatures in order, and retain the full signing history for this space.</p></div>
        <div className="flex items-center gap-3 border-b pb-4"><div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search agreements" className="pl-9" placeholder="Search agreements" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="text-sm text-muted-foreground">{visible.length} agreement{visible.length === 1 ? '' : 's'}</div></div>
        <div className="mt-5">
          {loading ? <div className="h-64 animate-pulse border bg-muted/40" role="status" aria-label="Loading sent agreements" /> : visible.length ? <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table min-w-[820px]"><thead><tr><th>Agreement</th><th>Status</th><th>Documents</th><th>Recipients</th><th>Completed</th><th>Updated</th><th /></tr></thead><tbody>{visible.map((agreement) => <tr key={agreement.id}>
            <td className="min-w-72"><div className="font-medium">{agreement.title}</div><div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{agreement.subject || 'Email message not configured'}</div></td>
            <td><Badge variant={statusVariant(agreement.status)}>{esignStatusLabel(agreement.status)}</Badge></td>
            <td>{agreement.documentCount || 0}</td><td>{agreement.recipientCount || 0}</td><td>{agreement.completedRecipientCount || 0}</td><td>{formatDate(agreement.updatedAt)}</td>
            <td className="text-right"><Button size="sm" variant="ghost" asChild><Link to={`/agreements/${agreement.id}`}>Open <ArrowRight /></Link></Button></td>
          </tr>)}</tbody></table></div></div> : <EmptyState icon={FileSignature} title={search ? 'No matching agreements' : 'Create your first agreement'} description={search ? 'Try another name, subject, or status.' : 'Upload a PDF, add recipients, place signing fields, and send it securely.'} action={!search && <Button asChild><Link to="/agreements/new">New agreement</Link></Button>} />}
        </div>
      </TabsContent>
      <TabsContent value="signed">
        <div className="mb-5"><h2 className="text-base font-semibold">Signed by me</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Documents addressed to your verified account are shown across all spaces, including agreements sent by organisations you do not belong to.</p></div>
        <RecipientDocumentLibrary />
      </TabsContent>
    </Tabs>
  </div>;
}
