import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpenCheck, CalendarDays, CheckSquare, ChevronRight, CircleAlert, Clock3, Copy, FilePenLine,
  FileText, House, Inbox, ListTodo, Loader2, MailCheck, MailOpen, MailPlus, MessageSquareText, PanelRightClose,
  Paperclip, Plus, RefreshCw, Save, Search, Send, ShieldCheck, Sparkles, Square, Star, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, json } from '@/lib/api';
import { getKnowledgeBases } from '@/lib/knowledgeBases';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { RichEmailEditor, emailBodyToHtml, emailBodyToPlainText } from '@/components/assistant/RichEmailEditor';
import { cn } from '@/lib/utils';
import type {
  AssistantAction, AssistantActionItem, AssistantAuditEvent, AssistantCalendar, AssistantCalendarEvent,
  AssistantConnection, AssistantDocumentType, AssistantMessage, AssistantOverview, AssistantReminder,
  AssistantRun, AssistantThread, AssistantThreadDetail, AssistantThreadPage, IntelligenceSource, KnowledgeBase
} from '@/types';

type WorkspaceTab = 'mailbox' | 'work-products' | 'actions' | 'calendar' | 'knowledge' | 'history' | 'audit';
type MobileMailboxView = 'threads' | 'conversation';
type MailboxAssistantMode = 'insights' | 'reply';
type MailboxThreadFilter = 'all' | 'unread' | 'attachments';
type WorkProductCalendarEvidence = {
  connectionId: string;
  calendarId: string;
  event: AssistantCalendarEvent;
};

const workProductTypes: Array<{ value: AssistantDocumentType; label: string }> = [
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'memo', label: 'Memo' },
  { value: 'report', label: 'Report' },
  { value: 'board_paper', label: 'Board paper' },
  { value: 'meeting_pack', label: 'Meeting pack' },
  { value: 'briefing_note', label: 'Briefing note' },
  { value: 'meeting_minutes', label: 'Meeting minutes' },
  { value: 'executive_document', label: 'Executive document' },
  { value: 'cross_document_summary', label: 'Cross-document summary' },
  { value: 'historical_decision_brief', label: 'Historical decision brief' },
  { value: 'policy_lookup', label: 'Policy lookup' },
  { value: 'scheduling_proposal', label: 'Scheduling proposal' }
];

function payloadItems<T>(value: T[] | { items?: T[] }) {
  return Array.isArray(value) ? value : Array.isArray(value.items) ? value.items : [];
}

function payloadItem<T>(value: T | { action?: T; reminder?: T }, key: 'action' | 'reminder') {
  if (value && typeof value === 'object' && key in value) return (value as { action?: T; reminder?: T })[key] as T;
  return value as T;
}

function localDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMailboxDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function runTitle(run: AssistantRun) {
  if (run.kind === 'assistant.email_summary' || run.kind === 'email_summary') return 'Email summary';
  if (run.kind === 'assistant.email_draft' || run.kind === 'email_draft') return run.subjectRef ? 'Email draft' : 'New email';
  if (run.kind === 'assistant.work_product' || run.kind === 'work_product') return run.title || workProductTypes.find((item) => item.value === run.documentType)?.label || 'Work product';
  return 'Knowledge answer';
}

function participantLabel(participant: AssistantThread['participants'][number]) {
  return typeof participant === 'string' ? participant : participant.name || participant.email;
}

function threadPage(value: AssistantThread[] | AssistantThreadPage) {
  const rows = Array.isArray(value) ? value : Array.isArray(value.items) ? value.items : Array.isArray(value.threads) ? value.threads : [];
  return Array.isArray(value)
    ? { items: value, nextCursor: null }
    : { items: rows, nextCursor: value.nextCursor || null };
}

function firstParticipant(thread: AssistantThread) {
  return thread.participants[0] ? participantLabel(thread.participants[0]) : 'Unknown sender';
}

function participantAddress(participant: AssistantMessage['from'][number]) {
  return participant.name ? `${participant.name} <${participant.email}>` : participant.email;
}

function messageInitial(message: AssistantMessage) {
  const sender = message.from[0];
  const value = sender?.name || sender?.email || '?';
  return value.slice(0, 1).toUpperCase();
}

function connectionCanSend(connection?: AssistantConnection | null) {
  if (!connection) return false;
  const scopes = new Set((connection.scopes || []).map((scope) => scope.toLocaleLowerCase()));
  return connection.provider === 'microsoft'
    ? scopes.has('mail.send')
    : scopes.has('https://www.googleapis.com/auth/gmail.send')
      || scopes.has('https://www.googleapis.com/auth/gmail.modify');
}

function connectionHasCalendarAccess(connection?: AssistantConnection | null) {
  if (!connection?.scopes?.length) return true;
  const scopes = new Set(connection.scopes.map((scope) => scope.toLocaleLowerCase('en-US')));
  return connection.provider === 'microsoft'
    ? scopes.has('calendars.read') || scopes.has('calendars.readwrite')
    : scopes.has('https://www.googleapis.com/auth/calendar.readonly')
      || scopes.has('https://www.googleapis.com/auth/calendar');
}

function parseEmailRecipients(value: string) {
  const recipients: Array<{ name?: string; email: string }> = [];
  const invalid: string[] = [];
  for (const token of value.split(/[;,\n]+/u).map((item) => item.trim()).filter(Boolean)) {
    const named = token.match(/^(.+?)\s*<([^<>]+)>$/u);
    const email = (named?.[2] || token).trim().toLocaleLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) { invalid.push(token); continue; }
    recipients.push({ email, ...(named?.[1]?.trim() ? { name: named[1].trim() } : {}) });
  }
  return { recipients: [...new Map(recipients.map((item) => [item.email, item])).values()], invalid };
}

function replyRecipientPreview(detail: AssistantThreadDetail | null, mailboxEmail: string, mode: 'reply' | 'reply_all') {
  const own = mailboxEmail.toLocaleLowerCase();
  const anchor = [...(detail?.messages || [])].reverse().find((message) =>
    message.from.some((participant) => participant.email.toLocaleLowerCase() !== own)) || detail?.messages.at(-1);
  if (!anchor) return [];
  const source = mode === 'reply_all'
    ? [...anchor.from, ...anchor.to, ...anchor.cc]
    : anchor.from.some((participant) => participant.email.toLocaleLowerCase() !== own) ? anchor.from : [...anchor.to, ...anchor.cc];
  return [...new Map(source
    .filter((participant) => participant.email.toLocaleLowerCase() !== own)
    .map((participant) => [participant.email.toLocaleLowerCase(), participantLabel(participant)])).values()];
}

function RunBadge({ run }: { run: AssistantRun }) {
  const waiting = run.stage?.startsWith('waiting_for_');
  const variant = run.state === 'completed' ? 'success' : run.state === 'failed' ? 'destructive' : waiting ? 'warning' : 'secondary';
  const label = waiting ? run.stage.replaceAll('_', ' ') : run.state === 'processing' ? `${run.progress}%` : run.state;
  return <Badge variant={variant}>{label}</Badge>;
}

function ResultList({ title, values }: { title: string; values?: unknown[] }) {
  if (!values?.length) return null;
  return <section>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
    <ul className="mt-2 space-y-2 text-sm leading-6">
      {values.map((value, index) => <li className="flex gap-2" key={index}><span aria-hidden="true">•</span><span>{typeof value === 'string' ? value : JSON.stringify(value)}</span></li>)}
    </ul>
  </section>;
}

function RuntimeFootnote({ run }: { run: AssistantRun }) {
  if (!run.runtime) return null;
  const usage = run.runtime.usage || {};
  const tokens = usage.totalTokens ?? usage.total_tokens;
  return <div className="border-t pt-3 text-xs text-muted-foreground">
    Runtime: {run.runtime.providerLabel || run.runtime.provider || run.runtime.model || 'AI runtime'}
    {tokens ? ` · ${tokens} tokens` : ''}{run.runtime.latencyMs ? ` · ${run.runtime.latencyMs} ms` : ''}
  </div>;
}

export function PersonalAssistantPage() {
  const [tab, setTab] = useState<WorkspaceTab>('mailbox');
  const [overview, setOverview] = useState<AssistantOverview | null>(null);
  const [runs, setRuns] = useState<AssistantRun[]>([]);
  const [sources, setSources] = useState<IntelligenceSource[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threadsConnectionId, setThreadsConnectionId] = useState('');
  const [threadId, setThreadId] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [threadQuery, setThreadQuery] = useState('');
  const [threadFilter, setThreadFilter] = useState<MailboxThreadFilter>('all');
  const [threadDetail, setThreadDetail] = useState<AssistantThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);
  const [threadDetailLoading, setThreadDetailLoading] = useState(false);
  const [threadDetailError, setThreadDetailError] = useState('');
  const [mobileMailboxView, setMobileMailboxView] = useState<MobileMailboxView>('threads');
  const [assistantOpen, setAssistantOpen] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1536px)').matches
      : false
  );
  const [assistantMode, setAssistantMode] = useState<MailboxAssistantMode>('insights');
  const [threadQuestion, setThreadQuestion] = useState('');
  const [replyMode, setReplyMode] = useState<'reply' | 'reply_all'>('reply');
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReview, setComposeReview] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeInstructions, setComposeInstructions] = useState('');
  const [composeTone, setComposeTone] = useState('professional');
  const [composeDraftRunId, setComposeDraftRunId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [instructions, setInstructions] = useState('Draft a concise, professional response. Do not make commitments that are not in the thread.');
  const [tone, setTone] = useState('professional');
  const [question, setQuestion] = useState('What are the most important customer experience risks, and which saved evidence supports them?');
  const [sourceRefs, setSourceRefs] = useState<string[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [knowledgeAnswerKnowledgeIds, setKnowledgeAnswerKnowledgeIds] = useState<string[]>([]);
  const [workProductType, setWorkProductType] = useState<AssistantDocumentType>('memo');
  const [workProductTitle, setWorkProductTitle] = useState('');
  const [workProductObjective, setWorkProductObjective] = useState('');
  const [workProductSourceRefs, setWorkProductSourceRefs] = useState<string[]>([]);
  const [workProductKnowledgeIds, setWorkProductKnowledgeIds] = useState<string[]>([]);
  const [includeMailboxThread, setIncludeMailboxThread] = useState(false);
  const [workProductCalendar, setWorkProductCalendar] = useState<WorkProductCalendarEvidence | null>(null);
  const [actions, setActions] = useState<AssistantAction[]>([]);
  const [selectedActionId, setSelectedActionId] = useState('');
  const [reminders, setReminders] = useState<AssistantReminder[]>([]);
  const [operationError, setOperationError] = useState('');
  const [calendarConnectionId, setCalendarConnectionId] = useState('');
  const [calendars, setCalendars] = useState<AssistantCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [calendarEvents, setCalendarEvents] = useState<AssistantCalendarEvent[]>([]);
  const [calendarStart, setCalendarStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [calendarEnd, setCalendarEnd] = useState(() => new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 10));
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarErrorCode, setCalendarErrorCode] = useState('');
  const [auditEvents, setAuditEvents] = useState<AssistantAuditEvent[]>([]);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [oauthNotice, setOauthNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const activeConnection = useRef('');
  const activeThreadSearch = useRef('');
  const connectedConnectionIds = useRef(new Set<string>());
  const workspaceRequest = useRef(0);
  const threadRequest = useRef(0);
  const threadDetailRequest = useRef(0);
  const reminderRequest = useRef(0);
  const calendarListRequest = useRef(0);
  const calendarEventRequest = useRef(0);
  const runRequest = useRef({ fingerprint: '', key: '' });
  const workProductRequest = useRef({ fingerprint: '', key: '' });
  const sendRequest = useRef({ fingerprint: '', key: '' });
  const composeDraftRequest = useRef({ fingerprint: '', key: '' });
  const composeSendRequest = useRef({ fingerprint: '', key: '' });

  const loadWorkspace = useCallback(async (quiet = false) => {
    const requestId = ++workspaceRequest.current;
    const [overviewResult, runResult, sourceResult] = await Promise.allSettled([
      api<AssistantOverview>('/api/assistant/overview'),
      api<AssistantRun[]>('/api/assistant/runs?limit=100'),
      api<IntelligenceSource[]>('/api/intelligence/sources')
    ]);
    if (requestId !== workspaceRequest.current) return;
    if (overviewResult.status === 'fulfilled') {
      const connected = overviewResult.value.connections.filter((item) => item.status === 'connected');
      connectedConnectionIds.current = new Set(connected.map((item) => item.id));
      const current = activeConnection.current;
      const next = connected.some((item) => item.id === current) ? current : connected[0]?.id || '';
      if (next !== current) {
        activeConnection.current = next;
        threadRequest.current += 1;
        threadDetailRequest.current += 1;
        setThreads([]);
        setThreadCursor(null);
        setThreadId('');
        setThreadDetail(null);
        setThreadsConnectionId('');
        setThreadError('');
        setThreadDetailError('');
        setMobileMailboxView('threads');
      }
      setOverview(overviewResult.value);
      setConnectionId(next);
      setCalendarConnectionId((current) => connected.some((item) => item.id === current) ? current : next);
    }
    if (runResult.status === 'fulfilled') {
      setRuns(runResult.value);
      setSelectedRunId((current) => current && runResult.value.some((run) => run.id === current)
        ? current : runResult.value[0]?.id || '');
    }
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value);
    const failures = [overviewResult, runResult, sourceResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Assistant data could not load.').join(' '));
    if (!quiet) setLoading(false);
  }, []);

  const loadAssistantOperations = useCallback(async () => {
    const [actionResult, auditResult, knowledgeResult] = await Promise.allSettled([
      api<AssistantAction[] | { items?: AssistantAction[] }>('/api/assistant/actions?limit=100'),
      api<AssistantAuditEvent[] | { items?: AssistantAuditEvent[] }>('/api/assistant/audit?limit=100'),
      getKnowledgeBases()
    ]);
    if (actionResult.status === 'fulfilled') {
      const items = payloadItems(actionResult.value);
      setActions(items);
      setSelectedActionId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || '');
    }
    if (auditResult.status === 'fulfilled') setAuditEvents(payloadItems(auditResult.value));
    if (knowledgeResult.status === 'fulfilled') setKnowledgeBases(knowledgeResult.value.filter((item) => item.state === 'ready'));
    const failures = [actionResult, auditResult, knowledgeResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setOperationError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Assistant operations could not load.').join(' '));
  }, []);

  const loadReminders = useCallback(async (actionId: string) => {
    const requestId = ++reminderRequest.current;
    if (!actionId) { setReminders([]); return; }
    try {
      const result = await api<AssistantReminder[] | { items?: AssistantReminder[] }>(`/api/assistant/actions/${encodeURIComponent(actionId)}/reminders`);
      if (requestId !== reminderRequest.current) return;
      setReminders(payloadItems(result));
    } catch (reason) {
      if (requestId !== reminderRequest.current) return;
      setReminders([]);
      setOperationError(reason instanceof Error ? reason.message : 'Reminders could not load.');
    }
  }, []);

  const loadCalendars = useCallback(async () => {
    const requestedConnection = calendarConnectionId;
    const requestId = ++calendarListRequest.current;
    calendarEventRequest.current += 1;
    if (!requestedConnection) { setCalendars([]); setCalendarId(''); setCalendarEvents([]); setCalendarErrorCode(''); return; }
    setCalendarEvents([]);
    setCalendarLoading(true); setCalendarError(''); setCalendarErrorCode('');
    try {
      const result = await api<{ items?: AssistantCalendar[] } | AssistantCalendar[]>(`/api/assistant/calendar/calendars?connectionId=${encodeURIComponent(requestedConnection)}`);
      if (requestId !== calendarListRequest.current) return;
      const items = payloadItems(result);
      setCalendars(items);
      setCalendarId((current) => current && items.some((item) => item.id === current)
        ? current : items.find((item) => item.primary)?.id || items[0]?.id || '');
    } catch (reason) {
      if (requestId !== calendarListRequest.current) return;
      setCalendars([]); setCalendarId('');
      setCalendarError(reason instanceof Error ? reason.message : 'Calendars could not load.');
      setCalendarErrorCode(reason instanceof ApiError ? reason.code || '' : '');
    } finally {
      if (requestId === calendarListRequest.current) setCalendarLoading(false);
    }
  }, [calendarConnectionId]);

  const loadCalendarEvents = useCallback(async () => {
    const requestedConnection = calendarConnectionId;
    const requestedCalendar = calendarId;
    const requestedStart = calendarStart;
    const requestedEnd = calendarEnd;
    const requestId = ++calendarEventRequest.current;
    if (!requestedConnection || !requestedCalendar || !requestedStart || !requestedEnd) { setCalendarEvents([]); return; }
    setCalendarLoading(true); setCalendarError(''); setCalendarErrorCode('');
    try {
      const start = new Date(`${requestedStart}T00:00:00`);
      const end = new Date(`${requestedEnd}T23:59:59`);
      const parameters = new URLSearchParams({
        connectionId: requestedConnection, calendarId: requestedCalendar,
        start: start.toISOString(), end: end.toISOString(), limit: '50'
      });
      const result = await api<{ items?: AssistantCalendarEvent[] } | AssistantCalendarEvent[]>(`/api/assistant/calendar/events?${parameters.toString()}`);
      if (requestId !== calendarEventRequest.current) return;
      setCalendarEvents(payloadItems(result));
    } catch (reason) {
      if (requestId !== calendarEventRequest.current) return;
      setCalendarEvents([]);
      setCalendarError(reason instanceof Error ? reason.message : 'Calendar events could not load.');
      setCalendarErrorCode(reason instanceof ApiError ? reason.code || '' : '');
    } finally {
      if (requestId === calendarEventRequest.current) setCalendarLoading(false);
    }
  }, [calendarConnectionId, calendarEnd, calendarId, calendarStart]);

  const loadThreads = useCallback(async (reset = true) => {
    const requestedConnection = connectionId;
    const requestId = ++threadRequest.current;
    if (reset) setThreadLoading(true);
    setThreadError('');
    if (!requestedConnection || !connectedConnectionIds.current.has(requestedConnection)) {
      setThreadLoading(false);
      return;
    }
    try {
      const parameters = new URLSearchParams({ connectionId: requestedConnection, limit: '40' });
      if (threadQuery) parameters.set('search', threadQuery);
      else if (threadFilter === 'unread') parameters.set('unread', 'true');
      else if (threadFilter === 'attachments') parameters.set('hasAttachment', 'true');
      const result = await api<AssistantThread[] | AssistantThreadPage>(`/api/assistant/mailbox/threads?${parameters.toString()}`);
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection) return;
      const page = threadPage(result);
      setThreads(page.items);
      setThreadCursor(page.nextCursor);
      setThreadsConnectionId(requestedConnection);
      setThreadId((current) => current && page.items.some((thread) => thread.id === current) ? current : page.items[0]?.id || '');
    } catch (reason) {
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection) return;
      setThreadError(reason instanceof Error ? reason.message : 'Mailbox threads could not load.');
    } finally {
      if (requestId === threadRequest.current) setThreadLoading(false);
    }
  }, [connectionId, threadFilter, threadQuery]);

  const loadMoreThreads = useCallback(async () => {
    const requestedConnection = connectionId;
    const cursor = threadCursor;
    if (!requestedConnection || !cursor || threadLoadingMore) return;
    const requestId = threadRequest.current;
    const requestedSearch = activeThreadSearch.current;
    setThreadLoadingMore(true);
    try {
      const parameters = new URLSearchParams({ connectionId: requestedConnection, limit: '40', cursor });
      if (threadQuery) parameters.set('search', threadQuery);
      else if (threadFilter === 'unread') parameters.set('unread', 'true');
      else if (threadFilter === 'attachments') parameters.set('hasAttachment', 'true');
      const result = await api<AssistantThread[] | AssistantThreadPage>(`/api/assistant/mailbox/threads?${parameters.toString()}`);
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection
        || activeThreadSearch.current !== requestedSearch) return;
      const page = threadPage(result);
      setThreads((current) => {
        const merged = new Map(current.map((thread) => [thread.id, thread]));
        for (const thread of page.items) merged.set(thread.id, thread);
        return [...merged.values()];
      });
      setThreadCursor(page.nextCursor);
    } catch (reason) {
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection
        || activeThreadSearch.current !== requestedSearch) return;
      toast.error(reason instanceof Error ? reason.message : 'More mailbox threads could not load.');
    } finally { setThreadLoadingMore(false); }
  }, [connectionId, threadCursor, threadFilter, threadLoadingMore, threadQuery]);

  const loadThreadDetail = useCallback(async () => {
    const requestedConnection = connectionId;
    const requestedThread = threadId;
    const requestId = ++threadDetailRequest.current;
    setThreadDetail(null);
    setThreadDetailError('');
    if (!requestedConnection || !requestedThread || threadsConnectionId !== requestedConnection) return;
    setThreadDetailLoading(true);
    try {
      const result = await api<AssistantThreadDetail>(
        `/api/assistant/mailbox/threads/${encodeURIComponent(requestedThread)}?connectionId=${encodeURIComponent(requestedConnection)}`
      );
      if (requestId !== threadDetailRequest.current || activeConnection.current !== requestedConnection) return;
      setThreadDetail(result);
    } catch (reason) {
      if (requestId !== threadDetailRequest.current || activeConnection.current !== requestedConnection) return;
      setThreadDetailError(reason instanceof Error ? reason.message : 'The conversation could not load.');
    } finally {
      if (requestId === threadDetailRequest.current) setThreadDetailLoading(false);
    }
  }, [connectionId, threadId, threadsConnectionId]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { void loadAssistantOperations(); }, [loadAssistantOperations]);
  useEffect(() => { void loadReminders(selectedActionId); }, [loadReminders, selectedActionId]);
  useEffect(() => {
    if (tab === 'calendar') void loadCalendars();
  }, [loadCalendars, tab]);
  useEffect(() => {
    if (tab === 'calendar' && calendarId) void loadCalendarEvents();
  }, [calendarId, loadCalendarEvents, tab]);
  useEffect(() => {
    const timer = window.setTimeout(() => setThreadQuery(threadSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [threadSearch]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { void loadThreadDetail(); }, [loadThreadDetail]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('nylas');
    if (!status) return;
    const code = url.searchParams.get('code');
    const failureMessages: Record<string, string> = {
      nylas_authorization_failed: 'Nylas rejected this connection. Verify the saved Client ID and API key, then start a new connection.',
      nylas_request_failed: 'Nylas could not complete this connection. Start a new connection and try again.',
      nylas_unavailable: 'Nylas is temporarily unavailable. Try connecting again in a few minutes.',
      nylas_oauth_state_invalid: 'This mailbox connection expired. Start a new connection and try again.',
      nylas_oauth_state_replay: 'This mailbox connection was already used. Start a new connection and try again.'
    };
    const notice = status === 'connected'
      ? { tone: 'success' as const, text: 'Mailbox connected successfully.' }
      : status === 'cancelled'
        ? { tone: 'warning' as const, text: 'Mailbox connection was cancelled. No access was added.' }
        : { tone: 'error' as const, text: failureMessages[code || ''] || 'Mailbox connection failed. Start a new connection and try again.' };
    setOauthNotice(notice);
    if (status === 'connected') toast.success(notice.text);
    else if (status === 'cancelled') toast.warning(notice.text);
    else toast.error(notice.text);
    url.searchParams.delete('nylas');
    url.searchParams.delete('code');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useLiveRefresh(useCallback(() => {
    void loadWorkspace(true); void loadThreads(false); void loadAssistantOperations();
  }, [loadAssistantOperations, loadWorkspace, loadThreads]));
  const hasActiveRun = runs.some((run) => run.state === 'queued' || run.state === 'processing'
    || (run.state === 'completed'
      && ['assistant.email_draft', 'email_draft', 'assistant.work_product', 'work_product'].includes(run.kind)
      && (!run.draft?.subject || !run.draft?.body)));
  useEffect(() => {
    if (!hasActiveRun) return;
    const timer = window.setInterval(() => void loadWorkspace(true), 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, loadWorkspace]);

  const selectedThread = threadsConnectionId === connectionId
    && overview?.connections.some((connection) => connection.id === connectionId && connection.status === 'connected')
    ? threads.find((thread) => thread.id === threadId) || null : null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const mailboxRuns = runs.filter((run) =>
    ['assistant.email_summary', 'assistant.email_draft', 'email_summary', 'email_draft'].includes(run.kind)
    && run.connectionId === connectionId && run.subjectRef === threadId
  );
  const selectedMailboxSummaryRun = mailboxRuns.find((run) =>
    ['assistant.email_summary', 'email_summary'].includes(run.kind)) || null;
  const selectedMailboxDraftRun = mailboxRuns.find((run) =>
    ['assistant.email_draft', 'email_draft'].includes(run.kind)) || null;
  const mailboxDraftSubject = draftSubject || selectedMailboxDraftRun?.draft?.subject || '';
  const mailboxDraftBody = draftBody || selectedMailboxDraftRun?.draft?.body || '';
  const workProductRuns = runs.filter((run) => ['assistant.work_product', 'work_product'].includes(run.kind));
  const selectedWorkProductRun = selectedRun && workProductRuns.some((run) => run.id === selectedRun.id)
    ? selectedRun : workProductRuns[0] || null;
  const editableRun = tab === 'mailbox' ? selectedMailboxDraftRun : tab === 'work-products' ? selectedWorkProductRun : selectedRun;
  const currentDraftSubject = draftSubject || editableRun?.draft?.subject || '';
  const currentDraftBody = draftBody || editableRun?.draft?.body || '';
  const draftDirty = Boolean(editableRun?.draft && (
    currentDraftSubject !== (editableRun.draft.subject || '') || currentDraftBody !== (editableRun.draft.body || '')
  ));
  const composeDirty = Boolean(composeOpen && (composeTo.trim() || composeCc.trim() || composeBcc.trim()
    || composeSubject.trim() || emailBodyToPlainText(composeBody) || composeInstructions.trim()));
  useUnsavedChanges(draftDirty || composeDirty);
  useLayoutEffect(() => {
    if (!editableRun?.draft) return;
    setDraftSubject(editableRun.draft.subject || '');
    setDraftBody(editableRun.draft.body || '');
    setDraftRevision(editableRun.draft.revision || 0);
  }, [editableRun?.id, editableRun?.draft?.revision, editableRun?.draft?.subject, editableRun?.draft?.body]);
  const composeDraftRun = runs.find((run) => run.id === composeDraftRunId) || null;
  useEffect(() => {
    if (!composeOpen || !composeDraftRun?.draft) return;
    setComposeSubject(composeDraftRun.draft.subject || '');
    setComposeBody(composeDraftRun.draft.body || '');
  }, [composeDraftRun?.draft?.body, composeDraftRun?.draft?.subject, composeDraftRun?.id, composeOpen]);

  const groupedSources = useMemo(() => ({
    survey: sources.filter((source) => source.type === 'survey'),
    social: sources.filter((source) => source.type === 'social')
  }), [sources]);
  const detail = threadDetail?.thread.id === threadId ? threadDetail : null;
  const readerThread = detail?.thread || selectedThread;
  const selectedAction = actions.find((action) => action.id === selectedActionId) || null;

  async function connect(provider: 'google' | 'microsoft') {
    setWorking(`connect:${provider}`);
    try {
      const result = await api<{ authorizeUrl: string }>('/api/assistant/nylas/connect', json('POST', { provider }));
      window.location.assign(result.authorizeUrl);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Mailbox connection could not start.'); }
    finally { setWorking(''); }
  }

  async function disconnect(connection: AssistantConnection) {
    if (!window.confirm(`Disconnect ${connection.email}? Saved assistant history will remain available.`)) return;
    setWorking(`disconnect:${connection.id}`);
    try {
      await api(`/api/assistant/nylas/connections/${connection.id}`, { method: 'DELETE' });
      connectedConnectionIds.current.delete(connection.id);
      if (activeConnection.current === connection.id) {
        activeConnection.current = '';
        threadRequest.current += 1;
        threadDetailRequest.current += 1;
        setConnectionId('');
        setThreads([]);
        setThreadCursor(null);
        setThreadId('');
        setThreadDetail(null);
        setThreadsConnectionId('');
        setThreadError('');
        setThreadDetailError('');
        setMobileMailboxView('threads');
      }
      await loadWorkspace(true); toast.success('Mailbox disconnected.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Mailbox could not be disconnected.'); }
    finally { setWorking(''); }
  }

  async function startRun(kind: 'email-summary' | 'email-draft' | 'knowledge-answer', options?: { instructions?: string }) {
    const emailRun = kind !== 'knowledge-answer';
    const activeMailbox = overview?.connections.find((connection) => connection.id === connectionId && connection.status === 'connected');
    if (emailRun && (!activeMailbox || !selectedThread)) return toast.error('Select a connected mailbox thread first.');
    if (!emailRun && (!question.trim() || (sourceRefs.length < 1 && knowledgeAnswerKnowledgeIds.length < 1))) {
      return toast.error('Ask a question and select at least one saved source or knowledge base.');
    }
    if (!confirmDraftDiscard()) return;
    setWorking(kind);
    try {
      const body = kind === 'email-summary' ? {
        connectionId, threadId: selectedThread?.id,
        ...(options?.instructions?.trim() ? { instructions: options.instructions.trim() } : {})
      }
        : kind === 'email-draft' ? {
          connectionId, threadId: selectedThread?.id,
          instructions: options?.instructions?.trim() || instructions,
          tone
        }
          : { question, sourceRefs, knowledgeBaseIds: knowledgeAnswerKnowledgeIds };
      const fingerprint = JSON.stringify({ kind, body });
      if (runRequest.current.fingerprint !== fingerprint) runRequest.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<{ run?: AssistantRun; jobId: string }>(`/api/assistant/runs/${kind}`, {
        ...json('POST', body), headers: { 'idempotency-key': runRequest.current.key }
      });
      runRequest.current = { fingerprint: '', key: '' };
      if (result.run) setSelectedRunId(result.run.id);
      if (kind === 'email-draft' && result.run?.draft) {
        setDraftSubject(result.run.draft.subject || '');
        setDraftBody(result.run.draft.body || '');
        setDraftRevision(result.run.draft.revision || 0);
      }
      void loadWorkspace(true);
      setTab(kind === 'knowledge-answer' ? 'knowledge' : 'mailbox');
      if (emailRun) {
        setAssistantMode(kind === 'email-draft' ? 'reply' : 'insights');
        setAssistantOpen(true);
      }
      toast.success('Assistant work queued. It is safe to leave this page.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Assistant work could not be queued.'); }
    finally { setWorking(''); }
  }

  async function startWorkProduct() {
    const hasEvidence = workProductSourceRefs.length > 0 || workProductKnowledgeIds.length > 0
      || Boolean(includeMailboxThread && selectedThread) || Boolean(workProductCalendar);
    if (!workProductTitle.trim() || !workProductObjective.trim()) return toast.error('Add a work product title and objective.');
    if (workProductType !== 'scheduling_proposal' && !hasEvidence) return toast.error('Select at least one authorized source.');
    if (!confirmDraftDiscard()) return;
    const threadConnectionId = includeMailboxThread && selectedThread ? connectionId : '';
    const calendarConnectionId = workProductCalendar?.connectionId || '';
    const body = {
      documentType: workProductType,
      title: workProductTitle.trim(),
      objective: workProductObjective.trim(),
      sourceRefs: workProductSourceRefs,
      knowledgeBaseIds: workProductKnowledgeIds,
      ...(includeMailboxThread && selectedThread ? { threadConnectionId, threadId: selectedThread.id } : {}),
      ...(workProductCalendar ? {
        calendarConnectionId: workProductCalendar.connectionId,
        calendarId: workProductCalendar.calendarId,
        calendarEventId: workProductCalendar.event.id
      } : {})
    };
    const fingerprint = JSON.stringify(body);
    if (workProductRequest.current.fingerprint !== fingerprint) {
      workProductRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    setWorking('work-product');
    try {
      const result = await api<{ run?: AssistantRun; jobId: string }>('/api/assistant/runs/work-product', {
        ...json('POST', body), headers: { 'idempotency-key': workProductRequest.current.key }
      });
      workProductRequest.current = { fingerprint: '', key: '' };
      if (result.run) setSelectedRunId(result.run.id);
      await loadWorkspace(true);
      toast.success('Work product queued. Its evidence snapshot is durable.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The work product could not be queued.'); }
    finally { setWorking(''); }
  }

  async function promoteAction(run: AssistantRun, actionIndex: number, item: AssistantActionItem) {
    setWorking(`promote:${run.id}:${actionIndex}`);
    try {
      const result = await api<{ action: AssistantAction; created: boolean }>('/api/assistant/actions/from-run', json('POST', {
        runId: run.id, actionIndex, ...(item.owner ? { owner: item.owner } : {})
      }));
      await loadAssistantOperations();
      toast.success(result.created ? 'Action added to your tracker.' : 'This action is already tracked.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The proposed action could not be added.'); }
    finally { setWorking(''); }
  }

  async function saveAction(input: AssistantAction) {
    setWorking(`action:${input.id}`);
    try {
      const result = await api<AssistantAction | { action?: AssistantAction }>('/api/assistant/actions', json('PATCH', {
        id: input.id, revision: input.revision, title: input.title, description: input.description,
        owner: input.owner, status: input.status, priority: input.priority, dueAt: input.dueAt
      }));
      const action = payloadItem(result, 'action');
      setActions((current) => current.map((item) => item.id === action.id ? action : item));
      toast.success('Action saved.');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The action could not be saved.');
      await loadAssistantOperations();
    } finally { setWorking(''); }
  }

  async function addReminder(actionId: string, remindAt: string, note: string) {
    setWorking(`reminder:new:${actionId}`);
    try {
      const result = await api<AssistantReminder | { reminder?: AssistantReminder }>(
        `/api/assistant/actions/${encodeURIComponent(actionId)}/reminders`,
        json('POST', { remindAt: new Date(remindAt).toISOString(), note })
      );
      const reminder = payloadItem(result, 'reminder');
      setReminders((current) => [...current, reminder].sort((left, right) => left.remindAt.localeCompare(right.remindAt)));
      toast.success('Reminder added.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The reminder could not be added.'); }
    finally { setWorking(''); }
  }

  async function saveReminder(reminder: AssistantReminder) {
    setWorking(`reminder:${reminder.id}`);
    try {
      const result = await api<AssistantReminder | { reminder?: AssistantReminder }>(
        `/api/assistant/actions/${encodeURIComponent(reminder.actionId)}/reminders/${encodeURIComponent(reminder.id)}`,
        json('PATCH', {
          revision: reminder.revision, remindAt: new Date(reminder.remindAt).toISOString(),
          note: reminder.note, state: reminder.state
        })
      );
      const saved = payloadItem(result, 'reminder');
      setReminders((current) => current.map((item) => item.id === saved.id ? saved : item));
      toast.success('Reminder saved.');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The reminder could not be saved.');
      await loadReminders(reminder.actionId);
    } finally { setWorking(''); }
  }

  function useCalendarEvent(event: AssistantCalendarEvent, documentType: 'meeting_pack' | 'scheduling_proposal') {
    if (!calendarConnectionId || !calendarId) return;
    if (!changeTab('work-products')) return;
    setWorkProductCalendar({ connectionId: calendarConnectionId, calendarId, event });
    setWorkProductType(documentType);
    setWorkProductTitle(`${documentType === 'meeting_pack' ? 'Meeting pack' : 'Scheduling proposal'}: ${event.title}`);
    setWorkProductObjective(documentType === 'meeting_pack'
      ? 'Prepare a concise meeting pack with context, agenda considerations, decisions required, risks, and follow-up actions.'
      : 'Prepare a scheduling proposal that respects the selected event context and clearly identifies assumptions for human review.');
  }

  async function saveDraft() {
    if (!editableRun?.draft) return;
    setWorking('save-draft');
    try {
      const result = await api<AssistantRun>(`/api/assistant/runs/${editableRun.id}/draft`, json('PATCH', {
        subject: currentDraftSubject, body: currentDraftBody, revision: draftRevision
      }));
      if (result.draft) setDraftRevision(result.draft.revision);
      await loadWorkspace(true); toast.success('Draft saved. Nothing was sent.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Draft could not be saved.'); }
    finally { setWorking(''); }
  }

  async function askThread(value = threadQuestion) {
    const question = value.trim();
    if (!question) { toast.error('Ask the AI assistant a question about this conversation.'); return; }
    await startRun('email-summary', {
      instructions: `Answer this user question using only the supplied email thread: ${question}`
    });
  }

  async function sendSavedReply() {
    const run = selectedMailboxDraftRun;
    if (!run?.draft || !readerThread || !activeMailbox) return;
    if (draftDirty || draftRevision !== run.draft.revision) {
      return toast.error('Save the latest draft before sending.');
    }
    const fingerprint = JSON.stringify({ runId: run.id, revision: draftRevision, mode: replyMode });
    if (sendRequest.current.fingerprint !== fingerprint) {
      sendRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    setWorking('send-reply');
    try {
      await api(`/api/assistant/mailbox/threads/${encodeURIComponent(readerThread.id)}/reply`, {
        ...json('POST', {
          connectionId: activeMailbox.id,
          runId: run.id,
          revision: draftRevision,
          mode: replyMode,
          confirmation: 'send'
        }),
        headers: { 'idempotency-key': sendRequest.current.key }
      });
      sendRequest.current = { fingerprint: '', key: '' };
      setSendConfirmOpen(false);
      await Promise.all([loadWorkspace(true), loadThreadDetail(), loadAssistantOperations()]);
      toast.success('Reply sent and recorded in the assistant audit.');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The reply could not be sent.');
    } finally { setWorking(''); }
  }

  function composeRecipients() {
    const to = parseEmailRecipients(composeTo);
    const cc = parseEmailRecipients(composeCc);
    const bcc = parseEmailRecipients(composeBcc);
    const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
    return { to: to.recipients, cc: cc.recipients, bcc: bcc.recipients, invalid };
  }

  async function draftComposeWithAi() {
    if (!activeMailbox) return;
    const recipients = composeRecipients();
    if (!recipients.to.length || recipients.invalid.length) {
      return toast.error(recipients.invalid.length
        ? `Check these recipient addresses: ${recipients.invalid.join(', ')}`
        : 'Add at least one valid recipient before asking the AI assistant.');
    }
    if (composeInstructions.trim().length < 3) return toast.error('Tell the AI assistant what this email should achieve.');
    const input = {
      connectionId: activeMailbox.id, to: recipients.to, cc: recipients.cc, bcc: recipients.bcc,
      subject: composeSubject.trim() || undefined, instructions: composeInstructions.trim(), tone: composeTone
    };
    const fingerprint = JSON.stringify(input);
    if (composeDraftRequest.current.fingerprint !== fingerprint) {
      composeDraftRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    setWorking('compose-ai');
    try {
      const result = await api<{ run?: AssistantRun; jobId: string }>('/api/assistant/runs/email-compose-draft', {
        ...json('POST', input), headers: { 'idempotency-key': composeDraftRequest.current.key }
      });
      if (result.run) {
        setComposeDraftRunId(result.run.id);
        if (result.run.draft) {
          setComposeSubject(result.run.draft.subject || ''); setComposeBody(result.run.draft.body || '');
        }
      }
      await loadWorkspace(true);
      toast.success('AI draft created for your review. Nothing was sent.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The AI email draft could not be created.'); }
    finally { setWorking(''); }
  }

  function reviewComposedEmail() {
    const recipients = composeRecipients();
    if (recipients.invalid.length) return toast.error(`Check these recipient addresses: ${recipients.invalid.join(', ')}`);
    if (!recipients.to.length) return toast.error('Add at least one recipient.');
    if (!composeSubject.trim() || !emailBodyToPlainText(composeBody)) return toast.error('Add a subject and email body.');
    setComposeReview(true);
  }

  async function sendComposedEmail() {
    if (!activeMailbox) return;
    const recipients = composeRecipients();
    const input = {
      connectionId: activeMailbox.id, to: recipients.to, cc: recipients.cc, bcc: recipients.bcc,
      subject: composeSubject.trim(), body: composeBody, confirmation: 'send'
    };
    const fingerprint = JSON.stringify(input);
    if (composeSendRequest.current.fingerprint !== fingerprint) {
      composeSendRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    setWorking('compose-send');
    try {
      await api('/api/assistant/mailbox/messages/send', {
        ...json('POST', input), headers: { 'idempotency-key': composeSendRequest.current.key }
      });
      composeSendRequest.current = { fingerprint: '', key: '' };
      resetCompose();
      await Promise.all([loadWorkspace(true), loadThreads(false), loadAssistantOperations()]);
      toast.success('Email sent from your connected mailbox and recorded in the assistant audit.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The email could not be sent.'); }
    finally { setWorking(''); }
  }

  function resetCompose() {
    setComposeOpen(false); setComposeReview(false); setComposeTo(''); setComposeCc(''); setComposeBcc('');
    setComposeSubject(''); setComposeBody(''); setComposeInstructions(''); setComposeTone('professional');
    setComposeDraftRunId(''); composeDraftRequest.current = { fingerprint: '', key: '' };
  }

  function toggleSource(ref: string) {
    setSourceRefs((current) => current.includes(ref) ? current.filter((item) => item !== ref) : current.length < 12 ? [...current, ref] : current);
  }

  function toggleKnowledgeAnswerBase(id: string) {
    setKnowledgeAnswerKnowledgeIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current
    );
  }

  function confirmDraftDiscard() {
    if (!draftDirty) return true;
    if (!window.confirm('Discard the unsaved changes to this assistant draft?')) return false;
    if (editableRun?.draft) {
      setDraftSubject(editableRun.draft.subject || '');
      setDraftBody(editableRun.draft.body || '');
      setDraftRevision(editableRun.draft.revision || 0);
    }
    return true;
  }

  function changeTab(next: WorkspaceTab) {
    if (next === tab) return true;
    if (!confirmDraftDiscard()) return false;
    setTab(next);
    return true;
  }

  function selectConnection(id: string) {
    if (!connectedConnectionIds.current.has(id)) return;
    if (id === connectionId) return;
    if (!confirmDraftDiscard()) return;
    activeConnection.current = id;
    threadRequest.current += 1;
    threadDetailRequest.current += 1;
    setThreads([]);
    setThreadCursor(null);
    setThreadId('');
    setThreadDetail(null);
    setThreadsConnectionId('');
    setThreadError('');
    setThreadDetailError('');
    setMobileMailboxView('threads');
    setConnectionId(id);
  }

  function changeThreadSearch(value: string) {
    if (value === threadSearch) return;
    activeThreadSearch.current = value;
    threadRequest.current += 1;
    setThreadSearch(value);
  }

  function selectThread(id: string) {
    if (id === threadId) {
      setMobileMailboxView('conversation');
      return;
    }
    if (!confirmDraftDiscard()) return;
    threadDetailRequest.current += 1;
    setThreadDetail(null);
    setThreadDetailError('');
    setThreadId(id);
    setMobileMailboxView('conversation');
  }

  function selectRun(id: string) {
    if (id === selectedRunId) return;
    if (!confirmDraftDiscard()) return;
    setSelectedRunId(id);
  }

  const assistantRuntime = overview?.ai;
  const runtimeReady = assistantRuntime?.ready === true;
  const workerBusy = (overview?.worker?.active || 0) + (overview?.worker?.queued || 0);
  const connectedCount = overview?.connections.filter((connection) => connection.status === 'connected').length || 0;
  const activeMailbox = overview?.connections.find((connection) => connection.id === connectionId) || null;
  const activeMailboxCanSend = connectionCanSend(activeMailbox);
  const sendRecipients = replyRecipientPreview(detail, activeMailbox?.email || '', replyMode);
  const composedRecipients = composeRecipients();

  return <div className="space-y-3">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h1 className="text-2xl font-semibold tracking-tight">Personal assistant</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Read, understand, and reply to important conversations with the selected AI runtime. Every provider action requires your review.</p></div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" asChild><a href="/api/auth/hub"><House />Go to Hub</a></Button>
        <Button size="sm" variant="outline" onClick={() => { void loadWorkspace(); void loadThreads(); }}><RefreshCw />Refresh</Button>
      </div>
    </header>

    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">{error}</div>}
    {oauthNotice && <div className={cn('border px-4 py-3 text-sm', oauthNotice.tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : oauthNotice.tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-destructive/40 bg-destructive/5 text-destructive')} role="status">{oauthNotice.text}</div>}
    {loading || !overview ? <div className="flex min-h-[360px] items-center justify-center border bg-card text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking mailbox connection</div>
      : connectedCount === 0 ? <MailboxConnectGate overview={overview} connect={connect} working={working} />
      : <>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-2.5 text-xs text-muted-foreground">
      <ServiceStatus ready={Boolean(overview.configured)} text={`${connectedCount} mailbox${connectedCount === 1 ? '' : 'es'} connected`} />
      <ServiceStatus ready={runtimeReady} text={runtimeReady ? `${assistantRuntime?.providerLabel || assistantRuntime?.model || 'AI runtime'} ready` : `${assistantRuntime?.providerLabel || 'AI runtime'} unavailable`} />
      <ServiceStatus ready={overview?.worker?.running !== false} text={workerBusy ? `${workerBusy} assistant request${workerBusy === 1 ? '' : 's'} active` : 'Assistant queue idle'} />
      <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" />Human review required</span>
    </div>

    <Tabs value={tab} onValueChange={(value) => { changeTab(value as WorkspaceTab); }}>
      <TabsList className="overflow-x-auto" aria-label="Assistant workspace">
        <TabsTrigger className="shrink-0" value="mailbox">Mailbox</TabsTrigger>
        <TabsTrigger className="shrink-0" value="work-products">Work products</TabsTrigger>
        <TabsTrigger className="shrink-0" value="actions">Actions <span className="ml-1 text-xs text-muted-foreground">{actions.length}</span></TabsTrigger>
        <TabsTrigger className="shrink-0" value="calendar">Calendar</TabsTrigger>
        <TabsTrigger className="shrink-0" value="knowledge">Workspace knowledge</TabsTrigger>
        <TabsTrigger className="shrink-0" value="history">History <span className="ml-1 text-xs text-muted-foreground">{runs.length}</span></TabsTrigger>
        <TabsTrigger className="shrink-0" value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="mailbox" className="mt-3">
        <div className="relative flex h-[calc(100dvh-13.5rem)] min-h-[600px] max-h-[980px] overflow-hidden rounded-md border bg-card">
          <MailboxThreadList
            activeConnection={activeMailbox} connections={overview?.connections || []} selectedConnection={connectionId}
            setSelectedConnection={selectConnection} configured={overview?.configured === true}
            connect={connect} disconnect={disconnect} working={working} search={threadSearch} setSearch={changeThreadSearch}
            filter={threadFilter} setFilter={setThreadFilter}
            threads={threads} selectedThread={threadId} selectThread={selectThread}
            loading={loading || threadLoading} error={threadError} retry={() => void loadThreads()}
            nextCursor={threadCursor} loadingMore={threadLoadingMore} loadMore={() => void loadMoreThreads()}
            mobileView={mobileMailboxView}
            compose={() => activeMailboxCanSend ? setComposeOpen(true)
              : void connect(activeMailbox?.provider === 'microsoft' ? 'microsoft' : 'google')}
            canCompose={activeMailboxCanSend}
          />
          <ConversationReader
            thread={readerThread} detail={detail} loading={threadDetailLoading} error={threadDetailError}
            retry={() => void loadThreadDetail()} mobileView={mobileMailboxView}
            back={() => setMobileMailboxView('threads')}
            openAssistant={() => { setAssistantMode('insights'); setAssistantOpen(true); }}
            openReply={() => { setAssistantMode('reply'); setAssistantOpen(true); }}
          />
          {assistantOpen && <MailboxAssistantPanel
            thread={readerThread} summaryRun={selectedMailboxSummaryRun} draftRun={selectedMailboxDraftRun}
            mode={assistantMode} setMode={setAssistantMode} close={() => setAssistantOpen(false)}
            working={working} startRun={startRun} tone={tone} setTone={setTone}
            instructions={instructions} setInstructions={setInstructions}
            question={threadQuestion} setQuestion={setThreadQuestion} askThread={askThread}
            draftSubject={mailboxDraftSubject} draftBody={mailboxDraftBody} setDraftSubject={setDraftSubject}
            setDraftBody={setDraftBody} saveDraft={saveDraft} draftDirty={draftDirty}
            canSend={activeMailboxCanSend} reconnect={() => void connect(activeMailbox?.provider === 'microsoft' ? 'microsoft' : 'google')}
            replyMode={replyMode} setReplyMode={setReplyMode} reviewSend={() => setSendConfirmOpen(true)}
          />}
        </div>
      </TabsContent>

      <TabsContent value="work-products">
        <WorkProductsPane
          documentType={workProductType} setDocumentType={setWorkProductType}
          title={workProductTitle} setTitle={setWorkProductTitle}
          objective={workProductObjective} setObjective={setWorkProductObjective}
          sources={sources} selectedSources={workProductSourceRefs} setSelectedSources={setWorkProductSourceRefs}
          knowledgeBases={knowledgeBases} selectedKnowledge={workProductKnowledgeIds} setSelectedKnowledge={setWorkProductKnowledgeIds}
          mailboxThread={selectedThread} includeMailboxThread={includeMailboxThread} setIncludeMailboxThread={setIncludeMailboxThread}
          calendarEvidence={workProductCalendar} clearCalendarEvidence={() => setWorkProductCalendar(null)}
          generate={() => void startWorkProduct()} generating={working === 'work-product'}
          runs={workProductRuns} selectedRun={selectedWorkProductRun} selectRun={selectRun}
          draftSubject={draftSubject} draftBody={draftBody} setDraftSubject={setDraftSubject} setDraftBody={setDraftBody}
          saveDraft={saveDraft} savingDraft={working === 'save-draft'}
          promoteAction={promoteAction} working={working}
        />
      </TabsContent>

      <TabsContent value="actions">
        <ActionsPane
          actions={actions} selected={selectedAction} select={(id) => setSelectedActionId(id)}
          reminders={reminders} saveAction={saveAction} working={working}
          addReminder={addReminder} saveReminder={saveReminder}
          error={operationError} refresh={() => void loadAssistantOperations()}
        />
      </TabsContent>

      <TabsContent value="calendar">
        <CalendarPane
          connections={overview?.connections.filter((item) => item.status === 'connected') || []}
          connectionId={calendarConnectionId} setConnectionId={setCalendarConnectionId}
          calendars={calendars} calendarId={calendarId} setCalendarId={setCalendarId}
          events={calendarEvents} start={calendarStart} setStart={setCalendarStart}
          end={calendarEnd} setEnd={setCalendarEnd} loading={calendarLoading} error={calendarError} errorCode={calendarErrorCode}
          reconnect={connect} reconnecting={working.startsWith('connect:')}
          refresh={() => void (calendarId ? loadCalendarEvents() : loadCalendars())} useEvent={useCalendarEvent}
        />
      </TabsContent>

      <TabsContent value="knowledge">
        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Ground the question</CardTitle>
              <CardDescription>Select saved intelligence, approved knowledge bases, or both. Graph-and-vector retrieval and the exact evidence excerpts are frozen before queueing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <div>
                <Label htmlFor="assistant-question">Question</Label>
                <Textarea id="assistant-question" className="mt-2 min-h-28" value={question} maxLength={1500} onChange={(event) => setQuestion(event.target.value)} />
              </div>
              <div className="max-h-[430px] overflow-y-auto border">
                <SourceGroup title="Survey intelligence" sources={groupedSources.survey} selected={sourceRefs} toggle={toggleSource} />
                <SourceGroup title="Social intelligence" sources={groupedSources.social} selected={sourceRefs} toggle={toggleSource} />
                <KnowledgeBaseGroup
                  title="Enterprise knowledge"
                  knowledgeBases={knowledgeBases}
                  selected={knowledgeAnswerKnowledgeIds}
                  toggle={toggleKnowledgeAnswerBase}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {sourceRefs.length} saved source{sourceRefs.length === 1 ? '' : 's'} · {knowledgeAnswerKnowledgeIds.length} knowledge base{knowledgeAnswerKnowledgeIds.length === 1 ? '' : 's'}
                </span>
                <Button
                  disabled={working !== '' || !question.trim() || (sourceRefs.length < 1 && knowledgeAnswerKnowledgeIds.length < 1)}
                  onClick={() => void startRun('knowledge-answer')}
                >
                  {working === 'knowledge-answer' ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}Ask from evidence
                </Button>
              </div>
            </CardContent>
          </Card>
          <div>{selectedRun && ['assistant.knowledge_answer', 'knowledge_answer'].includes(selectedRun.kind) ? <RunDetail run={selectedRun} draftSubject="" draftBody="" setDraftSubject={() => undefined} setDraftBody={() => undefined} saveDraft={() => undefined} saving={false} /> : <Card><CardContent className="py-20 text-center"><BookOpenCheck className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No knowledge answer selected</div><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">The assistant answers only from the saved sources you select and displays its evidence references.</p></CardContent></Card>}</div>
        </div>
      </TabsContent>

      <TabsContent value="history">
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card><CardHeader className="border-b"><CardTitle>Assistant history</CardTitle><CardDescription>Private to your account within the active space.</CardDescription></CardHeader><CardContent className="p-0">{runs.length ? <div className="divide-y">{runs.map((run) => <button key={run.id} aria-pressed={run.id === selectedRunId} onClick={() => selectRun(run.id)} className={cn('w-full border-l-2 border-transparent px-4 py-3 text-left hover:bg-muted/30', run.id === selectedRunId && 'border-l-primary bg-muted/50')}><span className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{runTitle(run)}</span><RunBadge run={run} /></span><span className="mt-1 block truncate text-xs text-muted-foreground">{run.subjectRef ? `Mailbox thread ${run.subjectRef}` : run.sourceRefs?.length ? `${run.sourceRefs.length} saved evidence source${run.sourceRefs.length === 1 ? '' : 's'}` : 'Saved assistant request'}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatDateTime(run.createdAt)}</span></button>)}</div> : <EmptyLine icon={MailCheck} text="No assistant work has been queued." />}</CardContent></Card>
          <div>{selectedRun ? <RunDetail run={selectedRun} draftSubject={draftSubject} draftBody={draftBody} setDraftSubject={setDraftSubject} setDraftBody={setDraftBody} saveDraft={saveDraft} saving={working === 'save-draft'} /> : <Card><CardContent className="py-20 text-center text-sm text-muted-foreground">Select a run to inspect its evidence, output, and runtime record.</CardContent></Card>}</div>
        </div>
      </TabsContent>

      <TabsContent value="audit">
        <AuditPane events={auditEvents} error={operationError} refresh={() => void loadAssistantOperations()} />
      </TabsContent>
    </Tabs>
    <Dialog open={sendConfirmOpen} onOpenChange={(open) => { if (working !== 'send-reply') setSendConfirmOpen(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this reply?</DialogTitle>
          <DialogDescription>This is the only step that changes your mailbox. Nylas will send the saved draft as you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div><div className="font-medium">To</div><div className="mt-1 text-muted-foreground">{sendRecipients.join(', ') || 'No recipient available'}</div></div>
          <div><div className="font-medium">Subject</div><div className="mt-1 break-words text-muted-foreground">{draftSubject}</div></div>
          <div className="max-h-48 overflow-y-auto border bg-muted/20 p-3 leading-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: emailBodyToHtml(draftBody) }} />
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />The provider message ID, recipients, and content hashes will be retained in the audit trail.</div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={working === 'send-reply'} onClick={() => setSendConfirmOpen(false)}>Keep editing</Button>
          <Button disabled={working === 'send-reply' || !sendRecipients.length} onClick={() => void sendSavedReply()}>{working === 'send-reply' ? <Loader2 className="animate-spin" /> : <Send />}Send reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={composeOpen} onOpenChange={(open) => {
      if (working === 'compose-send' || working === 'compose-ai') return;
      if (!open && composeDirty && !window.confirm('Discard this unsent email?')) return;
      if (open) setComposeOpen(true); else resetCompose();
    }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{composeReview ? 'Review email' : 'New email'}</DialogTitle>
          <DialogDescription>{composeReview
            ? 'Confirm the recipients and final content before Nylas sends from your connected mailbox.'
            : `Compose from ${activeMailbox?.email || 'the selected mailbox'}. AI can prepare a draft, but only you can send it.`}</DialogDescription>
        </DialogHeader>
        {composeReview ? <div className="space-y-4 text-sm">
          <div className="grid gap-3 border-b pb-4 sm:grid-cols-[90px_minmax(0,1fr)]">
            <div className="text-muted-foreground">From</div><div>{activeMailbox?.email}</div>
            <div className="text-muted-foreground">To</div><div className="break-words">{composedRecipients.to.map((item) => item.email).join(', ')}</div>
            {composedRecipients.cc.length > 0 && <><div className="text-muted-foreground">Cc</div><div className="break-words">{composedRecipients.cc.map((item) => item.email).join(', ')}</div></>}
            {composedRecipients.bcc.length > 0 && <><div className="text-muted-foreground">Bcc</div><div className="break-words">{composedRecipients.bcc.map((item) => item.email).join(', ')}</div></>}
            <div className="text-muted-foreground">Subject</div><div className="break-words font-medium">{composeSubject}</div>
          </div>
          <div className="max-h-72 overflow-y-auto border bg-muted/10 p-4 leading-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: emailBodyToHtml(composeBody) }} />
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Sending is idempotent and records the provider message ID, recipients, and content hashes in the assistant audit.</div>
        </div> : <div className="space-y-4">
          <div>
            <Label htmlFor="assistant-compose-to">To</Label>
            <Input id="assistant-compose-to" className="mt-2" value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="name@example.com, Person <person@example.com>" autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="assistant-compose-cc">Cc</Label><Input id="assistant-compose-cc" className="mt-2" value={composeCc} onChange={(event) => setComposeCc(event.target.value)} placeholder="Optional" autoComplete="off" /></div>
            <div><Label htmlFor="assistant-compose-bcc">Bcc</Label><Input id="assistant-compose-bcc" className="mt-2" value={composeBcc} onChange={(event) => setComposeBcc(event.target.value)} placeholder="Optional" autoComplete="off" /></div>
          </div>
          {composedRecipients.invalid.length > 0 && <p className="text-xs text-destructive" role="alert">Check: {composedRecipients.invalid.join(', ')}</p>}
          <div><Label htmlFor="assistant-compose-subject">Subject</Label><Input id="assistant-compose-subject" className="mt-2" value={composeSubject} maxLength={500} onChange={(event) => setComposeSubject(event.target.value)} /></div>
          <section className="border bg-muted/10 p-4" aria-labelledby="assistant-compose-ai-title">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><h3 id="assistant-compose-ai-title" className="text-sm font-semibold">Draft with AI</h3></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div><Label htmlFor="assistant-compose-tone">Tone</Label><select id="assistant-compose-tone" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={composeTone} onChange={(event) => setComposeTone(event.target.value)}><option value="professional">Professional</option><option value="warm">Warm</option><option value="concise">Concise</option><option value="direct">Direct</option><option value="empathetic">Empathetic</option></select></div>
              <div><Label htmlFor="assistant-compose-instructions">What should the email achieve?</Label><Textarea id="assistant-compose-instructions" className="mt-2 min-h-20" value={composeInstructions} maxLength={2_000} onChange={(event) => setComposeInstructions(event.target.value)} placeholder="Explain the purpose, relevant facts, and the response you need." /></div>
            </div>
            <div className="mt-3 flex justify-end"><Button type="button" size="sm" variant="outline" disabled={working !== '' || !composeInstructions.trim() || !composedRecipients.to.length || composedRecipients.invalid.length > 0} onClick={() => void draftComposeWithAi()}>{working === 'compose-ai' ? <Loader2 className="animate-spin" /> : <Sparkles />}Draft with AI</Button></div>
          </section>
          <div><Label className="mb-2 block" htmlFor="assistant-compose-body">Email body</Label><RichEmailEditor id="assistant-compose-body" ariaLabel="Email body" value={composeBody} onChange={setComposeBody} maxLength={12_000} placeholder="Write your email…" /></div>
        </div>}
        <DialogFooter>
          {composeReview ? <>
            <Button variant="outline" disabled={working === 'compose-send'} onClick={() => setComposeReview(false)}>Back to editing</Button>
            <Button disabled={working === 'compose-send'} onClick={() => void sendComposedEmail()}>{working === 'compose-send' ? <Loader2 className="animate-spin" /> : <Send />}Send email</Button>
          </> : <>
            <Button variant="outline" disabled={working !== ''} onClick={() => {
              if (!composeDirty || window.confirm('Discard this unsent email?')) resetCompose();
            }}>Cancel</Button>
            <Button disabled={working !== '' || !composedRecipients.to.length || composedRecipients.invalid.length > 0 || !composeSubject.trim() || !emailBodyToPlainText(composeBody)} onClick={reviewComposedEmail}>Review email</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>}
  </div>;
}

function MailboxConnectGate({ overview, connect, working }: {
  overview: AssistantOverview;
  connect: (provider: 'google' | 'microsoft') => Promise<void>;
  working: string;
}) {
  const ready = overview.configured === true;
  return <section className="flex min-h-[430px] items-center justify-center border bg-card px-6 py-12" aria-labelledby="mailbox-connect-title">
    <div className="w-full max-w-md text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-md border bg-muted/30"><Inbox className="h-5 w-5 text-muted-foreground" /></div>
      <h2 id="mailbox-connect-title" className="mt-5 text-lg font-semibold">{ready ? 'Connect your mailbox' : 'Mailbox setup needs attention'}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {ready ? 'Connect a Google or Microsoft account to open your private assistant workspace.' : overview.configurationError || 'Mailbox connectivity is not configured.'}
      </p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Button type="button" disabled={!ready || working !== ''} onClick={() => void connect('google')}>{working === 'connect:google' && <Loader2 className="animate-spin" />}Connect Google</Button>
        <Button type="button" variant="outline" disabled={!ready || working !== ''} onClick={() => void connect('microsoft')}>{working === 'connect:microsoft' && <Loader2 className="animate-spin" />}Connect Microsoft</Button>
      </div>
      {!ready && overview.callbackUrl && <p className="mt-5 break-all font-mono text-[11px] leading-5 text-muted-foreground">Callback: {overview.callbackUrl}</p>}
      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Mailbox access remains private to your account in this space.</p>
    </div>
  </section>;
}

function WorkProductsPane({
  documentType, setDocumentType, title, setTitle, objective, setObjective,
  sources, selectedSources, setSelectedSources, knowledgeBases, selectedKnowledge, setSelectedKnowledge,
  mailboxThread, includeMailboxThread, setIncludeMailboxThread, calendarEvidence, clearCalendarEvidence,
  generate, generating, runs, selectedRun, selectRun, draftSubject, draftBody, setDraftSubject, setDraftBody,
  saveDraft, savingDraft, promoteAction, working
}: {
  documentType: AssistantDocumentType;
  setDocumentType: (value: AssistantDocumentType) => void;
  title: string;
  setTitle: (value: string) => void;
  objective: string;
  setObjective: (value: string) => void;
  sources: IntelligenceSource[];
  selectedSources: string[];
  setSelectedSources: (value: string[]) => void;
  knowledgeBases: KnowledgeBase[];
  selectedKnowledge: string[];
  setSelectedKnowledge: (value: string[]) => void;
  mailboxThread: AssistantThread | null;
  includeMailboxThread: boolean;
  setIncludeMailboxThread: (value: boolean) => void;
  calendarEvidence: WorkProductCalendarEvidence | null;
  clearCalendarEvidence: () => void;
  generate: () => void;
  generating: boolean;
  runs: AssistantRun[];
  selectedRun: AssistantRun | null;
  selectRun: (id: string) => void;
  draftSubject: string;
  draftBody: string;
  setDraftSubject: (value: string) => void;
  setDraftBody: (value: string) => void;
  saveDraft: () => void;
  savingDraft: boolean;
  promoteAction: (run: AssistantRun, actionIndex: number, item: AssistantActionItem) => Promise<void>;
  working: string;
}) {
  const hasEvidence = selectedSources.length > 0 || selectedKnowledge.length > 0
    || Boolean(includeMailboxThread && mailboxThread) || Boolean(calendarEvidence);
  const canGenerate = Boolean(title.trim() && objective.trim()
    && (documentType === 'scheduling_proposal' || hasEvidence));

  function toggleSource(ref: string) {
    setSelectedSources(selectedSources.includes(ref)
      ? selectedSources.filter((item) => item !== ref)
      : selectedSources.length < 12 ? [...selectedSources, ref] : selectedSources);
  }

  function toggleKnowledge(id: string) {
    setSelectedKnowledge(selectedKnowledge.includes(id)
      ? selectedKnowledge.filter((item) => item !== id)
      : selectedKnowledge.length < 5 ? [...selectedKnowledge, id] : selectedKnowledge);
  }

  return <div className="mt-4 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Create a work product</CardTitle>
        <CardDescription>Choose the output and the approved evidence the selected AI runtime may use. Every request remains a human-reviewed draft.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div>
          <Label htmlFor="assistant-work-product-type">Work product type</Label>
          <select
            id="assistant-work-product-type"
            className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as AssistantDocumentType)}
          >
            {workProductTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="assistant-work-product-title">Work product title</Label>
          <Input
            id="assistant-work-product-title"
            className="mt-2"
            maxLength={500}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="assistant-work-product-objective">Objective</Label>
          <Textarea
            id="assistant-work-product-objective"
            className="mt-2 min-h-28"
            maxLength={6_000}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          />
        </div>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Saved intelligence</h3>
            <span className="text-xs text-muted-foreground">{selectedSources.length} of 12 selected</span>
          </div>
          <div className="mt-2 max-h-52 overflow-y-auto border">
            {sources.length ? <div className="divide-y">{sources.map((source) => {
              const selected = selectedSources.includes(source.ref);
              return <button
                key={source.ref}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSource(source.ref)}
                className={cn('flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/30', selected && 'bg-muted/50')}
              >
                {selected ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{source.title}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span>
                </span>
              </button>;
            })}</div> : <p className="px-3 py-5 text-sm text-muted-foreground">No saved survey or social intelligence is available.</p>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Knowledge bases</h3>
            <span className="text-xs text-muted-foreground">{selectedKnowledge.length} of 5 selected</span>
          </div>
          <div className="mt-2 max-h-44 overflow-y-auto border">
            {knowledgeBases.length ? <div className="divide-y">{knowledgeBases.map((knowledgeBase) => {
              const selected = selectedKnowledge.includes(knowledgeBase.id);
              return <button
                key={knowledgeBase.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleKnowledge(knowledgeBase.id)}
                className={cn('flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/30', selected && 'bg-muted/50')}
              >
                {selected ? <CheckSquare className="h-4 w-4 shrink-0" /> : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{knowledgeBase.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{knowledgeBase.documentCount} document{knowledgeBase.documentCount === 1 ? '' : 's'}</span>
                </span>
              </button>;
            })}</div> : <p className="px-3 py-5 text-sm text-muted-foreground">No ready knowledge base is available.</p>}
          </div>
        </section>

        {mailboxThread && <label className="flex cursor-pointer items-start gap-3 border px-3 py-3">
          <input
            className="mt-1"
            type="checkbox"
            checked={includeMailboxThread}
            onChange={(event) => setIncludeMailboxThread(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Include selected mailbox conversation</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{mailboxThread.subject}</span>
          </span>
        </label>}

        {calendarEvidence && <div className="flex items-start justify-between gap-3 border px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Calendar evidence</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{calendarEvidence.event.title} · {formatDateTime(calendarEvidence.event.startAt)}</div>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={clearCalendarEvidence}>Remove</Button>
        </div>}

        {!canGenerate && <p className="text-xs leading-5 text-muted-foreground">
          Add a title and objective, then select authorized evidence. Scheduling proposals may be started without evidence.
        </p>}
        <Button className="w-full" disabled={generating || !canGenerate} onClick={generate}>
          {generating ? <Loader2 className="animate-spin" /> : <FileText />}
          Generate work product
        </Button>
      </CardContent>
    </Card>

    <div className="min-w-0 space-y-4">
      {runs.length > 0 && <div className="flex items-center justify-between gap-3 border bg-card px-3 py-2">
        <Label className="shrink-0" htmlFor="assistant-generated-work-product">Generated work product</Label>
        <select
          id="assistant-generated-work-product"
          className="h-9 min-w-0 max-w-md flex-1 rounded-md border-input bg-background px-3 text-sm"
          value={selectedRun?.id || ''}
          onChange={(event) => selectRun(event.target.value)}
        >
          {runs.map((run) => <option key={run.id} value={run.id}>{run.title || runTitle(run)} · {formatDateTime(run.createdAt)}</option>)}
        </select>
      </div>}
      {selectedRun ? <WorkProductDetail
        run={selectedRun}
        draftSubject={draftSubject}
        draftBody={draftBody}
        setDraftSubject={setDraftSubject}
        setDraftBody={setDraftBody}
        saveDraft={saveDraft}
        savingDraft={savingDraft}
        promoteAction={promoteAction}
        working={working}
      /> : <Card><CardContent className="py-20 text-center">
        <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="mt-3 text-sm font-medium">No work product selected</div>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">Select approved evidence and generate a memo, report, meeting pack, policy lookup, or other executive document.</p>
      </CardContent></Card>}
    </div>
  </div>;
}

function WorkProductDetail({
  run, draftSubject, draftBody, setDraftSubject, setDraftBody, saveDraft, savingDraft, promoteAction, working
}: {
  run: AssistantRun;
  draftSubject: string;
  draftBody: string;
  setDraftSubject: (value: string) => void;
  setDraftBody: (value: string) => void;
  saveDraft: () => void;
  savingDraft: boolean;
  promoteAction: (run: AssistantRun, actionIndex: number, item: AssistantActionItem) => Promise<void>;
  working: string;
}) {
  const output = run.output || {};
  return <Card data-testid="assistant-work-product-detail">
    <CardHeader className="border-b">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>{run.title || runTitle(run)}</CardTitle>
          <CardDescription className="mt-1">
            {workProductTypes.find((item) => item.value === run.documentType)?.label || 'Work product'} · queued {formatDateTime(run.createdAt)}
          </CardDescription>
        </div>
        <RunBadge run={run} />
      </div>
    </CardHeader>
    <CardContent className="space-y-6 pt-5">
      <div className="flex gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div><div className="font-semibold">Human review required</div><p className="mt-1 text-xs leading-5">This work product has not been sent, published, or approved.</p></div>
      </div>
      {(run.state === 'queued' || run.state === 'processing') && <div className="flex items-center gap-3 border px-4 py-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        The AI runtime is preparing this durable request.
        <span className="ml-auto text-xs">{run.progress}%</span>
      </div>}
      {run.error && <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{run.error}</div>}
      {output.executiveSummary && <section>
        <h3 className="text-sm font-semibold">Executive summary</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{output.executiveSummary}</p>
      </section>}
      {output.body && <section>
        <h3 className="text-sm font-semibold">Document</h3>
        <div className="mt-2 whitespace-pre-wrap border px-4 py-4 text-sm leading-7">{output.body}</div>
      </section>}
      <ResultList title="Decisions" values={output.decisions} />
      {Boolean(output.actionItems?.length) && <section>
        <h3 className="text-sm font-semibold">Proposed actions</h3>
        <div className="mt-2 divide-y border">
          {output.actionItems?.map((item, index) => <div className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-start" key={`${item.sourceRef || 'action'}-${index}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.action || item.title || `Action ${index + 1}`}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {item.owner ? `Owner: ${item.owner}` : 'Owner not assigned'}
                {item.dueDate ? ` · Due: ${item.dueDate}` : ''}
                {item.sourceRef ? ` · Source: ${item.sourceRef}` : ''}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={working !== ''}
              onClick={() => void promoteAction(run, index, item)}
            >
              {working === `promote:${run.id}:${index}` ? <Loader2 className="animate-spin" /> : <Plus />}
              Add to actions
            </Button>
          </div>)}
        </div>
      </section>}
      {Boolean(output.citations?.length) && <section>
        <h3 className="text-sm font-semibold">Evidence</h3>
        <div className="mt-2 divide-y border">{output.citations?.map((citation, index) => <div className="px-4 py-3" key={`${citation.sourceRef}-${index}`}>
          <div className="text-xs font-medium">{citation.sourceRef}</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{citation.excerpt}</p>
        </div>)}</div>
      </section>}
      <ResultList title="Limitations" values={output.limitations} />
      {run.draft && <section className="space-y-4 border-t pt-5">
        <div>
          <Label htmlFor={`work-product-title-${run.id}`}>Document title</Label>
          <Input id={`work-product-title-${run.id}`} className="mt-2" value={draftSubject} maxLength={500} onChange={(event) => setDraftSubject(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={`work-product-body-${run.id}`}>Editable work product</Label>
          <Textarea id={`work-product-body-${run.id}`} className="mt-2 min-h-72" value={draftBody} maxLength={24_000} onChange={(event) => setDraftBody(event.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Revision {run.draft.revision} · the original output remains in the audit record.</span>
          <Button size="sm" disabled={savingDraft || !draftSubject.trim() || !draftBody.trim()} onClick={saveDraft}>
            {savingDraft ? <Loader2 className="animate-spin" /> : <Save />}Save draft
          </Button>
        </div>
      </section>}
      <RuntimeFootnote run={run} />
    </CardContent>
  </Card>;
}

function ActionsPane({
  actions, selected, select, reminders, saveAction, working, addReminder, saveReminder, error, refresh
}: {
  actions: AssistantAction[];
  selected: AssistantAction | null;
  select: (id: string) => void;
  reminders: AssistantReminder[];
  saveAction: (action: AssistantAction) => Promise<void>;
  working: string;
  addReminder: (actionId: string, remindAt: string, note: string) => Promise<void>;
  saveReminder: (reminder: AssistantReminder) => Promise<void>;
  error: string;
  refresh: () => void;
}) {
  return <div className="mt-4 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle>Actions</CardTitle><CardDescription className="mt-1">Only actions explicitly promoted by a person appear here.</CardDescription></div>
          <Button type="button" size="icon" variant="ghost" aria-label="Refresh actions" onClick={refresh}><RefreshCw /></Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && <div className="border-b bg-amber-50 px-3 py-3 text-xs text-amber-950" role="alert">{error}</div>}
        {actions.length ? <div className="divide-y">{actions.map((action) => <button
          key={action.id}
          type="button"
          aria-pressed={selected?.id === action.id}
          onClick={() => select(action.id)}
          className={cn('w-full border-l-2 border-transparent px-4 py-3 text-left hover:bg-muted/30', selected?.id === action.id && 'border-l-primary bg-muted/50')}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium">{action.title}</span>
            <Badge variant={action.status === 'completed' ? 'success' : action.status === 'cancelled' ? 'secondary' : 'outline'}>
              {action.status.replaceAll('_', ' ')}
            </Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{action.owner || 'No owner'}{action.dueAt ? ` · due ${formatDateTime(action.dueAt)}` : ''}</span>
        </button>)}</div> : <EmptyLine icon={ListTodo} text="No actions have been promoted." />}
      </CardContent>
    </Card>

    {selected ? <ActionEditor
      key={`${selected.id}:${selected.revision}`}
      action={selected}
      reminders={reminders}
      saveAction={saveAction}
      addReminder={addReminder}
      saveReminder={saveReminder}
      working={working}
    /> : <Card><CardContent className="py-20 text-center">
      <ListTodo className="mx-auto h-6 w-6 text-muted-foreground" />
      <div className="mt-3 text-sm font-medium">Select an action</div>
      <p className="mt-1 text-sm text-muted-foreground">Action ownership, status, due dates, and reminders remain under human control.</p>
    </CardContent></Card>}
  </div>;
}

function ActionEditor({
  action, reminders, saveAction, addReminder, saveReminder, working
}: {
  action: AssistantAction;
  reminders: AssistantReminder[];
  saveAction: (action: AssistantAction) => Promise<void>;
  addReminder: (actionId: string, remindAt: string, note: string) => Promise<void>;
  saveReminder: (reminder: AssistantReminder) => Promise<void>;
  working: string;
}) {
  const [title, setTitle] = useState(action.title);
  const [description, setDescription] = useState(action.description);
  const [owner, setOwner] = useState(action.owner);
  const [status, setStatus] = useState(action.status);
  const [priority, setPriority] = useState(action.priority);
  const [dueAt, setDueAt] = useState(localDateTime(action.dueAt));
  const [newReminderAt, setNewReminderAt] = useState('');
  const [newReminderNote, setNewReminderNote] = useState('');

  function submitAction() {
    void saveAction({
      ...action,
      title: title.trim(),
      description: description.trim(),
      owner: owner.trim(),
      status,
      priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null
    });
  }

  async function submitReminder() {
    if (!newReminderAt) return;
    await addReminder(action.id, newReminderAt, newReminderNote.trim());
    setNewReminderAt('');
    setNewReminderNote('');
  }

  return <Card data-testid={`assistant-action-${action.id}`}>
    <CardHeader className="border-b">
      <div className="flex items-start justify-between gap-4">
        <div><CardTitle>Action detail</CardTitle><CardDescription className="mt-1">Revision {action.revision} · promoted {formatDateTime(action.createdAt)}</CardDescription></div>
        <Badge variant={status === 'completed' ? 'success' : 'outline'}>{status.replaceAll('_', ' ')}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-6 pt-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor={`action-title-${action.id}`}>Action title</Label>
          <Input id={`action-title-${action.id}`} className="mt-2" maxLength={700} value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor={`action-description-${action.id}`}>Description</Label>
          <Textarea id={`action-description-${action.id}`} className="mt-2 min-h-24" maxLength={4_000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={`action-status-${action.id}`}>Action status</Label>
          <select id={`action-status-${action.id}`} className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as AssistantAction['status'])}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`action-priority-${action.id}`}>Priority</Label>
          <select id={`action-priority-${action.id}`} className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as AssistantAction['priority'])}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`action-owner-${action.id}`}>Owner</Label>
          <Input id={`action-owner-${action.id}`} className="mt-2" maxLength={200} value={owner} onChange={(event) => setOwner(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={`action-due-${action.id}`}>Due date</Label>
          <Input id={`action-due-${action.id}`} className="mt-2" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button disabled={!title.trim() || working !== ''} onClick={submitAction}>
          {working === `action:${action.id}` ? <Loader2 className="animate-spin" /> : <Save />}Save action
        </Button>
      </div>

      <section className="border-t pt-5">
        <h3 className="text-sm font-semibold">Reminders</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Reminders support follow-up; they do not change a calendar or send external messages.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] md:items-end">
          <div>
            <Label htmlFor={`new-reminder-at-${action.id}`}>Reminder date and time</Label>
            <Input id={`new-reminder-at-${action.id}`} className="mt-2" type="datetime-local" value={newReminderAt} onChange={(event) => setNewReminderAt(event.target.value)} />
          </div>
          <div>
            <Label htmlFor={`new-reminder-note-${action.id}`}>Reminder note</Label>
            <Input id={`new-reminder-note-${action.id}`} className="mt-2" maxLength={1_000} value={newReminderNote} onChange={(event) => setNewReminderNote(event.target.value)} />
          </div>
          <Button disabled={!newReminderAt || working !== ''} onClick={() => void submitReminder()}>
            {working === `reminder:new:${action.id}` ? <Loader2 className="animate-spin" /> : <Plus />}Add reminder
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {reminders.map((reminder) => <ReminderEditor
            key={`${reminder.id}:${reminder.revision}`}
            reminder={reminder}
            save={saveReminder}
            working={working === `reminder:${reminder.id}`}
          />)}
          {!reminders.length && <p className="border px-3 py-5 text-sm text-muted-foreground">No reminders are scheduled for this action.</p>}
        </div>
      </section>
    </CardContent>
  </Card>;
}

function ReminderEditor({
  reminder, save, working
}: {
  reminder: AssistantReminder;
  save: (reminder: AssistantReminder) => Promise<void>;
  working: boolean;
}) {
  const [remindAt, setRemindAt] = useState(localDateTime(reminder.remindAt));
  const [note, setNote] = useState(reminder.note);
  const [state, setState] = useState(reminder.state);

  function submit() {
    if (!remindAt) return;
    void save({ ...reminder, remindAt: new Date(remindAt).toISOString(), note: note.trim(), state });
  }

  return <div className="grid gap-3 border px-3 py-3 lg:grid-cols-[200px_minmax(0,1fr)_150px_auto] lg:items-end" data-testid={`assistant-reminder-${reminder.id}`}>
    <div>
      <Label htmlFor={`reminder-at-${reminder.id}`}>Reminder date and time</Label>
      <Input id={`reminder-at-${reminder.id}`} className="mt-2" type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} />
    </div>
    <div>
      <Label htmlFor={`reminder-note-${reminder.id}`}>Reminder note</Label>
      <Input id={`reminder-note-${reminder.id}`} className="mt-2" maxLength={1_000} value={note} onChange={(event) => setNote(event.target.value)} />
    </div>
    <div>
      <Label htmlFor={`reminder-state-${reminder.id}`}>Reminder state</Label>
      <select id={`reminder-state-${reminder.id}`} className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={state} onChange={(event) => setState(event.target.value as AssistantReminder['state'])}>
        <option value="scheduled">Scheduled</option>
        <option value="completed">Completed</option>
        <option value="dismissed">Dismissed</option>
      </select>
    </div>
    <Button variant="outline" disabled={working || !remindAt} onClick={submit}>{working ? <Loader2 className="animate-spin" /> : <Save />}Save reminder</Button>
  </div>;
}

function CalendarPane({
  connections, connectionId, setConnectionId, calendars, calendarId, setCalendarId,
  events, start, setStart, end, setEnd, loading, error, errorCode, reconnect, reconnecting, refresh, useEvent
}: {
  connections: AssistantConnection[];
  connectionId: string;
  setConnectionId: (id: string) => void;
  calendars: AssistantCalendar[];
  calendarId: string;
  setCalendarId: (id: string) => void;
  events: AssistantCalendarEvent[];
  start: string;
  setStart: (value: string) => void;
  end: string;
  setEnd: (value: string) => void;
  loading: boolean;
  error: string;
  errorCode: string;
  reconnect: (provider: 'google' | 'microsoft') => Promise<void>;
  reconnecting: boolean;
  refresh: () => void;
  useEvent: (event: AssistantCalendarEvent, documentType: 'meeting_pack' | 'scheduling_proposal') => void;
}) {
  const selectedConnection = connections.find((connection) => connection.id === connectionId) || null;
  const calendarPermissionRequired = Boolean(selectedConnection)
    && (!connectionHasCalendarAccess(selectedConnection) || errorCode === 'NYLAS_CALENDAR_SCOPE_REQUIRED');
  return <div className="mt-4 space-y-4">
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div><CardTitle>Calendar</CardTitle><CardDescription className="mt-1">Read calendar context and prepare meeting material. The assistant does not create, move, or cancel events.</CardDescription></div>
          <Button type="button" size="sm" variant="outline" disabled={loading || !connectionId} onClick={refresh}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor="assistant-calendar-connection">Calendar mailbox</Label>
          <select id="assistant-calendar-connection" className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
            {!connectionId && <option value="">Select a mailbox</option>}
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName || connection.email}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="assistant-calendar-id">Calendar</Label>
          <select id="assistant-calendar-id" className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={!calendars.length}>
            {!calendarId && <option value="">Select a calendar</option>}
            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.primary ? ' (primary)' : ''}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="assistant-calendar-start">From</Label>
          <Input id="assistant-calendar-start" className="mt-2" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="assistant-calendar-end">To</Label>
          <Input id="assistant-calendar-end" className="mt-2" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        </div>
      </CardContent>
    </Card>

    {calendarPermissionRequired && selectedConnection ? <div className="flex flex-col justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center" role="alert">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div><p className="font-medium">Calendar permission is not connected</p><p className="mt-1 text-amber-900">Reconnect {selectedConnection.email} and approve read-only calendar access. Email access will remain connected.</p></div>
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0 border-amber-400 bg-white" disabled={reconnecting} onClick={() => void reconnect(selectedConnection.provider === 'microsoft' ? 'microsoft' : 'google')}>
        {reconnecting ? <Loader2 className="animate-spin" /> : <CalendarDays />}Reconnect mailbox
      </Button>
    </div> : error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">{error}</div>}
    <Card>
      <CardHeader className="border-b"><CardTitle>Events</CardTitle><CardDescription>Use an event as read-only evidence for a meeting pack or scheduling proposal.</CardDescription></CardHeader>
      <CardContent className="p-0">
        {loading && !events.length ? <div className="flex items-center gap-3 px-4 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading calendar events.</div>
          : events.length ? <div className="divide-y">{events.map((event) => <article className="flex flex-col justify-between gap-4 px-4 py-4 lg:flex-row lg:items-start" key={event.id}>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{event.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(event.startAt)}{event.endAt ? ` – ${formatDateTime(event.endAt)}` : ''}{event.location ? ` · ${event.location}` : ''}</p>
              {event.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{event.description}</p>}
              {event.participants.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{event.participants.length} participant{event.participants.length === 1 ? '' : 's'}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => useEvent(event, 'meeting_pack')}><FileText />Use for meeting pack</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => useEvent(event, 'scheduling_proposal')}><CalendarDays />Use for scheduling proposal</Button>
            </div>
          </article>)}</div> : <EmptyLine icon={CalendarDays} text={calendarId ? 'No events were returned for this date range.' : 'Select a connected calendar.'} />}
      </CardContent>
    </Card>
  </div>;
}

function AuditPane({
  events, error, refresh
}: {
  events: AssistantAuditEvent[];
  error: string;
  refresh: () => void;
}) {
  return <Card className="mt-4">
    <CardHeader className="border-b">
      <div className="flex items-start justify-between gap-4">
        <div><CardTitle>Assistant audit</CardTitle><CardDescription className="mt-1">Account-scoped records of assistant reads, generated work, action changes, and reminders.</CardDescription></div>
        <Button type="button" size="sm" variant="outline" onClick={refresh}><RefreshCw />Refresh</Button>
      </div>
    </CardHeader>
    <CardContent className="p-0">
      {error && <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">{error}</div>}
      {events.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
          <tr><th className="px-4 py-3 font-medium">Event</th><th className="px-4 py-3 font-medium">Target</th><th className="px-4 py-3 font-medium">Detail</th><th className="px-4 py-3 font-medium">Time</th></tr>
        </thead>
        <tbody className="divide-y">{events.map((event) => <tr key={event.id}>
          <td className="px-4 py-3 font-medium">{event.action}</td>
          <td className="px-4 py-3 text-muted-foreground">{event.targetType}{event.targetId ? ` · ${event.targetId}` : ''}</td>
          <td className="max-w-md px-4 py-3 font-mono text-xs text-muted-foreground">{Object.keys(event.detail || {}).length ? JSON.stringify(event.detail) : '—'}</td>
          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(event.createdAt)}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyLine icon={ShieldCheck} text="No assistant audit events have been recorded." />}
    </CardContent>
  </Card>;
}

function ServiceStatus({ ready, text }: { ready: boolean; text: string }) {
  return <span className="flex items-center gap-2"><span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-600' : 'bg-amber-600')} />{text}</span>;
}

function MailboxThreadList({ activeConnection, connections, selectedConnection, setSelectedConnection, configured, connect, disconnect, working,
  search, setSearch, filter, setFilter, threads, selectedThread, selectThread, loading, error, retry, nextCursor, loadingMore, loadMore, mobileView,
  compose, canCompose }: {
  activeConnection: AssistantConnection | null; connections: AssistantConnection[]; selectedConnection: string;
  setSelectedConnection: (id: string) => void; configured: boolean;
  connect: (provider: 'google' | 'microsoft') => Promise<void>; disconnect: (connection: AssistantConnection) => Promise<void>; working: string;
  search: string; setSearch: (value: string) => void; threads: AssistantThread[]; selectedThread: string;
  filter: MailboxThreadFilter; setFilter: (value: MailboxThreadFilter) => void;
  selectThread: (id: string) => void; loading: boolean; error: string; retry: () => void;
  nextCursor: string | null; loadingMore: boolean; loadMore: () => void; mobileView: MobileMailboxView;
  compose: () => void; canCompose: boolean;
}) {
  return <section className={cn(
    'min-w-0 flex-col border-r bg-card md:flex md:w-[340px] md:shrink-0 xl:w-[360px]',
    mobileView === 'threads' ? 'flex w-full' : 'hidden'
  )}>
    <div className="shrink-0 border-b p-3">
      <div className="mb-3 flex items-center gap-2">
        <label className="sr-only" htmlFor="assistant-mailbox-select">Connected mailbox</label>
        <select
          id="assistant-mailbox-select"
          className="h-9 min-w-0 flex-1 rounded-md border-input bg-background px-3 text-sm"
          disabled={!connections.some((connection) => connection.status === 'connected')}
          value={selectedConnection}
          onChange={(event) => setSelectedConnection(event.target.value)}
        >
          {!selectedConnection && <option value="">Select a mailbox</option>}
          {connections.filter((connection) => connection.status === 'connected').map((connection) =>
            <option key={connection.id} value={connection.id}>{connection.displayName || connection.email} · {connection.email}</option>)}
        </select>
        <details className="relative">
          <summary aria-label="Mailbox accounts" className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"><Plus className="h-4 w-4" />Mailbox</summary>
          <div className="absolute right-0 z-30 mt-1 w-48 border bg-background p-1 shadow-panel">
            <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" disabled={!configured || working !== ''} onClick={() => void connect('google')}>Connect Google</button>
            <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" disabled={!configured || working !== ''} onClick={() => void connect('microsoft')}>Connect Microsoft</button>
            {activeConnection && <button type="button" className="w-full border-t px-3 py-2 text-left text-sm text-destructive hover:bg-muted" disabled={working !== ''} onClick={() => void disconnect(activeConnection)}>Disconnect current</button>}
          </div>
        </details>
      </div>
      <Button type="button" className="mb-3 w-full" size="sm" variant="outline" disabled={!activeConnection || working !== ''} onClick={compose}>
        <MailPlus />{canCompose ? 'Compose email' : 'Enable sending'}
      </Button>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search mail" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search mail" />
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Refresh conversations" onClick={retry}><RefreshCw /></Button>
      </div>
      <div className="mt-3 flex items-center gap-4 border-t pt-2" aria-label="Mailbox filters">
        {([['all', 'All'], ['unread', 'Unread'], ['attachments', 'Attachments']] as const).map(([value, label]) => <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          className={cn('border-b-2 border-transparent py-1 text-xs text-muted-foreground hover:text-foreground', filter === value && 'border-foreground font-medium text-foreground')}
          onClick={() => setFilter(value)}
        >{label}</button>)}
      </div>
    </div>
    <div role="region" aria-label="Mailbox conversations" className="min-h-0 flex-1 overflow-y-auto">
      {error && <div className="flex items-start justify-between gap-3 border-b bg-amber-50 px-3 py-3 text-xs text-amber-950" role="alert"><span>{error}</span><button className="shrink-0 font-semibold underline" onClick={retry}>Retry</button></div>}
      {loading ? <ThreadListSkeleton /> : !selectedConnection ? <div className="px-5 py-10 text-center">
        <Inbox className="mx-auto h-5 w-5 text-muted-foreground" />
        <div className="mt-3 text-sm font-medium">Connect a mailbox</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Your connected accounts stay private to you in this space.</p>
        <div className="mt-4 flex justify-center gap-2"><Button size="sm" variant="outline" disabled={!configured || working !== ''} onClick={() => void connect('google')}>Google</Button><Button size="sm" variant="outline" disabled={!configured || working !== ''} onClick={() => void connect('microsoft')}>Microsoft</Button></div>
      </div> : threads.length ? <div className="divide-y">{threads.map((thread) => {
        const selected = thread.id === selectedThread;
        return <button
          key={thread.id}
          type="button"
          data-testid={`assistant-thread-${thread.id}`}
          aria-pressed={selected}
          onClick={() => selectThread(thread.id)}
          className={cn(
            'w-full border-l-2 border-transparent px-3 py-3 text-left transition-colors hover:bg-muted/35',
            selected && 'border-l-primary bg-secondary/70'
          )}
        >
          <span className="flex items-center gap-2">
            {thread.unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : <span className="w-1.5 shrink-0" />}
            <span className={cn('min-w-0 flex-1 truncate text-xs', thread.unread ? 'font-semibold text-foreground' : 'font-medium')}>{firstParticipant(thread)}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{formatMailboxDate(thread.lastMessageAt)}</span>
          </span>
          <span className="mt-1 flex items-center gap-2 pl-3.5">
            <span className={cn('min-w-0 flex-1 truncate text-sm', thread.unread && 'font-semibold')}>{thread.subject || '(No subject)'}</span>
            {thread.starred && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-600" aria-label="Starred" />}
            {(thread.hasAttachments || Number(thread.attachmentCount) > 0) && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has attachments" />}
          </span>
          <span className="mt-1 flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{thread.snippet || 'No preview available.'}</span>
            {thread.messageCount > 1 && <span className="shrink-0">{thread.messageCount}</span>}
          </span>
        </button>;
      })}{nextCursor && <div className="p-3"><Button className="w-full" size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore && <Loader2 className="animate-spin" />}Load more conversations</Button></div>}</div>
        : <div className="px-5 py-10 text-center text-sm text-muted-foreground">{search ? 'No conversations match this search.' : 'No recent conversations were returned.'}</div>}
    </div>
  </section>;
}

function ThreadListSkeleton() {
  return <div className="divide-y">{Array.from({ length: 8 }, (_, index) => <div className="space-y-2 px-4 py-4" key={index}><div className="h-3 w-2/3 animate-pulse bg-muted" /><div className="h-3 w-5/6 animate-pulse bg-muted" /><div className="h-2.5 w-1/2 animate-pulse bg-muted" /></div>)}</div>;
}

function formatFileSize(value?: number | null) {
  if (!value || value < 1) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ConversationReader({ thread, detail, loading, error, retry, mobileView, back, openAssistant, openReply }: {
  thread: AssistantThread | null; detail: AssistantThreadDetail | null; loading: boolean; error: string; retry: () => void;
  mobileView: MobileMailboxView; back: () => void; openAssistant: () => void; openReply: () => void;
}) {
  const loadedMessageCount = detail?.loadedMessageCount ?? detail?.messages.length ?? 0;
  const totalMessageCount = detail?.totalMessageCount ?? thread?.messageCount ?? loadedMessageCount;
  return <section
    data-testid="assistant-conversation-reader"
    className={cn('min-w-0 flex-1 flex-col bg-background md:flex', mobileView === 'conversation' ? 'flex' : 'hidden')}
  >
    <header className="flex min-h-[64px] shrink-0 items-start gap-3 border-b px-4 py-3">
      <Button className="mt-0.5 md:hidden" type="button" size="icon" variant="ghost" aria-label="Back to conversations" onClick={back}><ArrowLeft /></Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold">{thread?.subject || 'Select a conversation'}</h2>
        {thread && <p className="mt-1 truncate text-xs text-muted-foreground">{thread.participants.map(participantLabel).join(', ')} · {totalMessageCount} message{totalMessageCount === 1 ? '' : 's'}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" aria-label="Open assistant" onClick={openAssistant}><Sparkles /><span className="hidden xl:inline">Ask AI</span></Button>
        <Button type="button" size="sm" disabled={!thread} onClick={openReply}><FilePenLine />Reply</Button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {detail?.messagesTruncated && <div
        className={cn('border-b px-4 py-2 text-xs', detail.messagesTruncated ? 'bg-amber-50 text-amber-950' : 'bg-muted/25 text-muted-foreground')}
        data-testid="assistant-thread-load-metadata"
        role="status"
      >
        Loaded {loadedMessageCount} of {totalMessageCount} messages.
        {detail.messagesTruncated ? ' Some messages were omitted by the mailbox or safety limits.' : ' The full conversation is shown.'}
        {detail.bytesTruncated ? ' The response-size safety limit was reached.' : ''}
        {detail.loadedMessageBytes > 0 && detail.threadByteLimit > 0
          ? ` ${formatFileSize(detail.loadedMessageBytes)} of the ${formatFileSize(detail.threadByteLimit)} thread budget was loaded.`
          : ''}
      </div>}
      {!thread ? <div className="grid h-full min-h-[320px] place-items-center px-6 text-center"><div><MailOpen className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">Choose a conversation</div><p className="mt-1 text-sm text-muted-foreground">Read the thread, ask the AI assistant, or prepare a reviewed reply.</p></div></div>
        : loading || !detail && !error ? <ConversationSkeleton />
          : error ? <div className="mx-auto max-w-xl px-6 py-12 text-center"><CircleAlert className="mx-auto h-5 w-5 text-amber-700" /><div className="mt-3 text-sm font-semibold">Conversation unavailable</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{error}</p><Button className="mt-4" size="sm" variant="outline" onClick={retry}>Retry conversation</Button>{thread.snippet && <p className="mt-6 border-l-2 pl-4 text-left text-sm leading-6 text-muted-foreground">{thread.snippet}</p>}</div>
            : detail?.messages.length ? <div className="mx-auto max-w-4xl">{detail.messages.map((message) => <MailboxMessage key={message.id} message={message} bodyByteLimit={detail.messageBodyByteLimit} />)}</div>
              : <div className="px-6 py-12 text-center text-sm text-muted-foreground">This conversation has no readable messages.</div>}
    </div>
  </section>;
}

function ConversationSkeleton() {
  return <div className="space-y-6 px-5 py-6">{[0, 1].map((item) => <div className="flex gap-3" key={item}><div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" /><div className="w-full space-y-3"><div className="h-3 w-1/3 animate-pulse bg-muted" /><div className="h-3 w-full animate-pulse bg-muted" /><div className="h-3 w-4/5 animate-pulse bg-muted" /></div></div>)}</div>;
}

function MailboxMessage({ message, bodyByteLimit }: { message: AssistantMessage; bodyByteLimit: number }) {
  const sender = message.from[0] ? participantAddress(message.from[0]) : 'Unknown sender';
  const recipients = message.to.map(participantAddress).join(', ');
  const copied = message.cc.map(participantAddress).join(', ');
  return <article data-testid={`assistant-message-${message.id}`} className="border-b px-4 py-5 sm:px-5">
    <div className="flex items-start gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{messageInitial(message)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" title={sender}>{sender}</div>
            <div className="truncate text-xs text-muted-foreground" title={recipients}>to {recipients || 'undisclosed recipients'}{copied ? ` · cc ${copied}` : ''}</div>
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">{formatDateTime(message.sentAt)}</time>
        </div>
        <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</div>
        {message.bodyTruncated && <div className="mt-3 border-l-2 border-amber-600 pl-3 text-xs leading-5 text-amber-900">
          This message body was shortened at the {formatFileSize(bodyByteLimit) || 'configured'} safety limit.
        </div>}
        {Boolean(message.attachments?.length) && <div className="mt-4 flex flex-wrap gap-2">{message.attachments?.map((attachment, index) => <div className="flex max-w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs" key={attachment.id || `${attachment.filename}-${index}`}><Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate font-medium">{attachment.filename}</span>{formatFileSize(attachment.size) && <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>}</div>)}</div>}
      </div>
    </div>
  </article>;
}

function MailboxAssistantPanel({
  thread, summaryRun, draftRun, mode, setMode, close, working, startRun, tone, setTone, instructions, setInstructions,
  question, setQuestion, askThread, draftSubject, draftBody, setDraftSubject, setDraftBody, saveDraft, draftDirty,
  canSend, reconnect, replyMode, setReplyMode, reviewSend
}: {
  thread: AssistantThread | null; summaryRun: AssistantRun | null; draftRun: AssistantRun | null;
  mode: MailboxAssistantMode; setMode: (value: MailboxAssistantMode) => void; close: () => void; working: string;
  startRun: (kind: 'email-summary' | 'email-draft' | 'knowledge-answer', options?: { instructions?: string }) => Promise<unknown>;
  tone: string; setTone: (value: string) => void; instructions: string; setInstructions: (value: string) => void;
  question: string; setQuestion: (value: string) => void; askThread: (value?: string) => Promise<void>;
  draftSubject: string; draftBody: string; setDraftSubject: (value: string) => void; setDraftBody: (value: string) => void;
  saveDraft: () => void; draftDirty: boolean; canSend: boolean; reconnect: () => void;
  replyMode: 'reply' | 'reply_all'; setReplyMode: (value: 'reply' | 'reply_all') => void; reviewSend: () => void;
}) {
  const busy = working !== '';
  const quickQuestions = [
    ['What needs a reply?', 'What specifically needs a response, and what is the deadline?'],
    ['Find commitments', 'List every commitment, owner, and date stated in this thread.'],
    ['Extract actions', 'Extract the concrete next actions supported by this thread.']
  ] as const;
  return <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-card shadow-panel sm:w-[430px] 2xl:relative 2xl:z-0 2xl:w-[420px] 2xl:shadow-none" aria-label="Mailbox assistant">
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-4">
      <div><div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />AI assistant</div><div className="mt-0.5 text-xs text-muted-foreground">Grounded in this conversation</div></div>
      <Button type="button" size="icon" variant="ghost" aria-label="Close assistant" onClick={close}><PanelRightClose /></Button>
    </header>
    <div className="grid h-11 shrink-0 grid-cols-2 border-b" role="tablist" aria-label="AI conversation tools">
      <button type="button" role="tab" aria-selected={mode === 'insights'} className={cn('border-b-2 border-transparent text-sm text-muted-foreground hover:text-foreground', mode === 'insights' && 'border-foreground font-medium text-foreground')} onClick={() => setMode('insights')}>Insights</button>
      <button type="button" role="tab" aria-selected={mode === 'reply'} className={cn('border-b-2 border-transparent text-sm text-muted-foreground hover:text-foreground', mode === 'reply' && 'border-foreground font-medium text-foreground')} onClick={() => setMode('reply')}>Reply</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {mode === 'insights' ? <>
        <div className="space-y-4 border-b p-4">
          <div>
            <Label htmlFor="assistant-thread-question">Ask about this thread</Label>
            <Textarea id="assistant-thread-question" className="mt-2 min-h-20" placeholder="What has been agreed, and what still needs a decision?" value={question} maxLength={1500} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void askThread(); }} />
            <div className="mt-2 flex justify-end"><Button size="sm" disabled={!thread || busy || !question.trim()} onClick={() => void askThread()}>{working === 'email-summary' ? <Loader2 className="animate-spin" /> : <Sparkles />}Ask AI</Button></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map(([label, prompt]) => <Button key={label} type="button" size="sm" variant="outline" disabled={!thread || busy} onClick={() => { setQuestion(prompt); void askThread(prompt); }}>{label}</Button>)}
            <Button type="button" size="sm" variant="outline" disabled={!thread || busy} onClick={() => void startRun('email-summary')}>Summarise</Button>
          </div>
        </div>
        {summaryRun ? <RunDetail embedded run={summaryRun} draftSubject="" draftBody="" setDraftSubject={() => undefined} setDraftBody={() => undefined} saveDraft={() => undefined} saving={false} />
          : <AssistantEmpty thread={thread} text="Ask a question or create a concise summary. The selected AI runtime will use only the loaded thread." />}
      </> : <>
        <div className="space-y-4 border-b p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <div><Label htmlFor="assistant-tone">Tone</Label><select id="assistant-tone" className="mt-2 h-9 w-full rounded-md border-input bg-background px-3 text-sm" value={tone} onChange={(event) => setTone(event.target.value)}><option value="professional">Professional</option><option value="concise">Concise</option><option value="warm">Warm</option><option value="empathetic">Empathetic</option><option value="direct">Direct</option></select></div>
            <Button type="button" size="sm" disabled={!thread || busy} onClick={() => void startRun('email-draft')}>{working === 'email-draft' ? <Loader2 className="animate-spin" /> : <Sparkles />}{draftRun ? 'Regenerate' : 'Draft reply'}</Button>
          </div>
          <div><Label htmlFor="assistant-instructions">What should the reply achieve?</Label><Textarea id="assistant-instructions" className="mt-2 min-h-20" value={instructions} maxLength={2000} onChange={(event) => setInstructions(event.target.value)} /></div>
          {draftRun && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void startRun('email-draft', { instructions: `${instructions}\nMake the reply materially shorter.` })}>Make shorter</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void startRun('email-draft', { instructions: `${instructions}\nMake the reply warmer while preserving every fact.` })}>Make warmer</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void startRun('email-draft', { instructions: `${instructions}\nMake the requested next step explicit.` })}>Clarify next step</Button></div>}
        </div>
        {draftRun ? <RunDetail embedded run={draftRun} draftSubject={draftSubject} draftBody={draftBody} setDraftSubject={setDraftSubject} setDraftBody={setDraftBody} saveDraft={saveDraft} saving={working === 'save-draft'} />
          : <AssistantEmpty thread={thread} text="Set the tone and outcome, then ask the AI assistant for an editable reply." />}
      </>}
    </div>
    {mode === 'reply' && draftRun?.draft && !draftRun.delivery?.sentAt && <div className="shrink-0 space-y-3 border-t bg-background p-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Reply recipients">
        <Button size="sm" variant={replyMode === 'reply' ? 'secondary' : 'outline'} onClick={() => setReplyMode('reply')}>Reply</Button>
        <Button size="sm" variant={replyMode === 'reply_all' ? 'secondary' : 'outline'} onClick={() => setReplyMode('reply_all')}><Users />Reply all</Button>
      </div>
      {canSend ? <Button className="w-full" disabled={busy || draftDirty || !draftSubject.trim() || !emailBodyToPlainText(draftBody)} onClick={reviewSend}><Send />{draftDirty ? 'Save changes before sending' : 'Review and send'}</Button>
        : <div className="space-y-2"><p className="text-xs leading-5 text-muted-foreground">This mailbox was connected with read-only access. Reconnect once to approve reply sending.</p><Button className="w-full" variant="outline" disabled={busy} onClick={reconnect}>Enable replies</Button></div>}
    </div>}
  </aside>;
}

function AssistantEmpty({ thread, text }: { thread: AssistantThread | null; text: string }) {
  return <div className="px-5 py-12 text-center"><MessageSquareText className="mx-auto h-5 w-5 text-muted-foreground" /><div className="mt-3 text-sm font-medium">{thread ? 'AI assistant ready' : 'Select a conversation'}</div><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{thread ? text : 'Choose a thread before asking the AI assistant to help.'}</p></div>;
}

function SourceGroup({ title, sources, selected, toggle }: { title: string; sources: IntelligenceSource[]; selected: string[]; toggle: (ref: string) => void }) {
  return <section className="border-b last:border-b-0"><div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">{title}<span className="float-right text-muted-foreground">{sources.length}</span></div>{sources.length ? <div className="divide-y">{sources.map((source) => { const active = selected.includes(source.ref); return <button key={source.ref} aria-pressed={active} onClick={() => toggle(source.ref)} className={cn('flex w-full gap-3 px-3 py-3 text-left hover:bg-muted/30', active && 'bg-muted/50')}><span className="mt-0.5 text-muted-foreground">{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span><span className="min-w-0"><span className="block text-sm font-medium">{source.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span></span></button>; })}</div> : <p className="px-3 py-5 text-xs text-muted-foreground">No saved reports yet.</p>}</section>;
}

function KnowledgeBaseGroup({
  title, knowledgeBases, selected, toggle
}: {
  title: string;
  knowledgeBases: KnowledgeBase[];
  selected: string[];
  toggle: (id: string) => void;
}) {
  return <section className="border-b last:border-b-0">
    <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">
      {title}<span className="float-right text-muted-foreground">{knowledgeBases.length}</span>
    </div>
    {knowledgeBases.length ? <div className="divide-y">{knowledgeBases.map((knowledgeBase) => {
      const active = selected.includes(knowledgeBase.id);
      return <button
        key={knowledgeBase.id}
        type="button"
        aria-pressed={active}
        onClick={() => toggle(knowledgeBase.id)}
        className={cn('flex w-full gap-3 px-3 py-3 text-left hover:bg-muted/30', active && 'bg-muted/50')}
      >
        <span className="mt-0.5 text-muted-foreground">{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{knowledgeBase.name}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
            {knowledgeBase.description || `${knowledgeBase.readyDocumentCount} ready document${knowledgeBase.readyDocumentCount === 1 ? '' : 's'}`}
          </span>
        </span>
      </button>;
    })}</div> : <p className="px-3 py-5 text-xs text-muted-foreground">No ready knowledge bases yet.</p>}
  </section>;
}

function EmptyLine({ icon: Icon, text }: { icon: typeof Inbox; text: string }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground"><Icon className="mx-auto mb-3 h-5 w-5" />{text}</div>;
}

function RunDetail({ run, draftSubject, draftBody, setDraftSubject, setDraftBody, saveDraft, saving, embedded = false }: {
  run: AssistantRun; draftSubject: string; draftBody: string; setDraftSubject: (value: string) => void; setDraftBody: (value: string) => void;
  saveDraft: () => void; saving: boolean; embedded?: boolean;
}) {
  const output = run.output || {};
  const summary = output.summary;
  const emailDraft = ['assistant.email_draft', 'email_draft'].includes(run.kind);
  return <Card className={cn(embedded && 'rounded-none border-0 shadow-none')} data-testid="assistant-run-detail"><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>{runTitle(run)}</CardTitle><CardDescription className="mt-1">{formatDateTime(run.createdAt)} · Saved assistant output</CardDescription></div><RunBadge run={run} /></div></CardHeader><CardContent className="space-y-5 pt-5">
    {(run.state === 'queued' || run.state === 'processing') && <div className="flex items-center gap-3 border px-4 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{run.stage?.startsWith('waiting_for_') ? run.stage.replaceAll('_', ' ') : 'The AI runtime is processing this durable request.'}<span className="ml-auto text-xs">{run.progress}%</span></div>}
    {run.error && <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{run.error}</div>}
    {emailDraft && run.draft ? <div className="space-y-4">
      {run.delivery?.sentAt ? <div className="flex gap-3 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><MailCheck className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-semibold">Reply sent</div><p className="mt-1 text-xs leading-5">Sent {formatDateTime(run.delivery.sentAt)} to {run.delivery.recipients.join(', ')}.</p></div></div>
        : <div className="flex gap-3 border bg-muted/20 px-4 py-3 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><div className="font-semibold">Review required</div><p className="mt-1 text-xs leading-5 text-muted-foreground">The AI assistant prepared this draft. Saving it does not send anything.</p></div></div>}
      <div><Label htmlFor={`draft-subject-${run.id}`}>Subject</Label><Input id={`draft-subject-${run.id}`} className="mt-2" value={draftSubject} maxLength={500} disabled={Boolean(run.delivery?.sentAt)} onChange={(event) => setDraftSubject(event.target.value)} /></div>
      <div><Label className="mb-2 block" htmlFor={`draft-body-${run.id}`}>Reply</Label><RichEmailEditor id={`draft-body-${run.id}`} value={draftBody} maxLength={12_000} disabled={Boolean(run.delivery?.sentAt)} onChange={setDraftBody} /></div>
      {!run.delivery?.sentAt && <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Revision {run.draft.revision} · Generated copy is retained for audit.</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(`${draftSubject}\n\n${emailBodyToPlainText(draftBody)}`); toast.success('Draft copied.'); }}><Copy />Copy</Button><Button size="sm" disabled={saving || !draftSubject.trim() || !emailBodyToPlainText(draftBody)} onClick={saveDraft}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save draft</Button></div></div>}
    </div> : <>
      {summary && <section><h3 className="text-sm font-semibold">{['assistant.knowledge_answer', 'knowledge_answer'].includes(run.kind) ? 'Answer' : 'Summary'}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{summary}</p></section>}
      {['assistant.knowledge_answer', 'knowledge_answer'].includes(run.kind) && output.answer && !summary && <section><h3 className="text-sm font-semibold">Answer</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{output.answer}</p></section>}
      <ResultList title="Key points" values={output.keyPoints} /><ResultList title="Action items" values={output.actionItems} /><ResultList title="Open questions" values={output.openQuestions} />
      {Boolean(output.citations?.length) && <section><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4><div className="mt-2 divide-y border">{output.citations?.map((citation, index) => <blockquote className="p-4 text-sm leading-6" key={`${citation.sourceRef}-${index}`}><div className="font-medium">{citation.sourceRef}</div><p className="mt-1 text-muted-foreground">“{citation.excerpt}”</p></blockquote>)}</div></section>}
      <ResultList title="Limitations" values={output.limitations || output.caveats} />
    </>}
    <RuntimeFootnote run={run} />
  </CardContent></Card>;
}
