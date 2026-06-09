const CandidateOnboarding = require('../models/CandidateOnboarding');
const emailService = require('./emailService');
const { processCopy } = require('./onboardingWorkflowService');

const DEFAULT_CANDIDATE_PORTAL_URL = 'https://candidate.seemplifyai.com';
const DEFAULT_AKWA_IBOM_CANDIDATE_PORTAL_URL = 'https://candidate-ibom.aiinnigeria.com';

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

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

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function safeProcessCopy(processType) {
  try {
    return processCopy(processType || 'onboarding');
  } catch (error) {
    return { label: 'Onboarding' };
  }
}

async function transitionSummary(onboardingOrEnvelope = {}) {
  const rawTransition = onboardingOrEnvelope && onboardingOrEnvelope.onboarding !== undefined
    ? onboardingOrEnvelope.onboarding
    : onboardingOrEnvelope;
  const rawTransitionId = rawTransition?._id || rawTransition || '';

  let transition = null;
  if (rawTransition && typeof rawTransition === 'object' && rawTransition.processType) {
    transition = rawTransition;
  } else if (rawTransitionId) {
    transition = await CandidateOnboarding.findById(rawTransitionId)
      .select('_id title processType dueAt')
      .lean()
      .catch(() => null);
  }

  const copy = safeProcessCopy(transition?.processType || rawTransition?.processType);
  const id = transition?._id || rawTransitionId;
  const label = copy.label || 'Transition';

  return {
    id: id ? String(id) : '',
    label,
    lowerLabel: label.toLowerCase(),
    title: transition?.title || `${label} process`
  };
}

function transitionPortalPath(transition) {
  return `/transitions/${encodeURIComponent(transition.id)}`;
}

function renderDetails(details = []) {
  const rows = details
    .filter((detail) => detail && detail.value !== undefined && detail.value !== null && String(detail.value).trim())
    .map((detail) => `
      <tr>
        <td style="padding: 9px 0; color: #6b7280; font-size: 13px; line-height: 18px; width: 38%;">${escapeHtml(detail.label)}</td>
        <td style="padding: 9px 0; color: #111827; font-size: 13px; line-height: 18px; font-weight: 600;">${escapeHtml(detail.value)}</td>
      </tr>
    `)
    .join('');

  if (!rows) return '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; margin: 22px 0;">
      ${rows}
    </table>
  `;
}

function renderTransitionEmail({
  organizationName,
  processLabel,
  preheader,
  title,
  greeting,
  body = [],
  details = [],
  actionLabel,
  actionUrl,
  note
}) {
  const safeActionUrl = actionUrl ? escapeHtml(actionUrl) : '';
  const paragraphs = body
    .filter((paragraph) => paragraph !== undefined && paragraph !== null && String(paragraph).trim())
    .map((paragraph) => `<p style="margin: 0 0 14px 0; color: #374151; font-size: 15px; line-height: 23px;">${escapeHtml(paragraph)}</p>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="margin: 0; padding: 0; background: #f6f7f9;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeHtml(preheader || title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f6f7f9; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px;">
            <tr>
              <td style="padding: 0 0 12px 0;">
                <div style="color: #111827; font-family: Helvetica, sans-serif; font-size: 15px; font-weight: 700; line-height: 20px;">${escapeHtml(organizationName)}</div>
                <div style="color: #6b7280; font-family: Helvetica, sans-serif; font-size: 12px; line-height: 18px;">People Transitions / ${escapeHtml(processLabel)}</div>
              </td>
            </tr>
            <tr>
              <td style="background: #ffffff; border: 1px solid #d8dee8; border-radius: 8px; padding: 28px;">
                <h1 style="margin: 0 0 16px 0; color: #111827; font-family: Helvetica, sans-serif; font-size: 22px; line-height: 29px; font-weight: 700;">${escapeHtml(title)}</h1>
                <p style="margin: 0 0 14px 0; color: #111827; font-family: Helvetica, sans-serif; font-size: 15px; line-height: 23px;">${escapeHtml(greeting)}</p>
                ${paragraphs}
                ${renderDetails(details)}
                ${safeActionUrl ? `
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 22px 0 18px 0;">
                    <tr>
                      <td>
                        <a href="${safeActionUrl}" style="display: inline-block; background: #111827; color: #ffffff; font-family: Helvetica, sans-serif; font-size: 14px; line-height: 18px; font-weight: 700; text-decoration: none; padding: 12px 16px; border-radius: 8px;">${escapeHtml(actionLabel || 'Open')}</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin: 0; color: #6b7280; font-family: Helvetica, sans-serif; font-size: 12px; line-height: 18px;">If the button does not work, copy this link into your browser:<br><a href="${safeActionUrl}" style="color: #374151; word-break: break-all;">${safeActionUrl}</a></p>
                ` : ''}
                ${note ? `<p style="margin: 18px 0 0 0; color: #6b7280; font-family: Helvetica, sans-serif; font-size: 12px; line-height: 18px;">${escapeHtml(note)}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding: 14px 0 0 0; color: #6b7280; font-family: Helvetica, sans-serif; font-size: 12px; line-height: 18px;">
                Sent by Seemplify on behalf of ${escapeHtml(organizationName)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderTextEmail({ title, greeting, body = [], details = [], actionLabel, actionUrl, note }) {
  const lines = [
    compactText(title),
    '',
    compactText(greeting),
    ...body.map(compactText).filter(Boolean),
    '',
    ...details
      .filter((detail) => detail && detail.value !== undefined && detail.value !== null && String(detail.value).trim())
      .map((detail) => `${compactText(detail.label)}: ${compactText(detail.value)}`),
    '',
    actionUrl ? `${compactText(actionLabel || 'Open')}: ${actionUrl}` : '',
    note ? `\n${compactText(note)}` : ''
  ].filter((line, index, all) => line || all[index - 1]);

  return lines.join('\n').trim();
}

function envelopeTitle(envelope = {}) {
  return envelope.title || 'Document packet';
}

function signerActionUrl({ signer, envelope, transition, organization, request, req }) {
  if (signer?.role === 'internal') {
    return `${recruiterFrontendBaseUrl()}/people-transitions/envelopes/${envelope._id}`;
  }
  return candidatePortalUrl(transitionPortalPath(transition), { organization, request: request || req });
}

function envelopeDocumentCount(envelope = {}) {
  const count = Array.isArray(envelope.documents) ? envelope.documents.length : 0;
  if (!count) return '';
  return `${count} document${count === 1 ? '' : 's'}`;
}

async function sendCandidateInvite({ candidate, organization, inviteToken, onboarding, request, req }) {
  const portalContext = { organization, request: request || req };
  const portalUrl = candidatePortalUrl(`/signup?token=${encodeURIComponent(inviteToken)}`, portalContext);
  const name = candidateName(candidate);
  const organizationName = organization?.name || 'Seemplify';
  const transition = await transitionSummary(onboarding);
  const title = `Your ${transition.lowerLabel} process is ready`;
  const greeting = `Hello ${name},`;
  const body = [
    `${organizationName} has started your ${transition.lowerLabel} process in the candidate portal.`,
    'Use the secure link below to review your tasks, complete any requested forms, and sign documents when they are ready.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Transition', value: transition.title }
  ];

  await emailService.sendEmail({
    to: candidate.email,
    subject: `${transition.label} process from ${organizationName}`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Open candidate portal', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${organizationName} has started your ${transition.lowerLabel} process.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Open candidate portal',
      actionUrl: portalUrl
    })
  });

  return portalUrl;
}

async function sendEnvelopeNotification({ candidate, organization, envelope, request, req }) {
  const transition = await transitionSummary(envelope);
  const portalUrl = candidatePortalUrl(transitionPortalPath(transition), { organization, request: request || req });
  const name = candidateName(candidate);
  const organizationName = organization?.name || 'Seemplify';
  const packetTitle = envelopeTitle(envelope);
  const title = 'Documents are ready';
  const greeting = `Hello ${name},`;
  const body = [
    `${organizationName} sent a document packet for your ${transition.lowerLabel} process.`,
    'Review each document in the candidate portal. The portal will guide you through the packet in order.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Packet', value: packetTitle },
    { label: 'Documents', value: envelopeDocumentCount(envelope) }
  ];

  return emailService.sendEmail({
    to: candidate.email,
    subject: `${transition.label} documents ready: ${packetTitle}`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Review documents', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${packetTitle} is ready for review.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Review documents',
      actionUrl: portalUrl
    })
  });
}

async function sendEnvelopeReminder({ signer, organization, envelope, request, req }) {
  const transition = await transitionSummary(envelope);
  const portalUrl = signerActionUrl({ signer, envelope, transition, organization, request, req });
  const organizationName = organization?.name || 'Seemplify';
  const name = signer.name || signer.email || 'there';
  const packetTitle = envelopeTitle(envelope);
  const title = 'Signature reminder';
  const greeting = `Hello ${name},`;
  const body = [
    `${packetTitle} is still waiting for your signature.`,
    signer.role === 'internal'
      ? 'Open the recruiter workspace to review the packet and complete your signing step.'
      : 'Open the candidate portal to continue from the next pending document.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Packet', value: packetTitle },
    { label: 'Status', value: 'Waiting for signature' }
  ];

  return emailService.sendEmail({
    to: signer.email,
    subject: `Reminder: ${packetTitle} needs your signature`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Open document packet', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${packetTitle} is still waiting for your signature.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Open document packet',
      actionUrl: portalUrl
    })
  });
}

async function sendEnvelopeSignerNotification({ signer, organization, envelope, request, req }) {
  const transition = await transitionSummary(envelope);
  const portalUrl = signerActionUrl({ signer, envelope, transition, organization, request, req });
  const organizationName = organization?.name || 'Seemplify';
  const name = signer.name || signer.email || 'there';
  const packetTitle = envelopeTitle(envelope);
  const title = 'Your signature is requested';
  const greeting = `Hello ${name},`;
  const body = [
    `${organizationName} sent ${packetTitle} for your review and signature.`,
    signer.role === 'internal'
      ? 'This packet is ready for your internal signing step.'
      : 'The candidate portal will take you to the next document that needs your action.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Packet', value: packetTitle },
    { label: 'Signer role', value: signer.role === 'internal' ? 'Internal signer' : 'Candidate' }
  ];

  return emailService.sendEmail({
    to: signer.email,
    subject: `${transition.label} signature requested: ${packetTitle}`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Review and sign', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${packetTitle} is ready for your signature.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Review and sign',
      actionUrl: portalUrl
    })
  });
}

async function sendEnvelopeCompleted({ recipientEmail, organization, envelope, request, req }) {
  const transition = await transitionSummary(envelope);
  const recipientSigner = Array.isArray(envelope.signers)
    ? envelope.signers.find((signer) => String(signer.email || '').toLowerCase() === String(recipientEmail || '').toLowerCase())
    : null;
  const portalUrl = signerActionUrl({
    signer: recipientSigner || { role: 'candidate' },
    envelope,
    transition,
    organization,
    request,
    req
  });
  const organizationName = organization?.name || 'Seemplify';
  const packetTitle = envelopeTitle(envelope);
  const name = recipientSigner?.name || recipientEmail || 'there';
  const title = 'Documents completed';
  const greeting = `Hello ${name},`;
  const body = [
    `${packetTitle} has been completed for the ${transition.lowerLabel} process.`,
    recipientSigner?.role === 'internal'
      ? 'Open the recruiter workspace to review the completed envelope.'
      : 'You can open the candidate portal to view or download the completed documents.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Packet', value: packetTitle },
    { label: 'Status', value: 'Completed' }
  ];

  return emailService.sendEmail({
    to: recipientEmail,
    subject: `Completed ${transition.lowerLabel} documents: ${packetTitle}`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Open completed documents', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${packetTitle} has been completed.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Open completed documents',
      actionUrl: portalUrl
    })
  });
}

async function sendWorkflowReminder({ candidate, organization, onboarding, item, request, req }) {
  const transition = await transitionSummary(onboarding);
  const portalUrl = candidatePortalUrl(transitionPortalPath(transition), { organization, request: request || req });
  const name = candidateName(candidate);
  const organizationName = organization?.name || 'Seemplify';
  const taskTitle = item?.title || transition.title;
  const dueAt = item?.dueAt ? new Date(item.dueAt) : null;
  const isOverdue = dueAt && !Number.isNaN(dueAt.getTime()) && dueAt < new Date();
  const title = isOverdue ? 'Action overdue' : 'Action due soon';
  const greeting = `Hello ${name},`;
  const body = [
    `${taskTitle} is waiting in your transition portal.`,
    isOverdue
      ? 'Please complete it as soon as possible so the process can continue.'
      : 'Please complete it before the due date so the process stays on track.'
  ];
  const details = [
    { label: 'Process', value: transition.label },
    { label: 'Task', value: taskTitle },
    { label: 'Due date', value: formatDate(item?.dueAt) },
    { label: 'Status', value: isOverdue ? 'Overdue' : 'Due soon' }
  ];

  return emailService.sendEmail({
    to: candidate.email,
    subject: `${isOverdue ? 'Overdue' : 'Due soon'}: ${taskTitle}`,
    organizationName,
    text: renderTextEmail({ title, greeting, body, details, actionLabel: 'Open transition portal', actionUrl: portalUrl }),
    html: renderTransitionEmail({
      organizationName,
      processLabel: transition.label,
      preheader: `${taskTitle} is ${isOverdue ? 'overdue' : 'due soon'}.`,
      title,
      greeting,
      body,
      details,
      actionLabel: 'Open transition portal',
      actionUrl: portalUrl
    })
  });
}

module.exports = {
  DEFAULT_AKWA_IBOM_CANDIDATE_PORTAL_URL,
  candidatePortalBaseUrl,
  candidatePortalUrl,
  isAkwaIbomContext,
  sendCandidateInvite,
  sendEnvelopeNotification,
  sendEnvelopeSignerNotification,
  sendEnvelopeReminder,
  sendEnvelopeCompleted,
  sendWorkflowReminder
};
