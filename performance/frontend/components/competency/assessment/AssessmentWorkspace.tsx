'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';

import { competencyRequest, competencyError, newIdempotencyKey } from '@/lib/competency-api';

import { Assessment, Finding, displayDate, human, permitted } from './types';

import { controls, Failure, Loading, muted, panel, Section } from './ui';

import EvidencePanel from './EvidencePanel';

import OralPanel from './OralPanel';

import AISuggestions from './AISuggestions';

import CompletionPanel from './CompletionPanel';

import FeedbackPanel from './FeedbackPanel';

import CompetencyReportSection from '../reports/CompetencyReportSection';

const findingInput=(f:Finding)=>({criterionId:f.criterionId,status:f.status,rationale:f.rationale,evidenceIds:f.evidenceIds,reviewedSuggestionIds:f.reviewedSuggestionIds,...(f.observedLevelId?{observedLevelId:f.observedLevelId}:{}),...(f.rating!==undefined?{rating:f.rating}:{})});
const initialFinding=(id:string):Finding=>({criterionId:id,status:'not_started',rationale:'',evidenceIds:[],reviewedSuggestionIds:[]});
const sameFinding=(a:Finding|undefined,b:Finding|undefined,id:string)=>JSON.stringify(findingInput(a||initialFinding(id)))===JSON.stringify(findingInput(b||initialFinding(id)));

export default function AssessmentWorkspace({assessmentId}:{assessmentId:string}) {

 const [comparison,setComparison]=useState<Assessment|null>(null);const [mine,setMine]=useState<Finding[]>([]);const [keepMine,setKeepMine]=useState<string[]>([]);

 const [assessment,setAssessment]=useState<Assessment|null>(null);const [items,setItems]=useState<Finding[]>([]);const [selected,setSelected]=useState('');const [tab,setTab]=useState(0);const [filter,setFilter]=useState('all');const [error,setError]=useState('');const [conflict,setConflict]=useState(false);const [dirty,setDirty]=useState(false);const [saving,setSaving]=useState(false);const [saved,setSaved]=useState('');const [roleOpen,setRoleOpen]=useState(false);const [reopen,setReopen]=useState(false);const [reopenReason,setReopenReason]=useState('');const [activity,setActivity]=useState<{action:string;actor?:{name:string};createdAt?:string;details?:{reason?:string;resultVersion?:number}}[]|null>(null);const draftRef=useRef<Finding[]>([]);const reopenKey=useRef(newIdempotencyKey());

 const baselineRef=useRef<Assessment|null>(null);
 const initialSection=useRef<string|null>(null);
 const load=useCallback(async(preserve=false)=>{
  try{
   const data=await competencyRequest<Assessment>('GET',`/assessments/${assessmentId}`);
   if(initialSection.current!==data.id){
    initialSection.current=data.id;
    if(!permitted(data.allowedActions,'assessment.edit'))setTab(permitted(data.allowedActions,'report.view')&&(data.result||data.resultVersions?.length)?3:permitted(data.allowedActions,'evidence.view')?1:0);
    else setTab(0);
   }
   const previous=baselineRef.current?.id===data.id?baselineRef.current:null;
   if(previous&&data.revision<previous.revision)return;
   setSelected(value=>data.definitionSnapshot.criteria.some(c=>c.id===value)?value:data.definitionSnapshot.criteria[0]?.id||'');
   if(preserve&&previous){
    const localChanges=draftRef.current.filter(local=>!sameFinding(local,previous.items.find(item=>item.criterionId===local.criterionId),local.criterionId));
    const conflicting=localChanges.some(local=>!sameFinding(previous.items.find(item=>item.criterionId===local.criterionId),data.items.find(item=>item.criterionId===local.criterionId),local.criterionId));
    const readOnly=!permitted(data.allowedActions,'assessment.edit')||['published','finalised'].includes(data.status);
    if(conflicting||(readOnly&&localChanges.length)){
     if(readOnly)setAssessment({...previous,allowedActions:data.allowedActions});
     setMine(draftRef.current);setComparison(data);setKeepMine([]);setConflict(true);setError(readOnly?'This assessment is now read-only. Your unsaved findings are retained for comparison.':'Another assessor changed a finding you are editing. Compare both versions before saving. Your unsaved findings are retained.');return;
    }
    const merged=data.items.map(current=>localChanges.find(local=>local.criterionId===current.criterionId)||current);
    setItems(merged);draftRef.current=merged;setDirty(localChanges.length>0);
   }else{setItems(data.items||[]);draftRef.current=data.items||[];setDirty(false);setConflict(false);}
   baselineRef.current=data;setAssessment(data);setConflict(false);setError('');if(preserve)setSaved('');
  }catch(e){setError(competencyError(e).message);}
 },[assessmentId]);
 useEffect(()=>{void load();},[load]);

 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);

 const refresh=useCallback(async()=>{await load(true);},[load]);

 function update(patch:Partial<Finding>){setItems(existing=>{const value=existing.find(f=>f.criterionId===selected)||initialFinding(selected);const next=[...existing.filter(f=>f.criterionId!==selected),{...value,...patch}];draftRef.current=next;return next;});setDirty(true);setSaved('');}

 async function save(){if(!assessment)return;setSaving(true);setError('');try{const result=await competencyRequest<Assessment>('PATCH',`/assessments/${assessment.id}`,{items:draftRef.current.filter(f=>JSON.stringify(findingInput(f))!==JSON.stringify(findingInput(assessment.items.find(current=>current.criterionId===f.criterionId)||initialFinding(f.criterionId)))).map(findingInput)},assessment.revision);baselineRef.current=result;setAssessment(result);setItems(result.items||draftRef.current);draftRef.current=result.items||draftRef.current;setDirty(false);setSaved(`Saved ${displayDate(result.updatedAt)}`);setConflict(false);}catch(e){const f=competencyError(e);setConflict(f.status===409);setError(f.status===409?'Someone updated this assessment. Your unsaved findings are retained. Load the current version to compare before saving again.':f.message);}finally{setSaving(false);}}

 async function reloadConflict(){if(!assessment)return;try{const current=await competencyRequest<Assessment>('GET',`/assessments/${assessmentId}`);setMine(draftRef.current);setComparison(current);setKeepMine([]);}catch(e){setError(competencyError(e).message);}}
 function reconcile(useSaved=false){if(!comparison||(!useSaved&&(!permitted(comparison.allowedActions,'assessment.edit')||['published','finalised'].includes(comparison.status))))return;const merged=comparison.items.map(current=>!useSaved&&keepMine.includes(current.criterionId)?mine.find(f=>f.criterionId===current.criterionId)||current:current);baselineRef.current=comparison;setAssessment(comparison);setItems(merged);draftRef.current=merged;setDirty(!useSaved&&keepMine.length>0);setConflict(false);setError('');setSaved(!useSaved&&keepMine.length?'Selected findings restored. Review them and save your draft.':'Current saved findings loaded.');setComparison(null);}

 async function reopenAssessment(){if(!assessment||!reopenReason.trim())return;setSaving(true);try{await competencyRequest('POST',`/assessments/${assessment.id}/reopen`,{reason:reopenReason},assessment.revision,reopenKey.current);setReopen(false);setTab(0);await load();}catch(e){setError(competencyError(e).message);}finally{setSaving(false);}}

 async function loadActivity(){if(!assessment)return;try{const data=await competencyRequest<unknown>('GET',`/audit?resourceId=${encodeURIComponent(assessment.id)}`);setActivity(Array.isArray(data)?data:[]);}catch(e){setError(competencyError(e).message);}}

 if(!assessment)return <Box><Typography component="h1" variant="h4">Competency assessment</Typography>{error?<Failure message={error} retry={()=>void load()}/>:<Loading/>}</Box>;

 const criteria=assessment.definitionSnapshot.criteria;const criterion=criteria.find(c=>c.id===selected);const finding=items.find(f=>f.criterionId===selected)||initialFinding(selected);const final=['published','finalised'].includes(assessment.status);const canAssess=permitted(assessment.allowedActions,'assessment.edit');const canEdit=canAssess&&!final;const hasReport=!!assessment.result||!!assessment.resultVersions?.length;const canViewReport=permitted(assessment.allowedActions,'report.view');const reviewed=criteria.filter(c=>items.find(i=>i.criterionId===c.id)?.status==='assessed').length;const filtered=criteria.filter(c=>filter==='all'||(filter==='assessed'?items.find(i=>i.criterionId===c.id)?.status==='assessed':items.find(i=>i.criterionId===c.id)?.status!=='assessed'));

 const normalize=criterion&&assessment.definitionSnapshot.scoringConfig.normalization.find(n=>n.sourceVersionId===criterion.sourceVersionId&&n.criterionId===(criterion.criterionId||criterion.id));const scale=normalize&&assessment.definitionSnapshot.scoringConfig.ratingScales.find(s=>s.id===normalize.ratingScaleId);

 return <Box sx={{...controls,color:'var(--suite-ink)',maxWidth:1600,mx:'auto',pb:8,'& .MuiInputBase-root':{background:'var(--suite-surface)'},'& .MuiOutlinedInput-notchedOutline':{borderColor:'var(--suite-line-strong)'},'& .MuiTab-root':{minHeight:48}}}>

 <Button component={Link} href="/competency/assessments" sx={{mb:2}}>Back to assessments</Button><Stack direction={{xs:'column',md:'row'}} justifyContent="space-between" gap={2} mb={3}><Box sx={{minWidth:0}}><Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap"><Typography component="h1" variant="h4" fontWeight={650}>{assessment.participant.name}</Typography><Chip label={human(assessment.status)} size="small"/></Stack><Typography sx={{mt:1}}>{assessment.definitionSnapshot.role.name} · Role version {assessment.definitionSnapshot.role.version}</Typography><Typography variant="body2" sx={{...muted,mt:1}}>Assigned assessors: {assessment.assessors.map(p=>p.name).join(', ')||'Not recorded'} · Updated {displayDate(assessment.updatedAt)}</Typography><Stack direction="row" gap={1} mt={1.5} flexWrap="wrap">{assessment.definitionSnapshot.selectedInputTypes.map(s=><Chip key={s} label={human(s)} size="small" variant="outlined"/>)}<Button size="small" onClick={()=>setRoleOpen(true)}>View role expectations</Button></Stack></Box><Box><Stack direction="row" gap={1} flexWrap="wrap">{canEdit&&<Button variant="contained" disabled={!dirty||saving||conflict} onClick={()=>void save()}>{saving?'Saving…':'Save draft'}</Button>}{canEdit&&<Button variant="outlined" onClick={()=>setTab(4)}>Check completion</Button>}{permitted(assessment.allowedActions,'assessment.reopen')&&final&&<Button variant="outlined" onClick={()=>setReopen(true)}>Reopen assessment</Button>}</Stack><Typography role="status" aria-live="polite" sx={{...muted,mt:1,fontSize:13}}>{dirty?'Unsaved findings':saved||`Last saved ${displayDate(assessment.updatedAt)}`}</Typography></Box></Stack>

 {error&&<Box mb={2}><Failure message={error} conflict={conflict} retry={conflict?()=>void reloadConflict():undefined}/></Box>}{final&&<Alert severity="success" sx={{mb:2}}>This assessment is final. Its published report preserves the role and submitted feedback used for this version.</Alert>}{assessment.status==='reopened'&&<Alert severity="info" sx={{mb:2}}>{canAssess?'You are editing a reopened draft. The previous final report remains available in Report.':'This assessment has been reopened. Your previous final report remains available; new reviewer findings stay private.'}</Alert>}

 <Tabs value={tab} onChange={(_,v)=>{setTab(v);if(v===5)void loadActivity();}} variant="scrollable" scrollButtons="auto" aria-label="Assessment sections" sx={{mb:3,borderBottom:'1px solid var(--suite-line)'}}><Tab value={0} label={canAssess?'Assessment':'Role expectations'}/>{permitted(assessment.allowedActions,'evidence.view')&&<Tab value={1} label="Evidence"/>}<Tab value={2} label="Oral assessment"/>{canViewReport&&(canAssess||hasReport)&&<Tab value={3} label={assessment.status==='reopened'?'Previous report':'Report'}/>} {canAssess&&<Tab value={4} label="Completion & outcome"/>}{permitted(assessment.allowedActions,'audit.view')&&<Tab value={5} label="Activity"/>}</Tabs>

 {tab===0&&!canAssess&&<Section title="Role expectations"><Typography sx={{...muted,mb:2}}>{hasReport?'The submitted findings and outcome are preserved in the final report.':'Your assessor is reviewing the evidence. Reviewer findings remain private until a report is published.'}</Typography>{criteria.map(c=><Box key={c.id} sx={{py:2,borderTop:'1px solid var(--suite-line)'}}><Typography component="h3" fontWeight={650}>{c.name}</Typography><Typography sx={muted}>{c.sourceName||human(c.sourceType)}</Typography><Typography sx={{mt:1}}>Expected: {c.expectedLevel?.label??c.evaluationTarget?.value??'Not recorded'}</Typography>{c.expectedLevel?.description&&<Typography variant="body2" sx={{mt:1}}>{c.expectedLevel.description}</Typography>}</Box>)}{canViewReport&&hasReport&&<Button component={Link} href={`/competency/reports/${assessment.id}`} sx={{mt:2}} variant="outlined">{assessment.status==='reopened'?'View previous report':'View report'}</Button>}</Section>}

 {tab===0&&canAssess&&<Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:'250px minmax(360px,1fr) 320px'},gap:3,alignItems:'start'}}>

 <Box component="nav" aria-label="Assessment criteria" sx={{...panel,position:{lg:'sticky'},top:20}}><Typography component="h2" fontWeight={650} mb={1}>Criteria</Typography><Typography variant="body2" sx={muted}>{reviewed} of {criteria.length} assessed</Typography><LinearProgress variant="determinate" value={criteria.length?reviewed/criteria.length*100:0} sx={{my:2}}/><TextField select fullWidth size="small" label="Filter criteria" value={filter} onChange={e=>setFilter(e.target.value)}><MenuItem value="all">All</MenuItem><MenuItem value="attention">Needs attention</MenuItem><MenuItem value="assessed">Assessed</MenuItem></TextField><Box sx={{display:{xs:"block",lg:"none"},mt:2}}><TextField select fullWidth label="Assessment criterion" value={selected} onChange={e=>setSelected(e.target.value)}>{criteria.map(c=><MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField></Box><Stack mt={2} gap={.5} sx={{display:{xs:"none",lg:"flex"}}}>{filtered.map(c=><Button key={c.id} aria-current={selected===c.id?'true':undefined} onClick={()=>setSelected(c.id)} sx={{textAlign:'left',justifyContent:'start',display:'block',p:1.5,color:'var(--suite-ink)',background:selected===c.id?'var(--suite-accent-soft)':'transparent',borderLeft:selected===c.id?'3px solid var(--suite-accent)':'3px solid transparent'}}><Typography variant="caption" sx={muted}>{human(c.sourceType)}</Typography><Typography fontWeight={selected===c.id?650:450}>{c.name}</Typography><Typography variant="caption" sx={muted}>{human(items.find(i=>i.criterionId===c.id)?.status||'not_started')}</Typography></Button>)}</Stack>{!filtered.length&&<Typography sx={{mt:2,...muted}}>No criteria match this filter.</Typography>}</Box>

 {criterion?<Box sx={{minWidth:0}}><Section title={criterion.name}><Typography sx={muted}>{criterion.description}</Typography><Box sx={{mt:2,p:2,bgcolor:'var(--suite-surface-muted)',borderRadius:2}}><Typography variant="subtitle2">Expected for this role</Typography><Typography fontWeight={650}>{criterion.expectedLevel?.label||criterion.levels.find(l=>l.id===criterion.expectedLevelId)?.label|| (criterion.evaluationTarget?`${criterion.evaluationTarget.value} ${scale?.label||''}`:'No expected level recorded')}</Typography>{criterion.expectedLevel?.description&&<Typography variant="body2" sx={{mt:.5,...muted}}>{criterion.expectedLevel.description}</Typography>}<Typography variant="caption" sx={muted}>{criterion.sourceName||human(criterion.sourceType)} · Role version {assessment.definitionSnapshot.role.version}</Typography></Box>

 <Stack gap={2.5} mt={3}><TextField select label="Finding status" value={finding.status} disabled={!canEdit} onChange={e=>update({status:e.target.value as Finding['status'],...(e.target.value!=='assessed'?{observedLevelId:undefined,rating:undefined}:{})})}><MenuItem value="not_started">Not started</MenuItem><MenuItem value="assessed">Assessed</MenuItem><MenuItem value="insufficient_evidence">Insufficient evidence</MenuItem></TextField>{finding.status==='insufficient_evidence'&&<Alert severity="warning">Insufficient evidence remains unscored. Explain what is missing and collect more evidence, or record an authorised exception at completion.</Alert>}

 {normalize?.method==='rating_scale'?<TextField label={`Observed ${scale?.label||'rating'}`} type="number" value={finding.rating??''} disabled={!canEdit||finding.status!=='assessed'} onChange={e=>update({rating:e.target.value===''?undefined:Number(e.target.value),observedLevelId:undefined})} inputProps={{min:scale?.min,max:scale?.max,step:'any'}} helperText={scale?`Use ${scale.min}–${scale.max} on the configured scale.`:'The configured scale is unavailable.'}/>:<TextField select label="Observed level" value={finding.observedLevelId||''} disabled={!canEdit||finding.status!=='assessed'} onChange={e=>update({observedLevelId:e.target.value||undefined,rating:undefined})}><MenuItem value="">Choose an observed level</MenuItem>{criterion.levels.map(l=><MenuItem key={l.id} value={l.id}>{l.label}</MenuItem>)}</TextField>}

 {finding.observedLevelId&&<Typography variant="body2" sx={muted}>{criterion.levels.find(l=>l.id===finding.observedLevelId)?.description}</Typography>}

 <TextField label={criterion.rationaleRequired?'Assessor rationale (required)':'Assessor rationale'} multiline minRows={6} value={finding.rationale} disabled={!canEdit} onChange={e=>update({rationale:e.target.value})} helperText="Explain how the evidence supports your finding against this role expectation."/>

 <Box component="fieldset" sx={{border:'1px solid var(--suite-line)',borderRadius:2,p:2,minWidth:0}}><Typography component="legend">Supporting evidence{criterion.evidenceRequired?' (required)':''}</Typography>{(assessment.evidence||[]).filter(e=>e.criterionIds.includes(selected)).map(e=><FormControlLabel key={e.id} sx={{display:'flex',overflowWrap:'anywhere'}} control={<Checkbox disabled={!canEdit||e.sourceUnavailable||e.status!=='ready'} checked={finding.evidenceIds.includes(e.id)} onChange={event=>update({evidenceIds:event.target.checked?[...finding.evidenceIds,e.id]:finding.evidenceIds.filter(id=>id!==e.id)})}/>} label={`${e.title||e.originalName||'Evidence'}${e.sourceUnavailable||e.status!=='ready'?' · Source no longer retained':''}`}/>)}{!(assessment.evidence||[]).some(e=>e.criterionIds.includes(selected))&&<Typography variant="body2" sx={muted}>No supporting evidence linked to this criterion.</Typography>}<Button onClick={()=>setTab(1)}>Manage evidence</Button></Box>

 {canEdit&&<Stack direction={{xs:'column',sm:'row'}} gap={1}><Button variant="contained" onClick={()=>void save()} disabled={!dirty||saving||conflict}>Save draft</Button><Button onClick={()=>setSelected(criteria[(criteria.findIndex(c=>c.id===selected)+1)%criteria.length]?.id||selected)}>Next criterion</Button></Stack>}

 {saved.includes('Current version loaded')&&<Box component="details"><summary>Compare with current saved finding</summary><Typography sx={{whiteSpace:'pre-wrap',mt:1}}>{assessment.items.find(i=>i.criterionId===selected)?.rationale||'No saved rationale.'}</Typography></Box>}

 </Stack></Section><Box mt={3}><FeedbackPanel assessment={assessment} refresh={refresh}/></Box></Box>:<Alert severity="info">This assessment has no criteria to review.</Alert>}

 <Box sx={{minWidth:0}}><AISuggestions assessment={assessment} criterionId={selected} refresh={refresh} onUse={(text,id,mode)=>update({rationale:mode==='append'?[finding.rationale,text].filter(Boolean).join('\n\n'):text,reviewedSuggestionIds:[...new Set([...finding.reviewedSuggestionIds,id])]})}/></Box></Box>}

 <Box hidden={tab!==1}><EvidencePanel assessment={assessment} refresh={refresh}/></Box><Box hidden={tab!==2}><OralPanel assessment={assessment} refresh={refresh}/></Box> {tab===3&&<CompetencyReportSection assessmentId={assessment.id} allowedActions={assessment.allowedActions}/>} {tab===4&&(!canEdit&&!final?<Alert severity='info'>The assigned assessor manages completion. Your permitted findings are available in Assessment.</Alert>:final?<Alert severity="info">This assessment is final. Open Report to view the outcome.</Alert>:<CompletionPanel assessment={assessment} dirty={dirty} onSaved={()=>load()} onCriterion={id=>{setSelected(id);setTab(0);}} onOral={()=>setTab(2)}/>)}

 {tab===5&&<Section title="Assessment activity">{!activity?<Loading label="Loading activity…"/>:activity.length===0?<Typography sx={muted}>No activity is available in your scope.</Typography>:activity.map((a,i)=><Box key={i} sx={{py:2,borderTop:'1px solid var(--suite-line)'}}><Typography fontWeight={600}>{human(a.action)}</Typography><Typography variant="body2" sx={muted}>{a.actor?.name||'Not recorded'} · {displayDate(a.createdAt)}</Typography>{a.details?.reason&&<Typography>{a.details.reason}</Typography>}</Box>)}</Section>}

 <Dialog open={!!comparison} onClose={()=>setComparison(null)} fullWidth maxWidth="md"><DialogTitle>Compare your findings with the saved version</DialogTitle><DialogContent><Typography sx={{mb:2}}>Nothing will be overwritten automatically. Choose which of your unsaved findings to keep, or load the current saved version.</Typography>{mine.filter(m=>JSON.stringify(m)!==JSON.stringify(comparison?.items.find(c=>c.criterionId===m.criterionId))).map(m=>{const current=comparison?.items.find(c=>c.criterionId===m.criterionId);return <Box key={m.criterionId} sx={{p:2,mb:2,border:'1px solid var(--suite-line)',borderRadius:2}}><Typography fontWeight={650}>{criteria.find(c=>c.id===m.criterionId)?.name||'Assessment criterion'}</Typography><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2,my:2}}><Box><Typography variant="subtitle2">Current saved finding</Typography><Typography>{human(current?.status||'not_started')} · {current?.rating??(criteria.find(c=>c.id===m.criterionId)?.levels.find(l=>l.id===current?.observedLevelId)?.label||'No observed level')}</Typography><Typography sx={{whiteSpace:'pre-wrap'}}>{current?.rationale||'No rationale recorded'}</Typography></Box><Box><Typography variant="subtitle2">Your unsaved finding</Typography><Typography>{human(m.status)} · {m.rating??(criteria.find(c=>c.id===m.criterionId)?.levels.find(l=>l.id===m.observedLevelId)?.label||'No observed level')}</Typography><Typography sx={{whiteSpace:'pre-wrap'}}>{m.rationale||'No rationale recorded'}</Typography></Box></Box><FormControlLabel control={<Checkbox disabled={!comparison||!permitted(comparison.allowedActions,'assessment.edit')||['published','finalised'].includes(comparison.status)} checked={keepMine.includes(m.criterionId)} onChange={e=>setKeepMine(v=>e.target.checked?[...v,m.criterionId]:v.filter(id=>id!==m.criterionId))}/>} label="Keep my unsaved finding for this criterion"/></Box>;})}</DialogContent><DialogActions><Button onClick={()=>setComparison(null)}>Return to my draft</Button><Button onClick={()=>reconcile(true)}>Use saved version</Button><Button variant="contained" disabled={!keepMine.length||!comparison||!permitted(comparison.allowedActions,'assessment.edit')||['published','finalised'].includes(comparison.status)} onClick={()=>reconcile()}>Apply selected findings</Button></DialogActions></Dialog>

 <Dialog open={roleOpen} onClose={()=>setRoleOpen(false)} maxWidth="md" fullWidth><DialogTitle>{assessment.definitionSnapshot.role.name} · Version {assessment.definitionSnapshot.role.version}</DialogTitle><DialogContent><Typography sx={{whiteSpace:'pre-wrap'}}>{assessment.definitionSnapshot.role.description}</Typography><Typography component="h3" variant="h6" mt={3}>Responsibilities</Typography>{assessment.definitionSnapshot.role.responsibilities?.map(r=><Typography key={r.id} sx={{mt:1}}>{r.text}</Typography>)}<Typography component="h3" variant="h6" mt={3}>Requirements</Typography>{assessment.definitionSnapshot.role.requirements?.map(r=><Typography key={r.id} sx={{mt:1}}>{r.text}</Typography>)}<Alert severity="info" sx={{mt:3}}>These are the role expectations saved when this assessment started. Later library edits do not change them.</Alert></DialogContent><DialogActions><Button onClick={()=>setRoleOpen(false)}>Close role expectations</Button></DialogActions></Dialog>

 <Dialog open={reopen} onClose={()=>!saving&&setReopen(false)} fullWidth maxWidth="sm"><DialogTitle>Reopen assessment</DialogTitle><DialogContent><Typography sx={{mb:2}}>The previous final report remains unchanged. Reopening creates an editable revision so you can publish a new result.</Typography><TextField label="Reason for reopening" value={reopenReason} onChange={e=>{setReopenReason(e.target.value);reopenKey.current=newIdempotencyKey();}} required fullWidth multiline minRows={3}/></DialogContent><DialogActions><Button disabled={saving} onClick={()=>setReopen(false)}>Cancel</Button><Button variant="contained" disabled={saving||!reopenReason.trim()} onClick={()=>void reopenAssessment()}>{saving?'Reopening…':'Reopen assessment'}</Button></DialogActions></Dialog>

 </Box>;

}
