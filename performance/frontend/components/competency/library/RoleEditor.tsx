'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { competencyDownload, competencyError, competencyRequest, newIdempotencyKey } from '@/lib/competency-api';
import { CompetencyPage, Surface, LoadingCompetency, CompetencyFailure, DeniedCompetency, useCompetencyBootstrap } from '../CompetencyPage';
import { ConfirmDialog, EditorActions, EditorError } from './EditorParts';
import { key, sourceLabel, type LibraryRecord, type RoleDraft, type RoleCriterion, type Version } from './types';
const empty: RoleDraft = { name: '', description: '', responsibilities: [], requirements: [], criteria: [] };
const content = (v: Partial<RoleDraft>): RoleDraft => ({ name: v.name || '', description: v.description || '', responsibilities: v.responsibilities || [], requirements: v.requirements || [], criteria: v.criteria || [] });
type ImportDraft = {
    id: string;
    originalName: string;
    extractedText: string;
    extractedDraft: RoleDraft;
    warnings: string[];
    extractionStatus: string;
};
export default function RoleEditor({ roleId }: {
    roleId?: string;
}) {
    const router = useRouter();
    const bootstrap = useCompetencyBootstrap();
    const manage = bootstrap.data?.capabilities.roleManage;
    const record = useSWR<LibraryRecord>(roleId && manage ? `competency-role-${roleId}` : null, () => competencyRequest<LibraryRecord>('GET', `/roles/${roleId}`));
    const [draft, setDraft] = useState<RoleDraft>(empty);
    const [version, setVersion] = useState<Version | null>(null);
    const [tab, setTab] = useState(0);
    const [error, setError] = useState<unknown>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('Unsaved draft');
    const [choice, setChoice] = useState<'manual' | 'upload' | null>(roleId ? 'manual' : null);
    const [imported, setImported] = useState<ImportDraft | null>(null);
    const [reviewed, setReviewed] = useState(false);
    const [confirm, setConfirm] = useState<'publish' | 'archive' | 'duplicate' | null>(null);
    const [comparison, setComparison] = useState<LibraryRecord | null>(null);
    const loaded = useRef('');
    const requestKey = useRef(newIdempotencyKey());
    useEffect(() => { if (record.data && loaded.current !== roleId) {
        const v = record.data.versions.find(v => v.status === 'draft') || record.data.versions[0];
        setVersion(v);
        setDraft(content(v));
        loaded.current = roleId || '';
        setNotice(v.status === 'published' ? `Published version ${v.version}` : 'Draft ready to edit');
    } }, [record.data, roleId]);
    const readonly = !!version && version.status === 'published' || !!record.data?.archivedAt;
    const sources = [...(bootstrap.data?.frameworks || []).map(s => ({ ...s, title: s.name })), ...(bootstrap.data?.strategies || []).map(s => ({ ...s, sourceType: 'strategy' as const, name: s.title }))];
    const change = (next: RoleDraft) => { setDraft(next); setNotice('Unsaved changes'); requestKey.current = newIdempotencyKey(); };
    async function save(duplicateConfirmed = false) { setBusy(true); setError(null); try {
        let result: LibraryRecord;
        if (imported) {
            result = await competencyRequest('POST', `/imports/${imported.id}/confirm`, { reviewed, draft: { ...draft, ...(duplicateConfirmed ? { duplicateConfirmed: true } : {}) } }, undefined, requestKey.current);
        }
        else if (roleId && version) {
            const v = await competencyRequest<Version>('PATCH', `/roles/${roleId}/versions/${version.id}`, draft, version.revision);
            setVersion(v);
            await record.mutate();
            setNotice('All changes saved');
            return;
        }
        else {
            result = await competencyRequest('POST', '/roles', { ...draft, ...(duplicateConfirmed ? { duplicateConfirmed: true } : {}) }, undefined, requestKey.current);
        }
        await bootstrap.mutate();
        router.replace(`/competency/roles/${result.id}`);
        setConfirm(null);
    }
    catch (e) {
        setError(e);
        if (competencyError(e).code === 'ROLE_NAME_EXISTS')
            setConfirm('duplicate');
    }
    finally {
        setBusy(false);
    } }
    async function transition(action: 'publish' | 'archive' | 'version') { if (!roleId || !record.data)
        return; setBusy(true); setError(null); try {
        if (action === 'version') {
            const v = await competencyRequest<Version>('POST', `/roles/${roleId}/versions`, {}, record.data.revision, newIdempotencyKey());
            setVersion(v);
            setDraft(content(v));
            setTab(0);
            setNotice('New draft created. Published appraisals keep their original role.');
        }
        else if (action === 'archive') {
            await competencyRequest('POST', `/roles/${roleId}/archive`, {}, record.data.revision, newIdempotencyKey());
            setNotice('Role archived. Existing appraisals keep their recorded role.');
        }
        else if (version) {
            const v = await competencyRequest<Version>('POST', `/roles/${roleId}/versions/${version.id}/publish`, {}, version.revision, newIdempotencyKey());
            setVersion(v);
            setNotice(`Version ${v.version} published for new appraisals`);
        }
        await record.mutate();
        await bootstrap.mutate();
        setConfirm(null);
    }
    catch (e) {
        setError(e);
        setConfirm(null);
    }
    finally {
        setBusy(false);
    } }
    async function upload(file: File) { setBusy(true); setError(null); setNotice('Checking and reading document…'); try {
        const body = new FormData();
        body.append('purpose', 'role');
        body.append('file', file);
        const result = await competencyRequest<ImportDraft>('POST', '/imports', body, undefined, newIdempotencyKey());
        setImported(result);
        setDraft(content(result.extractedDraft));
        setReviewed(false);
        setNotice('Review extracted details before saving');
    }
    catch (e) {
        setError(e);
        setNotice('Upload could not complete. You can continue manually.');
    }
    finally {
        setBusy(false);
    } }
    function updateCriterion(index: number, patch: Partial<RoleCriterion>) { change({ ...draft, criteria: draft.criteria.map((c, i) => i === index ? { ...c, ...patch } : c) }); }
    function selectSource(index: number, versionId: string) { const s = sources.find(s => (s.versionId || s.id) === versionId); if (!s)
        return; const criterion = s.criteria[0]; const { frameworkVersionId: oldF, strategyVersionId: oldS, expectedLevelId: oldL, evaluationTarget: oldT, ...old } = draft.criteria[index]; void oldF; void oldS; void oldL; void oldT; const next: RoleCriterion = { ...old, sourceType: s.sourceType, ...(s.sourceType === 'strategy' ? { strategyVersionId: versionId } : { frameworkVersionId: versionId }), criterionId: criterion?.id || '', ...(criterion?.levelIds.length ? { expectedLevelId: '' } : { evaluationTarget: { scaleId: 'percent', value: 0 } }) }; change({ ...draft, criteria: draft.criteria.map((c, i) => i === index ? next : c) }); }
    const heading = roleId ? record.data?.name || 'Assessment role' : 'New assessment role';
    return <CompetencyPage title={heading} description="Define responsibilities and expectations. Assessment roles describe work; they do not change app permissions.">
    {bootstrap.isLoading || roleId && record.isLoading ? <LoadingCompetency /> : bootstrap.error ? <CompetencyFailure error={bootstrap.error} retry={() => void bootstrap.mutate()}/> : !manage ? <DeniedCompetency /> : record.error ? <CompetencyFailure error={record.error} retry={() => void record.mutate()}/> : <>
      <EditorError error={error} draft={draft} reload={roleId ? async () => setComparison(await competencyRequest('GET', `/roles/${roleId}`)) : undefined}/>
      {(!roleId && !choice) && <Surface><Typography variant="h6">How would you like to define this role?</Typography><Typography sx={{ color: 'var(--suite-muted)', my: 2 }}>Create it here, or upload a role description to produce a draft you can review.</Typography><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><Button variant="contained" onClick={() => setChoice('manual')}>Create manually</Button><Button variant="outlined" onClick={() => setChoice('upload')}>Upload role description</Button></Stack></Surface>}
      {choice && <>
        {choice === 'upload' && !roleId && <Surface><Stack gap={2}><Typography variant="h6">Upload role description</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>PDF, DOCX or UTF-8 TXT. Maximum 10 MiB. Files are checked before reading.</Typography><Button component="label" variant="outlined" disabled={busy}>Choose role description<input aria-label="Choose role description" type="file" accept=".pdf,.docx,.txt" hidden onChange={e => { const f = e.target.files?.[0]; if (f)
                void upload(f); e.target.value = ''; }}/></Button><Button onClick={() => setChoice('manual')}>Continue manually</Button>{imported && <><Typography>{imported.originalName}</Typography><Alert severity="info">Review the draft before saving. Extracted text may be incomplete.</Alert><Box component="details"><Box component="summary" sx={{ cursor: 'pointer' }}>View extracted source text</Box><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto', fontFamily: 'inherit', fontSize: 14 }}>{imported.extractedText || 'No readable text was extracted. Enter the role details below.'}</Box><Button onClick={() => void competencyDownload(`/imports/${imported.id}/source`, imported.originalName)}>Download original</Button></Box>{imported.warnings.map(w => <Typography key={w} variant="body2" sx={{ color: 'var(--suite-muted)' }}>{w}</Typography>)}</>}</Stack></Surface>}
        <Box mt={3}><Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" aria-label="Role sections"><Tab label="Overview"/><Tab label={`Expectations (${draft.criteria.length})`}/>{roleId && <Tab label="Versions"/>}</Tabs></Box>
        <Box mt={2}><Surface>
          {tab === 0 && <Stack gap={3}><Stack direction="row" gap={1}><Chip size="small" label={record.data?.archivedAt ? 'Archived' : version ? `${version.status === 'draft' ? 'Draft' : 'Published'} v${version.version}` : 'Draft'}/></Stack><TextField label="Role name" required value={draft.name} disabled={readonly} onChange={e => change({ ...draft, name: e.target.value })} inputProps={{ maxLength: 200 }}/><TextField label="Summary" multiline minRows={3} value={draft.description} disabled={readonly} onChange={e => change({ ...draft, description: e.target.value })}/><Divider /><Typography variant="h6">Responsibilities</Typography>{draft.responsibilities.map((r, i) => <Stack key={r.id} direction={{ xs: 'column', sm: 'row' }} gap={1}><TextField label={`Responsibility ${i + 1}`} fullWidth multiline value={r.text} disabled={readonly} onChange={e => change({ ...draft, responsibilities: draft.responsibilities.map((v, j) => j === i ? { ...v, text: e.target.value } : v) })}/>{!readonly && <Button aria-label={`Remove responsibility ${i + 1}`} onClick={() => change({ ...draft, responsibilities: draft.responsibilities.filter((_, j) => j !== i), criteria: draft.criteria.map(c => ({ ...c, responsibilityIds: c.responsibilityIds.filter(v => v !== r.id) })) })}>Remove</Button>}</Stack>)}{!readonly && <Button variant="outlined" onClick={() => change({ ...draft, responsibilities: [...draft.responsibilities, { id: key(), text: '' }] })}>Add responsibility</Button>}<Divider /><Typography variant="h6">Requirements</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Knowledge, experience or outcomes expected in this role.</Typography>{draft.requirements.map((r, i) => <Stack key={r.id} direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}><TextField label={`Requirement ${i + 1}`} fullWidth multiline value={r.text} disabled={readonly} onChange={e => change({ ...draft, requirements: draft.requirements.map((v, j) => j === i ? { ...v, text: e.target.value } : v) })}/><FormControlLabel label="Required" control={<Checkbox checked={r.required} disabled={readonly} onChange={e => change({ ...draft, requirements: draft.requirements.map((v, j) => j === i ? { ...v, required: e.target.checked } : v) })}/>}/>{!readonly && <Button aria-label={`Remove requirement ${i + 1}`} onClick={() => change({ ...draft, requirements: draft.requirements.filter((_, j) => j !== i), criteria: draft.criteria.map(c => ({ ...c, requirementIds: c.requirementIds.filter(v => v !== r.id) })) })}>Remove</Button>}</Stack>)}{!readonly && <Button variant="outlined" onClick={() => change({ ...draft, requirements: [...draft.requirements, { id: key(), text: '', required: true }] })}>Add requirement</Button>}</Stack>}
          {tab === 1 && <Stack gap={3}><Typography variant="h6">Role expectations</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Choose exact published sources. Native levels stay within their framework; scoring conversions are configured in the cycle.</Typography>{!sources.length && <Alert severity="info">Publish an internal framework or strategy criterion first. You can save this role draft meanwhile.</Alert>}{draft.criteria.map((c, i) => { const source = sources.find(s => (s.versionId || s.id) === (c.frameworkVersionId || c.strategyVersionId)); const native = source?.criteria.find(n => n.id === c.criterionId); return <Box key={c.id} sx={{ border: '1px solid var(--suite-line)', borderRadius: 2, p: 2 }}><Stack gap={2}><Stack direction="row" alignItems="center" justifyContent="space-between"><Typography fontWeight={650}>Expectation {i + 1}</Typography>{!readonly && <Button aria-label={`Remove expectation ${i + 1}`} onClick={() => change({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}>Remove</Button>}</Stack><TextField select label={`Source for expectation ${i + 1}`} value={c.frameworkVersionId || c.strategyVersionId || ''} disabled={readonly} onChange={e => selectSource(i, e.target.value)}>{sources.map(s => <MenuItem key={s.versionId || s.id} value={s.versionId || s.id}>{sourceLabel(s.sourceType)} — {s.name} v{s.version}</MenuItem>)}</TextField><TextField select label={`Criterion for expectation ${i + 1}`} value={c.criterionId} disabled={readonly} onChange={e => { const selected = source?.criteria.find(n => n.id === e.target.value); const { expectedLevelId, evaluationTarget, ...rest } = c; void expectedLevelId; void evaluationTarget; change({ ...draft, criteria: draft.criteria.map((v, j) => j === i ? { ...rest, criterionId: e.target.value, ...(selected?.levelIds.length ? { expectedLevelId: '' } : { evaluationTarget: { scaleId: 'percent', value: 0 } }) } : v) }); }}>{source?.criteria.map(n => <MenuItem key={n.id} value={n.id}>{n.name}</MenuItem>)}</TextField>{native?.levelIds.length ? <TextField select label={`Expected level for expectation ${i + 1}`} value={c.expectedLevelId || ''} disabled={readonly} helperText={source?.levels.find(l => l.id === c.expectedLevelId)?.description || 'Select the native level expected for this role.'} onChange={e => updateCriterion(i, { expectedLevelId: e.target.value })}>{source?.levels.filter(l => native.levelIds.includes(l.id)).map(l => <MenuItem key={l.id} value={l.id}>{l.label}</MenuItem>)}</TextField> : <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label={`Measurement name for expectation ${i + 1}`} value={c.evaluationTarget?.scaleId || ''} disabled={readonly} helperText="Use this measurement name in the cycle’s rating scales." onChange={e => updateCriterion(i, { evaluationTarget: { scaleId: e.target.value, value: c.evaluationTarget?.value || 0 } })}/><TextField label={`Expected target for expectation ${i + 1}`} type="number" value={c.evaluationTarget?.value ?? ''} disabled={readonly} onChange={e => updateCriterion(i, { evaluationTarget: { scaleId: c.evaluationTarget?.scaleId || '', value: Number(e.target.value) } })}/></Stack>}<TextField label={`Criterion weight for expectation ${i + 1}`} type="number" value={c.weight} disabled={readonly} inputProps={{ min: 0, step: 'any' }} onChange={e => updateCriterion(i, { weight: Number(e.target.value) })}/><Stack direction="row" flexWrap="wrap"><FormControlLabel label="Finding required" control={<Checkbox checked={c.required} disabled={readonly} onChange={e => updateCriterion(i, { required: e.target.checked })}/>}/><FormControlLabel label="Evidence required" control={<Checkbox checked={c.evidenceRequired} disabled={readonly} onChange={e => updateCriterion(i, { evidenceRequired: e.target.checked })}/>}/><FormControlLabel label="Rationale required" control={<Checkbox checked={c.rationaleRequired} disabled={readonly} onChange={e => updateCriterion(i, { rationaleRequired: e.target.checked })}/>}/></Stack>{draft.responsibilities.length > 0 && <TextField select SelectProps={{ multiple: true }} label={`Related responsibilities for expectation ${i + 1}`} value={c.responsibilityIds} disabled={readonly} onChange={e => updateCriterion(i, { responsibilityIds: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}>{draft.responsibilities.map(r => <MenuItem key={r.id} value={r.id}>{r.text}</MenuItem>)}</TextField>}{draft.requirements.length > 0 && <TextField select SelectProps={{ multiple: true }} label={`Related requirements for expectation ${i + 1}`} value={c.requirementIds} disabled={readonly} onChange={e => updateCriterion(i, { requirementIds: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}>{draft.requirements.map(r => <MenuItem key={r.id} value={r.id}>{r.text}</MenuItem>)}</TextField>}</Stack></Box>; })}{!readonly && <Button variant="outlined" disabled={!sources.length} onClick={() => { const s = sources[0]; const n = s.criteria[0]; const v = s.versionId || s.id; change({ ...draft, criteria: [...draft.criteria, { id: key(), sourceType: s.sourceType, ...(s.sourceType === 'strategy' ? { strategyVersionId: v } : { frameworkVersionId: v }), criterionId: n?.id || '', ...(n?.levelIds.length ? { expectedLevelId: '' } : { evaluationTarget: { scaleId: 'percent', value: 0 } }), weight: 1, required: true, evidenceRequired: true, rationaleRequired: true, responsibilityIds: [], requirementIds: [] }] }); }}>Add expectation</Button>}</Stack>}
          {tab === 2 && <Stack gap={2}><Typography variant="h6">Role versions</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Existing appraisals keep the exact version recorded at launch.</Typography>{record.data?.versions.map(v => <Box key={v.id} sx={{ borderBottom: '1px solid var(--suite-line)', pb: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography fontWeight={650}>Version {v.version} — {v.status === 'published' ? 'Published' : 'Draft'}</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>{v.publishedAt ? `Published ${new Date(v.publishedAt).toLocaleString()} by ${v.publishedBy?.name || 'Not recorded'}` : v.createdAt ? `Created ${new Date(v.createdAt).toLocaleString()}` : 'Date not recorded'}</Typography></Box><Button onClick={() => { setVersion(v); setDraft(content(v)); setTab(0); setNotice(`${v.status === 'published' ? 'Viewing published' : 'Editing draft'} version ${v.version}`); }}>View version {v.version}</Button></Stack></Box>)}</Stack>}
        </Surface></Box>
        {imported && !roleId && <FormControlLabel sx={{ mt: 2 }} label="I have reviewed these role details" control={<Checkbox checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>}/>}
        <EditorActions status={notice}>{!readonly ? <><Button variant="contained" disabled={busy || !!imported && !reviewed} onClick={() => void save()}>{busy ? 'Saving…' : imported ? 'Save reviewed draft' : 'Save draft'}</Button>{roleId && <Button variant="outlined" disabled={busy || notice === 'Unsaved changes'} onClick={() => setConfirm('publish')}>Review and publish</Button>}</> : roleId && !record.data?.archivedAt && <Button variant="contained" disabled={busy} onClick={() => void transition('version')}>Create new version</Button>}{roleId && !record.data?.archivedAt && <Button disabled={busy} color="error" onClick={() => setConfirm('archive')}>Archive role</Button>}</EditorActions>
      </>}
      <ConfirmDialog open={confirm === 'publish'} title={`Publish version ${version?.version}?`} action={`Publish v${version?.version}`} onClose={() => setConfirm(null)} onConfirm={() => void transition('publish')} busy={busy}><Typography>{draft.name}</Typography><Typography sx={{ mt: 2 }}>{draft.responsibilities.length} responsibilities, {draft.requirements.length} requirements and {draft.criteria.length} expectations.</Typography><Typography sx={{ mt: 2 }}>This version becomes available for new appraisals. Existing appraisals keep their original role version.</Typography></ConfirmDialog>
      <ConfirmDialog open={confirm === 'archive'} title={`Archive ${draft.name}?`} action="Archive role" onClose={() => setConfirm(null)} onConfirm={() => void transition('archive')} busy={busy}><Typography>It will no longer be available for new appraisals. Existing appraisals and reports keep their role version.</Typography></ConfirmDialog>
      <ConfirmDialog open={confirm === 'duplicate'} title="A role with this name already exists" action="Create a separate role" onClose={() => setConfirm(null)} onConfirm={() => { requestKey.current = newIdempotencyKey(); void save(true); }} busy={busy}><Typography>Open the existing role from the library, or deliberately create a separate profile with the same name.</Typography></ConfirmDialog>
      <ConfirmDialog open={!!comparison} title="Compare your draft with the latest version" action="Reload latest" onClose={() => setComparison(null)} onConfirm={() => { if (comparison) {
            const v = comparison.versions.find(v => v.id === version?.id) || comparison.versions[0];
            setVersion(v);
            setDraft(content(v));
            void record.mutate(comparison, false);
            setNotice('Latest version loaded');
            setError(null);
            setComparison(null);
        } }}><Alert severity="warning">Reloading replaces your unsaved changes. Copy anything you want to keep first.</Alert><Stack direction={{ xs: 'column', sm: 'row' }} gap={3} mt={2}><Box flex={1}><Typography fontWeight={650}>Your changes</Typography><Typography>{draft.name}</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{draft.description}</Typography></Box><Box flex={1}><Typography fontWeight={650}>Latest saved</Typography><Typography>{comparison?.versions.find(v => v.id === version?.id)?.name}</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{comparison?.versions.find(v => v.id === version?.id)?.description}</Typography></Box></Stack></ConfirmDialog>
    </>}
  </CompetencyPage>;
}
