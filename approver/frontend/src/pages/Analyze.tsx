import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const sampleInitiative = {
    initiativeName: 'Customer Service AI Assistant',
    submitterName: 'Sarah Johnson',
    submitterTitle: 'Head of Customer Experience',
    submitterEmail: 'sarah.johnson@sterling.com',
    submitterPhone: '+234 801 234 5678',
    groupHeadName: 'Michael Adeyemi',
    groupHeadApproval: true,
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

const Analyze: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { activeDepartment, user } = useAuth();

    const [activeTab, setActiveTab] = useState<'view' | 'new'>('view');
    const [projects, setProjects] = useState<any[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);

    // Search and Pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this analysis?')) return;
        try {
            await api.delete(`/projects/${id}`);
            setProjects(projects.filter(p => p._id !== id));
        } catch (error) {
            console.error(error);
            alert('Failed to delete project');
        }
    };

    // Filter projects based on search query
    const filteredProjects = projects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.requester?.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.department?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.approvalStatus || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Pagination calculations
    const totalPages = Math.ceil(filteredProjects.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedProjects = filteredProjects.slice(startIndex, startIndex + itemsPerPage);

    // Reset to page 1 when search changes
    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setCurrentPage(1);
    };

    // Form State - Comprehensive Initiative Submission
    const [form, setForm] = useState({
        // Section 1: Basic Information
        initiativeName: '',
        submitterName: '',
        submitterTitle: '',
        submitterEmail: '',
        submitterPhone: '',
        groupHeadName: '',
        groupHeadApproval: false,

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
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState('');
    const [formStep, setFormStep] = useState(1);
    const totalSteps = 8;

    useEffect(() => {
        const tabParam = searchParams.get('tab');
        if (tabParam === 'new') setActiveTab('new');
        else setActiveTab('view');
    }, [searchParams]);

    useEffect(() => {
        if (activeTab === 'view') {
            fetchProjects();
        }
    }, [activeTab, activeDepartment]);

    const fetchProjects = async () => {
        setLoadingProjects(true);
        try {
            const params = activeDepartment ? { department: activeDepartment._id } : {};
            const res = await api.get('/projects', { params });
            setProjects(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingProjects(false);
        }
    };

    const fillSample = () => {
        setForm(sampleInitiative);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAnalyzing(true);
        setError('');
        try {
            // Build description from form fields for AI analysis
            const description = `
## Initiative Overview
**Submitter:** ${form.submitterName} (${form.submitterTitle})
**Email:** ${form.submitterEmail}
**Group Head:** ${form.groupHeadName}

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
                // Include full form data for future use
                formData: form
            };
            const res = await api.post('/projects/analyze', payload);
            navigate(`/projects/${res.data.projectId || res.data._id}`);
        } catch (err: any) {
            console.error('Error analyzing project:', err);
            const errorMsg = err.response?.data?.error || 'Analysis failed. Please try again.';
            setError(errorMsg);
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ margin: 0 }}>AI Initiative Intake</h2>

                {/* Tabs */}
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px' }}>
                    <button
                        onClick={() => setActiveTab('view')}
                        style={{
                            background: activeTab === 'view' ? 'var(--sterling-red)' : 'transparent',
                            color: 'white', border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        View All Initiatives
                    </button>
                    <button
                        onClick={() => setActiveTab('new')}
                        style={{
                            background: activeTab === 'new' ? 'var(--sterling-red)' : 'transparent',
                            color: 'white', border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        + New Initiative
                    </button>
                </div>
            </div>

            {activeTab === 'view' ? (
                <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Search Bar */}
                    <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <input
                            type="text"
                            placeholder="🔍 Search by name, requester, department, or status..."
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            style={{
                                flex: 1,
                                maxWidth: '400px',
                                padding: '0.6rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'white',
                                fontSize: '0.9rem'
                            }}
                        />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''} found
                        </span>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--glass-border)' }}>
                                <th style={{ padding: '1rem', textAlign: 'left' }}>Project Name</th>
                                <th style={{ padding: '1rem', textAlign: 'left' }}>Requester</th>
                                <th style={{ padding: '1rem', textAlign: 'left' }}>Date</th>
                                <th style={{ padding: '1rem', textAlign: 'center' }}>Score</th>
                                <th style={{ padding: '1rem', textAlign: 'center' }}>Status</th>
                                <th style={{ padding: '1rem', textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedProjects.map(p => (
                                <tr key={p._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '1rem', fontWeight: 600 }}>{p.name}</td>
                                    <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                                        {p.requester?.username || 'Unknown'}
                                        {p.department && <span style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '6px' }}>({p.department.name})</span>}
                                    </td>
                                    <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                                        <span style={{
                                            background: p.score >= 80 ? 'rgba(76, 175, 80, 0.2)' : p.score >= 50 ? 'rgba(255, 152, 0, 0.2)' : 'rgba(244, 67, 54, 0.2)',
                                            color: p.score >= 80 ? '#4caf50' : p.score >= 50 ? '#ff9800' : '#f44336',
                                            padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold'
                                        }}>
                                            {p.score}/100
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem',
                                            background: p.approvalStatus === 'Approved' ? 'rgba(76, 175, 80, 0.2)' : p.approvalStatus === 'Rejected' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 152, 0, 0.1)',
                                            color: p.approvalStatus === 'Approved' ? '#4caf50' : p.approvalStatus === 'Rejected' ? '#f44336' : '#ff9800',
                                            border: `1px solid ${p.approvalStatus === 'Approved' ? '#4caf50' : p.approvalStatus === 'Rejected' ? '#f44336' : '#ff9800'}`,
                                            fontWeight: 600
                                        }}>
                                            {p.approvalStatus}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <Link to={`/projects/${p._id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--glass-border)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>View</Link>
                                        {user?.isAdmin && (
                                            <button
                                                onClick={() => handleDelete(p._id)}
                                                style={{ background: 'transparent', border: 'none', marginLeft: '0.5rem', cursor: 'pointer', fontSize: '1rem' }}
                                                title="Delete"
                                            >
                                                🗑️
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {paginatedProjects.length === 0 && !loadingProjects && (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
                                    {searchQuery ? 'No projects match your search.' : 'No projects found.'}
                                </td></tr>
                            )}
                        </tbody>
                    </table>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div style={{
                            padding: '1rem',
                            borderTop: '1px solid var(--glass-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredProjects.length)} of {filteredProjects.length}
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: currentPage === 1 ? 'transparent' : 'rgba(255,255,255,0.1)',
                                        color: currentPage === 1 ? 'var(--text-secondary)' : 'white',
                                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    ← Previous
                                </button>
                                <span style={{ padding: '0.4rem 0.8rem', color: 'var(--text-primary)' }}>
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: currentPage === totalPages ? 'transparent' : 'rgba(255,255,255,0.1)',
                                        color: currentPage === totalPages ? 'var(--text-secondary)' : 'white',
                                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}

                    {loadingProjects && <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>}
                </div>
            ) : (
                <div className="glass-panel" style={{ maxWidth: '800px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.3rem' }}>AI Initiative Submission</h3>
                            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                Step {formStep} of {totalSteps}
                            </p>
                        </div>
                        <button type="button" onClick={fillSample} style={{ background: 'var(--sterling-gold)', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            📝 Fill Sample
                        </button>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '2rem' }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(step => (
                            <div
                                key={step}
                                onClick={() => setFormStep(step)}
                                style={{
                                    flex: 1,
                                    height: '4px',
                                    borderRadius: '2px',
                                    background: step <= formStep ? 'var(--sterling-red)' : 'rgba(255,255,255,0.1)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            />
                        ))}
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Section 1: Basic Information */}
                        {formStep === 1 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>📋 Section 1: Basic Information</h4>

                                <label>Initiative Name *</label>
                                <input type="text" value={form.initiativeName} onChange={(e) => setForm({ ...form, initiativeName: e.target.value })} required placeholder="What would you like to call this project?" />

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label>Your Name *</label>
                                        <input type="text" value={form.submitterName} onChange={(e) => setForm({ ...form, submitterName: e.target.value })} required placeholder="Full name" />
                                    </div>
                                    <div>
                                        <label>Your Title/Role *</label>
                                        <input type="text" value={form.submitterTitle} onChange={(e) => setForm({ ...form, submitterTitle: e.target.value })} required placeholder="e.g., Head of Operations" />
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label>Email *</label>
                                        <input type="email" value={form.submitterEmail} onChange={(e) => setForm({ ...form, submitterEmail: e.target.value })} required placeholder="your.email@sterling.com" />
                                    </div>
                                    <div>
                                        <label>Phone</label>
                                        <input type="tel" value={form.submitterPhone} onChange={(e) => setForm({ ...form, submitterPhone: e.target.value })} placeholder="+234 xxx xxx xxxx" />
                                    </div>
                                </div>

                                <label>Group Head Name *</label>
                                <input type="text" value={form.groupHeadName} onChange={(e) => setForm({ ...form, groupHeadName: e.target.value })} required placeholder="Name of your Group Head" />

                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '1rem' }}>
                                    <input type="checkbox" checked={form.groupHeadApproval} onChange={(e) => setForm({ ...form, groupHeadApproval: e.target.checked })} style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)' }} />
                                    <span>I have my Group Head's approval</span>
                                </label>
                            </div>
                        )}

                        {/* Section 2: Problem Statement */}
                        {formStep === 2 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>🔍 Section 2: The Problem You Want to Solve</h4>

                                <label>Describe the challenge *</label>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>Tell us the story of the problem. What's not working smoothly today?</p>
                                <textarea value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} required rows={6} placeholder="What feels slow, frustrating, or expensive? How does it affect the way people work or how customers are served?" />

                                <label>Who is affected the most? *</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                                    {[
                                        { value: 'customers', label: '👥 Our Customers' },
                                        { value: 'staff', label: '👔 Our Staff' },
                                        { value: 'operations', label: '⚙️ Our Operations' },
                                        { value: 'all', label: '🌐 All of the above' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, whoAffected: opt.value as any })}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                borderRadius: '8px',
                                                border: form.whoAffected === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.whoAffected === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                <label>How do you handle it today?</label>
                                <textarea value={form.currentHandling} onChange={(e) => setForm({ ...form, currentHandling: e.target.value })} rows={3} placeholder="Briefly describe the current way this issue is managed" />
                            </div>
                        )}

                        {/* Section 3: AI Solution */}
                        {formStep === 3 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>🤖 Section 3: What You Want AI to Do</h4>

                                <label>Which direction do you see this going? *</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { value: 'automate', label: '🔄 Automate repetitive tasks' },
                                        { value: 'decisions', label: '📊 Support better decision-making with data' },
                                        { value: 'customer_experience', label: '💬 Improve customer experience' },
                                        { value: 'detect_patterns', label: '🔍 Detect patterns, risks, or unusual activity' },
                                        { value: 'not_sure', label: '🤔 Not sure yet—need help shaping the idea' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, aiDirection: opt.value as any })}
                                            style={{
                                                padding: '0.8rem 1rem',
                                                borderRadius: '8px',
                                                border: form.aiDirection === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.aiDirection === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                <label>Your idea in simple words *</label>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>Don't worry about technical details—just explain the role you'd like AI to play.</p>
                                <textarea value={form.aiIdea} onChange={(e) => setForm({ ...form, aiIdea: e.target.value })} required rows={5} placeholder="Share your vision of how AI could help..." />
                            </div>
                        )}

                        {/* Section 4: Success Metrics */}
                        {formStep === 4 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>🎯 Section 4: What Success Would Look Like</h4>

                                <label>What would improve if this works? (Select all that apply)</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                                    {[
                                        { value: 'time', label: '⏱️ Save Time' },
                                        { value: 'money', label: '💰 Save Money' },
                                        { value: 'customer', label: '😊 Serve Customers Better' },
                                        { value: 'errors', label: '✅ Reduce Errors' },
                                        { value: 'decisions', label: '🧠 Make Better Decisions' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => {
                                                const newImprovements = form.improvements.includes(opt.value)
                                                    ? form.improvements.filter(i => i !== opt.value)
                                                    : [...form.improvements, opt.value];
                                                setForm({ ...form, improvements: newImprovements });
                                            }}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                borderRadius: '8px',
                                                border: form.improvements.includes(opt.value) ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.improvements.includes(opt.value) ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                {form.improvements.includes('time') && (
                                    <><label>How much time would be saved?</label>
                                        <input type="text" value={form.timeSaved} onChange={(e) => setForm({ ...form, timeSaved: e.target.value })} placeholder="e.g., 100 hours per month" /></>
                                )}
                                {form.improvements.includes('money') && (
                                    <><label>Estimated savings (₦)?</label>
                                        <input type="text" value={form.moneySaved} onChange={(e) => setForm({ ...form, moneySaved: e.target.value })} placeholder="e.g., ₦10,000,000 annually" /></>
                                )}
                                {form.improvements.includes('customer') && (
                                    <><label>In what way would customers be better served?</label>
                                        <input type="text" value={form.customerBenefit} onChange={(e) => setForm({ ...form, customerBenefit: e.target.value })} placeholder="e.g., Faster response times, 24/7 availability" /></>
                                )}
                                {form.improvements.includes('errors') && (
                                    <><label>What type of errors would be reduced?</label>
                                        <input type="text" value={form.errorReduction} onChange={(e) => setForm({ ...form, errorReduction: e.target.value })} placeholder="e.g., Data entry mistakes, calculation errors" /></>
                                )}
                                {form.improvements.includes('decisions') && (
                                    <><label>Which decisions would improve?</label>
                                        <input type="text" value={form.betterDecisions} onChange={(e) => setForm({ ...form, betterDecisions: e.target.value })} placeholder="e.g., Credit approvals, risk assessments" /></>
                                )}

                                <label>How will you know it's working? *</label>
                                <textarea value={form.successMeasure} onChange={(e) => setForm({ ...form, successMeasure: e.target.value })} required rows={3} placeholder="What would you measure to prove success?" />
                            </div>
                        )}

                        {/* Section 5: Data Requirements */}
                        {formStep === 5 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>📊 Section 5: Data and Information Needed</h4>

                                <label>What information would AI need? *</label>
                                <textarea value={form.dataNeeded} onChange={(e) => setForm({ ...form, dataNeeded: e.target.value })} required rows={4} placeholder="List the kinds of data or documents that would help AI do its job" />

                                <label>Where is this information currently stored? *</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { value: 'excel', label: '📑 Excel Files' },
                                        { value: 'banking_system', label: '🏦 Banking System' },
                                        { value: 'customer_files', label: '📁 Customer Files' },
                                        { value: 'external', label: '🌐 External Sources' },
                                        { value: 'not_sure', label: '❓ Not Sure' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, dataStorage: opt.value as any })}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                borderRadius: '8px',
                                                border: form.dataStorage === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.dataStorage === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                <label>Does this involve customer personal information? *</label>
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                    {[
                                        { value: 'yes', label: '✅ Yes' },
                                        { value: 'no', label: '❌ No' },
                                        { value: 'not_sure', label: '❓ Not Sure' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, involvesPersonalInfo: opt.value as any })}
                                            style={{
                                                padding: '0.6rem 1.5rem',
                                                borderRadius: '8px',
                                                border: form.involvesPersonalInfo === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.involvesPersonalInfo === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Section 6: Resources & Timeline */}
                        {formStep === 6 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>⏰ Section 6: Resources and Timeline</h4>

                                <label>How soon do you need this solution? *</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { value: 'urgent_3months', label: '🔥 Very urgent – within 3 months' },
                                        { value: 'important_6months', label: '⚡ Important – within 6 months' },
                                        { value: 'can_wait_1year', label: '📅 Can wait – within a year' },
                                        { value: 'nice_to_have', label: '💡 Nice to have – no fixed timeline' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, urgency: opt.value as any })}
                                            style={{
                                                padding: '0.8rem 1rem',
                                                borderRadius: '8px',
                                                border: form.urgency === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.urgency === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                <label>Do you have a budget available? *</label>
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                    {[
                                        { value: 'yes', label: '✅ Yes' },
                                        { value: 'no', label: '❌ No – will need approval' },
                                        { value: 'not_sure', label: '❓ Not Sure' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, budgetAvailable: opt.value as any })}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                borderRadius: '8px',
                                                border: form.budgetAvailable === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.budgetAvailable === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {form.budgetAvailable === 'yes' && (
                                    <><label>Approximate Budget (₦)</label>
                                        <input type="text" value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} placeholder="e.g., ₦50,000,000" /></>
                                )}

                                <label>Time commitment from you/your team? *</label>
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                    {[
                                        { value: 'yes', label: '✅ Available' },
                                        { value: 'limited', label: '⚠️ Limited' },
                                        { value: 'no', label: '❌ Need dedicated team' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setForm({ ...form, teamTimeCommitment: opt.value as any })}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                borderRadius: '8px',
                                                border: form.teamTimeCommitment === opt.value ? '2px solid var(--sterling-red)' : '1px solid var(--glass-border)',
                                                background: form.teamTimeCommitment === opt.value ? 'rgba(214, 54, 55, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {form.teamTimeCommitment === 'yes' && (
                                    <><label>Hours per week available</label>
                                        <input type="text" value={form.teamHoursPerWeek} onChange={(e) => setForm({ ...form, teamHoursPerWeek: e.target.value })} placeholder="e.g., 10" /></>
                                )}
                            </div>
                        )}

                        {/* Section 7: Extra Context */}
                        {formStep === 7 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>📝 Section 7: Extra Context</h4>

                                <label>Has anyone tried solving this before?</label>
                                <textarea value={form.previousAttempts} onChange={(e) => setForm({ ...form, previousAttempts: e.target.value })} rows={3} placeholder="If yes, what was done and what was the outcome?" />

                                <label>Any rules, policies, or regulations to keep in mind?</label>
                                <textarea value={form.regulations} onChange={(e) => setForm({ ...form, regulations: e.target.value })} rows={3} placeholder="Share anything you know that might affect how the solution is designed" />

                                <label>Anything else we should know?</label>
                                <textarea value={form.additionalContext} onChange={(e) => setForm({ ...form, additionalContext: e.target.value })} rows={3} placeholder="Optional: Share any extra context, background, or insight" />
                            </div>
                        )}

                        {/* Section 8: Confirmation */}
                        {formStep === 8 && (
                            <div>
                                <h4 style={{ color: 'var(--sterling-gold)', marginBottom: '1.5rem' }}>✅ Section 8: Confirmation</h4>

                                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                                    <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)' }}>Please confirm the following before submitting:</p>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }}>
                                        <input type="checkbox" checked={form.confirmAccuracy} onChange={(e) => setForm({ ...form, confirmAccuracy: e.target.checked })} required style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)' }} />
                                        <span>I confirm the information I've shared is accurate</span>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }}>
                                        <input type="checkbox" checked={form.confirmGroupHeadApproval} onChange={(e) => setForm({ ...form, confirmGroupHeadApproval: e.target.checked })} required style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)' }} />
                                        <span>I have my Group Head's approval</span>
                                    </label>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={form.confirmContactAcknowledgment} onChange={(e) => setForm({ ...form, confirmContactAcknowledgment: e.target.checked })} required style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--sterling-red)' }} />
                                        <span>I understand the AI CoE will contact me within 48 hours</span>
                                    </label>
                                </div>

                                {/* Summary Preview */}
                                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                                    <h5 style={{ margin: '0 0 0.5rem 0' }}>📋 Initiative Summary</h5>
                                    <p style={{ margin: '0', fontSize: '0.9rem' }}><strong>Name:</strong> {form.initiativeName || '—'}</p>
                                    <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}><strong>Submitter:</strong> {form.submitterName || '—'}</p>
                                    <p style={{ margin: '0', fontSize: '0.9rem' }}><strong>Direction:</strong> {form.aiDirection ? form.aiDirection.replace(/_/g, ' ') : '—'}</p>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div style={{ background: 'rgba(244, 67, 54, 0.1)', border: '1px solid #f44336', borderRadius: '8px', padding: '1rem', marginTop: '1rem', color: '#f44336' }}>
                                ⚠️ {error}
                            </div>
                        )}

                        {/* Navigation Buttons */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                            <button
                                type="button"
                                onClick={() => setFormStep(s => Math.max(1, s - 1))}
                                disabled={formStep === 1}
                                style={{
                                    padding: '0.7rem 1.5rem',
                                    borderRadius: '8px',
                                    border: '1px solid var(--glass-border)',
                                    background: formStep === 1 ? 'transparent' : 'rgba(255,255,255,0.1)',
                                    color: formStep === 1 ? 'var(--text-secondary)' : 'white',
                                    cursor: formStep === 1 ? 'not-allowed' : 'pointer'
                                }}
                            >
                                ← Previous
                            </button>

                            {formStep < 8 ? (
                                <button
                                    type="button"
                                    onClick={() => setFormStep(s => Math.min(8, s + 1))}
                                    style={{
                                        padding: '0.7rem 1.5rem',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: 'var(--sterling-red)',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontWeight: 600
                                    }}
                                >
                                    Next →
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={analyzing || !form.confirmAccuracy || !form.confirmGroupHeadApproval || !form.confirmContactAcknowledgment}
                                    style={{ padding: '0.7rem 2rem' }}
                                >
                                    {analyzing ? '🔄 AI Analyzing Initiative...' : '🚀 Submit for Analysis'}
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Analyze;
