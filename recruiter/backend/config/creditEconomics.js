/**
 * Credit economics (2026) — ties abstract "credits" to Azure model COGS heuristics.
 *
 * Research (verify on your Azure invoice; rates vary by region/commitment):
 * - Llama 3.3 70B Instruct (Azure AI / Foundry): ~$0.71 / 1M input + ~$0.71 / 1M output tokens (typical PAYG).
 * - text-embedding-3-large: ~$0.13–0.143 / 1M input tokens (embeddings are cheap vs chat).
 *
 * Heuristic USD per user-facing action (rough order-of-magnitude for budgeting):
 * - aiMatching (full analysis, top ≤100 + batch LLM): high token count → highest cost.
 * - aiAnalysis (interview transcript): long input → high.
 * - generateQuestions: medium.
 * - createJob / uploadCandidate (CV JD parsing): medium.
 * - bulkUpload: medium per batch.
 * - scheduleInterview: mostly app logic → low.
 * - reEmbed: embeddings only → very low (still ≥1 credit so metering works).
 *
 * We express costs as integer credits using a single scale where the heaviest ops
 * (aiMatching) set the top of the range. Adjust RECOMMENDED_CREDIT_COSTS together
 * with monthly allowances and pack pricing — do not change one in isolation.
 */

/** @type {Record<string, number>} */
const RECOMMENDED_CREDIT_COSTS = {
  createJob: 6,
  uploadCandidate: 4,
  scheduleInterview: 2,
  aiMatching: 14,
  generateQuestions: 7,
  aiAnalysis: 12,
  bulkUpload: 3,
  reEmbed: 1,
};

/**
 * Monthly credits included per subscription plan code (organization plans).
 * Chosen so higher tiers scale super-linearly vs price (enterprise value).
 */
const RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE = {
  /** ~8–9 full AI match runs at 14 credits each; tune for marketing */
  free: 120,
  basic: 380,
  pro: 880,
  enterprise: 3200,
};

/**
 * Suggested list prices (USD / month) — marketing; stored on Plan.price
 */
const RECOMMENDED_PLAN_LIST_PRICES_USD = {
  free: 0,
  basic: 49,
  pro: 99,
  enterprise: 299,
};

/**
 * Extra credit packs — total credits (incl. bonus) and list price.
 * Price/credit improves with volume (typical SaaS ladder).
 */
const RECOMMENDED_CREDIT_PACKS = [
  {
    name: 'Starter Pack',
    code: 'starter-100',
    credits: 100,
    bonusCredits: 0,
    price: 42,
    currency: 'USD',
    description: 'Top-up credits for occasional AI usage',
    displayOrder: 1,
    isPopular: false,
    features: [
      '100 credits',
      '~7 AI match runs (full analysis) or mix of other actions',
      'Best for topping up occasionally',
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
      '~20 AI match runs at current rates',
      '10%+ bonus vs Starter',
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

module.exports = {
  RECOMMENDED_CREDIT_COSTS,
  RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE,
  RECOMMENDED_PLAN_LIST_PRICES_USD,
  RECOMMENDED_CREDIT_PACKS,
};
