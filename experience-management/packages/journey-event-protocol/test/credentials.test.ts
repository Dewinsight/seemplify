import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseJourneyCredential,
  parseJourneyPublicWriteKey,
  parseJourneyServerSecret
} from '../src/index.js';

const secret = 'a'.repeat(43);

test('credential parser maps canonical public and server environments without returning secret material', () => {
  assert.deepEqual(parseJourneyPublicWriteKey(`jpk_dev.key_01.${secret}`), {
    kind: 'public_write', environment: 'development', keyId: 'key_01'
  });
  assert.deepEqual(parseJourneyPublicWriteKey(`jpk_stg.key_02.${secret}`), {
    kind: 'public_write', environment: 'staging', keyId: 'key_02'
  });
  assert.deepEqual(parseJourneyServerSecret(`jsk_live.server_01.${secret}`), {
    kind: 'server_secret', environment: 'production', keyId: 'server_01'
  });
  assert.equal(JSON.stringify(parseJourneyCredential(`jpk_live.key_03.${secret}`)).includes(secret), false);
});

test('credential parser rejects legacy, wrong-kind, short, unsafe, and malformed credentials', () => {
  assert.equal(parseJourneyPublicWriteKey(`jsk_live.server_01.${secret}`), undefined);
  assert.equal(parseJourneyServerSecret(`jpk_live.key_01.${secret}`), undefined);
  for (const value of [
    'sp_test_legacy',
    `jpk_test.key_01.${secret}`,
    `jpk_live.-unsafe.${secret}`,
    'jpk_live.key_01.short',
    `jpk_live.key.01.${secret}`,
    `jpk_live.key_01.${'a'.repeat(257)}`,
    `jpk_live.key_01.${secret}.extra`
  ]) assert.equal(parseJourneyCredential(value), undefined, value);
});
