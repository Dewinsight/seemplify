'use client'

import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface DonutChartData {
  name: string
  value: number
  color: string
  percentage?: number
}

interface DonutChartProps {
  data: DonutChartData[]
  title: string
  subtitle?: string
  showLegend?: boolean
  showCenter?: boolean
  centerValue?: string | number
  centerLabel?: string
  size?: number
  className?: string
}

export function DonutChart({ 
  data, 
  title, 
  subtitle, 
  showLegend = true,
  showCenter = true,
  centerValue,
  centerLabel,
  size = 300,
  className 
}: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  
  // Calculate percentages
  const dataWithPercentages = data.map(item => ({
    ...item,
    percentage: (item.value / total) * 100
  }))

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg z-[9999] relative" style={{ zIndex: 9999 }}>
          <div className="flex items-center gap-2 mb-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: data.color }}
            />
            <span className="font-medium">{data.name}</span>
          </div>
          <div className="text-sm space-y-1">
            <div>Value: {data.value.toLocaleString()}</div>
            <div>Percentage: {data.percentage.toFixed(1)}%</div>
          </div>
        </div>
      )
    }
    return null
  }

  const CustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null // Don't show labels for very small slices
    
    const RADIAN = Math.PI / 180
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)

    return (
      <g>
        {/* Background rectangle for better readability */}
        <rect
          x={x - 18}
          y={y - 10}
          width={36}
          height={20}
          fill="rgba(0, 0, 0, 0.75)"
          rx={4}
        />
        <text 
          x={x} 
          y={y} 
          fill="white" 
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight="600"
        >
          {`${(percent * 100).toFixed(0)}%`}
        </text>
      </g>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="flex flex-col items-center overflow-visible">
        <div className="relative" style={{ width: size, height: size, zIndex: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dataWithPercentages}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={CustomizedLabel}
                outerRadius={size * 0.35}
                innerRadius={size * 0.2}
                paddingAngle={2}
                dataKey="value"
              >
                {dataWithPercentages.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                content={<CustomTooltip />} 
                wrapperStyle={{ zIndex: 9999, position: 'relative' }}
              />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Center content */}
          {showCenter && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">
                  {centerValue || total.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  {centerLabel || 'Total'}
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Custom Legend */}
        {showLegend && (
          <div className="mt-6 w-full space-y-2">
            {dataWithPercentages.map((item, index) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm font-medium">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {item.value.toLocaleString()}
                  </Badge>
                  <span className="text-xs text-muted-foreground w-12 text-right">
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
