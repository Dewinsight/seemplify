'use client';
import { use } from 'react';
import CompetencyReportSection from '@/components/competency/reports/CompetencyReportSection';
import { Typography } from '@mui/material';
export default function Page({params}:{params:Promise<{assessmentId:string}>}) { const {assessmentId}=use(params);return <><Typography component="h1" variant="h4" mb={3}>Assessment report</Typography><CompetencyReportSection assessmentId={assessmentId}/></>; }
