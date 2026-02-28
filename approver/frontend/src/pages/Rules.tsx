import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { hasAnyCapability } from '../utils/access';

interface Rule {
    _id: string;
    name: string;
    criteria: string;
    category: string;
    weight: number;
    isMandatory: boolean;
    isActive: boolean;
    isSystem?: boolean;
    isHidden?: boolean;
    department?: { _id: string; name: string } | null;
    effects?: RuleEffect[];
    embeddingStatus?: {
        state?: 'pending' | 'indexed' | 'failed' | 'disabled';
        indexedAt?: string | null;
        lastAttemptAt?: string | null;
        source?: string;
        error?: string;
    };
}

type RuleEffectType = 'SET_TIER' | 'ROUTE_TO_STAGE' | 'SET_FLAG';
type CreateEffectType = 'SET_TIER';

interface RuleEffect {
    type: RuleEffectType;
    params: Record<string, any>;
}

interface RuleFormState {
    name: string;
    criteria: string;
    category: string;
    weight: number;
    isMandatory: boolean;
    department: string;
    effects: RuleEffect[];
}

const CATEGORY_OPTIONS = [
    'GATE',
    'ESCALATION',
    'SCORING',
    'STRATEGIC',
    'BOOST',
    'PENALTY',
    'CAP',
    'Security',
    'Architecture',
    'Other'
];

const CREATE_EFFECT_OPTIONS: Array<{ value: CreateEffectType; label: string }> = [
    { value: 'SET_TIER', label: 'Set Tier' }
];

const EMPTY_FORM: RuleFormState = {
    name: '',
    criteria: '',
    category: 'Other',
    weight: 5,
    isMandatory: false,
    department: '',
    effects: []
};

const EMPTY_EFFECT_DRAFT = {
    type: 'SET_TIER' as CreateEffectType,
    tier: 3
};

const formatEffect = (effect: RuleEffect): string => {
    if (effect.type === 'SET_TIER') return `Set Tier ${effect.params?.tier ?? '?'}`;
    if (effect.type === 'ROUTE_TO_STAGE') return `Legacy route effect (ignored): ${effect.params?.stageKey ?? '?'}`;
    return `Internal flag: ${effect.params?.key || 'unknown'}`;
};

const getEmbeddingBadge = (rule: Rule) => {
    const state = rule.embeddingStatus?.state || 'pending';
    if (state === 'indexed') return { label: 'Embedded', color: '#4caf50', border: 'rgba(76,175,80,0.45)' };
    if (state === 'failed') return { label: 'Embed Failed', color: '#f44336', border: 'rgba(244,67,54,0.45)' };
    if (state === 'disabled') return { label: 'Embedding Off', color: '#9ca3af', border: 'rgba(156,163,175,0.45)' };
    return { label: 'Embedding Pending', color: '#f59e0b', border: 'rgba(245,158,11,0.45)' };
};

const formatDateTime = (value?: string | null) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString();
};

const Rules: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isCreatePage = location.pathname === '/rules/new';

    const { activeDepartment, activeOrganization } = useAuth();
    const canEdit = hasAnyCapability(activeOrganization, ['rules.manage']);

    const [rules, setRules] = useState<Rule[]>([]);
    const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
    const [includeHidden, setIncludeHidden] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [scopeFilter, setScopeFilter] = useState<'all' | 'system' | 'custom'>('all');
    const [loadingRules, setLoadingRules] = useState(false);
    const [bulkLoading, setBulkLoading] = useState(false);
    const [retryAllLoading, setRetryAllLoading] = useState(false);
    const [retryingRuleIds, setRetryingRuleIds] = useState<Record<string, boolean>>({});

    const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
    const [effectDraft, setEffectDraft] = useState(EMPTY_EFFECT_DRAFT);
    const [submitting, setSubmitting] = useState(false);

    const fetchDepartments = async () => {
        if (!activeOrganization) return;
        if (activeOrganization.isAdmin) {
            try {
                const res = await api.get('/departments');
                setAvailableDepartments(res.data || []);
            } catch (error) {
                console.error('Error fetching departments:', error);
                setAvailableDepartments([]);
            }
            return;
        }

        const fromPermissions = activeOrganization.permissions
            ?.map((p: any) => p.department)
            .filter((d: any) => d && typeof d === 'object') || [];
        setAvailableDepartments(fromPermissions);
    };

    const fetchRules = async () => {
        if (!activeOrganization) return;
        setLoadingRules(true);
        try {
            const params: string[] = [];
            if (activeDepartment) params.push(`department=${activeDepartment._id}`);
            if (includeHidden && canEdit) params.push('includeHidden=1');
            const query = params.length > 0 ? `?${params.join('&')}` : '';
            const res = await api.get(`/rules${query}`);
            setRules(res.data || []);
        } catch (error) {
            console.error('Error fetching rules:', error);
            setRules([]);
        } finally {
            setLoadingRules(false);
        }
    };

    useEffect(() => {
        fetchDepartments();
    }, [activeOrganization?._id, activeOrganization?.isAdmin]);

    useEffect(() => {
        fetchRules();
    }, [activeOrganization?._id, activeDepartment?._id, includeHidden, canEdit]);

    const visibleRules = useMemo(() => {
        const needle = searchTerm.trim().toLowerCase();

        return rules
            .filter((rule) => {
                if (scopeFilter === 'system') return rule.isSystem === true;
                if (scopeFilter === 'custom') return rule.isSystem !== true;
                return true;
            })
            .filter((rule) => {
                if (!needle) return true;
                const text = `${rule.name} ${rule.criteria} ${rule.category}`.toLowerCase();
                return text.includes(needle);
            });
    }, [rules, searchTerm, scopeFilter]);

    const stats = useMemo(() => {
        const system = rules.filter((r) => r.isSystem).length;
        const custom = rules.filter((r) => !r.isSystem).length;
        const active = rules.filter((r) => r.isActive).length;
        return { total: rules.length, system, custom, active };
    }, [rules]);

    const handleAddEffect = () => {
        const effect: RuleEffect = {
            type: 'SET_TIER',
            params: { tier: Math.max(1, Math.min(3, Number(effectDraft.tier || 1))) }
        };

        setForm((prev) => ({ ...prev, effects: [...prev.effects, effect] }));
    };

    const handleRemoveEffect = (index: number) => {
        setForm((prev) => ({ ...prev, effects: prev.effects.filter((_, i) => i !== index) }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canEdit) return;

        setSubmitting(true);
        try {
            await api.post('/rules', {
                ...form,
                department: form.department || null
            });

            setForm(EMPTY_FORM);
            setEffectDraft(EMPTY_EFFECT_DRAFT);
            await fetchRules();
            navigate('/rules');
        } catch (error) {
            console.error('Error creating rule:', error);
            alert('Failed to create rule.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!canEdit) return;
        if (!window.confirm('Delete this custom rule?')) return;

        try {
            await api.delete(`/rules/${id}`);
            await fetchRules();
        } catch (error) {
            console.error('Error deleting rule:', error);
            alert('Failed to delete rule.');
        }
    };

    const handleToggleRule = async (rule: Rule, field: 'isActive' | 'isHidden', value: boolean) => {
        if (!rule.isSystem || !canEdit) return;
        try {
            await api.patch(`/rules/${rule._id}`, { [field]: value });
            await fetchRules();
        } catch (error) {
            console.error('Error updating rule:', error);
            alert('Failed to update rule.');
        }
    };

    const handleBulkSystemRules = async (isActive: boolean) => {
        if (!activeOrganization?.isAdmin) return;

        setBulkLoading(true);
        try {
            await api.patch('/rules/system/bulk', { isActive });
            await fetchRules();
        } catch (error) {
            console.error('Error bulk updating system rules:', error);
            alert('Failed to update system rules.');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleRetryRuleEmbedding = async (ruleId: string) => {
        if (!canEdit) return;
        setRetryingRuleIds((prev) => ({ ...prev, [ruleId]: true }));
        try {
            await api.post(`/rules/${ruleId}/embedding/retry`);
            await fetchRules();
        } catch (error) {
            console.error('Error retrying rule embedding:', error);
            alert('Failed to retry embedding for this rule.');
        } finally {
            setRetryingRuleIds((prev) => {
                const next = { ...prev };
                delete next[ruleId];
                return next;
            });
        }
    };

    const handleRetryAllEmbeddings = async () => {
        if (!canEdit) return;
        if (!window.confirm('Retry embeddings for all rules in this organization?')) return;

        setRetryAllLoading(true);
        try {
            const res = await api.post('/rules/embedding/retry-all');
            const data = res.data || {};
            alert(`Embedding retry complete. Indexed: ${data.indexed || 0}, Failed: ${data.failed || 0}, Disabled: ${data.disabled || 0}.`);
            await fetchRules();
        } catch (error) {
            console.error('Error retrying all rule embeddings:', error);
            alert('Failed to retry embeddings for all rules.');
        } finally {
            setRetryAllLoading(false);
        }
    };

    const renderCreateForm = () => (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
                <label style={{ marginBottom: '0.35rem' }}>Scope</label>
                <select
                    value={form.department}
                    onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
                >
                    <option value="">Global (All Departments)</option>
                    {availableDepartments.map((dept: any) => (
                        <option key={dept._id} value={dept._id}>{dept.name}</option>
                    ))}
                </select>
            </div>

            <div>
                <label style={{ marginBottom: '0.35rem' }}>Rule Name</label>
                <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Example: Budget over $500,000 requires additional review"
                    required
                />
            </div>

            <div>
                <label style={{ marginBottom: '0.35rem' }}>Category</label>
                <select
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                >
                    {CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>{category}</option>
                    ))}
                </select>
            </div>

            <div>
                <label style={{ marginBottom: '0.35rem' }}>Criteria Prompt</label>
                <textarea
                    rows={5}
                    value={form.criteria}
                    onChange={(e) => setForm((prev) => ({ ...prev, criteria: e.target.value }))}
                    placeholder="Describe what AI should evaluate to pass or fail this rule"
                    required
                />
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                    <label style={{ marginBottom: '0.35rem' }}>Weight (1-10)</label>
                    <input
                        type="number"
                        min={1}
                        max={10}
                        value={form.weight}
                        onChange={(e) => setForm((prev) => ({ ...prev, weight: Number(e.target.value) }))}
                        required
                    />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.4rem' }}>
                    <input
                        type="checkbox"
                        checked={form.isMandatory}
                        onChange={(e) => setForm((prev) => ({ ...prev, isMandatory: e.target.checked }))}
                        style={{ width: '1rem', height: '1rem', margin: 0 }}
                    />
                    Mandatory
                </label>
            </div>

            <div style={{ border: '1px solid var(--glass-border)', borderRadius: '10px', padding: '0.9rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Tier Effects</div>
                <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                    Effects can raise the final tier. Workflow Policy controls the actual approval path.
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                        value={effectDraft.type}
                        onChange={(e) => setEffectDraft((prev) => ({ ...prev, type: e.target.value as CreateEffectType }))}
                        style={{ width: 'auto', minWidth: '170px', marginBottom: 0 }}
                    >
                        {CREATE_EFFECT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>

                    <select
                        value={effectDraft.tier}
                        onChange={(e) => setEffectDraft((prev) => ({ ...prev, tier: Number(e.target.value) }))}
                        style={{ width: 'auto', minWidth: '120px', marginBottom: 0 }}
                    >
                        <option value={1}>Tier 1</option>
                        <option value={2}>Tier 2</option>
                        <option value={3}>Tier 3</option>
                    </select>

                    <button type="button" onClick={handleAddEffect} className="btn-primary" style={{ padding: '0.45rem 0.75rem' }}>
                        Add Effect
                    </button>
                </div>

                {form.effects.length > 0 ? (
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                        {form.effects.map((effect, index) => (
                            <span key={`${effect.type}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.45rem', borderRadius: '999px', border: '1px solid var(--glass-border)', fontSize: '0.78rem' }}>
                                {formatEffect(effect)}
                                <button
                                    type="button"
                                    onClick={() => handleRemoveEffect(index)}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}
                                >
                                    x
                                </button>
                            </span>
                        ))}
                    </div>
                ) : (
                    <div style={{ marginTop: '0.7rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        No effects configured yet.
                    </div>
                )}
            </div>

            <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: '0.25rem' }}>
                {submitting ? 'Creating...' : 'Create Rule'}
            </button>
        </form>
    );

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', paddingBottom: '2rem' }}>
            <div className="glass-panel" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem' }}>{isCreatePage ? 'Create Rule' : 'Rules Library'}</h2>
                    <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-secondary)' }}>
                        {isCreatePage
                            ? 'Define a rule and optional tier effects.'
                            : 'Browse, filter, and manage organization rules.'}
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {!isCreatePage && canEdit && (
                        <button className="btn-primary" onClick={() => navigate('/rules/new')}>
                            New Rule
                        </button>
                    )}
                    {isCreatePage && (
                        <button
                            onClick={() => navigate('/rules')}
                            style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', borderRadius: '8px', padding: '0.7rem 1rem', cursor: 'pointer', fontWeight: 600 }}
                        >
                            Back to Rules
                        </button>
                    )}
                </div>
            </div>

            {isCreatePage ? (
                canEdit ? (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <div className="glass-panel" style={{ flex: '2 1 560px', marginBottom: 0 }}>
                            {renderCreateForm()}
                        </div>

                        <div className="glass-panel" style={{ flex: '1 1 300px', marginBottom: 0 }}>
                            <h3 style={{ marginTop: 0 }}>How Effects Work</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.9rem', lineHeight: 1.55 }}>
                                <div>
                                    <strong>Set Tier:</strong> pushes initiative to at least the selected tier.
                                </div>
                                <div>
                                    <strong>Workflow Policy:</strong> decides who approves each stage and how many approvals are required within the chosen tier.
                                </div>
                                <div style={{ padding: '0.65rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)' }}>
                                    Legacy route effects are deprecated and ignored for new submissions. `SET_FLAG` is internal metadata and hidden from normal rule creation.
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="glass-panel">You do not have permission to create rules.</div>
                )
            ) : (
                <div className="glass-panel" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--glass-border)', borderRadius: '8px', minWidth: '130px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stats.total}</div>
                        </div>
                        <div style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--glass-border)', borderRadius: '8px', minWidth: '130px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>System</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stats.system}</div>
                        </div>
                        <div style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--glass-border)', borderRadius: '8px', minWidth: '130px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Custom</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stats.custom}</div>
                        </div>
                        <div style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--glass-border)', borderRadius: '8px', minWidth: '130px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Active</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stats.active}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search by name, category, or criteria"
                            style={{ marginBottom: 0, flex: '1 1 260px' }}
                        />

                        <select
                            value={scopeFilter}
                            onChange={(e) => setScopeFilter(e.target.value as 'all' | 'system' | 'custom')}
                            style={{ marginBottom: 0, width: 'auto', minWidth: '180px' }}
                        >
                            <option value="all">All Rules</option>
                            <option value="system">System Rules</option>
                            <option value="custom">Custom Rules</option>
                        </select>

                        {canEdit && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
                                <input
                                    type="checkbox"
                                    checked={includeHidden}
                                    onChange={(e) => setIncludeHidden(e.target.checked)}
                                    style={{ width: '1rem', height: '1rem', margin: 0 }}
                                />
                                Show hidden
                            </label>
                        )}

                        {activeOrganization?.isAdmin && canEdit && (
                            <>
                                <button
                                    onClick={() => handleBulkSystemRules(false)}
                                    disabled={bulkLoading}
                                    style={{ border: '1px solid rgba(244,67,54,0.45)', background: 'rgba(244,67,54,0.12)', color: '#f44336', borderRadius: '8px', padding: '0.55rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Turn Off System Rules
                                </button>
                                <button
                                    onClick={() => handleBulkSystemRules(true)}
                                    disabled={bulkLoading}
                                    style={{ border: '1px solid rgba(76,175,80,0.45)', background: 'rgba(76,175,80,0.12)', color: '#4caf50', borderRadius: '8px', padding: '0.55rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Turn On System Rules
                                </button>
                            </>
                        )}

                        {canEdit && (
                            <button
                                onClick={handleRetryAllEmbeddings}
                                disabled={retryAllLoading}
                                style={{ border: '1px solid rgba(59,130,246,0.45)', background: 'rgba(59,130,246,0.12)', color: '#60a5fa', borderRadius: '8px', padding: '0.55rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                                {retryAllLoading ? 'Retrying Embeddings...' : 'Retry Embeddings (All Rules)'}
                            </button>
                        )}
                    </div>

                    {loadingRules ? (
                        <div style={{ padding: '1.5rem 0', color: 'var(--text-secondary)' }}>Loading rules...</div>
                    ) : visibleRules.length === 0 ? (
                        <div style={{ padding: '2rem 0', color: 'var(--text-secondary)' }}>
                            No rules matched your filters.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                            {visibleRules.map((rule) => {
                                const embeddingBadge = getEmbeddingBadge(rule);
                                const indexedAt = formatDateTime(rule.embeddingStatus?.indexedAt);
                                const lastAttemptAt = formatDateTime(rule.embeddingStatus?.lastAttemptAt);
                                return (
                                <div
                                    key={rule._id}
                                    className="glass-card"
                                    style={{
                                        flex: '1 1 320px',
                                        borderLeft: rule.isMandatory ? '4px solid var(--sterling-red)' : '4px solid transparent',
                                        opacity: rule.isActive ? 1 : 0.7
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                        <h4 style={{ margin: 0, lineHeight: 1.3 }}>{rule.name}</h4>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            {rule.isSystem && <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>System</span>}
                                            {rule.isMandatory && <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid rgba(214,54,55,0.5)', color: 'var(--sterling-red)' }}>Mandatory</span>}
                                            {rule.department?.name ? <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>{rule.department.name}</span> : <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>Global</span>}
                                            {!rule.isActive && <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>Off</span>}
                                            {rule.isHidden && <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>Hidden</span>}
                                            <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: `1px solid ${embeddingBadge.border}`, color: embeddingBadge.color }}>
                                                {embeddingBadge.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.55rem' }}>
                                        {rule.category || 'Other'} | Weight {rule.weight}
                                    </div>

                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.55rem', lineHeight: 1.45 }}>
                                        {indexedAt ? `Indexed: ${indexedAt}` : (lastAttemptAt ? `Last attempt: ${lastAttemptAt}` : 'Never embedded')}
                                        {rule.embeddingStatus?.source ? ` | Source: ${rule.embeddingStatus.source}` : ''}
                                        {rule.embeddingStatus?.state === 'failed' && rule.embeddingStatus?.error ? ` | Error: ${rule.embeddingStatus.error}` : ''}
                                    </div>

                                    <p style={{ marginTop: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{rule.criteria}</p>

                                    {Array.isArray(rule.effects) && rule.effects.length > 0 && (
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                                            {rule.effects.map((effect, index) => (
                                                <span key={`${rule._id}-effect-${index}`} style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '999px', border: '1px solid var(--glass-border)' }}>
                                                    {formatEffect(effect)}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {canEdit && (
                                        <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
                                            <button
                                                onClick={() => handleRetryRuleEmbedding(rule._id)}
                                                disabled={Boolean(retryingRuleIds[rule._id])}
                                                style={{ border: '1px solid rgba(59,130,246,0.45)', background: 'rgba(59,130,246,0.12)', color: '#60a5fa', borderRadius: '6px', padding: '0.35rem 0.55rem', cursor: 'pointer' }}
                                            >
                                                {retryingRuleIds[rule._id] ? 'Retrying...' : 'Retry Embedding'}
                                            </button>
                                            {rule.isSystem ? (
                                                <>
                                                    <button
                                                        onClick={() => handleToggleRule(rule, 'isActive', !rule.isActive)}
                                                        style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', borderRadius: '6px', padding: '0.35rem 0.55rem', cursor: 'pointer' }}
                                                    >
                                                        {rule.isActive ? 'Turn Off' : 'Turn On'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleRule(rule, 'isHidden', !rule.isHidden)}
                                                        style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', borderRadius: '6px', padding: '0.35rem 0.55rem', cursor: 'pointer' }}
                                                    >
                                                        {rule.isHidden ? 'Unhide' : 'Hide'}
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => handleDelete(rule._id)}
                                                    style={{ border: '1px solid rgba(244,67,54,0.45)', background: 'rgba(244,67,54,0.12)', color: '#f44336', borderRadius: '6px', padding: '0.35rem 0.55rem', cursor: 'pointer' }}
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Rules;
