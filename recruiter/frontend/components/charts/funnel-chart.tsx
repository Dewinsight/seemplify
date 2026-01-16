'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface FunnelData {
  label: string
  value: number
  color: string
  percentage?: number
}

interface FunnelChartProps {
  data: FunnelData[]
  title: string
  subtitle?: string
  showPercentages?: boolean
  className?: string
}

export function FunnelChart({
  data,
  title,
  subtitle,
  showPercentages = true,
  className
}: FunnelChartProps) {
  const maxValue = Math.max(...data.map(d => d.value))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((item, index) => {
          const widthPercentage = (item.value / maxValue) * 100
          const conversionRate = index > 0 ? (item.value / data[index - 1].value) * 100 : 100

          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {item.value.toLocaleString()}
                  </Badge>
                  {showPercentages && index > 0 && (
                    <Badge
                      variant={conversionRate > 50 ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {conversionRate.toFixed(1)}%
                    </Badge>
                  )}
                </div>
              </div>

              {/* Funnel bar */}
              <div className="relative h-8 bg-muted rounded-lg overflow-hidden">
                <div
                  className="h-full rounded-lg transition-all duration-500 flex items-center justify-center"
                  style={{
                    width: `${widthPercentage}%`,
                    backgroundColor: item.color,
                    background: `linear-gradient(90deg, ${item.color}, ${item.color}dd)`
                  }}
                >
                  <span className="text-white text-xs font-medium">
                    {item.value.toLocaleString()}
                  </span>
                </div>

                {/* Conversion rate indicator */}
                {index > 0 && (
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <div className={cn(
                      "text-xs font-medium px-1 py-0.5 rounded",
                      conversionRate > 70 ? "text-green-600 dark:text-green-400" :
                        conversionRate > 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"
                    )}>
                      {conversionRate > 0 && '↓'} {conversionRate.toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Overall conversion rate */}
        <div className="pt-3 border-t">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-muted-foreground">
              Overall Conversion
            </span>
            <Badge variant="outline" className="font-medium">
              {data.length > 0 ? ((data[data.length - 1].value / data[0].value) * 100).toFixed(1) : 0}%
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
