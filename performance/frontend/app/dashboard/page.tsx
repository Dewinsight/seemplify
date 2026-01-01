'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useUserContext, useDashboardData } from '@/lib/hooks';
import {
  Typography, Box, Button, Card, CardContent, LinearProgress, Alert, Grid, Skeleton,
  alpha, useTheme
} from '@mui/material';
import Link from 'next/link';
import {
  Assessment, Assignment, Feedback as FeedbackIcon, TrendingUp, AutoAwesome,
  Groups, EmojiEvents, Warning, SupervisorAccount, ArrowForward, Rocket
} from '@mui/icons-material';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { gradients } from '../theme';

export default function DashboardPage() {
  const router = useRouter();
  const theme = useTheme();
  
  // Get auth state
  const { isAuthenticated, isLoading: authLoading, user: authUser, isManager: authIsManager, isHRAdmin: authIsHRAdmin } = useAuth();

  // SWR hooks - these will use the token from localStorage (set by AuthContext before redirect)
  const { dashboard, isLoading: dashboardLoading, isError } = useDashboardData();
  const {
    user: contextUser,
    role,
    roleDisplay,
    isManager: contextIsManager,
    isHRAdmin: contextIsHRAdmin,
    organization,
    primaryTeam,
    managerData,
    stats,
    isLoading: contextLoading
  } = useUserContext();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // Use auth context values with fallback to user context
  const user = authUser || contextUser;
  const isManager = authIsManager || contextIsManager;
  const isHRAdmin = authIsHRAdmin || contextIsHRAdmin;

  // Show loading while auth is being determined OR while fetching data
  const isLoading = authLoading || dashboardLoading || contextLoading;

  // Loading state with skeleton
  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Box sx={{ mb: 4 }}>
          <Skeleton variant="text" width={350} height={48} sx={{ borderRadius: 1 }} />
          <Skeleton variant="text" width={250} height={28} sx={{ borderRadius: 1 }} />
        </Box>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3, 4].map(i => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
              <Skeleton
                variant="rectangular"
                height={160}
                sx={{ borderRadius: 3 }}
              />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 3 }} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 3 }} />
          </Grid>
        </Grid>
      </Box>
    );
  }

  // Error state
  if (isError) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Unable to load dashboard data. Some features may be limited.
      </Alert>
    );
  }

  // Use real data only - no fallback mock data
  const data = dashboard || {
    okrProgress: 0,
    pendingReviews: 0,
    recentFeedback: 0,
    totalOkrs: 0,
    completedOkrs: 0,
    upcomingDeadlines: 0
  };

  const userName = user?.name || 'User';

  // Stat card configurations
  const statCards = [
    {
      title: 'OKR Progress',
      value: `${data.okrProgress}%`,
      subtitle: `${data.completedOkrs} of ${data.totalOkrs} objectives`,
      icon: <TrendingUp />,
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
      shadow: '0 10px 40px -10px rgba(99, 102, 241, 0.5)',
      showProgress: true,
      progressValue: data.okrProgress,
    },
    {
      title: 'Pending Reviews',
      value: data.pendingReviews,
      icon: <Assignment />,
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
      shadow: '0 10px 40px -10px rgba(245, 158, 11, 0.5)',
      link: '/reviews',
      linkText: data.pendingReviews > 0 ? 'Complete Reviews' : 'No Reviews',
      disabled: data.pendingReviews === 0,
    },
    {
      title: 'Feedback Received',
      value: data.recentFeedback,
      icon: <FeedbackIcon />,
      gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
      shadow: '0 10px 40px -10px rgba(16, 185, 129, 0.5)',
      link: '/feedback',
      linkText: 'View Feedback',
    },
    {
      title: 'Upcoming Deadlines',
      value: data.upcomingDeadlines,
      subtitle: 'Items due this week',
      icon: <Warning />,
      gradient: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
      shadow: '0 10px 40px -10px rgba(239, 68, 68, 0.5)',
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
          Welcome back, {userName}! 👋
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body1" color="text.secondary">
            {roleDisplay}
          </Typography>
          {primaryTeam && (
            <>
              <Typography variant="body1" color="text.secondary">•</Typography>
              <Typography variant="body1" color="text.secondary">
                {primaryTeam.name}
              </Typography>
            </>
          )}
          {organization && (
            <>
              <Typography variant="body1" color="text.secondary">•</Typography>
              <Typography variant="body1" color="text.secondary">
                {organization.name}
              </Typography>
            </>
          )}
        </Box>
      </Box>

      {/* Manager Alert Banner */}
      {isManager && managerData && (managerData.pendingReviews > 0 || managerData.directReportOkrsBehind > 0) && (
        <Alert
          severity="warning"
          sx={{
            mb: 3,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
            '& .MuiAlert-icon': {
              color: 'warning.main',
            },
          }}
          icon={<SupervisorAccount />}
          action={
            <Button
              color="inherit"
              size="small"
              component={Link}
              href="/team/reviews"
              endIcon={<ArrowForward />}
              sx={{ fontWeight: 600 }}
            >
              View Team
            </Button>
          }
        >
          <Typography variant="body2">
            <strong>Manager Action Required:</strong>{' '}
            {managerData.pendingReviews > 0 && `${managerData.pendingReviews} review${managerData.pendingReviews > 1 ? 's' : ''} awaiting your feedback`}
            {managerData.pendingReviews > 0 && managerData.directReportOkrsBehind > 0 && ' • '}
            {managerData.directReportOkrsBehind > 0 && `${managerData.directReportOkrsBehind} team OKR${managerData.directReportOkrsBehind > 1 ? 's' : ''} behind schedule`}
          </Typography>
        </Alert>
      )}

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {statCards.map((card, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card
              sx={{
                height: '100%',
                background: card.gradient,
                color: 'white',
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: card.shadow,
                '&:hover': {
                  transform: 'translateY(-6px)',
                  boxShadow: card.shadow.replace('0.5)', '0.7)'),
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%)',
                  pointerEvents: 'none',
                },
              }}
            >
              <CardContent sx={{ position: 'relative', zIndex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography
                      variant="overline"
                      sx={{
                        opacity: 0.9,
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                      }}
                    >
                      {card.title}
                    </Typography>
                    <Typography
                      variant="h3"
                      fontWeight={800}
                      sx={{ mt: 0.5 }}
                    >
                      {card.value}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      bgcolor: 'rgba(255,255,255,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    {card.icon}
                  </Box>
                </Box>

                {card.showProgress && (
                  <Box sx={{ mt: 2 }}>
                    <LinearProgress
                      variant="determinate"
                      value={card.progressValue}
                      sx={{
                        bgcolor: 'rgba(255,255,255,0.3)',
                        height: 6,
                        borderRadius: 3,
                        '& .MuiLinearProgress-bar': {
                          bgcolor: 'white',
                          borderRadius: 3,
                        }
                      }}
                    />
                    <Typography variant="caption" sx={{ opacity: 0.9, mt: 1, display: 'block' }}>
                      {card.subtitle}
                    </Typography>
                  </Box>
                )}

                {card.link && (
                  <Button
                    component={Link}
                    href={card.link}
                    size="small"
                    disabled={card.disabled}
                    sx={{
                      mt: 2,
                      color: 'white',
                      bgcolor: 'rgba(255,255,255,0.2)',
                      backdropFilter: 'blur(10px)',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.3)',
                      },
                      '&.Mui-disabled': {
                        color: 'rgba(255,255,255,0.5)',
                      },
                    }}
                  >
                    {card.linkText}
                  </Button>
                )}

                {card.subtitle && !card.showProgress && (
                  <Typography variant="caption" sx={{ opacity: 0.9, mt: 2, display: 'block' }}>
                    {card.subtitle}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Manager Section */}
      {isManager && managerData && (
        <Box sx={{ mb: 4 }}>
          <Typography
            variant="h6"
            fontWeight={700}
            gutterBottom
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <Groups sx={{ color: 'secondary.main' }} />
            Team Overview
          </Typography>
          <Grid container spacing={3}>
            {[
              { label: 'Direct Reports', value: managerData.directReportCount, color: 'primary' },
              { label: 'Pending Reviews', value: managerData.pendingReviews, color: 'warning' },
              { label: 'OKRs At Risk', value: managerData.directReportOkrsBehind, color: 'error' },
              { label: 'Teams Managed', value: managerData.managedTeams?.length || 0, color: 'info' },
            ].map((stat, index) => (
              <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}>
                <Card
                  sx={{
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: theme.shadows[8],
                    },
                  }}
                >
                  <CardContent>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {stat.label}
                    </Typography>
                    <Typography
                      variant="h4"
                      fontWeight={700}
                      color={stat.value > 0 ? `${stat.color}.main` : 'text.primary'}
                    >
                      {stat.value}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Quick Actions & AI Features */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card
            sx={{
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: gradients.primary,
              },
            }}
          >
            <CardContent sx={{ pt: 3 }}>
              <Typography
                variant="h6"
                fontWeight={700}
                gutterBottom
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Rocket sx={{ color: 'primary.main' }} />
                Quick Actions
              </Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                {[
                  { href: '/okrs', icon: <Assessment />, label: 'Create New OKR', color: 'primary' },
                  { href: '/feedback', icon: <FeedbackIcon />, label: 'Give Feedback', color: 'success' },
                  ...(isManager ? [
                    { href: '/team/okrs', icon: <Groups />, label: 'View Team OKRs', color: 'secondary' },
                    { href: '/team/reviews', icon: <SupervisorAccount />, label: 'Conduct Reviews', color: 'secondary' },
                  ] : []),
                ].map((action, index) => (
                  <Grid key={index} size={{ xs: 12, sm: 6 }}>
                    <Button
                      component={Link}
                      href={action.href}
                      variant="outlined"
                      fullWidth
                      startIcon={action.icon}
                      color={action.color as any}
                      sx={{
                        justifyContent: 'flex-start',
                        py: 1.5,
                        px: 2.5,
                        borderRadius: 2,
                        borderWidth: 1.5,
                        fontWeight: 600,
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          borderWidth: 1.5,
                          transform: 'translateX(4px)',
                        },
                      }}
                    >
                      {action.label}
                    </Button>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              height: '100%',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.05) 100%)',
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <CardContent>
              <Typography
                variant="h6"
                fontWeight={700}
                gutterBottom
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <AutoAwesome sx={{ color: 'secondary.main' }} />
                AI Features
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Leverage AI to enhance your performance management
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[
                  'AI OKR Suggestions',
                  'Review Writing Assistant',
                  'Feedback Summarizer',
                  'Sentiment Analysis',
                ].map((feature, index) => (
                  <Button
                    key={index}
                    size="small"
                    variant="text"
                    sx={{
                      justifyContent: 'flex-start',
                      color: 'text.primary',
                      fontWeight: 500,
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        color: 'primary.main',
                      },
                    }}
                    startIcon={
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: gradients.primary,
                        }}
                      />
                    }
                  >
                    {feature}
                  </Button>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Empty State */}
      {data.totalOkrs === 0 && data.pendingReviews === 0 && data.recentFeedback === 0 && (
        <Alert
          severity="info"
          sx={{
            mt: 4,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
          }}
          icon={<EmojiEvents />}
        >
          <Typography variant="body2">
            <strong>Getting Started:</strong> Your performance dashboard will populate with data as you create OKRs,
            participate in reviews, and receive feedback. Start by creating your first OKR!
          </Typography>
        </Alert>
      )}
    </Box>
  );
}


