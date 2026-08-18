const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const composePath = path.resolve(__dirname, '../../../deploy/hostinger/extended-apps.compose.yml');
const workflowPath = path.resolve(__dirname, '../../../.github/workflows/deploy-experience-hostinger.yml');

function aiInterviewServiceBlock() {
  const compose = fs.readFileSync(composePath, 'utf8');
  const match = compose.match(/\n  ai-interview-backend:\r?\n[\s\S]*?(?=\n  [a-z][a-z0-9-]*:\r?\n|\nvolumes:\r?\n|$)/u);
  assert.ok(match, 'ai-interview-backend service must exist in the Hostinger compose file');
  return match[0];
}

test('Hostinger AI Interview can read only the root-group platform HMAC mount', () => {
  const service = aiInterviewServiceBlock();

  assert.match(service, /\n    group_add:\r?\n      - "0"/u);
  assert.match(
    service,
    /\/opt\/seemplify\/secrets\/platform-integrations\/experience-hmac-secret:\/run\/seemplify\/platform-integration-hmac:ro/u
  );
  assert.match(
    service,
    /IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE: \/run\/seemplify\/platform-integration-hmac/u
  );
});

test('Hostinger deployment preserves root ownership and grants root-group read only', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(
    workflow,
    /chown root:root \/opt\/seemplify\/secrets\/platform-integrations\/experience-hmac-secret/u
  );
  assert.match(
    workflow,
    /chmod 0640 \/opt\/seemplify\/secrets\/platform-integrations\/experience-hmac-secret/u
  );
  assert.doesNotMatch(
    workflow,
    /chmod 0?6(?:4[4-7]|[5-7][0-7]) \/opt\/seemplify\/secrets\/platform-integrations\/experience-hmac-secret/u
  );
});
