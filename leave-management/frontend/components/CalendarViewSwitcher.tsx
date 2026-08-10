import Link from 'next/link';
import { CalendarDays, UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';

type Props = {
  active: 'personal' | 'workforce';
  showWorkforce?: boolean;
};

export default function CalendarViewSwitcher({ active, showWorkforce = true }: Props) {
  if (!showWorkforce) return null;

  const items = [
    { id: 'personal' as const, label: 'My calendar', href: '/calendar', icon: UserRound },
    { id: 'workforce' as const, label: 'Workforce calendar', href: '/admin?tab=calendar', icon: CalendarDays },
  ];

  return (
    <nav aria-label="Calendar views" className="border-b border-border">
      <div className="flex gap-6 overflow-x-auto">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active === item.id ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium',
              active === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
