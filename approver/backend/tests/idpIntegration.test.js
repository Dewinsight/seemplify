'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
    canAccessApprover,
    entitledOrganizations,
    splitName,
    usernameFor
} = require('../services/idpProvisioningService');
const { verifyIdpWebhook } = require('../services/idpWebhookSecurity');

test('Approver entitlement accepts all-app members and filters selected app access', () => {
    assert.equal(canAccessApprover({ appAccess: { mode: 'all', appIds: [] } }), true);
    assert.equal(canAccessApprover({ appAccess: { mode: 'selected', appIds: ['approver'] } }), true);
    assert.equal(canAccessApprover({ appAccess: { mode: 'selected', appIds: ['payroll-management'] } }), false);
    assert.deepEqual(
        entitledOrganizations({
            organizations: [
                { id: 'one', appAccess: { mode: 'all' } },
                { id: 'two', appAccess: { mode: 'selected', appIds: ['approver'] } },
                { id: 'three', appAccess: { mode: 'selected', appIds: ['messaging'] } }
            ]
        }).map((organization) => organization.id),
        ['one', 'two']
    );
});

test('IdP identity helpers produce a complete profile and stable collision-safe username', () => {
    assert.deepEqual(splitName({ name: 'Michael Egbo' }), { firstName: 'Michael', lastName: 'Egbo' });
    assert.deepEqual(splitName({ name: 'Michael' }), { firstName: 'Michael', lastName: 'User' });
    assert.equal(usernameFor({ sub: 'stable-subject', email: 'Michael.Egbo@example.com' }), usernameFor({
        sub: 'stable-subject',
        email: 'Michael.Egbo@example.com'
    }));
    assert.match(usernameFor({ sub: 'stable-subject', email: 'Michael.Egbo@example.com' }), /^michael\.egbo-[a-f0-9]{8}$/);
});

test('IdP webhook verification requires a fresh matching HMAC signature', () => {
    const prior = process.env.IDP_WEBHOOK_SECRET;
    const secret = 'approver-webhook-secret-at-least-32-characters';
    process.env.IDP_WEBHOOK_SECRET = secret;
    try {
        const payload = {
            eventId: 'e78f5b9f-e04a-4d11-978a-710142a72ca8',
            event: 'organization.member.removed',
            data: { subject: 'subject-one' }
        };
        const rawBody = Buffer.from(JSON.stringify(payload));
        const deliveryTimestamp = new Date().toISOString();
        const signature = crypto.createHmac('sha256', secret)
            .update(`${deliveryTimestamp}\n${rawBody.toString('utf8')}`)
            .digest('hex');
        assert.deepEqual(verifyIdpWebhook({
            payload,
            rawBody,
            eventHeader: payload.event,
            deliveryTimestamp,
            signature
        }), { ok: true });
        assert.equal(verifyIdpWebhook({
            payload,
            rawBody,
            eventHeader: payload.event,
            deliveryTimestamp,
            signature: '0'.repeat(64)
        }).ok, false);
    } finally {
        if (prior === undefined) delete process.env.IDP_WEBHOOK_SECRET;
        else process.env.IDP_WEBHOOK_SECRET = prior;
    }
});
