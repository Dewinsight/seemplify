'use client';
import { useState } from 'react';
import useSWR, { mutate as refresh } from 'swr';
import { useRouter } from 'next/navigation';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Menu, MenuItem, Stack, TextField } from '@mui/material';
import { MoreHoriz } from '@mui/icons-material';
import api from '@/lib/api';

type Permissions = { canCancel: boolean; canRemove: boolean; canRestore: boolean; canRetry: boolean; cleanupPending: boolean };
const messages = {
  cancel: { title: 'Cancel appraisal', confirm: 'Cancel appraisal', description: 'Stop this review and its outstanding calls and reminders. Assessments, recordings and notes remain in History. To review again, start a new appraisal.' },
  remove: { title: 'Remove appraisal', confirm: 'Move to Removed', description: 'Remove this appraisal from current work, History and appraisal analytics. Any active review is cancelled first. Its assessments, recordings and notes are kept. Published competency reports remain available to authorized viewers. An authorized reviewer or HR can restore it from Removed appraisals.' },
  restore: { title: 'Restore appraisal', confirm: 'Restore to History', description: 'Return this appraisal to History. A cancelled review stays cancelled; its calls and reminders will not restart.' },
  retry: { title: 'Retry outstanding cancellations', confirm: 'Retry cancellations', description: 'Retry cancelling the outstanding calendar invitations and reminders. The appraisal will stay closed and its saved evidence will be kept.' },
};
export default function AppraisalActions({ appraisalId, employeeName, enabled = true, onUpdated, restoreOnly = false }: { appraisalId: string; employeeName?: string; enabled?: boolean; onUpdated: () => void; restoreOnly?: boolean }) {
  const router = useRouter();
  const { data, error: permissionError, mutate } = useSWR<Permissions>(enabled ? `/appraisals/lifecycle/${appraisalId}` : null, async url => (await api.get(url)).data.data);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [action, setAction] = useState<keyof typeof messages | null>(null);
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!enabled || (permissionError as { response?: { status: number } })?.response?.status === 403) return null;
  if (permissionError) return <Alert severity="warning" action={<Button onClick={() => mutate()}>Retry</Button>}>Appraisal controls could not be loaded.</Alert>;
  if (!data) return null;
  const choose = (value: keyof typeof messages) => { setAnchor(null); setReason(''); setError(''); setAction(value); };
  const submit = async () => {
    if (!action) return;
    setBusy(true); setError('');
    try {
      await api.post(`/appraisals/lifecycle/${appraisalId}/${action}`, { confirm: true, reason });
      await mutate(); onUpdated();
      await refresh(key => typeof key === 'string' && (key.startsWith('/appraisals') || key.startsWith('/dashboard') || key.startsWith('/one-on-ones') || key.startsWith('/manager-insights')));
      setAction(null);
      if (action === 'remove') router.push('/appraisals/removed');
      else if (action === 'restore') router.push(`/appraisals/${appraisalId}`);
    } catch (failure) {
      setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'The appraisal could not be updated. Please retry.');
      await mutate(); onUpdated();
    } finally { setBusy(false); }
  };
  return <Stack spacing={1} alignItems="flex-start">
    {data.cleanupPending && <Alert severity="warning" action={data.canRetry ? <Button disabled={busy} onClick={() => choose('retry')}>Retry cancellation</Button> : undefined}>This appraisal is closed. Some calendar invitations or reminders still need cancellation.{!data.canRetry && ' Contact HR or an organization administrator to complete the cancellation.'}</Alert>}
    {restoreOnly ? data.canRestore && <Button variant="outlined" onClick={() => choose('restore')}>Restore appraisal</Button> : (data.canCancel || data.canRemove) && <>
      <Button startIcon={<MoreHoriz />} variant="outlined" aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)}>Manage appraisal</Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {data.canCancel && <MenuItem onClick={() => choose('cancel')}>Cancel appraisal</MenuItem>}
        {data.canRemove && <MenuItem onClick={() => choose('remove')}>Remove appraisal</MenuItem>}
      </Menu>
    </>}
    <Dialog open={Boolean(action)} onClose={() => { if (!busy) setAction(null); }} maxWidth="sm" fullWidth aria-labelledby="appraisal-action-title">
      {action && <><DialogTitle id="appraisal-action-title">{messages[action].title}{employeeName ? ` for ${employeeName}?` : '?'}</DialogTitle><DialogContent>
        <DialogContentText>{messages[action].description}</DialogContentText>
        {['cancel', 'remove'].includes(action) && <TextField fullWidth multiline minRows={2} label="Reason (optional)" value={reason} onChange={event => setReason(event.target.value)} disabled={busy} slotProps={{ htmlInput: { maxLength: 1000 } }} sx={{ mt: 3 }} />}
        {error && <Alert severity="error" sx={{ mt: 2 }} role="alert">{error}</Alert>}
      </DialogContent><DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}><Button disabled={busy} onClick={() => setAction(null)}>{action === 'restore' ? 'Keep in Removed' : action === 'retry' ? 'Go back' : 'Keep appraisal'}</Button><Button variant="contained" color={action === 'restore' ? 'primary' : 'error'} disabled={busy} onClick={submit}>{busy ? 'Updating…' : messages[action].confirm}</Button></DialogActions></>}
    </Dialog>
  </Stack>;
}
