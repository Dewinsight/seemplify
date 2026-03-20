'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Plus, RefreshCw, Save } from 'lucide-react';

import {
  TaxFieldDefinition,
  TaxJurisdictionDetail,
  TaxJurisdictionVersion,
  createTaxJurisdiction,
  createTaxJurisdictionVersion,
  getTaxJurisdiction,
  listTaxJurisdictions,
  previewTaxJurisdiction,
  publishTaxJurisdictionVersion,
  updateTaxJurisdiction,
} from '@/lib/payrollTax';
import { formatPayrollMoney } from '@/lib/payrollMoney';

type Draft = {
  label: string;
  effectiveFrom: string;
  effectiveTo: string;
  validationStatus: 'draft' | 'validated' | 'needs_review';
  fields: TaxFieldDefinition[];
  sourceLinksText: string;
  constantsText: string;
  incomeTaxText: string;
  statutoryText: string;
  notesText: string;
  testCasesText: string;
};

const types: TaxFieldDefinition['type'][] = ['currency', 'percent', 'integer', 'boolean', 'select', 'text', 'date'];

const json = (value: any) => JSON.stringify(value ?? {}, null, 2);
const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const optionsText = (options?: { value: string; label: string }[]) => (options || []).map((option) => `${option.value}|${option.label}`).join('\n');
const parseOptions = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
  const [rawValue, rawLabel] = line.split('|');
  return { value: String(rawValue || '').trim(), label: String(rawLabel || rawValue || '').trim() };
}).filter((option) => option.value);
const parseJson = <T,>(value: string, fallback: T): T => value.trim() ? JSON.parse(value) : fallback;
const emptyField = (): TaxFieldDefinition => ({ key: '', label: '', type: 'text', required: false, defaultValue: '', options: [] });
const createDraft = (version?: TaxJurisdictionVersion | null): Draft => ({
  label: version?.label || 'Draft Version',
  effectiveFrom: dateValue(version?.effectiveFrom) || new Date().toISOString().slice(0, 10),
  effectiveTo: dateValue(version?.effectiveTo),
  validationStatus: version?.validationStatus || 'draft',
  fields: Array.isArray(version?.fieldDefinitions) ? version.fieldDefinitions : [],
  sourceLinksText: json(version?.sourceLinks || []),
  constantsText: json(version?.constants || {}),
  incomeTaxText: json(version?.incomeTax || {}),
  statutoryText: json(version?.statutoryRules || []),
  notesText: (version?.notes || []).join('\n'),
  testCasesText: json(version?.testCases || []),
});

export default function TaxSettingsPage() {
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdictionDetail[]>([]);
  const [selected, setSelected] = useState<TaxJurisdictionDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [titleDraft, setTitleDraft] = useState({ displayName: '', countryCode: 'OTHER', countryName: '', description: '' });
  const [draft, setDraft] = useState<Draft>(createDraft());
  const [previewFields, setPreviewFields] = useState<Record<string, any>>({});
  const [previewBase, setPreviewBase] = useState({ basicSalary: 500000, grossPay: 500000, taxableIncome: 500000, payFrequency: 'monthly' });
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const canEdit = selected?.scope === 'organization';
  const selectedVersion = selected?.versions?.find((version) => version._id === selectedVersionId)
    || selected?.versions?.find((version) => version._id === selected?.publishedVersionId)
    || selected?.versions?.[0]
    || null;

  const applySelection = (next: TaxJurisdictionDetail | null) => {
    setSelected(next);
    const version = next?.versions?.find((entry) => entry._id === next?.publishedVersionId) || next?.versions?.[0] || null;
    setSelectedVersionId(version?._id || '');
    setTitleDraft({
      displayName: next?.displayName || '',
      countryCode: next?.countryCode || 'OTHER',
      countryName: next?.countryName || '',
      description: next?.description || '',
    });
    setDraft(createDraft(version));
    const defaults: Record<string, any> = {};
    for (const field of version?.fieldDefinitions || []) defaults[field.key] = field.defaultValue ?? (field.type === 'boolean' ? false : '');
    setPreviewFields(defaults);
  };

  const loadData = useCallback(async (nextId?: string) => {
    setLoading(true);
    setError('');
    try {
      const summaries = await listTaxJurisdictions();
      const details = await Promise.all(summaries.map((summary) => getTaxJurisdiction(summary._id)));
      setJurisdictions(details);
      applySelection(details.find((item) => item._id === nextId) || details.find((item) => item._id === selected?._id) || details[0] || null);
    } catch (fetchError: any) {
      setError(fetchError?.response?.data?.error || 'Failed to load tax jurisdictions');
    } finally {
      setLoading(false);
    }
  }, [selected?._id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setField = (index: number, patch: Partial<TaxFieldDefinition>) => setDraft((current) => ({
    ...current,
    fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field),
  }));

  const createBlank = async () => {
    setSaving(true); setError(''); setFeedback('');
    try {
      const created = await createTaxJurisdiction({ countryCode: 'OTHER', countryName: 'Custom jurisdiction', displayName: `Custom Tax Rule ${new Date().toISOString().slice(0, 16)}` });
      await loadData(created._id);
      setFeedback('Created a new organization tax rule.');
    } catch (createError: any) {
      setError(createError?.response?.data?.error || 'Failed to create a tax rule');
    } finally { setSaving(false); }
  };

  const cloneSelected = async () => {
    if (!selected?._id) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      const created = await createTaxJurisdiction({ cloneFromId: selected._id, displayName: `${selected.displayName} Override`, countryCode: selected.countryCode, countryName: selected.countryName });
      await loadData(created._id);
      setFeedback('Cloned the selected jurisdiction.');
    } catch (cloneError: any) {
      setError(cloneError?.response?.data?.error || 'Failed to clone the selected jurisdiction');
    } finally { setSaving(false); }
  };

  const saveChanges = async () => {
    if (!selected?._id || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await updateTaxJurisdiction(selected._id, {
        displayName: titleDraft.displayName,
        countryCode: titleDraft.countryCode,
        countryName: titleDraft.countryName,
        description: titleDraft.description,
        versionId: selectedVersionId,
        version: {
          label: draft.label,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          validationStatus: draft.validationStatus,
          fieldDefinitions: draft.fields,
          sourceLinks: parseJson(draft.sourceLinksText, []),
          constants: parseJson(draft.constantsText, {}),
          incomeTax: parseJson(draft.incomeTaxText, {}),
          statutoryRules: parseJson(draft.statutoryText, []),
          notes: draft.notesText.split('\n').map((line) => line.trim()).filter(Boolean),
          testCases: parseJson(draft.testCasesText, []),
        },
      });
      await loadData(selected._id);
      setFeedback('Saved tax jurisdiction changes.');
    } catch (saveError: any) {
      setError(saveError?.response?.data?.error || saveError?.message || 'Failed to save tax jurisdiction');
    } finally { setSaving(false); }
  };

  const newDraftVersion = async () => {
    if (!selected?._id || !selectedVersion || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      const createdVersion = await createTaxJurisdictionVersion(selected._id, { ...selectedVersion, label: `${selectedVersion.label} Draft`, validationStatus: 'draft' });
      await loadData(selected._id);
      setSelectedVersionId(createdVersion._id);
      setFeedback('Created a new draft version.');
    } catch (versionError: any) {
      setError(versionError?.response?.data?.error || 'Failed to create a draft version');
    } finally { setSaving(false); }
  };

  const publishVersion = async () => {
    if (!selected?._id || !selectedVersionId || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await publishTaxJurisdictionVersion(selected._id, selectedVersionId);
      await loadData(selected._id);
      setFeedback('Published the selected version.');
    } catch (publishError: any) {
      setError(publishError?.response?.data?.error || 'Failed to publish the selected version');
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    setPreviewing(true); setError('');
    try {
      const constants = parseJson<Record<string, any>>(draft.constantsText, {});
      const taxYearMode = typeof constants?.taxYearMode === 'string'
        ? constants.taxYearMode
        : (selectedVersion?.taxYear?.mode || 'calendar');
      setPreviewResult(await previewTaxJurisdiction({
        basicSalary: Number(previewBase.basicSalary || 0),
        grossPay: Number(previewBase.grossPay || 0),
        taxableIncome: Number(previewBase.taxableIncome || 0),
        payFrequency: previewBase.payFrequency,
        taxConfig: { jurisdictionConfigId: selected?._id, jurisdictionCode: titleDraft.countryCode, jurisdictionName: titleDraft.displayName, employeeTaxInputs: previewFields },
        versionDefinition: {
          label: draft.label,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          validationStatus: draft.validationStatus,
          fieldDefinitions: draft.fields,
          sourceLinks: parseJson(draft.sourceLinksText, []),
          constants,
          incomeTax: parseJson(draft.incomeTaxText, {}),
          statutoryRules: parseJson(draft.statutoryText, []),
          testCases: parseJson(draft.testCasesText, []),
          taxYear: { mode: taxYearMode },
        } as any,
      }));
    } catch (previewError: any) {
      setError(previewError?.response?.data?.error || previewError?.message || 'Failed to preview the tax rule');
    } finally { setPreviewing(false); }
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-zinc-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading tax jurisdictions...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-semibold text-zinc-100">Tax Rules</h1><p className="text-sm text-zinc-400 mt-1">Seeded jurisdictions, dynamic employee fields, formula JSON, and preview sandbox.</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => loadData(selected?._id)} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={createBlank} disabled={saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><Plus className="w-4 h-4" />New Country</button>
          <button onClick={cloneSelected} disabled={!selected?._id || saving} className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm flex items-center gap-2"><Copy className="w-4 h-4" />Clone Selected</button>
        </div>
      </div>
      {feedback ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{feedback}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
          {jurisdictions.map((item) => <button key={item._id} onClick={() => applySelection(item)} className={`w-full text-left rounded-xl border px-3 py-3 ${selected?._id === item._id ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50'}`}><p className="text-sm font-semibold text-zinc-100">{item.displayName}</p><p className="text-xs text-zinc-500 mt-1">{item.countryCode} · {item.scope}</p></button>)}
        </div>
        <div className="space-y-6">
          {selected ? (
            <>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div><h2 className="text-lg font-semibold text-zinc-100">{selected.displayName}</h2><p className="text-sm text-zinc-500 mt-1">{selected.scope === 'global' ? 'Platform seed. Clone before editing.' : 'Organization-owned rule.'}</p></div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={newDraftVersion} disabled={!canEdit || saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm">New Draft Version</button>
                    <button onClick={saveChanges} disabled={!canEdit || saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><Save className="w-4 h-4" />Save</button>
                    <button onClick={publishVersion} disabled={!canEdit || saving || !selectedVersionId} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Publish</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={titleDraft.displayName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, displayName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Display name" />
                  <input value={titleDraft.countryName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, countryName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Country name" />
                  <input value={titleDraft.countryCode} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, countryCode: e.target.value.toUpperCase() })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Country code" />
                  <select value={selectedVersionId} onChange={(e) => { setSelectedVersionId(e.target.value); setDraft(createDraft(selected.versions.find((version) => version._id === e.target.value) || null)); }} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100">{selected.versions.map((version) => <option key={version._id} value={version._id}>V{version.versionNumber} · {version.label}</option>)}</select>
                  <input value={draft.label} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Version label" />
                  <select value={draft.validationStatus} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, validationStatus: e.target.value as Draft['validationStatus'] })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100"><option value="draft">Draft</option><option value="validated">Validated</option><option value="needs_review">Needs review</option></select>
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-zinc-100">Dynamic Employee Fields</h3><button onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })} disabled={!canEdit} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm">Add Field</button></div>
                {draft.fields.map((field, index) => <div key={`${field.key || 'field'}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3"><div className="grid grid-cols-1 md:grid-cols-4 gap-3"><input value={field.key} disabled={!canEdit} onChange={(e) => setField(index, { key: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="key" /><input value={field.label} disabled={!canEdit} onChange={(e) => setField(index, { label: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Label" /><select value={field.type} disabled={!canEdit} onChange={(e) => setField(index, { type: e.target.value as TaxFieldDefinition['type'] })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100">{types.map((type) => <option key={type} value={type}>{type}</option>)}</select><input value={String(field.defaultValue ?? '')} disabled={!canEdit} onChange={(e) => setField(index, { defaultValue: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Default" /></div><textarea value={optionsText(field.options)} disabled={!canEdit || field.type !== 'select'} onChange={(e) => setField(index, { options: parseOptions(e.target.value) })} className="w-full min-h-[72px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="value|Label per line for select fields" /><div className="flex items-center justify-between"><label className="text-sm text-zinc-400 flex items-center gap-2"><input type="checkbox" checked={!!field.required} disabled={!canEdit} onChange={(e) => setField(index, { required: e.target.checked })} />Required</label><button onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index) })} disabled={!canEdit} className="text-sm text-red-300">Remove</button></div></div>)}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
                  <textarea value={draft.sourceLinksText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, sourceLinksText: e.target.value })} className="w-full min-h-[96px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Source links JSON" />
                  <textarea value={draft.constantsText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, constantsText: e.target.value })} className="w-full min-h-[120px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Constants JSON" />
                  <textarea value={draft.incomeTaxText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, incomeTaxText: e.target.value })} className="w-full min-h-[180px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Income tax JSON" />
                  <textarea value={draft.statutoryText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, statutoryText: e.target.value })} className="w-full min-h-[160px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Statutory rules JSON" />
                  <textarea value={draft.notesText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, notesText: e.target.value })} className="w-full min-h-[72px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Notes (one per line)" />
                  <textarea value={draft.testCasesText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, testCasesText: e.target.value })} className="w-full min-h-[120px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Test cases JSON" />
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                  <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-zinc-100">Preview Sandbox</h3><button onClick={runPreview} disabled={previewing} className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm">{previewing ? 'Previewing...' : 'Run Preview'}</button></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><input type="number" value={previewBase.basicSalary} onChange={(e) => setPreviewBase({ ...previewBase, basicSalary: Number(e.target.value) })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Basic salary" /><input type="number" value={previewBase.grossPay} onChange={(e) => setPreviewBase({ ...previewBase, grossPay: Number(e.target.value) })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Gross pay" /><input type="number" value={previewBase.taxableIncome} onChange={(e) => setPreviewBase({ ...previewBase, taxableIncome: Number(e.target.value) })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Taxable income" /><select value={previewBase.payFrequency} onChange={(e) => setPreviewBase({ ...previewBase, payFrequency: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100"><option value="monthly">Monthly</option><option value="semi-monthly">Semi-monthly</option><option value="bi-weekly">Bi-weekly</option><option value="weekly">Weekly</option></select></div>
                  {draft.fields.map((field) => <div key={`preview-${field.key}`}><label className="block text-sm font-medium text-zinc-400 mb-1.5">{field.label}</label>{field.type === 'select' ? <select value={previewFields[field.key] ?? ''} onChange={(e) => setPreviewFields({ ...previewFields, [field.key]: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100"><option value="">Select</option>{(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'boolean' ? <label className="text-sm text-zinc-200 flex items-center gap-2"><input type="checkbox" checked={!!previewFields[field.key]} onChange={(e) => setPreviewFields({ ...previewFields, [field.key]: e.target.checked })} />Enabled</label> : <input type={field.type === 'date' ? 'date' : 'text'} value={previewFields[field.key] ?? ''} onChange={(e) => setPreviewFields({ ...previewFields, [field.key]: field.type === 'currency' || field.type === 'percent' || field.type === 'integer' ? Number(e.target.value) : e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" />}</div>)}
                  {previewResult ? <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3">{Array.isArray(previewResult.validationErrors) && previewResult.validationErrors.length > 0 ? <div className="text-sm text-amber-300">{previewResult.validationErrors.join(' ')}</div> : null}<div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Income Tax</p><p className="mt-1 text-lg font-semibold text-amber-300">{formatPayrollMoney(previewResult?.incomeTax?.taxAmount || 0, 'NGN')}</p></div><div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Statutory</p><p className="mt-1 text-lg font-semibold text-zinc-100">{formatPayrollMoney(previewResult?.statutoryContributions?.totalAmount || 0, 'NGN')}</p></div><div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Method</p><p className="mt-1 text-sm font-medium text-zinc-100">{previewResult?.incomeTax?.method || 'n/a'}</p></div></div></div> : null}
                </div>
              </div>
            </>
          ) : <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-zinc-400">No jurisdiction selected.</div>}
        </div>
      </div>
    </div>
  );
}
