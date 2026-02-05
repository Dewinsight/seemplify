import React, { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

// --- Interfaces ---
interface Department {
    _id: string;
    name: string;
    description: string;
    manager?: { username: string };
}
interface Permission {
    department: { _id: string, name: string } | string;
    roles: string[]; // Now an array of roles
    role?: string; // Keep for backward compatibility
}
interface User {
    _id: string;
    username: string;
    email: string;
    isAdmin: boolean;
    permissions: Permission[];
    isVerified: boolean;
}

// Available roles (excluding old 'Approver')
const AVAILABLE_ROLES = ['Requester', 'GovernanceApprover', 'ExecutiveApprover'] as const;

const AdminUsers: React.FC = () => {
    const { user: currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState<'users' | 'departments'>('users');

    // Users State
    const [users, setUsers] = useState<User[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]); // Shared resource
    const [loading, setLoading] = useState(true);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editIsAdmin, setEditIsAdmin] = useState(false);
    // Changed to store array of roles per department
    const [editPermissions, setEditPermissions] = useState<Record<string, string[]>>({});

    // Departments State
    const [deptForm, setDeptForm] = useState({ name: '', description: '' });
    const [deptLoading, setDeptLoading] = useState(false);
    const [deptPage, setDeptPage] = useState(0);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersRes, deptsRes] = await Promise.all([
                api.get('/users'),
                api.get('/departments')
            ]);
            setUsers(usersRes.data);
            setDepartments(deptsRes.data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // --- User Logic ---
    const handleEditClick = (user: User) => {
        setEditingUser(user);
        setEditIsAdmin(user.isAdmin || false);
        const permMap: Record<string, string[]> = {};
        user.permissions.forEach(p => {
            const deptId = typeof p.department === 'string' ? p.department : p.department._id;
            // Handle both old format (role) and new format (roles array)
            permMap[deptId] = p.roles || (p.role ? [p.role] : []);
        });
        setEditPermissions(permMap);
    };

    const handleRoleToggle = (deptId: string, role: string) => {
        setEditPermissions(prev => {
            const currentRoles = prev[deptId] || [];
            const hasRole = currentRoles.includes(role);

            let newRoles: string[];
            if (hasRole) {
                newRoles = currentRoles.filter(r => r !== role);
            } else {
                newRoles = [...currentRoles, role];
            }

            const next = { ...prev };
            if (newRoles.length === 0) {
                delete next[deptId];
            } else {
                next[deptId] = newRoles;
            }
            return next;
        });
    };

    const savePermissions = async () => {
        if (!editingUser) return;
        const permissions = Object.entries(editPermissions).map(([deptId, roles]) => ({
            department: deptId,
            roles: roles
        }));
        try {
            await api.patch('/users/role', {
                userId: editingUser._id,
                isAdmin: editIsAdmin,
                permissions: permissions
            });
            setEditingUser(null);
            fetchData();
        } catch (error) {
            alert('Failed to update permissions');
        }
    };

    // --- Department Logic ---
    const handleCreateDept = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!deptForm.name) return;
        setDeptLoading(true);
        try {
            await api.post('/departments', deptForm);
            setDeptForm({ name: '', description: '' });
            fetchData(); // Reload both
        } catch (error) {
            alert('Failed to create department');
        } finally {
            setDeptLoading(false);
        }
    };

    const handleDeleteDept = async (id: string) => {
        if (!window.confirm('Delete this department? Users assigned to it might lose access.')) return;
        try {
            await api.delete(`/departments/${id}`);
            fetchData();
        } catch (error) {
            alert('Failed to delete department');
        }
    };

    if (currentUser?.role !== 'Admin' && !currentUser?.isAdmin) {
        return <div className="glass-panel">Access Denied</div>;
    }

    if (loading) return <div className="glass-panel">Loading Organization Data...</div>;

    return (
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ margin: 0 }}>⚙️ Organization Settings</h2>

                {/* Tabs */}
                <div style={{ display: 'flex', background: 'var(--glass-border)', borderRadius: '8px', padding: '4px' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            background: activeTab === 'users' ? 'var(--brand-primary)' : 'transparent',
                            color: activeTab === 'users' ? 'white' : 'var(--text-primary)',
                            border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        Users
                    </button>
                    <button
                        onClick={() => setActiveTab('departments')}
                        style={{
                            background: activeTab === 'departments' ? 'var(--brand-primary)' : 'transparent',
                            color: activeTab === 'departments' ? 'white' : 'var(--text-primary)',
                            border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                        }}
                    >
                        Departments
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'users' ? (
                <div className="glass-panel">
                    <div className="table-scroll-container">
                        <table className="data-table table-min-width">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Global Admin</th>
                                    <th>Department Permissions</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user._id}>
                                        <td>
                                            <div style={{ fontWeight: 'bold' }}>{user.username}</div>
                                            <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{user.email}</div>
                                        </td>
                                        <td>
                                            {user.isAdmin ? <span style={{ color: 'var(--sterling-red)', fontWeight: 'bold' }}>YES</span> : <span style={{ opacity: 0.3 }}>-</span>}
                                        </td>
                                        <td>
                                            {user.isAdmin ? <span style={{ opacity: 0.7 }}>All Access</span> : (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    {user.permissions?.length > 0 ? user.permissions.map((p, i) => {
                                                        const deptName = typeof p.department === 'object' ? p.department.name : 'Unknown';
                                                        const roles = p.roles || (p.role ? [p.role] : []);
                                                        return (
                                                            <span key={i} style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                                                                {deptName}: <strong>{roles.join(', ').replace(/Approver/g, '').replace('Governance', 'Gov').replace('Executive', 'Exec') || 'None'}</strong>
                                                            </span>
                                                        );
                                                    }) : <span style={{ opacity: 0.5 }}>None</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleEditClick(user)}>
                                                Manage
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <>
                    <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                        <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', color: 'var(--text-primary)' }}>Add New Department</h3>
                        <form onSubmit={handleCreateDept} className="dept-form-grid">
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Department Name</label>
                                <input
                                    value={deptForm.name}
                                    onChange={e => setDeptForm({ ...deptForm, name: e.target.value })}
                                    placeholder="e.g. Finance"
                                    required
                                    style={{ width: '100%', padding: '0.75rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', borderRadius: '6px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Description</label>
                                <input
                                    value={deptForm.description}
                                    onChange={e => setDeptForm({ ...deptForm, description: e.target.value })}
                                    placeholder="Brief description of responsibilities..."
                                    style={{ width: '100%', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '6px' }}
                                />
                            </div>
                            <button
                                type="submit"
                                className="btn-primary btn-full-mobile"
                                disabled={deptLoading}
                                style={{ padding: '0.75rem 2rem', height: 'fit-content' }}
                            >
                                {deptLoading ? 'Creating...' : '+ Create Department'}
                            </button>
                        </form>
                    </div>

                    <div className="glass-panel">
                        <h3 style={{ marginBottom: '1rem' }}>Existing Departments</h3>
                        <div className="dept-card-grid" style={{ marginBottom: '1.5rem' }}>
                            {departments.slice(deptPage * 5, (deptPage + 1) * 5).map(dept => (
                                <div key={dept._id} style={{
                                    padding: '1.5rem',
                                    background: 'rgba(0,0,0,0.2)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--glass-border)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1rem',
                                    position: 'relative'
                                }}>
                                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--sterling-gold)' }}>{dept.name}</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1 }}>{dept.description}</div>

                                    {dept.name !== 'General' && (
                                        <button
                                            onClick={() => handleDeleteDept(dept._id)}
                                            style={{
                                                alignSelf: 'flex-start',
                                                background: 'rgba(244, 67, 54, 0.1)',
                                                border: '1px solid rgba(244, 67, 54, 0.3)',
                                                color: '#f44336',
                                                padding: '0.4rem 0.8rem',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem'
                                            }}
                                        >
                                            Delete
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {departments.length === 0 && (
                            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>No departments found</div>
                        )}

                        {/* Pagination Controls */}
                        {departments.length > 5 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                                <button
                                    onClick={() => setDeptPage(p => Math.max(0, p - 1))}
                                    disabled={deptPage === 0}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: deptPage === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                                        color: deptPage === 0 ? 'rgba(255,255,255,0.3)' : 'white',
                                        border: 'none', borderRadius: '4px', cursor: deptPage === 0 ? 'default' : 'pointer'
                                    }}
                                >
                                    Previous
                                </button>
                                <span style={{ opacity: 0.7, fontSize: '0.9rem' }}>
                                    Page {deptPage + 1} of {Math.ceil(departments.length / 5)}
                                </span>
                                <button
                                    onClick={() => setDeptPage(p => (p + 1) * 5 < departments.length ? p + 1 : p)}
                                    disabled={(deptPage + 1) * 5 >= departments.length}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: (deptPage + 1) * 5 >= departments.length ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                                        color: (deptPage + 1) * 5 >= departments.length ? 'rgba(255,255,255,0.3)' : 'white',
                                        border: 'none', borderRadius: '4px', cursor: (deptPage + 1) * 5 >= departments.length ? 'default' : 'pointer'
                                    }}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Permission Modal */}
            {editingUser && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '1200px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--text-primary)' }}>Edit Permissions</h2>
                                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>User: <strong style={{ color: 'var(--text-primary)' }}>{editingUser.username}</strong></p>
                            </div>
                            <button onClick={() => setEditingUser(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '1.5rem', cursor: 'pointer' }}>✕</button>
                        </div>

                        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={editIsAdmin} onChange={e => setEditIsAdmin(e.target.checked)} style={{ width: '1.5rem', height: '1.5rem', accentColor: 'var(--sterling-red)' }} />
                                <div>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'block', color: 'var(--text-primary)' }}>Global Admin</span>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Grants full access to all departments and system settings.</span>
                                </div>
                            </label>
                        </div>

                        {!editIsAdmin && (
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h3 style={{ margin: 0 }}>Department Roles</h3>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        Select capabilities for each department.
                                    </p>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                                    {departments.map(dept => (
                                        <div key={dept._id} className="glass-card" style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '1rem'
                                        }}>
                                            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{dept.name}</div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                {AVAILABLE_ROLES.map(role => (
                                                    <label key={role} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.8rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.95rem',
                                                        padding: '0.5rem',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        color: 'var(--text-primary)',
                                                        background: (editPermissions[dept._id] || []).includes(role) ? 'rgba(155, 81, 224, 0.1)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(editPermissions[dept._id] || []).includes(role)}
                                                            onChange={() => handleRoleToggle(dept._id, role)}
                                                            style={{ width: '1.1rem', height: '1.1rem', accentColor: role === 'ExecutiveApprover' ? 'var(--sterling-red)' : role === 'GovernanceApprover' ? '#ff9800' : 'var(--brand-primary)' }}
                                                        />
                                                        <span style={{
                                                            fontWeight: (editPermissions[dept._id] || []).includes(role) ? 600 : 400,
                                                            color: role === 'ExecutiveApprover' ? 'var(--sterling-red)' :
                                                                role === 'GovernanceApprover' ? '#ff9800' : 'inherit'
                                                        }}>
                                                            {role === 'GovernanceApprover' ? 'Governance Reviewer' :
                                                                role === 'ExecutiveApprover' ? 'Executive Approver' : 'Requester'}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                            <button onClick={() => setEditingUser(null)} style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', padding: '0.8rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem' }}>Cancel</button>
                            <button onClick={savePermissions} className="btn-primary" style={{ padding: '0.8rem 2rem', fontSize: '1rem' }}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsers;
