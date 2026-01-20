import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface User {
    _id: string;
    username: string;
    email: string;
    role: 'Admin' | 'Approver' | 'Requester';
    department: string;
    isVerified: boolean;
    createdAt: string;
}

const AdminUsers = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('http://localhost:5000/api/users', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(res.data);
            setLoading(false);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to fetch users');
            setLoading(false);
        }
    };

    const updateRole = async (userId: string, newRole: string) => {
        try {
            const token = localStorage.getItem('token');
            await axios.patch('http://localhost:5000/api/users/role',
                { userId, role: newRole },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            fetchUsers(); // Refresh list
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to update role');
        }
    };

    if (currentUser?.role !== 'Admin') {
        return (
            <div className="glass-panel">
                <h2>Access Denied</h2>
                <p>Only Admins can access this page.</p>
            </div>
        );
    }

    if (loading) return <div className="glass-panel">Loading users...</div>;

    return (
        <div className="glass-panel">
            <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)' }}>👥 User Management</h2>

            {error && <div style={{ color: '#f44336', marginBottom: '1rem' }}>{error}</div>}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--glass-border)' }}>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Username</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Email</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Department</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Role</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user._id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                                <td style={{ padding: '0.75rem' }}>{user.username}</td>
                                <td style={{ padding: '0.75rem' }}>{user.email}</td>
                                <td style={{ padding: '0.75rem' }}>{user.department}</td>
                                <td style={{ padding: '0.75rem' }}>
                                    <span style={{
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        fontSize: '0.85rem',
                                        background: user.role === 'Admin' ? '#D63637' : user.role === 'Approver' ? '#E1A777' : '#2A3345',
                                        color: 'white'
                                    }}>
                                        {user.role}
                                    </span>
                                </td>
                                <td style={{ padding: '0.75rem' }}>
                                    {user.isVerified ?
                                        <span style={{ color: 'green' }}>✓ Verified</span> :
                                        <span style={{ color: 'orange' }}>⏳ Pending</span>
                                    }
                                </td>
                                <td style={{ padding: '0.75rem' }}>
                                    {user._id !== currentUser?.id && (
                                        <select
                                            value={user.role}
                                            onChange={(e) => updateRole(user._id, e.target.value)}
                                            style={{
                                                padding: '0.4rem',
                                                borderRadius: '4px',
                                                background: 'var(--glass-bg)',
                                                color: 'var(--text-primary)',
                                                border: '1px solid var(--glass-border)'
                                            }}
                                        >
                                            <option value="Requester">Requester</option>
                                            <option value="Approver">Approver</option>
                                            <option value="Admin">Admin</option>
                                        </select>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: '1.5rem', opacity: 0.7 }}>
                Total Users: {users.length}
            </div>
        </div>
    );
};

export default AdminUsers;
