import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

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
            <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
                <div style={{ marginBottom: '2rem' }}>
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
                    <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>MOSAIC</h1>
                </div>
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✉️</div>
                    <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Check Your Email</h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        If an account exists with <strong>{email}</strong>, we've sent a password reset code.
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>
                        Check your spam folder if you don't receive the email within a few minutes.
                    </p>
                    <Link 
                        to="/login" 
                        style={{ 
                            display: 'inline-block', 
                            marginTop: '1.5rem', 
                            color: 'var(--accent)',
                            textDecoration: 'none'
                        }}
                    >
                        Back to Login
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
            <div style={{ marginBottom: '2rem' }}>
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
                <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>MOSAIC</h1>
            </div>
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
