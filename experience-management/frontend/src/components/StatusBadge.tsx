import { Badge } from '@/components/ui/badge';
import type { AiJob, Survey } from '@/types';

export function SurveyStatus({ status }: { status: Survey['status'] }) {
  const variant = status === 'live' ? 'success' : status === 'closed' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{status === 'live' ? 'Live' : status === 'closed' ? 'Closed' : 'Draft'}</Badge>;
}

export function JobStatus({ job }: { job: AiJob }) {
  const waitingForRuntime = job.stage === 'waiting_for_runtime' || job.stage === 'waiting_for_terra';
  const variant = job.state === 'completed' ? 'success' : job.state === 'failed' ? 'destructive' : waitingForRuntime ? 'warning' : 'secondary';
  const label = waitingForRuntime ? 'Waiting for Experience AI' : job.state === 'processing' ? `${job.progress}%` : job.state;
  return <Badge variant={variant}>{label}</Badge>;
}
