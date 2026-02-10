'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProgressiveDisclosure } from '@/components/ui/progressive-disclosure';
import { useDashboardState } from '@/app/dashboard/hooks/useDashboardState';
import { BarChart2, TrendingUp, Activity, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Lazy load tab components for performance
const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'));
const PipelineTab = React.lazy(() => import('./tabs/PipelineTab'));
const PerformanceTab = React.lazy(() => import('./tabs/PerformanceTab'));
const ActivityTab = React.lazy(() => import('./tabs/ActivityTab'));

interface AnalyticsTabsProps {
  analytics: any;
  className?: string;
}

const tabConfig = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <BarChart2 className="h-4 w-4" />,
    description: 'Key metrics and trends',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: <TrendingUp className="h-4 w-4" />,
    description: 'Candidate flow analysis',
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: <Activity className="h-4 w-4" />,
    description: 'Hiring metrics',
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: <Clock className="h-4 w-4" />,
    description: 'Recent updates',
  },
];

export const AnalyticsTabs = React.memo(function AnalyticsTabs({ analytics, className }: AnalyticsTabsProps) {
  const { activeTab, setActiveTab, sections, toggleSectionExpanded, viewMode } = useDashboardState();
  const analyticsSection = sections.analytics;

  if (viewMode === 'simple' && !analyticsSection?.expanded) {
    // Show condensed view when collapsed in simple mode
    return (
      <ProgressiveDisclosure
        title="Analytics & Insights"
        subtitle="Detailed recruitment analytics"
        icon={<BarChart2 className="h-5 w-5" />}
        defaultExpanded={false}
        className={className}
        onToggle={(expanded) => toggleSectionExpanded('analytics')}
      >
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Click to expand and view detailed analytics across {tabConfig.length} categories
          </p>
        </div>
      </ProgressiveDisclosure>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Analytics & Insights</h2>
          <p className="text-sm text-muted-foreground">
            Comprehensive recruitment analytics and performance metrics
          </p>
        </div>
        {viewMode === 'simple' && (
          <button
            onClick={() => toggleSectionExpanded('analytics')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Collapse
          </button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as any)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-4 h-auto p-1">
          {tabConfig.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex flex-col gap-1 py-3 data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border/50 transition-all duration-200"
            >
              <div className="flex items-center gap-2">
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">
                {tab.description}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <React.Suspense
            fallback={
              <div className="flex items-center justify-center h-96">
                <div className="animate-pulse text-muted-foreground">
                  Loading analytics...
                </div>
              </div>
            }
          >
            <TabsContent value="overview" className="mt-0">
              <OverviewTab analytics={analytics} />
            </TabsContent>

            <TabsContent value="pipeline" className="mt-0">
              <PipelineTab analytics={analytics} />
            </TabsContent>

            <TabsContent value="performance" className="mt-0">
              <PerformanceTab analytics={analytics} />
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <ActivityTab analytics={analytics} />
            </TabsContent>
          </React.Suspense>
        </div>
      </Tabs>
    </div>
  );
});
