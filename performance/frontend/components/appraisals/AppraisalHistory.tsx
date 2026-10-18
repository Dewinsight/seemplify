'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { Download, Print } from '@mui/icons-material';
import { AppraisalResultItem, downloadResultsCsv, hasPublishedResult, resultCycleName, resultPeriodEnd, resultRating, shortDate, newestAppraisalsFirst } from '@/lib/appraisal-results';
import ResultPrintStyles from './ResultPrintStyles';
import AppraisalMetadata from './AppraisalMetadata';

export default function AppraisalHistory({ appraisals, showEmployee, organizationName }: { appraisals: AppraisalResultItem[]; showEmployee: boolean; organizationName?: string }) {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('newest');
  const years = useMemo(() => Array.from(new Set(appraisals.map((item) => resultPeriodEnd(item).slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))).sort().reverse(), [appraisals]);
  const results = useMemo(() => {
    const ordered = newestAppraisalsFirst(appraisals.filter((item) => (
      (year === 'all' || resultPeriodEnd(item).startsWith(year))
      && [resultCycleName(item), item.employee?.name, item.manager?.name, item.finalRating?.ratingLabel].some((text) => String(text || '').toLowerCase().includes(search.toLowerCase().trim()))
    )));
    return sort === 'newest' ? ordered : ordered.reverse();
  }, [appraisals, search, sort, year]);
  const completed = results.filter((item) => hasPublishedResult(item.status));
  const exportResults = () => downloadResultsCsv([
    ['Employee', 'Appraisal', 'Period start', 'Period end', 'Manager', 'Final result', 'Rating label', 'Status', 'Finalized'],
    ...results.map((item) => [item.employee?.name || '', resultCycleName(item), item.cycleConfigurationSnapshot?.periodStart || item.cycleId?.periodStart || '', resultPeriodEnd(item), item.manager?.name || '', resultRating(item), item.finalRating?.ratingLabel || '', item.status === 'cancelled' ? 'Cancelled' : item.status === 'employee_acknowledged' ? 'Acknowledged' : 'Completed', shortDate(item.finalRating?.finalizedAt)]),
  ], 'appraisal-results.csv');

  return <Box className="appraisal-print" sx={{ mt: 3 }}>
    <ResultPrintStyles />
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} mb={2}>
      <Box><Typography variant="h5" fontWeight={700}>Appraisal results report</Typography><Typography color="text.secondary">{organizationName ? `${organizationName} · ` : ''}{completed.length} completed review{completed.length === 1 ? '' : 's'}{year !== 'all' ? ` · ${year}` : ' · All years'}</Typography></Box>
      <Stack direction="row" spacing={1} className="no-print"><Button startIcon={<Download />} variant="outlined" onClick={exportResults} disabled={!results.length}>Download CSV</Button><Button startIcon={<Print />} variant="outlined" onClick={() => window.print()} disabled={!results.length}>Print report</Button></Stack>
    </Stack>
    <Stack className="no-print" direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
      <TextField label="Search past appraisals" value={search} onChange={(event) => setSearch(event.target.value)} size="small" sx={{ flex: 1 }} />
      <TextField select label="Review year" value={year} onChange={(event) => setYear(event.target.value)} size="small" sx={{ minWidth: 150 }}><MenuItem value="all">All years</MenuItem>{years.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
      <TextField select label="Sort results" value={sort} onChange={(event) => setSort(event.target.value)} size="small" sx={{ minWidth: 160 }}><MenuItem value="newest">Newest first</MenuItem><MenuItem value="oldest">Oldest first</MenuItem></TextField>
    </Stack>
    {!results.length ? <Alert severity="info">{appraisals.length ? 'No past appraisals match these filters.' : 'Your completed and cancelled appraisals will appear here across all cycles.'}{(search || year !== 'all') && <Button onClick={() => { setSearch(''); setYear('all'); }}>Clear filters</Button>}</Alert> : <Stack spacing={1.5}>
      {results.map((item) => <Paper className="result-row" variant="outlined" key={item._id} sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Box sx={{ minWidth: 0 }}><Typography variant="h6" fontSize={17} fontWeight={650}>{resultCycleName(item)}</Typography>{showEmployee && <Typography>{item.employee?.name}</Typography>}<Typography variant="body2" color="text.secondary">{shortDate(item.cycleConfigurationSnapshot?.periodStart || item.cycleId?.periodStart)} – {shortDate(resultPeriodEnd(item))}</Typography><Typography variant="body2" color="text.secondary">Reviewer: {item.manager?.name || 'Not recorded'}</Typography></Box>
          <Stack spacing={1} alignItems={{ xs: 'flex-start', sm: 'flex-end' }}>
            <Typography fontWeight={700}>{item.status === 'cancelled' ? 'Cancelled' : resultRating(item)}</Typography>
            {hasPublishedResult(item.status) && item.finalRating?.ratingLabel && <Typography variant="body2">{item.finalRating.ratingLabel}</Typography>}
            <Chip size="small" variant="outlined" label={item.status === 'employee_acknowledged' ? 'Acknowledged' : item.status === 'cancelled' ? 'Cancelled' : 'Completed · awaiting acknowledgement'} />
            <Button className="no-print" component={Link} href={hasPublishedResult(item.status) ? `/appraisals/${item._id}/report` : `/appraisals/${item._id}`} variant="outlined">{hasPublishedResult(item.status) ? 'View result report' : 'View appraisal'}</Button>
          </Stack>
        </Stack>
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}><AppraisalMetadata appraisal={item} /></Box>
      </Paper>)}
    </Stack>}
  </Box>;
}
