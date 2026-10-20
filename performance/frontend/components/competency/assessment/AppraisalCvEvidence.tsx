'use client';
import { useEffect, useState } from 'react';
import { Box, Stack } from '@mui/material';
import { competencyError, competencyRequest } from '@/lib/competency-api';
import CvEvidencePanel from './CvEvidencePanel';
import type { LinkedCompetencyAssessment } from './LinkedCompetencyAssessmentPanel';
import type { Assessment } from './types';
import { permitted } from './types';
import { Failure, Loading } from './ui';

export interface AppraisalCvEvidenceProps { appraisalId: string }

/** Resolve through the authorised appraisal link; never accept an assessment ID from a form. */
export default function AppraisalCvEvidence({ appraisalId }: AppraisalCvEvidenceProps) {
  return <AppraisalCvEvidenceContent key={appraisalId} appraisalId={appraisalId}/>;
}

function AppraisalCvEvidenceContent({ appraisalId }: AppraisalCvEvidenceProps) {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
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
      }
    }
    void load();
    return () => { current = false; };
  }, [appraisalId, attempt]);

  async function refresh(id: string) {
    const record = await competencyRequest<Assessment>('GET', `/assessments/${encodeURIComponent(id)}`);
    setAssessments(previous => previous?.map(item => item.id === id ? record : item) || [record]);
  }
  if (error) return <Box mb={3}><Failure message={`CV evidence could not be loaded. ${error}`} retry={() => { setAssessments(null); setError(''); setAttempt(value => value + 1); }}/></Box>;
  if (!assessments) return <Box mb={3}><Loading label="Checking optional CV evidence…"/></Box>;
  const visible = assessments.filter(assessment => assessment.definitionSnapshot.cvRequested === true || assessment.cvRequested === true || assessment.evidence?.some(source => source.documentType === 'cv') || (permitted(assessment.allowedActions, 'evidence.create') && ['draft', 'in_progress', 'reopened'].includes(assessment.status)));
  if (!visible.length) return null;
  return <Stack gap={2} mb={3}>{visible.map(assessment => <CvEvidencePanel key={`${appraisalId}:${assessment.id}`} assessment={assessment} refresh={() => refresh(assessment.id)}/>)}</Stack>;
}
