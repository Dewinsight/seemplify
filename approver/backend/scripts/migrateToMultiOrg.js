/**
 * Migration Script: Single-Org → Multi-Org
 *
 * Run once: node scripts/migrateToMultiOrg.js
 *
 * Steps:
 * 1. Create "Testing" organization
 * 2. Assign all existing users to Testing org
 * 3. Assign all departments to Testing org
 * 4. Assign all projects to Testing org
 * 5. Assign all rules to Testing org
 * 6. Assign all audits to Testing org
 * 7. Create/update Settings for Testing org
 * 8. Verify migration
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Organization = require('../models/Organization');
const User = require('../models/User');
const Department = require('../models/Department');
const Project = require('../models/Project');
const Rule = require('../models/Rule');
const Audit = require('../models/Audit');
const Settings = require('../models/Settings');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/mosaic-approver';

async function migrate() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.\n');

    // Step 1: Create Testing organization
    console.log('Step 1: Creating "Testing" organization...');
    let testingOrg = await Organization.findOne({ slug: 'testing' });
    if (!testingOrg) {
        testingOrg = await new Organization({
            name: 'Testing',
            slug: 'testing',
            description: 'Default migration organization for existing data'
        }).save();
        console.log(`  Created: ${testingOrg._id}`);
    } else {
        console.log(`  Already exists: ${testingOrg._id}`);
    }

    // Step 2: Update all Users
    console.log('\nStep 2: Migrating Users...');
    const userResult = await User.updateMany(
        { organization: null },
        { $set: { organization: testingOrg._id } }
    );
    console.log(`  Updated: ${userResult.modifiedCount} users`);

    // Step 3: Update all Departments
    console.log('\nStep 3: Migrating Departments...');
    const deptResult = await Department.updateMany(
        { organization: { $exists: false } },
        { $set: { organization: testingOrg._id } }
    );
    // Also catch null values
    const deptResult2 = await Department.updateMany(
        { organization: null },
        { $set: { organization: testingOrg._id } }
    );
    console.log(`  Updated: ${deptResult.modifiedCount + deptResult2.modifiedCount} departments`);

    // Step 4: Update all Projects
    console.log('\nStep 4: Migrating Projects...');
    const projResult = await Project.updateMany(
        { $or: [{ organization: { $exists: false } }, { organization: null }] },
        { $set: { organization: testingOrg._id } }
    );
    console.log(`  Updated: ${projResult.modifiedCount} projects`);

    // Step 5: Update all Rules
    console.log('\nStep 5: Migrating Rules...');
    const ruleResult = await Rule.updateMany(
        { $or: [{ organization: { $exists: false } }, { organization: null }] },
        { $set: { organization: testingOrg._id } }
    );
    console.log(`  Updated: ${ruleResult.modifiedCount} rules`);

    // Step 6: Update all Audits
    console.log('\nStep 6: Migrating Audits...');
    const auditResult = await Audit.updateMany(
        { $or: [{ organization: { $exists: false } }, { organization: null }] },
        { $set: { organization: testingOrg._id } }
    );
    console.log(`  Updated: ${auditResult.modifiedCount} audits`);

    // Step 7: Settings
    console.log('\nStep 7: Migrating Settings...');
    const settings = await Settings.findOne({});
    if (settings && !settings.organization) {
        settings.organization = testingOrg._id;
        await settings.save();
        console.log('  Updated existing settings doc');
    } else if (!settings) {
        await new Settings({ organization: testingOrg._id }).save();
        console.log('  Created settings for Testing org');
    } else {
        console.log('  Settings already has organization');
    }

    // Step 8: Drop old unique index on Department.name (if exists) and ensure compound index
    console.log('\nStep 8: Updating Department indexes...');
    try {
        const collection = mongoose.connection.db.collection('departments');
        const indexes = await collection.indexes();
        const nameIndex = indexes.find(i => i.key && i.key.name === 1 && !i.key.organization);
        if (nameIndex) {
            await collection.dropIndex(nameIndex.name);
            console.log(`  Dropped old index: ${nameIndex.name}`);
        } else {
            console.log('  No old name-only unique index found');
        }
    } catch (err) {
        console.log(`  Index cleanup note: ${err.message}`);
    }

    // Step 9: Verify
    console.log('\nStep 9: Verification...');
    const nullUsers = await User.countDocuments({ organization: null });
    const nullDepts = await Department.countDocuments({ $or: [{ organization: { $exists: false } }, { organization: null }] });
    const nullProjects = await Project.countDocuments({ $or: [{ organization: { $exists: false } }, { organization: null }] });
    const nullRules = await Rule.countDocuments({ $or: [{ organization: { $exists: false } }, { organization: null }] });
    const nullAudits = await Audit.countDocuments({ $or: [{ organization: { $exists: false } }, { organization: null }] });

    console.log(`  Users without org: ${nullUsers}`);
    console.log(`  Departments without org: ${nullDepts}`);
    console.log(`  Projects without org: ${nullProjects}`);
    console.log(`  Rules without org: ${nullRules}`);
    console.log(`  Audits without org: ${nullAudits}`);

    const total = nullUsers + nullDepts + nullProjects + nullRules + nullAudits;
    if (total === 0) {
        console.log('\n  Migration complete! All records have an organization.');
    } else {
        console.log(`\n  WARNING: ${total} records still missing organization.`);
    }

    await mongoose.disconnect();
    console.log('\nDone.');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
