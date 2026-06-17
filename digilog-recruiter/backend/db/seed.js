// Idempotent PostgreSQL reference-data seeders (create-if-missing — never
// destructive, never overwrites existing rows). Mirrors the legacy Mongo seed
// scripts but writes to Postgres via Prisma. Run by db/bootstrap.js on startup.
const bcrypt = require('bcryptjs');
const prisma = require('./client');
const {
  RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE,
  RECOMMENDED_CREDIT_COSTS,
  RECOMMENDED_PLAN_LIST_PRICES_USD,
  RECOMMENDED_CREDIT_PACKS,
} = require('../config/creditEconomics');

const SYSTEM_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', locale: 'en-NG' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', locale: 'en-KE' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', locale: 'en-GH' },
  { code: 'EGP', symbol: '£', name: 'Egyptian Pound', locale: 'ar-EG' },
  { code: 'MAD', symbol: 'د.م.', name: 'Moroccan Dirham', locale: 'ar-MA' },
  { code: 'TND', symbol: 'د.ت', name: 'Tunisian Dinar', locale: 'ar-TN' },
  { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr', locale: 'am-ET' },
  { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', locale: 'en-UG' },
  { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', locale: 'sw-TZ' },
  { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc', locale: 'fr-SN' },
  { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc', locale: 'fr-CM' },
  { code: 'BWP', symbol: 'P', name: 'Botswana Pula', locale: 'en-BW' },
  { code: 'ZMW', symbol: 'K', name: 'Zambian Kwacha', locale: 'en-ZM' },
  { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha', locale: 'en-MW' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', locale: 'pt-BR' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', locale: 'zh-HK' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', locale: 'es-MX' },
];

const planCredits = (code) => ({
  totalCredits: RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[code] ?? 80,
  creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
  rolloverEnabled: false,
  rolloverPercentage: 0,
});

const DEFAULT_PLANS = [
  { name: 'Free', code: 'free', features: [{ name: 'Basic Candidate Management' }, { name: 'Limited Job Postings (5)' }, { name: 'Up to 3 Team Members' }], limits: { memberLimit: 3, storageLimit: 100, apiCallsLimit: 100 }, displayOrder: 1 },
  { name: 'Starter', code: 'basic', features: [{ name: 'Enhanced Candidate Management' }, { name: 'Up to 15 Job Postings' }, { name: 'AI-powered CV Parsing' }, { name: 'Up to 10 Team Members' }], limits: { memberLimit: 10, storageLimit: 1024, apiCallsLimit: 500 }, displayOrder: 2 },
  { name: 'Professional', code: 'pro', features: [{ name: 'AI Candidate Matching' }, { name: 'Up to 50 Job Postings' }, { name: 'Up to 25 Team Members' }, { name: 'Custom Pipelines' }], limits: { memberLimit: 25, storageLimit: 5120, apiCallsLimit: 2000 }, displayOrder: 3 },
  { name: 'Business', code: 'business', features: [{ name: 'Everything in Professional' }, { name: 'Higher monthly AI credits' }, { name: 'Priority email support' }], limits: { memberLimit: 50, storageLimit: 20480, apiCallsLimit: 10000 }, displayOrder: 4 },
  { name: 'Premium', code: 'premium', features: [{ name: 'Everything in Business' }, { name: 'Large monthly AI credit pool' }, { name: 'Advanced analytics' }], limits: { memberLimit: 150, storageLimit: 102400, apiCallsLimit: 50000 }, displayOrder: 5 },
  { name: 'Enterprise', code: 'enterprise', features: [{ name: 'Unlimited Candidates' }, { name: 'Unlimited Job Postings' }, { name: 'Unlimited Team Members' }, { name: 'API Access' }, { name: 'Dedicated Account Manager' }], limits: { memberLimit: 'unlimited', storageLimit: 'unlimited', apiCallsLimit: 'unlimited' }, displayOrder: 6 },
];

const SUPER_ADMIN_PERMISSIONS = {
  manageUsers: true, manageOrganizations: true, manageLicenses: true,
  manageBilling: true, viewAnalytics: true, systemSettings: true,
};

async function seedCurrencies() {
  // Only seed a genuinely fresh deploy; never inject into a provisioned/migrated DB.
  const existing = await prisma.currency.count();
  if (existing > 0) return { skipped: true, existing };
  let created = 0;
  for (const c of SYSTEM_CURRENCIES) {
    const existing = await prisma.currency.findFirst({ where: { code: c.code, isSystem: true, organizationId: null } });
    if (existing) continue;
    await prisma.currency.create({ data: { ...c, isSystem: true, organizationId: null, createdById: null } });
    created++;
  }
  return { created, total: SYSTEM_CURRENCIES.length };
}

async function seedPlans() {
  const existing = await prisma.plan.count();
  if (existing > 0) return { skipped: true, existing };
  let created = 0;
  for (const p of DEFAULT_PLANS) {
    const existing = await prisma.plan.findFirst({ where: { code: p.code } });
    if (existing) continue;
    await prisma.plan.create({
      data: {
        name: p.name, code: p.code, price: RECOMMENDED_PLAN_LIST_PRICES_USD[p.code] ?? 0,
        billingCycle: 'monthly', credits: planCredits(p.code), features: p.features,
        limits: p.limits, displayOrder: p.displayOrder, isDefault: true, isPublished: true,
        planType: 'organization',
      },
    });
    created++;
  }
  return { created, total: DEFAULT_PLANS.length };
}

async function seedCreditPacks() {
  const existing = await prisma.creditPack.count();
  if (existing > 0) return { skipped: true, existing };
  let created = 0;
  for (const p of RECOMMENDED_CREDIT_PACKS) {
    const existing = await prisma.creditPack.findFirst({ where: { code: p.code } });
    if (existing) continue;
    await prisma.creditPack.create({
      data: {
        name: p.name, code: p.code, credits: p.credits, bonusCredits: p.bonusCredits || 0,
        totalCredits: (p.credits || 0) + (p.bonusCredits || 0), price: p.price,
        currency: p.currency || 'USD', description: p.description || '', displayOrder: p.displayOrder,
        isActive: true, isPopular: !!p.isPopular, features: p.features || [],
      },
    });
    created++;
  }
  return { created, total: RECOMMENDED_CREDIT_PACKS.length };
}

async function seedSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || 'michael.egbo@aiinnigeria.com').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || 'SmartHR@Admin2024';
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) return { created: 0, email };
  const hash = await bcrypt.hash(password, 10);
  await prisma.admin.create({
    data: { email, password: hash, name, role: 'super_admin', permissions: SUPER_ADMIN_PERMISSIONS, authSource: 'local', isActive: true },
  });
  return { created: 1, email };
}

// Postgres port of services/nylasAccountBootstrap.js. Unlike the one-time seeds
// above, this is an ENSURE that runs every boot (keyed by clientId): it
// reactivates or creates the env-derived default calendar account so "set the
// NYLAS_* env vars + restart" is all that's needed. Never destructive.
async function ensureDefaultNylasAccount() {
  const clientId = process.env.NYLAS_CLIENT_ID;
  const apiKey = process.env.NYLAS_API_KEY;
  const clientSecret = process.env.NYLAS_CLIENT_SECRET;
  if (!clientId || !apiKey || !clientSecret) {
    return { skipped: true, reason: 'NYLAS_CLIENT_ID/API_KEY/CLIENT_SECRET not set' };
  }

  const rawRegion = (process.env.NYLAS_REGION || 'us').toLowerCase();
  const region = ['us', 'eu', 'au'].includes(rawRegion) ? rawRegion : 'us';
  const apiUri = process.env.NYLAS_API_URI || `https://api.${region}.nylas.com`;
  const parsedMax = parseInt(process.env.NYLAS_MAX_GRANTS, 10);
  const maxGrants = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 5;

  const existing = await prisma.nylasAccount.findFirst({ where: { clientId } });
  if (existing) {
    const updates = {};
    if (!existing.active) updates.active = true;
    if (!existing.verified) updates.verified = true;
    if (!existing.maxGrants || existing.maxGrants < 1) updates.maxGrants = maxGrants;
    if (Object.keys(updates).length > 0) {
      await prisma.nylasAccount.update({ where: { id: existing.id }, data: updates });
      return { reactivated: existing.id, updated: Object.keys(updates) };
    }
    return { ensured: existing.id };
  }

  const created = await prisma.nylasAccount.create({
    data: {
      name: 'Default Account (from env)', clientId, apiKey, clientSecret, region, apiUri,
      maxGrants, accountType: 'production', priority: 100, active: true, verified: true,
      isDefault: true, notes: 'Auto-created from environment variables on startup',
    },
  });
  return { created: created.id, region, maxGrants };
}

module.exports = {
  seedCurrencies, seedPlans, seedCreditPacks, seedSuperAdmin, ensureDefaultNylasAccount,
  SYSTEM_CURRENCIES, DEFAULT_PLANS,
};
