const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DEFAULT_PIVOT_CURRENCIES = ['USD', 'EUR', 'GBP'];

/**
 * ExchangeRate Model
 * Stores currency exchange rates for multi-currency payroll
 */
const ExchangeRateSchema = new Schema({
    organizationId: {
        type: String,
        required: true,
        index: true
    },

    baseCurrency: {
        type: String,
        required: true,
        uppercase: true,
        maxlength: 3
    },

    targetCurrency: {
        type: String,
        required: true,
        uppercase: true,
        maxlength: 3
    },

    rate: {
        type: Number,
        required: true,
        validate: {
            validator: (value) => Number.isFinite(value) && value > 0,
            message: 'Exchange rate must be a finite number greater than zero'
        }
    },

    effectiveDate: {
        type: Date,
        required: true,
        default: Date.now
    },

    expiresAt: {
        type: Date
    },

    source: {
        type: String,
        enum: ['manual', 'api', 'import'],
        default: 'manual'
    },

    isActive: {
        type: Boolean,
        default: true
    },

    notes: String,

    createdBy: String,
    createdByName: String
}, {
    timestamps: true,
    // Startup performs a guarded migration before installing this model's
    // exact-instant unique index. Automatic index creation would race that
    // migration on legacy databases.
    autoIndex: false
});

// A currency pair may have only one immutable value for an exact effective
// instant. `source` is provenance, not a separate rate timeline. Keeping it
// out of this key prevents manual, API, and import writers from publishing
// ambiguous values concurrently for the same instant.
ExchangeRateSchema.index(
    { organizationId: 1, baseCurrency: 1, targetCurrency: 1, effectiveDate: 1 },
    { unique: true, name: 'exchange_rate_pair_effective_instant_unique' }
);
// Compound index for as-of lookups.
ExchangeRateSchema.index({ organizationId: 1, baseCurrency: 1, targetCurrency: 1, effectiveDate: -1 });

function getActiveDateQuery(date) {
    return {
        effectiveDate: { $lte: date },
        isActive: true,
        $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gte: date } }
        ]
    };
}

async function findPreferredRate(model, organizationId, baseCurrency, targetCurrency, date) {
    const query = {
        organizationId,
        baseCurrency: baseCurrency.toUpperCase(),
        targetCurrency: targetCurrency.toUpperCase(),
        ...getActiveDateQuery(date)
    };

    // Manual overrides are represented by their effective window. Selecting
    // strictly by the latest instant keeps reads deterministic even while two
    // writers are completing post-insert window reconciliation.
    return model.findOne(query).sort({ effectiveDate: -1 });
}

/**
 * Get current exchange rate
 */
ExchangeRateSchema.statics.getCurrentRate = async function (organizationId, baseCurrency, targetCurrency, date = new Date(), options = {}) {
    const normalizedBase = String(baseCurrency || '').trim().toUpperCase();
    const normalizedTarget = String(targetCurrency || '').trim().toUpperCase();

    // Same currency = rate is 1
    if (normalizedBase === normalizedTarget) {
        return { rate: 1, direct: true, exchangeRateId: null, rateLegs: [] };
    }

    // Try direct rate
    let rate = await findPreferredRate(
        this,
        organizationId,
        normalizedBase,
        normalizedTarget,
        date
    );

    if (rate) {
        return {
            rate: rate.rate,
            direct: true,
            source: rate.source,
            effectiveDate: rate.effectiveDate,
            exchangeRateId: String(rate._id),
            rateLegs: [{ exchangeRateId: String(rate._id), direction: 'direct' }]
        };
    }

    // Try inverse rate
    rate = await findPreferredRate(
        this,
        organizationId,
        normalizedTarget,
        normalizedBase,
        date
    );

    if (rate) {
        return {
            rate: 1 / rate.rate,
            direct: false,
            inverse: true,
            source: rate.source,
            effectiveDate: rate.effectiveDate,
            exchangeRateId: String(rate._id),
            rateLegs: [{ exchangeRateId: String(rate._id), direction: 'inverse' }]
        };
    }

    if (options.allowPivot === false) {
        return null;
    }

    const dynamicPivots = await this.distinct('baseCurrency', {
        organizationId,
        ...getActiveDateQuery(date)
    });

    const pivotCurrencies = Array.from(new Set([
        ...(options.pivotCurrencies || []),
        ...DEFAULT_PIVOT_CURRENCIES,
        ...dynamicPivots
    ]))
        .map((currency) => String(currency || '').trim().toUpperCase())
        .filter((currency) => currency && currency !== normalizedBase && currency !== normalizedTarget);

    for (const pivotCurrency of pivotCurrencies) {
        const baseToPivot = await this.getCurrentRate(
            organizationId,
            normalizedBase,
            pivotCurrency,
            date,
            { allowPivot: false }
        );
        if (!baseToPivot) {
            continue;
        }

        const pivotToTarget = await this.getCurrentRate(
            organizationId,
            pivotCurrency,
            normalizedTarget,
            date,
            { allowPivot: false }
        );
        if (!pivotToTarget) {
            continue;
        }

        const effectiveDates = [
            baseToPivot.effectiveDate,
            pivotToTarget.effectiveDate
        ].filter(Boolean).map((value) => new Date(value).getTime());

        return {
            rate: baseToPivot.rate * pivotToTarget.rate,
            direct: false,
            via: pivotCurrency,
            source: [baseToPivot.source, pivotToTarget.source].filter(Boolean).join('+') || 'derived',
            effectiveDate: effectiveDates.length > 0 ? new Date(Math.min(...effectiveDates)) : undefined,
            exchangeRateId: null,
            rateLegs: [
                ...(baseToPivot.rateLegs || []),
                ...(pivotToTarget.rateLegs || [])
            ]
        };
    }

    return null;
};

/**
 * Convert amount between currencies
 */
ExchangeRateSchema.statics.convert = async function (organizationId, amount, fromCurrency, toCurrency, date = new Date()) {
    const rateInfo = await this.getCurrentRate(organizationId, fromCurrency, toCurrency, date);

    if (!rateInfo) {
        throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency}`);
    }

    return {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        convertedAmount: amount * rateInfo.rate,
        targetCurrency: toCurrency,
        rate: rateInfo.rate,
        ...rateInfo
    };
};

/**
 * Get all active rates for organization
 */
ExchangeRateSchema.statics.getActiveRates = async function (organizationId, baseCurrency = null) {
    const query = { organizationId, isActive: true };
    if (baseCurrency) {
        query.baseCurrency = baseCurrency.toUpperCase();
    }

    const rates = await this.find(query).sort({ effectiveDate: -1 });

    return rates.sort((a, b) => {
        const baseCompare = String(a.baseCurrency || '').localeCompare(String(b.baseCurrency || ''));
        if (baseCompare !== 0) return baseCompare;

        const targetCompare = String(a.targetCurrency || '').localeCompare(String(b.targetCurrency || ''));
        if (targetCompare !== 0) return targetCompare;

        const effectiveCompare = new Date(b.effectiveDate || 0).getTime()
            - new Date(a.effectiveDate || 0).getTime();
        if (effectiveCompare !== 0) return effectiveCompare;

        return String(a.source || '').localeCompare(String(b.source || ''));
    });
};

module.exports = mongoose.model('ExchangeRate', ExchangeRateSchema);
