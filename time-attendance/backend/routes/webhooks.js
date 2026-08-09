const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { processLifecycleEvent } = require('../services/lifecycleService');

function verifySignature(req, source) {
    const secret = source === 'idp'
        ? process.env.IDP_WEBHOOK_SECRET
        : process.env.LEAVE_WEBHOOK_SECRET;
    if (!secret && process.env.NODE_ENV !== 'production') return true;
    if (!secret) return false;
    const headerName = source === 'idp' ? 'x-idp-signature' : 'x-leave-signature';
    const received = String(req.get(headerName) || '').replace(/^sha256=/, '');
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(received)) return false;
    return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

async function handle(source, req, res) {
    if (!verifySignature(req, source)) return res.status(401).json({ error: 'Invalid webhook signature' });
    try {
        const result = await processLifecycleEvent(
            source,
            req.body,
            req.get(source === 'idp' ? 'x-idp-event' : 'x-leave-event')
        );
        return res.status(result.duplicate ? 200 : 202).json({ accepted: true, ...result });
    } catch (error) {
        console.error(`${source} webhook error:`, error);
        return res.status(400).json({ error: error.message || 'Webhook processing failed' });
    }
}

router.post('/idp', (req, res) => handle('idp', req, res));
router.post('/leave', (req, res) => handle('leave', req, res));

module.exports = router;
