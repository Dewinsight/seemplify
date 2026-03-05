import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import './InitiativeIntake.css';

interface SubmitterUser {
    firstName?: string;
    lastName?: string;
    username?: string;
    email?: string;
    phone?: string;
    phoneNumber?: string;
    mobile?: string;
    mobileNumber?: string;
}

const normalizeText = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '');

const resolveSubmitterPrefill = (user: SubmitterUser | null | undefined) => {
    const fullName = [normalizeText(user?.firstName), normalizeText(user?.lastName)].filter(Boolean).join(' ').trim();
    const name = fullName || normalizeText(user?.username);
    const email = normalizeText(user?.email);
    const phone =
        normalizeText(user?.phone) ||
        normalizeText(user?.phoneNumber) ||
        normalizeText(user?.mobile) ||
        normalizeText(user?.mobileNumber);

    return { name, email, phone };
};

interface InitiativeIntakeProps {
    activeDepartment: any;
    onCancel: () => void;
}

const InitiativeIntake: React.FC<InitiativeIntakeProps> = ({ activeDepartment, onCancel }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [step, setStep] = useState(1);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState('');
    const [analysisJobId, setAnalysisJobId] = useState('');
    const [analysisProgress, setAnalysisProgress] = useState<any>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const submitterPrefill = resolveSubmitterPrefill(user as SubmitterUser | null);

    // Form State
    const [form, setForm] = useState({
        // Section 1: Basic Information
        initiativeName: '',
        submitterName: '',
        submitterTitle: '',
        submitterEmail: '',
        submitterPhone: '',
        groupHeadName: '',
        groupHeadApproval: false,
        heartSectorClassification: '' as '' | 'direct_heart_impact' | 'indirect_heart_impact' | 'heart_adjacent' | 'non_heart',

        // Section 2: Problem Statement
        problemDescription: '',
        whoAffected: '' as '' | 'customers' | 'staff' | 'operations' | 'all',
        currentHandling: '',

        // Section 3: AI Solution
        aiDirection: '' as '' | 'automate' | 'decisions' | 'customer_experience' | 'detect_patterns' | 'not_sure',
        aiIdea: '',

        // Section 4: Success Metrics
        improvements: [] as string[],
        timeSaved: '',
        moneySaved: '',
        customerBenefit: '',
        errorReduction: '',
        betterDecisions: '',
        successMeasure: '',

        // Section 5: Data Requirements
        dataNeeded: '',
        dataStorage: '' as '' | 'excel' | 'banking_system' | 'customer_files' | 'external' | 'not_sure',
        involvesPersonalInfo: '' as '' | 'yes' | 'no' | 'not_sure',

        // Section 6: Resources & Timeline
        urgency: '' as '' | 'urgent_3months' | 'important_6months' | 'can_wait_1year' | 'nice_to_have',
        budgetAvailable: '' as '' | 'yes' | 'no' | 'not_sure',
        budgetAmount: '',
        teamTimeCommitment: '' as '' | 'yes' | 'limited' | 'no',
        teamHoursPerWeek: '',

        // Section 7: Extra Context
        previousAttempts: '',
        regulations: '',
        additionalContext: '',

        // Section 8: Confirmation
        confirmAccuracy: false,
        confirmGroupHeadApproval: false,
        confirmContactAcknowledgment: false
    });

    const totalSteps = 8;
    const steps = [
        { id: 1, label: 'Basics', icon: '📝' },
        { id: 2, label: 'Problem', icon: '🔥' },
        { id: 3, label: 'Solution', icon: '💡' },
        { id: 4, label: 'Impact', icon: '🎯' },
        { id: 5, label: 'Data', icon: '📊' },
        { id: 6, label: 'Resources', icon: '⏳' },
        { id: 7, label: 'Context', icon: '🧩' },
        { id: 8, label: 'Review', icon: '✅' },
    ];

    const nextStep = () => setStep(prev => Math.min(prev + 1, totalSteps));
    const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    useEffect(() => {
        return () => stopPolling();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!submitterPrefill.name && !submitterPrefill.email && !submitterPrefill.phone) {
            return;
        }

        setForm((prev) => {
            const next = {
                ...prev,
                submitterName: prev.submitterName || submitterPrefill.name,
                submitterEmail: prev.submitterEmail || submitterPrefill.email,
                submitterPhone: prev.submitterPhone || submitterPrefill.phone
            };

            if (
                next.submitterName === prev.submitterName &&
                next.submitterEmail === prev.submitterEmail &&
                next.submitterPhone === prev.submitterPhone
            ) {
                return prev;
            }

            return next;
        });
    }, [submitterPrefill.email, submitterPrefill.name, submitterPrefill.phone]);

    const startPolling = (jobId: string) => {
        stopPolling();

        const poll = async () => {
            try {
                const statusRes = await api.get(`/projects/analyze-jobs/${jobId}`);
                const status = statusRes.data || {};
                setAnalysisProgress(status);

                if (status.status === 'completed' && status.projectId) {
                    stopPolling();
                    navigate(`/projects/${status.projectId}`);
                    return;
                }

                if (status.status === 'failed') {
                    stopPolling();
                    setAnalyzing(false);
                    setError(status.error || 'Analysis failed. Please try again.');
                }
            } catch (err: any) {
                stopPolling();
                setAnalyzing(false);
                setError(err.response?.data?.error || 'Failed to read analysis progress.');
            }
        };

        poll();
        pollRef.current = setInterval(poll, 1200);
    };

    const handleSubmit = async () => {
        setAnalyzing(true);
        setError('');
        setAnalysisJobId('');
        setAnalysisProgress(null);
        let payload: any = null;
        try {
            // Build description from form fields for AI analysis
            const description = `
## Initiative Overview
**Submitter:** ${form.submitterName} (${form.submitterTitle})
**Email:** ${form.submitterEmail}
**Phone:** ${form.submitterPhone || '(not provided)'}
**Group Head:** ${form.groupHeadName || '(not provided)'}
**Group Head approval confirmed:** ${form.confirmGroupHeadApproval ? 'Yes' : 'No'}
**HEART Sector Classification:** ${(form.heartSectorClassification || '').replace(/_/g, ' ') || '(not provided)'}

## Problem Statement
${form.problemDescription}

**Who is affected:** ${form.whoAffected}
**Current handling:** ${form.currentHandling}

## Proposed AI Solution
**Direction:** ${form.aiDirection?.replace(/_/g, ' ')}
${form.aiIdea}

## Success Metrics
**Expected improvements:** ${form.improvements.join(', ')}
${form.timeSaved ? `- Time saved: ${form.timeSaved}` : ''}
${form.moneySaved ? `- Money saved: ${form.moneySaved}` : ''}
${form.customerBenefit ? `- Customer benefit: ${form.customerBenefit}` : ''}
${form.errorReduction ? `- Error reduction: ${form.errorReduction}` : ''}
${form.betterDecisions ? `- Better decisions: ${form.betterDecisions}` : ''}

**Success measure:** ${form.successMeasure}

## Data Requirements
${form.dataNeeded}
**Storage:** ${form.dataStorage}
**Involves personal info:** ${form.involvesPersonalInfo}

## Resources & Timeline
**Urgency:** ${form.urgency?.replace(/_/g, ' ')}
**Budget available:** ${form.budgetAvailable}${form.budgetAmount ? ` (${form.budgetAmount})` : ''}
**Team commitment:** ${form.teamTimeCommitment}${form.teamHoursPerWeek ? ` (${form.teamHoursPerWeek} hrs/week)` : ''}

## Additional Context
${form.previousAttempts ? `**Previous attempts:** ${form.previousAttempts}` : ''}
${form.regulations ? `**Regulations:** ${form.regulations}` : ''}
${form.additionalContext ? `**Notes:** ${form.additionalContext}` : ''}
            `.trim();

            payload = {
                name: form.initiativeName,
                description,
                department: activeDepartment?._id,
                formData: form
            };
            const res = await api.post('/projects/analyze-async', payload);
            const jobId = res.data?.jobId;
            if (!jobId) {
                throw new Error('No analysis job ID returned.');
            }

            setAnalysisJobId(jobId);
            setAnalysisProgress({
                status: 'running',
                phase: 'queued',
                message: 'Analysis queued...',
                progressPercent: 0
            });
            startPolling(jobId);
        } catch (err: any) {
            // Backward-compatible fallback if async endpoint is not yet deployed.
            if (err.response?.status === 404) {
                try {
                    const fallbackRes = await api.post('/projects/analyze', payload || {
                        name: form.initiativeName,
                        description: '',
                        department: activeDepartment?._id,
                        formData: form
                    });
                    navigate(`/projects/${fallbackRes.data.projectId || fallbackRes.data._id}`);
                    return;
                } catch (fallbackErr: any) {
                    console.error('Fallback analyze failed:', fallbackErr);
                    const fallbackMsg = fallbackErr.response?.data?.error || 'Analysis failed. Please try again.';
                    setError(fallbackMsg);
                    setAnalyzing(false);
                    return;
                }
            }

            console.error('Error analyzing project:', err);
            const errorMsg = err.response?.data?.error || err.message || 'Analysis failed. Please try again.';
            setError(errorMsg);
            setAnalyzing(false);
        }
    };

    // Helper for Option Cards
    const OptionCard = ({ selected, onClick, label, icon }: { selected: boolean, onClick: () => void, label: string, icon?: string }) => (
        <div className={`option-card ${selected ? 'selected' : ''}`} onClick={onClick}>
            {icon && <div className="option-icon">{icon}</div>}
            <div className="option-label">{label}</div>
        </div>
    );

    return (
        <div className="intake-container">
            {/* Header */}
            <div className="intake-header">
                <h2 className="intake-title">Start a New AI Initiative</h2>
                <div className="intake-subtitle">Let's shape the future of banking together</div>
            </div>

            {/* Steps Progress */}
            <div className="steps-container">
                <div className="steps-progress-bar">
                    <div className="steps-progress-fill" style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}></div>
                </div>
                {steps.map((s) => (
                    <div
                        key={s.id}
                        className={`step-item ${step === s.id ? 'active' : ''} ${step > s.id ? 'completed' : ''}`}
                        onClick={() => !analyzing && setStep(s.id)}
                        style={{ cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.8 : 1 }}
                    >
                        <div className="step-circle">
                            {step > s.id ? '✓' : s.id}
                        </div>
                        <div className="step-label hide-mobile">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Main Card */}
            <div className="intake-card">
                <div className="step-content">

                    {/* Step 1: Basics */}
                    {step === 1 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">📝</div>
                                <div>Basic Information</div>
                            </div>

                            {/* Required for AI rules — shown first so users see Group Head + HEART before anything else */}
                            <div style={{
                                marginBottom: '1.5rem',
                                padding: '1.25rem',
                                background: 'rgba(214, 54, 55, 0.08)',
                                border: '1px solid rgba(214, 54, 55, 0.3)',
                                borderRadius: '12px'
                            }}>
                                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                                    Required for AI evaluation
                                </div>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.4 }}>
                                    AI rules will reject initiatives missing these. Complete all three.
                                </p>

                                <div className="form-group">
                                    <label className="form-label">Group Head Name <span style={{ color: '#d63637' }}>*</span></label>
                                    <input className="form-input" type="text" value={form.groupHeadName} onChange={(e) => setForm({ ...form, groupHeadName: e.target.value })} placeholder="e.g. Michael Adeyemi" />
                                </div>

                                <div className="form-group" style={{ marginTop: '1rem' }}>
                                    <label className="form-label">Group Head approval <span style={{ color: '#d63637' }}>*</span></label>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        padding: '0.75rem 1rem',
                                        background: 'rgba(255,255,255,0.04)',
                                        borderRadius: '8px',
                                        border: '1px solid var(--glass-border)',
                                        cursor: 'pointer'
                                    }} onClick={() => setForm({ ...form, confirmGroupHeadApproval: !form.confirmGroupHeadApproval })}>
                                        <input
                                            type="checkbox"
                                            checked={form.confirmGroupHeadApproval}
                                            onChange={e => setForm({ ...form, confirmGroupHeadApproval: e.target.checked })}
                                            style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--sterling-red)', cursor: 'pointer' }}
                                        />
                                        <span>I confirm the Group Head has approved this initiative</span>
                                    </div>
                                </div>

                                <div className="form-group" style={{ marginTop: '1rem' }}>
                                    <label className="form-label">HEART Sector Classification <span style={{ color: '#d63637' }}>*</span></label>
                                    <select
                                        className="form-select"
                                        value={form.heartSectorClassification}
                                        onChange={(e: any) => setForm({ ...form, heartSectorClassification: e.target.value })}
                                        style={{ width: '100%', maxWidth: 400 }}
                                    >
                                        <option value="">— Select classification —</option>
                                        <option value="direct_heart_impact">Direct HEART Impact</option>
                                        <option value="indirect_heart_impact">Indirect HEART Impact</option>
                                        <option value="heart_adjacent">HEART-Adjacent</option>
                                        <option value="non_heart">Non-HEART</option>
                                    </select>
                                    <small style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem', display: 'block' }}>
                                        HEART: Health, Education, Agriculture, Renewable Energy, Transportation
                                    </small>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Initiative Name</label>
                                <input className="form-input" type="text" value={form.initiativeName} onChange={(e) => setForm({ ...form, initiativeName: e.target.value })} placeholder="Project Name" autoFocus />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Your Name</label>
                                    <input className="form-input" type="text" value={form.submitterName} onChange={(e) => setForm({ ...form, submitterName: e.target.value })} placeholder="Full Name" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Your Title</label>
                                    <input className="form-input" type="text" value={form.submitterTitle} onChange={(e) => setForm({ ...form, submitterTitle: e.target.value })} placeholder="Job Title" />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Your Email</label>
                                    <input className="form-input" type="email" value={form.submitterEmail} onChange={(e) => setForm({ ...form, submitterEmail: e.target.value })} placeholder="name@company.com" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Your Phone</label>
                                    <input className="form-input" type="tel" value={form.submitterPhone} onChange={(e) => setForm({ ...form, submitterPhone: e.target.value })} placeholder="+44 7000 000000" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Problem */}
                    {step === 2 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">🔥</div>
                                <div>The Problem</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">What's the challenge?</label>
                                <textarea className="form-textarea" rows={6} value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} placeholder="Describe the pain point..." autoFocus />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Who is affected?</label>
                                <div className="option-grid">
                                    {[
                                        { value: 'customers', label: 'Customers', icon: '👥' },
                                        { value: 'staff', label: 'Staff', icon: '👔' },
                                        { value: 'operations', label: 'Operations', icon: '⚙️' },
                                        { value: 'all', label: 'Everyone', icon: '🌐' }
                                    ].map(opt => (
                                        <OptionCard
                                            key={opt.value}
                                            selected={form.whoAffected === opt.value}
                                            onClick={() => setForm({ ...form, whoAffected: opt.value as any })}
                                            label={opt.label}
                                            icon={opt.icon}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Solution */}
                    {step === 3 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">💡</div>
                                <div>The AI Solution</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">AI Direction</label>
                                <div className="option-grid">
                                    {[
                                        { value: 'automate', label: 'Automation', icon: '🔄' },
                                        { value: 'decisions', label: 'Better Decisions', icon: '📊' },
                                        { value: 'customer_experience', label: 'Customer XP', icon: '💬' },
                                        { value: 'detect_patterns', label: 'Risk/Patterns', icon: '🔍' },
                                        { value: 'not_sure', label: 'Not Sure', icon: '🤔' }
                                    ].map(opt => (
                                        <OptionCard
                                            key={opt.value}
                                            selected={form.aiDirection === opt.value}
                                            onClick={() => setForm({ ...form, aiDirection: opt.value as any })}
                                            label={opt.label}
                                            icon={opt.icon}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Your Vision</label>
                                <textarea className="form-textarea" rows={6} value={form.aiIdea} onChange={(e) => setForm({ ...form, aiIdea: e.target.value })} placeholder="How do you see AI solving this?" autoFocus />
                            </div>
                        </div>
                    )}

                    {/* Step 4: Impact */}
                    {step === 4 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">🎯</div>
                                <div>Expected Impact</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Key Improvements</label>
                                <div className="option-grid">
                                    {[
                                        { value: 'time', label: 'Save Time', icon: '⏱️' },
                                        { value: 'money', label: 'Save Money', icon: '💰' },
                                        { value: 'customer', label: 'Serve Customers', icon: '😊' },
                                        { value: 'errors', label: 'Reduce Errors', icon: '✅' },
                                        { value: 'decisions', label: 'Better Decisions', icon: '🧠' }
                                    ].map(opt => (
                                        <OptionCard
                                            key={opt.value}
                                            selected={form.improvements.includes(opt.value)}
                                            onClick={() => {
                                                const newImp = form.improvements.includes(opt.value)
                                                    ? form.improvements.filter(i => i !== opt.value)
                                                    : [...form.improvements, opt.value];
                                                setForm({ ...form, improvements: newImp });
                                            }}
                                            label={opt.label}
                                            icon={opt.icon}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Success Measure</label>
                                <textarea className="form-textarea" rows={3} value={form.successMeasure} onChange={(e) => setForm({ ...form, successMeasure: e.target.value })} placeholder="How will we measure success?" />
                            </div>
                        </div>
                    )}

                    {/* Step 5: Data */}
                    {step === 5 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">📊</div>
                                <div>Data Requirements</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">What data is needed?</label>
                                <textarea className="form-textarea" rows={4} value={form.dataNeeded} onChange={(e) => setForm({ ...form, dataNeeded: e.target.value })} placeholder="List data sources..." autoFocus />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Where is it stored?</label>
                                <div className="option-grid">
                                    {[
                                        { value: 'excel', label: 'Excel Files', icon: '📑' },
                                        { value: 'banking_system', label: 'Core Banking', icon: '🏦' },
                                        { value: 'customer_files', label: 'Customer Files', icon: '📁' },
                                        { value: 'external', label: 'External', icon: '🌐' }
                                    ].map(opt => (
                                        <OptionCard
                                            key={opt.value}
                                            selected={form.dataStorage === opt.value}
                                            onClick={() => setForm({ ...form, dataStorage: opt.value as any })}
                                            label={opt.label}
                                            icon={opt.icon}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 6: Resources */}
                    {step === 6 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">⏳</div>
                                <div>Resources & Timeline</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Urgency</label>
                                <select className="form-select" value={form.urgency} onChange={(e: any) => setForm({ ...form, urgency: e.target.value })}>
                                    <option value="">Select Urgency</option>
                                    <option value="urgent_3months">Urgent (Within 3 months)</option>
                                    <option value="important_6months">Important (Within 6 months)</option>
                                    <option value="can_wait_1year">Flexible (Within 1 year)</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Budget Available?</label>
                                <div className="option-grid">
                                    {[
                                        { value: 'yes', label: 'Yes', icon: '✅' },
                                        { value: 'no', label: 'No', icon: '❌' },
                                        { value: 'not_sure', label: 'Not Sure', icon: '❓' }
                                    ].map(opt => (
                                        <OptionCard
                                            key={opt.value}
                                            selected={form.budgetAvailable === opt.value}
                                            onClick={() => setForm({ ...form, budgetAvailable: opt.value as any })}
                                            label={opt.label}
                                            icon={opt.icon}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 7: Context */}
                    {step === 7 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">🧩</div>
                                <div>Additional Context</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Previous Attempts</label>
                                <textarea className="form-textarea" rows={3} value={form.previousAttempts} onChange={(e) => setForm({ ...form, previousAttempts: e.target.value })} placeholder="Have we tried this before?" />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Additional Notes</label>
                                <textarea className="form-textarea" rows={3} value={form.additionalContext} onChange={(e) => setForm({ ...form, additionalContext: e.target.value })} placeholder="Any other details..." />
                            </div>
                        </div>
                    )}

                    {/* Step 8: Review */}
                    {step === 8 && (
                        <div>
                            <div className="step-title">
                                <div className="step-icon">✅</div>
                                <div>Review & Submit</div>
                            </div>

                            <div className="review-grid">
                                <div className="review-item">
                                    <div className="review-label">Initiative Name</div>
                                    <div className="review-value">{form.initiativeName || 'Untitled'}</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">Submitter</div>
                                    <div className="review-value">{form.submitterName}</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">Email</div>
                                    <div className="review-value">{form.submitterEmail || '(not provided)'}</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">Phone</div>
                                    <div className="review-value">{form.submitterPhone || '(not provided)'}</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">Problem</div>
                                    <div className="review-value" style={{ fontSize: '0.9rem' }}>{form.problemDescription.substring(0, 100)}...</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">Proposed Solution</div>
                                    <div className="review-value" style={{ fontSize: '0.9rem' }}>{form.aiIdea.substring(0, 100)}...</div>
                                </div>
                            </div>

                            {/* Required fields — editable on Review; AI rules reject if missing */}
                            <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(214, 54, 55, 0.08)', border: '1px solid rgba(214, 54, 55, 0.3)', borderRadius: '12px' }}>
                                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Required for AI evaluation</div>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Complete these — AI rules will reject initiatives if missing.</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div className="form-group">
                                        <label className="form-label">Group Head Name <span style={{ color: '#d63637' }}>*</span></label>
                                        <input
                                            className="form-input"
                                            type="text"
                                            value={form.groupHeadName}
                                            onChange={e => setForm({ ...form, groupHeadName: e.target.value })}
                                            placeholder="e.g. Michael Adeyemi"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Group Head approval <span style={{ color: '#d63637' }}>*</span></label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid var(--glass-border)', cursor: 'pointer' }} onClick={() => setForm({ ...form, confirmGroupHeadApproval: !form.confirmGroupHeadApproval })}>
                                            <input type="checkbox" checked={form.confirmGroupHeadApproval} onChange={e => setForm({ ...form, confirmGroupHeadApproval: e.target.checked })} style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--sterling-red)', cursor: 'pointer' }} />
                                            <span>I confirm the Group Head has approved this initiative</span>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">HEART Sector Classification <span style={{ color: '#d63637' }}>*</span></label>
                                        <select
                                            className="form-select"
                                            value={form.heartSectorClassification}
                                            onChange={e => setForm({ ...form, heartSectorClassification: e.target.value as any })}
                                            style={{ width: '100%', maxWidth: 400 }}
                                        >
                                            <option value="">— Select classification —</option>
                                            <option value="direct_heart_impact">Direct HEART Impact</option>
                                            <option value="indirect_heart_impact">Indirect HEART Impact</option>
                                            <option value="heart_adjacent">HEART-Adjacent</option>
                                            <option value="non_heart">Non-HEART</option>
                                        </select>
                                        <small style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem', display: 'block' }}>
                                            HEART: Health, Education, Agriculture, Renewable Energy, Transportation
                                        </small>
                                    </div>
                                </div>
                            </div>

                            {analyzing && (
                                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(33, 150, 243, 0.1)', border: '1px solid rgba(33, 150, 243, 0.4)', borderRadius: '8px' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#64b5f6' }}>
                                        Agentic Rule Analysis In Progress
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
                                        {analysisProgress?.message || 'Preparing analysis pipeline...'}
                                    </div>
                                    <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginBottom: '0.65rem' }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${Number(analysisProgress?.progressPercent || 0)}%`,
                                            background: 'linear-gradient(90deg, #2196f3 0%, #00e676 100%)',
                                            transition: 'width 0.35s ease'
                                        }} />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <span>Job: {analysisJobId || '...'}</span>
                                        <span>Phase: {analysisProgress?.phase || 'queued'}</span>
                                        {typeof analysisProgress?.completedRules === 'number' && typeof analysisProgress?.totalRules === 'number' && analysisProgress.totalRules > 0 && (
                                            <span>Rules: {analysisProgress.completedRules}/{analysisProgress.totalRules}</span>
                                        )}
                                    </div>
                                    {analysisProgress?.currentRule && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                            Current: <strong style={{ color: 'var(--text-primary)' }}>{analysisProgress.currentRule}</strong>{' '}
                                            ({analysisProgress.currentRuleStatus || '...'})
                                        </div>
                                    )}
                                </div>
                            )}

                            {error && (
                                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(244, 67, 54, 0.1)', border: '1px solid #f44336', borderRadius: '8px', color: '#f44336' }}>
                                    {error}
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* Footer Navigation */}
                <div className="nav-buttons">
                    <button className="btn-back" onClick={step === 1 ? onCancel : prevStep} disabled={analyzing}>
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>

                    {step < totalSteps ? (
                        <button className="btn-next" onClick={nextStep} disabled={analyzing}>
                            Next Step →
                        </button>
                    ) : (
                        <button className="btn-next" onClick={handleSubmit} disabled={analyzing} style={{ backgroundColor: '#00E676' }}>
                            {analyzing ? 'Analyzing...' : 'Submit Initiative ✨'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InitiativeIntake;

