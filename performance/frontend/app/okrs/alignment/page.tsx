'use client';

import { useState, useEffect } from 'react';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Alert, LinearProgress, IconButton, Tooltip, Paper, Collapse, Divider
} from '@mui/material';
import {
  AccountTree, ExpandMore, ExpandLess, Business, Groups, Person,
  ArrowForward, CheckCircle, Warning, Link as LinkIcon
} from '@mui/icons-material';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

interface OKRNode {
  _id: string;
  type: 'organization' | 'team' | 'individual';
  ownerId: string;
  period: string;
  status: string;
  progress: number;
  objectives: Array<{
    title: string;
    description?: string;
    keyResults: Array<{
      title: string;
      currentValue: number;
      targetValue: number;
    }>;
  }>;
  children?: OKRNode[];
}

interface HierarchyData {
  organization: OKRNode[];
  unalignedTeam: OKRNode[];
  unalignedIndividual: OKRNode[];
}

export default function OKRAlignmentPage() {
  const { isLoading: authLoading } = useAuth();
  const { isManager, isHRAdmin, isLoading: userLoading } = useUserContext();
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchHierarchy = async () => {
      try {
        const res = await api.get('/okrs/hierarchy');
        setHierarchy(res.data.data);
        setSummary(res.data.summary);
      } catch (error) {
        console.error('Error fetching hierarchy:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHierarchy();
  }, []);

  if (authLoading || userLoading || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'organization': return <Business color="primary" />;
      case 'team': return <Groups color="secondary" />;
      default: return <Person color="action" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'organization': return 'primary';
      case 'team': return 'secondary';
      default: return 'default';
    }
  };

  const renderOKRNode = (okr: OKRNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(okr._id);
    const hasChildren = okr.children && okr.children.length > 0;

    return (
      <Box key={okr._id} sx={{ ml: depth * 4, mb: 1 }}>
        <Paper
          elevation={depth === 0 ? 2 : 1}
          sx={{
            p: 2,
            borderLeft: 4,
            borderColor: okr.type === 'organization' ? 'primary.main' : okr.type === 'team' ? 'secondary.main' : 'grey.400',
            '&:hover': { bgcolor: 'action.hover' }
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            {hasChildren && (
              <IconButton size="small" onClick={() => toggleExpand(okr._id)}>
                {isExpanded ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            )}
            {!hasChildren && <Box sx={{ width: 32 }} />}

            {getTypeIcon(okr.type)}

            <Box flex={1}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {okr.objectives?.[0]?.title || 'Untitled OKR'}
                </Typography>
                <Chip
                  size="small"
                  label={okr.type}
                  color={getTypeColor(okr.type) as any}
                />
                <Chip
                  size="small"
                  label={okr.status}
                  variant="outlined"
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {okr.period} • Owner: {okr.ownerId}
              </Typography>
            </Box>

            <Box sx={{ minWidth: 150 }}>
              <Box display="flex" justifyContent="space-between" mb={0.5}>
                <Typography variant="caption">Progress</Typography>
                <Typography variant="caption" fontWeight="bold">{okr.progress || 0}%</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={okr.progress || 0}
                sx={{ height: 6, borderRadius: 1 }}
                color={okr.progress >= 70 ? 'success' : okr.progress >= 40 ? 'warning' : 'error'}
              />
            </Box>

            {hasChildren && (
              <Chip
                size="small"
                label={`${okr.children?.length} aligned`}
                icon={<LinkIcon />}
                variant="outlined"
                color="info"
              />
            )}
          </Box>

          {/* Key Results Preview */}
          {isExpanded && okr.objectives?.[0]?.keyResults && (
            <Box mt={2} pl={5}>
              <Typography variant="caption" color="text.secondary" fontWeight="bold">
                Key Results:
              </Typography>
              {okr.objectives[0].keyResults.map((kr, idx) => (
                <Box key={idx} display="flex" alignItems="center" gap={2} mt={0.5}>
                  <CheckCircle
                    sx={{ fontSize: 14 }}
                    color={kr.currentValue >= kr.targetValue ? 'success' : 'action'}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {kr.title}
                  </Typography>
                  <Typography variant="caption">
                    {kr.currentValue}/{kr.targetValue}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>

        {/* Children */}
        {hasChildren && (
          <Collapse in={isExpanded}>
            <Box sx={{ mt: 1, borderLeft: 2, borderColor: 'divider' }}>
              {okr.children?.map(child => renderOKRNode(child, depth + 1))}
            </Box>
          </Collapse>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" fontWeight="bold">
            OKR Alignment
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View how objectives cascade from organization to teams to individuals
          </Typography>
        </Box>
        <Button
          component={Link}
          href="/okrs"
          variant="outlined"
          startIcon={<ArrowForward />}
        >
          Back to My OKRs
        </Button>
      </Box>

      {/* Summary Cards */}
      {summary && (
        <Grid container spacing={3} mb={4}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Business sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
                <Typography variant="h4" fontWeight="bold">{summary.organization}</Typography>
                <Typography variant="caption" color="text.secondary">Organization OKRs</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Groups sx={{ fontSize: 40, color: 'secondary.main', mb: 1 }} />
                <Typography variant="h4" fontWeight="bold">{summary.team}</Typography>
                <Typography variant="caption" color="text.secondary">Team OKRs</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Person sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                <Typography variant="h4" fontWeight="bold">{summary.individual}</Typography>
                <Typography variant="caption" color="text.secondary">Individual OKRs</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <AccountTree sx={{ fontSize: 40, color: 'success.main', mb: 1 }} />
                <Typography variant="h4" fontWeight="bold">
                  {summary.total > 0 ? Math.round((summary.aligned / summary.total) * 100) : 0}%
                </Typography>
                <Typography variant="caption" color="text.secondary">Aligned</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Hierarchy Tree */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <AccountTree sx={{ mr: 1, verticalAlign: 'middle' }} />
            OKR Hierarchy
          </Typography>
          <Divider sx={{ my: 2 }} />

          {hierarchy?.organization && hierarchy.organization.length > 0 ? (
            hierarchy.organization.map(okr => renderOKRNode(okr))
          ) : (
            <Alert severity="info">
              No organization-level OKRs found. Create organization OKRs first to build a cascade.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Unaligned OKRs */}
      {((hierarchy?.unalignedTeam?.length || 0) > 0 || (hierarchy?.unalignedIndividual?.length || 0) > 0) && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom color="warning.main">
              <Warning sx={{ mr: 1, verticalAlign: 'middle' }} />
              Unaligned OKRs
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              These OKRs are not connected to a parent objective. Consider aligning them to improve goal coherence.
            </Typography>
            <Divider sx={{ my: 2 }} />

            {hierarchy?.unalignedTeam?.map(okr => (
              <Box key={okr._id} sx={{ mb: 1 }}>
                <Paper variant="outlined" sx={{ p: 2, borderColor: 'warning.main' }}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Groups color="secondary" />
                    <Box flex={1}>
                      <Typography variant="subtitle2">
                        {okr.objectives?.[0]?.title || 'Untitled'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Team OKR • {okr.period}
                      </Typography>
                    </Box>
                    <Chip size="small" label="Unaligned" color="warning" />
                  </Box>
                </Paper>
              </Box>
            ))}

            {hierarchy?.unalignedIndividual?.map(okr => (
              <Box key={okr._id} sx={{ mb: 1 }}>
                <Paper variant="outlined" sx={{ p: 2, borderColor: 'warning.light' }}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Person color="action" />
                    <Box flex={1}>
                      <Typography variant="subtitle2">
                        {okr.objectives?.[0]?.title || 'Untitled'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Individual OKR • {okr.period}
                      </Typography>
                    </Box>
                    <Chip size="small" label="Unaligned" variant="outlined" />
                  </Box>
                </Paper>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}






