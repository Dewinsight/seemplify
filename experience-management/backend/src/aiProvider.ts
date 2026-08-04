import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { codexActionCatalog, codexActionIds, type CodexActionId } from './codexActionCatalog.js';
import { codexClientForUser, codexRuntimeError, type CodexModel } from './codexAppServer.js';
import { completeWithTerra, TerraError, type TerraCompletionInput } from './terraClient.js';

export type AiProvider = 'terra' | 'codex';
export type AiRuntimeChoice = 'local' | 'chatgpt' | null;

export type CodexActionOverride = {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAuto?: true;
};

export type CodexActionOverrides = Partial<Record<CodexActionId, CodexActionOverride>>;

export type CodexDefaultsInput = {
  codexModel?: string | null;
  codexReasoningEffort?: string | null;
  codexActionOverrides?: CodexActionOverrides;
};

export type AdminCodexDefaults = {
  codexModel: string | null;
  codexReasoningEffort: string | null;
  codexActionOverrides: CodexActionOverrides;
  updatedAt: string | null;
};

export type CodexSettingSource =
  | 'user_action'
  | 'user_default'
  | 'admin_action'
  | 'admin_default'
  | 'action_default'
  | 'connected_model_default'
  | 'model_default';

export type CodexSettingCandidate = {
  value: string;
  source: CodexSettingSource;
};

export type ResolvedCodexSetting = {
  value: string | null;
  source: CodexSettingSource | null;
  inherited: boolean;
};

export type AiProviderPreference = {
  provider: AiProvider;
  runtimeChoice: AiRuntimeChoice;
  codexModel: string | null;
  codexReasoningEffort: string | null;
  codexActionOverrides: CodexActionOverrides;
  codexDataSharingAcknowledgedAt: string | null;
  updatedAt: string | null;
};

type StoredAiProviderPreference = Omit<AiProviderPreference, 'runtimeChoice'> & {
  /** Missing on preferences written before the ChatGPT-first runtime gate. */
  runtimeChoice?: AiRuntimeChoice;
};

export type AiProviderSnapshot = {
  provider: AiProvider;
  codexModel: string | null;
  codexReasoningEffort?: string | null;
  /** Ordered, immutable-at-enqueue candidates. Older jobs may only have the legacy scalar fields above. */
  codexModelCandidates?: CodexSettingCandidate[];
  codexReasoningEffortCandidates?: CodexSettingCandidate[];
  codexActionId?: CodexActionId | null;
  codexDataSharingAcknowledgedAt: string | null;
};

type PreferenceFile = {
  version: 1;
  preferences: Record<string, StoredAiProviderPreference>;
  adminCodexDefaults?: AdminCodexDefaults;
};

const preferencePath = path.join(config.codexRuntimeDir, 'provider-preferences.json');
let preferenceCache: PreferenceFile | null = null;

function preferenceKey(userId: string, spaceId: string) {
  return `${userId}:${spaceId}`;
}

function optionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function choiceForProvider(provider: AiProvider): Exclude<AiRuntimeChoice, null> {
  return provider === 'codex' ? 'chatgpt' : 'local';
}

function storedRuntimeChoice(stored: StoredAiProviderPreference | undefined): AiRuntimeChoice {
  if (!stored) return null;
  if (stored.runtimeChoice === 'local' || stored.runtimeChoice === 'chatgpt' || stored.runtimeChoice === null) {
    return stored.runtimeChoice;
  }
  return choiceForProvider(stored.provider === 'codex' ? 'codex' : 'terra');
}

function normaliseActionOverrides(value: unknown): CodexActionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const overrides: CodexActionOverrides = {};
  for (const [actionId, candidate] of Object.entries(value)) {
    if (!codexActionIds.has(actionId as CodexActionId) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const model = optionalString((candidate as Record<string, unknown>).model);
    const reasoningEffort = optionalString((candidate as Record<string, unknown>).reasoningEffort);
    const reasoningEffortAuto = reasoningEffort
      && (candidate as Record<string, unknown>).reasoningEffortAuto === true;
    if (model || reasoningEffort) overrides[actionId as CodexActionId] = {
      model,
      reasoningEffort,
      ...(reasoningEffortAuto ? { reasoningEffortAuto: true as const } : {})
    };
  }
  return overrides;
}

function assertKnownActionOverrides(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const unknown = Object.keys(value).find((actionId) => !codexActionIds.has(actionId as CodexActionId));
  if (unknown) throw new TerraError(`Unknown Codex AI action: ${unknown}.`, 'CODEX_ACTION_UNKNOWN', 400, false);
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

export function getAdminCodexDefaults(): AdminCodexDefaults {
  const stored = readPreferences().adminCodexDefaults;
  return {
    codexModel: optionalString(stored?.codexModel),
    codexReasoningEffort: optionalString(stored?.codexReasoningEffort),
    codexActionOverrides: normaliseActionOverrides(stored?.codexActionOverrides),
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null
  };
}

export function getAiProviderPreference(userId: string, spaceId: string): AiProviderPreference {
  const stored = readPreferences().preferences[preferenceKey(userId, spaceId)];
  return {
    provider: stored?.provider === 'terra' ? 'terra' : 'codex',
    runtimeChoice: storedRuntimeChoice(stored),
    codexModel: typeof stored?.codexModel === 'string' ? stored.codexModel : null,
    codexReasoningEffort: optionalString(stored?.codexReasoningEffort),
    codexActionOverrides: normaliseActionOverrides(stored?.codexActionOverrides),
    codexDataSharingAcknowledgedAt: typeof stored?.codexDataSharingAcknowledgedAt === 'string'
      ? stored.codexDataSharingAcknowledgedAt : null,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : null
  };
}

export function setAiProviderPreference(userId: string, spaceId: string, patch: Partial<Pick<
AiProviderPreference, 'provider' | 'runtimeChoice' | 'codexModel' | 'codexReasoningEffort' | 'codexActionOverrides' | 'codexDataSharingAcknowledgedAt'
>>) {
  const file = readPreferences();
  const current = getAiProviderPreference(userId, spaceId);
  const provider = patch.provider ?? current.provider;
  const next: AiProviderPreference = {
    provider,
    runtimeChoice: patch.runtimeChoice !== undefined
      ? patch.runtimeChoice
      : patch.provider !== undefined ? choiceForProvider(provider) : current.runtimeChoice,
    codexModel: patch.codexModel === undefined ? current.codexModel : patch.codexModel,
    codexReasoningEffort: patch.codexReasoningEffort === undefined
      ? current.codexReasoningEffort : optionalString(patch.codexReasoningEffort),
    codexActionOverrides: patch.codexActionOverrides === undefined
      ? current.codexActionOverrides : normaliseActionOverrides(patch.codexActionOverrides),
    codexDataSharingAcknowledgedAt: patch.codexDataSharingAcknowledgedAt === undefined
      ? current.codexDataSharingAcknowledgedAt : patch.codexDataSharingAcknowledgedAt,
    updatedAt: new Date().toISOString()
  };
  writePreferences({ ...file, preferences: { ...file.preferences, [preferenceKey(userId, spaceId)]: next } });
  return next;
}

/**
 * Clears only this user's Codex choices. Provider selection, ChatGPT consent,
 * connection state, and administrator defaults are deliberately preserved.
 */
export function resetUserCodexDefaults(userId: string, spaceId: string) {
  return setAiProviderPreference(userId, spaceId, {
    codexModel: null,
    codexReasoningEffort: null,
    codexActionOverrides: {}
  });
}

function candidates(values: Array<[unknown, CodexSettingSource]>) {
  const result: CodexSettingCandidate[] = [];
  const seen = new Set<string>();
  for (const [candidate, source] of values) {
    const value = optionalString(candidate);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({ value, source });
  }
  return result;
}

function codexCandidates(
  preference: Pick<AiProviderPreference, 'codexModel' | 'codexReasoningEffort' | 'codexActionOverrides'>,
  adminDefaults: AdminCodexDefaults,
  actionId?: CodexActionId | null
) {
  const userAction = actionId ? preference.codexActionOverrides[actionId] : undefined;
  const adminAction = actionId ? adminDefaults.codexActionOverrides[actionId] : undefined;
  const action = actionId ? codexActionCatalog.find((item) => item.id === actionId) : undefined;
  return {
    models: candidates([
      [userAction?.model, 'user_action'],
      [preference.codexModel, 'user_default'],
      [adminAction?.model, 'admin_action'],
      [adminDefaults.codexModel, 'admin_default']
    ]),
    efforts: candidates([
      [userAction?.reasoningEffortAuto ? null : userAction?.reasoningEffort, 'user_action'],
      [preference.codexReasoningEffort, 'user_default'],
      [adminAction?.reasoningEffortAuto ? null : adminAction?.reasoningEffort, 'admin_action'],
      [adminDefaults.codexReasoningEffort, 'admin_default'],
      [action?.defaultReasoningEffort, 'action_default']
    ])
  };
}

export function aiProviderSnapshot(
  userId: string | null | undefined,
  spaceId: string,
  actionId?: CodexActionId | null
): AiProviderSnapshot {
  if (!userId) return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  const preference = getAiProviderPreference(userId, spaceId);
  const ordered = codexCandidates(preference, getAdminCodexDefaults(), actionId);
  return {
    provider: preference.provider,
    codexModel: ordered.models[0]?.value || null,
    codexReasoningEffort: ordered.efforts[0]?.value || null,
    codexModelCandidates: ordered.models,
    codexReasoningEffortCandidates: ordered.efforts,
    codexActionId: actionId || null,
    codexDataSharingAcknowledgedAt: preference.codexDataSharingAcknowledgedAt
  };
}

function visibleModels(models: CodexModel[]) {
  return models.filter((model) => !model.hidden && model.id && model.displayName);
}

function supportedEfforts(model: CodexModel) {
  const advertised = (model.supportedReasoningEfforts || [])
    .map((item) => optionalString(item.reasoningEffort))
    .filter((effort): effort is string => Boolean(effort));
  const modelDefault = optionalString(model.defaultReasoningEffort);
  return [...new Set([...advertised, ...(modelDefault ? [modelDefault] : [])])];
}

function safeConnectedModel(models: CodexModel[]) {
  const available = visibleModels(models);
  return available.find((model) => model.isDefault) || available[0] || null;
}

function resolvedSetting(
  candidate: CodexSettingCandidate | null,
  actionScoped: boolean
): ResolvedCodexSetting {
  return {
    value: candidate?.value || null,
    source: candidate?.source || null,
    inherited: candidate ? (actionScoped ? candidate.source !== 'user_action' : candidate.source !== 'user_default') : true
  };
}

function resolveCodexConfiguration(input: {
  preference: Pick<AiProviderPreference, 'codexModel' | 'codexReasoningEffort' | 'codexActionOverrides'>;
  adminDefaults: AdminCodexDefaults;
  models: CodexModel[];
  actionId?: CodexActionId | null;
}) {
  const available = visibleModels(input.models);
  const byId = new Map(available.map((model) => [model.id, model]));
  const ordered = codexCandidates(input.preference, input.adminDefaults, input.actionId);
  const configuredModel = ordered.models.find((candidate) => byId.has(candidate.value));
  const fallbackModel = safeConnectedModel(available);
  const modelDefinition = configuredModel ? byId.get(configuredModel.value)! : fallbackModel;
  const modelCandidate = configuredModel || (modelDefinition
    ? { value: modelDefinition.id, source: 'connected_model_default' as const }
    : null);
  const supported = modelDefinition ? supportedEfforts(modelDefinition) : [];
  const configuredEffort = ordered.efforts.find((candidate) => supported.includes(candidate.value));
  const fallbackEffort = modelDefinition
    ? (supported.includes(modelDefinition.defaultReasoningEffort || '')
      ? modelDefinition.defaultReasoningEffort!
      : supported[0] || null)
    : null;
  const effortCandidate = configuredEffort || (fallbackEffort
    ? { value: fallbackEffort, source: 'model_default' as const }
    : null);
  return {
    model: resolvedSetting(modelCandidate, Boolean(input.actionId)),
    reasoningEffort: resolvedSetting(effortCandidate, Boolean(input.actionId)),
    modelDefinition,
    modelCandidates: ordered.models,
    reasoningEffortCandidates: ordered.efforts
  };
}

function resolveAutomaticReasoningEfforts(input: {
  models: CodexModel[];
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  actionOverrides: CodexActionOverrides;
}) {
  const modelById = new Map(visibleModels(input.models).map((model) => [model.id, model]));
  const defaultModel = input.defaultModel ? modelById.get(input.defaultModel) : undefined;
  const next: CodexActionOverrides = {};
  for (const action of codexActionCatalog) {
    const override = input.actionOverrides[action.id];
    if (!override) continue;
    if (override.reasoningEffort && !override.reasoningEffortAuto) {
      next[action.id] = override;
      continue;
    }
    const model = override.model ? modelById.get(override.model) : defaultModel;
    const inheritedEffort = input.defaultReasoningEffort || action.defaultReasoningEffort;
    const supported = model ? supportedEfforts(model) : [];
    if (supported.includes(inheritedEffort)) {
      if (override.model) next[action.id] = { model: override.model, reasoningEffort: null };
      continue;
    }
    const fallback = model
      ? (supported.includes(model.defaultReasoningEffort || '')
        ? model.defaultReasoningEffort!
        : supported[0] || null)
      : override.reasoningEffort;
    next[action.id] = {
      model: override.model,
      reasoningEffort: fallback,
      ...(fallback ? { reasoningEffortAuto: true as const } : {})
    };
  }
  return next;
}

function validateCodexConfiguration(input: {
  models: CodexModel[];
  preference: Pick<AiProviderPreference, 'codexModel' | 'codexReasoningEffort' | 'codexActionOverrides'>;
  adminDefaults: AdminCodexDefaults;
  target: 'user' | 'admin';
}) {
  const models = visibleModels(input.models);
  const modelById = new Map(models.map((model) => [model.id, model]));
  if (!models.length) {
    throw new TerraError('This ChatGPT account does not advertise an available Codex model.',
      'CODEX_MODEL_UNAVAILABLE', 409, false);
  }
  const targetDefaults = input.target === 'user' ? input.preference : input.adminDefaults;
  const configuredModels = [
    targetDefaults.codexModel,
    ...Object.values(targetDefaults.codexActionOverrides).map((override) => override?.model)
  ].map(optionalString).filter((model): model is string => Boolean(model));
  const unavailableModel = configuredModels.find((model) => !modelById.has(model));
  if (unavailableModel) {
    throw new TerraError(
      `The selected Codex model (${unavailableModel}) is not available to this ChatGPT account.`,
      'CODEX_MODEL_UNAVAILABLE', 409, false
    );
  }
  const assertEffort = (model: CodexModel, effort: string, label: string) => {
    const supported = supportedEfforts(model);
    if (!supported.length) {
      throw new TerraError(
        `${label} does not advertise a usable reasoning effort.`,
        'CODEX_REASONING_EFFORT_UNAVAILABLE', 409, false
      );
    }
    if (!supported.includes(effort)) {
      throw new TerraError(
        `${label} does not support the ${effort} reasoning effort.`,
        'CODEX_REASONING_EFFORT_UNAVAILABLE', 409, false
      );
    }
  };

  const targetSources = input.target === 'user'
    ? new Set<CodexSettingSource>(['user_action', 'user_default'])
    : new Set<CodexSettingSource>(['admin_action', 'admin_default']);
  const scopes: Array<{ actionId: CodexActionId | null; label: string }> = [
    { actionId: null, label: 'the global Codex default' },
    ...codexActionCatalog.map((action) => ({ actionId: action.id, label: action.label }))
  ];
  for (const scope of scopes) {
    const targetActionOverride = scope.actionId
      ? targetDefaults.codexActionOverrides[scope.actionId]
      : undefined;
    const resolved = resolveCodexConfiguration({
      preference: input.preference,
      adminDefaults: input.adminDefaults,
      models,
      actionId: scope.actionId
    });
    // An automatic action effort is only a catalog-compatibility marker. It
    // permits this action to fall through to a compatible inherited or model
    // default without becoming a durable user/admin precedence override.
    if (targetActionOverride?.reasoningEffortAuto) continue;
    const requestedEffort = resolved.reasoningEffortCandidates[0];
    if (!requestedEffort || !targetSources.has(requestedEffort.source)) continue;
    if (!resolved.modelDefinition) {
      throw new TerraError('Select a Codex model available to this ChatGPT account.',
        'CODEX_MODEL_UNAVAILABLE', 409, false);
    }
    assertEffort(resolved.modelDefinition, requestedEffort.value,
      `${resolved.modelDefinition.displayName} for ${scope.label}`);
  }
}

const emptyCodexPreference = {
  codexModel: null,
  codexReasoningEffort: null,
  codexActionOverrides: {} as CodexActionOverrides
};

/**
 * Route-agnostic admin service. The caller owns RBAC/audit policy; this service
 * owns connected-catalog validation and durable persistence.
 */
export async function updateAdminCodexDefaults(validatingUserId: string, input: CodexDefaultsInput) {
  if (input.codexActionOverrides !== undefined) assertKnownActionOverrides(input.codexActionOverrides);
  const client = codexClientForUser(validatingUserId);
  const account = await client.accountStatus().catch((error) => {
    throw new TerraError(`Codex is unavailable: ${codexRuntimeError(error)}`, 'CODEX_UNAVAILABLE', 503, true);
  });
  if (!account.connected) {
    throw new TerraError('Connect a ChatGPT account before managing administrator Codex defaults.',
      'CODEX_NOT_CONNECTED', 409, false);
  }
  let models: CodexModel[];
  try { models = visibleModels(await client.models()); }
  catch (error) {
    throw new TerraError(`Codex models could not be loaded: ${codexRuntimeError(error)}`,
      'CODEX_MODELS_UNAVAILABLE', 503, true);
  }
  const current = getAdminCodexDefaults();
  const draft: AdminCodexDefaults = {
    codexModel: input.codexModel === undefined ? current.codexModel : optionalString(input.codexModel),
    codexReasoningEffort: input.codexReasoningEffort === undefined
      ? current.codexReasoningEffort : optionalString(input.codexReasoningEffort),
    codexActionOverrides: input.codexActionOverrides === undefined
      ? current.codexActionOverrides : normaliseActionOverrides(input.codexActionOverrides),
    updatedAt: current.updatedAt
  };
  const global = resolveCodexConfiguration({
    preference: emptyCodexPreference,
    adminDefaults: draft,
    models
  });
  const next: AdminCodexDefaults = {
    ...draft,
    codexActionOverrides: resolveAutomaticReasoningEfforts({
      models,
      defaultModel: global.model.value,
      defaultReasoningEffort: draft.codexReasoningEffort,
      actionOverrides: draft.codexActionOverrides
    }),
    updatedAt: new Date().toISOString()
  };
  validateCodexConfiguration({
    models,
    preference: emptyCodexPreference,
    adminDefaults: next,
    target: 'admin'
  });
  const file = readPreferences();
  writePreferences({ ...file, adminCodexDefaults: next });
  return next;
}

export function resetAdminCodexDefaults(): AdminCodexDefaults {
  const next: AdminCodexDefaults = {
    codexModel: null,
    codexReasoningEffort: null,
    codexActionOverrides: {},
    updatedAt: new Date().toISOString()
  };
  const file = readPreferences();
  writePreferences({ ...file, adminCodexDefaults: next });
  return next;
}

function effectiveCodexConfiguration(
  preference: AiProviderPreference,
  adminDefaults: AdminCodexDefaults,
  models: CodexModel[]
) {
  const global = resolveCodexConfiguration({ preference, adminDefaults, models });
  return {
    default: { model: global.model, reasoningEffort: global.reasoningEffort },
    actions: Object.fromEntries(codexActionCatalog.map((action) => {
      const resolved = resolveCodexConfiguration({ preference, adminDefaults, models, actionId: action.id });
      return [action.id, { model: resolved.model, reasoningEffort: resolved.reasoningEffort }];
    })) as Record<CodexActionId, { model: ResolvedCodexSetting; reasoningEffort: ResolvedCodexSetting }>
  };
}

export async function getAiProviderState(userId: string, spaceId: string) {
  const preference = getAiProviderPreference(userId, spaceId);
  const adminDefaults = getAdminCodexDefaults();
  try {
    const client = codexClientForUser(userId);
    const account = await client.accountStatus();
    const models = account.connected ? visibleModels(await client.models()) : [];
    const effectiveConfiguration = effectiveCodexConfiguration(preference, adminDefaults, models);
    return {
      preference,
      codex: {
        available: true,
        account,
        models,
        actions: codexActionCatalog,
        adminDefaults,
        effectiveConfiguration,
        selectedModel: effectiveConfiguration.default.model.value,
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
        actions: codexActionCatalog,
        adminDefaults,
        effectiveConfiguration: effectiveCodexConfiguration(preference, adminDefaults, []),
        selectedModel: preference.codexModel || adminDefaults.codexModel,
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
  const preferences = Object.fromEntries(Object.entries(file.preferences).map(([key, value]) => {
    if (!key.startsWith(prefix)) return [key, value];
    const updatedAt = new Date().toISOString();
    return storedRuntimeChoice(value) === 'local'
      ? [key, { ...value, provider: 'terra' as const, runtimeChoice: 'local' as const,
        codexDataSharingAcknowledgedAt: null, updatedAt }]
      : [key, { ...value, provider: 'codex' as const, runtimeChoice: null,
        codexDataSharingAcknowledgedAt: null, updatedAt }];
  }));
  writePreferences({ ...file, preferences });
}

export async function chooseAiProvider(userId: string, spaceId: string, input: {
  provider: AiProvider;
  codexModel?: string | null;
  codexReasoningEffort?: string | null;
  codexActionOverrides?: CodexActionOverrides;
  codexDataSharingAcknowledged?: boolean;
}) {
  // Revocation is an immediate privacy boundary. Never make it depend on the
  // connected account, live model catalog, or any optional full-form fields.
  if (input.provider === 'terra' && input.codexDataSharingAcknowledged === false) {
    return setAiProviderPreference(userId, spaceId, {
      provider: 'terra', runtimeChoice: 'local', codexDataSharingAcknowledgedAt: null
    });
  }
  if (input.codexActionOverrides !== undefined) assertKnownActionOverrides(input.codexActionOverrides);
  const normalisedRequestedOverrides = input.codexActionOverrides === undefined
    ? undefined : normaliseActionOverrides(input.codexActionOverrides);
  const changesCodexConfiguration = optionalString(input.codexModel) !== null
    || optionalString(input.codexReasoningEffort) !== null
    || Boolean(normalisedRequestedOverrides && Object.keys(normalisedRequestedOverrides).length);
  if (input.provider === 'codex' || changesCodexConfiguration) {
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
    if (input.provider === 'codex'
      && (input.codexDataSharingAcknowledged === false || !acknowledgedAt)) {
      throw new TerraError(
        'Acknowledge that AI task content may be sent to OpenAI before selecting Codex.',
        'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED', 409, false
      );
    }
    const model = input.codexModel === undefined ? current.codexModel : optionalString(input.codexModel);
    const reasoningEffort = input.codexReasoningEffort === undefined
      ? current.codexReasoningEffort : optionalString(input.codexReasoningEffort);
    const requestedActionOverrides = input.codexActionOverrides === undefined
      ? current.codexActionOverrides : normalisedRequestedOverrides!;
    const adminDefaults = getAdminCodexDefaults();
    const draftPreference = {
      codexModel: model,
      codexReasoningEffort: reasoningEffort,
      codexActionOverrides: requestedActionOverrides
    };
    const global = resolveCodexConfiguration({
      preference: draftPreference,
      adminDefaults,
      models
    });
    const actionOverrides = resolveAutomaticReasoningEfforts({
      models,
      defaultModel: global.model.value,
      defaultReasoningEffort: reasoningEffort || adminDefaults.codexReasoningEffort,
      actionOverrides: requestedActionOverrides
    });
    validateCodexConfiguration({
      models,
      preference: { ...draftPreference, codexActionOverrides: actionOverrides },
      adminDefaults,
      target: 'user'
    });
    return setAiProviderPreference(userId, spaceId, {
      provider: input.provider,
      runtimeChoice: input.provider === 'codex' ? 'chatgpt' : 'local',
      codexModel: model,
      codexReasoningEffort: reasoningEffort,
      codexActionOverrides: actionOverrides,
      codexDataSharingAcknowledgedAt: input.codexDataSharingAcknowledged === false ? null : acknowledgedAt
    });
  }
  return setAiProviderPreference(userId, spaceId, {
    provider: 'terra',
    runtimeChoice: 'local',
    codexModel: input.codexModel,
    codexReasoningEffort: input.codexReasoningEffort,
    codexActionOverrides: normalisedRequestedOverrides,
    ...(input.codexDataSharingAcknowledged === false ? { codexDataSharingAcknowledgedAt: null } : {})
  });
}

export interface AiCompletionInput extends TerraCompletionInput {
  spaceId: string;
  userId: string | null;
  actionId?: CodexActionId;
  providerSnapshot?: AiProviderSnapshot;
}

export function effectiveAiProviderSnapshot(
  userId: string | null | undefined,
  spaceId: string,
  recorded?: AiProviderSnapshot,
  actionId?: CodexActionId
): AiProviderSnapshot {
  if (!userId) return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  const snapshot = recorded || aiProviderSnapshot(userId, spaceId, actionId);
  // Provider/model are durable job inputs, but privacy revocation is an immediate
  // override: queued or retried work must return to Terra once consent is removed.
  if (snapshot.provider === 'codex' && !getAiProviderPreference(userId, spaceId).codexDataSharingAcknowledgedAt) {
    return { provider: 'terra', codexModel: null, codexDataSharingAcknowledgedAt: null };
  }
  return snapshot;
}

const codexSettingSources = new Set<CodexSettingSource>([
  'user_action', 'user_default', 'admin_action', 'admin_default',
  'action_default', 'connected_model_default', 'model_default'
]);

function recordedCandidates(
  recorded: unknown,
  legacy: unknown,
  legacySource: CodexSettingSource
): CodexSettingCandidate[] {
  if (Array.isArray(recorded)) {
    return recorded.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const value = optionalString((candidate as Record<string, unknown>).value);
      const source = (candidate as Record<string, unknown>).source;
      return value && codexSettingSources.has(source as CodexSettingSource)
        ? [{ value, source: source as CodexSettingSource }]
        : [];
    });
  }
  const value = optionalString(legacy);
  return value ? [{ value, source: legacySource }] : [];
}

export async function completeWithAi(input: AiCompletionInput) {
  const snapshot = effectiveAiProviderSnapshot(input.userId, input.spaceId, input.providerSnapshot, input.actionId);
  if (!input.userId || snapshot.provider === 'terra') {
    return completeWithTerra(input);
  }
  if (!snapshot.codexDataSharingAcknowledgedAt) {
    throw new TerraError('This Codex task does not have a recorded data-sharing acknowledgement.',
      'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED', 409, false);
  }
  const client = codexClientForUser(input.userId);
  let models: CodexModel[];
  try {
    models = visibleModels(await client.models());
  } catch (error) {
    throw new TerraError(`Codex models could not be loaded: ${codexRuntimeError(error)}`,
      'CODEX_MODELS_UNAVAILABLE', 503, true);
  }
  const modelCandidates = recordedCandidates(
    snapshot.codexModelCandidates,
    snapshot.codexModel,
    snapshot.codexActionId ? 'user_action' : 'user_default'
  );
  const modelDefinition = modelCandidates
    .map((candidate) => models.find((item) => item.id === candidate.value))
    .find((candidate): candidate is CodexModel => Boolean(candidate))
    || safeConnectedModel(models);
  if (!modelDefinition) {
    throw new TerraError(
      'This ChatGPT account does not advertise an available Codex model.',
      'CODEX_MODEL_UNAVAILABLE', 409, false
    );
  }
  const model = modelDefinition.id;
  const efforts = supportedEfforts(modelDefinition);
  if (!efforts.length) {
    throw new TerraError(
      `${modelDefinition.displayName} does not advertise a usable reasoning effort.`,
      'CODEX_REASONING_EFFORT_UNAVAILABLE', 409, false
    );
  }
  const effortCandidates = recordedCandidates(
    snapshot.codexReasoningEffortCandidates,
    snapshot.codexReasoningEffort,
    snapshot.codexActionId ? 'user_action' : 'user_default'
  );
  let reasoningEffort = effortCandidates.find((candidate) => efforts.includes(candidate.value))?.value || null;
  if (!reasoningEffort) {
    reasoningEffort = efforts.includes(modelDefinition.defaultReasoningEffort || '')
        ? modelDefinition.defaultReasoningEffort!
        : efforts[0];
  }
  try {
    return await client.complete({
      messages: input.messages,
      jsonSchema: input.jsonSchema,
      model,
      reasoningEffort,
      action: input.actionId || snapshot.codexActionId || input.activity,
      requestId: input.requestId,
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
