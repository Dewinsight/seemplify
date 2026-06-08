'use client';

import React from 'react';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Briefcase, FileText, TrendingUp } from 'lucide-react';

interface PipelineTabProps {
  analytics: any;
}

export default function PipelineTab({ analytics }: PipelineTabProps) {
  // Detailed funnel data with all stages
  const detailedFunnelData = React.useMemo(() => {
    const statusData = analytics?.distributions?.candidatesByStatus || [];
    const statusMapping: Record<string, { label: string; color: string; order: number }> = {
      'New': { label: 'New Applications', color: '#6366f1', order: 1 },
      'Applied': { label: 'Applied', color: '#6366f1', order: 2 },
      'Screening': { label: 'Screening', color: '#f59e0b', order: 3 },
      'Reviewing': { label: 'Under Review', color: '#ec4899', order: 4 },
      'Interview': { label: 'Interview Stage', color: '#6b7280', order: 5 },
      'Technical Test': { label: 'Technical Assessment', color: '#8b5cf6', order: 6 },
      'Offer': { label: 'Offer Extended', color: '#3b82f6', order: 7 },
      'Hired': { label: 'Hired', color: '#14b8a6', order: 8 },
      'Rejected': { label: 'Not Selected', color: '#ef4444', order: 9 },
      'Withdrawn': { label: 'Withdrawn', color: '#9ca3af', order: 10 }
    };
    
    return statusData
      .map((item: { name: string; value: number }) => {
        const mapping = statusMapping[item.name];
        if (mapping) {
          return {
            ...mapping,
            value: item.value,
            name: mapping.label
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.order - b.order);
  }, [analytics?.distributions?.candidatesByStatus]);

  // Source distribution data
  const sourceData = React.useMemo(() => {
    const sources = analytics?.distributions?.candidatesBySource || [];
    const colors = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6'];
    return sources.map((source: any, index: number) => ({
      name: source.name || 'Unknown',
      value: source.value || 0,
      color: colors[index % colors.length]
    }));
  }, [analytics?.distributions?.candidatesBySource]);

  // Calculate REAL pipeline metrics
  const pipelineMetrics = React.useMemo(() => {
    const totalCandidates = analytics?.overview?.totalCandidates?.value || 0;
    const totalJobs = analytics?.overview?.totalJobs?.value || 0;
    const activeJobs = analytics?.overview?.activeJobs?.value || 0;
    const statusData = analytics?.distributions?.candidatesByStatus || [];
    
    // Count active candidates (not rejected/withdrawn)
    const activeCandidates = statusData
      .filter((s: any) => !['Rejected', 'Withdrawn'].includes(s.name))
      .reduce((sum: number, s: any) => sum + s.value, 0);
    
    const inScreening = statusData.find((s: any) => s.name === 'Screening')?.value || 0;
    const inInterview = statusData.find((s: any) => s.name === 'Interview')?.value || 0;
    
    return {
      totalCandidates,
      activeCandidates,
      inScreening,
      inInterview,
      activeJobs,
    };
  }, [analytics]);

  return (
    <div className="space-y-6">
      {/* Real Pipeline Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Candidates</p>
                <p className="text-2xl font-bold">{pipelineMetrics.totalCandidates}</p>
              </div>
              <Users className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Pipeline</p>
                <p className="text-2xl font-bold">{pipelineMetrics.activeCandidates}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Screening</p>
                <p className="text-2xl font-bold">{pipelineMetrics.inScreening}</p>
              </div>
              <FileText className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Interview</p>
                <p className="text-2xl font-bold">{pipelineMetrics.inInterview}</p>
              </div>
              <Briefcase className="h-8 w-8 text-info" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Analytics */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Detailed Funnel - Takes 2 columns */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium">Detailed Pipeline Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart
              data={detailedFunnelData}
              title=""
              subtitle=""
              showPercentages={true}
              height={400}
            />
          </CardContent>
        </Card>

        {/* Source Distribution */}
        <DonutChart
          data={sourceData}
          title="Candidate Sources"
          subtitle=""
          showLegend={true}
          showCenter={true}
          centerValue={analytics?.overview?.totalCandidates?.value?.toString() || "0"}
          centerLabel="Total"
          size={280}
        />
      </div>

      {/* Status Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {detailedFunnelData.map((stage: any) => (
              <div key={stage.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="font-medium">{stage.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-2xl font-bold">{stage.value}</span>
                  <span className="text-sm text-muted-foreground w-16 text-right">
                    {pipelineMetrics.totalCandidates > 0 
                      ? `${Math.round((stage.value / pipelineMetrics.totalCandidates) * 100)}%`
                      : '0%'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
