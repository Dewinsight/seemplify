'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext, useDirectReports } from '@/lib/hooks';
import { useThemeMode } from '@/context/ThemeContext';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Avatar, Chip, Button,
  LinearProgress, Tabs, Tab, Badge, Alert, TextField, InputAdornment,
  List, ListItem, ListItemAvatar, ListItemText, ListItemSecondaryAction,
  IconButton, Tooltip, Divider, CircularProgress, Paper, Menu, MenuItem,
} from '@mui/material';
import {
  Person, Assessment, Feedback as FeedbackIcon, EventNote, TrendingUp,
  TrendingDown, Remove, Search, MoreVert, Schedule, Assignment,
  Chat, VideoCall, Star, Warning, CheckCircle, PlayArrow, Visibility,
  Add, FilterList, Groups, Description
} from '@mui/icons-material';
import styles from './team.module.css';

interface TeamMember {
  userId: string;
  name: string;
  email: string;
  title?: string;
  avatar?: string;
  department?: string;
  teamName?: string;
  teamIds?: string[];
  organizationRole?: string;
  isSelf?: boolean;
  teams?: Array<{ id: string; name: string; role: string }>;
  role?: string;
}

interface TeamMemberStats {
  okrProgress: number;
  pendingAppraisals: number;
  last1on1Date: string | null;
  averageScore: number | null;
  feedbackCount: number;
  hasActiveAppraisal: boolean;
  moodTrend: 'up' | 'down' | 'stable' | 'unknown';
}

const emptyMemberStats: TeamMemberStats = {
  okrProgress: 0,
  pendingAppraisals: 0,
  last1on1Date: null,
  averageScore: null,
  feedbackCount: 0,
  hasActiveAppraisal: false,
  moodTrend: 'unknown'
};

export default function TeamHubPage() {
  const router = useRouter();
  const { mode } = useThemeMode();
  const isDarkMode = mode === 'dark';
  const { isManager, isHRAdmin, user, teams, currentTeam: contextCurrentTeam, features, isLoading: contextLoading, isError: contextError, mutate: reloadContext } = useUserContext();
  const { workspace, setWorkspace } = usePerformanceWorkspace();
  const organizationView = isHRAdmin && workspace === 'admin';
  const { directReports, isLoading: reportsLoading, managedTeams, isError: peopleError } = useDirectReports(organizationView ? 'organization' : 'managed');

  const [selectedTab, setSelectedTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [teamStats, setTeamStats] = useState<Record<string, TeamMemberStats>>({});
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all'); // 'all' or specific teamId
  const [allTeamMembers, setAllTeamMembers] = useState<TeamMember[]>([]);

  // Load all team members from direct reports (which includes team info)
  useEffect(() => {
    const loadTeamMembers = () => {
      const membersMap = new Map<string, TeamMember>();
      
      // Direct reports already include team info from /user/my-team-members endpoint
      directReports?.forEach((report: any) => {
        membersMap.set(report.userId || report.email, {
          userId: report.userId || report.email,
          name: report.name || report.profile?.displayName || report.email,
          email: report.email,
          title: report.jobTitle || report.title || report.profile?.title || 'Team Member',
          avatar: report.avatar || report.profile?.avatar,
          department: report.teamName || report.department,
          teamName: report.teamName,
          teamIds: report.teamIds || (report.teamId ? [report.teamId] : []),
          organizationRole: report.organizationRole,
          isSelf: report.isSelf,
          teams: report.teams,
          role: report.teamRole || report.role
        });
      });
      
      setAllTeamMembers(Array.from(membersMap.values()));
      
    };
    
    loadTeamMembers();
  }, [directReports, managedTeams]);
  
  // Load team stats for each member
  useEffect(() => {
    if (allTeamMembers && allTeamMembers.length > 0) {
      loadTeamStats();
    } else {
      setLoading(false);
    }
  }, [allTeamMembers]);

  const loadTeamStats = async () => {
    try {
      setLoading(true);
      const statsPromises = allTeamMembers.map(async (member: TeamMember) => {
        try {
          const response = await api.get(`/user/${member.userId}/stats`);
          const payload = response.data?.data ?? response.data;
          return { userId: member.userId, stats: { ...emptyMemberStats, ...(payload || {}) } };
        } catch {
          return {
            userId: member.userId,
            stats: emptyMemberStats
          };
        }
      });

      const results = await Promise.all(statsPromises);
      const statsMap: Record<string, TeamMemberStats> = {};
      results.forEach(r => {
        statsMap[r.userId] = r.stats;
      });
      setTeamStats(statsMap);
    } catch (error) {
      console.error('Failed to load team stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get user's managed teams for filter
  const userManagedTeams = managedTeams || [];
  useEffect(() => {
    if (selectedTeamFilter !== 'all' && !userManagedTeams.some((team: any) => team.id === selectedTeamFilter)) setSelectedTeamFilter('all');
  }, [managedTeams, selectedTeamFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Filter team members by selected team and search
  const filteredMembers = (allTeamMembers || []).filter((member: TeamMember) => {
    // Filter by team
    if (selectedTeamFilter !== 'all') {
      if (!(member.teamIds || []).includes(selectedTeamFilter)) {
        return false;
      }
    }
    
    // Filter by search
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      member.name?.toLowerCase().includes(query) ||
      member.email?.toLowerCase().includes(query) ||
      member.title?.toLowerCase().includes(query) ||
      member.teamName?.toLowerCase().includes(query)
    );
  });

  // Calculate team summary
  const filteredStats = filteredMembers.map(member => teamStats[member.userId] || emptyMemberStats);
  const teamSummary = {
    total: filteredMembers.length,
    needsAttention: filteredStats.filter(s =>
      (features.canonicalAppraisals !== false && s.pendingAppraisals > 0) || s.okrProgress < 30
    ).length,
    avgOkrProgress: filteredMembers.length > 0
      ? filteredStats.reduce((a, s) => a + (s.okrProgress || 0), 0) / filteredMembers.length
      : 0,
    pending1on1s: filteredStats.filter(s => {
      if (!s.last1on1Date) return true;
      const daysSince = Math.floor((Date.now() - new Date(s.last1on1Date).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince > 14;
    }).length
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, member: TeamMember) => {
    setAnchorEl(event.currentTarget);
    setSelectedMember(member);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedMember(null);
  };

  const handleViewProfile = (member: TeamMember) => {
    router.push(`/team/${member.userId}`);
    handleMenuClose();
  };

  const handleSchedule1on1 = (member: TeamMember) => {
    router.push(`/one-on-ones/new?employeeId=${member.userId}&name=${encodeURIComponent(member.name)}`);
    handleMenuClose();
  };

  const handleViewAppraisal = (member: TeamMember) => {
    if (member.isSelf) setWorkspace('personal');
    router.push(`/appraisals?employeeId=${member.userId}`);
    handleMenuClose();
  };

  const handleGiveFeedback = (member: TeamMember) => {
    router.push(`/feedback/new?recipientId=${member.userId}&name=${encodeURIComponent(member.name)}`);
    handleMenuClose();
  };

  const handleViewOkrs = (member: TeamMember) => {
    router.push(`/team/${member.userId}?tab=okrs`);
    handleMenuClose();
  };

  if (contextLoading || contextError) {
    return (
      <Box className={styles.teamHub}>
        <Typography component="h1" variant="h4" sx={{ mb: 2 }}>My Team</Typography>
        {contextLoading ? (
          <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={24} aria-hidden="true" />
            <Typography>Loading your team…</Typography>
          </Box>
        ) : (
          <Alert severity="error" action={<Button color="inherit" onClick={() => void reloadContext().catch(() => undefined)}>Retry</Button>}>
            We couldn&apos;t load your team access. Please try again.
          </Alert>
        )}
      </Box>
    );
  }

  if (!isManager && !isHRAdmin) {
    return (
      <Alert
        severity="info"
        sx={{
          borderRadius: 3,
          bgcolor: isDarkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)',
          color: isDarkMode ? '#93c5fd' : '#1e40af',
          border: `1px solid ${isDarkMode ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)'}`,
        }}
      >
        This page is for managers and HR administrators. You don&apos;t have direct reports to manage.
      </Alert>
    );
  }

  const getMoodIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp color="success" fontSize="small" />;
      case 'down': return <TrendingDown color="error" fontSize="small" />;
      default: return <Remove color="disabled" fontSize="small" />;
    }
  };

  // Summary card configurations
  const summaryCards = [
    {
      label: 'Team Members',
      value: teamSummary.total,
      icon: <Groups />,
    },
    {
      label: 'Needs Attention',
      value: teamSummary.needsAttention,
      icon: <Warning />,
      attention: teamSummary.needsAttention > 0,
    },
    {
      label: 'Avg OKR Progress',
      value: `${Math.round(teamSummary.avgOkrProgress)}%`,
      icon: <Assessment />,
      showProgress: true,
      progressValue: teamSummary.avgOkrProgress,
    },
    ...(features.continuousPerformance === false ? [] : [{
      label: 'Overdue 1:1s',
      value: teamSummary.pending1on1s,
      icon: <Schedule />,
      attention: teamSummary.pending1on1s > 0,
    }]),
  ];

  return (
    <div className={`${styles.teamHub} space-y-8`}>
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className={`${styles.heading} text-4xl font-bold`}>
                {organizationView ? 'People & teams' : 'My teams'}
              </h1>
              {selectedTeamFilter !== 'all' && (
                <span className={`${styles.badge} inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm`}>
                  <Groups className="h-4 w-4" />
                  {userManagedTeams.find((t: any) => t.id === selectedTeamFilter)?.name}
                </span>
              )}
            </div>
            <p className={`text-base ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
              {selectedTeamFilter === 'all' 
                ? `${organizationView ? 'Organization-wide access' : 'Your managed team hierarchy'} · ${userManagedTeams.length} team${userManagedTeams.length !== 1 ? 's' : ''} · ${allTeamMembers.length} people`
                : `Track performance and schedule check-ins for ${filteredMembers.length} member${filteredMembers.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>

      <Alert severity="info" action={isHRAdmin && !organizationView ? <Button onClick={() => setWorkspace('admin')}>View all people</Button> : undefined}>
        {organizationView ? 'Your organization role gives you access to everyone in this organization. Filter by team, then choose who to review and who will conduct each appraisal.' : 'This manager view contains the teams you lead and their subteams. Use Personal for your own work.'}
      </Alert>
      {peopleError && <Alert severity="error">People and teams could not be refreshed from Seemplify Identity. Please refresh this page to retry.</Alert>}
      <div className="flex flex-wrap gap-3">
        {features.canonicalAppraisals !== false && <Button variant="contained" onClick={() => router.push(`/appraisals/start${selectedTeamFilter !== 'all' ? `?teamId=${encodeURIComponent(selectedTeamFilter)}` : ''}`)}>Start appraisal</Button>}
        {features.continuousPerformance !== false && <Button variant="outlined" startIcon={<Add />} onClick={() => router.push('/one-on-ones/new')}>New 1:1</Button>}
      </div>

      {/* Summary Cards */}
      <div aria-label="Team summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, index) => (
          <div
            key={index}
            className={`${styles.summaryCard} relative overflow-hidden rounded-xl p-6`}
          >
            <div className="relative flex justify-between items-center">
              <div>
                <div className={`${styles.summaryLabel} text-xs font-semibold uppercase tracking-wider mb-2`}>
                  {card.label}
                </div>
                <div className={`${styles.heading} text-4xl font-bold`}>
                  {card.value}
                </div>
              </div>
              <div data-attention={card.attention || undefined} className={`${styles.summaryIcon} w-14 h-14 rounded-xl flex items-center justify-center`}>
                <Box sx={{ '& svg': { fontSize: 28, color: 'inherit' } }}>
                  {card.icon}
                </Box>
              </div>
            </div>
            {card.showProgress && (
              <div className={`${styles.progressTrack} mt-4 h-2 rounded-full overflow-hidden`}>
                <div 
                  className={`${styles.progressFill} h-full rounded-full transition-all duration-300`}
                  style={{ width: `${card.progressValue}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tabs and Filters */}
      <div className={`${styles.panel} rounded-xl p-6`}>
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex gap-4">
            <button
              onClick={() => setSelectedTab(0)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                selectedTab === 0
                  ? isDarkMode
                    ? 'bg-zinc-800/80 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : isDarkMode
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              All Members
            </button>
            <button
              onClick={() => setSelectedTab(1)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2 ${
                selectedTab === 1
                  ? isDarkMode
                    ? 'bg-zinc-800/80 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : isDarkMode
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              Needs Attention
              {teamSummary.needsAttention > 0 && (
                <span className={`${styles.attentionBadge} text-xs font-bold px-2 py-0.5 rounded-full`}>
                  {teamSummary.needsAttention}
                </span>
              )}
            </button>
            <button
              onClick={() => setSelectedTab(2)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                selectedTab === 2
                  ? isDarkMode
                    ? 'bg-zinc-800/80 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : isDarkMode
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              Recently Active
            </button>
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            {userManagedTeams.length > 0 && (
              <select
                aria-label="Filter by team"
                value={selectedTeamFilter}
                onChange={(e) => setSelectedTeamFilter(e.target.value)}
                className={`min-w-[240px] px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isDarkMode
                    ? 'bg-zinc-800/60 border-zinc-700/50 text-zinc-100 hover:bg-zinc-800 focus:border-purple-500/50'
                    : 'bg-white border-gray-300 text-gray-900 hover:border-gray-400 focus:border-purple-500'
                } focus:outline-none focus:ring-2 focus:ring-purple-500/20`}
              >
                <option value="all">
                  🏢 All Teams ({userManagedTeams.length} teams • {allTeamMembers.length} members)
                </option>
                {userManagedTeams.map((team: any) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({allTeamMembers.filter(m => m.teamIds?.includes(team.id)).length} people)
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              placeholder="🔍 Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`min-w-[280px] px-4 py-2.5 rounded-lg border text-sm transition-all ${
                isDarkMode
                  ? 'bg-zinc-800/60 border-zinc-700/50 text-zinc-100 placeholder:text-zinc-500 hover:bg-zinc-800 focus:border-purple-500/50'
                  : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 hover:border-gray-400 focus:border-purple-500'
              } focus:outline-none focus:ring-2 focus:ring-purple-500/20`}
            />
          </div>
        </div>
      </div>

      {/* Team List */}
      {loading || reportsLoading ? (
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className={`rounded-xl border p-6 ${isDarkMode ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-900'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
              <Groups className={isDarkMode ? 'text-blue-400' : 'text-blue-600'} />
            </div>
            <div>
              <p className={`font-semibold ${isDarkMode ? 'text-zinc-100' : 'text-gray-900'}`}>
                {searchQuery ? 'No team members match your search' : 'No team members found'}
              </p>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                {searchQuery ? 'Try adjusting your search criteria' : 'Team members will appear here once they are assigned to your teams'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className={`${styles.panel} rounded-xl overflow-hidden`}>
          <div className={styles.memberList}>
            {filteredMembers.map((member: TeamMember, index: number) => {
              const stats: TeamMemberStats = teamStats[member.userId] || {
                okrProgress: 0,
                pendingAppraisals: 0,
                last1on1Date: null,
                averageScore: null,
                feedbackCount: 0,
                hasActiveAppraisal: false,
                moodTrend: 'unknown' as const
              };
              const needsAttention = (features.canonicalAppraisals !== false && stats.pendingAppraisals > 0) || stats.okrProgress < 30;

              // Filter based on tab
              if (selectedTab === 1 && !needsAttention) return null;

              return (
                <div 
                  key={member.userId}
                  className={`${styles.memberRow} p-4 transition-all cursor-pointer`}
                  onClick={() => handleViewProfile(member)}
                >
                  <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-4 xl:flex">
                    <div className="relative flex-shrink-0">
                      <div className="relative">
                        <div className={`${styles.avatar} w-14 h-14 rounded-full flex items-center justify-center font-semibold text-xl`}>
                          {member.name?.[0] || 'U'}
                        </div>
                        <div className={`${styles.moodIndicator} absolute -bottom-1 -right-1 rounded-full p-0.5`}>
                          {getMoodIcon(stats.moodTrend || 'unknown')}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className={`break-words font-semibold text-lg ${isDarkMode ? 'text-zinc-100' : 'text-gray-900'}`}>
                          {member.name}
                        </h3>
                        {member.isSelf && <Chip size="small" label="You" variant="outlined" />}
                        {needsAttention && (
                          <span className={`${styles.attentionBadge} inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold`}>
                            Needs Attention
                          </span>
                        )}
                        {features.canonicalAppraisals !== false && stats.hasActiveAppraisal && (
                          <span className={`${styles.badge} inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold`}>
                            Active Appraisal
                          </span>
                        )}
                      </div>
                      <div className="mt-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`break-words text-sm ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                            {member.organizationRole ? `Organization role: ${member.organizationRole.replace(/_/g, ' ')}` : member.title || 'Team Member'}
                            {member.teams?.length ? ` · ${member.teams.filter(team => selectedTeamFilter === 'all' || team.id === selectedTeamFilter).map(team => `${team.name}: ${team.role.replace(/_/g, ' ')}`).join(' · ')}` : member.role ? ` · Team role: ${member.role.replace(/_/g, ' ')}` : ''}
                          </span>
                          {member.teamName && selectedTeamFilter === 'all' && (
                            <>
                              <span className={`text-sm ${isDarkMode ? 'text-zinc-600' : 'text-gray-400'}`}>•</span>
                              <span className={`${styles.badge} inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium`}>
                                <Groups sx={{ fontSize: 12 }} />
                                {member.teamName}
                              </span>
                            </>
                          )}
                        </div>
                        <div className={`break-words text-sm ${isDarkMode ? 'text-zinc-500' : 'text-gray-500'}`}>
                          {member.email}
                        </div>
                      </div>
                    </div>

                    {/* Stats chips */}
                    <div className="col-span-2 flex flex-wrap items-center gap-2 xl:mt-3">
                      <Tooltip title="OKR Progress">
                        <span className={`${styles.badge} inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold`}>
                          <Assessment sx={{ fontSize: 14 }} />
                          {stats.okrProgress || 0}%
                        </span>
                      </Tooltip>

                      {features.canonicalAppraisals !== false && stats.averageScore && (
                        <Tooltip title="Average Performance Score">
                          <span className={`${styles.badge} inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold`}>
                            <Star sx={{ fontSize: 14 }} />
                            {stats.averageScore.toFixed(1)}
                          </span>
                        </Tooltip>
                      )}

                      {features.canonicalAppraisals !== false && stats.pendingAppraisals > 0 && (
                        <Tooltip title="Pending Appraisals">
                          <span className={`${styles.attentionBadge} inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold`}>
                            <Assignment sx={{ fontSize: 14 }} />
                            {stats.pendingAppraisals}
                          </span>
                        </Tooltip>
                      )}

                      {features.continuousPerformance !== false && <Tooltip title="Feedback Received">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                          isDarkMode
                            ? 'border-zinc-700 text-zinc-400'
                            : 'border-gray-300 text-gray-600'
                        }`}>
                          <FeedbackIcon sx={{ fontSize: 14 }} />
                          {stats.feedbackCount || 0}
                        </span>
                      </Tooltip>}

                      {features.continuousPerformance !== false && <Tooltip title={stats.last1on1Date ? `Last 1:1: ${new Date(stats.last1on1Date).toLocaleDateString()}` : 'No recent 1:1'}>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                            ? styles.attentionBadge
                            : styles.neutralBadge
                        }`}>
                          <EventNote sx={{ fontSize: 14 }} />
                          {stats.last1on1Date ? new Date(stats.last1on1Date).toLocaleDateString() : 'None'}
                        </span>
                      </Tooltip>}
                    </div>

                    {/* Quick Actions */}
                    <div className="col-span-2 flex-shrink-0 xl:ml-auto">
                      <div className="flex flex-wrap gap-2">
                        {features.continuousPerformance !== false && !member.isSelf && <Tooltip title="Schedule 1:1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSchedule1on1(member); }}
                            className={`${styles.action} p-2 rounded-lg transition-all`}
                          >
                            <VideoCall fontSize="small" />
                          </button>
                        </Tooltip>}
                        {features.continuousPerformance !== false && !member.isSelf && <Tooltip title="Give Feedback">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleGiveFeedback(member); }}
                            className={`${styles.action} p-2 rounded-lg transition-all`}
                          >
                            <FeedbackIcon fontSize="small" />
                          </button>
                        </Tooltip>}
                        {features.canonicalAppraisals !== false && <Tooltip title="View Appraisal">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewAppraisal(member); }}
                            className={`${styles.action} p-2 rounded-lg transition-all`}
                          >
                            <Description fontSize="small" />
                          </button>
                        </Tooltip>}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMenuOpen(e, member); }}
                          aria-label={`More actions for ${member.name}`}
                          className={`p-2 rounded-lg transition-all ${
                            isDarkMode
                              ? 'text-zinc-400 hover:bg-zinc-800/50'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <MoreVert fontSize="small" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          sx: {
            bgcolor: isDarkMode ? '#18181b' : 'white',
            border: isDarkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e5e7eb',
            borderRadius: 2,
            minWidth: 200,
          }
        }}
      >
        <MenuItem onClick={() => selectedMember && handleViewProfile(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Person sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View Full Profile
        </MenuItem>
        {features.continuousPerformance !== false && !selectedMember?.isSelf && <MenuItem onClick={() => selectedMember && handleSchedule1on1(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <VideoCall sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> Schedule 1:1
        </MenuItem>}
        {features.canonicalAppraisals !== false && <MenuItem onClick={() => selectedMember && handleViewAppraisal(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Assignment sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View Appraisal
        </MenuItem>}
        {features.continuousPerformance !== false && !selectedMember?.isSelf && <MenuItem onClick={() => selectedMember && handleGiveFeedback(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <FeedbackIcon sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> Give Feedback
        </MenuItem>}
        <Divider sx={{ borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' }} />
        <MenuItem onClick={() => selectedMember && handleViewOkrs(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Assessment sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View OKRs
        </MenuItem>
        {features.continuousPerformance !== false && <MenuItem onClick={() => selectedMember && router.push(`/one-on-ones?with=${selectedMember.userId}`)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Chat sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View 1:1 History
        </MenuItem>}
      </Menu>

    </div>
  );
}
