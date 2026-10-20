'use client';
import { useCompetencyBootstrap } from './CompetencyPage';
import LinkedCompetencyAssessmentPanel from './assessment/LinkedCompetencyAssessmentPanel';
import AppraisalCvEvidence from './assessment/AppraisalCvEvidence';
export default function AppraisalCompetencySlot({ appraisalId }: { appraisalId: string }) {
  const bootstrap = useCompetencyBootstrap();
  if (!bootstrap.data?.enabled) return null;
  return <div style={{ marginTop: 24 }}><LinkedCompetencyAssessmentPanel appraisalId={appraisalId} /><AppraisalCvEvidence appraisalId={appraisalId} /></div>;
}
