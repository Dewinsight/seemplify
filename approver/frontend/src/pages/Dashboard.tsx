import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const Dashboard: React.FC = () => {
    const { user, activeDepartment } = useAuth();
    const [stats, setStats] = useState<any>(null);
    const [recentProjects, setRecentProjects] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [activeDepartment]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const params = activeDepartment ? { department: activeDepartment._id } : {};

            // Determine effective role for this context
            let showStats = false;

            const hasApproverRole = (perms: any) => {
                const roles = perms?.roles || (perms?.role ? [perms.role] : []);
                return roles.some((r: string) => ['GovernanceApprover', 'ExecutiveApprover', 'Approver'].includes(r));
            };

            if (user?.isAdmin) showStats = true;
            else if (activeDepartment) {
                const deptPerms = user?.permissions?.find(p =>
                    (typeof p.department === 'object' ? p.department._id : p.department) === activeDepartment._id
                );
                if (hasApproverRole(deptPerms)) showStats = true;
            } else {
                // No active dept (Global view?) - show if they have ANY approver role
                if (user?.permissions?.some(p => hasApproverRole(p))) showStats = true;
            }

            if (showStats) {
                const statsRes = await api.get('/dashboard/stats', { params });
                setStats(statsRes.data);
            } else {
                setStats(null);
            }

            const projectsRes = await api.get('/projects', { params });
            setRecentProjects(projectsRes.data);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            setLoading(false);
        }
    };

    if (loading) return <div className="glass-panel">Loading dashboard...</div>;

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 style={{ margin: 0, fontSize: '2rem' }}>Welcome, {user?.username}</h1>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.5rem 0 0 0' }}>Here is what's happening today.</p>
                </div>
                <Link to="/analyze" className="btn-primary" style={{ textDecoration: 'none' }}>+ New Initiative</Link>
            </div>

            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
                    <div className="glass-card" style={{ textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: 'var(--sterling-red)' }}>{stats.total}</h3>
                        <span style={{ color: 'var(--text-secondary)' }}>Total Projects</span>
                    </div>
                    <div className="glass-card" style={{ textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: '#4caf50' }}>{stats.approved}</h3>
                        <span style={{ color: 'var(--text-secondary)' }}>Approved</span>
                    </div>
                    <div className="glass-card" style={{ textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: '#ff9800' }}>{stats.pending}</h3>
                        <span style={{ color: 'var(--text-secondary)' }}>Pending / Review</span>
                    </div>
                    <div className="glass-card" style={{ textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', color: 'var(--sterling-gold)' }}>{stats.avgScore || 0}%</h3>
                        <span style={{ color: 'var(--text-secondary)' }}>Avg Score</span>
                    </div>
                </div>
            )}

            <div className="dashboard-grid">
                <div className="glass-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0 }}>Recent Initiatives</h3>
                        <Link to="/analyze?tab=view" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>View All →</Link>
                    </div>
                    {recentProjects.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)' }}>No projects found. Start a new initiative!</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                                        <th style={{ textAlign: 'left', padding: '1rem 0.5rem' }}>Project Name</th>
                                        <th style={{ textAlign: 'left', padding: '1rem 0.5rem' }}>Department</th>
                                        <th style={{ textAlign: 'left', padding: '1rem 0.5rem' }}>Status</th>
                                        <th style={{ textAlign: 'left', padding: '1rem 0.5rem' }}>Score</th>
                                        <th style={{ textAlign: 'left', padding: '1rem 0.5rem' }}>Date</th>
                                        <th style={{ textAlign: 'right', padding: '1rem 0.5rem' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentProjects.map(p => (
                                        <tr key={p._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '1rem 0.5rem', fontWeight: 'bold' }}>{p.name}</td>
                                            <td style={{ padding: '1rem 0.5rem', color: 'var(--text-secondary)' }}>{p.department?.name || 'General'}</td>
                                            <td style={{ padding: '1rem 0.5rem' }}>
                                                <span style={{
                                                    padding: '0.25rem 0.75rem',
                                                    borderRadius: '20px',
                                                    fontSize: '0.85rem',
                                                    background: p.approvalStatus === 'Approved' ? 'rgba(76, 175, 80, 0.2)' :
                                                        p.approvalStatus === 'Rejected' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 193, 7, 0.2)',
                                                    color: p.approvalStatus === 'Approved' ? '#81c784' :
                                                        p.approvalStatus === 'Rejected' ? '#e57373' : '#ffd54f'
                                                }}>
                                                    {p.approvalStatus}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem 0.5rem' }}>{p.score || 0}/100</td>
                                            <td style={{ padding: '1rem 0.5rem', color: 'var(--text-secondary)' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                                            <td style={{ padding: '1rem 0.5rem', textAlign: 'right' }}>
                                                <Link to={`/projects/${p._id}`} style={{ color: 'var(--sterling-gold)', textDecoration: 'none' }}>View →</Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={{ height: 'fit-content' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Reviewer Guide</h3>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                        <p>💡 <strong>Budget Rules:</strong> Projects over $500k require explicit executive sponsorship.</p>
                        <p>🔒 <strong>Security:</strong> All customer-facing apps must pass SOC2 criteria.</p>
                        <p>⚙️ <strong>Tech Stack:</strong> Stick to the approved list (React, Node, Py, Java) to ensure maintainability.</p>
                        <hr style={{ borderColor: 'var(--glass-border)', margin: '1.5rem 0' }} />
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                            <strong>Need to Override?</strong>
                            <p style={{ margin: '0.5rem 0 0 0' }}>Admins can manually approve rejected projects if a valid business justification is provided in the audit log.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
