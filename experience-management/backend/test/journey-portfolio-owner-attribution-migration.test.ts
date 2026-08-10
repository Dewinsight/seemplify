import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'migrations/postgres/0034_journey_portfolio_owner_attribution.sql'), 'utf8');
const portfolioSource = fs.readFileSync(path.join(root, 'src/journeyPortfolio.ts'), 'utf8');

test('runtime-34 is a forward-only repair gated exactly on runtime-33', () => {
  assert.match(sql, /MAX\(version\)[\s\S]*?<>33/u);
  assert.doesNotMatch(sql, /INSERT INTO experience_runtime_schema_version/u);
  assert.doesNotMatch(sql, /^CREATE TABLE/gmu);
});

test('runtime-34 keeps owner attribution while moving membership to a write-time guard', () => {
  assert.match(sql, /DROP CONSTRAINT journey_portfolio_items_owner_membership_fk/u);
  assert.match(sql, /journey_portfolio_items_owner_user_fk[\s\S]*?FOREIGN KEY\(owner_user_id\)[\s\S]*?REFERENCES users\(id\) ON DELETE NO ACTION/u);
  assert.match(sql, /PERFORM 1 FROM space_memberships[\s\S]*?space_id=NEW\.space_id AND user_id=NEW\.owner_user_id FOR SHARE/u);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF space_id,owner_user_id ON journey_portfolio_items/u);
  assert.match(sql, /USING ERRCODE='23503'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION journey_portfolio_owner_membership_guard\(\) FROM PUBLIC/u);
});

test('the application creates a policy with its current version pointer inline', () => {
  const start = portfolioSource.indexOf('export function createJourneyPortfolioScoringPolicy(');
  const end = portfolioSource.indexOf('export function createJourneyPortfolioScoringPolicyVersion(', start);
  const createPolicy = portfolioSource.slice(start, end);
  assert.match(createPolicy,
    /INSERT INTO journey_portfolio_scoring_policies[\s\S]*?current_version_id[\s\S]*?\.run\(\s*id,\s*input\.spaceId,\s*name,\s*input\.method,\s*state,\s*versionId,/u);
  assert.doesNotMatch(createPolicy,
    /UPDATE journey_portfolio_scoring_policies SET current_version_id/u);
});
