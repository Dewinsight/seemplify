import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getUserDisplayName } from '../utils/userDisplay';

const Dashboard: React.FC = () => {
    const { user, activeDepartment, activeOrganization } = useAuth();
    const [stats, setStats] = useState<any>(null);
    const [recentProjects, setRecentProjects] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [sortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const displayName = getUserDisplayName(user, 'there');

    useEffect(() => {
        fetchData();
    }, [activeDepartment]);

    const sortedProjects = React.useMemo(() => {
        let sortableItems = [...recentProjects];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Handle nested keys like department.name
                if (sortConfig.key === 'department') {
                    aValue = a.department?.name || '';
                    bValue = b.department?.name || '';
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [recentProjects, sortConfig]);

    const handleDownload = () => {
        const headers = ['Project Name', 'Department', 'Status', 'Score', 'Priority Score', 'Tier', 'Date'];
        const csvContent = [
            headers.join(','),
            ...sortedProjects.map(p => [
                `"${p.name}"`,
                `"${p.department?.name || 'General'}"`,
                `"${p.approvalStatus}"`,
                p.score,
                p.priorityScore || 'N/A',
                p.tier || 'N/A',
                `"${new Date(p.createdAt).toLocaleDateString()}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'initiatives_export.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const params = activeDepartment ? { department: activeDepartment._id } : {};

            // Determine effective role for this context
            let showStats = false;

            const hasApproverRole = (perm: any) => {
                const roles = perm?.roles || (perm?.role ? [perm.role] : []);
                return roles.some((r: string) => ['GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'].includes(r));
            };

            const orgPerms = activeOrganization?.permissions || [];

            if (activeOrganization?.isAdmin) showStats = true;
            else if (activeDepartment) {
                const deptPerms = orgPerms.find((p: any) =>
                    (typeof p.department === 'object' ? p.department._id : p.department) === activeDepartment._id
                );
                if (hasApproverRole(deptPerms)) showStats = true;
            } else {
                // No active dept (Global view?) - show if they have ANY approver role
                if (orgPerms.some((p: any) => hasApproverRole(p))) showStats = true;
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

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 6) return 'Burning the midnight oil';
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        if (hour < 21) return 'Good evening';
        return 'Working late';
    };

    const getSubtitle = () => {
        if (!stats && recentProjects.length === 0) {
            return "Welcome to Mosaic! Submit your first initiative to get started.";
        }
        const parts: string[] = [];
        if (stats) {
            if (stats.pending > 0) {
                parts.push(`${stats.pending} initiative${stats.pending === 1 ? '' : 's'} awaiting review`);
            }
            if (stats.approved > 0 && stats.total > 0) {
                const rate = Math.round((stats.approved / stats.total) * 100);
                parts.push(`${rate}% approval rate`);
            }
        }
        if (recentProjects.length > 0) {
            const today = new Date().toDateString();
            const todayCount = recentProjects.filter(p => new Date(p.createdAt).toDateString() === today).length;
            if (todayCount > 0) {
                parts.push(`${todayCount} new today`);
            }
        }
        if (parts.length > 0) return parts.join(' · ');
        return `${recentProjects.length} initiative${recentProjects.length === 1 ? '' : 's'} across your portfolio.`;
    };

    return (
        <div>
            <div className="page-header">
                <div style={{ width: '100%' }}>
                    <h1 className="dashboard-greeting" style={{
                        margin: 0,
                        fontSize: '2rem',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                    }}>
                        {getGreeting()}, {displayName}
                    </h1>
                    <p className="dashboard-subtitle" style={{
                        color: 'var(--text-secondary)',
                        margin: '0.5rem 0 0 0',
                        fontSize: '1rem',
                    }}>
                        {getSubtitle()}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
                    <button onClick={handleDownload} className="btn-primary" style={{ textDecoration: 'none', background: 'var(--sterling-dark)', border: '1px solid var(--glass-border)' }}>Download CSV</button>
                    <Link to="/analyze" className="btn-primary" style={{ textDecoration: 'none' }}>+ New Initiative</Link>
                </div>
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
                <div className="glass-panel" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0 }}>Recent Initiatives</h3>
                        <Link to="/analyze?tab=view" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>View All →</Link>
                    </div>
                    {recentProjects.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)' }}>No projects found. Start a new initiative!</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {sortedProjects.slice(0, 5).map(p => (
                                <div
                                    key={p._id}
                                    onClick={() => window.location.href = `/projects/${p._id}`}
                                    className="glass-card"
                                    style={{
                                        cursor: 'pointer',
                                        padding: '1rem 1.25rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '0.75rem',
                                        transition: 'transform 0.2s, box-shadow 0.2s'
                                    }}
                                >
                                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {p.name}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {p.department?.name || 'General'} • {new Date(p.createdAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '20px',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            background: p.approvalStatus === 'Approved' ? 'rgba(76, 175, 80, 0.2)' :
                                                p.approvalStatus === 'Rejected' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 193, 7, 0.2)',
                                            color: p.approvalStatus === 'Approved' ? '#81c784' :
                                                p.approvalStatus === 'Rejected' ? '#e57373' : '#ffd54f'
                                        }}>
                                            {p.approvalStatus}
                                        </span>
                                        <span style={{ fontWeight: 600, color: 'var(--sterling-gold)' }}>
                                            {p.priorityScore != null ? `${Number(p.priorityScore).toFixed(1)}/5` : `${p.score || 0}/100`}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={{ height: 'fit-content', overflow: 'hidden' }}>
                    <h3 style={{ marginBottom: '1rem' }}>🚀 Getting Started</h3>
                    <div style={{ fontSize: '0.9rem', lineHeight: '1.8' }}>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                            <span style={{
                                background: 'var(--sterling-gold)',
                                color: '#000',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.8rem',
                                flexShrink: 0
                            }}>1</span>
                            <div>
                                <strong>Submit an Initiative</strong>
                                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>Click "+ New Initiative" to describe your project idea.</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                            <span style={{
                                background: 'var(--sterling-gold)',
                                color: '#000',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.8rem',
                                flexShrink: 0
                            }}>2</span>
                            <div>
                                <strong>AI Analysis</strong>
                                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>Mosaic AI evaluates your initiative against company policies.</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                            <span style={{
                                background: 'var(--sterling-gold)',
                                color: '#000',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.8rem',
                                flexShrink: 0
                            }}>3</span>
                            <div>
                                <strong>Track Progress</strong>
                                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>Monitor approvals in the Initiatives page.</p>
                            </div>
                        </div>
                        <hr style={{ borderColor: 'var(--glass-border)', margin: '1rem 0' }} />
                        <Link to="/analyze" style={{ color: 'var(--sterling-gold)', fontWeight: 600, textDecoration: 'none' }}>
                            Start your first initiative →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
