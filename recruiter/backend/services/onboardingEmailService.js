const emailService = require('./emailService');

function candidatePortalBaseUrl() {
  return (
    process.env.CANDIDATE_PORTAL_URL ||
    process.env.NEXT_PUBLIC_CANDIDATE_PORTAL_URL ||
    'https://candidate.seemplifyai.com'
  ).replace(/\/$/, '');
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

async function sendCandidateInvite({ candidate, organization, inviteToken, onboarding }) {
  const portalUrl = `${candidatePortalBaseUrl()}/signup?token=${encodeURIComponent(inviteToken)}`;
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

async function sendEnvelopeNotification({ candidate, organization, envelope }) {
  const portalUrl = `${candidatePortalBaseUrl()}/onboarding/${envelope.onboarding}`;
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

async function sendEnvelopeReminder({ signer, organization, envelope }) {
  const portalUrl = signer.role === 'candidate'
    ? `${candidatePortalBaseUrl()}/onboarding/${envelope.onboarding}`
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

async function sendEnvelopeCompleted({ recipientEmail, organization, envelope }) {
  const portalUrl = `${candidatePortalBaseUrl()}/onboarding/${envelope.onboarding}`;
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
  candidatePortalBaseUrl,
  sendCandidateInvite,
  sendEnvelopeNotification,
  sendEnvelopeReminder,
  sendEnvelopeCompleted
};
