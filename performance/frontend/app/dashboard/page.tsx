'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUserContext, useDashboardData, useCurrentTeam } from '@/lib/hooks';
import Link from 'next/link';
import {
  Target, FileText, Users, LayoutGrid, Sparkles, Flag, AlertCircle, ChevronDown, Eye
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import api, { authApi } from '@/lib/api';

interface ManagerPortalNotification {
  appraisalId: string;
  message: string;
  sentAt?: string;
  employee?: {
    name?: string;
  };
}

interface TeamOption {
  id: string;
  name: string;
  organizationId?: string;
  role?: string;
  roleDisplay?: string;
}

export default function DashboardPage() {
  const router = useRouter();

  // Get auth state
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth();

  // User context and teams
  const {
    user: contextUser,
    role,
    roleDisplay,
    isManager,
    isHRAdmin,
    organization,
    primaryTeam,
    teams,
    currentTeam: contextCurrentTeam,
    managerData,
    isLoading: contextLoading
  } = useUserContext();

  // Team switching state
  const { currentTeam, mutate: mutateCurrentTeam } = useCurrentTeam();
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [switchingTeam, setSwitchingTeam] = useState(false);
  const teamButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const [selectedTeamView, setSelectedTeamView] = useState<string>('current'); // 'current', 'all', or specific teamId
  const [managerNotifications, setManagerNotifications] = useState<ManagerPortalNotification[]>([]);
  const [managerNotificationLoading, setManagerNotificationLoading] = useState(false);

  // Filter teams by current organization
  const { currentOrganization } = useAuth();
  const orgTeams = (teams as TeamOption[]).filter((t) => {
    const orgId = currentOrganization?.id || currentOrganization?._id?.toString() || currentOrganization;
    return t.organizationId === orgId;
  });
  const activeCurrentTeam = currentTeam || contextCurrentTeam;

  // Dashboard data with team filter
  const dashboardTeamFilter = selectedTeamView === 'current' ? activeCurrentTeam?.id : selectedTeamView;
  const { dashboard, isLoading: dashboardLoading, isError } = useDashboardData(dashboardTeamFilter);

  // Client-side mounting check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update dropdown position
  useEffect(() => {
    if (teamDropdownOpen && teamButtonRef.current) {
      const rect = teamButtonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX
      });
    }
  }, [teamDropdownOpen]);

  const showTeamSwitcher = orgTeams.length > 0;

  // Get display name for selected view
  const getTeamViewDisplay = () => {
    if (selectedTeamView === 'all') return 'All Teams';
    if (selectedTeamView === 'current') return activeCurrentTeam?.name || orgTeams[0]?.name || 'Select Team';
    const team = orgTeams.find((t) => t.id === selectedTeamView);
    return team?.name || 'Select Team';
  };

  // Handle team view change (view specific team or all teams)
  const handleSwitchTeamView = async (teamId: string) => {
    if (switchingTeam) return;
    setSwitchingTeam(true);
    setTeamDropdownOpen(false);

    try {
      if (teamId === 'all') {
        // View all teams - don't change current team, just the view
        setSelectedTeamView('all');
        setSwitchingTeam(false);
        // Optionally refresh dashboard data with all teams filter
        // The dashboard will show aggregated data across all teams
      } else {
        // Switch to specific team
        await authApi.switchTeam(teamId);
        setSelectedTeamView('current');
        if (mutateCurrentTeam) {
          mutateCurrentTeam();
        }
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to switch team:', error);
      setSwitchingTeam(false);
    }
  };

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isManager) return;

    const loadManagerNotifications = async () => {
      setManagerNotificationLoading(true);
      try {
        const res = await api.get('/appraisals/notifications/manager?limit=5');
        const notifications = res.data?.data?.notifications || [];
        setManagerNotifications(notifications);
      } catch (error) {
        console.error('Failed to load manager notifications', error);
      } finally {
        setManagerNotificationLoading(false);
      }
    };

    loadManagerNotifications();
  }, [isManager]);

const handleOpenManagerNotification = async (notification: ManagerPortalNotification) => {
  try {
      await api.post(`/appraisals/${notification.appraisalId}/manager-review/start`);
    } catch (startError) {
      console.error('Failed to start manager review from dashboard', startError);
      try {
        await api.post(`/appraisals/${notification.appraisalId}/notifications/read`, {
          types: ['self_assessment_submitted', 'manager_review_requested']
        });
      } catch (readError) {
        console.error('Failed to mark manager notification as read', readError);
      }
    } finally {
      router.push(`/appraisals/${notification.appraisalId}/manager-review`);
    }
  };

  const user = authUser || contextUser;
  const isLoading = authLoading || dashboardLoading || contextLoading;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-lg flex items-start gap-2">
        <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
        <div className="text-sm">Unable to load dashboard data. Some features may be limited.</div>
      </div>
    );
  }

  const data = dashboard || {
    okrProgress: 0,
    totalOkrs: 0,
    completedOkrs: 0,
    upcomingDeadlines: 0
  };

  const userName = user?.name || 'User';

  // Stat cards
  const statCards = [
    {
      title: 'OKR Progress',
      value: `${data.okrProgress}%`,
      subtitle: `${data.completedOkrs} of ${data.totalOkrs} objectives`,
      icon: Target,
      gradient: 'from-purple-500 via-pink-500 to-rose-500',
      showProgress: true,
      progressValue: data.okrProgress,
      href: '/okrs'
    },
    {
      title: 'Active OKRs',
      value: data.totalOkrs,
      subtitle: `${data.completedOkrs} completed`,
      icon: Target,
      gradient: 'from-amber-500 to-orange-500',
      href: '/okrs'
    },
    {
      title: 'Upcoming Deadlines',
      value: data.upcomingDeadlines,
      subtitle: 'Next 7 days',
      icon: FileText,
      gradient: 'from-emerald-500 to-teal-500',
      href: '/appraisals'
    },
    {
      title: 'Team Members',
      value: managerData?.directReportCount || 0,
      subtitle: isManager ? 'Direct reports' : 'Your team',
      icon: Users,
      gradient: 'from-indigo-500 to-blue-500',
      href: isManager ? '/team' : '/dashboard'
    },
  ];

  // Quick actions
  const quickActions = [
    { name: 'Set OKRs', href: '/okrs', icon: Target, color: 'from-purple-500 to-pink-500' },
    { name: 'My Appraisals', href: '/appraisals', icon: FileText, color: 'from-indigo-500 to-blue-500' },
  ];

  if (isManager) {
    quickActions.push({ name: 'My Team', href: '/team', icon: Users, color: 'from-emerald-500 to-teal-500' });
  }

  if (isHRAdmin) {
    quickActions.push({ name: 'Create Cycle', href: '/admin/appraisal-cycles/new', icon: Flag, color: 'from-rose-500 to-orange-500' });
    quickActions.push({ name: 'Manage Cycles', href: '/admin/appraisal-cycles', icon: LayoutGrid, color: 'from-red-500 to-amber-500' });
    quickActions.push({ name: 'Admin Panel', href: '/admin', icon: Flag, color: 'from-rose-500 to-orange-500' });
  }

  return (
    <div className="space-y-8">
        {isManager && managerNotifications.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-amber-500/20 p-2 text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Manager action required</p>
                  <p className="text-sm text-muted-foreground">
                    It&apos;s your turn to review {managerNotifications[0]?.employee?.name || 'an employee'}&apos;s appraisal.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleOpenManagerNotification(managerNotifications[0])}
                className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
              >
                Start review
              </button>
            </div>
          </div>
        )}

        {/* Welcome Header */}
        <div className="border-b border-border pb-5">
          <div>

            {/* Top Section - Welcome + App Hub */}
            <div className="flex justify-between items-center pb-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-purple-600 dark:text-purple-400">Performance overview</div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  Welcome back, {userName.split(' ')[0]}
                  <Sparkles className="h-6 w-6 text-purple-500 dark:text-purple-400" />
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  Performance overview for <span className="text-foreground font-medium">{organization?.name || 'your organization'}</span>
                </p>
              </div>
              <a
                href={process.env.NEXT_PUBLIC_IDP_URL || 'https://auth.seemplifyai.com'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              >
                <LayoutGrid className="h-4 w-4" />
                App Hub
              </a>
            </div>

            {/* Bottom Section - Team Selector */}
            {showTeamSwitcher && (
              <div className="flex items-center gap-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                    <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-sm text-muted-foreground hidden sm:inline">Viewing:</span>
                </div>

                {selectedTeamView === 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-700 dark:text-purple-200 text-sm font-medium">
                    <Users className="h-3.5 w-3.5" />
                    All {orgTeams.length} Teams
                  </span>
                )}

                <div className="relative">
                  <button
                    ref={teamButtonRef}
                    onClick={() => {
                      if (teamButtonRef.current) {
                        const rect = teamButtonRef.current.getBoundingClientRect();
                        setDropdownPosition({
                          top: rect.bottom + 8,
                          left: rect.left
                        });
                      }
                      setTeamDropdownOpen(!teamDropdownOpen);
                    }}
                    disabled={switchingTeam}
                    className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-background border border-border text-sm text-foreground hover:bg-muted transition-all shadow-lg dark:bg-zinc-800/80 dark:border-zinc-700/60 dark:hover:bg-zinc-700/80"
                  >
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-purple-400" />
                      <span className="font-medium">{getTeamViewDisplay()}</span>
                    </div>
                    <div className="h-4 w-px bg-border"></div>
                    <span className="text-xs text-muted-foreground">
                      {orgTeams.length} team{orgTeams.length !== 1 ? 's' : ''}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {teamDropdownOpen && mounted && createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setTeamDropdownOpen(false)}
                      />
                      <div
                        className="fixed w-80 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden z-[9999]"
                        style={{
                          top: `${dropdownPosition.top}px`,
                          left: `${dropdownPosition.left}px`
                        }}
                      >
                        <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-purple-500/10 to-pink-500/10">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-purple-400" />
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team View</div>
                            </div>
                            <span className="text-xs text-muted-foreground">{orgTeams.length + 1} options</span>
                          </div>
                        </div>

                        {/* All Teams Option */}
                        <button
                          onClick={() => handleSwitchTeamView('all')}
                          disabled={switchingTeam}
                          className={`w-full text-left px-4 py-3 text-sm transition-all ${selectedTeamView === 'all' ? 'bg-purple-500/20 border-l-4 border-l-purple-500 cursor-default' : 'border-l-4 border-l-transparent hover:bg-purple-500/10 cursor-pointer'} ${switchingTeam ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className={`font-semibold ${selectedTeamView === 'all' ? 'text-purple-700 dark:text-purple-200' : 'text-foreground'} truncate`}>
                                All Teams
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                View aggregated data across {orgTeams.length} teams
                              </div>
                            </div>
                            {selectedTeamView === 'all' && (
                              <span className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-300 flex-shrink-0 bg-purple-500/15 px-2.5 py-1.5 rounded-lg font-medium">
                                <Eye className="h-3 w-3" />
                                Viewing
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Individual Teams */}
                        {orgTeams.map((team) => {
                          const isActiveTeam = selectedTeamView === 'current' && team.id === activeCurrentTeam?.id;
                          const isSelectedTeam = selectedTeamView === team.id;
                          const isActive = isActiveTeam || isSelectedTeam;

                          return (
                            <button
                              key={team.id}
                              onClick={() => !isActiveTeam && handleSwitchTeamView(team.id)}
                              disabled={switchingTeam || isActiveTeam}
                              className={`w-full text-left px-4 py-3 text-sm transition-all ${!isActive && 'hover:bg-purple-500/10 cursor-pointer'} ${isActive ? 'bg-purple-500/20 border-l-4 border-l-purple-500 cursor-default' : 'border-l-4 border-l-transparent'} ${switchingTeam ? 'opacity-50 cursor-wait' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className={`font-semibold ${isActive ? 'text-purple-700 dark:text-purple-200' : 'text-foreground'} truncate`}>{team.name}</div>
                                  <div className="flex items-center gap-2 mt-1">
                                    {team.role && (
                                      <span className={`text-xs truncate ${isActive ? 'text-purple-600 dark:text-purple-300' : 'text-muted-foreground'}`}>
                                        {team.roleDisplay || team.role}
                                      </span>
                                    )}
                                    {!isActive && (
                                      <span className="text-xs text-muted-foreground/80">- Click to view</span>
                                    )}
                                  </div>
                                </div>
                                {isActive && (
                                  <span className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-300 flex-shrink-0 bg-purple-500/15 px-2.5 py-1.5 rounded-lg font-medium">
                                    <Eye className="h-3 w-3" />
                                    {isActiveTeam ? 'Active' : 'Viewing'}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, index) => (
            <Link
              key={stat.title}
              href={stat.href}
              className="group block"
            >
              <div className={`glass-card rounded-xl p-6 transition-all duration-300 hover:scale-105 relative overflow-hidden`}>
                <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-0 group-hover:opacity-5 transition-opacity`}></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg`}>
                      <stat.icon className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-foreground mb-1">{stat.value}</div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">{stat.title}</div>
                    {stat.subtitle && (
                      <div className="text-xs text-muted-foreground/80">{stat.subtitle}</div>
                    )}
                    {stat.showProgress && (
                      <div className="mt-3 w-full bg-muted/60 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full bg-gradient-to-r ${stat.gradient} transition-all duration-300`}
                          style={{ width: `${stat.progressValue}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="glass-card rounded-xl p-6">
          <h2 className="text-lg font-bold text-foreground mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <Link
                key={action.name}
                href={action.href}
                className="group flex flex-col items-center p-4 bg-muted/40 rounded-lg border border-border hover:border-purple-500/30 hover:bg-muted transition-all duration-200 hover:scale-105"
              >
                <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                  <action.icon className="h-6 w-6 text-white" />
                </div>
                <span className="text-sm font-medium text-foreground">{action.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {isManager && (
          <div className="glass-card rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Manager Notifications
              </h2>
              {managerNotifications.length > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  {managerNotifications.length} pending
                </span>
              )}
            </div>

            {managerNotificationLoading ? (
              <div className="text-sm text-muted-foreground">Loading notifications...</div>
            ) : managerNotifications.length === 0 ? (
              <div className="text-sm text-muted-foreground">No new manager notifications.</div>
            ) : (
              <div className="space-y-2">
                {managerNotifications.map((notification) => (
                  <button
                    key={`${notification.appraisalId}-${notification.sentAt || 'now'}`}
                    type="button"
                    onClick={() => handleOpenManagerNotification(notification)}
                    className="w-full text-left p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {notification.employee?.name || 'Employee'}
                        </div>
                        <div className="text-sm text-muted-foreground">{notification.message}</div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {notification.sentAt ? new Date(notification.sentAt).toLocaleDateString() : 'Now'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Role-specific sections */}
        {isManager && managerData && managerData.directReportCount > 0 && (
          <div className="glass-card rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
                Team Overview
              </h2>
              <Link
                href="/team"
                className="text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 transition-colors font-medium"
              >
                View All →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <div className="text-2xl font-bold text-foreground">{managerData.directReportCount}</div>
                <div className="text-sm text-muted-foreground">Direct Reports</div>
              </div>
              {managerData.pendingReviews > 0 && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-300">{managerData.pendingReviews}</div>
                  <div className="text-sm text-muted-foreground">Pending Reviews</div>
                </div>
              )}
            </div>
          </div>
        )}

        {isHRAdmin && (
          <div className="glass-card rounded-xl shadow-lg border border-red-500/20 p-6">
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Flag className="h-5 w-5 text-red-500 dark:text-red-400" />
                  HR Administration
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Create an appraisal cycle, choose participants, and launch it immediately from one flow.
                </p>
              </div>
              <Link
                href="/admin"
                className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors font-medium"
              >
                Admin Panel →
              </Link>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/appraisal-cycles/new"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Create Cycle
              </Link>
              <Link
                href="/admin/appraisal-cycles"
                className="inline-flex items-center justify-center rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-500/5 dark:text-red-300"
              >
                Manage Cycles
              </Link>
            </div>
          </div>
        )}
    </div>
  );
}
