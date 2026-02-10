/**
 * Seed rules for tonyegboo@gmail.com's General and Product organizations
 * Run with: node scripts/seedRulesForTony.js
 *
 * Prerequisites:
 * - Organizations with slug "general" and "product" must exist
 * - User tonyegboo@gmail.com should have membership in these orgs
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');
const Organization = require('../models/Organization');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const Department = require('../models/Department');

// Default approval rules (from seedRules.js)
const defaultRules = [
    { name: 'Budget Threshold', description: 'Projects with budget over $500,000 require executive approval.', criteria: 'Reject if budget exceeds $500,000 without executive sponsor approval or detailed ROI analysis showing payback within 2 years.', category: 'Other', isActive: true },
    { name: 'Security Compliance', description: 'All projects must meet security standards.', criteria: 'Reject if project handles customer data but does not include: encryption at rest and in transit, role-based access control (RBAC), and compliance with SOC 2 or equivalent standards.', category: 'Security', isActive: true },
    { name: 'Timeline Reasonability', description: 'Timelines must be realistic for scope.', criteria: 'Flag for review if complex migrations are scheduled for less than 3 months, or if team size appears insufficient for timeline.', category: 'Other', isActive: true },
    { name: 'Technology Stack Approval', description: 'Use approved technology stacks.', criteria: 'Approved stacks: React/Angular/Vue frontend, Node.js/Java/Python backend, PostgreSQL/MongoDB databases. Flag projects using unapproved technologies unless justified.', category: 'Architecture', isActive: true },
    { name: 'Team Composition', description: 'Adequate staffing requirements.', criteria: 'Recommend 1 DevOps engineer per 5 developers for cloud projects. Flag if no DevOps is allocated for cloud-deployed applications.', category: 'Other', isActive: true },
    { name: 'Third-Party Integration Risk', description: 'External integrations need fallbacks.', criteria: 'Require fallback mechanisms and SLA documentation for any external system integrations (CRM, Payment gateways, third-party APIs).', category: 'Architecture', isActive: true },
    { name: 'Documentation Requirement', description: 'Projects must include documentation.', criteria: 'All approved projects must commit to delivering: architecture diagrams, API documentation, and deployment runbooks before go-live.', category: 'Other', isActive: true }
];

// Escalation rules (from seedEscalationRules.js)
const escalationRules = [
    { name: 'HR: Recruitment/Candidate Selection AI', description: 'Automatically escalates to Tier 3 if AI is used for recruitment screening or candidate selection', criteria: 'Check if the initiative involves AI for recruitment, hiring, candidate screening, resume filtering, or job applicant selection. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'HR: Performance/Promotion AI', description: 'Automatically escalates to Tier 3 if AI is used for performance evaluation or promotion recommendations', criteria: 'Check if the initiative involves AI for employee performance evaluation, performance scoring, promotion recommendations, or career advancement decisions. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'HR: Termination/Discipline AI', description: 'Automatically escalates to Tier 3 if AI is used for termination or discipline recommendations', criteria: 'Check if the initiative involves AI for employee termination decisions, disciplinary actions, or workforce reduction recommendations. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'HR: Compensation/Benefits AI', description: 'Automatically escalates to Tier 3 if AI is used for compensation or benefits determination', criteria: 'Check if the initiative involves AI for salary determination, benefits allocation, compensation decisions, or pay structure recommendations. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Customer: Automated Credit Decisions', description: 'Automatically escalates to Tier 3 if AI makes credit approval/denial without human review', criteria: 'Check if the initiative involves AI for automated credit approval, loan denial, credit scoring without human review, or autonomous lending decisions. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Customer: Insurance Underwriting/Claims AI', description: 'Automatically escalates to Tier 3 if AI is used for insurance underwriting or claims decisions', criteria: 'Check if the initiative involves AI for insurance underwriting, claims processing decisions, policy approval/denial, or coverage determination. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Customer: Account Closure/Service Denial AI', description: 'Automatically escalates to Tier 3 if AI is used for account closure or service denial', criteria: 'Check if the initiative involves AI for automated account closure, service termination, customer offboarding, or denial of banking services. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Customer: Pricing/Terms AI', description: 'Automatically escalates to Tier 3 if AI determines pricing or terms affecting customer outcomes', criteria: 'Check if the initiative involves AI for personalized pricing, interest rate determination, fee setting, or terms that directly affect customer financial outcomes. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Data: Biometric Processing', description: 'Automatically escalates to Tier 3 if AI processes biometric data', criteria: 'Check if the initiative involves processing biometric data including facial recognition, fingerprint scanning, voice recognition, iris scanning, or other biometric identifiers. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Data: Health/Medical Information', description: 'Automatically escalates to Tier 3 if AI processes health or medical information', criteria: 'Check if the initiative involves processing health records, medical history, health conditions, medical diagnoses, or any health-related personal data. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Data: Children\'s Data', description: 'Automatically escalates to Tier 3 if AI processes children\'s data', criteria: 'Check if the initiative involves processing data of minors (under 18), children\'s accounts, youth programs, or services targeting children. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Data: Aggregated Sensitive Financial Data', description: 'Automatically escalates to Tier 3 if AI processes aggregated sensitive financial data beyond standard banking', criteria: 'Check if the initiative involves aggregating sensitive financial data across multiple sources, deep financial profiling, wealth analysis, or financial data beyond standard transactional banking. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Risk: High-Visibility Public AI', description: 'Automatically escalates to Tier 3 if AI is public-facing with high brand visibility', criteria: 'Check if the initiative involves public-facing AI with significant brand visibility, customer interaction AI, marketing AI with wide reach, or AI that represents the bank publicly. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Risk: Vulnerable Populations', description: 'Automatically escalates to Tier 3 if AI systems target vulnerable populations', criteria: 'Check if the initiative involves AI systems serving vulnerable populations including elderly, disabled, financially distressed, or other protected groups. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Risk: Novel AI Without Precedent', description: 'Automatically escalates to Tier 3 if using novel AI without industry precedent', criteria: 'Check if the initiative involves novel AI technology, experimental approaches, first-of-its-kind in the industry, or AI without established industry precedent. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true },
    { name: 'Risk: Cross-Border High-Risk Transfers', description: 'Automatically escalates to Tier 3 if AI involves cross-border transfers to high-risk jurisdictions', criteria: 'Check if the initiative involves cross-border data transfers, international AI processing, or data movement to high-risk jurisdictions with weak data protection. If YES, this triggers mandatory Tier 3 escalation.', weight: 10, isMandatory: true, department: null, isActive: true }
];

async function seedRulesForOrg(org, allRules) {
    let created = 0;
    let skipped = 0;

    for (const rule of allRules) {
        const existing = await Rule.findOne({ name: rule.name, organization: org._id });
        if (existing) {
            skipped++;
            continue;
        }
        const { category, ...ruleFields } = rule; // Rule schema has no category
        await Rule.create({ ...ruleFields, organization: org._id });
        created++;
    }
    return { created, skipped };
}

async function ensureOrg(name, slug, user) {
    let org = await Organization.findOne({ slug });
    if (org) return org;

    console.log(`Creating organization: ${name} (slug: ${slug})...`);
    org = await new Organization({
        name,
        slug,
        description: `Organization for ${name}`
    }).save();

    // Create General department
    const generalDept = await new Department({
        name: 'General',
        description: 'Default department',
        organization: org._id
    }).save();

    // Add user as admin if they exist
    if (user) {
        const existing = await UserOrganization.findOne({ user: user._id, organization: org._id });
        if (!existing) {
            await UserOrganization.create({
                user: user._id,
                organization: org._id,
                isAdmin: true,
                permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
            });
            console.log(`  Added tonyegboo@gmail.com as admin`);
        }
    }
    return org;
}

async function seedRulesForTony() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB\n');

        const targetOrgs = [
            { name: 'General', slug: 'general' },
            { name: 'Product', slug: 'product' }
        ];
        const user = await User.findOne({ email: 'tonyegboo@gmail.com' });

        if (!user) {
            console.log('Note: User tonyegboo@gmail.com not found in approver DB.');
            console.log('Orgs will be created/updated but user will not be added as member.\n');
        }

        const orgs = [];
        for (const { name, slug } of targetOrgs) {
            const org = await ensureOrg(name, slug, user);
            orgs.push(org);
        }

        const allRules = [...defaultRules, ...escalationRules];

        for (const org of orgs) {
            console.log(`Seeding rules for org: ${org.name} (slug: ${org.slug})...`);
            const { created, skipped } = await seedRulesForOrg(org, allRules);
            console.log(`  ✓ ${created} created, ${skipped} skipped (already existed)\n`);
        }

        console.log('Rules seeding complete for General and Product orgs!');
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error seeding rules:', error);
        process.exit(1);
    }
}

seedRulesForTony();
