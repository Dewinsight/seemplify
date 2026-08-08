'use strict';

const User = require('../../models/User');
const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const codexAccountService = require('./codexAccountService');

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
        .map((item) => String(item?.reasoningEffort || '').trim().slice(0, 20))
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

module.exports = { adminModelCatalog, cleanModels };
