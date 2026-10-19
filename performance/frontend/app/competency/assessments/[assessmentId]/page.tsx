'use client';
import { use } from 'react';
import AssessmentWorkspace from '@/components/competency/assessment/AssessmentWorkspace';
export default function Page({ params }: { params: Promise<{ assessmentId: string }> }) { const { assessmentId } = use(params); return <AssessmentWorkspace assessmentId={assessmentId}/>; }
