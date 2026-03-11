import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../api';

const ResetPassword: React.FC = () => {
    const [searchParams] = useSearchParams();
    const emailFromUrl = searchParams.get('email') || '';
    
    const [email, setEmail] = useState(emailFromUrl);
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            setLoading(false);
            return;
        }

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            setLoading(false);
            return;
        }

        try {
            await api.post('/auth/reset-password', { email, otp, newPassword });
            setSuccess(true);
            setTimeout(() => navigate('/login'), 3000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to reset password');
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
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                    <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Password Reset!</h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        Your password has been reset successfully.
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>
                        Redirecting to login...
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
                        Go to Login
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
            <h2 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Create New Password</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>
                Enter the code from your email and create a new password
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
                    <input
                        type="text"
                        placeholder="Reset Code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        required
                        maxLength={6}
                    />
                    <input
                        type="password"
                        placeholder="New Password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                    />
                    <input
                        type="password"
                        placeholder="Confirm New Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                    />
                    {error && <p style={{ color: '#ff6b6b', margin: '0 0 1rem 0' }}>{error}</p>}
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Resetting...' : 'Reset Password'}
                    </button>
                </form>
                <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>
                    <Link to="/forgot-password" style={{ color: 'var(--accent)' }}>Resend code</Link>
                </p>
            </div>
        </div>
    );
};

export default ResetPassword;
