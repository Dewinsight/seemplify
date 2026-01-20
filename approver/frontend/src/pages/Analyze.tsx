import React, { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';

const sampleProject = {
    name: 'Customer Portal Modernization',
    description: `Project Overview:
We are proposing to modernize our legacy customer portal from a monolithic PHP application to a modern microservices architecture.

Technical Stack:
- Frontend: React 18 with TypeScript
- Backend: Node.js with Express
- Database: PostgreSQL (migrating from MySQL)
- Cloud: AWS (ECS, RDS, S3)
- Authentication: OAuth 2.0 with Cognito

Budget: $250,000
Timeline: 6 months
Team Size: 5 developers + 1 DevOps

Key Features:
1. Real-time dashboard with customer analytics
2. Self-service account management
3. Document upload and processing
4. Integration with existing CRM (Salesforce)
5. Mobile-responsive design

Security Considerations:
- All data encrypted at rest and in transit
- Role-based access control (RBAC)
- SOC 2 compliance required
- Regular penetration testing

Risk Assessment:
- Data migration complexity: Medium
- Third-party integration risks: Low
- Timeline risk: Medium (aggressive deadline)`,
    repoUrl: 'https://github.com/sterling-bank/customer-portal-v2'
};

const Analyze: React.FC = () => {
    const navigate = useNavigate();
    const [form, setForm] = useState({ name: '', description: '', repoUrl: '' });
    const [analyzing, setAnalyzing] = useState(false);

    const fillSample = () => {
        setForm(sampleProject);
    };

    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAnalyzing(true);
        setError('');
        try {
            const res = await api.post('/projects/analyze', form);
            navigate(`/projects/${res.data.projectId || res.data._id}`);
        } catch (err: any) {
            console.error('Error analyzing project:', err);
            const errorMsg = err.response?.data?.error || 'Analysis failed. Please try again.';
            setError(errorMsg);
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div>
            <h2 style={{ marginBottom: '2rem' }}>New Project Analysis</h2>

            <div className="glass-panel" style={{ maxWidth: '600px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                        Submit a project for automated AI approval based on your defined rules.
                    </p>
                    <button
                        type="button"
                        onClick={fillSample}
                        style={{
                            background: 'var(--sterling-gold)',
                            color: 'white',
                            border: 'none',
                            padding: '0.5rem 1rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        📝 Fill Sample
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Name</label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                        placeholder="e.g., Customer Portal Modernization"
                    />

                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Repository URL (Optional)</label>
                    <input
                        type="text"
                        value={form.repoUrl}
                        onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
                        placeholder="e.g., https://github.com/org/project"
                    />

                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Project Description / Context</label>
                    <textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        required
                        rows={12}
                        placeholder="Include: project overview, tech stack, budget, timeline, team size, key features, security requirements, and risk assessment..."
                    />

                    {error && (
                        <div style={{
                            background: 'rgba(244, 67, 54, 0.1)',
                            border: '1px solid #f44336',
                            borderRadius: '8px',
                            padding: '1rem',
                            marginTop: '1rem',
                            color: '#f44336'
                        }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" disabled={analyzing} style={{ width: '100%', marginTop: '1rem' }}>
                        {analyzing ? 'AI Analyzing Project...' : 'Start Analysis'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Analyze;
