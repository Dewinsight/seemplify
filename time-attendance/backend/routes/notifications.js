const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization } = require('../middleware/auth');
const { Notification, NotificationPreference, BrowserPushSubscription } = require('../models');

router.use(requireAuth, requireOrganization);

router.get('/', async (req, res) => {
    const query = { organizationId: req.organizationId, userId: req.user.id, dismissedAt: { $exists: false } };
    if (req.query.unread === 'true') query.readAt = { $exists: false };
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 50), 100));
    const unread = await Notification.countDocuments({ organizationId: req.organizationId, userId: req.user.id, readAt: { $exists: false }, dismissedAt: { $exists: false } });
    res.json({ notifications, unread });
});

router.post('/:id/read', async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, organizationId: req.organizationId, userId: req.user.id },
        { $set: { readAt: new Date() } },
        { new: true }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification });
});

router.post('/read-all', async (req, res) => {
    const result = await Notification.updateMany(
        { organizationId: req.organizationId, userId: req.user.id, readAt: { $exists: false } },
        { $set: { readAt: new Date() } }
    );
    res.json({ updated: result.modifiedCount });
});

router.get('/preferences/me', async (req, res) => {
    const preferences = await NotificationPreference.findOneAndUpdate(
        { organizationId: req.organizationId, userId: req.user.id },
        { $setOnInsert: { organizationId: req.organizationId, userId: req.user.id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ preferences, vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.put('/preferences/me', async (req, res) => {
    const allowed = {};
    if (req.body.timezone) allowed.timezone = req.body.timezone;
    if (req.body.channels) allowed.channels = req.body.channels;
    if (req.body.quietHours) allowed.quietHours = req.body.quietHours;
    if (Array.isArray(req.body.mutedTypes)) allowed.mutedTypes = req.body.mutedTypes;
    const preferences = await NotificationPreference.findOneAndUpdate(
        { organizationId: req.organizationId, userId: req.user.id },
        { $set: allowed, $setOnInsert: { organizationId: req.organizationId, userId: req.user.id } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ preferences });
});

router.post('/push-subscriptions', async (req, res) => {
    const subscription = req.body.subscription || req.body;
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) return res.status(400).json({ error: 'A valid browser push subscription is required' });
    const saved = await BrowserPushSubscription.findOneAndUpdate(
        { organizationId: req.organizationId, userId: req.user.id, endpoint: subscription.endpoint },
        { $set: { keys: subscription.keys, active: true, userAgent: req.get('user-agent'), lastUsedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ subscription: saved });
});

router.delete('/push-subscriptions', async (req, res) => {
    await BrowserPushSubscription.updateMany(
        { organizationId: req.organizationId, userId: req.user.id, ...(req.body.endpoint ? { endpoint: req.body.endpoint } : {}) },
        { $set: { active: false } }
    );
    res.status(204).end();
});

module.exports = router;
