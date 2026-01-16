'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ProgressiveDisclosureProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  loading?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: React.ReactNode;
  onToggle?: (expanded: boolean) => void;
  collapsible?: boolean;
  badge?: React.ReactNode;
}

export function ProgressiveDisclosure({
  title,
  subtitle,
  icon,
  defaultExpanded = false,
  loading = false,
  className,
  headerClassName,
  contentClassName,
  children,
  onToggle,
  collapsible = true,
  badge,
}: ProgressiveDisclosureProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  const handleToggle = () => {
    if (!collapsible) return;
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onToggle?.(newExpanded);
  };

  return (
    <div className={cn('rounded-lg border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between p-4 transition-colors',
          collapsible && 'cursor-pointer hover:bg-muted/50',
          headerClassName
        )}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 flex-1">
          {collapsible && (
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </motion.div>
          )}

          {icon && (
            <div className="text-muted-foreground">{icon}</div>
          )}

          <div className="flex-1">
            <h3 className="font-semibold text-sm">{title}</h3>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>

          {badge}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <div className={cn('border-t', contentClassName)}>
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                children
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ProgressiveCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
  preview?: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
  iconClassName?: string;
  onDetailClick?: () => void;
}

export function ProgressiveCard({
  title,
  value,
  icon,
  trend,
  preview,
  detail,
  className,
  iconClassName,
  onDetailClick,
}: ProgressiveCardProps) {
  const [showPreview, setShowPreview] = React.useState(false);

  return (
    <motion.div
      className={cn(
        'relative rounded-lg border bg-card p-6 transition-all',
        'hover:shadow-md hover:border-primary/20',
        className
      )}
      onHoverStart={() => setShowPreview(true)}
      onHoverEnd={() => setShowPreview(false)}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      {/* Main Content */}
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          {icon && (
            <div className={cn("rounded-lg bg-primary/10 p-2 text-primary", iconClassName)}>
              {icon}
            </div>
          )}
        </div>

        {/* Trend */}
        {trend && (
          <div className="flex items-center gap-1 text-sm">
            <span
              className={cn(
                'font-medium',
                trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
              )}
            >
              {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
            <span className="text-muted-foreground">vs last period</span>
          </div>
        )}
      </div>

      {/* Preview on Hover */}
      <AnimatePresence>
        {showPreview && preview && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 top-full mt-2 z-10"
          >
            <div className="rounded-lg border bg-popover p-4 shadow-lg">
              {preview}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail Button */}
      {detail && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full"
          onClick={onDetailClick}
        >
          View Details
        </Button>
      )}
    </motion.div>
  );
}
