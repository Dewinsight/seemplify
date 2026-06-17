const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const prisma = require('../db/client');
const browserFingerprintService = require('../services/browserFingerprintService');
const sessionService = require('../services/sessionService');
const notificationService = require('../services/notificationService');

// @route   GET /api/trusted-devices
// @desc    Get all trusted devices for the authenticated user
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, security: true } });

        if (!user || !user.security || !user.security.trustedBrowsers) {
            return res.json({ devices: [] });
        }

        // Format the trusted browsers for display
        const devices = user.security.trustedBrowsers.map(browser => ({
            id: browser._id,
            fingerprint: browser.fingerprint,
            userAgent: browser.userAgent,
            browser: browserFingerprintService.parseBrowserInfo(browser.userAgent),
            ip: browser.ip,
            lastUsed: browser.lastUsed,
            createdAt: browser.createdAt,
            isCurrent: browser.fingerprint === browserFingerprintService.generateFingerprint(req).fingerprint
        }));

        // Sort by last used date (most recent first)
        devices.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

        res.json({ devices });
    } catch (err) {
        console.error('Error fetching trusted devices:', err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route   DELETE /api/trusted-devices/:deviceId
// @desc    Remove a trusted device
// @access  Private
router.delete('/:deviceId', authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });

        if (!user || !user.security || !user.security.trustedBrowsers) {
            return res.status(404).json({ msg: 'No trusted devices found' });
        }

        // Find the device to remove
        const deviceIndex = user.security.trustedBrowsers.findIndex(
            browser => browser._id.toString() === req.params.deviceId
        );

        if (deviceIndex === -1) {
            return res.status(404).json({ msg: 'Device not found' });
        }

        // Check if this is the current device
        const currentFingerprint = browserFingerprintService.generateFingerprint(req).fingerprint;
        const deviceToRemove = user.security.trustedBrowsers[deviceIndex];
        
        if (deviceToRemove.fingerprint === currentFingerprint) {
            return res.status(400).json({ 
                msg: 'Cannot remove the currently active device. Please use a different device to remove this one.' 
            });
        }

        // Remove the device
        await browserFingerprintService.removeTrustedBrowser(user, deviceToRemove.fingerprint);
        await sessionService.revokeSessionsByFingerprint(user._id, deviceToRemove.fingerprint, 'device_removed');

        await notificationService.notifyDeviceRevoked(user, deviceToRemove);

        res.json({ msg: 'Device removed successfully' });
    } catch (err) {
        console.error('Error removing trusted device:', err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// @route   DELETE /api/trusted-devices
// @desc    Remove all trusted devices except the current one
// @access  Private
router.delete('/', authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });

        if (!user || !user.security || !user.security.trustedBrowsers) {
            return res.status(404).json({ msg: 'No trusted devices found' });
        }

        // Get current device fingerprint
        const currentFingerprint = browserFingerprintService.generateFingerprint(req).fingerprint;

        const removedBrowsers = user.security.trustedBrowsers.filter(
            browser => browser.fingerprint !== currentFingerprint
        );

        user.security.trustedBrowsers = user.security.trustedBrowsers.filter(
            browser => browser.fingerprint === currentFingerprint
        );

        await prisma.user.update({ where: { id: user.id }, data: { security: user.security } });

        for (const browser of removedBrowsers) {
            await sessionService.revokeSessionsByFingerprint(user._id, browser.fingerprint, 'device_removed_all');
        }

        if (removedBrowsers.length > 0) {
            await notificationService.notifyAllDevicesRevoked(user, removedBrowsers.length);
        }

        res.json({ 
            msg: 'All devices removed except the current one',
            remainingDevices: user.security.trustedBrowsers.length 
        });
    } catch (err) {
        console.error('Error removing all trusted devices:', err.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
