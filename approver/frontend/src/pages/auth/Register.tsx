import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api';

interface Department {
    _id: string;
    name: string;
    description: string;
}

const Register: React.FC = () => {
    const [form, setForm] = useState({ username: '', email: '', password: '', department: '' });
    const [departments, setDepartments] = useState<Department[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        fetchDepartments();
    }, []);

    const fetchDepartments = async () => {
        try {
            const res = await api.get('/departments');
            setDepartments(res.data);
            // Default to first if available and not set? No, let user choose or 'General' default
            const general = res.data.find((d: Department) => d.name === 'General');
            if (general) {
                setForm(f => ({ ...f, department: general._id }));
            } else if (res.data.length > 0) {
                setForm(f => ({ ...f, department: res.data[0]._id }));
            }
        } catch (err) {
            console.error('Failed to fetch departments', err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await api.post('/auth/register', form);
            // Check if user already exists but needs verification
            if (res.data.needsVerification) {
                navigate('/verify', { state: { email: res.data.email } });
            } else {
                // New registration - redirect to verify
                navigate('/verify', { state: { email: form.email } });
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: '450px', margin: '4rem auto', textAlign: 'center' }}>
            <h2 style={{ marginBottom: '2rem' }}>Create Account</h2>
            <div className="glass-panel">
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Username"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        required
                        style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                    />
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                        style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                    />

                    <div style={{ textAlign: 'left' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Department</label>
                        <select
                            value={form.department}
                            onChange={(e) => setForm({ ...form, department: e.target.value })}
                            required
                            style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                        >
                            {departments.map(dept => (
                                <option key={dept._id} value={dept._id}>{dept.name}</option>
                            ))}
                        </select>
                    </div>

                    <input
                        type="password"
                        placeholder="Choose Password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                        style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
                    />

                    {error && <p style={{ color: '#ff6b6b', margin: '0' }}>{error}</p>}

                    <button type="submit" className="btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '1rem' }} disabled={loading}>
                        {loading ? 'Creating Account...' : 'Sign Up'}
                    </button>
                </form>
                <p style={{ marginTop: '1.5rem', color: 'var(--text-secondary)' }}>
                    Already have an account? <Link to="/login" style={{ color: 'var(--accent)' }}>Login</Link>
                </p>
            </div>
        </div>
    );
};

export default Register;
