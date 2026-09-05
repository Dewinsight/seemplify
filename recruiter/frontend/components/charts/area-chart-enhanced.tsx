'use client'

import React from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTheme } from 'next-themes'

interface AreaChartData {
  [key: string]: string | number
}

interface AreaSeries {
  dataKey: string
  name: string
  color: string
  strokeWidth?: number
}

interface AreaChartEnhancedProps {
  data: AreaChartData[]
  series: AreaSeries[]
  title: string
  subtitle?: string
  height?: number
  showGrid?: boolean
  showLegend?: boolean
  stacked?: boolean
  className?: string
}

export function AreaChartEnhanced({
  data,
  series,
  title,
  subtitle,
  height = 350,
  showGrid = true,
  showLegend = true,
  stacked = false,
  className
}: AreaChartEnhancedProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const textColor = isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)'

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              <span className="font-medium">{entry.name}:</span>
              <span>{entry.value?.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  // Calculate trend for each series
  const calculateTrend = (dataKey: string) => {
    if (data.length < 2) return 0
    const firstValue = data[0][dataKey] as number
    const lastValue = data[data.length - 1][dataKey] as number
    return ((lastValue - firstValue) / firstValue) * 100
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">{title}</CardTitle>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          
          {/* Trend indicators */}
          <div className="flex gap-2">
            {series.slice(0, 2).map(serie => {
              const trend = calculateTrend(serie.dataKey)
              const isPositive = trend > 0
              
              return (
                <Badge 
                  key={serie.dataKey}
                  variant={isPositive ? "default" : "destructive"}
                  className="text-xs"
                >
                  {isPositive ? '↗' : '↘'} {Math.abs(trend).toFixed(1)}%
                </Badge>
              )
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
            
            <XAxis 
              dataKey="name" 
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
            />
            
            <YAxis 
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
            />
            
            <Tooltip content={<CustomTooltip />} />
            
            {showLegend && <Legend />}
            
            {series.map((serie, index) => (
              <Area
                key={serie.dataKey}
                type="monotone"
                dataKey={serie.dataKey}
                stackId={stacked ? "1" : serie.dataKey}
                stroke={serie.color}
                fill={serie.color}
                fillOpacity={0.6}
                strokeWidth={serie.strokeWidth || 2}
                name={serie.name}
                activeDot={{ r: 6, stroke: serie.color, strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
