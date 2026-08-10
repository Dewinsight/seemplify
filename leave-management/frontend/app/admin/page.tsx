'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, ClipboardCheck, History, Settings2, Users } from 'lucide-react';

import Layout from '@/components/Layout';
import LeaveAuditPanel from '@/components/admin/LeaveAuditPanel';
import LeaveTypesPanel from '@/components/admin/LeaveTypesPanel';
import PeopleEntitlementsPanel from '@/components/admin/PeopleEntitlementsPanel';
import WorkforceCalendarPanel from '@/components/admin/WorkforceCalendarPanel';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

type AdminTab = 'leave-types' | 'people' | 'calendar' | 'audit';
const tabs: Array<{ id: AdminTab; label: string; icon: typeof Settings2 }> = [
  { id: 'leave-types', label: 'Leave types', icon: Settings2 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'calendar', label: 'Workforce calendar', icon: CalendarDays },
  { id: 'audit', label: 'Audit history', icon: History },
];

export default function LeaveAdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganization, isAuthenticated, isLoading } = useAuth();
  const requestedTab = searchParams.get('tab') as AdminTab | null;
  const [tab, setTab] = useState<AdminTab>(tabs.some((item) => item.id === requestedTab) ? requestedTab! : 'leave-types');
  const permissions = currentOrganization?.appPermissions?.['leave-management'] || [];
  const allowed = currentOrganization?.role === 'owner' || currentOrganization?.role === 'admin' || permissions.includes('*') || permissions.includes('manage_policies') || permissions.includes('manage_leaves');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login');
    else if (!isLoading && currentOrganization && !allowed) router.push('/dashboard');
  }, [allowed, currentOrganization, isAuthenticated, isLoading, router]);

  function selectTab(next: AdminTab) {
    setTab(next);
    router.replace(`/admin?tab=${next}`, { scroll: false });
  }

  if (isLoading || !allowed) return <Layout><div className="py-16 text-center text-sm text-muted-foreground">Checking administrator access…</div></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Leave administration</h1><p className="mt-1 text-sm text-muted-foreground">Configure organization defaults, manage employee exceptions, and review every change.</p></div><Link href="/approvals" className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"><ClipboardCheck className="h-4 w-4" /> Review leave requests</Link></div>
        <div className="border-b border-border" role="tablist" aria-label="Leave administration sections"><div className="flex gap-6 overflow-x-auto">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => selectTab(item.id)} className={cn('flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium', tab === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}><item.icon className="h-4 w-4" />{item.label}</button>)}</div></div>
        {tab === 'leave-types' && <LeaveTypesPanel />}
        {tab === 'people' && <PeopleEntitlementsPanel />}
        {tab === 'calendar' && <WorkforceCalendarPanel />}
        {tab === 'audit' && <LeaveAuditPanel />}
      </div>
    </Layout>
  );
}
