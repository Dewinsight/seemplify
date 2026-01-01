"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MultiStepInterviewScheduler } from '@/components/ui/multi-step-interview-scheduler';
import { toast } from 'sonner';
import { getJobById } from '@/services/jobService';
import { useCreditError } from '@/hooks/useCreditError';
import { CreditErrorDialog } from '@/components/ui/credit-error-dialog';

export default function ScheduleMultiCandidatePage() {
  const params = useParams();
  const router = useRouter();
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError();
  const jobId = params.jobId as string;
  
  const [jobData, setJobData] = useState<any>(null);
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
    // Navigate back to the job pipeline
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100/50">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="hover:bg-gray-100"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Pipeline
              </Button>
              <div className="hidden sm:block h-6 w-px bg-gray-300"></div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Users className="h-6 w-6 text-orange-600" />
                  Multi-Candidate Interview
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  {jobData.title} • Schedule multiple candidates in one session
                </p>
              </div>
            </div>
            
            <div className="hidden md:flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              <Calendar className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-700">Efficient Scheduling</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 sm:px-6 max-w-7xl">
        <Card className="bg-white shadow-lg">
          <div className="p-6">
            {/* Multi-Candidate Scheduler - Same component, pre-configured for multi-candidate */}
            <div className="space-y-6">
              {/* Info Banner */}
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Users className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-orange-900">Multi-Candidate Interview Session</h3>
                    <p className="text-sm text-orange-700 mt-1">
                      Interview multiple candidates in one session with a shared meeting link. Perfect for efficient scheduling and easy candidate comparison.
                    </p>
                    <div className="flex flex-wrap gap-4 mt-3 text-xs text-orange-600">
                      <span className="flex items-center gap-1">
                        <span className="text-green-600">✓</span> Single meeting link
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-green-600">✓</span> Back-to-back time slots
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-green-600">✓</span> AI notetaker for all
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-green-600">✓</span> Automatic transcript segmentation
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scheduler Component - Exact same component used in modal */}
              <MultiStepInterviewScheduler
                candidateId="" // Empty for multi-candidate (not tied to single candidate)
                candidateName="" // Will be filled when adding candidates
                candidateEmail=""
                jobTitle={jobData.title}
                jobId={jobId}
                stageId={jobData.stages?.[0]?._id} // Default to first stage or can be selected
                onScheduled={handleScheduled}
                onCancel={handleCancel}
                forceMultiCandidate={true} // Skip interview type selection, go straight to multi-candidate flow
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  );
}

