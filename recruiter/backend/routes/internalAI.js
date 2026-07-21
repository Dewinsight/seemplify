const express = require('express');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');
const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
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

router.post('/v1/complete', internalAuth, async (req, res) => {
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
        })
        : aiRuntimeService.complete(activity, completionInput)
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
    const status = error instanceof TypeError ? 400 : error.statusCode || 503;
    res.status(status).json({
      code: error.code || (status === 400 ? 'AI_GATEWAY_VALIDATION_ERROR' : 'AI_PROVIDER_UNAVAILABLE'),
      message: error.message || 'AI provider is unavailable'
    });
  }
});

module.exports = router;
