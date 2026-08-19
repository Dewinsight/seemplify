'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Beaker, CheckCircle2, Copy, ExternalLink, FilePlus2, Loader2, Plus, Save, Scale, Send, X } from 'lucide-react';
import { correctionRunsApi, rulePacksApi } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/apiError';

const STARTING_RULES = {
    work: { standardHoursPerDay: 8, standardHoursPerWeek: 40, maximumHoursPerWeek: 48, workDays: [1, 2, 3, 4, 5], defaultStartTime: '09:00', defaultEndTime: '17:00' },
    breaks: { requiredAfterMinutes: 360, minimumBreakMinutes: 30, paid: false },
    rest: { minimumDailyRestMinutes: 660, minimumWeeklyRestMinutes: 1440 },
    overtime: { enabled: true, dailyThresholdHours: 8, weeklyThresholdHours: 40, multiplier: 1.5, requiresApproval: true },
    rounding: { enabled: false, incrementMinutes: 5, mode: 'nearest' },
    retention: { attendanceDays: 2190, presenceEventDays: 90 },
    exceptions: { lateGraceMinutes: 15, earlyDepartureGraceMinutes: 15, longBreakAfterMinutes: 90 },
};

const EMPTY_FORM = {
    name: '', key: '', description: '', jurisdictionKind: 'country', jurisdictionCode: '',
    effectiveFrom: new Date().toISOString().slice(0, 10), sourceTitle: '', sourceUrl: '',
};

function slugify(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function RulePackStudioPage() {
    const [packs, setPacks] = useState<any[]>([]);
    const [selected, setSelected] = useState<any>(null);
    const selectedId = useRef('');
    const [compareId, setCompareId] = useState('');
    const [comparison, setComparison] = useState<any>(null);
    const [rulesText, setRulesText] = useState('{}');
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [validation, setValidation] = useState<any>(null);
    const [simulation, setSimulation] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [seeding, setSeeding] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const select = useCallback(async (id: string) => {
        const data = await rulePacksApi.get(id);
        selectedId.current = id;
        setSelected(data.pack);
        setRulesText(JSON.stringify(data.pack.rules || {}, null, 2));
        setValidation(null);
        setSimulation(null);
    }, []);

    const load = useCallback(async (options: { seedIfEmpty?: boolean } = {}) => {
        setLoading(true);
        setErrorMessage('');
        try {
            let data = await rulePacksApi.list();
            if (!data.packs?.length && options.seedIfEmpty) {
                setSeeding(true);
                await rulePacksApi.seedDefaults();
                data = await rulePacksApi.list();
                setMessage('Baseline templates were added. Review and clone one before publishing it for your organization.');
            }
            const nextPacks = data.packs || [];
            setPacks(nextPacks);
            const currentStillExists = nextPacks.some((pack: any) => pack._id === selectedId.current);
            if (!currentStillExists && nextPacks.length) await select(nextPacks[0]._id);
            if (!nextPacks.length) {
                selectedId.current = '';
                setSelected(null);
            }
        } catch (error: any) {
            setErrorMessage(getApiErrorMessage(error, 'Rule packs could not be loaded.'));
        } finally {
            setLoading(false);
            setSeeding(false);
        }
    }, [select]);

    useEffect(() => { void load({ seedIfEmpty: true }); }, [load]);

    const seedDefaults = async () => {
        setSeeding(true);
        setErrorMessage('');
        try {
            const result = await rulePacksApi.seedDefaults();
            setMessage(result.inserted ? `${result.inserted} baseline templates added.` : 'All baseline templates are already present.');
            await load();
        } catch (error: any) {
            setErrorMessage(getApiErrorMessage(error, 'Baseline templates could not be added.'));
        } finally {
            setSeeding(false);
        }
    };

    const createPack = async (event: React.FormEvent) => {
        event.preventDefault();
        setCreating(true);
        setErrorMessage('');
        try {
            const code = form.jurisdictionCode.trim().toUpperCase();
            const jurisdiction: any = { kind: form.jurisdictionKind };
            if (form.jurisdictionKind === 'country') jurisdiction.countryCode = code;
            if (form.jurisdictionKind === 'regional') jurisdiction.regionCode = code;
            if (form.jurisdictionKind === 'subdivision') jurisdiction.subdivisionCode = code;
            const data = await rulePacksApi.create({
                key: form.key || slugify(form.name), name: form.name, description: form.description,
                jurisdiction, effectiveFrom: form.effectiveFrom, rules: STARTING_RULES,
                sources: form.sourceTitle ? [{ title: form.sourceTitle, url: form.sourceUrl || undefined }] : [],
                reviewRequired: true, changeNotes: 'Custom organization draft created in Rule Pack Studio.',
            });
            setCreateOpen(false);
            setForm(EMPTY_FORM);
            setMessage('Custom draft created. Add authoritative sources, review the rules, validate, and simulate before publication.');
            await load();
            await select(data.pack._id);
        } catch (error: any) {
            setErrorMessage(getApiErrorMessage(error, 'The custom rule pack could not be created.'));
        } finally {
            setCreating(false);
        }
    };

    const orgOwned = Boolean(selected?.scope?.organizationId);
    const clone = async () => { const data = await rulePacksApi.clone(selected._id, { name: `${selected.name} — organization copy` }); setMessage('Editable organization copy created.'); await load(); await select(data.pack._id); };
    const save = async () => { try { const rules = JSON.parse(rulesText); const data = await rulePacksApi.update(selected._id, { name: selected.name, description: selected.description, effectiveFrom: selected.effectiveFrom, rules, sources: selected.sources, changeNotes: selected.changeNotes }); setSelected(data.pack); setValidation(data.validation); setMessage('Draft saved.'); await load(); } catch (error: any) { setErrorMessage(getApiErrorMessage(error, 'Rules must be valid JSON.')); } };
    const validate = async () => { try { const data = await rulePacksApi.validate(selected._id); setValidation(data); setSelected(data.pack); setMessage('Validation passed.'); await load(); } catch (error: any) { setValidation(error?.response?.data); setErrorMessage(getApiErrorMessage(error, 'Validation found issues that must be corrected.')); } };
    const publish = async () => { if (!window.confirm('Confirm jurisdictional review and publish this immutable version?')) return; const data = await rulePacksApi.publish(selected._id, { confirmReviewed: true, reviewedBy: 'Organization rule-pack reviewer' }); setSelected(data.pack); setMessage('Rule pack published and selected for new calculations. Approved history was not changed.'); await load(); };
    const simulate = async () => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start.getTime() + 6 * 86400000); const clockIn = new Date(start); clockIn.setHours(9); const clockOut = new Date(start); clockOut.setHours(18); const data = await rulePacksApi.simulate(selected._id, { startDate: start, endDate: end, timezone: 'UTC', entries: [{ entryType: 'clock_in', timestamp: clockIn }, { entryType: 'clock_out', timestamp: clockOut }] }); setSimulation(data); };
    const compare = async (id: string) => { setCompareId(id); if (!id) return setComparison(null); const data = await rulePacksApi.get(id); setComparison(data); };
    const correctionRun = async () => {
        const periodStart = window.prompt('Correction period start (YYYY-MM-DD)'); const periodEnd = window.prompt('Correction period end (YYYY-MM-DD)');
        const reason = window.prompt('Why should approved history be recalculated? This will create new adjustment versions.');
        if (!periodStart || !periodEnd || !reason) return;
        await correctionRunsApi.create({ type: 'rule_change', periodStart, periodEnd, reason, rulePackId: selected._id });
        setMessage('Audited correction run queued. Existing approved and payroll versions remain unchanged.');
    };

    return <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-2xl font-semibold text-white">Rule Pack Studio</h1><p className="mt-1 text-sm text-zinc-400">Configure, test, review, and publish the working-time rules used in attendance calculations.</p></div>
            <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800"><Plus className="h-4 w-4" />New custom pack</button>
        </div>
        {message && <div role="status" className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">{message}</div>}
        {errorMessage && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{errorMessage}</div>}

        {loading ? <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{seeding ? 'Adding baseline templates…' : 'Loading rule packs…'}</div> : packs.length === 0 ?
            <EmptyState onSeed={seedDefaults} onCreate={() => setCreateOpen(true)} seeding={seeding} /> :
            <div className="grid min-h-[680px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 lg:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="border-b border-zinc-800 lg:border-b-0 lg:border-r">
                    <div className="border-b border-zinc-800 px-4 py-3"><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Available packs</div><div className="mt-1 text-xs text-zinc-600">{packs.length} version{packs.length === 1 ? '' : 's'} available</div></div>
                    <div className="max-h-[640px] overflow-y-auto p-2">{packs.map(pack => <button key={pack._id} onClick={() => select(pack._id)} className={`mb-1 w-full rounded-lg px-3 py-3 text-left ${selected?._id === pack._id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}><div className="flex items-start justify-between gap-2"><div className="text-sm font-medium">{pack.name}</div><span className="text-[10px] uppercase text-zinc-500">v{pack.version}</span></div><div className="mt-1 flex gap-2 text-xs text-zinc-600"><span>{pack.jurisdiction?.countryCode || pack.jurisdiction?.regionCode || 'Global'}</span><span>·</span><span>{pack.status}</span></div></button>)}</div>
                </aside>
                {selected ? <main className="p-5 lg:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><Scale className="h-5 w-5 text-teal-400" /><h2 className="text-lg font-semibold text-white">{selected.name}</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{selected.description || selected.changeNotes || 'No description supplied.'}</p><div className="mt-2 text-xs text-zinc-600">{selected.key} · version {selected.version} · {selected.status} · effective {new Date(selected.effectiveFrom).toLocaleDateString()}</div></div><div className="flex flex-wrap gap-2">{!orgOwned ? <button onClick={clone} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500"><Copy className="h-4 w-4" />Clone to edit</button> : <><button onClick={save} disabled={selected.status === 'published'} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40"><Save className="h-4 w-4" />Save</button><button onClick={validate} disabled={selected.status === 'published'} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Validate</button><button onClick={publish} disabled={!['validated', 'draft'].includes(selected.status)} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><Send className="h-4 w-4" />Publish</button></>}</div></div>
                    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"><div><label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rules JSON</label><textarea value={rulesText} onChange={event => setRulesText(event.target.value)} readOnly={!orgOwned || selected.status === 'published'} spellCheck={false} className="mt-2 h-[430px] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-200 read-only:text-zinc-500" />{validation && <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${validation.valid ? 'border-teal-500/30 bg-teal-500/10 text-teal-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{validation.valid ? 'Schema and rule validation passed.' : (validation.errors || []).map((error: any) => error.message || error).join(' · ')}</div>}</div>
                        <aside className="space-y-5"><div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"><h3 className="text-sm font-semibold text-white">Impact preview</h3><p className="mt-1 text-xs leading-5 text-zinc-500">Runs a sample 09:00–18:00 day through this exact version. It never writes timesheets.</p><button onClick={simulate} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-teal-400"><Beaker className="h-4 w-4" />Run simulation</button>{simulation && <div className="mt-3 text-xs leading-5 text-zinc-400">Regular: {simulation.result?.totals?.regularHours ?? 0}h<br />Overtime: {simulation.result?.totals?.overtimeHours ?? 0}h<br />Exceptions: {simulation.result?.totals?.exceptionCount ?? simulation.result?.dailyEntries?.flatMap((day: any) => day.exceptions || []).length ?? 0}</div>}</div>
                            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"><h3 className="text-sm font-semibold text-white">Compare effective rules</h3><select value={compareId} onChange={event => compare(event.target.value)} className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"><option value="">Choose another pack</option>{packs.filter(pack => pack._id !== selected._id).map(pack => <option key={pack._id} value={pack._id}>{pack.name} v{pack.version}</option>)}</select>{comparison && <div className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-zinc-500">{JSON.stringify(comparison.resolved?.rules || {}, null, 2)}</div>}</div>
                            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"><h3 className="text-sm font-semibold text-white">Sources and review</h3><div className="mt-3 space-y-3">{selected.sources?.length ? selected.sources.map((source: any, index: number) => <div key={index} className="text-xs text-zinc-400">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-400 hover:underline">{source.title}<ExternalLink className="h-3 w-3" /></a> : source.title}<p className="mt-1 leading-5 text-zinc-600">{source.note}</p></div>) : <p className="text-xs text-amber-300">No source references. Add current authoritative sources before validation.</p>}</div><p className="mt-4 border-t border-zinc-800 pt-3 text-[11px] leading-5 text-zinc-600">Seeded packs are implementation templates. Publication requires documented jurisdictional review. Approved history is never recalculated automatically.</p>{selected.status === 'published' && orgOwned && <button onClick={correctionRun} className="mt-3 text-xs font-medium text-amber-300 hover:text-amber-200">Launch audited history correction…</button>}</div></aside></div>
                </main> : <div className="flex items-center justify-center p-12 text-sm text-zinc-500">Choose a rule pack.</div>}
            </div>}
        {createOpen && <CreateDialog form={form} setForm={setForm} creating={creating} onClose={() => setCreateOpen(false)} onSubmit={createPack} />}
    </div>;
}

function EmptyState({ onSeed, onCreate, seeding }: { onSeed: () => void; onCreate: () => void; seeding: boolean }) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-12">
        <div className="mx-auto max-w-xl text-center"><Scale className="mx-auto h-9 w-9 text-zinc-500" /><h2 className="mt-4 text-lg font-semibold text-white">No rule packs available</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Add the baseline catalog for Nigeria, the United Kingdom, the EU baseline and 27 member-state overlays, or create an organization-specific pack from scratch.</p><div className="mt-5 flex flex-wrap justify-center gap-3"><button onClick={onSeed} disabled={seeding} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}Add baseline templates</button><button onClick={onCreate} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200"><Plus className="h-4 w-4" />Create custom pack</button></div></div>
        <div className="mx-auto mt-10 max-w-2xl border-t border-zinc-800 pt-6"><h3 className="text-sm font-semibold text-zinc-200">How to set up attendance rules</h3><ol className="mt-3 grid gap-3 text-sm text-zinc-400 sm:grid-cols-2"><li><span className="mr-2 text-zinc-600">1.</span>Add a baseline or custom draft.</li><li><span className="mr-2 text-zinc-600">2.</span>Clone templates before editing.</li><li><span className="mr-2 text-zinc-600">3.</span>Add sources, validate, and simulate.</li><li><span className="mr-2 text-zinc-600">4.</span>Complete legal review, then publish.</li></ol><p className="mt-5 text-xs leading-5 text-zinc-600">Templates are deliberately unpublished. They are configuration starting points and require review for the organization and jurisdiction before use.</p></div>
    </div>;
}

function CreateDialog({ form, setForm, creating, onClose, onSubmit }: any) {
    const inputClass = 'mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-500';
    const needsCode = form.jurisdictionKind !== 'global';
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="create-rule-pack-title">
        <form onSubmit={onSubmit} className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4"><div><h2 id="create-rule-pack-title" className="text-lg font-semibold text-white">Create custom rule pack</h2><p className="mt-1 text-sm text-zinc-400">Starts as an editable organization draft with safe default working-time values.</p></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-sm text-zinc-300">Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value, key: slugify(event.target.value) })} placeholder="Nigeria office rules" className={inputClass} /></label>
                <label className="text-sm text-zinc-300">Key<input required value={form.key} onChange={event => setForm({ ...form, key: slugify(event.target.value) })} placeholder="nigeria-office-rules" className={inputClass} /><span className="mt-1 block text-xs text-zinc-600">Permanent identifier; lowercase letters, numbers, and hyphens.</span></label>
                <label className="text-sm text-zinc-300">Jurisdiction<select value={form.jurisdictionKind} onChange={event => setForm({ ...form, jurisdictionKind: event.target.value, jurisdictionCode: '' })} className={inputClass}><option value="country">Country</option><option value="regional">Region</option><option value="subdivision">State or subdivision</option><option value="global">Global</option></select></label>
                {needsCode ? <label className="text-sm text-zinc-300">{form.jurisdictionKind === 'country' ? 'ISO country code' : form.jurisdictionKind === 'regional' ? 'Region code' : 'ISO subdivision code'}<input required value={form.jurisdictionCode} onChange={event => setForm({ ...form, jurisdictionCode: event.target.value.toUpperCase() })} placeholder={form.jurisdictionKind === 'country' ? 'NG' : form.jurisdictionKind === 'regional' ? 'EU' : 'GB-ENG'} className={inputClass} /></label> : <div />}
                <label className="text-sm text-zinc-300">Effective from<input required type="date" value={form.effectiveFrom} onChange={event => setForm({ ...form, effectiveFrom: event.target.value })} className={inputClass} /></label>
                <label className="text-sm text-zinc-300">Authoritative source title<input required value={form.sourceTitle} onChange={event => setForm({ ...form, sourceTitle: event.target.value })} placeholder="Working Time Regulations" className={inputClass} /></label>
                <label className="text-sm text-zinc-300 sm:col-span-2">Source URL<input type="url" value={form.sourceUrl} onChange={event => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://…" className={inputClass} /></label>
                <label className="text-sm text-zinc-300 sm:col-span-2">Description<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Who this pack applies to and what it covers" className={inputClass} /></label>
            </div>
            <div className="flex justify-end gap-3 border-t border-zinc-800 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300">Cancel</button><button type="submit" disabled={creating} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{creating && <Loader2 className="h-4 w-4 animate-spin" />}Create draft</button></div>
        </form>
    </div>;
}
