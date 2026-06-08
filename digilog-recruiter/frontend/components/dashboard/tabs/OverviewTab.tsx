'use client';

import React from 'react';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { AreaChartEnhanced } from '@/components/charts/area-chart-enhanced';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Briefcase, TrendingUp } from 'lucide-react';

interface OverviewTabProps {
  analytics: any;
}

export default function OverviewTab({ analytics }: OverviewTabProps) {
  // Transform funnel data
  const funnelData = React.useMemo(() => {
    const statusData = analytics?.distributions?.candidatesByStatus || [];
    const statusMapping: Record<string, { label: string; color: string; order: number }> = {
      'New': { label: 'Applications', color: '#6366f1', order: 1 },
      'Applied': { label: 'Applications', color: '#6366f1', order: 1 },
      'Screening': { label: 'Screening', color: '#f59e0b', order: 2 },
      'Interview': { label: 'Interviews', color: '#6b7280', order: 3 },
      'Offer': { label: 'Offers', color: '#6366f1', order: 4 },
      'Hired': { label: 'Hired', color: '#14b8a6', order: 5 }
    };
    
    const funnelMap: Record<string, { label: string; color: string; order: number; value: number }> = {};
    statusData.forEach((item: { name: string; value: number }) => {
      const mapping = statusMapping[item.name];
      if (mapping) {
        if (!funnelMap[mapping.label]) {
          funnelMap[mapping.label] = { ...mapping, value: 0 };
        }
        funnelMap[mapping.label].value += item.value;
      }
    });
    
    return Object.values(funnelMap).sort((a, b) => a.order - b.order);
  }, [analytics?.distributions?.candidatesByStatus]);

  // Timeline data
  const timelineData = React.useMemo(() => {
    const candidateTimeline = analytics?.timeline?.candidates || [];
    const jobTimeline = analytics?.timeline?.jobs || [];
    
    const dataMap = new Map();
    
    candidateTimeline.forEach((item: any) => {
      const date = new Date(item.date);
      const monthName = date.toLocaleDateString('en', { month: 'short' });
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      
      if (!dataMap.has(key)) {
        dataMap.set(key, { name: monthName, candidates: 0, jobs: 0 });
      }
      dataMap.get(key).candidates += item.count;
    });
    
    jobTimeline.forEach((item: any) => {
      const date = new Date(item.date);
      const monthName = date.toLocaleDateString('en', { month: 'short' });
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      
      if (!dataMap.has(key)) {
        dataMap.set(key, { name: monthName, candidates: 0, jobs: 0 });
      }
      dataMap.get(key).jobs += item.count;
    });
    
    return Array.from(dataMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, data]) => data)
      .slice(-6); // Show last 6 months
  }, [analytics?.timeline]);

  const topJobs = analytics?.topPerformingJobs?.slice(0, 3) || [];

  return (
    <div className="space-y-6">
      {/* Main Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Simplified Pipeline Funnel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Recruitment Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart
              data={funnelData}
              title=""
              subtitle=""
              showPercentages={true}
            />
          </CardContent>
        </Card>

        {/* Timeline Chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Growth Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChartEnhanced
              data={timelineData}
              series={[
                { dataKey: 'candidates', name: 'Candidates', color: '#6366f1' },
                { dataKey: 'jobs', name: 'Jobs', color: '#14b8a6' }
              ]}
              title=""
              subtitle=""
              height={300}
              showLegend={true}
            />
          </CardContent>
        </Card>
      </div>

      {/* Top Performing Jobs - Simplified */}
      {topJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                Top Performing Jobs
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                Top 3
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topJobs.map((job: any, index: number) => (
                <div
                  key={job._id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{job.title}</p>
                      <p className="text-xs text-muted-foreground">{typeof job.department === 'object' ? job.department?.name : job.department}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{job.applicantCount}</p>
                    <p className="text-xs text-muted-foreground">applications</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
