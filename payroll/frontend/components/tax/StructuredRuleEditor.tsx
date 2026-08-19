'use client';

import { Plus, Trash2 } from 'lucide-react';

type ValueKind = 'text' | 'number' | 'boolean' | 'object' | 'list' | 'empty';

const controlClass = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/70 disabled:cursor-not-allowed disabled:text-zinc-500';

const humanize = (value: string) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const kindOf = (value: unknown): ValueKind => {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
};

const valueForKind = (kind: ValueKind): any => ({
  text: '',
  number: 0,
  boolean: false,
  object: {},
  list: [],
  empty: null,
}[kind]);

function PrimitiveEditor({ value, onChange, disabled, fieldName = '' }: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  fieldName?: string;
}) {
  if (typeof value === 'boolean') {
    return (
      <label className="flex min-h-10 items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {value ? 'Enabled' : 'Disabled'}
      </label>
    );
  }
  if (typeof value === 'number') {
    return <input type="number" step="any" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value || 0))} className={controlClass} />;
  }
  if (value === null || value === undefined) {
    return <div className="flex min-h-10 items-center text-sm text-zinc-500">No value</div>;
  }
  const text = String(value);
  const isFormula = /formula|expression|condition/i.test(fieldName) || text.length > 80;
  return isFormula
    ? <textarea rows={2} value={text} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={controlClass} />
    : <input value={text} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={controlClass} />;
}

function StructuredValue({ value, onChange, disabled, depth = 0, fieldName = '' }: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  depth?: number;
  fieldName?: string;
}) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="border-l border-zinc-800 pl-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Item {index + 1}</span>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Item ${index + 1} type`}
                  value={kindOf(item)}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = [...value];
                    next[index] = valueForKind(event.target.value as ValueKind);
                    onChange(next);
                  }}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
                >
                  <option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option>
                  <option value="object">Group</option><option value="list">List</option><option value="empty">Empty</option>
                </select>
                <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} className="text-zinc-500 hover:text-red-300 disabled:opacity-40" aria-label={`Remove item ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <StructuredValue value={item} disabled={disabled} depth={depth + 1} fieldName={`${fieldName} item ${index + 1}`} onChange={(nextItem) => {
              const next = [...value];
              next[index] = nextItem;
              onChange(next);
            }} />
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => onChange([...value, {}])} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add item</button>
      </div>
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      <div className="space-y-3">
        {entries.map(([key, child], index) => (
          <div key={`${key}-${index}`} className={depth > 0 ? 'border-l border-zinc-800 pl-3' : ''}>
            <div className="mb-1.5 grid grid-cols-[minmax(130px,0.45fr)_120px_32px] gap-2">
              <input
                aria-label="Setting name"
                value={key}
                disabled={disabled}
                onChange={(event) => {
                  const nextKey = event.target.value;
                  const nextEntries = entries.map(([entryKey, entryValue], entryIndex) => entryIndex === index ? [nextKey, entryValue] : [entryKey, entryValue]);
                  onChange(Object.fromEntries(nextEntries.filter(([entryKey]) => entryKey)));
                }}
                className={controlClass}
                title={humanize(key)}
              />
              <select
                aria-label={`${humanize(key)} type`}
                value={kindOf(child)}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, [key]: valueForKind(event.target.value as ValueKind) })}
                className={controlClass}
              >
                <option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option>
                <option value="object">Group</option><option value="list">List</option><option value="empty">Empty</option>
              </select>
              <button type="button" disabled={disabled} onClick={() => onChange(Object.fromEntries(entries.filter((_, entryIndex) => entryIndex !== index)))} className="text-zinc-500 hover:text-red-300 disabled:opacity-40" aria-label={`Remove ${humanize(key)}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            <StructuredValue value={child} disabled={disabled} depth={depth + 1} fieldName={key} onChange={(nextChild) => onChange({ ...value, [key]: nextChild })} />
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => {
          let suffix = entries.length + 1;
          while (Object.prototype.hasOwnProperty.call(value, `setting${suffix}`)) suffix += 1;
          onChange({ ...value, [`setting${suffix}`]: '' });
        }} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add setting</button>
      </div>
    );
  }

  return <PrimitiveEditor value={value} onChange={onChange} disabled={disabled} fieldName={fieldName} />;
}

export function StructuredRuleEditor({ value, onChange, disabled }: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  return <StructuredValue value={value} onChange={onChange} disabled={disabled} />;
}

export const incomeTaxStrategyOptions = [
  ['none', 'No income tax'],
  ['flat_rate', 'Flat annual rate'],
  ['progressive_bands', 'Progressive bands'],
  ['base_plus_rate', 'Base amount plus marginal rate'],
  ['conditional', 'Conditional rules'],
  ['mozambique_monthly_irps', 'Mozambique monthly IRPS table'],
] as const;

export const statutoryStrategyOptions = [
  ['flat_percent', 'Percentage contribution'],
  ['fixed_amount', 'Fixed amount'],
  ['uk_ni', 'United Kingdom National Insurance'],
  ['us_fica', 'United States FICA'],
] as const;

export function incomeTaxDefaults(strategy: string) {
  if (strategy === 'flat_rate') return { strategy, taxableAnnualFormula: 'annualizedTaxableIncome', annualRateFormula: '0', annualTaxAfterFormula: 'annualTaxBeforeAdjustments' };
  if (strategy === 'progressive_bands') return { strategy, taxableAnnualFormula: 'annualizedTaxableIncome', brackets: [{ min: 0, max: null, rate: 0 }], annualTaxAfterFormula: 'annualTaxBeforeAdjustments' };
  if (strategy === 'base_plus_rate') return { strategy, taxableAnnualFormula: 'annualizedTaxableIncome', tableGroupFormula: "'default'", rowKeyFormula: "'default'", tableSets: { default: { default: [{ min: 0, max: null, baseTax: 0, rate: 0 }] } }, annualTaxAfterFormula: 'annualBaseTax' };
  if (strategy === 'conditional') return { strategy, cases: [{ whenFormula: 'false', strategyConfig: { strategy: 'none' } }], defaultStrategyConfig: { strategy: 'none' } };
  if (strategy === 'mozambique_monthly_irps') return { strategy };
  return { strategy: 'none' };
}

export function statutoryRuleDefaults(strategy = 'flat_percent') {
  const common = { strategy, type: 'social_security', name: 'New statutory contribution', liabilityCode: '', payer: 'employee', remittanceAuthority: '' };
  if (strategy === 'fixed_amount') return { ...common, amountFormula: '0', baseFormula: 'grossPay', whenFormula: 'true', reducesTaxableIncome: false };
  if (strategy === 'uk_ni' || strategy === 'us_fica') return common;
  return { ...common, rate: 0, baseFormula: 'grossPay', capFormula: '', floorFormula: '', capMode: 'annual_ytd', whenFormula: 'true', reducesTaxableIncome: false };
}
