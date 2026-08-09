const { Notification, NotificationPreference, BrowserPushSubscription } = require('../models');
const { sendNotificationEmail } = require('./emailService');
const { enqueueJob } = require('./backgroundJobService');

let webPush;
try {
    webPush = require('web-push');
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webPush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:privacy@seemplifyai.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
    }
} catch (_error) {
    webPush = null;
}

function minutesOfDay(value = '00:00') {
    const [hour, minute] = String(value).split(':').map(Number);
    return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function localMinute(timezone, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(date);
    return Number(parts.find(part => part.type === 'hour')?.value || 0) * 60 + Number(parts.find(part => part.type === 'minute')?.value || 0);
}

function inQuietHours(preference, priority, date = new Date()) {
    const quiet = preference?.quietHours;
    if (!quiet?.enabled || (priority === 'urgent' && quiet.allowUrgent)) return false;
    const current = localMinute(preference.timezone, date);
    const start = minutesOfDay(quiet.start);
    const end = minutesOfDay(quiet.end);
    return start <= end ? current >= start && current < end : current >= start || current < end;
}

function nextQuietHoursEnd(preference, now = new Date()) {
    for (let minutes = 1; minutes <= 24 * 60; minutes += 1) {
        const candidate = new Date(now.getTime() + minutes * 60000);
        if (!inQuietHours(preference, 'normal', candidate)) return candidate;
    }
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

async function getPreference(organizationId, userId) {
    return NotificationPreference.findOneAndUpdate(
        { organizationId, userId },
        { $setOnInsert: { organizationId, userId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function createNotification(input) {
    const preference = await getPreference(input.organizationId, input.userId);
    if ((preference.mutedTypes || []).includes(input.type) && input.priority !== 'urgent') return { skipped: true, reason: 'muted' };
    const deliveryChannels = [];
    const requestedChannels = input.channels || {};
    if (preference.channels.inApp && requestedChannels.inApp !== false) deliveryChannels.push({ channel: 'in_app', status: 'delivered', deliveredAt: new Date() });
    if (preference.channels.email && requestedChannels.email !== false && input.userEmail) deliveryChannels.push({ channel: 'email', status: 'pending' });
    if (preference.channels.browserPush && requestedChannels.browserPush !== false) deliveryChannels.push({ channel: 'browser_push', status: 'pending' });
    try {
        const { channels: _channels, ...notificationInput } = input;
        const notification = await Notification.create({ ...notificationInput, deliveries: deliveryChannels });
        if (deliveryChannels.some(channel => channel.status === 'pending')) {
            await enqueueJob('notification_delivery', {}, { idempotencyKey: 'recurring:notification_delivery', repeatEveryMs: 60000 });
        }
        return notification;
    } catch (error) {
        if (error.code === 11000) return Notification.findOne({ organizationId: input.organizationId, userId: input.userId, eventKey: input.eventKey });
        throw error;
    }
}

async function deliverBrowserPush(notification) {
    if (!webPush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('Browser push is not configured');
    const subscriptions = await BrowserPushSubscription.find({ organizationId: notification.organizationId, userId: notification.userId, active: true });
    if (!subscriptions.length) throw new Error('No active browser push subscription');
    const payload = JSON.stringify({
        title: notification.title,
        body: notification.message,
        data: { notificationId: notification._id, url: notification.actionUrl || '/notifications', type: notification.type },
    });
    const outcomes = await Promise.allSettled(subscriptions.map(subscription => webPush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload)));
    let successes = 0;
    for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = outcomes[index];
        if (outcome.status === 'fulfilled') {
            successes += 1;
            subscriptions[index].lastUsedAt = new Date();
            await subscriptions[index].save();
        } else if ([404, 410].includes(outcome.reason?.statusCode)) {
            subscriptions[index].active = false;
            await subscriptions[index].save();
        }
    }
    if (!successes) throw new Error('Browser push delivery failed');
}

async function deliverPendingNotifications(limit = 100) {
    const now = new Date();
    const notifications = await Notification.find({
        deliveries: { $elemMatch: { status: 'pending', nextAttemptAt: { $lte: now } } },
    }).sort({ createdAt: 1 }).limit(limit);
    let delivered = 0;
    let failed = 0;
    for (const notification of notifications) {
        const preference = await getPreference(notification.organizationId, notification.userId);
        if (inQuietHours(preference, notification.priority, now)) {
            const resumeAt = nextQuietHoursEnd(preference, now);
            notification.deliveries.forEach(delivery => { if (delivery.status === 'pending') delivery.nextAttemptAt = resumeAt; });
            await notification.save();
            continue;
        }
        for (const delivery of notification.deliveries.filter(item => item.status === 'pending' && item.nextAttemptAt <= now)) {
            delivery.attempts += 1;
            try {
                if (delivery.channel === 'email') await sendNotificationEmail(notification, notification.userEmail);
                else if (delivery.channel === 'browser_push') await deliverBrowserPush(notification);
                delivery.status = 'delivered';
                delivery.deliveredAt = new Date();
                delivery.lastError = '';
                delivered += 1;
            } catch (error) {
                delivery.lastError = String(error.message || error).slice(0, 1000);
                if (delivery.attempts >= 8) delivery.status = 'failed';
                else delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 15000 * (2 ** (delivery.attempts - 1))));
                failed += 1;
            }
        }
        await notification.save();
    }
    return { notifications: notifications.length, delivered, failed };
}

module.exports = { createNotification, deliverPendingNotifications, getPreference, inQuietHours };
