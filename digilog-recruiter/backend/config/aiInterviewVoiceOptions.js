const DEFAULT_LANGUAGE = 'en-US';
const AI_INTERVIEW_USD_PER_CREDIT = 0.25;
const AI_INTERVIEW_TARGET_PROFIT_USD_PER_CANDIDATE = 1;
const AZURE_SPEECH_STT_USD_PER_HOUR = 1;
const AI_INTERVIEW_LLM_AND_PLATFORM_USD_PER_CANDIDATE = 0.35;

const VOICE_TIERS = {
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Reliable Azure neural voices for everyday interviews.',
    usdPerMillionCharacters: 15,
    surchargeCredits: 0,
    sortOrder: 10
  },
  multilingual: {
    id: 'multilingual',
    label: 'Multilingual',
    description: 'Natural neural voices that keep better pronunciation flexibility.',
    usdPerMillionCharacters: 15,
    surchargeCredits: 0,
    sortOrder: 20
  },
  hd: {
    id: 'hd',
    label: 'HD',
    description: 'Azure Neural HD voices with stronger expressiveness and pacing.',
    usdPerMillionCharacters: 22,
    surchargeCredits: 1,
    sortOrder: 30
  },
  mai_premium: {
    id: 'mai_premium',
    label: 'MAI Premium',
    description: 'Microsoft MAI-Voice-1 preview voices for premium conversation quality.',
    usdPerMillionCharacters: 22,
    surchargeCredits: 2,
    sortOrder: 40
  }
};

const AI_INTERVIEW_VOICE_OPTIONS = [
  {
    id: 'en-NG-EzinneNeural',
    name: 'Ezinne',
    displayName: 'Ezinne',
    tier: 'standard',
    language: 'en-NG',
    gender: 'female',
    avatarTone: 'purple',
    isDefault: true,
    description: 'Warm Nigerian English voice with a clear, confident interview style.',
    samplePhrase: 'Welcome. I will guide you through this interview one question at a time.',
    traits: ['nigerian english', 'warm', 'confident'],
    sortOrder: 0
  },
  {
    id: 'en-NG-AbeoNeural',
    name: 'Abeo',
    displayName: 'Abeo',
    tier: 'standard',
    language: 'en-NG',
    gender: 'male',
    avatarTone: 'emerald',
    description: 'Calm Nigerian English voice with a composed, professional delivery.',
    samplePhrase: 'Take your time, and share a clear example when you are ready.',
    traits: ['nigerian english', 'calm', 'professional'],
    sortOrder: 1
  },
  {
    id: 'en-US-JennyMultilingualNeural',
    name: 'Jenny',
    displayName: 'Jenny',
    tier: 'multilingual',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'emerald',
    description: 'Warm, polished, and clear. Good default for candidate-facing interviews.',
    samplePhrase: 'Hello, I will guide you through this interview one question at a time.',
    traits: ['warm', 'clear', 'balanced'],
    sortOrder: 1
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria',
    displayName: 'Aria',
    tier: 'standard',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'blue',
    description: 'Friendly and professional with a familiar Azure neural voice profile.',
    samplePhrase: 'Take your time, and use a specific example where possible.',
    traits: ['friendly', 'professional'],
    sortOrder: 2
  },
  {
    id: 'en-US-GuyNeural',
    name: 'Guy',
    displayName: 'Guy',
    tier: 'standard',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'slate',
    description: 'Direct and steady. Works well for structured technical interviews.',
    samplePhrase: 'I will ask each question clearly, and you can ask me to clarify.',
    traits: ['steady', 'direct'],
    sortOrder: 3
  },
  {
    id: 'en-US-AndrewMultilingualNeural',
    name: 'Andrew',
    displayName: 'Andrew',
    tier: 'multilingual',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'cyan',
    description: 'Calm and conversational with flexible pronunciation.',
    samplePhrase: 'When you are ready, share the context, your actions, and the outcome.',
    traits: ['calm', 'conversational'],
    sortOrder: 4
  },
  {
    id: 'en-US-Ava:DragonHDLatestNeural',
    name: 'Ava',
    displayName: 'Ava HD',
    tier: 'hd',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'violet',
    description: 'Expressive HD voice for a more natural interviewer presence.',
    samplePhrase: 'Thanks for joining. I will keep the interview focused and conversational.',
    traits: ['expressive', 'natural'],
    sortOrder: 5
  },
  {
    id: 'en-US-Andrew:DragonHDLatestNeural',
    name: 'Andrew',
    displayName: 'Andrew HD',
    tier: 'hd',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'indigo',
    description: 'Deep, composed HD voice with strong clarity for longer sessions.',
    samplePhrase: 'Let us move through the questions carefully and keep the timing clear.',
    traits: ['composed', 'clear'],
    sortOrder: 6
  },
  {
    id: 'en-US-Emma:DragonHDLatestNeural',
    name: 'Emma',
    displayName: 'Emma HD',
    tier: 'hd',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'rose',
    description: 'Bright HD voice with smoother phrasing for candidate guidance.',
    samplePhrase: 'You can ask for clarification before you answer any question.',
    traits: ['bright', 'smooth'],
    sortOrder: 7
  },
  {
    id: 'en-us-Jasper:MAI-Voice-1',
    name: 'Jasper',
    displayName: 'Jasper MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'cyan',
    description: 'Premium preview voice with expressive general conversation and sales energy.',
    samplePhrase: 'I will keep this conversation natural while staying on the interview questions.',
    traits: ['expressive', 'conversational'],
    sortOrder: 8
  },
  {
    id: 'en-us-June:MAI-Voice-1',
    name: 'June',
    displayName: 'June MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'amber',
    description: 'Premium preview voice for polished professional conversation.',
    samplePhrase: 'I will listen for concrete examples and keep the interview moving.',
    traits: ['premium', 'professional'],
    sortOrder: 9
  },
  {
    id: 'en-us-Grant:MAI-Voice-1',
    name: 'Grant',
    displayName: 'Grant MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'orange',
    description: 'Premium preview voice with a grounded interview style.',
    samplePhrase: 'Please answer naturally. I will help keep the structure clear.',
    traits: ['grounded', 'premium'],
    sortOrder: 10
  },
  {
    id: 'en-us-Iris:MAI-Voice-1',
    name: 'Iris',
    displayName: 'Iris MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'purple',
    description: 'Premium preview voice with a narrative, high-fidelity tone.',
    samplePhrase: 'Let us begin with the first question when you are ready.',
    traits: ['narrative', 'high fidelity'],
    sortOrder: 11
  },
  {
    id: 'en-us-Reed:MAI-Voice-1',
    name: 'Reed',
    displayName: 'Reed MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'male',
    avatarTone: 'slate',
    description: 'Premium preview voice for calm general conversation.',
    samplePhrase: 'We will move through each stage clearly and keep your answer focused.',
    traits: ['calm', 'general conversation'],
    sortOrder: 12
  },
  {
    id: 'en-us-Joy:MAI-Voice-1',
    name: 'Joy',
    displayName: 'Joy MAI',
    tier: 'mai_premium',
    language: DEFAULT_LANGUAGE,
    gender: 'female',
    avatarTone: 'rose',
    description: 'Premium preview voice with a warmer conversational feel.',
    samplePhrase: 'Please take a breath, then walk me through your example.',
    traits: ['warm', 'conversational'],
    sortOrder: 13
  }
];

function normalizeVoiceId(value) {
  return String(value || '').trim();
}

function getVoiceTier(tierId) {
  return VOICE_TIERS[tierId] || VOICE_TIERS.multilingual;
}

function decorateVoiceOption(option) {
  const tier = getVoiceTier(option.tier);
  return {
    ...option,
    provider: 'azure-speech',
    tierLabel: tier.label,
    tierDescription: tier.description,
    surchargeCredits: tier.surchargeCredits,
    usdPerMillionCharacters: tier.usdPerMillionCharacters
  };
}

function getAIInterviewVoiceOptions() {
  return [...AI_INTERVIEW_VOICE_OPTIONS]
    .sort((a, b) => {
      const tierDelta = getVoiceTier(a.tier).sortOrder - getVoiceTier(b.tier).sortOrder;
      return tierDelta || a.sortOrder - b.sortOrder;
    })
    .map(decorateVoiceOption);
}

function findAIInterviewVoiceOption(voiceId) {
  const normalized = normalizeVoiceId(voiceId);
  const option = AI_INTERVIEW_VOICE_OPTIONS.find((item) => item.id === normalized);
  return decorateVoiceOption(option || AI_INTERVIEW_VOICE_OPTIONS.find((item) => item.isDefault) || AI_INTERVIEW_VOICE_OPTIONS[0]);
}

function getDefaultAIInterviewVoiceOption() {
  return findAIInterviewVoiceOption();
}

function estimateSpokenCharacters(questionCount, totalMinutes) {
  const questions = Math.max(1, Number(questionCount) || 1);
  const minutes = Math.max(1, Number(totalMinutes) || 30);
  const questionIntroCharacters = questions * 900;
  const clarificationAndAckBuffer = Math.max(1200, minutes * 120);
  return Math.min(30000, Math.round(questionIntroCharacters + clarificationAndAckBuffer));
}

function estimateAIInterviewCredits({
  candidateCount = 0,
  questionCount = 1,
  totalMinutes = 30,
  voiceId
} = {}) {
  const voice = findAIInterviewVoiceOption(voiceId);
  const candidates = Math.max(0, Math.ceil(Number(candidateCount) || 0));
  const minutes = Math.max(1, Math.ceil(Number(totalMinutes) || 30));
  const estimatedSpeechCharacters = estimateSpokenCharacters(questionCount, minutes);
  const estimatedSpeechUsd = (estimatedSpeechCharacters / 1000000) * Number(voice.usdPerMillionCharacters || 0);
  const estimatedSttUsd = (minutes / 60) * AZURE_SPEECH_STT_USD_PER_HOUR;
  const estimatedLlmAndPlatformUsd = AI_INTERVIEW_LLM_AND_PLATFORM_USD_PER_CANDIDATE;
  const estimatedBackendCostUsdPerCandidate = estimatedSttUsd + estimatedSpeechUsd + estimatedLlmAndPlatformUsd;
  const targetProfitUsdPerCandidate = AI_INTERVIEW_TARGET_PROFIT_USD_PER_CANDIDATE;
  const billableUsdPerCandidateBeforePremium = estimatedBackendCostUsdPerCandidate + targetProfitUsdPerCandidate;
  const baseCreditsPerCandidate = Math.max(1, Math.ceil(billableUsdPerCandidateBeforePremium / AI_INTERVIEW_USD_PER_CREDIT));
  const voiceSurchargeCredits = Math.max(0, Math.ceil(Number(voice.surchargeCredits) || 0));
  const durationSurchargeCredits = 0;
  const creditCostPerCandidate = baseCreditsPerCandidate + voiceSurchargeCredits;
  const voiceSurchargeUsdPerCandidate = voiceSurchargeCredits * AI_INTERVIEW_USD_PER_CREDIT;
  const billableUsdPerCandidate = billableUsdPerCandidateBeforePremium + voiceSurchargeUsdPerCandidate;
  const estimatedBackendCostUsd = estimatedBackendCostUsdPerCandidate * candidates;
  const targetProfitUsd = targetProfitUsdPerCandidate * candidates;
  const voiceSurchargeUsd = voiceSurchargeUsdPerCandidate * candidates;
  const billableUsdBeforeRounding = billableUsdPerCandidate * candidates;
  const roundedBillableUsd = creditCostPerCandidate * candidates * AI_INTERVIEW_USD_PER_CREDIT;

  return {
    baseCreditsPerCandidate,
    voiceSurchargeCredits,
    durationSurchargeCredits,
    creditCostPerCandidate,
    candidateCount: candidates,
    totalCredits: creditCostPerCandidate * candidates,
    estimatedSpeechCharacters,
    estimatedSpeechUsd,
    estimatedSttUsd,
    estimatedLlmAndPlatformUsd,
    estimatedBackendCostUsdPerCandidate,
    targetProfitUsdPerCandidate,
    voiceSurchargeUsdPerCandidate,
    billableUsdPerCandidate,
    estimatedBackendCostUsd,
    targetProfitUsd,
    voiceSurchargeUsd,
    billableUsdBeforeRounding,
    roundedBillableUsd,
    platformUsdPerCredit: AI_INTERVIEW_USD_PER_CREDIT,
    voice
  };
}

module.exports = {
  VOICE_TIERS,
  AI_INTERVIEW_VOICE_OPTIONS,
  AI_INTERVIEW_USD_PER_CREDIT,
  AI_INTERVIEW_TARGET_PROFIT_USD_PER_CANDIDATE,
  AZURE_SPEECH_STT_USD_PER_HOUR,
  AI_INTERVIEW_LLM_AND_PLATFORM_USD_PER_CANDIDATE,
  getAIInterviewVoiceOptions,
  findAIInterviewVoiceOption,
  getDefaultAIInterviewVoiceOption,
  estimateAIInterviewCredits,
  estimateSpokenCharacters
};
