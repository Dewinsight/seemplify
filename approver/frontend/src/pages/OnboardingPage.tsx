import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { getUserDisplayName, hasCompletedNameProfile } from '../utils/userDisplay';
import { formatRoleLabel as formatRoleLabelFromOrg } from '../utils/access';

interface PendingInvite {
    _id: string;
    organization: { _id: string; name: string; slug: string };
    invitedBy: { username?: string; firstName?: string; lastName?: string };
    role: string;
    department?: { name: string };
    expiresAt: string;
}

const formatRoleLabel = (role: string) => formatRoleLabelFromOrg(null, role);

const OnboardingPage: React.FC = () => {
    const { user, organizations, logout, refreshOrganizations, updateUserProfile } = useAuth();
    const navigate = useNavigate();

    const [firstName, setFirstName] = useState(user?.firstName || '');
    const [lastName, setLastName] = useState(user?.lastName || '');
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');

    // Create org state
    const [orgName, setOrgName] = useState('');
    const [orgDescription, setOrgDescription] = useState('');
    const [createLoading, setCreateLoading] = useState(false);
    const [createError, setCreateError] = useState('');
    const createInFlightRef = useRef(false);

    // Invites state
    const [invites, setInvites] = useState<PendingInvite[]>([]);
    const [invitesLoading, setInvitesLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const isProfileComplete = hasCompletedNameProfile(user);
    const displayName = getUserDisplayName(user, 'there');
    const profileHasChanges =
        firstName.trim() !== (user?.firstName || '').trim() ||
        lastName.trim() !== (user?.lastName || '').trim();

    useEffect(() => {
        fetchPendingInvites();
    }, []);

    useEffect(() => {
        setFirstName(user?.firstName || '');
        setLastName(user?.lastName || '');
    }, [user?.firstName, user?.lastName]);

    const fetchPendingInvites = async () => {
        try {
            const res = await api.get('/invites/pending');
            setInvites(res.data);
        } catch (err) {
            console.error('Failed to fetch invites:', err);
        } finally {
            setInvitesLoading(false);
        }
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedFirst = firstName.trim();
        const trimmedLast = lastName.trim();
        if (!trimmedFirst || !trimmedLast) {
            setProfileError('First name and last name are required.');
            return;
        }

        setProfileLoading(true);
        setProfileError('');
        try {
            const res = await api.patch('/auth/me', {
                firstName: trimmedFirst,
                lastName: trimmedLast
            });
            if (res.data?.user) {
                updateUserProfile(res.data.user);
            }
            if (organizations.length > 0) {
                navigate('/');
            }
        } catch (err: any) {
            setProfileError(err.response?.data?.error || 'Failed to update profile');
        } finally {
            setProfileLoading(false);
        }
    };

    const handleCreateOrg = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isProfileComplete) {
            setCreateError('Complete your profile before creating or joining an organization.');
            return;
        }
        if (!orgName.trim()) return;
        if (createInFlightRef.current) return;
        createInFlightRef.current = true;
        setCreateLoading(true);
        setCreateError('');

        try {
            const res = await api.post('/organizations/create-and-join', {
                name: orgName.trim(),
                description: orgDescription.trim()
            });
            // 200 = already member (idempotent), 201 = created
            if (res.data?.organization) {
                await refreshOrganizations();
                navigate('/');
            }
        } catch (err: any) {
            // On 409: maybe we're already a member (create succeeded earlier, client had stale state)
            if (err.response?.status === 409) {
                const orgs = await refreshOrganizations();
                if (orgs.length > 0) {
                    navigate('/');
                    return;
                }
            }
            const message = err.response?.data?.error || 'Failed to create organization';
            const hint = err.response?.data?.hint;
            setCreateError(hint ? `${message} ${hint}` : message);

            // Only log unexpected errors; "org already exists" is a normal user-facing case.
            if (!err.response || err.response.status >= 500) {
                console.error(err);
            }
        } finally {
            setCreateLoading(false);
            createInFlightRef.current = false;
        }
    };

    const handleAcceptInvite = async (inviteId: string) => {
        if (!isProfileComplete) {
            alert('Complete your profile before joining an organization.');
            return;
        }
        setActionLoading(inviteId);
        try {
            await api.post(`/invites/${inviteId}/accept`);
            await refreshOrganizations();
            navigate('/');
        } catch (err: any) {
            console.error(err);
            alert(err.response?.data?.error || 'Failed to accept invite');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeclineInvite = async (inviteId: string) => {
        setActionLoading(inviteId);
        try {
            await api.post(`/invites/${inviteId}/decline`);
            setInvites(prev => prev.filter(inv => inv._id !== inviteId));
        } catch (err: any) {
            console.error(err);
            alert(err.response?.data?.error || 'Failed to decline invite');
        } finally {
            setActionLoading(null);
        }
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

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '3rem', marginTop: '2rem' }}>
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none" style={{ display: 'inline-block', marginBottom: '1rem' }}>
                    <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad)" />
                    <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.8" />
                    <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.8" />
                    <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.6" />
                    <defs>
                        <linearGradient id="mosaicGrad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#9B51E0" />
                            <stop offset="100%" stopColor="#7B3FC0" />
                        </linearGradient>
                    </defs>
                </svg>
                <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
                    Welcome, {displayName}!
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {isProfileComplete
                        ? 'Get started by creating an organization or joining one via an invite.'
                        : 'Complete your profile before continuing.'}
                </p>
            </div>

            <div style={{ width: '100%', maxWidth: '800px', marginBottom: '2rem' }}>
                <div className="glass-panel" style={{ height: 'fit-content' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                        {isProfileComplete ? 'Profile Details' : 'Complete Your Profile'}
                    </h3>
                    <form onSubmit={handleSaveProfile} style={{ display: 'grid', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                    First Name *
                                </label>
                                <input
                                    type="text"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.8rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                    Last Name *
                                </label>
                                <input
                                    type="text"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.8rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                        </div>
                        {profileError && <p style={{ color: '#ff6b6b', margin: 0 }}>{profileError}</p>}
                        <button
                            type="submit"
                            className="btn-primary"
                            style={{ width: '100%', padding: '0.9rem', marginTop: '0.25rem' }}
                            disabled={profileLoading || (!profileHasChanges && isProfileComplete)}
                        >
                            {profileLoading
                                ? 'Saving...'
                                : (!profileHasChanges && isProfileComplete ? 'Profile Saved' : 'Save Profile')}
                        </button>
                    </form>
                </div>
            </div>

            {isProfileComplete ? (
                <div style={{ width: '100%', maxWidth: '800px', display: 'grid', gridTemplateColumns: invites.length > 0 ? '1fr 1fr' : '1fr', gap: '2rem' }}>
                    {/* Create Organization */}
                    <div className="glass-panel" style={{ height: 'fit-content' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                            Create Organization
                        </h3>
                        <form onSubmit={handleCreateOrg} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                    Organization Name *
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Acme Corp"
                                    value={orgName}
                                    onChange={(e) => setOrgName(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.8rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                    Description
                                </label>
                                <input
                                    type="text"
                                    placeholder="Brief description (optional)"
                                    value={orgDescription}
                                    onChange={(e) => setOrgDescription(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.8rem', borderRadius: '6px',
                                        border: '1px solid var(--glass-border)',
                                        background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                            {createError && <p style={{ color: '#ff6b6b', margin: 0 }}>{createError}</p>}
                            <button
                                type="submit"
                                className="btn-primary"
                                style={{ width: '100%', padding: '0.9rem', marginTop: '0.5rem' }}
                                disabled={createLoading}
                            >
                                {createLoading ? 'Creating...' : 'Create Organization'}
                            </button>
                        </form>
                    </div>

                    {/* Pending Invites */}
                    {invitesLoading ? (
                        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                            <p style={{ color: 'var(--text-secondary)' }}>Loading invites...</p>
                        </div>
                    ) : invites.length > 0 ? (
                        <div className="glass-panel" style={{ height: 'fit-content' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
                                Pending Invites
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {invites.map(invite => (
                                    <div
                                        key={invite._id}
                                        style={{
                                            padding: '1.2rem',
                                            background: 'rgba(0,0,0,0.2)',
                                            borderRadius: '10px',
                                            border: '1px solid var(--glass-border)'
                                        }}
                                    >
                                        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                                            {invite.organization.name}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
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
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                        Profile completion is required before you can create or join an organization.
                    </p>
                </div>
            )}

            {/* Logout link */}
            <div style={{ marginTop: '2rem' }}>
                <button
                    onClick={logout}
                    style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                        textDecoration: 'underline', fontSize: '0.9rem'
                    }}
                >
                    Sign out
                </button>
            </div>
        </div>
    );
};

export default OnboardingPage;
