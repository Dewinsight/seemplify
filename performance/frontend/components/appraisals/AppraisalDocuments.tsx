'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import { useUserContext } from '@/lib/hooks';
import { resolvePerformanceApiUrl } from '@/lib/runtimeConfig';

interface AppraisalDocument {
  _id: string;
  originalName: string;
  status?: string;
  uploadedBy?: { userId?: string };
  category?: string;
  textExtraction?: { status?: string; extractedText?: string; wordCount?: number };
}

interface Props {
  appraisalId: string;
  documents?: AppraisalDocument[];
  disabled?: boolean;
  readOnly?: boolean;
  onChanged: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
  kind?: 'cv' | 'supporting';
  excludeCv?: boolean;
  cvRequired?: boolean;
}

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

export default function AppraisalDocuments({ appraisalId, documents = [], disabled = false, readOnly = false, onChanged, onBusyChange, kind = 'supporting', excludeCv = false, cvRequired = false }: Props) {
  const { user } = useUserContext();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false);
  const [remove, setRemove] = useState<AppraisalDocument | null>(null);
  const [savedDocument, setSavedDocument] = useState<AppraisalDocument | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [success, setSuccess] = useState('');
  const isCv = kind === 'cv';
  useEffect(() => {
    if (savedDocument && documents.some(document => document._id === savedDocument._id)) setSavedDocument(null);
  }, [documents, savedDocument]);
  const retained = documents.filter(document => document && document._id && document.status !== 'deleted');
  if (savedDocument && !retained.some(document => document._id === savedDocument._id)) retained.push(savedDocument);
  const visibleDocuments = retained.filter(document => isCv ? document.category === 'cv' : !excludeCv || document.category !== 'cv');
  const blocked = disabled || Boolean(busy);
  const begin = (action: string) => { setBusy(action); setError(''); onBusyChange?.(true); };
  const finish = () => { setBusy(''); onBusyChange?.(false); };
  const refresh = async () => {
    try { await onChanged(); setRefreshFailed(false); }
    catch { setRefreshFailed(true); setError('The file was saved, but the list could not be refreshed. Refresh the list to check it.'); }
  };

  const upload = async () => {
    if (!file || blocked || readOnly) return;
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('Choose a non-empty file no larger than 10 MiB.'); return; }
    if (isCv && !/\.(pdf|docx|txt)$/i.test(file.name)) { setError('Choose a PDF, DOCX or TXT file for your CV.'); return; }
    begin('upload');
    setSuccess('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('visibility', 'employee_manager');
      body.append('assessmentMode', 'form');
      if (isCv) body.append('category', 'cv');
      const response = await api.post(`/appraisals/${appraisalId}/documents`, body, { headers: { 'Content-Type': undefined } });
      setSavedDocument(response.data.data);
      setFile(null);
      setUploadFailed(false);
      setSuccess(isCv ? 'CV saved. Your reviewer can use it as supporting evidence.' : 'Document saved.');
      await refresh();
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
      if (savedDocument?._id === remove._id) setSavedDocument(null);
      setRemove(null);
      setSuccess('');
      await onChanged();
    } catch (requestError) { setError(errorMessage(requestError, 'Could not remove this document. Please retry.')); }
    finally { finish(); }
  };

  return <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
    <Typography variant="h6" component="h2" fontWeight={600}>{isCv ? `CV (${cvRequired ? 'required' : 'optional'})` : 'Supporting documents'}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
      {isCv ? cvRequired ? 'Upload your current CV before submitting your self-assessment.' : 'Would you like to add your current CV? Your reviewer can use it alongside your self-assessment. You can continue without one.'
        : readOnly ? 'Retained supporting documents available to your role. Download access follows each document’s original audience restrictions.'
        : 'Documents uploaded here are shared with the employee and reviewer as supporting evidence. A ChatGPT connection is not required.'}
    </Typography>
    {error && !remove && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {success && <Alert severity="success" role="status" sx={{ mb: 2 }}>{success}</Alert>}
    {refreshFailed && <Button disabled={blocked} onClick={async () => { begin('refresh'); await refresh(); finish(); }}>Refresh file list</Button>}
    <Stack spacing={1.5}>
      {visibleDocuments.length === 0 && <Typography variant="body2" color="text.secondary">{isCv ? cvRequired ? 'No CV uploaded yet. You can save your draft and add it before submitting.' : 'No CV uploaded. You can continue without one.' : 'No documents attached.'}</Typography>}
      {visibleDocuments.map(document => <Stack key={document._id} role="group" aria-label={document.originalName}
        direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Typography variant="body2">{document.originalName}{!isCv && document.category === 'cv' ? ' · CV' : ''}</Typography>
          {isCv && <Typography variant="body2" color="text.secondary">{document.textExtraction?.status === 'completed' && (document.textExtraction.extractedText?.trim() || (document.textExtraction.wordCount || 0) > 0) ? 'Ready for assessment analysis' : ['failed', 'completed'].includes(document.textExtraction?.status || '') ? 'Text could not be read. Your reviewer can download the CV; try a text-based file for AI analysis.' : 'Text processing has not completed. Refresh the list to check it.'}</Typography>}
        </Box>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button size="small" disabled={blocked} onClick={() => void download(document)}>{isCv ? 'Download CV' : 'Download document'}</Button>
          {!readOnly && [user?.id, user?.sub].filter(Boolean).includes(document.uploadedBy?.userId) && <Button size="small" color="error" disabled={blocked} onClick={() => { setError(''); setRemove(document); }}>{isCv ? 'Remove CV' : 'Remove document'}</Button>}
        </Stack>
      </Stack>)}
      {!readOnly && <Box>
        <Button variant="outlined" disabled={blocked} onClick={() => input.current?.click()}>{isCv ? 'Choose CV file' : 'Choose document'}</Button>
        <input ref={input} type="file" hidden disabled={blocked} aria-label={isCv ? 'Choose CV file' : 'Supporting document'} accept={isCv ? '.pdf,.docx,.txt' : '.pdf,.docx,.txt,.pptx'} onChange={event => {
          setFile(event.target.files?.[0] || null); event.target.value = ''; setError(''); setUploadFailed(false);
        }} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{file?.name || (isCv ? 'PDF, DOCX or TXT · up to 10 MiB' : 'PDF, DOCX, TXT or PPTX · up to 10 MB')}</Typography>
        {isCv && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Shared with you and authorised reviewers. Uploading does not change your score or start AI processing.</Typography>}
      </Box>}
      {!readOnly && file && <Box><Button variant="contained" disabled={blocked} onClick={() => void upload()}>{busy === 'upload' ? 'Uploading…' : uploadFailed ? 'Retry upload' : isCv ? 'Upload CV' : 'Upload document'}</Button></Box>}
    </Stack>
    <Dialog open={Boolean(remove)} onClose={() => { if (!busy) setRemove(null); }} fullWidth maxWidth="xs">
      <DialogTitle>Remove document</DialogTitle>
      <DialogContent>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Typography sx={{ overflowWrap: 'anywhere' }}>Remove {remove?.originalName} from this appraisal?</Typography></DialogContent>
      <DialogActions><Button disabled={Boolean(busy)} onClick={() => setRemove(null)}>Cancel</Button><Button color="error" disabled={blocked} onClick={() => void removeDocument()}>{busy.startsWith('remove-') ? 'Removing…' : 'Remove'}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
