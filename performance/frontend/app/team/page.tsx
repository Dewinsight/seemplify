'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext, useDirectReports } from '@/lib/hooks';
import { useThemeMode } from '@/context/ThemeContext';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Avatar, Chip, Button,
  LinearProgress, Tabs, Tab, Badge, Alert, TextField, InputAdornment,
  List, ListItem, ListItemAvatar, ListItemText, ListItemSecondaryAction,
  IconButton, Tooltip, Divider, CircularProgress, Paper, Menu, MenuItem,
  alpha, useTheme
} from '@mui/material';
import {
  Person, Assessment, Feedback as FeedbackIcon, EventNote, TrendingUp,
  TrendingDown, Remove, Search, MoreVert, Schedule, Assignment,
  Chat, VideoCall, Star, Warning, CheckCircle, PlayArrow, Visibility,
  Add, FilterList, Groups, Description
} from '@mui/icons-material';
import { gradients } from '../theme';
import Layout from '@/components/Layout';

interface TeamMember {
  userId: string;
  name: string;
  email: string;
  title?: string;
  avatar?: string;
  department?: string;
  teamName?: string;
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

export default function TeamHubPage() {
  const router = useRouter();
  const theme = useTheme();
  const { mode } = useThemeMode();
  const isDarkMode = mode === 'dark';
  const { isManager, isHRAdmin, user, teams, currentTeam: contextCurrentTeam } = useUserContext();
  const { directReports, isLoading: reportsLoading, managedTeams } = useDirectReports();

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
          role: report.teamRole || report.role
        });
      });
      
      setAllTeamMembers(Array.from(membersMap.values()));
      
      console.log('📊 Loaded team members:', {
        total: membersMap.size,
        directReports: directReports?.length,
        managedTeams: managedTeams?.length,
        members: Array.from(membersMap.values())
      });
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
          return { userId: member.userId, stats: response.data };
        } catch {
          return {
            userId: member.userId,
            stats: {
              okrProgress: 0,
              pendingAppraisals: 0,
              last1on1Date: null,
              averageScore: null,
              feedbackCount: 0,
              hasActiveAppraisal: false,
              moodTrend: 'unknown'
            }
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
  const userManagedTeams = teams?.filter((t: any) => t.isManager || t.role === 'line_manager') || [];
  
  // Filter team members by selected team and search
  const filteredMembers = (allTeamMembers || []).filter((member: TeamMember) => {
    // Filter by team
    if (selectedTeamFilter !== 'all') {
      if (member.teamName !== userManagedTeams.find((t: any) => t.id === selectedTeamFilter)?.name) {
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
  const teamSummary = {
    total: filteredMembers.length,
    needsAttention: Object.values(teamStats).filter(s =>
      s.pendingAppraisals > 0 || s.okrProgress < 30
    ).length,
    avgOkrProgress: filteredMembers.length > 0
      ? Object.values(teamStats).reduce((a, s) => a + (s.okrProgress || 0), 0) / filteredMembers.length
      : 0,
    pending1on1s: Object.values(teamStats).filter(s => {
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
    router.push(`/appraisals?employeeId=${member.userId}`);
    handleMenuClose();
  };

  const handleGiveFeedback = (member: TeamMember) => {
    router.push(`/feedback/new?recipientId=${member.userId}&name=${encodeURIComponent(member.name)}`);
    handleMenuClose();
  };

  if (!isManager && !isHRAdmin) {
    return (
      <Layout>
        <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[rgb(var(--background-start-rgb))]' : 'bg-slate-50'}`}>
          {isDarkMode && <div className="bg-noise" />}
          <div className="relative mx-auto px-4 py-8 lg:px-8 max-w-7xl">
            <Alert
              severity="info"
              sx={{ 
                borderRadius: 3,
                bgcolor: isDarkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)',
                color: isDarkMode ? '#93c5fd' : '#1e40af',
                border: `1px solid ${isDarkMode ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)'}`,
              }}
            >
              This page is for managers and HR administrators. You don't have direct reports to manage.
            </Alert>
          </div>
        </div>
      </Layout>
    );
  }

  const getMoodIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp color="success" fontSize="small" />;
      case 'down': return <TrendingDown color="error" fontSize="small" />;
      default: return <Remove color="disabled" fontSize="small" />;
    }
  };

  const getOkrColor = (progress: number): 'success' | 'warning' | 'error' => {
    if (progress >= 70) return 'success';
    if (progress >= 40) return 'warning';
    return 'error';
  };

  const getOkrGradient = (progress: number) => {
    if (progress >= 70) return 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
    if (progress >= 40) return 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
    return 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
  };

  // Summary card configurations
  const summaryCards = [
    {
      label: 'Team Members',
      value: teamSummary.total,
      icon: <Groups />,
      gradient: gradients.primary,
      shadow: '0 10px 40px -10px rgba(99, 102, 241, 0.5)',
    },
    {
      label: 'Needs Attention',
      value: teamSummary.needsAttention,
      icon: <Warning />,
      gradient: teamSummary.needsAttention > 0
        ? 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'
        : alpha(theme.palette.grey[400], 0.2),
      shadow: teamSummary.needsAttention > 0
        ? '0 10px 40px -10px rgba(245, 158, 11, 0.5)'
        : 'none',
      showBorder: teamSummary.needsAttention > 0,
    },
    {
      label: 'Avg OKR Progress',
      value: `${Math.round(teamSummary.avgOkrProgress)}%`,
      icon: <Assessment />,
      gradient: getOkrGradient(teamSummary.avgOkrProgress),
      shadow: '0 10px 40px -10px rgba(99, 102, 241, 0.3)',
      showProgress: true,
      progressValue: teamSummary.avgOkrProgress,
    },
    {
      label: 'Overdue 1:1s',
      value: teamSummary.pending1on1s,
      icon: <Schedule />,
      gradient: teamSummary.pending1on1s > 0
        ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)'
        : alpha(theme.palette.grey[400], 0.2),
      shadow: teamSummary.pending1on1s > 0
        ? '0 10px 40px -10px rgba(239, 68, 68, 0.5)'
        : 'none',
      showBorder: teamSummary.pending1on1s > 0,
    },
  ];

  return (
    <Layout>
      <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[rgb(var(--background-start-rgb))]' : 'bg-slate-50'}`}>
        {isDarkMode && <div className="bg-noise" />}
        <div className="relative mx-auto px-4 py-8 lg:px-8 max-w-7xl space-y-8">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className={`text-4xl font-bold bg-gradient-to-r ${isDarkMode ? 'from-white via-zinc-100 to-zinc-200' : 'from-gray-900 via-gray-800 to-gray-700'} bg-clip-text text-transparent`}>
                My Team
              </h1>
              {selectedTeamFilter !== 'all' && (
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 text-white font-semibold text-sm shadow-lg">
                  <Groups className="h-4 w-4" />
                  {userManagedTeams.find((t: any) => t.id === selectedTeamFilter)?.name}
                </span>
              )}
            </div>
            <p className={`text-base ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
              {selectedTeamFilter === 'all' 
                ? `Manage ${userManagedTeams.length} team${userManagedTeams.length !== 1 ? 's' : ''} with ${allTeamMembers.length} total members`
                : `Track performance and schedule check-ins for ${filteredMembers.length} member${filteredMembers.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, index) => (
          <div
            key={index}
            className={`relative overflow-hidden rounded-xl p-6 transition-all duration-300 hover:scale-105 ${
              card.showBorder
                ? isDarkMode
                  ? 'bg-zinc-900/80 border border-amber-500/30'
                  : 'bg-white border border-amber-500/30'
                : ''
            }`}
            style={{
              background: !card.showBorder ? card.gradient : undefined,
              color: card.showBorder ? undefined : 'white',
              boxShadow: card.shadow,
            }}
          >
            {!card.showBorder && (
              <div 
                className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%)' }}
              />
            )}
            <div className="relative flex justify-between items-center">
              <div>
                <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${card.showBorder ? (isDarkMode ? 'text-zinc-400' : 'text-gray-600') : 'text-white/90'}`}>
                  {card.label}
                </div>
                <div className={`text-4xl font-bold ${card.showBorder ? (card.value as number) > 0 ? 'text-amber-500' : (isDarkMode ? 'text-zinc-100' : 'text-gray-900') : 'text-white'}`}>
                  {card.value}
                </div>
              </div>
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center backdrop-blur-lg ${card.showBorder ? 'bg-amber-500/10' : 'bg-white/20'}`}>
                <Box sx={{ '& svg': { fontSize: 28, opacity: 0.9, color: card.showBorder ? 'warning.main' : 'white' } }}>
                  {card.icon}
                </Box>
              </div>
            </div>
            {card.showProgress && (
              <div className="mt-4 h-2 bg-white/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-white rounded-full transition-all duration-300"
                  style={{ width: `${card.progressValue}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tabs and Filters */}
      <div className={`rounded-xl border p-6 ${isDarkMode ? 'bg-zinc-900/50 border-zinc-700/50' : 'bg-white border-gray-200'}`}>
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
                <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
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
            {userManagedTeams.length > 1 && (
              <select
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
                    👥 {team.name} ({allTeamMembers.filter(m => m.teamName === team.name).length} members)
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
        <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-zinc-900/50 border-zinc-700/50' : 'bg-white border-gray-200'}`}>
          <div className="divide-y divide-zinc-700/50">
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
              const needsAttention = stats.pendingAppraisals > 0 || stats.okrProgress < 30;

              // Filter based on tab
              if (selectedTab === 1 && !needsAttention) return null;

              return (
                <div 
                  key={member.userId}
                  className={`p-4 transition-all cursor-pointer ${
                    needsAttention
                      ? isDarkMode
                        ? 'bg-amber-500/5 hover:bg-amber-500/10'
                        : 'bg-amber-50 hover:bg-amber-100/50'
                      : isDarkMode
                        ? 'hover:bg-zinc-800/50'
                        : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleViewProfile(member)}
                >
                  <div className="flex items-start gap-4">
                    <div className="relative flex-shrink-0">
                      <div className="relative">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center text-white font-semibold text-xl shadow-lg shadow-purple-500/20">
                          {member.name?.[0] || 'U'}
                        </div>
                        <div className="absolute -bottom-1 -right-1 bg-zinc-900 rounded-full p-0.5">
                          {getMoodIcon(stats.moodTrend || 'unknown')}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className={`font-semibold text-lg ${isDarkMode ? 'text-zinc-100' : 'text-gray-900'}`}>
                          {member.name}
                        </h3>
                        {needsAttention && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-xs font-bold">
                            Needs Attention
                          </span>
                        )}
                        {stats.hasActiveAppraisal && (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-semibold ${
                            isDarkMode 
                              ? 'border-blue-500/50 text-blue-400' 
                              : 'border-blue-500/30 text-blue-600'
                          }`}>
                            Active Appraisal
                          </span>
                        )}
                      </div>
                      <div className="mt-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                            {member.title || 'Team Member'}
                          </span>
                          {member.teamName && selectedTeamFilter === 'all' && (
                            <>
                              <span className={`text-sm ${isDarkMode ? 'text-zinc-600' : 'text-gray-400'}`}>•</span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${
                                isDarkMode
                                  ? 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                                  : 'border-purple-500/20 text-purple-600 bg-purple-50'
                              }`}>
                                <Groups sx={{ fontSize: 12 }} />
                                {member.teamName}
                              </span>
                            </>
                          )}
                        </div>
                        <div className={`text-sm ${isDarkMode ? 'text-zinc-500' : 'text-gray-500'}`}>
                          {member.email}
                        </div>
                      </div>
                    </div>

                    {/* Stats chips */}
                    <div className="flex gap-2 items-center flex-wrap mt-3">
                      <Tooltip title="OKR Progress">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold shadow-md"
                          style={{ background: getOkrGradient(stats.okrProgress || 0) }}>
                          <Assessment sx={{ fontSize: 14 }} />
                          {stats.okrProgress || 0}%
                        </span>
                      </Tooltip>

                      {stats.averageScore && (
                        <Tooltip title="Average Performance Score">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 text-white text-xs font-semibold shadow-md">
                            <Star sx={{ fontSize: 14 }} />
                            {stats.averageScore.toFixed(1)}
                          </span>
                        </Tooltip>
                      )}

                      {stats.pendingAppraisals > 0 && (
                        <Tooltip title="Pending Appraisals">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-xs font-semibold shadow-md">
                            <Assignment sx={{ fontSize: 14 }} />
                            {stats.pendingAppraisals}
                          </span>
                        </Tooltip>
                      )}

                      <Tooltip title="Feedback Received">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                          isDarkMode
                            ? 'border-zinc-700 text-zinc-400'
                            : 'border-gray-300 text-gray-600'
                        }`}>
                          <FeedbackIcon sx={{ fontSize: 14 }} />
                          {stats.feedbackCount || 0}
                        </span>
                      </Tooltip>

                      <Tooltip title={stats.last1on1Date ? `Last 1:1: ${new Date(stats.last1on1Date).toLocaleDateString()}` : 'No recent 1:1'}>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                            ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-md'
                            : isDarkMode
                              ? 'border border-zinc-700 text-zinc-400'
                              : 'border border-gray-300 text-gray-600'
                        }`}>
                          <EventNote sx={{ fontSize: 14 }} />
                          {stats.last1on1Date ? new Date(stats.last1on1Date).toLocaleDateString() : 'None'}
                        </span>
                      </Tooltip>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex-shrink-0">
                      <div className="flex gap-2">
                        <Tooltip title="Schedule 1:1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSchedule1on1(member); }}
                            className={`p-2 rounded-lg transition-all ${
                              isDarkMode
                                ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}
                          >
                            <VideoCall fontSize="small" />
                          </button>
                        </Tooltip>
                        <Tooltip title="Give Feedback">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleGiveFeedback(member); }}
                            className={`p-2 rounded-lg transition-all ${
                              isDarkMode
                                ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                : 'bg-green-50 text-green-600 hover:bg-green-100'
                            }`}
                          >
                            <FeedbackIcon fontSize="small" />
                          </button>
                        </Tooltip>
                        <Tooltip title="View Appraisal">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewAppraisal(member); }}
                            className={`p-2 rounded-lg transition-all ${
                              isDarkMode
                                ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                            }`}
                          >
                            <Description fontSize="small" />
                          </button>
                        </Tooltip>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMenuOpen(e, member); }}
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
        <MenuItem onClick={() => selectedMember && handleSchedule1on1(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <VideoCall sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> Schedule 1:1
        </MenuItem>
        <MenuItem onClick={() => selectedMember && handleViewAppraisal(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Assignment sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View Appraisal
        </MenuItem>
        <MenuItem onClick={() => selectedMember && handleGiveFeedback(selectedMember)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <FeedbackIcon sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> Give Feedback
        </MenuItem>
        <Divider sx={{ borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' }} />
        <MenuItem onClick={() => selectedMember && router.push(`/team/${selectedMember.userId}/okrs`)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Assessment sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View OKRs
        </MenuItem>
        <MenuItem onClick={() => selectedMember && router.push(`/one-on-ones?with=${selectedMember.userId}`)}
          sx={{ color: isDarkMode ? '#e4e4e7' : '#111827', '&:hover': { bgcolor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } }}>
          <Chat sx={{ mr: 1.5, color: isDarkMode ? '#a1a1aa' : '#6b7280' }} /> View 1:1 History
        </MenuItem>
      </Menu>

      {/* Quick Actions FAB */}
      <button
        onClick={() => router.push('/one-on-ones/new')}
        className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 text-white font-semibold shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/40 hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50"
      >
        <Add />
        New 1:1
      </button>
        </div>
      </div>
    </Layout>
  );
}
