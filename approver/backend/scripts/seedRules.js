const axios = require('axios');

const seedRules = async () => {
    try {
        console.log('Seeding default approval rules...');

        const rules = [
            {
                name: 'Budget Threshold',
                description: 'Projects with budget over $500,000 require executive approval.',
                criteria: 'Reject if budget exceeds $500,000 without executive sponsor approval or detailed ROI analysis showing payback within 2 years.',
                category: 'Other',
                isActive: true
            },
            {
                name: 'Security Compliance',
                description: 'All projects must meet security standards.',
                criteria: 'Reject if project handles customer data but does not include: encryption at rest and in transit, role-based access control (RBAC), and compliance with SOC 2 or equivalent standards.',
                category: 'Security',
                isActive: true
            },
            {
                name: 'Timeline Reasonability',
                description: 'Timelines must be realistic for scope.',
                criteria: 'Flag for review if complex migrations are scheduled for less than 3 months, or if team size appears insufficient for timeline.',
                category: 'Other',
                isActive: true
            },
            {
                name: 'Technology Stack Approval',
                description: 'Use approved technology stacks.',
                criteria: 'Approved stacks: React/Angular/Vue frontend, Node.js/Java/Python backend, PostgreSQL/MongoDB databases. Flag projects using unapproved technologies unless justified.',
                category: 'Architecture',
                isActive: true
            },
            {
                name: 'Team Composition',
                description: 'Adequate staffing requirements.',
                criteria: 'Recommend 1 DevOps engineer per 5 developers for cloud projects. Flag if no DevOps is allocated for cloud-deployed applications.',
                category: 'Other',
                isActive: true
            },
            {
                name: 'Third-Party Integration Risk',
                description: 'External integrations need fallbacks.',
                criteria: 'Require fallback mechanisms and SLA documentation for any external system integrations (CRM, Payment gateways, third-party APIs).',
                category: 'Architecture',
                isActive: true
            },
            {
                name: 'Documentation Requirement',
                description: 'Projects must include documentation.',
                criteria: 'All approved projects must commit to delivering: architecture diagrams, API documentation, and deployment runbooks before go-live.',
                category: 'Other',
                isActive: true
            }
        ];

        // First login as admin to get token
        const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
            email: 'admin@approver.com',
            password: 'password123'
        });

        const token = loginRes.data.token;
        console.log('Logged in as admin');

        // Create each rule
        for (const rule of rules) {
            try {
                await axios.post('http://localhost:5000/api/rules', rule, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log(`✓ Created rule: ${rule.name}`);
            } catch (error) {
                if (error.response?.status === 400) {
                    console.log(`  Rule already exists: ${rule.name}`);
                } else {
                    console.error(`  Failed to create: ${rule.name}`, error.message);
                }
            }
        }

        console.log('\nDone seeding rules!');
    } catch (error) {
        console.error('Seed failed:', error.response?.data || error.message);
    }
};

seedRules();
