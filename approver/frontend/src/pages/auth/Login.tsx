import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [localAuthEnabled, setLocalAuthEnabled] = useState(false);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuth();

    useEffect(() => {
        const oidcError = searchParams.get('error');
        if (oidcError) setError(oidcError);
        api.get('/auth/oidc/status')
            .then((response) => setLocalAuthEnabled(response.data?.localAuthEnabled === true))
            .catch(() => setLocalAuthEnabled(false));
    }, [searchParams]);

    const startSingleSignOn = () => {
        const returnTo = `${window.location.origin}/`;
        window.location.assign(`/api/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await api.post('/auth/login', { email, password });
            const { user, organizations, needsOnboarding } = response.data;
            login(user, organizations || []);

            if (needsOnboarding) {
                navigate('/setup');
            } else {
                navigate('/');
            }
        } catch (err: any) {
            console.error(err);
            if (err.response?.data?.needsVerification) {
                navigate('/verify', { state: { email: err.response.data.email || email } });
                return;
            }
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

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
            <h2 style={{ marginBottom: '2rem', color: 'var(--text-primary)' }}>Welcome Back</h2>
            <div className="glass-panel">
                {error && <p role="alert" style={{ color: '#c24141', margin: '0 0 1rem 0' }}>{error}</p>}
                <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={startSingleSignOn}>
                    Continue with Seemplify
                </button>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5, margin: '0.85rem 0 0' }}>
                    Use your Seemplify account and organization access.
                </p>
                {localAuthEnabled && <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    <span style={{ height: 1, background: 'var(--glass-border)', flex: 1 }} />
                    Local account
                    <span style={{ height: 1, background: 'var(--glass-border)', flex: 1 }} />
                </div>}
                {localAuthEnabled && <form onSubmit={handleSubmit}>
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Logging in...' : 'Login'}
                    </button>
                </form>}
                {localAuthEnabled && <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
                    Don't have an account? <Link to="/register" style={{ color: 'var(--accent)' }}>Register</Link>
                </p>}
                {localAuthEnabled && <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                    Forgot your password? <Link to="/forgot-password" style={{ color: 'var(--accent)' }}>Reset it here</Link>
                </p>}
            </div>
            <p style={{ marginTop: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                <Link
                    to="/docs"
                    style={{
                        color: 'var(--accent)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        textDecoration: 'none',
                    }}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                        <path d="M12 17h.01" />
                    </svg>
                    Help &amp; Documentation
                </Link>
            </p>
        </div>
    );
};

export default Login;
