'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUserContext, useOrganizations } from '@/lib/hooks';
import { authApi, handleAuthCallback } from '@/lib/api';
import { resolveIdpUrl } from '@/lib/runtimeConfig';
import { PayrollViewModeProvider, PayrollViewMode } from '@/context/PayrollViewModeContext';
import PageGuide from '@/components/PageGuide';
import ThemePreferenceMenu from '@/components/ThemePreferenceMenu';
import { themeInitScript } from '@/lib/theme-sync';
import AttendancePresenceReporter from '@/components/AttendancePresenceReporter';
import './globals.css';
import {
  LayoutGrid,
  FileText,
  Users,
  Clock,
  Calculator,
  Settings,
  Menu,
  X,
  ChevronDown,
  Building2,
  DollarSign,
  BarChart3,
  CheckCircle,
  Check,
  Wallet,
  History,
  Coins,
  ChevronRight,
} from 'lucide-react';

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

interface NavDropdown {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const VIEW_MODE_STORAGE_KEY = 'payroll:viewMode';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const {
    user,
    roleDisplay,
    isHRAdmin,
    organization,
    isLoading: contextLoading
  } = useUserContext();

  const {
    organizations,
    isLoading: orgsLoading,
  } = useOrganizations();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileExpandedDropdown, setMobileExpandedDropdown] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<PayrollViewMode>('personal');

  useEffect(() => {
    handleAuthCallback();
  }, []);

  useEffect(() => {
    if (contextLoading) return;

    if (!isHRAdmin) {
      setViewModeState('personal');
      if (typeof window !== 'undefined') {
        localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      const nextMode: PayrollViewMode = stored === 'personal' ? 'personal' : 'admin';
      setViewModeState(nextMode);
    }
  }, [contextLoading, isHRAdmin]);

  useEffect(() => {
    setOpenDropdown(null);
    setMobileExpandedDropdown(null);
    setOrgMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  const effectiveViewMode: PayrollViewMode = isHRAdmin ? viewMode : 'personal';
  const isAdminWorkspace = isHRAdmin && effectiveViewMode === 'admin';

  const setViewMode = (mode: PayrollViewMode) => {
    if (!isHRAdmin) return;

    setViewModeState(mode);

    if (typeof window !== 'undefined') {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }

    if (mode === 'personal' && pathname.startsWith('/admin')) {
      router.push('/dashboard');
    }
  };

  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  const orgName = organization?.name ||
    (Array.isArray(organizations) && organizations.length > 1
      ? organizations.find((o: any) => o.isCurrent)?.name || organizations[0]?.name
      : 'Organization');

  const handleSwitchOrganization = async (orgId: string) => {
    if (switchingOrg) return;
    try {
      setSwitchingOrg(true);
      setOrgMenuOpen(false);
      const response = await authApi.switchOrganization(orgId);
      if (response?.success) {
        console.log('Organization switched to:', response.organization?.name);
        window.location.reload();
      } else {
        throw new Error(response?.error || 'Failed to switch organization');
      }
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setSwitchingOrg(false);
    }
  };

  const isLoginPage = pathname === '/login';
  const hubUrl = resolveIdpUrl();
  const hasOrganizations = Array.isArray(organizations) && organizations.length > 0;
  const showNoOrganizations = !contextLoading && !orgsLoading && user && !hasOrganizations;

  if (isLoginPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
        <body>
          {children}
        </body>
      </html>
    );
  }

  if (showNoOrganizations) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
        <body className="bg-[rgb(var(--background-start-rgb))]">
          <div className="bg-noise" />
          <div className="min-h-screen flex items-center justify-center px-4 py-16">
            <div className="w-full max-w-xl rounded-2xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 p-8 text-center shadow-2xl">
              <div className="mx-auto mb-6 h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
                <Building2 className="h-8 w-8 text-amber-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white">No organizations yet</h1>
              <p className="mt-3 text-sm text-zinc-400">
                To use Payroll Management, you need to belong to an organization.
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Return to the hub to join or create one.
              </p>
              <a
                href={hubUrl}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <LayoutGrid className="h-4 w-4" />
                Return to Hub
              </a>
            </div>
          </div>
        </body>
      </html>
    );
  }

  const personalNavItems: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
    { name: 'My Payslips', href: '/payslips', icon: FileText },
    { name: 'My Requests', href: '/requests', icon: Clock },
  ];

  const adminDropdowns: NavDropdown[] = [
    {
      name: 'Payroll',
      icon: Wallet,
      items: [
        { name: 'Run Payroll', href: '/admin/run', icon: Calculator },
        { name: 'Payroll History', href: '/admin/runs', icon: History },
        { name: 'Approvals', href: '/admin/approvals', icon: CheckCircle },
      ],
    },
    {
      name: 'Employees',
      icon: Users,
      items: [
        { name: 'All Employees', href: '/admin/employees', icon: Users },
        { name: 'Setup Queue', href: '/admin/employees?setup=pending', icon: CheckCircle },
      ],
    },
    {
      name: 'Reports',
      icon: BarChart3,
      items: [
        { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
        { name: 'Reports', href: '/admin/reports', icon: FileText },
      ],
    },
    {
      name: 'Settings',
      icon: Settings,
      items: [
        { name: 'Tax Rules', href: '/admin/settings/tax', icon: Calculator },
        { name: 'Currencies', href: '/admin/currencies', icon: Coins },
      ],
    },
  ];

  const isDropdownActive = (dropdown: NavDropdown) => {
    return dropdown.items.some(item =>
      pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href.split('?')[0]))
    );
  };

  const showOrgSwitcher = Array.isArray(organizations) && organizations.length > 1;

  const providerValue = {
    viewMode: effectiveViewMode,
    isHRAdmin: !!isHRAdmin,
    setViewMode,
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body className="bg-[rgb(var(--background-start-rgb))]">
        <div className="bg-noise" />

        <PayrollViewModeProvider value={providerValue}>
          <AttendancePresenceReporter />
          <div className="min-h-screen">
            <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/60 bg-zinc-950">
              <div className="mx-auto px-4 lg:px-8">
                <div className="flex h-16 items-center justify-between">
                  <Link href="https://seemplifyai.com" className="flex items-center gap-3 group">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-500">
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div className="hidden sm:block">
                      <div className="text-sm font-semibold text-white">Payroll Management</div>
                      <div className="text-xs text-zinc-400">by Seemplify</div>
                    </div>
                  </Link>

                  <div className="hidden lg:flex items-center gap-1">
                    {isAdminWorkspace ? (
                      <>
                        <Link
                          href="/dashboard"
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                            pathname === '/dashboard'
                              ? 'bg-zinc-800/80 text-white'
                              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                          )}
                        >
                          <LayoutGrid className="h-4 w-4" />
                          Dashboard
                        </Link>

                        {adminDropdowns.map((dropdown) => {
                          const isOpen = openDropdown === dropdown.name;
                          const isActive = isDropdownActive(dropdown);
                          return (
                            <div key={dropdown.name} className="relative">
                              <button
                                onClick={() => setOpenDropdown(isOpen ? null : dropdown.name)}
                                className={cn(
                                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                  isActive || isOpen
                                    ? 'bg-zinc-800/80 text-white'
                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                )}
                              >
                                <dropdown.icon className="h-4 w-4" />
                                {dropdown.name}
                                <ChevronDown className={cn(
                                  'h-3.5 w-3.5 transition-transform duration-200',
                                  isOpen && 'rotate-180'
                                )} />
                              </button>
                              {isOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setOpenDropdown(null)}
                                  />
                                  <div className="payroll-popover absolute left-0 top-11 z-50 w-52">
                                    {dropdown.items.map((item) => {
                                      const itemPath = item.href.split('?')[0];
                                      const itemActive = pathname === itemPath || (itemPath !== '/' && pathname.startsWith(itemPath));
                                      return (
                                        <Link
                                          key={item.href}
                                          href={item.href}
                                          onClick={() => setOpenDropdown(null)}
                                          className={cn('payroll-popover-item', itemActive && 'is-active')}
                                        >
                                          <item.icon className="h-4 w-4" />
                                          {item.name}
                                        </Link>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        {personalNavItems.map((item) => {
                          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                                active
                                  ? 'bg-zinc-800/80 text-white'
                                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                              )}
                            >
                              <item.icon className="h-4 w-4" />
                              {item.name}
                            </Link>
                          );
                        })}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <ThemePreferenceMenu />
                    {isHRAdmin && (
                      <div className="hidden md:flex items-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
                        <button
                          onClick={() => setViewMode('admin')}
                          className={cn(
                            'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
                            effectiveViewMode === 'admin'
                              ? 'suite-view-active'
                              : 'text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          Admin View
                        </button>
                        <button
                          onClick={() => setViewMode('personal')}
                          className={cn(
                            'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
                            effectiveViewMode === 'personal'
                              ? 'suite-view-active'
                              : 'text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          Personal View
                        </button>
                      </div>
                    )}

                    {showOrgSwitcher && (
                      <div className="hidden md:block relative">
                        <button
                          onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                        >
                          <Building2 className="h-4 w-4" />
                          <span className="max-w-[120px] truncate">{orgName}</span>
                          <ChevronDown className="h-4 w-4 text-zinc-500" />
                        </button>
                        {orgMenuOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setOrgMenuOpen(false)}
                            />
                            <div className="payroll-popover absolute right-0 top-12 z-50 w-64">
                              {organizations.map((org: any) => (
                                <button
                                  key={org.id}
                                  onClick={() => !org.isCurrent && handleSwitchOrganization(org.id)}
                                  disabled={org.isCurrent || switchingOrg}
                                  className={cn('payroll-popover-item px-4 py-3', org.isCurrent && 'is-active cursor-default')}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate">{org.name}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-zinc-500 flex-shrink-0">{org.role}</span>
                                      {org.isCurrent && <Check className="h-4 w-4 text-green-500" />}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="relative">
                      <button
                        onClick={() => setUserMenuOpen(!userMenuOpen)}
                        className="flex items-center gap-2 rounded-lg hover:bg-zinc-800/50 p-2 transition-colors"
                      >
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 flex items-center justify-center ring-2 ring-zinc-800">
                          <span className="text-sm font-semibold text-white">{userName.charAt(0)}</span>
                        </div>
                        <div className="hidden lg:block text-left">
                          <div className="text-sm font-medium text-white truncate max-w-[120px]">{userName}</div>
                          <div className="text-xs text-zinc-500 truncate max-w-[120px]">{userEmail}</div>
                        </div>
                        <ChevronDown className="hidden lg:block h-4 w-4 text-zinc-500" />
                      </button>
                      {userMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setUserMenuOpen(false)}
                          />
                          <div className="payroll-popover absolute right-0 top-14 z-50 w-56">
                            <div className="payroll-popover-header p-3">
                              <div className="payroll-dialog-title truncate text-sm font-medium">{userName}</div>
                              <div className="payroll-dialog-copy truncate text-xs">{userEmail}</div>
                              {roleDisplay && (
                                <div className="mt-1">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium">
                                    {roleDisplay}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="py-2">
                              <a
                                href={hubUrl}
                                className="payroll-popover-item px-4 py-2"
                                onClick={() => setUserMenuOpen(false)}
                              >
                                <LayoutGrid className="h-4 w-4" />
                                Back to App Hub
                              </a>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

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

            {mobileOpen && (
              <>
                <div
                  className="payroll-overlay lg:hidden"
                  onClick={() => setMobileOpen(false)}
                />
                <div className="payroll-mobile-drawer fixed inset-y-0 right-0 z-[51] w-80 max-w-[85vw] overflow-y-auto lg:hidden">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 flex items-center justify-center shadow-lg">
                          <DollarSign className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">Payroll</div>
                          <div className="text-xs text-zinc-400">by Seemplify</div>
                        </div>
                      </div>
                      <button
                        className="p-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
                        onClick={() => setMobileOpen(false)}
                      >
                        <X className="h-5 w-5 text-zinc-400" />
                      </button>
                    </div>

                    <ThemePreferenceMenu mobile />

                    {isHRAdmin && (
                      <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1 flex items-center">
                        <button
                          onClick={() => setViewMode('admin')}
                          className={cn(
                            'flex-1 px-3 py-2 text-xs rounded-md font-medium transition-colors',
                            effectiveViewMode === 'admin'
                              ? 'suite-view-active'
                              : 'text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          Admin
                        </button>
                        <button
                          onClick={() => setViewMode('personal')}
                          className={cn(
                            'flex-1 px-3 py-2 text-xs rounded-md font-medium transition-colors',
                            effectiveViewMode === 'personal'
                              ? 'suite-view-active'
                              : 'text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          Personal
                        </button>
                      </div>
                    )}

                    {showOrgSwitcher && (
                      <div className="mb-6">
                        <button
                          onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                          className="w-full flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                            <span className="text-zinc-200 truncate">{orgName}</span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-zinc-500" />
                        </button>
                        {orgMenuOpen && (
                          <div className="payroll-popover mt-2">
                            {organizations.map((org: any) => (
                              <button
                                key={org.id}
                                onClick={() => {
                                  if (!org.isCurrent) {
                                    handleSwitchOrganization(org.id);
                                    setMobileOpen(false);
                                  }
                                }}
                                disabled={org.isCurrent || switchingOrg}
                                className={cn('payroll-popover-item px-3 py-2.5', org.isCurrent && 'is-active cursor-default')}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{org.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500">{org.role}</span>
                                    {org.isCurrent && <Check className="h-4 w-4 text-green-500" />}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-zinc-500 px-2 mb-2">Navigation</div>

                      {isAdminWorkspace ? (
                        <>
                          <Link
                            href="/dashboard"
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                              pathname === '/dashboard'
                                ? 'bg-zinc-800/80 text-white'
                                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                            )}
                          >
                            <LayoutGrid className="h-4 w-4" />
                            Dashboard
                          </Link>

                          {adminDropdowns.map((dropdown) => {
                            const isExpanded = mobileExpandedDropdown === dropdown.name;
                            const isActive = isDropdownActive(dropdown);
                            return (
                              <div key={dropdown.name}>
                                <button
                                  onClick={() => setMobileExpandedDropdown(isExpanded ? null : dropdown.name)}
                                  className={cn(
                                    'w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                    isActive || isExpanded
                                      ? 'bg-zinc-800/80 text-white'
                                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    <dropdown.icon className="h-4 w-4" />
                                    {dropdown.name}
                                  </div>
                                  <ChevronRight className={cn(
                                    'h-4 w-4 transition-transform duration-200',
                                    isExpanded && 'rotate-90'
                                  )} />
                                </button>
                                {isExpanded && (
                                  <div className="mt-1 ml-4 pl-4 border-l border-zinc-800 space-y-1">
                                    {dropdown.items.map((item) => {
                                      const itemPath = item.href.split('?')[0];
                                      const itemActive = pathname === itemPath || (itemPath !== '/' && pathname.startsWith(itemPath));
                                      return (
                                        <Link
                                          key={item.href}
                                          href={item.href}
                                          onClick={() => setMobileOpen(false)}
                                          className={cn(
                                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                                            itemActive
                                              ? 'bg-zinc-800/60 text-white'
                                              : 'text-zinc-500 hover:text-white hover:bg-zinc-800/40'
                                          )}
                                        >
                                          <item.icon className="h-4 w-4" />
                                          {item.name}
                                        </Link>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <>
                          {personalNavItems.map((item) => {
                            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={cn(
                                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                  active
                                    ? 'bg-zinc-800/80 text-white'
                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                )}
                              >
                                <item.icon className="h-4 w-4" />
                                {item.name}
                              </Link>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            <main className="min-h-screen bg-[var(--suite-canvas)] pt-16 transition-colors duration-150">
              <div className="mx-auto px-4 py-8 lg:px-8 max-w-7xl">
                {children}
              </div>
            </main>
            <PageGuide />
          </div>
        </PayrollViewModeProvider>
      </body>
    </html>
  );
}
