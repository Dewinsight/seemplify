import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const sampleProject = {
    name: 'Customer Portal Modernization',
    description: `Project Overview:\nWe are proposing to modernize our legacy customer portal from a monolithic PHP application to a modern microservices architecture.\n\nTechnical Stack:\n- Frontend: React 18 with TypeScript\n- Backend: Node.js with Express\n- Database: PostgreSQL (migrating from MySQL)\n- Cloud: AWS (ECS, RDS, S3)\n- Authentication: OAuth 2.0 with Cognito\n\nBudget: $250,000\nTimeline: 6 months\nTeam Size: 5 developers + 1 DevOps\n\nKey Features:\n1. Real-time dashboard with customer analytics\n2. Self-service account management\n3. Document upload and processing\n4. Integration with existing CRM (Salesforce)\n5. Mobile-responsive design\n\nSecurity Considerations:\n- All data encrypted at rest and in transit\n- Role-based access control (RBAC)\n- SOC 2 compliance required\n- Regular penetration testing\n\nRisk Assessment:\n- Data migration complexity: Medium\n- Third-party integration risks: Low\n- Timeline risk: Medium (aggressive deadline)`,
    repoUrl: 'https://github.com/sterling-bank/customer-portal-v2'
};

const Analyze: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { activeDepartment, user } = useAuth();

    const [activeTab, setActiveTab] = useState<'view' | 'new'>('view');
    const [projects, setProjects] = useState<any[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);

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

    // Form State
    const [form, setForm] = useState({ name: '', description: '', repoUrl: '' });
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState('');

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
        setForm(sampleProject);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAnalyzing(true);
        setError('');
        try {
            const payload = { ...form, department: activeDepartment?._id };
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
                <h2 style={{ margin: 0 }}>Project Analysis</h2>

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
                        View All Analysis
                    </button>
                    <button
                        onClick={() => setActiveTab('new')}
                        style={{
                            background: activeTab === 'new' ? 'var(--sterling-red)' : 'transparent',
                            color: 'white', border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        + New Analysis
                    </button>
                </div>
            </div>

            {activeTab === 'view' ? (
                <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
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
                            {projects.map(p => (
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
                            {projects.length === 0 && !loadingProjects && (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>No projects found.</td></tr>
                            )}
                        </tbody>
                    </table>
                    {loadingProjects && <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>}
                </div>
            ) : (
                <div className="glass-panel" style={{ maxWidth: '700px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                            Submit a project for automated AI approval based on your defined rules.
                        </p>
                        <button type="button" onClick={fillSample} style={{ background: 'var(--sterling-gold)', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            📝 Fill Sample
                        </button>
                    </div>
                    <form onSubmit={handleSubmit}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Name</label>
                        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g., Customer Portal Modernization" />

                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Repository URL (Optional)</label>
                        <input type="text" value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="e.g., https://github.com/org/project" />

                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Description / Context</label>
                        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required rows={12} placeholder="Include: project overview, tech stack, budget, timeline..." />

                        {error && (
                            <div style={{ background: 'rgba(244, 67, 54, 0.1)', border: '1px solid #f44336', borderRadius: '8px', padding: '1rem', marginTop: '1rem', color: '#f44336' }}>
                                ⚠️ {error}
                            </div>
                        )}

                        <button type="submit" className="btn-primary" disabled={analyzing} style={{ width: '100%', marginTop: '1rem' }}>
                            {analyzing ? 'AI Analyzing Project...' : 'Start Analysis'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Analyze;
