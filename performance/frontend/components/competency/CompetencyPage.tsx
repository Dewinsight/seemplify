'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { competencyRequest, competencyError, type CompetencyBootstrap } from '@/lib/competency-api';
import type { ReactNode } from 'react';

export const useCompetencyBootstrap = () => useSWR<CompetencyBootstrap>('competency-bootstrap', () => competencyRequest('GET', '/bootstrap'), { revalidateOnFocus: false });
export function CompetencyPage({ title, description, children, action }: { title: string; description: string; children: ReactNode; action?: ReactNode }) {
  const pathname = usePathname();
  return <Box sx={{ color: 'var(--suite-ink)', maxWidth: 1440, mx: 'auto', '& .MuiPaper-root': { bgcolor: 'var(--suite-surface)', color: 'var(--suite-ink)', borderColor: 'var(--suite-line)' }, '& .MuiInputBase-root, & .MuiTextField-root .MuiInputBase-root': { bgcolor: 'var(--suite-surface-muted)', color: 'var(--suite-ink)' }, '& .MuiInputLabel-root, & .MuiFormHelperText-root': { color: 'var(--suite-muted)' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--suite-line-strong)' }, '& .MuiButton-textPrimary, & .MuiButton-outlinedPrimary': { color: 'var(--suite-ink)', borderColor: 'var(--suite-line-strong)' }, '& .MuiButton-root:focus-visible': { outline: '2px solid var(--suite-accent)', outlineOffset: 3 }, '& .MuiButton-containedPrimary': { bgcolor: 'var(--suite-action)', color: 'var(--suite-action-ink)' } }}>
    <Button component={Link} href="/appraisals" size="small" sx={{ mb: 2 }}>Back to appraisals</Button>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} mb={3}>
      <Box><Typography component="h1" variant="h4" fontWeight={700}>{title}</Typography><Typography sx={{ color: 'var(--suite-muted)', mt: 1, maxWidth: 720 }}>{description}</Typography></Box>{action}
    </Stack>
    <Stack component="nav" aria-label="Competency assessments" direction="row" gap={1} sx={{ overflowX: 'auto', borderBottom: '1px solid var(--suite-line)', pb: 2, mb: 3 }}>
      {[['Overview', '/competency'], ['Assessments', '/competency/assessments'], ['Role library', '/competency/roles'], ['Frameworks', '/competency/frameworks'], ['Strategy', '/competency/strategies'], ['Cycles', '/competency/cycles']].map(([label, href]) => <Button key={href} component={Link} href={href} aria-current={(href === '/competency' ? pathname === href : pathname.startsWith(href)) ? 'page' : undefined} variant={(href === '/competency' ? pathname === href : pathname.startsWith(href)) ? 'contained' : 'text'} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</Button>)}
    </Stack>{children}
  </Box>;
}
export function Surface({ children }: { children: ReactNode }) { return <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2 }}>{children}</Paper>; }
export function LoadingCompetency() { return <Stack role="status" direction="row" alignItems="center" gap={2} py={5}><CircularProgress size={24} /><Typography>Loading assessment details…</Typography></Stack>; }
export function CompetencyFailure({ error, retry }: { error: unknown; retry?: () => void }) { const failure = competencyError(error); return <Alert severity="error" action={retry ? <Button color="inherit" onClick={retry}>Try again</Button> : undefined}>{failure.message}</Alert>; }
export function DeniedCompetency() { return <Alert severity="info">You do not have permission to configure this area. <Link href="/appraisals">Back to my appraisals</Link></Alert>; }
