'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Stack, Typography } from '@mui/material';
import { competencyRequest, competencyError } from '@/lib/competency-api';
import { displayDate, human, rows } from './types';
import { Failure, Loading, muted, Section } from './ui';
type Linked = { id?:string;assessmentId?:string;status:string;role?:{name:string;version:number};participant?:{name:string};createdAt?:string };
export default function LinkedCompetencyAssessmentPanel({appraisalId}:{appraisalId:string}) {
 const [links,setLinks]=useState<Linked[]|null>(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setError('');competencyRequest<unknown>('GET',`/appraisal-links/${appraisalId}`).then(data=>{if(!active)return;const value=data as {assessments?:Linked[];links?:Linked[];assessmentId?:string;status?:string};setLinks(Array.isArray(data)?data:value.assessments||value.links||(value.assessmentId?[value as Linked]:[]));}).catch(e=>{if(active)setError(competencyError(e).message);});return()=>{active=false;};},[appraisalId,attempt]);
 if(error)return <Failure message={error} retry={()=>setAttempt(v=>v+1)}/>;
 if(!links)return <Loading label="Checking linked competency assessment…"/>;
 if(!links.length)return null;
 return <Section title="Competency assessment">{links.map((l,i)=><Stack key={l.assessmentId||l.id||i} direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={2} sx={{py:1}}><div><Typography fontWeight={650}>{l.role?.name||'Selected assessment role'}{l.role?.version?` · Version ${l.role.version}`:''}</Typography><Typography variant="body2" sx={muted}>{human(l.status||'draft')} · Created {displayDate(l.createdAt)}</Typography></div><Button component={Link} href={`/competency/assessments/${l.assessmentId||l.id}`} variant="outlined">Open assessment workspace</Button></Stack>)}</Section>;
}
