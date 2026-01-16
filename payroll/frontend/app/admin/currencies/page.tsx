'use client';

import { useState, useEffect } from 'react';
import { DollarSign, RefreshCw, Plus, Trash2, ArrowRightLeft, History, Globe } from 'lucide-react';

interface Currency {
    code: string;
    name: string;
    symbol: string;
    decimals: number;
}

interface ExchangeRate {
    _id: string;
    baseCurrency: string;
    targetCurrency: string;
    rate: number;
    effectiveDate: string;
    source: string;
    isActive: boolean;
    createdByName?: string;
    createdAt: string;
}

export default function CurrenciesPage() {
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [rates, setRates] = useState<ExchangeRate[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddRate, setShowAddRate] = useState(false);
    const [baseCurrency, setBaseCurrency] = useState('USD');
    const [targetCurrency, setTargetCurrency] = useState('NGN');
    const [rateValue, setRateValue] = useState('');
    const [saving, setSaving] = useState(false);

    // Conversion calculator
    const [convertFrom, setConvertFrom] = useState('USD');
    const [convertTo, setConvertTo] = useState('NGN');
    const [convertAmount, setConvertAmount] = useState('1000');
    const [convertResult, setConvertResult] = useState<any>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [currenciesRes, ratesRes] = await Promise.all([
                fetch('/api/payroll/currencies', { credentials: 'include' }),
                fetch('/api/payroll/currencies/rates', { credentials: 'include' })
            ]);

            if (currenciesRes.ok) {
                const data = await currenciesRes.json();
                setCurrencies(data.currencies || []);
            }

            if (ratesRes.ok) {
                const data = await ratesRes.json();
                setRates(data.rates || []);
            }
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddRate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rateValue || parseFloat(rateValue) <= 0) return;

        setSaving(true);
        try {
            const res = await fetch('/api/payroll/currencies/rates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    baseCurrency,
                    targetCurrency,
                    rate: parseFloat(rateValue)
                })
            });

            if (res.ok) {
                await fetchData();
                setShowAddRate(false);
                setRateValue('');
            }
        } catch (err) {
            console.error('Failed to add rate:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRate = async (rateId: string) => {
        if (!confirm('Deactivate this exchange rate?')) return;

        try {
            const res = await fetch(`/api/payroll/currencies/rates/${rateId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (res.ok) {
                await fetchData();
            }
        } catch (err) {
            console.error('Failed to delete rate:', err);
        }
    };

    const handleConvert = async () => {
        try {
            const res = await fetch(
                `/api/payroll/currencies/convert?amount=${convertAmount}&from=${convertFrom}&to=${convertTo}`,
                { credentials: 'include' }
            );

            if (res.ok) {
                const result = await res.json();
                setConvertResult(result);
            }
        } catch (err) {
            console.error('Conversion failed:', err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Currency Management</h1>
                    <p className="text-zinc-400 text-sm mt-1">
                        Manage exchange rates for multi-currency payroll
                    </p>
                </div>
                <button
                    onClick={() => setShowAddRate(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-medium hover:shadow-lg transition-all"
                >
                    <Plus className="h-4 w-4" />
                    Add Exchange Rate
                </button>
            </div>

            {/* Supported Currencies */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                        <Globe className="h-5 w-5 text-amber-400" />
                    </div>
                    <h3 className="font-semibold text-white">Supported Currencies</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    {currencies.map((c) => (
                        <div
                            key={c.code}
                            className="px-3 py-1.5 bg-zinc-800 rounded-lg text-sm"
                        >
                            <span className="font-medium text-white">{c.code}</span>
                            <span className="text-zinc-400 ml-2">{c.symbol}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Exchange Rates */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-emerald-500/10">
                                <ArrowRightLeft className="h-5 w-5 text-emerald-400" />
                            </div>
                            <h3 className="font-semibold text-white">Active Exchange Rates</h3>
                        </div>
                        <button onClick={fetchData} className="text-zinc-400 hover:text-white">
                            <RefreshCw className="h-4 w-4" />
                        </button>
                    </div>

                    {rates.length === 0 ? (
                        <div className="text-center py-8 text-zinc-500">
                            <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No exchange rates configured</p>
                            <p className="text-xs mt-1">Add rates to enable multi-currency payroll</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {rates.map((rate) => (
                                <div
                                    key={rate._id}
                                    className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
                                >
                                    <div>
                                        <div className="flex items-center gap-2 font-medium text-white">
                                            <span>{rate.baseCurrency}</span>
                                            <ArrowRightLeft className="h-4 w-4 text-zinc-500" />
                                            <span>{rate.targetCurrency}</span>
                                        </div>
                                        <p className="text-xs text-zinc-500">
                                            {new Date(rate.effectiveDate).toLocaleDateString()}
                                            {rate.createdByName && ` • ${rate.createdByName}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-bold text-emerald-400">
                                            {rate.rate.toLocaleString()}
                                        </span>
                                        <button
                                            onClick={() => handleDeleteRate(rate._id)}
                                            className="text-zinc-500 hover:text-red-400"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Currency Converter */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                            <DollarSign className="h-5 w-5 text-blue-400" />
                        </div>
                        <h3 className="font-semibold text-white">Currency Converter</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Amount</label>
                                <input
                                    type="number"
                                    value={convertAmount}
                                    onChange={(e) => setConvertAmount(e.target.value)}
                                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">From</label>
                                <select
                                    value={convertFrom}
                                    onChange={(e) => setConvertFrom(e.target.value)}
                                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                >
                                    {currencies.map((c) => (
                                        <option key={c.code} value={c.code}>{c.code}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm text-zinc-400 mb-1">To</label>
                            <select
                                value={convertTo}
                                onChange={(e) => setConvertTo(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                            >
                                {currencies.map((c) => (
                                    <option key={c.code} value={c.code}>{c.code}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={handleConvert}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                        >
                            Convert
                        </button>

                        {convertResult && (
                            <div className="p-4 bg-zinc-800 rounded-lg text-center">
                                <p className="text-zinc-400 text-sm">
                                    {convertResult.formattedOriginal}
                                </p>
                                <p className="text-2xl font-bold text-emerald-400 mt-1">
                                    {convertResult.formattedConverted}
                                </p>
                                <p className="text-xs text-zinc-500 mt-2">
                                    Rate: 1 {convertFrom} = {convertResult.rate?.toLocaleString()} {convertTo}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Add Rate Modal */}
            {showAddRate && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md">
                        <h3 className="text-lg font-semibold text-white mb-4">Add Exchange Rate</h3>
                        <form onSubmit={handleAddRate} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Base Currency</label>
                                    <select
                                        value={baseCurrency}
                                        onChange={(e) => setBaseCurrency(e.target.value)}
                                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                    >
                                        {currencies.map((c) => (
                                            <option key={c.code} value={c.code}>{c.code}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-zinc-400 mb-1">Target Currency</label>
                                    <select
                                        value={targetCurrency}
                                        onChange={(e) => setTargetCurrency(e.target.value)}
                                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                    >
                                        {currencies.map((c) => (
                                            <option key={c.code} value={c.code}>{c.code}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">
                                    Rate (1 {baseCurrency} = X {targetCurrency})
                                </label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    value={rateValue}
                                    onChange={(e) => setRateValue(e.target.value)}
                                    placeholder="e.g., 1600.50"
                                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAddRate(false)}
                                    className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || !rateValue}
                                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-medium disabled:opacity-50"
                                >
                                    {saving ? 'Saving...' : 'Save Rate'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
