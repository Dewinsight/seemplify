'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const sessionService = require('./sessionService');
const { canonicalAIContextFromRecords } = require('./aiRuntime/canonicalAIContext');
const { recruiterOrganizationAuthorized } = require('./sharedAIUserSecurity');

function id(value) {
  return String(value?._id || value?.id || value || '').trim();
}

function socketAuthError(message, code, statusCode, details) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function bearerToken(value) {
  const token = String(value || '').trim();
  return token.startsWith('Bearer ') ? token.slice(7).trim() : token;
}

async function loadActor(UserModel, actorId) {
  let query = UserModel.findById(actorId);
  if (typeof query?.populate === 'function') {
    query = query
      .populate('currentOrganization', 'name idpOrganizationId isActive +erasureState')
      .populate('organizationMemberships.organization', 'name idpOrganizationId isActive +erasureState');
  }
  return query;
}

async function resolveAssistantWebsocketIdentity({
  authToken,
  organizationId,
  requestId
} = {}, {
  sessionServiceImpl = sessionService,
  UserModel = User
} = {}) {
  const token = bearerToken(authToken);
  if (!token) {
    throw socketAuthError(
      'Sign in to Recruiter before using the AI assistant.',
      'ASSISTANT_SOCKET_AUTH_REQUIRED',
      401
    );
  }

  let validated;
  try {
    validated = await sessionServiceImpl.validateAccessToken(token);
  } catch (_error) {
    throw socketAuthError(
      'Your Recruiter session is no longer valid. Sign in again and retry.',
      'ASSISTANT_SOCKET_SESSION_INVALID',
      401
    );
  }

  const localActorId = id(validated?.decoded?.user?.id);
  const actor = localActorId ? await loadActor(UserModel, localActorId) : null;
  if (!actor || actor.sharedAIOnly === true) {
    throw socketAuthError(
      'This identity is not an active Recruiter account.',
      'RECRUITER_APP_ACCESS_REQUIRED',
      403
    );
  }

  const requestedOrganizationId = id(organizationId || actor.currentOrganization);
  const membership = (actor.organizationMemberships || []).find((candidate) => (
    candidate?.isActive === true
    && id(candidate.organization) === requestedOrganizationId
    && candidate.organization?.isActive !== false
    && candidate.organization?.erasureState !== 'tombstoned'
  ));

  if (!requestedOrganizationId || !membership
    || !recruiterOrganizationAuthorized(actor, requestedOrganizationId)) {
    throw socketAuthError(
      'Your Recruiter session is not authorized for the selected workspace. Sign in again and retry.',
      'ASSISTANT_SOCKET_ORGANIZATION_REQUIRED',
      403,
      { reason: 'organization_not_authorized' }
    );
  }

  const organization = membership.organization;
  return {
    userId: localActorId,
    organizationId: requestedOrganizationId,
    sessionId: String(validated.decoded.jti || validated.session?.accessTokenId || '').trim(),
    context: {
      requestId: String(requestId || crypto.randomUUID()),
      sourceApp: 'recruiter',
      sessionId: String(validated.decoded.jti || validated.session?.accessTokenId || '').trim(),
      ...canonicalAIContextFromRecords({
        actor,
        organization,
        actorId: localActorId,
        organizationId: requestedOrganizationId
      })
    }
  };
}

module.exports = {
  bearerToken,
  resolveAssistantWebsocketIdentity,
  socketAuthError
};
