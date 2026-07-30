import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronRight, Database, Loader2, LockKeyhole, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledgeBases';
import { Link, useNavigate } from '@/lib/router';
import type { KnowledgeBase, KnowledgeBasePrivacy } from '@/types';

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not indexed';
}

function stateVariant(state: KnowledgeBase['state']) {
  return state === 'ready' ? 'success' : state === 'failed' ? 'destructive' : ['indexing', 'deleting'].includes(state) ? 'warning' : 'secondary';
}

export function KnowledgeBasesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', privacy: 'space' as KnowledgeBasePrivacy, terraContextEnabled: false });

  const load = useCallback(async () => {
    try {
      setItems(await getKnowledgeBases());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Knowledge bases could not load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(term)) : items;
  }, [items, search]);

  async function create() {
    if (draft.name.trim().length < 2) return;
    setWorking(true);
    try {
      const created = await createKnowledgeBase({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
      setDraft({ name: '', description: '', privacy: 'space', terraContextEnabled: false });
      setCreateOpen(false);
      toast.success('Knowledge base created.');
      navigate(`/knowledge-bases/${created.id}`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Knowledge base could not be created.');
    } finally {
      setWorking(false);
    }
  }

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h1 className="page-title">Knowledge bases</h1><p className="page-description">Index trusted workspace documents, inspect their provenance, and explicitly attach them to Terra requests.</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button><Button size="sm" onClick={() => setCreateOpen(true)}><Plus />New knowledge base</Button></div>
    </header>

    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">{error}</div>}
    <div className="flex flex-col justify-between gap-3 border-y py-3 sm:flex-row sm:items-center">
      <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search knowledge bases" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search knowledge bases" /></div>
      <p className="text-xs text-muted-foreground">{items.length} total · {items.filter((item) => item.state === 'ready').length} ready</p>
    </div>

    {loading ? <div className="grid min-h-[360px] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : visible.length ? <div className="overflow-hidden border bg-card">
      <div className="hidden grid-cols-[minmax(240px,1fr)_130px_130px_170px_36px] gap-4 border-b bg-muted/35 px-4 py-2.5 text-xs font-semibold text-muted-foreground md:grid"><span>Name</span><span>Access</span><span>Documents</span><span>Last indexed</span><span /></div>
      <div className="divide-y">{visible.map((item) => {
        const PrivacyIcon = item.privacy === 'private' ? LockKeyhole : Users;
        return <Link key={item.id} to={`/knowledge-bases/${item.id}`} className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/30 md:grid-cols-[minmax(240px,1fr)_130px_130px_170px_36px] md:items-center md:gap-4">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{item.name}</span><Badge variant={stateVariant(item.state)}>{item.state}</Badge></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description || 'No description'}</p></div>
          <div className="flex items-center gap-1.5 text-xs"><PrivacyIcon className="h-3.5 w-3.5 text-muted-foreground" />{item.privacy === 'private' ? 'Private' : 'Space'}<span className="sr-only">. Terra context {item.terraContextEnabled ? 'enabled' : 'disabled'}.</span></div>
          <div className="text-xs"><span className="font-medium">{item.readyDocumentCount || item.documentCount}</span><span className="text-muted-foreground"> / {item.documentCount} ready</span></div>
          <div className="text-xs text-muted-foreground">{dateLabel(item.lastIndexedAt)}</div>
          <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:block" />
        </Link>;
      })}</div>
    </div> : <div className="grid min-h-[360px] place-items-center border border-dashed bg-muted/15 p-8 text-center"><div className="max-w-md"><Database className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-4 text-base font-semibold">{search ? 'No matching knowledge bases' : 'Create the first knowledge base'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{search ? 'Try a different name or description.' : 'Keep source documents together, index them durably, then choose exactly when Terra may use them.'}</p>{!search && <Button className="mt-5" onClick={() => setCreateOpen(true)}><BookOpenText />New knowledge base</Button>}</div></div>}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>New knowledge base</DialogTitle><DialogDescription>Create the workspace first, then upload documents for durable indexing.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div><Label htmlFor="knowledge-name">Name</Label><Input id="knowledge-name" autoFocus value={draft.name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Product and support knowledge" /></div>
          <div><Label htmlFor="knowledge-description">Description</Label><Textarea id="knowledge-description" rows={3} value={draft.description} maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What this source contains and when it should be used" /></div>
          <div><Label htmlFor="knowledge-privacy">Access</Label><select id="knowledge-privacy" className="mt-2 h-10 w-full rounded-md border-input bg-background text-sm" value={draft.privacy} onChange={(event) => setDraft((current) => ({ ...current, privacy: event.target.value as KnowledgeBasePrivacy }))}><option value="space">Everyone in this space</option><option value="private">Private to me</option></select></div>
          <label className="flex items-center justify-between gap-4 border px-3 py-3"><span><span className="block text-sm font-medium">Allow as Terra context</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Off by default. When enabled and explicitly selected, relevant excerpts may be sent to the Terra local-cloud runtime.</span></span><input type="checkbox" className="h-4 w-4" checked={draft.terraContextEnabled} onChange={(event) => setDraft((current) => ({ ...current, terraContextEnabled: event.target.checked }))} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={working}>Cancel</Button><Button onClick={() => void create()} disabled={working || draft.name.trim().length < 2}>{working ? <Loader2 className="animate-spin" /> : <Plus />}Create knowledge base</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
