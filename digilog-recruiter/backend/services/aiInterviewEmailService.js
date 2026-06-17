const crypto = require('crypto');
const cron = require('node-cron');
const prisma = require('../db/client');
const emailService = require('./emailService');
const creditsService = require('./creditsService');

const AI_INTERVIEW_ACTION = 'aiInterviewCandidate';

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createPublicToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashPublicToken(token)
  };
}

function getFrontendUrl() {
  const configuredUrl =
    process.env.AI_INTERVIEW_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_BASE_URL;

  if (!configuredUrl) {
    throw new Error('AI_INTERVIEW_FRONTEND_URL or FRONTEND_URL must be set before sending AI interview invitations');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch (_) {
    throw new Error('AI interview frontend URL must be a valid absolute URL');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (localHosts.has(parsedUrl.hostname)) {
    throw new Error('AI interview invitation links cannot use localhost. Set AI_INTERVIEW_FRONTEND_URL to the public app URL.');
  }

  return parsedUrl.origin;
}

function buildEmailHtml({ candidateName, organizationName, jobTitle, interviewTitle, questionCount, expiresAt, interviewUrl }) {
  const expiry = new Date(expiresAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h2 style="color: #111827;">AI Interview Invitation</h2>
      <p>Hello ${candidateName},</p>
      <p>${organizationName} has invited you to complete an AI interview for <strong>${jobTitle}</strong>.</p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Interview:</strong> ${interviewTitle}</p>
        <p style="margin: 6px 0 0;"><strong>Questions:</strong> ${questionCount}</p>
        <p style="margin: 6px 0 0;"><strong>Deadline:</strong> ${expiry}</p>
      </div>
      <p>Use the secure link below to review the guidelines and start when you are ready.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse: separate; margin: 28px auto; width: auto;">
        <tr>
          <td align="center" bgcolor="#111827" style="border-radius: 6px; mso-padding-alt: 14px 28px;">
            <a href="${interviewUrl}" target="_blank" style="background: #111827; border: 1px solid #111827; border-radius: 6px; color: #ffffff; display: inline-block; font-family: Arial, sans-serif; font-size: 15px; font-weight: 700; line-height: 20px; min-width: 190px; padding: 14px 28px; text-align: center; text-decoration: none; white-space: nowrap; -webkit-text-size-adjust: none;">
              Start AI Interview
            </a>
          </td>
        </tr>
      </table>
      <p style="font-size: 13px; color: #6b7280; word-break: break-word;">If the button does not open, copy and paste this link into your browser:<br><a href="${interviewUrl}" style="color: #2563eb; text-decoration: underline;">${interviewUrl}</a></p>
      <p style="font-size: 13px; color: #6b7280;">This link is unique to you. Please do not forward it.</p>
    </div>
  `;
}

class AIInterviewEmailService {
  constructor() {
    this.isRunning = false;
    this.task = null;
  }

  start() {
    console.log('Starting AI interview invite scheduler...');
    this.task = cron.schedule('* * * * *', async () => {
      if (this.isRunning) return;
      this.isRunning = true;
      try {
        await this.checkAndSendInvites();
      } catch (error) {
        console.error('AI interview invite scheduler failed:', error);
      } finally {
        this.isRunning = false;
      }
    });
    console.log('AI interview invite scheduler started');
  }

  stop() {
    if (this.task?.stop) {
      this.task.stop();
    }
    this.isRunning = false;
  }

  async checkAndSendInvites() {
    const now = new Date();
    const sessions = await prisma.aIInterviewSession.findMany({
      where: { status: 'pending_send' },
      take: 50
    });

    // Resolve parent AIInterviews (status filter in DB; schedule is a Json column
    // so the sendAt/expiresAt window is applied in JS).
    const interviewIds = Array.from(new Set(sessions.map((s) => s.aiInterviewId).filter(Boolean)));
    const interviews = interviewIds.length
      ? await prisma.aIInterview.findMany({
          where: {
            id: { in: interviewIds },
            status: { in: ['scheduled', 'sending', 'active'] }
          }
        })
      : [];

    const dueInterviews = interviews.filter((interview) => {
      const sendAt = interview.schedule?.sendAt ? new Date(interview.schedule.sendAt) : null;
      const expiresAt = interview.schedule?.expiresAt ? new Date(interview.schedule.expiresAt) : null;
      return sendAt && expiresAt && sendAt <= now && expiresAt > now;
    });

    // Stitch job (title) + organization (name) onto each due interview.
    const jobIds = Array.from(new Set(dueInterviews.map((i) => i.jobId).filter(Boolean)));
    const orgIds = Array.from(new Set(dueInterviews.map((i) => i.organizationId).filter(Boolean)));
    const jobs = jobIds.length
      ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true, organizationId: true } })
      : [];
    const orgs = orgIds.length
      ? await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const jobById = new Map(jobs.map((j) => [String(j.id), j]));
    const orgById = new Map(orgs.map((o) => [String(o.id), o]));
    for (const interview of dueInterviews) {
      interview.job = interview.jobId ? (jobById.get(String(interview.jobId)) || null) : null;
      interview.organization = interview.organizationId ? (orgById.get(String(interview.organizationId)) || null) : null;
    }
    const interviewById = new Map(dueInterviews.map((i) => [String(i.id), i]));

    const dueSessions = sessions
      .map((session) => {
        const interview = session.aiInterviewId ? interviewById.get(String(session.aiInterviewId)) : null;
        if (!interview) return null;
        session.aiInterview = interview;
        return session;
      })
      .filter(Boolean);

    for (const session of dueSessions) {
      await this.sendInvite(session);
    }
  }

  async sendInvite(session) {
    const interview = session.aiInterview;
    const organizationId = session.organizationId;
    const candidateEmail = session.candidateSnapshot?.email;

    if (!candidateEmail) {
      // email is a Json column -> read-modify-write the nested fields.
      const fresh = await prisma.aIInterviewSession.findFirst({
        where: { id: session._id, status: 'pending_send' },
        select: { id: true, email: true }
      });
      if (fresh) {
        const email = { ...(fresh.email || {}) };
        email.lastError = 'Candidate email is missing';
        email.attempts = Number(email.attempts || 0) + 1;
        await prisma.aIInterviewSession.update({
          where: { id: fresh.id },
          data: { status: 'email_failed', email }
        });
      }
      return false;
    }

    let cost = Number(session.credits?.cost || interview.creditCostPerCandidate || 0);
    if (!session.credits?.charged) {
      const creditCheck = await creditsService.checkSufficientCredits(organizationId, AI_INTERVIEW_ACTION, {
        creditCostOverride: cost
      });
      cost = Number(creditCheck.cost || cost || interview.creditCostPerCandidate || 0);
      if (!creditCheck.allowed || (Number.isFinite(creditCheck.remaining) && creditCheck.remaining < cost)) {
        // credits is a Json column -> read-modify-write the nested fields.
        const fresh = await prisma.aIInterviewSession.findFirst({
          where: { id: session._id, status: 'pending_send' },
          select: { id: true, credits: true }
        });
        if (fresh) {
          const credits = { ...(fresh.credits || {}) };
          credits.cost = cost;
          credits.error = creditCheck.message || 'Insufficient credits';
          await prisma.aIInterviewSession.update({
            where: { id: fresh.id },
            data: { status: 'credit_blocked', credits }
          });
        }
        return false;
      }
    }

    const { token, tokenHash } = createPublicToken();
    const interviewUrl = `${getFrontendUrl().replace(/\/$/, '')}/public/ai-interview/${token}`;
    // Conditional claim (only while still pending_send); email is a Json column.
    const claimable = await prisma.aIInterviewSession.findFirst({
      where: { id: session._id, status: 'pending_send' },
      select: { id: true, email: true }
    });
    let claimedSession = null;
    if (claimable) {
      const email = { ...(claimable.email || {}) };
      email.lastError = undefined;
      email.attempts = Number(email.attempts || 0) + 1;
      claimedSession = await prisma.aIInterviewSession.update({
        where: { id: claimable.id },
        data: {
          status: 'sending',
          tokenHash,
          tokenGeneratedAt: new Date(),
          email
        }
      });
    }

    if (!claimedSession) {
      return false;
    }
    session = claimedSession;

    const organizationName =
      interview.organization?.name ||
      (await prisma.organization.findUnique({ where: { id: String(organizationId) }, select: { name: true } }))?.name ||
      'Organization';
    const jobTitle = interview.job?.title || 'the role';
    const candidateName = session.candidateSnapshot?.name || candidateEmail;

    try {
      const result = await emailService.sendEmail({
        to: candidateEmail,
        subject: `AI Interview Invitation - ${jobTitle}`,
        organizationName,
        html: buildEmailHtml({
          candidateName,
          organizationName,
          jobTitle,
          interviewTitle: interview.title,
          questionCount: interview.questionSnapshots.length,
          expiresAt: interview.schedule.expiresAt,
          interviewUrl
        }),
        text: `Hello ${candidateName}, ${organizationName} has invited you to complete an AI interview for ${jobTitle}. Start here: ${interviewUrl}`
      });

      // email/credits are Json columns -> mutate local copies then persist.
      if (!session.email || typeof session.email !== 'object') session.email = {};
      if (!session.credits || typeof session.credits !== 'object') session.credits = {};

      session.status = 'sent';
      session.email.sentAt = new Date();
      session.email.messageId = result?.messageId || result?.messageIds?.[0] || undefined;
      session.email.lastError = undefined;
      session.credits.cost = cost;

      if (cost > 0 && !session.credits.charged) {
        const creditResult = await creditsService.consumeCredits(
          organizationId,
          AI_INTERVIEW_ACTION,
          session._id,
          'aiInterview',
          session.createdById,
          {
            creditCostOverride: cost,
            aiInterviewId: interview._id,
            candidateId: session.candidateId,
            candidateEmail,
            voice: interview.voice,
            costEstimate: interview.costEstimate
          }
        );

        if (!creditResult?.success) {
          session.status = 'credit_error';
          session.credits.error = creditResult?.message || 'Credit deduction failed after email send';
        } else {
          session.credits.charged = true;
          session.credits.chargedAt = new Date();
        }
      }

      await prisma.aIInterviewSession.update({
        where: { id: session.id },
        data: { status: session.status, email: session.email, credits: session.credits }
      });
      if (interview.status === 'scheduled') {
        await prisma.aIInterview.update({ where: { id: interview._id }, data: { status: 'active' } });
      }
      return {
        sent: session.status === 'sent',
        interviewUrl,
        messageId: session.email.messageId
      };
    } catch (error) {
      if (!session.email || typeof session.email !== 'object') session.email = {};
      session.status = 'email_failed';
      session.email.lastError = error.message;
      await prisma.aIInterviewSession.update({
        where: { id: session.id },
        data: { status: session.status, email: session.email }
      });
      return false;
    }
  }
}

module.exports = new AIInterviewEmailService();
