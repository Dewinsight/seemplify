import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, CheckSquare, LockKeyhole, Search, Square, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { getKnowledgeBases } from '@/lib/knowledgeBases';
import { Link } from '@/lib/router';
import type { KnowledgeBase } from '@/types';

export interface KnowledgeBasePickerProps {
  value: string[];
  onChange: (knowledgeBaseIds: string[]) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  max?: number;
  allowPrivate?: boolean;
  excludeIds?: string[];
}

function canSelect(item: KnowledgeBase, allowPrivate: boolean) {
  return (allowPrivate || item.privacy === 'space')
    && item.terraContextEnabled
    && (item.state === 'ready' || (['indexing', 'degraded'].includes(item.state) && item.readyDocumentCount > 0));
}

export function KnowledgeBasePicker({
  value,
  onChange,
  disabled = false,
  label = 'Knowledge bases',
  description = 'Optionally ground Terra in selected workspace documents.',
  max = 5,
  allowPrivate = false,
  excludeIds = []
}: KnowledgeBasePickerProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setKnowledgeBases(await getKnowledgeBases());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Knowledge bases could not load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const selected = value.map((id) => knowledgeBases.find((item) => item.id === id)).filter(Boolean) as KnowledgeBase[];
  const selectedProvider = selected.find((item) => item.embeddingProfile?.provider)?.embeddingProfile?.provider;
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term
      ? knowledgeBases.filter((item) => !excludeIds.includes(item.id) && `${item.name} ${item.description}`.toLocaleLowerCase().includes(term))
      : knowledgeBases.filter((item) => !excludeIds.includes(item.id));
  }, [excludeIds, knowledgeBases, search]);

  function toggle(item: KnowledgeBase) {
    if (!canSelect(item, allowPrivate)) return;
    if (!value.includes(item.id) && selectedProvider && item.embeddingProfile?.provider
      && selectedProvider !== item.embeddingProfile.provider) return;
    if (value.includes(item.id)) onChange(value.filter((id) => id !== item.id));
    else if (value.length < max) onChange([...value, item.id]);
  }

  return <div className="space-y-2" data-testid="knowledge-base-picker">
    <div>
      <Label>{label}</Label>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
    {selected.length > 0 && <div className="divide-y border" aria-label="Selected knowledge bases">
      {selected.map((item) => <div className="flex items-center justify-between gap-3 px-3 py-2" key={item.id}>
        <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((id) => id !== item.id))} disabled={disabled} aria-label={`Remove ${item.name}`}><X className="h-4 w-4" /></button>
      </div>)}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled || loading} onClick={() => setOpen(true)}>
        <BookOpenText />{loading ? 'Loading knowledge bases…' : value.length ? 'Change selection' : 'Choose knowledge bases'}
      </Button>
      <span className="text-xs text-muted-foreground">{value.length} of {max} selected</span>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Select knowledge bases</DialogTitle>
          <DialogDescription>Nothing is selected automatically. Shared AI outputs can use only ready, space-visible knowledge bases that allow Terra context.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search knowledge bases" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or description" />
        </div>
        <div className="max-h-[360px] overflow-y-auto border">
          {visible.length ? <div className="divide-y">{visible.map((item) => {
            const active = value.includes(item.id);
            const compatible = active || !selectedProvider || !item.embeddingProfile?.provider
              || selectedProvider === item.embeddingProfile.provider;
            const available = canSelect(item, allowPrivate) && compatible;
            const PrivacyIcon = item.privacy === 'private' ? LockKeyhole : Users;
            return <button
              type="button"
              key={item.id}
              className={`flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/35 disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'bg-accent/45' : ''}`}
              onClick={() => toggle(item)}
              disabled={!available || (!active && value.length >= max)}
              aria-pressed={active}
            >
              {active ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.description || 'No description'}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><PrivacyIcon className="h-3 w-3" />{item.privacy === 'private' ? 'Private' : 'Space'} · {item.documentCount} documents · {item.embeddingProfile?.provider === 'gte-node' ? 'GTE' : 'Qwen'} · {available ? item.state === 'ready' ? 'Ready' : `${item.readyDocumentCount} ready while indexing` : !compatible ? 'Uses a different embedding profile' : item.privacy === 'private' ? 'Not shareable with this output' : item.terraContextEnabled ? item.state : 'Terra context off'}</span>
              </span>
            </button>;
          })}</div> : <div className="px-4 py-10 text-center text-sm text-muted-foreground">No matching knowledge bases.</div>}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Button variant="link" size="sm" asChild><Link to="/knowledge-bases">Manage knowledge bases</Link></Button>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => onChange([])} disabled={!value.length}>Clear</Button><Button type="button" onClick={() => setOpen(false)}>Done</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
