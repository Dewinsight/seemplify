const crypto = require('crypto');
const emailService = require('../services/emailService');
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const browserFingerprintService = require('../services/browserFingerprintService');
const otpService = require('../services/otpService');
const sessionService = require('../services/sessionService');
const jwt = require('jsonwebtoken');

const router = express.Router();

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    // Check for existing user
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    // Create new user
    user = new User({
      email,
      password,
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Save user to database
    await user.save();

    // Email confirmation: send a one-time code (via Brevo) before first sign-in.
    // The frontend shows the OTP step, then calls POST /verify-otp which trusts
    // this browser, issues the session, and proceeds to organization setup.
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const otp = otpService.generateOTP();
    otpService.storeOTP(user.id, otp, 'login');

    user.security = user.security || {};
    user.security.lastOtpSent = new Date();
    await user.save();

    try {
      await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
    } catch (emailError) {
      console.error('Failed to send signup verification email:', emailError);
      return res.status(500).json({ msg: 'Failed to send verification email' });
    }

    return res.status(200).json({
      requiresOTP: true,
      message: 'Verification code sent to your email',
      browserInfo: fingerprintData.browserInfo
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token (with MFA for new browsers)
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    // Check for user
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Generate browser fingerprint
    const fingerprintData = browserFingerprintService.generateFingerprint(req);

    // Check if browser is trusted
    const isTrusted = browserFingerprintService.isBrowserTrusted(user, fingerprintData.fingerprint);

    // If browser is not trusted, require OTP
    if (!isTrusted) {
      // Check if user can receive OTP (rate limiting)
      const canSend = otpService.canSendOTP(user);

      // Even if rate limited, still show OTP modal so user can enter existing OTP
      if (!canSend.allowed) {
        return res.status(200).json({
          requiresOTP: true,
          message: canSend.reason,
          browserInfo: fingerprintData.browserInfo,
          rateLimited: true  // Flag to indicate rate limiting
        });
      }

      // Generate and send OTP
      const otp = otpService.generateOTP();
      otpService.storeOTP(user.id, otp, 'login');

      // Update user's last OTP sent time
      user.security = user.security || {};
      user.security.lastOtpSent = new Date();
      await user.save();

      // Send OTP email
      try {
        await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      } catch (emailError) {
        console.error('Failed to send OTP email:', emailError);
        return res.status(500).json({ msg: 'Failed to send verification email' });
      }

      // Return response indicating OTP is required
      return res.status(200).json({
        requiresOTP: true,
        message: 'Verification code sent to your email',
        browserInfo: fingerprintData.browserInfo
      });
    }

    // Browser is trusted, update last used
    await browserFingerprintService.updateBrowserLastUsed(user, fingerprintData.fingerprint);

    const { accessToken, refreshToken, session } = await sessionService.createSession({
      user,
      fingerprint: fingerprintData.fingerprint,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip,
    });

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionId: session.accessTokenId,
      user: {
        id: user.id,
        email: user.email,
        mfaEnabled: user.security?.mfaEnabled || false
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});
// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and complete login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  // Validate input
  if (!email || !otp) {
    return res.status(400).json({ msg: 'Please provide email and OTP' });
  }

  try {
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Verify OTP
    const verificationResult = otpService.verifyOTP(user.id, otp, 'login');

    if (!verificationResult.valid) {
      // Update failed attempts
      await otpService.updateOTPAttempts(user, true);

      return res.status(400).json({
        msg: verificationResult.reason,
        remainingAttempts: verificationResult.remainingAttempts
      });
    }

    // OTP is valid, reset attempts
    await otpService.updateOTPAttempts(user, false);

    // Get browser fingerprint and add to trusted browsers
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    await browserFingerprintService.addTrustedBrowser(user, fingerprintData);

    // Enable MFA if not already enabled
    if (!user.security?.mfaEnabled) {
      user.security = user.security || {};
      user.security.mfaEnabled = true;
      await user.save();
    }

    const { accessToken, refreshToken, session } = await sessionService.createSession({
      user,
      fingerprint: fingerprintData.fingerprint,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip,
    });

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionId: session.accessTokenId,
      user: {
        id: user.id,
        email: user.email,
        mfaEnabled: true
      },
      message: 'Device trusted successfully'
    });
  } catch (err) {
    console.error('OTP verification error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ msg: 'Refresh token is required' });
  }

  try {
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const { accessToken, refreshToken: newRefreshToken, user } = await sessionService.refreshSession(
      refreshToken,
      fingerprintData.fingerprint,
      req.headers['user-agent'] || 'unknown',
      req.ip,
    );

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionVersion: user.security?.sessionVersion || 1,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    const codeMap = {
      invalid_refresh_token: 'invalid_refresh_token',
      session_revoked: 'session_revoked',
      refresh_expired: 'refresh_expired',
      user_not_found: 'user_not_found',
    };

    const code = codeMap[error.message] || 'refresh_failed';
    res.status(401).json({ msg: 'Refresh token invalid or expired', code });
  }
});

// @route   POST /api/auth/resend-otp
// @desc    Resend OTP for login
// @access  Public
router.post('/resend-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Check if user can receive OTP (rate limiting)
    const canSend = otpService.canSendOTP(user);
    if (!canSend.allowed) {
      return res.status(429).json({ msg: canSend.reason });
    }

    // Clear old OTP and generate new one
    otpService.clearOTP(user.id, 'login');
    const otp = otpService.generateOTP();
    otpService.storeOTP(user.id, otp, 'login');

    // Update last OTP sent time
    user.security = user.security || {};
    user.security.lastOtpSent = new Date();
    await user.save();

    // Get browser info for email
    const fingerprintData = browserFingerprintService.generateFingerprint(req);

    // Send OTP email
    try {
      await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      res.json({
        message: 'New verification code sent to your email',
        nextResendIn: 60 // seconds
      });
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      return res.status(500).json({ msg: 'Failed to send verification email' });
    }
  } catch (err) {
    console.error('Resend OTP error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req, res) => {
  const { email, frontendUrl } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      // We don't want to reveal that the user doesn't exist
      return res.status(200).json({ msg: 'If a user with that email exists, a password reset link has been sent.' });
    }

    // Generate token
    const token = crypto.randomBytes(20).toString('hex');

    // Set token and expiration on user
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

    await user.save();

    // Send email with dynamic frontend URL
    await emailService.sendPasswordResetEmail(user.email, token, frontendUrl);

    res.json({ msg: 'If a user with that email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).send('Server error');
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ msg: 'Password reset token is invalid or has expired.' });
    }

    // Set new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.lastPasswordChange = new Date();

    await user.save();

    res.json({ msg: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
