'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { competencyRequest } from '@/lib/competency-api';
import { CompetencyPage, Surface, LoadingCompetency, CompetencyFailure, DeniedCompetency, useCompetencyBootstrap } from '../CompetencyPage';
type Row = {
    id: string;
    strategyId?: string;
    name?: string;
    title?: string;
    sourceType?: string;
    status?: string;
    archivedAt?: string;
    updatedAt?: string;
    currentVersionId?: string;
    version?: number;
};
export default function LibraryList({ kind }: {
    kind: 'roles' | 'frameworks' | 'cycles' | 'strategies';
}) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('active');
    const bootstrap = useCompetencyBootstrap();
    const capabilities = bootstrap.data?.capabilities;
    const canManage = capabilities?.[kind === 'roles' ? 'roleManage' : kind === 'frameworks' ? 'frameworkManage' : 'cycleManage'];
    const readable = canManage || capabilities?.assessmentLaunch;
    const rows = useSWR<Row[]>(readable ? `competency-${kind}-${status}` : null, () => competencyRequest<Row[]>('GET', `/${kind}?status=${status}`));
    const title = kind === 'roles' ? 'Role library' : kind === 'frameworks' ? 'Competency frameworks' : kind === 'strategies' ? 'Strategy criteria' : 'Assessment cycles';
    const singular = kind === 'roles' ? 'role' : kind === 'frameworks' ? 'framework' : kind === 'strategies' ? 'strategy' : 'cycle';
    const grouped = kind === 'strategies' ? [...(rows.data || []).reduce((map, row) => { const id = row.strategyId || row.id; if (!map.has(id) || (row.version || 0) > (map.get(id)?.version || 0))
            map.set(id, { ...row, id }); return map; }, new Map<string, Row>()).values()] : rows.data || [];
    const shown = grouped.filter(row => `${row.name || row.title || ''} ${row.sourceType || ''}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || status === 'archived' ? status === 'all' || !!row.archivedAt : !row.archivedAt));
    return <CompetencyPage title={title} description={kind === 'roles' ? 'Define the work expectations used in appraisals. Assessment roles do not change app permissions.' : kind === 'frameworks' ? 'Keep each framework’s competencies, native levels and published versions together.' : kind === 'strategies' ? 'Define strategic outcomes or capture an authorised objective for role assessment.' : 'Choose assessment inputs, roles, scoring and outcomes before starting staff reviews.'} action={canManage ? <Button component={Link} href={`/competency/${kind}/new`} variant="contained">New {singular}</Button> : undefined}>
    {bootstrap.isLoading ? <LoadingCompetency /> : bootstrap.error ? <CompetencyFailure error={bootstrap.error} retry={() => void bootstrap.mutate()}/> : !readable ? <DeniedCompetency /> : <>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} mb={3}><TextField label={`Search ${kind}`} value={search} onChange={event => setSearch(event.target.value)} size="small" fullWidth/><TextField select label="Status" value={status} onChange={event => setStatus(event.target.value)} size="small" sx={{ minWidth: 160 }}><MenuItem value="active">Active</MenuItem><MenuItem value="archived">Archived</MenuItem><MenuItem value="all">All statuses</MenuItem></TextField></Stack>
      {rows.isLoading ? <LoadingCompetency /> : rows.error ? <CompetencyFailure error={rows.error} retry={() => void rows.mutate()}/> : !shown.length ? <Surface><Typography variant="h6">{search ? 'No matching results' : `No ${kind} yet`}</Typography><Typography color="text.secondary" mt={1}>{search ? 'Try another name or status.' : `Create a ${singular} to get started.`}</Typography></Surface> : <Stack spacing={1}>{shown.map(row => <Surface key={row.id}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Box><Typography component={Link} href={`/competency/${kind}/${row.id}`} fontWeight={650} sx={{ color: 'var(--suite-ink)', textDecoration: 'none', fontSize: 18 }}>{row.name || row.title}</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)', mt: 1 }}>{row.sourceType === 'sfia' ? 'SFIA' : row.sourceType === 'internal' ? 'Internal framework' : kind === 'roles' ? 'Occupational role profile' : kind === 'strategies' ? 'Strategic outcome criteria' : 'Configured assessment cycle'}{typeof row.version === 'number' && Number.isFinite(row.version) ? ` · v${row.version}` : ''}{row.updatedAt ? ` · Updated ${new Date(row.updatedAt).toLocaleDateString()}` : ''}</Typography></Box><Stack direction="row" gap={1} alignItems="center"><Chip size="small" label={row.archivedAt ? 'Archived' : row.status === 'published' || row.currentVersionId ? 'Published' : 'Draft'} variant="outlined"/><Button component={Link} href={`/competency/${kind}/${row.id}`}>Open {singular}</Button></Stack></Stack></Surface>)}</Stack>}
    </>}
  </CompetencyPage>;
}
