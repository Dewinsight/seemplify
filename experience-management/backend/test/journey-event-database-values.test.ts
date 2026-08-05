import assert from 'node:assert/strict';
import test from 'node:test';
import { journeyEventReplayEligibilityValue } from '../src/journeyEventDatabaseValues.js';

test('journey rejection replay_eligible binds a native PostgreSQL boolean and a SQLite 0/1 integer', () => {
  assert.equal(journeyEventReplayEligibilityValue('postgres', false), false);
  assert.equal(journeyEventReplayEligibilityValue('postgres', true), true);
  assert.equal(journeyEventReplayEligibilityValue('sqlite', false), 0);
  assert.equal(journeyEventReplayEligibilityValue('sqlite', true), 1);
});
