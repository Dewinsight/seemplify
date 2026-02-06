import React, { useState, useEffect } from 'react';
import api from '../api';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import InitiativeIntake from '../components/InitiativeIntake';

const Analyze: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { activeDepartment } = useAuth();

    const [activeTab, setActiveTab] = useState<'view' | 'new'>('view');
    const [projects, setProjects] = useState<any[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    // Calculate Priority Score
    const calculatePriority = (project: any) => {
        // Weighted logic: (Score * 0.4) + (Tier * 20 * 0.3) + (Urgency * 0.3)
        // This is a simplified example logic
        let urgencyScore = 0;
        if (project.formData?.urgency === 'urgent_3months') urgencyScore = 100;
        else if (project.formData?.urgency === 'important_6months') urgencyScore = 70;
        else if (project.formData?.urgency === 'can_wait_1year') urgencyScore = 40;
        else urgencyScore = 20;

        const tierScore = (project.tier || 3) === 1 ? 100 : (project.tier || 3) === 2 ? 60 : 30;
        const baseScore = project.score || 0;

        // Formula: Score (40%) + Urgency (30%) + Tier Impact (30%)
        // Result is 0-100, mapped to 1-5 stars if needed, or just 1-5 number
        const weighted = (baseScore * 0.4) + (urgencyScore * 0.3) + (tierScore * 0.3);
        // Normalize to 1-5
        return (weighted / 20).toFixed(1);
    };

    // Enhanced Sort Handler
    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Helper to render sort arrow
    const renderSortArrow = (columnKey: string) => {
        const isActive = sortConfig?.key === columnKey;
        const isAsc = sortConfig?.direction === 'asc';

        return (
            <span className={`sort-icon ${isActive ? 'active' : ''}`} style={{ opacity: isActive ? 1 : 0.3 }}>
                {isActive ? (isAsc ? '↑' : '↓') : '↕'}
            </span>
        );
    };

    const sortedProjects = React.useMemo(() => {
        // Enhance projects with priority score for sorting
        let enhanced = projects.map(p => ({
            ...p,
            priorityScore: parseFloat(calculatePriority(p))
        }));

        let sortableItems = [...enhanced];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Handle nested keys
                if (sortConfig.key === 'requester') {
                    aValue = a.requester?.username || '';
                    bValue = b.requester?.username || '';
                }
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
    }, [projects, sortConfig]);

    const handleDownload = () => {
        const headers = ['Project Name', 'Requester', 'Department', 'Status', 'Score', 'Priority Score', 'Tier', 'Date'];
        const csvContent = [
            headers.join(','),
            ...sortedProjects.map(p => [
                `"${p.name}"`,
                `"${p.requester?.username || 'Unknown'}"`,
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

    // Filter projects based on search query
    const filteredProjects = sortedProjects.filter(p =>
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

    return (
        <div style={{ maxWidth: '100%', margin: '0 auto' }}>
            <div className="mobile-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.8rem' }}>AI Initiative Intake</h2>

                {/* Tabs */}
                <div className="mobile-stack" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {activeTab === 'view' && (
                        <button onClick={handleDownload} style={{
                            background: 'var(--sterling-dark)', color: 'white', border: '1px solid var(--glass-border)',
                            padding: '0.6rem 1.2rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600,
                            whiteSpace: 'nowrap'
                        }}>
                            Download CSV
                        </button>
                    )}
                    <div className="mobile-stack" style={{ display: 'flex', background: 'var(--glass-border)', borderRadius: '8px', padding: '4px' }}>
                        <button
                            onClick={() => setActiveTab('view')}
                            style={{
                                background: activeTab === 'view' ? 'var(--brand-primary)' : 'transparent',
                                color: activeTab === 'view' ? 'white' : 'var(--text-primary)',
                                border: 'none', padding: '0.6rem 1.2rem',
                                borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
                                flex: 1
                            }}
                        >
                            View All Initiatives
                        </button>
                        <button
                            onClick={() => setActiveTab('new')}
                            style={{
                                background: activeTab === 'new' ? 'var(--brand-primary)' : 'transparent',
                                color: activeTab === 'new' ? 'white' : 'var(--text-primary)',
                                border: 'none', padding: '0.6rem 1.2rem',
                                borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
                                flex: 1
                            }}
                        >
                            + New Initiative
                        </button>
                    </div>
                </div>
            </div>

            {activeTab === 'view' ? (
                <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Search Bar */}
                    <div className="mobile-stack" style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                        <input
                            type="text"
                            placeholder="🔍 Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                flex: 1,
                                width: '100%',
                                minWidth: '200px',
                                padding: '0.6rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid var(--glass-border)',
                                background: 'var(--glass-border)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem'
                            }}
                        />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                            {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''} found
                        </span>
                    </div>

                    <div className="table-scroll-container">
                        <table className="data-table table-min-width">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('name')} className={sortConfig?.key === 'name' ? 'sort-active' : ''}>
                                        Project Name {renderSortArrow('name')}
                                    </th>
                                    <th onClick={() => handleSort('requester')} className={sortConfig?.key === 'requester' ? 'sort-active' : ''}>
                                        Requester {renderSortArrow('requester')}
                                    </th>
                                    <th onClick={() => handleSort('department')} className={sortConfig?.key === 'department' ? 'sort-active' : ''}>
                                        Department {renderSortArrow('department')}
                                    </th>
                                    <th onClick={() => handleSort('createdAt')} className={sortConfig?.key === 'createdAt' ? 'sort-active' : ''}>
                                        Date {renderSortArrow('createdAt')}
                                    </th>
                                    <th style={{ textAlign: 'center' }} onClick={() => handleSort('score')} className={sortConfig?.key === 'score' ? 'sort-active' : ''}>
                                        AI Score {renderSortArrow('score')}
                                    </th>
                                    <th style={{ textAlign: 'center' }} onClick={() => handleSort('priorityScore')} className={sortConfig?.key === 'priorityScore' ? 'sort-active' : ''}>
                                        Priority {renderSortArrow('priorityScore')}
                                    </th>
                                    <th style={{ textAlign: 'center' }} onClick={() => handleSort('approvalStatus')} className={sortConfig?.key === 'approvalStatus' ? 'sort-active' : ''}>
                                        Status {renderSortArrow('approvalStatus')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedProjects.map(p => {
                                    // Determine status class
                                    const statusClass = p.approvalStatus?.toLowerCase().includes('approved') || p.approvalStatus === 'AI Approved' ? 'status-approved' :
                                        p.approvalStatus?.toLowerCase().includes('rejected') || p.approvalStatus === 'AI Rejected' ? 'status-rejected' : 'status-pending';

                                    return (
                                        <tr
                                            key={p._id}
                                            onClick={() => navigate(`/projects/${p._id}`)}
                                            style={{ cursor: 'pointer' }}
                                            title="Click to view details"
                                        >
                                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>
                                                {p.requester?.username || 'Unknown'}
                                            </td>
                                            <td style={{ color: 'var(--text-secondary)' }}>
                                                {p.department?.name || 'General'}
                                            </td>
                                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                                            <td style={{ textAlign: 'center' }}>
                                                <div style={{
                                                    display: 'inline-block',
                                                    width: '40px',
                                                    height: '40px',
                                                    borderRadius: '50%',
                                                    lineHeight: '40px',
                                                    background: p.score >= 80 ? 'rgba(76, 175, 80, 0.1)' : p.score >= 50 ? 'rgba(255, 152, 0, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                                                    color: p.score >= 80 ? '#2e7d32' : p.score >= 50 ? '#ef6c00' : '#c62828',
                                                    fontWeight: 'bold',
                                                    fontSize: '0.9rem'
                                                }}>
                                                    {p.score}
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {p.priorityScore ? (
                                                    <span className="priority-score" style={{ color: p.priorityScore > 3.5 ? '#f44336' : p.priorityScore > 2.5 ? '#ff9800' : '#4caf50' }}>
                                                        {p.priorityScore}
                                                    </span>
                                                ) : <span style={{ opacity: 0.5 }}>-</span>}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span className={`status-badge ${statusClass}`}>
                                                    {statusClass === 'status-approved' && '✅'}
                                                    {statusClass === 'status-rejected' && '❌'}
                                                    {statusClass === 'status-pending' && '⏳'}
                                                    {p.approvalStatus}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {paginatedProjects.length === 0 && !loadingProjects && (
                                    <tr><td colSpan={7} style={{ padding: '3rem', textAlign: 'center', opacity: 0.6, fontStyle: 'italic' }}>
                                        {searchQuery ? 'No projects match your search.' : 'No projects found. Start a new initiative!'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

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
                <InitiativeIntake
                    activeDepartment={activeDepartment}
                    onCancel={() => setActiveTab('view')}
                />
            )}
        </div>
    );
};

export default Analyze;
