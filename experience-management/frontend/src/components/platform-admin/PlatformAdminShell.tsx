import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, Building2, ClipboardCheck, CreditCard, FileClock, LayoutDashboard, ListTodo, LogOut, Menu, Package, Shield, ShieldCheck, SlidersHorizontal, Users, X, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Link, NavLink, useLocation } from '@/lib/router';
import { cn } from '@/lib/utils';
import { normalizePlatformAdminPage, platformAdminApi } from '@/lib/platformAdminApi';
import type { AuthSession } from '@/types';
import { platformAdminHasPermission, type PlatformAdminCapability, type PlatformAdminMe, type PlatformSubscriptionRequest } from '@/pages/platform-admin/types';

type PlatformSession = AuthSession & {
  permissions?: { platformAdmin?: boolean; rootPlatformAdmin?: boolean; platformRoles?: string[] };
};

const navigation: Array<{ to: string; label: string; icon: LucideIcon; end: boolean; capability: PlatformAdminCapability | null }> = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, capability: 'analytics.read' },
  { to: '/admin/users', label: 'Users', icon: Users, end: false, capability: 'users.read' },
  { to: '/admin/roles', label: 'Roles & permissions', icon: Shield, end: false, capability: 'roles.read' },
  { to: '/admin/spaces', label: 'Spaces', icon: Building2, end: false, capability: 'spaces.read' },
  { to: '/admin/plans', label: 'Plans', icon: Package, end: false, capability: 'subscriptions.read' },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard, end: false, capability: 'subscriptions.read' },
  { to: '/admin/subscription-requests', label: 'Subscription requests', icon: ClipboardCheck, end: false, capability: 'subscriptions.read' },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, end: false, capability: 'analytics.read' },
  { to: '/admin/jobs', label: 'AI queue', icon: ListTodo, end: false, capability: 'jobs.read' },
  { to: '/admin/activity', label: 'Activity', icon: Activity, end: false, capability: 'activity.read' },
  { to: '/admin/ai-defaults', label: 'AI defaults', icon: SlidersHorizontal, end: false, capability: 'ai_defaults.read' },
  { to: '/admin/audit', label: 'Audit log', icon: FileClock, end: false, capability: 'audit.read' }
];

const PlatformAdminAccessContext = createContext<PlatformAdminMe | null>(null);

export function usePlatformAdminAccess() {
  const access = useContext(PlatformAdminAccessContext);
  if (!access) throw new Error('Platform administrator access has not loaded.');
  return access;
}

function isPlatformAdmin(session: PlatformSession | null) {
  return Boolean(session?.permissions?.platformAdmin);
}

function AdminNavigation({ session, access, pending, close }: { session: PlatformSession; access: PlatformAdminMe; pending: number; close?: () => void }) {
  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { window.location.assign('/login'); }
  }
  return <>
    <Link to="/admin" onClick={close} className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
      <img src="/brand/experience-mark.png" alt="" className="h-8 w-8 object-contain" width={32} height={32} />
      <div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Platform administration</div></div>
    </Link>
    <div className="border-b p-3"><Button asChild variant="ghost" size="sm" className="w-full justify-start"><Link to="/" onClick={close}><ArrowLeft />Back to Experience</Link></Button></div>
    <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" aria-label="Platform administration">
      {navigation.filter((item) => !item.capability || platformAdminHasPermission(access, item.capability)).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={close} className={({ isActive }) => cn(
        'flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        isActive && 'bg-secondary text-secondary-foreground'
      )}>
        <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{label}</span>
        {to === '/admin/subscription-requests' && pending > 0 && <Badge variant="warning" aria-label={`${pending} pending requests`}>{pending}</Badge>}
      </NavLink>)}
    </nav>
    <div className="shrink-0 border-t p-3">
      <div className="px-2 py-1.5"><div className="truncate text-xs font-semibold">{session.user?.name}</div><div className="mt-0.5 truncate text-[11px] text-muted-foreground">{session.user?.email}</div></div>
      <button type="button" onClick={() => void signOut()} className="mt-1 flex h-9 w-full items-center gap-3 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-4 w-4" />Sign out</button>
    </div>
  </>;
}

export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [access, setAccess] = useState<PlatformAdminMe | null>(null);
  const [accessError, setAccessError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const location = useLocation();

  const loadPending = useCallback(async () => {
    try {
      const value = await platformAdminApi<unknown>('/api/platform-admin/subscription-requests?status=pending&offset=0&limit=1');
      setPending(normalizePlatformAdminPage<PlatformSubscriptionRequest>(value, 1, 1).total);
    } catch { /* Page-level errors remain authoritative. */ }
  }, []);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setAccessError('');
    try {
      const value = await api<PlatformSession>('/api/auth/session');
      setSession(value);
      if (isPlatformAdmin(value)) setAccess(await platformAdminApi<PlatformAdminMe>('/api/platform-admin/me'));
      else setAccess(null);
    } catch (cause) {
      setAccessError(cause instanceof Error ? cause.message : 'Could not verify platform administrator access.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadAccess(); }, [loadAccess]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!platformAdminHasPermission(access, 'subscriptions.read')) return;
    void loadPending();
    const timer = window.setInterval(() => void loadPending(), 30_000);
    return () => window.clearInterval(timer);
  }, [access, loadPending]);
  useEffect(() => {
    if (!mobileOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [mobileOpen]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Checking administrator access…</div>;
  if (accessError) return <div className="grid min-h-screen place-items-center bg-background p-6"><div className="w-full max-w-md border bg-card p-6"><ShieldCheck className="h-6 w-6 text-muted-foreground" /><h1 className="mt-4 text-lg font-semibold">Administrator access could not be checked</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{accessError}</p><div className="mt-5 flex gap-2"><Button onClick={() => void loadAccess()}>Retry</Button><Button asChild variant="outline"><Link to="/">Return to Experience</Link></Button></div></div></div>;
  if (!session?.authenticated || !session.user) {
    window.location.assign('/login');
    return null;
  }
  if (!isPlatformAdmin(session)) return <div className="grid min-h-screen place-items-center bg-background p-6"><div className="w-full max-w-md border bg-card p-6"><ShieldCheck className="h-6 w-6 text-muted-foreground" /><h1 className="mt-4 text-lg font-semibold">Platform administrator access required</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">This area contains platform-wide customer, subscription, and audit information.</p><Button asChild variant="outline" className="mt-5"><Link to="/">Return to Experience</Link></Button></div></div>;
  if (!access) return <div className="grid min-h-screen place-items-center bg-background p-6"><div className="w-full max-w-md border bg-card p-6"><ShieldCheck className="h-6 w-6 text-muted-foreground" /><h1 className="mt-4 text-lg font-semibold">Administrator profile unavailable</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The platform administrator profile did not include access details.</p><Button className="mt-5" onClick={() => void loadAccess()}>Retry</Button></div></div>;

  const exact = navigation.find((item) => item.to === location.pathname)?.label;
  const title = exact || (location.pathname.startsWith('/admin/users/') ? 'User detail' : location.pathname.startsWith('/admin/spaces/') ? 'Space detail' : location.pathname.startsWith('/admin/subscription-requests/') ? 'Subscription request' : location.pathname.startsWith('/admin/jobs/') ? 'AI job detail' : location.pathname.startsWith('/admin/audit/') ? 'Audit event' : 'Platform administration');
  const requiredCapability: PlatformAdminCapability | null = location.pathname === '/admin'
    ? 'analytics.read'
    : location.pathname.startsWith('/admin/users')
      ? 'users.read'
    : location.pathname.startsWith('/admin/roles')
      ? 'roles.read'
    : location.pathname.startsWith('/admin/spaces')
      ? 'spaces.read'
      : location.pathname.startsWith('/admin/plans') || location.pathname.startsWith('/admin/subscriptions') || location.pathname.startsWith('/admin/subscription-requests')
        ? 'subscriptions.read'
        : location.pathname.startsWith('/admin/analytics')
          ? 'analytics.read'
          : location.pathname.startsWith('/admin/jobs')
            ? 'jobs.read'
            : location.pathname.startsWith('/admin/activity')
              ? 'activity.read'
              : location.pathname.startsWith('/admin/ai-defaults')
                ? 'ai_defaults.read'
          : location.pathname.startsWith('/admin/audit')
            ? 'audit.read'
            : null;
  const routeAllowed = !requiredCapability || platformAdminHasPermission(access, requiredCapability);
  const firstAllowedPath = navigation.find((item) => !item.capability || platformAdminHasPermission(access, item.capability))?.to || '/';

  return <PlatformAdminAccessContext.Provider value={access}><div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-hidden border-r bg-card md:flex"><AdminNavigation session={session} access={access} pending={pending} /></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 md:hidden"><button className="absolute inset-0 bg-foreground/30" aria-label="Dismiss navigation" onClick={() => setMobileOpen(false)} /><aside className="relative flex h-full w-[278px] flex-col overflow-hidden border-r bg-card shadow-panel"><button className="absolute right-3 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></button><AdminNavigation session={session} access={access} pending={pending} close={() => setMobileOpen(false)} /></aside></div>}
    <div className="md:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6"><div className="flex items-center gap-3"><Button className="md:hidden" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button><div className="text-sm font-semibold">{title}</div></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /><span className="hidden sm:inline">Platform-wide access</span></div></header>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{routeAllowed ? children : <div className="border bg-card p-6"><h1 className="text-lg font-semibold">This administrator role cannot open this area</h1><p className="mt-2 text-sm text-muted-foreground">Your platform role does not include the required read permission.</p><Button asChild variant="outline" className="mt-5"><Link to={firstAllowedPath}>Open an available admin area</Link></Button></div>}</main>
    </div>
  </div></PlatformAdminAccessContext.Provider>;
}
