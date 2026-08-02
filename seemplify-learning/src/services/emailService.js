import dotenv from 'dotenv'

dotenv.config()

class EmailService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY || ''
    this.apiBaseUrl = 'https://api.brevo.com/v3/smtp/email'
    this.senderEmail = process.env.SENDER_EMAIL || 'no-reply@seemplifyai.com'
    this.senderName = process.env.SENDER_NAME || 'Seemplify Learning'
  }

  async sendEmail({ to, subject, html, text }) {
    if (!to || !subject || !html) {
      throw new Error('Missing required email fields')
    }

    if (!this.apiKey) {
      console.warn('BREVO_API_KEY missing. Email delivery skipped.')
      return { skipped: true }
    }

    const response = await fetch(this.apiBaseUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: this.senderName,
          email: this.senderEmail
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(text ? { textContent: text } : {})
      })
    })

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(result.message || 'Email send failed')
    }
    return result
  }

  async sendNotificationEmail({ to, subject, html, text }) {
    return this.sendEmail({ to, subject, html, text })
  }
}

export const emailService = new EmailService()
export default emailService
