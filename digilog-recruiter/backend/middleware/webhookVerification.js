const crypto = require('crypto');

const verifyNylasWebhook = (req, res, next) => {
  const signature = req.headers['x-nylas-signature'];
  const webhookSecret = process.env.NYLAS_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    console.error('❌ Webhook verification failed - Missing signature or secret', {
      hasSignature: !!signature,
      hasSecret: !!webhookSecret,
      endpoint: req.originalUrl,
      timestamp: new Date().toISOString()
    });
    return res.status(401).json({ error: 'Unauthorized webhook request' });
  }
  
  try {
    // Use raw body for signature verification - this is critical!
    // Express.json() middleware parses the body, but we need the original raw bytes
    let body;
    if (req.rawBody) {
      // If raw body is available (from custom middleware)
      body = req.rawBody;
    } else {
      // Fallback: stringify the parsed body, but this is not ideal
      body = JSON.stringify(req.body);
      console.warn('⚠️ Using stringified body for webhook verification - this may cause issues');
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body, 'utf8')
      .digest('hex');
    
    const providedSignature = signature.replace('sha256=', '');
    
    // Use timing-safe comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    )) {
      console.error('❌ Webhook verification failed - Invalid signature', {
        provided: providedSignature.substring(0, 8) + '...',
        expected: expectedSignature.substring(0, 8) + '...',
        endpoint: req.originalUrl,
        webhookType: req.body?.type || 'unknown',
        bodyLength: body.length,
        hasRawBody: !!req.rawBody,
        timestamp: new Date().toISOString()
      });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    
    console.log('✅ Webhook signature verified successfully', {
      endpoint: req.originalUrl,
      webhookType: req.body?.type || 'unknown',
      timestamp: new Date().toISOString()
    });
    next();
  } catch (error) {
    console.error('Webhook verification error:', error);
    return res.status(401).json({ error: 'Webhook verification failed' });
  }
};

const logWebhookRequest = (req, res, next) => {
  console.log('Webhook received:', {
    type: req.body?.type,
    timestamp: new Date().toISOString(),
    headers: {
      'x-nylas-signature': req.headers['x-nylas-signature'] ? 'present' : 'missing',
      'content-type': req.headers['content-type']
    }
  });
  next();
};

module.exports = { 
  verifyNylasWebhook,
  logWebhookRequest 
}; 