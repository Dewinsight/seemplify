'use client';
import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogTitle, DialogActions } from '@mui/material';
import { EventOutlined } from '@mui/icons-material';
import CalendarAccount from './CalendarAccount';

export default function CalendarAccountControl({ connectionPath }: { connectionPath: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outlined" startIcon={<EventOutlined />} onClick={() => setOpen(true)}>My calendar account</Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="calendar-account-heading">
      <DialogTitle id="calendar-account-heading">Calendar connected through Nylas</DialogTitle>
      <DialogContent><CalendarAccount connectionPath={connectionPath} /></DialogContent>
      <DialogActions><Button color="inherit" onClick={() => setOpen(false)}>Close</Button></DialogActions>
    </Dialog>
  </>;
}
