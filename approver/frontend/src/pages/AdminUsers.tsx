import React, { useState, useEffect, useRef, useMemo } from 'react';
import api, { getLogoUrl } from '../api';
import { useAuth } from '../context/AuthContext';
import { getUserDisplayName } from '../utils/userDisplay';
import { getOrganizationRoles, formatRoleLabel as formatRoleLabelFromOrg } from '../utils/access';
import type { RoleDefinition } from '../utils/access';

// --- Interfaces ---
interface Department {
    _id: string;
    name: string;
    description: string;
    manager?: { username?: string; firstName?: string; lastName?: string };
}
interface Permission {
    department: { _id: string, name: string } | string;
    roles: string[]; // Now an array of roles
    role?: string; // Keep for backward compatibility
}
interface User {
    _id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    email: string;
    isAdmin: boolean;
    permissions: Permission[];
    isVerified: boolean;
}

interface WorkflowPolicyPayload {
    _id?: string;
    name: string;
    description?: string;
    aiGate: {
        rejectBelow: number;
        enhancedOversightMax: number;
    };
    escalation: {
        forcedTierOnEscalation: number;
    };
    tiers: Array<{
        tier: number;
        label: string;
        minPriorityScore: number;
        maxPriorityScore: number;
        stages: Array<{
            stageKey: string;
            label: string;
            requiredRoleKeys: string[];
            minApprovals: number;
            onReject: 'REJECT' | 'ESCALATE_TO_NEXT';
            pendingStatusLabel?: string;
            approvedStatusLabel?: string;
            rejectedStatusLabel?: string;
        }>;
    }>;
    isActive?: boolean;
}

type WorkflowStageKey = 'CenterOfExcellence' | 'Governance' | 'Executive';

const WORKFLOW_STAGE_ORDER: WorkflowStageKey[] = ['CenterOfExcellence', 'Governance', 'Executive'];
const STAGE_CONFIG: Record<WorkflowStageKey, { title: string; hint: string }> = {
    CenterOfExcellence: {
        title: 'Center of Excellence Review',
        hint: 'Initial governance quality and architecture review.'
    },
    Governance: {
        title: 'Governance Committee Review',
        hint: 'Risk and compliance review before executive escalation.'
    },
    Executive: {
        title: 'Executive Approval',
        hint: 'Final leadership decision for high-priority projects.'
    }
};

const CAPABILITY_PRESETS: Array<{ key: string; label: string; description: string }> = [
    { key: 'projects.submit', label: 'Submit Projects', description: 'Can submit initiatives for AI analysis.' },
    { key: 'projects.review.coe', label: 'Review CoE Stage', description: 'Can review Center of Excellence stage.' },
    { key: 'projects.review.governance', label: 'Review Governance Stage', description: 'Can review Governance stage.' },
    { key: 'projects.review.executive', label: 'Review Executive Stage', description: 'Can review Executive stage.' },
    { key: 'dashboard.review', label: 'Review Dashboard', description: 'Can access pending review dashboards.' },
    { key: 'scoring.manage', label: 'Manage Scoring Policy', description: 'Can manage priority score weights and department overrides.' },
    { key: 'rules.manage', label: 'Manage Rules', description: 'Can create/update organization-level rules.' },
    { key: 'rules.manage.system', label: 'Manage System Rules', description: 'Can update organization system rules.' },
    { key: 'projects.override', label: 'Override Decisions', description: 'Can override project decisions.' }
];

const ROLE_COLOR_PALETTE = ['var(--brand-primary)', '#2196f3', '#ff9800', 'var(--sterling-red)', '#4caf50', '#9c27b0'];

const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const sanitizeCapabilities = (caps: string[]) => Array.from(new Set(caps.map(cap => cap.trim()).filter(Boolean)));

const findFirstRoleWithCapability = (roleList: RoleDefinition[], capability: string): string | null => {
    const match = roleList.find(role => role.isActive !== false && (role.capabilities || []).includes(capability));
    return match?.key || null;
};

const getFallbackRoleKey = (roleList: RoleDefinition[]): string => {
    const firstActive = roleList.find(role => role.isActive !== false);
    return firstActive?.key || 'Requester';
};

const buildDefaultStage = (tier: number, stageKey: WorkflowStageKey, roleList: RoleDefinition[]) => {
    const fallbackRole = getFallbackRoleKey(roleList);
    const preferredCapability =
        stageKey === 'CenterOfExcellence'
            ? 'projects.review.coe'
            : stageKey === 'Governance'
                ? 'projects.review.governance'
                : 'projects.review.executive';

    const preferredRoleKey = findFirstRoleWithCapability(roleList, preferredCapability);
    const defaultRoleKey = preferredRoleKey || fallbackRole;

    const defaultOnReject = stageKey === 'Governance' && tier === 3 ? 'ESCALATE_TO_NEXT' : 'REJECT';

    const label = STAGE_CONFIG[stageKey].title;
    const pendingStageLabel = stageKey === 'CenterOfExcellence'
        ? 'Pending Center of Excellence'
        : stageKey === 'Governance'
            ? 'Pending Governance'
            : 'Pending Executive';

    return {
        stageKey,
        label,
        requiredRoleKeys: [defaultRoleKey],
        minApprovals: 1,
        onReject: defaultOnReject as 'REJECT' | 'ESCALATE_TO_NEXT',
        pendingStatusLabel: pendingStageLabel,
        approvedStatusLabel: `${label} Approved`,
        rejectedStatusLabel: `${label} Rejected`
    };
};

const buildDefaultWorkflowPolicy = (roleList: RoleDefinition[]): WorkflowPolicyPayload => ({
    name: 'System Default Workflow Policy',
    description: 'Default tier routing and reviewer requirements for initiative approvals.',
    aiGate: {
        rejectBelow: 1.5,
        enhancedOversightMax: 2.0
    },
    escalation: {
        forcedTierOnEscalation: 3
    },
    tiers: [
        {
            tier: 1,
            label: 'Tier 1',
            minPriorityScore: 1.0,
            maxPriorityScore: 2.5,
            stages: [buildDefaultStage(1, 'CenterOfExcellence', roleList)]
        },
        {
            tier: 2,
            label: 'Tier 2',
            minPriorityScore: 2.6,
            maxPriorityScore: 3.5,
            stages: [
                buildDefaultStage(2, 'CenterOfExcellence', roleList),
                buildDefaultStage(2, 'Governance', roleList)
            ]
        },
        {
            tier: 3,
            label: 'Tier 3',
            minPriorityScore: 3.6,
            maxPriorityScore: 5.0,
            stages: [
                buildDefaultStage(3, 'CenterOfExcellence', roleList),
                buildDefaultStage(3, 'Governance', roleList),
                buildDefaultStage(3, 'Executive', roleList)
            ]
        }
    ],
    isActive: true
});

const normalizeWorkflowPolicy = (rawPolicy: any, roleList: RoleDefinition[]): WorkflowPolicyPayload => {
    const base = buildDefaultWorkflowPolicy(roleList);
    if (!rawPolicy || typeof rawPolicy !== 'object') return base;

    const tierMap = new Map<number, any>(
        Array.isArray(rawPolicy.tiers)
            ? rawPolicy.tiers
                .map((tier: any) => [Number(tier?.tier), tier] as const)
                .filter(([tier]: readonly [number, any]) => [1, 2, 3].includes(tier))
            : []
    );

    const tiers = base.tiers.map((defaultTier) => {
        const incomingTier = tierMap.get(defaultTier.tier);
        const incomingStages = Array.isArray(incomingTier?.stages) ? incomingTier.stages : [];
        const incomingStageMap = new Map<string, any>(
            incomingStages
                .map((stage: any) => [String(stage?.stageKey || ''), stage] as const)
                .filter(([stageKey]: readonly [string, any]) => WORKFLOW_STAGE_ORDER.includes(stageKey as WorkflowStageKey))
        );

        const stages = WORKFLOW_STAGE_ORDER
            .filter((stageKey) => incomingStageMap.has(stageKey) || defaultTier.stages.some((s) => s.stageKey === stageKey))
            .map((stageKey) => {
                const fallback = defaultTier.stages.find((stage) => stage.stageKey === stageKey)
                    || buildDefaultStage(defaultTier.tier, stageKey, roleList);
                const incoming = incomingStageMap.get(stageKey) || {};
                const sourceRoleKeys = Array.isArray(incoming.requiredRoleKeys)
                    ? incoming.requiredRoleKeys
                    : fallback.requiredRoleKeys;
                const requiredRoleKeys: string[] = Array.from(new Set(
                    sourceRoleKeys
                        .map((roleKey: any) => String(roleKey || '').trim())
                        .filter((roleKey: string) => Boolean(roleKey))
                ));

                return {
                    stageKey,
                    label: String(incoming.label || fallback.label),
                    requiredRoleKeys: requiredRoleKeys.length > 0 ? requiredRoleKeys : fallback.requiredRoleKeys,
                    minApprovals: Math.max(1, Number(incoming.minApprovals || fallback.minApprovals || 1)),
                    onReject: incoming.onReject === 'ESCALATE_TO_NEXT' ? 'ESCALATE_TO_NEXT' : (fallback.onReject || 'REJECT'),
                    pendingStatusLabel: String(incoming.pendingStatusLabel || fallback.pendingStatusLabel || ''),
                    approvedStatusLabel: String(incoming.approvedStatusLabel || fallback.approvedStatusLabel || ''),
                    rejectedStatusLabel: String(incoming.rejectedStatusLabel || fallback.rejectedStatusLabel || '')
                };
            });

        return {
            tier: defaultTier.tier,
            label: String(incomingTier?.label || defaultTier.label),
            minPriorityScore: Number(incomingTier?.minPriorityScore ?? defaultTier.minPriorityScore),
            maxPriorityScore: Number(incomingTier?.maxPriorityScore ?? defaultTier.maxPriorityScore),
            stages
        };
    });

    return {
        _id: rawPolicy._id,
        name: String(rawPolicy.name || base.name),
        description: String(rawPolicy.description || base.description || ''),
        aiGate: {
            rejectBelow: Number(rawPolicy?.aiGate?.rejectBelow ?? base.aiGate.rejectBelow),
            enhancedOversightMax: Number(rawPolicy?.aiGate?.enhancedOversightMax ?? base.aiGate.enhancedOversightMax)
        },
        escalation: {
            forcedTierOnEscalation: [1, 2, 3].includes(Number(rawPolicy?.escalation?.forcedTierOnEscalation))
                ? Number(rawPolicy.escalation.forcedTierOnEscalation)
                : base.escalation.forcedTierOnEscalation
        },
        tiers,
        isActive: rawPolicy.isActive !== false
    };
};

const AdminUsers: React.FC = () => {
    const { activeOrganization, refreshOrganizations, switchOrganization } = useAuth();
    const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'organization'>('users');
    const [organizationTab, setOrganizationTab] = useState<'profile' | 'roles' | 'workflow'>('profile');

    // Users State
    const [users, setUsers] = useState<User[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]); // Shared resource
    const [roles, setRoles] = useState<RoleDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editIsAdmin, setEditIsAdmin] = useState(false);
    // Changed to store array of roles per department
    const [editPermissions, setEditPermissions] = useState<Record<string, string[]>>({});

    // Departments State
    const [deptForm, setDeptForm] = useState({ name: '', description: '' });
    const [deptLoading, setDeptLoading] = useState(false);
    const [deptPage, setDeptPage] = useState(0);

    // Organization State
    const [orgName, setOrgName] = useState('');
    const [orgLoading, setOrgLoading] = useState(false);
    const [logoLoading, setLogoLoading] = useState(false);
    const [logoBackground, setLogoBackground] = useState<string>('transparent');
    const [logoMode, setLogoMode] = useState<'dark' | 'light' | 'system' | 'all'>('all');
    const [logoSettingsLoading, setLogoSettingsLoading] = useState(false);
    const [roleForm, setRoleForm] = useState({
        name: '',
        key: '',
        description: '',
        capabilities: [] as string[],
        customCapabilities: ''
    });
    const [roleSaving, setRoleSaving] = useState(false);
    const [workflowPolicy, setWorkflowPolicy] = useState<WorkflowPolicyPayload | null>(null);
    const [workflowSaving, setWorkflowSaving] = useState(false);
    const [missingSetup, setMissingSetup] = useState({ roles: false, workflow: false });
    const [setupWizardOpen, setSetupWizardOpen] = useState(false);
    const [setupActionLoading, setSetupActionLoading] = useState(false);
    const [wizardDismissed, setWizardDismissed] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);
    const logoDarkInputRef = useRef<HTMLInputElement>(null);
    const logoLightInputRef = useRef<HTMLInputElement>(null);

    const roleOptions = useMemo(() => {
        if (roles.length > 0) {
            return roles.filter(role => role.isActive !== false);
        }
        if (activeOrganization?.roles && activeOrganization.roles.length > 0) {
            return activeOrganization.roles.filter(role => role.isActive !== false);
        }
        return getOrganizationRoles(null);
    }, [activeOrganization?.roles, roles]);

    const roleNameByKey = useMemo(() => {
        const map = new Map<string, string>();
        roleOptions.forEach((role) => map.set(role.key, role.name));
        return map;
    }, [roleOptions]);

    const getRoleColor = (roleKey: string) => {
        const index = roleOptions.findIndex(role => role.key === roleKey);
        if (index < 0) return ROLE_COLOR_PALETTE[0];
        return ROLE_COLOR_PALETTE[index % ROLE_COLOR_PALETTE.length];
    };

    const formatRoleLabel = (roleKey: string) => roleNameByKey.get(roleKey) || formatRoleLabelFromOrg(activeOrganization, roleKey);

    useEffect(() => {
        if (activeOrganization?._id) {
            fetchData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeOrganization?._id]);

    useEffect(() => {
        if ((missingSetup.roles || missingSetup.workflow) && !wizardDismissed) {
            setActiveTab('organization');
            setOrganizationTab(missingSetup.roles ? 'roles' : 'workflow');
            setSetupWizardOpen(true);
        }
    }, [missingSetup.roles, missingSetup.workflow, wizardDismissed]);

    useEffect(() => {
        if (activeOrganization?.name) setOrgName(activeOrganization.name);
        if (activeOrganization?.logoBackground !== undefined) setLogoBackground(activeOrganization.logoBackground || 'transparent');
        if (activeOrganization?.logoMode) setLogoMode(activeOrganization.logoMode);
    }, [activeOrganization?.name, activeOrganization?.logoBackground, activeOrganization?.logoMode]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersRes, deptsRes, rolesRes, workflowRes] = await Promise.all([
                api.get('/users'),
                api.get('/departments'),
                api.get('/roles'),
                api.get('/workflow-policy')
            ]);
            const roleList: RoleDefinition[] = Array.isArray(rolesRes.data) ? rolesRes.data : [];
            const rawPolicy = workflowRes.data?.policy || workflowRes.data || null;
            const normalizedPolicy = normalizeWorkflowPolicy(
                rawPolicy,
                roleList.length > 0 ? roleList : getOrganizationRoles(activeOrganization)
            );
            const hasActiveRoles = roleList.some(role => role.isActive !== false);
            const hasWorkflowPolicy = !!rawPolicy && Array.isArray(rawPolicy.tiers) && rawPolicy.tiers.length > 0;

            setUsers(usersRes.data);
            setDepartments(deptsRes.data);
            setRoles(roleList);
            setWorkflowPolicy(normalizedPolicy);
            setMissingSetup({
                roles: !hasActiveRoles,
                workflow: !hasWorkflowPolicy
            });

            if (hasActiveRoles && hasWorkflowPolicy) {
                setSetupWizardOpen(false);
                setWizardDismissed(false);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // --- User Logic ---
    const handleEditClick = (user: User) => {
        setEditingUser(user);
        setEditIsAdmin(user.isAdmin || false);
        const permMap: Record<string, string[]> = {};
        user.permissions.forEach(p => {
            const deptId = typeof p.department === 'string' ? p.department : p.department._id;
            // Handle both old format (role) and new format (roles array)
            permMap[deptId] = p.roles || (p.role ? [p.role] : []);
        });
        setEditPermissions(permMap);
    };

    const handleRoleToggle = (deptId: string, role: string) => {
        setEditPermissions(prev => {
            const currentRoles = prev[deptId] || [];
            const hasRole = currentRoles.includes(role);

            let newRoles: string[];
            if (hasRole) {
                newRoles = currentRoles.filter(r => r !== role);
            } else {
                newRoles = [...currentRoles, role];
            }

            const next = { ...prev };
            if (newRoles.length === 0) {
                delete next[deptId];
            } else {
                next[deptId] = newRoles;
            }
            return next;
        });
    };

    const savePermissions = async () => {
        if (!editingUser) return;
        const permissions = Object.entries(editPermissions).map(([deptId, roles]) => ({
            department: deptId,
            roles: roles
        }));
        try {
            await api.patch('/users/role', {
                userId: editingUser._id,
                isAdmin: editIsAdmin,
                permissions: permissions
            });
            setEditingUser(null);
            fetchData();
        } catch (error) {
            alert('Failed to update permissions');
        }
    };

    // --- Department Logic ---
    const handleCreateDept = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!deptForm.name) return;
        setDeptLoading(true);
        try {
            await api.post('/departments', deptForm);
            setDeptForm({ name: '', description: '' });
            fetchData(); // Reload both
        } catch (error) {
            alert('Failed to create department');
        } finally {
            setDeptLoading(false);
        }
    };

    const handleDeleteDept = async (id: string) => {
        if (!window.confirm('Delete this department? Users assigned to it might lose access.')) return;
        try {
            await api.delete(`/departments/${id}`);
            fetchData();
        } catch (error) {
            alert('Failed to delete department');
        }
    };

    // --- Organization Logic ---
    const handleSaveOrgName = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!orgName.trim()) return;
        setOrgLoading(true);
        try {
            await api.patch('/organizations/current', { name: orgName.trim() });
            const orgs = await refreshOrganizations();
            const updated = orgs.find(o => o._id === activeOrganization?._id);
            if (updated) switchOrganization(updated);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to update organization name');
        } finally {
            setOrgLoading(false);
        }
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, variant?: 'dark' | 'light') => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file (PNG, JPG, GIF, or WebP)');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            alert('Image must be under 2MB');
            return;
        }
        setLogoLoading(true);
        try {
            const formData = new FormData();
            formData.append('logo', file);
            const url = variant ? `/organizations/current/logo?variant=${variant}` : '/organizations/current/logo';
            await api.post(url, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const orgs = await refreshOrganizations();
            const updated = orgs.find(o => o._id === activeOrganization?._id);
            if (updated) switchOrganization(updated);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to upload logo');
        } finally {
            setLogoLoading(false);
            e.target.value = '';
        }
    };

    const handleRemoveLogo = async (variant?: 'dark' | 'light') => {
        const hasLogo = variant
            ? (variant === 'dark' ? activeOrganization?.logoDark : activeOrganization?.logoLight)
            : activeOrganization?.logo;
        if (!hasLogo) return;
        const label = variant ? (variant === 'dark' ? 'Dark theme logo' : 'Light theme logo') : 'organization logo';
        if (!window.confirm(`Remove the ${label}?`)) return;
        setLogoLoading(true);
        try {
            const url = variant ? `/organizations/current/logo?variant=${variant}` : '/organizations/current/logo';
            await api.delete(url);
            const orgs = await refreshOrganizations();
            const updated = orgs.find(o => o._id === activeOrganization?._id);
            if (updated) switchOrganization(updated);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to remove logo');
        } finally {
            setLogoLoading(false);
        }
    };

    const handleSaveLogoSettings = async () => {
        setLogoSettingsLoading(true);
        try {
            await api.patch('/organizations/current', { logoBackground, logoMode });
            const orgs = await refreshOrganizations();
            const updated = orgs.find(o => o._id === activeOrganization?._id);
            if (updated) switchOrganization(updated);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to update logo settings');
        } finally {
            setLogoSettingsLoading(false);
        }
    };

    const refreshActiveOrganizationContext = async () => {
        const orgs = await refreshOrganizations();
        const updated = orgs.find(o => o._id === activeOrganization?._id);
        if (updated) switchOrganization(updated);
    };

    const handleCreateRole = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!roleForm.name.trim()) return;
        setRoleSaving(true);
        try {
            const manualCapabilities = roleForm.customCapabilities
                .split(',')
                .map(capability => capability.trim())
                .filter(Boolean);
            const capabilities = sanitizeCapabilities([
                ...roleForm.capabilities,
                ...manualCapabilities
            ]);

            await api.post('/roles', {
                name: roleForm.name.trim(),
                key: roleForm.key.trim() || undefined,
                description: roleForm.description.trim() || undefined,
                capabilities
            });
            setRoleForm({ name: '', key: '', description: '', capabilities: [], customCapabilities: '' });
            await fetchData();
            await refreshActiveOrganizationContext();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to create role');
        } finally {
            setRoleSaving(false);
        }
    };

    const handleDeleteRole = async (roleId: string, roleName: string) => {
        if (!window.confirm(`Delete role "${roleName}"? It will be removed from users and workflow stages.`)) return;
        try {
            await api.delete(`/roles/${roleId}`);
            await fetchData();
            await refreshActiveOrganizationContext();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to delete role');
        }
    };

    const handleToggleRoleCapability = (capabilityKey: string) => {
        setRoleForm(prev => {
            const exists = prev.capabilities.includes(capabilityKey);
            return {
                ...prev,
                capabilities: exists
                    ? prev.capabilities.filter(cap => cap !== capabilityKey)
                    : [...prev.capabilities, capabilityKey]
            };
        });
    };

    const handleApplyDefaultWorkflowTemplate = () => {
        setWorkflowPolicy(buildDefaultWorkflowPolicy(roleOptions));
    };

    const updateWorkflowPolicyDraft = (updater: (draft: WorkflowPolicyPayload) => void) => {
        setWorkflowPolicy(prev => {
            const base = prev ? cloneValue(prev) : buildDefaultWorkflowPolicy(roleOptions);
            updater(base);
            return base;
        });
    };

    const updateTierField = (
        tierNumber: number,
        field: 'label' | 'minPriorityScore' | 'maxPriorityScore',
        value: string | number
    ) => {
        updateWorkflowPolicyDraft((draft) => {
            const tier = draft.tiers.find(t => t.tier === tierNumber);
            if (!tier) return;
            if (field === 'label') {
                tier.label = String(value);
                return;
            }
            tier[field] = Number(value);
        });
    };

    const isStageEnabled = (tierNumber: number, stageKey: WorkflowStageKey) => {
        const tier = workflowPolicy?.tiers.find(t => t.tier === tierNumber);
        return !!tier?.stages.some(stage => stage.stageKey === stageKey);
    };

    const toggleTierStage = (tierNumber: number, stageKey: WorkflowStageKey) => {
        updateWorkflowPolicyDraft((draft) => {
            const tier = draft.tiers.find(t => t.tier === tierNumber);
            if (!tier) return;

            const existingIndex = tier.stages.findIndex(stage => stage.stageKey === stageKey);
            if (existingIndex >= 0) {
                tier.stages.splice(existingIndex, 1);
            } else {
                tier.stages.push(buildDefaultStage(tierNumber, stageKey, roleOptions));
            }

            tier.stages.sort((a, b) => {
                const aIndex = WORKFLOW_STAGE_ORDER.indexOf(a.stageKey as WorkflowStageKey);
                const bIndex = WORKFLOW_STAGE_ORDER.indexOf(b.stageKey as WorkflowStageKey);
                return aIndex - bIndex;
            });
        });
    };

    const updateTierStageField = (
        tierNumber: number,
        stageKey: WorkflowStageKey,
        field: 'label' | 'minApprovals' | 'onReject',
        value: string | number
    ) => {
        updateWorkflowPolicyDraft((draft) => {
            const tier = draft.tiers.find(t => t.tier === tierNumber);
            const stage = tier?.stages.find(s => s.stageKey === stageKey);
            if (!stage) return;

            if (field === 'label') {
                stage.label = String(value);
                return;
            }
            if (field === 'minApprovals') {
                stage.minApprovals = Math.max(1, Number(value || 1));
                return;
            }
            stage.onReject = value === 'ESCALATE_TO_NEXT' ? 'ESCALATE_TO_NEXT' : 'REJECT';
        });
    };

    const toggleTierStageRole = (tierNumber: number, stageKey: WorkflowStageKey, roleKey: string) => {
        updateWorkflowPolicyDraft((draft) => {
            const tier = draft.tiers.find(t => t.tier === tierNumber);
            const stage = tier?.stages.find(s => s.stageKey === stageKey);
            if (!stage) return;

            const current = new Set(stage.requiredRoleKeys || []);
            if (current.has(roleKey)) {
                if (current.size === 1) return; // Must keep at least one reviewer role
                current.delete(roleKey);
            } else {
                current.add(roleKey);
            }

            stage.requiredRoleKeys = Array.from(current);
        });
    };

    const handleSetupNow = async () => {
        setSetupActionLoading(true);
        try {
            await api.get('/roles');
            if (missingSetup.workflow) {
                await api.post('/workflow-policy/reset');
            }
            await fetchData();
            await refreshActiveOrganizationContext();
            setSetupWizardOpen(false);
            setWizardDismissed(false);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to initialize governance setup');
        } finally {
            setSetupActionLoading(false);
        }
    };

    const handleResetWorkflowPolicy = async () => {
        if (!window.confirm('Reset workflow policy to the system default template?')) return;
        setWorkflowSaving(true);
        try {
            await api.post('/workflow-policy/reset');
            await fetchData();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to reset workflow policy');
        } finally {
            setWorkflowSaving(false);
        }
    };

    const handleSaveWorkflowPolicy = async () => {
        if (!workflowPolicy) {
            alert('Workflow policy is not loaded yet.');
            return;
        }

        const emptyTier = workflowPolicy.tiers.find(tier => !Array.isArray(tier.stages) || tier.stages.length === 0);
        if (emptyTier) {
            alert(`Tier ${emptyTier.tier} must include at least one review stage.`);
            return;
        }

        const invalidStage = workflowPolicy.tiers
            .flatMap(tier => tier.stages.map(stage => ({ tier: tier.tier, stage })))
            .find(({ stage }) => !Array.isArray(stage.requiredRoleKeys) || stage.requiredRoleKeys.length === 0);
        if (invalidStage) {
            alert(`Each stage needs at least one reviewer role. Tier ${invalidStage.tier}, stage ${invalidStage.stage.label}.`);
            return;
        }

        setWorkflowSaving(true);
        try {
            await api.put('/workflow-policy', workflowPolicy);
            const workflowRes = await api.get('/workflow-policy');
            const refreshedPolicy = normalizeWorkflowPolicy(workflowRes.data?.policy || workflowRes.data || {}, roleOptions);
            setWorkflowPolicy(refreshedPolicy);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to save workflow policy');
        } finally {
            setWorkflowSaving(false);
        }
    };

    // Only org admins can access this page (matches backend verifyRole(['Admin'])).
    if (!activeOrganization?.isAdmin) {
        return <div className="glass-panel">Access Denied</div>;
    }

    if (loading) return <div className="glass-panel">Loading Organization Data...</div>;

    return (
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ margin: 0 }}>âš™ï¸ Organization Settings</h2>

                {/* Tabs */}
                <div style={{ display: 'flex', background: 'var(--glass-border)', borderRadius: '8px', padding: '4px' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            background: activeTab === 'users' ? 'var(--brand-primary)' : 'transparent',
                            color: activeTab === 'users' ? 'white' : 'var(--text-primary)',
                            border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        Users
                    </button>
                    <button
                        onClick={() => setActiveTab('departments')}
                        style={{
                            background: activeTab === 'departments' ? 'var(--brand-primary)' : 'transparent',
                            color: activeTab === 'departments' ? 'white' : 'var(--text-primary)',
                            border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        Departments
                    </button>
                    <button
                        onClick={() => setActiveTab('organization')}
                        style={{
                            background: activeTab === 'organization' ? 'var(--brand-primary)' : 'transparent',
                            color: activeTab === 'organization' ? 'white' : 'var(--text-primary)',
                            border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        Organization
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'organization' ? (
                <div style={{ display: 'grid', gap: '1rem' }}>
                    {(missingSetup.roles || missingSetup.workflow) && (
                        <div className="glass-panel" style={{ border: '1px solid rgba(255, 152, 0, 0.4)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ fontWeight: 700, color: '#ffb74d', marginBottom: '0.35rem' }}>Setup Required</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                        {missingSetup.roles && missingSetup.workflow
                                            ? 'This organization is missing role catalog and workflow policy setup.'
                                            : missingSetup.roles
                                                ? 'This organization is missing role catalog setup.'
                                                : 'This organization is missing workflow policy setup.'}
                                    </div>
                                </div>
                                <button type="button" className="btn-primary" onClick={() => setSetupWizardOpen(true)}>
                                    Open Setup Wizard
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="glass-panel">
                        <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', color: 'var(--text-primary)' }}>Organization Settings</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => setOrganizationTab('profile')}
                                style={{
                                    background: organizationTab === 'profile' ? 'var(--brand-primary)' : 'var(--glass-bg)',
                                    color: organizationTab === 'profile' ? 'white' : 'var(--text-primary)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '8px',
                                    padding: '0.45rem 0.9rem',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                }}
                            >
                                Profile
                            </button>
                            <button
                                type="button"
                                onClick={() => setOrganizationTab('roles')}
                                style={{
                                    background: organizationTab === 'roles' ? 'var(--brand-primary)' : 'var(--glass-bg)',
                                    color: organizationTab === 'roles' ? 'white' : 'var(--text-primary)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '8px',
                                    padding: '0.45rem 0.9rem',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                }}
                            >
                                Roles
                            </button>
                            <button
                                type="button"
                                onClick={() => setOrganizationTab('workflow')}
                                style={{
                                    background: organizationTab === 'workflow' ? 'var(--brand-primary)' : 'var(--glass-bg)',
                                    color: organizationTab === 'workflow' ? 'white' : 'var(--text-primary)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '8px',
                                    padding: '0.45rem 0.9rem',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                }}
                            >
                                Workflow
                            </button>
                        </div>

                        {organizationTab === 'profile' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: '560px' }}>
                        {/* Organization Name */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>Organization Name</label>
                            <form onSubmit={handleSaveOrgName} style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
                                <input
                                    value={orgName}
                                    onChange={e => setOrgName(e.target.value)}
                                    placeholder="e.g. Acme Corp"
                                    required
                                    style={{ flex: '1 1 200px', minWidth: 0, padding: '0.75rem 1rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', borderRadius: '8px', fontSize: '1rem' }}
                                />
                                <button type="submit" className="btn-primary" disabled={orgLoading} style={{ padding: '0.75rem 1.5rem', flexShrink: 0 }}>
                                    {orgLoading ? 'Saving...' : 'Save Name'}
                                </button>
                            </form>
                        </div>

                        {/* Logo display options â€” Show logo in first so user picks mode before uploading */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>Logo display options</label>
                            <div style={{
                                padding: '1.25rem',
                                background: 'var(--surface-soft)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: '12px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1.25rem'
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Show logo in</div>
                                    <select
                                        value={logoMode}
                                        onChange={e => setLogoMode(e.target.value as 'dark' | 'light' | 'system' | 'all')}
                                        style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', width: '100%', maxWidth: 280 }}
                                    >
                                        <option value="all">All themes (always)</option>
                                        <option value="dark">Dark mode only</option>
                                        <option value="light">Light mode only</option>
                                        <option value="system">Follow system preference</option>
                                    </select>
                                    {logoMode !== 'all' && (
                                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Use dark and light logo versions below for best visibility.
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Background</div>
                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <select
                                            value={logoBackground === 'transparent' ? 'transparent' : 'custom'}
                                            onChange={e => {
                                                setLogoBackground(e.target.value === 'transparent' ? 'transparent' : '#1a1a2e');
                                            }}
                                            style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                        >
                                            <option value="transparent">Transparent</option>
                                            <option value="custom">Custom color</option>
                                        </select>
                                        {logoBackground !== 'transparent' && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="color"
                                                    value={logoBackground.startsWith('#') ? logoBackground : '#1a1a2e'}
                                                    onChange={e => setLogoBackground(e.target.value)}
                                                    style={{ width: 36, height: 36, padding: 2, border: '1px solid var(--glass-border)', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                                                />
                                                <input
                                                    type="text"
                                                    value={logoBackground}
                                                    onChange={e => setLogoBackground(e.target.value)}
                                                    placeholder="#1a1a2e"
                                                    style={{ width: 100, padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSaveLogoSettings}
                                    disabled={logoSettingsLoading}
                                    className="btn-primary"
                                    style={{ alignSelf: 'flex-start', padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                                >
                                    {logoSettingsLoading ? 'Saving...' : 'Save display options'}
                                </button>
                            </div>
                        </div>

                        {/* Organization Logo â€” single when "All themes", dark/light when theme-specific */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>
                                {logoMode === 'all' ? 'Organization Logo' : 'Theme-specific logos'}
                            </label>
                            {logoMode === 'all' ? (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '1.5rem',
                                    padding: '1.5rem', background: 'var(--surface-soft)', border: '1px solid var(--glass-border)', borderRadius: '12px'
                                }}>
                                    {activeOrganization?.logo ? (
                                        <div style={{ flexShrink: 0 }}>
                                            <img src={getLogoUrl(activeOrganization.logo) || ''} alt={activeOrganization.name}
                                                style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', padding: '8px', boxSizing: 'border-box' }} />
                                        </div>
                                    ) : (
                                        <div style={{ width: 96, height: 96, borderRadius: '10px', background: 'var(--surface-soft)', border: '2px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '2rem', flexShrink: 0 }}>ðŸ–¼ï¸</div>
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={(e) => handleLogoUpload(e)} style={{ display: 'none' }} />
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                            <button type="button" onClick={() => logoInputRef.current?.click()} className="btn-primary" disabled={logoLoading} style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem' }}>
                                                {logoLoading ? 'Uploading...' : (activeOrganization?.logo ? 'Change Logo' : 'Upload Logo')}
                                            </button>
                                            {activeOrganization?.logo && (
                                                <button type="button" onClick={() => handleRemoveLogo()} disabled={logoLoading} style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem', background: 'rgba(244, 67, 54, 0.15)', border: '1px solid rgba(244, 67, 54, 0.4)', color: '#f44336', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}>Remove Logo</button>
                                            )}
                                        </div>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>PNG, JPG, GIF or WebP. Max 2MB.</p>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    <div style={{ padding: '1.25rem', background: 'var(--surface-soft)', border: '1px solid var(--glass-border)', borderRadius: '12px'
                                    }}>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Dark theme logo</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            {activeOrganization?.logoDark ? (
                                                <img src={getLogoUrl(activeOrganization.logoDark) || ''} alt="Dark" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: '8px', background: '#1a1a2e', padding: '6px' }} />
                                            ) : (
                                                <div style={{ width: 64, height: 64, borderRadius: '8px', background: '#1a1a2e', border: '2px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '1.5rem' }}>ðŸŒ™</div>
                                            )}
                                            <div>
                                                <input ref={logoDarkInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={(e) => handleLogoUpload(e, 'dark')} style={{ display: 'none' }} />
                                                <button type="button" onClick={() => logoDarkInputRef.current?.click()} className="btn-primary" disabled={logoLoading} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', marginRight: '0.5rem' }}>
                                                    {activeOrganization?.logoDark ? 'Change' : 'Upload'}
                                                </button>
                                                {activeOrganization?.logoDark && (
                                                    <button type="button" onClick={() => handleRemoveLogo('dark')} disabled={logoLoading} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: 'rgba(244, 67, 54, 0.15)', border: '1px solid rgba(244, 67, 54, 0.4)', color: '#f44336', borderRadius: '8px', cursor: 'pointer' }}>Remove</button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '1.25rem', background: 'var(--surface-soft)', border: '1px solid var(--glass-border)', borderRadius: '12px'
                                    }}>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Light theme logo</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            {activeOrganization?.logoLight ? (
                                                <img src={getLogoUrl(activeOrganization.logoLight) || ''} alt="Light" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: '8px', background: '#f5f5f5', padding: '6px' }} />
                                            ) : (
                                                <div style={{ width: 64, height: 64, borderRadius: '8px', background: '#f5f5f5', border: '2px dashed var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '1.5rem' }}>â˜€ï¸</div>
                                            )}
                                            <div>
                                                <input ref={logoLightInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={(e) => handleLogoUpload(e, 'light')} style={{ display: 'none' }} />
                                                <button type="button" onClick={() => logoLightInputRef.current?.click()} className="btn-primary" disabled={logoLoading} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', marginRight: '0.5rem' }}>
                                                    {activeOrganization?.logoLight ? 'Change' : 'Upload'}
                                                </button>
                                                {activeOrganization?.logoLight && (
                                                    <button type="button" onClick={() => handleRemoveLogo('light')} disabled={logoLoading} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: 'rgba(244, 67, 54, 0.15)', border: '1px solid rgba(244, 67, 54, 0.4)', color: '#f44336', borderRadius: '8px', cursor: 'pointer' }}>Remove</button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                        Upload dark and light versions for best visibility in each theme.
                                    </p>
                                </div>
                            )}
                        </div>
                            </div>
                        )}

                        {organizationTab === 'roles' && (
                            <div style={{ display: 'grid', gap: '1rem', maxWidth: '860px' }}>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Roles define who can review projects, approve tiers, manage rules, and override decisions.
                                </div>
                                <div style={{ padding: '1rem', background: 'var(--surface-soft)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
                                    <form onSubmit={handleCreateRole} style={{ display: 'grid', gap: '0.75rem' }}>
                                        <input
                                            value={roleForm.name}
                                            onChange={(e) => setRoleForm(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder="Role name (e.g. Risk Reviewer)"
                                            required
                                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                        <input
                                            value={roleForm.key}
                                            onChange={(e) => setRoleForm(prev => ({ ...prev, key: e.target.value }))}
                                            placeholder="Role key (optional, auto-generated)"
                                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                        <input
                                            value={roleForm.description}
                                            onChange={(e) => setRoleForm(prev => ({ ...prev, description: e.target.value }))}
                                            placeholder="Description (optional)"
                                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />

                                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>Permissions</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                                                {CAPABILITY_PRESETS.map((preset) => {
                                                    const selected = roleForm.capabilities.includes(preset.key);
                                                    return (
                                                        <label key={preset.key} style={{
                                                            display: 'flex',
                                                            alignItems: 'flex-start',
                                                            gap: '0.5rem',
                                                            border: '1px solid var(--glass-border)',
                                                            borderRadius: '8px',
                                                            padding: '0.5rem',
                                                            cursor: 'pointer',
                                                            background: selected ? 'rgba(34, 139, 230, 0.14)' : 'rgba(255,255,255,0.02)'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={selected}
                                                                onChange={() => handleToggleRoleCapability(preset.key)}
                                                                style={{ marginTop: '0.15rem' }}
                                                            />
                                                            <span>
                                                                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>{preset.label}</span>
                                                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{preset.description}</span>
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <input
                                            value={roleForm.customCapabilities}
                                            onChange={(e) => setRoleForm(prev => ({ ...prev, customCapabilities: e.target.value }))}
                                            placeholder="Advanced: extra capability keys (comma-separated)"
                                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                        <button type="submit" className="btn-primary" disabled={roleSaving} style={{ width: 'fit-content', padding: '0.5rem 1rem' }}>
                                            {roleSaving ? 'Saving...' : 'Create Role'}
                                        </button>
                                    </form>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {roles.map((role, index) => (
                                        <div key={role.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.75rem', border: '1px solid var(--glass-border)', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, color: ROLE_COLOR_PALETTE[index % ROLE_COLOR_PALETTE.length] }}>{role.name}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>{role.key}</div>
                                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                    {(role.capabilities || []).map((cap) => (
                                                        <span key={cap} style={{ border: '1px solid var(--glass-border)', borderRadius: '999px', padding: '0.15rem 0.4rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                            {cap}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteRole(role._id || role.key, role.name)}
                                                style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem', background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.35)', color: '#f44336', borderRadius: '6px', cursor: 'pointer' }}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {organizationTab === 'workflow' && (
                            <div style={{ display: 'grid', gap: '1rem' }}>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Configure this workflow visually. Example: Tier 1 (CoE only), Tier 2 (CoE + Governance), Tier 3 (CoE + Governance + Executive).
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Policy Name</span>
                                        <input
                                            value={workflowPolicy?.name || ''}
                                            onChange={(e) => updateWorkflowPolicyDraft((draft) => { draft.name = e.target.value; })}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                    </label>
                                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Reject Below Priority</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={workflowPolicy?.aiGate?.rejectBelow ?? 1.5}
                                            onChange={(e) => updateWorkflowPolicyDraft((draft) => { draft.aiGate.rejectBelow = Number(e.target.value || 0); })}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                    </label>
                                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Enhanced Oversight Max</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={workflowPolicy?.aiGate?.enhancedOversightMax ?? 2.0}
                                            onChange={(e) => updateWorkflowPolicyDraft((draft) => { draft.aiGate.enhancedOversightMax = Number(e.target.value || 0); })}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        />
                                    </label>
                                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Escalation Tier</span>
                                        <select
                                            value={workflowPolicy?.escalation?.forcedTierOnEscalation || 3}
                                            onChange={(e) => updateWorkflowPolicyDraft((draft) => { draft.escalation.forcedTierOnEscalation = Number(e.target.value); })}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        >
                                            <option value={1}>Tier 1</option>
                                            <option value={2}>Tier 2</option>
                                            <option value={3}>Tier 3</option>
                                        </select>
                                    </label>
                                </div>

                                {(workflowPolicy?.tiers || [])
                                    .slice()
                                    .sort((a, b) => a.tier - b.tier)
                                    .map((tier) => (
                                        <div key={tier.tier} style={{ border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
                                                <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Tier Label</span>
                                                    <input
                                                        value={tier.label}
                                                        onChange={(e) => updateTierField(tier.tier, 'label', e.target.value)}
                                                        style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                    />
                                                </label>
                                                <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Min Score</span>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        value={tier.minPriorityScore}
                                                        onChange={(e) => updateTierField(tier.tier, 'minPriorityScore', e.target.value)}
                                                        style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                    />
                                                </label>
                                                <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Max Score</span>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        value={tier.maxPriorityScore}
                                                        onChange={(e) => updateTierField(tier.tier, 'maxPriorityScore', e.target.value)}
                                                        style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                    />
                                                </label>
                                            </div>

                                            <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.75rem' }}>
                                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Select stages for Tier {tier.tier}:</div>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    {WORKFLOW_STAGE_ORDER.map((stageKey) => (
                                                        <label key={`${tier.tier}-${stageKey}`} style={{
                                                            border: '1px solid var(--glass-border)',
                                                            borderRadius: '999px',
                                                            padding: '0.28rem 0.58rem',
                                                            background: isStageEnabled(tier.tier, stageKey) ? 'rgba(34, 139, 230, 0.16)' : 'rgba(255,255,255,0.02)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.3rem',
                                                            cursor: 'pointer'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isStageEnabled(tier.tier, stageKey)}
                                                                onChange={() => toggleTierStage(tier.tier, stageKey)}
                                                            />
                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{STAGE_CONFIG[stageKey].title}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                {tier.stages.map((stage) => (
                                                    <div key={stage.stageKey} style={{ border: '1px solid var(--glass-border)', borderRadius: '10px', padding: '0.75rem', background: 'rgba(0,0,0,0.12)' }}>
                                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{STAGE_CONFIG[stage.stageKey as WorkflowStageKey]?.title || stage.label}</div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', marginBottom: '0.6rem' }}>{STAGE_CONFIG[stage.stageKey as WorkflowStageKey]?.hint || 'Workflow stage'}</div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '0.65rem' }}>
                                                            <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Stage Name</span>
                                                                <input
                                                                    value={stage.label}
                                                                    onChange={(e) => updateTierStageField(tier.tier, stage.stageKey as WorkflowStageKey, 'label', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </label>
                                                            <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Approvals Required</span>
                                                                <input
                                                                    type="number"
                                                                    min={1}
                                                                    value={stage.minApprovals}
                                                                    onChange={(e) => updateTierStageField(tier.tier, stage.stageKey as WorkflowStageKey, 'minApprovals', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                                />
                                                            </label>
                                                            <label style={{ display: 'grid', gap: '0.2rem' }}>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>If Rejected</span>
                                                                <select
                                                                    value={stage.onReject}
                                                                    onChange={(e) => updateTierStageField(tier.tier, stage.stageKey as WorkflowStageKey, 'onReject', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                                                >
                                                                    <option value="REJECT">Stop and Reject</option>
                                                                    <option value="ESCALATE_TO_NEXT">Escalate to Next Stage</option>
                                                                </select>
                                                            </label>
                                                        </div>

                                                        <div style={{ display: 'grid', gap: '0.35rem' }}>
                                                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Reviewer roles for this stage:</div>
                                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                                {roleOptions.map((role) => {
                                                                    const checked = (stage.requiredRoleKeys || []).includes(role.key);
                                                                    return (
                                                                        <label key={`${tier.tier}-${stage.stageKey}-${role.key}`} style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.3rem',
                                                                            border: '1px solid var(--glass-border)',
                                                                            borderRadius: '999px',
                                                                            padding: '0.2rem 0.45rem',
                                                                            cursor: 'pointer',
                                                                            background: checked ? 'rgba(46, 204, 113, 0.16)' : 'rgba(255,255,255,0.02)'
                                                                        }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={checked}
                                                                                onChange={() => toggleTierStageRole(tier.tier, stage.stageKey as WorkflowStageKey, role.key)}
                                                                            />
                                                                            <span style={{ fontSize: '0.73rem', color: checked ? '#66bb6a' : 'var(--text-primary)' }}>{role.name}</span>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}

                                <div style={{ marginTop: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Workflow updates apply to new and in-progress projects.
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                        <button type="button" onClick={handleApplyDefaultWorkflowTemplate} className="btn-secondary" disabled={workflowSaving} style={{ padding: '0.45rem 0.9rem' }}>
                                            Use Recommended Template
                                        </button>
                                        <button type="button" onClick={handleResetWorkflowPolicy} disabled={workflowSaving} style={{ padding: '0.45rem 0.9rem', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', cursor: 'pointer' }}>
                                            Reset Defaults
                                        </button>
                                        <button type="button" onClick={handleSaveWorkflowPolicy} className="btn-primary" disabled={workflowSaving} style={{ padding: '0.45rem 0.9rem' }}>
                                            {workflowSaving ? 'Saving...' : 'Save Workflow Policy'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            ) : activeTab === 'users' ? (
                <div className="glass-panel">
                    <div className="table-scroll-container">
                        <table className="data-table table-min-width">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Global Admin</th>
                                    <th>Department Permissions</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user._id}>
                                        <td>
                                            <div style={{ fontWeight: 'bold' }}>{getUserDisplayName(user, user.username)}</div>
                                            <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{user.email}</div>
                                        </td>
                                        <td>
                                            {user.isAdmin ? <span style={{ color: 'var(--sterling-red)', fontWeight: 'bold' }}>YES</span> : <span style={{ opacity: 0.3 }}>-</span>}
                                        </td>
                                        <td>
                                            {user.isAdmin ? <span style={{ opacity: 0.7 }}>All Access</span> : (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    {user.permissions?.length > 0 ? user.permissions.map((p, i) => {
                                                        const deptName = typeof p.department === 'object' ? p.department.name : 'Unknown';
                                                        const roles = p.roles || (p.role ? [p.role] : []);
                                                        return (
                                                            <span key={i} style={{ background: 'var(--surface-soft-strong)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                                                                {deptName}: <strong>{roles.map(formatRoleLabel).join(', ') || 'None'}</strong>
                                                            </span>
                                                        );
                                                    }) : <span style={{ opacity: 0.5 }}>None</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleEditClick(user)}>
                                                Manage
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <>
                    <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                        <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', color: 'var(--text-primary)' }}>Add New Department</h3>
                        <form onSubmit={handleCreateDept} className="dept-form-grid">
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Department Name</label>
                                <input
                                    value={deptForm.name}
                                    onChange={e => setDeptForm({ ...deptForm, name: e.target.value })}
                                    placeholder="e.g. Finance"
                                    required
                                    style={{ width: '100%', padding: '0.75rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', borderRadius: '6px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Description</label>
                                <input
                                    value={deptForm.description}
                                    onChange={e => setDeptForm({ ...deptForm, description: e.target.value })}
                                    placeholder="Brief description of responsibilities..."
                                    style={{ width: '100%', padding: '0.75rem', background: 'var(--input-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', borderRadius: '6px' }}
                                />
                            </div>
                            <button
                                type="submit"
                                className="btn-primary btn-full-mobile"
                                disabled={deptLoading}
                                style={{ padding: '0.75rem 2rem', height: 'fit-content' }}
                            >
                                {deptLoading ? 'Creating...' : '+ Create Department'}
                            </button>
                        </form>
                    </div>

                    <div className="glass-panel">
                        <h3 style={{ marginBottom: '1rem' }}>Existing Departments</h3>
                        <div className="dept-card-grid" style={{ marginBottom: '1.5rem' }}>
                            {departments.slice(deptPage * 5, (deptPage + 1) * 5).map(dept => (
                                <div key={dept._id} style={{
                                    padding: '1.5rem',
                                    background: 'var(--surface-darkened)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--glass-border)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1rem',
                                    position: 'relative'
                                }}>
                                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--sterling-gold)' }}>{dept.name}</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1 }}>{dept.description}</div>

                                    {dept.name !== 'General' && (
                                        <button
                                            onClick={() => handleDeleteDept(dept._id)}
                                            style={{
                                                alignSelf: 'flex-start',
                                                background: 'rgba(244, 67, 54, 0.1)',
                                                border: '1px solid rgba(244, 67, 54, 0.3)',
                                                color: '#f44336',
                                                padding: '0.4rem 0.8rem',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem'
                                            }}
                                        >
                                            Delete
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {departments.length === 0 && (
                            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>No departments found</div>
                        )}

                        {/* Pagination Controls */}
                        {departments.length > 5 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                                <button
                                    onClick={() => setDeptPage(p => Math.max(0, p - 1))}
                                    disabled={deptPage === 0}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: deptPage === 0 ? 'var(--surface-soft)' : 'var(--surface-soft-strong)',
                                        color: deptPage === 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
                                        border: 'none', borderRadius: '4px', cursor: deptPage === 0 ? 'default' : 'pointer'
                                    }}
                                >
                                    Previous
                                </button>
                                <span style={{ opacity: 0.7, fontSize: '0.9rem' }}>
                                    Page {deptPage + 1} of {Math.ceil(departments.length / 5)}
                                </span>
                                <button
                                    onClick={() => setDeptPage(p => (p + 1) * 5 < departments.length ? p + 1 : p)}
                                    disabled={(deptPage + 1) * 5 >= departments.length}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: (deptPage + 1) * 5 >= departments.length ? 'var(--surface-soft)' : 'var(--surface-soft-strong)',
                                        color: (deptPage + 1) * 5 >= departments.length ? 'var(--text-secondary)' : 'var(--text-primary)',
                                        border: 'none', borderRadius: '4px', cursor: (deptPage + 1) * 5 >= departments.length ? 'default' : 'pointer'
                                    }}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {setupWizardOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1.5rem' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '680px' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Organization Setup Wizard</h3>
                        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
                            This organization needs required governance setup before normal approval workflows can run.
                        </p>

                        <div style={{ display: 'grid', gap: '0.65rem', marginBottom: '1rem' }}>
                            <div style={{ padding: '0.75rem', border: '1px solid var(--glass-border)', borderRadius: '8px', background: missingSetup.roles ? 'rgba(255, 152, 0, 0.12)' : 'rgba(46, 204, 113, 0.12)' }}>
                                <strong>Role Catalog:</strong> {missingSetup.roles ? 'Not configured' : 'Configured'}
                            </div>
                            <div style={{ padding: '0.75rem', border: '1px solid var(--glass-border)', borderRadius: '8px', background: missingSetup.workflow ? 'rgba(255, 152, 0, 0.12)' : 'rgba(46, 204, 113, 0.12)' }}>
                                <strong>Workflow Policy:</strong> {missingSetup.workflow ? 'Not configured' : 'Configured'}
                            </div>
                        </div>

                        <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                            Selecting <strong>Setup Now</strong> will create/refresh standard roles and policy so you can then customize them in the Roles and Workflow tabs.
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setSetupWizardOpen(false);
                                    setWizardDismissed(true);
                                }}
                                style={{ padding: '0.55rem 1rem', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', cursor: 'pointer' }}
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={handleSetupNow}
                                disabled={setupActionLoading}
                                style={{ padding: '0.55rem 1rem' }}
                            >
                                {setupActionLoading ? 'Setting Up...' : 'Setup Now'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Permission Modal */}
            {editingUser && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '1200px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                        {/* Fixed Header */}
                        <div style={{ padding: '0 2rem', marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--text-primary)' }}>Edit Permissions</h2>
                                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>User: <strong style={{ color: 'var(--text-primary)' }}>{getUserDisplayName(editingUser, editingUser.username)}</strong></p>
                            </div>
                            <button onClick={() => setEditingUser(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '1.5rem', cursor: 'pointer' }}>âœ•</button>
                        </div>

                        {/* Divider */}
                        <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0 2rem', flexShrink: 0 }} />

                        {/* Scrollable Content */}
                        <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
                            <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={editIsAdmin} onChange={e => setEditIsAdmin(e.target.checked)} style={{ width: '1.5rem', height: '1.5rem', accentColor: 'var(--sterling-red)' }} />
                                    <div>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'block', color: 'var(--text-primary)' }}>Global Admin</span>
                                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Grants full access to all departments and system settings.</span>
                                    </div>
                                </label>
                            </div>

                            {!editIsAdmin && (
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                        <h3 style={{ margin: 0 }}>Department Roles</h3>
                                        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            Select capabilities for each department.
                                        </p>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                                        {departments.map(dept => (
                                            <div key={dept._id} className="glass-card" style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '1rem'
                                            }}>
                                                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{dept.name}</div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                    {roleOptions.map((roleOption) => (
                                                        <label key={roleOption.key} style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.8rem',
                                                            cursor: 'pointer',
                                                            fontSize: '0.95rem',
                                                            padding: '0.5rem',
                                                            borderRadius: '6px',
                                                            transition: 'background 0.2s',
                                                            color: 'var(--text-primary)',
                                                            background: (editPermissions[dept._id] || []).includes(roleOption.key) ? 'rgba(var(--brand-primary-rgb), 0.12)' : 'transparent'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={(editPermissions[dept._id] || []).includes(roleOption.key)}
                                                                onChange={() => handleRoleToggle(dept._id, roleOption.key)}
                                                                style={{ width: '1.1rem', height: '1.1rem', accentColor: getRoleColor(roleOption.key) }}
                                                            />
                                                            <span style={{
                                                                fontWeight: (editPermissions[dept._id] || []).includes(roleOption.key) ? 600 : 400,
                                                                color: getRoleColor(roleOption.key)
                                                            }}>
                                                                {roleOption.name}
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Fixed Footer */}
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', padding: '1.5rem 2rem', borderTop: '1px solid var(--glass-border)', background: 'var(--glass-bg)', flexShrink: 0 }}>
                            <button onClick={() => setEditingUser(null)} style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', padding: '0.8rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem' }}>Cancel</button>
                            <button onClick={savePermissions} className="btn-primary" style={{ padding: '0.8rem 2rem', fontSize: '1rem' }}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsers;

