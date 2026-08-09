const crypto = require('crypto');
const { AttendancePolicy, EmployeeRoster } = require('../models');
const { processLifecycleEvent } = require('./lifecycleService');

function endpoint() {
    return String(process.env.IDP_INTERNAL_API_URL || process.env.IDP_ISSUER_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function signingSecret() {
    return process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_IDP_SERVICE_SECRET || '';
}

async function fetchRoster(organizationId) {
    const body = { organizationId };
    const serialized = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const secret = signingSecret();
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('T&A to IDP service authentication is not configured');
    const signature = secret
        ? crypto.createHmac('sha256', secret).update(`${timestamp}.${serialized}`).digest('hex')
        : '';
    const response = await fetch(`${endpoint()}/api/internal/v1/memberships/reconcile`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-service-id': 'time-attendance',
            'x-service-timestamp': timestamp,
            'x-service-signature': signature ? `sha256=${signature}` : '',
        },
        body: serialized,
        signal: AbortSignal.timeout(Number(process.env.IDP_RECONCILIATION_TIMEOUT_MS || 30000)),
    });
    if (!response.ok) throw new Error(`IDP roster reconciliation failed with HTTP ${response.status}`);
    return response.json();
}

async function reconcileOrganization(organizationId) {
    const snapshot = await fetchRoster(organizationId);
    if (!Array.isArray(snapshot.memberships)) throw new Error('IDP roster response did not contain a membership list');
    const seen = new Set();
    let applied = 0;
    for (const membership of snapshot.memberships) {
        const userId = String(membership.idpSubject || membership.userId || membership.subjectId || '');
        if (!userId) continue;
        seen.add(userId);
        const event = membership.status === 'active' ? 'organization.member.updated' : 'organization.member.deactivated';
        await processLifecycleEvent('idp', {
            schemaVersion: snapshot.schemaVersion || '1.0',
            eventId: `reconcile:${organizationId}:${userId}:${snapshot.generatedAt}`,
            event,
            timestamp: snapshot.generatedAt,
            data: { ...membership, organizationId, userId, idpSubject: userId, effectiveAt: membership.effectiveAt || snapshot.generatedAt },
        }, event);
        applied += 1;
    }
    const missing = await EmployeeRoster.find({ organizationId, status: { $in: ['active', 'scheduled_exit'] }, userId: { $nin: [...seen] } });
    for (const roster of missing) {
        await processLifecycleEvent('idp', {
            schemaVersion: snapshot.schemaVersion || '1.0',
            eventId: `reconcile-missing:${organizationId}:${roster.userId}:${snapshot.generatedAt}`,
            event: 'organization.member.deactivated',
            timestamp: snapshot.generatedAt,
            data: { organizationId, userId: roster.userId, effectiveAt: snapshot.generatedAt, reason: 'missing_from_authoritative_idp_roster' },
        }, 'organization.member.deactivated');
    }
    await EmployeeRoster.updateMany({ organizationId, userId: { $in: [...seen] } }, { $set: { lastReconciledAt: new Date() } });
    return { organizationId, applied, deactivatedMissing: missing.length };
}

async function reconcileAllRosters(payload = {}) {
    const configured = Array.isArray(payload.organizationIds) ? payload.organizationIds.map(String) : [];
    const discovered = configured.length ? configured : Array.from(new Set([
        ...(await EmployeeRoster.distinct('organizationId')),
        ...(await AttendancePolicy.distinct('organizationId')),
    ].map(String).filter(Boolean)));
    const results = [];
    for (const organizationId of discovered) results.push(await reconcileOrganization(organizationId));
    return { organizations: results.length, results };
}

module.exports = { fetchRoster, reconcileAllRosters, reconcileOrganization };
