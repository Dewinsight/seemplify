import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getUserDisplayName } from '../utils/userDisplay';
import { getOrganizationRoles, formatRoleLabel as formatRoleLabelFromOrg } from '../utils/access';

interface PendingInvite {
    _id: string;
    organization: { _id: string; name: string; slug: string };
    invitedBy: { username?: string; firstName?: string; lastName?: string };
    role: string;
    department?: { name: string };
    expiresAt: string;
}

interface SentInvite {
    _id: string;
    email: string;
    role: string;
    status: string;
    department?: { _id: string; name: string };
    invitedBy: { username?: string; firstName?: string; lastName?: string };
    createdAt: string;
    expiresAt: string;
}

interface Department {
    _id: string;
    name: string;
}

const InvitesPage: React.FC = () => {
    const { activeOrganization, refreshOrganizations } = useAuth();
    const isAdmin = activeOrganization?.isAdmin || false;
    const roleOptions = useMemo(() => getOrganizationRoles(activeOrganization), [activeOrganization]);
    const formatRoleLabel = (role: string) => formatRoleLabelFromOrg(activeOrganization, role);

    // My pending invites
    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [pendingLoading, setPendingLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Admin: sent invites
    const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);
    const [sentLoading, setSentLoading] = useState(false);

    // Admin: send invite form
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('');
    const [inviteDept, setInviteDept] = useState('');
    const [inviteIsAdmin, setInviteIsAdmin] = useState(false);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [sendLoading, setSendLoading] = useState(false);
    const [sendError, setSendError] = useState('');
    const [sendSuccess, setSendSuccess] = useState('');

    useEffect(() => {
        fetchPendingInvites();
    }, []);

    useEffect(() => {
        if (isAdmin) {
            fetchSentInvites();
            fetchDepartments();
        }
    }, [isAdmin, activeOrganization]);

    useEffect(() => {
        if (!roleOptions.length) return;
        if (!inviteRole || !roleOptions.some((role) => role.key === inviteRole)) {
            setInviteRole(roleOptions[0].key);
        }
    }, [inviteRole, roleOptions]);

    const fetchPendingInvites = async () => {
        try {
            const res = await api.get('/invites/pending');
            setPendingInvites(res.data);
        } catch (err) {
            console.error('Failed to fetch pending invites:', err);
        } finally {
            setPendingLoading(false);
        }
    };

    const fetchSentInvites = async () => {
        setSentLoading(true);
        try {
            const res = await api.get('/invites/sent');
            setSentInvites(res.data);
        } catch (err) {
            console.error('Failed to fetch sent invites:', err);
        } finally {
            setSentLoading(false);
        }
    };

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/departments');
            setDepartments(res.data);
        } catch (err) {
            console.error('Failed to fetch departments:', err);
        }
    };

    const handleAcceptInvite = async (inviteId: string) => {
        setActionLoading(inviteId);
        try {
            await api.post(`/invites/${inviteId}/accept`);
            setPendingInvites(prev => prev.filter(inv => inv._id !== inviteId));
            await refreshOrganizations();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to accept invite');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeclineInvite = async (inviteId: string) => {
        setActionLoading(inviteId);
        try {
            await api.post(`/invites/${inviteId}/decline`);
            setPendingInvites(prev => prev.filter(inv => inv._id !== inviteId));
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to decline invite');
        } finally {
            setActionLoading(null);
        }
    };

    const handleSendInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setSendLoading(true);
        setSendError('');
        setSendSuccess('');

        try {
            await api.post('/invites', {
                email: inviteEmail.trim().toLowerCase(),
                role: inviteRole,
                department: inviteDept || undefined,
                isAdmin: inviteIsAdmin
            });
            setSendSuccess(`Invite sent to ${inviteEmail}`);
            setInviteEmail('');
            setInviteRole(roleOptions[0]?.key || '');
            setInviteDept('');
            setInviteIsAdmin(false);
            fetchSentInvites();
        } catch (err: any) {
            setSendError(err.response?.data?.error || 'Failed to send invite');
        } finally {
            setSendLoading(false);
        }
    };

    const handleRevokeInvite = async (inviteId: string) => {
        if (!window.confirm('Revoke this invite?')) return;
        try {
            await api.delete(`/invites/${inviteId}`);
            setSentInvites(prev => prev.filter(inv => inv._id !== inviteId));
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to revoke invite');
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    };

    const formatExpiry = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return 'Expired';
        if (diffDays === 1) return 'Expires tomorrow';
        return `Expires in ${diffDays} days`;
    };

    const statusBadge = (status: string) => {
        const colors: Record<string, { bg: string; text: string }> = {
            pending: { bg: 'rgba(255, 152, 0, 0.15)', text: '#ff9800' },
            accepted: { bg: 'rgba(76, 175, 80, 0.15)', text: '#4caf50' },
            declined: { bg: 'rgba(244, 67, 54, 0.15)', text: '#f44336' },
            expired: { bg: 'rgba(158, 158, 158, 0.15)', text: '#9e9e9e' }
        };
        const c = colors[status] || colors.pending;
        return (
            <span style={{
                padding: '3px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600,
                background: c.bg, color: c.text, textTransform: 'capitalize'
            }}>
                {status}
            </span>
        );
    };

    return (
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <h2 style={{ marginBottom: '2rem' }}>Invites</h2>

            {/* My Pending Invites Section */}
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                <h3 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                    My Pending Invites
                </h3>
                {pendingLoading ? (
                    <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
                ) : pendingInvites.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>No pending invites.</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                        {pendingInvites.map(invite => (
                            <div key={invite._id} style={{
                                padding: '1.2rem', background: 'rgba(0,0,0,0.2)',
                                borderRadius: '10px', border: '1px solid var(--glass-border)'
                            }}>
                                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                                    {invite.organization.name}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                                    Invited by <strong>{getUserDisplayName(invite.invitedBy, 'Someone')}</strong>
                                    {' '}&middot;{' '}Role: <strong>{formatRoleLabel(invite.role)}</strong>
                                    {invite.department && <>{' '}&middot;{' '}Dept: <strong>{invite.department.name}</strong></>}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.8rem' }}>
                                    {formatExpiry(invite.expiresAt)}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="btn-primary"
                                        style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                                        onClick={() => handleAcceptInvite(invite._id)}
                                        disabled={actionLoading === invite._id}
                                    >
                                        {actionLoading === invite._id ? 'Accepting...' : 'Accept'}
                                    </button>
                                    <button
                                        style={{
                                            padding: '0.5rem 1.2rem', fontSize: '0.85rem',
                                            background: 'transparent', border: '1px solid var(--glass-border)',
                                            color: 'var(--text-secondary)', borderRadius: '6px', cursor: 'pointer'
                                        }}
                                        onClick={() => handleDeclineInvite(invite._id)}
                                        disabled={actionLoading === invite._id}
                                    >
                                        Decline
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Admin: Send Invites */}
            {isAdmin && (
                <>
                    <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                            Send Invite
                        </h3>
                        <form onSubmit={handleSendInvite} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
                            <div style={{ flex: '2 1 200px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Email *</label>
                                <input
                                    type="email"
                                    placeholder="user@example.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.7rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                            <div style={{ flex: '1 1 140px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Role</label>
                                <select
                                    value={inviteRole}
                                    onChange={(e) => setInviteRole(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.7rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(0,0,0,0.3)', color: 'var(--text-primary)'
                                    }}
                                >
                                    {roleOptions.map((role) => (
                                        <option key={role.key} value={role.key}>{role.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 140px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Department</label>
                                <select
                                    value={inviteDept}
                                    onChange={(e) => setInviteDept(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.7rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(0,0,0,0.3)', color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="">General (default)</option>
                                    {departments.map(dept => (
                                        <option key={dept._id} value={dept._id}>{dept.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={inviteIsAdmin}
                                        onChange={(e) => setInviteIsAdmin(e.target.checked)}
                                        style={{ accentColor: 'var(--brand-primary)' }}
                                    />
                                    Admin
                                </label>
                            </div>
                            <button
                                type="submit"
                                className="btn-primary"
                                style={{ padding: '0.7rem 1.5rem' }}
                                disabled={sendLoading}
                            >
                                {sendLoading ? 'Sending...' : 'Send Invite'}
                            </button>
                        </form>
                        {sendError && <p style={{ color: '#ff6b6b', marginTop: '0.75rem', marginBottom: 0 }}>{sendError}</p>}
                        {sendSuccess && <p style={{ color: '#4caf50', marginTop: '0.75rem', marginBottom: 0 }}>{sendSuccess}</p>}
                    </div>

                    {/* Sent Invites Table */}
                    <div className="glass-panel">
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                            Sent Invites
                        </h3>
                        {sentLoading ? (
                            <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
                        ) : sentInvites.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>No invites sent yet.</p>
                        ) : (
                            <div className="table-scroll-container">
                                <table className="data-table table-min-width">
                                    <thead>
                                        <tr>
                                            <th>Email</th>
                                            <th>Role</th>
                                            <th>Department</th>
                                            <th>Status</th>
                                            <th>Sent</th>
                                            <th style={{ textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sentInvites.map(invite => (
                                            <tr key={invite._id}>
                                                <td style={{ fontWeight: 600 }}>{invite.email}</td>
                                                <td>{formatRoleLabel(invite.role)}</td>
                                                <td>{invite.department?.name || 'General'}</td>
                                                <td>{statusBadge(invite.status)}</td>
                                                <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{formatDate(invite.createdAt)}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {invite.status === 'pending' && (
                                                        <button
                                                            onClick={() => handleRevokeInvite(invite._id)}
                                                            style={{
                                                                background: 'rgba(244, 67, 54, 0.1)',
                                                                border: '1px solid rgba(244, 67, 54, 0.3)',
                                                                color: '#f44336',
                                                                padding: '0.3rem 0.8rem', borderRadius: '4px',
                                                                cursor: 'pointer', fontSize: '0.8rem'
                                                            }}
                                                        >
                                                            Revoke
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default InvitesPage;
