'use client';

import { useState } from 'react';
import { useOrgSummaryReport, useReviewCycles, useReviewCycleReport, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Alert, Tabs, Tab, Select, MenuItem, FormControl, InputLabel,
  Table, TableHead, TableRow, TableCell, TableBody, Paper
} from '@mui/material';
import {
  Assessment, TrendingUp, People, Feedback as FeedbackIcon,
  Download
} from '@mui/icons-material';
import {
  BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

const COLORS = ['#667eea', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function ReportsPage() {
  const { isHRAdmin, isLoading: userLoading } = useUserContext();
  const { report: orgReport, isLoading: orgLoading } = useOrgSummaryReport();
  const { cycles } = useReviewCycles();
  
  const [tabValue, setTabValue] = useState(0);
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');
  const { report: cycleReport, isLoading: cycleLoading } = useReviewCycleReport(selectedCycleId);

  if (userLoading || orgLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isHRAdmin) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <Alert severity="error">
          Access denied. Only HR Administrators can access reports.
        </Alert>
      </Box>
    );
  }

  const handleExport = async (type: string) => {
    try {
      let url = '';
      switch (type) {
        case 'okrs':
          url = '/bulk/export/okrs?format=csv';
          break;
        case 'reviews':
          url = `/bulk/export/reviews?cycleId=${selectedCycleId}&format=csv`;
          break;
      }
      
      const res = await api.get(url);
      if (typeof res.data === 'string') {
        // Create download
        const blob = new Blob([res.data], { type: 'text/csv' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${type}-export-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        console.log('Export data:', res.data);
        alert('Export data logged to console. CSV download works when data is in CSV format.');
      }
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  // Prepare chart data
  const okrStatusData = orgReport?.okrs?.byStatus?.map((item: any) => ({
    name: item._id,
    count: item.count
  })) || [];

  const reviewStatusData = orgReport?.reviews?.byStatus?.map((item: any) => ({
    name: item._id,
    count: item.count
  })) || [];

  const feedbackTypeData = orgReport?.feedback?.byType?.map((item: any) => ({
    name: item._id,
    value: item.count
  })) || [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          Analytics & Reports
        </Typography>
      </Box>

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 3 }}>
        <Tab label="Organization Overview" />
        <Tab label="Review Cycle Analysis" />
        <Tab label="Export Data" />
      </Tabs>

      {/* Organization Overview */}
      {tabValue === 0 && (
        <>
          {/* Summary Cards */}
          <Grid container spacing={3} mb={4}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Assessment sx={{ fontSize: 40, opacity: 0.8 }} />
                    <Box>
                      <Typography variant="h4" fontWeight="bold">{orgReport?.okrs?.total || 0}</Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>Total OKRs</Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {orgReport?.okrs?.recentMonth || 0} created this month
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card sx={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={2}>
                    <People sx={{ fontSize: 40, opacity: 0.8 }} />
                    <Box>
                      <Typography variant="h4" fontWeight="bold">{orgReport?.reviews?.total || 0}</Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>Reviews</Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card sx={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={2}>
                    <FeedbackIcon sx={{ fontSize: 40, opacity: 0.8 }} />
                    <Box>
                      <Typography variant="h4" fontWeight="bold">{orgReport?.feedback?.total || 0}</Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>Feedback Items</Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {orgReport?.feedback?.recentMonth || 0} this month
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Card sx={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', color: 'white' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={2}>
                    <TrendingUp sx={{ fontSize: 40, opacity: 0.8 }} />
                    <Box>
                      <Typography variant="h4" fontWeight="bold">
                        {Math.round(orgReport?.okrs?.byStatus?.find((s: any) => s._id === 'active')?.avgProgress || 0)}%
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.9 }}>Avg OKR Progress</Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Charts */}
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>OKR Status Distribution</Typography>
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsBarChart data={okrStatusData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#667eea" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Feedback by Type</Typography>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={feedbackTypeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label
                      >
                        {feedbackTypeData.map((entry: any, index: number) => (
                          <Cell key={index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Review Status Breakdown</Typography>
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsBarChart data={reviewStatusData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}

      {/* Review Cycle Analysis */}
      {tabValue === 1 && (
        <>
          <FormControl fullWidth sx={{ mb: 3, maxWidth: 400 }}>
            <InputLabel>Select Review Cycle</InputLabel>
            <Select
              value={selectedCycleId}
              label="Select Review Cycle"
              onChange={(e) => setSelectedCycleId(e.target.value)}
            >
              {cycles?.map((cycle: any) => (
                <MenuItem key={cycle._id} value={cycle._id}>
                  {cycle.title} ({cycle.status})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedCycleId && cycleLoading && (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          )}

          {selectedCycleId && cycleReport && !cycleLoading && (
            <>
              <Grid container spacing={3} mb={4}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h4" fontWeight="bold" color="primary">
                        {cycleReport.totals?.totalReviews || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Total Reviews</Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h4" fontWeight="bold" color="success.main">
                        {cycleReport.completionRates?.selfReview || 0}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Self-Review Complete</Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h4" fontWeight="bold" color="info.main">
                        {cycleReport.completionRates?.managerReview || 0}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Manager Review Complete</Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h4" fontWeight="bold" color="warning.main">
                        {cycleReport.ratings?.ratingGap?.toFixed(1) || '-'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">Rating Gap (Self - Manager)</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Cycle Information</Typography>
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell>Title</TableCell>
                            <TableCell>{cycleReport.cycle?.title}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Status</TableCell>
                            <TableCell>
                              <Chip size="small" label={cycleReport.cycle?.status} color="primary" />
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Start Date</TableCell>
                            <TableCell>{new Date(cycleReport.cycle?.startDate).toLocaleDateString()}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>End Date</TableCell>
                            <TableCell>{new Date(cycleReport.cycle?.endDate).toLocaleDateString()}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Rating Summary</Typography>
                      <Table size="small">
                        <TableBody>
                          <TableRow>
                            <TableCell>Average Self Rating</TableCell>
                            <TableCell>
                              <Typography fontWeight="bold">{cycleReport.ratings?.avgSelfRating?.toFixed(1) || '-'}</Typography>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Average Manager Rating</TableCell>
                            <TableCell>
                              <Typography fontWeight="bold">{cycleReport.ratings?.avgManagerRating?.toFixed(1) || '-'}</Typography>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Fully Completed Reviews</TableCell>
                            <TableCell>
                              <Typography fontWeight="bold">{cycleReport.totals?.fullyCompleted || 0}</Typography>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid size={12}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Status Breakdown</Typography>
                      <ResponsiveContainer width="100%" height={250}>
                        <RechartsBarChart 
                          data={Object.entries(cycleReport.statusBreakdown || {}).map(([key, value]) => ({
                            status: key,
                            count: value as number
                          }))}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="status" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="count" fill="#667eea" />
                        </RechartsBarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </>
          )}

          {!selectedCycleId && (
            <Alert severity="info">Select a review cycle to view detailed analytics.</Alert>
          )}
        </>
      )}

      {/* Export Data */}
      {tabValue === 2 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Assessment color="primary" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h6">Export OKRs</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Download all OKRs as CSV
                    </Typography>
                  </Box>
                </Box>
                <Button 
                  variant="outlined" 
                  startIcon={<Download />}
                  onClick={() => handleExport('okrs')}
                >
                  Export OKRs
                </Button>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <People color="secondary" sx={{ fontSize: 40 }} />
                  <Box>
                    <Typography variant="h6">Export Reviews</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Download performance reviews as CSV
                    </Typography>
                  </Box>
                </Box>
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Select Cycle</InputLabel>
                  <Select
                    value={selectedCycleId}
                    label="Select Cycle"
                    onChange={(e) => setSelectedCycleId(e.target.value)}
                  >
                    <MenuItem value="">All Cycles</MenuItem>
                    {cycles?.map((cycle: any) => (
                      <MenuItem key={cycle._id} value={cycle._id}>
                        {cycle.title}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button 
                  variant="outlined" 
                  startIcon={<Download />}
                  onClick={() => handleExport('reviews')}
                >
                  Export Reviews
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}






