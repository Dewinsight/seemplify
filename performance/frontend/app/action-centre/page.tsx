'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccessTime,
  ArrowForward,
  CheckCircleOutline,
  Close,
  NotificationsNone,
  Refresh,
  SettingsOutlined,
  Snooze,
  TaskAlt,
} from '@mui/icons-material';
import api from '@/lib/api';
import { ActionCentreItem, ActionDueLabel, ActionStatus } from '@/components/ActionCentre';

type ResourceTab = 'actions' | 'notifications' | 'preferences';
type DigestFrequency = 'immediate' | 'daily' | 'weekly' | 'off';

interface NotificationPreferences {
  channels: { inApp: true; email: boolean; chat: boolean };
  digest: { frequency: DigestFrequency; time: string; dayOfWeek: number };
  quietHours: { enabled: boolean; start: string; end: string };
  timezone: string;
}

const defaultNotificationPreferences: NotificationPreferences = {
  channels: { inApp: true, email: false, chat: false },
  digest: { frequency: 'immediate', time: '09:00', dayOfWeek: 1 },
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  timezone: 'UTC',
};

const actionStates: Array<{ value: ActionStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'completed', label: 'Completed' },
  { value: 'dismissed', label: 'Dismissed' },
];

function unpackData(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const outer = response as { data?: unknown };
  const value = outer.data ?? response;
  if (!value || typeof value !== 'object') return value;
  const envelope = value as { data?: unknown };
  return envelope.data ?? value;
}

function unpackItems(response: unknown): ActionCentreItem[] {
  const data = unpackData(response);
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function unpackPreferences(response: unknown): NotificationPreferences {
  const raw = unpackData(response);
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const digest = data.digest && typeof data.digest === 'object' ? data.digest as Record<string, unknown> : {};
  const channels = data.channels && typeof data.channels === 'object' ? data.channels as Record<string, unknown> : {};
  const quietHours = data.quietHours && typeof data.quietHours === 'object' ? data.quietHours as Record<string, unknown> : {};
  const frequency = typeof digest.frequency === 'string' && ['immediate', 'daily', 'weekly', 'off'].includes(digest.frequency)
    ? digest.frequency as DigestFrequency
    : defaultNotificationPreferences.digest.frequency;

  return {
    channels: { inApp: true, email: Boolean(channels.email), chat: Boolean(channels.chat) },
    digest: {
      frequency,
      time: typeof digest.time === 'string' ? digest.time : defaultNotificationPreferences.digest.time,
      dayOfWeek: Number.isInteger(digest.dayOfWeek) ? Number(digest.dayOfWeek) : defaultNotificationPreferences.digest.dayOfWeek,
    },
    quietHours: {
      enabled: Boolean(quietHours.enabled),
      start: typeof quietHours.start === 'string' ? quietHours.start : defaultNotificationPreferences.quietHours.start,
      end: typeof quietHours.end === 'string' ? quietHours.end : defaultNotificationPreferences.quietHours.end,
    },
    timezone: typeof data.timezone === 'string' && data.timezone.trim()
      ? data.timezone
      : defaultNotificationPreferences.timezone,
  };
}

function requestErrorMessage(error: unknown, fallback: string): string {
  const responseData = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  if (typeof responseData?.error === 'string') return responseData.error;
  if (typeof responseData?.message === 'string') return responseData.message;
  return fallback;
}

function priorityColor(priority?: string): 'default' | 'error' | 'warning' | 'info' {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'low') return 'info';
  return 'default';
}

export default function ActionCentrePage() {
  const router = useRouter();
  const [resource, setResource] = useState<ResourceTab>('actions');
  const [status, setStatus] = useState<ActionStatus>('open');
  const [items, setItems] = useState<ActionCentreItem[]>([]);
  const [counts, setCounts] = useState({ open: 0, unread: 0, overdue: 0, dueSoon: 0, snoozed: 0 });
  const [notificationCounts, setNotificationCounts] = useState({ unread: 0, total: 0 });
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [loading, setLoading] = useState(true);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [snoozeAnchor, setSnoozeAnchor] = useState<HTMLElement | null>(null);
  const [snoozeItem, setSnoozeItem] = useState<ActionCentreItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (resource === 'actions') {
        const [listResponse, countResponse] = await Promise.all([
          api.get('/actions', { params: { status, limit: 50 } }),
          api.get('/actions/counts'),
        ]);
        setItems(unpackItems(listResponse));
        const nextCounts = countResponse?.data?.data ?? countResponse?.data ?? {};
        setCounts({
          open: Number(nextCounts.open ?? 0),
          unread: Number(nextCounts.unread ?? 0),
          overdue: Number(nextCounts.overdue ?? 0),
          dueSoon: Number(nextCounts.dueSoon ?? 0),
          snoozed: Number(nextCounts.snoozed ?? 0),
        });
      } else if (resource === 'notifications') {
        const [listResponse, countResponse] = await Promise.all([
          api.get('/notifications', { params: { limit: 50 } }),
          api.get('/notifications/counts'),
        ]);
        setItems(unpackItems(listResponse));
        const nextCounts = countResponse?.data?.data ?? countResponse?.data ?? {};
        setNotificationCounts({ unread: Number(nextCounts.unread ?? 0), total: Number(nextCounts.total ?? 0) });
      } else {
        const response = await api.get('/notifications/preferences');
        setPreferences(unpackPreferences(response));
      }
    } catch (requestError) {
      setError(requestErrorMessage(requestError, `Could not load ${resource}.`));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [resource, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (item: ActionCentreItem, operation: 'complete' | 'dismiss' | 'snooze', until?: Date) => {
    setBusyId(item._id);
    setError('');
    try {
      const body = operation === 'snooze' ? { until: until?.toISOString() } : undefined;
      await api.patch(`/actions/${item._id}/${operation}`, body);
      setNotice(operation === 'complete' ? 'Action completed.' : operation === 'dismiss' ? 'Action dismissed.' : 'Action snoozed.');
      await load();
    } catch (requestError) {
      setError(requestErrorMessage(requestError, `Could not ${operation} this action.`));
    } finally {
      setBusyId('');
    }
  };

  const openItem = async (item: ActionCentreItem) => {
    if (!item.readAt) {
      setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, readAt: new Date().toISOString() } : entry));
      if (resource === 'notifications') setNotificationCounts((current) => ({ ...current, unread: Math.max(0, current.unread - 1) }));
      try {
        await api.patch(`/notifications/${item._id}/read`);
      } catch {
        void load();
      }
    }
    if (item.deepLink) router.push(item.deepLink);
  };

  const markAllRead = async () => {
    setBusyId('all');
    try {
      await api.patch('/notifications/read-all');
      setNotice('All notifications marked as read.');
      await load();
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Could not mark all notifications as read.'));
    } finally {
      setBusyId('');
    }
  };

  const savePreferences = async () => {
    if (!preferences.timezone.trim()) {
      setError('Enter a timezone, for example Europe/London.');
      return;
    }

    setPreferencesSaving(true);
    setError('');
    try {
      const response = await api.patch('/notifications/preferences', {
        channels: {
          inApp: true,
          email: preferences.channels.email,
          chat: preferences.channels.chat,
        },
        digest: {
          frequency: preferences.digest.frequency,
          time: preferences.digest.time,
          dayOfWeek: preferences.digest.dayOfWeek,
        },
        quietHours: preferences.quietHours,
        timezone: preferences.timezone.trim(),
      });
      setPreferences(unpackPreferences(response));
      setNotice('Notification preferences saved.');
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Could not save notification preferences.'));
    } finally {
      setPreferencesSaving(false);
    }
  };

  const emptyCopy = useMemo(() => {
    if (resource === 'notifications') return 'No notifications have arrived yet.';
    if (status === 'open') return 'Nothing needs your attention right now.';
    if (status === 'snoozed') return 'You have not snoozed any actions.';
    if (status === 'completed') return 'Completed actions will appear here.';
    return 'Dismissed actions will appear here.';
  }, [resource, status]);

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>Action centre</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            A single place for goal decisions, acknowledgements, check-ins, feedback, and review follow-ups.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => void load()} disabled={loading} sx={{ alignSelf: { sm: 'flex-start' } }}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={resource} onChange={(_, value) => setResource(value)} aria-label="Action centre sections">
          <Tab value="actions" icon={<TaskAlt />} iconPosition="start" label={`My actions${counts.open ? ` (${counts.open})` : ''}`} />
          <Tab value="notifications" icon={<NotificationsNone />} iconPosition="start" label={`Notifications${notificationCounts.unread ? ` (${notificationCounts.unread})` : ''}`} />
          <Tab value="preferences" icon={<SettingsOutlined />} iconPosition="start" label="Preferences" />
        </Tabs>
      </Paper>

      {resource === 'actions' ? (
        <>
          <Paper variant="outlined" sx={{ mb: 2, overflowX: 'auto' }}>
            <Tabs value={status} onChange={(_, value) => setStatus(value)} aria-label="Action status">
              {actionStates.map((state) => (
                <Tab
                  key={state.value}
                  value={state.value}
                  label={`${state.label}${state.value === 'open' && counts.open ? ` (${counts.open})` : state.value === 'snoozed' && counts.snoozed ? ` (${counts.snoozed})` : ''}`}
                />
              ))}
            </Tabs>
          </Paper>
          {status === 'open' && (counts.overdue > 0 || counts.dueSoon > 0) && (
            <Alert severity={counts.overdue > 0 ? 'warning' : 'info'} sx={{ mb: 2 }}>
              {counts.overdue > 0 && `${counts.overdue} overdue`}
              {counts.overdue > 0 && counts.dueSoon > 0 && ' · '}
              {counts.dueSoon > 0 && `${counts.dueSoon} due soon`}
            </Alert>
          )}
        </>
      ) : resource === 'notifications' ? (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button startIcon={<CheckCircleOutline />} onClick={markAllRead} disabled={!notificationCounts.unread || busyId === 'all'}>
            Mark all read
          </Button>
        </Stack>
      ) : loading ? (
        <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>
      ) : (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720 }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" component="h2" fontWeight={700}>Notification preferences</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Choose how external channels should prompt you about performance work.
              </Typography>
            </Box>

            <Alert severity="info">
              In-app notifications remain on for required work. External channels send generic prompts with secure links; sensitive performance information stays in Seemplify.
            </Alert>

            <Box>
              <Typography fontWeight={600}>Channels</Typography>
              <FormControlLabel
                sx={{ mt: 1, display: 'flex', alignItems: 'flex-start' }}
                control={(
                  <Switch
                    checked={preferences.channels.email}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      channels: { ...current.channels, inApp: true, email: event.target.checked },
                    }))}
                  />
                )}
                label={(
                  <Box sx={{ pt: 0.75 }}>
                    <Typography variant="body2" fontWeight={600}>Email notifications</Typography>
                    <Typography variant="caption" color="text.secondary">Receive performance prompts outside the app.</Typography>
                  </Box>
                )}
              />
              <FormControlLabel
                sx={{ mt: 1, display: 'flex', alignItems: 'flex-start' }}
                control={(
                  <Switch
                    checked={preferences.channels.chat}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      channels: { ...current.channels, inApp: true, chat: event.target.checked },
                    }))}
                  />
                )}
                label={(
                  <Box sx={{ pt: 0.75 }}>
                    <Typography variant="body2" fontWeight={600}>Chat notifications</Typography>
                    <Typography variant="caption" color="text.secondary">Receive a generic prompt and secure link in your configured work chat.</Typography>
                  </Box>
                )}
              />
            </Box>

            <Divider />

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <FormControl fullWidth>
                <InputLabel id="notification-digest-label">Digest</InputLabel>
                <Select
                  labelId="notification-digest-label"
                  label="Digest"
                  value={preferences.digest.frequency}
                  onChange={(event) => setPreferences((current) => ({
                    ...current,
                    digest: { ...current.digest, frequency: event.target.value as DigestFrequency },
                  }))}
                >
                  <MenuItem value="immediate">Immediate</MenuItem>
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="off">Off</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Timezone"
                value={preferences.timezone}
                onChange={(event) => setPreferences((current) => ({ ...current, timezone: event.target.value }))}
                helperText="Use an IANA timezone, such as Europe/London."
              />
            </Box>

            <Divider />

            <Box>
              <FormControlLabel
                control={(
                  <Switch
                    checked={preferences.quietHours.enabled}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      quietHours: { ...current.quietHours, enabled: event.target.checked },
                    }))}
                  />
                )}
                label="Use quiet hours"
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2 }}>
                Hold external prompts during this window. In-app work remains available.
              </Typography>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                <TextField
                  label="Quiet hours start"
                  type="time"
                  value={preferences.quietHours.start}
                  disabled={!preferences.quietHours.enabled}
                  onChange={(event) => setPreferences((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, start: event.target.value },
                  }))}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Quiet hours end"
                  type="time"
                  value={preferences.quietHours.end}
                  disabled={!preferences.quietHours.enabled}
                  onChange={(event) => setPreferences((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, end: event.target.value },
                  }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>
            </Box>

            <Box>
              <Button variant="contained" onClick={() => void savePreferences()} disabled={preferencesSaving}>
                {preferencesSaving ? 'Saving...' : 'Save preferences'}
              </Button>
            </Box>
          </Stack>
        </Paper>
      )}

      {resource !== 'preferences' && (loading ? (
        <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 8, px: 3, textAlign: 'center' }}>
          <Typography fontWeight={600}>{emptyCopy}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            New work will appear automatically when somebody assigns or requests something from you.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {items.map((item) => {
            const isBusy = busyId === item._id;
            const unread = resource === 'notifications' && !item.readAt;
            return (
              <Card key={item._id} variant="outlined" sx={{ borderLeftWidth: unread ? 3 : 1, borderLeftColor: unread ? 'primary.main' : 'divider' }}>
                <CardContent>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography fontWeight={700}>{item.title}</Typography>
                        {unread && <Chip label="New" color="primary" size="small" />}
                        {item.priority && item.priority !== 'normal' && (
                          <Chip label={item.priority} color={priorityColor(item.priority)} size="small" variant="outlined" />
                        )}
                        {item.category && <Chip label={item.category.replaceAll('_', ' ')} size="small" variant="outlined" />}
                      </Stack>
                      {item.message && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{item.message}</Typography>}
                      <Box sx={{ mt: 1 }}><ActionDueLabel item={item} /></Box>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
                      {item.deepLink && (
                        <Button size="small" variant={resource === 'notifications' ? 'contained' : 'outlined'} endIcon={<ArrowForward />} onClick={() => void openItem(item)}>
                          {item.action?.label || 'Open'}
                        </Button>
                      )}
                      {resource === 'actions' && status === 'open' && (
                        <>
                          {(item.action?.kind === 'complete' || item.readAt) && (
                            <Button size="small" startIcon={<CheckCircleOutline />} onClick={() => void act(item, 'complete')} disabled={isBusy}>
                              Mark done
                            </Button>
                          )}
                          <IconButton
                            size="small"
                            aria-label="Snooze action"
                            onClick={(event) => { setSnoozeItem(item); setSnoozeAnchor(event.currentTarget); }}
                            disabled={isBusy}
                          >
                            <Snooze fontSize="small" />
                          </IconButton>
                          <IconButton size="small" aria-label="Dismiss action" onClick={() => void act(item, 'dismiss')} disabled={isBusy}>
                            <Close fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      ))}

      <Menu anchorEl={snoozeAnchor} open={Boolean(snoozeAnchor)} onClose={() => setSnoozeAnchor(null)}>
        <MenuItem
          onClick={() => {
            const until = new Date();
            until.setDate(until.getDate() + 1);
            if (snoozeItem) void act(snoozeItem, 'snooze', until);
            setSnoozeAnchor(null);
          }}
        >
          <AccessTime fontSize="small" sx={{ mr: 1 }} /> Tomorrow
        </MenuItem>
        <MenuItem
          onClick={() => {
            const until = new Date();
            until.setDate(until.getDate() + 7);
            if (snoozeItem) void act(snoozeItem, 'snooze', until);
            setSnoozeAnchor(null);
          }}
        >
          <AccessTime fontSize="small" sx={{ mr: 1 }} /> Next week
        </MenuItem>
      </Menu>

      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
