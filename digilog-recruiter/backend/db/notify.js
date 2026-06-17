// Prisma notification fan-out helpers — Postgres port of the Mongoose
// Notification statics. Creates a notification for the actor plus every active
// org member (from the OrganizationMember table). Non-critical / best-effort.
const prisma = require('./client');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

const idOf = (x) => (x && typeof x === 'object' ? String(x._id || x.id) : (x == null ? null : String(x)));

async function orgContext(userId) {
  const creator = await prisma.user.findUnique({ where: { id: String(userId) } });
  if (!creator) return null;
  const orgId = creator.currentOrganizationId || null;
  let orgName = null;
  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    orgName = org?.name || null;
  }
  let memberIds = [];
  if (orgId) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: orgId, status: 'active' }, select: { userId: true },
    });
    memberIds = members.map((m) => m.userId).filter((id) => id !== String(userId));
  }
  const creatorName = creator.name || creator.profile?.firstName
    ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim() || creator.email
    : creator.email;
  return { creator, orgId, orgName, memberIds, creatorName };
}

async function insert(notifications) {
  if (!notifications.length) return [];
  return prisma.notification.createMany({ data: notifications });
}

async function createJobCreatedNotification(userId, jobData) {
  try {
    const ctx = await orgContext(userId);
    if (!ctx) return;
    const jobId = idOf(jobData);
    const dept = jobData.department || jobData.departmentName || '';
    const data = { jobId, jobTitle: decodeHtmlEntities(jobData.title), department: decodeHtmlEntities(dept), location: decodeHtmlEntities(jobData.location), type: decodeHtmlEntities(jobData.type), creatorId: String(userId), creatorName: ctx.creatorName, organizationId: ctx.orgId, organizationName: ctx.orgName };
    const common = { type: 'job_created', actionUrl: `/jobs/${jobId}`, actionText: 'View Job', priority: 'medium', read: false, data };
    return insert([
      { userId: String(userId), title: decodeHtmlEntities(`Job created: ${jobData.title}`), message: decodeHtmlEntities(`You created a new job posting for ${jobData.title}${dept ? ` in ${dept}` : ''}`), ...common },
      ...ctx.memberIds.map((mid) => ({ userId: mid, title: decodeHtmlEntities(`New job posted: ${jobData.title}`), message: decodeHtmlEntities(`${ctx.creatorName} created a new job posting for ${jobData.title}${dept ? ` in ${dept}` : ''}`), ...common })),
    ]);
  } catch (e) { console.error('Error creating job notifications:', e.message); }
}

function displayCandidateName(c) {
  const fn = c.firstName && c.firstName !== 'N/A' ? c.firstName : '';
  const ln = c.lastName && c.lastName !== 'N/A' ? c.lastName : '';
  if (fn && ln) return `${fn} ${ln}`;
  if (fn) return fn; if (ln) return ln;
  if (c.email && c.email !== 'candidate-' && !c.email.includes('@temp.com')) return c.email.split('@')[0];
  if (c.position && c.position !== 'N/A') return `Candidate (${c.position})`;
  return 'New Candidate';
}

async function createCandidateUploadedNotification(userId, candidateData) {
  try {
    const ctx = await orgContext(userId);
    if (!ctx) return;
    const candidateId = idOf(candidateData);
    const name = displayCandidateName(candidateData);
    const data = { candidateId, candidateName: name, position: candidateData.position, email: candidateData.email, source: candidateData.source, creatorId: String(userId), creatorName: ctx.creatorName, organizationId: ctx.orgId, organizationName: ctx.orgName };
    const common = { type: 'candidate_uploaded', actionUrl: `/candidates/${candidateId}`, actionText: 'View Candidate', priority: 'medium', read: false, data };
    return insert([
      { userId: String(userId), title: decodeHtmlEntities(`Candidate added: ${name}`), message: decodeHtmlEntities(`You added ${name} to the candidate database`), ...common },
      ...ctx.memberIds.map((mid) => ({ userId: mid, title: decodeHtmlEntities(`New candidate: ${name}`), message: decodeHtmlEntities(`${ctx.creatorName} added ${name} to the candidate database`), ...common })),
    ]);
  } catch (e) { console.error('Error creating candidate notifications:', e.message); }
}

async function createInterviewCreatedNotification(userId, interviewData) {
  try {
    const ctx = await orgContext(userId);
    if (!ctx) return;
    const interviewId = idOf(interviewData);
    const scheduledDate = interviewData.scheduledAt ? new Date(interviewData.scheduledAt).toLocaleDateString() : '';
    const data = { interviewId, candidateId: interviewData.candidateId, candidateName: interviewData.candidateName, jobTitle: interviewData.jobTitle, scheduledAt: interviewData.scheduledAt, duration: interviewData.duration, type: interviewData.type, creatorId: String(userId), creatorName: ctx.creatorName, organizationId: ctx.orgId, organizationName: ctx.orgName };
    const common = { type: 'interview_created', actionUrl: `/interviews/${interviewId}`, actionText: 'View Interview', priority: 'high', read: false, data };
    return insert([
      { userId: String(userId), title: decodeHtmlEntities(`Interview scheduled: ${interviewData.candidateName}`), message: decodeHtmlEntities(`You scheduled an interview with ${interviewData.candidateName} for ${scheduledDate}`), ...common },
      ...ctx.memberIds.map((mid) => ({ userId: mid, title: decodeHtmlEntities(`Interview scheduled: ${interviewData.candidateName}`), message: decodeHtmlEntities(`${ctx.creatorName} scheduled an interview with ${interviewData.candidateName} for ${scheduledDate}`), ...common })),
    ]);
  } catch (e) { console.error('Error creating interview notifications:', e.message); }
}

async function createInterviewCancelledNotification(userId, interviewData, cancellationReason) {
  try {
    const ctx = await orgContext(userId);
    if (!ctx) return [];
    const interviewId = idOf(interviewData);
    const scheduledDate = interviewData.scheduledAt ? new Date(interviewData.scheduledAt).toLocaleDateString() : '';
    const data = { interviewId, candidateId: interviewData.candidateId, candidateName: interviewData.candidateName, jobTitle: interviewData.jobTitle, scheduledAt: interviewData.scheduledAt, duration: interviewData.duration, type: interviewData.type, cancellerId: String(userId), cancellerName: ctx.creatorName, cancellationReason, organizationId: ctx.orgId, organizationName: ctx.orgName };
    const common = { type: 'interview_cancelled', actionUrl: `/calendar`, actionText: 'View Calendar', priority: 'medium', read: false, data };
    return insert([
      { userId: String(userId), title: `Interview cancelled: ${interviewData.candidateName}`, message: `You cancelled the interview with ${interviewData.candidateName} scheduled for ${scheduledDate}`, ...common },
      ...ctx.memberIds.map((mid) => ({ userId: mid, title: `Interview cancelled: ${interviewData.candidateName}`, message: `${ctx.creatorName} cancelled the interview with ${interviewData.candidateName} scheduled for ${scheduledDate}${cancellationReason ? `. Reason: ${cancellationReason}` : ''}`, ...common })),
    ]);
  } catch (e) { console.error('Error creating interview cancellation notifications:', e.message); return []; }
}

module.exports = {
  createJobCreatedNotification,
  createCandidateUploadedNotification,
  createInterviewCreatedNotification,
  createInterviewCancelledNotification,
};
