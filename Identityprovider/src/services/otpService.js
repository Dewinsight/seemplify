import crypto from 'crypto'
import { emailService } from './emailService.js'

/**
 * OTP Service for Identity Provider
 * Handles OTP generation, storage, verification for:
 * - Email verification on signup
 * - Password reset
 * - Device verification on login (future)
 * 
 * Based on SmartHR's OTP implementation
 */
class OTPService {
  constructor() {
    this.otpExpiry = 10 * 60 * 1000 // 10 minutes
    this.maxAttempts = 5
    this.lockoutDuration = 30 * 60 * 1000 // 30 minutes
    this.resendCooldown = 60 * 1000 // 1 minute
    
    console.log('📱 OTP Service initialized for Identity Provider')
  }
  
  /**
   * Generate a 6-digit OTP
   * @returns {String} 6-digit OTP
   */
  generateOTP() {
    // Generate cryptographically secure random 6-digit number
    const otp = crypto.randomInt(100000, 999999).toString()
    return otp
  }
  
  /**
   * Store OTP in memory (temporary storage)
   * In production, consider using Redis for better scalability
   * @param {String} accountId - Account ID (sub)
   * @param {String} otp - Generated OTP
   * @param {String} purpose - Purpose of OTP (email_verification, password_reset, login)
   */
  storeOTP(accountId, otp, purpose = 'email_verification') {
    // For now, we'll store in memory. In production, use Redis
    if (!global.otpStore) {
      global.otpStore = new Map()
    }
    
    const key = `${accountId}_${purpose}`
    const hashedOTP = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex')
    
    global.otpStore.set(key, {
      otp: hashedOTP,
      createdAt: Date.now(),
      attempts: 0,
      purpose
    })
    
    console.log(`🔐 OTP stored for account ${accountId.slice(-8)} (purpose: ${purpose})`)
    
    // Auto-cleanup after expiry
    const expiryTimer = setTimeout(() => {
      if (global.otpStore?.has(key)) {
        global.otpStore.delete(key)
        console.log(`🧹 OTP expired and cleaned up for ${accountId.slice(-8)}`)
      }
    }, this.otpExpiry)
    expiryTimer.unref?.()
  }

  /**
   * Check whether a usable OTP already exists without consuming an attempt.
   * This lets an interrupted OIDC signup resume verification without sending
   * a new code on every successful password retry.
   */
  hasActiveOTP(accountId, purpose = 'email_verification') {
    if (!global.otpStore) return false

    const key = `${accountId}_${purpose}`
    const storedData = global.otpStore.get(key)
    if (!storedData) return false

    const expired = Date.now() - storedData.createdAt > this.otpExpiry
    const exhausted = storedData.attempts >= this.maxAttempts
    if (expired || exhausted) {
      global.otpStore.delete(key)
      return false
    }

    return true
  }
  
  /**
   * Verify OTP
   * @param {String} accountId - Account ID
   * @param {String} inputOTP - User provided OTP
   * @param {String} purpose - Purpose of OTP
   * @returns {Object} Verification result
   */
  verifyOTP(accountId, inputOTP, purpose = 'email_verification') {
    if (!global.otpStore) {
      return { valid: false, reason: 'No OTP found' }
    }
    
    const key = `${accountId}_${purpose}`
    const storedData = global.otpStore.get(key)
    
    if (!storedData) {
      return { valid: false, reason: 'No OTP found or expired' }
    }
    
    // Check if expired
    if (Date.now() - storedData.createdAt > this.otpExpiry) {
      global.otpStore.delete(key)
      return { valid: false, reason: 'OTP has expired' }
    }
    
    // Check attempts
    if (storedData.attempts >= this.maxAttempts) {
      return { valid: false, reason: 'Too many invalid attempts' }
    }
    
    // Hash input OTP for comparison
    const hashedInput = crypto
      .createHash('sha256')
      .update(inputOTP.toString())
      .digest('hex')
    
    if (hashedInput !== storedData.otp) {
      // Increment attempts
      storedData.attempts++
      global.otpStore.set(key, storedData)
      
      const remainingAttempts = this.maxAttempts - storedData.attempts
      return { 
        valid: false, 
        reason: 'Invalid OTP',
        remainingAttempts 
      }
    }
    
    // OTP is valid, remove it
    global.otpStore.delete(key)
    console.log(`✅ OTP verified successfully for ${accountId.slice(-8)} (purpose: ${purpose})`)
    return { valid: true }
  }
  
  /**
   * Check if account can receive new OTP (rate limiting)
   * @param {Object} account - Account document
   * @returns {Object} Check result
   */
  canSendOTP(account) {
    // Check if account is locked out
    if (account.security?.otpLockedUntil && new Date(account.security.otpLockedUntil) > new Date()) {
      const remainingTime = Math.ceil((new Date(account.security.otpLockedUntil) - new Date()) / 1000 / 60)
      return { 
        allowed: false, 
        reason: `Account locked. Try again in ${remainingTime} minutes` 
      }
    }
    
    // Check resend cooldown
    if (account.security?.lastOtpSent) {
      const timeSinceLastOTP = Date.now() - new Date(account.security.lastOtpSent).getTime()
      if (timeSinceLastOTP < this.resendCooldown) {
        const remainingTime = Math.ceil((this.resendCooldown - timeSinceLastOTP) / 1000)
        return { 
          allowed: false, 
          reason: `Please wait ${remainingTime} seconds before requesting new OTP` 
        }
      }
    }
    
    return { allowed: true }
  }
  
  /**
   * Send email verification OTP
   * @param {Object} account - Account document
   * @param {String} otp - Generated OTP
   * @returns {Promise} Email send result
   */
  async sendEmailVerificationOTP(account, otp) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              ✉️
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Verify Your Email</h1>
          </div>
          
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello ${account.profile?.name || account.email.split('@')[0]},</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              Thank you for creating your AIIN Identity account! To complete your registration and verify your email address, please use the following verification code:
            </p>
            
            <div style="background: #f9fafb; border: 2px solid #667eea; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600;">Your Verification Code</p>
              <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${otp}</p>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #92400e;">
                <strong>⏰ Important:</strong> This code will expire in 10 minutes.
              </p>
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🛡️ Security:</strong> Never share this code with anyone. AIIN Identity will never ask for your code via phone or email.
              </p>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
EMAIL VERIFICATION - AIIN IDENTITY
===================================

Hello ${account.profile?.name || account.email.split('@')[0]},

Thank you for creating your AIIN Identity account! To complete your registration and verify your email address, please use the following verification code:

VERIFICATION CODE: ${otp}

IMPORTANT:
- This code will expire in 10 minutes
- Never share this code with anyone
- If you did not create this account, please ignore this email

Need help? Contact us at support@aiinidentity.com

Best regards,
The AIIN Identity Team

© ${new Date().getFullYear()} AIIN Identity. All rights reserved.
    `.trim()

    return emailService.sendEmail({
      to: account.email,
      subject: 'Verify Your Email - AIIN Identity',
      html: htmlContent,
      text: textContent
    })
  }
  
  /**
   * Send password reset OTP
   * @param {Object} account - Account document
   * @param {String} otp - Generated OTP
   * @returns {Promise} Email send result
   */
  async sendPasswordResetOTP(account, otp) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 24px; text-align: center;">
            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 40px;">
              🔑
            </div>
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Password Reset Code</h1>
          </div>
          
          <div style="padding: 40px 24px; color: #333;">
            <p style="font-size: 18px; margin: 0 0 16px;">Hello,</p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 24px;">
              We received a request to reset the password for your AIIN Identity account (<strong>${account.email}</strong>).
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #666; margin: 0 0 16px;">
              Use this verification code to reset your password:
            </p>
            
            <div style="background: #f9fafb; border: 2px solid #667eea; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600;">Your Password Reset Code</p>
              <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #667eea;">${otp}</p>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #92400e;">
                <strong>⏰ Important:</strong> This code will expire in 10 minutes for security purposes.
              </p>
              <p style="margin: 0; font-size: 14px; color: #92400e;">
                <strong>🛡️ Security:</strong> If you did not request this password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #666;">
              Need help? Contact us at <a href="mailto:support@aiinidentity.com" style="color: #667eea; text-decoration: none;">support@aiinidentity.com</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © ${new Date().getFullYear()} AIIN Identity. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
PASSWORD RESET CODE - AIIN IDENTITY
====================================

Hello,

We received a request to reset the password for your AIIN Identity account (${account.email}).

PASSWORD RESET CODE: ${otp}

IMPORTANT:
- This code will expire in 10 minutes
- If you did not request this reset, ignore this email
- Your password will remain unchanged if you don't use this code

Need help? Contact us at support@aiinidentity.com

Best regards,
The AIIN Identity Team

© ${new Date().getFullYear()} AIIN Identity. All rights reserved.
    `.trim()

    return emailService.sendEmail({
      to: account.email,
      subject: 'Password Reset Code - AIIN Identity',
      html: htmlContent,
      text: textContent
    })
  }
  
  /**
   * Verify OTP
   * @param {String} accountId - Account ID
   * @param {String} inputOTP - User provided OTP
   * @param {String} purpose - Purpose of OTP
   * @returns {Object} Verification result
   */
  verifyOTP(accountId, inputOTP, purpose = 'email_verification') {
    if (!global.otpStore) {
      return { valid: false, reason: 'No OTP found' }
    }
    
    const key = `${accountId}_${purpose}`
    const storedData = global.otpStore.get(key)
    
    if (!storedData) {
      return { valid: false, reason: 'No OTP found or expired' }
    }
    
    // Check if expired
    if (Date.now() - storedData.createdAt > this.otpExpiry) {
      global.otpStore.delete(key)
      return { valid: false, reason: 'OTP has expired' }
    }
    
    // Check attempts
    if (storedData.attempts >= this.maxAttempts) {
      return { valid: false, reason: 'Too many invalid attempts' }
    }
    
    // Hash input OTP for comparison
    const hashedInput = crypto
      .createHash('sha256')
      .update(inputOTP.toString())
      .digest('hex')
    
    if (hashedInput !== storedData.otp) {
      // Increment attempts
      storedData.attempts++
      global.otpStore.set(key, storedData)
      
      const remainingAttempts = this.maxAttempts - storedData.attempts
      return { 
        valid: false, 
        reason: 'Invalid OTP',
        remainingAttempts 
      }
    }
    
    // OTP is valid, remove it
    global.otpStore.delete(key)
    console.log(`✅ OTP verified for ${accountId.slice(-8)} (purpose: ${purpose})`)
    return { valid: true }
  }
  
  /**
   * Update account's OTP attempts and lockout status
   * @param {Object} account - Account document
   * @param {Boolean} failed - Whether the attempt failed
   * @returns {Promise} Updated account
   */
  async updateOTPAttempts(account, failed = false) {
    if (!account.security) {
      account.security = {}
    }
    
    if (failed) {
      account.security.otpAttempts = (account.security.otpAttempts || 0) + 1
      
      // Lock account after max attempts
      if (account.security.otpAttempts >= this.maxAttempts) {
        account.security.otpLockedUntil = new Date(Date.now() + this.lockoutDuration)
        console.log(`🔒 Account locked for ${account.email} until`, account.security.otpLockedUntil)
      }
    } else {
      // Reset on successful verification
      account.security.otpAttempts = 0
      account.security.otpLockedUntil = null
      console.log(`🔓 OTP attempts reset for ${account.email}`)
    }
    
    return account.save()
  }
  
  /**
   * Clear OTP from storage
   * @param {String} accountId - Account ID
   * @param {String} purpose - Purpose of OTP
   */
  clearOTP(accountId, purpose = 'email_verification') {
    if (global.otpStore) {
      const key = `${accountId}_${purpose}`
      global.otpStore.delete(key)
      console.log(`🧹 OTP cleared for ${accountId.slice(-8)} (purpose: ${purpose})`)
    }
  }
}

export const otpService = new OTPService()
