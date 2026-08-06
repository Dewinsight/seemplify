import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  cancelCodexDeviceLogin, chooseAiProvider, disconnectCodex, getAiProviderState,
  resetUserCodexDefaults, startCodexDeviceLogin
} from './aiProvider.js';
import { currentSessionUser } from './auth.js';
import { db } from './database.js';
import { recordPlatformAuditEvent } from './platformAudit.js';
import { resolveRequestSpace } from './spaces.js';
import { TerraError } from './terraClient.js';

export const aiProviderRouter = express.Router();

function optionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function recordAiRuntimeAudit(request: express.Request, userId: string, input: {
  action: string;
  targetId: string;
  spaceId: string;
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  recordPlatformAuditEvent({
    request,
    action: input.action,
    actorUserId: userId,
    actorRole: 'workspace_user',
    targetType: 'ai_runtime',
    targetId: input.targetId,
    spaceId: input.spaceId,
    reason: input.reason,
    before: input.before,
    after: input.after
  });
}

function hasActiveCodexConnectionAudit(userId: string) {
  const row = db.prepare(`SELECT action FROM platform_audit_events
    WHERE actor_user_id=? AND target_type='ai_runtime'
      AND action IN ('ai_runtime.codex_connected','ai_runtime.codex_disconnected')
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(userId) as { action?: string } | undefined;
  return row?.action === 'ai_runtime.codex_connected';
}

function latestRuntimeSelectionAudit(targetId: string) {
  const row = db.prepare(`SELECT after_json FROM platform_audit_events
    WHERE target_id=? AND target_type='ai_runtime'
      AND action='ai_runtime.runtime_selected'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(targetId) as { after_json?: string | null } | undefined;
  if (!row?.after_json) return null;
  try {
    const parsed = JSON.parse(row.after_json) as { runtimeChoice?: unknown } | null;
    return optionalString(parsed?.runtimeChoice);
  } catch {
    return null;
  }
}

function effectiveRuntimeChoiceFromState(state: Awaited<ReturnType<typeof getAiProviderState>>) {
  const explicitChoice = optionalString(state.preference.runtimeChoice);
  if (explicitChoice) return explicitChoice;
  return state.preference.effectiveProvider === 'codex' ? 'chatgpt' : 'local';
}

function syncRuntimeSelectionAudit(
  request: express.Request,
  userId: string,
  spaceId: string,
  before: {
    provider: string;
    runtimeChoice: string | null;
    codexModel: string | null;
  },
  next: Awaited<ReturnType<typeof getAiProviderState>>
) {
  const targetId = `${userId}:${spaceId}`;
  const nextChoice = effectiveRuntimeChoiceFromState(next);
  if (!nextChoice) return;
  const auditedChoice = latestRuntimeSelectionAudit(targetId);
  if (auditedChoice === nextChoice) return;
  recordAiRuntimeAudit(request, userId, {
    action: 'ai_runtime.runtime_selected',
    targetId,
    spaceId,
    reason: before.runtimeChoice === nextChoice
      ? 'Workspace AI runtime selection was reconciled from the current live state.'
      : 'Workspace AI runtime selection changed.',
    before: {
      provider: before.provider,
      runtimeChoice: before.runtimeChoice,
      codexModel: before.codexModel
    },
    after: {
      provider: next.preference.provider,
      runtimeChoice: nextChoice,
      codexModel: optionalString(next.codex.selectedModel)
    }
  });
}

function syncCodexConnectionAudit(
  request: express.Request,
  userId: string,
  spaceId: string,
  before: {
    connected: boolean;
    planType: string | null;
    authMode: string | null;
    runtimeChoice: string | null;
  },
  next: Awaited<ReturnType<typeof getAiProviderState>>
) {
  const hadConnectedAudit = hasActiveCodexConnectionAudit(userId);
  if (next.codex.account.connected && !hadConnectedAudit) {
    recordAiRuntimeAudit(request, userId, {
      action: 'ai_runtime.codex_connected',
      targetId: userId,
      spaceId,
      reason: 'ChatGPT / Codex became connected for this account.',
      before: {
        connected: before.connected,
        planType: before.planType,
        authMode: before.authMode
      },
      after: {
        connected: true,
        planType: next.codex.account.planType,
        authMode: next.codex.account.authMode,
        codexModel: optionalString(next.codex.selectedModel)
      }
    });
  }
  if (!next.codex.account.connected && before.connected && hadConnectedAudit) {
    recordAiRuntimeAudit(request, userId, {
      action: 'ai_runtime.codex_disconnected',
      targetId: userId,
      spaceId,
      reason: 'ChatGPT / Codex was disconnected from this account.',
      before: {
        connected: true,
        planType: before.planType,
        authMode: before.authMode,
        runtimeChoice: before.runtimeChoice
      },
      after: {
        connected: false,
        planType: next.codex.account.planType,
        authMode: next.codex.account.authMode,
        runtimeChoice: next.preference.runtimeChoice
      }
    });
  }
}

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
    const beforeConnected = hasActiveCodexConnectionAudit(user.id);
    const state = await getAiProviderState(user.id, space.id);
    syncRuntimeSelectionAudit(request, user.id, space.id, {
      provider: state.preference.provider,
      runtimeChoice: state.preference.runtimeChoice,
      codexModel: optionalString(state.codex.selectedModel)
    }, state);
    if (state.codex.account.connected && !beforeConnected) {
      syncCodexConnectionAudit(request, user.id, space.id, {
        connected: false,
        planType: null,
        authMode: null,
        runtimeChoice: state.preference.runtimeChoice
      }, state);
    }
    return response.json(state);
  } catch (error) { return sendError(response, error); }
});

aiProviderRouter.patch('/', async (request, response) => {
  try {
    const { user, space } = context(request);
    const before = await getAiProviderState(user.id, space.id);
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
    const next = await getAiProviderState(user.id, space.id);
    syncRuntimeSelectionAudit(request, user.id, space.id, {
      provider: before.preference.provider,
      runtimeChoice: before.preference.runtimeChoice,
      codexModel: optionalString(before.codex.selectedModel)
    }, next);
    syncCodexConnectionAudit(request, user.id, space.id, {
      connected: before.codex.account.connected,
      planType: before.codex.account.planType,
      authMode: before.codex.account.authMode,
      runtimeChoice: before.preference.runtimeChoice
    }, next);
    return response.json(next);
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
    const { user, space } = context(request);
    const started = await startCodexDeviceLogin(user.id);
    recordAiRuntimeAudit(request, user.id, {
      action: 'ai_runtime.codex_login_started',
      targetId: user.id,
      spaceId: space.id,
      reason: 'ChatGPT / Codex device login started.',
      after: {
        verificationUrl: started.verificationUrl,
        loginId: 'loginId' in started ? started.loginId : null,
        connected: started.connected
      }
    });
    return response.json(started);
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
    const before = await getAiProviderState(user.id, space.id);
    await disconnectCodex(user.id);
    const next = await getAiProviderState(user.id, space.id);
    syncCodexConnectionAudit(request, user.id, space.id, {
      connected: before.codex.account.connected,
      planType: before.codex.account.planType,
      authMode: before.codex.account.authMode,
      runtimeChoice: before.preference.runtimeChoice
    }, next);
    return response.json(next);
  } catch (error) { return sendError(response, error); }
});
