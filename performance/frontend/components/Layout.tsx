'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  TrendingUp,
  Target,
  FileText,
  MessageSquare,
  Video,
  GraduationCap,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  Sparkles,
} from 'lucide-react';
import { useUserContext } from '@/lib/hooks';

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  section: 'main' | 'manager' | 'admin' | 'analytics';
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user: authUser } = useAuth();
  const { user, role, isManager, isHRAdmin } = useUserContext();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const navigation: NavItem[] = useMemo(() => {
    const main: NavItem[] = [
      { name: 'Dashboard', href: '/dashboard', icon: TrendingUp, section: 'main' },
      { name: 'My OKRs', href: '/okrs', icon: Target, badge: 'AI', section: 'main' },
      { name: 'Appraisals', href: '/appraisals', icon: FileText, badge: 'AI', section: 'main' },
      { name: 'Reviews', href: '/reviews', icon: BarChart3, badge: 'AI', section: 'main' },
      { name: 'Feedback', href: '/feedback', icon: MessageSquare, section: 'main' },
      { name: '1:1 Meetings', href: '/one-on-ones', icon: Video, section: 'main' },
      { name: 'Development', href: '/development', icon: GraduationCap, section: 'main' },
    ];

    const manager: NavItem[] = isManager
      ? [
          { name: 'My Team', href: '/team', icon: Users, section: 'manager' },
        ]
      : [];

    const admin: NavItem[] = isHRAdmin
      ? [
          { name: 'Admin Panel', href: '/admin/appraisal-cycles', icon: Settings, section: 'admin' },
        ]
      : [];

    return [...main, ...manager, ...admin];
  }, [isManager, isHRAdmin]);

  const handleLogout = async () => {
    // Implementation from auth context
    window.location.href = '/api/auth/logout';
  };

  const orgs = authUser?.organizations || [];
  const currentOrganization = orgs.find((o: any) => o.isCurrent) || orgs[0];
  const showOrgSwitcher = orgs.length > 1;

  return (
    <div className="min-h-screen bg-[rgb(var(--background-start-rgb))]">
      {/* Background Noise */}
      <div className="bg-noise" />
      
      {/* Top Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto px-4 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="https://seemplifyai.com" className="flex items-center gap-3 group">
              <div className="relative h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-purple-500/20 transition-transform duration-300 group-hover:scale-105">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-semibold text-white">Performance Management</div>
                <div className="text-xs text-zinc-400">by Seemplify</div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-2">
              {navigation.filter(n => n.section === 'main').slice(0, 5).map((item) => {
                const active = pathname === item.href;
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
                    {item.badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-3">
              {/* Organization Switcher */}
              {showOrgSwitcher && (
                <div className="hidden md:block relative">
                  <button
                    onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="max-w-[120px] truncate">{currentOrganization?.name || 'Org'}</span>
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  </button>
                  {orgDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40"
                        onClick={() => setOrgDropdownOpen(false)}
                      />
                      <div className="absolute right-0 top-12 w-64 rounded-xl border border-white/[0.08] bg-[#0a0a0c] shadow-2xl overflow-hidden z-50">
                        {orgs.map((org: any) => (
                          <button
                            key={org.id}
                            className={cn(
                              'w-full text-left px-4 py-3 text-sm hover:bg-zinc-800/70 transition-colors',
                              org.isCurrent && 'bg-zinc-800/70'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-zinc-200 truncate">{org.name}</span>
                              <span className="text-xs text-zinc-500 flex-shrink-0">{org.role}</span>
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
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 rounded-lg hover:bg-zinc-800/50 p-2 transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center ring-2 ring-zinc-800">
                    <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
                  </div>
                  <div className="hidden lg:block text-left">
                    <div className="text-sm font-medium text-white truncate max-w-[120px]">{user?.name || 'User'}</div>
                    <div className="text-xs text-zinc-500 truncate max-w-[120px]">{user?.email}</div>
                  </div>
                  <ChevronDown className="hidden lg:block h-4 w-4 text-zinc-500" />
                </button>
                {userDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40"
                      onClick={() => setUserDropdownOpen(false)}
                    />
                        <div className="absolute right-0 top-14 w-56 rounded-xl border border-white/[0.08] bg-[#0a0a0c] shadow-2xl overflow-hidden z-50">
                      <div className="p-3 border-b border-zinc-800/60">
                        <div className="text-sm font-medium text-white truncate">{user?.name || 'User'}</div>
                        <div className="text-xs text-zinc-500 truncate">{user?.email}</div>
                      </div>
                      <div className="py-2">
                        {isManager && (
                          <Link
                            href="/team"
                            className="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                            onClick={() => setUserDropdownOpen(false)}
                          >
                            <Users className="h-4 w-4 inline mr-2" />
                            My Team
                          </Link>
                        )}
                        {isHRAdmin && (
                          <Link
                            href="/admin/appraisal-cycles"
                            className="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                            onClick={() => setUserDropdownOpen(false)}
                          >
                            <Settings className="h-4 w-4 inline mr-2" />
                            Admin Panel
                          </Link>
                        )}
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors flex items-center gap-2"
                          onClick={() => {
                            setUserDropdownOpen(false);
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
          <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-zinc-950 border-l border-zinc-800/60 shadow-2xl z-50 lg:hidden overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center shadow-lg">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Performance</div>
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
                    onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                    className="w-full flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                      <span className="text-zinc-200 truncate">{currentOrganization?.name || 'Select'}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  </button>
                  {orgDropdownOpen && (
                        <div className="mt-2 rounded-lg border border-white/[0.08] bg-[#0a0a0c] overflow-hidden">
                      {orgs.map((org: any) => (
                        <button
                          key={org.id}
                          onClick={() => {
                            setMobileOpen(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-800/70 transition-colors',
                            org.isCurrent && 'bg-zinc-800/70'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-zinc-200 truncate">{org.name}</span>
                            <span className="text-xs text-zinc-500">{org.role}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Mobile Navigation */}
              <div className="space-y-1 mb-6">
                <div className="text-xs font-semibold text-zinc-500 px-2 mb-2">Navigation</div>
                {navigation.map((item) => {
                  const active = pathname === item.href;
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
                      {item.badge && (
                        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
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
  );
}
