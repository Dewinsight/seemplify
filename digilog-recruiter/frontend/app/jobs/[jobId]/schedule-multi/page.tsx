"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { MultiStepInterviewScheduler } from '@/components/ui/multi-step-interview-scheduler';
import { toast } from 'sonner';
import { getJobById, type JobData } from '@/services/jobService';
import { useCreditError } from '@/hooks/useCreditError';
import { CreditErrorDialog } from '@/components/ui/credit-error-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function ScheduleMultiCandidatePage() {
  const params = useParams();
  const router = useRouter();
  const { creditError, showCreditDialog, setShowCreditDialog } = useCreditError();
  const jobId = params.jobId as string;

  const [jobData, setJobData] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (jobId) {
      loadJobData();
    }
  }, [jobId]);

  const loadJobData = async () => {
    try {
      setLoading(true);
      const data = await getJobById(jobId);
      setJobData(data);
    } catch (error) {
      console.error('Error loading job:', error);
      toast.error('Failed to load job details');
      router.push(`/jobs/${jobId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduled = (result: any) => {
    console.log('Multi-candidate interviews scheduled:', result);
    toast.success(`Successfully scheduled ${result.successCount || 0} interviews!`);
    router.push(`/jobs/${jobId}?tab=pipeline`);
  };

  const handleCancel = () => {
    router.push(`/jobs/${jobId}?tab=pipeline`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading job details...</p>
        </div>
      </div>
    );
  }

  if (!jobData) {
    return null;
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="w-[98vw] max-w-[1600px] h-[96vh] max-h-[96vh] p-0 overflow-hidden multi-step-scheduler-portal">
          <DialogHeader className="sr-only">
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Multi-Candidate Interview Scheduler
            </DialogTitle>
            <DialogDescription>
              Schedule multiple candidates in one session for {jobData.title}.
            </DialogDescription>
          </DialogHeader>

          <MultiStepInterviewScheduler
            candidateId=""
            candidateName=""
            candidateEmail=""
            jobTitle={jobData.title}
            jobId={jobId}
            stageId={jobData.stages?.[0]?._id}
            onScheduled={handleScheduled}
            onCancel={handleCancel}
            forceMultiCandidate={true}
          />
        </DialogContent>
      </Dialog>

      <CreditErrorDialog
        open={showCreditDialog}
        onOpenChange={setShowCreditDialog}
        error={creditError}
      />
    </>
  );
}
