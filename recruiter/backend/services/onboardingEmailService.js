const emailService = require('./emailService');

const DEFAULT_CANDIDATE_PORTAL_URL = 'https://candidate.seemplifyai.com';
const DEFAULT_AKWA_IBOM_CANDIDATE_PORTAL_URL = 'https://candidate-ibom.aiinnigeria.com';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function defaultCandidatePortalBaseUrl() {
  return normalizeBaseUrl(
    process.env.CANDIDATE_PORTAL_URL ||
    process.env.NEXT_PUBLIC_CANDIDATE_PORTAL_URL ||
    DEFAULT_CANDIDATE_PORTAL_URL
  );
}

function akwaIbomCandidatePortalBaseUrl() {
  return normalizeBaseUrl(
    process.env.AKWA_IBOM_CANDIDATE_PORTAL_URL ||
    process.env.CANDIDATE_PORTAL_AKWA_IBOM_URL ||
    DEFAULT_AKWA_IBOM_CANDIDATE_PORTAL_URL
  );
}

function requestValue(req, headerName) {
  if (!req || typeof req.get !== 'function') return '';
  return req.get(headerName) || '';
}

function organizationSignals(organization = {}) {
  return [
    organization.name,
    organization.website,
    organization.logo,
    organization.idpOrganizationId
  ];
}

function isAkwaIbomContext(context = {}) {
  const request = context.request || context.req;
  const signal = [
    context.origin,
    context.referer,
    context.referrer,
    context.host,
    context.url,
    requestValue(request, 'origin'),
    requestValue(request, 'referer'),
    requestValue(request, 'host'),
    ...organizationSignals(context.organization)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return signal.includes('akwa') || signal.includes('ibom') || signal.includes('jetstone');
}

function candidatePortalBaseUrl(context = {}) {
  return isAkwaIbomContext(context)
    ? akwaIbomCandidatePortalBaseUrl()
    : defaultCandidatePortalBaseUrl();
}

function candidatePortalUrl(path, context = {}) {
  return `${candidatePortalBaseUrl(context)}${path.startsWith('/') ? path : `/${path}`}`;
}

function recruiterFrontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://app.seemplifyai.com'
  ).replace(/\/$/, '');
}

function candidateName(candidate = {}) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email || 'Candidate';
}

async function sendCandidateInvite({ candidate, organization, inviteToken, onboarding, request, req }) {
  const portalContext = { organization, request: request || req };
  const portalUrl = candidatePortalUrl(`/signup?token=${encodeURIComponent(inviteToken)}`, portalContext);
  const name = candidateName(candidate);
  const organizationName = organization?.name || 'Seemplify';

  await emailService.sendEmail({
    to: candidate.email,
    subject: `Onboarding documents from ${organizationName}`,
    organizationName,
    text: `Hello ${name}, ${organizationName} has started your onboarding. Open ${portalUrl} to review and sign your documents.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 12px 0;">Your onboarding is ready</h2>
        <p>Hello ${name},</p>
        <p>${organizationName} has started your onboarding. Use the secure portal below to review and sign your documents.</p>
        <p style="margin: 24px 0;">
          <a href="${portalUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Open candidate portal</a>
        </p>
        <p style="color:#64748b;font-size:13px;">This invitation is linked to onboarding ${onboarding?._id || ''}.</p>
      </div>
    `
  });

  return portalUrl;
}

async function sendEnvelopeNotification({ candidate, organization, envelope, request, req }) {
  const portalUrl = candidatePortalUrl(`/onboarding/${envelope.onboarding}`, { organization, request: request || req });
  const name = candidateName(candidate);
  const organizationName = organization?.name || 'Seemplify';

  return emailService.sendEmail({
    to: candidate.email,
    subject: `Documents ready for signature: ${envelope.title}`,
    organizationName,
    text: `Hello ${name}, documents are ready for your signature. Open ${portalUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 12px 0;">Documents ready for signature</h2>
        <p>Hello ${name},</p>
        <p>${organizationName} sent you <strong>${envelope.title}</strong> for review and signature.</p>
        <p style="margin: 24px 0;">
          <a href="${portalUrl}" style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Review and sign</a>
        </p>
      </div>
    `
  });
}

async function sendEnvelopeReminder({ signer, organization, envelope, request, req }) {
  const portalUrl = signer.role === 'candidate'
    ? candidatePortalUrl(`/onboarding/${envelope.onboarding}`, { organization, request: request || req })
    : `${recruiterFrontendBaseUrl()}/onboarding/envelopes/${envelope._id}`;
  const organizationName = organization?.name || 'Seemplify';

  return emailService.sendEmail({
    to: signer.email,
    subject: `Reminder: ${envelope.title} needs your signature`,
    organizationName,
    text: `Reminder: ${envelope.title} needs your signature. Open ${portalUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 12px 0;">Signature reminder</h2>
        <p>${envelope.title} is still waiting for your signature.</p>
        <p style="margin: 24px 0;">
          <a href="${portalUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Open document</a>
        </p>
      </div>
    `
  });
}

async function sendEnvelopeCompleted({ recipientEmail, organization, envelope, request, req }) {
  const portalUrl = candidatePortalUrl(`/onboarding/${envelope.onboarding}`, { organization, request: request || req });
  const organizationName = organization?.name || 'Seemplify';

  return emailService.sendEmail({
    to: recipientEmail,
    subject: `Completed documents: ${envelope.title}`,
    organizationName,
    text: `${envelope.title} has been completed. Open ${portalUrl} to download the signed documents.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 12px 0;">Documents completed</h2>
        <p>${envelope.title} has been completed.</p>
        <p style="margin: 24px 0;">
          <a href="${portalUrl}" style="background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Download documents</a>
        </p>
      </div>
    `
  });
}

module.exports = {
  DEFAULT_AKWA_IBOM_CANDIDATE_PORTAL_URL,
  candidatePortalBaseUrl,
  candidatePortalUrl,
  isAkwaIbomContext,
  sendCandidateInvite,
  sendEnvelopeNotification,
  sendEnvelopeReminder,
  sendEnvelopeCompleted
};
