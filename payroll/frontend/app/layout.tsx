'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserContext, useOrganizations } from '@/lib/hooks';
import { authApi, isAuthenticated as checkAuthenticated } from '@/lib/api';
import { useRouter } from 'next/navigation';
import './globals.css';
import {
  LayoutGrid,
  FileText,
  Users,
  Calculator,
  Settings,
  LogOut,
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

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const {
    user,
    role,
    roleDisplay,
    isHRAdmin,
    organization,
    primaryTeam,
    isLoading: contextLoading
  } = useUserContext();

  const {
    organizations,
    isLoading: orgsLoading,
  } = useOrganizations();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileExpandedDropdown, setMobileExpandedDropdown] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        setHasAccessToken(true);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  const isAuthenticated = checkAuthenticated() || hasAccessToken;
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  const orgName = organization?.name ||
    (Array.isArray(organizations) && organizations.length > 1
      ? organizations.find((o: any) => o.isCurrent)?.name || organizations[0]?.name
      : 'Organization');

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await authApi.logout();
    router.push('/login');
  };

  const handleSwitchOrganization = async (orgId: string) => {
    if (switchingOrg) return;
    try {
      setSwitchingOrg(true);
      setOrgMenuOpen(false);
      const response = await authApi.switchOrganization(orgId);
      // authApi.switchOrganization returns response.data directly
      if (response?.success) {
        console.log('✅ Organization switched to:', response.organization?.name);
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

  if (isLoginPage) {
    return (
      <html lang="en">
        <body>
          {children}
        </body>
      </html>
    );
  }

  // Simple nav items (direct links)
  const simpleNavItems: NavItem[] = [
    { name: 'Dashboard', href: '/', icon: LayoutGrid },
    { name: 'My Payslips', href: '/payslips', icon: FileText },
  ];

  // Dropdown menus for admin (grouped by functionality)
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
      name: 'Team',
      icon: Users,
      items: [
        { name: 'My Team', href: '/team', icon: Users },
        { name: 'All Employees', href: '/admin/employees', icon: Users },
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
        { name: 'Currencies', href: '/admin/currencies', icon: Coins },
      ],
    },
  ];

  // For non-admin users, show simple nav with team link
  const nonAdminNavItems: NavItem[] = [
    ...simpleNavItems,
    { name: 'Team', href: '/team', icon: Users },
  ];

  const isDropdownActive = (dropdown: NavDropdown) => {
    return dropdown.items.some(item => 
      pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
    );
  };

  const showOrgSwitcher = Array.isArray(organizations) && organizations.length > 1;

  return (
    <html lang="en">
      <body className="bg-[rgb(var(--background-start-rgb))]">
        {/* Background Noise */}
        <div className="bg-noise" />

        <div className="min-h-screen">
          {/* Top Navbar */}
          <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
            <div className="mx-auto px-4 lg:px-8">
              <div className="flex h-16 items-center justify-between">
                {/* Logo */}
                <Link href="https://seemplifyai.com" className="flex items-center gap-3 group">
                  <div className="relative h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/20 transition-transform duration-300 group-hover:scale-105">
                    <DollarSign className="h-5 w-5 text-white" />
                  </div>
                  <div className="hidden sm:block">
                    <div className="text-sm font-semibold text-white">Payroll Management</div>
                    <div className="text-xs text-zinc-400">by Seemplify</div>
                  </div>
                </Link>

                {/* Desktop Navigation */}
                <div className="hidden lg:flex items-center gap-1">
                  {/* Simple nav items */}
                  {simpleNavItems.map((item) => {
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

                  {/* Dropdown menus for admin */}
                  {isHRAdmin ? (
                    <>
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
                                "h-3.5 w-3.5 transition-transform duration-200",
                                isOpen && "rotate-180"
                              )} />
                            </button>
                            {isOpen && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setOpenDropdown(null)}
                                />
                                <div className="absolute left-0 top-11 w-48 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden z-50">
                                  {dropdown.items.map((item) => {
                                    const itemActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                                    return (
                                      <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setOpenDropdown(null)}
                                        className={cn(
                                          'flex items-center gap-2 px-4 py-2.5 text-sm transition-colors',
                                          itemActive
                                            ? 'bg-zinc-800/80 text-white'
                                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                                        )}
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
                    /* Non-admin: just show Team link */
                    <Link
                      href="/team"
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                        pathname === '/team'
                          ? 'bg-zinc-800/80 text-white'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                      )}
                    >
                      <Users className="h-4 w-4" />
                      Team
                    </Link>
                  )}
                </div>

                {/* Right Side Actions */}
                <div className="flex items-center gap-3">
                  {/* Organization Switcher */}
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
                          <div className="absolute right-0 top-12 w-64 rounded-xl border border-white/[0.08] bg-[#0a0a0c] shadow-2xl overflow-hidden z-50">
                            {organizations.map((org: any) => (
                              <button
                                key={org.id}
                                onClick={() => !org.isCurrent && handleSwitchOrganization(org.id)}
                                disabled={org.isCurrent || switchingOrg}
                                className={cn(
                                  'w-full text-left px-4 py-3 text-sm hover:bg-zinc-800/70 transition-colors',
                                  org.isCurrent && 'bg-zinc-800/70 cursor-default'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-zinc-200 truncate">{org.name}</span>
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

                  {/* User Menu */}
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
                        <div className="absolute right-0 top-14 w-56 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden z-50">
                          <div className="p-3 border-b border-zinc-800/60">
                            <div className="text-sm font-medium text-white truncate">{userName}</div>
                            <div className="text-xs text-zinc-500 truncate">{userEmail}</div>
                            {roleDisplay && (
                              <div className="mt-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium">
                                  {roleDisplay}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="py-2">
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors flex items-center gap-2"
                              onClick={() => {
                                setUserMenuOpen(false);
                                handleLogout();
                              }}
                            >
                              <LogOut className="h-4 w-4" />
                              Logout
                            </button>
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
              <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-[#0a0a0c] border-l border-white/[0.08] shadow-2xl z-50 lg:hidden overflow-y-auto">
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

                  {/* Mobile Organization Switcher */}
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
                        <div className="mt-2 rounded-lg border border-white/[0.08] bg-[#0a0a0c] overflow-hidden">
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
                              className={cn(
                                'w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-800/70 transition-colors',
                                org.isCurrent && 'bg-zinc-800/70 cursor-default'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-zinc-200 truncate">{org.name}</span>
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

                  {/* Mobile Navigation */}
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-zinc-500 px-2 mb-2">Navigation</div>
                    
                    {/* Simple nav items */}
                    {simpleNavItems.map((item) => {
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

                    {isHRAdmin ? (
                      <>
                        {/* Admin dropdown sections */}
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
                                  "h-4 w-4 transition-transform duration-200",
                                  isExpanded && "rotate-90"
                                )} />
                              </button>
                              {isExpanded && (
                                <div className="mt-1 ml-4 pl-4 border-l border-zinc-800 space-y-1">
                                  {dropdown.items.map((item) => {
                                    const itemActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
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
                      /* Non-admin: just show Team link */
                      <Link
                        href="/team"
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                          pathname === '/team'
                            ? 'bg-zinc-800/80 text-white'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                        )}
                      >
                        <Users className="h-4 w-4" />
                        Team
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Main Content */}
          <main className="pt-16 min-h-screen">
            <div className="mx-auto px-4 py-8 lg:px-8 max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
