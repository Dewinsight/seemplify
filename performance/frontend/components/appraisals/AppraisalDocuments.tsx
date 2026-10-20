'use client';

import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import { useUserContext } from '@/lib/hooks';
import { resolvePerformanceApiUrl } from '@/lib/runtimeConfig';

interface AppraisalDocument {
  _id: string;
  originalName: string;
  status?: string;
  uploadedBy?: { userId?: string };
}

interface Props {
  appraisalId: string;
  documents?: AppraisalDocument[];
  disabled?: boolean;
  readOnly?: boolean;
  onChanged: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

export default function AppraisalDocuments({ appraisalId, documents = [], disabled = false, readOnly = false, onChanged, onBusyChange }: Props) {
  const { user } = useUserContext();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false);
  const [remove, setRemove] = useState<AppraisalDocument | null>(null);
  const visibleDocuments = documents.filter(document => document && document._id && document.status !== 'deleted');
  const blocked = disabled || Boolean(busy);
  const begin = (action: string) => { setBusy(action); setError(''); onBusyChange?.(true); };
  const finish = () => { setBusy(''); onBusyChange?.(false); };

  const upload = async () => {
    if (!file || blocked || readOnly) return;
    if (file.size > 10 * 1024 * 1024) { setError('Choose a document no larger than 10 MB.'); return; }
    begin('upload');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('visibility', 'employee_manager');
      body.append('assessmentMode', 'form');
      await api.post(`/appraisals/${appraisalId}/documents`, body, { headers: { 'Content-Type': undefined } });
      setFile(null);
      setUploadFailed(false);
      await onChanged();
    } catch (requestError) {
      setUploadFailed(true);
      setError(errorMessage(requestError, 'Failed to upload document. Please retry.'));
    } finally { finish(); }
  };

  const download = async (document: AppraisalDocument) => {
    begin(`download-${document._id}`);
    try {
      // Check authorization before navigating. The content route redirects to
      // the captured provider; browser navigation avoids credentialed CORS.
      await api.get(`/appraisals/${appraisalId}/documents/${document._id}`);
      const link = window.document.createElement('a');
      link.href = `${resolvePerformanceApiUrl()}/appraisals/${appraisalId}/documents/${document._id}/content`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      window.document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (requestError) { setError(errorMessage(requestError, 'Could not download this document. Please retry.')); }
    finally { finish(); }
  };

  const removeDocument = async () => {
    if (!remove || blocked || readOnly) return;
    begin(`remove-${remove._id}`);
    try {
      await api.delete(`/appraisals/${appraisalId}/documents/${remove._id}`);
      setRemove(null);
      await onChanged();
    } catch (requestError) { setError(errorMessage(requestError, 'Could not remove this document. Please retry.')); }
    finally { finish(); }
  };

  return <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
    <Typography variant="h6" component="h2" fontWeight={600}>Supporting documents</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
      Documents uploaded here are shared with the employee and reviewer as supporting evidence. A ChatGPT connection is not required.
    </Typography>
    {error && !remove && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Stack spacing={1.5}>
      {visibleDocuments.length === 0 && <Typography variant="body2" color="text.secondary">No documents attached.</Typography>}
      {visibleDocuments.map(document => <Stack key={document._id} role="group" aria-label={document.originalName}
        direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{document.originalName}</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button size="small" disabled={blocked} onClick={() => void download(document)}>Download document</Button>
          {!readOnly && [user?.id, user?.sub].filter(Boolean).includes(document.uploadedBy?.userId) && <Button size="small" color="error" disabled={blocked} onClick={() => { setError(''); setRemove(document); }}>Remove document</Button>}
        </Stack>
      </Stack>)}
      {!readOnly && <Box>
        <Button variant="outlined" disabled={blocked} onClick={() => input.current?.click()}>Choose document</Button>
        <input ref={input} type="file" hidden aria-label="Supporting document" accept=".pdf,.docx,.txt,.pptx" onChange={event => {
          setFile(event.target.files?.[0] || null); event.target.value = ''; setError(''); setUploadFailed(false);
        }} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{file?.name || 'PDF, DOCX, TXT or PPTX · up to 10 MB'}</Typography>
      </Box>}
      {!readOnly && file && <Box><Button variant="contained" disabled={blocked} onClick={() => void upload()}>{busy === 'upload' ? 'Uploading…' : uploadFailed ? 'Retry upload' : 'Upload document'}</Button></Box>}
    </Stack>
    <Dialog open={Boolean(remove)} onClose={() => { if (!busy) setRemove(null); }} fullWidth maxWidth="xs">
      <DialogTitle>Remove document</DialogTitle>
      <DialogContent>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Typography sx={{ overflowWrap: 'anywhere' }}>Remove {remove?.originalName} from this appraisal?</Typography></DialogContent>
      <DialogActions><Button disabled={Boolean(busy)} onClick={() => setRemove(null)}>Cancel</Button><Button color="error" disabled={blocked} onClick={() => void removeDocument()}>{busy.startsWith('remove-') ? 'Removing…' : 'Remove'}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
