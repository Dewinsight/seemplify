import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { codexClientForUser, codexRuntimeError, type CodexModel } from './codexAppServer.js';
import { completeWithTerra, TerraError, type TerraCompletionInput } from './terraClient.js';

export type AiProvider = 'terra' | 'codex';

export type AiProviderPreference = {
  provider: AiProvider;
  codexModel: string | null;
  codexDataSharingAcknowledgedAt: string | null;
  updatedAt: string | null;
};

export type AiProviderSnapshot = Pick<
  AiProviderPreference,
  'provider' | 'codexModel' | 'codexDataSharingAcknowledgedAt'
>;

type PreferenceFile = {
  version: 1;
  preferences: Record<string, AiProviderPreference>;
};

const preferencePath = path.join(config.codexRuntimeDir, 'provider-preferences.json');
let preferenceCache: PreferenceFile | null = null;

function preferenceKey(userId: string, spaceId: string) {
  return `${userId}:${spaceId}`;
}

function readPreferences(): PreferenceFile {
  if (preferenceCache) return preferenceCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(preferencePath, 'utf8')) as PreferenceFile;
    preferenceCache = parsed?.version === 1 && parsed.preferences && typeof parsed.preferences === 'object'
      ? parsed
      : { version: 1, preferences: {} };
  } catch {
    preferenceCache = { version: 1, preferences: {} };
  }
  return preferenceCache;
}

function writePreferences(value: PreferenceFile) {
  fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
  const temporary = `${preferencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, preferencePath);
  preferenceCache = value;
}

export function getAiProviderPreference(userId: string, spaceId: string): AiProviderPreference {
  const stored = readPreferences().preferences[preferenceKey(userId, spaceId)];
  return {
    provider: stored?.provider === 'codex' ? 'codex' : 'terra',
    codexModel: typeof stored?.codexModel === 'string' ? stored.codexModel : null,
    codexDataSharingAcknowledgedAt: typeof stored?.codexDataSharingAcknowledgedAt === 'string'
      ? stored.codexDataSharingAcknowledgedAt : null,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null
  };
}

export function setAiProviderPreference(userId: string, spaceId: string, patch: Partial<Pick<
AiProviderPreference, 'provider' | 'codexModel' | 'codexDataSharingAcknowledgedAt'
>>) {
  const file = readPreferences();
  const current = getAiProviderPreference(userId, spaceId);
  const next: AiProviderPreference = {
    provider: patch.provider || current.provider,
    codexModel: patch.codexModel === undefined ? current.codexModel : patch.codexModel,
    codexDataSharingAcknowledgedAt: patch.codexDataSharingAcknowledgedAt === undefined
      ? current.codexDataSharingAcknowledgedAt : patch.codexDataSharingAcknowledgedAt,
    updatedAt: new Date().toISOString()
  };
  writePreferences({ ...file, preferences: { ...file.preferences, [preferenceKey(userId, spaceId)]: next } });
  return next;
}

export function aiProviderSnapshot(userId: string | null | undefined, spaceId: string): AiProviderSnapshot {
  if (!userId) return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  const preference = getAiProviderPreference(userId, spaceId);
  return {
    provider: preference.provider,
    codexModel: preference.codexModel,
    codexDataSharingAcknowledgedAt: preference.codexDataSharingAcknowledgedAt
  };
}

function visibleModels(models: CodexModel[]) {
  return models.filter((model) => !model.hidden && model.id && model.displayName);
}

function selectedModel(preference: AiProviderPreference, models: CodexModel[]) {
  const available = visibleModels(models);
  if (preference.codexModel && available.some((model) => model.id === preference.codexModel)) return preference.codexModel;
  return available.find((model) => model.isDefault)?.id || available[0]?.id || null;
}

export async function getAiProviderState(userId: string, spaceId: string) {
  const preference = getAiProviderPreference(userId, spaceId);
  try {
    const client = codexClientForUser(userId);
    const account = await client.accountStatus();
    const models = account.connected ? visibleModels(await client.models()) : [];
    return {
      preference,
      codex: {
        available: true,
        account,
        models,
        selectedModel: selectedModel(preference, models),
        error: null
      }
    };
  } catch (error) {
    return {
      preference,
      codex: {
        available: false,
        account: {
          connected: false, email: null, planType: null, authMode: null,
          pendingLogin: false, loginError: null
        },
        models: [] as CodexModel[],
        selectedModel: preference.codexModel,
        error: codexRuntimeError(error)
      }
    };
  }
}

export async function startCodexDeviceLogin(userId: string) {
  try { return await codexClientForUser(userId).startDeviceLogin(); }
  catch (error) {
    throw new TerraError(`Codex sign-in could not start: ${codexRuntimeError(error)}`, 'CODEX_LOGIN_FAILED', 502, false);
  }
}

export async function cancelCodexDeviceLogin(userId: string) {
  try { return await codexClientForUser(userId).cancelDeviceLogin(); }
  catch (error) {
    throw new TerraError(`Codex sign-in could not be cancelled: ${codexRuntimeError(error)}`,
      'CODEX_LOGIN_CANCEL_FAILED', 502, false);
  }
}

export async function disconnectCodex(userId: string) {
  try { await codexClientForUser(userId).logout(); }
  catch (error) {
    throw new TerraError(`Codex sign-out failed: ${codexRuntimeError(error)}`, 'CODEX_LOGOUT_FAILED', 502, false);
  }
  const file = readPreferences();
  const prefix = `${userId}:`;
  const preferences = Object.fromEntries(Object.entries(file.preferences).map(([key, value]) => [
    key,
    key.startsWith(prefix) ? {
      ...value, provider: 'terra' as const, codexDataSharingAcknowledgedAt: null, updatedAt: new Date().toISOString()
    } : value
  ]));
  writePreferences({ ...file, preferences });
}

export async function chooseAiProvider(userId: string, spaceId: string, input: {
  provider: AiProvider;
  codexModel?: string | null;
  codexDataSharingAcknowledged?: boolean;
}) {
  if (input.provider === 'codex') {
    const client = codexClientForUser(userId);
    const account = await client.accountStatus().catch((error) => {
      throw new TerraError(`Codex is unavailable: ${codexRuntimeError(error)}`, 'CODEX_UNAVAILABLE', 503, true);
    });
    if (!account.connected) {
      throw new TerraError('Connect a ChatGPT account before selecting Codex.', 'CODEX_NOT_CONNECTED', 409, false);
    }
    let models: CodexModel[];
    try { models = visibleModels(await client.models()); }
    catch (error) {
      throw new TerraError(`Codex models could not be loaded: ${codexRuntimeError(error)}`,
        'CODEX_MODELS_UNAVAILABLE', 503, true);
    }
    const current = getAiProviderPreference(userId, spaceId);
    const acknowledgedAt = input.codexDataSharingAcknowledged === true
      ? new Date().toISOString() : current.codexDataSharingAcknowledgedAt;
    if (!acknowledgedAt) {
      throw new TerraError(
        'Acknowledge that AI task content may be sent to OpenAI before selecting Codex.',
        'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED', 409, false
      );
    }
    const model = input.codexModel || selectedModel(current, models);
    if (!model || !models.some((item) => item.id === model)) {
      throw new TerraError('Select a Codex model available to this ChatGPT account.', 'CODEX_MODEL_UNAVAILABLE', 409, false);
    }
    return setAiProviderPreference(userId, spaceId, {
      provider: 'codex', codexModel: model, codexDataSharingAcknowledgedAt: acknowledgedAt
    });
  }
  return setAiProviderPreference(userId, spaceId, {
    provider: 'terra',
    codexModel: input.codexModel,
    ...(input.codexDataSharingAcknowledged === false ? { codexDataSharingAcknowledgedAt: null } : {})
  });
}

export interface AiCompletionInput extends TerraCompletionInput {
  spaceId: string;
  userId: string | null;
  providerSnapshot?: AiProviderSnapshot;
}

export function effectiveAiProviderSnapshot(
  userId: string | null | undefined,
  spaceId: string,
  recorded?: AiProviderSnapshot
): AiProviderSnapshot {
  if (!userId) return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  const snapshot = recorded || aiProviderSnapshot(userId, spaceId);
  // Provider/model are durable job inputs, but privacy revocation is an immediate
  // override: queued or retried work must return to Terra once consent is removed.
  if (snapshot.provider === 'codex' && !getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt) {
    return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  }
  return snapshot;
}

export async function completeWithAi(input: AiCompletionInput) {
  const snapshot = effectiveAiProviderSnapshot(input.userId, input.spaceId, input.providerSnapshot);
  if (!input.userId || snapshot.provider === 'terra') {
    return completeWithTerra(input);
  }
  if (!snapshot.codexDataSharingAcknowledgedAt) {
    throw new TerraError('This Codex task does not have a recorded data-sharing acknowledgement.',
      'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED', 409, false);
  }
  const client = codexClientForUser(input.userId);
  try {
    const models = await client.models();
    const model = snapshot.codexModel;
    if (!model || !visibleModels(models).some((item) => item.id === model)) {
      throw new Error('The Codex model recorded for this task is no longer available to this account.');
    }
    return await client.complete({
      messages: input.messages,
      jsonSchema: input.jsonSchema,
      model,
      reasoningEffort: input.reasoningEffort || 'medium',
      timeoutMs: input.timeoutMs || 300_000
    });
  } catch (error) {
    throw new TerraError(`Codex could not complete ${input.activity}: ${codexRuntimeError(error)}`,
      'CODEX_REQUEST_FAILED', 502, true);
  }
}

export function resetAiProviderPreferenceCacheForTests() {
  preferenceCache = null;
}
