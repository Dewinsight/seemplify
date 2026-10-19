'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { competencyRequest, competencyError } from '@/lib/competency-api';
import { Assessment, displayDate, human, rows } from './types';
import { controls, Empty, Failure, Loading, muted, Section } from './ui';
export default function AssessmentList() {
  type Summary = Omit<Assessment,'definitionSnapshot'> & {role: {name:string;version:number}};
  const [list, setList] = useState<Summary[] | null>(null); const [error, setError] = useState(''); const [status, setStatus] = useState('all'); const [search, setSearch] = useState('');
  const load = useCallback(async () => { setError(''); try { setList(rows(await competencyRequest<Summary[]>('GET', '/assessments'))); } catch (e) { setError(competencyError(e).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = list?.filter(a => (status === 'all' || a.status === status) && `${a.participant.name} ${a.role.name}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return <Box sx={{ ...controls, color: 'var(--suite-ink)', maxWidth: 1300, mx: 'auto' }}><Stack direction={{ xs:'column', sm:'row' }} justifyContent="space-between" gap={2} mb={3}><Box><Typography component="h1" variant="h4" fontWeight={650}>Competency assessments</Typography><Typography sx={{ ...muted, mt: 1 }}>Review people against their selected role, with evidence for every finding.</Typography></Box><Button component={Link} href="/competency/cycles" variant="outlined">Assessment cycles</Button></Stack>
    {error && <Failure message={error} retry={load}/>}{!list && !error ? <Loading label="Loading your assessments…"/> : list && <Section title="Your assessments"><Typography sx={{ ...muted, mb: 2 }}>Showing the people you are allowed to view. Newest assessments appear first.</Typography><Stack direction={{xs:'column',sm:'row'}} gap={2} mb={3}><TextField label="Search people or roles" value={search} onChange={e=>setSearch(e.target.value)} fullWidth/><TextField select label="Status" value={status} onChange={e=>setStatus(e.target.value)} sx={{ minWidth: 200 }}><MenuItem value="all">All statuses</MenuItem>{['draft','in_progress','published','reopened'].map(s=><MenuItem key={s} value={s}>{human(s)}</MenuItem>)}</TextField></Stack>
      {!filtered?.length ? <Empty>{list.length ? 'No assessments match these filters.' : 'No assessments are available in your scope. Assigned assessments will appear here.'}</Empty> : filtered.map(a=><Box key={a.id} sx={{ borderTop:'1px solid var(--suite-line)', py:2.5 }}><Stack direction={{ xs:'column',sm:'row' }} justifyContent="space-between" alignItems={{xs:'start',sm:'center'}} gap={2}><Box sx={{minWidth:0}}><Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography component="h3" variant="h6">{a.participant.name}</Typography><Chip size="small" label={human(a.status)}/></Stack><Typography sx={{mt:.5}}>{a.role.name} · Version {a.role.version}</Typography><Typography variant="body2" sx={muted}>Created {displayDate(a.createdAt)} · Updated {displayDate(a.updatedAt)}</Typography></Box><Button component={Link} href={`/competency/assessments/${a.id}`} variant="outlined">{a.status==='published'?'View assessment':'Open assessment'}</Button></Stack></Box>)}
    </Section>}
  </Box>;
}
