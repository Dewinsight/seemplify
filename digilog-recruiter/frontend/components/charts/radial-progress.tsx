'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface RadialProgressProps {
  value: number
  max: number
  title: string
  subtitle?: string
  color?: string
  backgroundColor?: string
  size?: number
  strokeWidth?: number
  showValue?: boolean
  className?: string
  unit?: string
}

export function RadialProgress({
  value,
  max,
  title,
  subtitle,
  color = '#3b82f6',
  backgroundColor = '#e5e7eb',
  size = 120,
  strokeWidth = 8,
  showValue = true,
  className,
  unit = ''
}: RadialProgressProps) {
  const percentage = Math.min((value / max) * 100, 100)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDasharray = circumference
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-center">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground text-center">{subtitle}</p>}
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        <div className="relative flex items-center justify-center">
          <svg width={size} height={size} className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={backgroundColor}
              strokeWidth={strokeWidth}
            />
            {/* Progress circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-500 ease-out"
            />
          </svg>
          
          {/* Center content */}
          {showValue && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-lg font-bold" style={{ color }}>
                {value.toLocaleString()}{unit}
              </div>
              <div className="text-xs text-muted-foreground">
                of {max.toLocaleString()}{unit}
              </div>
            </div>
          )}
        </div>
        
        {/* Progress badge */}
        <Badge variant="secondary" className="text-xs">
          {percentage.toFixed(1)}% Complete
        </Badge>
      </CardContent>
    </Card>
  )
}
