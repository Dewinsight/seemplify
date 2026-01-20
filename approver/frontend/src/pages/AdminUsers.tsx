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
    role: 'Approver' | 'Requester';
}
interface User {
    _id: string;
    username: string;
    email: string;
    isAdmin: boolean;
    permissions: Permission[];
    isVerified: boolean;
}

const AdminUsers: React.FC = () => {
    const { user: currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState<'users' | 'departments'>('users');

    // Users State
    const [users, setUsers] = useState<User[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]); // Shared resource
    const [loading, setLoading] = useState(true);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editIsAdmin, setEditIsAdmin] = useState(false);
    const [editPermissions, setEditPermissions] = useState<Record<string, string>>({});

    // Departments State
    const [deptForm, setDeptForm] = useState({ name: '', description: '' });
    const [deptLoading, setDeptLoading] = useState(false);

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
        const permMap: Record<string, string> = {};
        user.permissions.forEach(p => {
            const deptId = typeof p.department === 'string' ? p.department : p.department._id;
            permMap[deptId] = p.role;
        });
        setEditPermissions(permMap);
    };

    const handlePermissionChange = (deptId: string, role: string) => {
        setEditPermissions(prev => {
            const next = { ...prev };
            if (role === 'None') delete next[deptId];
            else next[deptId] = role;
            return next;
        });
    };

    const savePermissions = async () => {
        if (!editingUser) return;
        const permissions = Object.entries(editPermissions).map(([deptId, role]) => ({
            department: deptId,
            role
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
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            background: activeTab === 'users' ? 'var(--sterling-red)' : 'transparent',
                            color: 'white', border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                        }}
                    >
                        Users
                    </button>
                    <button
                        onClick={() => setActiveTab('departments')}
                        style={{
                            background: activeTab === 'departments' ? 'var(--sterling-red)' : 'transparent',
                            color: 'white', border: 'none', padding: '0.6rem 1.2rem',
                            borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                        }}
                    >
                        Departments
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'users' ? (
                <div className="glass-panel">
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--glass-border)' }}>
                                    <th style={{ padding: '1rem', textAlign: 'left' }}>User</th>
                                    <th style={{ padding: '1rem', textAlign: 'left' }}>Global Admin</th>
                                    <th style={{ padding: '1rem', textAlign: 'left' }}>Department Permissions</th>
                                    <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user._id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                                        <td style={{ padding: '1rem' }}>
                                            <div style={{ fontWeight: 'bold' }}>{user.username}</div>
                                            <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{user.email}</div>
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {user.isAdmin ? <span style={{ color: 'var(--sterling-red)', fontWeight: 'bold' }}>YES</span> : <span style={{ opacity: 0.3 }}>-</span>}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {user.isAdmin ? <span style={{ opacity: 0.7 }}>All Access</span> : (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    {user.permissions?.length > 0 ? user.permissions.map((p, i) => (
                                                        <span key={i} style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                                                            {typeof p.department === 'object' ? p.department.name : 'Unknown'}: <strong>{p.role}</strong>
                                                        </span>
                                                    )) : <span style={{ opacity: 0.5 }}>None</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'right' }}>
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
                        <h3>Add New Department</h3>
                        <form onSubmit={handleCreateDept} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Name</label>
                                <input value={deptForm.name} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="e.g. Finance" required
                                    style={{ width: '100%', padding: '0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '4px' }} />
                            </div>
                            <div style={{ flex: 2, minWidth: '300px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Description</label>
                                <input value={deptForm.description} onChange={e => setDeptForm({ ...deptForm, description: e.target.value })} placeholder="Optional description..."
                                    style={{ width: '100%', padding: '0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '4px' }} />
                            </div>
                            <button type="submit" className="btn-primary" disabled={deptLoading} style={{ padding: '0.6rem 1.5rem', height: 'fit-content', marginBottom: '1px' }}>{deptLoading ? 'Creating...' : '+ Create'}</button>
                        </form>
                    </div>
                    <div className="glass-panel">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--glass-border)' }}>
                                    <th style={{ padding: '1rem', textAlign: 'left' }}>Name</th>
                                    <th style={{ padding: '1rem', textAlign: 'left' }}>Description</th>
                                    <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {departments.map(dept => (
                                    <tr key={dept._id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '1rem', fontWeight: 600 }}>{dept.name}</td>
                                        <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{dept.description}</td>
                                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                                            {dept.name !== 'General' && (
                                                <button onClick={() => handleDeleteDept(dept._id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Delete">🗑️</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Permission Modal */}
            {editingUser && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass-panel" style={{ width: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h3 style={{ marginTop: 0 }}>Edit Permissions: {editingUser.username}</h3>
                        <div style={{ margin: '1.5rem 0', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={editIsAdmin} onChange={e => setEditIsAdmin(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                                <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Global Admin</span>
                            </label>
                            <p style={{ margin: '0.5rem 0 0 2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Admins have full access to all departments.</p>
                        </div>
                        {!editIsAdmin && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Department Roles</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                    {departments.map(dept => (
                                        <div key={dept._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontWeight: 500 }}>{dept.name}</span>
                                            <select value={editPermissions[dept._id] || 'None'} onChange={e => handlePermissionChange(dept._id, e.target.value)}
                                                style={{ padding: '0.4rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '4px', width: '140px' }}>
                                                <option value="None">None</option>
                                                <option value="Requester">Requester</option>
                                                <option value="Approver">Approver</option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                            <button onClick={() => setEditingUser(null)} style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={savePermissions} className="btn-primary" style={{ padding: '0.6rem 1.5rem' }}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsers;
