'use client'

import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface GaugeChartProps {
  value: number
  max: number
  title: string
  subtitle?: string
  color?: string
  size?: number
  showValue?: boolean
}

export function GaugeChart({ 
  value, 
  max, 
  title, 
  subtitle, 
  color = '#3b82f6', 
  size = 200,
  showValue = true 
}: GaugeChartProps) {
  const percentage = Math.min((value / max) * 100, 100)
  const angle = (percentage / 100) * 180 // Half circle
  
  // Create data for the gauge
  const data = [
    { name: 'Used', value: percentage },
    { name: 'Unused', value: 100 - percentage }
  ]

  const RADIAN = Math.PI / 180
  const cx = size / 2
  const cy = size / 2
  const iR = size * 0.3
  const oR = size * 0.45
  
  const needle = () => {
    const radius = size * 0.35
    const x = cx + radius * Math.cos(-RADIAN * (90 + angle))
    const y = cy + radius * Math.sin(-RADIAN * (90 + angle))
    
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="none" />
        <path 
          d={`M${cx},${cy}L${x},${y}`} 
          strokeWidth="3" 
          stroke={color} 
          fill="none"
          strokeLinecap="round"
        />
      </g>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div className="relative" style={{ width: size, height: size * 0.6 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                dataKey="value"
                startAngle={180}
                endAngle={0}
                data={data}
                cx="50%"
                cy="100%"
                innerRadius={iR}
                outerRadius={oR}
                stroke="none"
              >
                <Cell fill={color} />
                <Cell fill="#e5e7eb" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <svg 
            width={size} 
            height={size * 0.6} 
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            {needle()}
          </svg>
        </div>
        
        {showValue && (
          <div className="mt-4 text-center">
            <div className="text-3xl font-bold" style={{ color }}>
              {value}
            </div>
            <div className="text-sm text-muted-foreground">
              of {max} ({percentage.toFixed(1)}%)
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
