'use client';
import { ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
export const controls = {
  '& .MuiButton-root': { minHeight: 44, '&:focus-visible': { outline: '3px solid var(--suite-accent)', outlineOffset: 2 } },
  '& .MuiButton-root.MuiButton-containedPrimary:not(.Mui-disabled)': { backgroundColor: 'var(--suite-action)', color: 'var(--suite-action-ink)', '&:hover': { opacity: .9 } },
  '& .MuiButton-root.MuiButton-outlinedPrimary:not(.Mui-disabled)': { color: 'var(--suite-ink)', borderColor: 'var(--suite-line-strong)', '&:hover': { backgroundColor: 'var(--suite-surface-muted)' } },
  '& .MuiButton-root.MuiButton-textPrimary:not(.Mui-disabled)': { color: 'var(--suite-ink)' },
  '& .MuiTabs-root .MuiTab-root': { color: 'var(--suite-muted)', '&:focus-visible': { outline: '3px solid var(--suite-accent)', outlineOffset: -3 } },
  '& .MuiTabs-root .MuiTab-root.Mui-selected': { color: 'var(--suite-accent)' },
  '& .MuiTabs-root .MuiTabs-indicator': { backgroundColor: 'var(--suite-accent)' },
  '& .MuiTextField-root .MuiOutlinedInput-root': { backgroundColor: 'var(--suite-surface-muted)' },
  '& .MuiTextField-root .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--suite-line-strong)' },
  '& .MuiLinearProgress-bar': { background: 'var(--suite-accent)' },
};
export const panel = { ...controls, p: { xs: 2, md: 3 }, background: 'var(--suite-surface)', border: '1px solid var(--suite-line)', borderRadius: '12px', color: 'var(--suite-ink)', boxShadow: 'none' };
export const muted = { color: 'var(--suite-muted)' };
export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <Paper sx={panel}><Stack direction="row" justifyContent="space-between" alignItems="center" gap={2} mb={2}><Typography component="h2" variant="h6" fontWeight={650}>{title}</Typography>{action}</Stack>{children}</Paper>; }
export function Loading({ label = 'Loading assessment…' }: { label?: string }) { return <Box role="status" aria-busy="true" sx={{ p: 5, display: 'flex', alignItems: 'center', gap: 2 }}><CircularProgress size={24}/><Typography>{label}</Typography></Box>; }
export function Failure({ message, retry, conflict }: { message: string; retry?: () => void; conflict?: boolean }) { return <Alert severity={conflict ? 'warning' : 'error'} action={retry && <Button color="inherit" onClick={retry}>{conflict ? 'Load current version' : 'Retry'}</Button>}>{message}</Alert>; }
export function Empty({ children }: { children: ReactNode }) { return <Box sx={{ py: 4, ...muted }}>{children}</Box>; }
