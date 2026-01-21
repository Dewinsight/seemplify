/**
 * Seed script to create Mandatory Escalation Trigger Rules
 * These are global rules that automatically escalate initiatives to Tier 3
 * Run with: node scripts/seedEscalationRules.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');

const escalationRules = [
    // 4.1 Employment & HR Decisions
    {
        name: 'HR: Recruitment/Candidate Selection AI',
        description: 'Automatically escalates to Tier 3 if AI is used for recruitment screening or candidate selection',
        criteria: 'Check if the initiative involves AI for recruitment, hiring, candidate screening, resume filtering, or job applicant selection. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null, // Global
        isActive: true
    },
    {
        name: 'HR: Performance/Promotion AI',
        description: 'Automatically escalates to Tier 3 if AI is used for performance evaluation or promotion recommendations',
        criteria: 'Check if the initiative involves AI for employee performance evaluation, performance scoring, promotion recommendations, or career advancement decisions. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'HR: Termination/Discipline AI',
        description: 'Automatically escalates to Tier 3 if AI is used for termination or discipline recommendations',
        criteria: 'Check if the initiative involves AI for employee termination decisions, disciplinary actions, or workforce reduction recommendations. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'HR: Compensation/Benefits AI',
        description: 'Automatically escalates to Tier 3 if AI is used for compensation or benefits determination',
        criteria: 'Check if the initiative involves AI for salary determination, benefits allocation, compensation decisions, or pay structure recommendations. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },

    // 4.2 Customer-Facing Automated Decisions
    {
        name: 'Customer: Automated Credit Decisions',
        description: 'Automatically escalates to Tier 3 if AI makes credit approval/denial without human review',
        criteria: 'Check if the initiative involves AI for automated credit approval, loan denial, credit scoring without human review, or autonomous lending decisions. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Customer: Insurance Underwriting/Claims AI',
        description: 'Automatically escalates to Tier 3 if AI is used for insurance underwriting or claims decisions',
        criteria: 'Check if the initiative involves AI for insurance underwriting, claims processing decisions, policy approval/denial, or coverage determination. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Customer: Account Closure/Service Denial AI',
        description: 'Automatically escalates to Tier 3 if AI is used for account closure or service denial',
        criteria: 'Check if the initiative involves AI for automated account closure, service termination, customer offboarding, or denial of banking services. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Customer: Pricing/Terms AI',
        description: 'Automatically escalates to Tier 3 if AI determines pricing or terms affecting customer outcomes',
        criteria: 'Check if the initiative involves AI for personalized pricing, interest rate determination, fee setting, or terms that directly affect customer financial outcomes. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },

    // 4.3 Sensitive Data Processing
    {
        name: 'Data: Biometric Processing',
        description: 'Automatically escalates to Tier 3 if AI processes biometric data',
        criteria: 'Check if the initiative involves processing biometric data including facial recognition, fingerprint scanning, voice recognition, iris scanning, or other biometric identifiers. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Data: Health/Medical Information',
        description: 'Automatically escalates to Tier 3 if AI processes health or medical information',
        criteria: 'Check if the initiative involves processing health records, medical history, health conditions, medical diagnoses, or any health-related personal data. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Data: Children\'s Data',
        description: 'Automatically escalates to Tier 3 if AI processes children\'s data',
        criteria: 'Check if the initiative involves processing data of minors (under 18), children\'s accounts, youth programs, or services targeting children. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Data: Aggregated Sensitive Financial Data',
        description: 'Automatically escalates to Tier 3 if AI processes aggregated sensitive financial data beyond standard banking',
        criteria: 'Check if the initiative involves aggregating sensitive financial data across multiple sources, deep financial profiling, wealth analysis, or financial data beyond standard transactional banking. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },

    // 4.4 Significant Reputational Risk
    {
        name: 'Risk: High-Visibility Public AI',
        description: 'Automatically escalates to Tier 3 if AI is public-facing with high brand visibility',
        criteria: 'Check if the initiative involves public-facing AI with significant brand visibility, customer interaction AI, marketing AI with wide reach, or AI that represents the bank publicly. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Risk: Vulnerable Populations',
        description: 'Automatically escalates to Tier 3 if AI systems target vulnerable populations',
        criteria: 'Check if the initiative involves AI systems serving vulnerable populations including elderly, disabled, financially distressed, or other protected groups. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Risk: Novel AI Without Precedent',
        description: 'Automatically escalates to Tier 3 if using novel AI without industry precedent',
        criteria: 'Check if the initiative involves novel AI technology, experimental approaches, first-of-its-kind in the industry, or AI without established industry precedent. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    },
    {
        name: 'Risk: Cross-Border High-Risk Transfers',
        description: 'Automatically escalates to Tier 3 if AI involves cross-border transfers to high-risk jurisdictions',
        criteria: 'Check if the initiative involves cross-border data transfers, international AI processing, or data movement to high-risk jurisdictions with weak data protection. If YES, this triggers mandatory Tier 3 escalation.',
        weight: 10,
        isMandatory: true,
        department: null,
        isActive: true
    }
];

async function seedEscalationRules() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        let created = 0;
        let skipped = 0;

        for (const rule of escalationRules) {
            // Check if rule already exists
            const existing = await Rule.findOne({ name: rule.name });
            if (existing) {
                console.log(`⏭️  Skipped (exists): ${rule.name}`);
                skipped++;
            } else {
                await Rule.create(rule);
                console.log(`✅ Created: ${rule.name}`);
                created++;
            }
        }

        console.log(`\n📊 Summary: ${created} created, ${skipped} skipped`);
        console.log('✅ Escalation rules seeding complete!');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error seeding escalation rules:', error);
        process.exit(1);
    }
}

seedEscalationRules();
