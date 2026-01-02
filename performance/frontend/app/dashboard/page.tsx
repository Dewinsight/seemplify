'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useUserContext, useDashboardData } from '@/lib/hooks';
import Link from 'next/link';
import {
  TrendingUp, Target, MessageSquare, BarChart3, Users, LayoutGrid, Sparkles, Flag, AlertCircle
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';

export default function DashboardPage() {
  const router = useRouter();
  
  // Get auth state
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth();

  // SWR hooks
  const { dashboard, isLoading: dashboardLoading, isError } = useDashboardData();
  const {
    user: contextUser,
    role,
    roleDisplay,
    isManager,
    isHRAdmin,
    organization,
    primaryTeam,
    managerData,
    isLoading: contextLoading
  } = useUserContext();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const user = authUser || contextUser;
  const isLoading = authLoading || dashboardLoading || contextLoading;

  // Loading state
  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
        </div>
      </Layout>
    );
  }

  // Error state
  if (isError) {
    return (
      <Layout>
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="text-sm">Unable to load dashboard data. Some features may be limited.</div>
        </div>
      </Layout>
    );
  }

  const data = dashboard || {
    okrProgress: 0,
    pendingReviews: 0,
    recentFeedback: 0,
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
      title: 'Pending Reviews',
      value: data.pendingReviews,
      subtitle: data.pendingReviews > 0 ? 'Needs your attention' : 'All caught up!',
      icon: BarChart3,
      gradient: 'from-amber-500 to-orange-500',
      href: '/reviews'
    },
    {
      title: 'Recent Feedback',
      value: data.recentFeedback,
      subtitle: 'This month',
      icon: MessageSquare,
      gradient: 'from-emerald-500 to-teal-500',
      href: '/feedback'
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
    { name: 'Give Feedback', href: '/feedback', icon: MessageSquare, color: 'from-green-500 to-emerald-500' },
    { name: 'View Reviews', href: '/reviews', icon: BarChart3, color: 'from-amber-500 to-orange-500' },
    { name: 'Schedule 1:1', href: '/one-on-ones', icon: Users, color: 'from-indigo-500 to-blue-500' },
  ];

  return (
    <Layout>
      <div className="space-y-8">
        {/* Welcome Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-rose-500/20 rounded-2xl blur-3xl"></div>
          <div className="relative bg-gradient-to-br from-zinc-900/80 to-zinc-800/80 backdrop-blur-xl rounded-2xl border border-zinc-700/50 p-8 shadow-2xl shadow-purple-500/10">
            <div className="flex justify-between items-start flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-200 bg-clip-text text-transparent flex items-center gap-2">
                  Welcome back, {userName.split(' ')[0]} 
                  <Sparkles className="h-7 w-7 text-purple-400" />
                </h1>
                <p className="text-zinc-400 mt-2">
                  Here's your performance overview for{' '}
                  <span className="text-zinc-300 font-medium">{organization?.name || 'your organization'}</span>
                </p>
              </div>
              <a
                href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:shadow-purple-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <LayoutGrid className="h-4 w-4" />
                App Hub
              </a>
            </div>
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
              <div className={`bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-purple-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-purple-500/10 relative overflow-hidden`}>
                <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-0 group-hover:opacity-5 transition-opacity`}></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg`}>
                      <stat.icon className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-zinc-100 mb-1">{stat.value}</div>
                    <div className="text-sm font-medium text-zinc-400 mb-1">{stat.title}</div>
                    {stat.subtitle && (
                      <div className="text-xs text-zinc-500">{stat.subtitle}</div>
                    )}
                    {stat.showProgress && (
                      <div className="mt-3 w-full bg-zinc-800/70 rounded-full h-2 overflow-hidden">
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
        <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
          <h2 className="text-lg font-bold text-zinc-100 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <Link
                key={action.name}
                href={action.href}
                className="group flex flex-col items-center p-4 bg-zinc-800/60 rounded-lg border border-zinc-700/50 hover:border-purple-500/30 hover:bg-zinc-800 transition-all duration-200 hover:scale-105"
              >
                <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                  <action.icon className="h-6 w-6 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-200">{action.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Role-specific sections */}
        {isManager && managerData && managerData.directReportCount > 0 && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-400" />
                Team Overview
              </h2>
              <Link
                href="/team"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors font-medium"
              >
                View All →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
                <div className="text-2xl font-bold text-zinc-100">{managerData.directReportCount}</div>
                <div className="text-sm text-zinc-400">Direct Reports</div>
              </div>
              {managerData.pendingReviews > 0 && (
                <div className="p-4 rounded-lg bg-zinc-800/60 border border-amber-500/20">
                  <div className="text-2xl font-bold text-amber-300">{managerData.pendingReviews}</div>
                  <div className="text-sm text-zinc-400">Pending Reviews</div>
                </div>
              )}
            </div>
          </div>
        )}

        {isHRAdmin && (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-red-500/20 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                <Flag className="h-5 w-5 text-red-400" />
                HR Administration
              </h2>
              <Link
                href="/admin/appraisal-cycles"
                className="text-sm text-red-400 hover:text-red-300 transition-colors font-medium"
              >
                Admin Panel →
              </Link>
            </div>
            <p className="text-sm text-zinc-400">
              Manage appraisal cycles, calibration sessions, and organization-wide reports.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
