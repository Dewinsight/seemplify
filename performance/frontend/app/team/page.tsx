'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext, useDirectReports } from '@/lib/hooks';
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
  const { isManager, isHRAdmin, user } = useUserContext();
  const { directReports, isLoading: reportsLoading } = useDirectReports();

  const [selectedTab, setSelectedTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [teamStats, setTeamStats] = useState<Record<string, TeamMemberStats>>({});
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Load team stats for each member
  useEffect(() => {
    if (directReports && directReports.length > 0) {
      loadTeamStats();
    } else {
      setLoading(false);
    }
  }, [directReports]);

  const loadTeamStats = async () => {
    try {
      setLoading(true);
      const statsPromises = directReports.map(async (member: TeamMember) => {
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

  // Filter team members
  const filteredMembers = (directReports || []).filter((member: TeamMember) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      member.name?.toLowerCase().includes(query) ||
      member.email?.toLowerCase().includes(query) ||
      member.title?.toLowerCase().includes(query)
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
      <Box sx={{ p: 3 }}>
        <Alert
          severity="info"
          sx={{ borderRadius: 3 }}
        >
          This page is for managers and HR administrators. You don't have direct reports to manage.
        </Alert>
      </Box>
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
    <Box className="animate-fadeIn">
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography
          variant="h4"
          fontWeight={800}
          gutterBottom
          sx={{
            background: gradients.primary,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          My Team
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your direct reports, track performance, and schedule check-ins
        </Typography>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {summaryCards.map((card, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card
              sx={{
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                background: card.showBorder ? 'white' : card.gradient,
                color: card.showBorder ? 'inherit' : 'white',
                borderLeft: card.showBorder ? 4 : 0,
                borderColor: card.showBorder ? theme.palette.warning.main : 'transparent',
                boxShadow: card.shadow,
                '&:hover': {
                  transform: 'translateY(-4px)',
                },
                '&::before': !card.showBorder ? {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%)',
                  pointerEvents: 'none',
                } : {},
              }}
            >
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography
                      variant="overline"
                      sx={{
                        opacity: card.showBorder ? 0.7 : 0.9,
                        color: card.showBorder ? 'text.secondary' : 'inherit',
                        fontWeight: 600,
                      }}
                    >
                      {card.label}
                    </Typography>
                    <Typography
                      variant="h3"
                      fontWeight={800}
                      color={card.showBorder
                        ? (card.value as number) > 0 ? 'warning.main' : 'text.primary'
                        : 'inherit'
                      }
                    >
                      {card.value}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      width: 52,
                      height: 52,
                      borderRadius: 2,
                      bgcolor: card.showBorder
                        ? alpha(theme.palette.warning.main, 0.1)
                        : 'rgba(255,255,255,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backdropFilter: 'blur(10px)',
                      '& svg': {
                        fontSize: 28,
                        color: card.showBorder ? 'warning.main' : 'inherit',
                        opacity: 0.9,
                      },
                    }}
                  >
                    {card.icon}
                  </Box>
                </Box>
                {card.showProgress && (
                  <LinearProgress
                    variant="determinate"
                    value={card.progressValue}
                    sx={{
                      mt: 2,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'rgba(255,255,255,0.3)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: 'white',
                        borderRadius: 3,
                      },
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tabs and Search */}
      <Paper
        sx={{
          mb: 3,
          p: 0.5,
          bgcolor: alpha(theme.palette.grey[500], 0.04),
        }}
      >
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Tabs
            value={selectedTab}
            onChange={(_, v) => setSelectedTab(v)}
            sx={{
              '& .MuiTab-root': {
                fontWeight: 600,
              },
            }}
          >
            <Tab label="All Members" />
            <Tab
              label={
                <Badge badgeContent={teamSummary.needsAttention} color="warning">
                  Needs Attention
                </Badge>
              }
            />
            <Tab label="Recently Active" />
          </Tabs>
          <TextField
            size="small"
            placeholder="Search team members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search /></InputAdornment>
            }}
            sx={{
              minWidth: 280,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'white',
              },
            }}
          />
        </Box>
      </Paper>

      {/* Team List */}
      {loading || reportsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredMembers.length === 0 ? (
        <Alert
          severity="info"
          sx={{ borderRadius: 3 }}
        >
          {searchQuery ? 'No team members match your search' : 'No direct reports found. Team members will appear here once assigned.'}
        </Alert>
      ) : (
        <Paper sx={{ overflow: 'hidden' }}>
          <List disablePadding>
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
                <Box key={member.userId}>
                  {index > 0 && <Divider />}
                  <ListItem
                    sx={{
                      py: 2.5,
                      px: 3,
                      bgcolor: needsAttention
                        ? alpha(theme.palette.warning.main, 0.04)
                        : 'inherit',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        bgcolor: needsAttention
                          ? alpha(theme.palette.warning.main, 0.08)
                          : alpha(theme.palette.primary.main, 0.04),
                        cursor: 'pointer',
                      }
                    }}
                    onClick={() => handleViewProfile(member)}
                  >
                    <ListItemAvatar>
                      <Badge
                        overlap="circular"
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        badgeContent={getMoodIcon(stats.moodTrend || 'unknown')}
                      >
                        <Avatar
                          sx={{
                            width: 56,
                            height: 56,
                            background: gradients.primary,
                            boxShadow: '0 4px 14px -4px rgba(99, 102, 241, 0.4)',
                            fontSize: '1.25rem',
                            fontWeight: 600,
                          }}
                        >
                          {member.name?.[0] || 'U'}
                        </Avatar>
                      </Badge>
                    </ListItemAvatar>

                    <ListItemText
                      sx={{ ml: 2 }}
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="subtitle1" fontWeight={600}>
                            {member.name}
                          </Typography>
                          {needsAttention && (
                            <Chip
                              size="small"
                              label="Needs Attention"
                              sx={{
                                height: 22,
                                fontSize: 11,
                                fontWeight: 600,
                                background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                                color: 'white',
                              }}
                            />
                          )}
                          {stats.hasActiveAppraisal && (
                            <Chip
                              size="small"
                              label="Active Appraisal"
                              variant="outlined"
                              sx={{
                                height: 22,
                                fontSize: 11,
                                borderColor: alpha(theme.palette.info.main, 0.5),
                                color: 'info.main',
                              }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          <Typography variant="body2" color="text.secondary">
                            {member.title || 'Team Member'} {member.department && `• ${member.department}`}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {member.email}
                          </Typography>
                        </Box>
                      }
                    />

                    {/* Stats chips */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mr: 2, flexWrap: 'wrap' }}>
                      <Tooltip title="OKR Progress">
                        <Chip
                          size="small"
                          icon={<Assessment />}
                          label={`${stats.okrProgress || 0}%`}
                          sx={{
                            fontWeight: 600,
                            background: getOkrGradient(stats.okrProgress || 0),
                            color: 'white',
                            '& .MuiChip-icon': { color: 'white' },
                          }}
                        />
                      </Tooltip>

                      {stats.averageScore && (
                        <Tooltip title="Average Performance Score">
                          <Chip
                            size="small"
                            icon={<Star />}
                            label={stats.averageScore.toFixed(1)}
                            sx={{
                              fontWeight: 600,
                              background: gradients.primary,
                              color: 'white',
                              '& .MuiChip-icon': { color: 'white' },
                            }}
                          />
                        </Tooltip>
                      )}

                      {stats.pendingAppraisals > 0 && (
                        <Tooltip title="Pending Appraisals">
                          <Chip
                            size="small"
                            icon={<Assignment />}
                            label={stats.pendingAppraisals}
                            sx={{
                              fontWeight: 600,
                              background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                              color: 'white',
                              '& .MuiChip-icon': { color: 'white' },
                            }}
                          />
                        </Tooltip>
                      )}

                      <Tooltip title="Feedback Received">
                        <Chip
                          size="small"
                          icon={<FeedbackIcon />}
                          label={stats.feedbackCount || 0}
                          variant="outlined"
                          sx={{ borderColor: alpha(theme.palette.grey[400], 0.5) }}
                        />
                      </Tooltip>

                      <Tooltip title={stats.last1on1Date ? `Last 1:1: ${new Date(stats.last1on1Date).toLocaleDateString()}` : 'No recent 1:1'}>
                        <Chip
                          size="small"
                          icon={<EventNote />}
                          label={stats.last1on1Date ? new Date(stats.last1on1Date).toLocaleDateString() : 'None'}
                          sx={{
                            fontWeight: !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000 ? 600 : 400,
                            background: !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                              ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)'
                              : 'transparent',
                            color: !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                              ? 'white'
                              : 'text.secondary',
                            border: !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                              ? 'none'
                              : `1px solid ${alpha(theme.palette.grey[400], 0.5)}`,
                            '& .MuiChip-icon': {
                              color: !stats.last1on1Date || (Date.now() - new Date(stats.last1on1Date).getTime()) > 14 * 24 * 60 * 60 * 1000
                                ? 'white'
                                : 'inherit',
                            },
                          }}
                        />
                      </Tooltip>
                    </Box>

                    {/* Quick Actions */}
                    <ListItemSecondaryAction>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Schedule 1:1">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); handleSchedule1on1(member); }}
                            sx={{
                              bgcolor: alpha(theme.palette.primary.main, 0.08),
                              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.12) },
                            }}
                          >
                            <VideoCall fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Give Feedback">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); handleGiveFeedback(member); }}
                            sx={{
                              bgcolor: alpha(theme.palette.success.main, 0.08),
                              color: 'success.main',
                              '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.12) },
                            }}
                          >
                            <FeedbackIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="View Appraisal">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); handleViewAppraisal(member); }}
                            sx={{
                              bgcolor: alpha(theme.palette.warning.main, 0.08),
                              color: 'warning.main',
                              '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.12) },
                            }}
                          >
                            <Description fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); handleMenuOpen(e, member); }}
                        >
                          <MoreVert fontSize="small" />
                        </IconButton>
                      </Box>
                    </ListItemSecondaryAction>
                  </ListItem>
                </Box>
              );
            })}
          </List>
        </Paper>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => selectedMember && handleViewProfile(selectedMember)}>
          <Person sx={{ mr: 1.5, color: 'text.secondary' }} /> View Full Profile
        </MenuItem>
        <MenuItem onClick={() => selectedMember && handleSchedule1on1(selectedMember)}>
          <VideoCall sx={{ mr: 1.5, color: 'text.secondary' }} /> Schedule 1:1
        </MenuItem>
        <MenuItem onClick={() => selectedMember && handleViewAppraisal(selectedMember)}>
          <Assignment sx={{ mr: 1.5, color: 'text.secondary' }} /> View Appraisal
        </MenuItem>
        <MenuItem onClick={() => selectedMember && handleGiveFeedback(selectedMember)}>
          <FeedbackIcon sx={{ mr: 1.5, color: 'text.secondary' }} /> Give Feedback
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => selectedMember && router.push(`/team/${selectedMember.userId}/okrs`)}>
          <Assessment sx={{ mr: 1.5, color: 'text.secondary' }} /> View OKRs
        </MenuItem>
        <MenuItem onClick={() => selectedMember && router.push(`/one-on-ones?with=${selectedMember.userId}`)}>
          <Chat sx={{ mr: 1.5, color: 'text.secondary' }} /> View 1:1 History
        </MenuItem>
      </Menu>

      {/* Quick Actions FAB */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000,
        }}
      >
        <Button
          variant="contained"
          size="large"
          startIcon={<Add />}
          onClick={() => router.push('/one-on-ones/new')}
          sx={{
            borderRadius: 3,
            px: 3,
            py: 1.5,
            boxShadow: '0 8px 32px -8px rgba(99, 102, 241, 0.5)',
            '&:hover': {
              boxShadow: '0 12px 40px -8px rgba(99, 102, 241, 0.6)',
            },
          }}
        >
          New 1:1
        </Button>
      </Box>
    </Box>
  );
}
