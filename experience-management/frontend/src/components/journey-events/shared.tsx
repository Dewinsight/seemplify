import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import type {
  JourneyEventCredentialStatus,
  JourneyEventSchemaState,
  JourneyEventSourceStatus
} from '@/lib/journeyEventControlPlane';

export const controlSelectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function formatControlPlaneDate(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

export function StatusLabel({ status }: { status: JourneyEventSourceStatus | JourneyEventCredentialStatus | JourneyEventSchemaState }) {
  const variant = status === 'active' || status === 'published'
    ? 'success'
    : status === 'revoked' || status === 'retired'
      ? 'destructive'
      : status === 'overlap' || status === 'deprecated' || status === 'paused'
        ? 'warning'
        : 'outline';
  return <Badge variant={variant}>{status.replaceAll('_', ' ')}</Badge>;
}

export function SectionFrame({ title, description, action, children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return <section className="border bg-card" aria-labelledby={`section-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}>
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h2 id={`section-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`} className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>;
}

export function ConfirmationDialog({ open, title, description, confirmLabel, destructive = false, busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700" />{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
