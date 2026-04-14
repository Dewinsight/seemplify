/**
 * Credit economics — ties "credits" to modeled Azure AI COGS + target margin.
 *
 * ## Online research (verify against your Azure invoice; PAYG varies by region/commitment)
 * - **Llama 3.3 70B Instruct** on Azure AI / Foundry: commonly cited **~$0.71 / 1M input**
 *   and **~$0.71 / 1M output** tokens (e.g. third-party aggregators and calculators aligned
 *   with Azure AI; Microsoft lists model-specific pricing on Foundry pricing pages).
 * - **text-embedding-3-large** (Azure OpenAI): **~$0.13 / 1M input** tokens (order-of-magnitude;
 *   exact tier depends on product SKU).
 *
 * Vector DB / Weaviate hosting is excluded from per-credit COGS here (as requested).
 *
 * ## Method
 * 1. Estimate **input/output/embedding tokens** per user-facing action (P50–P75 load;
 *    worst cases like huge CVs may exceed this — that is intentional buffer in estimates).
 * 2. **COGS_USD** = Llama cost + embedding cost for that operation.
 * 3. **Target gross margin** on modeled AI COGS: **100%** ⇒ billable value = **COGS × 2**.
 * 4. Choose a **credit peg** (USD per credit) so integer credits are readable and the
 *    heaviest operation (AI matching **per batch of 10** candidates, one LLM call) lands
 *    in a sensible range.
 * 5. **credits** = max(1, ceil((COGS × 2) / CREDIT_VALUE_PEG_USD)).
 *
 * **aiMatching** is charged **per enrichment batch** (10 candidates) in addition to any
 * separate matching endpoint usage — aligns with one batched LLM JSON call in `gptAnalysisService`.
 */

/** @type {{ usdPerMillionInput: number; usdPerMillionOutput: number }} */
const AZURE_LLAMA_3_3_70B_INSTRUCT = {
  usdPerMillionInput: 0.71,
  usdPerMillionOutput: 0.71,
};

/** text-embedding-3-large (order-of-magnitude; confirm on your embedding deployment) */
const AZURE_TEXT_EMBEDDING_3_LARGE = {
  usdPerMillionInput: 0.13,
};

/** Revenue multiple on modeled COGS (100% margin ⇒ 2×) */
const TARGET_GROSS_MARGIN_ON_MODELED_COGS = 1.0;

/**
 * USD represented by one credit for pricing math (derived from anchor operation below).
 * Chosen so batch AI matching ≈ 16 credits after rounding.
 */
const CREDIT_VALUE_PEG_USD = 0.00175;

function llamaCostUsd(inputTokens, outputTokens) {
  const inCost = (inputTokens / 1e6) * AZURE_LLAMA_3_3_70B_INSTRUCT.usdPerMillionInput;
  const outCost = (outputTokens / 1e6) * AZURE_LLAMA_3_3_70B_INSTRUCT.usdPerMillionOutput;
  return inCost + outCost;
}

function embedCostUsd(inputTokens) {
  return (inputTokens / 1e6) * AZURE_TEXT_EMBEDDING_3_LARGE.usdPerMillionInput;
}

function creditsFromModeledCogs(cogsUsd) {
  const billable = cogsUsd * (1 + TARGET_GROSS_MARGIN_ON_MODELED_COGS);
  return Math.max(1, Math.ceil(billable / CREDIT_VALUE_PEG_USD));
}

/**
 * Token assumptions (rough, documented). Tune from production `usage` logs when available.
 * @type {Record<string, { llmIn: number; llmOut: number; embedIn: number; note?: string }>}
 */
const OPERATION_TOKEN_ASSUMPTIONS = {
  createJob: {
    llmIn: 3200,
    llmOut: 1200,
    embedIn: 6000,
    note: 'JD text + structured parse; embeddings for job text',
  },
  uploadCandidate: {
    llmIn: 7000,
    llmOut: 2200,
    embedIn: 10000,
    note: 'CV text extraction/summary; resume + sections embedded',
  },
  scheduleInterview: {
    llmIn: 900,
    llmOut: 350,
    embedIn: 0,
    note: 'light LLM copy / slot text if used',
  },
  /** One BullMQ enrichment batch = up to 10 candidates, one batched JSON completion */
  aiMatching: {
    llmIn: 14500,
    llmOut: 4000,
    embedIn: 0,
    note: 'batchAnalyzeCandidates — single call per 10 candidates',
  },
  generateQuestions: {
    llmIn: 6500,
    llmOut: 4000,
    embedIn: 0,
    note: 'interview question generation',
  },
  aiAnalysis: {
    llmIn: 17000,
    llmOut: 3500,
    embedIn: 0,
    note: 'long transcript / multi-segment interview analysis',
  },
  bulkUpload: {
    llmIn: 4000,
    llmOut: 1200,
    embedIn: 8000,
    note: 'per bulk batch — CSV row normalization + chunk embed',
  },
  reEmbed: {
    llmIn: 0,
    llmOut: 0,
    embedIn: 20000,
    note: 're-embed only; no chat',
  },
};

function deriveCreditCostsFromModel() {
  const out = {};
  for (const [action, est] of Object.entries(OPERATION_TOKEN_ASSUMPTIONS)) {
    const cogs = llamaCostUsd(est.llmIn, est.llmOut) + embedCostUsd(est.embedIn);
    out[action] = creditsFromModeledCogs(cogs);
  }
  return out;
}

// Integer credits used by app + DB seeds (must stay in sync with deriveCreditCostsFromModel)
const RECOMMENDED_CREDIT_COSTS = {
  createJob: 5,
  uploadCandidate: 9,
  scheduleInterview: 2,
  aiMatching: 16,
  generateQuestions: 9,
  aiAnalysis: 17,
  bulkUpload: 6,
  reEmbed: 3,
};

(function assertDerivedMatchesStatic() {
  const derived = deriveCreditCostsFromModel();
  const keys = Object.keys(RECOMMENDED_CREDIT_COSTS);
  for (const k of keys) {
    if (derived[k] !== RECOMMENDED_CREDIT_COSTS[k]) {
      throw new Error(
        `creditEconomics: RECOMMENDED_CREDIT_COSTS.${k}=${RECOMMENDED_CREDIT_COSTS[k]} but model derives ${derived[k]} — update the static table or assumptions.`
      );
    }
  }
})();

/**
 * Monthly credits: scaled so tiers stay usable after aiMatching per-batch increase
 * (~26 batches on Basic at 16 credits ≈ same ballpark as old 380 @ 14).
 */
const RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE = {
  free: 130,
  basic: 430,
  pro: 1000,
  enterprise: 3600,
};

const RECOMMENDED_PLAN_LIST_PRICES_USD = {
  free: 0,
  basic: 49,
  pro: 99,
  enterprise: 299,
};

/**
 * Extra credit packs — list price ladder (marketing / self-serve).
 * $/credit improves with volume; verify against your target gross margin on blended AI usage.
 */
const RECOMMENDED_CREDIT_PACKS = [
  {
    name: 'Starter Pack',
    code: 'starter-100',
    credits: 100,
    bonusCredits: 0,
    price: 44,
    currency: 'USD',
    description: 'Top-up credits for occasional AI usage',
    displayOrder: 1,
    isPopular: false,
    features: [
      '100 credits',
      '~6 full AI enrichment batches (10 candidates each) at current rates',
      'Mix with uploads, jobs, and interview AI as needed',
    ],
  },
  {
    name: 'Professional Pack',
    code: 'pro-250',
    credits: 250,
    bonusCredits: 30,
    price: 99,
    currency: 'USD',
    description: 'Most popular — growing teams',
    displayOrder: 2,
    isPopular: true,
    features: [
      '250 credits + 30 bonus (280 total)',
      '~17 enrichment batches at current rates',
      'Bonus credits improve effective $/credit',
    ],
  },
  {
    name: 'Business Pack',
    code: 'business-500',
    credits: 500,
    bonusCredits: 90,
    price: 189,
    currency: 'USD',
    description: 'Volume discount for active hiring',
    displayOrder: 3,
    isPopular: false,
    features: [
      '500 credits + 90 bonus (590 total)',
      'Volume discount on $/credit',
      'For active hiring teams',
    ],
  },
  {
    name: 'Enterprise Pack',
    code: 'enterprise-1000',
    credits: 1000,
    bonusCredits: 250,
    price: 329,
    currency: 'USD',
    description: 'Best self-serve $/credit',
    displayOrder: 4,
    isPopular: false,
    features: [
      '1000 credits + 250 bonus (1250 total)',
      'Best $/credit in self-serve packs',
    ],
  },
  {
    name: 'Mega Pack',
    code: 'mega-2500',
    credits: 2500,
    bonusCredits: 750,
    price: 699,
    currency: 'USD',
    description: 'Maximum volume discount',
    displayOrder: 5,
    isPopular: false,
    features: [
      '2500 credits + 750 bonus (3250 total)',
      'Maximum volume discount',
    ],
  },
];

/**
 * Legacy plan `code` values sometimes used in older DBs (screenshots: GOLD, DIAMOND).
 * Values are canonical `RECOMMENDED_*` keys to copy economics from (does not rename plans).
 */
const LEGACY_PLAN_CODE_ECONOMICS_MAP = {
  gold: 'pro',
  diamond: 'enterprise',
  silver: 'basic',
  bronze: 'free',
};

module.exports = {
  AZURE_LLAMA_3_3_70B_INSTRUCT,
  AZURE_TEXT_EMBEDDING_3_LARGE,
  TARGET_GROSS_MARGIN_ON_MODELED_COGS,
  CREDIT_VALUE_PEG_USD,
  OPERATION_TOKEN_ASSUMPTIONS,
  RECOMMENDED_CREDIT_COSTS,
  RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE,
  RECOMMENDED_PLAN_LIST_PRICES_USD,
  RECOMMENDED_CREDIT_PACKS,
  LEGACY_PLAN_CODE_ECONOMICS_MAP,
  llamaCostUsd,
  embedCostUsd,
  creditsFromModeledCogs,
  deriveCreditCostsFromModel,
};
