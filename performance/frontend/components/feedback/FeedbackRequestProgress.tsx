'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import api from '@/lib/api';

export interface FeedbackRequestStatus {
  _id?: string;
  kind?: 'cohort' | 'confidential_summary';
  cohortId?: string;
  subjectId: string;
  subjectInfo?: { name?: string; email?: string };
  reviewerInfo?: { name?: string; email?: string };
  reviewerId?: string;
  contextType?: string;
  contextLabel?: string;
  questions?: string[];
  dueDate?: string;
  visibility?: string;
  anonymity?: string;
  minimumCohortSize?: number;
  reviewerCount?: number;
  reportable?: boolean;
  responseCount?: number | null;
  state: string;
}

export default function FeedbackRequestProgress({ view, revision, ownIds, onViewResponses }: {
  view: 'requested' | 'subject'; revision: number; ownIds: Set<string>; onViewResponses: () => void;
}) {
  const [items, setItems] = useState<FeedbackRequestStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await api.get('/feedback/requests', { params: { view } });
      const data = response.data?.data;
      if (!Array.isArray(data)) throw new Error('Invalid request status response');
      setItems(data);
    } catch { setError('Could not load feedback request status. Please retry.'); }
    finally { setLoading(false); }
  }, [view]);
  useEffect(() => { void load(); }, [load, revision]);

  return <Stack spacing={1.5}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Typography component="h2" variant="h6">{view === 'requested' ? 'Requested by me' : 'About me'}</Typography>
      <Button disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh status'}</Button>
    </Stack>
    {loading && <LinearProgress aria-label="Loading feedback request status" />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={() => void load()}>Retry status</Button>}>{error}</Alert>}
    {!loading && !error && items.length === 0 && <Paper variant="outlined" sx={{ p: 3 }}><Typography>No feedback requests yet.</Typography></Paper>}
    {items.map((item, index) => {
      const summary = Boolean(item.kind);
      const anonymous = item.kind === 'cohort';
      return <Paper key={item._id || item.cohortId || `${item.subjectId}-${index}`} component="article"
        aria-label={`${item.contextLabel || 'Feedback request'} for ${item.subjectInfo?.name || item.subjectInfo?.email || 'employee'}`} variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{item.contextLabel || 'Feedback request'}</Typography>
          <Chip size="small" label={anonymous ? 'Anonymous 360' : item.anonymity === 'confidential' ? 'Confidential' : 'Named'} />
          <Chip size="small" variant="outlined" label={item.state} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 1 }}>Feedback about {item.subjectInfo?.name || item.subjectInfo?.email || 'employee'}</Typography>
        {!summary && item.reviewerInfo && <Typography variant="body2">Reviewer: {item.reviewerInfo.name || item.reviewerInfo.email}</Typography>}
        {item.dueDate && <Typography variant="body2" color="text.secondary">Due {new Date(item.dueDate).toLocaleDateString()} · {item.visibility}</Typography>}
        {summary && <Typography variant="body2" sx={{ mt: 1 }}>{item.reviewerCount} invited · {item.reportable && typeof item.responseCount === 'number'
          ? `${item.responseCount} responses available to permitted readers`
          : `Collecting responses. Anonymous content stays unavailable until at least ${item.minimumCohortSize || 5} responses are received.`}</Typography>}
        {anonymous && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Individual reviewer identities and response progress are not shown.</Typography>}
        {item.questions?.length ? <Stack component="ul" sx={{ pl: 2.5, mb: 0 }}>{item.questions.map(question => <Typography component="li" variant="body2" key={question}>{question}</Typography>)}</Stack> : null}
        {ownIds.has(item.subjectId) && (item.reportable || (!summary && item.state === 'fulfilled')) && <Button sx={{ mt: 1 }} onClick={onViewResponses}>View received responses</Button>}
      </Paper>;
    })}
  </Stack>;
}
