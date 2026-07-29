import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode; className?: string }) {
  return <div className={cn('flex min-h-56 flex-col items-center justify-center border border-dashed bg-muted/20 px-6 py-10 text-center', className)}>
    <Icon className="mb-4 h-6 w-6 text-muted-foreground" />
    <p className="font-semibold">{title}</p>
    <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}
