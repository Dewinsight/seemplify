'use client'

import React, { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface ResponsiveContentLayoutProps {
  children: ReactNode
  className?: string
  enablePadding?: boolean
}

interface ResponsiveCardProps {
  title?: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  headerActions?: ReactNode
  variant?: 'default' | 'gradient' | 'glass' | 'bordered'
  size?: 'sm' | 'md' | 'lg'
  mobileFullWidth?: boolean
}

interface ResponsiveTwoColumnProps {
  left: ReactNode
  right: ReactNode
  leftClassName?: string
  rightClassName?: string
  gap?: 'sm' | 'md' | 'lg'
  stackOrder?: 'left-first' | 'right-first'
  enableMobileStack?: boolean
}

interface ResponsiveGridProps {
  children: ReactNode
  cols?: {
    mobile: 1 | 2
    tablet: 1 | 2 | 3
    desktop: 1 | 2 | 3 | 4 | 5 | 6
  }
  gap?: 'sm' | 'md' | 'lg'
  className?: string
}

interface MobileBottomSheetProps {
  children: ReactNode
  trigger: ReactNode
  title?: string
  description?: string
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

// Main responsive layout wrapper
export function ResponsiveContentLayout({ 
  children, 
  className, 
  enablePadding = true 
}: ResponsiveContentLayoutProps) {
  return (
    <div className={cn(
      "w-full",
      enablePadding && "px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8",
      className
    )}>
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6 lg:space-y-8">
        {children}
      </div>
    </div>
  )
}

// Responsive card component
export function ResponsiveCard({ 
  title, 
  subtitle,
  icon, 
  children, 
  className, 
  headerActions,
  variant = 'default',
  size = 'md',
  mobileFullWidth = false
}: ResponsiveCardProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'gradient':
        return 'bg-gradient-to-br from-white via-blue-50 to-purple-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900 border-0 shadow-xl'
      case 'glass':
        return 'bg-card/60 dark:bg-slate-800/60 backdrop-blur-xl border-0 shadow-lg'
      case 'bordered':
        return 'bg-card dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-800 shadow-md'
      default:
        return 'bg-card dark:bg-slate-800 border border-gray-200 dark:border-gray-700 shadow-sm'
    }
  }

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'p-3 sm:p-4'
      case 'lg':
        return 'p-6 sm:p-8'
      default:
        return 'p-4 sm:p-6'
    }
  }

  return (
    <Card className={cn(
      getVariantClasses(),
      "transition-all duration-200 hover:shadow-lg",
      mobileFullWidth && "mx-0",
      className
    )}>
      {(title || subtitle || headerActions) && (
        <CardHeader className={cn(
          "space-y-2",
          variant === 'gradient' && "bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg -m-px mb-0"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              {icon && <div className="flex-shrink-0">{icon}</div>}
              <div className="min-w-0 flex-1">
                {title && (
                  <CardTitle className={cn(
                    "text-lg sm:text-xl font-semibold truncate",
                    variant === 'gradient' && "text-white"
                  )}>
                    {title}
                  </CardTitle>
                )}
                {subtitle && (
                  <p className={cn(
                    "text-sm text-muted-foreground mt-1",
                    variant === 'gradient' && "text-blue-100"
                  )}>
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            {headerActions && (
              <div className="flex-shrink-0 ml-4">
                {headerActions}
              </div>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className={getSizeClasses()}>
        {children}
      </CardContent>
    </Card>
  )
}

// Two column responsive layout
export function ResponsiveTwoColumn({ 
  left, 
  right, 
  leftClassName, 
  rightClassName,
  gap = 'md',
  stackOrder = 'left-first',
  enableMobileStack = true
}: ResponsiveTwoColumnProps) {
  const getGapClasses = () => {
    switch (gap) {
      case 'sm': return 'gap-3 sm:gap-4'
      case 'lg': return 'gap-6 sm:gap-8'
      default: return 'gap-4 sm:gap-6'
    }
  }

  if (enableMobileStack) {
    return (
      <div className={cn(
        "grid grid-cols-1 lg:grid-cols-3",
        getGapClasses()
      )}>
        <div className={cn(
          "lg:col-span-2",
          stackOrder === 'right-first' && "order-2 lg:order-1",
          leftClassName
        )}>
          {left}
        </div>
        <div className={cn(
          "lg:col-span-1",
          stackOrder === 'right-first' && "order-1 lg:order-2",
          rightClassName
        )}>
          {right}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col lg:flex-row", getGapClasses())}>
      <div className={cn("flex-1 min-w-0", leftClassName)}>
        {left}
      </div>
      <div className={cn("w-full lg:w-80 flex-shrink-0", rightClassName)}>
        {right}
      </div>
    </div>
  )
}

// Responsive grid component
export function ResponsiveGrid({ 
  children, 
  cols = { mobile: 1, tablet: 2, desktop: 3 },
  gap = 'md',
  className 
}: ResponsiveGridProps) {
  const getGridClasses = () => {
    const gapClass = gap === 'sm' ? 'gap-3' : gap === 'lg' ? 'gap-6' : 'gap-4'
    return `grid grid-cols-${cols.mobile} md:grid-cols-${cols.tablet} lg:grid-cols-${cols.desktop} ${gapClass}`
  }

  return (
    <div className={cn(getGridClasses(), className)}>
      {children}
    </div>
  )
}

// Mobile-optimized stat card
export function MobileStatCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  trend,
  className 
}: {
  title: string
  value: string | number
  subtitle?: string
  icon?: ReactNode
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}) {
  const getTrendColor = () => {
    switch (trend) {
      case 'up': return 'text-green-600 dark:text-green-400'
      case 'down': return 'text-red-600 dark:text-red-400'
      default: return 'text-muted-foreground dark:text-gray-400'
    }
  }

  return (
    <div className={cn(
      "p-4 bg-card dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700",
      "shadow-sm hover:shadow-md transition-shadow duration-200",
      className
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {icon && (
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              {icon}
            </div>
          )}
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {value}
            </div>
            <div className="text-sm text-muted-foreground dark:text-gray-400">
              {title}
            </div>
          </div>
        </div>
      </div>
      {subtitle && (
        <div className={cn("text-sm mt-2", getTrendColor())}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

// Mobile action button group
export function MobileActionGroup({ 
  actions,
  orientation = 'horizontal'
}: {
  actions: Array<{
    label: string
    icon?: ReactNode
    onClick: () => void
    variant?: 'default' | 'outline' | 'ghost' | 'destructive'
    disabled?: boolean
    className?: string
  }>
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <div className={cn(
      "flex gap-2",
      orientation === 'vertical' ? "flex-col" : "flex-row flex-wrap",
      "sm:gap-3"
    )}>
      {actions.map((action, index) => (
        <Button
          key={index}
          variant={action.variant || 'outline'}
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            "min-h-[44px] px-4 text-sm font-medium",
            orientation === 'horizontal' && "flex-1 min-w-0",
            orientation === 'vertical' && "w-full justify-start",
            action.className
          )}
        >
          {action.icon && <span className="mr-2">{action.icon}</span>}
          <span className="truncate">{action.label}</span>
        </Button>
      ))}
    </div>
  )
}

// Sticky mobile toolbar
export function StickyMobileToolbar({ 
  children,
  visible = true 
}: {
  children: ReactNode
  visible?: boolean
}) {
  if (!visible) return null

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
      <div className="px-4 py-3">
        {children}
      </div>
    </div>
  )
}

// Mobile-optimized content section
export function MobileContentSection({ 
  title, 
  children, 
  collapsible = false,
  defaultExpanded = true,
  className 
}: {
  title: string
  children: ReactNode
  collapsible?: boolean
  defaultExpanded?: boolean
  className?: string
}) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  if (collapsible) {
    return (
      <div className={cn("border-b border-gray-200 dark:border-gray-700 last:border-b-0", className)}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-4 text-left hover:bg-muted/30 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            <div className={cn(
              "transform transition-transform duration-200",
              isExpanded ? "rotate-180" : "rotate-0"
            )}>
              ↓
            </div>
          </div>
        </button>
        {isExpanded && (
          <div className="px-4 pb-4">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 px-4 sm:px-0">
        {title}
      </h3>
      <div className="px-4 sm:px-0">
        {children}
      </div>
    </div>
  )
}

// Mobile swipe container
export function MobileSwipeContainer({ 
  children,
  onSwipeLeft,
  onSwipeRight,
  className 
}: {
  children: ReactNode
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  className?: string
}) {
  const [touchStart, setTouchStart] = React.useState<number | null>(null)
  const [touchEnd, setTouchEnd] = React.useState<number | null>(null)

  const minSwipeDistance = 50

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return
    
    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance

    if (isLeftSwipe && onSwipeLeft) {
      onSwipeLeft()
    }
    if (isRightSwipe && onSwipeRight) {
      onSwipeRight()
    }
  }

  return (
    <div
      className={cn("touch-pan-y", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  )
}

// Responsive info list
export function ResponsiveInfoList({ 
  items,
  orientation = 'vertical' 
}: {
  items: Array<{
    label: string
    value: string | ReactNode
    icon?: ReactNode
    variant?: 'default' | 'important' | 'muted'
  }>
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <div className={cn(
      "space-y-3",
      orientation === 'horizontal' && "sm:flex sm:flex-wrap sm:gap-6 sm:space-y-0"
    )}>
      {items.map((item, index) => (
        <div 
          key={index} 
          className={cn(
            "flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0",
            orientation === 'horizontal' && "sm:border-b-0 sm:py-0 sm:flex-col sm:items-start sm:justify-start",
            item.variant === 'important' && "bg-blue-50 dark:bg-blue-950/30 -mx-2 px-2 rounded",
            item.variant === 'muted' && "opacity-75"
          )}
        >
          <div className="flex items-center space-x-2 min-w-0">
            {item.icon && <div className="flex-shrink-0 text-muted-foreground">{item.icon}</div>}
            <span className={cn(
              "font-medium text-gray-700 dark:text-gray-300 text-sm sm:text-base",
              orientation === 'horizontal' && "sm:text-xs sm:text-muted-foreground sm:dark:text-gray-400"
            )}>
              {item.label}
            </span>
          </div>
          <div className={cn(
            "text-gray-900 dark:text-gray-100 text-sm sm:text-base font-medium ml-4",
            orientation === 'horizontal' && "sm:ml-0 sm:mt-1 sm:text-lg sm:font-bold"
          )}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// Mobile-friendly table alternative
export function ResponsiveDataList({ 
  data,
  keyField = 'id',
  renderItem
}: {
  data: any[]
  keyField?: string
  renderItem: (item: any, index: number) => ReactNode
}) {
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div
          key={item[keyField] || index}
          className="p-4 bg-muted/30 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  )
}

// Mobile pullable content
export function MobilePullToRefresh({ 
  children, 
  onRefresh,
  isRefreshing = false 
}: {
  children: ReactNode
  onRefresh: () => void
  isRefreshing?: boolean
}) {
  const [pullDistance, setPullDistance] = React.useState(0)
  const [isPulling, setIsPulling] = React.useState(false)

  return (
    <div className="relative">
      {isPulling && pullDistance > 60 && (
        <div className="absolute top-0 left-0 right-0 flex justify-center py-4 bg-blue-50 dark:bg-blue-950/30 rounded-t-lg">
          <div className="text-sm text-blue-600 dark:text-blue-400">
            {isRefreshing ? 'Refreshing...' : 'Release to refresh'}
          </div>
        </div>
      )}
      <div 
        style={{ 
          transform: isPulling ? `translateY(${Math.min(pullDistance * 0.5, 30)}px)` : 'none',
          transition: isPulling ? 'none' : 'transform 0.3s ease-out'
        }}
      >
        {children}
      </div>
    </div>
  )
}
