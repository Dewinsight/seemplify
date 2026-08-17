'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    AUTH_COOKIE_NAME,
    LEGACY_AUTH_COOKIE_NAMES,
    extractTokenFromRequest,
    setAuthCookie
} = require('../utils/authSession');

test('Approver uses an app-specific cookie and still accepts the legacy cookie during rollout', () => {
    assert.equal(AUTH_COOKIE_NAME, 'seemplify_approver_session');
    assert.deepEqual(LEGACY_AUTH_COOKIE_NAMES, ['mosaic_auth']);
    assert.equal(extractTokenFromRequest({ headers: { cookie: `${AUTH_COOKIE_NAME}=current-token` } }), 'current-token');
    assert.equal(extractTokenFromRequest({ headers: { cookie: 'mosaic_auth=legacy-token' } }), 'legacy-token');
});

test('setting a session clears legacy cookie variants before issuing the new host-only cookie', () => {
    const cleared = [];
    const issued = [];
    const response = {
        clearCookie: (name, options) => cleared.push({ name, options }),
        cookie: (name, value, options) => issued.push({ name, value, options })
    };

    setAuthCookie(response, 'signed-token');

    assert.equal(cleared.some(entry => entry.name === 'mosaic_auth' && !entry.options.domain), true);
    assert.deepEqual(issued.map(entry => ({ name: entry.name, value: entry.value })), [
        { name: 'seemplify_approver_session', value: 'signed-token' }
    ]);
    assert.equal(issued[0].options.path, '/');
    assert.equal(issued[0].options.httpOnly, true);
});
