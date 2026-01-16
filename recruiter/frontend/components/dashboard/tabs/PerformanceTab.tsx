'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Briefcase, TrendingUp, FileText } from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  PieChart,
  Pie,
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';

interface PerformanceTabProps {
  analytics: any;
}

const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6'];

export default function PerformanceTab({ analytics }: PerformanceTabProps) {
  // Calculate REAL metrics from actual data
  const performanceMetrics = React.useMemo(() => {
    const totalCandidates = analytics?.overview?.totalCandidates?.value || 0;
    const totalJobs = analytics?.overview?.totalJobs?.value || 0;
    const activeJobs = analytics?.overview?.activeJobs?.value || 0;
    const statusData = analytics?.distributions?.candidatesByStatus || [];
    
    // Count candidates in active stages (not rejected/withdrawn)
    const activeCandidates = statusData
      .filter((s: any) => !['Rejected', 'Withdrawn'].includes(s.name))
      .reduce((sum: number, s: any) => sum + s.value, 0);
    
    return {
      totalCandidates,
      totalJobs,
      activeJobs,
      activeCandidates,
      candidatesPerJob: totalJobs > 0 ? Math.round(totalCandidates / totalJobs) : 0,
    };
  }, [analytics]);

  // Job status distribution
  const jobStatusData = React.useMemo(() => {
    const jobsByStatus = analytics?.distributions?.jobsByStatus || [];
    return jobsByStatus.map((item: any, index: number) => ({
      name: item.name,
      value: item.value,
      color: COLORS[index % COLORS.length]
    }));
  }, [analytics?.distributions?.jobsByStatus]);

  // Candidate status distribution
  const candidateStatusData = React.useMemo(() => {
    const candidatesByStatus = analytics?.distributions?.candidatesByStatus || [];
    return candidatesByStatus.map((item: any) => ({
      name: item.name,
      value: item.value
    }));
  }, [analytics?.distributions?.candidatesByStatus]);

  // Top skills
  const topSkills = React.useMemo(() => {
    const skills = analytics?.distributions?.topSkills || [];
    return skills.slice(0, 10);
  }, [analytics?.distributions?.topSkills]);

  return (
    <div className="space-y-6">
      {/* Key Performance Metrics */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
              <p className="text-3xl font-bold">{performanceMetrics.totalCandidates}</p>
              <p className="text-sm text-muted-foreground mt-1">Total Candidates</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Briefcase className="h-8 w-8 mx-auto mb-2 text-success" />
              <p className="text-3xl font-bold">{performanceMetrics.totalJobs}</p>
              <p className="text-sm text-muted-foreground mt-1">Total Jobs</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <TrendingUp className="h-8 w-8 mx-auto mb-2 text-warning" />
              <p className="text-3xl font-bold">{performanceMetrics.activeJobs}</p>
              <p className="text-sm text-muted-foreground mt-1">Active Jobs</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <FileText className="h-8 w-8 mx-auto mb-2 text-info" />
              <p className="text-3xl font-bold">{performanceMetrics.candidatesPerJob}</p>
              <p className="text-sm text-muted-foreground mt-1">Avg Candidates/Job</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Job Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Job Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={jobStatusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    style={{ fill: 'hsl(var(--foreground))', fontSize: '12px' }}
                  >
                    {jobStatusData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Candidate Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Candidate Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={candidateStatusData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  />
                  <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Skills */}
      {topSkills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Top Skills in Candidate Pool</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSkills} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="text-xs" />
                  <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  />
                  <Bar dataKey="count" fill="#14b8a6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Pipeline Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Active Candidates</p>
              <p className="text-2xl font-bold">{performanceMetrics.activeCandidates}</p>
              <p className="text-xs text-muted-foreground">Currently in pipeline</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Applications</p>
              <p className="text-2xl font-bold">{performanceMetrics.totalCandidates}</p>
              <p className="text-xs text-muted-foreground">All-time total</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Open Positions</p>
              <p className="text-2xl font-bold">{performanceMetrics.activeJobs}</p>
              <p className="text-xs text-muted-foreground">Currently active</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
