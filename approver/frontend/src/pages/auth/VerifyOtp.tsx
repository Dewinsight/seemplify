import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../../api';

const VerifyOtp: React.FC = () => {
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendLoading, setResendLoading] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const email = location.state?.email;

    if (!email) {
        // Fallback if accessed directly without email state
        return <div style={{ textAlign: 'center', marginTop: '2rem' }}>Error: No email provided for verification. Please <Link to="/login">Login</Link> or <Link to="/register">Register</Link>.</div>;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.post('/auth/verify', { email, otp });
            alert('Verification successful! Please login.');
            navigate('/login');
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setResendLoading(true);
        setResendSuccess(false);
        setError('');
        try {
            await api.post('/auth/resend-otp', { email });
            setResendSuccess(true);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to resend code');
        } finally {
            setResendLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
            <h2 style={{ marginBottom: '2rem' }}>Verify Email</h2>
            <div className="glass-panel">
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                    Enter the code sent to <strong>{email}</strong>
                </p>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        placeholder="Enter OTP Code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        required
                        style={{ textAlign: 'center', letterSpacing: '2px', fontSize: '1.2rem' }}
                    />
                    {error && <p style={{ color: '#ff6b6b', margin: '0 0 1rem 0' }}>{error}</p>}
                    {resendSuccess && <p style={{ color: '#10b981', margin: '0 0 1rem 0' }}>New code sent. Check your email.</p>}
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Verifying...' : 'Verify Me'}
                    </button>
                </form>
                <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Didn&apos;t receive the code?{' '}
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendLoading}
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: resendLoading ? 'not-allowed' : 'pointer', textDecoration: 'underline', padding: 0, fontSize: 'inherit' }}
                    >
                        {resendLoading ? 'Sending...' : 'Resend'}
                    </button>
                </p>
            </div>
        </div>
    );
};

export default VerifyOtp;
