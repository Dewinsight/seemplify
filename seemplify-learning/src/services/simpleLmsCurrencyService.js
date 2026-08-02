import { SimpleLmsCurrency } from '../models/SimpleLmsCurrency.js'

const DEFAULT_SIMPLE_LMS_CURRENCY = Object.freeze({
  code: 'NGN',
  name: 'Nigerian Naira',
  symbol: 'NGN',
  decimals: 2,
  isActive: true,
  isDefault: true,
  sortOrder: 1
})

const CURRENCY_CACHE_TTL_MS = 60 * 1000

let currencyCache = {
  loadedAt: 0,
  currencies: [DEFAULT_SIMPLE_LMS_CURRENCY],
  codes: [DEFAULT_SIMPLE_LMS_CURRENCY.code],
  defaultCurrencyCode: DEFAULT_SIMPLE_LMS_CURRENCY.code
}

const sanitizeCurrencyCode = (value) => {
  const normalized = String(value || '').trim().toUpperCase().slice(0, 3)
  return /^[A-Z]{3}$/.test(normalized) ? normalized : ''
}

const normalizeSimpleLmsCurrencyCode = (value, fallback = 'NGN', allowedCodes = [DEFAULT_SIMPLE_LMS_CURRENCY.code]) => {
  const normalizedAllowedCodes = Array.isArray(allowedCodes)
    ? allowedCodes.map((code) => sanitizeCurrencyCode(code)).filter(Boolean)
    : [DEFAULT_SIMPLE_LMS_CURRENCY.code]
  const safeAllowedCodes = normalizedAllowedCodes.length > 0
    ? normalizedAllowedCodes
    : [DEFAULT_SIMPLE_LMS_CURRENCY.code]

  const normalized = sanitizeCurrencyCode(value)
  if (normalized && safeAllowedCodes.includes(normalized)) return normalized

  const fallbackCode = sanitizeCurrencyCode(fallback)
  if (fallbackCode && safeAllowedCodes.includes(fallbackCode)) return fallbackCode

  return safeAllowedCodes[0] || DEFAULT_SIMPLE_LMS_CURRENCY.code
}

const parseMajorAmountToMinor = (value) => {
  const normalized = String(value || '').trim().replace(/,/g, '')
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.round(parsed * 100))
}

const formatMinorAmountForInput = (value) => {
  const minor = Number(value)
  const safeMinor = Number.isFinite(minor) ? Math.max(0, minor) : 0
  const major = safeMinor / 100
  if (Number.isInteger(major)) return String(major)
  return major.toFixed(2).replace(/\.?0+$/, '')
}

const ensureSimpleLmsCurrencySeed = async () => {
  await SimpleLmsCurrency.findOneAndUpdate(
    { code: DEFAULT_SIMPLE_LMS_CURRENCY.code },
    {
      $setOnInsert: DEFAULT_SIMPLE_LMS_CURRENCY
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  await SimpleLmsCurrency.updateOne(
    { code: DEFAULT_SIMPLE_LMS_CURRENCY.code },
    {
      $set: {
        name: DEFAULT_SIMPLE_LMS_CURRENCY.name,
        symbol: DEFAULT_SIMPLE_LMS_CURRENCY.symbol,
        decimals: DEFAULT_SIMPLE_LMS_CURRENCY.decimals,
        isActive: true,
        isDefault: true,
        sortOrder: DEFAULT_SIMPLE_LMS_CURRENCY.sortOrder
      }
    }
  )
}

const getSimpleLmsCurrencyCatalog = async ({ forceRefresh = false } = {}) => {
  const now = Date.now()
  if (!forceRefresh && now - currencyCache.loadedAt < CURRENCY_CACHE_TTL_MS) {
    return currencyCache
  }

  await ensureSimpleLmsCurrencySeed()

  const rows = await SimpleLmsCurrency.find({ isActive: true })
    .select('code name symbol decimals isDefault isActive sortOrder')
    .sort({ isDefault: -1, sortOrder: 1, code: 1 })
    .lean()

  const currencies = (rows || [])
    .map((row) => {
      const code = sanitizeCurrencyCode(row?.code)
      if (!code) return null
      return {
        code,
        name: String(row?.name || '').trim() || code,
        symbol: String(row?.symbol || '').trim(),
        decimals: Number.isFinite(Number(row?.decimals))
          ? Math.min(4, Math.max(0, Math.round(Number(row.decimals))))
          : 2,
        isActive: row?.isActive !== false,
        isDefault: Boolean(row?.isDefault),
        sortOrder: Number.isFinite(Number(row?.sortOrder)) ? Number(row.sortOrder) : 100
      }
    })
    .filter(Boolean)

  const normalizedCurrencies = currencies.length > 0
    ? currencies
    : [{ ...DEFAULT_SIMPLE_LMS_CURRENCY }]
  const codes = Array.from(new Set(normalizedCurrencies.map((currency) => currency.code)))
  const defaultCurrencyCode = normalizeSimpleLmsCurrencyCode(
    normalizedCurrencies.find((currency) => currency.isDefault)?.code || normalizedCurrencies[0]?.code || DEFAULT_SIMPLE_LMS_CURRENCY.code,
    DEFAULT_SIMPLE_LMS_CURRENCY.code,
    codes
  )

  currencyCache = {
    loadedAt: now,
    currencies: normalizedCurrencies,
    codes,
    defaultCurrencyCode
  }

  return currencyCache
}

export {
  DEFAULT_SIMPLE_LMS_CURRENCY,
  formatMinorAmountForInput,
  getSimpleLmsCurrencyCatalog,
  normalizeSimpleLmsCurrencyCode,
  parseMajorAmountToMinor
}
