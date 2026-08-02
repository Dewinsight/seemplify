import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api';

const Logo = () => (
    <div style={{ marginBottom: '2rem' }}>
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" style={{ display: 'inline-block', marginBottom: '1rem' }}>
            <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#fpGrad)" />
            <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#fpGrad)" opacity="0.8" />
            <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#fpGrad)" opacity="0.8" />
            <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#fpGrad)" opacity="0.6" />
            <defs>
                <linearGradient id="fpGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#9B51E0" />
                    <stop offset="100%" stopColor="#7B3FC0" />
                </linearGradient>
            </defs>
        </svg>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>MOSAIC</h1>
    </div>
);

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.post('/auth/forgot-password', { email });
            setSuccess(true);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to send reset code');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div style={{ maxWidth: '420px', margin: '4rem auto', textAlign: 'center' }}>
                <Logo />
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    {/* Email sent icon */}
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%',
                        background: 'rgba(155, 81, 224, 0.12)',
                        border: '2px solid rgba(155, 81, 224, 0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        fontSize: '1.75rem'
                    }}>✉️</div>

                    <h2 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)', fontSize: '1.3rem' }}>
                        Reset Code Sent!
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '0.5rem' }}>
                        We sent a 6-digit reset code to
                    </p>
                    <p style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                        {email}
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.75rem', lineHeight: 1.5 }}>
                        Check your inbox (and spam folder). The code expires in <strong style={{ color: 'var(--text-primary)' }}>10 minutes</strong>.
                    </p>

                    {/* Primary CTA */}
                    <button
                        onClick={() => navigate(`/reset-password?email=${encodeURIComponent(email)}`)}
                        className="btn-primary"
                        style={{ width: '100%', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                        Enter Reset Code
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>

                    <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Wrong email?{' '}
                        <button
                            onClick={() => setSuccess(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 'inherit' }}
                        >
                            Try again
                        </button>
                        {' · '}
                        <Link to="/login" style={{ color: 'var(--accent)' }}>Back to Login</Link>
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
            <Logo />
            <h2 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Reset Password</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>
                Enter your email and we'll send you a reset code
            </p>
            <div className="glass-panel">
                <form onSubmit={handleSubmit}>
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    {error && <p style={{ color: '#ff6b6b', margin: '0 0 1rem 0' }}>{error}</p>}
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Sending...' : 'Send Reset Code'}
                    </button>
                </form>
                <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
                    Remember your password? <Link to="/login" style={{ color: 'var(--accent)' }}>Login</Link>
                </p>
            </div>
        </div>
    );
};

export default ForgotPassword;
