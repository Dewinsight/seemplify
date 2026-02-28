import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { UBA_LOGO_URL, APP_BRAND_NAME, APP_BRAND_TAGLINE } from '../../constants/branding';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await api.post('/auth/login', { email, password });
            const { token, user, organizations, needsOnboarding } = response.data;
            login(token, user, organizations || []);

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
                <img
                    src={UBA_LOGO_URL}
                    alt="UBA logo"
                    style={{ width: '170px', height: '52px', objectFit: 'contain', display: 'inline-block', marginBottom: '0.75rem' }}
                />
                <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.8rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.1 }}>{APP_BRAND_NAME}</h1>
                <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{APP_BRAND_TAGLINE}</p>
            </div>
            <h2 style={{ marginBottom: '2rem', color: 'var(--text-primary)' }}>Welcome Back</h2>
            <div className="glass-panel">
                <form onSubmit={handleSubmit}>
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
                    {error && <p style={{ color: '#ff6b6b', margin: '0 0 1rem 0' }}>{error}</p>}
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Logging in...' : 'Login'}
                    </button>
                </form>
                <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
                    Don't have an account? <Link to="/register" style={{ color: 'var(--accent)' }}>Register</Link>
                </p>
            </div>
        </div>
    );
};

export default Login;
