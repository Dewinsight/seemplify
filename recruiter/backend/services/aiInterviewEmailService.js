const crypto = require('crypto');
const cron = require('node-cron');
const AIInterview = require('../models/AIInterview');
const AIInterviewSession = require('../models/AIInterviewSession');
const Organization = require('../models/Organization');
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
    const sessions = await AIInterviewSession.find({
      status: 'pending_send'
    })
      .populate({
        path: 'aiInterview',
        match: {
          status: { $in: ['scheduled', 'sending', 'active'] },
          'schedule.sendAt': { $lte: now },
          'schedule.expiresAt': { $gt: now }
        },
        populate: [
          { path: 'job', select: 'title organization' },
          { path: 'organization', select: 'name' }
        ]
      })
      .limit(50);

    const dueSessions = sessions.filter((session) => session.aiInterview);
    for (const session of dueSessions) {
      await this.sendInvite(session);
    }
  }

  async sendInvite(session) {
    const interview = session.aiInterview;
    const organizationId = session.organization;
    const candidateEmail = session.candidateSnapshot?.email;

    if (!candidateEmail) {
      await AIInterviewSession.findOneAndUpdate(
        { _id: session._id, status: 'pending_send' },
        {
          $set: {
            status: 'email_failed',
            'email.lastError': 'Candidate email is missing'
          },
          $inc: { 'email.attempts': 1 }
        }
      );
      return false;
    }

    let cost = Number(session.credits?.cost || interview.creditCostPerCandidate || 0);
    if (!session.credits?.charged) {
      const creditCheck = await creditsService.checkSufficientCredits(organizationId, AI_INTERVIEW_ACTION);
      cost = Number(creditCheck.cost || interview.creditCostPerCandidate || 0);
      if (!creditCheck.allowed || (Number.isFinite(creditCheck.remaining) && creditCheck.remaining < cost)) {
        await AIInterviewSession.findOneAndUpdate(
          { _id: session._id, status: 'pending_send' },
          {
            $set: {
              status: 'credit_blocked',
              'credits.cost': cost,
              'credits.error': creditCheck.message || 'Insufficient credits'
            }
          }
        );
        return false;
      }
    }

    const { token, tokenHash } = createPublicToken();
    const interviewUrl = `${getFrontendUrl().replace(/\/$/, '')}/public/ai-interview/${token}`;
    const claimedSession = await AIInterviewSession.findOneAndUpdate(
      { _id: session._id, status: 'pending_send' },
      {
        $set: {
          status: 'sending',
          tokenHash,
          tokenGeneratedAt: new Date(),
          'email.lastError': undefined
        },
        $inc: { 'email.attempts': 1 }
      },
      { new: true }
    );

    if (!claimedSession) {
      return false;
    }
    session = claimedSession;

    const organizationName =
      interview.organization?.name ||
      (await Organization.findById(organizationId).select('name'))?.name ||
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
          session.createdBy,
          {
            aiInterviewId: interview._id,
            candidateId: session.candidate,
            candidateEmail
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

      await session.save();
      if (interview.status === 'scheduled') {
        await AIInterview.findByIdAndUpdate(interview._id, { status: 'active' });
      }
      return {
        sent: session.status === 'sent',
        interviewUrl,
        messageId: session.email.messageId
      };
    } catch (error) {
      session.status = 'email_failed';
      session.email.lastError = error.message;
      await session.save();
      return false;
    }
  }
}

module.exports = new AIInterviewEmailService();
