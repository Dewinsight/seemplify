'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useDashboardState } from '@/app/dashboard/hooks/useDashboardState';

interface EnhancedMetricCardProps {
  id: string;
  title: string;
  value: number;
  formatValue?: (value: number) => string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down';
    label: string;
  };
  description?: string;
  chartData?: Array<{ date: string; value: number }>;
  variant?: 'default' | 'primary' | 'success' | 'warning';
  onClick?: () => void;
}

const variantStyles = {
  default: 'text-muted-foreground',
  primary: 'text-indigo-600 dark:text-indigo-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

export const EnhancedMetricCard = React.memo(function EnhancedMetricCard({
  id,
  title,
  value,
  formatValue,
  icon,
  trend,
  description,
  chartData,
  variant = 'default',
  onClick,
}: EnhancedMetricCardProps) {
  const { viewMode, showTrends, setFocusedMetric } = useDashboardState();

  const displayValue = React.useMemo(
    () => (formatValue ? formatValue(value) : value.toLocaleString()),
    [value, formatValue]
  );

  const handleClick = React.useCallback(() => {
    setFocusedMetric(id);
    onClick?.();
  }, [id, setFocusedMetric, onClick]);

  const miniChart = chartData && chartData.length > 0 && (
    <span
      className="recruiter-metric-chart block h-12 w-full text-primary"
      aria-hidden="true"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData.slice(-7)}
          margin={{ top: 4, right: 1, bottom: 2, left: 1 }}
        >
          <Line
            type="monotone"
            dataKey="value"
            stroke="currentColor"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );

  return (
    <div
      className={cn(
        'recruiter-metric relative flex h-full min-h-[116px] w-full flex-col justify-between gap-4',
        'rounded-lg border border-border bg-card px-5 py-4',
        'transition-colors duration-150 hover:bg-muted/35'
      )}
      data-metric-id={id}
      data-metric-variant={variant}
      data-view-mode={viewMode}
    >
      <button
        type="button"
        onClick={handleClick}
        className="recruiter-metric-action absolute inset-0 z-10 cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Open ${title} details. Current value ${displayValue}.`}
      />

      <span className="recruiter-metric-header pointer-events-none flex w-full items-start justify-between gap-3">
        <span className="recruiter-metric-copy min-w-0">
          <span className="recruiter-metric-title block text-sm font-medium text-muted-foreground">
            {title}
          </span>
          <span className="recruiter-metric-value mt-1 block text-2xl font-semibold tracking-tight text-foreground">
            {displayValue}
          </span>
        </span>
        <span
          className={cn(
            'recruiter-metric-icon mt-0.5 shrink-0',
            variantStyles[variant]
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      </span>

      <span className="recruiter-metric-detail pointer-events-none block w-full">
        {viewMode === 'detailed' && description && (
          <span className="recruiter-metric-description mb-3 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        )}

        {viewMode === 'detailed' && miniChart}

        {showTrends && trend && (
          <span
            className="recruiter-metric-trend mt-2 flex items-center gap-1 text-xs font-medium text-foreground"
            title={trend.label}
          >
            {trend.direction === 'up' ? (
              <ArrowUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
            )}
            <span>{Math.abs(trend.value)}%</span>
            {viewMode === 'detailed' && (
              <span className="font-normal text-muted-foreground">{trend.label}</span>
            )}
          </span>
        )}
      </span>
    </div>
  );
});
