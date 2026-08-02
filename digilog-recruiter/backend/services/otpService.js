const crypto = require('crypto');
const emailService = require('./emailService');

class OTPService {
  constructor() {
    this.otpExpiry = 10 * 60 * 1000; // 10 minutes
    this.maxAttempts = 5;
    this.lockoutDuration = 30 * 60 * 1000; // 30 minutes
    this.resendCooldown = 60 * 1000; // 1 minute
  }
  
  /**
   * Generate a 6-digit OTP
   * @returns {String} 6-digit OTP
   */
  generateOTP() {
    // Generate cryptographically secure random 6-digit number
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
  }
  
  /**
   * Store OTP in user's session/memory (temporary storage)
   * In production, consider using Redis for better scalability
   * @param {String} userId - User ID
   * @param {String} otp - Generated OTP
   * @param {String} purpose - Purpose of OTP (login, password_reset, etc.)
   */
  storeOTP(userId, otp, purpose = 'login') {
    // For now, we'll store in memory. In production, use Redis
    if (!global.otpStore) {
      global.otpStore = new Map();
    }
    
    const key = `${userId}_${purpose}`;
    const hashedOTP = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');
    
    global.otpStore.set(key, {
      otp: hashedOTP,
      createdAt: Date.now(),
      attempts: 0,
      purpose
    });
    
    // Auto-cleanup after expiry
    setTimeout(() => {
      global.otpStore.delete(key);
    }, this.otpExpiry);
  }
  
  /**
   * Verify OTP
   * @param {String} userId - User ID
   * @param {String} inputOTP - User provided OTP
   * @param {String} purpose - Purpose of OTP
   * @returns {Object} Verification result
   */
  verifyOTP(userId, inputOTP, purpose = 'login') {
    if (!global.otpStore) {
      return { valid: false, reason: 'No OTP found' };
    }
    
    const key = `${userId}_${purpose}`;
    const storedData = global.otpStore.get(key);
    
    if (!storedData) {
      return { valid: false, reason: 'No OTP found or expired' };
    }
    
    // Check if expired
    if (Date.now() - storedData.createdAt > this.otpExpiry) {
      global.otpStore.delete(key);
      return { valid: false, reason: 'OTP has expired' };
    }
    
    // Check attempts
    if (storedData.attempts >= this.maxAttempts) {
      return { valid: false, reason: 'Too many invalid attempts' };
    }
    
    // Hash input OTP for comparison
    const hashedInput = crypto
      .createHash('sha256')
      .update(inputOTP)
      .digest('hex');
    
    if (hashedInput !== storedData.otp) {
      // Increment attempts
      storedData.attempts++;
      global.otpStore.set(key, storedData);
      
      const remainingAttempts = this.maxAttempts - storedData.attempts;
      return { 
        valid: false, 
        reason: 'Invalid OTP',
        remainingAttempts 
      };
    }
    
    // OTP is valid, remove it
    global.otpStore.delete(key);
    return { valid: true };
  }
  
  /**
   * Check if user can receive new OTP (rate limiting)
   * @param {Object} user - User document
   * @returns {Object} Check result
   */
  canSendOTP(user) {
    // Check if user is locked out
    if (user.security?.otpLockedUntil && new Date(user.security.otpLockedUntil) > new Date()) {
      const remainingTime = Math.ceil((new Date(user.security.otpLockedUntil) - new Date()) / 1000 / 60);
      return { 
        allowed: false, 
        reason: `Account locked. Try again in ${remainingTime} minutes` 
      };
    }
    
    // Check resend cooldown
    if (user.security?.lastOtpSent) {
      const timeSinceLastOTP = Date.now() - new Date(user.security.lastOtpSent).getTime();
      if (timeSinceLastOTP < this.resendCooldown) {
        const remainingTime = Math.ceil((this.resendCooldown - timeSinceLastOTP) / 1000);
        return { 
          allowed: false, 
          reason: `Please wait ${remainingTime} seconds before requesting new OTP` 
        };
      }
    }
    
    return { allowed: true };
  }
  
  /**
   * Send OTP via email
   * @param {Object} user - User document
   * @param {String} otp - Generated OTP
   * @param {Object} browserInfo - Browser information
   * @returns {Promise} Email send result
   */
  async sendOTPEmail(user, otp, browserInfo) {
    // Plain text version - faster delivery, less spam filtering
    const textContent = `
New Device Login Verification

Hello ${user.profile?.firstName || 'User'},

We detected a login attempt from a new device:

Device: ${browserInfo.name} ${browserInfo.version}
Operating System: ${browserInfo.os}
Device Type: ${browserInfo.device}
Time: ${new Date().toLocaleString()}

Your verification code is: ${otp}

This code will expire in 10 minutes.

If you did not attempt to login, please change your password immediately and contact support.

---
This is an automated security email from SmartHR. Please do not reply to this email.
    `.trim();

    // Simplified HTML version - less styling for faster delivery
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Device Login Verification</h2>
        <p>Hello ${user.profile?.firstName || 'User'},</p>
        <p>We detected a login attempt from a new device:</p>
        
        <p><strong>Device:</strong> ${browserInfo.name} ${browserInfo.version}<br>
        <strong>Operating System:</strong> ${browserInfo.os}<br>
        <strong>Device Type:</strong> ${browserInfo.device}<br>
        <strong>Time:</strong> ${new Date().toLocaleString()}</p>
        
        <p>Your verification code is:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">${otp}</p>
        
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not attempt to login, please change your password immediately and contact support.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated security email from SmartHR. Please do not reply to this email.
        </p>
      </div>
    `.trim();
    
    return await emailService.sendEmail({
      to: user.email,
      subject: 'SmartHR - Device Verification Code',
      html: htmlContent,
      text: textContent  // Including plain text improves deliverability and reduces Gmail delays
    });
  }
  
  /**
   * Update user's OTP attempts and lockout status
   * @param {Object} user - User document
   * @param {Boolean} failed - Whether the attempt failed
   * @returns {Promise} Updated user
   */
  async updateOTPAttempts(user, failed = false) {
    if (!user.security) {
      user.security = {};
    }
    
    if (failed) {
      user.security.otpAttempts = (user.security.otpAttempts || 0) + 1;
      
      // Lock account after max attempts
      if (user.security.otpAttempts >= this.maxAttempts) {
        user.security.otpLockedUntil = new Date(Date.now() + this.lockoutDuration);
      }
    } else {
      // Reset on successful verification
      user.security.otpAttempts = 0;
      user.security.otpLockedUntil = null;
    }
    
    return await user.save();
  }
  
  /**
   * Clear OTP from storage
   * @param {String} userId - User ID
   * @param {String} purpose - Purpose of OTP
   */
  clearOTP(userId, purpose = 'login') {
    if (global.otpStore) {
      const key = `${userId}_${purpose}`;
      global.otpStore.delete(key);
    }
  }
}

module.exports = new OTPService();
