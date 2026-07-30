import { Link } from '@/lib/router';
import { cn } from '@/lib/utils';

export function ExperienceBrand({ className, to = '/' }: { className?: string; to?: string | null }) {
  const content = <>
    <img src="/brand/experience-mark.png" alt="" width={44} height={44} className="h-10 w-10 shrink-0 object-contain" />
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold leading-5 tracking-[-0.015em] text-foreground">Experience Management</span>
      <span className="block text-xs leading-4 text-muted-foreground">Experience management, simplified.</span>
    </span>
  </>;
  const classes = cn('inline-flex items-center gap-3', className);
  return to ? <Link className={classes} to={to} aria-label="Experience Management home">{content}</Link> : <div className={classes}>{content}</div>;
}
