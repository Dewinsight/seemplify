import dotenv from 'dotenv'
import { isConfigured, readEnvironment, sendMail } from './mailClient.js'

dotenv.config()

class EmailService {
  constructor() {
    const config = readEnvironment(process.env)
    this.apiKey = config.token
    this.apiBaseUrl = config.baseUrl
    this.senderEmail = config.fromEmail
    this.senderName = config.fromName
    this.identityProviderUrl = process.env.ISSUER_URL || 'http://localhost:4000'
  }

  async sendEmail({ to, subject, html, text }) {
    if (!isConfigured(process.env)) throw new Error('Email service not properly configured')
    return sendMail({ to, subject, html, text }, process.env)
  }

  async sendWelcomeEmail(to, name) {
    const displayName = name || to.split('@')[0]
    return this.sendEmail({
      to,
      subject: 'Welcome to AIIN Identity!',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Welcome to AIIN Identity</h2>
        <p>Hi ${displayName},</p>
        <p>Your account has been created successfully and is ready to use.</p>
        <p><a href="${this.identityProviderUrl}">Go to AIIN Identity</a></p>
      </body></html>`,
      text: `Hi ${displayName}, your AIIN Identity account is ready. Visit ${this.identityProviderUrl}`
    })
  }

  async sendPasswordResetEmail(to, token) {
    const resetUrl = `${this.identityProviderUrl}/reset-password/${token}`
    return this.sendEmail({
      to,
      subject: 'Password Reset Request - AIIN Identity',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Password Reset Request</h2>
        <p>We received a request to reset the password for <strong>${to}</strong>.</p>
        <p><a href="${resetUrl}">Reset Your Password</a></p>
        <p>This link expires in 1 hour.</p>
      </body></html>`,
      text: `Reset your password using this link: ${resetUrl}`
    })
  }

  async sendEmailVerificationOTP(to, otp, name) {
    const displayName = name || to.split('@')[0]
    return this.sendEmail({
      to,
      subject: 'Verify Your Email - AIIN Identity',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Verify Your Email</h2>
        <p>Hello ${displayName},</p>
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: bold;">${otp}</p>
        <p>This code expires in 10 minutes.</p>
      </body></html>`,
      text: `Hello ${displayName}, your verification code is ${otp}. It expires in 10 minutes.`
    })
  }

  async sendNotificationEmail({ to, toName, subject, html, text }) {
    const displayName = toName || to.split('@')[0]
    return this.sendEmail({
      to,
      subject,
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <p>Hi ${displayName},</p>
        ${html}
      </body></html>`,
      text: text || `Hi ${displayName}, ${html.replace(/<[^>]*>/g, '').trim()}`
    })
  }

  async sendPasswordResetOTP(to, otp) {
    return this.sendEmail({
      to,
      subject: 'Password Reset Code - AIIN Identity',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Password Reset Code</h2>
        <p>Your password reset code is:</p>
        <p style="font-size: 28px; font-weight: bold;">${otp}</p>
        <p>This code expires in 10 minutes.</p>
      </body></html>`,
      text: `Your password reset code is ${otp}. It expires in 10 minutes.`
    })
  }
}

export const emailService = new EmailService()
