'use strict';

const crypto = require('node:crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const UserOrganization = require('../models/UserOrganization');
const { ensureGovernanceConfigForOrganization } = require('./governanceConfigService');

const APPROVER_APP_ID = 'approver';
const ADMIN_ROLES = new Set(['owner', 'admin']);

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function canAccessApprover(organization = {}) {
    const access = organization.appAccess;
    if (!access || text(access.mode).toLowerCase() !== 'selected') return true;
    return Array.isArray(access.appIds) && access.appIds.map(text).includes(APPROVER_APP_ID);
}

function entitledOrganizations(claims = {}) {
    return (Array.isArray(claims.organizations) ? claims.organizations : [])
        .filter((organization) => text(organization?.id) && canAccessApprover(organization));
}

function splitName(claims = {}) {
    const displayName = text(claims.name);
    const parts = displayName.split(/\s+/).filter(Boolean);
    return {
        firstName: text(claims.given_name) || parts[0] || 'Seemplify',
        lastName: text(claims.family_name) || parts.slice(1).join(' ') || 'User'
    };
}

function usernameFor(claims = {}) {
    const preferred = text(claims.preferred_username) || text(claims.email).split('@')[0] || 'user';
    const safe = preferred.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^-|-$)/g, '') || 'user';
    const suffix = crypto.createHash('sha256').update(text(claims.sub)).digest('hex').slice(0, 8);
    return `${safe}-${suffix}`;
}

function slugFor(name, id) {
    const base = text(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'organization';
    const suffix = crypto.createHash('sha256').update(text(id)).digest('hex').slice(0, 8);
    return `${base}-${suffix}`;
}

async function findOrProvisionUser(claims) {
    const subject = text(claims.sub);
    const email = text(claims.email).toLowerCase();
    if (!subject || !email || claims.email_verified !== true) {
        const error = new Error('The identity provider did not return a verified email and stable subject.');
        error.code = 'OIDC_IDENTITY_INCOMPLETE';
        throw error;
    }

    let user = await User.findOne({ idpSubject: subject });
    if (!user) {
        user = await User.findOne({ email });
        if (user?.idpSubject && user.idpSubject !== subject) {
            const error = new Error('This email is already linked to a different identity.');
            error.code = 'OIDC_ACCOUNT_CONFLICT';
            throw error;
        }
    }

    const names = splitName(claims);
    if (!user) {
        user = new User({
            username: usernameFor(claims),
            email,
            ...names,
            idpSubject: subject,
            authProvider: 'seemplify-idp',
            isVerified: true,
            lastLoginAt: new Date()
        });
    } else {
        user.idpSubject = subject;
        user.authProvider = 'seemplify-idp';
        user.isVerified = true;
        user.firstName = names.firstName || user.firstName;
        user.lastName = names.lastName || user.lastName;
        user.lastLoginAt = new Date();
    }
    await user.save();
    return user;
}

async function findOrProvisionOrganization(claim) {
    const idpOrganizationId = text(claim.id);
    const name = text(claim.name) || 'Seemplify Organization';
    let organization = await Organization.findOne({ idpOrganizationId });
    if (!organization) {
        const duplicateName = await Organization.exists({ name });
        organization = await Organization.create({
            name: duplicateName ? `${name} (${idpOrganizationId.slice(-6)})` : name,
            slug: slugFor(name, idpOrganizationId),
            idpOrganizationId,
            description: 'Provisioned from Seemplify Identity'
        });
    }
    return organization;
}

async function syncMembership(user, organization, claim) {
    await ensureGovernanceConfigForOrganization(organization._id);
    const department = await Department.findOneAndUpdate(
        { name: 'General', organization: organization._id },
        { $setOnInsert: { name: 'General', organization: organization._id, description: 'Default IdP-provisioned department' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const idpRole = text(claim.role).toLowerCase();
    const isAdmin = ADMIN_ROLES.has(idpRole);
    const defaultRole = isAdmin ? 'ExecutiveApprover' : 'Requester';
    const membership = await UserOrganization.findOne({ user: user._id, organization: organization._id });

    if (!membership) {
        return UserOrganization.create({
            user: user._id,
            organization: organization._id,
            managedByIdp: true,
            idpRole,
            isAdmin,
            permissions: [{ department: department._id, roles: [defaultRole] }]
        });
    }

    membership.managedByIdp = true;
    membership.idpRole = idpRole;
    membership.isAdmin = isAdmin;
    if (!Array.isArray(membership.permissions) || membership.permissions.length === 0) {
        membership.permissions = [{ department: department._id, roles: [defaultRole] }];
    }
    await membership.save();
    return membership;
}

async function provisionIdentity(claims = {}) {
    const organizations = entitledOrganizations(claims);
    if (organizations.length === 0) {
        const error = new Error('Your current Seemplify organization has not granted access to Approver.');
        error.code = 'APPROVER_ACCESS_DENIED';
        throw error;
    }

    const user = await findOrProvisionUser(claims);
    const localByIdpId = new Map();
    for (const claim of organizations) {
        const organization = await findOrProvisionOrganization(claim);
        localByIdpId.set(text(claim.id), organization);
        await syncMembership(user, organization, claim);
    }

    const entitledIds = organizations.map((organization) => text(organization.id));
    const staleOrganizations = await Organization.find({
        idpOrganizationId: { $nin: entitledIds, $exists: true }
    }).select('_id');
    if (staleOrganizations.length > 0) {
        await UserOrganization.deleteMany({
            user: user._id,
            managedByIdp: true,
            organization: { $in: staleOrganizations.map((organization) => organization._id) }
        });
    }

    const current = claims.current_organization || claims.currentOrganization;
    const currentLocal = current?.id ? localByIdpId.get(text(current.id)) : null;
    user.organization = currentLocal?._id || localByIdpId.values().next().value?._id || null;
    await user.save();
    return user;
}

async function invalidateIdentitySession({ subject, organizationId, removeMembership = false } = {}) {
    const user = await User.findOneAndUpdate(
        { idpSubject: text(subject) },
        { $inc: { sessionVersion: 1 } },
        { new: true }
    );
    if (!user || !removeMembership || !text(organizationId)) return Boolean(user);
    const organization = await Organization.findOne({ idpOrganizationId: text(organizationId) }).select('_id');
    if (organization) {
        await UserOrganization.deleteOne({ user: user._id, organization: organization._id, managedByIdp: true });
    }
    return true;
}

module.exports = {
    APPROVER_APP_ID,
    canAccessApprover,
    entitledOrganizations,
    invalidateIdentitySession,
    provisionIdentity,
    slugFor,
    splitName,
    usernameFor
};
