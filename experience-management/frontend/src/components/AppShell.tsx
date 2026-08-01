import { type ReactNode, useEffect, useState } from 'react';
import { BrainCircuit, CircleAlert, CircleCheck, ClipboardList, Cpu, FileSignature, Gauge, Inbox, LoaderCircle, LogOut, MailCheck, Megaphone, Menu, Plus, Radar, Route, Settings2, Sparkles, X } from 'lucide-react';
import { Link, NavLink, useLocation } from '@/lib/router';
import { activeSpaceId, api, json, storeActiveSpaceId, subscribeToSpaceChanges } from '@/lib/api';
import { allowConfirmedSpaceSwitchUnload, confirmDiscardForSpaceSwitch } from '@/lib/unsavedChanges';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AuthSession, SpaceSession } from '@/types';

const navigation = [
  { to: '/', label: 'Overview', icon: Gauge, end: true },
  { to: '/surveys', label: 'Surveys', icon: ClipboardList },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/agreements', label: 'Agreements', icon: FileSignature },
  { to: '/social-listening', label: 'Social listening', icon: Radar },
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit },
  { to: '/assistant', label: 'Personal assistant', icon: MailCheck },
  { to: '/journeys', label: 'Journey maps', icon: Route },
  { to: '/ai-queue', label: 'AI queue', icon: Sparkles },
  { to: '/tickets', label: 'Service recovery', icon: Inbox },
  { to: '/settings/space', label: 'Space settings', icon: Settings2 }
];

function Brand() {
  return <Link to="/" className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
    <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div>
    <div><div className="text-sm font-semibold leading-4">Seemplify</div><div className="text-xs text-muted-foreground">Experience</div></div>
  </Link>;
}

type RuntimeState = 'checking' | 'ready' | 'unavailable';

function runtimeName(label: string) {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim() || label;
}

function runtimeSummary(label: string) {
  const match = label.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return match ? `${match[1].trim()} · ${match[2].trim()}` : label;
}

function SidebarContent({ close, runtimeState, runtimeLabel, session, switching, onSwitch, selectorId }: {
  close?: () => void; runtimeState: RuntimeState; runtimeLabel: string; session: AuthSession | null;
  switching: boolean; onSwitch: (spaceId: string) => void; selectorId: string;
}) {
  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { storeActiveSpaceId(null); window.location.assign('/login'); }
  }
  const status = runtimeState === 'ready' ? 'Ready' : runtimeState === 'checking' ? 'Checking' : 'Unavailable';
  const StatusIcon = runtimeState === 'ready' ? CircleCheck : runtimeState === 'checking' ? LoaderCircle : CircleAlert;
  return <>
    <Brand />
    <div className="border-b px-3 py-3">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={selectorId}>Active space</label>
        <select
          id={selectorId}
          aria-label="Active space"
          className="h-9 min-w-0 flex-1 rounded-md border-input bg-background py-1 pl-2.5 pr-8 text-sm font-medium focus:border-ring focus:ring-1 focus:ring-ring"
          disabled={!session?.activeSpace || switching}
          value={session?.activeSpace?.id || ''}
          onChange={(event) => onSwitch(event.target.value)}
        >
          {!session?.activeSpace && <option value="">Loading space…</option>}
          {session?.spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}
        </select>
        <Link to="/settings/space" onClick={close} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Manage spaces"><Settings2 className="h-4 w-4" /></Link>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
        <span className="capitalize">{session?.activeSpace?.role || 'Loading'}</span>
        <Link to="/settings/space?create=1" onClick={close} className="font-medium hover:text-foreground hover:underline">Create space</Link>
      </div>
    </div>
    <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary navigation">
      {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={close} className={({ isActive }) => cn('flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', isActive && 'bg-secondary text-secondary-foreground')}>
        <Icon className="h-4 w-4" />{label}
      </NavLink>)}
    </nav>
    <div className="relative z-10 shrink-0 border-t bg-card p-3">
      <div className="mb-2 min-w-0 px-2">
        <div className="truncate text-xs font-semibold text-foreground">{session?.user?.name || 'Signed in'}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={session?.user?.email || ''}>{session?.user?.email || 'Loading account…'}</div>
      </div>
      <Link
        to="/ai-queue"
        onClick={close}
        data-testid="sidebar-runtime-status"
        aria-label={`Open AI queue. ${runtimeLabel}. ${status}.`}
        className="group flex min-w-0 items-center gap-3 rounded-md px-2 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Cpu className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">AI runtime</span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 text-[11px] font-medium',
                runtimeState === 'ready' ? 'text-emerald-700' : runtimeState === 'checking' ? 'text-muted-foreground' : 'text-amber-700'
              )}
              aria-live="polite"
              aria-atomic="true"
              role="status"
            >
              <StatusIcon className={cn('h-3 w-3', runtimeState === 'checking' && 'animate-spin')} />{status}
            </span>
          </span>
          <span data-testid="sidebar-runtime-provider" className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={runtimeLabel}>{runtimeSummary(runtimeLabel)}</span>
        </span>
      </Link>
      <button onClick={signOut} className="mt-1 flex h-9 w-full items-center gap-3 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><LogOut className="h-4 w-4" />Sign out</button>
      <div className="flex gap-3 px-2 pt-1 text-[11px] text-muted-foreground"><Link className="hover:text-foreground hover:underline" to="/legal/terms">Terms</Link><Link className="hover:text-foreground hover:underline" to="/legal/privacy">Privacy</Link></div>
    </div>
  </>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [runtime, setRuntime] = useState<any>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [switching, setSwitching] = useState(false);
  const location = useLocation();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);
  useEffect(() => { api<any>('/api/runtime').then(setRuntime).catch(() => setRuntime({ ai: { reachable: false } })); const timer = setInterval(() => api<any>('/api/runtime').then(setRuntime).catch(() => null), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false;
    void api<AuthSession>('/api/auth/session').then(async (nextSession) => {
      if (cancelled) return;
      if (!nextSession.authenticated || !nextSession.user || !nextSession.activeSpace) {
        window.location.assign('/login'); return;
      }
      const stored = activeSpaceId();
      const storedMembership = stored && nextSession.spaces.some((space) => space.id === stored);
      if (storedMembership && stored !== nextSession.activeSpace.id) {
        const selected = await api<SpaceSession>(`/api/spaces/${stored}/select`, json('POST', {}));
        if (!cancelled) setSession({ ...nextSession, ...selected });
        return;
      }
      storeActiveSpaceId(nextSession.activeSpace.id, false);
      setSession(nextSession);
    }).catch(() => null);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => subscribeToSpaceChanges((spaceId) => {
    if (!session?.activeSpace || spaceId === session.activeSpace.id) return;
    if (!confirmDiscardForSpaceSwitch()) return;
    storeActiveSpaceId(spaceId, false);
    allowConfirmedSpaceSwitchUnload();
    window.location.reload();
  }), [session?.activeSpace]);
  async function switchSpace(spaceId: string) {
    if (!spaceId || spaceId === session?.activeSpace?.id || switching) return;
    if (!confirmDiscardForSpaceSwitch()) return;
    try {
      setSwitching(true);
      const selected = await api<SpaceSession>(`/api/spaces/${spaceId}/select`, json('POST', {}));
      allowConfirmedSpaceSwitchUnload();
      storeActiveSpaceId(selected.activeSpace.id, false);
      window.location.replace('/');
    } catch { setSwitching(false); }
  }
  const editorMode = /^\/agreements\/[^/]+\/prepare$/.test(location.pathname);
  const title = location.pathname === '/' ? 'Overview' : location.pathname.startsWith('/surveys/') ? 'Survey workspace' : location.pathname.startsWith('/campaigns/') ? 'Campaign workspace' : location.pathname.startsWith('/agreements/') ? 'Agreement workspace' : navigation.find((item) => item.to === location.pathname)?.label || 'Seemplify Experience';
  const managedRuntime = runtime?.ai || runtime?.terra;
  const runtimeReady = managedRuntime?.ready === true;
  const runtimeState: RuntimeState = runtime === null ? 'checking' : runtimeReady ? 'ready' : 'unavailable';
  const runtimeLabel = managedRuntime?.providerLabel || 'Experience AI';
  const creationAction = location.pathname.startsWith('/agreements')
    ? { to: '/agreements/new', label: 'New agreement' }
    : location.pathname === '/' || location.pathname.startsWith('/surveys')
      ? { to: '/surveys/new', label: 'New survey' }
      : null;
  if (editorMode) return <div className="min-h-screen bg-background"><header className="flex h-[52px] items-center justify-between border-b bg-card px-4"><Link to="/agreements" className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">S</div><span className="text-sm font-semibold">Seemplify Experience</span></Link><span className="text-xs font-medium text-muted-foreground">Agreement field editor</span></header><main>{children}</main></div>;
  return <div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-hidden border-r bg-card md:flex"><SidebarContent selectorId="active-space-desktop" runtimeState={runtimeState} runtimeLabel={runtimeLabel} session={session} switching={switching} onSwitch={switchSpace} /></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 md:hidden">
      <button aria-label="Dismiss navigation" className="absolute inset-0 bg-foreground/30" onClick={() => setMobileOpen(false)} />
      <aside className="relative flex h-full w-[278px] flex-col overflow-hidden border-r bg-card shadow-panel"><button aria-label="Close navigation" className="absolute right-3 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></button><SidebarContent selectorId="active-space-mobile" close={() => setMobileOpen(false)} runtimeState={runtimeState} runtimeLabel={runtimeLabel} session={session} switching={switching} onSwitch={switchSpace} /></aside>
    </div>}
    <div className="md:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3"><Button className="md:hidden" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button><div className="text-sm font-semibold">{title}</div></div>
        <div className="flex items-center gap-2">
          <Badge variant={runtimeState === 'ready' ? 'success' : runtimeState === 'checking' ? 'outline' : 'warning'} className="hidden sm:inline-flex" title={runtimeLabel}>{runtimeName(runtimeLabel)} {runtimeState}</Badge>
          {creationAction && <Button asChild size="sm"><Link to={creationAction.to}><Plus />{creationAction.label}</Link></Button>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  </div>;
}
