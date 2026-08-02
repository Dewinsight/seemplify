const emailService = require('./emailService');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

async function notifyDeviceRevoked(user, device) {
  try {
    await emailService.sendEmail({
      to: user.email,
      subject: 'SmartHR security alert: trusted device removed',
      html: `
        <p>Hi ${decodeHtmlEntities(user.profile?.firstName) || 'there'},</p>
        <p>This is a confirmation that a trusted device was removed from your SmartHR account.</p>
        <ul>
          <li><strong>Browser:</strong> ${device.userAgent || 'Unknown'}</li>
          <li><strong>IP Address:</strong> ${device.ip || 'Unknown'}</li>
          <li><strong>Last Used:</strong> ${device.lastUsed ? new Date(device.lastUsed).toLocaleString() : 'Unknown'}</li>
        </ul>
        <p>If this was not you, please secure your account immediately by resetting your password and re-enabling MFA.</p>
        <p><a href="${process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://smarthr.aiinnigeria.com'}/settings/security">Secure your account</a></p>
      `,
    });
  } catch (error) {
    console.error('Failed to send device revoked email:', error);
  }
}

async function notifyAllDevicesRevoked(user, count) {
  try {
    await emailService.sendEmail({
      to: user.email,
      subject: 'SmartHR security alert: trusted devices cleared',
      html: `
        <p>Hi ${decodeHtmlEntities(user.profile?.firstName) || 'there'},</p>
        <p>${count} trusted devices were removed from your SmartHR account.</p>
        <p>If you initiated this action, no further steps are required. Otherwise, please secure your account immediately.</p>
        <p><a href="${process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://smarthr.aiinnigeria.com'}/settings/security">Secure your account</a></p>
      `,
    });
  } catch (error) {
    console.error('Failed to send devices cleared email:', error);
  }
}

module.exports = {
  notifyDeviceRevoked,
  notifyAllDevicesRevoked,
};

