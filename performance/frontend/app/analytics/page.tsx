'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useTeamAnalytics } from '@/lib/hooks';
import { Box, Typography, Card, CardContent, CircularProgress, Select, MenuItem, FormControl, InputLabel, SelectChangeEvent, Alert, Grid } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useState } from 'react';

export default function AnalyticsPage() {
    const [teamId, setTeamId] = useState('engineering'); // Mock team ID
    const { analytics, isLoading, isError } = useTeamAnalytics(teamId);

    const handleTeamChange = (event: SelectChangeEvent) => {
        setTeamId(event.target.value);
    };

    if (isLoading) return <CircularProgress />;
    if (isError) return <Typography color="error">Failed to load analytics. Please try again.</Typography>;

    // Use real data only - no fallback
    const data = analytics || {
        performanceDistribution: [],
        okrCompletionHistory: []
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4">Team Analytics</Typography>
                <FormControl sx={{ minWidth: 200 }}>
                    <InputLabel>Team</InputLabel>
                    <Select value={teamId} label="Team" onChange={handleTeamChange}>
                        <MenuItem value="engineering">Engineering</MenuItem>
                        <MenuItem value="product">Product</MenuItem>
                        <MenuItem value="sales">Sales</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            {data.performanceDistribution.length === 0 && data.okrCompletionHistory.length === 0 ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No analytics data available yet. Data will appear once OKRs and reviews are created.
                </Alert>
            ) : (
            <Grid container spacing={3}>
                {/* Performance Distribution Chart */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Performance Rating Distribution</Typography>
                            {data.performanceDistribution.length === 0 ? (
                                <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography color="text.secondary">No performance data available</Typography>
                                </Box>
                            ) : (
                            <Box sx={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.performanceDistribution}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Legend />
                                        <Bar dataKey="count" fill="#2563eb" name="Employees" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* OKR Completion Trend */}
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>OKR Completion Trend (%)</Typography>
                            {data.okrCompletionHistory.length === 0 ? (
                                <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography color="text.secondary">No OKR history available</Typography>
                                </Box>
                            ) : (
                            <Box sx={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data.okrCompletionHistory}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="month" />
                                        <YAxis domain={[0, 100]} />
                                        <Tooltip />
                                        <Legend />
                                        <Line type="monotone" dataKey="avg" stroke="#dc004e" strokeWidth={2} name="Avg. Progress" />
                                    </LineChart>
                                </ResponsiveContainer>
                            </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
            )}
        </Box>
    );
}
