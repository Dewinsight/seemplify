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
  ArrowBack, CheckCircle, Warning, Link as LinkIcon
} from '@mui/icons-material';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

interface OKRNode {
  _id: string;
  type: 'organization' | 'department' | 'team' | 'individual';
  ownerId: string;
  owner?: { name?: string; email?: string };
  title?: string;
  period: string;
  status: string;
  progress: number | null;
  scoring?: { progress?: number | null };
  objectives: Array<{
    title: string;
    description?: string;
    keyResults: Array<{
      title: string;
      currentValue?: number;
      targetValue: number;
    }>;
  }>;
  children?: OKRNode[];
}

interface HierarchyData {
  organization: OKRNode[];
  unalignedDepartment: OKRNode[];
  unalignedTeam: OKRNode[];
  unalignedIndividual: OKRNode[];
}

export default function OKRAlignmentPage() {
  const { isLoading: authLoading } = useAuth();
  const { isLoading: userLoading } = useUserContext();
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const fetchHierarchy = async () => {
      const params = new URLSearchParams(window.location.search);
      const goalId = params.get('goal') || '';
      const period = params.get('period') || '';
      setSelectedGoalId(goalId);
      setSelectedPeriod(period);
      setError('');
      setLoading(true);
      try {
        const res = await api.get('/okrs/hierarchy', { params: period ? { period } : undefined });
        setHierarchy(res.data.data);
        setSummary(res.data.summary);
        if (goalId) {
          const findPath = (nodes: OKRNode[], path: string[] = []): string[] | null => {
            for (const node of nodes) {
              const nextPath = [...path, node._id];
              if (node._id === goalId) return nextPath;
              const found = findPath(node.children || [], nextPath);
              if (found) return found;
            }
            return null;
          };
          const path = findPath(res.data.data?.organization || []);
          if (path) setExpandedNodes(new Set(path));
          window.setTimeout(() => document.getElementById(`goal-${goalId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
        }
      } catch (requestError: any) {
        setHierarchy(null);
        setError(requestError?.response?.data?.error || 'Could not load goal alignment.');
      } finally {
        setLoading(false);
      }
    };

    fetchHierarchy();
  }, [reloadKey]);

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
      case 'department': return <AccountTree color="info" />;
      case 'team': return <Groups color="secondary" />;
      default: return <Person color="action" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'organization': return 'primary';
      case 'department': return 'info';
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
          id={`goal-${okr._id}`}
          elevation={depth === 0 ? 2 : 1}
          sx={{
            p: 2,
            borderLeft: 4,
            borderColor: okr.type === 'organization' ? 'primary.main' : okr.type === 'department' ? 'info.main' : okr.type === 'team' ? 'secondary.main' : 'grey.400',
            outline: selectedGoalId === okr._id ? '2px solid' : 'none',
            outlineColor: 'primary.main',
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
                  {okr.title || okr.objectives?.[0]?.title || 'Untitled OKR'}
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
                {okr.period} · {okr.owner?.name || okr.owner?.email || 'Goal owner'}
              </Typography>
            </Box>

            <Box sx={{ minWidth: 150 }}>
              <Box display="flex" justifyContent="space-between" mb={0.5}>
                <Typography variant="caption">Progress</Typography>
                <Typography variant="caption" fontWeight="bold">{(okr.scoring?.progress ?? okr.progress) == null ? 'Not rated' : `${Math.round(okr.scoring?.progress ?? okr.progress ?? 0)}%`}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={okr.scoring?.progress ?? okr.progress ?? 0}
                sx={{ height: 6, borderRadius: 1 }}
                color={(okr.scoring?.progress ?? okr.progress ?? 0) >= 70 ? 'success' : (okr.scoring?.progress ?? okr.progress ?? 0) >= 40 ? 'warning' : 'error'}
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
                    color={typeof kr.currentValue === 'number' && kr.currentValue >= kr.targetValue ? 'success' : 'action'}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {kr.title}
                  </Typography>
                  <Typography variant="caption">
                    {typeof kr.currentValue === 'number' ? `${kr.currentValue}/${kr.targetValue}` : 'Not rated'}
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
            View how objectives cascade from the organization through departments and teams to individuals{selectedPeriod ? ` for ${selectedPeriod}` : ''}.
          </Typography>
        </Box>
        <Button
          component={Link}
          href="/okrs"
          variant="outlined"
          startIcon={<ArrowBack />}
        >
          Back to My OKRs
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} action={<Button color="inherit" size="small" onClick={() => setReloadKey((value) => value + 1)}>Retry</Button>}>
          {error}
        </Alert>
      )}

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
                <AccountTree sx={{ fontSize: 40, color: 'info.main', mb: 1 }} />
                <Typography variant="h4" fontWeight="bold">{summary.department || 0}</Typography>
                <Typography variant="caption" color="text.secondary">Department OKRs</Typography>
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
      {((hierarchy?.unalignedDepartment?.length || 0) > 0 || (hierarchy?.unalignedTeam?.length || 0) > 0 || (hierarchy?.unalignedIndividual?.length || 0) > 0) && (
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

            {hierarchy?.unalignedDepartment?.map(okr => (
              <Box key={okr._id} sx={{ mb: 1 }}>
                <Paper id={`goal-${okr._id}`} variant="outlined" sx={{ p: 2, borderColor: selectedGoalId === okr._id ? 'primary.main' : 'info.main' }}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <AccountTree color="info" />
                    <Box flex={1}>
                      <Typography variant="subtitle2">{okr.title || okr.objectives?.[0]?.title || 'Untitled'}</Typography>
                      <Typography variant="caption" color="text.secondary">Department OKR · {okr.period}</Typography>
                    </Box>
                    <Chip size="small" label="Unaligned" color="warning" />
                  </Box>
                </Paper>
              </Box>
            ))}

            {hierarchy?.unalignedTeam?.map(okr => (
              <Box key={okr._id} sx={{ mb: 1 }}>
                <Paper id={`goal-${okr._id}`} variant="outlined" sx={{ p: 2, borderColor: selectedGoalId === okr._id ? 'primary.main' : 'warning.main' }}>
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
                <Paper id={`goal-${okr._id}`} variant="outlined" sx={{ p: 2, borderColor: selectedGoalId === okr._id ? 'primary.main' : 'warning.light' }}>
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






