import assert from 'node:assert/strict';
import test from 'node:test';
import { createJourneyConnectorWorkerRuntime, validateJourneyConnectorWorkerConfiguration } from '../src/journeyConnectorWorkerRuntime.js';

const base:any={enabled:false,databaseProvider:'postgres',pollMs:1000,principalId:'principal',keyId:'key',keyRef:'file://worker-key',
  secretFile:'unused',spaceIds:['space'],connectorIds:['connector'],postgres:{}};
test('disabled connector worker is a safe no-processing state',async()=>assert.equal(await createJourneyConnectorWorkerRuntime({configuration:base}),null));
test('enabled connector worker fails closed without PostgreSQL or explicit bounded authority',()=>{
  assert.throws(()=>validateJourneyConnectorWorkerConfiguration({...base,enabled:true,databaseProvider:'sqlite'}),/requires PostgreSQL/u);
  assert.throws(()=>validateJourneyConnectorWorkerConfiguration({...base,enabled:true,spaceIds:[]}),/explicit bounded/u);
  assert.throws(()=>validateJourneyConnectorWorkerConfiguration({...base,enabled:true,keyRef:'env://unsafe'}),/file secret reference/u);
});
