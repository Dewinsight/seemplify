const express = require('express');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');
const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const {
  ingestChatGptUsageEnvelope,
  verifyAndClaimChatGptUsageSignature
} = require('../services/aiRuntime/chatGptUsageIngestionService');
const {
  ingestLocalUsageEnvelope,
  verifyAndClaimLocalUsageSignature
} = require('../services/aiRuntime/localUsageIngestionService');
const { runWithAIRequestContext } = require('../services/aiRuntime/requestContext');
const codexAccountService = require('../services/aiRuntime/codexAccountService');
const userAISettingsService = require('../services/aiRuntime/userAISettingsService');
const { resolveSharedPrincipal } = require('../services/aiRuntime/sharedIdentityService');

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

function requireServiceActivity(service, activity) {
  const definition = ACTIVITY_DEFINITIONS[activity];
  if (!definition) throw new TypeError('Unknown AI activity');
  if (service === 'performance-management' && definition.app !== 'performance') {
    const error = new Error('Performance Management may only invoke Performance AI activities.');
    error.code = 'SHARED_AI_ACTIVITY_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
  return definition;
}

function internalError(res, error, fallback = 'The shared AI account request failed') {
  const status = error instanceof TypeError ? 400 : Number(error?.statusCode) || 503;
  const retryAfterSeconds = Number(error?.retryAfterSeconds) || 0;
  if (retryAfterSeconds > 0) res.set('Retry-After', String(retryAfterSeconds));
  return res.status(status).json({
    code: error?.code || (status === 400 ? 'SHARED_AI_VALIDATION_ERROR' : 'SHARED_AI_UNAVAILABLE'),
    message: error?.message || fallback,
    retryable: error?.retryable === true,
    ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
  });
}

async function sharedPrincipal(req) {
  if (req.internalService !== 'performance-management') {
    const error = new Error('This service is not authorized to manage shared ChatGPT accounts.');
    error.code = 'SHARED_AI_SERVICE_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
  return resolveSharedPrincipal(req.body?.identity);
}

async function sharedUser(req) {
  return (await sharedPrincipal(req)).user;
}

router.post('/v1/health', internalAuth, (req, res) => res.json({
  ok: true,
  service: 'seemplify-shared-ai-account',
  consumer: req.internalService,
  signatureVersion: req.internalSignatureVersion
}));

router.post('/v1/account/status', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const account = await codexAccountService.readAccount(user);
    const preferences = await userAISettingsService.readPreferences(user);
    return res.json({
      account: account.toPublicJSON({ app: 'performance' }),
      // This describes the shared account proxy, not Recruiter's product
      // runtime switches. Performance combines it with its own local policy.
      runtimePolicy: {
        authority: 'shared-account-service',
        localEnabled: false,
        chatgptEnabled: true,
        chatgptRequired: true,
        defaultRuntime: 'chatgpt'
      },
      preferences
    });
  } catch (error) { return internalError(res, error); }
});

router.post('/v1/account/login/start', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const { login, account } = await codexAccountService.startLogin(user);
    return res.json({ login, account: account.toPublicJSON({ app: 'performance' }) });
  } catch (error) { return internalError(res, error, 'ChatGPT sign-in could not be started'); }
});

router.post('/v1/account/login/cancel', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const { result, account } = await codexAccountService.cancelLogin(user);
    return res.json({ ...result, account: account.toPublicJSON({ app: 'performance' }) });
  } catch (error) { return internalError(res, error, 'ChatGPT sign-in could not be cancelled'); }
});

router.post('/v1/account/login/reset', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const { result, account } = await codexAccountService.resetLogin(user);
    return res.json({ ...result, account: account.toPublicJSON({ app: 'performance' }) });
  } catch (error) { return internalError(res, error, 'ChatGPT sign-in could not be reset'); }
});

router.post('/v1/account/consent', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const account = await codexAccountService.setConsent(
      user,
      req.body?.acknowledged === true,
      { app: 'performance' }
    );
    return res.json({ account: account.toPublicJSON({ app: 'performance' }) });
  } catch (error) { return internalError(res, error, 'ChatGPT data-sharing consent could not be saved'); }
});

router.post('/v1/account/disconnect', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    const account = await codexAccountService.disconnect(user);
    return res.json({ account: account.toPublicJSON({ app: 'performance' }) });
  } catch (error) { return internalError(res, error, 'ChatGPT could not be disconnected'); }
});

router.post('/v1/account/models', internalAuth, async (req, res) => {
  try {
    const user = await sharedUser(req);
    return res.json({ models: await codexAccountService.listModels(user) });
  } catch (error) { return internalError(res, error, 'The ChatGPT model catalogue could not be loaded'); }
});

router.post('/v1/account/preferences/read', internalAuth, async (req, res) => {
  try {
    return res.json(await userAISettingsService.readPreferences(await sharedUser(req)));
  } catch (error) { return internalError(res, error, 'AI preferences could not be loaded'); }
});

router.post('/v1/account/preferences/write', internalAuth, async (req, res) => {
  try {
    if (req.body?.activity) requireServiceActivity(req.internalService, String(req.body.activity));
    return res.json(await userAISettingsService.writePreference(await sharedUser(req), req.body));
  } catch (error) { return internalError(res, error, 'AI preferences could not be saved'); }
});

router.post('/v1/account/preferences/delete', internalAuth, async (req, res) => {
  try {
    if (req.body?.activity) requireServiceActivity(req.internalService, String(req.body.activity));
    return res.json(await userAISettingsService.deletePreference(await sharedUser(req), req.body));
  } catch (error) { return internalError(res, error, 'AI preferences could not be reset'); }
});

router.post('/v1/chatgpt-usage/events', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body || {});
  const verified = await verifyAndClaimChatGptUsageSignature({
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

router.post('/v1/local-usage/events', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body || {});
  const verified = await verifyAndClaimLocalUsageSignature({
    headers: req.headers,
    method: req.method,
    requestPath: req.originalUrl.split('?')[0],
    rawBody
  });
  if (!verified.ok) {
    return res.status(verified.statusCode).json({ code: verified.code, message: verified.message });
  }
  try {
    return res.status(202).json(await ingestLocalUsageEnvelope(req.body));
  } catch (error) {
    const status = error.code === 'AI_USAGE_IDENTITY_CONFLICT' ? 409 : error instanceof TypeError ? 400 : 503;
    return res.status(status).json({
      code: error.code || 'LOCAL_USAGE_INGESTION_FAILED',
      message: error.message || 'Local usage event could not be recorded'
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
    requireServiceActivity(req.internalService, activity);
    const messages = validateMessages(req.body?.messages);
    const principal = req.internalService === 'performance-management'
      ? await sharedPrincipal(req) : null;
    const user = principal?.user || null;
    const context = {
      ...(req.body?.context || {}),
      sourceApp: req.internalService,
      ...(user ? {
        // Meter both Local and ChatGPT against the stable cross-product IdP
        // dimensions. runtimeActorId/localOrganizationId remain private
        // routing keys for Recruiter's canonical connected account.
        actorId: principal.identity.sub,
        runtimeActorId: String(user._id || user.id),
        actorEmail: user.email,
        actorName: user.profile?.displayName,
        // Performance's signed identity carries the organization selected for
        // this request. Prefer its locally resolved record (or the signed IdP
        // id) over Recruiter's independently persisted current organization.
        organizationId: String(
          principal.identity.organizationId
          || principal.organization?._id
          || user.currentOrganization?._id
          || user.currentOrganization
          || ''
        ) || undefined,
        localOrganizationId: String(principal.organization?._id || '') || undefined,
        organizationName: principal.identity.organizationName || principal.organization?.name || undefined
      } : {}),
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
        }, {
          signal: controller.signal,
          requiredRuntime: req.internalService === 'performance-management' ? 'chatgpt' : undefined,
          sharedAccountRuntime: req.internalService === 'performance-management',
          consentApp: req.internalService === 'performance-management' ? 'performance' : 'recruiter'
        })
        : aiRuntimeService.complete(activity, completionInput, {
          signal: controller.signal,
          requiredRuntime: req.internalService === 'performance-management' ? 'chatgpt' : undefined,
          sharedAccountRuntime: req.internalService === 'performance-management',
          consentApp: req.internalService === 'performance-management' ? 'performance' : 'recruiter'
        })
    ));
    res.json({
      requestId: result.requestId,
      content: result.content,
      model: result.model,
      modelSource: result.modelSource,
      reasoningEffort: result.reasoningEffort,
      reasoningEffortSource: result.reasoningEffortSource,
      degraded: result.degraded,
      planType: result.planType,
      usage: result.usage,
      data: result.data,
      schemaRepairAttempted: result.schemaRepairAttempted,
      finishReason: result.finishReason
    });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    const status = error instanceof TypeError ? 400 : error.statusCode || 503;
    const retryAfterSeconds = Number(error?.retryAfterSeconds) || 0;
    if (retryAfterSeconds > 0) res.set('Retry-After', String(retryAfterSeconds));
    res.status(status).json({
      code: error.code || (status === 400 ? 'AI_GATEWAY_VALIDATION_ERROR' : 'AI_PROVIDER_UNAVAILABLE'),
      message: error.message || 'AI provider is unavailable',
      retryable: error?.retryable === true,
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
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
module.exports.requireServiceActivity = requireServiceActivity;
