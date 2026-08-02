"use client"

import { useTheme } from "next-themes"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts"
import { Card } from "@/components/ui/card"

// Sample data for the chart
const data = [
  { name: "Week 1", candidates: 65, interviews: 28, hires: 5 },
  { name: "Week 2", candidates: 59, interviews: 32, hires: 8 },
  { name: "Week 3", candidates: 80, interviews: 45, hires: 12 },
  { name: "Week 4", candidates: 81, interviews: 40, hires: 10 },
  { name: "Week 5", candidates: 56, interviews: 36, hires: 7 },
  { name: "Week 6", candidates: 55, interviews: 30, hires: 6 },
  { name: "Week 7", candidates: 40, interviews: 20, hires: 4 },
  { name: "Week 8", candidates: 75, interviews: 45, hires: 11 },
]

// Custom tooltip component
const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    return (
      <Card className="border p-2 shadow-sm">
        <p className="font-medium">{label}</p>
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
            <p className="text-sm">
              {entry.name}: {entry.value}
            </p>
          </div>
        ))}
      </Card>
    )
  }

  return null
}

export function DashboardChart() {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  // Colors based on theme
  const colors = {
    candidates: isDark ? "#3b82f6" : "#3b82f6", // blue
    interviews: isDark ? "#8b5cf6" : "#8b5cf6", // purple
    hires: isDark ? "#10b981" : "#10b981", // green
    grid: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
    text: isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart
        data={data}
        margin={{
          top: 5,
          right: 30,
          left: 20,
          bottom: 5,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
        <XAxis
          dataKey="name"
          tick={{ fill: colors.text }}
          tickLine={{ stroke: colors.grid }}
          axisLine={{ stroke: colors.grid }}
        />
        <YAxis tick={{ fill: colors.text }} tickLine={{ stroke: colors.grid }} axisLine={{ stroke: colors.grid }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Line
          type="monotone"
          dataKey="candidates"
          stroke={colors.candidates}
          strokeWidth={2}
          activeDot={{ r: 8 }}
          name="Candidates"
        />
        <Line type="monotone" dataKey="interviews" stroke={colors.interviews} strokeWidth={2} name="Interviews" />
        <Line type="monotone" dataKey="hires" stroke={colors.hires} strokeWidth={2} name="Hires" />
      </LineChart>
    </ResponsiveContainer>
  )
}
