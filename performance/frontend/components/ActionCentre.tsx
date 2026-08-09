'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AccessTime,
  ArrowForward,
  DoneAll,
  NotificationsNone,
} from '@mui/icons-material';
import api from '@/lib/api';

export type ActionStatus = 'open' | 'snoozed' | 'completed' | 'dismissed';

export interface ActionCentreItem {
  _id: string;
  eventId?: string;
  eventType?: string;
  category?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  message?: string;
  deepLink?: string;
  action?: { kind?: string; label?: string };
  target?: { type?: string; id?: string };
  dueAt?: string;
  readAt?: string;
  actionStatus?: ActionStatus;
  snoozedUntil?: string;
  createdAt: string;
}

function getItems(payload: any): ActionCentreItem[] {
  const data = payload?.data?.data ?? payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export function formatRelativeDate(value?: string) {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const delta = timestamp - Date.now();
  const hours = Math.round(Math.abs(delta) / 3_600_000);
  if (hours < 1) return delta < 0 ? 'Just now' : 'Within an hour';
  if (hours < 24) return delta < 0 ? `${hours}h ago` : `In ${hours}h`;
  const days = Math.round(hours / 24);
  return delta < 0 ? `${days}d ago` : `In ${days}d`;
}

export function ActionCentreBell() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<ActionCentreItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [listResponse, countResponse] = await Promise.all([
        api.get('/notifications', { params: { limit: 8 } }),
        api.get('/notifications/counts'),
      ]);
      setItems(getItems(listResponse).slice(0, 8));
      const counts = countResponse?.data?.data ?? countResponse?.data ?? {};
      setUnread(Number(counts.unread ?? 0));
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.response?.data?.message || 'Notifications are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const refresh = () => void loadNotifications();
    window.addEventListener('focus', refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(interval);
    };
  }, [loadNotifications]);

  const openNotification = async (item: ActionCentreItem) => {
    if (!item.readAt) {
      setItems((current) => current.map((entry) => (
        entry._id === item._id ? { ...entry, readAt: new Date().toISOString() } : entry
      )));
      setUnread((current) => Math.max(0, current - 1));
      try {
        await api.patch(`/notifications/${item._id}/read`);
      } catch {
        void loadNotifications();
      }
    }
    setAnchorEl(null);
    router.push(item.deepLink || '/action-centre');
  };

  const markAllRead = async () => {
    setUnread(0);
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    try {
      await api.patch('/notifications/read-all');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.response?.data?.message || 'Could not mark notifications as read.');
      void loadNotifications();
    }
  };

  return (
    <>
      <Tooltip title="Notifications and action centre">
        <IconButton
          aria-label={`${unread} unread notifications`}
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
            void loadNotifications(true);
          }}
          size="small"
          sx={{ color: 'text.secondary' }}
        >
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNone fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 24px)', mt: 1 } } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
          <Box>
            <Typography fontWeight={700}>Notifications</Typography>
            <Typography variant="caption" color="text.secondary">
              {unread ? `${unread} unread` : 'You are up to date'}
            </Typography>
          </Box>
          {unread > 0 && (
            <Button size="small" startIcon={<DoneAll />} onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </Stack>
        <Divider />
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>
        ) : error ? (
          <Alert severity="warning" sx={{ m: 2 }}>{error}</Alert>
        ) : items.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No notifications yet.</Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.map((item, index) => (
              <Box key={item._id}>
                {index > 0 && <Divider component="li" />}
                <ListItemButton
                  onClick={() => void openNotification(item)}
                  sx={{ alignItems: 'flex-start', px: 2, py: 1.5, bgcolor: item.readAt ? 'transparent' : 'action.hover' }}
                >
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor: item.readAt ? 'transparent' : 'primary.main',
                      mt: 0.8,
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={<Typography variant="body2" fontWeight={item.readAt ? 500 : 700}>{item.title}</Typography>}
                    secondary={(
                      <>
                        {item.message && <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{item.message}</Typography>}
                        <Typography component="span" variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>{formatRelativeDate(item.createdAt)}</Typography>
                      </>
                    )}
                  />
                </ListItemButton>
              </Box>
            ))}
          </List>
        )}
        <Divider />
        <Button
          fullWidth
          endIcon={<ArrowForward />}
          onClick={() => {
            setAnchorEl(null);
            router.push('/action-centre');
          }}
          sx={{ justifyContent: 'space-between', px: 2, py: 1.25 }}
        >
          Open action centre
        </Button>
      </Popover>
    </>
  );
}

export function ActionDueLabel({ item }: { item: ActionCentreItem }) {
  const label = useMemo(() => {
    if (item.actionStatus === 'snoozed' && item.snoozedUntil) return `Snoozed · ${formatRelativeDate(item.snoozedUntil)}`;
    if (item.dueAt) return `Due ${formatRelativeDate(item.dueAt).toLowerCase()}`;
    return formatRelativeDate(item.createdAt);
  }, [item]);

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <AccessTime sx={{ fontSize: 14 }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}
