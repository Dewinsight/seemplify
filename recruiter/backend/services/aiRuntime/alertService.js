const AIAuditEvent = require('../../models/AIAuditEvent');
const AIUsageDailyRollup = require('../../models/AIUsageDailyRollup');
const Admin = require('../../models/Admin');
const emailService = require('../emailService');
const { sanitizeMessage } = require('./usageService');

let lastMonthlyCheckAt = 0;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function resolveRecipients(config = {}) {
  const admins = await Admin.find({ role: 'super_admin', isActive: true }).select('email').lean();
  return Array.from(new Set([
    ...admins.map((admin) => String(admin.email || '').toLowerCase()),
    ...(Array.isArray(config.recipients) ? config.recipients : []).map((email) => String(email || '').trim().toLowerCase())
  ].filter(Boolean)));
}

async function reserveAlert({ dedupeKey, action, message, quotaGroup, model, metadata }) {
  try {
    return await AIAuditEvent.create({
      category: 'alert',
      action,
      status: 'suppressed',
      dedupeKey,
      message,
      quotaGroup,
      model,
      metadata
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function deliverAlert({ dedupeKey, action, subject, message, quotaGroup, model, metadata, config }) {
  if (!config?.enabled) return false;
  const reservation = await reserveAlert({ dedupeKey, action, message, quotaGroup, model, metadata });
  if (!reservation) return false;

  const recipients = await resolveRecipients(config);
  if (!recipients.length) {
    reservation.message = `${message} No active alert recipients were configured.`;
    await reservation.save();
    return false;
  }

  const adminUrl = String(process.env.ADMIN_FRONTEND_URL || process.env.FRONTEND_URL || 'https://app.seemplifyai.com').replace(/\/$/, '');
  const text = `${message}\n\nOpen AI Runtime: ${adminUrl}/admin/ai-runtime`;
  const html = `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(adminUrl)}/admin/ai-runtime">Open AI Runtime</a></p>`;
  const results = await Promise.allSettled(recipients.map((to) => emailService.sendEmail({
    to,
    subject,
    text,
    html,
    organizationName: 'Seemplify'
  })));
  const failed = results.filter((result) => result.status === 'rejected');
  reservation.status = failed.length === results.length ? 'failed' : 'sent';
  reservation.metadata = { ...(metadata || {}), recipients: recipients.length, failed: failed.length };
  if (failed.length) reservation.message = `${message} Delivery failures: ${failed.map((item) => sanitizeMessage(item.reason?.message)).join('; ')}`;
  await reservation.save();
  return failed.length < results.length;
}

async function evaluateDailyQuota({ event, quota, config }) {
  if (!quota || !Number.isFinite(Number(quota.requestLimitDaily)) || Number(quota.requestLimitDaily) <= 0) return;
  if (!Number.isFinite(Number(quota.requestRemainingDaily))) return;
  const percent = Math.max(0, (Number(quota.requestRemainingDaily) / Number(quota.requestLimitDaily)) * 100);
  const resetKey = quota.requestResetAt
    ? new Date(quota.requestResetAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const highestThreshold = Math.max(...(config.dailyRemainingPercent || []).map(Number).filter(Number.isFinite), 0);
  if (percent > highestThreshold) {
    const previousLow = await AIAuditEvent.findOne({
      category: 'alert',
      action: 'daily_quota_low',
      quotaGroup: event.quotaGroup,
      model: event.model,
      status: 'sent',
      createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) }
    }).lean();
    if (previousLow) {
      await deliverAlert({
        dedupeKey: `recovery:daily:${event.quotaGroup}:${event.model}:${resetKey}`,
        action: 'daily_quota_recovered',
        subject: 'Groq daily quota recovered',
        message: `${event.model} in ${event.quotaGroup} has recovered to ${Math.round(percent)}% daily requests remaining.`,
        quotaGroup: event.quotaGroup,
        model: event.model,
        metadata: { remainingPercent: percent, resetAt: quota.requestResetAt },
        config
      });
    }
  }

  for (const threshold of config.dailyRemainingPercent || []) {
    if (percent > Number(threshold)) continue;
    await deliverAlert({
      dedupeKey: `daily:${event.quotaGroup}:${event.model}:${resetKey}:${threshold}`,
      action: 'daily_quota_low',
      subject: `Groq daily quota at ${Math.round(percent)}% remaining`,
      message: `${event.model} in ${event.quotaGroup} has ${quota.requestRemainingDaily} of ${quota.requestLimitDaily} daily requests remaining.`,
      quotaGroup: event.quotaGroup,
      model: event.model,
      metadata: { threshold, remainingPercent: percent, resetAt: quota.requestResetAt },
      config
    });
  }
}

async function evaluateMonthlySpend({ event, config }) {
  const budget = Number(config.monthlyBudgetUsd);
  if (!Number.isFinite(budget) || budget <= 0 || Date.now() - lastMonthlyCheckAt < 5 * 60 * 1000) return;
  lastMonthlyCheckAt = Date.now();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await AIUsageDailyRollup.aggregate([
    { $match: { day: { $gte: start }, provider: 'groq' } },
    { $group: { _id: null, spend: { $sum: '$estimatedCostUsd' } } }
  ]);
  const spend = Number(row?.spend || 0);
  const percent = (spend / budget) * 100;
  const monthKey = start.toISOString().slice(0, 7);
  for (const threshold of config.monthlySpendPercent || []) {
    if (percent < Number(threshold)) continue;
    await deliverAlert({
      dedupeKey: `monthly:groq:${monthKey}:${threshold}`,
      action: 'monthly_spend_high',
      subject: `Estimated Groq spend reached ${Math.round(percent)}%`,
      message: `Groq has an estimated monthly spend of $${spend.toFixed(2)} against a local $${budget.toFixed(2)} budget. Groq billing remains the source of truth.`,
      quotaGroup: 'all-groq',
      model: event.model,
      metadata: { threshold, spend, budget, estimated: true },
      config
    });
  }
}

async function evaluateUsageAlerts({ event, quota, settings }) {
  const config = settings?.alerts || {};
  if (!config.enabled) return;
  try {
    await evaluateDailyQuota({ event, quota, config });
    await evaluateMonthlySpend({ event, config });
  } catch (error) {
    console.error('AI runtime alert evaluation failed:', sanitizeMessage(error.message));
  }
}

async function alertCredentialFailure({ credential, code, message, settings }) {
  const config = settings?.alerts || {};
  if (!config.enabled) return;
  const day = new Date().toISOString().slice(0, 10);
  await deliverAlert({
    dedupeKey: `credential:${credential._id}:${code}:${day}`,
    action: 'credential_unhealthy',
    subject: `Groq credential ${credential.label} needs attention`,
    message: `${credential.label} reported ${code}: ${sanitizeMessage(message)}`,
    quotaGroup: credential.quotaGroup,
    metadata: { credentialId: String(credential._id), code },
    config
  });
}

async function alertCredentialRecovery({ credential, settings }) {
  const config = settings?.alerts || {};
  if (!config.enabled) return;
  const day = new Date().toISOString().slice(0, 10);
  await deliverAlert({
    dedupeKey: `credential-recovery:${credential._id}:${day}`,
    action: 'credential_recovered',
    subject: `Groq credential ${credential.label} recovered`,
    message: `${credential.label} passed a provider request and is healthy again.`,
    quotaGroup: credential.quotaGroup,
    metadata: { credentialId: String(credential._id) },
    config
  });
}

module.exports = { alertCredentialFailure, alertCredentialRecovery, deliverAlert, evaluateUsageAlerts, resolveRecipients };
