const prisma = require('../db/client');
const creditsService = require('./creditsService');
const currencyConversionService = require('./currencyConversionService');
const {
  AI_INTERVIEW_USD_PER_CREDIT,
  estimateAIInterviewCredits,
  findAIInterviewVoiceOption,
  getAIInterviewVoiceOptions
} = require('../config/aiInterviewVoiceOptions');

const AI_INTERVIEW_ACTION = 'aiInterviewCandidate';

async function getReferenceCreditRate() {
  return {
    usdPerCredit: AI_INTERVIEW_USD_PER_CREDIT,
    source: 'ai_interview_pricing_model',
    referencePack: null,
    bestPack: null
  };
}

async function getOrganizationCurrency(organizationId) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true }
  });
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

  const creditEstimate = estimateAIInterviewCredits({
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
  AI_INTERVIEW_USD_PER_CREDIT,
  snapshotVoice,
  getOptionsPayload
};
