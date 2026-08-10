'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, BarChart3, ChevronDown, ClipboardCheck, Eye, FileText, Flag, LayoutGrid, Settings, Target, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';
import { useCurrentTeam, useDashboardData, useUserContext } from '@/lib/hooks';
import api, { authApi } from '@/lib/api';

interface ManagerPortalNotification {
  appraisalId: string;
  message: string;
  sentAt?: string;
  employee?: { name?: string; };
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
  const { workspace } = usePerformanceWorkspace();
  const { isAuthenticated, isLoading: authLoading, user: authUser, currentOrganization } = useAuth();
  const {
    user: contextUser,
    roleDisplay,
    isManager,
    isHRAdmin,
    organization,
    teams,
    currentTeam: contextCurrentTeam,
    managerData,
    features,
    isLoading: contextLoading
  } = useUserContext();
  const { currentTeam, mutate: mutateCurrentTeam } = useCurrentTeam();
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [switchingTeam, setSwitchingTeam] = useState(false);
  const teamButtonRef = useRef<HTMLButtonElement>(null);
  const teamMenuRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const [selectedTeamView, setSelectedTeamView] = useState<string>('current');
  const [managerNotifications, setManagerNotifications] = useState<ManagerPortalNotification[]>([]);
  const [managerNotificationLoading, setManagerNotificationLoading] = useState(true);

  const organizationId = currentOrganization?.id || currentOrganization?._id?.toString() || currentOrganization;
  const orgTeams = (teams as TeamOption[]).filter((team) => team.organizationId === organizationId);
  const activeCurrentTeam = currentTeam || contextCurrentTeam;
  const dashboardTeamFilter = workspace === 'personal'
    ? undefined
    : selectedTeamView === 'current' ? activeCurrentTeam?.id : selectedTeamView;
  const { dashboard, isLoading: dashboardLoading, isError } = useDashboardData(dashboardTeamFilter);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!teamDropdownOpen || !teamButtonRef.current) return;

    const updatePosition = () => {
      const rect = teamButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = Math.min(320, Math.max(0, window.innerWidth - 24));
      setDropdownPosition({
        top: rect.bottom + 8,
        left: Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12)),
      });
    };
    updatePosition();
    requestAnimationFrame(() => teamMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus());
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [teamDropdownOpen]);

  useEffect(() => {
    if (workspace !== 'manager' || !isManager || features.canonicalAppraisals === false) {
      setManagerNotifications([]);
      setManagerNotificationLoading(false);
      return;
    }
    const loadManagerNotifications = async () => {
      setManagerNotificationLoading(true);
      try {
        const response = await api.get('/appraisals/notifications/manager?limit=5');
        setManagerNotifications(response.data?.data?.notifications || []);
      } catch (error) {
        console.error('Failed to load manager notifications', error);
      } finally {
        setManagerNotificationLoading(false);
      }
    };
    loadManagerNotifications();
  }, [features.canonicalAppraisals, isManager, workspace]);

  const getTeamViewDisplay = () => {
    if (selectedTeamView === 'all') return 'All teams';
    if (selectedTeamView === 'current') return activeCurrentTeam?.name || orgTeams[0]?.name || 'Select team';
    return orgTeams.find((team) => team.id === selectedTeamView)?.name || 'Select team';
  };

  const closeTeamMenu = () => {
    setTeamDropdownOpen(false);
    requestAnimationFrame(() => teamButtonRef.current?.focus());
  };

  const handleTeamMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(teamMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') || []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      closeTeamMenu();
      return;
    }
    if (nextIndex === null || !items[nextIndex]) return;
    event.preventDefault();
    items[nextIndex].focus();
  };

  const handleSwitchTeamView = async (teamId: string) => {
    if (switchingTeam) return;
    setSwitchingTeam(true);
    closeTeamMenu();
    try {
      if (teamId === 'all') {
        setSelectedTeamView('all');
        setSwitchingTeam(false);
      } else {
        await authApi.switchTeam(teamId);
        setSelectedTeamView('current');
        mutateCurrentTeam?.();
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to switch team:', error);
      setSwitchingTeam(false);
    }
  };

  const handleOpenManagerNotification = async (notification: ManagerPortalNotification) => {
    try {
      await api.post(`/appraisals/${notification.appraisalId}/manager-review/start`);
    } catch (startError) {
      console.error('Failed to start manager review from dashboard', startError);
      try {
        await api.post(`/appraisals/${notification.appraisalId}/notifications/read`, { types: ['self_assessment_submitted', 'manager_review_requested'] });
      } catch (readError) {
        console.error('Failed to mark manager notification as read', readError);
      }
    } finally {
      router.push(`/appraisals/${notification.appraisalId}/manager-review`);
    }
  };

  if (authLoading || dashboardLoading || contextLoading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--suite-line)] border-t-[var(--suite-accent)]" /></div>;
  }

  if (isError) {
    return <div className="suite-notice"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5" style={{ color: 'var(--suite-warning)' }} /><p className="text-sm">Unable to load dashboard data. Some features may be limited.</p></div></div>;
  }

  const data = dashboard || { okrProgress: 0, totalOkrs: 0, completedOkrs: 0, upcomingDeadlines: 0, pendingReviews: 0, recentFeedback: 0 };
  const user = authUser || contextUser;
  const firstName = user?.name?.split(' ')?.[0] || 'there';
  const organizationName = organization?.name || currentOrganization?.name || 'your organization';
  const showTeamSwitcher = workspace !== 'personal' && orgTeams.length > 0;
  const personalActions = [
    { name: 'Set and update OKRs', href: '/okrs?view=my', icon: Target, copy: 'Create objectives, update progress, and keep outcomes connected to your work.', meta: `${data.totalOkrs || 0} active` },
    ...(features.canonicalAppraisals === false ? [] : [
      { name: 'My appraisals', href: '/appraisals?view=personal', icon: FileText, copy: 'Continue your self-assessments, discussions, and assigned reviews.', meta: `${data.upcomingDeadlines || 0} due soon` },
    ]),
  ];
  const managerActions = [
    { name: 'Direct reports', href: '/team', icon: Users, copy: `Review your team, coaching activity${features.continuousPerformance === false ? '' : ', feedback, and development follow-ups'}.`, meta: `${managerData?.directReportCount || 0} reports` },
    { name: 'Team goals', href: '/okrs?view=team', icon: Target, copy: 'Assign, approve, and monitor goals for the people who report to you.', meta: `${data.totalOkrs || 0} in view` },
    ...(features.canonicalAppraisals === false ? [] : [
      { name: 'Team appraisals', href: '/appraisals?view=team', icon: ClipboardCheck, copy: 'Complete manager assessments and move submitted appraisals forward.', meta: `${managerData?.pendingReviews || 0} pending` },
    ]),
  ];
  const adminActions = [
    { name: 'Administration overview', href: '/admin', icon: Settings, copy: 'See cycle health, organization activity, and exceptions that need HR attention.', meta: 'Organization-wide' },
    ...(features.canonicalAppraisals === false ? [] : [
      { name: 'Create appraisal cycle', href: '/admin/appraisal-cycles/new', icon: Flag, copy: 'Choose participants, set the timeline, and launch the next review cycle.', meta: 'New cycle' },
      { name: 'Calibration', href: '/admin/calibration', icon: ClipboardCheck, copy: 'Review rating distribution and complete fair, auditable calibration.', meta: 'HR workflow' },
      { name: 'Performance reports', href: '/admin/reports', icon: BarChart3, copy: 'Monitor completion, progress, and organization-level outcomes.', meta: 'Reporting' },
    ]),
  ];
  const actions = workspace === 'manager' && isManager
    ? managerActions
    : workspace === 'admin' && isHRAdmin
      ? adminActions
      : personalActions;
  const workspaceHeading = workspace === 'manager' && isManager
    ? {
      kicker: 'Manager workspace',
      title: 'Keep your team’s performance work moving.',
      copy: `Review direct reports, goals, coaching, and manager assessments for ${organizationName}.`,
    }
    : workspace === 'admin' && isHRAdmin
      ? {
        kicker: 'Admin workspace',
        title: 'Run a clear and consistent performance process.',
        copy: `Manage cycles, calibration, reporting, and organization-wide performance settings for ${organizationName}.`,
      }
      : {
        kicker: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        title: 'Your performance work, in one place.',
        copy: `Welcome back, ${firstName}. Keep your goals${features.canonicalAppraisals === false ? '' : ', appraisals'}, feedback, and development moving.`,
      };
  const renderActionCard = ({ name, href, icon: Icon, copy, meta }: (typeof actions)[number], compact = false) => (
    <Link key={name} href={href} className={`suite-card${compact ? ' suite-role-card' : ''}`}>
      <div className="suite-card-top"><div className="suite-icon"><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div>
      <h3 className="suite-card-title mt-4">{name}</h3><p className="suite-card-copy">{copy}</p>
      <div className="suite-card-footer"><div className="min-w-0"><p className="suite-label">Current state</p><p className="mt-1 truncate text-sm font-semibold">{meta}</p></div><span className="suite-button">Open <ArrowRight className="h-4 w-4" /></span></div>
    </Link>
  );

  return (
    <div className="suite-dashboard">
      <header className="suite-dashboard-header">
        <div>
          <p className="suite-kicker">{workspaceHeading.kicker}</p>
          <h1 className="suite-dashboard-title">{workspaceHeading.title}</h1>
          <p className="suite-dashboard-copy">{workspaceHeading.copy}</p>
        </div>
        <div className="suite-context">
          <div className="suite-context-row">
            <div className="flex min-w-0 items-center gap-3">
              <div className="suite-context-mark">{organizationName.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0"><p className="suite-label">Performance workspace</p><p className="truncate text-base font-semibold">{organizationName}</p></div>
            </div>
            <a href={process.env.NEXT_PUBLIC_IDP_URL || 'https://auth.seemplifyai.com'} className="suite-button-secondary"><LayoutGrid className="h-4 w-4" /> App Hub</a>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4 border-t pt-3" style={{ borderColor: 'var(--suite-line)' }}>
            <div>
              <p className="suite-label">Current view</p>
              <p className="text-sm font-semibold">{workspace === 'admin' ? 'Admin' : workspace === 'manager' ? 'Manager' : 'Personal'}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--suite-muted)' }}>{roleDisplay || (isHRAdmin ? 'HR administrator' : isManager ? 'Manager' : 'Team member')}</p>
            </div>
            {showTeamSwitcher && (
              <button
                ref={teamButtonRef}
                id="performance-team-trigger"
                type="button"
                aria-expanded={teamDropdownOpen}
                aria-haspopup="menu"
                aria-controls="performance-team-menu"
                onClick={() => setTeamDropdownOpen((open) => !open)}
                disabled={switchingTeam}
                className="suite-button-secondary"
              >
                <Eye className="h-4 w-4" /> {getTeamViewDisplay()} <ChevronDown className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {teamDropdownOpen && mounted && createPortal(
        <>
          <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-[9998] cursor-default" onClick={closeTeamMenu} />
          <div ref={teamMenuRef} id="performance-team-menu" role="menu" aria-labelledby="performance-team-trigger" onKeyDown={handleTeamMenuKeyDown} className="fixed z-[9999] w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-[var(--suite-surface)] shadow-[0_2px_8px_rgba(0,0,0,.12)]" style={{ top: dropdownPosition.top, left: dropdownPosition.left, borderColor: 'var(--suite-line)' }}>
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--suite-line)' }}><p className="text-sm font-semibold">View performance by team</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{orgTeams.length} teams in this organization</p></div>
            <button role="menuitemradio" aria-checked={selectedTeamView === 'all'} onClick={() => selectedTeamView === 'all' ? closeTeamMenu() : handleSwitchTeamView('all')} disabled={switchingTeam} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]"><div><p className="text-sm font-semibold">All teams</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Aggregated organization view</p></div>{selectedTeamView === 'all' && <span className="suite-status">Viewing</span>}</button>
            {orgTeams.map((team) => {
              const active = (selectedTeamView === 'current' && team.id === activeCurrentTeam?.id) || selectedTeamView === team.id;
              return <button role="menuitemradio" aria-checked={active} key={team.id} onClick={() => active ? closeTeamMenu() : handleSwitchTeamView(team.id)} disabled={switchingTeam} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{team.name}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{team.roleDisplay || team.role || 'Team access'}</p></div>{active && <span className="suite-status">Active</span>}</button>;
            })}
          </div>
        </>, document.body
      )}

      {workspace === 'manager' && features.canonicalAppraisals !== false && isManager && managerNotifications.length > 0 && (
        <div className="suite-notice mt-6">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5" style={{ color: 'var(--suite-warning)' }} /><div><p className="text-sm font-semibold">Manager review ready</p><p className="mt-1 text-sm" style={{ color: 'var(--suite-muted)' }}>Review {managerNotifications[0]?.employee?.name || 'an employee'}&apos;s submitted appraisal.</p></div></div>
          <button onClick={() => handleOpenManagerNotification(managerNotifications[0])} className="suite-button">Start review <ArrowRight className="h-4 w-4" /></button>
        </div>
      )}

      <section className="suite-section suite-metrics-section">
        <div className="suite-metrics">
          {workspace === 'manager' && isManager ? (
            <>
              <Link href="/team" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Direct reports</p><p className="suite-metric-value">{managerData?.directReportCount || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>People you manage</p></Link>
              <Link href="/okrs?view=team" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Team OKR progress</p><p className="suite-metric-value">{data.okrProgress || 0}%</p><div className="suite-progress mt-3"><span style={{ width: `${Math.min(100, Number(data.okrProgress || 0))}%` }} /></div></Link>
              {features.canonicalAppraisals !== false && <Link href="/appraisals?view=team" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Pending reviews</p><p className="suite-metric-value">{managerData?.pendingReviews || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Needs your attention</p></Link>}
              {features.canonicalAppraisals !== false && <Link href="/appraisals?view=team" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Upcoming deadlines</p><p className="suite-metric-value">{data.upcomingDeadlines || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Next 7 days</p></Link>}
            </>
          ) : workspace === 'admin' && isHRAdmin ? (
            <>
              <Link href="/admin/appraisal-cycles" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Appraisal cycles</p><p className="suite-metric-value">Open</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Manage timelines and participants</p></Link>
              <Link href="/admin/calibration" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Calibration</p><p className="suite-metric-value">Review</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Rating distribution and fairness</p></Link>
              <Link href="/admin/reports" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Reporting</p><p className="suite-metric-value">Live</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Organization performance data</p></Link>
              <Link href="/analytics" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Analytics</p><p className="suite-metric-value">Explore</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Trends and completion</p></Link>
            </>
          ) : (
            <>
              <Link href="/okrs?view=my" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">OKR progress</p><p className="suite-metric-value">{data.okrProgress || 0}%</p><div className="suite-progress mt-3"><span style={{ width: `${Math.min(100, Number(data.okrProgress || 0))}%` }} /></div></Link>
              <Link href="/okrs?view=my" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Active OKRs</p><p className="suite-metric-value">{data.totalOkrs || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{data.completedOkrs || 0} completed</p></Link>
              {features.canonicalAppraisals !== false && <Link href="/appraisals?view=personal" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Upcoming deadlines</p><p className="suite-metric-value">{data.upcomingDeadlines || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Next 7 days</p></Link>}
              {features.continuousPerformance !== false && <Link href="/feedback" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Recent feedback</p><p className="suite-metric-value">{data.recentFeedback || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Shared with you</p></Link>}
            </>
          )}
        </div>
      </section>

      <section className="suite-section suite-workspace-section" aria-labelledby="performance-workspace-title">
        <div className="suite-section-heading"><div><h2 id="performance-workspace-title" className="suite-section-title">Performance workspace</h2><p className="suite-section-copy">Start with the action that needs to move today.</p></div></div>
        <div className="suite-workspace-layout suite-workspace-layout--single">
          <div className="suite-workspace-main">
            <div className="suite-primary-actions">
              {actions.map((action) => renderActionCard(action))}
            </div>

            {workspace === 'manager' && features.canonicalAppraisals !== false && isManager && (
              <section className="suite-manager-block" aria-labelledby="manager-actions-title">
                <div className="suite-section-heading"><div><h2 id="manager-actions-title" className="suite-section-title">Manager actions</h2><p className="suite-section-copy">Reviews and follow-ups routed directly to you.</p></div></div>
                <div className="suite-panel overflow-hidden">
                  {managerNotificationLoading ? <p className="suite-empty-state">Loading manager actions…</p> : managerNotifications.length === 0 ? <div className="suite-empty-state"><p className="text-sm font-semibold" style={{ color: 'var(--suite-ink)' }}>You are all caught up</p><p className="mt-1 text-sm">No reviews or follow-ups need your attention.</p></div> : managerNotifications.map((notification) => (
                    <button key={`${notification.appraisalId}-${notification.sentAt || 'now'}`} onClick={() => handleOpenManagerNotification(notification)} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]">
                      <div className="min-w-0"><p className="text-sm font-semibold">{notification.employee?.name || 'Employee'}</p><p className="mt-1 truncate text-sm" style={{ color: 'var(--suite-muted)' }}>{notification.message}</p></div><div className="flex shrink-0 items-center gap-3"><span className="text-xs" style={{ color: 'var(--suite-muted)' }}>{notification.sentAt ? new Date(notification.sentAt).toLocaleDateString() : 'Now'}</span><ArrowRight className="h-4 w-4" /></div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
