'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { usePerformanceWorkspace, type PerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';
import { useThemeMode } from '@/context/ThemeContext';
import {
  TrendingUp,
  Target,
  FileText,
  Users,
  Settings,
  Menu,
  X,
  ChevronDown,
  Building2,
  LayoutGrid,
  Sparkles,
  MessageSquare,
  CalendarDays,
  Sprout,
  ListChecks,
  ClipboardCheck,
  UserRound,
  BriefcaseBusiness,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { useUserContext, useCurrentTeam } from '@/lib/hooks';
import { authApi } from '@/lib/api';
import PageGuide from './PageGuide';
import ThemePreferenceMenu from './ThemePreferenceMenu';
import { ActionCentreBell } from './ActionCentre';

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

const WORKSPACE_ICONS: Record<PerformanceWorkspace, React.ComponentType<{ className?: string }>> = {
  personal: UserRound,
  manager: BriefcaseBusiness,
  admin: ShieldCheck,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user: authUser, currentOrganization: authCurrentOrg, switchOrganization, isLoading: authLoading } = useAuth();
  const {
    user,
    role,
    isManager,
    isHRAdmin,
    teams,
    currentTeam: contextCurrentTeam,
    features,
    isLoading: contextLoading,
    isError: contextError,
  } = useUserContext();
  const { currentTeam, availableTeams, mutate: mutateCurrentTeam } = useCurrentTeam();
  const { workspace, availableWorkspaces, setWorkspace, isReady: workspaceReady } = usePerformanceWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [growthDropdownOpen, setGrowthDropdownOpen] = useState(false);
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [switchingTeam, setSwitchingTeam] = useState(false);

  // Get current team (from hook or context)
  const activeCurrentTeam = currentTeam || contextCurrentTeam;

  // Get organizations from auth user - includes IDP data
  const orgs = authUser?.idpOrganizations || authUser?.organizations || [];

  // Current organization from AuthContext (synced with IDP)
  const currentOrganization = authCurrentOrg || orgs.find((o: any) => o.id === authCurrentOrg?.id) || orgs[0];
  const showOrgSwitcher = orgs.length > 1;

  // Filter teams by current organization
  const orgTeams = teams.filter((t: any) => {
    const orgId = authCurrentOrg?.id || authCurrentOrg?._id?.toString() || authCurrentOrg;
    return t.organizationId === orgId;
  });
  const showTeamSwitcher = orgTeams.length > 1 && currentOrganization;
  const rolloutVisibilityReady = !contextLoading && !contextError;

  const navigation: NavItem[] = useMemo(() => {
    const dashboard: NavItem = { name: 'Dashboard', href: '/dashboard', icon: TrendingUp, section: 'main' };
    const appraisalsEnabled = rolloutVisibilityReady && features.canonicalAppraisals !== false;
    const continuousEnabled = rolloutVisibilityReady && features.continuousPerformance !== false;

    if (workspace === 'admin' && isHRAdmin) {
      return [
        dashboard,
        { name: 'Overview', href: '/admin', icon: ShieldCheck, section: 'main' },
        ...(appraisalsEnabled ? [
          { name: 'Cycles', href: '/admin/appraisal-cycles', icon: Settings, section: 'main' as const },
          { name: 'Calibration', href: '/admin/calibration', icon: ClipboardCheck, section: 'main' as const },
          { name: 'Reports', href: '/admin/reports', icon: BarChart3, section: 'main' as const },
        ] : []),
        { name: 'Analytics', href: '/analytics', icon: TrendingUp, section: 'main' },
      ];
    }

    const growthItems: NavItem[] = continuousEnabled ? [
      { name: 'Feedback', href: '/feedback', icon: MessageSquare, section: 'analytics' },
      { name: '1:1s', href: '/one-on-ones', icon: CalendarDays, section: 'analytics' },
      { name: 'Check-ins', href: '/check-ins', icon: ClipboardCheck, section: 'analytics' },
      { name: 'Development', href: '/development', icon: Sprout, section: 'analytics' },
    ] : [];

    if (workspace === 'manager' && isManager) {
      return [
        dashboard,
        { name: 'Team', href: '/team', icon: Users, section: 'main' },
        { name: 'Team OKRs', href: '/okrs?view=team', icon: Target, section: 'main' },
        ...(appraisalsEnabled ? [{ name: 'Team Appraisals', href: '/appraisals?view=team', icon: FileText, section: 'main' as const }] : []),
        ...growthItems,
      ];
    }

    return [
      dashboard,
      { name: 'My OKRs', href: '/okrs?view=my', icon: Target, section: 'main' },
      ...(appraisalsEnabled ? [{ name: 'My Appraisals', href: '/appraisals?view=personal', icon: FileText, section: 'main' as const }] : []),
      ...growthItems,
    ];
  }, [features.canonicalAppraisals, features.continuousPerformance, isHRAdmin, isManager, rolloutVisibilityReady, workspace]);

  const handleWorkspaceChange = (nextWorkspace: PerformanceWorkspace) => {
    if (nextWorkspace === workspace) return;
    setWorkspace(nextWorkspace);
    setGrowthDropdownOpen(false);
    setMobileOpen(false);
    router.push('/dashboard');
  };

  const ActiveWorkspaceIcon = WORKSPACE_ICONS[workspace];
  const activeWorkspaceLabel = availableWorkspaces.find((option) => option.value === workspace)?.label || 'Personal';

  // Handle organization switch
  const handleSwitchOrganization = async (orgId: string) => {
    if (switchingOrg) return;
    setSwitchingOrg(true);
    setOrgDropdownOpen(false);
    try {
      await switchOrganization(orgId);
      // Reset team when switching org (teams are org-specific)
      if (mutateCurrentTeam) {
        mutateCurrentTeam();
      }
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setSwitchingOrg(false);
    }
  };

  // Handle team switch (within current organization)
  const handleSwitchTeam = async (teamId: string) => {
    if (switchingTeam) return;
    setSwitchingTeam(true);
    setTeamDropdownOpen(false);
    try {
      await authApi.switchTeam(teamId);
      // Refresh current team data
      if (mutateCurrentTeam) {
        mutateCurrentTeam();
      }
      // Refresh user context to get updated team info
      window.location.reload(); // Simple reload to refresh all data
    } catch (error) {
      console.error('Failed to switch team:', error);
      setSwitchingTeam(false);
    }
  };

  const { mode } = useThemeMode();
  const isDarkMode = mode === 'dark';
  const hubUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
  const showNoOrganizations = !authLoading && !!authUser && orgs.length === 0;

  if (showNoOrganizations) {
    return (
      <div className={cn(
        "min-h-screen transition-colors duration-300",
        isDarkMode ? "bg-[#0f0e13]" : "bg-[#f1efe9]"
      )}>
        {isDarkMode && <div className="bg-noise" />}
        <div className="relative mx-auto px-4 py-16 lg:px-8 max-w-3xl">
          <div className={cn(
            "rounded-2xl border p-8 text-center shadow-2xl",
            isDarkMode
              ? "bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 border-zinc-700/50"
              : "bg-white border-gray-200"
          )}>
            <div className={cn(
              "mx-auto mb-6 h-16 w-16 rounded-2xl flex items-center justify-center",
              isDarkMode
                ? "bg-zinc-800/70 text-teal-300"
                : "bg-teal-50 text-teal-700"
            )}>
              <Building2 className="h-8 w-8" />
            </div>
            <h1 className={cn(
              "text-2xl font-semibold",
              isDarkMode ? "text-white" : "text-gray-900"
            )}>
              No organizations yet
            </h1>
            <p className={cn(
              "mt-3 text-sm",
              isDarkMode ? "text-zinc-400" : "text-gray-600"
            )}>
              To use Performance Management, you need to belong to an organization.
            </p>
            <p className={cn(
              "mt-1 text-sm",
              isDarkMode ? "text-zinc-500" : "text-gray-500"
            )}>
              Return to the hub to join or create one.
            </p>
            <a
              href={hubUrl}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-500 via-cyan-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition-all hover:shadow-teal-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            >
              <LayoutGrid className="h-4 w-4" />
              Return to Hub
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300",
        isDarkMode ? "bg-[#0f0e13]" : "bg-[#f1efe9]"
    )}>
      {/* Background Noise */}
      {isDarkMode && <div className="bg-noise" />}

      {/* Top Navbar */}
      <nav className={cn(
        "fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-300",
        isDarkMode
          ? "border-[#312d39] bg-[#0f0e13]"
          : "border-[#cbc6bc] bg-[#f1efe9]"
      )}>
        <div className="mx-auto max-w-[100rem] px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <Link href="https://seemplifyai.com" className="flex shrink-0 items-center gap-2.5 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="hidden sm:block">
                <div className={cn(
                  "whitespace-nowrap text-sm font-semibold leading-tight transition-colors",
                  isDarkMode ? "text-white" : "text-gray-900"
                )}>Performance Management</div>
                <div className={cn(
                  "text-xs leading-tight transition-colors",
                  isDarkMode ? "text-zinc-400" : "text-gray-500"
                )}>by Seemplify</div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden min-w-0 items-center gap-1 lg:flex" aria-label="Primary navigation">
              {navigation.filter(n => n.section === 'main').map((item) => {
                const itemPath = item.href.split('?')[0];
                const active = pathname === itemPath || (itemPath !== '/dashboard' && pathname.startsWith(`${itemPath}/`));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150',
                      active
                        ? isDarkMode
                          ? 'bg-zinc-800/80 text-white'
                          : 'bg-gray-100 text-gray-900'
                        : isDarkMode
                          ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                    {item.badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-teal-500 to-cyan-500 text-white">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
              {navigation.some((item) => item.section === 'analytics') && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setGrowthDropdownOpen((open) => !open)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      navigation.filter((item) => item.section === 'analytics').some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
                        ? isDarkMode ? 'bg-zinc-800/80 text-white' : 'bg-gray-100 text-gray-900'
                        : isDarkMode ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    )}
                    aria-expanded={growthDropdownOpen}
                    aria-haspopup="menu"
                  >
                    Growth
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {growthDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setGrowthDropdownOpen(false)} />
                      <div
                        className={cn(
                          'absolute left-0 top-11 z-50 w-52 overflow-hidden rounded-lg border py-1 shadow-lg',
                          isDarkMode ? 'border-zinc-800 bg-zinc-950' : 'border-gray-200 bg-white'
                        )}
                        role="menu"
                      >
                        {navigation.filter((item) => item.section === 'analytics').map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setGrowthDropdownOpen(false)}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                              isDarkMode ? 'text-zinc-300 hover:bg-zinc-800/70' : 'text-gray-700 hover:bg-gray-50'
                            )}
                            role="menuitem"
                          >
                            <item.icon className="h-4 w-4" />
                            {item.name}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right Side Actions */}
            <div className="flex shrink-0 items-center gap-2">
              {workspaceReady && availableWorkspaces.length > 1 && (
                <div
                  className={cn(
                    'hidden items-center rounded-lg border p-0.5 2xl:flex',
                    isDarkMode ? 'border-zinc-800 bg-zinc-900/60' : 'border-gray-200 bg-white'
                  )}
                  role="group"
                  aria-label="Performance workspace"
                >
                  {availableWorkspaces.map((option) => {
                    const Icon = WORKSPACE_ICONS[option.value];
                    const active = workspace === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        title={option.description}
                        onClick={() => handleWorkspaceChange(option.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                          active
                            ? 'bg-teal-700 text-white'
                            : isDarkMode
                              ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {workspaceReady && availableWorkspaces.length > 1 && (
                <div className="relative hidden lg:block 2xl:hidden">
                  <button
                    type="button"
                    aria-expanded={workspaceDropdownOpen}
                    aria-haspopup="menu"
                    onClick={() => setWorkspaceDropdownOpen((open) => !open)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold',
                      isDarkMode ? 'border-zinc-800 bg-zinc-900/60 text-zinc-200' : 'border-gray-200 bg-white text-gray-700'
                    )}
                  >
                    <ActiveWorkspaceIcon className="h-3.5 w-3.5" />
                    {activeWorkspaceLabel}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {workspaceDropdownOpen && (
                    <>
                      <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-40 cursor-default" onClick={() => setWorkspaceDropdownOpen(false)} />
                      <div className={cn('absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-lg border py-1 shadow-lg', isDarkMode ? 'border-zinc-800 bg-zinc-950' : 'border-gray-200 bg-white')} role="menu">
                        {availableWorkspaces.map((option) => {
                          const Icon = WORKSPACE_ICONS[option.value];
                          const active = option.value === workspace;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={() => {
                                setWorkspaceDropdownOpen(false);
                                handleWorkspaceChange(option.value);
                              }}
                              className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left', isDarkMode ? 'hover:bg-zinc-900' : 'hover:bg-gray-50')}
                            >
                              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">{option.label}</span>
                                <span className={cn('mt-0.5 block text-xs', isDarkMode ? 'text-zinc-500' : 'text-gray-500')}>{option.description}</span>
                              </span>
                              {active && <span className="ml-auto text-xs text-teal-600">Current</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              {rolloutVisibilityReady && features.notifications !== false && <ActionCentreBell />}
              <ThemePreferenceMenu />

              {/* Organization & Team Switcher */}
              <div className="relative hidden 2xl:block">
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
                    isDarkMode
                      ? "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800/70"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  )}
                >
                  <Building2 className="h-4 w-4" />
                  <div className="flex flex-col items-start">
                    <span className="max-w-[108px] truncate text-xs font-medium">{currentOrganization?.name || 'Organization'}</span>
                    {activeCurrentTeam && (
                      <span className={cn("max-w-[108px] truncate text-[10px]", isDarkMode ? "text-zinc-500" : "text-gray-500")}>
                        {activeCurrentTeam.name || 'Team'}
                      </span>
                    )}
                  </div>
                  <ChevronDown className={cn("h-4 w-4", isDarkMode ? "text-zinc-500" : "text-gray-400")} />
                </button>
                {orgDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setOrgDropdownOpen(false)}
                    />
                    <div className={cn(
                      "absolute right-0 top-12 w-72 rounded-xl border shadow-2xl overflow-hidden z-50",
                      isDarkMode
                        ? "border-white/[0.08] bg-zinc-950"
                        : "border-gray-200 bg-white"
                    )}>
                      {/* Current Organization Header */}
                      <div className={cn(
                        "px-4 py-3 border-b",
                        isDarkMode ? "border-zinc-800/60 bg-zinc-900/50" : "border-gray-100 bg-gray-50"
                      )}>
                        <div className="flex items-center gap-2">
                          <Building2 className={cn("h-4 w-4", isDarkMode ? "text-teal-400" : "text-teal-700")} />
                          <span className={cn("text-sm font-semibold", isDarkMode ? "text-white" : "text-gray-900")}>
                            {currentOrganization?.name || 'Organization'}
                          </span>
                        </div>
                        {showOrgSwitcher && (
                          <span className={cn("text-xs mt-1 block", isDarkMode ? "text-zinc-500" : "text-gray-500")}>
                            {orgs.length} organizations available
                          </span>
                        )}
                      </div>

                      {/* Teams Section */}
                      <div className={cn("py-2", isDarkMode ? "border-b border-zinc-800/60" : "border-b border-gray-100")}>
                        <div className={cn("px-4 py-1 text-xs font-medium uppercase tracking-wider", isDarkMode ? "text-zinc-500" : "text-gray-400")}>
                          Teams
                        </div>
                        {orgTeams.length > 0 ? (
                          orgTeams.map((team: any) => {
                            const isCurrentTeam = team.id === activeCurrentTeam?.id;
                            return (
                              <button
                                key={team.id}
                                onClick={() => !isCurrentTeam && handleSwitchTeam(team.id)}
                                disabled={switchingTeam || isCurrentTeam}
                                className={cn(
                                  'w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between',
                                  isDarkMode
                                    ? cn('hover:bg-zinc-800/70', isCurrentTeam && 'bg-zinc-800/70')
                                    : cn('hover:bg-gray-50', isCurrentTeam && 'bg-gray-100'),
                                  isCurrentTeam && 'cursor-default',
                                  switchingTeam && 'opacity-50 cursor-wait'
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <Users className="h-3.5 w-3.5" />
                                  <span className={cn("truncate", isDarkMode ? "text-zinc-200" : "text-gray-900")}>{team.name}</span>
                                </div>
                                <span className={cn("text-xs", isDarkMode ? "text-zinc-500" : "text-gray-500")}>
                                  {isCurrentTeam ? '✓' : team.role}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className={cn("px-4 py-4 text-center", isDarkMode ? "text-zinc-500" : "text-gray-500")}>
                            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm mb-2">No teams yet</p>
                            <a
                              href={`${hubUrl}/teams`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors",
                                isDarkMode
                                  ? "bg-teal-500/20 text-teal-300 hover:bg-teal-500/30"
                                  : "bg-teal-100 text-teal-700 hover:bg-teal-200"
                              )}
                              onClick={() => setOrgDropdownOpen(false)}
                            >
                              Create First Team →
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Switch Organization (if multiple orgs) */}
                      {showOrgSwitcher && (
                        <div className="py-2">
                          <div className={cn("px-4 py-1 text-xs font-medium uppercase tracking-wider", isDarkMode ? "text-zinc-500" : "text-gray-400")}>
                            Switch Organization
                          </div>
                          {orgs.filter((org: any) => org.id !== currentOrganization?.id).map((org: any) => (
                            <button
                              key={org.id}
                              onClick={() => handleSwitchOrganization(org.id)}
                              disabled={switchingOrg}
                              className={cn(
                                'w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between',
                                isDarkMode ? 'hover:bg-zinc-800/70' : 'hover:bg-gray-50',
                                switchingOrg && 'opacity-50 cursor-wait'
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <Building2 className="h-3.5 w-3.5" />
                                <span className={cn("truncate", isDarkMode ? "text-zinc-200" : "text-gray-900")}>{org.name}</span>
                              </div>
                              <span className={cn("text-xs", isDarkMode ? "text-zinc-500" : "text-gray-500")}>{org.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-lg p-1.5 transition-colors",
                    isDarkMode ? "hover:bg-zinc-800/50" : "hover:bg-gray-100"
                  )}
                >
                  <div className={cn(
                    "h-9 w-9 rounded-full bg-gradient-to-br from-teal-500 via-cyan-500 to-emerald-500 flex items-center justify-center ring-2",
                    isDarkMode ? "ring-zinc-800" : "ring-gray-200"
                  )}>
                    <span className="text-sm font-semibold text-white">{user?.name?.charAt(0) || 'U'}</span>
                  </div>
                  <div className="hidden max-w-[132px] text-left 2xl:block">
                    <div className={cn(
                      "truncate text-sm font-medium",
                      isDarkMode ? "text-white" : "text-gray-900"
                    )}>{user?.name || 'User'}</div>
                    <div className={cn(
                      "truncate text-xs",
                      isDarkMode ? "text-zinc-500" : "text-gray-500"
                    )}>{user?.email}</div>
                  </div>
                  <ChevronDown className={cn("hidden lg:block h-4 w-4", isDarkMode ? "text-zinc-500" : "text-gray-400")} />
                </button>
                {userDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserDropdownOpen(false)}
                    />
                    <div className={cn(
                      "absolute right-0 top-14 w-56 rounded-xl border shadow-2xl overflow-hidden z-50",
                      isDarkMode ? "border-white/[0.08] bg-zinc-950" : "border-gray-200 bg-white"
                    )}>
                      <div className={cn(
                        "p-3 border-b",
                        isDarkMode ? "border-zinc-800/60" : "border-gray-100"
                      )}>
                        <div className={cn(
                          "text-sm font-medium truncate",
                          isDarkMode ? "text-white" : "text-gray-900"
                        )}>{user?.name || 'User'}</div>
                        <div className={cn(
                          "text-xs truncate",
                          isDarkMode ? "text-zinc-500" : "text-gray-500"
                        )}>{user?.email}</div>
                      </div>
                      <div className="py-2">
                        {rolloutVisibilityReady && features.notifications !== false && (
                          <Link
                            href="/action-centre"
                            className={cn(
                              "block px-4 py-2 text-sm transition-colors",
                              isDarkMode ? "text-zinc-300 hover:bg-zinc-800/70" : "text-gray-700 hover:bg-gray-50"
                            )}
                            onClick={() => setUserDropdownOpen(false)}
                          >
                            <ListChecks className="h-4 w-4 inline mr-2" />
                            Action centre
                          </Link>
                        )}
                        <Link
                          href="/ai-account"
                          className={cn(
                            "block px-4 py-2 text-sm transition-colors",
                            isDarkMode ? "text-zinc-300 hover:bg-zinc-800/70" : "text-gray-700 hover:bg-gray-50"
                          )}
                          onClick={() => setUserDropdownOpen(false)}
                        >
                          <Sparkles className="h-4 w-4 inline mr-2" />
                          ChatGPT account
                        </Link>
                        {workspace === 'manager' && isManager && (
                          <Link
                            href="/team"
                            className={cn(
                              "block px-4 py-2 text-sm transition-colors",
                              isDarkMode ? "text-zinc-300 hover:bg-zinc-800/70" : "text-gray-700 hover:bg-gray-50"
                            )}
                            onClick={() => setUserDropdownOpen(false)}
                          >
                            <Users className="h-4 w-4 inline mr-2" />
                            My Team
                          </Link>
                        )}
                        {workspace === 'admin' && isHRAdmin && (
                          <Link
                            href="/admin"
                            className={cn(
                              "block px-4 py-2 text-sm transition-colors",
                              isDarkMode ? "text-zinc-300 hover:bg-zinc-800/70" : "text-gray-700 hover:bg-gray-50"
                            )}
                            onClick={() => setUserDropdownOpen(false)}
                          >
                            <Settings className="h-4 w-4 inline mr-2" />
                            Admin Panel
                          </Link>
                        )}
                        <a
                          href={hubUrl}
                          className={cn(
                            "w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2",
                            isDarkMode ? "text-zinc-300 hover:bg-zinc-800/70" : "text-gray-700 hover:bg-gray-50"
                          )}
                          onClick={() => setUserDropdownOpen(false)}
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
                className={cn(
                  "lg:hidden p-2 rounded-lg transition-colors",
                  isDarkMode ? "hover:bg-zinc-800/50" : "hover:bg-gray-100"
                )}
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className={cn("h-5 w-5", isDarkMode ? "text-zinc-300" : "text-gray-600")} />
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
          <div className={cn(
            "fixed inset-y-0 right-0 w-80 max-w-[85vw] border-l shadow-2xl z-50 lg:hidden overflow-y-auto",
            isDarkMode ? "bg-zinc-950 border-zinc-800/60" : "bg-white border-gray-200"
          )}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 via-cyan-500 to-emerald-500 flex items-center justify-center shadow-lg">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className={cn(
                      "text-sm font-semibold",
                      isDarkMode ? "text-white" : "text-gray-900"
                    )}>Performance</div>
                    <div className={cn(
                      "text-xs",
                      isDarkMode ? "text-zinc-400" : "text-gray-500"
                    )}>by Seemplify</div>
                  </div>
                </div>
                <button
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isDarkMode ? "hover:bg-zinc-800/50" : "hover:bg-gray-100"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  <X className={cn("h-5 w-5", isDarkMode ? "text-zinc-400" : "text-gray-500")} />
                </button>
              </div>

              <ThemePreferenceMenu mobile />

              {workspaceReady && availableWorkspaces.length > 1 && (
                <div className="mb-6">
                  <p className={cn('mb-2 px-1 text-xs font-semibold', isDarkMode ? 'text-zinc-500' : 'text-gray-500')}>
                    Workspace
                  </p>
                  <div className={cn('overflow-hidden rounded-lg border', isDarkMode ? 'border-zinc-800' : 'border-gray-200')}>
                    {availableWorkspaces.map((option) => {
                      const Icon = WORKSPACE_ICONS[option.value];
                      const active = workspace === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleWorkspaceChange(option.value)}
                          className={cn(
                            'flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-b-0',
                            isDarkMode ? 'border-zinc-800' : 'border-gray-200',
                            active
                              ? isDarkMode ? 'bg-teal-950/50 text-teal-200' : 'bg-teal-50 text-teal-900'
                              : isDarkMode ? 'text-zinc-300 hover:bg-zinc-900' : 'text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className={cn('mt-0.5 block text-xs', isDarkMode ? 'text-zinc-500' : 'text-gray-500')}>
                              {option.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mobile Organization Switcher */}
              {showOrgSwitcher && (
                <div className="mb-6">
                  <button
                    onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm",
                      isDarkMode
                        ? "border-zinc-800 bg-zinc-900/50"
                        : "border-gray-200 bg-gray-50"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className={cn("h-4 w-4 flex-shrink-0", isDarkMode ? "text-zinc-400" : "text-gray-500")} />
                      <span className={cn("truncate", isDarkMode ? "text-zinc-200" : "text-gray-900")}>{currentOrganization?.name || 'Select'}</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4", isDarkMode ? "text-zinc-500" : "text-gray-400")} />
                  </button>
                  {orgDropdownOpen && (
                    <div className={cn(
                      "mt-2 rounded-lg border overflow-hidden",
                      isDarkMode ? "border-white/[0.08] bg-zinc-950" : "border-gray-200 bg-white"
                    )}>
                      {orgs.map((org: any) => {
                        const isCurrentOrg = org.id === currentOrganization?.id;
                        return (
                          <button
                            key={org.id}
                            onClick={() => {
                              if (!isCurrentOrg) {
                                handleSwitchOrganization(org.id);
                              }
                              setMobileOpen(false);
                            }}
                            disabled={switchingOrg || isCurrentOrg}
                            className={cn(
                              'w-full text-left px-3 py-2.5 text-sm transition-colors',
                              isDarkMode
                                ? cn('hover:bg-zinc-800/70', isCurrentOrg && 'bg-zinc-800/70')
                                : cn('hover:bg-gray-50', isCurrentOrg && 'bg-gray-100'),
                              isCurrentOrg && 'cursor-default',
                              switchingOrg && 'opacity-50 cursor-wait'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn("truncate", isDarkMode ? "text-zinc-200" : "text-gray-900")}>{org.name}</span>
                              <span className={cn("text-xs", isDarkMode ? "text-zinc-500" : "text-gray-500")}>
                                {isCurrentOrg ? '✓ Current' : org.role}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Mobile Navigation */}
              <div className="space-y-1 mb-6">
                <div className={cn(
                  "text-xs font-semibold px-2 mb-2",
                  isDarkMode ? "text-zinc-500" : "text-gray-500"
                )}>Navigation</div>
                {navigation.map((item) => {
                  const itemPath = item.href.split('?')[0];
                  const active = pathname === itemPath || (itemPath !== '/dashboard' && pathname.startsWith(`${itemPath}/`));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? isDarkMode
                            ? 'bg-zinc-800/80 text-white'
                            : 'bg-gray-100 text-gray-900'
                          : isDarkMode
                            ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                      {item.badge && (
                        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-teal-500 to-cyan-500 text-white">
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
      <main className={cn(
        "min-h-screen bg-[var(--suite-canvas)] pt-16 transition-colors duration-150"
      )}>
        <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
          <PageGuide />
          {children}
        </div>
      </main>
    </div>
  );
}
