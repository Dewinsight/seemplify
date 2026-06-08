'use client';

import React from 'react';
import { ActivityFeed } from '@/components/activity-feed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, TrendingUp, Calendar, Briefcase } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ActivityTabProps {
  analytics: any;
}

const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6'];

export default function ActivityTab({ analytics }: ActivityTabProps) {
  // ✅ REAL: 7-Day Activity Trend from actual recentActivity timestamps
  const activityTrends = React.useMemo(() => {
    const activities = analytics?.recentActivity || [];
    
    // Create last 7 days structure
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return {
        day: date.toLocaleDateString('en', { weekday: 'short' }),
        date: date.toISOString().split('T')[0],
        jobs: 0,
        candidates: 0,
        interviews: 0,
      };
    });

    // Count real activities by day and type
    activities.forEach((activity: any) => {
      try {
        const activityDate = new Date(activity.timestamp).toISOString().split('T')[0];
        const dayData = last7Days.find(d => d.date === activityDate);
        if (dayData) {
          if (activity.type === 'job') dayData.jobs++;
          else if (activity.type === 'candidate') dayData.candidates++;
          else if (activity.type === 'interview') dayData.interviews++;
        }
      } catch (err) {
        // Skip invalid timestamps
      }
    });

    return last7Days;
  }, [analytics?.recentActivity]);

  // ✅ REAL: Department activity from topPerformingJobs
  const departmentActivity = React.useMemo(() => {
    const jobs = analytics?.topPerformingJobs || [];
    const deptMap = new Map<string, number>();
    
    jobs.forEach((job: any) => {
      const dept = (typeof job.department === 'object' ? job.department?.name : job.department) || 'Unknown';
      const current = deptMap.get(dept) || 0;
      deptMap.set(dept, current + (job.applicantCount || 0));
    });
    
    return Array.from(deptMap.entries())
      .map(([name, value], index) => ({
        name,
        value,
        color: COLORS[index % COLORS.length]
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [analytics?.topPerformingJobs]);

  // ✅ REAL: This week's summary from recentActivity
  const weekSummary = React.useMemo(() => {
    const activities = analytics?.recentActivity || [];
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const thisWeek = activities.filter((a: any) => {
      try {
        return new Date(a.timestamp) > oneWeekAgo;
      } catch {
        return false;
      }
    });
    
    return {
      totalActivities: thisWeek.length,
      newCandidates: thisWeek.filter((a: any) => a.type === 'candidate').length,
      interviewsScheduled: thisWeek.filter((a: any) => a.type === 'interview').length,
      jobsPosted: thisWeek.filter((a: any) => a.type === 'job').length,
    };
  }, [analytics?.recentActivity]);

  // Check if we have any real data
  const hasActivityData = (analytics?.recentActivity || []).length > 0;
  const hasDepartmentData = departmentActivity.length > 0;

  return (
    <div className="space-y-6">
      {/* Activity Feed and Trends Side by Side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity Feed - ALREADY REAL! ✅ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed />
          </CardContent>
        </Card>

        {/* 7-Day Activity Trend - NOW REAL! ✅ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              7-Day Activity Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasActivityData ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityTrends}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" className="text-xs" />
                    <YAxis className="text-xs" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="candidates" 
                      stroke="#6366f1" 
                      strokeWidth={2}
                      name="Candidates Added"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="jobs" 
                      stroke="#14b8a6" 
                      strokeWidth={2}
                      name="Jobs Posted"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="interviews" 
                      stroke="#f59e0b" 
                      strokeWidth={2}
                      name="Interviews Scheduled"
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>No activity data available for the last 7 days</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Department Activity - NOW REAL! ✅ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Activity by Department
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasDepartmentData ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentActivity} layout="horizontal">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value) => [value, 'Applications']}
                    />
                    <Bar 
                      dataKey="value" 
                      radius={[4, 4, 0, 0]}
                    >
                      {departmentActivity.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <p>No department data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Summary - NOW REAL! ✅ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Recent Activity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10">
                <div>
                  <p className="text-sm text-muted-foreground">Jobs Posted</p>
                  <p className="text-2xl font-bold text-primary">{weekSummary.jobsPosted}</p>
                </div>
                <Briefcase className="h-8 w-8 text-primary" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-success/10">
                <div>
                  <p className="text-sm text-muted-foreground">Candidates Added</p>
                  <p className="text-2xl font-bold text-success">{weekSummary.newCandidates}</p>
                </div>
                <MessageSquare className="h-8 w-8 text-success" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-warning/10">
                <div>
                  <p className="text-sm text-muted-foreground">Interviews Scheduled</p>
                  <p className="text-2xl font-bold text-warning">{weekSummary.interviewsScheduled}</p>
                </div>
                <Calendar className="h-8 w-8 text-warning" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-info/10">
                <div>
                  <p className="text-sm text-muted-foreground">Total Activities</p>
                  <p className="text-2xl font-bold text-info">{weekSummary.totalActivities}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-info" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* This Week's Summary Stats - NOW REAL! ✅ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">This Week's Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-primary">{weekSummary.totalActivities}</p>
              <p className="text-sm text-muted-foreground">Total Activities</p>
              <p className="text-xs text-muted-foreground mt-1">Last 7 days</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-green-600">{weekSummary.newCandidates}</p>
              <p className="text-sm text-muted-foreground">New Candidates</p>
              <p className="text-xs text-muted-foreground mt-1">Added this week</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-blue-600">{weekSummary.interviewsScheduled}</p>
              <p className="text-sm text-muted-foreground">Interviews Scheduled</p>
              <p className="text-xs text-muted-foreground mt-1">This week</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-3xl font-bold text-amber-600">{weekSummary.jobsPosted}</p>
              <p className="text-sm text-muted-foreground">Jobs Posted</p>
              <p className="text-xs text-muted-foreground mt-1">New positions</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
