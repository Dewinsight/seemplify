'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const Organization = require('../../models/Organization');
const { AIRuntimeError } = require('./aiRuntimeService');

function identityError(message, code = 'SHARED_AI_IDENTITY_INVALID', statusCode = 400) {
  return new AIRuntimeError(message, { code, statusCode, retryable: false });
}

function normalizeIdentity(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const sub = String(candidate.sub || '').trim();
  const email = String(candidate.email || '').trim().toLowerCase();
  const organizationId = String(candidate.organizationId || '').trim();
  const organizationName = String(candidate.organizationName || '').trim().slice(0, 200);
  const displayName = String(candidate.displayName || '').trim().slice(0, 200);
  if (!sub || sub.length > 255 || !/^[\x21-\x7e]+$/.test(sub)) {
    throw identityError('A valid identity-provider subject is required.');
  }
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw identityError('A valid identity-provider email is required.');
  }
  if (organizationId.length > 255) throw identityError('The identity organization is invalid.');
  return { sub, email, organizationId, organizationName, displayName };
}

async function localOrganization(identity, dependencies = {}) {
  if (!identity.organizationId) return null;
  const findOrganization = dependencies.findOrganization || ((idpOrganizationId) => (
    Organization.findOne({ idpOrganizationId }).select('_id name').lean()
  ));
  return findOrganization(identity.organizationId);
}

/**
 * Resolve a signed cross-app identity to Recruiter's canonical local user.
 * Existing users keep their Mongo ObjectId, which in turn preserves the
 * gateway subject holding their current ChatGPT credential. A Performance-only
 * user receives a dormant OIDC shadow row; no password or app authorization is
 * derived from the caller's identity claims.
 */
async function resolveSharedPrincipal(rawIdentity, dependencies = {}) {
  const identity = normalizeIdentity(rawIdentity);
  const findBySubject = dependencies.findBySubject || ((sub) => User.findOne({ idpSubject: sub }));
  const findByEmail = dependencies.findByEmail || ((email) => User.findOne({ email }));
  const createUser = dependencies.createUser || ((data) => User.create(data));

  const [userBySubject, userByEmail, organization] = await Promise.all([
    findBySubject(identity.sub),
    findByEmail(identity.email),
    localOrganization(identity, dependencies)
  ]);
  if (userBySubject && userByEmail && String(userBySubject._id) !== String(userByEmail._id)) {
    throw identityError(
      'The identity-provider subject and email resolve to different accounts.',
      'SHARED_AI_IDENTITY_CONFLICT',
      409
    );
  }

  let user = userBySubject || userByEmail;
  if (user?.idpSubject && user.idpSubject !== identity.sub) {
    throw identityError(
      'The identity-provider subject and email resolve to different accounts.',
      'SHARED_AI_IDENTITY_CONFLICT',
      409
    );
  }
  if (!user) {
    // The random password is never disclosed or accepted as an SSO grant. It
    // only satisfies the legacy local schema until this person first enters
    // Recruiter through OIDC and the normal membership sync runs.
    const password = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);
    try {
      user = await createUser({
        email: identity.email,
        password,
        idpSubject: identity.sub,
        sharedAIOnly: true,
        ...(identity.displayName ? { profile: { displayName: identity.displayName } } : {}),
        ...(organization?._id ? { currentOrganization: organization._id } : {})
      });
      return { user, identity, organization };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Two first-time calls can race on the unique subject/email indexes.
      // Re-read the winner and apply the same conflict checks instead of
      // exposing an intermittent 500 to one of the products.
      const [racedBySubject, racedByEmail] = await Promise.all([
        findBySubject(identity.sub),
        findByEmail(identity.email)
      ]);
      if (racedBySubject && racedByEmail && String(racedBySubject._id) !== String(racedByEmail._id)) {
        throw identityError(
          'The identity-provider subject and email resolve to different accounts.',
          'SHARED_AI_IDENTITY_CONFLICT',
          409
        );
      }
      user = racedBySubject || racedByEmail;
      if (!user || (user.idpSubject && user.idpSubject !== identity.sub)) {
        throw identityError(
          'The identity-provider subject and email resolve to different accounts.',
          'SHARED_AI_IDENTITY_CONFLICT',
          409
        );
      }
    }
  }

  let changed = false;
  if (!user.idpSubject) {
    user.idpSubject = identity.sub;
    changed = true;
  }
  if (String(user.email || '').toLowerCase() !== identity.email) {
    user.email = identity.email;
    changed = true;
  }
  if (!user.currentOrganization && organization?._id) {
    user.currentOrganization = organization._id;
    changed = true;
  }
  if (identity.displayName && !user.profile?.displayName) {
    user.profile = user.profile || {};
    user.profile.displayName = identity.displayName;
    changed = true;
  }
  if (changed && typeof user.save === 'function') await user.save();
  return { user, identity, organization };
}

async function resolveSharedUser(rawIdentity, dependencies = {}) {
  return (await resolveSharedPrincipal(rawIdentity, dependencies)).user;
}

module.exports = { normalizeIdentity, resolveSharedPrincipal, resolveSharedUser };
