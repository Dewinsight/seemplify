'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useTeamAnalytics, useUserContext } from '@/lib/hooks';
import { Box, Typography, Card, CardContent, CircularProgress, Select, MenuItem, FormControl, InputLabel, SelectChangeEvent, Alert, Grid } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useMemo, useState } from 'react';

export default function AnalyticsPage() {
    const { teams, currentTeam, isLoading: contextLoading } = useUserContext();
    const teamOptions = useMemo(() => {
        const byId = new Map<string, { id: string; name: string }>();
        [...(teams || []), currentTeam].filter(Boolean).forEach((team: any) => {
            const id = String(team.id || team.teamId || team._id || '');
            if (id) byId.set(id, { id, name: team.name || team.teamName || 'My team' });
        });
        return [...byId.values()];
    }, [currentTeam, teams]);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const preferredTeamId = String(currentTeam?.id || currentTeam?.teamId || currentTeam?._id || '');
    const teamId = teamOptions.some((team) => team.id === selectedTeamId)
        ? selectedTeamId
        : teamOptions.find((team) => team.id === preferredTeamId)?.id || teamOptions[0]?.id || '';
    const { analytics, isLoading, isError } = useTeamAnalytics(teamId);

    const handleTeamChange = (event: SelectChangeEvent) => {
        setSelectedTeamId(event.target.value);
    };

    if (contextLoading || (teamId && isLoading)) return <CircularProgress />;
    if (isError) return <Typography color="error">Failed to load analytics. Please try again.</Typography>;

    // The shared fetcher unwraps { success, data }, while this fallback also
    // tolerates a direct payload for local or older deployments.
    const data = analytics?.data || analytics || {
        performanceDistribution: [],
        okrCompletionHistory: []
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4">Team Analytics</Typography>
                <FormControl sx={{ minWidth: 220 }} disabled={!teamOptions.length}>
                    <InputLabel>Team</InputLabel>
                    <Select value={teamId} label="Team" onChange={handleTeamChange}>
                        {teamOptions.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
                    </Select>
                </FormControl>
            </Box>

            {!teamOptions.length ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No team is available in your current organization. Join or select a team to view team analytics.
                </Alert>
            ) : data.performanceDistribution.length === 0 && data.okrCompletionHistory.length === 0 ? (
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
