'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import api from '@/lib/api';

export const dynamic = 'force-dynamic';

interface HistoricalEvaluation { content?: string; rating?: number | null; submittedAt?: string; aiRefinement?: string }
interface HistoricalReview {
  _id: string; cycleName?: string; status?: string; dueDate?: string;
  selfEvaluation?: HistoricalEvaluation; managerEvaluation?: HistoricalEvaluation;
  peerReviews?: Array<{ status?: string; content?: string; rating?: number | null }>;
}

function recordedDate(value?: string) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString();
}

function Evaluation({ title, evaluation }: { title: string; evaluation?: HistoricalEvaluation }) {
  return <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
    <Typography component="h2" variant="h6" gutterBottom>{title}</Typography>
    <Typography variant="body2" color="text.secondary">Recorded rating: {evaluation?.rating ?? 'Not recorded'} · Submitted: {recordedDate(evaluation?.submittedAt)}</Typography>
    <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{evaluation?.content || 'No evaluation text recorded.'}</Typography>
    {evaluation?.aiRefinement && <Box sx={{ mt: 2 }}><Typography variant="subtitle2">Historical AI refinement</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{evaluation.aiRefinement}</Typography></Box>}
  </Paper>;
}

export default function HistoricalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: review, error, isLoading, isValidating, mutate } = useSWR<HistoricalReview>(
    id ? `/reviews/${id}` : null,
    async (url: string) => (await api.get(url)).data.data,
    { shouldRetryOnError: false }
  );
  return <Box sx={{ maxWidth: 1000, mx: 'auto', pb: 8 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 3 }}>
      <Button component={Link} href="/appraisals?section=history">Back to appraisal history</Button>
      <Button component={Link} href="/appraisals">Current appraisals</Button>
    </Stack>
    <Typography component="h1" variant="h4" fontWeight={700} gutterBottom>Historical review</Typography>
    <Alert severity="info" sx={{ mb: 3 }}>This review is retained as a read-only historical record. Start and complete new reviews in Appraisals.</Alert>
    {isLoading && <CircularProgress aria-label="Loading historical review" />}
    {error && <Alert severity="warning" aria-busy={isValidating} action={<Button color="inherit" disabled={isValidating} onClick={() => { void mutate().catch(() => undefined); }}>{isValidating ? 'Retrying…' : 'Retry historical review'}</Button>}>{error.response?.status === 403 ? 'You do not have access to this historical review.' : error.response?.status === 404 ? 'This historical review could not be found.' : 'Could not load this historical review. Try again.'}</Alert>}
    {!isLoading && !error && review && <Stack spacing={2}>
      <Box><Typography variant="h5" gutterBottom>{review.cycleName || 'Historical review cycle'}</Typography><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"><Chip size="small" variant="outlined" label={review.status || 'Status not recorded'} /><Typography variant="body2" color="text.secondary">Review due date: {recordedDate(review.dueDate)}</Typography></Stack></Box>
      <Evaluation title="Self evaluation" evaluation={review.selfEvaluation} />
      <Evaluation title="Manager evaluation" evaluation={review.managerEvaluation} />
      {!!review.peerReviews?.length && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Typography component="h2" variant="h6" gutterBottom>Recorded peer feedback</Typography><Stack spacing={2}>{review.peerReviews.map((peer, index) => <Box key={index}><Typography variant="body2" color="text.secondary">Feedback {index + 1} · Rating: {peer.rating ?? 'Not recorded'}{peer.status ? ` · ${peer.status}` : ''}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{peer.content || 'No feedback text recorded.'}</Typography></Box>)}</Stack></Paper>}
    </Stack>}
  </Box>;
}
