/**
 * Credit economics — ties "credits" to modeled Azure AI COGS + target margin.
 *
 * ## Pricing basis (update from your Azure invoice)
 * - **Llama 3.3 70B Instruct**: use **$0.50 / 1M input** and **$0.50 / 1M output** tokens
 *   (your cited rate; regional/commitment pricing may differ).
 * - **text-embedding-3-large** (Azure OpenAI): **~$0.13 / 1M input** tokens (unchanged).
 * - **AI interview voice**: product-priced from the 30-minute voice interview benchmark
 *   rather than derived from LLM tokens only. The baseline covers Azure Speech STT,
 *   Azure Speech TTS, question generation allocation, interview harness calls, scoring,
 *   and a small infrastructure buffer.
 *
 * Vector DB hosting is excluded from per-credit COGS.
 *
 * ## Method
 * 1. Estimate **input/output/embedding tokens** per user-facing action (P50–P75 load).
 * 2. **COGS_USD** = Llama cost + embedding cost.
 * 3. **Target gross margin** on modeled AI COGS: **100%** ⇒ billable = **COGS × 2** (you pay 2× model cost in "credit value").
 * 4. **CREDIT_VALUE_PEG_USD** — USD per abstract credit unit for rounding to integers.
 * 5. **credits** = max(1, ceil((COGS × 2) / CREDIT_VALUE_PEG_USD)).
 *
 * **aiMatching** = one enrichment batch (10 candidates) = one batched LLM call in `gptAnalysisService`.
 *
 * ## Subscription ladder ($99 → $4,999 / month)
 * Monthly included credits scale super-linearly with list price (higher tiers = better $/credit).
 * Tune `RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE` against your target margin after measuring real usage.
 */

/** @type {{ usdPerMillionInput: number; usdPerMillionOutput: number }} */
const AZURE_LLAMA_3_3_70B_INSTRUCT = {
  usdPerMillionInput: 0.5,
  usdPerMillionOutput: 0.5,
};

/** text-embedding-3-large (order-of-magnitude; confirm on your embedding deployment) */
const AZURE_TEXT_EMBEDDING_3_LARGE = {
  usdPerMillionInput: 0.13,
};

/** Revenue multiple on modeled COGS (100% margin ⇒ 2×) */
const TARGET_GROSS_MARGIN_ON_MODELED_COGS = 1.0;

/**
 * USD per abstract credit (rounding). Chosen so aiMatching batch ≈ 11 credits at $0.50/M Llama.
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
 * @type {Record<string, { llmIn: number; llmOut: number; embedIn: number; fixedCredits?: number; note?: string }>}
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
  /** Sized so modeled COGS × 2 yields ≥ 2 credits at current peg ($0.50/M Llama) */
  scheduleInterview: {
    llmIn: 2500,
    llmOut: 1000,
    embedIn: 0,
    note: 'scheduling / comms copy',
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
  aiInterviewCandidate: {
    llmIn: 5000,
    llmOut: 3000,
    embedIn: 0,
    fixedCredits: 12,
    note: 'per candidate 30-minute async voice AI interview: STT + TTS + LLM question generation allocation + interview harness + scoring',
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
    if (Number.isFinite(est.fixedCredits)) {
      out[action] = est.fixedCredits;
      continue;
    }
    const cogs = llamaCostUsd(est.llmIn, est.llmOut) + embedCostUsd(est.embedIn);
    out[action] = creditsFromModeledCogs(cogs);
  }
  return out;
}

// Integer credits — must match deriveCreditCostsFromModel() at current rates + peg.
const RECOMMENDED_CREDIT_COSTS = {
  createJob: 4,
  uploadCandidate: 7,
  scheduleInterview: 2,
  aiMatching: 11,
  generateQuestions: 6,
  aiAnalysis: 12,
  aiInterviewCandidate: 12,
  bulkUpload: 5,
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
 * Monthly credits included per plan code.
 * Ladder: Free → $99 → $499 → $999 → $2,499 → $4,999 / month (USD list).
 */
const RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE = {
  free: 60,
  basic: 360,
  pro: 2000,
  business: 4400,
  premium: 11500,
  enterprise: 24000,
};

const RECOMMENDED_PLAN_LIST_PRICES_USD = {
  free: 0,
  basic: 99,
  pro: 499,
  business: 999,
  premium: 2499,
  enterprise: 4999,
};

/**
 * Extra credit packs — top-ups (list $ scales with lower $/token COGS vs older $0.71/M assumption).
 */
const RECOMMENDED_CREDIT_PACKS = [
  {
    name: 'Starter Pack',
    code: 'starter-100',
    credits: 100,
    bonusCredits: 0,
    price: 36,
    currency: 'USD',
    description: 'Top-up credits for occasional AI usage',
    displayOrder: 1,
    isPopular: false,
    features: [
      '100 credits',
      '~9 AI enrichment batches (10 candidates each) at current rates',
      'Mix with uploads, jobs, and interview AI as needed',
    ],
  },
  {
    name: 'Professional Pack',
    code: 'pro-250',
    credits: 250,
    bonusCredits: 30,
    price: 85,
    currency: 'USD',
    description: 'Most popular — growing teams',
    displayOrder: 2,
    isPopular: true,
    features: [
      '250 credits + 30 bonus (280 total)',
      '~25 enrichment batches at current rates',
      'Bonus improves effective $/credit',
    ],
  },
  {
    name: 'Business Pack',
    code: 'business-500',
    credits: 500,
    bonusCredits: 90,
    price: 165,
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
    price: 299,
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
    price: 649,
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
 * Legacy plan codes → canonical economics key (does not rename plans in DB).
 */
const LEGACY_PLAN_CODE_ECONOMICS_MAP = {
  gold: 'pro',
  gld: 'pro',
  diamond: 'enterprise',
  dmd: 'enterprise',
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
