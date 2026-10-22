'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Stack, Typography } from '@mui/material';
import { competencyRequest, competencyError } from '@/lib/competency-api';
import { displayDate, human, permitted } from './types';
import { Failure, Loading, muted, Section } from './ui';
export type LinkedCompetencyAssessment = { cvRequired?:boolean; cvRequested?:boolean; id?:string;assessmentId?:string;status:string;role?:{name:string;version:number};participant?:{name:string};createdAt?:string;currentResultNumber?:number|null;allowedActions?:string[] };
export default function LinkedCompetencyAssessmentPanel({appraisalId, showCompletionHelp = false}:{appraisalId:string;showCompletionHelp?:boolean}) {
 const [links,setLinks]=useState<LinkedCompetencyAssessment[]|null>(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;competencyRequest<unknown>('GET',`/appraisal-links/${appraisalId}`).then(data=>{if(!active)return;setError('');const value=data as {assessments?:LinkedCompetencyAssessment[];links?:LinkedCompetencyAssessment[];assessmentId?:string;status?:string};setLinks(Array.isArray(data)?data:value.assessments||value.links||(value.assessmentId?[value as LinkedCompetencyAssessment]:[]));}).catch(e=>{if(!active)return;const failure=competencyError(e);if(failure.code==='COMPETENCY_DISABLED')setLinks([]);else setError(failure.message);});return()=>{active=false;};},[appraisalId,attempt]);
 if(error)return <Failure message={error} retry={()=>{setError('');setAttempt(v=>v+1);}}/>;
 if(!links)return <Loading label="Checking linked competency assessment…"/>;
 if(!links.length)return null;
 return <Section title="Competency assessment">{showCompletionHelp&&<Typography variant="body2" sx={{mb:2}}>Finalise each linked role assessment using the latest submitted reviewer feedback before completing this appraisal.</Typography>}{links.map((l,i)=>{
  const report=!!l.currentResultNumber&&permitted(l.allowedActions||[],'report.view');const previous=!['published','finalised'].includes(l.status);const edit=permitted(l.allowedActions||[],'assessment.edit');
  return <Stack key={l.assessmentId||l.id||i} direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={2} sx={{py:1}}><div><Typography fontWeight={650}>{l.role?.name||'Selected assessment role'}{l.role?.version?` · Version ${l.role.version}`:''}</Typography><Typography variant="body2" sx={muted}>{human(l.status||'draft')} · Created {displayDate(l.createdAt)}</Typography>{(l.cvRequired||l.cvRequested)&&<Typography variant="body2" sx={muted}>{l.cvRequired ? 'CV required before employee submission' : 'CV requested · Optional evidence'}</Typography>}{report&&previous&&<Typography variant="body2" sx={muted}>Your previous final report remains available. New reviewer findings are not published yet.</Typography>}</div><Stack direction={{xs:'column',sm:'row'}} gap={1}>{report&&<Button component={Link} href={`/competency/reports/${l.assessmentId||l.id}`} variant="outlined">{previous?'View previous report':'View report'}</Button>}{(!report||edit)&&<Button component={Link} href={`/competency/assessments/${l.assessmentId||l.id}`} variant="outlined">{edit?'Open assessment workspace':'View role & evidence'}</Button>}</Stack></Stack>;
 })}</Section>;
}
