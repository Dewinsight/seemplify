"use client";

import React, { useState } from 'react';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';
// Choose which scheduler to use
import { InterviewScheduler } from './interview-scheduler'; // Original single-page scheduler
import { MultiStepInterviewScheduler } from './multi-step-interview-scheduler'; // New multi-step scheduler

interface InterviewSchedulerExampleProps {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  jobTitle: string;
  jobId?: string;
  stageId?: string;
  useMultiStep?: boolean; // Flag to switch between schedulers
}

export function InterviewSchedulerExample({
  candidateId,
  candidateName,
  candidateEmail,
  jobTitle,
  jobId,
  stageId,
  useMultiStep = false // Default to original scheduler
}: InterviewSchedulerExampleProps) {
  const [showScheduler, setShowScheduler] = useState(false);

  const handleScheduled = (interview: any) => {
    console.log('Interview scheduled:', interview);
    setShowScheduler(false);
    // Add your own logic here (e.g., refresh interviews list, show success message, etc.)
  };

  const handleCancel = () => {
    setShowScheduler(false);
  };

  return (
    <>
      <Button onClick={() => setShowScheduler(true)}>
        Schedule Interview
      </Button>

      <Dialog open={showScheduler} onOpenChange={setShowScheduler}>
        <DialogContent 
          className={useMultiStep 
            ? "max-w-[90vw] sm:max-w-4xl h-[85vh] p-0 overflow-hidden multi-step-scheduler-portal" 
            : "max-w-6xl max-h-[90vh] overflow-y-auto"
          }
        >
          {useMultiStep ? (
            <div className="relative w-full h-full">
              <MultiStepInterviewScheduler
                candidateId={candidateId}
                candidateName={candidateName}
                candidateEmail={candidateEmail}
                jobTitle={jobTitle}
                jobId={jobId}
                stageId={stageId}
                onScheduled={handleScheduled}
                onCancel={handleCancel}
              />
            </div>
          ) : (
            <InterviewScheduler
              candidateId={candidateId}
              candidateName={candidateName}
              jobTitle={jobTitle}
              jobId={jobId}
              stageId={stageId}
              onScheduled={handleScheduled}
              onCancel={handleCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Example usage in a component:
/*
function CandidateCard({ candidate }) {
  return (
    <div>
      <h3>{candidate.name}</h3>
      <InterviewSchedulerExample
        candidateId={candidate._id}
        candidateName={candidate.name}
        candidateEmail={candidate.email}
        jobTitle={candidate.jobTitle}
        jobId={candidate.jobId}
        useMultiStep={true} // Enable multi-step scheduler
      />
    </div>
  );
}
*/
