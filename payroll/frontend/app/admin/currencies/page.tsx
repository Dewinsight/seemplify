'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  DollarSign,
  Globe,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';

import api from '@/lib/api';
import { usePayrollCurrencies } from '@/lib/usePayrollCurrencies';

interface ExchangeRate {
  _id: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string;
  isActive: boolean;
  createdByName?: string;
  notes?: string;
}

interface CurrencySyncSettings {
  provider: string;
  providerBaseCurrency: string;
  autoSyncEnabled: boolean;
  preserveManualOverrides: boolean;
  autoSeedOnEmpty: boolean;
  lastSyncStatus: 'never' | 'success' | 'partial' | 'failed';
  lastSyncMessage?: string;
  lastSyncAt?: string;
  lastProviderUpdateAt?: string;
  nextProviderUpdateAt?: string;
  lastSyncedRates?: number;
  skippedManualOverrides?: number;
}

interface ProviderInfo {
  key: string;
  name: string;
  docsUrl: string;
  homepageUrl: string;
  updateCadence: string;
  requiresApiKey: boolean;
}

interface CurrencyCatalogItem {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  label: string;
  kind: 'iso' | 'custom';
  enabled: boolean;
  paymentEnabled: boolean;
  statutoryEligible: boolean;
  payrollCalculationReady?: boolean;
  usage?: 'reporting_only';
}

interface CustomCurrency {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  isActive: boolean;
  usage: 'reporting_only';
  nonStatutoryOnly: true;
  createdAt?: string;
}

interface EnabledCurrency {
  code: string;
  paymentEnabled: boolean;
  isActive: boolean;
  addedAt?: string;
}

interface OrganizationCurrencyPolicy {
  functionalCurrency: string;
  reportingCurrency: string;
  enabledCurrencies: EnabledCurrency[];
  customCurrencies: CustomCurrency[];
  requireConfiguredPaymentCurrency: boolean;
  updatedAt?: string;
}

const emptyCustomCurrency = () => ({
  code: '',
  name: '',
  symbol: '',
  minorUnits: 2,
});

export default function CurrenciesPage() {
  const { currencies, loading: currenciesLoading } = usePayrollCurrencies();
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [settings, setSettings] = useState<CurrencySyncSettings | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [policy, setPolicy] = useState<OrganizationCurrencyPolicy | null>(null);
  const [policyCatalog, setPolicyCatalog] = useState<CurrencyCatalogItem[]>([]);
  const [activeRateCount, setActiveRateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddRate, setShowAddRate] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [targetCurrency, setTargetCurrency] = useState('NGN');
  const [rateValue, setRateValue] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [convertFrom, setConvertFrom] = useState('USD');
  const [convertTo, setConvertTo] = useState('NGN');
  const [convertAmount, setConvertAmount] = useState('1000');
  const [convertResult, setConvertResult] = useState<any>(null);
  const [currencySearch, setCurrencySearch] = useState('');
  const [customCurrency, setCustomCurrency] = useState(emptyCustomCurrency());

  const [policyForm, setPolicyForm] = useState<OrganizationCurrencyPolicy>({
    functionalCurrency: 'USD',
    reportingCurrency: 'USD',
    enabledCurrencies: [{ code: 'USD', paymentEnabled: true, isActive: true }],
    customCurrencies: [],
    requireConfiguredPaymentCurrency: true,
  });

  const [settingsForm, setSettingsForm] = useState({
    providerBaseCurrency: 'USD',
    autoSyncEnabled: true,
    preserveManualOverrides: true,
    autoSeedOnEmpty: true,
  });

  const syncStatusTone = useMemo(() => {
    switch (settings?.lastSyncStatus) {
      case 'success':
        return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
      case 'partial':
        return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
      case 'failed':
        return 'border-red-500/20 bg-red-500/10 text-red-200';
      default:
        return 'border-zinc-700 bg-zinc-800/40 text-zinc-300';
    }
  }, [settings?.lastSyncStatus]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [ratesRes, settingsRes, policyRes] = await Promise.all([
        api.get('/currencies/rates'),
        api.get('/currencies/settings'),
        api.get('/currencies/policy'),
      ]);

      const nextRates = Array.isArray(ratesRes.data?.rates) ? ratesRes.data.rates : [];
      const nextSettings = settingsRes.data?.settings || null;

      setRates(nextRates);
      setSettings(nextSettings);
      setProvider(settingsRes.data?.provider || null);
      setActiveRateCount(Number(settingsRes.data?.activeRateCount || nextRates.length || 0));

      const nextPolicy = policyRes.data?.policy || null;
      setPolicy(nextPolicy);
      setPolicyCatalog(Array.isArray(policyRes.data?.currencies) ? policyRes.data.currencies : []);
      if (nextPolicy) {
        setPolicyForm({
          functionalCurrency: nextPolicy.functionalCurrency || 'USD',
          reportingCurrency: nextPolicy.reportingCurrency || nextPolicy.functionalCurrency || 'USD',
          enabledCurrencies: Array.isArray(nextPolicy.enabledCurrencies) ? nextPolicy.enabledCurrencies : [],
          customCurrencies: Array.isArray(nextPolicy.customCurrencies) ? nextPolicy.customCurrencies : [],
          requireConfiguredPaymentCurrency: nextPolicy.requireConfiguredPaymentCurrency !== false,
        });
      }

      if (nextSettings) {
        setSettingsForm({
          providerBaseCurrency: nextSettings.providerBaseCurrency || 'USD',
          autoSyncEnabled: nextSettings.autoSyncEnabled !== false,
          preserveManualOverrides: nextSettings.preserveManualOverrides !== false,
          autoSeedOnEmpty: nextSettings.autoSeedOnEmpty !== false,
        });
        setBaseCurrency(nextSettings.providerBaseCurrency || 'USD');
      }
    } catch (err: any) {
      console.error('Failed to fetch currency data:', err);
      setError(err?.response?.data?.error || 'Failed to fetch currency data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!currencies.length) {
      return;
    }

    if (!currencies.find((currency) => currency.code === baseCurrency)) {
      setBaseCurrency(currencies[0].code);
    }
    if (!currencies.find((currency) => currency.code === targetCurrency)) {
      setTargetCurrency(currencies.find((currency) => currency.code !== baseCurrency)?.code || currencies[0].code);
    }
    if (!currencies.find((currency) => currency.code === convertFrom)) {
      setConvertFrom(currencies[0].code);
    }
    if (!currencies.find((currency) => currency.code === convertTo)) {
      setConvertTo(currencies.find((currency) => currency.code !== convertFrom)?.code || currencies[0].code);
    }
  }, [currencies, baseCurrency, targetCurrency, convertFrom, convertTo]);

  const handleAddRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rateValue || parseFloat(rateValue) <= 0) return;

    setSaving(true);
    setFeedback(null);
    setError(null);

    try {
      await api.post('/currencies/rates', {
        baseCurrency,
        targetCurrency,
        rate: parseFloat(rateValue),
        notes: manualNotes || undefined,
      });

      await fetchData();
      setShowAddRate(false);
      setRateValue('');
      setManualNotes('');
      setFeedback(`Saved manual override for ${baseCurrency} to ${targetCurrency}.`);
    } catch (err: any) {
      console.error('Failed to add manual rate:', err);
      setError(err?.response?.data?.error || 'Failed to add exchange rate');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRate = async (rateId: string) => {
    if (!confirm('Deactivate this exchange rate?')) return;

    setFeedback(null);
    setError(null);

    try {
      await api.delete(`/currencies/rates/${rateId}`);
      await fetchData();
      setFeedback('Exchange rate deactivated.');
    } catch (err: any) {
      console.error('Failed to delete rate:', err);
      setError(err?.response?.data?.error || 'Failed to deactivate exchange rate');
    }
  };

  const handleConvert = async () => {
    setFeedback(null);
    setError(null);

    try {
      const res = await api.get('/currencies/convert', {
        params: {
          amount: convertAmount,
          from: convertFrom,
          to: convertTo,
        },
      });
      setConvertResult(res.data);
    } catch (err: any) {
      console.error('Currency conversion failed:', err);
      setError(err?.response?.data?.error || err?.response?.data?.details || 'Currency conversion failed');
      setConvertResult(null);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setFeedback(null);
    setError(null);

    try {
      const res = await api.put('/currencies/settings', settingsForm);
      setSettings(res.data?.settings || null);
      setProvider(res.data?.provider || provider);
      setFeedback('Daily exchange-rate settings updated.');
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      setError(err?.response?.data?.error || 'Failed to update currency sync settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const enabledCurrencyCodes = useMemo(
    () => new Set(policyForm.enabledCurrencies
      .filter((currency) => currency.isActive !== false && currency.paymentEnabled !== false)
      .map((currency) => currency.code)),
    [policyForm.enabledCurrencies]
  );

  const activeIsoCurrencyCodes = useMemo(
    () => new Set(policyForm.enabledCurrencies
      .filter((currency) => currency.isActive !== false)
      .map((currency) => currency.code)),
    [policyForm.enabledCurrencies]
  );

  const filteredPolicyCurrencies = useMemo(() => {
    const query = currencySearch.trim().toLowerCase();
    return policyCatalog
      .filter((currency) => currency.kind === 'iso')
      .filter((currency) => !query
        || currency.code.toLowerCase().includes(query)
        || currency.name.toLowerCase().includes(query));
  }, [currencySearch, policyCatalog]);

  const reportingCurrencies = useMemo(() => {
    const iso = policyCatalog.filter((currency) => (
      currency.kind === 'iso' && activeIsoCurrencyCodes.has(currency.code)
    ));
    const custom = policyForm.customCurrencies
      .filter((currency) => currency.isActive !== false)
      .map((currency) => ({
        code: currency.code,
        name: currency.name,
        label: `${currency.code} - ${currency.name}`,
        kind: 'custom' as const,
      }));
    return [...iso, ...custom];
  }, [activeIsoCurrencyCodes, policyCatalog, policyForm.customCurrencies]);

  const handleFunctionalCurrencyChange = (code: string) => {
    if (policyCatalog.find((currency) => currency.code === code)?.payrollCalculationReady === false) return;
    setPolicyForm((current) => {
      const alreadyEnabled = current.enabledCurrencies.some((currency) => currency.code === code);
      return {
        ...current,
        functionalCurrency: code,
        enabledCurrencies: alreadyEnabled
          ? current.enabledCurrencies.map((currency) => currency.code === code
            ? { ...currency, isActive: true, paymentEnabled: true }
            : currency)
          : [...current.enabledCurrencies, { code, isActive: true, paymentEnabled: true }],
      };
    });
  };

  const togglePaymentCurrency = (code: string) => {
    if (code === policyForm.functionalCurrency) return;
    const calculationReady = policyCatalog.find((currency) => currency.code === code)?.payrollCalculationReady !== false;
    setPolicyForm((current) => {
      const enabled = current.enabledCurrencies.some((currency) => (
        currency.code === code
        && currency.isActive !== false
        && (calculationReady ? currency.paymentEnabled !== false : true)
      ));
      const nextEnabled = enabled
        ? current.enabledCurrencies.filter((currency) => currency.code !== code)
        : [...current.enabledCurrencies.filter((currency) => currency.code !== code), {
          code,
          isActive: true,
          paymentEnabled: calculationReady,
        }];
      const reportingCurrency = current.reportingCurrency === code && enabled
        ? current.functionalCurrency
        : current.reportingCurrency;
      return { ...current, enabledCurrencies: nextEnabled, reportingCurrency };
    });
  };

  const addCustomReportingCurrency = () => {
    const code = customCurrency.code.trim().toUpperCase();
    const name = customCurrency.name.trim();
    const symbol = customCurrency.symbol.trim();
    if (!/^[A-Z][A-Z0-9]{2}$/.test(code) || !name || !symbol) {
      setError('Enter a three-character code, name, and symbol for the reporting currency.');
      return;
    }
    if (policyCatalog.some((currency) => currency.code === code)
      || policyForm.customCurrencies.some((currency) => currency.code === code)) {
      setError(`${code} already exists in the currency catalogue.`);
      return;
    }

    setError(null);
    setPolicyForm((current) => ({
      ...current,
      customCurrencies: [...current.customCurrencies, {
        code,
        name,
        symbol,
        minorUnits: Math.min(6, Math.max(0, Number(customCurrency.minorUnits || 0))),
        isActive: true,
        usage: 'reporting_only',
        nonStatutoryOnly: true,
      }],
    }));
    setCustomCurrency(emptyCustomCurrency());
  };

  const removeCustomReportingCurrency = (code: string) => {
    if (!window.confirm(`Remove ${code} from the custom reporting currency list?`)) return;
    setPolicyForm((current) => ({
      ...current,
      reportingCurrency: current.reportingCurrency === code ? current.functionalCurrency : current.reportingCurrency,
      customCurrencies: current.customCurrencies.filter((currency) => currency.code !== code),
    }));
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await api.put('/currencies/policy', policyForm);
      const nextPolicy = response.data?.policy;
      setPolicy(nextPolicy || null);
      setPolicyCatalog(Array.isArray(response.data?.currencies) ? response.data.currencies : []);
      if (nextPolicy) {
        setPolicyForm(nextPolicy);
      }
      setFeedback('Organization currency policy updated.');
    } catch (err: any) {
      console.error('Failed to save currency policy:', err);
      const details = Array.isArray(err?.response?.data?.details)
        ? ` ${err.response.data.details.join(' ')}`
        : '';
      setError(`${err?.response?.data?.error || 'Failed to update currency policy'}${details}`);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSyncRates = async (mode: 'sync' | 'seed') => {
    setSyncing(true);
    setFeedback(null);
    setError(null);

    try {
      const endpoint = mode === 'seed' ? '/currencies/rates/seed' : '/currencies/rates/sync';
      const res = await api.post(endpoint, {
        baseCurrency: settingsForm.providerBaseCurrency,
        preserveManualOverrides: settingsForm.preserveManualOverrides,
      });

      await fetchData();

      if (mode === 'seed' && res.data?.seeded === false) {
        setFeedback('Rates already exist for this organization. Use Sync Now to refresh live rates.');
      } else {
        const syncedCount = Number(res.data?.syncedCount || 0);
        const skippedCount = Number(res.data?.skippedManualOverrides || 0);
        setFeedback(
          syncedCount > 0
            ? `Synced ${syncedCount} live rate${syncedCount === 1 ? '' : 's'}${skippedCount > 0 ? ` and kept ${skippedCount} manual override${skippedCount === 1 ? '' : 's'}` : ''}.`
            : 'Live exchange-rate sync completed.'
        );
      }
    } catch (err: any) {
      console.error('Failed to sync live rates:', err);
      setError(err?.response?.data?.details || err?.response?.data?.error || 'Failed to sync live exchange rates');
    } finally {
      setSyncing(false);
    }
  };

  if (loading || currenciesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Currency Management</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Seed live rates, keep daily sync on, and override any pair manually for payroll.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleSyncRates('seed')}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            Seed Live Rates
          </button>
          <button
            onClick={() => handleSyncRates('sync')}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Now
          </button>
          <button
            onClick={() => setShowAddRate(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
            Manual Override
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {feedback && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {feedback}
        </div>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5" aria-labelledby="organization-currency-policy">
        <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Landmark className="mt-0.5 h-5 w-5 text-amber-400" aria-hidden="true" />
            <div>
              <h2 id="organization-currency-policy" className="text-lg font-semibold text-white">Organization currency policy</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Choose the organization ledger currency, reporting currency, and currencies employees can be paid in.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSavePolicy}
            disabled={savingPolicy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {savingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Save policy
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 py-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300" htmlFor="functional-currency">Functional currency</label>
              <select
                id="functional-currency"
                value={policyForm.functionalCurrency}
                onChange={(event) => handleFunctionalCurrencyChange(event.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                {policyCatalog.filter((currency) => currency.kind === 'iso' && currency.payrollCalculationReady !== false).map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-500">The legal ledger currency for payroll and statutory records. Payment calculation is currently certified for two-decimal currencies.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300" htmlFor="reporting-currency">Reporting currency</label>
              <select
                id="reporting-currency"
                value={policyForm.reportingCurrency}
                onChange={(event) => setPolicyForm((current) => ({ ...current, reportingCurrency: event.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                {reportingCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}{currency.kind === 'custom' ? ' (reporting only)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-500">Used for consolidated reports. Custom units cannot be used for employee pay or tax.</p>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={policyForm.requireConfiguredPaymentCurrency}
                onChange={(event) => setPolicyForm((current) => ({
                  ...current,
                  requireConfiguredPaymentCurrency: event.target.checked,
                }))}
                className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500"
              />
              <span>
                <span className="block font-medium text-zinc-200">Require an enabled payment currency</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Prevents new or edited payroll profiles from using an unapproved currency.</span>
              </span>
            </label>

            {policy?.updatedAt ? (
              <p className="text-xs text-zinc-500">Last updated {new Date(policy.updatedAt).toLocaleString()}</p>
            ) : null}
          </div>

          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Employee payment currencies</h3>
                <p className="mt-1 text-xs text-zinc-500">The functional currency is always enabled. Zero- and three-decimal currencies can be enabled for reporting, but not employee payment, until their rounding pipelines are certified.</p>
              </div>
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  type="search"
                  value={currencySearch}
                  onChange={(event) => setCurrencySearch(event.target.value)}
                  placeholder="Find a currency"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40">
              {filteredPolicyCurrencies.length ? filteredPolicyCurrencies.map((currency) => {
                const calculationReady = currency.payrollCalculationReady !== false;
                const checked = calculationReady
                  ? enabledCurrencyCodes.has(currency.code)
                  : activeIsoCurrencyCodes.has(currency.code);
                const locked = currency.code === policyForm.functionalCurrency;
                return (
                  <label
                    key={currency.code}
                    className="flex cursor-pointer items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2.5 text-sm last:border-b-0 hover:bg-zinc-900"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-zinc-200">{currency.code}</span>
                      <span className="ml-2 truncate text-zinc-500">{currency.name}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-zinc-500">
                      {locked ? 'Functional' : !calculationReady ? (checked ? 'Reporting only' : 'Disabled') : checked ? 'Payment enabled' : 'Disabled'}
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={() => togglePaymentCurrency(currency.code)}
                        className="rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500 disabled:opacity-50"
                      />
                    </span>
                  </label>
                );
              }) : (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">No currencies match this search.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{enabledCurrencyCodes.size} payment currenc{enabledCurrencyCodes.size === 1 ? 'y' : 'ies'} enabled.</p>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Custom reporting currencies</h3>
            <p className="mt-1 text-xs text-zinc-500">For internal reporting units only. They are never eligible for statutory calculations or employee payment.</p>
          </div>

          {policyForm.customCurrencies.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800">
              {policyForm.customCurrencies.map((currency) => (
                <div key={currency.code} className="flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950/40 px-3 py-2.5 last:border-b-0">
                  <div className="text-sm">
                    <span className="font-medium text-zinc-200">{currency.code}</span>
                    <span className="ml-2 text-zinc-500">{currency.name} · {currency.symbol} · {currency.minorUnits} decimals</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCustomReportingCurrency(currency.code)}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                    aria-label={`Remove ${currency.code}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[0.7fr_1.4fr_0.7fr_0.6fr_auto]">
            <input
              value={customCurrency.code}
              onChange={(event) => setCustomCurrency((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
              maxLength={3}
              placeholder="Code"
              aria-label="Custom currency code"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <input
              value={customCurrency.name}
              onChange={(event) => setCustomCurrency((current) => ({ ...current, name: event.target.value }))}
              placeholder="Name"
              aria-label="Custom currency name"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <input
              value={customCurrency.symbol}
              onChange={(event) => setCustomCurrency((current) => ({ ...current, symbol: event.target.value }))}
              maxLength={12}
              placeholder="Symbol"
              aria-label="Custom currency symbol"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <input
              type="number"
              min="0"
              max="6"
              value={customCurrency.minorUnits}
              onChange={(event) => setCustomCurrency((current) => ({ ...current, minorUnits: Number(event.target.value) }))}
              aria-label="Custom currency decimal places"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={addCustomReportingCurrency}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="pt-0.5">
                <Settings2 className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Live Rate Sync</h2>
                <p className="text-sm text-zinc-500">
                  Source: {provider?.name || 'Provider not loaded'}
                </p>
              </div>
            </div>
            {provider?.docsUrl && (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-amber-400 hover:text-amber-300"
              >
                Provider Docs
              </a>
            )}
          </div>

          <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${syncStatusTone}`}>
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              <span>Last sync status: {settings?.lastSyncStatus || 'never'}</span>
            </div>
            <p className="mt-2 text-xs opacity-90">
              {settings?.lastSyncMessage || 'No live-rate sync has run yet for this organization.'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-zinc-400">Provider Base Currency</label>
              <select
                value={settingsForm.providerBaseCurrency}
                onChange={(e) => setSettingsForm((current) => ({ ...current, providerBaseCurrency: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white"
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-500">
                Payroll can still convert between any supported currencies through this base.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                <span>Auto-sync live rates daily</span>
                <input
                  type="checkbox"
                  checked={settingsForm.autoSyncEnabled}
                  onChange={(e) => setSettingsForm((current) => ({ ...current, autoSyncEnabled: e.target.checked }))}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                <span>Preserve manual overrides</span>
                <input
                  type="checkbox"
                  checked={settingsForm.preserveManualOverrides}
                  onChange={(e) => setSettingsForm((current) => ({ ...current, preserveManualOverrides: e.target.checked }))}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                <span>Auto-seed when no rates exist</span>
                <input
                  type="checkbox"
                  checked={settingsForm.autoSeedOnEmpty}
                  onChange={(e) => setSettingsForm((current) => ({ ...current, autoSeedOnEmpty: e.target.checked }))}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Save Sync Settings
            </button>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 text-sm text-zinc-400 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs text-zinc-500">Active rates</div>
              <div className="mt-2 text-xl font-semibold text-white">{activeRateCount}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs text-zinc-500">Provider updated</div>
              <div className="mt-2 text-sm text-white">
                {settings?.lastProviderUpdateAt ? new Date(settings.lastProviderUpdateAt).toLocaleString() : 'Not synced yet'}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs text-zinc-500">Next provider update</div>
              <div className="mt-2 text-sm text-white">
                {settings?.nextProviderUpdateAt ? new Date(settings.nextProviderUpdateAt).toLocaleString() : 'Not available yet'}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="pt-0.5">
                <Globe className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Supported Currencies</h2>
                <p className="text-sm text-zinc-500">Payroll now uses the shared currency catalog everywhere.</p>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex flex-wrap gap-2">
                {currencies.map((currency) => (
                  <div
                    key={currency.code}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium text-white">{currency.code}</span>
                    <span className="ml-2 text-zinc-500">{currency.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="pt-0.5">
                <DollarSign className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Currency Converter</h2>
                <p className="text-sm text-zinc-500">Test the exact rates payroll will use.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-zinc-400">Amount</label>
                  <input
                    type="number"
                    value={convertAmount}
                    onChange={(e) => setConvertAmount(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-400">From</label>
                  <select
                    value={convertFrom}
                    onChange={(e) => setConvertFrom(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white"
                  >
                    {currencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-zinc-400">To</label>
                <select
                  value={convertTo}
                  onChange={(e) => setConvertTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white"
                >
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleConvert}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500"
              >
                <ArrowRightLeft className="h-4 w-4" />
                Convert
              </button>

              {convertResult && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-center">
                  <p className="text-sm text-zinc-400">{convertResult.formattedOriginal}</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-400">{convertResult.formattedConverted}</p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Rate: 1 {convertFrom} = {Number(convertResult.rate || 0).toLocaleString()} {convertTo}
                    {convertResult.via ? ` via ${convertResult.via}` : ''}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="pt-0.5">
              <ArrowRightLeft className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Active Exchange Rates</h2>
              <p className="text-sm text-zinc-500">
                Manual overrides always win over synced provider rates for the same pair.
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {rates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 py-10 text-center text-zinc-500">
            <DollarSign className="mx-auto mb-3 h-8 w-8 opacity-50" />
            <p>No exchange rates configured yet.</p>
            <p className="mt-1 text-xs">Seed live rates to start multi-currency payroll calculations.</p>
          </div>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto space-y-3">
            {rates.map((rate) => (
              <div
                key={rate._id}
                className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium text-white">
                    <span>{rate.baseCurrency}</span>
                    <ArrowRightLeft className="h-4 w-4 text-zinc-500" />
                    <span>{rate.targetCurrency}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${rate.source === 'manual' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300'}`}>
                      {rate.source === 'manual' ? 'Manual override' : 'Live sync'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(rate.effectiveDate).toLocaleString()}
                    {rate.createdByName ? ` • ${rate.createdByName}` : ''}
                  </p>
                  {rate.notes && <p className="mt-1 text-xs text-zinc-500">{rate.notes}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-lg font-semibold text-emerald-400">
                    {Number(rate.rate || 0).toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleDeleteRate(rate._id)}
                    className="rounded-lg border border-zinc-800 p-2 text-zinc-400 hover:border-red-500/30 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddRate && (
        <div className="payroll-dialog-shell" role="presentation">
          <div className="payroll-dialog max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="manual-rate-title">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 id="manual-rate-title" className="payroll-dialog-title text-lg font-semibold">Add Manual Rate Override</h3>
                <p className="payroll-dialog-copy text-sm">This will take precedence over the daily provider sync.</p>
              </div>
              <button onClick={() => setShowAddRate(false)} className="payroll-dialog-close" aria-label="Close manual rate dialog">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddRate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="payroll-field-label">Base Currency</label>
                  <select
                    value={baseCurrency}
                    onChange={(e) => setBaseCurrency(e.target.value)}
                    className="payroll-field"
                  >
                    {currencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="payroll-field-label">Target Currency</label>
                  <select
                    value={targetCurrency}
                    onChange={(e) => setTargetCurrency(e.target.value)}
                    className="payroll-field"
                  >
                    {currencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="payroll-field-label">
                  Rate (1 {baseCurrency} = X {targetCurrency})
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                  placeholder="e.g. 1357.264974"
                  className="payroll-field"
                />
              </div>

              <div>
                <label className="payroll-field-label">Notes (optional)</label>
                <textarea
                  rows={3}
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Why should payroll use this override?"
                  className="payroll-field"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRate(false)}
                  className="payroll-button-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !rateValue || baseCurrency === targetCurrency}
                  className="payroll-button-primary flex-1"
                >
                  {saving ? 'Saving...' : 'Save Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
