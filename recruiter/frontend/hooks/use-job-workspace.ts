"use client"

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { getJobWorkspace, type JobWorkflowType } from '@/lib/jobWorkspace';

export function useJobWorkspace(workflowType?: JobWorkflowType) {
  const pathname = usePathname();
  return useMemo(() => getJobWorkspace(pathname, workflowType), [pathname, workflowType]);
}
