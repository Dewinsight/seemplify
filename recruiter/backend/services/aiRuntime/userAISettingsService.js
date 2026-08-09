'use strict';

const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const { ACTIVITY_DEFINITIONS, CHATGPT_DEFAULT_CODEX_MODEL } = require('../../config/aiRuntimeCatalog');
const { AIRuntimeError } = require('./aiRuntimeService');
const aiRuntimeService = require('./aiRuntimeService');
const codexAccountService = require('./codexAccountService');
const { cleanModels } = require('./adminModelCatalogService');

// The live model catalogue is authoritative. This superset covers current and
// legacy Codex app-server values; a selection is further constrained to the
// efforts advertised by the chosen model whenever that list is present.
const REASONING_EFFORTS = Object.freeze(['minimal', 'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const SAFE_DEFAULT = Object.freeze({ codexModel: CHATGPT_DEFAULT_CODEX_MODEL, reasoningEffort: 'medium' });
const PROVENANCE = Object.freeze({
  ACTIVITY: 'activity_override',
  ACCOUNT: 'account_default',
  ADMIN: 'admin_default',
  APP: 'app_default'
});

function valueOrNull(value, max = 120) {
  const normalized = String(value || '').trim().slice(0, max);
  return normalized || null;
}

function accountDefaults(account) {
  return {
    codexModel: valueOrNull(account?.aiDefaults?.codexModel),
    reasoningEffort: valueOrNull(account?.aiDefaults?.reasoningEffort, 20)
  };
}

function activityOverride(account, activity) {
  const candidate = (account?.activityOverrides || []).find((item) => item.activity === activity);
  return {
    codexModel: valueOrNull(candidate?.codexModel),
    reasoningEffort: valueOrNull(candidate?.reasoningEffort, 20)
  };
}

function fieldResolution({ activityValue, accountValue, adminValue, appValue }) {
  if (activityValue) return { value: activityValue, provenance: PROVENANCE.ACTIVITY };
  if (accountValue) return { value: accountValue, provenance: PROVENANCE.ACCOUNT };
  if (adminValue) return { value: adminValue, provenance: PROVENANCE.ADMIN };
  return { value: appValue, provenance: PROVENANCE.APP };
}

function resolveActivityPreference(activity, route, account) {
  const override = activityOverride(account, activity);
  const defaults = accountDefaults(account);
  const model = fieldResolution({
    activityValue: override.codexModel,
    accountValue: defaults.codexModel,
    adminValue: valueOrNull(route?.codexModel),
    appValue: SAFE_DEFAULT.codexModel
  });
  const effort = fieldResolution({
    activityValue: override.reasoningEffort,
    accountValue: defaults.reasoningEffort,
    adminValue: valueOrNull(route?.reasoningEffort, 20),
    appValue: SAFE_DEFAULT.reasoningEffort
  });
  return {
    effective: { codexModel: model.value, reasoningEffort: effort.value },
    provenance: { codexModel: model.provenance, reasoningEffort: effort.provenance },
    override,
    accountDefault: defaults
  };
}

function buildPreferences({ settings, account, models = [] }) {
  const routes = new Map((settings?.routes || []).map((route) => [route.activity, route]));
  const defaults = accountDefaults(account);
  const activities = Object.entries(ACTIVITY_DEFINITIONS).map(([activity, definition]) => {
    const route = routes.get(activity) || {};
    const resolved = resolveActivityPreference(activity, route, account);
    return {
      activity,
      app: definition.app || 'recruiter',
      label: definition.label,
      group: definition.group,
      enabled: route.enabled !== false,
      adminDefault: {
        codexModel: valueOrNull(route.codexModel) || SAFE_DEFAULT.codexModel,
        reasoningEffort: valueOrNull(route.reasoningEffort, 20) || SAFE_DEFAULT.reasoningEffort
      },
      ...resolved
    };
  });
  return {
    defaults: {
      override: defaults,
      // Account defaults are context-free. A null field means each activity
      // inherits its administrator default; the activity rows below always
      // contain the concrete effective value and its provenance.
      effective: {
        codexModel: defaults.codexModel,
        reasoningEffort: defaults.reasoningEffort
      },
      provenance: {
        codexModel: defaults.codexModel ? PROVENANCE.ACCOUNT : PROVENANCE.ADMIN,
        reasoningEffort: defaults.reasoningEffort ? PROVENANCE.ACCOUNT : PROVENANCE.ADMIN
      }
    },
    activities,
    models: cleanModels(models),
    provenanceValues: Object.values(PROVENANCE)
  };
}

async function findAccount(user) {
  const userId = String(user?.id || user?._id || '');
  let account = await AIUserRuntimeAccount.findOne({ user: userId });
  if (!account) account = await codexAccountService.accountForUser(user);
  return account;
}

async function liveModels(user, account, { required = false } = {}) {
  if (account?.status !== 'connected') {
    if (required) {
      throw new AIRuntimeError('Connect ChatGPT before changing model preferences.', {
        code: 'CHATGPT_NOT_CONNECTED', statusCode: 409, retryable: false
      });
    }
    return [];
  }
  try {
    return cleanModels(await codexAccountService.listModels(user));
  } catch (error) {
    if (required) throw error;
    return [];
  }
}

async function readPreferences(user) {
  const [settings, account] = await Promise.all([
    aiRuntimeService.getSettings(),
    findAccount(user)
  ]);
  const models = await liveModels(user, account);
  return buildPreferences({ settings, account, models });
}

function normalizeUpdate(input) {
  const scope = input?.scope === 'default' ? 'default' : 'activity';
  const activity = valueOrNull(input?.activity);
  if (scope === 'activity' && (!activity || !ACTIVITY_DEFINITIONS[activity])) {
    throw new AIRuntimeError('Choose a valid AI activity.', {
      code: 'AI_ACTIVITY_UNKNOWN', statusCode: 400, retryable: false
    });
  }
  const hasCodexModel = Object.prototype.hasOwnProperty.call(input || {}, 'codexModel');
  const hasReasoningEffort = Object.prototype.hasOwnProperty.call(input || {}, 'reasoningEffort');
  if (!hasCodexModel && !hasReasoningEffort) {
    throw new AIRuntimeError('Choose a model or reasoning preference to update.', {
      code: 'AI_PREFERENCE_UPDATE_EMPTY', statusCode: 400, retryable: false
    });
  }
  const codexModel = !hasCodexModel || input.codexModel == null ? null : valueOrNull(input.codexModel);
  const reasoningEffort = !hasReasoningEffort || input.reasoningEffort == null
    ? null : valueOrNull(input.reasoningEffort, 20);
  if (reasoningEffort && !REASONING_EFFORTS.includes(reasoningEffort)) {
    throw new AIRuntimeError('Choose a supported reasoning effort.', {
      code: 'AI_REASONING_EFFORT_INVALID', statusCode: 400, retryable: false
    });
  }
  return { scope, activity, codexModel, reasoningEffort, hasCodexModel, hasReasoningEffort };
}

function modelEfforts(model) {
  return (model?.supportedReasoningEfforts || []).map((item) => (
    typeof item === 'string' ? item : item?.reasoningEffort
  )).filter((item) => REASONING_EFFORTS.includes(item));
}

function updateIncludes(update, field) {
  const flag = field === 'codexModel' ? 'hasCodexModel' : 'hasReasoningEffort';
  return update[flag] === undefined
    ? Object.prototype.hasOwnProperty.call(update, field)
    : update[flag] === true;
}

function mergedPreference(current, update) {
  return {
    codexModel: updateIncludes(update, 'codexModel') ? update.codexModel : current.codexModel,
    reasoningEffort: updateIncludes(update, 'reasoningEffort') ? update.reasoningEffort : current.reasoningEffort
  };
}

function plainOverrides(account) {
  return (account?.activityOverrides || []).map((item) => ({
    activity: String(item.activity || ''),
    codexModel: valueOrNull(item.codexModel),
    reasoningEffort: valueOrNull(item.reasoningEffort, 20)
  })).filter((item) => item.activity);
}

function preferenceMutation(account, update) {
  const current = update.scope === 'default'
    ? accountDefaults(account) : activityOverride(account, update.activity);
  const nextPreference = mergedPreference(current, update);
  if (update.scope === 'default') {
    return { nextPreference, set: { aiDefaults: nextPreference } };
  }
  const overrides = plainOverrides(account);
  const index = overrides.findIndex((item) => item.activity === update.activity);
  if (!nextPreference.codexModel && !nextPreference.reasoningEffort) {
    if (index >= 0) overrides.splice(index, 1);
  } else {
    const value = { activity: update.activity, ...nextPreference };
    if (index >= 0) overrides[index] = value;
    else overrides.push(value);
  }
  return { nextPreference, set: { activityOverrides: overrides } };
}

function validateUpdate(update, models, settings, account) {
  const modelMap = new Map(models.map((model) => [model.id, model]));
  if (update.codexModel && !modelMap.has(update.codexModel)) {
    throw new AIRuntimeError('That model is not available on your connected ChatGPT account.', {
      code: 'CHATGPT_MODEL_NOT_AVAILABLE', statusCode: 400, retryable: false
    });
  }
  const routeMap = new Map((settings.routes || []).map((route) => [route.activity, route]));
  let affected = [];
  if (update.scope === 'activity') {
    const nextOverride = mergedPreference(activityOverride(account, update.activity), update);
    const simulated = {
      aiDefaults: accountDefaults(account),
      activityOverrides: [
        ...(account?.activityOverrides || []).filter((item) => item.activity !== update.activity),
        ...((nextOverride.codexModel || nextOverride.reasoningEffort)
          ? [{ activity: update.activity, ...nextOverride }] : [])
      ]
    };
    affected = [resolveActivityPreference(update.activity, routeMap.get(update.activity), simulated).effective];
  } else {
    const nextDefaults = mergedPreference(accountDefaults(account), update);
    const simulated = {
      aiDefaults: nextDefaults,
      activityOverrides: account?.activityOverrides || []
    };
    affected = Object.keys(ACTIVITY_DEFINITIONS).flatMap((activity) => {
      const existing = activityOverride(account, activity);
      const modelAffected = updateIncludes(update, 'codexModel') && !existing.codexModel;
      const effortAffected = updateIncludes(update, 'reasoningEffort') && !existing.reasoningEffort;
      if (!modelAffected && !effortAffected) return [];
      return [resolveActivityPreference(activity, routeMap.get(activity), simulated).effective];
    });
  }

  for (const preference of affected) {
    const model = modelMap.get(preference.codexModel);
    if (!model) {
      throw new AIRuntimeError('That model is not available on your connected ChatGPT account.', {
        code: 'CHATGPT_MODEL_NOT_AVAILABLE', statusCode: 400, retryable: false,
        details: { model: preference.codexModel }
      });
    }
    const supported = modelEfforts(model);
    if (preference.reasoningEffort && supported.length && !supported.includes(preference.reasoningEffort)) {
      throw new AIRuntimeError('That reasoning effort is not supported by the selected model.', {
        code: 'CHATGPT_REASONING_NOT_SUPPORTED', statusCode: 400, retryable: false,
        details: { model: preference.codexModel }
      });
    }
  }
}

async function writePreference(user, input) {
  const update = normalizeUpdate(input);
  const settings = await aiRuntimeService.getSettings();
  let account = await findAccount(user);
  // Clearing an override cannot introduce an unsupported model, and must stay
  // possible after disconnecting ChatGPT. New concrete selections still
  // require the live connected-account catalogue as their authority.
  let { nextPreference } = preferenceMutation(account, update);
  const clearing = updateIncludes(update, 'codexModel')
    && updateIncludes(update, 'reasoningEffort')
    && !nextPreference.codexModel
    && !nextPreference.reasoningEffort;
  const models = await liveModels(user, account, { required: !clearing });

  // Optimistic versioning makes a preference edit one atomic mutation. When
  // Recruiter and Performance save different activities concurrently, the
  // loser re-reads and reapplies its field-level change instead of replacing
  // the winner's whole activityOverrides array with a stale snapshot.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const mutation = preferenceMutation(account, update);
    nextPreference = mutation.nextPreference;
    const retryClearing = updateIncludes(update, 'codexModel')
      && updateIncludes(update, 'reasoningEffort')
      && !nextPreference.codexModel
      && !nextPreference.reasoningEffort;
    if (!retryClearing) validateUpdate(update, models, settings, account);
    const expectedVersion = Number(account.__v || 0);
    const updated = await AIUserRuntimeAccount.findOneAndUpdate(
      { _id: account._id, __v: expectedVersion },
      { $set: mutation.set, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (updated) return buildPreferences({ settings, account: updated, models });
    account = await findAccount(user);
  }
  throw new AIRuntimeError('Your AI preferences changed in another session. Please retry.', {
    code: 'AI_PREFERENCE_CONFLICT_RETRY', statusCode: 409, retryable: true
  });
}

async function deletePreference(user, input) {
  return writePreference(user, {
    scope: input?.scope === 'default' ? 'default' : 'activity',
    activity: input?.activity,
    codexModel: null,
    reasoningEffort: null
  });
}

async function effectiveOverride(userId, activity) {
  if (!userId || !ACTIVITY_DEFINITIONS[activity]) return null;
  const [settings, account] = await Promise.all([
    aiRuntimeService.getSettings(),
    AIUserRuntimeAccount.findOne({ user: userId }).lean()
  ]);
  if (!account) return null;
  const route = (settings.routes || []).find((item) => item.activity === activity);
  return resolveActivityPreference(activity, route, account);
}

module.exports = {
  PROVENANCE,
  REASONING_EFFORTS,
  SAFE_DEFAULT,
  buildPreferences,
  deletePreference,
  effectiveOverride,
  normalizeUpdate,
  preferenceMutation,
  readPreferences,
  resolveActivityPreference,
  validateUpdate,
  writePreference
};
