import express from 'express';
import { z } from 'zod';
import {
  cancelCodexDeviceLogin, chooseAiProvider, disconnectCodex, getAiProviderState,
  resetUserCodexDefaults, startCodexDeviceLogin
} from './aiProvider.js';
import { currentSessionUser } from './auth.js';
import { resolveRequestSpace } from './spaces.js';
import { TerraError } from './terraClient.js';

export const aiProviderRouter = express.Router();

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user) throw new TerraError('Authentication required.', 'AUTHENTICATION_REQUIRED', 401, false);
  return { user, space: resolveRequestSpace(request, user.id) };
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed', details: error.issues });
  if (error instanceof TerraError) return response.status(error.status).json({ error: error.message, code: error.code });
  return response.status(500).json({ error: error instanceof Error ? error.message : 'AI provider request failed.' });
}

aiProviderRouter.get('/', async (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(await getAiProviderState(user.id, space.id));
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.patch('/', async (request, response) => {
  try {
    const { user, space } = context(request);
    const optionalCodexSetting = z.string().trim().min(1).max(200).nullable();
    const input = z.object({
      provider: z.enum(['terra', 'codex']),
      codexModel: optionalCodexSetting.optional(),
      codexReasoningEffort: optionalCodexSetting.optional(),
      codexActionOverrides: z.record(
        z.string().trim().min(1).max(100),
        z.object({
          model: optionalCodexSetting.optional(),
          reasoningEffort: optionalCodexSetting.optional(),
          reasoningEffortAuto: z.boolean().optional()
        }).strict()
      ).refine((value) => Object.keys(value).length <= 50, 'Too many Codex action overrides.').optional(),
      codexDataSharingAcknowledged: z.boolean().optional()
    }).parse(request.body);
    await chooseAiProvider(user.id, space.id, input);
    return response.json(await getAiProviderState(user.id, space.id));
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.post('/reset-codex-defaults', async (request, response) => {
  try {
    const { user, space } = context(request);
    resetUserCodexDefaults(user.id, space.id);
    return response.json(await getAiProviderState(user.id, space.id));
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.post('/codex/device-login', async (request, response) => {
  try {
    const { user } = context(request);
    return response.json(await startCodexDeviceLogin(user.id));
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.post('/codex/device-login/cancel', async (request, response) => {
  try {
    const { user } = context(request);
    return response.json(await cancelCodexDeviceLogin(user.id));
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.post('/codex/disconnect', async (request, response) => {
  try {
    const { user, space } = context(request);
    await disconnectCodex(user.id);
    return response.json(await getAiProviderState(user.id, space.id));
  } catch (error) { return sendError(response, error); }
});
