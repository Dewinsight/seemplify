import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../../api';

const VerifyOtp: React.FC = () => {
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const email = location.state?.email;

    if (!email) {
        // Fallback if accessed directly without email state
        // In real app, might redirect to login or show email input
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
                    <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Verifying...' : 'Verify Me'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default VerifyOtp;
