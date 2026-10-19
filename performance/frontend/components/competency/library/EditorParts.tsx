'use client';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { competencyError } from '@/lib/competency-api';
import { useState, type ReactNode } from 'react';
export function EditorError({ error, reload, draft }: { error: unknown; reload?: () => void; draft?: unknown }) {
  const [copied, setCopied] = useState('');
  const serialize = () => JSON.stringify(draft, null, 2);
  function download() {
    const url = URL.createObjectURL(new Blob([serialize()], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'my-assessment-changes.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setCopied('Your current edits were downloaded.');
  }
  async function copy() {
    try { await navigator.clipboard.writeText(serialize()); setCopied('Your current edits were copied.'); }
    catch { setCopied('Clipboard is unavailable. Download your changes before reloading.'); }
  }
  if (!error) return null;
  const value = competencyError(error);
  return <Alert severity="error" role="alert" sx={{ mb: 2 }}><Typography>{value.message}</Typography>{value.fields?.map(f => <Typography key={f.path} variant="body2">{f.message}</Typography>)}{value.status === 409 && reload && <><Stack direction="row" gap={1} mt={1} flexWrap="wrap"><Button color="inherit" onClick={reload}>Compare latest version</Button>{draft !== undefined && <><Button color="inherit" onClick={() => void copy()}>Copy my changes</Button><Button color="inherit" onClick={download}>Download my changes</Button></>}</Stack>{copied && <Typography role="status" variant="body2">{copied}</Typography>}</>}</Alert>;
}
export function EditorActions({ children, status }: {
    children: ReactNode;
    status: string;
}) { return <Box sx={{ position: 'sticky', bottom: 12, zIndex: 3, mt: 3, p: 2, bgcolor: 'var(--suite-surface)', border: '1px solid var(--suite-line)', borderRadius: 2, boxShadow: '0 8px 24px #00000012' }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2}><Typography variant="body2" role="status" sx={{ color: 'var(--suite-muted)' }}>{status}</Typography><Stack direction="row" gap={1} flexWrap="wrap">{children}</Stack></Stack></Box>; }
export function ConfirmDialog({ open, title, children, action, onConfirm, onClose, busy = false }: {
    open: boolean;
    title: string;
    children: ReactNode;
    action: string;
    onConfirm: () => void;
    onClose: () => void;
    busy?: boolean;
}) { return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>{title}</DialogTitle><DialogContent>{children}</DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="contained" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : action}</Button></DialogActions></Dialog>; }
