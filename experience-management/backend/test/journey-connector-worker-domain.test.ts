import assert from 'node:assert/strict';import test from 'node:test';
import {authenticateConnectorWorkerCredential,mintConnectorWorkerCredential,ticketConnectorPayload} from '../src/journeyConnectorWorkerDomain.js';
const secret='s'.repeat(48),issuedAt='2026-08-08T10:00:00.000Z',expiresAt='2026-08-08T12:00:00.000Z';
test('worker credentials are signed, bounded and immutable',()=>{const credential=mintConnectorWorkerCredential({principalId:'principal-a',keyId:'key-a',
  allowedSpaceIds:['space-a'],allowedConnectorIds:['connector-a'],allowedAdapters:['service_recovery_tickets_v1'],issuedAt,expiresAt,secret});
  const authority=authenticateConnectorWorkerCredential({credential,secret,at:'2026-08-08T11:00:00.000Z'});assert.equal(authority.principalId,'principal-a');
  assert.throws(()=>authenticateConnectorWorkerCredential({credential:`${credential}x`,secret,at:'2026-08-08T11:00:00.000Z'}),/signature/u);
  assert.throws(()=>authenticateConnectorWorkerCredential({credential,secret,at:expiresAt}),/expired/u);});
test('ticket adapter emits operational fields and excludes content',()=>{const payload=ticketConnectorPayload({surveyId:'survey-a',priority:'high',status:'open',
  createdAt:issuedAt,updatedAt:issuedAt});assert.deepEqual(Object.keys(payload).sort(),['createdAt','priority','schemaVersion','sourceType','status','surveyId','updatedAt'].sort());
  assert.doesNotMatch(JSON.stringify(payload),/title|notes|owner|response|content/iu);});
