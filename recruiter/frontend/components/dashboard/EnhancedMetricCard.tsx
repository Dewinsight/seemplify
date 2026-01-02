'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ProgressiveCard } from '@/components/ui/progressive-disclosure';
import { 
  LineChart, 
  Line, 
  ResponsiveContainer,
  Tooltip
} from 'recharts';
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
  default: {
    icon: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400',
    border: 'hover:border-zinc-300 dark:hover:border-zinc-600',
    card: 'dark:bg-zinc-900/40 dark:border-zinc-800/50',
  },
  primary: {
    icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
    border: 'hover:border-indigo-400 dark:hover:border-indigo-500',
    card: 'dark:bg-indigo-950/20 dark:border-indigo-900/30',
  },
  success: {
    icon: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
    border: 'hover:border-teal-400 dark:hover:border-teal-500',
    card: 'dark:bg-teal-950/20 dark:border-teal-900/30',
  },
  warning: {
    icon: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    border: 'hover:border-amber-400 dark:hover:border-amber-500',
    card: 'dark:bg-amber-950/20 dark:border-amber-900/30',
  },
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
  const [isHovered, setIsHovered] = React.useState(false);

  const displayValue = React.useMemo(
    () => formatValue ? formatValue(value) : value.toLocaleString(),
    [value, formatValue]
  );
  const styles = variantStyles[variant];

  // Mini chart for preview
  const miniChart = chartData && chartData.length > 0 && (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData.slice(-7)} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="currentColor"
            strokeWidth={2}
            dot={false}
            className="text-primary"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
            formatter={(value: number) => [formatValue ? formatValue(value) : value.toLocaleString(), '']}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const handleClick = React.useCallback(() => {
    setFocusedMetric(id);
    onClick?.();
  }, [id, setFocusedMetric, onClick]);

  if (viewMode === 'simple') {
    // Simplified view for reduced clutter
    return (
      <motion.div
        className={cn(
          'relative rounded-xl border p-6 transition-all cursor-pointer',
          'bg-card dark:glass-card',
          'hover:shadow-lg dark:hover:shadow-xl dark:hover:shadow-black/20',
          styles.border,
          styles.card
        )}
        whileHover={{ y: -2 }}
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        onClick={handleClick}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{displayValue}</p>
            {showTrends && trend && (
              <div className="flex items-center gap-1 text-sm">
                <span
                  className={cn(
                    'font-medium',
                    trend.direction === 'up' ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.value)}%
                </span>
              </div>
            )}
          </div>
          <div className={cn('rounded-lg p-3', styles.icon)}>
            {icon}
          </div>
        </div>

        {/* Hover preview */}
        <motion.div
          initial={false}
          animate={{ opacity: isHovered ? 1 : 0, height: isHovered ? 'auto' : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          {isHovered && chartData && (
            <div className="mt-4 pt-4 border-t">
              {miniChart}
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Last 7 days • Click for details
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    );
  }

  // Detailed view with all information
  return (
    <ProgressiveCard
      title={title}
      value={displayValue}
      icon={icon}
      trend={trend}
      preview={
        <div className="space-y-3">
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          {miniChart}
        </div>
      }
      detail={<div>Full details would go here</div>}
      onDetailClick={handleClick}
      className={styles.border}
    />
  );
});
