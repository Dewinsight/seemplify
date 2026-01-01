'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useUserContext, useReviewCycles } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, Alert, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Tooltip, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, FormControl, InputLabel, Select, MenuItem,
  Grid, Skeleton
} from '@mui/material';
import { Add, Edit, PlayArrow, Stop, Visibility, Delete } from '@mui/icons-material';

export default function ReviewCyclesPage() {
  const { isHRAdmin, isLoading: contextLoading } = useUserContext();
  const { cycles, isLoading: cyclesLoading, mutate } = useReviewCycles();
  
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCycle, setNewCycle] = useState({
    title: '',
    type: 'manager-only',
    startDate: '',
    endDate: ''
  });

  const isLoading = contextLoading || cyclesLoading;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="text" width={300} height={24} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!isHRAdmin) {
    return (
      <Box>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Review Cycles
        </Typography>
        <Alert severity="error" sx={{ mt: 2 }}>
          Access Denied. This page is restricted to HR Administrators.
        </Alert>
      </Box>
    );
  }

  const handleCreateCycle = async () => {
    try {
      // Call API to create cycle
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5006'}/api/reviews/cycles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newCycle)
      });
      
      if (response.ok) {
        mutate(); // Refresh cycles list
        setCreateDialogOpen(false);
        setNewCycle({ title: '', type: 'manager-only', startDate: '', endDate: '' });
      }
    } catch (error) {
      console.error('Error creating cycle:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'default';
      case 'planning': return 'info';
      case 'active': return 'success';
      case 'calibration': return 'warning';
      case 'closed': return 'error';
      default: return 'default';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case '360': return '360° Review';
      case 'manager-only': return 'Manager Review';
      case 'self-only': return 'Self Review';
      case 'peer': return 'Peer Review';
      default: return type;
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Review Cycles
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage performance review cycles for your organization
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Cycle
        </Button>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Total Cycles</Typography>
              <Typography variant="h3" fontWeight={700}>{cycles.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ bgcolor: 'success.light' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Active</Typography>
              <Typography variant="h3" fontWeight={700} color="success.dark">
                {cycles.filter((c: any) => c.status === 'active').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Draft</Typography>
              <Typography variant="h3" fontWeight={700}>
                {cycles.filter((c: any) => c.status === 'draft').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Cycles Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            All Review Cycles
          </Typography>
          
          {cycles.length === 0 ? (
            <Alert severity="info">
              No review cycles created yet. Click "Create Cycle" to set up your first performance review cycle.
            </Alert>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Start Date</TableCell>
                    <TableCell>End Date</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cycles.map((cycle: any) => (
                    <TableRow key={cycle._id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {cycle.title}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={getTypeLabel(cycle.type)} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {cycle.startDate ? new Date(cycle.startDate).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        {cycle.endDate ? new Date(cycle.endDate).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={cycle.status} 
                          size="small" 
                          color={getStatusColor(cycle.status) as any}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="View">
                          <IconButton size="small">
                            <Visibility fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {cycle.status === 'draft' && (
                          <>
                            <Tooltip title="Edit">
                              <IconButton size="small">
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Activate">
                              <IconButton size="small" color="success">
                                <PlayArrow fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                        {cycle.status === 'active' && (
                          <Tooltip title="Close Cycle">
                            <IconButton size="small" color="warning">
                              <Stop fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Create Cycle Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Review Cycle</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Cycle Title"
              fullWidth
              value={newCycle.title}
              onChange={(e) => setNewCycle({ ...newCycle, title: e.target.value })}
              placeholder="e.g., Q4 2024 Performance Review"
            />
            
            <FormControl fullWidth>
              <InputLabel>Review Type</InputLabel>
              <Select
                value={newCycle.type}
                label="Review Type"
                onChange={(e) => setNewCycle({ ...newCycle, type: e.target.value })}
              >
                <MenuItem value="manager-only">Manager Review Only</MenuItem>
                <MenuItem value="self-only">Self Review Only</MenuItem>
                <MenuItem value="360">360° Review</MenuItem>
                <MenuItem value="peer">Peer Review</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Start Date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newCycle.startDate}
              onChange={(e) => setNewCycle({ ...newCycle, startDate: e.target.value })}
            />

            <TextField
              label="End Date"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newCycle.endDate}
              onChange={(e) => setNewCycle({ ...newCycle, endDate: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateCycle} 
            variant="contained"
            disabled={!newCycle.title || !newCycle.startDate || !newCycle.endDate}
          >
            Create Cycle
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}






