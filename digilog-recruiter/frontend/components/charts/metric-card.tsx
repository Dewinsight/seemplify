'use client'

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: string | number
  change?: {
    value: number
    period: string
    type: 'increase' | 'decrease' | 'neutral'
  }
  icon?: React.ReactNode
  description?: string
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const variantStyles = {
  default: 'border-gray-300 bg-white dark:bg-slate-900 shadow-md hover:shadow-lg dark:border-slate-600',
  success: 'border-green-300 dark:border-green-700 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-950/20 dark:to-emerald-950/20 shadow-md hover:shadow-lg',
  warning: 'border-yellow-300 dark:border-yellow-700 bg-gradient-to-br from-yellow-100 to-amber-100 dark:from-yellow-950/20 dark:to-amber-950/20 shadow-md hover:shadow-lg',
  danger: 'border-red-300 dark:border-red-700 bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-950/20 dark:to-rose-950/20 shadow-md hover:shadow-lg',
  info: 'border-blue-300 bg-gradient-to-br from-blue-100 to-indigo-100 dark:border-blue-700 dark:from-blue-950/20 dark:to-indigo-950/20 shadow-md hover:shadow-lg',
}

const sizeStyles = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8'
}

const iconStyles = {
  default: 'text-gray-600 dark:text-gray-400',
  success: 'text-green-600 dark:text-green-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  danger: 'text-red-600 dark:text-red-400',
  info: 'text-blue-600 dark:text-blue-400',
}

export function MetricCard({
  title,
  value,
  change,
  icon,
  description,
  variant = 'default',
  size = 'md',
  className
}: MetricCardProps) {
  const formatValue = (val: string | number) => {
    if (typeof val === 'number') {
      return val.toLocaleString()
    }
    return val
  }

  const getTrendIcon = (type: 'increase' | 'decrease' | 'neutral') => {
    switch (type) {
      case 'increase':
        return <TrendingUp className="h-3 w-3" />
      case 'decrease':
        return <TrendingDown className="h-3 w-3" />
      case 'neutral':
        return <Minus className="h-3 w-3" />
    }
  }

  const getTrendColor = (type: 'increase' | 'decrease' | 'neutral') => {
    switch (type) {
      case 'increase':
        return 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/20'
      case 'decrease':
        return 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/20'
      case 'neutral':
        return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-900/20'
    }
  }

  return (
    <Card className={cn(
      'transition-all duration-200 hover:shadow-md hover:scale-[1.02]',
      variantStyles[variant],
      className
    )}>
      <CardContent className={cn('space-y-3', sizeStyles[size])}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          {icon && (
            <div className={cn('h-4 w-4', iconStyles[variant])}>
              {icon}
            </div>
          )}
        </div>

        {/* Value */}
        <div className="space-y-1">
          <div className={cn(
            'font-bold text-foreground',
            size === 'sm' ? 'text-xl' : size === 'md' ? 'text-2xl' : 'text-3xl'
          )}>
            {formatValue(value)}
          </div>
          
          {/* Change indicator */}
          {change && (
            <div className="flex items-center gap-2">
              <Badge 
                variant="secondary" 
                className={cn('text-xs', getTrendColor(change.type))}
              >
                <div className="flex items-center gap-1">
                  {getTrendIcon(change.type)}
                  <span>
                    {change.type === 'increase' ? '+' : change.type === 'decrease' ? '-' : ''}
                    {Math.abs(change.value)}%
                  </span>
                </div>
              </Badge>
              <span className="text-xs text-muted-foreground">
                vs {change.period}
              </span>
            </div>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
