'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  Home,
  FileText,
  CheckSquare,
  LayoutGrid,
  Menu,
  X,
  ChevronDown,
  Building2,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';
import { exitLeaveToHub } from '@/lib/productExit';

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  section: 'main' | 'admin';
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, currentOrganization, switchOrganization } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const hubUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';

  // Administration follows the active organization, not a role the user may
  // hold in a different tenant.
  const leavePermissions = currentOrganization?.appPermissions?.['leave-management'] || [];
  const hasAdminAccess = currentOrganization?.role === 'admin' ||
    currentOrganization?.role === 'owner' ||
    leavePermissions.includes('*') ||
    leavePermissions.includes('manage_policies') ||
    leavePermissions.includes('manage_leaves');

  const navigation: NavItem[] = useMemo(() => {
    const main: NavItem[] = [
      { name: 'Dashboard', href: '/dashboard', icon: Home, section: 'main' },
      { name: 'My Requests', href: '/leave-requests', icon: FileText, section: 'main' },
      { name: 'Approvals', href: '/approvals', icon: CheckSquare, section: 'main' },
      { name: 'My Calendar', href: '/calendar', icon: Calendar, section: 'main' },
    ];
    const admin: NavItem[] = hasAdminAccess
      ? [{ name: 'Admin', href: '/admin', icon: Users, section: 'admin' }]
      : [];
    return [...main, ...admin];
  }, [hasAdminAccess]);

  const handleOrgSwitch = async (orgId: string) => {
    await switchOrganization(orgId);
    setOrgDropdownOpen(false);
    setUserDropdownOpen(false);
  };

  const orgs = user?.organizations || [];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className="min-h-screen bg-[rgb(var(--background-start-rgb))]">
      {/* Background Noise */}
      <div className="bg-noise" />

      {/* Top Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background">
        <div className="mx-auto px-4 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="https://seemplifyai.com" className="flex items-center gap-3 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-300">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-semibold text-foreground">Leave Management</div>
                <div className="text-xs text-muted-foreground">by Seemplify</div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-2">
              {navigation.map((item) => {
                const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                      active
                        ? 'bg-muted text-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-3">
              <ThemeToggle />

              {/* Organization Switcher */}
              {showOrgSwitcher && (
                <div className="hidden md:block relative">
                  <button
                    onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="max-w-[120px] truncate">{currentOrganization?.name || 'Org'}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {orgDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOrgDropdownOpen(false)}
                      />
                      <div className="absolute right-0 top-12 w-64 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-50">
                        {orgs.map((org) => (
                          <button
                            key={org.id}
                            onClick={() => handleOrgSwitch(org.id)}
                            className={cn(
                              'w-full text-left px-4 py-3 text-sm hover:bg-accent transition-colors',
                              org.id === currentOrganization?.id && 'bg-accent/70'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-foreground truncate">{org.name}</span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">{org.role}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Request Leave Button */}
              <Link href="/leave-requests/new" className="hidden md:block">
                <Button className="rounded-lg bg-purple-600 text-white shadow-none hover:bg-purple-700">
                  Request Leave
                </Button>
              </Link>

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 rounded-lg hover:bg-accent/50 p-2 transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center ring-2 ring-background">
                    <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
                  </div>
                  <div className="hidden lg:block text-left">
                    <div className="text-sm font-medium text-foreground truncate max-w-[120px]">{user?.name || 'User'}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[120px]">{user?.email}</div>
                  </div>
                  <ChevronDown className="hidden lg:block h-4 w-4 text-muted-foreground" />
                </button>
                {userDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserDropdownOpen(false)}
                    />
                    <div className="absolute right-0 top-14 w-56 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-50">
                      <div className="p-3 border-b border-border">
                        <div className="text-sm font-medium text-foreground truncate">{user?.name || 'User'}</div>
                        <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                      </div>
                      <div className="py-2">
                        <Link
                          href="/leave-requests/new"
                          className="block px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          onClick={() => setUserDropdownOpen(false)}
                        >
                          Request Leave
                        </Link>
                        <a
                          href={hubUrl}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={(event) => { event.preventDefault(); setUserDropdownOpen(false); void exitLeaveToHub(hubUrl); }}
                        >
                          <LayoutGrid className="h-4 w-4" />
                          Back to App Hub
                        </a>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                className="lg:hidden p-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5 text-zinc-300" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Slide-out Menu */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-background border-l border-border shadow-2xl z-50 lg:hidden overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">Leave Management</div>
                    <div className="text-xs text-muted-foreground">by Seemplify</div>
                  </div>
                </div>
                <button
                  className="p-2 rounded-lg hover:bg-accent/50 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              {/* Mobile Organization Switcher */}
              {showOrgSwitcher && (
                <div className="mb-6">
                  <button
                    onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                    className="w-full flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                      <span className="text-zinc-200 truncate">{currentOrganization?.name || 'Select'}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  </button>
                  {orgDropdownOpen && (
                    <div className="mt-2 rounded-lg border border-border bg-card/50 overflow-hidden">
                      {orgs.map((org) => (
                        <button
                          key={org.id}
                          onClick={() => {
                            handleOrgSwitch(org.id);
                            setMobileOpen(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors',
                            org.id === currentOrganization?.id && 'bg-accent/70'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-foreground truncate">{org.name}</span>
                            <span className="text-xs text-muted-foreground">{org.role}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1 mb-6">
                <div className="text-xs font-semibold text-muted-foreground px-2 mb-2">Navigation</div>
                {navigation.map((item) => {
                  const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-muted text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>

              {/* Mobile CTA */}
              <Link href="/leave-requests/new" onClick={() => setMobileOpen(false)}>
                <Button className="w-full rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/20">
                  Request Leave
                </Button>
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="min-h-screen bg-[var(--suite-canvas)] pt-16 transition-colors duration-150">
        <div className="mx-auto px-4 py-8 lg:px-8 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
}
