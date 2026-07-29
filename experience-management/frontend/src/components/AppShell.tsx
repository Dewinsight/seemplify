import { type ReactNode, useEffect, useState } from 'react';
import { ClipboardList, Gauge, Inbox, LogOut, Menu, Plus, RadioTower, Sparkles, X } from 'lucide-react';
import { Link, NavLink, useLocation } from '@/lib/router';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const navigation = [
  { to: '/', label: 'Overview', icon: Gauge, end: true },
  { to: '/surveys', label: 'Surveys', icon: ClipboardList },
  { to: '/ai-queue', label: 'AI queue', icon: Sparkles },
  { to: '/tickets', label: 'Service recovery', icon: Inbox }
];

function Brand() {
  return <Link to="/" className="flex h-16 items-center gap-3 border-b px-5">
    <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div>
    <div><div className="text-sm font-semibold leading-4">Seemplify</div><div className="text-xs text-muted-foreground">Experience</div></div>
  </Link>;
}

function SidebarContent({ close }: { close?: () => void }) {
  async function signOut() { try { await api('/api/auth/logout', { method: 'POST' }); } finally { window.location.assign('/login'); } }
  return <>
    <Brand />
    <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
      {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={close} className={({ isActive }) => cn('flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', isActive && 'bg-secondary text-secondary-foreground')}>
        <Icon className="h-4 w-4" />{label}
      </NavLink>)}
    </nav>
    <div className="border-t p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><RadioTower className="h-3.5 w-3.5" /> Hosted locally</div>
      <button onClick={signOut} className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><LogOut className="h-3.5 w-3.5" />Sign out</button>
    </div>
  </>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [runtime, setRuntime] = useState<any>(null);
  const location = useLocation();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => { api<any>('/api/runtime').then(setRuntime).catch(() => setRuntime({ terra: { reachable: false } })); const timer = setInterval(() => api<any>('/api/runtime').then(setRuntime).catch(() => null), 30_000); return () => clearInterval(timer); }, []);
  const title = location.pathname === '/' ? 'Overview' : location.pathname.startsWith('/surveys/') ? 'Survey workspace' : navigation.find((item) => item.to === location.pathname)?.label || 'Seemplify Experience';
  const terraReady = runtime?.terra?.reachable && runtime?.terra?.health?.ok !== false;
  return <div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r bg-card md:flex"><SidebarContent /></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 md:hidden">
      <button aria-label="Close navigation" className="absolute inset-0 bg-foreground/30" onClick={() => setMobileOpen(false)} />
      <aside className="relative flex h-full w-[278px] flex-col border-r bg-card shadow-panel"><button className="absolute right-3 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></button><SidebarContent close={() => setMobileOpen(false)} /></aside>
    </div>}
    <div className="md:pl-[236px]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3"><Button className="md:hidden" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button><div className="text-sm font-semibold">{title}</div></div>
        <div className="flex items-center gap-2">
          <Badge variant={terraReady ? 'success' : 'warning'} className="hidden sm:inline-flex">Terra {terraReady ? 'ready' : 'unavailable'}</Badge>
          <Button asChild size="sm"><Link to="/surveys/new"><Plus />New survey</Link></Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  </div>;
}
