import React, { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface Rule {
    _id: string;
    name: string;
    criteria: string;
    category: string;
    weight: number;
    isMandatory: boolean;
    department?: { _id: string; name: string } | null;
}

const CATEGORY_ICONS: Record<string, string> = {
    'Code Quality': '🧹',
    'Security': '🔒',
    'Performance': '⚡',
    'Architecture': '🏛️',
    'Other': '📦'
};

const Rules: React.FC = () => {
    const [rules, setRules] = useState<Rule[]>([]);
    const { user, activeDepartment } = useAuth();
    // Form state: department is ID string or empty (for Global)
    const [form, setForm] = useState({
        name: '',
        criteria: '',
        category: 'Code Quality',
        weight: 5,
        isMandatory: false,
        department: ''
    });
    const [loading, setLoading] = useState(false);

    // Determine edit permission: Admin or Approver
    // Note: Requesters probably can't see this page or can't edit. 
    // ProtectedRoute lets them in. UI should hide form.
    const canEdit = user?.isAdmin || (user?.permissions || []).some((p: any) => p.role === 'Approver' || p.role === 'Admin');

    useEffect(() => {
        fetchRules();
    }, [activeDepartment]); // Refetch when context changes

    const fetchRules = async () => {
        try {
            // Filter by context if active (and assume controller returns global + dept)
            const query = activeDepartment ? `?department=${activeDepartment._id}` : '';
            const response = await api.get(`/rules${query}`);
            setRules(response.data);
        } catch (error) {
            console.error('Error fetching rules:', error);
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
            setForm({ ...form, name: '', criteria: '', category: 'Code Quality', weight: 5, isMandatory: false });
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

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'start' }}>
                {canEdit && (
                    <div className="glass-panel" style={{ flex: '0 0 320px', minWidth: '300px', position: 'sticky', top: '2rem' }}>
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
                                    {activeDepartment && (
                                        <option value={activeDepartment._id}>{activeDepartment.name} Only</option>
                                    )}
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
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Category</label>
                                <select
                                    value={form.category}
                                    onChange={e => setForm({ ...form, category: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                                >
                                    {Object.keys(CATEGORY_ICONS).map(cat => (
                                        <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {cat}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Criteria Prompt</label>
                                <textarea
                                    placeholder="Describe what the AI should check for..."
                                    value={form.criteria}
                                    onChange={e => setForm({ ...form, criteria: e.target.value })}
                                    required
                                    rows={4}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white', resize: 'vertical' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Weight (1-10)</label>
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

                            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', padding: '0.8rem' }}>
                                {loading ? 'Saving...' : 'Create Rule'}
                            </button>
                        </form>
                    </div>
                )}

                <div style={{ flex: 1, minWidth: '300px' }}>
                    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--glass-border)' }}>
                            <h3 style={{ margin: 0 }}>Active Rules Library ({rules.length})</h3>
                        </div>

                        {rules.length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                No rules defined yet. Add one to get started.
                            </div>
                        ) : (
                            <div style={{ padding: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                                {rules.map(rule => (
                                    <div key={rule._id} className="glass-card" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', position: 'relative', borderLeft: rule.isMandatory ? '4px solid var(--sterling-red)' : '4px solid transparent' }}>
                                        {/* Badges Container */}
                                        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.5rem' }}>
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
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1rem', paddingRight: '1rem', marginTop: '1.5rem' }}>
                                            <div style={{
                                                fontSize: '1.5rem',
                                                background: 'rgba(255,255,255,0.1)',
                                                width: '40px',
                                                height: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: '8px',
                                                flexShrink: 0
                                            }}>
                                                {CATEGORY_ICONS[rule.category] || '📦'}
                                            </div>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1.1rem', wordBreak: 'break-word', lineHeight: '1.3' }}>{rule.name}</h4>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rule.category}</span>
                                            </div>
                                        </div>

                                        <p style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                                            {rule.criteria}
                                        </p>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
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

                                            {canEdit && (
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
