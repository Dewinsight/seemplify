import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../api';

const Logo = () => (
    <div style={{ marginBottom: '2rem' }}>
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" style={{ display: 'inline-block', marginBottom: '1rem' }}>
            <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#rpGrad)" />
            <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#rpGrad)" opacity="0.8" />
            <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#rpGrad)" opacity="0.8" />
            <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#rpGrad)" opacity="0.6" />
            <defs>
                <linearGradient id="rpGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#9B51E0" />
                    <stop offset="100%" stopColor="#7B3FC0" />
                </linearGradient>
            </defs>
        </svg>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>MOSAIC</h1>
    </div>
);

const OTP_LENGTH = 6;

const ResetPassword: React.FC = () => {
    const [searchParams] = useSearchParams();
    const emailFromUrl = searchParams.get('email') || '';

    const [email, setEmail] = useState(emailFromUrl);
    const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();

    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Auto-focus first box on mount
    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, []);

    const handleDigitChange = (index: number, value: string) => {
        // Allow paste of full code
        if (value.length > 1) {
            const pasted = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
            const newDigits = [...digits];
            for (let i = 0; i < OTP_LENGTH; i++) {
                newDigits[i] = pasted[i] || '';
            }
            setDigits(newDigits);
            const nextFocus = Math.min(pasted.length, OTP_LENGTH - 1);
            inputRefs.current[nextFocus]?.focus();
            return;
        }
        const char = value.replace(/\D/g, '');
        const newDigits = [...digits];
        newDigits[index] = char;
        setDigits(newDigits);
        if (char && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            if (digits[index]) {
                const newDigits = [...digits];
                newDigits[index] = '';
                setDigits(newDigits);
            } else if (index > 0) {
                inputRefs.current[index - 1]?.focus();
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const otp = digits.join('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (otp.length < OTP_LENGTH) {
            setError('Please enter all 6 digits of the reset code');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);
        try {
            await api.post('/auth/reset-password', { email, otp, newPassword });
            setSuccess(true);
            setTimeout(() => navigate('/login'), 3000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to reset password. Check your code and try again.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
                <Logo />
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%',
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '2px solid rgba(16, 185, 129, 0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        fontSize: '1.75rem'
                    }}>✅</div>
                    <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Password Reset!</h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        Your password has been reset successfully.
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>
                        Redirecting to login...
                    </p>
                    <Link
                        to="/login"
                        style={{ display: 'inline-block', marginTop: '1.5rem', color: 'var(--accent)', textDecoration: 'none' }}
                    >
                        Go to Login
                    </Link>
                </div>
            </div>
        );
    }

    const digitBoxStyle = (filled: boolean): React.CSSProperties => ({
        width: '48px',
        height: '56px',
        textAlign: 'center',
        fontSize: '1.4rem',
        fontWeight: 700,
        borderRadius: '10px',
        border: filled ? '2px solid var(--brand-primary, #9B51E0)' : '1px solid var(--glass-border)',
        background: filled ? 'rgba(155, 81, 224, 0.08)' : 'var(--glass-bg)',
        color: 'var(--text-primary)',
        outline: 'none',
        transition: 'border-color 0.15s, background 0.15s',
        caretColor: 'var(--brand-primary, #9B51E0)',
    });

    return (
        <div style={{ maxWidth: '420px', margin: '4rem auto', textAlign: 'center' }}>
            <Logo />
            <h2 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Create New Password</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                Enter the 6-digit code sent to your email and choose a new password
            </p>

            <div className="glass-panel">
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Email (pre-filled, editable) */}
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        style={{ marginBottom: 0 }}
                    />

                    {/* 6-digit OTP boxes */}
                    <div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.6rem', textAlign: 'left' }}>
                            Reset Code <span style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>(from your email)</span>
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            {digits.map((d, i) => (
                                <input
                                    key={i}
                                    ref={el => { inputRefs.current[i] = el; }}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={OTP_LENGTH}
                                    value={d}
                                    onChange={e => handleDigitChange(i, e.target.value)}
                                    onKeyDown={e => handleKeyDown(i, e)}
                                    onFocus={e => e.target.select()}
                                    style={digitBoxStyle(!!d)}
                                    autoComplete="one-time-code"
                                />
                            ))}
                        </div>
                    </div>

                    {/* New Password */}
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showNew ? 'text' : 'password'}
                            placeholder="New Password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={6}
                            style={{ marginBottom: 0, paddingRight: '2.75rem', width: '100%' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowNew(v => !v)}
                            style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}
                            tabIndex={-1}
                        >
                            {showNew
                                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                            }
                        </button>
                    </div>

                    {/* Confirm Password */}
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showConfirm ? 'text' : 'password'}
                            placeholder="Confirm New Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            minLength={6}
                            style={{ marginBottom: 0, paddingRight: '2.75rem', width: '100%' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirm(v => !v)}
                            style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}
                            tabIndex={-1}
                        >
                            {showConfirm
                                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                            }
                        </button>
                    </div>

                    {/* Password match indicator */}
                    {confirmPassword && (
                        <p style={{ fontSize: '0.8rem', margin: '-0.25rem 0 0', textAlign: 'left', color: newPassword === confirmPassword ? '#10b981' : '#ef4444' }}>
                            {newPassword === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                        </p>
                    )}

                    {error && (
                        <p style={{ color: '#ff6b6b', margin: 0, fontSize: '0.875rem', textAlign: 'left' }}>
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        className="btn-primary"
                        style={{ width: '100%', marginTop: '0.25rem' }}
                        disabled={loading || otp.length < OTP_LENGTH}
                    >
                        {loading ? 'Resetting...' : 'Reset Password'}
                    </button>
                </form>

                <p style={{ marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Didn't get a code?{' '}
                    <Link to="/forgot-password" style={{ color: 'var(--accent)' }}>Resend</Link>
                    {' · '}
                    <Link to="/login" style={{ color: 'var(--accent)' }}>Back to Login</Link>
                </p>
            </div>
        </div>
    );
};

export default ResetPassword;
