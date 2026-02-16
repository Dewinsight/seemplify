import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import './InitiativeIntake.css';

// Sample Data
const sampleInitiative = {
    initiativeName: 'Customer Service AI Assistant',
    submitterName: 'Sarah Johnson',
    submitterTitle: 'Head of Customer Experience',
    submitterEmail: 'sarah.johnson@sterling.com',
    submitterPhone: '+234 801 234 5678',
    groupHeadName: 'Michael Adeyemi',
    groupHeadApproval: true,
    heartSectorClassification: 'direct_heart_impact' as const,
    problemDescription: 'Our customer service team handles over 5,000 calls daily, with 60% being routine inquiries about account balances, transaction status, and branch locations. This creates long wait times (average 8 minutes) and prevents agents from handling complex issues that truly need human attention.\n\nCustomer satisfaction scores have dropped 15% over the past quarter, primarily due to wait times. Staff turnover in the call center is also increasing due to repetitive work.',
    whoAffected: 'all' as const,
    currentHandling: 'Currently, all calls go through a basic IVR menu, then to human agents. Agents manually look up information across multiple systems. We have no self-service options beyond the IVR.',
    aiDirection: 'customer_experience' as const,
    aiIdea: 'An AI-powered virtual assistant that can handle routine inquiries 24/7, understand natural language, and seamlessly escalate complex issues to human agents with full context. The AI would integrate with our core banking system to provide real-time information.',
    improvements: ['time', 'customer', 'errors'],
    timeSaved: '2000 hours per month',
    moneySaved: '₦50,000,000 annually',
    customerBenefit: 'Instant responses to common questions, 24/7 availability',
    errorReduction: 'Fewer miscommunications and information lookup errors',
    betterDecisions: '',
    successMeasure: 'Reduction in average wait time to under 2 minutes, customer satisfaction score increase of 20%, and handling 40% of routine inquiries without human intervention.',
    dataNeeded: 'Customer account information (read-only), transaction history, FAQ database, call recordings for training, product and service catalog',
    dataStorage: 'banking_system' as const,
    involvesPersonalInfo: 'yes' as const,
    urgency: 'important_6months' as const,
    budgetAvailable: 'yes' as const,
    budgetAmount: '₦75,000,000',
    teamTimeCommitment: 'yes' as const,
    teamHoursPerWeek: '20',
    previousAttempts: 'We piloted a basic chatbot 2 years ago, but it had limited capabilities and poor natural language understanding. Customers found it frustrating. AI technology has advanced significantly since then.',
    regulations: 'Must comply with CBN data protection guidelines, customer consent requirements for AI interactions, and our internal data governance policies.',
    additionalContext: 'We have executive sponsorship for this initiative. Our IT team has already done preliminary architecture assessment and believes integration is feasible.',
    confirmAccuracy: true,
    confirmGroupHeadApproval: true,
    confirmContactAcknowledgment: true
};

interface InitiativeIntakeProps {
    activeDepartment: any;
    onCancel: () => void;
}

const InitiativeIntake: React.FC<InitiativeIntakeProps> = ({ activeDepartment, onCancel }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState('');

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

    const fillSample = () => {
        setForm(sampleInitiative);
    };

    const nextStep = () => setStep(prev => Math.min(prev + 1, totalSteps));
    const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

    const handleSubmit = async () => {
        setAnalyzing(true);
        setError('');
        try {
            // Build description from form fields for AI analysis
            const description = `
## Initiative Overview
**Submitter:** ${form.submitterName} (${form.submitterTitle})
**Email:** ${form.submitterEmail}
**Group Head:** ${form.groupHeadName}
**HEART Classification:** ${(form.heartSectorClassification || '').replace(/_/g, ' ')}

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

            const payload = {
                name: form.initiativeName,
                description,
                department: activeDepartment?._id,
                formData: form
            };
            const res = await api.post('/projects/analyze', payload);
            navigate(`/projects/${res.data.projectId || res.data._id}`);
        } catch (err: any) {
            console.error('Error analyzing project:', err);
            const errorMsg = err.response?.data?.error || 'Analysis failed. Please try again.';
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
                <button type="button" onClick={fillSample} style={{ marginTop: '1rem', background: 'transparent', border: '1px solid var(--text-secondary)', padding: '0.4rem 1rem', borderRadius: '50px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    📝 Fill with Sample Data
                </button>
            </div>

            {/* Steps Progress */}
            <div className="steps-container">
                <div className="steps-progress-bar">
                    <div className="steps-progress-fill" style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}></div>
                </div>
                {steps.map((s) => (
                    <div key={s.id} className={`step-item ${step === s.id ? 'active' : ''} ${step > s.id ? 'completed' : ''}`} onClick={() => setStep(s.id)}>
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

                            <div className="form-group">
                                <label className="form-label">Group Head Name <span style={{ color: 'var(--sterling-red)' }}>*</span></label>
                                <input className="form-input" type="text" value={form.groupHeadName} onChange={(e) => setForm({ ...form, groupHeadName: e.target.value })} placeholder="Approver Name" />
                            </div>

                            <div className="form-group">
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input type="checkbox" checked={form.confirmGroupHeadApproval} onChange={(e) => setForm({ ...form, confirmGroupHeadApproval: e.target.checked })} style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)' }} />
                                    I confirm the Group Head has approved this initiative <span style={{ color: 'var(--sterling-red)' }}>*</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label className="form-label">HEART Sector Classification <span style={{ color: 'var(--sterling-red)' }}>*</span></label>
                                <select className="form-select" value={form.heartSectorClassification} onChange={(e: any) => setForm({ ...form, heartSectorClassification: e.target.value })}>
                                    <option value="">Select classification</option>
                                    <option value="direct_heart_impact">Direct HEART Impact</option>
                                    <option value="indirect_heart_impact">Indirect HEART Impact</option>
                                    <option value="heart_adjacent">HEART-Adjacent</option>
                                    <option value="non_heart">Non-HEART</option>
                                </select>
                                <small style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem', display: 'block' }}>HEART: Health, Education, Agriculture, Renewable Energy, Transportation</small>
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
                                    <div className="review-label">Group Head</div>
                                    <div className="review-value">{form.groupHeadName || '—'}</div>
                                </div>
                                <div className="review-item">
                                    <div className="review-label">HEART Classification</div>
                                    <div className="review-value">{(form.heartSectorClassification || '').replace(/_/g, ' ') || '—'}</div>
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
                    <button className="btn-back" onClick={step === 1 ? onCancel : prevStep}>
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>

                    {step < totalSteps ? (
                        <button className="btn-next" onClick={nextStep}>
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
