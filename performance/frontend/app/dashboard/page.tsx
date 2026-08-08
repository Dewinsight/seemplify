'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, ChevronDown, Eye, FileText, Flag, LayoutGrid, Target, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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
    isLoading: contextLoading
  } = useUserContext();
  const { currentTeam, mutate: mutateCurrentTeam } = useCurrentTeam();
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [switchingTeam, setSwitchingTeam] = useState(false);
  const teamButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const [selectedTeamView, setSelectedTeamView] = useState<string>('current');
  const [managerNotifications, setManagerNotifications] = useState<ManagerPortalNotification[]>([]);
  const [managerNotificationLoading, setManagerNotificationLoading] = useState(false);

  const organizationId = currentOrganization?.id || currentOrganization?._id?.toString() || currentOrganization;
  const orgTeams = (teams as TeamOption[]).filter((team) => team.organizationId === organizationId);
  const activeCurrentTeam = currentTeam || contextCurrentTeam;
  const dashboardTeamFilter = selectedTeamView === 'current' ? activeCurrentTeam?.id : selectedTeamView;
  const { dashboard, isLoading: dashboardLoading, isError } = useDashboardData(dashboardTeamFilter);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!teamDropdownOpen || !teamButtonRef.current) return;
    const rect = teamButtonRef.current.getBoundingClientRect();
    setDropdownPosition({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 336) });
  }, [teamDropdownOpen]);

  useEffect(() => {
    if (!isManager) return;
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
  }, [isManager]);

  const getTeamViewDisplay = () => {
    if (selectedTeamView === 'all') return 'All teams';
    if (selectedTeamView === 'current') return activeCurrentTeam?.name || orgTeams[0]?.name || 'Select team';
    return orgTeams.find((team) => team.id === selectedTeamView)?.name || 'Select team';
  };

  const handleSwitchTeamView = async (teamId: string) => {
    if (switchingTeam) return;
    setSwitchingTeam(true);
    setTeamDropdownOpen(false);
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

  const data = dashboard || { okrProgress: 0, totalOkrs: 0, completedOkrs: 0, upcomingDeadlines: 0 };
  const user = authUser || contextUser;
  const firstName = user?.name?.split(' ')?.[0] || 'there';
  const organizationName = organization?.name || currentOrganization?.name || 'your organization';
  const showTeamSwitcher = orgTeams.length > 0;
  const actions = [
    { name: 'Set and update OKRs', href: '/okrs', icon: Target, copy: 'Create objectives, update progress, and keep outcomes connected to the work.', meta: `${data.totalOkrs || 0} active` },
    { name: 'My appraisals', href: '/appraisals', icon: FileText, copy: 'Continue self-assessments, discussions, and reviews already assigned to you.', meta: `${data.upcomingDeadlines || 0} due soon` },
    ...(isManager ? [{ name: 'My team', href: '/team', icon: Users, copy: 'Review direct reports, manager actions, goals, and development activity.', meta: `${managerData?.directReportCount || 0} reports` }] : []),
    ...(isHRAdmin ? [{ name: 'Create appraisal cycle', href: '/admin/appraisal-cycles/new', icon: Flag, copy: 'Choose participants, set the timeline, and launch the next review cycle.', meta: 'HR administration' }] : []),
  ];

  return (
    <div className="suite-dashboard">
      <header className="suite-dashboard-header">
        <div>
          <p className="suite-kicker">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="suite-dashboard-title">Performance work that stays close to the team.</h1>
          <p className="suite-dashboard-copy">
            Welcome back, {firstName}. Move goals, appraisals, and manager actions forward for {organizationName} without hunting through separate workflows.
          </p>
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
            <div><p className="suite-label">Your role</p><p className="text-sm font-semibold">{roleDisplay || (isHRAdmin ? 'HR administrator' : isManager ? 'Manager' : 'Team member')}</p></div>
            {showTeamSwitcher && (
              <button ref={teamButtonRef} onClick={() => setTeamDropdownOpen((open) => !open)} disabled={switchingTeam} className="suite-button-secondary">
                <Eye className="h-4 w-4" /> {getTeamViewDisplay()} <ChevronDown className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {teamDropdownOpen && mounted && createPortal(
        <>
          <button aria-label="Close team menu" className="fixed inset-0 z-[9998] cursor-default" onClick={() => setTeamDropdownOpen(false)} />
          <div className="fixed z-[9999] w-80 overflow-hidden rounded-xl border bg-[var(--suite-surface)] shadow-[0_2px_8px_rgba(0,0,0,.12)]" style={{ top: dropdownPosition.top, left: dropdownPosition.left, borderColor: 'var(--suite-line)' }}>
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--suite-line)' }}><p className="text-sm font-semibold">View performance by team</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{orgTeams.length} teams in this organization</p></div>
            <button onClick={() => handleSwitchTeamView('all')} disabled={switchingTeam} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]"><div><p className="text-sm font-semibold">All teams</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Aggregated organization view</p></div>{selectedTeamView === 'all' && <span className="suite-status">Viewing</span>}</button>
            {orgTeams.map((team) => {
              const active = (selectedTeamView === 'current' && team.id === activeCurrentTeam?.id) || selectedTeamView === team.id;
              return <button key={team.id} onClick={() => !active && handleSwitchTeamView(team.id)} disabled={switchingTeam || active} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]"><div className="min-w-0"><p className="truncate text-sm font-semibold">{team.name}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{team.roleDisplay || team.role || 'Team access'}</p></div>{active && <span className="suite-status">Active</span>}</button>;
            })}
          </div>
        </>, document.body
      )}

      {isManager && managerNotifications.length > 0 && (
        <div className="suite-notice mt-6">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5" style={{ color: 'var(--suite-warning)' }} /><div><p className="text-sm font-semibold">Manager review ready</p><p className="mt-1 text-sm" style={{ color: 'var(--suite-muted)' }}>Review {managerNotifications[0]?.employee?.name || 'an employee'}&apos;s submitted appraisal.</p></div></div>
          <button onClick={() => handleOpenManagerNotification(managerNotifications[0])} className="suite-button">Start review <ArrowRight className="h-4 w-4" /></button>
        </div>
      )}

      <section className="suite-section">
        <div className="suite-metrics">
          <Link href="/okrs" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">OKR progress</p><p className="suite-metric-value">{data.okrProgress || 0}%</p><div className="suite-progress mt-3"><span style={{ width: `${Math.min(100, Number(data.okrProgress || 0))}%` }} /></div></Link>
          <Link href="/okrs" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Active OKRs</p><p className="suite-metric-value">{data.totalOkrs || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{data.completedOkrs || 0} completed</p></Link>
          <Link href="/appraisals" className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Upcoming deadlines</p><p className="suite-metric-value">{data.upcomingDeadlines || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Next 7 days</p></Link>
          <Link href={isManager ? '/team' : '/dashboard'} className="suite-metric hover:bg-[var(--suite-surface-muted)]"><p className="suite-label">Direct reports</p><p className="suite-metric-value">{managerData?.directReportCount || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{isManager ? 'In your team' : 'Manager view only'}</p></Link>
        </div>
      </section>

      <section className="suite-section">
        <div className="suite-section-heading"><div><h2 className="suite-section-title">Performance workspace</h2><p className="suite-section-copy">Start with the action that needs to move today.</p></div>{isHRAdmin && <Link href="/admin" className="suite-button-secondary">Admin panel <ArrowRight className="h-4 w-4" /></Link>}</div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {actions.map(({ name, href, icon: Icon, copy, meta }) => (
            <Link key={name} href={href} className="suite-card">
              <div className="suite-card-top"><div className="suite-icon"><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div>
              <h3 className="suite-card-title mt-4">{name}</h3><p className="suite-card-copy">{copy}</p>
              <div className="suite-card-footer"><div className="min-w-0"><p className="suite-label">Current state</p><p className="mt-1 truncate text-sm font-semibold">{meta}</p></div><span className="suite-button">Open <ArrowRight className="h-4 w-4" /></span></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="suite-section suite-split">
        <div>
          <div className="suite-section-heading"><div><h2 className="suite-section-title">Manager actions</h2><p className="suite-section-copy">Reviews and follow-ups routed directly to you.</p></div></div>
          <div className="suite-panel overflow-hidden">
            {managerNotificationLoading ? <p className="px-5 py-10 text-sm" style={{ color: 'var(--suite-muted)' }}>Loading manager actions…</p> : managerNotifications.length === 0 ? <p className="px-5 py-10 text-sm" style={{ color: 'var(--suite-muted)' }}>No new manager actions.</p> : managerNotifications.map((notification) => (
              <button key={`${notification.appraisalId}-${notification.sentAt || 'now'}`} onClick={() => handleOpenManagerNotification(notification)} className="suite-list-row w-full text-left hover:bg-[var(--suite-surface-muted)]">
                <div className="min-w-0"><p className="text-sm font-semibold">{notification.employee?.name || 'Employee'}</p><p className="mt-1 truncate text-sm" style={{ color: 'var(--suite-muted)' }}>{notification.message}</p></div><div className="flex shrink-0 items-center gap-3"><span className="text-xs" style={{ color: 'var(--suite-muted)' }}>{notification.sentAt ? new Date(notification.sentAt).toLocaleDateString() : 'Now'}</span><ArrowRight className="h-4 w-4" /></div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="suite-section-heading"><div><h2 className="suite-section-title">Your management scope</h2><p className="suite-section-copy">The people and reviews currently assigned to you.</p></div></div>
          <div className="suite-panel overflow-hidden">
            <div className="suite-list-row"><div><p className="suite-label">Direct reports</p><p className="suite-value">{managerData?.directReportCount || 0}</p></div><Users className="h-5 w-5" style={{ color: 'var(--suite-accent)' }} /></div>
            <div className="suite-list-row"><div><p className="suite-label">Pending reviews</p><p className="suite-value">{managerData?.pendingReviews || 0}</p></div><FileText className="h-5 w-5" style={{ color: 'var(--suite-warning)' }} /></div>
            {isHRAdmin && <div className="p-5"><p className="text-sm font-semibold">Review-cycle administration</p><p className="mt-2 text-sm leading-6" style={{ color: 'var(--suite-muted)' }}>Create, launch, and manage appraisal cycles from the HR workspace.</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/admin/appraisal-cycles/new" className="suite-button">Create cycle</Link><Link href="/admin/appraisal-cycles" className="suite-button-secondary">Manage cycles</Link></div></div>}
          </div>
        </div>
      </section>
    </div>
  );
}
