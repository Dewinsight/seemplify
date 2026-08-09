'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { getAIRequestContext } = require('../services/aiRuntime/requestContext');
const {
  bearerToken,
  resolveAssistantWebsocketIdentity
} = require('../services/assistantWebsocketAuthService');
const { WebSocketService } = require('../services/websocketService');

function authorizedFixture() {
  const organization = {
    _id: '507f191e810c19729de86101',
    idpOrganizationId: 'idp-org-aiin',
    name: 'AIIN',
    isActive: true
  };
  const actor = {
    _id: '507f191e810c19729de86100',
    idpSubject: 'idp-user-michael',
    email: 'pubgegbo@gmail.com',
    profile: { displayName: 'Michael Egbo' },
    sharedAIOnly: false,
    currentOrganization: organization,
    recruiterAppAccessSyncedAt: new Date(),
    recruiterAuthorizedOrganizations: [organization._id],
    organizationMemberships: [{ organization, isActive: true }]
  };
  return { actor, organization };
}

test('assistant WebSocket identity uses the verified session and exact authorized workspace', async () => {
  const { actor, organization } = authorizedFixture();
  let validatedToken;
  let loadedActorId;
  const identity = await resolveAssistantWebsocketIdentity({
    authToken: 'Bearer signed-access-token',
    organizationId: organization._id,
    requestId: 'assistant-request-1'
  }, {
    sessionServiceImpl: {
      async validateAccessToken(token) {
        validatedToken = token;
        return {
          decoded: { user: { id: actor._id }, jti: 'verified-session' },
          session: { accessTokenId: 'verified-session' }
        };
      }
    },
    UserModel: {
      async findById(actorId) {
        loadedActorId = actorId;
        return actor;
      }
    }
  });

  assert.equal(validatedToken, 'signed-access-token');
  assert.equal(loadedActorId, actor._id);
  assert.equal(identity.userId, actor._id);
  assert.equal(identity.organizationId, organization._id);
  assert.deepEqual(identity.context, {
    requestId: 'assistant-request-1',
    sourceApp: 'recruiter',
    sessionId: 'verified-session',
    actorId: 'idp-user-michael',
    runtimeActorId: actor._id,
    actorName: 'Michael Egbo',
    actorEmail: 'pubgegbo@gmail.com',
    organizationId: 'idp-org-aiin',
    localOrganizationId: organization._id,
    organizationName: 'AIIN'
  });
});

test('assistant WebSocket identity fails closed for a member workspace without Recruiter entitlement', async () => {
  const { actor } = authorizedFixture();
  const unauthorizedOrganization = {
    _id: '507f191e810c19729de86102',
    idpOrganizationId: 'idp-org-performance-only',
    name: 'Performance only',
    isActive: true
  };
  actor.organizationMemberships.push({ organization: unauthorizedOrganization, isActive: true });

  await assert.rejects(
    resolveAssistantWebsocketIdentity({
      authToken: 'signed-access-token',
      organizationId: unauthorizedOrganization._id
    }, {
      sessionServiceImpl: {
        async validateAccessToken() {
          return { decoded: { user: { id: actor._id }, jti: 'verified-session' } };
        }
      },
      UserModel: { async findById() { return actor; } }
    }),
    (error) => (
      error.code === 'ASSISTANT_SOCKET_ORGANIZATION_REQUIRED'
      && error.statusCode === 403
      && error.details?.reason === 'organization_not_authorized'
    )
  );
});

test('assistant chat ignores a client-supplied user id and runs the stream in verified AI context', async () => {
  const sent = [];
  let streamed;
  const service = new WebSocketService({
    resolveIdentity: async () => ({
      userId: 'verified-local-actor',
      organizationId: 'verified-local-org',
      context: {
        requestId: 'assistant-request-2',
        actorId: 'canonical-actor',
        runtimeActorId: 'verified-local-actor',
        organizationId: 'canonical-org',
        localOrganizationId: 'verified-local-org',
        sourceApp: 'recruiter'
      }
    }),
    streamAgent: async (input, actorId, sessionId, token, callbacks) => {
      streamed = {
        input,
        actorId,
        sessionId,
        token,
        context: getAIRequestContext()
      };
      callbacks.onComplete();
    }
  });
  service.clients.set('client-1', {
    connected: true,
    ws: { readyState: 1, send(payload) { sent.push(JSON.parse(payload)); } }
  });

  await service.handleChat('client-1', {
    type: 'chat',
    userInput: 'Show me how to create a job',
    userId: 'client-forged-actor',
    sessionId: 'chat-session-1',
    authToken: 'signed-access-token',
    organizationId: 'verified-local-org'
  });

  assert.equal(streamed.actorId, 'verified-local-actor');
  assert.equal(streamed.sessionId, 'chat-session-1');
  assert.equal(streamed.token, 'signed-access-token');
  assert.equal(streamed.context.runtimeActorId, 'verified-local-actor');
  assert.equal(streamed.context.localOrganizationId, 'verified-local-org');
  assert.ok(sent.some((message) => message.type === 'chat_complete'));
});

test('bearer token normalization never treats the client user id as authentication', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken(''), '');
});

test('assistant socket errors preserve safe routing diagnostics without exposing arbitrary details', () => {
  const sent = [];
  const service = new WebSocketService();
  service.clients.set('client-error', {
    connected: true,
    ws: { readyState: 1, send(payload) { sent.push(JSON.parse(payload)); } }
  });
  service.sendError('client-error', 'Workspace access needs refreshing.', {
    code: 'ASSISTANT_SOCKET_ORGANIZATION_REQUIRED',
    statusCode: 403,
    details: { reason: 'organization_not_authorized', internalRecord: 'must-not-leak' }
  });

  assert.equal(sent[0].code, 'ASSISTANT_SOCKET_ORGANIZATION_REQUIRED');
  assert.equal(sent[0].status, 403);
  assert.deepEqual(sent[0].details, { reason: 'organization_not_authorized' });
});
