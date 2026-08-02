/**
 * Seed and reconcile governance configuration for all organizations.
 *
 * Usage:
 *   node scripts/seedGovernancePoliciesAndRoles.js
 *   node scripts/seedGovernancePoliciesAndRoles.js --force-policy-sync
 *   node scripts/seedGovernancePoliciesAndRoles.js --clear-non-admin-roles
 *   node scripts/seedGovernancePoliciesAndRoles.js --dry-run
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const Role = require('../models/Role');
const UserOrganization = require('../models/UserOrganization');
const { ensureGovernanceConfigForOrganization } = require('../services/governanceConfigService');
const { sanitizePermissions } = require('../utils/access');

const args = process.argv.slice(2);
const forcePolicySync = args.includes('--force-policy-sync');
const forceRoleSync = args.includes('--force-role-sync');
const clearNonAdminRoles = args.includes('--clear-non-admin-roles');
const dryRun = args.includes('--dry-run');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB\n');
        console.log(`Options: forcePolicySync=${forcePolicySync}, forceRoleSync=${forceRoleSync}, clearNonAdminRoles=${clearNonAdminRoles}, dryRun=${dryRun}\n`);

        const organizations = await Organization.find({});
        if (organizations.length === 0) {
            console.log('No organizations found.');
            await mongoose.connection.close();
            process.exit(0);
            return;
        }

        let totalMembershipUpdates = 0;

        for (const organization of organizations) {
            await ensureGovernanceConfigForOrganization(organization._id, { forcePolicySync, forceRoleSync });

            const activeRoles = await Role.find({ organization: organization._id, isActive: true }, 'key');
            const validRoleKeys = new Set(activeRoles.map(role => role.key));
            const memberships = await UserOrganization.find({ organization: organization._id });

            let orgMembershipUpdates = 0;

            for (const membership of memberships) {
                const original = JSON.stringify(membership.permissions || []);
                let nextPermissions;

                if (!membership.isAdmin && clearNonAdminRoles) {
                    nextPermissions = [];
                } else {
                    nextPermissions = sanitizePermissions(
                        membership.permissions || [],
                        validRoleKeys.size > 0 ? validRoleKeys : null
                    );
                }

                const changed = original !== JSON.stringify(nextPermissions);
                if (!changed) continue;

                orgMembershipUpdates++;
                totalMembershipUpdates++;

                if (!dryRun) {
                    membership.permissions = nextPermissions;
                    await membership.save();
                }
            }

            console.log(`${organization.name} (${organization.slug}): ${orgMembershipUpdates} membership update(s)`);
        }

        console.log(`\nDone. Total membership updates: ${totalMembershipUpdates}${dryRun ? ' (dry run only)' : ''}.`);
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Governance seed/reconcile failed:', error);
        process.exit(1);
    }
}

run();
