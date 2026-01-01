'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Calendar,
  Home,
  FileText,
  CheckSquare,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  section: 'main' | 'admin';
};

function getPageTitle(pathname: string) {
  if (pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/leave-requests') return 'My Leave Requests';
  if (pathname === '/leave-requests/new') return 'Request Leave';
  if (pathname.startsWith('/leave-requests/')) return 'Leave Request';
  if (pathname === '/approvals') return 'Approvals';
  if (pathname === '/calendar') return 'Calendar';
  if (pathname === '/admin') return 'Admin';
  return 'Leave Management';
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, currentOrganization, logout, switchOrganization } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  // Check if user has admin/HR manager access
  const hasAdminAccess = user?.organizations?.some(
    org => org.role === 'admin' || org.role === 'hr_manager' || org.role === 'owner'
  );

  const navigation: NavItem[] = useMemo(() => {
    const main: NavItem[] = [
      { name: 'Dashboard', href: '/dashboard', icon: Home, section: 'main' },
      { name: 'My Requests', href: '/leave-requests', icon: FileText, section: 'main' },
      { name: 'Approvals', href: '/approvals', icon: CheckSquare, section: 'main' },
      { name: 'Calendar', href: '/calendar', icon: Calendar, section: 'main' },
    ];
    const admin: NavItem[] = hasAdminAccess
      ? [{ name: 'Admin', href: '/admin', icon: Users, section: 'admin' }]
      : [];
    return [...main, ...admin];
  }, [hasAdminAccess]);

  const handleLogout = async () => {
    await logout();
  };

  const handleOrgSwitch = async (orgId: string) => {
    await switchOrganization(orgId);
    setOrgDropdownOpen(false);
    setUserDropdownOpen(false);
  };

  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);
  const orgs = user?.organizations || [];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      <div className={cn('fixed inset-0 z-50 lg:hidden', mobileOpen ? 'block' : 'hidden')}>
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
        <div className="absolute inset-y-0 left-0 w-[18.5rem] bg-slate-950 text-slate-50 shadow-2xl border-r border-slate-800/60">
          <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Calendar className="h-5 w-5 text-white" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold">Leave</div>
                <div className="text-xs text-slate-400">Management</div>
              </div>
            </div>
            <button
              className="p-2 rounded-lg hover:bg-slate-900/70 transition-colors"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-3">
            {showOrgSwitcher && (
              <div className="mb-3 relative">
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    <span className="truncate">{currentOrganization?.name || 'Select organization'}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>
                {orgDropdownOpen && (
                  <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                    {orgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleOrgSwitch(org.id)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 text-sm hover:bg-slate-900/70 transition-colors',
                          org.id === currentOrganization?.id && 'bg-slate-900/70'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{org.name}</span>
                          <span className="text-xs text-slate-400 flex-shrink-0">{org.role}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="text-xs font-semibold text-slate-400 px-2 mb-2">Navigation</div>
            <nav className="space-y-1">
              {navigation.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-slate-900/70 text-white'
                        : 'text-slate-200 hover:bg-slate-900/50'
                    )}
                  >
                    <item.icon className={cn('h-4 w-4', active ? 'text-white' : 'text-slate-400')} />
                    {item.name}
                    {item.href === '/approvals' && (
                      <Badge variant="secondary" className="ml-auto bg-slate-800 text-slate-200 border-slate-700">
                        Team
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 pt-4 border-t border-slate-800/60">
              <div className="flex items-center gap-3 px-2">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{user?.name || 'User'}</div>
                  <div className="text-xs text-slate-400 truncate">{user?.email}</div>
                </div>
              </div>
              <button
                className="mt-3 w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold bg-slate-900/50 border border-slate-800 hover:bg-slate-900/70 transition-colors"
                onClick={() => {
                  handleLogout();
                  setMobileOpen(false);
                }}
              >
                <LogOut className="h-4 w-4 text-slate-300" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop shell */}
      <div>
        {/* Sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-[18.5rem] bg-slate-950 text-slate-50 border-r border-slate-800/60">
          <div className="h-14 px-4 flex items-center gap-2 border-b border-slate-800/60">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold">Leave</div>
              <div className="text-xs text-slate-400">Management</div>
            </div>
            <div className="ml-auto">
              <Badge className="bg-slate-900 border-slate-800 text-slate-200" variant="secondary">
                SSO
              </Badge>
            </div>
          </div>

          <div className="p-3">
            {showOrgSwitcher && (
              <div className="mb-4 relative">
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    <span className="truncate">{currentOrganization?.name || 'Select organization'}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>
                {orgDropdownOpen && (
                  <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl">
                    {orgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleOrgSwitch(org.id)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 text-sm hover:bg-slate-900/70 transition-colors',
                          org.id === currentOrganization?.id && 'bg-slate-900/70'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{org.name}</span>
                          <span className="text-xs text-slate-400 flex-shrink-0">{org.role}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="text-xs font-semibold text-slate-400 px-2 mb-2">Navigation</div>
            <nav className="space-y-1">
              {navigation
                .filter((n) => n.section === 'main')
                .map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-slate-900/70 text-white' : 'text-slate-200 hover:bg-slate-900/50'
                      )}
                    >
                      <item.icon className={cn('h-4 w-4', active ? 'text-white' : 'text-slate-400')} />
                      {item.name}
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-gradient-to-b from-blue-500 to-purple-600" />
                      )}
                    </Link>
                  );
                })}
            </nav>

            {hasAdminAccess && (
              <>
                <div className="mt-5 text-xs font-semibold text-slate-400 px-2 mb-2">Admin</div>
                <nav className="space-y-1">
                  {navigation
                    .filter((n) => n.section === 'admin')
                    .map((item) => {
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                            active
                              ? 'bg-slate-900/70 text-white'
                              : 'text-slate-200 hover:bg-slate-900/50'
                          )}
                        >
                          <item.icon className={cn('h-4 w-4', active ? 'text-white' : 'text-slate-400')} />
                          {item.name}
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-gradient-to-b from-blue-500 to-purple-600" />
                          )}
                        </Link>
                      );
                    })}
                </nav>
              </>
            )}
          </div>

          <div className="mt-auto p-3 border-t border-slate-800/60 bg-slate-950">
            <div className="flex items-center gap-3 px-2">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{user?.name || 'User'}</div>
                <div className="text-xs text-slate-400 truncate">{user?.email}</div>
              </div>
              <div className="ml-auto relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="p-2 rounded-lg hover:bg-slate-900/70 transition-colors"
                  aria-label="User menu"
                >
                  <ChevronDown className="h-4 w-4 text-slate-300" />
                </button>
                {userDropdownOpen && (
                  <div className="absolute right-0 bottom-12 w-48 rounded-xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden z-30">
                    <Link
                      href="/leave-requests/new"
                      className="block px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-900/70 transition-colors"
                      onClick={() => setUserDropdownOpen(false)}
                    >
                      Request leave
                    </Link>
                    <button
                      className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-900/70 transition-colors flex items-center gap-2"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleLogout();
                      }}
                    >
                      <LogOut className="h-4 w-4 text-slate-300" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="lg:pl-[18.5rem]">
          {/* Header */}
          <header className="sticky top-0 z-30 bg-background/70 backdrop-blur-xl border-b border-slate-200/60">
            <div className="h-14 px-4 lg:px-8 flex items-center gap-3">
              <button
                className="lg:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5 text-slate-700" />
              </button>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{pageTitle}</div>
                <div className="text-xs text-slate-500 truncate">
                  {currentOrganization?.name ? currentOrganization.name : 'Your organization'}
                </div>
              </div>

              <div className="hidden md:flex flex-1 justify-center">
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    placeholder="Search leave requests, people, teams…"
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white/70 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Link href="/leave-requests/new">
                  <Button className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-md shadow-blue-500/20">
                    Request Leave
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-slate-50 via-white to-slate-50 px-4 py-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
