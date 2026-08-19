'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Beaker, CheckCircle2, ChevronDown, Copy, ExternalLink, FilePlus2, Loader2, Plus, Save, Scale, Send, Users, X } from 'lucide-react';
import { correctionRunsApi, rulePacksApi } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/apiError';

const STARTING_RULES: any = {
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
const DAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]] as const;
const inputClass = 'mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:opacity-50';

function slugify(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function dateValue(value?: string) {
    return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function assignmentMode(pack: any) {
    if (pack?.scope?.userId) return 'employee';
    if (pack?.scope?.teamId) return 'team';
    if (pack?.scope?.locationId) return 'location';
    if (pack?.jurisdiction?.kind === 'subdivision') return 'subdivision';
    if (pack?.jurisdiction?.kind === 'country') return 'country';
    return 'organization';
}

function assignmentLabel(pack: any, options: any) {
    const mode = assignmentMode(pack);
    if (mode === 'employee') return options.people?.find((person: any) => person.userId === pack.scope.userId)?.name || pack.scope.userId;
    if (mode === 'team') return options.teams?.find((team: any) => team.id === pack.scope.teamId)?.name || pack.scope.teamId;
    if (mode === 'location') return pack.scope.locationId;
    if (mode === 'subdivision') return pack.jurisdiction?.subdivisionCode;
    if (mode === 'country') return pack.jurisdiction?.countryCode;
    return pack?.scope?.organizationId ? 'Everyone in the organization' : 'Global baseline';
}

export default function RulePackStudioPage() {
    const [packs, setPacks] = useState<any[]>([]);
    const [selected, setSelected] = useState<any>(null);
    const [rules, setRules] = useState<any>(STARTING_RULES);
    const [jsonDraft, setJsonDraft] = useState('{}');
    const [options, setOptions] = useState<any>({ people: [], teams: [] });
    const [coverage, setCoverage] = useState<any[] | null>(null);
    const selectedId = useRef('');
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [validation, setValidation] = useState<any>(null);
    const [simulation, setSimulation] = useState<any>(null);
    const [compareId, setCompareId] = useState('');
    const [comparison, setComparison] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [seeding, setSeeding] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const select = useCallback(async (id: string) => {
        const data = await rulePacksApi.get(id);
        selectedId.current = id;
        setSelected(data.pack);
        const nextRules = data.pack.rules || {};
        setRules(nextRules);
        setJsonDraft(JSON.stringify(nextRules, null, 2));
        setValidation(null);
        setSimulation(null);
        setCompareId('');
        setComparison(null);
    }, []);

    const load = useCallback(async (seedIfEmpty = false) => {
        setLoading(true);
        setErrorMessage('');
        try {
            let data = await rulePacksApi.list();
            if (!data.packs?.length && seedIfEmpty) {
                setSeeding(true);
                await rulePacksApi.seedDefaults();
                data = await rulePacksApi.list();
                setMessage('Baseline templates were added. Clone one before adapting it for your organization.');
            }
            const nextPacks = data.packs || [];
            setPacks(nextPacks);
            if (!nextPacks.some((pack: any) => pack._id === selectedId.current) && nextPacks.length) await select(nextPacks[0]._id);
            if (!nextPacks.length) { selectedId.current = ''; setSelected(null); }
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error, 'Rule packs could not be loaded.'));
        } finally {
            setLoading(false);
            setSeeding(false);
        }
    }, [select]);

    useEffect(() => {
        void load(true);
        rulePacksApi.assignmentOptions().then(setOptions).catch(error => setErrorMessage(getApiErrorMessage(error, 'Employees and teams could not be loaded.')));
    }, [load]);

    const editSelected = (changes: any) => setSelected((current: any) => ({ ...current, ...changes }));
    const updateRule = (section: string, key: string, value: any) => setRules((current: any) => ({ ...current, [section]: { ...(current[section] || {}), [key]: value } }));
    const orgOwned = Boolean(selected?.scope?.organizationId);
    const editable = orgOwned && selected?.status !== 'published';

    const setAssignment = (mode: string) => {
        const scope: any = { organizationId: selected.scope.organizationId };
        const jurisdiction: any = { kind: 'global' };
        if (mode === 'employee') scope.userId = options.people?.[0]?.userId || '';
        if (mode === 'team') scope.teamId = options.teams?.[0]?.id || '';
        if (mode === 'country') Object.assign(jurisdiction, { kind: 'country', countryCode: selected.jurisdiction?.countryCode || '' });
        if (mode === 'subdivision') Object.assign(jurisdiction, { kind: 'subdivision', subdivisionCode: selected.jurisdiction?.subdivisionCode || '' });
        editSelected({ scope, jurisdiction });
    };

    const createPack = async (event: React.FormEvent) => {
        event.preventDefault(); setCreating(true); setErrorMessage('');
        try {
            const code = form.jurisdictionCode.trim().toUpperCase();
            const jurisdiction: any = { kind: form.jurisdictionKind };
            if (form.jurisdictionKind === 'country') jurisdiction.countryCode = code;
            if (form.jurisdictionKind === 'regional') jurisdiction.regionCode = code;
            if (form.jurisdictionKind === 'subdivision') jurisdiction.subdivisionCode = code;
            const data = await rulePacksApi.create({
                key: form.key || slugify(form.name), name: form.name, description: form.description,
                jurisdiction, effectiveFrom: form.effectiveFrom, rules: STARTING_RULES,
                sources: [{ title: form.sourceTitle, url: form.sourceUrl || undefined }], reviewRequired: true,
                changeNotes: 'Custom organization draft created in Rule Pack Studio.',
            });
            setCreateOpen(false); setForm(EMPTY_FORM); setMessage('Custom draft created. Set who it applies to, review the rules, then validate and publish.');
            await load(); await select(data.pack._id);
        } catch (error) { setErrorMessage(getApiErrorMessage(error, 'The custom rule pack could not be created.')); }
        finally { setCreating(false); }
    };

    const clone = async () => {
        try {
            const data = await rulePacksApi.clone(selected._id, { name: `${selected.name} — organization copy` });
            setMessage('Editable organization copy created.'); await load(); await select(data.pack._id);
        } catch (error) { setErrorMessage(getApiErrorMessage(error, 'The rule pack could not be cloned.')); }
    };
    const save = async () => {
        setErrorMessage('');
        try {
            const data = await rulePacksApi.update(selected._id, {
                name: selected.name, description: selected.description, scope: selected.scope,
                jurisdiction: selected.jurisdiction, effectiveFrom: selected.effectiveFrom,
                effectiveTo: selected.effectiveTo || null, rules, sources: selected.sources, changeNotes: selected.changeNotes,
            });
            setSelected(data.pack); setRules(data.pack.rules || {}); setValidation(data.validation); setMessage('Draft saved.'); await load();
        } catch (error) { setErrorMessage(getApiErrorMessage(error, 'The draft could not be saved.')); }
    };
    const validate = async () => {
        try { const data = await rulePacksApi.validate(selected._id); setValidation(data); setSelected(data.pack); setMessage('Validation passed.'); await load(); }
        catch (error: any) { setValidation(error?.response?.data); setErrorMessage(getApiErrorMessage(error, 'Validation found issues that must be corrected.')); }
    };
    const publish = async () => {
        if (!window.confirm('Confirm jurisdictional review and publish this immutable version?')) return;
        try { const data = await rulePacksApi.publish(selected._id, { confirmReviewed: true, reviewedBy: 'Organization rule-pack reviewer' }); setSelected(data.pack); setMessage(`Published for ${assignmentLabel(data.pack, options)}. New calculations will use this assignment.`); await load(); }
        catch (error) { setErrorMessage(getApiErrorMessage(error, 'The rule pack could not be published.')); }
    };
    const simulate = async () => {
        try {
            const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start.getTime() + 6 * 86400000);
            const clockIn = new Date(start); clockIn.setHours(9); const clockOut = new Date(start); clockOut.setHours(18);
            setSimulation(await rulePacksApi.simulate(selected._id, { startDate: start, endDate: end, timezone: 'UTC', entries: [{ entryType: 'clock_in', timestamp: clockIn }, { entryType: 'clock_out', timestamp: clockOut }] }));
        } catch (error) { setErrorMessage(getApiErrorMessage(error, 'The simulation could not be run.')); }
    };
    const showCoverage = async () => {
        try { setCoverage((await rulePacksApi.coverage()).coverage || []); }
        catch (error) { setErrorMessage(getApiErrorMessage(error, 'Rule-pack coverage could not be calculated.')); }
    };
    const compare = async (id: string) => {
        setCompareId(id);
        if (!id) return setComparison(null);
        try { setComparison(await rulePacksApi.get(id)); }
        catch (error) { setErrorMessage(getApiErrorMessage(error, 'The comparison rule pack could not be loaded.')); }
    };
    const applyJson = () => {
        try { const next = JSON.parse(jsonDraft); setRules(next); setMessage('Advanced JSON applied to the draft. Save to persist it.'); }
        catch { setErrorMessage('Advanced rules must be valid JSON before they can be applied.'); }
    };
    const correctionRun = async () => {
        const periodStart = window.prompt('Correction period start (YYYY-MM-DD)'); const periodEnd = window.prompt('Correction period end (YYYY-MM-DD)');
        const reason = window.prompt('Why should approved history be recalculated? This will create new adjustment versions.');
        if (!periodStart || !periodEnd || !reason) return;
        await correctionRunsApi.create({ type: 'rule_change', periodStart, periodEnd, reason, rulePackId: selected._id });
        setMessage('Audited correction run queued. Existing approved and payroll versions remain unchanged.');
    };

    return <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-2xl font-semibold text-white">Rule Pack Studio</h1><p className="mt-1 text-sm text-zinc-400">Set working-time rules and assign them to an organization, country, team, or employee.</p></div>
            <div className="flex gap-2"><button onClick={showCoverage} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"><Users className="h-4 w-4" />View coverage</button><button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"><Plus className="h-4 w-4" />New custom pack</button></div>
        </header>
        {message && <div role="status" className="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">{message}</div>}
        {errorMessage && <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{errorMessage}</div>}
        {coverage && <CoverageTable coverage={coverage} packs={packs} onClose={() => setCoverage(null)} />}

        {loading ? <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{seeding ? 'Adding baseline templates…' : 'Loading rule packs…'}</div> : packs.length === 0 ?
            <EmptyState onSeed={() => void load(true)} onCreate={() => setCreateOpen(true)} seeding={seeding} /> :
            <div className="grid min-h-[680px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 lg:grid-cols-[290px_minmax(0,1fr)]">
                <aside className="border-b border-zinc-800 lg:border-b-0 lg:border-r">
                    <div className="border-b border-zinc-800 px-4 py-3"><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Available packs</div><div className="mt-1 text-xs text-zinc-600">Most specific assignment wins</div></div>
                    <div className="max-h-[720px] overflow-y-auto p-2">{packs.map(pack => <button key={pack._id} onClick={() => select(pack._id)} className={`mb-1 w-full rounded-md px-3 py-3 text-left ${selected?._id === pack._id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}><div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{pack.name}</span><span className="text-[10px] uppercase text-zinc-500">v{pack.version}</span></div><div className="mt-1 text-xs text-zinc-600">{assignmentLabel(pack, options)} · {pack.status}</div></button>)}</div>
                </aside>
                {selected ? <main className="p-5 lg:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Scale className="h-5 w-5 text-teal-400" /><h2 className="text-lg font-semibold text-white">{selected.name}</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{selected.description || selected.changeNotes || 'No description supplied.'}</p><p className="mt-2 text-xs text-zinc-600">{selected.key} · version {selected.version} · {selected.status}</p></div><div className="flex flex-wrap gap-2">{!orgOwned ? <button onClick={clone} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500"><Copy className="h-4 w-4" />Clone to edit</button> : <><button onClick={save} disabled={!editable} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40"><Save className="h-4 w-4" />Save</button><button onClick={validate} disabled={!editable} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Validate</button><button onClick={publish} disabled={!editable} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"><Send className="h-4 w-4" />Publish</button></>}</div></div>
                    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="space-y-5">
                            <AssignmentEditor pack={selected} options={options} editable={editable} onMode={setAssignment} onChange={editSelected} />
                            <RuleEditor rules={rules} editable={editable} updateRule={updateRule} setRules={setRules} />
                            <details className="rounded-md border border-zinc-800 bg-zinc-950/30" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setJsonDraft(JSON.stringify(rules, null, 2)); }}><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300">Advanced JSON <ChevronDown className="h-4 w-4 text-zinc-500" /></summary><div className="border-t border-zinc-800 p-4"><p className="mb-3 text-xs leading-5 text-zinc-500">For technical administrators who need fields not yet available above.</p><textarea aria-label="Advanced rules JSON" value={jsonDraft} onChange={event => setJsonDraft(event.target.value)} readOnly={!editable} spellCheck={false} className="h-72 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 read-only:text-zinc-500" />{editable && <button onClick={applyJson} className="mt-3 rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200">Apply JSON</button>}</div></details>
                            {validation && <div className={`rounded-md border px-3 py-2 text-xs ${validation.valid ? 'border-teal-500/30 bg-teal-500/10 text-teal-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{validation.valid ? 'Schema and rule validation passed.' : (validation.errors || []).map((item: any) => item.message || item).join(' · ')}</div>}
                        </div>
                        <aside className="space-y-5"><InfoPanel title="Impact preview"><p>Runs a sample 09:00–18:00 day through this version without writing timesheets.</p><button onClick={simulate} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-teal-400"><Beaker className="h-4 w-4" />Run simulation</button>{simulation && <div className="mt-3 text-xs leading-5 text-zinc-400">Regular: {simulation.result?.totals?.regularHours ?? 0}h<br />Overtime: {simulation.result?.totals?.overtimeHours ?? 0}h</div>}</InfoPanel><InfoPanel title="Compare effective rules"><select aria-label="Compare with" value={compareId} onChange={event => void compare(event.target.value)} className={inputClass}><option value="">Choose another pack</option>{packs.filter(pack => pack._id !== selected._id).map(pack => <option key={pack._id} value={pack._id}>{pack.name} v{pack.version}</option>)}</select>{comparison && <div className="mt-3 border-t border-zinc-800 pt-3 text-zinc-400"><div>{comparison.pack.name}</div><div className="mt-1 text-zinc-600">Work week: {comparison.resolved?.rules?.work?.standardHoursPerWeek ?? 'Not set'} hours</div><div className="text-zinc-600">Overtime after: {comparison.resolved?.rules?.overtime?.weeklyThresholdHours ?? 'Not set'} hours</div></div>}</InfoPanel><InfoPanel title="Sources and review">{selected.sources?.length ? selected.sources.map((source: any, index: number) => <div key={index} className="mb-3 text-xs text-zinc-400">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-400 hover:underline">{source.title}<ExternalLink className="h-3 w-3" /></a> : source.title}</div>) : <p className="text-amber-300">No source references. Add one before validation.</p>}<p className="border-t border-zinc-800 pt-3 text-[11px] leading-5 text-zinc-600">Published versions are immutable. New assignments affect new calculations only.</p>{selected.status === 'published' && orgOwned && <button onClick={correctionRun} className="mt-3 text-xs font-medium text-amber-300">Launch audited history correction…</button>}</InfoPanel></aside>
                    </div>
                </main> : null}
            </div>}
        {createOpen && <CreateDialog form={form} setForm={setForm} creating={creating} onClose={() => setCreateOpen(false)} onSubmit={createPack} />}
    </div>;
}

function AssignmentEditor({ pack, options, editable, onMode, onChange }: any) {
    const mode = assignmentMode(pack);
    return <section className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold text-white">Assignment</h3><p className="mt-1 text-xs leading-5 text-zinc-500">Employee overrides team, then subdivision, country, organization, and global defaults.</p></div><span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400">{assignmentLabel(pack, options)}</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-zinc-300">Applies to<select aria-label="Applies to" value={mode} disabled={!editable} onChange={event => onMode(event.target.value)} className={inputClass}><option value="organization">Everyone in organization</option><option value="country">Country</option><option value="subdivision">State or subdivision</option><option value="team">Team</option><option value="employee">Employee</option></select></label>
        {mode === 'employee' && <label className="text-sm text-zinc-300">Employee<select value={pack.scope?.userId || ''} disabled={!editable} onChange={event => onChange({ scope: { organizationId: pack.scope.organizationId, userId: event.target.value } })} className={inputClass}><option value="">Choose an employee</option>{options.people?.map((person: any) => <option key={person.userId} value={person.userId}>{person.name || person.email} ({person.email})</option>)}</select></label>}
        {mode === 'team' && <label className="text-sm text-zinc-300">Team<select value={pack.scope?.teamId || ''} disabled={!editable} onChange={event => onChange({ scope: { organizationId: pack.scope.organizationId, teamId: event.target.value } })} className={inputClass}><option value="">Choose a team</option>{options.teams?.map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        {mode === 'country' && <label className="text-sm text-zinc-300">ISO country code<input value={pack.jurisdiction?.countryCode || ''} disabled={!editable} onChange={event => onChange({ jurisdiction: { kind: 'country', countryCode: event.target.value.toUpperCase() } })} placeholder="AU" className={inputClass} /></label>}
        {mode === 'subdivision' && <label className="text-sm text-zinc-300">ISO subdivision code<input value={pack.jurisdiction?.subdivisionCode || ''} disabled={!editable} onChange={event => onChange({ jurisdiction: { kind: 'subdivision', subdivisionCode: event.target.value.toUpperCase() } })} placeholder="AU-NSW" className={inputClass} /></label>}
        <label className="text-sm text-zinc-300">Effective from<input type="date" value={dateValue(pack.effectiveFrom)} disabled={!editable} onChange={event => onChange({ effectiveFrom: event.target.value })} className={inputClass} /></label><label className="text-sm text-zinc-300">Effective until <span className="text-zinc-600">(optional)</span><input type="date" value={dateValue(pack.effectiveTo)} disabled={!editable} onChange={event => onChange({ effectiveTo: event.target.value || null })} className={inputClass} /></label>
    </div></section>;
}

function RuleEditor({ rules, editable, updateRule, setRules }: any) {
    const number = (section: string, key: string) => (event: React.ChangeEvent<HTMLInputElement>) => updateRule(section, key, Number(event.target.value));
    const field = (label: string, section: string, key: string, suffix?: string) => <label className="text-sm text-zinc-300">{label}<div className="relative"><input type="number" min="0" value={rules[section]?.[key] ?? ''} disabled={!editable} onChange={number(section, key)} className={`${inputClass} ${suffix ? 'pr-14' : ''}`} />{suffix && <span className="absolute bottom-2.5 right-3 text-xs text-zinc-600">{suffix}</span>}</div></label>;
    return <div className="space-y-4"><section className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-sm font-semibold text-white">Working schedule</h3><div className="mt-4 grid gap-4 sm:grid-cols-3">{field('Hours per day', 'work', 'standardHoursPerDay', 'hours')}{field('Hours per week', 'work', 'standardHoursPerWeek', 'hours')}{field('Maximum per week', 'work', 'maximumHoursPerWeek', 'hours')}<label className="text-sm text-zinc-300">Default start<input type="time" value={rules.work?.defaultStartTime || ''} disabled={!editable} onChange={event => updateRule('work', 'defaultStartTime', event.target.value)} className={inputClass} /></label><label className="text-sm text-zinc-300">Default end<input type="time" value={rules.work?.defaultEndTime || ''} disabled={!editable} onChange={event => updateRule('work', 'defaultEndTime', event.target.value)} className={inputClass} /></label></div><fieldset className="mt-4"><legend className="text-sm text-zinc-300">Working days</legend><div className="mt-2 flex flex-wrap gap-2">{DAYS.map(([label, value]) => { const checked = (rules.work?.workDays || []).includes(value); return <label key={value} className={`cursor-pointer rounded-md border px-3 py-2 text-xs ${checked ? 'border-teal-500/50 bg-teal-500/10 text-teal-200' : 'border-zinc-700 text-zinc-500'}`}><input type="checkbox" className="sr-only" checked={checked} disabled={!editable} onChange={() => setRules((current: any) => ({ ...current, work: { ...current.work, workDays: checked ? current.work.workDays.filter((day: number) => day !== value) : [...(current.work.workDays || []), value].sort() } }))} />{label}</label>; })}</div></fieldset></section>
        <section className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-sm font-semibold text-white">Breaks and rest</h3><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{field('Break required after', 'breaks', 'requiredAfterMinutes', 'minutes')}{field('Minimum break', 'breaks', 'minimumBreakMinutes', 'minutes')}{field('Daily rest', 'rest', 'minimumDailyRestMinutes', 'minutes')}{field('Weekly rest', 'rest', 'minimumWeeklyRestMinutes', 'minutes')}</div><Toggle label="Break is paid" checked={Boolean(rules.breaks?.paid)} disabled={!editable} onChange={(value: boolean) => updateRule('breaks', 'paid', value)} /></section>
        <section className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-sm font-semibold text-white">Overtime</h3><div className="mt-3 flex flex-wrap gap-6"><Toggle label="Calculate overtime" checked={Boolean(rules.overtime?.enabled)} disabled={!editable} onChange={(value: boolean) => updateRule('overtime', 'enabled', value)} /><Toggle label="Approval required" checked={Boolean(rules.overtime?.requiresApproval)} disabled={!editable} onChange={(value: boolean) => updateRule('overtime', 'requiresApproval', value)} /></div><div className="mt-4 grid gap-4 sm:grid-cols-3">{field('Daily threshold', 'overtime', 'dailyThresholdHours', 'hours')}{field('Weekly threshold', 'overtime', 'weeklyThresholdHours', 'hours')}{field('Pay multiplier', 'overtime', 'multiplier', '×')}</div></section>
        <section className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4"><h3 className="text-sm font-semibold text-white">Clocking and exceptions</h3><Toggle label="Round clock times" checked={Boolean(rules.rounding?.enabled)} disabled={!editable} onChange={(value: boolean) => updateRule('rounding', 'enabled', value)} /><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{field('Rounding increment', 'rounding', 'incrementMinutes', 'minutes')}<label className="text-sm text-zinc-300">Rounding direction<select value={rules.rounding?.mode || 'nearest'} disabled={!editable} onChange={event => updateRule('rounding', 'mode', event.target.value)} className={inputClass}><option value="nearest">Nearest</option><option value="up">Up</option><option value="down">Down</option></select></label>{field('Late arrival grace', 'exceptions', 'lateGraceMinutes', 'minutes')}{field('Early departure grace', 'exceptions', 'earlyDepartureGraceMinutes', 'minutes')}{field('Long break threshold', 'exceptions', 'longBreakAfterMinutes', 'minutes')}{field('Attendance retention', 'retention', 'attendanceDays', 'days')}</div></section>
    </div>;
}

function Toggle({ label, checked, disabled, onChange }: any) { return <label className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-teal-500" />{label}</label>; }
function InfoPanel({ title, children }: any) { return <section className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs leading-5 text-zinc-500"><h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>{children}</section>; }

function CoverageTable({ coverage, packs, onClose }: any) {
    const names = new Map<string, string>(packs.map((pack: any) => [String(pack._id), String(pack.name)]));
    return <section className="rounded-md border border-zinc-700 bg-zinc-900"><div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3"><div><h2 className="text-sm font-semibold text-white">Employee rule coverage</h2><p className="mt-1 text-xs text-zinc-500">The effective published rule pack for each active employee.</p></div><button onClick={onClose} aria-label="Close coverage"><X className="h-4 w-4 text-zinc-500" /></button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="px-4 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Jurisdiction</th><th className="px-4 py-3 font-medium">Effective rule pack</th></tr></thead><tbody>{coverage.map((row: any) => <tr key={row.userId} className="border-t border-zinc-800"><td className="px-4 py-3 text-zinc-200">{row.name || row.email}<div className="text-xs text-zinc-600">{row.email}</div></td><td className="px-4 py-3 text-zinc-400">{row.jurisdiction?.subdivisionCode || row.jurisdiction?.countryCode || 'Not set'}</td><td className="px-4 py-3 text-zinc-300">{row.effectiveRulePack ? names.get(String(row.effectiveRulePack.id)) || `${row.effectiveRulePack.key} v${row.effectiveRulePack.version}` : <span className="text-amber-300">No published pack</span>}</td></tr>)}</tbody></table>{coverage.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">No active employees were found in the roster.</p>}</div></section>;
}

function EmptyState({ onSeed, onCreate, seeding }: any) { return <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center"><Scale className="mx-auto h-9 w-9 text-zinc-500" /><h2 className="mt-4 text-lg font-semibold text-white">No rule packs available</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">Add the baseline catalog or create an organization-specific pack.</p><div className="mt-5 flex justify-center gap-3"><button onClick={onSeed} disabled={seeding} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}Add baseline templates</button><button onClick={onCreate} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200">Create custom pack</button></div></div>; }

function CreateDialog({ form, setForm, creating, onClose, onSubmit }: any) {
    const needsCode = form.jurisdictionKind !== 'global';
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="create-rule-pack-title"><form onSubmit={onSubmit} className="w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-900"><div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4"><div><h2 id="create-rule-pack-title" className="text-lg font-semibold text-white">Create custom rule pack</h2><p className="mt-1 text-sm text-zinc-400">Starts with standard working-time values that you can edit.</p></div><button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500"><X className="h-5 w-5" /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm text-zinc-300">Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value, key: slugify(event.target.value) })} className={inputClass} /></label><label className="text-sm text-zinc-300">Key<input required value={form.key} onChange={event => setForm({ ...form, key: slugify(event.target.value) })} className={inputClass} /></label><label className="text-sm text-zinc-300">Jurisdiction<select value={form.jurisdictionKind} onChange={event => setForm({ ...form, jurisdictionKind: event.target.value, jurisdictionCode: '' })} className={inputClass}><option value="country">Country</option><option value="regional">Region</option><option value="subdivision">State or subdivision</option><option value="global">Global</option></select></label>{needsCode ? <label className="text-sm text-zinc-300">{form.jurisdictionKind === 'country' ? 'ISO country code' : form.jurisdictionKind === 'regional' ? 'Region code' : 'ISO subdivision code'}<input required value={form.jurisdictionCode} onChange={event => setForm({ ...form, jurisdictionCode: event.target.value.toUpperCase() })} className={inputClass} /></label> : <div />}<label className="text-sm text-zinc-300">Effective from<input required type="date" value={form.effectiveFrom} onChange={event => setForm({ ...form, effectiveFrom: event.target.value })} className={inputClass} /></label><label className="text-sm text-zinc-300">Authoritative source title<input required value={form.sourceTitle} onChange={event => setForm({ ...form, sourceTitle: event.target.value })} className={inputClass} /></label><label className="text-sm text-zinc-300 sm:col-span-2">Source URL<input type="url" value={form.sourceUrl} onChange={event => setForm({ ...form, sourceUrl: event.target.value })} className={inputClass} /></label><label className="text-sm text-zinc-300 sm:col-span-2">Description<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows={3} className={inputClass} /></label></div><div className="flex justify-end gap-3 border-t border-zinc-800 px-5 py-4"><button type="button" onClick={onClose} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300">Cancel</button><button type="submit" disabled={creating} className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{creating && <Loader2 className="h-4 w-4 animate-spin" />}Create draft</button></div></form></div>;
}
