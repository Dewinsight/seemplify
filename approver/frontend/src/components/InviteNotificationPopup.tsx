import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';

interface PendingInvite {
    _id: string;
    organization: { _id: string; name: string; slug: string };
    invitedBy: { username?: string; firstName?: string; lastName?: string };
    role: string;
}

const getInviterName = (invite: PendingInvite) => {
    const inv = invite.invitedBy;
    if (!inv) return 'Someone';
    const first = (inv as { firstName?: string }).firstName || '';
    const last = (inv as { lastName?: string }).lastName || '';
    const full = `${first} ${last}`.trim();
    return full || inv.username || 'Someone';
};

const InviteNotificationPopup: React.FC = () => {
    const [invites, setInvites] = useState<PendingInvite[]>([]);
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (location.pathname === '/invites') {
            setLoading(false);
            return;
        }
        api.get('/invites/pending')
            .then((res) => {
                const data = res.data || [];
                setInvites(data);
                if (data.length > 0) setShow(true);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [location.pathname]);

    const handleViewInvites = () => {
        setShow(false);
        navigate('/invites');
    };

    const handleDismiss = () => {
        setShow(false);
    };

    if (loading || !show || invites.length === 0) return null;

    return (
        <div
            className="modal-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '1rem'
            }}
        >
            <div
                className="modal-content"
                style={{
                    padding: '1.5rem',
                    borderRadius: '12px',
                    maxWidth: '420px',
                    width: '100%'
                }}
            >
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.25rem' }}>You have pending invites</h3>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem 0', fontSize: '0.9rem' }}>
                    {invites.length} organization{invites.length > 1 ? 's' : ''} want{invites.length === 1 ? 's' : ''} to add you.
                </p>
                <ul style={{ margin: '0 0 1.25rem 0', paddingLeft: '1.25rem' }}>
                    {invites.map((inv) => (
                        <li key={inv._id} style={{ marginBottom: '0.25rem' }}>
                            <strong>{inv.organization.name}</strong>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                {' '}
                                — from {getInviterName(inv)}
                            </span>
                        </li>
                    ))}
                </ul>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        onClick={handleViewInvites}
                        className="btn-primary"
                        style={{ flex: 1, padding: '0.6rem 1rem' }}
                    >
                        View invites
                    </button>
                    <button
                        onClick={handleDismiss}
                        style={{
                            flex: 1,
                            padding: '0.6rem 1rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)',
                            cursor: 'pointer'
                        }}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InviteNotificationPopup;
