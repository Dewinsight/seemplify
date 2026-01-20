import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface RuleAnalysis {
    ruleName: string;
    status: string;
    reason: string;
}

interface Project {
    _id: string;
    name: string;
    description: string;
    repoUrl: string;
    approvalStatus: string;
    status: string;
    score: number;
    analysisResult: {
        overallStatus: string;
        rulesAnalysis: RuleAnalysis[];
        summary: string;
    };
    requester: {
        username: string;
        department: string;
    };
    overrideBy?: string;
    overrideReason?: string;
    createdAt: string;
}

const ProjectDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [showOverride, setShowOverride] = useState(false);
    const [overrideReason, setOverrideReason] = useState('');
    const [overrideAction, setOverrideAction] = useState<'Approved' | 'Rejected'>('Approved');

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

    if (loading) return <div className="glass-panel">Loading...</div>;
    if (!project) return <div className="glass-panel">Project not found</div>;

    const canOverride = (user?.isAdmin || user?.role === 'Admin' || user?.role === 'Approver');

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h2 style={{ margin: '0 0 0.5rem 0' }}>{project.name}</h2>
                        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                            Submitted by <strong>{project.requester?.username}</strong> ({project.requester?.department}) on {new Date(project.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{
                            fontSize: '1.5rem',
                            fontWeight: 'bold',
                            color: project.approvalStatus === 'Approved' ? '#4caf50' : '#f44336'
                        }}>
                            {project.approvalStatus}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Score: {project.score}/100
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0' }}>Description</h4>
                    <p style={{ margin: 0 }}>{project.description}</p>
                    {project.repoUrl && (
                        <div style={{ marginTop: '0.5rem' }}>
                            <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sterling-gold)' }}>View Repository →</a>
                        </div>
                    )}
                </div>

                {project.overrideBy && (
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255, 193, 7, 0.1)', border: '1px solid #ffc107', borderRadius: '8px' }}>
                        <strong>⚠️ Overridden by Admin</strong>
                        <p style={{ margin: '0.5rem 0 0 0' }}>Reason: {project.overrideReason}</p>
                    </div>
                )}
            </div>

            <div className="glass-panel">
                <h3 style={{ marginBottom: '1.5rem' }}>Analysis Results</h3>
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

            {(user?.isAdmin || user?.role === 'Admin') && (
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
