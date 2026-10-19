'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { competencyRequest, newIdempotencyKey } from '@/lib/competency-api';
import api from '@/lib/api';
import { CompetencyPage, Surface, LoadingCompetency, CompetencyFailure, DeniedCompetency, useCompetencyBootstrap } from '../CompetencyPage';
import { ConfirmDialog, EditorActions, EditorError } from './EditorParts';
import { key, type Level, type LibraryRecord, type NativeCriterion, type Version } from './types';
type Draft = {
    name: string;
    sourceType: 'sfia' | 'internal';
    source: string;
    licenseProvenance: string;
    description: string;
    criteria: NativeCriterion[];
    levels: Level[];
    sourceRef?: {
        type: 'okr';
        id: string;
    } | null;
};
const empty: Draft = { name: '', sourceType: 'internal', source: '', licenseProvenance: '', description: '', criteria: [], levels: [] };
function content(v: Version): Draft { return { ...empty, name: v.name || v.title || '', description: v.description || '', sourceType: v.sourceType === 'sfia' ? 'sfia' : 'internal', source: v.source || '', licenseProvenance: v.licenseProvenance || '', criteria: v.criteria || [], levels: v.levels || [], ...(v.sourceRef?{sourceRef:{type:'okr',id:v.sourceRef.id}}:{}) }; }
export default function FrameworkEditor({ recordId, strategy = false }: {
    recordId?: string;
    strategy?: boolean;
}) {
    const router = useRouter();
    const bootstrap = useCompetencyBootstrap();
    const manage = bootstrap.data?.capabilities[strategy ? 'cycleManage' : 'frameworkManage'];
    const kind = strategy ? 'strategies' : 'frameworks';
    const noun = strategy ? 'strategy' : 'framework';
    const record = useSWR<LibraryRecord>(recordId && manage ? `competency-${kind}-${recordId}` : null, async () => { if (!strategy)
        return competencyRequest<LibraryRecord>('GET', `/frameworks/${recordId}`); const all = await competencyRequest<Version[]>('GET', '/strategies'); const versions = all.filter(v => v.strategyId === recordId || v.id === recordId).sort((a, b) => b.version - a.version); if (!versions.length)
        throw new Error('Strategy not found'); return { id: versions[0].strategyId || versions[0].id, revision: versions[0].revision, name: versions[0].title || '', versions }; });
    const [draft, setDraft] = useState<Draft>(empty);
    const [version, setVersion] = useState<Version | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('Unsaved draft');
    const [tab, setTab] = useState(0);
    const [confirm, setConfirm] = useState(false);
    const [latest, setLatest] = useState<LibraryRecord | null>(null);
    const [linkGoal, setLinkGoal] = useState(false);
    const [goals, setGoals] = useState<{
        _id: string;
        title: string;
        description?: string;
    }[]>([]);
    const loaded = useRef('');
    const requestKey = useRef(newIdempotencyKey());
    useEffect(() => { if (record.data && loaded.current !== recordId) {
        const v = record.data.versions.find(v => v.status === 'draft') || record.data.versions[0];
        setVersion(v);
        setDraft(content(v));
        setLinkGoal(!!v.sourceRef);
        setNotice(v.status === 'draft' ? 'Draft ready to edit' : `Viewing published version ${v.version}`);
        loaded.current = recordId || '';
    } }, [record.data, recordId]);
    useEffect(() => { if (strategy && linkGoal) {
        api.get('/okrs').then(r => { const list = r.data?.data || r.data?.okrs || []; setGoals(Array.isArray(list) ? list : []); }).catch(setError);
    } }, [strategy, linkGoal]);
    const readonly = version?.status === 'published';
    const change = (v: Draft) => { setDraft(v); setNotice('Unsaved changes'); requestKey.current = newIdempotencyKey(); };
    const payload = () => strategy ? { title: draft.name, description: draft.description, criteria: draft.criteria, levels: draft.levels, sourceRef:linkGoal?draft.sourceRef||null:null } : { name: draft.name, criteria: draft.criteria, levels: draft.levels, source: draft.source, licenseProvenance: draft.licenseProvenance };
    async function save() { setBusy(true); setError(null); try {
        if (recordId && version) {
            const v = await competencyRequest<Version>('PATCH', `/${kind}/${record.data?.id || recordId}/versions/${version.id}`, payload(), version.revision);
            setVersion(v);
            await record.mutate();
            setNotice('All changes saved');
        }
        else {
            const result = await competencyRequest<LibraryRecord & Version>('POST', `/${kind}`, { ...payload(), ...(!strategy ? { sourceType: draft.sourceType } : {}) }, undefined, requestKey.current);
            await bootstrap.mutate();
            router.replace(`/competency/${kind}/${strategy ? result.strategyId || result.id : result.id}`);
        }
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } }
    async function publish() { if (!recordId || !version)
        return; setBusy(true); setError(null); try {
        const v = await competencyRequest<Version>('POST', `/${kind}/${record.data?.id || recordId}/versions/${version.id}/publish`, {}, version.revision, newIdempotencyKey());
        setVersion(v);
        await record.mutate();
        await bootstrap.mutate();
        setConfirm(false);
        setNotice(`Version ${v.version} published`);
    }
    catch (e) {
        setError(e);
        setConfirm(false);
    }
    finally {
        setBusy(false);
    } }
    async function newVersion() { if (!record.data)
        return; setBusy(true); setError(null); try {
        const v = await competencyRequest<Version>('POST', `/${kind}/${record.data.id}/versions`, {}, record.data.revision, newIdempotencyKey());
        setVersion(v);
        setDraft(content(v));
        setLinkGoal(!!v.sourceRef);
        await record.mutate();
        setTab(0);
        setNotice('New draft created. Existing assessments keep their original sources.');
    }
    catch (e) {
        setError(e);
    }
    finally {
        setBusy(false);
    } }
    function level(index: number, patch: Partial<Level>) { change({ ...draft, levels: draft.levels.map((l, i) => i === index ? { ...l, ...patch } : l) }); }
    function criterion(index: number, patch: Partial<NativeCriterion>) { change({ ...draft, criteria: draft.criteria.map((c, i) => i === index ? { ...c, ...patch } : c) }); }
    return <CompetencyPage title={recordId ? record.data?.name || `Assessment ${noun}` : `New ${noun}`} description={strategy ? 'Define strategic outcomes and assessment criteria. Numeric targets use an explicit measurement scale when mapped to a role.' : 'Define source-specific competencies and native levels. Matching labels in different frameworks do not imply equivalent proficiency.'}>
    {bootstrap.isLoading || recordId && record.isLoading ? <LoadingCompetency /> : bootstrap.error ? <CompetencyFailure error={bootstrap.error} retry={() => void bootstrap.mutate()}/> : !manage ? <DeniedCompetency /> : record.error ? <CompetencyFailure error={record.error} retry={() => void record.mutate()}/> : <>
      <EditorError error={error} draft={draft} reload={recordId ? async () => setLatest(await record.mutate() || null) : undefined}/><Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label={`${noun} sections`} variant="scrollable"><Tab label="Definition"/><Tab label={`Criteria (${draft.criteria.length})`}/><Tab label={`Native levels (${draft.levels.length})`}/>{recordId && <Tab label="Versions"/>}</Tabs>
      <Box mt={2}><Surface>
        {tab === 0 && <Stack gap={3}><Chip sx={{ alignSelf: 'flex-start' }} size="small" label={version ? `${readonly ? 'Published' : 'Draft'} v${version.version}` : 'Draft'}/><TextField required label={strategy ? 'Strategy name' : 'Framework name'} value={draft.name} disabled={readonly} onChange={e => change({ ...draft, name: e.target.value })}/>{strategy ? <>{version?.sourceRef&&<Alert severity="info">Captured objective: {version.sourceRef.title||'Not recorded'}{version.sourceRef.capturedAt?' — '+new Date(version.sourceRef.capturedAt).toLocaleString():''}. Existing assessments retain this captured version.{goals.some(g=>g._id===version.sourceRef?.id)&&<Button component="a" href={'/okrs/alignment?goal='+encodeURIComponent(version.sourceRef.id)}>View current objective</Button>}</Alert>}<TextField label="Description and expected outcomes" multiline minRows={4} value={draft.description} disabled={readonly} onChange={e => change({ ...draft, description: e.target.value })}/><FormControlLabel label="Link an existing objective" control={<Checkbox checked={linkGoal} disabled={readonly} onChange={e => {setLinkGoal(e.target.checked);change({...draft,...(!e.target.checked?{sourceRef:null}:{})});}}/>}/>{linkGoal && <><TextField select label="Existing objective" value={draft.sourceRef?.id || ''} disabled={readonly} helperText="Only objectives you can access are listed. Saving captures a version; it does not change the objective." onChange={e => { const goal = goals.find(g => g._id === e.target.value); change({ ...draft, sourceRef: { type: 'okr', id: e.target.value }, name: draft.name || goal?.title || '', description: draft.description || goal?.description || '' }); }}>{goals.map(g => <MenuItem key={g._id} value={g._id}>{g.title}</MenuItem>)}</TextField>{!goals.length && <Alert severity="info">No accessible objectives were returned. You can define a strategy manually.</Alert>}</>}</> : <><TextField select label="Source" value={draft.sourceType} disabled={!!recordId} onChange={e => change({ ...draft, sourceType: e.target.value as Draft['sourceType'] })}><MenuItem value="internal">Internal framework</MenuItem><MenuItem value="sfia">SFIA</MenuItem></TextField>{draft.sourceType === 'sfia' && <Alert severity="info">Supply content your organisation is permitted to use. No licensed SFIA catalogue is bundled.</Alert>}<TextField label="Source and provenance" multiline minRows={2} value={draft.source} disabled={readonly} onChange={e => change({ ...draft, source: e.target.value })}/><TextField label="Licence / ownership provenance" multiline minRows={2} value={draft.licenseProvenance} required={draft.sourceType === 'sfia'} disabled={readonly} onChange={e => change({ ...draft, licenseProvenance: e.target.value })}/></>}</Stack>}
        {tab === 1 && <Stack gap={3}><Typography variant="h6">Assessment criteria</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Describe the behaviours or outcomes to assess. Choose the native levels available for each criterion, or leave levels empty for a numeric strategy measure.</Typography>{draft.criteria.map((c, i) => <Box key={c.id} sx={{ border: '1px solid var(--suite-line)', borderRadius: 2, p: 2 }}><Stack gap={2}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={650}>Criterion {i + 1}</Typography>{!readonly && <Button aria-label={`Remove criterion ${i + 1}`} onClick={() => change({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}>Remove</Button>}</Stack><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label={`Criterion ${i + 1} code`} value={c.code} disabled={readonly} onChange={e => criterion(i, { code: e.target.value })}/><TextField label={`Criterion ${i + 1} name`} fullWidth value={c.name} disabled={readonly} onChange={e => criterion(i, { name: e.target.value })}/></Stack><TextField label={`Criterion ${i + 1} description`} multiline minRows={2} value={c.description} disabled={readonly} onChange={e => criterion(i, { description: e.target.value })}/><TextField select SelectProps={{ multiple: true }} label={`Available levels for criterion ${i + 1}`} value={c.levelIds} disabled={readonly} helperText={!draft.levels.length ? 'Add native levels first, or use a numeric strategy measure.' : undefined} onChange={e => criterion(i, { levelIds: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}>{draft.levels.map(l => <MenuItem key={l.id} value={l.id}>{l.label}</MenuItem>)}</TextField></Stack></Box>)}{!readonly && <Button variant="outlined" onClick={() => change({ ...draft, criteria: [...draft.criteria, { id: key(), code: '', name: '', description: '', levelIds: [] }] })}>Add criterion</Button>}</Stack>}
        {tab === 2 && <Stack gap={3}><Typography variant="h6">Native proficiency levels</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Each descriptor belongs to this source only. Order controls presentation; scores are mapped separately in cycle setup.</Typography>{draft.levels.map((l, i) => <Box key={l.id} sx={{ border: '1px solid var(--suite-line)', borderRadius: 2, p: 2 }}><Stack gap={2}><Typography fontWeight={650}>Level {i + 1}</Typography><TextField label={`Level ${i + 1} label`} value={l.label} disabled={readonly} onChange={e => level(i, { label: e.target.value })}/><TextField label={`Level ${i + 1} description`} multiline minRows={2} value={l.description} disabled={readonly} onChange={e => level(i, { description: e.target.value })}/>{!readonly && <Stack direction="row" gap={1} flexWrap="wrap"><Button disabled={i === 0} aria-label={`Move level ${i + 1} up`} onClick={() => { const next = [...draft.levels]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; change({ ...draft, levels: next.map((v, j) => ({ ...v, order: j + 1 })) }); }}>Move up</Button><Button disabled={i === draft.levels.length - 1} aria-label={`Move level ${i + 1} down`} onClick={() => { const next = [...draft.levels]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; change({ ...draft, levels: next.map((v, j) => ({ ...v, order: j + 1 })) }); }}>Move down</Button><Button aria-label={`Remove level ${i + 1}`} onClick={() => change({ ...draft, levels: draft.levels.filter((_, j) => j !== i), criteria: draft.criteria.map(c => ({ ...c, levelIds: c.levelIds.filter(id => id !== l.id) })) })}>Remove</Button></Stack>}</Stack></Box>)}{!readonly && <Button variant="outlined" onClick={() => change({ ...draft, levels: [...draft.levels, { id: key(), label: '', description: '', order: draft.levels.length + 1 }] })}>Add level</Button>}</Stack>}
        {tab === 3 && <Stack gap={2}><Typography variant="h6">Source versions</Typography>{record.data?.versions.map(v => <Box key={v.id}><Stack direction="row" alignItems="center" justifyContent="space-between"><Box><Typography fontWeight={650}>Version {v.version} — {v.status === 'published' ? 'Published' : 'Draft'}</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>{v.publishedAt ? new Date(v.publishedAt).toLocaleString() : 'Not published'}{v.publishedBy?.name ? ` by ${v.publishedBy.name}` : ''}</Typography></Box><Button onClick={() => { setVersion(v); setDraft(content(v)); setTab(0); setNotice(`Viewing ${v.status} version ${v.version}`); }}>View v{v.version}</Button></Stack><Divider sx={{ my: 2 }}/></Box>)}</Stack>}
      </Surface></Box>
      <EditorActions status={notice}>{readonly ? <Button variant="contained" disabled={busy} onClick={() => void newVersion()}>Create new version</Button> : <><Button variant="contained" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</Button>{recordId && <Button variant="outlined" disabled={busy || notice === 'Unsaved changes'} onClick={() => setConfirm(true)}>Review and publish</Button>}</>}</EditorActions>
      <ConfirmDialog open={confirm} title={`Publish ${draft.name}?`} action={`Publish v${version?.version}`} onClose={() => setConfirm(false)} onConfirm={() => void publish()} busy={busy}><Typography>{draft.criteria.length} criteria and {draft.levels.length} native levels.</Typography><Typography mt={2}>Published content becomes read-only. Future changes create a new version; existing assessments retain their original source.</Typography></ConfirmDialog>
      <ConfirmDialog open={!!latest} title="A newer version is available" action="Reload latest" onClose={() => setLatest(null)} onConfirm={() => { const v = latest?.versions.find(v => v.id === version?.id) || latest?.versions[0]; if (v) {
            setVersion(v);
            setDraft(content(v));
            setNotice('Latest saved version loaded');
            setError(null);
        } setLatest(null); }}><Alert severity="warning">Reloading replaces your unsaved changes. Copy anything you want to keep before continuing.</Alert><Typography mt={2}>Your draft: {draft.name}</Typography><Typography>Latest saved: {latest?.name}</Typography></ConfirmDialog>
    </>}
  </CompetencyPage>;
}
