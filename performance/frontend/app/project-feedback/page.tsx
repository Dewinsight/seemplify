'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography
} from '@mui/material';
import { Add, Send } from '@mui/icons-material';
import api from '@/lib/api';
import { useDirectReports, useUserContext, useUserSearch } from '@/lib/hooks';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';

interface Person { userId: string; name?: string; email?: string; role?: string }
interface Project { _id: string; name: string; description?: string; state: 'draft' | 'active' | 'closed'; leads: Person[]; participants: Person[]; startDate: string; endDate?: string; feedbackWindow?: { opensAt?: string; closesAt?: string } }

function dataOf<T>(response: { data?: unknown }): T { const payload = response.data as { data?: T } | T; return ((payload as { data?: T })?.data ?? payload) as T; }
function errorText(error: unknown, fallback: string) { const candidate = error as { response?: { data?: { error?: string } }; message?: string }; return candidate.response?.data?.error || candidate.message || fallback; }

export default function ProjectFeedbackPage() {
  const { workspace } = usePerformanceWorkspace();
  const { user, isManager, isHRAdmin } = useUserContext();
  const { directReports } = useDirectReports();
  const actorId = String(user?.id || user?.sub || '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [requestProject, setRequestProject] = useState<Project | null>(null);
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState(''); const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [participantQuery, setParticipantQuery] = useState('');
  const [participantDirectory, setParticipantDirectory] = useState<Person[]>([]);
  const [subjectId, setSubjectId] = useState(''); const [reviewerId, setReviewerId] = useState(''); const [dueDate, setDueDate] = useState(''); const [question, setQuestion] = useState('What contribution made the biggest difference, and what would improve future delivery?');

  const people = useMemo<Person[]>(() => (directReports || []).map((item: Record<string, unknown>) => ({ userId: String(item.userId || item.id || item._id || ''), name: String(item.name || item.email || 'Team member'), email: String(item.email || ''), role: String(item.jobTitle || 'Contributor') })).filter(item => item.userId), [directReports]);
  const { users: searchResults, isLoading: searching } = useUserSearch(participantQuery);
  const searchedPeople = useMemo<Person[]>(() => (searchResults || []).map((item: Record<string, unknown>) => ({ userId: String(item.userId || item.id || item._id || ''), name: String(item.name || item.email || 'Colleague'), email: String(item.email || ''), role: String(item.title || 'Contributor') })).filter(item => item.userId), [searchResults]);
  const canCreate = workspace !== 'personal' && (isManager || isHRAdmin);

  useEffect(() => {
    setParticipantDirectory(current => {
      const byId = new Map([...current, ...people, ...searchedPeople].map(person => [person.userId, person]));
      const next = [...byId.values()];
      const unchanged = next.length === current.length && next.every((person, index) => {
        const previous = current[index];
        return previous?.userId === person.userId && previous.name === person.name && previous.email === person.email && previous.role === person.role;
      });
      return unchanged ? current : next;
    });
  }, [people, searchedPeople]);

  const load = useCallback(async () => { setLoading(true); setError(''); try { const data = dataOf<Project[]>(await api.get('/performance-projects')); setProjects(Array.isArray(data) ? data : []); } catch (requestError) { setError(errorText(requestError, 'Could not load project feedback.')); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!name || !startDate || participantIds.length === 0) { setError('Add a project name, start date, and at least one participant.'); return; }
    setWorking(true); setError('');
    try {
      await api.post('/performance-projects', { name, description, startDate, endDate: endDate || undefined, state: 'active', participants: participantDirectory.filter(person => participantIds.includes(person.userId)) });
      setCreateOpen(false); setName(''); setDescription(''); setStartDate(''); setEndDate(''); setParticipantIds([]); setParticipantQuery(''); setNotice('Project created. Only its leads can request feedback from project members.'); await load();
    } catch (requestError) { setError(errorText(requestError, 'Could not create project.')); } finally { setWorking(false); }
  };

  const requestFeedback = async () => {
    if (!requestProject || !subjectId || !reviewerId || !dueDate || !question.trim()) { setError('Choose a subject, reviewer, due date, and feedback question.'); return; }
    setWorking(true); setError('');
    try { await api.post(`/performance-projects/${requestProject._id}/feedback-requests`, { subjectId, reviewerId, dueDate, questions: [question], visibility: 'private', anonymity: 'named' }); setRequestProject(null); setSubjectId(''); setReviewerId(''); setDueDate(''); setNotice('Project feedback request sent to the reviewer.'); }
    catch (requestError) { setError(errorText(requestError, 'Could not request project feedback.')); } finally { setWorking(false); }
  };

  return <Box sx={{ maxWidth: 1040, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} mb={3}><Box><Typography component="h1" variant="h4" fontWeight={700}>Project feedback</Typography><Typography color="text.secondary" mt={0.5}>Request feedback from people who worked together on a defined project.</Typography></Box>{canCreate && <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>Add project</Button>}</Stack>
    <Alert severity="info" sx={{ mb: 2 }}>Project membership controls who can request and receive project feedback. A project lead cannot add people outside the project to a request.</Alert>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
    {loading ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} /></Box> : projects.length === 0 ? <Paper variant="outlined" sx={{ p: 4 }}><Typography fontWeight={650}>No projects available</Typography><Typography color="text.secondary" mt={0.5}>{canCreate ? 'Add a project and its participants before requesting feedback.' : 'Projects you participate in will appear here.'}</Typography></Paper> : <Stack spacing={1.5}>{projects.map(project => {
      const lead = project.leads.some(person => person.userId === actorId) || isHRAdmin;
      return <Paper key={project._id} variant="outlined" sx={{ p: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}><Box><Stack direction="row" gap={1} alignItems="center"><Typography variant="h6">{project.name}</Typography><Chip size="small" label={project.state} color={project.state === 'active' ? 'success' : 'default'} /></Stack>{project.description && <Typography color="text.secondary" mt={0.5}>{project.description}</Typography>}<Typography variant="body2" mt={1}>{project.participants.length} participant{project.participants.length === 1 ? '' : 's'} · Started {new Date(project.startDate).toLocaleDateString()}</Typography></Box>{lead && project.state === 'active' && <Button startIcon={<Send />} onClick={() => setRequestProject(project)}>Request feedback</Button>}</Stack></Paper>;
    })}</Stack>}

    <Dialog open={createOpen} onClose={() => !working && setCreateOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Add a project</DialogTitle><DialogContent dividers><Stack spacing={2}><TextField label="Project name" value={name} onChange={event => setName(event.target.value)} /><TextField label="Description" multiline minRows={3} value={description} onChange={event => setDescription(event.target.value)} /><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField fullWidth type="date" label="Start date" InputLabelProps={{ shrink: true }} value={startDate} onChange={event => setStartDate(event.target.value)} /><TextField fullWidth type="date" label="End date" InputLabelProps={{ shrink: true }} value={endDate} onChange={event => setEndDate(event.target.value)} /></Stack><TextField label="Search organization participants" value={participantQuery} onChange={event => setParticipantQuery(event.target.value)} helperText={searching ? 'Searching…' : 'Search by name or email. Results stay limited to the active organization.'} /><FormControl><InputLabel id="project-participants-label">Participants</InputLabel><Select multiple labelId="project-participants-label" label="Participants" value={participantIds} onChange={event => setParticipantIds(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}>{participantDirectory.map(person => <MenuItem key={person.userId} value={person.userId}>{person.name}</MenuItem>)}</Select></FormControl><Typography variant="caption" color="text.secondary">Add direct reports or cross-functional colleagues. The server verifies every participant belongs to this organization.</Typography></Stack></DialogContent><DialogActions><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="contained" disabled={working} onClick={() => void create()}>{working ? 'Saving…' : 'Create active project'}</Button></DialogActions></Dialog>

    <Dialog open={Boolean(requestProject)} onClose={() => !working && setRequestProject(null)} fullWidth maxWidth="sm"><DialogTitle>Request project feedback</DialogTitle><DialogContent dividers>{requestProject && <Stack spacing={2}><Alert severity="info">Both people must be members of {requestProject.name}. The reviewer sees the request in Feedback.</Alert><FormControl><InputLabel id="project-feedback-subject-label">Feedback about</InputLabel><Select labelId="project-feedback-subject-label" label="Feedback about" value={subjectId} onChange={event => setSubjectId(String(event.target.value))}>{[...requestProject.leads, ...requestProject.participants].map(person => <MenuItem key={`subject-${person.userId}`} value={person.userId}>{person.name || person.email}</MenuItem>)}</Select></FormControl><FormControl><InputLabel id="project-feedback-reviewer-label">Reviewer</InputLabel><Select labelId="project-feedback-reviewer-label" label="Reviewer" value={reviewerId} onChange={event => setReviewerId(String(event.target.value))}>{[...requestProject.leads, ...requestProject.participants].filter(person => person.userId !== subjectId).map(person => <MenuItem key={`reviewer-${person.userId}`} value={person.userId}>{person.name || person.email}</MenuItem>)}</Select></FormControl><TextField type="date" label="Due date" InputLabelProps={{ shrink: true }} value={dueDate} onChange={event => setDueDate(event.target.value)} /><TextField label="Question" multiline minRows={3} value={question} onChange={event => setQuestion(event.target.value)} /></Stack>}</DialogContent><DialogActions><Button onClick={() => setRequestProject(null)}>Cancel</Button><Button variant="contained" startIcon={<Send />} disabled={working} onClick={() => void requestFeedback()}>{working ? 'Sending…' : 'Send request'}</Button></DialogActions></Dialog>
  </Box>;
}
