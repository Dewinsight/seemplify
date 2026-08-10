const axios = require('axios');

const CurrencySyncSettings = require('../models/CurrencySyncSettings');
const ExchangeRate = require('../models/ExchangeRate');
const PayrollProfile = require('../models/PayrollProfile');
const currencyService = require('./CurrencyService');

const PROVIDER_CONFIG = {
  key: 'open_er_api',
  name: 'ExchangeRate-API Open',
  docsUrl: 'https://www.exchangerate-api.com/docs/free',
  homepageUrl: 'https://open.er-api.com/',
  latestUrl: 'https://open.er-api.com/v6/latest',
  updateCadence: 'daily',
  requiresApiKey: false,
};

function normalizeCurrencyCode(code) {
  return String(code || '').trim().toUpperCase();
}

class ExchangeRateSyncService {
  getProviderInfo() {
    return PROVIDER_CONFIG;
  }

  async getOrCreateSettings(organizationId, metadata = {}) {
    return CurrencySyncSettings.findOneAndUpdate(
      { organizationId },
      {
        $setOnInsert: {
          provider: PROVIDER_CONFIG.key,
          providerBaseCurrency: 'USD',
          autoSyncEnabled: true,
          preserveManualOverrides: true,
          autoSeedOnEmpty: true,
          createdBy: metadata.userId,
          createdByName: metadata.name,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );
  }

  async getSettings(organizationId, metadata = {}) {
    return this.getOrCreateSettings(organizationId, metadata);
  }

  async updateSettings(organizationId, updates = {}, metadata = {}) {
    const payload = {};

    if (updates.providerBaseCurrency) {
      payload.providerBaseCurrency = normalizeCurrencyCode(updates.providerBaseCurrency);
    }
    if (updates.autoSyncEnabled !== undefined) {
      payload.autoSyncEnabled = !!updates.autoSyncEnabled;
    }
    if (updates.preserveManualOverrides !== undefined) {
      payload.preserveManualOverrides = !!updates.preserveManualOverrides;
    }
    if (updates.autoSeedOnEmpty !== undefined) {
      payload.autoSeedOnEmpty = !!updates.autoSeedOnEmpty;
    }

    if (metadata.userId) {
      payload.updatedBy = metadata.userId;
      payload.updatedByName = metadata.name;
    }

    return CurrencySyncSettings.findOneAndUpdate(
      { organizationId },
      {
        $set: payload,
        $setOnInsert: {
          provider: PROVIDER_CONFIG.key,
          createdBy: metadata.userId,
          createdByName: metadata.name,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );
  }

  async fetchLatestRates(baseCurrency = 'USD') {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || 'USD';
    const response = await axios.get(
      `${PROVIDER_CONFIG.latestUrl}/${normalizedBaseCurrency}`,
      {
        timeout: 15000,
        headers: {
          Accept: 'application/json',
        },
      }
    );

    const payload = response.data || {};
    if (payload.result !== 'success' || !payload.rates || typeof payload.rates !== 'object') {
      throw new Error(payload['error-type'] || 'Provider returned an invalid response');
    }

    return {
      baseCurrency: normalizeCurrencyCode(payload.base_code || normalizedBaseCurrency),
      rates: payload.rates,
      result: payload.result,
      lastUpdateAt: payload.time_last_update_utc ? new Date(payload.time_last_update_utc) : null,
      nextUpdateAt: payload.time_next_update_utc ? new Date(payload.time_next_update_utc) : null,
      timeLastUpdateUtc: payload.time_last_update_utc || null,
      timeNextUpdateUtc: payload.time_next_update_utc || null,
      docsUrl: PROVIDER_CONFIG.docsUrl,
      provider: PROVIDER_CONFIG.key,
    };
  }

  async syncOrganizationRates(organizationId, options = {}) {
    const metadata = {
      userId: options.createdBy || options.userId,
      name: options.createdByName || options.name || 'System',
    };
    const now = new Date();
    const settings = await this.getOrCreateSettings(organizationId, metadata);
    const providerBaseCurrency = normalizeCurrencyCode(
      options.baseCurrency || settings.providerBaseCurrency || 'USD'
    ) || 'USD';
    const preserveManualOverrides = options.preserveManualOverrides !== undefined
      ? !!options.preserveManualOverrides
      : settings.preserveManualOverrides !== false;

    await CurrencySyncSettings.updateOne(
      { organizationId },
      {
        $set: {
          lastSyncStartedAt: now,
          lastSyncMessage: `Fetching latest ${providerBaseCurrency} rates from ${PROVIDER_CONFIG.name}`,
          updatedBy: metadata.userId,
          updatedByName: metadata.name,
        },
      }
    );

    try {
      const providerPayload = await this.fetchLatestRates(providerBaseCurrency);
      const supportedCurrencyCodes = new Set(currencyService.getSupportedCurrencyCodes());
      const allTargetCodes = Object.keys(providerPayload.rates || {})
        .map(normalizeCurrencyCode)
        .filter((code) => code && code !== providerPayload.baseCurrency && supportedCurrencyCodes.has(code));

      const manualOverrideTargets = preserveManualOverrides
        ? new Set(
          (await ExchangeRate.find({
            organizationId,
            baseCurrency: providerPayload.baseCurrency,
            targetCurrency: { $in: allTargetCodes },
            isActive: true,
            source: 'manual',
            effectiveDate: { $lte: now },
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: null },
              { expiresAt: { $gte: now } },
            ],
          }).select('targetCurrency -_id').lean()).map((rate) => rate.targetCurrency)
        )
        : new Set();

      const providerEffectiveDate = providerPayload.lastUpdateAt || now;
      let syncedCount = 0;
      let skippedCount = 0;

      for (const targetCurrency of allTargetCodes) {
        const rate = Number(providerPayload.rates[targetCurrency]);
        if (!(rate > 0)) {
          continue;
        }

        if (manualOverrideTargets.has(targetCurrency)) {
          skippedCount += 1;
          continue;
        }

        await currencyService.setRate(
          organizationId,
          providerPayload.baseCurrency,
          targetCurrency,
          rate,
          {
            effectiveDate: providerEffectiveDate,
            source: 'api',
            preserveManualOverrides,
            notes: `Synced from ${PROVIDER_CONFIG.name} (${PROVIDER_CONFIG.homepageUrl})`,
            createdBy: metadata.userId || 'system',
            createdByName: metadata.name || 'System',
          }
        );
        syncedCount += 1;
      }

      const status = skippedCount > 0 ? 'partial' : 'success';
      const syncMessage = syncedCount > 0
        ? `Synced ${syncedCount} ${providerBaseCurrency} rate${syncedCount === 1 ? '' : 's'} from ${PROVIDER_CONFIG.name}`
        : 'No new provider rates were written';

      const updatedSettings = await CurrencySyncSettings.findOneAndUpdate(
        { organizationId },
        {
          $set: {
            provider: PROVIDER_CONFIG.key,
            providerBaseCurrency: providerPayload.baseCurrency,
            lastSyncStatus: status,
            lastSyncMessage: skippedCount > 0
              ? `${syncMessage}. Skipped ${skippedCount} manual override${skippedCount === 1 ? '' : 's'}.`
              : syncMessage,
            lastSyncAt: now,
            lastSyncCompletedAt: now,
            lastSyncedRates: syncedCount,
            skippedManualOverrides: skippedCount,
            lastProviderUpdateAt: providerPayload.lastUpdateAt,
            nextProviderUpdateAt: providerPayload.nextUpdateAt,
            lastProviderBaseCurrency: providerPayload.baseCurrency,
            lastProviderResult: providerPayload.result,
            updatedBy: metadata.userId,
            updatedByName: metadata.name,
          },
        },
        { new: true }
      );

      return {
        success: true,
        provider: this.getProviderInfo(),
        settings: updatedSettings,
        baseCurrency: providerPayload.baseCurrency,
        syncedCount,
        skippedManualOverrides: skippedCount,
        totalAvailableRates: allTargetCodes.length,
        providerLastUpdateAt: providerPayload.lastUpdateAt,
        providerNextUpdateAt: providerPayload.nextUpdateAt,
      };
    } catch (error) {
      await CurrencySyncSettings.findOneAndUpdate(
        { organizationId },
        {
          $set: {
            lastSyncStatus: 'failed',
            lastSyncMessage: error.message,
            lastSyncCompletedAt: new Date(),
            updatedBy: metadata.userId,
            updatedByName: metadata.name,
          },
        }
      );

      throw error;
    }
  }

  async syncIfEmpty(organizationId, options = {}) {
    const settings = await this.getOrCreateSettings(organizationId, {
      userId: options.userId,
      name: options.name,
    });
    const hasActiveRates = await ExchangeRate.exists({
      organizationId,
      isActive: true,
    });

    if (hasActiveRates || settings.autoSeedOnEmpty === false) {
      return {
        seeded: false,
        reason: hasActiveRates ? 'rates_already_exist' : 'auto_seed_disabled',
        settings,
      };
    }

    const syncResult = await this.syncOrganizationRates(organizationId, options);
    return {
      seeded: true,
      reason: 'seeded_from_provider',
      ...syncResult,
    };
  }

  async syncAutoEnabledOrganizations() {
    const settingsList = await CurrencySyncSettings.find({
      autoSyncEnabled: true,
    }).select('organizationId providerBaseCurrency preserveManualOverrides autoSyncEnabled').lean();
    const payrollOrganizationIds = await PayrollProfile.distinct('organizationId', { isActive: true });
    const settingsByOrganization = new Map(
      settingsList.map((settings) => [settings.organizationId, settings])
    );

    for (const organizationId of payrollOrganizationIds) {
      if (settingsByOrganization.has(organizationId)) {
        continue;
      }

      const settings = await this.getOrCreateSettings(organizationId, {
        userId: 'system-scheduler',
        name: 'Daily Exchange Rate Scheduler',
      });

      if (settings.autoSyncEnabled !== false) {
        settingsByOrganization.set(organizationId, {
          organizationId: settings.organizationId,
          providerBaseCurrency: settings.providerBaseCurrency,
          preserveManualOverrides: settings.preserveManualOverrides,
          autoSyncEnabled: settings.autoSyncEnabled,
        });
      }
    }

    const results = [];

    for (const settings of settingsByOrganization.values()) {
      try {
        const result = await this.syncOrganizationRates(settings.organizationId, {
          baseCurrency: settings.providerBaseCurrency,
          preserveManualOverrides: settings.preserveManualOverrides !== false,
          createdBy: 'system-scheduler',
          createdByName: 'Daily Exchange Rate Scheduler',
        });

        results.push({
          organizationId: settings.organizationId,
          success: true,
          syncedCount: result.syncedCount,
          skippedManualOverrides: result.skippedManualOverrides,
        });
      } catch (error) {
        results.push({
          organizationId: settings.organizationId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }
}

module.exports = new ExchangeRateSyncService();
