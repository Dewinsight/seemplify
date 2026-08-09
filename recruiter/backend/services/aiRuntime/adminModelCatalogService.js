'use strict';

const User = require('../../models/User');
const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const codexAccountService = require('./codexAccountService');

const ADMIN_REASONING_EFFORTS = Object.freeze([
  'minimal', 'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'
]);

function preferenceError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function cleanModels(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((candidate) => {
    const id = String(candidate?.id || '').trim().slice(0, 100);
    const displayName = String(candidate?.displayName || '').trim().slice(0, 120);
    if (!id || !displayName || candidate?.hidden === true || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      displayName,
      isDefault: candidate?.isDefault === true,
      defaultReasoningEffort: String(candidate?.defaultReasoningEffort || '').trim().slice(0, 20) || null,
      supportedReasoningEfforts: (Array.isArray(candidate?.supportedReasoningEfforts)
        ? candidate.supportedReasoningEfforts : [])
        .map((item) => String(typeof item === 'string' ? item : item?.reasoningEffort || '').trim().slice(0, 20))
        .filter(Boolean)
        .map((reasoningEffort) => ({ reasoningEffort }))
    }];
  });
}

async function defaultFindUserByEmail(email) {
  return User.findOne({ email }).select('_id').lean();
}

async function defaultFindRuntimeAccount(userId) {
  return AIUserRuntimeAccount.findOne({ user: userId }).select('status').lean();
}

async function adminModelCatalog(admin, dependencies = {}) {
  const findUserByEmail = dependencies.findUserByEmail || defaultFindUserByEmail;
  const findRuntimeAccount = dependencies.findRuntimeAccount || defaultFindRuntimeAccount;
  const listModels = dependencies.listModels || codexAccountService.listModels;
  const email = String(admin?.email || '').trim().toLowerCase();

  if (!email) {
    return { available: false, models: [], message: 'The administrator account has no email address.' };
  }

  const user = await findUserByEmail(email);
  if (!user?._id && !user?.id) {
    return {
      available: false,
      models: [],
      message: 'No Recruiter account matches this administrator email, so its ChatGPT model catalogue cannot be loaded.'
    };
  }

  const userId = user._id || user.id;
  const account = await findRuntimeAccount(userId);
  if (account?.status !== 'connected') {
    return {
      available: false,
      models: [],
      message: 'Connect ChatGPT in Recruiter with this administrator email to load the available models.'
    };
  }

  try {
    const models = cleanModels(await listModels({ id: userId }));
    return {
      available: models.length > 0,
      models,
      message: models.length ? null : 'The connected ChatGPT account did not advertise any selectable models.'
    };
  } catch (error) {
    return {
      available: false,
      models: [],
      message: error?.message || 'The ChatGPT model catalogue is currently unavailable.'
    };
  }
}

function validateAdminRoutePreference(currentRoute, input, models) {
  const hasModel = Object.prototype.hasOwnProperty.call(input || {}, 'codexModel');
  const hasEffort = Object.prototype.hasOwnProperty.call(input || {}, 'reasoningEffort');
  const next = {
    codexModel: hasModel ? String(input.codexModel || '').trim().slice(0, 100) : String(currentRoute?.codexModel || ''),
    reasoningEffort: hasEffort ? String(input.reasoningEffort || '').trim() : String(currentRoute?.reasoningEffort || '')
  };
  if (!hasModel && !hasEffort) return next;
  if (!next.codexModel) throw preferenceError('Choose an available ChatGPT model.', 'CHATGPT_MODEL_NOT_AVAILABLE');
  if (!ADMIN_REASONING_EFFORTS.includes(next.reasoningEffort)) {
    throw preferenceError('Choose a supported reasoning effort.', 'AI_REASONING_EFFORT_INVALID');
  }
  const model = (Array.isArray(models) ? models : []).find((candidate) => candidate.id === next.codexModel);
  if (!model) {
    throw preferenceError('That model is not available on the connected administrator ChatGPT account.', 'CHATGPT_MODEL_NOT_AVAILABLE');
  }
  const supported = (model.supportedReasoningEfforts || []).map((item) => (
    typeof item === 'string' ? item : item?.reasoningEffort
  )).filter(Boolean);
  if (supported.length && !supported.includes(next.reasoningEffort)) {
    throw preferenceError('That reasoning effort is not supported by the selected model.', 'CHATGPT_REASONING_NOT_SUPPORTED');
  }
  return next;
}

module.exports = {
  ADMIN_REASONING_EFFORTS,
  adminModelCatalog,
  cleanModels,
  validateAdminRoutePreference
};
