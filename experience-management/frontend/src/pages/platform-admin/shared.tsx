import type { ReactNode } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function AdminPageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>;
}

export function AdminLoading({ label = 'Loading platform data…' }: { label?: string }) {
  return <div className="flex min-h-48 items-center justify-center gap-2 border bg-card text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}

export function AdminError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="flex items-start justify-between gap-4 border border-destructive/35 bg-card p-4 text-sm text-destructive" role="alert">
    <div className="flex min-w-0 gap-3"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>
    {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw />Retry</Button>}
  </div>;
}

export function AdminEmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr><td colSpan={columns} className="py-14 text-center text-sm text-muted-foreground">{children}</td></tr>;
}

export function AdminStatus({ value }: { value: string | null | undefined }) {
  const normalized = String(value || 'unknown').toLowerCase();
  const variant = ['active', 'approved', 'success', 'verified', 'completed'].includes(normalized)
    ? 'success'
    : ['pending', 'processing', 'trial', 'open'].includes(normalized)
      ? 'warning'
      : ['rejected', 'disabled', 'failed', 'cancelled'].includes(normalized)
        ? 'destructive'
        : 'outline';
  return <Badge variant={variant} className="capitalize">{normalized.replaceAll('_', ' ')}</Badge>;
}

export function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode; note?: string }> }) {
  return <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-4">
    {items.map((item) => <div className="border-b border-r p-4 last:border-b-0" key={item.label}>
      <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{item.value}</div>
      {item.note && <div className="mt-1 text-xs text-muted-foreground">{item.note}</div>}
    </div>)}
  </div>;
}

export function Pagination({ page, pageSize, total, hasMore, onPage }: {
  page: number; pageSize: number; total: number; hasMore: boolean; onPage: (page: number) => void;
}) {
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return <div className="flex flex-col justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
    <span>{from}–{to} of {total}</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Button></div>
  </div>;
}

export function formatAdminDate(value: string | null | undefined, dateOnly = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export function formatBytes(value: number | null | undefined) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function safeJson(value: unknown) {
  const sensitive = /password|secret|token|authorization|cookie|credential|private.?key|bearer/i;
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(redact);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(child)]));
  };
  return JSON.stringify(redact(value ?? {}), null, 2);
}
