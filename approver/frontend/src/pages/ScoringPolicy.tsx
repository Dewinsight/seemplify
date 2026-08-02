import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { hasAnyCapability } from '../utils/access';

type WeightKey =
    | 'strategicAlignment'
    | 'regulatoryRisk'
    | 'businessImpact'
    | 'implementationComplexity'
    | 'timeToValue'
    | 'resourceRequirements';

type Weights = Record<WeightKey, number>;

interface Department {
    _id: string;
    name: string;
}

interface DepartmentOverride {
    department: string;
    weights: Weights;
}

const WEIGHT_DIMENSIONS: Array<{ key: WeightKey; label: string }> = [
    { key: 'strategicAlignment', label: 'Strategic Alignment' },
    { key: 'regulatoryRisk', label: 'Regulatory Risk' },
    { key: 'businessImpact', label: 'Business Impact' },
    { key: 'implementationComplexity', label: 'Implementation Complexity' },
    { key: 'timeToValue', label: 'Time To Value' },
    { key: 'resourceRequirements', label: 'Resource Requirements' }
];

const DEFAULT_WEIGHTS: Weights = {
    strategicAlignment: 25,
    regulatoryRisk: 25,
    businessImpact: 20,
    implementationComplexity: 15,
    timeToValue: 10,
    resourceRequirements: 5
};

const roundWeight = (value: number) => Math.round(value * 100) / 100;

const sumWeights = (weights: Weights) => {
    return WEIGHT_DIMENSIONS.reduce((sum, dimension) => sum + Number(weights[dimension.key] || 0), 0);
};

const applyCappedWeight = (weights: Weights, key: WeightKey, nextValue: number): Weights => {
    const safe = Number.isFinite(nextValue) ? Math.max(0, Math.min(100, nextValue)) : 0;
    const otherTotal = WEIGHT_DIMENSIONS
        .filter((dimension) => dimension.key !== key)
        .reduce((sum, dimension) => sum + Number(weights[dimension.key] || 0), 0);
    const maxAllowed = Math.max(0, 100 - otherTotal);
    const capped = Math.min(safe, maxAllowed);
    return {
        ...weights,
        [key]: roundWeight(capped)
    };
};

const normalizeWeights = (input: Partial<Weights> | undefined | null): Weights => {
    const next: Weights = { ...DEFAULT_WEIGHTS };
    WEIGHT_DIMENSIONS.forEach((dimension) => {
        const raw = Number(input?.[dimension.key]);
        if (!Number.isNaN(raw) && raw >= 0 && raw <= 100) {
            next[dimension.key] = roundWeight(raw);
        }
    });
    return next;
};

const ScoringPolicy: React.FC = () => {
    const { activeOrganization } = useAuth();
    const canManage = hasAnyCapability(activeOrganization, ['scoring.manage']);

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [globalWeights, setGlobalWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
    const [departments, setDepartments] = useState<Department[]>([]);
    const [departmentOverrides, setDepartmentOverrides] = useState<DepartmentOverride[]>([]);
    const [canEditGlobal, setCanEditGlobal] = useState(true);

    const fetchPolicy = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.get('/scoring-policy');
            const payload = response.data || {};

            const nextGlobal = normalizeWeights(payload.scoringWeights);
            setGlobalWeights(nextGlobal);
            setCanEditGlobal(payload.canEditGlobal !== false);

            const nextDepartments: Department[] = Array.isArray(payload.departments) ? payload.departments : [];
            setDepartments(nextDepartments);

            const nextOverrides: DepartmentOverride[] = Array.isArray(payload.departmentScoringWeights)
                ? payload.departmentScoringWeights
                    .map((row: any) => ({
                        department: String(row.department || ''),
                        weights: normalizeWeights(row.weights)
                    }))
                    .filter((row: DepartmentOverride) => row.department)
                : [];
            setDepartmentOverrides(nextOverrides);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to load scoring policy.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!canManage) return;
        fetchPolicy();
    }, [canManage, activeOrganization?._id]);

    const globalTotal = useMemo(() => sumWeights(globalWeights), [globalWeights]);

    const overrideTotals = useMemo(
        () => departmentOverrides.map((row) => sumWeights(row.weights)),
        [departmentOverrides]
    );

    const assignedDepartmentIds = useMemo(
        () => new Set(departmentOverrides.map((row) => row.department)),
        [departmentOverrides]
    );

    const addDepartmentOverride = () => {
        const firstAvailable = departments.find((department) => !assignedDepartmentIds.has(department._id));
        setDepartmentOverrides((prev) => ([
            ...prev,
            {
                department: firstAvailable?._id || '',
                weights: { ...globalWeights }
            }
        ]));
    };

    const removeDepartmentOverride = (index: number) => {
        setDepartmentOverrides((prev) => prev.filter((_, i) => i !== index));
    };

    const updateDepartmentOverrideDepartment = (index: number, departmentId: string) => {
        setDepartmentOverrides((prev) => prev.map((row, i) => {
            if (i !== index) return row;
            return { ...row, department: departmentId };
        }));
    };

    const updateGlobalWeight = (key: WeightKey, value: number) => {
        setGlobalWeights((prev) => applyCappedWeight(prev, key, value));
    };

    const updateDepartmentWeight = (index: number, key: WeightKey, value: number) => {
        setDepartmentOverrides((prev) => prev.map((row, i) => {
            if (i !== index) return row;
            return {
                ...row,
                weights: applyCappedWeight(row.weights, key, value)
            };
        }));
    };

    const canSave = useMemo(() => {
        if (canEditGlobal && Math.abs(globalTotal - 100) > 0.001) return false;

        const invalidOverride = departmentOverrides.some((row, index) => {
            if (!row.department) return true;
            if (Math.abs(overrideTotals[index] - 100) > 0.001) return true;
            return false;
        });

        if (invalidOverride) return false;

        const ids = departmentOverrides.map((row) => row.department).filter(Boolean);
        if (new Set(ids).size !== ids.length) return false;

        return true;
    }, [canEditGlobal, globalTotal, departmentOverrides, overrideTotals]);

    const handleSave = async () => {
        if (!canSave) return;

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const payload: any = {
                departmentScoringWeights: departmentOverrides
            };
            if (canEditGlobal) payload.scoringWeights = globalWeights;

            await api.put('/scoring-policy', payload);
            setSuccess('Scoring policy updated.');
            await fetchPolicy();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to update scoring policy.');
        } finally {
            setSaving(false);
        }
    };

    if (!canManage) {
        return (
            <div className="glass-panel" style={{ maxWidth: '900px', margin: '0 auto' }}>
                You do not have permission to manage scoring policy.
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '2rem' }}>
            <div className="glass-panel" style={{ marginBottom: '1rem' }}>
                <h2 style={{ marginTop: 0, marginBottom: '0.35rem' }}>Scoring Policy</h2>
                <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
                    These weights drive the Priority Score (1-5), which determines default Tier routing.
                </p>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                    Formula: (Strategic x weight) + (Regulatory x weight) + (Business x weight) +
                    (Complexity x weight) + (Time-to-Value x weight) + (Resources x weight)
                </div>
            </div>

            {loading ? (
                <div className="glass-panel">Loading scoring policy...</div>
            ) : (
                <>
                    <div className="glass-panel" style={{ marginBottom: '1rem' }}>
                        <h3 style={{ marginTop: 0 }}>Organization Weights</h3>
                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                            {WEIGHT_DIMENSIONS.map((dimension) => (
                                <div key={dimension.key} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 90px', gap: '0.75rem', alignItems: 'center' }}>
                                    <div>{dimension.label}</div>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={globalWeights[dimension.key]}
                                        onChange={(event) => updateGlobalWeight(dimension.key, Number(event.target.value))}
                                        disabled={!canEditGlobal}
                                        style={{ marginBottom: 0 }}
                                    />
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>%</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: '0.9rem', fontSize: '0.9rem', color: Math.abs(globalTotal - 100) < 0.001 ? '#4caf50' : '#f44336' }}>
                            Total: {globalTotal.toFixed(2)}% {Math.abs(globalTotal - 100) < 0.001 ? '(valid)' : '(must equal 100%)'}
                        </div>
                        {!canEditGlobal && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                Global weights are admin-controlled. You can still manage department overrides.
                            </div>
                        )}
                    </div>

                    <div className="glass-panel" style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <h3 style={{ margin: 0 }}>Department Overrides</h3>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={addDepartmentOverride}
                                disabled={departments.length === 0 || assignedDepartmentIds.size >= departments.length}
                            >
                                Add Department Override
                            </button>
                        </div>

                        {departmentOverrides.length === 0 ? (
                            <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>
                                No department overrides configured. Departments inherit organization weights.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.9rem' }}>
                                {departmentOverrides.map((row, index) => {
                                    const total = overrideTotals[index] || 0;
                                    return (
                                        <div key={`${row.department}-${index}`} style={{ border: '1px solid var(--glass-border)', borderRadius: '10px', padding: '0.9rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                <select
                                                    value={row.department}
                                                    onChange={(event) => updateDepartmentOverrideDepartment(index, event.target.value)}
                                                    style={{ width: 'auto', minWidth: '260px', marginBottom: 0 }}
                                                >
                                                    <option value="">Select department</option>
                                                    {departments.map((department) => {
                                                        const selectedByOther = departmentOverrides.some((other, otherIndex) => otherIndex !== index && other.department === department._id);
                                                        return (
                                                            <option key={department._id} value={department._id} disabled={selectedByOther}>
                                                                {department.name}
                                                            </option>
                                                        );
                                                    })}
                                                </select>

                                                <button
                                                    type="button"
                                                    onClick={() => removeDepartmentOverride(index)}
                                                    style={{ border: '1px solid rgba(244,67,54,0.45)', background: 'rgba(244,67,54,0.12)', color: '#f44336', borderRadius: '8px', padding: '0.45rem 0.75rem', cursor: 'pointer' }}
                                                >
                                                    Remove
                                                </button>
                                            </div>

                                            <div style={{ display: 'grid', gap: '0.6rem' }}>
                                                {WEIGHT_DIMENSIONS.map((dimension) => (
                                                    <div key={dimension.key} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 90px', gap: '0.75rem', alignItems: 'center' }}>
                                                        <div>{dimension.label}</div>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={100}
                                                            step={0.5}
                                                            value={row.weights[dimension.key]}
                                                            onChange={(event) => updateDepartmentWeight(index, dimension.key, Number(event.target.value))}
                                                            style={{ marginBottom: 0 }}
                                                        />
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>%</div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div style={{ marginTop: '0.75rem', fontSize: '0.88rem', color: Math.abs(total - 100) < 0.001 ? '#4caf50' : '#f44336' }}>
                                                Total: {total.toFixed(2)}% {Math.abs(total - 100) < 0.001 ? '(valid)' : '(must equal 100%)'}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {(error || success) && (
                        <div className="glass-panel" style={{ marginBottom: '1rem', color: error ? '#f44336' : '#4caf50' }}>
                            {error || success}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            className="btn-primary"
                            onClick={handleSave}
                            disabled={!canSave || saving}
                        >
                            {saving ? 'Saving...' : 'Save Scoring Policy'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default ScoringPolicy;
