import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { getUserDisplayName } from '../utils/userDisplay';
import { getOrganizationRoles, formatRoleLabel as formatRoleLabelFromOrg } from '../utils/access';

const Profile: React.FC = () => {
    const { user, activeOrganization, updateUserProfile } = useAuth();
    const [form, setForm] = useState({
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        username: user?.username || '',
        email: user?.email || ''
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const displayName = getUserDisplayName(user, 'User');
    const rolePalette = ['#2196f3', '#4caf50', '#ff9800', '#ef5350', '#9c27b0', '#00bcd4'];
    const roleOptions = getOrganizationRoles(activeOrganization);
    const getRoleColor = (roleKey: string) => {
        const idx = roleOptions.findIndex(role => role.key === roleKey);
        if (idx >= 0) return rolePalette[idx % rolePalette.length];
        return '#2196f3';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        setError('');

        try {
            const payload: any = {};
            if (form.firstName !== (user?.firstName || '')) payload.firstName = form.firstName;
            if (form.lastName !== (user?.lastName || '')) payload.lastName = form.lastName;
            if (form.username !== user?.username) payload.username = form.username;

            if (Object.keys(payload).length === 0) {
                setLoading(false);
                return;
            }

            const res = await api.patch('/auth/me', payload);
            if (res.data?.user) {
                updateUserProfile(res.data.user);
                setForm({
                    firstName: res.data.user.firstName || '',
                    lastName: res.data.user.lastName || '',
                    username: res.data.user.username || '',
                    email: res.data.user.email || form.email
                });
            }
            setMessage('Profile updated successfully.');
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h2 style={{ marginBottom: '2rem' }}>User Profile</h2>
            <p style={{ marginTop: '-1rem', marginBottom: '2rem', color: 'var(--text-secondary)' }}>
                Display name: <strong style={{ color: 'var(--text-primary)' }}>{displayName}</strong>
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Left Column: Edit Profile */}
                <div className="glass-panel">
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Edit Information</h3>
                    <form onSubmit={handleSubmit}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>First Name</label>
                        <input
                            type="text"
                            value={form.firstName}
                            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                            required
                            style={{
                                width: '100%',
                                padding: '0.6rem',
                                borderRadius: '4px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'white'
                            }}
                        />

                        <label style={{ display: 'block', marginBottom: '0.5rem', marginTop: '1rem' }}>Last Name</label>
                        <input
                            type="text"
                            value={form.lastName}
                            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                            required
                            style={{
                                width: '100%',
                                padding: '0.6rem',
                                borderRadius: '4px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'white'
                            }}
                        />

                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Username</label>
                        <input
                            type="text"
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                            required
                            style={{
                                width: '100%',
                                padding: '0.6rem',
                                borderRadius: '4px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255,255,255,0.05)',
                                color: 'white'
                            }}
                        />

                        <label style={{ display: 'block', marginBottom: '0.5rem', marginTop: '1rem' }}>Email (Read Only)</label>
                        <input
                            type="email"
                            value={form.email}
                            readOnly
                            disabled
                            style={{
                                width: '100%',
                                padding: '0.6rem',
                                borderRadius: '4px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(0,0,0,0.2)',
                                color: 'var(--text-secondary)',
                                cursor: 'not-allowed'
                            }}
                        />

                        <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            To change your email or password, please contact an administrator.
                        </div>

                        {message && <div style={{ color: '#4caf50', margin: '1rem 0', padding: '0.5rem', background: 'rgba(76, 175, 80, 0.1)', borderRadius: '4px' }}>{message}</div>}
                        {error && <div style={{ color: '#f44336', margin: '1rem 0', padding: '0.5rem', background: 'rgba(244, 67, 54, 0.1)', borderRadius: '4px' }}>{error}</div>}

                        <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', marginTop: '1.5rem', padding: '0.8rem' }}>
                            {loading ? 'Saving...' : 'Save Profile'}
                        </button>
                    </form>
                </div>

                {/* Right Column: Roles & Departments */}
                <div>
                    <div className="glass-panel">
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Department Access</h3>

                        {activeOrganization?.isAdmin && (
                            <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(255, 193, 7, 0.1)', border: '1px solid #ffc107', borderRadius: '8px', color: '#ffc107' }}>
                                <strong>👑 Global Administrator</strong>
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.9 }}>You have full access to all departments.</p>
                            </div>
                        )}

                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--glass-border)' }}>
                                    <th style={{ padding: '0.5rem' }}>Department</th>
                                    <th style={{ padding: '0.5rem' }}>Role</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeOrganization?.permissions?.map((p: any, idx: number) => {
                                    // Handle populated object or raw ID string from token
                                    const deptName = typeof p.department === 'object' ? p.department?.name : 'Unknown Dept';
                                    const roles = p.roles || (p.role ? [p.role] : []);

                                    return (
                                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.5rem' }}>{deptName}</td>
                                            <td style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {roles.map((role: string) => (
                                                    <span key={role} style={{
                                                        background: `${getRoleColor(role)}22`,
                                                        color: getRoleColor(role),
                                                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold'
                                                    }}>
                                                        {formatRoleLabelFromOrg(activeOrganization, role)}
                                                    </span>
                                                ))}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {(!activeOrganization?.permissions || activeOrganization.permissions.length === 0) && (
                                    <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', opacity: 0.5 }}>No specific department roles assigned.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
