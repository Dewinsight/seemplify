const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOidcCallbackTarget,
  normalizeOidcReturnTo
} = require('../utils/oidcReturnTo');

const productionEnv = { NODE_ENV: 'production' };

test('accepts known Recruiter frontend origins and discards unneeded path state', () => {
  assert.equal(
    normalizeOidcReturnTo('https://app.seemplifyai.com/login?next=%2Fjobs#section', productionEnv),
    'https://app.seemplifyai.com'
  );
  assert.equal(
    getOidcCallbackTarget('https://akwaibom.aiinnigeria.com/login', productionEnv),
    'https://akwaibom.aiinnigeria.com/oidc/callback'
  );
});

test('accepts exact configured frontend origins', () => {
  const env = {
    NODE_ENV: 'production',
    OIDC_ALLOWED_RETURN_ORIGINS: 'https://recruiter.customer.example, https://recruiter-two.customer.example/path'
  };

  assert.equal(
    normalizeOidcReturnTo('https://recruiter.customer.example/login', env),
    'https://recruiter.customer.example'
  );
  assert.equal(
    normalizeOidcReturnTo('https://recruiter-two.customer.example/anything', env),
    'https://recruiter-two.customer.example'
  );
});

test('accepts the frontend URL used by the App Hub launch configuration', () => {
  const env = {
    NODE_ENV: 'production',
    SMARTHR_URL: 'https://recruiter.workspace.example'
  };

  assert.equal(
    getOidcCallbackTarget('https://recruiter.workspace.example', env),
    'https://recruiter.workspace.example/oidc/callback'
  );
});

test('rejects attacker, lookalike, credentialed, and non-http return URLs', () => {
  const rejected = [
    'https://attacker.example/login',
    'https://app.seemplifyai.com.attacker.example/login',
    'https://app.seemplifyai.com@attacker.example/login',
    'javascript:alert(1)',
    '//attacker.example/login',
    'not-a-url'
  ];

  for (const value of rejected) {
    assert.equal(normalizeOidcReturnTo(value, productionEnv), null, value);
  }
});

test('localhost is available only outside production', () => {
  assert.equal(
    normalizeOidcReturnTo('http://localhost:5000/login', { NODE_ENV: 'development' }),
    'http://localhost:5000'
  );
  assert.equal(
    normalizeOidcReturnTo('http://localhost:5000/login', productionEnv),
    null
  );
  assert.equal(
    normalizeOidcReturnTo('http://localhost:5000/login', {
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://localhost:5000'
    }),
    null
  );
});
