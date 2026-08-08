const express = require('express');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');
const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const {
  ingestChatGptUsageEnvelope,
  verifyChatGptUsageSignature
} = require('../services/aiRuntime/chatGptUsageIngestionService');
const { runWithAIRequestContext } = require('../services/aiRuntime/requestContext');

const router = express.Router();
const internalAuth = createInternalServiceAuth();

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 100) {
    throw new TypeError('messages must be a non-empty array with at most 100 entries');
  }
  return messages.map((message) => {
    const role = String(message?.role || '');
    const content = String(message?.content || '');
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(role) || !content) {
      throw new TypeError('Each message must have a supported role and non-empty content');
    }
    if (content.length > 250000) throw new TypeError('An AI message exceeds the maximum supported length');
    return { role, content };
  });
}

router.post('/v1/chatgpt-usage/events', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body || {});
  const verified = verifyChatGptUsageSignature({
    headers: req.headers,
    method: req.method,
    requestPath: req.originalUrl.split('?')[0],
    rawBody
  });
  if (!verified.ok) {
    return res.status(verified.statusCode).json({
      code: verified.code,
      message: verified.message
    });
  }
  try {
    const result = await ingestChatGptUsageEnvelope(req.body);
    return res.status(202).json(result);
  } catch (error) {
    const status = error.code === 'AI_USAGE_IDENTITY_CONFLICT'
      ? 409
      : error instanceof TypeError
        ? 400
        : error.statusCode || 503;
    return res.status(status).json({
      code: error.code || 'CHATGPT_USAGE_INGESTION_FAILED',
      message: error.message || 'ChatGPT usage event could not be recorded'
    });
  }
});

router.post('/v1/complete', internalAuth, async (req, res) => {
  const controller = new AbortController();
  const abortForDisconnect = () => {
    if (controller.signal.aborted) return;
    const error = new Error('The internal AI client disconnected before inference completed');
    error.code = 'AI_CLIENT_DISCONNECTED';
    error.statusCode = 499;
    controller.abort(error);
  };
  const abortForPrematureClose = () => {
    if (!res.writableEnded) abortForDisconnect();
  };
  req.once('aborted', abortForDisconnect);
  res.once('close', abortForPrematureClose);
  try {
    const activity = String(req.body?.activity || '');
    if (!ACTIVITY_DEFINITIONS[activity]) throw new TypeError('Unknown AI activity');
    const messages = validateMessages(req.body?.messages);
    const context = {
      ...(req.body?.context || {}),
      sourceApp: req.internalService,
      requestId: String(req.get('x-request-id') || req.body?.context?.requestId || '') || undefined
    };
    const completionInput = {
      messages,
      promptVersion: String(req.body?.promptVersion || '1').slice(0, 100),
      temperature: req.body?.temperature,
      top_p: req.body?.topP,
      max_tokens: Math.min(8000, Math.max(1, Number(req.body?.maxTokens || 500))),
      response_format: req.body?.responseFormat,
      context
    };
    const result = await runWithAIRequestContext(context, () => (
      req.body?.jsonSchema
        ? aiRuntimeService.structuredComplete(activity, {
          ...completionInput,
          jsonSchema: req.body.jsonSchema,
          schemaName: req.body.schemaName
        }, { signal: controller.signal })
        : aiRuntimeService.complete(activity, completionInput, { signal: controller.signal })
    ));
    res.json({
      requestId: result.requestId,
      content: result.content,
      model: result.model,
      usage: result.usage,
      data: result.data,
      schemaRepairAttempted: result.schemaRepairAttempted,
      finishReason: result.finishReason
    });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    const status = error instanceof TypeError ? 400 : error.statusCode || 503;
    res.status(status).json({
      code: error.code || (status === 400 ? 'AI_GATEWAY_VALIDATION_ERROR' : 'AI_PROVIDER_UNAVAILABLE'),
      message: error.message || 'AI provider is unavailable'
    });
  } finally {
    req.removeListener('aborted', abortForDisconnect);
    res.removeListener('close', abortForPrematureClose);
  }
});

router.post('/v1/cv-queue/events', internalAuth, async (req, res) => {
  try {
    const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
    res.json(await cvAnalysisQueue.ingestExternalQueueEvent(req.internalService, req.body));
  } catch (error) {
    res.status(error.statusCode || 503).json({
      code: error.code || 'CV_QUEUE_EVENT_UNAVAILABLE',
      message: error.message || 'CV queue event could not be recorded'
    });
  }
});

module.exports = router;
