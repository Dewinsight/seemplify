'use client';
import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { AssessmentSource, categoryNames, SourcePreview, stateName } from '@/lib/assessment-presentation';

export function SourceLibrary({ sources, onOpen }: { sources: AssessmentSource[]; onOpen: (refs: string[]) => void }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [page, setPage] = useState(0);
  const filtered = sources.filter(source => (category === 'all' || source.category === category) && `${source.title} ${source.ref || ''} ${categoryNames[source.category] || source.category}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 8) - 1));
  const start = currentPage * 8;
  return <Stack spacing={2}>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
      <TextField size="small" label="Find a source" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} sx={{ flex: 1 }} />
      <TextField select size="small" label="Evidence type" value={category} onChange={event => { setCategory(event.target.value); setPage(0); }} sx={{ minWidth: { sm: 220 } }}>
        <MenuItem value="all">All evidence types</MenuItem>{Object.entries(categoryNames).filter(([key]) => sources.some(source => source.category === key)).map(([key, title]) => <MenuItem key={key} value={key}>{title}</MenuItem>)}
      </TextField>
    </Stack>
    <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>{filtered.slice(start, start + 8).map(source => <Box component="li" key={source.id} sx={{ py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box minWidth={0} flex={1}><Typography fontWeight={600}>{source.title}</Typography><Typography variant="body2" color="text.secondary">{categoryNames[source.category] || 'Evidence'} · {stateName(source.state)}</Typography></Box>
      <Button size="small" variant="outlined" disabled={!source.ref} onClick={() => onOpen([source.ref!])} aria-label={`View source: ${source.title}`}>View</Button>
    </Box>)}</Box>
    {!filtered.length && <Typography color="text.secondary">No sources match these filters.</Typography>}
    {!!filtered.length && <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}><Typography variant="body2" color="text.secondary">{start + 1}–{Math.min(start + 8, filtered.length)} of {filtered.length} sources</Typography><Stack direction="row"><Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button disabled={start + 8 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</Button></Stack></Stack>}
  </Stack>;
}

export function SourceReader({ refs, sources, previews, onClose }: { refs: string[] | null; sources: AssessmentSource[]; previews: SourcePreview[]; onClose: () => void }) {
  const [selection, setSelection] = useState<{ refs: string[] | null; ref: string }>({ refs: null, ref: '' });
  const visible = (refs || []).map(ref => sources.find(source => source.ref === ref)).filter((source): source is AssessmentSource => Boolean(source));
  const selected = selection.refs === refs ? selection.ref : refs?.[0];
  const source = visible.find(item => item.ref === selected) || visible[0];
  const preview = previews.find(item => item.ref === source?.ref);
  return <Dialog open={refs !== null} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="assessment-source-heading">
    <DialogTitle id="assessment-source-heading">Assessment sources</DialogTitle>
    <DialogContent dividers><Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'minmax(180px,.75fr) minmax(0,1.5fr)' }, gap: 3 }}>
      <Box><TextField select size="small" label="Cited source" value={source?.ref || ''} onChange={event => setSelection({ refs, ref: event.target.value })} fullWidth sx={{ display: { xs: 'block', sm: 'none' } }}>{visible.map(item => <MenuItem key={item.ref} value={item.ref}>{item.title}</MenuItem>)}</TextField>
        <Stack component="nav" aria-label="Sources cited in this passage" spacing={.75} sx={{ display: { xs: 'none', sm: 'flex' }, maxHeight: 440, overflowY: 'auto' }}>{visible.map(item => <Button key={item.ref} color="inherit" variant={item.ref === source?.ref ? 'outlined' : 'text'} onClick={() => setSelection({ refs, ref: item.ref! })} aria-current={item.ref === source?.ref ? 'true' : undefined} sx={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}>{item.title}</Button>)}</Stack>
      </Box>
      {source ? <Box minWidth={0}><Typography component="h3" variant="h6">{source.title}</Typography><Stack direction="row" gap={1} flexWrap="wrap" mt={1} mb={2}><Chip size="small" label={categoryNames[source.category] || 'Evidence'} /><Chip size="small" variant="outlined" label={stateName(source.state)} /></Stack>
        {preview?.text ? <><Typography variant="body2" color="text.secondary" mb={1}>Source excerpt{preview.truncated ? ' · shortened for preview' : ''}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.75 }}>{preview.text}</Typography></> : <Typography color="text.secondary">This source contains structured ratings or review settings. Its recorded values are shown in the overview when available.</Typography>}
        {source.includedCharacters !== undefined && source.characters !== undefined && source.includedCharacters < source.characters && <Typography variant="body2" color="text.secondary" mt={2}>The AI assessment used an excerpt of this source.</Typography>}
      </Box> : <Typography color="text.secondary">These sources are no longer available in this view. Refresh the assessment to review the current evidence.</Typography>}
    </Box></DialogContent><DialogActions><Button onClick={onClose}>Back to assessment</Button></DialogActions>
  </Dialog>;
}
