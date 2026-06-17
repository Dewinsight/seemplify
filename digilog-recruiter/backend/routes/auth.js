const crypto = require('crypto');
const emailService = require('../services/emailService');
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const browserFingerprintService = require('../services/browserFingerprintService');
const otpService = require('../services/otpService');
const sessionService = require('../services/sessionService');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Persist a mutated `security` blob for a Prisma user.
async function saveSecurity(user) {
  return prisma.user.update({ where: { id: user.id }, data: { security: user.security } });
}

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: { email, password: hashed, security: { lastOtpSent: new Date() } },
    });

    // Email confirmation: send a one-time code before first sign-in.
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const otp = otpService.generateOTP();
    otpService.storeOTP(user.id, otp, 'login');

    try {
      await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
    } catch (emailError) {
      console.error('Failed to send signup verification email:', emailError);
      return res.status(500).json({ msg: 'Failed to send verification email' });
    }

    return res.status(200).json({
      requiresOTP: true,
      message: 'Verification code sent to your email',
      browserInfo: fingerprintData.browserInfo,
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

  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const isTrusted = browserFingerprintService.isBrowserTrusted(user, fingerprintData.fingerprint);

    if (!isTrusted) {
      const canSend = otpService.canSendOTP(user);
      if (!canSend.allowed) {
        return res.status(200).json({
          requiresOTP: true,
          message: canSend.reason,
          browserInfo: fingerprintData.browserInfo,
          rateLimited: true,
        });
      }

      const otp = otpService.generateOTP();
      otpService.storeOTP(user.id, otp, 'login');

      user.security = { ...(user.security || {}), lastOtpSent: new Date() };
      await saveSecurity(user);

      try {
        await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      } catch (emailError) {
        console.error('Failed to send OTP email:', emailError);
        return res.status(500).json({ msg: 'Failed to send verification email' });
      }

      return res.status(200).json({
        requiresOTP: true,
        message: 'Verification code sent to your email',
        browserInfo: fingerprintData.browserInfo,
      });
    }

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
        mfaEnabled: user.security?.mfaEnabled || false,
      },
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

  if (!email || !otp) {
    return res.status(400).json({ msg: 'Please provide email and OTP' });
  }

  try {
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    const verificationResult = otpService.verifyOTP(user.id, otp, 'login');

    if (!verificationResult.valid) {
      await otpService.updateOTPAttempts(user, true);
      return res.status(400).json({
        msg: verificationResult.reason,
        remainingAttempts: verificationResult.remainingAttempts,
      });
    }

    await otpService.updateOTPAttempts(user, false);

    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    await browserFingerprintService.addTrustedBrowser(user, fingerprintData);

    if (!user.security?.mfaEnabled) {
      user.security = { ...(user.security || {}), mfaEnabled: true };
      await saveSecurity(user);
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
      user: { id: user.id, email: user.email, mfaEnabled: true },
      message: 'Device trusted successfully',
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
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    const canSend = otpService.canSendOTP(user);
    if (!canSend.allowed) {
      return res.status(429).json({ msg: canSend.reason });
    }

    otpService.clearOTP(user.id, 'login');
    const otp = otpService.generateOTP();
    otpService.storeOTP(user.id, otp, 'login');

    user.security = { ...(user.security || {}), lastOtpSent: new Date() };
    await saveSecurity(user);

    const fingerprintData = browserFingerprintService.generateFingerprint(req);

    try {
      await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      res.json({ message: 'New verification code sent to your email', nextResendIn: 60 });
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
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      // Don't reveal whether the user exists
      return res.status(200).json({ msg: 'If a user with that email exists, a password reset link has been sent.' });
    }

    const token = crypto.randomBytes(20).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: token, resetPasswordExpires: new Date(Date.now() + 3600000) },
    });

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
    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token, resetPasswordExpires: { gt: new Date() } },
    });

    if (!user) {
      return res.status(400).json({ msg: 'Password reset token is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        lastPasswordChange: new Date(),
      },
    });

    res.json({ msg: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
