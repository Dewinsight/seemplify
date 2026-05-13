const Organization = require('../models/Organization');
const CreditPack = require('../models/CreditPack');
const creditsService = require('./creditsService');
const currencyConversionService = require('./currencyConversionService');
const {
  estimateAIInterviewCredits,
  findAIInterviewVoiceOption,
  getAIInterviewVoiceOptions
} = require('../config/aiInterviewVoiceOptions');

const AI_INTERVIEW_ACTION = 'aiInterviewCandidate';
const FALLBACK_USD_PER_CREDIT = 0.30;

async function getReferenceCreditRate() {
  const packs = await CreditPack.find({ isActive: true, currency: 'USD' })
    .sort({ isPopular: -1, displayOrder: 1, price: 1 })
    .lean();

  const normalized = packs
    .map((pack) => {
      const totalCredits = Number(pack.totalCredits || pack.credits || 0);
      const price = Number(pack.price || 0);
      const usdPerCredit = totalCredits > 0 ? price / totalCredits : 0;
      return {
        code: pack.code,
        name: pack.name,
        price,
        totalCredits,
        usdPerCredit,
        isPopular: Boolean(pack.isPopular)
      };
    })
    .filter((pack) => pack.totalCredits > 0 && pack.usdPerCredit > 0);

  const referencePack = normalized.find((pack) => pack.isPopular) || normalized[0];
  const bestPack = [...normalized].sort((a, b) => a.usdPerCredit - b.usdPerCredit)[0];

  return {
    usdPerCredit: referencePack?.usdPerCredit || FALLBACK_USD_PER_CREDIT,
    source: referencePack ? 'credit_pack' : 'fallback',
    referencePack: referencePack || null,
    bestPack: bestPack || null
  };
}

async function getOrganizationCurrency(organizationId) {
  const organization = await Organization.findById(organizationId).select('settings.defaultCurrency').lean();
  return currencyConversionService.normalizeCurrencyCode(organization?.settings?.defaultCurrency || 'USD');
}

async function buildAIInterviewEstimate({
  organizationId,
  candidateCount,
  questionCount,
  totalMinutes,
  voiceId
} = {}) {
  const [creditStatus, creditRate, displayCurrency] = await Promise.all([
    organizationId ? creditsService.getOrganizationCredits(organizationId) : Promise.resolve(null),
    getReferenceCreditRate(),
    organizationId ? getOrganizationCurrency(organizationId) : Promise.resolve('USD')
  ]);

  const basePerCandidateCost = Number(creditStatus?.creditCosts?.[AI_INTERVIEW_ACTION] ?? 12);
  const creditEstimate = estimateAIInterviewCredits({
    basePerCandidateCost,
    candidateCount,
    questionCount,
    totalMinutes,
    voiceId
  });

  const estimatedUsdValue = creditEstimate.totalCredits * creditRate.usdPerCredit;
  const displayValue = await currencyConversionService.convertUsd(estimatedUsdValue, displayCurrency);

  return {
    ...creditEstimate,
    baseAction: AI_INTERVIEW_ACTION,
    remainingCredits: Number.isFinite(creditStatus?.remainingCredits) ? creditStatus.remainingCredits : null,
    enoughCredits: !creditStatus || creditEstimate.totalCredits <= Number(creditStatus.remainingCredits || 0),
    creditRate,
    estimatedUsdValue,
    displayValue,
    supportedCurrencies: currencyConversionService.getSupportedCurrencies(),
    calculatedAt: new Date().toISOString()
  };
}

function snapshotVoice(voiceId) {
  const voice = findAIInterviewVoiceOption(voiceId);
  return {
    voiceId: voice.id,
    name: voice.name,
    displayName: voice.displayName,
    tier: voice.tier,
    tierLabel: voice.tierLabel,
    provider: voice.provider,
    language: voice.language,
    gender: voice.gender,
    avatarTone: voice.avatarTone,
    samplePhrase: voice.samplePhrase,
    description: voice.description,
    traits: voice.traits,
    surchargeCredits: voice.surchargeCredits,
    usdPerMillionCharacters: voice.usdPerMillionCharacters
  };
}

function getOptionsPayload() {
  const voices = getAIInterviewVoiceOptions();
  const tiers = voices.reduce((acc, voice) => {
    if (!acc[voice.tier]) {
      acc[voice.tier] = {
        id: voice.tier,
        label: voice.tierLabel,
        description: voice.tierDescription,
        surchargeCredits: voice.surchargeCredits,
        usdPerMillionCharacters: voice.usdPerMillionCharacters,
        voices: []
      };
    }
    acc[voice.tier].voices.push(voice);
    return acc;
  }, {});

  return {
    voices,
    tiers: Object.values(tiers),
    defaultVoiceId: voices.find((voice) => voice.isDefault)?.id || voices[0]?.id
  };
}

module.exports = {
  buildAIInterviewEstimate,
  getReferenceCreditRate,
  snapshotVoice,
  getOptionsPayload
};
