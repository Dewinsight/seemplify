'use client';
import { useId, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { competencyDownload, competencyError, competencyRequest, newIdempotencyKey } from '@/lib/competency-api';
import { useAuth } from '@/context/AuthContext';
import { Assessment, displayDate, Evidence, permitted } from './types';
import { muted, Section } from './ui';
import EvidenceRetention from './EvidenceRetention';

export interface CvEvidencePanelProps {
  assessment: Assessment;
  refresh: () => Promise<void>;
  required?: boolean;
}

const closed = (assessment: Assessment) => !['draft', 'in_progress', 'reopened'].includes(assessment.status);
function unavailable(source: Evidence) {
  return source.sourceUnavailable || ['deleted', 'expired', 'deletion_pending', 'deletion_failed'].includes(source.status || '')
    || (!source.legalHold && !!source.retention?.expiresAt && new Date(source.retention.expiresAt).getTime() <= Date.now());
}
function sourceState(source: Evidence) {
  if (source.status === 'deletion_failed') return 'Source removal failed. Retry CV removal.';
  if (source.status === 'deletion_pending') return 'Source removal is pending.';
  if (unavailable(source)) return 'Source no longer available';
  if (source.status === 'ready') return 'Ready';
  if (source.scanStatus === 'failed' || source.scanStatus === 'rejected' || source.status === 'failed') return 'File check failed. Choose another CV or retry the upload.';
  return 'File check in progress. Refresh to check availability.';
}

export default function CvEvidencePanel({ assessment, refresh, required }: CvEvidencePanelProps) {
  const { user } = useAuth();
  const actorId = String(user?.id || user?.sub || '');
  // The server includes organisation-wide and currently eligible assessor scope.
  // An explicit false must override a historical assignment in the snapshot.
  const isAssessor = assessment.viewerIsAssessor ?? assessment.assessors.some(actor => actor.userId === actorId);
  const inputId = useId();
  const helpId = useId();
  const input = useRef<HTMLInputElement>(null);
  const requestKey = useRef(newIdempotencyKey());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [uploaded, setUploaded] = useState<Evidence | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const sources = (assessment.evidence || []).filter(source => source.documentType === 'cv');
  if (uploaded && !sources.some(source => source.id === uploaded.id)) sources.push(uploaded);
  const canView = permitted(assessment.allowedActions, 'evidence.view');
  const canUpload = permitted(assessment.allowedActions, 'evidence.create') && !closed(assessment);
  const requested = assessment.definitionSnapshot.cvRequested === true || assessment.cvRequested === true;
  const cvRequired = required ?? assessment.definitionSnapshot.cvRequired === true;
  const role = assessment.definitionSnapshot.role;

  function selectFile(next: File | null) {
    setSaved(''); setError(''); setFile(null);
    requestKey.current = newIdempotencyKey();
    if (!next) return;
    if (!/\.(pdf|docx|txt)$/i.test(next.name)) setError('Choose a PDF, DOCX or TXT file for the CV.');
    else if (!next.size || next.size > 10 * 1024 * 1024) setError('Choose a non-empty CV file up to 10 MiB.');
    else { setFile(next); return; }
    if (input.current) input.current.value = '';
  }
  async function reload() {
    setBusy(true); setError('');
    try { await refresh(); setRefreshFailed(false); }
    catch { setRefreshFailed(true); setError('The CV list could not be refreshed. Retry to see the latest files.'); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(''); setSaved('');
    const form = new FormData();
    form.append('file', file); form.append('title', file.name);
    form.append('documentType', 'cv'); form.append('visibility', 'participant');
    try {
      const source = await competencyRequest<Evidence>('POST', `/assessments/${assessment.id}/evidence`, form, undefined, requestKey.current);
      setUploaded(source); setFile(null); if (input.current) input.current.value = '';
      setSaved('CV saved. Your reviewer can use it as supporting evidence.');
      requestKey.current = newIdempotencyKey();
      try { await refresh(); setRefreshFailed(false); }
      catch { setRefreshFailed(true); setError('Your CV was saved, but the list could not be refreshed. Retry the list refresh.'); }
    } catch (reason) { setError(competencyError(reason).message); }
    finally { setBusy(false); }
  }
  async function download(source: Evidence) {
    setBusy(true); setError('');
    try { await competencyDownload(`/assessments/${assessment.id}/evidence/${source.id}/source`, source.originalName || source.title || 'cv'); }
    catch (reason) { setError(competencyError(reason).message); }
    finally { setBusy(false); }
  }
  async function remove(source: Evidence) {
    if (!window.confirm(`Remove ${source.originalName || source.title || 'this CV'}? Existing references will show that the source is unavailable.`)) return;
    setBusy(true); setError(''); setSaved('');
    try {
      await competencyRequest('DELETE', `/assessments/${assessment.id}/evidence/${source.id}`);
      if (uploaded?.id === source.id) setUploaded(null);
      await refresh();
      setSaved(cvRequired ? 'CV removed. Upload a CV before submitting this self-assessment.' : 'CV removed. A CV remains optional for this appraisal.');
    } catch (reason) { setError(competencyError(reason).message); }
    finally { setBusy(false); }
  }

  return <Section title={`CV (${cvRequired ? 'required' : 'optional'})`}>
    <Stack gap={2}>
      <Box>
        <Typography fontWeight={600}>{role.name} · Version {role.version}</Typography>
        <Typography variant="body2" sx={muted}>{cvRequired ? 'Upload your current CV before submitting your self-assessment.' : requested ? 'A current CV was requested for this appraisal. A missing CV does not block submission.' : 'You can add a current CV as optional evidence for this role.'}</Typography>
      </Box>
      {error && <Alert severity="error" action={refreshFailed ? <Button color="inherit" disabled={busy} onClick={() => void reload()}>Retry refresh</Button> : undefined}>{error}</Alert>}
      {saved && <Alert severity="success" role="status">{saved}</Alert>}
      {!canView ? <Alert severity="info">You do not have permission to view CV evidence for this assessment.</Alert> : sources.length ? <Stack component="ul" gap={2} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
        {sources.map(source => <Box component="li" key={source.id} sx={{ borderTop: '1px solid var(--suite-line)', pt: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
            <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <Typography fontWeight={600}>{source.originalName || source.title || 'CV'}</Typography>
              <Typography variant="body2" sx={muted}>{source.createdBy?.name ? `Uploaded by ${source.createdBy.name} · ` : ''}{displayDate(source.createdAt)}{source.size !== undefined ? ` · ${Math.max(1, Math.ceil(source.size / 1024))} KB` : ''}</Typography>
              <Typography variant="body2" sx={muted}>Participant and assessors · {sourceState(source)}</Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
              {!unavailable(source) && source.status === 'ready' && source.kind === 'file' && <Button variant="outlined" disabled={busy} aria-label={`Download CV ${source.originalName || source.title || ''}`.trim()} onClick={() => void download(source)}>Download CV</Button>}
              {permitted(assessment.allowedActions, 'retention.manage') && <EvidenceRetention assessmentId={assessment.id} evidence={source} refresh={refresh}/>}
              {permitted(assessment.allowedActions, 'evidence.delete') && (isAssessor || source.createdBy?.userId === actorId) && source.status !== 'deleted' && <Button color="error" disabled={busy || source.legalHold} onClick={() => void remove(source)}>{source.status === 'deletion_failed' ? 'Retry CV removal' : 'Remove CV'}</Button>}
            </Stack>
          </Stack>
        </Box>)}
      </Stack> : <Typography variant="body2" sx={muted}>{cvRequired ? 'No CV uploaded yet. You can save your draft and add it before submitting.' : 'No CV uploaded. You can continue without one.'}</Typography>}
      {canUpload ? <Box component="form" onSubmit={event => { event.preventDefault(); void upload(); }} aria-busy={busy}>
        <Stack gap={1.5}>
          <Typography component="label" htmlFor={inputId} fontWeight={600}>Choose CV file</Typography>
          <Box component="input" id={inputId} ref={input} type="file" accept=".pdf,.docx,.txt" disabled={busy} aria-describedby={helpId} onChange={event => selectFile(event.target.files?.[0] || null)} sx={{ width: '100%', maxWidth: '100%', color: 'var(--suite-ink)', fontSize: 14, '&:focus-visible': { outline: '2px solid var(--suite-accent)', outlineOffset: 3 } }}/>
          <Typography id={helpId} variant="body2" sx={muted}>PDF, DOCX or TXT · up to 10 MiB. Private to the participant and authorised assessors. Uploading does not change your score or start AI processing.</Typography>
          <Box><Button type="submit" variant="contained" disabled={!file || busy}>{busy ? 'Uploading CV…' : error && file ? 'Retry CV upload' : 'Upload CV'}</Button></Box>
        </Stack>
      </Box> : <Typography variant="body2" sx={muted}>{closed(assessment) ? 'This assessment is read-only. Existing CVs remain available to authorised viewers.' : 'You do not have permission to upload a CV for this assessment.'}</Typography>}
      {canView && sources.some(source => !unavailable(source) && source.status !== 'ready') && <Box><Button disabled={busy} onClick={() => void reload()}>Refresh CV status</Button></Box>}
    </Stack>
  </Section>;
}
