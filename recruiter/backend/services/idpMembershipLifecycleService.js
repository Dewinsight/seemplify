const axios = require('axios');
const crypto = require('crypto');

function baseUrl() {
  return String(process.env.IDP_INTERNAL_API_URL || process.env.IDP_ISSUER_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function secret() {
  return process.env.INTERNAL_SERVICE_SECRET || process.env.RECRUITER_IDP_SERVICE_SECRET || '';
}

function signedHeaders(body, idempotencyKey) {
  const timestamp = new Date().toISOString();
  const configuredSecret = secret();
  if (!configuredSecret && process.env.NODE_ENV === 'production') {
    throw new Error('Recruiter to IDP service authentication is not configured');
  }
  const signature = configuredSecret
    ? crypto.createHmac('sha256', configuredSecret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex')
    : '';
  return {
    'content-type': 'application/json',
    'x-service-id': 'recruiter',
    'x-service-timestamp': timestamp,
    'x-service-signature': signature ? `sha256=${signature}` : '',
    'idempotency-key': idempotencyKey,
  };
}

async function callIdp(operation, body, idempotencyKey) {
  const serialized = JSON.stringify({ ...body, idempotencyKey });
  try {
    const response = await axios.post(
      `${baseUrl()}/api/internal/v1/memberships/${operation}`,
      serialized,
      { headers: signedHeaders(JSON.parse(serialized), idempotencyKey), timeout: Number(process.env.IDP_INTERNAL_API_TIMEOUT_MS || 15000) }
    );
    return response.data;
  } catch (error) {
    const detail = error.response?.data?.error || error.message || 'IDP membership request failed';
    const wrapped = new Error(detail);
    wrapped.statusCode = error.response?.status || 502;
    wrapped.response = error.response?.data;
    throw wrapped;
  }
}

function transitionSubject(transition) {
  const candidate = transition.candidate;
  return {
    idpAccountId: transition.subject?.idpAccountId || transition.identityAction?.idpAccountId,
    email: transition.subject?.email || candidate?.email,
    name: transition.subject?.name || `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || candidate?.email,
  };
}

async function performIdentityAction({ transition, organization, action, actorId, emergency = false, reason }) {
  if (!organization?.idpOrganizationId) throw new Error('Recruiter organization is not linked to an IDP organization');
  const subject = transitionSubject(transition);
  if (action === 'provision' && !subject.email) throw new Error('An employee email is required before provisioning');
  if (action !== 'provision' && !subject.idpAccountId && !subject.email) throw new Error('An IDP account identifier or email is required');
  const idempotencyKey = transition.identityAction?.idempotencyKey || `people-transition:${transition._id}:${action}:${transition.identityAction?.effectiveAt?.toISOString?.() || 'now'}`;
  const occurredAt = new Date().toISOString();
  const body = {
    schemaVersion: '1.0',
    eventId: idempotencyKey,
    organizationId: organization.idpOrganizationId,
    subjectId: subject.idpAccountId || subject.email,
    occurredAt,
    correlationId: `people-transition:${transition._id}`,
    idempotencyKey,
    ...subject,
    role: transition.employment?.role || 'staff',
    managerId: transition.employment?.managerId,
    departmentId: transition.employment?.departmentId,
    employeeId: transition.employment?.employeeId || transition.subject?.employeeId,
    appAccess: transition.employment?.appAccess,
    jurisdiction: transition.employment?.jurisdiction,
    startAt: transition.employment?.startAt,
    effectiveAt: transition.identityAction?.effectiveAt || transition.employment?.lastWorkingAt,
    emergency,
    reason,
    transitionId: transition._id.toString(),
    requestedBy: actorId?.toString?.() || actorId,
  };

  transition.identityAction = {
    ...(transition.identityAction?.toObject?.() || transition.identityAction || {}),
    action,
    idempotencyKey,
    status: 'pending',
    requestedBy: actorId,
    attempts: Number(transition.identityAction?.attempts || 0) + 1,
    lastAttemptAt: new Date(),
    lastError: '',
  };
  await transition.save();
  try {
    const result = await callIdp(action, body, idempotencyKey);
    transition.identityAction.status = result.status === 'scheduled' ? 'pending' : 'completed';
    transition.identityAction.completedAt = result.status === 'scheduled' ? undefined : new Date();
    transition.identityAction.idpAccountId = result.account?.userId || subject.idpAccountId;
    transition.status = action === 'provision' && result.status !== 'scheduled' ? 'provisioned' : transition.status;
    await transition.save();
    return result;
  } catch (error) {
    transition.identityAction.status = 'failed';
    transition.identityAction.lastError = error.message;
    transition.status = action === 'provision' ? 'failed' : transition.status;
    await transition.save();
    throw error;
  }
}

module.exports = { callIdp, performIdentityAction, transitionSubject };
