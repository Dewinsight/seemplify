import crypto from 'node:crypto'
import dotenv from 'dotenv'
import { formatMailAddress, isMailConfigured, sendMail } from './mailClient.js'

dotenv.config()

class EmailService {
  constructor() {
    this.senderEmail = process.env.MAIL_FROM_EMAIL || process.env.SENDER_EMAIL || 'no-reply@seemplifyai.com'
    this.senderName = process.env.MAIL_FROM_NAME || process.env.SENDER_NAME || 'Seemplify Learning'
  }

  /** True when the mail service URL, credential and sender are all present. */
  isConfigured() {
    return isMailConfigured()
  }

  /**
   * Sends one transactional message through the self-hosted Seemplify mail
   * service. When the service is not configured the send is skipped rather than
   * throwing, preserving the previous behaviour for optional notifications.
   */
  async sendEmail({ to, subject, html, text, idempotencyKey, tag, replyTo }) {
    if (!to || !subject || !html) {
      throw new Error('Missing required email fields')
    }

    if (!this.isConfigured()) {
      console.warn('Mail service is not configured (MAIL_API_BASE_URL / MAIL_API_TOKEN / MAIL_FROM_EMAIL). Email delivery skipped.')
      return { skipped: true }
    }

    return sendMail({
      from: formatMailAddress(this.senderEmail),
      fromName: this.senderName,
      to,
      subject,
      html,
      text,
      tag,
      replyTo,
      idempotencyKey: String(idempotencyKey || '').trim() || crypto.randomUUID()
    })
  }

  async sendNotificationEmail({ to, subject, html, text, idempotencyKey, tag }) {
    return this.sendEmail({ to, subject, html, text, idempotencyKey, tag: tag || 'notification' })
  }
}

export const emailService = new EmailService()
export default emailService
