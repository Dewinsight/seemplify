import React, { useEffect, useState } from 'react';
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
}

type RuleEffectType = 'SET_TIER' | 'ROUTE_TO_STAGE' | 'SET_FLAG';

interface RuleEffect {
    type: RuleEffectType;
    params: Record<string, any>;
}

const CATEGORY_ICONS: Record<string, string> = {
    'Code Quality': '🧹',
    'Security': '🔒',
    'Performance': '⚡',
    'Architecture': '🏛️',
    'GATE': '🚪',
    'ESCALATION': '⬆️',
    'SCORING': '📊',
    'STRATEGIC': '🎯',
    'BOOST': '⬆️',
    'PENALTY': '⬇️',
    'CAP': '🔒',
    'GENERAL': '📦',
    'MANDATORY': '⚠️',
    'Other': '📦'
};

const EFFECT_TYPE_OPTIONS: Array<{ value: RuleEffectType; label: string }> = [
    { value: 'SET_TIER', label: 'Set Tier' },
    { value: 'ROUTE_TO_STAGE', label: 'Route To Stage' },
    { value: 'SET_FLAG', label: 'Set Flag' }
];

const STAGE_OPTIONS = [
    { value: 'CenterOfExcellence', label: 'Center of Excellence' },
    { value: 'Governance', label: 'Governance' },
    { value: 'Executive', label: 'Executive' }
];

const formatEffect = (effect: RuleEffect): string => {
    if (effect.type === 'SET_TIER') return `Set Tier ${effect.params?.tier ?? '?'}`;
    if (effect.type === 'ROUTE_TO_STAGE') return `Route to ${effect.params?.stageKey ?? '?'}`;
    return `Set ${effect.params?.key || 'flag'} = ${String(effect.params?.value ?? '')}`;
};

const Rules: React.FC = () => {
    const [rules, setRules] = useState<Rule[]>([]);
    const { activeDepartment, activeOrganization } = useAuth();
    const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
    const [includeHidden, setIncludeHidden] = useState(false);
    const [bulkLoading, setBulkLoading] = useState(false);
    // Form state: department is ID string or empty (for Global)
    const [form, setForm] = useState({
        name: '',
        criteria: '',
        category: 'Code Quality',
        weight: 5,
        isMandatory: false,
        department: '',
        effects: [] as RuleEffect[]
    });
    const [effectDraft, setEffectDraft] = useState({
        type: 'SET_TIER' as RuleEffectType,
        tier: 3,
        stageKey: 'Governance',
        flagKey: '',
        flagValue: ''
    });
    const [loading, setLoading] = useState(false);

    // Determine edit permission: Admin or Governance/Executive Approver
    // Note: Requesters probably can't see this page or can't edit. 
    // ProtectedRoute lets them in. UI should hide form.
    const canEdit = hasAnyCapability(activeOrganization, ['rules.manage']);

    // Fetch available departments for scope dropdown
    useEffect(() => {
        const fetchDepartments = async () => {
            if (activeOrganization?.isAdmin) {
                try {
                    const res = await api.get('/departments');
                    setAvailableDepartments(res.data);
                } catch (e) {
                    console.error('Error fetching departments:', e);
                }
            } else {
                // For non-admins, use their permissions
                const depts = activeOrganization?.permissions?.map((p: any) => p.department).filter((d: any) => d && typeof d === 'object') || [];
                setAvailableDepartments(depts);
            }
        };
        fetchDepartments();
    }, [activeOrganization]);

    useEffect(() => {
        fetchRules();
    }, [activeDepartment, includeHidden]);

    const fetchRules = async () => {
        try {
            const params: string[] = [];
            if (activeDepartment) params.push(`department=${activeDepartment._id}`);
            if (includeHidden && canEdit) params.push('includeHidden=1');
            const query = params.length ? '?' + params.join('&') : '';
            const response = await api.get(`/rules${query}`);
            setRules(response.data);
        } catch (error) {
            console.error('Error fetching rules:', error);
        }
    };

    const handleToggleRule = async (rule: Rule, field: 'isActive' | 'isHidden', value: boolean) => {
        if (!rule.isSystem || !canEdit) return;
        try {
            await api.patch(`/rules/${rule._id}`, { [field]: value });
            fetchRules();
        } catch (e) {
            console.error(e);
            alert('Failed to update rule');
        }
    };

    const handleBulkSystemRules = async (isActive: boolean) => {
        if (!activeOrganization?.isAdmin) return;
        setBulkLoading(true);
        try {
            await api.patch('/rules/system/bulk', { isActive });
            fetchRules();
        } catch (e) {
            console.error(e);
            alert('Failed to update system rules');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this rule?')) return;
        try {
            await api.delete(`/rules/${id}`);
            fetchRules();
        } catch (error) {
            console.error('Error deleting rule:', error);
            alert('Failed to delete rule.');
        }
    };

    const handleAddEffect = () => {
        let effect: RuleEffect | null = null;

        if (effectDraft.type === 'SET_TIER') {
            const tier = Math.min(3, Math.max(1, Number(effectDraft.tier || 1)));
            effect = { type: 'SET_TIER', params: { tier } };
        } else if (effectDraft.type === 'ROUTE_TO_STAGE') {
            if (!effectDraft.stageKey) return;
            effect = { type: 'ROUTE_TO_STAGE', params: { stageKey: effectDraft.stageKey } };
        } else if (effectDraft.type === 'SET_FLAG') {
            const key = String(effectDraft.flagKey || '').trim();
            if (!key) {
                alert('Flag key is required for SET_FLAG effect.');
                return;
            }
            effect = { type: 'SET_FLAG', params: { key, value: effectDraft.flagValue } };
        }

        if (!effect) return;
        setForm(prev => ({ ...prev, effects: [...prev.effects, effect] }));
    };

    const handleRemoveEffect = (index: number) => {
        setForm(prev => ({
            ...prev,
            effects: prev.effects.filter((_, i) => i !== index)
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/rules', {
                ...form,
                department: form.department || null // Ensure empty string sends null
            });
            // Reset, keeping current scope preference? or reset to default?
            // Resetting to default (Global or as is)
            setForm({
                ...form,
                name: '',
                criteria: '',
                category: 'Code Quality',
                weight: 5,
                isMandatory: false,
                effects: []
            });
            fetchRules();
        } catch (error) {
            console.error('Error creating rule:', error);
            alert('Failed to create rule.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', paddingBottom: '2rem' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Approval Rules</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.5rem 0 0 0' }}>Define the AI evaluation criteria for new projects.</p>
                </div>
                {activeDepartment && (
                    <div style={{ padding: '0.5rem 1rem', background: 'rgba(214, 54, 55, 0.1)', border: '1px solid var(--sterling-red)', borderRadius: '8px', color: 'var(--sterling-red)' }}>
                        Context: <strong>{activeDepartment.name}</strong>
                    </div>
                )}
            </div>

            <div className="rules-container">
                {canEdit && (
                    <div className="glass-panel rules-sidebar">
                        <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
                            + New Rule
                        </h3>
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            {/* Scope Selector */}
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Scope</label>
                                <select
                                    value={form.department}
                                    onChange={e => setForm({ ...form, department: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                                >
                                    <option value="">Global (All Departments)</option>
                                    {availableDepartments.map((dept: any) => (
                                        <option key={dept._id} value={dept._id}>{dept.name} Only</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Rule Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. No Hardcoded Secrets"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    required
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>Category</label>
                                <select
                                    value={form.category}
                                    onChange={e => setForm({ ...form, category: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                >
                                    {Object.keys(CATEGORY_ICONS).map(cat => (
                                        <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {cat}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>Criteria Prompt</label>
                                <textarea
                                    placeholder="Describe what the AI should check for..."
                                    value={form.criteria}
                                    onChange={e => setForm({ ...form, criteria: e.target.value })}
                                    required
                                    rows={4}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', resize: 'vertical' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>Weight (1-10)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={form.weight}
                                        onChange={e => setForm({ ...form, weight: Number(e.target.value) })}
                                        required
                                        style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white', marginBottom: 0 }}
                                    />
                                </div>
                                <div style={{ flex: 1, paddingTop: '1.6rem' }}>
                                    <label style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.isMandatory}
                                            onChange={e => setForm({ ...form, isMandatory: e.target.checked })}
                                            style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)', margin: 0 }}
                                        />
                                        <span style={{ fontWeight: 600, color: form.isMandatory ? 'var(--sterling-red)' : 'var(--text-primary)' }}>Mandatory</span>
                                    </label>
                                </div>
                            </div>

                            <div style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                                    Effects (Optional)
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <select
                                        value={effectDraft.type}
                                        onChange={e => setEffectDraft(prev => ({ ...prev, type: e.target.value as RuleEffectType }))}
                                        style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                    >
                                        {EFFECT_TYPE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>

                                    {effectDraft.type === 'SET_TIER' && (
                                        <select
                                            value={effectDraft.tier}
                                            onChange={e => setEffectDraft(prev => ({ ...prev, tier: Number(e.target.value) }))}
                                            style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        >
                                            <option value={1}>Tier 1</option>
                                            <option value={2}>Tier 2</option>
                                            <option value={3}>Tier 3</option>
                                        </select>
                                    )}

                                    {effectDraft.type === 'ROUTE_TO_STAGE' && (
                                        <select
                                            value={effectDraft.stageKey}
                                            onChange={e => setEffectDraft(prev => ({ ...prev, stageKey: e.target.value }))}
                                            style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                                        >
                                            {STAGE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    )}

                                    {effectDraft.type === 'SET_FLAG' && (
                                        <>
                                            <input
                                                type="text"
                                                placeholder="flag key"
                                                value={effectDraft.flagKey}
                                                onChange={e => setEffectDraft(prev => ({ ...prev, flagKey: e.target.value }))}
                                                style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', minWidth: '120px' }}
                                            />
                                            <input
                                                type="text"
                                                placeholder="flag value"
                                                value={effectDraft.flagValue}
                                                onChange={e => setEffectDraft(prev => ({ ...prev, flagValue: e.target.value }))}
                                                style={{ padding: '0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', minWidth: '120px' }}
                                            />
                                        </>
                                    )}

                                    <button
                                        type="button"
                                        onClick={handleAddEffect}
                                        style={{ padding: '0.45rem 0.7rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(76,175,80,0.18)', color: '#4caf50', cursor: 'pointer' }}
                                    >
                                        Add Effect
                                    </button>
                                </div>

                                {form.effects.length > 0 ? (
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        {form.effects.map((effect, index) => (
                                            <span key={`${effect.type}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.76rem', padding: '0.2rem 0.45rem', borderRadius: '999px', border: '1px solid var(--glass-border)', background: 'rgba(33,150,243,0.15)', color: '#90caf9' }}>
                                                {formatEffect(effect)}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveEffect(index)}
                                                    style={{ background: 'transparent', border: 'none', color: '#90caf9', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                                    aria-label="Remove effect"
                                                >
                                                    x
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                        No effects added. Rule will not force any tier/stage override.
                                    </div>
                                )}
                            </div>

                            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', padding: '0.8rem' }}>
                                {loading ? 'Saving...' : 'Create Rule'}
                            </button>
                        </form>
                    </div>
                )}

                <div style={{ flex: 1, minWidth: '300px' }}>
                    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0 }}>Active Rules Library ({rules.length})</h3>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                {canEdit && (
                                    <>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input type="checkbox" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)} style={{ accentColor: 'var(--brand-primary)' }} />
                                            Show hidden
                                        </label>
                                        {activeOrganization?.isAdmin && (
                                            <>
                                                <button onClick={() => handleBulkSystemRules(false)} disabled={bulkLoading} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(244,67,54,0.2)', border: '1px solid rgba(244,67,54,0.4)', color: '#f44336', borderRadius: '6px', cursor: 'pointer' }}>
                                                    Turn off all system rules
                                                </button>
                                                <button onClick={() => handleBulkSystemRules(true)} disabled={bulkLoading} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(76,175,80,0.2)', border: '1px solid rgba(76,175,80,0.4)', color: '#4caf50', borderRadius: '6px', cursor: 'pointer' }}>
                                                    Turn on all system rules
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {rules.length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                No rules defined yet. Add one to get started.
                            </div>
                        ) : (
                            <div style={{ padding: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                                {rules.map(rule => (
                                    <div key={rule._id} className="glass-card" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', position: 'relative', borderLeft: rule.isMandatory ? '4px solid var(--sterling-red)' : '4px solid transparent', opacity: rule.isActive === false ? 0.7 : 1 }} data-rule-active={rule.isActive}>
                                        {/* Badges Container */}
                                        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {rule.isSystem && (
                                                <div style={{
                                                    background: 'rgba(155, 81, 224, 0.3)',
                                                    color: '#b794f6',
                                                    fontSize: '0.7rem',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    System
                                                </div>
                                            )}
                                            {rule.department ? (
                                                <div style={{
                                                    background: 'rgba(33, 150, 243, 0.2)',
                                                    color: '#2196f3',
                                                    fontSize: '0.7rem',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {rule.department.name}
                                                </div>
                                            ) : (
                                                <div style={{
                                                    background: 'rgba(255,255,255,0.1)',
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '0.7rem',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Global
                                                </div>
                                            )}
                                            {rule.isMandatory && (
                                                <div style={{
                                                    background: 'var(--sterling-red)',
                                                    color: 'white',
                                                    fontSize: '0.7rem',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Mandatory
                                                </div>
                                            )}
                                            {rule.isActive === false && (
                                                <div style={{
                                                    background: 'rgba(255,255,255,0.15)',
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '0.7rem',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    Off
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1rem', paddingRight: '1rem', marginTop: '1.5rem' }}>
                                            <div style={{
                                                fontSize: '1.5rem',
                                                background: 'var(--glass-border)',
                                                width: '40px',
                                                height: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: '8px',
                                                flexShrink: 0
                                            }}>
                                                {CATEGORY_ICONS[rule.category || ''] || '📦'}
                                            </div>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1.1rem', wordBreak: 'break-word', lineHeight: '1.3', color: 'var(--text-primary)' }}>{rule.name}</h4>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rule.category || 'General'}</span>
                                            </div>
                                        </div>

                                        <p style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                                            {rule.criteria}
                                        </p>

                                        {Array.isArray(rule.effects) && rule.effects.length > 0 && (
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                                {rule.effects.map((effect, index) => (
                                                    <span key={`${rule._id}-effect-${index}`} style={{ fontSize: '0.72rem', padding: '0.18rem 0.45rem', borderRadius: '999px', border: '1px solid rgba(33,150,243,0.4)', background: 'rgba(33,150,243,0.14)', color: '#90caf9' }}>
                                                        {formatEffect(effect)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Weight:</span>
                                                <div style={{ display: 'flex', gap: '2px' }}>
                                                    {[...Array(10)].map((_, i) => (
                                                        <div key={i} style={{
                                                            width: '4px',
                                                            height: '12px',
                                                            borderRadius: '2px',
                                                            background: i < rule.weight ? 'var(--sterling-gold)' : 'rgba(255,255,255,0.1)'
                                                        }} />
                                                    ))}
                                                </div>
                                                <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{rule.weight}</span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {canEdit && rule.isSystem && (
                                                    <>
                                                        <button
                                                            onClick={() => handleToggleRule(rule, 'isActive', !rule.isActive)}
                                                            title={rule.isActive ? 'Turn off' : 'Turn on'}
                                                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: rule.isActive ? 'rgba(244,67,54,0.2)' : 'rgba(76,175,80,0.2)', border: `1px solid ${rule.isActive ? 'rgba(244,67,54,0.4)' : 'rgba(76,175,80,0.4)'}`, color: rule.isActive ? '#f44336' : '#4caf50', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            {rule.isActive ? 'Off' : 'On'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleRule(rule, 'isHidden', !rule.isHidden)}
                                                            title={rule.isHidden ? 'Show' : 'Hide'}
                                                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            {rule.isHidden ? '👁️ Show' : '🙈 Hide'}
                                                        </button>
                                                    </>
                                                )}
                                                {canEdit && !rule.isSystem && (
                                                    <button
                                                        onClick={() => handleDelete(rule._id)}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            fontSize: '1rem',
                                                            opacity: 0.6,
                                                            transition: 'opacity 0.2s',
                                                            padding: '4px'
                                                        }}
                                                        title="Delete Rule"
                                                        onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                                                        onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Rules;
