import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getUserDisplayName } from '../utils/userDisplay';

interface RuleAnalysis {
    ruleName: string;
    status: string;
    reason: string;
}

interface FormData {
    initiativeName?: string;
    submitterName?: string;
    submitterTitle?: string;
    submitterEmail?: string;
    submitterPhone?: string;
    groupHeadName?: string;
    confirmGroupHeadApproval?: boolean;
    heartSectorClassification?: string;
    problemDescription?: string;
    whoAffected?: string;
    currentHandling?: string;
    aiDirection?: string;
    aiIdea?: string;
    improvements?: string[];
    timeSaved?: string;
    moneySaved?: string;
    customerBenefit?: string;
    errorReduction?: string;
    betterDecisions?: string;
    successMeasure?: string;
    dataNeeded?: string;
    dataStorage?: string;
    involvesPersonalInfo?: string;
    urgency?: string;
    budgetAvailable?: string;
    budgetAmount?: string;
    teamTimeCommitment?: string;
    teamHoursPerWeek?: string;
    previousAttempts?: string;
    regulations?: string;
    additionalContext?: string;
}

interface ApprovalHistoryItem {
    stage: 'AI' | 'CenterOfExcellence' | 'Governance' | 'Executive';
    action: 'Approved' | 'Rejected' | 'Escalated';
    by?: { username?: string; firstName?: string; lastName?: string } | null;
    reason?: string;
    score?: number;
    timestamp: string;
}

interface ScoringBreakdown {
    strategicAlignment?: { score: number; reason: string };
    regulatoryRisk?: { score: number; reason: string };
    businessImpact?: { score: number; reason: string };
    implementationComplexity?: { score: number; reason: string };
    timeToValue?: { score: number; reason: string };
    resourceRequirements?: { score: number; reason: string };
}

interface Project {
    _id: string;
    name: string;
    description: string;
    repoUrl: string;
    approvalStatus: string;
    status: string;
    score: number;
    formData?: FormData;
    tier?: number;
    priorityScore?: number;
    scoringBreakdown?: ScoringBreakdown;
    escalationTriggers?: string[];
    needEnhancedOversight?: boolean;
    workflowStage?: string;
    approvalHistory?: ApprovalHistoryItem[];
    submittedAt?: string;
    analysisResult: {
        overallStatus: string;
        rulesAnalysis: RuleAnalysis[];
        summary: string;
        scoringBreakdown?: ScoringBreakdown;
        priorityScore?: number;
        calculatedTier?: number;
    };
    requester: {
        username?: string;
        firstName?: string;
        lastName?: string;
        department: string;
    };
    department?: { _id: string; name: string };
    overrideBy?: string;
    overrideReason?: string;
    createdAt: string;
}

const ProjectDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { activeOrganization } = useAuth();
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [showOverride, setShowOverride] = useState(false);
    const [overrideReason, setOverrideReason] = useState('');
    const [overrideAction, setOverrideAction] = useState<'Approved' | 'Rejected'>('Approved');

    // Tiered review state
    const [reviewReason, setReviewReason] = useState('');
    const [reviewLoading, setReviewLoading] = useState(false);

    useEffect(() => {
        fetchProject();
    }, [id]);

    const fetchProject = async () => {
        try {
            const res = await api.get(`/projects/${id}`);
            setProject(res.data);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching project:', error);
            setLoading(false);
        }
    };

    const handleOverride = async () => {
        if (!overrideReason.trim()) {
            alert('Please provide a reason for the override.');
            return;
        }
        try {
            await api.patch(`/projects/${id}/override`, {
                projectId: id,
                newStatus: overrideAction,
                reason: overrideReason
            });
            setShowOverride(false);
            fetchProject();
        } catch (error) {
            console.error('Error overriding project:', error);
            alert('Failed to override project.');
        }
    };

    const handleGovernanceReview = async (action: 'Approved' | 'Rejected') => {
        setReviewLoading(true);
        try {
            await api.post('/projects/governance-review', {
                projectId: id,
                action,
                reason: reviewReason || `Governance ${action.toLowerCase()}`
            });
            setReviewReason('');
            fetchProject();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to submit governance review');
        } finally {
            setReviewLoading(false);
        }
    };

    const handleExecutiveReview = async (action: 'Approved' | 'Rejected') => {
        setReviewLoading(true);
        try {
            await api.post('/projects/executive-review', {
                projectId: id,
                action,
                reason: reviewReason || `Executive ${action.toLowerCase()}`
            });
            setReviewReason('');
            fetchProject();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to submit executive review');
        } finally {
            setReviewLoading(false);
        }
    };

    const handleCoEReview = async (action: 'Approved' | 'Rejected') => {
        setReviewLoading(true);
        try {
            await api.post('/projects/coe-review', {
                projectId: id,
                action,
                reason: reviewReason || `Center of Excellence ${action.toLowerCase()}`
            });
            setReviewReason('');
            fetchProject();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to submit CoE review');
        } finally {
            setReviewLoading(false);
        }
    };

    if (loading) return <div className="glass-panel">Loading...</div>;
    if (!project) return <div className="glass-panel">Project not found</div>;

    const canOverride = (activeOrganization?.isAdmin ||
        activeOrganization?.permissions?.some((p: any) => {
            const roles = p.roles || (p.role ? [p.role] : []);
            return roles.some((r: string) => ['GovernanceApprover', 'ExecutiveApprover'].includes(r));
        })
    );

    // Check if user can perform CoE review
    const canCoEReview = activeOrganization?.isAdmin || activeOrganization?.permissions?.some(
        (p: any) => {
            const roles = p.roles || (p.role ? [p.role] : []);
            return roles.includes('CenterOfExcellence');
        }
    );

    // Check if user can perform governance review
    const canGovernanceReview = activeOrganization?.isAdmin || activeOrganization?.permissions?.some(
        (p: any) => {
            const roles = p.roles || (p.role ? [p.role] : []);
            return roles.some((r: string) => ['GovernanceApprover', 'ExecutiveApprover'].includes(r));
        }
    );

    // Check if user can perform executive review
    const canExecutiveReview = activeOrganization?.isAdmin || activeOrganization?.permissions?.some(
        (p: any) => {
            const roles = p.roles || (p.role ? [p.role] : []);
            return roles.includes('ExecutiveApprover');
        }
    );

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h2 style={{ margin: '0 0 0.5rem 0' }}>{project.name}</h2>
                        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                            Submitted by <strong>{getUserDisplayName(project.requester, 'Unknown')}</strong> ({project.requester?.department}) on {new Date(project.createdAt).toLocaleDateString()}
                        </p>
                        {project.workflowStage && (
                            <span style={{
                                display: 'inline-block',
                                marginTop: '0.5rem',
                                padding: '0.25rem 0.75rem',
                                background: 'rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                fontSize: '0.8rem'
                            }}>
                                📋 Stage: {project.workflowStage}
                            </span>
                        )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{
                            fontSize: '1.5rem',
                            fontWeight: 'bold',
                            color: project.approvalStatus?.toLowerCase().includes('approved') ? '#4caf50' : project.approvalStatus?.toLowerCase().includes('rejected') ? '#f44336' : '#ffd54f'
                        }}>
                            {project.approvalStatus}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {project.priorityScore != null ? (
                                <>Priority Score: {project.priorityScore.toFixed(2)}/5.0 ({(project.priorityScore / 5 * 100).toFixed(0)}%)</>
                            ) : (
                                <>Score: {project.score}/100</>
                            )}
                        </div>
                        {project.analysisResult?.rulesAnalysis && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', opacity: 0.8, marginTop: '0.15rem' }}>
                                Rules: {project.analysisResult.rulesAnalysis.filter(r => r.status.toLowerCase() === 'pass').length}/{project.analysisResult.rulesAnalysis.length} passed
                            </div>
                        )}
                        {project.tier && (
                            <div style={{
                                fontSize: '0.85rem',
                                marginTop: '0.25rem',
                                color: project.tier === 3 ? '#f44336' : project.tier === 2 ? '#ff9800' : '#4caf50'
                            }}>
                                Tier {project.tier} {project.tier === 1 ? '(Low Risk)' : project.tier === 2 ? '(Moderate)' : '(High Risk)'}
                            </div>
                        )}
                        {project.needEnhancedOversight && (
                            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', color: '#ff9800' }}>
                                ⚠️ Enhanced oversight required (Priority Score 1.5–2.0)
                            </div>
                        )}
                    </div>
                </div>

                {/* Structured Initiative Details */}
                {project.formData ? (
                    <div style={{ marginTop: '1.5rem' }}>
                        {/* Submitter Info */}
                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '1rem' }}>
                            <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>📋 Submitter Information</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                <div><span style={{ color: 'var(--text-secondary)' }}>Name:</span> <strong>{project.formData.submitterName}</strong></div>
                                <div><span style={{ color: 'var(--text-secondary)' }}>Title:</span> {project.formData.submitterTitle}</div>
                                <div><span style={{ color: 'var(--text-secondary)' }}>Email:</span> {project.formData.submitterEmail}</div>
                                {project.formData.submitterPhone && <div><span style={{ color: 'var(--text-secondary)' }}>Phone:</span> {project.formData.submitterPhone}</div>}
                                <div><span style={{ color: 'var(--text-secondary)' }}>Group Head:</span> {project.formData.groupHeadName}</div>
                                {project.formData.heartSectorClassification && (
                                    <div><span style={{ color: 'var(--text-secondary)' }}>HEART Classification:</span> {(project.formData.heartSectorClassification as string).replace(/_/g, ' ')}</div>
                                )}
                            </div>
                        </div>

                        {/* Problem Statement */}
                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '1rem' }}>
                            <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>🔍 Problem Statement</h4>
                            <p style={{ margin: '0 0 0.75rem 0', whiteSpace: 'pre-wrap' }}>{project.formData.problemDescription}</p>
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
                                <div><span style={{ color: 'var(--text-secondary)' }}>Affected:</span> {project.formData.whoAffected?.replace(/_/g, ' ')}</div>
                            </div>
                            {project.formData.currentHandling && (
                                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Current Handling:</span>
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{project.formData.currentHandling}</p>
                                </div>
                            )}
                        </div>

                        {/* Proposed AI Solution */}
                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '1rem' }}>
                            <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>🤖 Proposed AI Solution</h4>
                            <div style={{ marginBottom: '0.75rem' }}>
                                <span style={{
                                    display: 'inline-block',
                                    padding: '0.3rem 0.75rem',
                                    background: 'rgba(214, 54, 55, 0.2)',
                                    border: '1px solid var(--sterling-red)',
                                    borderRadius: '6px',
                                    fontSize: '0.85rem'
                                }}>
                                    {project.formData.aiDirection?.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{project.formData.aiIdea}</p>
                        </div>

                        {/* Success Metrics */}
                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '1rem' }}>
                            <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>🎯 Success Metrics</h4>
                            {project.formData.improvements && project.formData.improvements.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                    {project.formData.improvements.map((imp, i) => (
                                        <span key={i} style={{
                                            padding: '0.25rem 0.6rem',
                                            background: 'rgba(76, 175, 80, 0.2)',
                                            borderRadius: '4px',
                                            fontSize: '0.85rem'
                                        }}>{imp}</span>
                                    ))}
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.9rem' }}>
                                {project.formData.timeSaved && <div>⏱️ Time saved: <strong>{project.formData.timeSaved}</strong></div>}
                                {project.formData.moneySaved && <div>💰 Money saved: <strong>{project.formData.moneySaved}</strong></div>}
                                {project.formData.customerBenefit && <div>😊 Customer benefit: {project.formData.customerBenefit}</div>}
                                {project.formData.errorReduction && <div>✅ Error reduction: {project.formData.errorReduction}</div>}
                                {project.formData.betterDecisions && <div>🧠 Better decisions: {project.formData.betterDecisions}</div>}
                            </div>
                            {project.formData.successMeasure && (
                                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Success Measure:</span>
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{project.formData.successMeasure}</p>
                                </div>
                            )}
                        </div>

                        {/* Data & Resources */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                            {/* Data Requirements */}
                            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>📊 Data Requirements</h4>
                                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>{project.formData.dataNeeded}</p>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    <div>Storage: {project.formData.dataStorage?.replace(/_/g, ' ')}</div>
                                    <div>Personal info: {project.formData.involvesPersonalInfo}</div>
                                </div>
                            </div>

                            {/* Resources & Timeline */}
                            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>⏰ Resources & Timeline</h4>
                                <div style={{ fontSize: '0.9rem' }}>
                                    <div style={{ marginBottom: '0.5rem' }}>
                                        <span style={{
                                            padding: '0.25rem 0.6rem',
                                            background: project.formData.urgency === 'urgent_3months' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255,255,255,0.1)',
                                            borderRadius: '4px',
                                            fontSize: '0.85rem'
                                        }}>
                                            {project.formData.urgency?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div>Budget: {project.formData.budgetAvailable} {project.formData.budgetAmount && `(${project.formData.budgetAmount})`}</div>
                                    <div>Team availability: {project.formData.teamTimeCommitment} {project.formData.teamHoursPerWeek && `(${project.formData.teamHoursPerWeek} hrs/week)`}</div>
                                </div>
                            </div>
                        </div>

                        {/* Additional Context */}
                        {(project.formData.previousAttempts || project.formData.regulations || project.formData.additionalContext) && (
                            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginTop: '1rem' }}>
                                <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--sterling-gold)' }}>📝 Additional Context</h4>
                                {project.formData.previousAttempts && (
                                    <div style={{ marginBottom: '0.75rem' }}>
                                        <strong style={{ fontSize: '0.85rem' }}>Previous Attempts:</strong>
                                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{project.formData.previousAttempts}</p>
                                    </div>
                                )}
                                {project.formData.regulations && (
                                    <div style={{ marginBottom: '0.75rem' }}>
                                        <strong style={{ fontSize: '0.85rem' }}>Regulations:</strong>
                                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{project.formData.regulations}</p>
                                    </div>
                                )}
                                {project.formData.additionalContext && (
                                    <div>
                                        <strong style={{ fontSize: '0.85rem' }}>Notes:</strong>
                                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{project.formData.additionalContext}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    /* Fallback for old projects without formData */
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0' }}>Description</h4>
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{project.description}</p>
                        {project.repoUrl && (
                            <div style={{ marginTop: '0.5rem' }}>
                                <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sterling-gold)' }}>View Repository →</a>
                            </div>
                        )}
                    </div>
                )}

                {project.overrideBy && (
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255, 193, 7, 0.1)', border: '1px solid #ffc107', borderRadius: '8px' }}>
                        <strong>⚠️ Overridden by Admin</strong>
                        <p style={{ margin: '0.5rem 0 0 0' }}>Reason: {project.overrideReason}</p>
                    </div>
                )}
            </div>

            <div className="glass-panel">
                <h3 style={{ marginBottom: '1.5rem' }}>Analysis Results</h3>

                {/* Priority Scoring Breakdown */}
                {(project.scoringBreakdown || project.analysisResult?.scoringBreakdown) && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--sterling-gold)' }}>📊 Priority Score Breakdown</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                            {Object.entries(project.scoringBreakdown || project.analysisResult?.scoringBreakdown || {}).map(([key, val]: [string, any]) => (
                                <div key={key} style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {key.replace(/([A-Z])/g, ' $1').trim()}
                                        </span>
                                        <strong style={{ color: val?.score >= 4 ? '#4caf50' : val?.score >= 3 ? '#ff9800' : '#f44336' }}>
                                            {val?.score}/5
                                        </strong>
                                    </div>
                                    {val?.reason && <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{val.reason}</div>}
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div><strong>Priority Score:</strong> {project.priorityScore?.toFixed(2) || 'N/A'}</div>
                            <div><strong>Calculated Tier:</strong> Tier {project.tier}</div>
                        </div>
                    </div>
                )}

                {/* Rule Analysis */}
                <div style={{ display: 'grid', gap: '1rem' }}>
                    {project.analysisResult?.rulesAnalysis?.map((rule, index) => (
                        <div key={index} style={{
                            padding: '1rem',
                            background: rule.status.toLowerCase() === 'pass' ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                            borderLeft: `4px solid ${rule.status.toLowerCase() === 'pass' ? '#4caf50' : '#f44336'}`,
                            borderRadius: '4px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <strong>{rule.ruleName}</strong>
                                <span style={{
                                    fontWeight: 'bold',
                                    color: rule.status.toLowerCase() === 'pass' ? '#4caf50' : '#f44336'
                                }}>
                                    {rule.status.toUpperCase()}
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>{rule.reason}</p>
                        </div>
                    ))}
                </div>

                {project.analysisResult?.summary && (
                    <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                        <h4>AI Summary</h4>
                        <p>{project.analysisResult.summary}</p>
                    </div>
                )}
            </div>

            {/* Approval History */}
            {project.approvalHistory && project.approvalHistory.length > 0 && (
                <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem' }}>📜 Approval History</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {project.approvalHistory.map((item, idx) => (
                            <div key={idx} style={{
                                padding: '0.75rem 1rem',
                                background: item.action === 'Approved' ? 'rgba(76, 175, 80, 0.1)' :
                                    item.action === 'Escalated' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                                borderLeft: `4px solid ${item.action === 'Approved' ? '#4caf50' : item.action === 'Escalated' ? '#ffc107' : '#f44336'}`,
                                borderRadius: '4px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <strong>{item.stage} Review:</strong>{' '}
                                        <span style={{
                                            color: item.action === 'Approved' ? '#4caf50' : item.action === 'Escalated' ? '#ffc107' : '#f44336',
                                            fontWeight: 600
                                        }}>
                                            {item.action}
                                        </span>
                                        {item.by && <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>by {typeof item.by === 'object' ? getUserDisplayName(item.by, 'System') : 'System'}</span>}
                                    </div>
                                    <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                                        {new Date(item.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                {item.reason && <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.8 }}>{item.reason}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* CoE Review Panel */}
            {project.approvalStatus === 'Pending Center of Excellence' && canCoEReview && (
                <div className="glass-panel" style={{ marginTop: '1.5rem', border: '2px solid #2196f3' }}>
                    <h3 style={{ marginTop: 0, color: '#2196f3' }}>🏢 Center of Excellence Review Required</h3>
                    <p style={{ opacity: 0.8 }}>This initiative requires Center of Excellence review before proceeding.</p>
                    <textarea
                        placeholder="Review notes (optional)"
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        style={{ width: '100%', minHeight: '80px', marginBottom: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '6px', color: 'white' }}
                    />
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            className="btn-primary"
                            onClick={() => handleCoEReview('Approved')}
                            disabled={reviewLoading}
                            style={{ background: '#4caf50', flex: 1 }}
                        >
                            ✅ Approve
                        </button>
                        <button
                            onClick={() => handleCoEReview('Rejected')}
                            disabled={reviewLoading}
                            style={{ background: '#f44336', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', cursor: 'pointer', flex: 1 }}
                        >
                            ❌ Reject
                        </button>
                    </div>
                </div>
            )}

            {/* Governance Review Panel */}
            {project.approvalStatus === 'Pending Governance' && canGovernanceReview && (
                <div className="glass-panel" style={{ marginTop: '1.5rem', border: '2px solid #ff9800' }}>
                    <h3 style={{ marginTop: 0, color: '#ff9800' }}>⚖️ Governance Committee Review Required</h3>
                    <p style={{ opacity: 0.8 }}>This Tier {project.tier} initiative requires Governance Committee review before proceeding.</p>
                    <textarea
                        placeholder="Review notes (optional)"
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        style={{ width: '100%', minHeight: '80px', marginBottom: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '6px', color: 'white' }}
                    />
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            className="btn-primary"
                            onClick={() => handleGovernanceReview('Approved')}
                            disabled={reviewLoading}
                            style={{ background: '#4caf50', flex: 1 }}
                        >
                            ✅ Approve
                        </button>
                        <button
                            onClick={() => handleGovernanceReview('Rejected')}
                            disabled={reviewLoading}
                            style={{ background: '#f44336', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', cursor: 'pointer', flex: 1 }}
                        >
                            ❌ Reject
                        </button>
                    </div>
                    {project.tier === 3 && (
                        <p style={{ marginTop: '1rem', fontSize: '0.85rem', opacity: 0.7 }}>
                            Note: Tier 3 initiatives will proceed to Executive Review after Governance review.
                        </p>
                    )}
                </div>
            )}

            {/* Executive Review Panel */}
            {project.approvalStatus === 'Pending Executive' && canExecutiveReview && (
                <div className="glass-panel" style={{ marginTop: '1.5rem', border: '2px solid var(--sterling-red)' }}>
                    <h3 style={{ marginTop: 0, color: 'var(--sterling-red)' }}>👔 Executive Review Required</h3>
                    <p style={{ opacity: 0.8 }}>This Tier 3 initiative requires Executive approval for final decision.</p>
                    <textarea
                        placeholder="Executive review notes (optional)"
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        style={{ width: '100%', minHeight: '80px', marginBottom: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '6px', color: 'white' }}
                    />
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            className="btn-primary"
                            onClick={() => handleExecutiveReview('Approved')}
                            disabled={reviewLoading}
                            style={{ background: '#4caf50', flex: 1 }}
                        >
                            ✅ Executive Approve
                        </button>
                        <button
                            onClick={() => handleExecutiveReview('Rejected')}
                            disabled={reviewLoading}
                            style={{ background: '#f44336', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', cursor: 'pointer', flex: 1 }}
                        >
                            ❌ Executive Reject
                        </button>
                    </div>
                </div>
            )}

            {canOverride && (
                <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                    <button
                        className="btn-primary"
                        onClick={() => setShowOverride(!showOverride)}
                        style={{ background: 'var(--sterling-gold)', color: '#000' }}
                    >
                        {showOverride ? 'Cancel Review' : 'Admin Actions'}
                    </button>

                    {showOverride && (
                        <div className="glass-panel" style={{ marginTop: '1rem', textAlign: 'left', border: '1px solid var(--sterling-gold)' }}>
                            <h3>Override Project Status</h3>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ marginRight: '1rem' }}>
                                    <input
                                        type="radio"
                                        name="action"
                                        checked={overrideAction === 'Approved'}
                                        onChange={() => setOverrideAction('Approved')}
                                    /> Approve
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        name="action"
                                        checked={overrideAction === 'Rejected'}
                                        onChange={() => setOverrideAction('Rejected')}
                                    /> Reject
                                </label>
                            </div>
                            <textarea
                                placeholder="Reason for override (required)"
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                                style={{ width: '100%', minHeight: '80px', marginBottom: '1rem', padding: '0.5rem' }}
                            />
                            <button className="btn-primary" onClick={handleOverride}>Confirm Override</button>
                        </div>
                    )}
                </div>
            )}

            {activeOrganization?.isAdmin && (
                <div style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', textAlign: 'right' }}>
                    <button
                        onClick={async () => {
                            if (window.confirm('Are you sure you want to delete this project permanently?')) {
                                try {
                                    await api.delete(`/projects/${id}`);
                                    navigate('/');
                                } catch (e) {
                                    console.error(e);
                                    alert('Failed to delete project');
                                }
                            }
                        }}
                        style={{
                            background: 'none',
                            border: '1px solid #f44336',
                            color: '#f44336',
                            padding: '0.5rem 1rem',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        🗑️ Delete Project
                    </button>
                </div>
            )}
        </div>
    );
};

export default ProjectDetail;
