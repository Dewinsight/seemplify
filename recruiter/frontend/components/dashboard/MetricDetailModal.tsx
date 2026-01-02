'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';
import { Download, TrendingUp, Calendar, Filter } from 'lucide-react';
import { useDashboardState } from '@/app/dashboard/hooks/useDashboardState';

interface MetricDetailModalProps {
  metricId: string;
  metricData: {
    title: string;
    currentValue: number;
    historicalData?: Array<{ date: string; value: number }>;
    breakdown?: Array<{ category: string; value: number }>;
    insights?: string[];
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MetricDetailModal({
  metricId,
  metricData,
  open,
  onOpenChange,
}: MetricDetailModalProps) {
  const { setFocusedMetric } = useDashboardState();

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setFocusedMetric(null);
    }
    onOpenChange(isOpen);
  };

  // Use provided historical data only - don't generate fake data
  const historicalData = metricData.historicalData || [];

  // Calculate trend
  const trend = historicalData.length > 1
    ? ((historicalData[historicalData.length - 1].value - historicalData[0].value) / historicalData[0].value) * 100
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">{metricData.title} Analysis</DialogTitle>
              <DialogDescription>
                Detailed insights and historical trends
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={trend > 0 ? 'default' : 'secondary'}>
                {trend > 0 ? '+' : ''}{trend.toFixed(1)}% trend
              </Badge>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-6 space-y-6">
          {/* Current Value Display */}
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-4xl font-bold">{metricData.currentValue.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-2">Current Value</p>
              </div>
            </CardContent>
          </Card>

          {/* Tabs for different views */}
          <Tabs defaultValue="trend" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="trend">Historical Trend</TabsTrigger>
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
            </TabsList>

            <TabsContent value="trend" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">30-Day Trend</CardTitle>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm">
                        <Calendar className="h-4 w-4 mr-2" />
                        Date Range
                      </Button>
                      <Button variant="outline" size="sm">
                        <Filter className="h-4 w-4 mr-2" />
                        Filter
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {historicalData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={historicalData}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(value) => new Date(value).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                            className="text-xs"
                          />
                          <YAxis className="text-xs" />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--popover))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '6px',
                            }}
                            labelFormatter={(value) => new Date(value).toLocaleDateString()}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#6366f1"
                            fillOpacity={1}
                            fill="url(#colorValue)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center">
                      <p className="text-muted-foreground">No historical data available</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Statistics */}
              {historicalData.length > 0 && (
                <div className="grid gap-4 md:grid-cols-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">
                          {Math.max(...historicalData.map(d => d.value)).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Peak Value</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">
                          {Math.min(...historicalData.map(d => d.value)).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Lowest Value</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">
                          {Math.round(historicalData.reduce((sum, d) => sum + d.value, 0) / historicalData.length).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Average</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">
                          {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">Growth Rate</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="breakdown" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Category Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {metricData.breakdown ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metricData.breakdown}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="category" className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--popover))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '6px',
                            }}
                          />
                          <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No breakdown data available
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="insights" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Key Insights</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {metricData.insights && metricData.insights.length > 0 ? (
                      metricData.insights.map((insight, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                          <p className="text-sm">{insight}</p>
                        </div>
                      ))
                    ) : historicalData.length > 1 ? (
                      <>
                        <div className="flex items-start gap-3">
                          <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                          <p className="text-sm">
                            This metric has shown a {trend > 0 ? 'positive' : 'negative'} trend of {Math.abs(trend).toFixed(1)}% over the available period.
                          </p>
                        </div>
                        <div className="flex items-start gap-3">
                          <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                          <p className="text-sm">
                            Peak performance was observed on {new Date(historicalData.reduce((max, d) => d.value > max.value ? d : max).date).toLocaleDateString()}.
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">No insights available - historical data needed to generate insights</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
