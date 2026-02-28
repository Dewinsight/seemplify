'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface HeatmapData {
  x: string | number
  y: string | number
  value: number
  label?: string
}

interface HeatmapChartProps {
  data: HeatmapData[]
  title: string
  subtitle?: string
  xAxisLabel?: string
  yAxisLabel?: string
  colorScale?: [string, string]
  className?: string
}

export function HeatmapChart({ 
  data, 
  title, 
  subtitle, 
  xAxisLabel = 'X Axis',
  yAxisLabel = 'Y Axis',
  colorScale = ['#f3f4f6', '#3b82f6'],
  className 
}: HeatmapChartProps) {
  // Get unique x and y values
  const xValues = [...new Set(data.map(d => d.x))].sort()
  const yValues = [...new Set(data.map(d => d.y))].sort()
  
  // Get min and max values for color scaling
  const values = data.map(d => d.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  
  // Create a map for quick data lookup
  const dataMap = new Map()
  data.forEach(d => {
    dataMap.set(`${d.x}-${d.y}`, d)
  })
  
  // Generate color based on value
  const getColor = (value: number) => {
    if (maxValue === minValue) return colorScale[1]
    
    const normalizedValue = (value - minValue) / (maxValue - minValue)
    
    // Simple linear interpolation between two colors
    const r1 = parseInt(colorScale[0].slice(1, 3), 16)
    const g1 = parseInt(colorScale[0].slice(3, 5), 16)
    const b1 = parseInt(colorScale[0].slice(5, 7), 16)
    
    const r2 = parseInt(colorScale[1].slice(1, 3), 16)
    const g2 = parseInt(colorScale[1].slice(3, 5), 16)
    const b2 = parseInt(colorScale[1].slice(5, 7), 16)
    
    const r = Math.round(r1 + (r2 - r1) * normalizedValue)
    const g = Math.round(g1 + (g2 - g1) * normalizedValue)
    const b = Math.round(b1 + (b2 - b1) * normalizedValue)
    
    return `rgb(${r}, ${g}, ${b})`
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Heatmap grid */}
          <div className="overflow-x-auto">
            <div className="min-w-fit">
              {/* Y-axis label */}
              <div className="flex">
                <div className="w-16 flex items-center justify-center text-xs font-medium text-muted-foreground transform -rotate-90">
                  {yAxisLabel}
                </div>
                <div className="flex-1">
                  {/* Header row with x-axis values */}
                  <div className="flex mb-1">
                    <div className="w-20"></div> {/* Spacer for y-axis labels */}
                    {xValues.map(x => (
                      <div key={x} className="w-16 text-center text-xs font-medium text-muted-foreground py-1">
                        {x}
                      </div>
                    ))}
                  </div>
                  
                  {/* Data rows */}
                  {yValues.map(y => (
                    <div key={y} className="flex items-center mb-1">
                      <div className="w-20 text-xs font-medium text-muted-foreground text-right pr-2">
                        {y}
                      </div>
                      {xValues.map(x => {
                        const cellData = dataMap.get(`${x}-${y}`)
                        const value = cellData?.value || 0
                        
                        return (
                          <TooltipProvider key={`${x}-${y}`}>
                            <Tooltip>
                              <TooltipTrigger>
                                <div
                                  className={cn(
                                    "w-14 h-8 m-0.5 rounded flex items-center justify-center text-xs font-medium",
                                    "transition-all duration-200 hover:scale-110 cursor-pointer",
                                    value > (maxValue + minValue) / 2 ? "text-white" : "text-gray-800"
                                  )}
                                  style={{ backgroundColor: getColor(value) }}
                                >
                                  {value}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-sm">
                                  <div className="font-medium">
                                    {cellData?.label || `${x} × ${y}`}
                                  </div>
                                  <div>Value: {value}</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )
                      })}
                    </div>
                  ))}
                  
                  {/* X-axis label */}
                  <div className="text-center text-xs font-medium text-muted-foreground mt-2">
                    {xAxisLabel}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="text-xs text-muted-foreground">Low</div>
              <div className="w-20 h-3 rounded" style={{
                background: `linear-gradient(to right, ${colorScale[0]}, ${colorScale[1]})`
              }}></div>
              <div className="text-xs text-muted-foreground">High</div>
            </div>
            <div className="text-xs text-muted-foreground">
              {minValue} - {maxValue}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
