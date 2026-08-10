'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Autocomplete,
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
  Divider,
  FormControl,
  Grid,
  IconButton,
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
import {
  AccountTree,
  Add,
  Check,
  Close,
  Edit,
  EditNote,
  Flag,
  Groups,
  History,
  Person,
  Refresh,
  Send,
  TrendingUp,
} from '@mui/icons-material';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';
import { useDirectReports, useUserContext } from '@/lib/hooks';

type MetricType = 'percentage' | 'number' | 'currency' | 'boolean' | 'milestone';
type GoalType = 'individual' | 'team' | 'department' | 'organization';
type PeriodBand = 'upcoming' | 'current' | 'past';
type WorkspaceView = 'my' | 'team' | 'alignment' | 'approvals';
type Decision = 'approve' | 'request_changes' | 'reject';

interface KeyResult {
  _id?: string;
  title: string;
  description?: string;
  metricType: MetricType;
  unit?: string;
  weight?: number;
  startValue: number;
  targetValue: number;
  currentValue?: number;
  direction?: 'auto' | 'increase' | 'decrease';
  dueDate?: string;
  health?: string;
  lastUpdated?: string;
  aiSuggestions?: string;
}

interface Objective {
  _id?: string;
  title: string;
  description?: string;
  weight?: number;
  aiGenerated?: boolean;
  aiConfidence?: number;
  keyResults: KeyResult[];
}

interface PersonOption {
  id: string;
  name: string;
  email?: string;
  title?: string;
  teamName?: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface Goal {
  _id: string;
  title?: string;
  type: GoalType;
  ownerId: string | { _id?: string; id?: string; userId?: string; name?: string; email?: string };
  owner?: { userId?: string; name?: string; email?: string };
  period: string;
  periodId?: string;
  teamId?: string | null;
  teamHierarchy?: {
    teamId?: string;
    teamName?: string;
    departmentId?: string;
    departmentName?: string;
  };
  status: 'draft' | 'active' | 'closed' | string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'changes_requested' | string;
  progress?: number;
  objectives?: Objective[];
  alignment?: {
    parentOKRId?: string | { _id?: string; title?: string; objectives?: Objective[] } | null;
    alignmentType?: string;
    alignmentNotes?: string;
  };
  lifecycle?: {
    state?: string;
    updatedAt?: string;
    comment?: string;
  };
  assignment?: {
    assignedBy?: { userId?: string; name?: string; email?: string };
    assignedAt?: string;
    acknowledgementStatus?: string;
    acknowledgedAt?: string;
  };
  acknowledgement?: {
    status?: string;
    acknowledgedAt?: string;
    comment?: string;
  };
  createdBy?: { userId?: string; name?: string; email?: string };
  creationSource?: string;
  origin?: { type?: string; label?: string; sourceName?: string } | string;
  pendingChangeRequests?: number;
  score?: number;
  scoring?: {
    status?: string;
    progress?: number | null;
    ratedKeyResults?: number;
    totalKeyResults?: number;
  };
  health?: string;
  permissions?: {
    view?: boolean;
    edit?: boolean;
    submit?: boolean;
    decide?: boolean;
    acknowledge?: boolean;
    requestChange?: boolean;
    checkIn?: boolean;
    align?: boolean;
  };
  updatedAt?: string;
  createdAt?: string;
}

interface AlignableGoal {
  id: string;
  title: string;
  type: GoalType;
  ownerId?: string;
  period?: string;
}

interface HierarchyNode extends Goal {
  children?: HierarchyNode[];
}

interface HierarchyResponse {
  organization: HierarchyNode[];
  unalignedDepartment: HierarchyNode[];
  unalignedTeam: HierarchyNode[];
  unalignedIndividual: HierarchyNode[];
}

interface GoalPeriod {
  _id: string;
  name: string;
  code?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'upcoming' | 'open' | 'closed' | 'archived' | string;
}

interface GoalFormState {
  title: string;
  type: GoalType;
  period: string;
  periodId: string;
  assignees: PersonOption[];
  teamId: string;
  departmentId: string;
  parentOKRId: string;
  objectives: Objective[];
}

const emptyKeyResult = (): KeyResult => ({
  title: '',
  metricType: 'percentage',
  startValue: 0,
  targetValue: 100,
});

const emptyObjective = (): Objective => ({
  title: '',
  description: '',
  weight: 100,
  keyResults: [emptyKeyResult()],
});

function currentQuarterLabel(date = new Date()) {
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}

function adjacentQuarterLabel(offset: number) {
  const now = new Date();
  const quarterIndex = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + offset;
  const year = Math.floor(quarterIndex / 4);
  const quarter = (quarterIndex % 4) + 1;
  return `Q${quarter} ${year}`;
}

function parseQuarter(period?: string) {
  const match = String(period || '').trim().match(/^Q([1-4])\s+(\d{4})$/i);
  if (!match) return null;
  return Number(match[2]) * 4 + Number(match[1]) - 1;
}

function classifyPeriod(period?: string): PeriodBand {
  const parsed = parseQuarter(period);
  const current = parseQuarter(currentQuarterLabel());
  if (parsed == null || current == null || parsed === current) return 'current';
  return parsed > current ? 'upcoming' : 'past';
}

function sortPeriods(periods: string[], direction: 'asc' | 'desc' = 'asc') {
  return [...periods].sort((a, b) => {
    const aValue = parseQuarter(a) ?? 0;
    const bValue = parseQuarter(b) ?? 0;
    return direction === 'asc' ? aValue - bValue : bValue - aValue;
  });
}

function unwrapData<T>(response: any, fallback: T): T {
  return (response?.data?.data ?? response?.data ?? fallback) as T;
}

function apiError(error: any, fallback: string) {
  return error?.response?.data?.error || error?.response?.data?.message || error?.message || fallback;
}

function normalizedId(value: Goal['ownerId'] | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.userId || value.id || value._id || '');
}

function lifecycleState(goal: Goal) {
  return goal.lifecycle?.state || goal.acknowledgement?.status || goal.approvalStatus || goal.status || 'active';
}

function readableState(value?: string) {
  return String(value || 'active')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function goalTitle(goal: Goal) {
  return goal.title || goal.objectives?.[0]?.title || 'Untitled goal';
}

function alignmentTitle(goal: Goal) {
  const parent = goal.alignment?.parentOKRId;
  if (!parent) return '';
  if (typeof parent === 'string') return 'Aligned to a parent goal';
  return parent.title || parent.objectives?.[0]?.title || 'Aligned to a parent goal';
}

function stateColor(state: string): 'default' | 'success' | 'warning' | 'info' | 'error' {
  if (['active', 'approved', 'acknowledged', 'completed'].includes(state)) return 'success';
  if (['pending', 'pending_approval', 'pending_acknowledgement', 'draft'].includes(state)) return 'warning';
  if (['changes_requested', 'request_changes'].includes(state)) return 'info';
  if (['rejected', 'closed', 'cancelled'].includes(state)) return 'error';
  return 'default';
}

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return <Box sx={{ pt: 3 }}>{children}</Box>;
}

const periodInitializationByOrganization = new Map<string, Promise<GoalPeriod[]>>();

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
      <Flag color="disabled" sx={{ mb: 1 }} />
      <Typography variant="h6" gutterBottom>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: action ? 2 : 0 }}>
        {description}
      </Typography>
      {action}
    </Paper>
  );
}

export default function OKRWorkspacePage() {
  const { user: authUser, currentOrganization: authOrganization } = useAuth();
  const { workspace } = usePerformanceWorkspace();
  const { user, role, isManager, isHRAdmin, teams, isLoading: contextLoading } = useUserContext();
  const { directReports, managedTeams, isLoading: reportsLoading } = useDirectReports();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [periodDefinitions, setPeriodDefinitions] = useState<GoalPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodBand, setPeriodBand] = useState<PeriodBand>('current');
  const [selectedPeriod, setSelectedPeriod] = useState(currentQuarterLabel());
  const [view, setView] = useState<WorkspaceView>('my');
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [alignableGoals, setAlignableGoals] = useState<AlignableGoal[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyResponse | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [progressGoal, setProgressGoal] = useState<Goal | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressValues, setProgressValues] = useState<Record<string, number | ''>>({});
  const [progressHealth, setProgressHealth] = useState('not_set');
  const [progressSummary, setProgressSummary] = useState('');
  const [decisionGoal, setDecisionGoal] = useState<Goal | null>(null);
  const [decision, setDecision] = useState<Decision>('approve');
  const [decisionComment, setDecisionComment] = useState('');
  const [changeGoal, setChangeGoal] = useState<Goal | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [proposedChanges, setProposedChanges] = useState('');
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'error' | 'info' } | null>(null);
  const [form, setForm] = useState<GoalFormState>({
    title: '',
    type: 'individual',
    period: currentQuarterLabel(),
    periodId: '',
    assignees: [],
    teamId: '',
    departmentId: '',
    parentOKRId: '',
    objectives: [emptyObjective()],
  });
  const currentUserIds = useMemo(
    () => new Set([user?.id, user?.sub].filter(Boolean).map(String)),
    [user?.id, user?.sub],
  );

  const people = useMemo<PersonOption[]>(() => {
    const map = new Map<string, PersonOption>();
    if (user?.id || user?.sub) {
      const id = String(user.id || user.sub);
      map.set(id, { id, name: user.name || user.email || 'You', email: user.email, title: user.title });
    }
    (directReports || []).forEach((person: any) => {
      const id = String(person.userId || person.id || person._id || '');
      if (!id) return;
      map.set(id, {
        id,
        name: person.name || person.email || 'Team member',
        email: person.email,
        title: person.jobTitle || person.title,
        teamName: person.teamName,
      });
    });
    return Array.from(map.values());
  }, [directReports, user]);

  const departmentOptions = useMemo<DepartmentOption[]>(() => {
    const byId = new Map<string, DepartmentOption>();
    const activeOrganizationId = String(authOrganization?.id || authOrganization?._id || '');
    const organizations = authUser?.idpOrganizations || authUser?.organizations || authUser?.userinfo?.organizations || [];
    const organizationClaim = organizations.find((organization: any) => (
      !activeOrganizationId || String(organization.id || organization._id || organization.organizationId || '') === activeOrganizationId
    )) || authOrganization;
    const claimTeams = [
      ...(teams || []),
      ...(authUser?.idpTeams || authUser?.teams || authUser?.userinfo?.teams || []),
    ].filter((team: any) => !activeOrganizationId || !team.organizationId || String(team.organizationId) === activeOrganizationId);

    const addDepartment = (value: any) => {
      const id = String(value?.id || value?._id || value?.departmentId || value?.department?.id || '');
      if (!id) return;
      const matchingTeam = claimTeams.find((team: any) => String(team.departmentId || team.department?.id || '') === id);
      const name = value?.name || value?.departmentName || value?.department?.name || matchingTeam?.departmentName || matchingTeam?.department?.name || id;
      byId.set(id, { id, name });
    };

    const headedDepartments = organizationClaim?.departmentHeadPermissions || [];
    if (role === 'line_manager') headedDepartments.forEach(addDepartment);
    if (isHRAdmin) {
      headedDepartments.forEach(addDepartment);
      addDepartment({ departmentId: organizationClaim?.departmentId, departmentName: organizationClaim?.departmentName });
      addDepartment({ departmentId: authUser?.departmentId, departmentName: authUser?.departmentName });
      claimTeams.forEach((team: any) => addDepartment({ departmentId: team.departmentId || team.department?.id, departmentName: team.departmentName || team.department?.name }));
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [authOrganization, authUser, isHRAdmin, role, teams]);

  const canCreateDepartmentGoal = departmentOptions.length > 0 && (isHRAdmin || role === 'line_manager');
  const canManageGoalWorkspace = isManager || isHRAdmin || role === 'line_manager';
  const objectiveWeightTotal = useMemo(
    () => form.objectives.reduce((total, objective) => total + Number(objective.weight || 0), 0),
    [form.objectives],
  );

  const ownerName = useCallback((goal: Goal) => {
    if (goal.owner?.name) return goal.owner.name;
    if (typeof goal.ownerId === 'object' && goal.ownerId.name) return goal.ownerId.name;
    const id = normalizedId(goal.ownerId);
    if (currentUserIds.has(id)) return user?.name || 'You';
    return people.find((person) => person.id === id)?.name || goal.owner?.email || 'Team member';
  }, [currentUserIds, people, user?.name]);

  const originLabel = useCallback((goal: Goal) => {
    if (typeof goal.origin === 'string') return readableState(goal.origin);
    if (goal.origin?.label) return goal.origin.label;
    if (goal.origin?.sourceName) return `From ${goal.origin.sourceName}`;
    if (goal.assignment?.assignedBy?.name) return `Assigned by ${goal.assignment.assignedBy.name}`;
    if (goal.createdBy?.name) return `Created by ${goal.createdBy.name}`;
    if (goal.creationSource) return `Created by ${readableState(goal.creationSource)}`;
    if (currentUserIds.has(normalizedId(goal.ownerId))) return 'Created by you';
    return goal.type === 'organization'
      ? 'Organization goal'
      : goal.type === 'department'
        ? 'Department goal'
        : goal.type === 'team'
          ? 'Team goal'
          : 'Assigned goal';
  }, [currentUserIds]);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [response, periodResponse] = await Promise.all([
        api.get('/okrs'),
        api.get('/goal-periods', { params: { includePast: true } }).catch(() => null),
      ]);
      const data = unwrapData<any>(response, []);
      const records = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setGoals(records);
      let periods = periodResponse ? unwrapData<GoalPeriod[]>(periodResponse, []) : [];
      if ((!Array.isArray(periods) || periods.length === 0) && canManageGoalWorkspace) {
        const organizationKey = String(authOrganization?.id || authOrganization?._id || 'active-organization');
        let initialization = periodInitializationByOrganization.get(organizationKey);
        if (!initialization) {
          initialization = api.post('/goal-periods/generate-fiscal', {
            startMonth: 1,
            years: 2,
            includeQuarters: true,
          }).then((generatedResponse) => unwrapData<GoalPeriod[]>(generatedResponse, []))
            .catch((initializationError) => {
              throw initializationError;
            })
            .finally(() => {
              periodInitializationByOrganization.delete(organizationKey);
            });
          periodInitializationByOrganization.set(organizationKey, initialization);
        }
        periods = await initialization;
      }
      setPeriodDefinitions(Array.isArray(periods) ? periods : []);
    } catch (loadError) {
      setGoals([]);
      setError(apiError(loadError, 'Could not load goals. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [authOrganization?.id, authOrganization?._id, canManageGoalWorkspace]);

  useEffect(() => {
    if (!contextLoading) loadGoals();
  }, [contextLoading, loadGoals]);

  useEffect(() => {
    setSelectedGoalId(new URLSearchParams(window.location.search).get('goal') || '');
  }, []);

  useEffect(() => {
    if (!goals.length) return;
    const goalId = new URLSearchParams(window.location.search).get('goal') || '';
    if (!goalId) return;
    const goal = goals.find((item) => item._id === goalId);
    if (!goal) return;
    setSelectedGoalId(goalId);
    setSelectedPeriod(goal.period);
    const definition = periodDefinitions.find((period) => period._id === goal.periodId || period.name === goal.period || period.code === goal.period);
    const now = Date.now();
    const start = definition?.startDate ? new Date(definition.startDate).getTime() : Number.NaN;
    const end = definition?.endDate ? new Date(definition.endDate).getTime() : Number.NaN;
    if (definition?.status === 'closed' || definition?.status === 'archived' || (!Number.isNaN(end) && end < now)) setPeriodBand('past');
    else if (definition?.status === 'upcoming' || definition?.status === 'draft' || (!Number.isNaN(start) && start > now)) setPeriodBand('upcoming');
    else setPeriodBand(classifyPeriod(goal.period));
    if (goal.permissions?.decide) setView('approvals');
    else if (currentUserIds.has(normalizedId(goal.ownerId))) setView('my');
    else if (canManageGoalWorkspace) setView('team');
    window.setTimeout(() => document.getElementById(`goal-${goalId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [canManageGoalWorkspace, currentUserIds, goals, periodDefinitions]);

  const periodsByBand = useMemo(() => {
    const allPeriods = new Set(goals.map((goal) => goal.period).filter(Boolean));
    periodDefinitions.forEach((period) => allPeriods.add(period.name || period.code || ''));
    if (periodDefinitions.length === 0) {
      allPeriods.add(currentQuarterLabel());
      allPeriods.add(adjacentQuarterLabel(1));
      allPeriods.add(adjacentQuarterLabel(-1));
    }
    const grouped: Record<PeriodBand, string[]> = { upcoming: [], current: [], past: [] };
    allPeriods.forEach((period) => {
      if (!period) return;
      const definition = periodDefinitions.find((item) => item.name === period || item.code === period);
      let band = classifyPeriod(period);
      if (definition) {
        const now = Date.now();
        const start = definition.startDate ? new Date(definition.startDate).getTime() : Number.NaN;
        const end = definition.endDate ? new Date(definition.endDate).getTime() : Number.NaN;
        if (definition.status === 'closed' || definition.status === 'archived' || (!Number.isNaN(end) && end < now)) band = 'past';
        else if (definition.status === 'upcoming' || definition.status === 'draft' || (!Number.isNaN(start) && start > now)) band = 'upcoming';
        else band = 'current';
      }
      grouped[band].push(period);
    });
    grouped.upcoming = sortPeriods(grouped.upcoming);
    grouped.current = sortPeriods(grouped.current);
    grouped.past = sortPeriods(grouped.past, 'desc');
    return grouped;
  }, [goals, periodDefinitions]);

  useEffect(() => {
    if (selectedGoalId) return;
    const choices = periodsByBand[periodBand];
    if (!choices.includes(selectedPeriod)) {
      setSelectedPeriod(choices[0] || currentQuarterLabel());
    }
  }, [periodBand, periodsByBand, selectedGoalId, selectedPeriod]);

  const periodGoals = useMemo(
    () => goals.filter((goal) => goal.period === selectedPeriod),
    [goals, selectedPeriod],
  );
  const myGoals = useMemo(
    () => periodGoals.filter((goal) => currentUserIds.has(normalizedId(goal.ownerId))),
    [currentUserIds, periodGoals],
  );
  const teamGoals = useMemo(
    () => periodGoals.filter((goal) => (
      ['team', 'department'].includes(goal.type)
      || (goal.type === 'individual' && !currentUserIds.has(normalizedId(goal.ownerId)))
    )),
    [currentUserIds, periodGoals],
  );
  const approvalGoals = useMemo(
    () => periodGoals.filter((goal) => goal.permissions?.decide === true),
    [periodGoals],
  );

  const views = useMemo(() => {
    const items: Array<{ value: WorkspaceView; label: string; count?: number }> = [];
    if (workspace === 'personal') {
      items.push({ value: 'my', label: 'My Goals', count: myGoals.length });
      return items;
    }
    if (canManageGoalWorkspace) items.push({ value: 'team', label: 'Team & Department Goals', count: teamGoals.length });
    items.push({ value: 'alignment', label: 'Organization Alignment' });
    if (canManageGoalWorkspace || approvalGoals.length > 0) items.push({ value: 'approvals', label: 'Approvals', count: approvalGoals.length });
    return items;
  }, [approvalGoals.length, canManageGoalWorkspace, myGoals.length, teamGoals.length, workspace]);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view') as WorkspaceView | null;
    if (requestedView && views.some((item) => item.value === requestedView)) {
      if (view !== requestedView) setView(requestedView);
      return;
    }
    if (!views.some((item) => item.value === view)) setView(views[0]?.value || 'my');
  }, [view, views, workspace]);

  const loadHierarchy = useCallback(async () => {
    setHierarchyLoading(true);
    try {
      const response = await api.get('/okrs/hierarchy', { params: { period: selectedPeriod } });
      setHierarchy(unwrapData<HierarchyResponse>(response, { organization: [], unalignedDepartment: [], unalignedTeam: [], unalignedIndividual: [] }));
    } catch (hierarchyError) {
      setHierarchy(null);
      setMessage({ text: apiError(hierarchyError, 'Could not load alignment.'), severity: 'error' });
    } finally {
      setHierarchyLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    if (view === 'alignment') loadHierarchy();
  }, [loadHierarchy, view]);

  const creatablePeriods = useMemo(() => periodDefinitions.filter((period) => (
    !['closed', 'archived'].includes(String(period.status || ''))
  )), [periodDefinitions]);

  const resetForm = useCallback(() => {
    const period = periodDefinitions.find((item) => item.name === selectedPeriod || item.code === selectedPeriod)
      || periodDefinitions.find((item) => !['closed', 'archived'].includes(String(item.status || '')));
    setForm({
      title: '',
      type: 'individual',
      period: period?.name || period?.code || selectedPeriod,
      periodId: period?._id || '',
      assignees: [],
      teamId: '',
      departmentId: '',
      parentOKRId: '',
      objectives: [emptyObjective()],
    });
    setAlignableGoals([]);
  }, [periodDefinitions, selectedPeriod]);

  const closeGoalEditor = useCallback(() => {
    setCreateOpen(false);
    setEditingGoal(null);
    setEditLoading(false);
    setEditReason('');
  }, []);

  const loadAlignableGoals = async (type: GoalType, period = form.period) => {
    if (type === 'organization') {
      setAlignableGoals([]);
      return;
    }
    try {
      const response = await api.get('/okrs/alignable/list', { params: { childType: type, period } });
      setAlignableGoals(unwrapData<AlignableGoal[]>(response, []));
    } catch {
      setAlignableGoals([]);
    }
  };

  const updateObjective = (objectiveIndex: number, field: keyof Objective, value: any) => {
    setForm((current) => ({
      ...current,
      objectives: current.objectives.map((objective, index) => (
        index === objectiveIndex ? { ...objective, [field]: value } : objective
      )),
    }));
  };

  const updateKeyResult = (objectiveIndex: number, keyResultIndex: number, field: keyof KeyResult, value: any) => {
    setForm((current) => ({
      ...current,
      objectives: current.objectives.map((objective, index) => (
        index === objectiveIndex
          ? {
            ...objective,
            keyResults: objective.keyResults.map((keyResult, krIndex) => (
              krIndex === keyResultIndex ? { ...keyResult, [field]: value } : keyResult
            )),
          }
          : objective
      )),
    }));
  };

  const validateGoal = () => {
    if (!form.title.trim()) return 'Add a goal title.';
    if (!form.period) return 'Choose a period.';
    if (form.type === 'individual' && canManageGoalWorkspace && form.assignees.length === 0) return 'Choose at least one assignee.';
    if (form.type === 'team' && !form.teamId) return 'Choose a team.';
    if (form.type === 'department' && !form.departmentId) return 'Choose a department.';
    if (form.objectives.some((objective) => !objective.title.trim())) return 'Every objective needs a title.';
    if (Math.abs(objectiveWeightTotal - 100) > 0.01) return `Objective weights must total 100% (currently ${objectiveWeightTotal}%).`;
    if (form.objectives.some((objective) => objective.keyResults.length === 0 || objective.keyResults.some((kr) => !kr.title.trim()))) {
      return 'Every objective needs at least one named key result.';
    }
    return '';
  };

  const createGoal = async () => {
    const validationError = validateGoal();
    if (validationError) {
      setMessage({ text: validationError, severity: 'error' });
      return;
    }

    setSaving(true);
    try {
      const currentUser = people.find((person) => currentUserIds.has(person.id));
      const selectedTeam = [...(managedTeams || []), ...(teams || [])].find((team: any) => String(team.id || team.teamId || team._id || '') === form.teamId);
      const selectedDepartmentId = form.type === 'department'
        ? form.departmentId
        : String(selectedTeam?.departmentId || selectedTeam?.department?.id || '');
      const selectedDepartment = departmentOptions.find((department) => department.id === selectedDepartmentId);
      const selectedDepartmentName = selectedDepartment?.name || selectedTeam?.departmentName || selectedTeam?.department?.name;
      const assignees = form.type === 'individual'
        ? (form.assignees.length ? form.assignees : currentUser ? [currentUser] : [])
        : [currentUser].filter(Boolean) as PersonOption[];
      const targets = assignees.length ? assignees : [{ id: String(user?.id || user?.sub), name: user?.name || 'You' }];

      await Promise.all(targets.map((assignee) => api.post('/okrs', {
        title: form.title.trim(),
        type: form.type,
        period: form.period,
        periodId: form.periodId || undefined,
        ownerId: assignee.id,
        teamId: form.type === 'team' ? form.teamId : undefined,
        teamName: form.type === 'team' ? selectedTeam?.name || selectedTeam?.teamName : undefined,
        departmentId: ['team', 'department'].includes(form.type) ? selectedDepartmentId || undefined : undefined,
        departmentName: ['team', 'department'].includes(form.type) ? selectedDepartmentName : undefined,
        parentOKRId: form.parentOKRId || undefined,
        objectives: form.objectives.map((objective) => ({
          title: objective.title.trim(),
          description: objective.description?.trim() || '',
          weight: objective.weight || 0,
          keyResults: objective.keyResults.map((keyResult) => ({
            title: keyResult.title.trim(),
            metricType: keyResult.metricType,
            startValue: Number(keyResult.startValue),
            targetValue: Number(keyResult.targetValue),
          })),
        })),
      })));

      setCreateOpen(false);
      resetForm();
      await loadGoals();
      setMessage({
        text: targets.length > 1 ? `Goal created for ${targets.length} people.` : 'Goal created.',
        severity: 'success',
      });
    } catch (createError) {
      setMessage({ text: apiError(createError, 'Could not create goal.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const openEditGoal = async (goal: Goal) => {
    setEditingGoal(goal);
    setCreateOpen(false);
    setEditLoading(true);
    setEditReason('');
    try {
      const response = await api.get(`/okrs/${goal._id}`);
      const fullGoal = unwrapData<Goal>(response, goal);
      const ownerId = normalizedId(fullGoal.ownerId);
      const owner = people.find((person) => person.id === ownerId) || {
        id: ownerId,
        name: ownerName(fullGoal),
        email: fullGoal.owner?.email,
      };
      const periodId = typeof fullGoal.periodId === 'string'
        ? fullGoal.periodId
        : String((fullGoal.periodId as { _id?: string } | undefined)?._id || '');
      const parentOKRId = normalizedId(fullGoal.alignment?.parentOKRId as Goal['ownerId']);
      const objectives = (fullGoal.objectives || []).map((objective) => ({
        ...objective,
        _id: objective._id,
        title: objective.title || '',
        description: objective.description || '',
        weight: objective.weight ?? 0,
        keyResults: (objective.keyResults || []).map((keyResult) => ({
          ...keyResult,
          _id: keyResult._id,
          title: keyResult.title || '',
          description: keyResult.description || '',
          metricType: keyResult.metricType || 'percentage',
          startValue: Number(keyResult.startValue ?? 0),
          targetValue: Number(keyResult.targetValue ?? 100),
          ...(typeof keyResult.currentValue === 'number' ? { currentValue: keyResult.currentValue } : {}),
        })),
      }));

      setEditingGoal(fullGoal);
      setForm({
        title: goalTitle(fullGoal),
        type: fullGoal.type,
        period: fullGoal.period,
        periodId,
        assignees: ownerId ? [owner] : [],
        teamId: String(fullGoal.teamId || fullGoal.teamHierarchy?.teamId || ''),
        departmentId: String(fullGoal.teamHierarchy?.departmentId || ''),
        parentOKRId,
        objectives: objectives.length ? objectives : [emptyObjective()],
      });
      await loadAlignableGoals(fullGoal.type, fullGoal.period);
    } catch (editError) {
      closeGoalEditor();
      setMessage({ text: apiError(editError, 'Could not load this goal for editing.'), severity: 'error' });
    } finally {
      setEditLoading(false);
    }
  };

  const saveGoalEdit = async () => {
    if (!editingGoal) return;
    const validationError = validateGoal();
    if (validationError) {
      setMessage({ text: validationError, severity: 'error' });
      return;
    }
    if (!editReason.trim()) {
      setMessage({ text: 'Add a short reason for this edit.', severity: 'error' });
      return;
    }

    setSaving(true);
    try {
      const response = await api.put(`/okrs/${editingGoal._id}`, {
        title: form.title.trim(),
        period: form.period,
        periodId: form.periodId || undefined,
        parentOKRId: form.parentOKRId || null,
        editReason: editReason.trim(),
        objectives: form.objectives.map((objective) => {
          const keyResultWeightTotal = objective.keyResults.reduce((total, keyResult) => total + Number(keyResult.weight ?? 0), 0);
          const hasExplicitKeyResultWeights = objective.keyResults.every((keyResult) => typeof keyResult.weight === 'number')
            && Math.abs(keyResultWeightTotal - 100) <= 0.01;
          return {
            ...(objective._id ? { _id: objective._id } : {}),
            title: objective.title.trim(),
            description: objective.description?.trim() || '',
            weight: objective.weight ?? 0,
            aiGenerated: objective.aiGenerated,
            aiConfidence: objective.aiConfidence,
            keyResults: objective.keyResults.map((keyResult) => ({
              ...(keyResult._id ? { _id: keyResult._id } : {}),
              title: keyResult.title.trim(),
              description: keyResult.description?.trim() || '',
              metricType: keyResult.metricType,
              unit: keyResult.unit,
              ...(hasExplicitKeyResultWeights ? { weight: keyResult.weight } : {}),
              startValue: Number(keyResult.startValue),
              targetValue: Number(keyResult.targetValue),
              ...(typeof keyResult.currentValue === 'number' ? { currentValue: keyResult.currentValue } : {}),
              direction: keyResult.direction,
              dueDate: keyResult.dueDate,
              health: keyResult.health,
              lastUpdated: keyResult.lastUpdated,
              aiSuggestions: keyResult.aiSuggestions,
            })),
          };
        }),
      });
      const updatedGoal = unwrapData<Goal>(response, editingGoal);
      closeGoalEditor();
      await loadGoals();
      setMessage({
        text: updatedGoal.lifecycle?.state === 'pending_acknowledgement'
          ? 'Goal updated. The employee must acknowledge the new version.'
          : 'Goal updated.',
        severity: 'success',
      });
    } catch (editError) {
      setMessage({ text: apiError(editError, 'Could not update this goal.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const performAction = async (goal: Goal, action: 'submit' | 'acknowledge') => {
    setSaving(true);
    try {
      await api.post(`/okrs/${goal._id}/${action}`, {});
      await loadGoals();
      setMessage({ text: action === 'acknowledge' ? 'Goal acknowledged.' : 'Goal submitted for approval.', severity: 'success' });
    } catch (actionError) {
      setMessage({ text: apiError(actionError, `Could not ${action} goal.`), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const openProgress = async (goal: Goal) => {
    setProgressLoading(true);
    setProgressGoal(goal);
    try {
      const response = await api.get(`/okrs/${goal._id}`);
      const fullGoal = unwrapData<Goal>(response, goal);
      setProgressGoal(fullGoal);
      setProgressHealth(fullGoal.health || 'not_set');
      setProgressSummary('');
      const values: Record<string, number | ''> = {};
      (fullGoal.objectives || []).forEach((objective, objectiveIndex) => {
        (objective.keyResults || []).forEach((keyResult, keyResultIndex) => {
          values[`${objectiveIndex}:${keyResultIndex}`] = typeof keyResult.currentValue === 'number'
            ? keyResult.currentValue
            : '';
        });
      });
      setProgressValues(values);
    } catch (detailError) {
      setProgressGoal(null);
      setMessage({ text: apiError(detailError, 'Could not load goal details.'), severity: 'error' });
    } finally {
      setProgressLoading(false);
    }
  };

  const saveProgress = async () => {
    if (!progressGoal) return;
    setSaving(true);
    try {
      const healthChanged = progressHealth !== (progressGoal.health || 'not_set');
      const updates: Array<{
        objectiveId?: string;
        objectiveIndex: number;
        keyResultId?: string;
        keyResultIndex: number;
        currentValue: number;
      }> = [];
      (progressGoal.objectives || []).forEach((objective, objectiveIndex) => {
        (objective.keyResults || []).forEach((keyResult, keyResultIndex) => {
          const currentValue = progressValues[`${objectiveIndex}:${keyResultIndex}`];
          if (currentValue !== '' && currentValue !== undefined && currentValue !== keyResult.currentValue) {
            updates.push({
              objectiveId: objective._id,
              objectiveIndex,
              keyResultId: keyResult._id,
              keyResultIndex,
              currentValue,
            });
          }
        });
      });
      if (updates.length || progressSummary.trim() || healthChanged) {
        await api.post(`/okrs/${progressGoal._id}/check-ins`, {
          idempotencyKey: `web-${Date.now()}`,
          summary: progressSummary.trim() || undefined,
          health: progressHealth,
          keyResultUpdates: updates,
        });
      }
      setProgressGoal(null);
      await loadGoals();
      setMessage({ text: updates.length || progressSummary.trim() || healthChanged ? 'Progress check-in saved.' : 'No progress changes to save.', severity: 'success' });
    } catch (progressError) {
      setMessage({ text: apiError(progressError, 'Could not update progress.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const submitDecision = async () => {
    if (!decisionGoal) return;
    if (decision !== 'approve' && !decisionComment.trim()) {
      setMessage({ text: 'Add a reason for this decision.', severity: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post(`/okrs/${decisionGoal._id}/decision`, {
        decision,
        comment: decisionComment.trim() || undefined,
      });
      setDecisionGoal(null);
      setDecisionComment('');
      await loadGoals();
      setMessage({ text: decision === 'approve' ? 'Goal approved.' : 'Decision sent to the goal owner.', severity: 'success' });
    } catch (decisionError) {
      setMessage({ text: apiError(decisionError, 'Could not record decision.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const submitChangeRequest = async () => {
    if (!changeGoal || !changeReason.trim() || !proposedChanges.trim()) {
      setMessage({ text: 'Explain the reason and proposed change.', severity: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post(`/okrs/${changeGoal._id}/change-requests`, {
        reason: changeReason.trim(),
        proposedChanges: { title: proposedChanges.trim() },
      });
      setChangeGoal(null);
      setChangeReason('');
      setProposedChanges('');
      await loadGoals();
      setMessage({ text: 'Change request sent.', severity: 'success' });
    } catch (changeError) {
      setMessage({ text: apiError(changeError, 'Could not send change request.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const renderGoal = (goal: Goal, approvalMode = false) => {
    const state = lifecycleState(goal);
    const canUpdate = goal.permissions?.checkIn === true;
    const canSubmit = goal.permissions?.submit === true;
    const needsAcknowledgement = goal.permissions?.acknowledge === true;
    const canRequestChange = goal.permissions?.requestChange === true;
    const canDecide = goal.permissions?.decide === true;
    const canEdit = goal.permissions?.edit === true;
    const progress = goal.scoring?.progress ?? goal.progress;

    return (
      <Card
        key={goal._id}
        id={`goal-${goal._id}`}
        variant="outlined"
        sx={{ borderRadius: 2, borderColor: selectedGoalId === goal._id ? 'primary.main' : 'divider', borderWidth: selectedGoalId === goal._id ? 2 : 1 }}
      >
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                <Chip size="small" variant="outlined" label={readableState(goal.type)} />
                <Chip size="small" color={stateColor(state)} label={readableState(state)} />
                {goal.assignment?.acknowledgementStatus === 'pending' && <Chip size="small" color="warning" variant="outlined" label="Acknowledgement required" />}
                {goal.assignment?.acknowledgementStatus === 'acknowledged' && <Chip size="small" color="success" variant="outlined" label="Acknowledged" />}
                {goal.health && goal.health !== 'not_set' && <Chip size="small" variant="outlined" label={readableState(goal.health)} />}
                {goal.pendingChangeRequests ? <Chip size="small" color="info" label={`${goal.pendingChangeRequests} change request${goal.pendingChangeRequests === 1 ? '' : 's'}`} /> : null}
              </Stack>
              <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{goalTitle(goal)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {ownerName(goal)} · {originLabel(goal)}
              </Typography>
              {alignmentTitle(goal) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AccountTree fontSize="small" /> {alignmentTitle(goal)}
                </Typography>
              )}
              {goal.lifecycle?.comment && (
                <Alert severity="info" sx={{ mt: 2, py: 0 }}>
                  {goal.lifecycle.comment}
                </Alert>
              )}
            </Box>

            <Box sx={{ width: { xs: '100%', md: 240 }, flexShrink: 0 }}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Progress</Typography>
                <Typography variant="body2" fontWeight={600}>{progress == null ? 'Not rated' : `${Math.round(progress)}%`}</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, progress || 0))} sx={{ height: 7, borderRadius: 1 }} />
              {typeof goal.score === 'number' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  Outcome score: {goal.score}
                </Typography>
              )}
            </Box>
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {needsAcknowledgement && (
              <Button size="small" variant="contained" startIcon={<Check />} disabled={saving} onClick={() => performAction(goal, 'acknowledge')}>
                Acknowledge
              </Button>
            )}
            {canSubmit && (
              <Button size="small" variant="contained" startIcon={<Send />} disabled={saving} onClick={() => performAction(goal, 'submit')}>
                Submit for approval
              </Button>
            )}
            {canUpdate && (
              <Button size="small" variant="outlined" startIcon={<TrendingUp />} onClick={() => openProgress(goal)}>
                Update progress
              </Button>
            )}
            {canEdit && (
              <Button size="small" variant="text" startIcon={<Edit />} onClick={() => openEditGoal(goal)}>
                Edit goal
              </Button>
            )}
            {!approvalMode && canRequestChange && (
              <Button size="small" variant="text" startIcon={<EditNote />} onClick={() => setChangeGoal(goal)}>
                Suggest a change
              </Button>
            )}
            {approvalMode && canDecide && (
              <>
                <Button size="small" variant="contained" color="success" onClick={() => { setDecision('approve'); setDecisionGoal(goal); }}>
                  Approve
                </Button>
                <Button size="small" variant="outlined" onClick={() => { setDecision('request_changes'); setDecisionGoal(goal); }}>
                  Request changes
                </Button>
                <Button size="small" color="error" onClick={() => { setDecision('reject'); setDecisionGoal(goal); }}>
                  Reject
                </Button>
              </>
            )}
            <Button size="small" component={Link} href={`/okrs/alignment?goal=${goal._id}`} startIcon={<History />}>
              Context
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  };

  const renderGoalList = (records: Goal[], emptyTitle: string, emptyDescription: string, approvalMode = false) => (
    records.length ? (
      <Stack spacing={2}>{records.map((goal) => renderGoal(goal, approvalMode))}</Stack>
    ) : (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={!approvalMode && view === 'my' ? (
          <Button variant="contained" onClick={() => { resetForm(); setEditingGoal(null); setCreateOpen(true); }}>Create goal</Button>
        ) : undefined}
      />
    )
  );

  const renderHierarchyNode = (node: HierarchyNode, depth = 0): React.ReactNode => (
    <Box key={node._id} sx={{ ml: depth ? 3 : 0, mt: 1.5, borderLeft: depth ? 1 : 0, borderColor: 'divider', pl: depth ? 2 : 0 }}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>{goalTitle(node)}</Typography>
            <Typography variant="body2" color="text.secondary">{ownerName(node)} · {readableState(node.type)}</Typography>
          </Box>
          <Typography variant="body2" fontWeight={600}>{Math.round(node.progress || 0)}%</Typography>
        </Stack>
      </Paper>
      {(node.children || []).map((child) => renderHierarchyNode(child, depth + 1))}
    </Box>
  );

  if (contextLoading || reportsLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Goals</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {workspace === 'personal'
              ? 'Set your direction and keep your own progress current.'
              : workspace === 'manager'
                ? 'Assign, align, approve, and monitor goals for your team.'
                : 'Set organization direction and monitor goal alignment.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton aria-label="Refresh goals" onClick={loadGoals} disabled={loading}><Refresh /></IconButton>
          <Button variant="contained" startIcon={<Add />} onClick={() => { resetForm(); setEditingGoal(null); setCreateOpen(true); }}>
            Create goal
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
        <Tabs value={periodBand} onChange={(_, value: PeriodBand) => { setSelectedGoalId(''); setPeriodBand(value); }}>
          <Tab value="upcoming" label="Upcoming" />
          <Tab value="current" label="Current" />
          <Tab value="past" label="Past" />
        </Tabs>
        <Divider />
        <Box sx={{ p: 2 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Period</InputLabel>
            <Select
              value={periodsByBand[periodBand].includes(selectedPeriod) ? selectedPeriod : periodsByBand[periodBand][0] || ''}
              label="Period"
              onChange={(event) => { setSelectedGoalId(''); setSelectedPeriod(event.target.value); }}
            >
              {periodsByBand[periodBand].map((period) => <MenuItem key={period} value={period}>{period}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs value={view} onChange={(_, value: WorkspaceView) => setView(value)} variant="scrollable" scrollButtons="auto">
          {views.map((item) => (
            <Tab key={item.value} value={item.value} label={item.count == null ? item.label : `${item.label} (${item.count})`} />
          ))}
        </Tabs>
      </Paper>

      {error && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={loadGoals}>Retry</Button>} sx={{ mt: 3 }}>
          {error}
        </Alert>
      )}
      {loading && <LinearProgress sx={{ mt: 3 }} />}

      {!loading && !error && (
        <>
          <TabPanel active={view === 'my'}>
            {renderGoalList(myGoals, 'No goals for this period', 'Create a goal or choose another period.')}
          </TabPanel>
          <TabPanel active={view === 'team'}>
            {renderGoalList(teamGoals, 'No team or department goals for this period', 'Assigned, team, and department goals will appear here.')}
          </TabPanel>
          <TabPanel active={view === 'approvals'}>
            {renderGoalList(approvalGoals, 'Nothing awaiting approval', 'New submissions and requested decisions will appear here.', true)}
          </TabPanel>
          <TabPanel active={view === 'alignment'}>
            {hierarchyLoading ? <LinearProgress /> : hierarchy ? (
              <Stack spacing={3}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography variant="h6">Organization alignment</Typography>
                    <Typography variant="body2" color="text.secondary">How goals for {selectedPeriod} connect across the organization.</Typography>
                  </Box>
                  <Button component={Link} href={`/okrs/alignment?period=${encodeURIComponent(selectedPeriod)}`} startIcon={<AccountTree />}>
                    Open full alignment
                  </Button>
                </Stack>
                {hierarchy.organization?.length ? hierarchy.organization.map((goal) => renderHierarchyNode(goal)) : (
                  <EmptyState title="No organization goals" description="Organization goals for this period have not been set yet." />
                )}
                {(hierarchy.unalignedDepartment?.length || hierarchy.unalignedTeam?.length || hierarchy.unalignedIndividual?.length) ? (
                  <Alert severity="warning">
                    {(hierarchy.unalignedDepartment?.length || 0) + (hierarchy.unalignedTeam?.length || 0) + (hierarchy.unalignedIndividual?.length || 0)} goals are not aligned to a parent goal.
                  </Alert>
                ) : null}
              </Stack>
            ) : (
              <EmptyState title="Alignment unavailable" description="Reload this view to try again." action={<Button onClick={loadHierarchy}>Reload</Button>} />
            )}
          </TabPanel>
        </>
      )}

      <Dialog open={createOpen || !!editingGoal} onClose={() => !saving && closeGoalEditor()} maxWidth="md" fullWidth>
        <DialogTitle>{editingGoal ? 'Edit goal' : 'Create goal'}</DialogTitle>
        <DialogContent dividers>
          {editLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress aria-label="Loading goal" />
            </Box>
          ) : (
          <>
          {editingGoal && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Saving creates an audited goal version. An assigned active goal will need employee acknowledgement again.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 8 }}>
              <TextField fullWidth label="Goal title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              {creatablePeriods.length ? (
                <FormControl fullWidth>
                  <InputLabel>Period</InputLabel>
                  <Select
                    value={form.periodId}
                    label="Period"
                    onChange={(event) => {
                      const period = creatablePeriods.find((item) => item._id === event.target.value);
                      setForm({ ...form, periodId: event.target.value, period: period?.name || period?.code || '', parentOKRId: '' });
                      setAlignableGoals([]);
                    }}
                  >
                    {creatablePeriods.map((period) => (
                      <MenuItem key={period._id} value={period._id}>{period.name || period.code}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField
                  fullWidth
                  label="Period"
                  value={form.period}
                  onChange={(event) => {
                    setForm({ ...form, period: event.target.value, periodId: '', parentOKRId: '' });
                    setAlignableGoals([]);
                  }}
                  helperText="For example, Q3 2026"
                />
              )}
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>Scope</InputLabel>
                <Select
                  value={form.type}
                  label="Scope"
                  disabled={!!editingGoal}
                  onChange={(event) => {
                    const type = event.target.value as GoalType;
                    setForm({
                      ...form,
                      type,
                      teamId: type === 'team' ? form.teamId : '',
                      departmentId: type === 'department' ? departmentOptions[0]?.id || '' : '',
                      parentOKRId: '',
                      assignees: type === 'individual' ? form.assignees : [],
                    });
                    loadAlignableGoals(type);
                  }}
                >
                  <MenuItem value="individual">Individual</MenuItem>
                  {canManageGoalWorkspace && <MenuItem value="team">Team</MenuItem>}
                  {canCreateDepartmentGoal && <MenuItem value="department">Department</MenuItem>}
                  {isHRAdmin && <MenuItem value="organization">Organization</MenuItem>}
                </Select>
              </FormControl>
            </Grid>
            {form.type === 'individual' && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Autocomplete
                  multiple
                  disabled={!!editingGoal}
                  options={people}
                  value={form.assignees}
                  getOptionLabel={(option) => option.name}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  onChange={(_, value) => setForm({ ...form, assignees: Array.isArray(value) ? value : value ? [value] : [] })}
                  renderInput={(params) => <TextField {...params} label={canManageGoalWorkspace ? 'Assignees' : 'Owner'} placeholder="Choose people" />}
                />
              </Grid>
            )}
            {form.type === 'team' && (
              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Team</InputLabel>
                  <Select value={form.teamId} label="Team" disabled={!!editingGoal} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
                    {(managedTeams?.length ? managedTeams : teams || []).map((team: any) => {
                      const id = String(team.id || team.teamId || team._id || '');
                      return <MenuItem key={id} value={id}>{team.name || team.teamName || 'Team'}</MenuItem>;
                    })}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {form.type === 'department' && (
              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Department</InputLabel>
                  <Select value={form.departmentId} label="Department" disabled={!!editingGoal} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>
                    {departmentOptions.map((department) => (
                      <MenuItem key={department.id} value={department.id}>{department.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {form.type !== 'organization' && (
              <Grid size={{ xs: 12 }}>
                <Autocomplete
                  options={alignableGoals}
                  value={alignableGoals.find((goal) => goal.id === form.parentOKRId) || null}
                  getOptionLabel={(option) => `${option.title}${option.period ? ` · ${option.period}` : ''}`}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  onOpen={() => !alignableGoals.length && loadAlignableGoals(form.type)}
                  onChange={(_, value) => setForm({ ...form, parentOKRId: value?.id || '' })}
                  renderInput={(params) => <TextField {...params} label="Align to parent goal (optional)" />}
                />
              </Grid>
            )}
          </Grid>

          <Divider sx={{ my: 3 }} />
          <Stack spacing={2}>
            {form.objectives.map((objective, objectiveIndex) => (
              <Paper key={objectiveIndex} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600}>Objective {objectiveIndex + 1}</Typography>
                  {form.objectives.length > 1 && (
                    <IconButton size="small" aria-label="Remove objective" onClick={() => setForm({ ...form, objectives: form.objectives.filter((_, index) => index !== objectiveIndex) })}>
                      <Close />
                    </IconButton>
                  )}
                </Stack>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <TextField fullWidth label="Objective" value={objective.title} onChange={(event) => updateObjective(objectiveIndex, 'title', event.target.value)} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField fullWidth type="number" label="Weight (%)" value={objective.weight || 0} onChange={(event) => updateObjective(objectiveIndex, 'weight', Number(event.target.value))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth multiline minRows={2} label="Description (optional)" value={objective.description || ''} onChange={(event) => updateObjective(objectiveIndex, 'description', event.target.value)} />
                  </Grid>
                </Grid>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Key results</Typography>
                <Stack spacing={1.5}>
                  {objective.keyResults.map((keyResult, keyResultIndex) => (
                    <Grid container spacing={1.5} key={keyResultIndex} alignItems="center">
                      <Grid size={{ xs: 12, md: 5 }}>
                        <TextField fullWidth size="small" label={`Key result ${keyResultIndex + 1}`} value={keyResult.title} onChange={(event) => updateKeyResult(objectiveIndex, keyResultIndex, 'title', event.target.value)} />
                      </Grid>
                      <Grid size={{ xs: 6, md: 2 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Metric</InputLabel>
                          <Select value={keyResult.metricType} label="Metric" onChange={(event) => updateKeyResult(objectiveIndex, keyResultIndex, 'metricType', event.target.value as MetricType)}>
                            <MenuItem value="percentage">Percentage</MenuItem>
                            <MenuItem value="number">Number</MenuItem>
                            <MenuItem value="currency">Currency</MenuItem>
                            <MenuItem value="boolean">Yes / no</MenuItem>
                            <MenuItem value="milestone">Milestone</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 3, md: 2 }}>
                        <TextField fullWidth size="small" type="number" label="Start" value={keyResult.startValue} onChange={(event) => updateKeyResult(objectiveIndex, keyResultIndex, 'startValue', Number(event.target.value))} />
                      </Grid>
                      <Grid size={{ xs: 3, md: 2 }}>
                        <TextField fullWidth size="small" type="number" label="Target" value={keyResult.targetValue} onChange={(event) => updateKeyResult(objectiveIndex, keyResultIndex, 'targetValue', Number(event.target.value))} />
                      </Grid>
                      <Grid size={{ xs: 12, md: 1 }}>
                        <IconButton
                          size="small"
                          aria-label="Remove key result"
                          disabled={objective.keyResults.length === 1}
                          onClick={() => updateObjective(objectiveIndex, 'keyResults', objective.keyResults.filter((_, index) => index !== keyResultIndex))}
                        >
                          <Close fontSize="small" />
                        </IconButton>
                      </Grid>
                    </Grid>
                  ))}
                </Stack>
                <Button size="small" startIcon={<Add />} sx={{ mt: 1.5 }} onClick={() => updateObjective(objectiveIndex, 'keyResults', [...objective.keyResults, emptyKeyResult()])}>
                  Add key result
                </Button>
              </Paper>
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ mt: 2 }}>
            <Button variant="outlined" startIcon={<Add />} onClick={() => setForm({ ...form, objectives: [...form.objectives, emptyObjective()] })}>
              Add objective
            </Button>
            <Typography
              variant="body2"
              color={Math.abs(objectiveWeightTotal - 100) <= 0.01 ? 'success.main' : 'error.main'}
            >
              Objective weight total: {objectiveWeightTotal}%
            </Typography>
          </Stack>
          {editingGoal && (
            <TextField
              fullWidth
              required
              multiline
              minRows={2}
              label="Reason for edit"
              value={editReason}
              onChange={(event) => setEditReason(event.target.value)}
              helperText="This is recorded in the goal history for employees, managers, and HR."
              sx={{ mt: 3 }}
            />
          )}
          </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeGoalEditor} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={editingGoal ? saveGoalEdit : createGoal}
            disabled={saving || editLoading}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : editingGoal ? <Edit /> : <Add />}
          >
            {editingGoal ? 'Save changes' : 'Create goal'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!progressGoal} onClose={() => !saving && setProgressGoal(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Update progress</DialogTitle>
        <DialogContent dividers>
          {progressLoading ? <CircularProgress /> : progressGoal ? (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>{goalTitle(progressGoal)}</Typography>
                <Typography variant="body2" color="text.secondary">Enter the latest values and a short check-in summary.</Typography>
              </Box>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Check-in summary (optional)"
                value={progressSummary}
                onChange={(event) => setProgressSummary(event.target.value)}
                placeholder="What changed, and what needs attention next?"
              />
              <FormControl fullWidth>
                <InputLabel>Health</InputLabel>
                <Select value={progressHealth} label="Health" onChange={(event) => setProgressHealth(event.target.value)}>
                  <MenuItem value="not_set">Not set</MenuItem>
                  <MenuItem value="on_track">On track</MenuItem>
                  <MenuItem value="at_risk">At risk</MenuItem>
                  <MenuItem value="off_track">Off track</MenuItem>
                  <MenuItem value="complete">Complete</MenuItem>
                </Select>
              </FormControl>
              {(progressGoal.objectives || []).map((objective, objectiveIndex) => (
                <Box key={objectiveIndex}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>{objective.title}</Typography>
                  <Stack spacing={1.5}>
                    {objective.keyResults.map((keyResult, keyResultIndex) => (
                      <TextField
                        key={keyResultIndex}
                        fullWidth
                        type="number"
                        label={keyResult.title}
                        value={progressValues[`${objectiveIndex}:${keyResultIndex}`] ?? ''}
                        onChange={(event) => setProgressValues({
                          ...progressValues,
                          [`${objectiveIndex}:${keyResultIndex}`]: event.target.value === '' ? '' : Number(event.target.value),
                        })}
                        helperText={`Leave blank to keep this key result unrated · Start ${keyResult.startValue} · Target ${keyResult.targetValue}`}
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
              {!progressGoal.objectives?.length && <Alert severity="info">No key results are available for this goal.</Alert>}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProgressGoal(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={saveProgress} disabled={saving || progressLoading || !progressGoal?.objectives?.length}>Save progress</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!decisionGoal} onClose={() => !saving && setDecisionGoal(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{readableState(decision)}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>{decisionGoal ? goalTitle(decisionGoal) : ''}</Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label={decision === 'approve' ? 'Comment (optional)' : 'Reason'}
            value={decisionComment}
            onChange={(event) => setDecisionComment(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecisionGoal(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" color={decision === 'reject' ? 'error' : 'primary'} onClick={submitDecision} disabled={saving}>Confirm</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!changeGoal} onClose={() => !saving && setChangeGoal(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Suggest a change</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>{changeGoal ? goalTitle(changeGoal) : ''}</Typography>
          <Stack spacing={2}>
            <TextField fullWidth multiline minRows={2} label="Why should this change?" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} />
            <TextField fullWidth multiline minRows={3} label="Proposed change" value={proposedChanges} onChange={(event) => setProposedChanges(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangeGoal(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={submitChangeRequest} disabled={saving}>Send request</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!message} autoHideDuration={5000} onClose={() => setMessage(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={message?.severity || 'info'} onClose={() => setMessage(null)}>{message?.text}</Alert>
      </Snackbar>
    </Box>
  );
}
