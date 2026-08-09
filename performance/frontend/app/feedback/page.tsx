'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Check, Lightbulb, Send, ThumbUp } from '@mui/icons-material';
import api from '@/lib/api';
import { useDirectReports, useFeedback, useMyAppraisals, useUserContext, useUserSearch } from '@/lib/hooks';

type FeedbackTab = 'all' | 'received' | 'sent' | 'requests';
type FeedbackType = 'praise' | 'coaching' | 'general';

interface PersonOption {
  id: string;
  name: string;
  email?: string;
  title?: string;
}

interface FeedbackRequestItem {
  _id: string;
  subjectId: string;
  subjectInfo?: { name?: string; email?: string };
  requesterInfo?: { name?: string; email?: string };
  contextType?: string;
  contextLabel?: string;
  questions?: string[];
  visibility?: string;
  dueDate?: string;
  state: string;
}

interface AppraisalOption {
  _id: string;
  organizationId?: string | { _id?: string; id?: string };
  status?: string;
  cycleId?: string | {
    _id?: string;
    name?: string;
    periodStart?: string;
    periodEnd?: string;
  };
}

const typeLabels: Record<string, string> = {
  praise: 'Praise',
  Positive: 'Praise',
  coaching: 'Coaching',
  Constructive: 'Coaching',
  general: 'General',
  General: 'General',
};

function personFrom(value: any): PersonOption | null {
  const id = value?.id || value?._id || value?.userId || value?.idpSub;
  if (!id) return null;
  return {
    id: String(id),
    name: value?.name || value?.displayName || value?.profile?.displayName || value?.email || 'Employee',
    email: value?.email,
    title: value?.title || value?.jobTitle || value?.profile?.title,
  };
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function normalizeId(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value._id || value.id || value);
}

function appraisalLabel(appraisal?: AppraisalOption) {
  if (!appraisal) return 'Active appraisal';
  const cycle = typeof appraisal.cycleId === 'object' ? appraisal.cycleId : null;
  const name = cycle?.name || 'Performance appraisal';
  const dates = [formatDate(cycle?.periodStart), formatDate(cycle?.periodEnd)].filter(Boolean).join(' – ');
  return dates ? `${name} · ${dates}` : name;
}

export default function FeedbackPage() {
  const { feedback, isLoading, isError, mutate } = useFeedback();
  const { appraisals } = useMyAppraisals();
  const { user, isManager, organization } = useUserContext();
  const { directReports } = useDirectReports();
  const [tab, setTab] = useState<FeedbackTab>('all');
  const [requests, setRequests] = useState<FeedbackRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState<PersonOption | null>(null);
  const [search, setSearch] = useState('');
  const { users: searchResults, isLoading: searchLoading } = useUserSearch(search);
  const [type, setType] = useState<FeedbackType>('praise');
  const [visibility, setVisibility] = useState('private');
  const [contextType, setContextType] = useState('general');
  const [contextLabel, setContextLabel] = useState('');
  const [requestId, setRequestId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [acknowledgingId, setAcknowledgingId] = useState('');
  const [evidenceItem, setEvidenceItem] = useState<any | null>(null);
  const [evidenceAppraisalId, setEvidenceAppraisalId] = useState('');
  const [evidenceSaving, setEvidenceSaving] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');

  const currentUserIds = useMemo(() => new Set([
    user?.id,
    user?._id,
    user?.userId,
    user?.idpSub,
    user?.sub,
  ].filter(Boolean).map(String)), [user]);

  const suggestions = useMemo(() => {
    const byId = new Map<string, PersonOption>();
    [...(directReports || []), ...(searchResults || [])].forEach((entry: any) => {
      const person = personFrom(entry);
      if (person && !currentUserIds.has(person.id)) byId.set(person.id, person);
    });
    if (recipient) byId.set(recipient.id, recipient);
    return [...byId.values()];
  }, [currentUserIds, directReports, recipient, searchResults]);

  const activeAppraisals = useMemo<AppraisalOption[]>(() => {
    const currentOrganizationId = normalizeId(organization);
    if (!currentOrganizationId) return [];
    const lockedStatuses = new Set(['final_review_pending', 'employee_acknowledged', 'completed', 'cancelled']);
    return (Array.isArray(appraisals) ? appraisals : []).filter((appraisal: AppraisalOption) => (
      Boolean(appraisal?._id)
      && normalizeId(appraisal.organizationId) === currentOrganizationId
      && !lockedStatuses.has(String(appraisal.status || ''))
    ));
  }, [appraisals, organization]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const feedbackId = params.get('feedback') || '';
    const linkedRequestId = params.get('request') || '';
    setSelectedFeedbackId(feedbackId);
    setSelectedRequestId(linkedRequestId);
    if (linkedRequestId) setTab('requests');
    const recipientId = params.get('recipientId');
    if (recipientId) {
      const name = params.get('name') || 'Selected employee';
      setRecipient({ id: recipientId, name });
      setSearch(name);
      setOpen(true);
    } else if (params.get('compose') === 'true') {
      setOpen(true);
    }
    const loadRequests = async () => {
      setRequestsLoading(true);
      try {
        const response = await api.get('/feedback/requests', { params: { view: 'reviewer' } });
        const data = response.data?.data || response.data || [];
        setRequests(Array.isArray(data) ? data : []);
      } catch {
        setRequests([]);
      } finally {
        setRequestsLoading(false);
      }
    };
    void loadRequests();
  }, []);

  useEffect(() => {
    const id = selectedFeedbackId || selectedRequestId;
    if (!id) return;
    window.setTimeout(() => document.getElementById(`feedback-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [feedback, requests, selectedFeedbackId, selectedRequestId]);

  const filteredFeedback = useMemo(() => {
    const items = feedback || [];
    if (tab === 'received') return items.filter((item: any) => currentUserIds.has(String(item.receiverId || '')));
    if (tab === 'sent') return items.filter((item: any) => currentUserIds.has(String(item.senderId || '')));
    return items;
  }, [currentUserIds, feedback, tab]);

  const closeDialog = () => {
    if (sending) return;
    setOpen(false);
    setRecipient(null);
    setSearch('');
    setType('praise');
    setVisibility('private');
    setContextType('general');
    setContextLabel('');
    setRequestId('');
    setMessage('');
    setFormError('');
  };

  const sendFeedback = async () => {
    if (!recipient) {
      setFormError('Choose the person who should receive this feedback.');
      return;
    }
    if (message.trim().length < 3) {
      setFormError('Write at least three characters of feedback.');
      return;
    }
    setSending(true);
    setFormError('');
    try {
      await api.post('/feedback', {
        receiverId: recipient.id,
        receiverName: recipient.name,
        receiverEmail: recipient.email,
        content: message.trim(),
        type,
        visibility,
        contextType,
        contextLabel: contextLabel.trim() || undefined,
        requestId: requestId || undefined,
      });
      await mutate();
      if (requestId) setRequests((current) => current.map((item) => item._id === requestId ? { ...item, state: 'fulfilled' } : item));
      setNotice(`Feedback sent to ${recipient.name}.`);
      closeDialog();
    } catch (requestError: any) {
      setFormError(requestError?.response?.data?.error || requestError?.response?.data?.message || 'Could not send feedback.');
    } finally {
      setSending(false);
    }
  };

  const acknowledge = async (id: string) => {
    setAcknowledgingId(id);
    try {
      await api.post(`/feedback/${id}/acknowledge`);
      await mutate();
      setNotice('Feedback acknowledged.');
    } catch (requestError: any) {
      setNotice(requestError?.response?.data?.error || 'Could not acknowledge this feedback.');
    } finally {
      setAcknowledgingId('');
    }
  };

  const openEvidenceDialog = (item: any) => {
    const existingAppraisalId = normalizeId(item.appraisalEvidence?.appraisalId);
    setEvidenceItem(item);
    setEvidenceAppraisalId(existingAppraisalId || activeAppraisals[0]?._id || '');
    setEvidenceError('');
  };

  const closeEvidenceDialog = () => {
    if (evidenceSaving) return;
    setEvidenceItem(null);
    setEvidenceAppraisalId('');
    setEvidenceError('');
  };

  const updateAppraisalEvidence = async () => {
    if (!evidenceItem || !evidenceAppraisalId) return;
    const included = !evidenceItem.appraisalEvidence?.included;
    setEvidenceSaving(true);
    setEvidenceError('');
    try {
      await api.post(`/feedback/${evidenceItem._id}/appraisal-evidence`, {
        included,
        appraisalId: evidenceAppraisalId,
      });
      await mutate();
      setNotice(included ? 'Feedback added to your appraisal evidence.' : 'Feedback removed from your appraisal evidence.');
      setEvidenceItem(null);
      setEvidenceAppraisalId('');
    } catch (requestError: any) {
      setEvidenceError(requestError?.response?.data?.error || 'Could not update appraisal evidence.');
    } finally {
      setEvidenceSaving(false);
    }
  };

  const decideRequest = async (request: FeedbackRequestItem, decision: 'accept' | 'decline') => {
    setSending(true);
    setFormError('');
    try {
      const response = await api.post(`/feedback/requests/${request._id}/decision`, { decision });
      const updated = response.data?.data || response.data;
      setRequests((current) => current.map((item) => item._id === request._id ? updated : item));
      setNotice(decision === 'accept' ? 'Feedback request accepted.' : 'Feedback request declined.');
    } catch (requestError: any) {
      setFormError(requestError?.response?.data?.error || 'Could not update this request.');
    } finally {
      setSending(false);
    }
  };

  const respondToRequest = (request: FeedbackRequestItem) => {
    const name = request.subjectInfo?.name || request.subjectInfo?.email || 'Employee';
    setRecipient({ id: request.subjectId, name, email: request.subjectInfo?.email });
    setSearch(name);
    setType('general');
    setVisibility(request.visibility || 'private');
    setContextType(request.contextType || 'general');
    setContextLabel(request.contextLabel || '');
    setRequestId(request._id);
    setOpen(true);
  };

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>Feedback</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Recognize good work and share useful coaching while the context is still fresh.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} sx={{ alignSelf: { sm: 'flex-start' } }}>
          Give feedback
        </Button>
      </Stack>

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Feedback could not be loaded. Try refreshing the page.</Alert>}
      {formError && !open && <Alert severity="error" onClose={() => setFormError('')} sx={{ mb: 2 }}>{formError}</Alert>}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Feedback views">
          <Tab value="all" label="All" />
          <Tab value="received" label="Received" />
          <Tab value="sent" label="Sent" />
          <Tab value="requests" label={`Requests${requests.length ? ` (${requests.length})` : ''}`} />
        </Tabs>
      </Paper>

      {tab === 'requests' ? (
        requestsLoading ? (
          <LinearProgress />
        ) : requests.length === 0 ? (
          <Paper variant="outlined" sx={{ px: 3, py: 7, textAlign: 'center' }}>
            <Typography fontWeight={700}>No feedback requests</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Requests from colleagues and managers will appear here.</Typography>
          </Paper>
        ) : (
          <Stack spacing={1.5}>
            {requests.map((request) => (
              <Card
                key={request._id}
                id={`feedback-${request._id}`}
                variant="outlined"
                sx={{ borderColor: selectedRequestId === request._id ? 'primary.main' : 'divider', borderWidth: selectedRequestId === request._id ? 2 : 1 }}
              >
                <CardContent>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography fontWeight={700}>Feedback for {request.subjectInfo?.name || request.subjectInfo?.email || 'an employee'}</Typography>
                        <Chip size="small" label={request.state} variant="outlined" />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Requested by {request.requesterInfo?.name || request.requesterInfo?.email || 'a colleague'}
                        {request.dueDate ? ` · Due ${formatDate(request.dueDate)}` : ''}
                      </Typography>
                      {request.contextLabel && <Typography variant="body2" sx={{ mt: 1 }}>{request.contextLabel}</Typography>}
                      {request.questions?.length ? (
                        <Box component="ul" sx={{ pl: 2.5, mb: 0, mt: 1 }}>
                          {request.questions.map((question) => <Typography component="li" variant="body2" key={question}>{question}</Typography>)}
                        </Box>
                      ) : null}
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                      {request.state === 'requested' && (
                        <>
                          <Button size="small" variant="outlined" onClick={() => void decideRequest(request, 'decline')} disabled={sending}>Decline</Button>
                          <Button size="small" variant="contained" onClick={() => void decideRequest(request, 'accept')} disabled={sending}>Accept</Button>
                        </>
                      )}
                      {['requested', 'accepted'].includes(request.state) && (
                        <Button size="small" onClick={() => respondToRequest(request)}>Give feedback</Button>
                      )}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )
      ) : isLoading ? (
        <LinearProgress />
      ) : filteredFeedback.length === 0 ? (
        <Paper variant="outlined" sx={{ px: 3, py: 7, textAlign: 'center' }}>
          <Typography fontWeight={700}>No {tab === 'all' ? '' : `${tab} `}feedback yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
            Feedback shared with you or by you will stay here as a useful record.
          </Typography>
          <Button variant="outlined" startIcon={<Add />} onClick={() => setOpen(true)}>Give feedback</Button>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {filteredFeedback.map((item: any) => {
            const received = currentUserIds.has(String(item.receiverId || ''));
            const label = typeLabels[item.type] || item.type || 'General';
            const evidenceIncluded = Boolean(item.appraisalEvidence?.included);
            const includedAppraisalId = normalizeId(item.appraisalEvidence?.appraisalId);
            const includedAppraisalIsActive = activeAppraisals.some((appraisal) => appraisal._id === includedAppraisalId);
            // The API deliberately removes senderId for anonymous and confidential
            // responses. Requiring it means only proven named feedback can expose
            // an individual appraisal action.
            const canManageAppraisalEvidence = received && Boolean(item.senderId) && (
              evidenceIncluded ? includedAppraisalIsActive : activeAppraisals.length > 0
            );
            return (
              <Grid key={item._id} size={{ xs: 12, md: 6 }}>
                <Card
                  id={`feedback-${item._id}`}
                  variant="outlined"
                  sx={{ height: '100%', borderColor: selectedFeedbackId === item._id ? 'primary.main' : 'divider', borderWidth: selectedFeedbackId === item._id ? 2 : 1 }}
                >
                  <CardContent>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Avatar sx={{ bgcolor: label === 'Praise' ? 'success.main' : label === 'Coaching' ? 'warning.main' : 'primary.main' }}>
                        {label === 'Praise' ? <ThumbUp fontSize="small" /> : <Lightbulb fontSize="small" />}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                          <Box>
                            <Typography fontWeight={700}>{received ? item.sender : `To ${item.receiver || 'employee'}`}</Typography>
                            <Typography variant="caption" color="text.secondary">{formatDate(item.date || item.createdAt)}</Typography>
                          </Box>
                          <Chip label={label} size="small" variant="outlined" />
                        </Stack>
                        <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>{item.message || item.content}</Typography>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                           {item.contextLabel && <Chip size="small" label={item.contextLabel} />}
                           <Typography variant="caption" color="text.secondary">{item.visibility || 'private'}</Typography>
                           {received && Boolean(item.senderId) && evidenceIncluded && (
                             <Chip size="small" label="Appraisal evidence" variant="outlined" />
                           )}
                           {received && !item.acknowledgedAt && (
                             <Button size="small" startIcon={<Check />} onClick={() => void acknowledge(item._id)} disabled={acknowledgingId === item._id}>
                               Acknowledge
                             </Button>
                           )}
                           {canManageAppraisalEvidence && (
                             <Button size="small" onClick={() => openEvidenceDialog(item)}>
                               {evidenceIncluded ? 'Remove from appraisal' : 'Use in appraisal'}
                             </Button>
                           )}
                        </Stack>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>Give feedback</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <Autocomplete
              options={suggestions}
              value={recipient}
              inputValue={search}
              onInputChange={(_, value) => setSearch(value)}
              onChange={(_, value) => setRecipient(value)}
              getOptionLabel={(option) => option.name || option.email || ''}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              filterOptions={(options) => options}
              loading={searchLoading}
              noOptionsText={search.length < 2 ? 'Type at least two characters to search' : 'No people found'}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Box>
                    <Typography variant="body2">{option.name}</Typography>
                    {(option.title || option.email) && <Typography variant="caption" color="text.secondary">{option.title || option.email}</Typography>}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Recipient"
                  placeholder="Search by name or email"
                  required
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: <>{searchLoading && <CircularProgress size={18} />}{params.InputProps.endAdornment}</>,
                  }}
                />
              )}
            />
            <FormControl fullWidth>
              <InputLabel>Feedback type</InputLabel>
              <Select value={type} label="Feedback type" onChange={(event) => setType(event.target.value as FeedbackType)}>
                <MenuItem value="praise">Praise and recognition</MenuItem>
                <MenuItem value="coaching">Coaching suggestion</MenuItem>
                <MenuItem value="general">General feedback</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Feedback"
              multiline
              minRows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              helperText={`${message.trim().length} characters`}
              required
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Visibility</InputLabel>
                  <Select value={visibility} label="Visibility" onChange={(event) => setVisibility(event.target.value)}>
                    <MenuItem value="private">Private to participants</MenuItem>
                    <MenuItem value="public">Visible to permitted managers</MenuItem>
                    {isManager && <MenuItem value="manager-only">Manager only</MenuItem>}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Context</InputLabel>
                  <Select value={contextType} label="Context" onChange={(event) => setContextType(event.target.value)}>
                    <MenuItem value="general">General</MenuItem>
                    <MenuItem value="goal">Goal</MenuItem>
                    <MenuItem value="project">Project</MenuItem>
                    <MenuItem value="peer">Peer feedback</MenuItem>
                    <MenuItem value="upward">Upward feedback</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
            {contextType !== 'general' && (
              <TextField label="Context label (optional)" value={contextLabel} onChange={(event) => setContextLabel(event.target.value)} placeholder="For example, Q3 launch" />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeDialog} disabled={sending}>Cancel</Button>
          <Button variant="contained" endIcon={<Send />} onClick={() => void sendFeedback()} disabled={sending || !recipient || message.trim().length < 3}>
            {sending ? 'Sending…' : 'Send feedback'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(evidenceItem)} onClose={closeEvidenceDialog} fullWidth maxWidth="sm">
        <DialogTitle>{evidenceItem?.appraisalEvidence?.included ? 'Remove appraisal evidence' : 'Use feedback in an appraisal'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {evidenceError && <Alert severity="error">{evidenceError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              {evidenceItem?.appraisalEvidence?.included
                ? 'This removes the feedback from the appraisal evidence list. The feedback itself stays in your record.'
                : 'Choose an active appraisal. This feedback will be supporting evidence and will not set or change a rating.'}
            </Typography>
            {evidenceItem && !evidenceItem.appraisalEvidence?.included && (
              <FormControl fullWidth>
                <InputLabel>Appraisal</InputLabel>
                <Select value={evidenceAppraisalId} label="Appraisal" onChange={(event) => setEvidenceAppraisalId(event.target.value)}>
                  {activeAppraisals.map((appraisal) => (
                    <MenuItem key={appraisal._id} value={appraisal._id}>{appraisalLabel(appraisal)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {evidenceItem?.appraisalEvidence?.included && (
              <Typography variant="body2">
                {appraisalLabel(activeAppraisals.find((appraisal) => appraisal._id === evidenceAppraisalId))}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEvidenceDialog} disabled={evidenceSaving}>Cancel</Button>
          <Button
            variant="contained"
            color={evidenceItem?.appraisalEvidence?.included ? 'error' : 'primary'}
            onClick={() => void updateAppraisalEvidence()}
            disabled={evidenceSaving || !evidenceAppraisalId}
          >
            {evidenceItem?.appraisalEvidence?.included ? 'Remove' : 'Add to appraisal'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
