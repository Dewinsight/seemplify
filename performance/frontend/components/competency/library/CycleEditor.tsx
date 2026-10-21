'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, MenuItem, Stack, Stepper, Step, StepLabel, TextField, Typography } from '@mui/material';
import { competencyRequest, newIdempotencyKey } from '@/lib/competency-api';
import { CompetencyPage, Surface, LoadingCompetency, CompetencyFailure, DeniedCompetency, useCompetencyBootstrap } from '../CompetencyPage';
import { ConfirmDialog, EditorActions, EditorError } from './EditorParts';
import api from '@/lib/api';
import CycleDesignBuilder, { type CycleDesign, type CycleTemplateSummary } from '@/components/appraisals/CycleDesignBuilder';
import Link from 'next/link';
import { key, sourceLabel, type SourceType } from './types';
type Config = Record<string, any>;
type Cycle = {
    includeApprovedGoals?: boolean;
    reviewMode: 'regular' | 'competency' | 'combined';
    cadence: { type: 'one_time' | 'periodic'; frequency?: string };
    regularTemplateId: string;
    workflowDefinition?: CycleDesign | null;
    id: string;
    revision: number;
    status: 'draft' | 'published';
    name: string;
    period: {
        start: string;
        end: string;
    };
    selectedInputTypes: SourceType[];
    frameworkVersionIds: string[];
    strategyVersionIds: string[];
    roleVersionIds: string[];
    scoringConfig: Config;
    rankingConfig: Config;
};
const scoring = () => ({ version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: {}, ratingScales: [], normalization: [], thresholds: [{ id: 'development', label: 'Development needed', minInclusive: 0, maxExclusive: 75 }, { id: 'suitable', label: 'Suitable', minInclusive: 75, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception', exceptionPolicy: 'retain_as_unscored' });
const blank: Cycle = { reviewMode: 'competency', cadence: { type: 'one_time' }, regularTemplateId: 'balanced_performance', id: '', revision: 1, status: 'draft', name: '', period: { start: '', end: '' }, selectedInputTypes: [], frameworkVersionIds: [], strategyVersionIds: [], roleVersionIds: [], scoringConfig: scoring(), rankingConfig: { enabled: false, scope: 'role', direction: 'desc', tieRule: 'competition', decimalPlaces: 2, measure: 'overallScore' } };
const numeric = (value: string) => value.trim() === '' ? null : Number(value);
export default function CycleEditor({ cycleId }: {
    cycleId?: string;
}) {
    const router = useRouter();
    const bootstrap = useCompetencyBootstrap();
    const manage = bootstrap.data?.capabilities.cycleManage;
    const record = useSWR<Cycle>(cycleId && manage ? `competency-cycle-${cycleId}` : null, () => competencyRequest<Cycle>('GET', `/cycles/${cycleId}`));
    const [draft, setDraft] = useState<Cycle>(blank);
    const [step, setStep] = useState(0);
    const [notice, setNotice] = useState('Unsaved draft');
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [removing, setRemoving] = useState<SourceType | null>(null);
    const [validation, setValidation] = useState<Config | null>(null);
    const [latest, setLatest] = useState<Cycle | null>(null);
    const loaded = useRef('');
    const requestKey = useRef(newIdempotencyKey());
    useEffect(() => { if (record.data && loaded.current !== cycleId) {
        setDraft({ ...blank, ...record.data, scoringConfig: { ...scoring(), ...record.data.scoringConfig }, rankingConfig: { ...blank.rankingConfig, ...record.data.rankingConfig } });
        loaded.current = cycleId || '';
        setNotice(record.data.status === 'published' ? 'Published configuration — read only' : 'Draft ready to edit');
    } }, [record.data, cycleId]);
    const [templates, setTemplates] = useState<CycleTemplateSummary[]>([]);
    useEffect(() => { api.get('/appraisals/cycle-templates').then(response => setTemplates(response.data.data || [])).catch(() => {}); }, []);
    const regularDesign = draft.workflowDefinition || templates.find(t => t.id === draft.regularTemplateId)?.design;
    useEffect(() => { if (!cycleId && bootstrap.data?.enabled === false) setDraft(previous => ({ ...previous, reviewMode: 'regular' })); }, [cycleId, bootstrap.data?.enabled]);
    const readonly = draft.status === 'published';
    const sourceRows = [...(bootstrap.data?.frameworks || []), ...(bootstrap.data?.strategies || []).map(s => ({ ...s, sourceType: 'strategy' as SourceType, name: s.title }))];
    const selectedSources = sourceRows.filter(s => [...draft.frameworkVersionIds, ...draft.strategyVersionIds].includes(s.versionId || s.id));
    const roles = bootstrap.data?.roles || [];
    const selectedRoles = roles.filter(r => draft.roleVersionIds.includes(r.versionId));
    const change = (v: Cycle) => { setDraft(v); setNotice('Unsaved changes'); setValidation(null); requestKey.current = newIdempotencyKey(); };
    const updateScoring = (patch: Config) => change({ ...draft, scoringConfig: { ...draft.scoringConfig, ...patch } });
    function toggleSource(source: SourceType, enabled: boolean) { if (!enabled) {
        setRemoving(source);
        return;
    } change({ ...draft, selectedInputTypes: [...draft.selectedInputTypes, source], scoringConfig: { ...draft.scoringConfig, inputWeights: { ...draft.scoringConfig.inputWeights, [source]: null } } }); }
    function removeSource() { if (!removing)
        return; const ids = sourceRows.filter(s => s.sourceType === removing).map(s => s.versionId || s.id); const weights = { ...draft.scoringConfig.inputWeights }; delete weights[removing]; change({ ...draft, selectedInputTypes: draft.selectedInputTypes.filter(s => s !== removing), frameworkVersionIds: draft.frameworkVersionIds.filter(id => !ids.includes(id)), strategyVersionIds: draft.strategyVersionIds.filter(id => !ids.includes(id)), scoringConfig: { ...draft.scoringConfig, inputWeights: weights, normalization: draft.scoringConfig.normalization.filter((n: Config) => !ids.includes(n.sourceVersionId)) } }); setRemoving(null); }
    function chooseVersions(source: SourceType, values: string[]) { const others = sourceRows.filter(s => s.sourceType !== source).map(s => s.versionId || s.id); const all = [...(source === 'strategy' ? draft.strategyVersionIds : draft.frameworkVersionIds).filter(id => others.includes(id)), ...values]; const before = draft.scoringConfig.normalization.filter((n: Config) => !sourceRows.some(s => s.sourceType === source && (s.versionId || s.id) === n.sourceVersionId) || values.includes(n.sourceVersionId)); const rules = [...before]; for (const id of values) {
        const row = sourceRows.find(s => (s.versionId || s.id) === id);
        for (const criterion of row?.criteria || []) {
            if (!rules.some((n: Config) => n.sourceVersionId === id && n.criterionId === criterion.id))
                rules.push({ sourceVersionId: id, criterionId: criterion.id, ...(criterion.levelIds.length ? { method: 'level_map', levelScores: {} } : { method: 'rating_scale', ratingScaleId: '' }) });
        }
    } change({ ...draft, ...(source === 'strategy' ? { strategyVersionIds: all } : { frameworkVersionIds: all }), scoringConfig: { ...draft.scoringConfig, normalization: rules } }); }
    async function save() { setBusy(true); setError(null); try {
        const revision = draft.revision;
        const body = Object.fromEntries(['includeApprovedGoals', 'reviewMode', 'cadence', 'regularTemplateId', 'workflowDefinition', 'name', 'period', 'selectedInputTypes', 'frameworkVersionIds', 'strategyVersionIds', 'roleVersionIds', 'scoringConfig', 'rankingConfig'].map(k => [k, (draft as unknown as Config)[k]]));
        const result = await competencyRequest<Cycle>(cycleId ? 'PATCH' : 'POST', cycleId ? `/cycles/${cycleId}` : '/cycles', body, cycleId ? revision : undefined, cycleId ? undefined : requestKey.current);
        setDraft({ ...draft, ...result });
        await record.mutate();
        setNotice('All changes saved');
        if (!cycleId)
            router.replace(`/competency/cycles/${result.id}`);
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } }
    async function check() { if (!cycleId)
        return; setBusy(true); setError(null); try {
        setValidation(await competencyRequest('POST', `/cycles/${cycleId}/validate`, {}));
        setNotice('Configuration is ready to publish');
    }
    catch (e) {
        setError(e);
        setValidation(null);
    }
    finally {
        setBusy(false);
    } }
    async function publish() { if (!cycleId)
        return; setBusy(true); setError(null); try {
        const result = await competencyRequest<Cycle>('POST', `/cycles/${cycleId}/publish`, {}, draft.revision, newIdempotencyKey());
        setDraft({ ...draft, ...result });
        await record.mutate();
        await bootstrap.mutate();
        setConfirm(false);
        setNotice('Cycle published. Select it when starting an appraisal.');
    }
    catch (e) {
        setError(e);
        setConfirm(false);
    }
    finally {
        setBusy(false);
    } }
    function normalization(index: number, patch: Config) { updateScoring({ normalization: draft.scoringConfig.normalization.map((n: Config, i: number) => i === index ? { ...n, ...patch } : n) }); }
    return <CompetencyPage title={cycleId ? draft.name || 'Appraisal cycle' : 'New appraisal cycle'} description="Set up regular appraisals, role competency reviews, or both. Choose whether this cycle runs once or repeats." action={readonly ? <Button component={Link} href={`/appraisals/start?assessmentCycleId=${cycleId}`} variant="contained">Start appraisals</Button> : undefined}>
    {bootstrap.isLoading || cycleId && record.isLoading ? <LoadingCompetency /> : bootstrap.error ? <CompetencyFailure error={bootstrap.error} retry={() => void bootstrap.mutate()}/> : !manage ? <DeniedCompetency /> : record.error ? <CompetencyFailure error={record.error} retry={() => void record.mutate()}/> : <>
      <EditorError error={error} draft={draft} reload={cycleId ? async () => setLatest(await competencyRequest('GET', `/cycles/${cycleId}`)) : undefined}/>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>{['Inputs & roles', 'Scoring', 'Outcomes', 'Review'].map((label, i) => <Step key={label}><StepLabel onClick={() => setStep(i)} sx={{ cursor: 'pointer' }}>{label}</StepLabel></Step>)}</Stepper>
      <Surface>

        {step === 0 && <Stack gap={2} mb={3}>
          <TextField select label="Review type" value={draft.reviewMode} disabled={readonly} onChange={e => { const mode = e.target.value as Cycle['reviewMode']; change({ ...draft, reviewMode: mode, ...(mode === 'regular' ? { selectedInputTypes: [], frameworkVersionIds: [], strategyVersionIds: [], roleVersionIds: [], scoringConfig: scoring(), rankingConfig: { enabled: false } } : {}) }); }}>
            <MenuItem value="regular">Regular appraisal</MenuItem><MenuItem value="competency" disabled={!bootstrap.data?.enabled}>Role competency</MenuItem><MenuItem value="combined" disabled={!bootstrap.data?.enabled}>Combined — appraisal and role competency</MenuItem>
          </TextField>
          <TextField select label="Schedule" value={draft.cadence.type} disabled={readonly} onChange={e => change({ ...draft, cadence: e.target.value === 'periodic' ? { type: 'periodic', frequency: 'quarterly' } : { type: 'one_time' } })} helperText="Periodic reviews reuse these expectations for each scheduled period. A manager starts each period when the work is complete.">
            <MenuItem value="one_time">One-time</MenuItem><MenuItem value="periodic">Periodic</MenuItem>
          </TextField>
          {draft.cadence.type === 'periodic' && <TextField select label="Repeat every" value={draft.cadence.frequency || 'quarterly'} disabled={readonly} onChange={e => change({ ...draft, cadence: { type: 'periodic', frequency: e.target.value } })}>
            <MenuItem value="monthly">Month</MenuItem><MenuItem value="quarterly">Quarter</MenuItem><MenuItem value="semi_annual">Six months</MenuItem><MenuItem value="annual">Year</MenuItem>
          </TextField>}
          {draft.reviewMode !== 'competency' && <><FormControlLabel control={<Checkbox checked={!!draft.includeApprovedGoals} disabled={readonly} onChange={e => change({ ...draft, includeApprovedGoals: e.target.checked })} />} label="Include approved goals" /><Typography variant="body2" color="text.secondary">When included, each participant needs approved goals for the review period before launch.</Typography><TextField select label="Regular appraisal template" value={draft.regularTemplateId} disabled={readonly} onChange={e => change({ ...draft, regularTemplateId: e.target.value, workflowDefinition: null })}>
            {templates.filter(t => ['balanced_performance', 'quarterly_checkpoint', 'probation_review'].includes(t.id)).map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </TextField>{regularDesign && <CycleDesignBuilder readOnly={readonly} design={regularDesign} canSaveTemplate={false} onTemplateChange={() => {}} showTemplatePicker={false} showStages={false} onChange={value => change({ ...draft, workflowDefinition: value })} />}</>}
        </Stack>}
        {draft.reviewMode === 'regular' && (step === 1 || step === 2) && <Alert severity="info">This review uses the appraisal template's questions and scoring. Choose Combined to add framework-based role assessment.</Alert>}
        {step === 0 && <Stack gap={3}><Chip size="small" sx={{ alignSelf: 'flex-start' }} label={readonly ? 'Published' : 'Draft — setup may be incomplete'}/><TextField label="Cycle name" required value={draft.name} disabled={readonly} onChange={e => change({ ...draft, name: e.target.value })}/><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label="Assessment period starts" type="date" InputLabelProps={{ shrink: true }} value={draft.period.start.slice(0, 10)} disabled={readonly} onChange={e => change({ ...draft, period: { ...draft.period, start: e.target.value } })} fullWidth/><TextField label="Assessment period ends" type="date" InputLabelProps={{ shrink: true }} value={draft.period.end.slice(0, 10)} disabled={readonly} onChange={e => change({ ...draft, period: { ...draft.period, end: e.target.value } })} fullWidth/></Stack>{draft.reviewMode !== 'regular' && <><Divider /><Typography variant="h6">Assessment inputs</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Choose one source or combine them. Internal competencies and strategy work without SFIA.</Typography>{(['sfia', 'internal', 'strategy'] as SourceType[]).map(source => <Box key={source} sx={{ border: '1px solid var(--suite-line)', p: 2, borderRadius: 2 }}><FormControlLabel label={sourceLabel(source)} control={<Checkbox checked={draft.selectedInputTypes.includes(source)} disabled={readonly} onChange={e => toggleSource(source, e.target.checked)}/>}/>{draft.selectedInputTypes.includes(source) && <TextField select fullWidth SelectProps={{ multiple: true }} label={`${sourceLabel(source)} versions`} value={(source === 'strategy' ? draft.strategyVersionIds : draft.frameworkVersionIds).filter(id => sourceRows.some(s => s.sourceType === source && (s.versionId || s.id) === id))} disabled={readonly} onChange={e => chooseVersions(source, typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} helperText={!sourceRows.some(s => s.sourceType === source) ? `Publish a ${sourceLabel(source).toLowerCase()} definition first.` : 'Only published versions are available.'}>{sourceRows.filter(s => s.sourceType === source).map(s => <MenuItem key={s.versionId || s.id} value={s.versionId || s.id}>{s.name} v{s.version} — {s.criteria.length} criteria</MenuItem>)}</TextField>}</Box>)}<Divider /><TextField select SelectProps={{ multiple: true }} label="Assessment role versions" value={draft.roleVersionIds} disabled={readonly} onChange={e => change({ ...draft, roleVersionIds: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })} helperText="Each participant will be assigned one of these roles during appraisal setup.">{roles.map(r => <MenuItem key={r.versionId} value={r.versionId}>{r.name} v{r.version}</MenuItem>)}</TextField>{!roles.length && <Alert severity="info">Publish at least one role with mapped expectations first.</Alert>}</>}</Stack>}
        {step === 1 && draft.reviewMode !== 'regular' && <Stack gap={3}><Typography variant="h6">Explainable scoring</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Weighted mean: each criterion contributes its configured weight within a source; source results contribute the weights below. Native level order is never used as a score.</Typography><TextField select label="Weight format" value={draft.scoringConfig.weightMode} disabled={readonly} onChange={e => updateScoring({ weightMode: e.target.value })}><MenuItem value="relative">Relative weights (positive total)</MenuItem><MenuItem value="percentage">Percentages (total 100)</MenuItem><MenuItem value="fraction">Fractions (total 1)</MenuItem></TextField>{draft.selectedInputTypes.map(source => <TextField key={source} label={`${sourceLabel(source)} weight`} type="number" inputProps={{ min: 0, step: 'any' }} value={draft.scoringConfig.inputWeights[source] ?? ''} disabled={readonly} onChange={e => updateScoring({ inputWeights: { ...draft.scoringConfig.inputWeights, [source]: numeric(e.target.value) } })}/>)}{!draft.selectedInputTypes.length && <Alert severity="info">Choose assessment inputs first.</Alert>}<Divider /><Typography variant="h6">Rating scales</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>For numeric outcomes, define the measurement name used by the role, plus its valid minimum and maximum. Expected targets do not become the scoring denominator.</Typography>{draft.scoringConfig.ratingScales.map((s: Config, i: number) => <Box key={s._key || i} sx={{ border: '1px solid var(--suite-line)', p: 2, borderRadius: 2 }}><Stack gap={2}><TextField label={`Measurement name ${i + 1}`} value={s.id} disabled={readonly} onChange={e => updateScoring({ ratingScales: draft.scoringConfig.ratingScales.map((v: Config, j: number) => j === i ? { ...v, id: e.target.value } : v) })}/><TextField label={`Scale ${i + 1} label`} value={s.label} disabled={readonly} onChange={e => updateScoring({ ratingScales: draft.scoringConfig.ratingScales.map((v: Config, j: number) => j === i ? { ...v, label: e.target.value } : v) })}/><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label={`Scale ${i + 1} minimum`} type="number" value={s.min ?? ''} disabled={readonly} onChange={e => updateScoring({ ratingScales: draft.scoringConfig.ratingScales.map((v: Config, j: number) => j === i ? { ...v, min: numeric(e.target.value) } : v) })}/><TextField label={`Scale ${i + 1} maximum`} type="number" value={s.max ?? ''} disabled={readonly} onChange={e => updateScoring({ ratingScales: draft.scoringConfig.ratingScales.map((v: Config, j: number) => j === i ? { ...v, max: numeric(e.target.value) } : v) })}/></Stack>{!readonly && <Button aria-label={`Remove scale ${i + 1}`} onClick={() => updateScoring({ ratingScales: draft.scoringConfig.ratingScales.filter((_: Config, j: number) => j !== i) })}>Remove scale</Button>}</Stack></Box>)}{!readonly && <Button variant="outlined" onClick={() => updateScoring({ ratingScales: [...draft.scoringConfig.ratingScales, { id: '', label: '', min: null, max: null }] })}>Add rating scale</Button>}<Divider /><Typography variant="h6">Criterion conversions</Typography>{draft.scoringConfig.normalization.map((n: Config, i: number) => { const source = selectedSources.find(s => (s.versionId || s.id) === n.sourceVersionId); const criterion = source?.criteria.find(c => c.id === n.criterionId); return <Box key={`${n.sourceVersionId}:${n.criterionId}`} sx={{ border: '1px solid var(--suite-line)', p: 2, borderRadius: 2 }}><Stack gap={2}><Typography fontWeight={650}>{criterion?.name || 'Criterion'} — {source?.name} v{source?.version}</Typography><TextField select label={`Scoring method for ${criterion?.name || i + 1}`} value={n.method} disabled={readonly} onChange={e => { const entries = draft.scoringConfig.normalization.map((old: Config, j: number) => j === i ? { sourceVersionId: old.sourceVersionId, criterionId: old.criterionId, ...(e.target.value === 'level_map' ? { method: 'level_map', levelScores: {} } : { method: 'rating_scale', ratingScaleId: '' }) } : old); updateScoring({ normalization: entries }); }}>{!!criterion?.levelIds.length && <MenuItem value="level_map">Map native levels to scores</MenuItem>}<MenuItem value="rating_scale">Use rating scale</MenuItem></TextField>{n.method === 'level_map' ? <>{source?.levels.filter(l => criterion?.levelIds.includes(l.id)).map(l => <TextField key={l.id} label={`${criterion?.name}: ${l.label} score (0–100)`} helperText={l.description} type="number" inputProps={{ min: 0, max: 100, step: 'any' }} value={n.levelScores?.[l.id] ?? ''} disabled={readonly} onChange={e => normalization(i, { levelScores: { ...n.levelScores, [l.id]: numeric(e.target.value) } })}/>)}</> : <TextField select label={`Rating scale for ${criterion?.name || i + 1}`} value={n.ratingScaleId} disabled={readonly} onChange={e => normalization(i, { ratingScaleId: e.target.value })}>{draft.scoringConfig.ratingScales.filter((s: Config) => s.id).map((s: Config) => <MenuItem key={s.id} value={s.id}>{s.label || s.id}: {s.min ?? '?'} to {s.max ?? '?'}</MenuItem>)}</TextField>}</Stack></Box>; })}<TextField select label="Authorised missing-evidence exception policy" value={draft.scoringConfig.exceptionPolicy} disabled={readonly} helperText="A required missing item blocks completion unless an authorised assessor records a reasoned exception." onChange={e => updateScoring({ exceptionPolicy: e.target.value })}><MenuItem value="retain_as_unscored">Keep incomplete results unscored</MenuItem><MenuItem value="exclude_and_renormalize">Exclude waived measures and disclose recalculation</MenuItem></TextField></Stack>}
        {step === 2 && draft.reviewMode !== 'regular' && <Stack gap={3}><Typography variant="h6">Suitability bands</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Cover 0 to 100 without gaps or overlap. The last band includes 100. The calculated suggestion remains separate from the human final decision.</Typography>{draft.scoringConfig.thresholds.map((t: Config, i: number) => { const last = i === draft.scoringConfig.thresholds.length - 1; return <Box key={t.id} sx={{ border: '1px solid var(--suite-line)', p: 2, borderRadius: 2 }}><Stack gap={2}><TextField label={`Band ${i + 1} label`} value={t.label} disabled={readonly} onChange={e => updateScoring({ thresholds: draft.scoringConfig.thresholds.map((b: Config, j: number) => j === i ? { ...b, label: e.target.value } : b) })}/><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label={`Band ${i + 1} starts at (inclusive)`} type="number" value={t.minInclusive ?? ''} disabled={readonly} onChange={e => updateScoring({ thresholds: draft.scoringConfig.thresholds.map((b: Config, j: number) => j === i ? { ...b, minInclusive: numeric(e.target.value) } : b) })}/><TextField label={`Band ${i + 1} ends at (${last ? 'inclusive' : 'exclusive'})`} type="number" value={(last ? t.maxInclusive : t.maxExclusive) ?? ''} disabled={readonly} onChange={e => updateScoring({ thresholds: draft.scoringConfig.thresholds.map((b: Config, j: number) => j === i ? { ...b, [last ? 'maxInclusive' : 'maxExclusive']: numeric(e.target.value) } : b) })}/></Stack>{!readonly && draft.scoringConfig.thresholds.length > 1 && <Button aria-label={`Remove band ${i + 1}`} onClick={() => { const bands = draft.scoringConfig.thresholds.filter((_: Config, j: number) => j !== i).map((b: Config, j: number, a: Config[]) => { const { maxExclusive, maxInclusive, ...rest } = b; return { ...rest, ...(j === a.length - 1 ? { maxInclusive: maxInclusive ?? maxExclusive } : { maxExclusive: maxExclusive ?? maxInclusive }) }; }); updateScoring({ thresholds: bands }); }}>Remove band</Button>}</Stack></Box>; })}{!readonly && <Button variant="outlined" onClick={() => { const bands = draft.scoringConfig.thresholds.map((b: Config) => ({ ...b })); const previous = bands[bands.length - 1]; const upper = previous.maxInclusive; delete previous.maxInclusive; previous.maxExclusive = upper; bands.push({ id: key(), label: '', minInclusive: upper, maxInclusive: 100 }); updateScoring({ thresholds: bands }); }}>Add band</Button>}<Divider /><Typography variant="h6">Optional rankings</Typography><FormControlLabel label="Include comparable rankings" control={<Checkbox checked={draft.rankingConfig.enabled} disabled={readonly} onChange={e => change({ ...draft, rankingConfig: { ...draft.rankingConfig, enabled: e.target.checked } })}/>}/>{draft.rankingConfig.enabled && <><Alert severity="info">Only results with compatible role expectations, sources and scoring rules can be ranked together.</Alert><TextField select label="Ranking scope" value={draft.rankingConfig.scope} disabled={readonly} onChange={e => change({ ...draft, rankingConfig: { ...draft.rankingConfig, scope: e.target.value } })}><MenuItem value="role">Role</MenuItem><MenuItem value="department">Department</MenuItem><MenuItem value="organization">Organisation</MenuItem></TextField><TextField select label="Ranking order" value={draft.rankingConfig.direction} disabled={readonly} onChange={e => change({ ...draft, rankingConfig: { ...draft.rankingConfig, direction: e.target.value } })}><MenuItem value="desc">Highest score first</MenuItem><MenuItem value="asc">Lowest score first</MenuItem></TextField><TextField select label="Tie handling" value={draft.rankingConfig.tieRule} disabled={readonly} onChange={e => change({ ...draft, rankingConfig: { ...draft.rankingConfig, tieRule: e.target.value } })}><MenuItem value="competition">Competition (1, 1, 3)</MenuItem><MenuItem value="dense">Dense (1, 1, 2)</MenuItem></TextField><TextField label="Tie precision (decimal places)" type="number" inputProps={{ min: 0, max: 6, step: 1 }} value={draft.rankingConfig.decimalPlaces} disabled={readonly} onChange={e => change({ ...draft, rankingConfig: { ...draft.rankingConfig, decimalPlaces: Number(e.target.value) } })}/></>}</Stack>}
        {step === 3 && <Stack gap={3}><Typography variant="h6">Check assessment configuration</Typography><Typography fontWeight={650}>{draft.name || 'Cycle name needed'}</Typography><Typography>{draft.period.start || 'Start date needed'} to {draft.period.end || 'End date needed'}</Typography><Typography>Review: {draft.reviewMode} · {draft.cadence.type === 'periodic' ? `Repeats ${draft.cadence.frequency}` : 'One-time'}</Typography>{draft.reviewMode !== 'regular' && <><Divider /><Typography fontWeight={650}>Selected inputs</Typography>{draft.selectedInputTypes.length ? draft.selectedInputTypes.map(s => <Typography key={s}>{sourceLabel(s)} — weight {draft.scoringConfig.inputWeights[s] ?? 'not set'}</Typography>) : <Alert severity="warning">Choose at least one assessment input.</Alert>}{selectedSources.map(s => <Typography key={s.id}>{s.name} v{s.version} — {s.criteria.length} criteria</Typography>)}<Typography fontWeight={650}>Role versions</Typography>{selectedRoles.map(r => <Typography key={r.versionId}>{r.name} v{r.version}</Typography>)}{!selectedRoles.length && <Alert severity="warning">Choose a published assessment role.</Alert>}<Typography>{draft.scoringConfig.normalization.length} criterion conversions · {draft.scoringConfig.thresholds.length} suitability bands</Typography><Typography>Rankings {draft.rankingConfig.enabled ? `enabled by ${draft.rankingConfig.scope}` : 'disabled'}</Typography></>}{validation && <Alert severity="success">Configuration is valid and ready to publish.</Alert>}{!readonly && cycleId && <Button variant="outlined" disabled={busy || notice === 'Unsaved changes'} onClick={() => void check()}>Check readiness</Button>}</Stack>}
      </Surface>
      <EditorActions status={notice}><Button disabled={step === 0} onClick={() => setStep(step - 1)}>Previous</Button>{step < 3 && <Button variant="outlined" onClick={() => setStep(step + 1)}>Continue</Button>}{!readonly && <><Button variant="contained" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</Button>{step === 3 && cycleId && <Button variant="outlined" disabled={busy || !validation || notice === 'Unsaved changes'} onClick={() => setConfirm(true)}>Publish cycle</Button>}</>}</EditorActions>
      <ConfirmDialog open={confirm} title="Publish this assessment cycle?" action="Publish cycle" onClose={() => setConfirm(false)} onConfirm={() => void publish()} busy={busy}><Typography>{draft.name}</Typography><Typography mt={2}>The selected roles, source versions and scoring rules will become fixed. You can then choose this cycle when starting appraisals.</Typography></ConfirmDialog>
      <ConfirmDialog open={!!removing} title={`Remove ${removing ? sourceLabel(removing) : 'source'}?`} action="Remove source and cycle mappings" onClose={() => setRemoving(null)} onConfirm={removeSource}><Typography>This removes its selected versions, weight and scoring conversions from this draft. Review the remaining roles and scoring before publishing. Role library definitions stay unchanged.</Typography></ConfirmDialog>
      <ConfirmDialog open={!!latest} title="Reload the latest cycle?" action="Reload latest" onClose={() => setLatest(null)} onConfirm={() => { if (latest)
            setDraft({ ...blank, ...latest, scoringConfig: { ...scoring(), ...latest.scoringConfig } }); setLatest(null); setError(null); setNotice('Latest configuration loaded'); }}><Alert severity="warning">This replaces your unsaved changes. Copy any settings you want to keep first.</Alert><Typography mt={2}>Your draft: {draft.name}</Typography><Typography>Latest saved: {latest?.name}</Typography></ConfirmDialog>
    </>}
  </CompetencyPage>;
}
