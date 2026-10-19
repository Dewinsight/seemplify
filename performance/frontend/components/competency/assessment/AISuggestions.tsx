'use client';

import { useEffect, useState } from 'react';

import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Stack, TextField, Typography } from '@mui/material';

import { competencyRequest, competencyError, newIdempotencyKey } from '@/lib/competency-api';

import { Assessment, Finding, Suggestion, permitted, displayDate } from './types';

import { Empty, muted, Section } from './ui';

export default function AISuggestions({assessment,criterionId,onUse,refresh}:{assessment:Assessment;criterionId:string;onUse:(text:string,id:string,mode:'append'|'replace')=>void;refresh:()=>Promise<void>}) {

 const [settings,setSettings]=useState<{aiDraftsEnabled?:boolean;noticeText?:string;policyVersion?:string}|null>(null);useEffect(()=>{competencyRequest<{aiDraftsEnabled?:boolean;noticeText?:string;policyVersion?:string}>('GET','/settings').then(setSettings).catch(()=>setSettings({}));},[]);

 const [consent,setConsent]=useState(false);const [selected,setSelected]=useState<string[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [editing,setEditing]=useState<string|null>(null);const [text,setText]=useState('');const [mode,setMode]=useState<'append'|'replace'>('append');

 const sources=(assessment.evidence||[]).filter(e=>e.criterionIds.includes(criterionId)&&!e.sourceUnavailable&&e.status==='ready');const suggestions=(assessment.aiSuggestions||[]).filter(s=>s.observations?s.observations.some(o=>o.criterionId===criterionId):!s.criterionId||s.criterionId===criterionId);

 async function generate(){setError('');if(!consent||!selected.length||!settings?.policyVersion){setError('Choose evidence and confirm AI processing before requesting suggestions.');return;}setBusy(true);try{await competencyRequest('POST',`/assessments/${assessment.id}/ai-suggestions`,{evidenceIds:selected,consent:{acknowledged:true,policyVersion:settings?.policyVersion}},undefined,newIdempotencyKey());await refresh();}catch(e){setError(competencyError(e).message);}finally{setBusy(false);}}

 async function review(s:Suggestion,status:'accepted'|'edited'|'dismissed',value?:string){setError('');setBusy(true);try{await competencyRequest('PATCH',`/assessments/${assessment.id}/ai-suggestions/${s.id}`,{status,...(value?{text:value}:{})},s.revision);if(status!=='dismissed')onUse(value||s.observations?.filter(o=>o.criterionId===criterionId).map(o=>o.text).join('\n\n')||s.observation||s.text||s.draft?.observation||s.draft?.rationale||'',s.id,mode);setEditing(null);await refresh();}catch(e){setError(competencyError(e).message);}finally{setBusy(false);}}

 return <Section title="AI assistance"><Typography variant="body2" sx={{...muted,mb:2}}>Optional suggestions use your connected AI account and the selected role. You choose the rating and remain responsible for the finding.</Typography>{error&&<Alert severity="warning" sx={{mb:2}}>{error} You can continue manually.</Alert>}

 {!permitted(assessment.allowedActions,'ai.use')||!settings?.aiDraftsEnabled||!settings?.policyVersion||['published','finalised'].includes(assessment.status)?<Alert severity="info">AI assistance is unavailable for this assessment. Continue with your own evidence and findings.</Alert>:<Stack gap={1.5}>

 <Typography variant="subtitle2">Evidence to analyse</Typography>{settings?.noticeText&&<Typography variant="body2" sx={muted}>{settings.noticeText}</Typography>}{!sources.length?<Typography variant="body2" sx={muted}>Add supporting evidence for this criterion before requesting a suggestion.</Typography>:sources.map(e=><FormControlLabel key={e.id} control={<Checkbox checked={selected.includes(e.id)} onChange={event=>setSelected(v=>event.target.checked?[...v,e.id]:v.filter(x=>x!==e.id))}/>} label={e.title||e.originalName||'Evidence'}/>)}

 <FormControlLabel control={<Checkbox checked={consent} onChange={e=>setConsent(e.target.checked)}/>} label="I agree to process the selected evidence with my connected AI service for competency analysis."/><Button variant="outlined" disabled={busy||!sources.length} onClick={()=>void generate()}>{busy?'Processing…':'Request AI suggestions'}</Button><Typography variant="caption" sx={muted}>You can connect or manage AI sharing in your account settings. No rating or final classification is selected automatically.</Typography>

 </Stack>}

 {suggestions.length===0?<Empty>No AI drafts for this criterion.</Empty>:suggestions.map(s=>{const observations=s.observations?.filter(o=>o.criterionId===criterionId);const citations=observations?.flatMap(o=>o.citations)||s.citations||[];const value=s.status==='edited'?s.text||'':observations?.map(o=>o.text).join('\n\n')||s.observation||s.text||s.draft?.observation||s.draft?.rationale||'';const unusable=!!citations.some(c=>c.verified===false||c.available===false);return <Box key={s.id} sx={{mt:2,pt:2,borderTop:'1px solid var(--suite-line)'}}><Stack direction="row" gap={1} flexWrap="wrap"><Chip size="small" label="AI draft"/><Chip size="small" label={s.status}/></Stack><Typography variant="caption" sx={muted}>Generated {displayDate(s.generatedAt)} · Model {s.model||'Not recorded'} · Provider {s.provider||'Not recorded'}</Typography>{s.status==='pending'||s.status==='running'?<Typography role="status" sx={{mt:2}}>Preparing a suggestion. Refresh to check its progress.</Typography>:[ 'failed','cancelled','expired' ].includes(s.status)?<Alert severity="warning" sx={{mt:2}}>{s.error?.message||'AI analysis is unavailable. Continue manually.'}</Alert>:<><Typography sx={{mt:2,whiteSpace:'pre-wrap'}}>{value}</Typography><Stack gap={1} mt={1}>{citations.map((c,i)=><Typography key={i} variant="body2" sx={muted}>{c.label||assessment.evidence?.find(e=>e.id===c.evidenceId)?.title||`Evidence ${i+1}`} {c.quote?`“${c.quote}”`:''}{c.page?` · page ${c.page}`:''}{c.startSeconds!==undefined?` · ${Math.floor(c.startSeconds/60)}:${String(c.startSeconds%60).padStart(2,'0')}`:''}{c.verified===false||c.available===false?' · Source unavailable — verify before using':''}</Typography>)}</Stack>{permitted(assessment.allowedActions,'assessment.edit')&&!['published','finalised'].includes(assessment.status)&&['draft','ready','completed','dismissed'].includes(s.status)&&<><FormControlLabel control={<Checkbox checked={mode==='replace'} onChange={e=>setMode(e.target.checked?'replace':'append')}/>} label="Replace my existing rationale instead of appending"/>{editing===s.id?<Stack gap={1}><TextField label="Reviewed AI observation" multiline minRows={3} value={text} onChange={e=>setText(e.target.value)}/><Button disabled={busy||!text.trim()||unusable} onClick={()=>void review(s,'edited',text)}>Use edited draft</Button><Button onClick={()=>setEditing(null)}>Cancel</Button></Stack>:<Stack direction="row" gap={1} flexWrap="wrap"><Button disabled={busy||unusable} onClick={()=>void review(s,'accepted')}>Accept as draft finding</Button><Button disabled={busy} onClick={()=>{setEditing(s.id);setText(value);}}>Edit before using</Button><Button disabled={busy} onClick={()=>void review(s,'dismissed')}>Dismiss</Button></Stack>}</>}</>}</Box>;})}

 {suggestions.some(s=>['pending','running'].includes(s.status))&&<Button onClick={()=>void refresh()}>Refresh AI status</Button>}

 </Section>;

}
