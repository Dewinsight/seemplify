'use client';
import { ReactNode, useEffect, useState } from 'react';
import { Box, Stack } from '@mui/material';
import { competencyError, competencyRequest } from '@/lib/competency-api';
import CvEvidencePanel from './CvEvidencePanel';
import type { LinkedCompetencyAssessment } from './LinkedCompetencyAssessmentPanel';
import type { Assessment } from './types';
import { permitted } from './types';
import { Failure, Loading } from './ui';

export interface AppraisalCvEvidenceProps { appraisalId: string; fallback?: ReactNode; preferFallback?: boolean; required?: boolean; onChanged?: () => Promise<unknown> }

/** Resolve through the authorised appraisal link; never accept an assessment ID from a form. */
export default function AppraisalCvEvidence(props: AppraisalCvEvidenceProps) {
  return <AppraisalCvEvidenceContent key={props.appraisalId} {...props}/>;
}

function AppraisalCvEvidenceContent({ appraisalId, fallback, preferFallback, required, onChanged }: AppraisalCvEvidenceProps) {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const hasFallback = Boolean(fallback);
  useEffect(() => {
    let current = true;
    // Optional role discovery must not indefinitely hide the ordinary CV
    // prompt. Ignore a late result so it cannot discard a selected CV file.
    const deadline = hasFallback ? window.setTimeout(() => {
      if (current) { current = false; setAssessments([]); }
    }, 5000) : undefined;
    async function load() {
      try {
        const data = await competencyRequest<LinkedCompetencyAssessment[] | { assessments?: LinkedCompetencyAssessment[]; links?: LinkedCompetencyAssessment[] }>('GET', `/appraisal-links/${encodeURIComponent(appraisalId)}`);
        const links = Array.isArray(data) ? data : data.assessments || data.links || [];
        const ids = [...new Set(links.map(link => link.assessmentId || link.id).filter((id): id is string => !!id))];
        const records = await Promise.all(ids.map(id => competencyRequest<Assessment>('GET', `/assessments/${encodeURIComponent(id)}`)));
        if (current) setAssessments(records);
      } catch (reason) {
        if (!current) return;
        const failure = competencyError(reason);
        // Ordinary appraisals remain quiet when this optional organisation feature is off.
        if (failure.code === 'COMPETENCY_DISABLED') setAssessments([]);
        else setError(failure.message);
      } finally {
        window.clearTimeout(deadline);
      }
    }
    void load();
    return () => { current = false; window.clearTimeout(deadline); };
  }, [appraisalId, attempt, hasFallback]);

  async function refresh(id: string) {
    const record = await competencyRequest<Assessment>('GET', `/assessments/${encodeURIComponent(id)}`);
    setAssessments(previous => previous?.map(item => item.id === id ? record : item) || [record]);
    await onChanged?.();
  }
  if (error) return <>{fallback}<Box mb={3}><Failure message={`Linked role CV evidence could not be loaded. ${error}`} retry={() => { setAssessments(null); setError(''); setAttempt(value => value + 1); }}/></Box></>;
  if (!assessments) return <Box mb={3}><Loading label="Checking optional CV evidence…"/></Box>;
  const visible = assessments.filter(assessment => assessment.definitionSnapshot.cvRequested === true || assessment.cvRequested === true || assessment.evidence?.some(source => source.documentType === 'cv') || (permitted(assessment.allowedActions, 'evidence.create') && ['draft', 'in_progress', 'reopened'].includes(assessment.status)));
  if (!visible.length) return fallback || null;
  // A CV uploaded before a role was linked stays accessible in its original
  // appraisal storage; do not make the employee upload it again.
  const roleCvs = preferFallback ? visible.filter(assessment => assessment.evidence?.some(source => source.documentType === 'cv')) : visible;
  return <>{preferFallback && fallback}<Stack gap={2} mb={3}>{roleCvs.map(assessment => <CvEvidencePanel key={`${appraisalId}:${assessment.id}`} assessment={assessment} required={required} refresh={() => refresh(assessment.id)}/>)}</Stack></>;
}
