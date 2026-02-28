"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronLeft, ChevronRight, AlertCircle, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Label } from './label';
import { Progress } from './progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';
import interviewService from '@/services/interviewService';
import { useCreditError } from '@/hooks/useCreditError';
import { CreditErrorDialog } from '@/components/ui/credit-error-dialog';
import { getDefaultEmailTemplate } from '@/lib/emailTemplatePresets';

// Import step components
import {
  CalendarConnectionStep,
  InterviewDetailsStep,
  ParticipantsStep,
  CommunicationStep,
  ReviewScheduleStep,
  InterviewTypeStep,
  MultiCandidateSessionStep,
  MultiCandidateSlotsStep,
  MultiCandidateParticipantsStep,
  MultiCandidateReviewStep
} from './interview-scheduler-steps';

export interface MultiCandidateSlot {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId?: string;
  stageId?: string;
  jobTitle: string;
  startTime: string;
  endTime: string;
  duration: number;
  notes?: string;
  order: number;
}

export interface InterviewSchedulerData {
  // Interview type
  interviewType: 'single' | 'multi';
  
  // Basic info (for single interview)
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  jobTitle: string;
  jobId?: string;
  stageId?: string;
  
  // Multi-candidate specific
  multiCandidateSlots: MultiCandidateSlot[];
  
  // Calendar
  calendarConnected: boolean;
  calendarProvider?: string;
  calendarEmail?: string;
  
  // Interview details
  startTime: string;
  endTime: string;
  duration: number;
  type: 'video' | 'phone' | 'in_person';
  location: string;
  notes: string;
  addNotetaker: boolean;
  
  // Participants
  additionalParticipants: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
  }>;
  bccParticipants: Array<{
    id: string;
    email: string;
    name: string;
  }>;
  ccParticipants: Array<{
    id: string;
    email: string;
    name: string;
  }>;
  
  // Communication
  subject: string;
  sendCustomEmail: boolean;
  emailTemplate: string;
  sendQuestionsToInterviewers: boolean;
  questionsSendTime: number;
  selectedQuestionIds: string[];
  
  // Settings
  skipAvailabilityCheck: boolean;
  provider: string;
}

interface MultiStepInterviewSchedulerProps {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  jobTitle: string;
  jobId?: string;
  stageId?: string;
  onScheduled?: (interview: any) => void;
  onCancel?: () => void;
  // Optional: Force multi-candidate mode (skip interview type selection)
  forceMultiCandidate?: boolean;
  // Optional: Skip interview type selection step entirely (works for both single and multi)
  skipTypeSelection?: boolean;
  // Optional: Callback to navigate to shortlist tab
  onNavigateToShortlist?: () => void;
}

const SINGLE_STEPS = [
  {
    id: 1,
    title: 'Interview Type',
    description: 'Choose single or multi-candidate interview',
  },
  {
    id: 2,
    title: 'Calendar Connection',
    description: 'Connect your calendar to schedule interviews',
  },
  {
    id: 3,
    title: 'Interview Details',
    description: 'Set the time, duration, and type of interview',
  },
  {
    id: 4,
    title: 'Participants',
    description: 'Add interviewers and observers',
  },
  {
    id: 5,
    title: 'Communication',
    description: 'Configure invitation email notifications',
  },
  {
    id: 6,
    title: 'Interviewer Questions',
    description: 'Select questions and when to send them',
  },
  {
    id: 7,
    title: 'Review & Schedule',
    description: 'Review all details and schedule the interview',
  },
];

const MULTI_STEPS = [
  {
    id: 1,
    title: 'Interview Type',
    description: 'Choose single or multi-candidate interview',
  },
  {
    id: 2,
    title: 'Calendar Connection',
    description: 'Connect your calendar to schedule interviews',
  },
  {
    id: 3,
    title: 'Session Setup',
    description: 'Set up the multi-candidate session',
  },
  {
    id: 4,
    title: 'Add Candidates',
    description: 'Add candidates to interview',
  },
  {
    id: 5,
    title: 'Participants',
    description: 'Add interviewers and observers',
  },
  {
    id: 6,
    title: 'Communication',
    description: 'Configure invitation email notifications',
  },
  {
    id: 7,
    title: 'Interviewer Questions',
    description: 'Select questions and when to send them',
  },
  {
    id: 8,
    title: 'Review & Schedule',
    description: 'Review all details and schedule interviews',
  },
];

export function MultiStepInterviewScheduler({
  candidateId,
  candidateName,
  candidateEmail,
  jobTitle,
  jobId,
  stageId,
  onScheduled,
  onCancel,
  forceMultiCandidate = false,
  skipTypeSelection = true,
  onNavigateToShortlist,
}: MultiStepInterviewSchedulerProps) {
  const { state } = useUser();
  
  // Skip interview type selection if explicitly requested OR if forcing multi-candidate
  const shouldSkipTypeSelection = skipTypeSelection || forceMultiCandidate;
  
  // Start at step 2 (Calendar Connection) if skipping type selection, otherwise step 1 (Interview Type)
  const [currentStep, setCurrentStep] = useState(shouldSkipTypeSelection ? 2 : 1);
  const [isLoading, setIsLoading] = useState(false);
  const stepContentRef = useRef<HTMLDivElement | null>(null);
  
  // Credit error handling
  const { creditError, showCreditDialog, setShowCreditDialog, handleError: handleCreditError } = useCreditError();
  
  // Generic error modal state (for non-credit errors)
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorDetails, setErrorDetails] = useState<{
    title: string;
    message: string;
    details?: string;
    suggestions?: string[];
    code?: string;
  } | null>(null);
  
  // Determine initial interview type
  const initialInterviewType = forceMultiCandidate ? 'multi' : 'single';
  
  const DEFAULT_EMAIL_TEMPLATE = getDefaultEmailTemplate();
  
  const [data, setData] = useState<InterviewSchedulerData>({
    // Pre-set interview type if skipping type selection, otherwise default to 'single'
    interviewType: shouldSkipTypeSelection ? initialInterviewType : 'single',
    candidateId,
    candidateName,
    candidateEmail,
    jobTitle,
    jobId,
    stageId,
    multiCandidateSlots: [],
    calendarConnected: false,
    calendarProvider: 'google',
    startTime: '',
    endTime: '',
    duration: 60,
    type: 'video',
    location: '',
    notes: '',
    addNotetaker: true,
    additionalParticipants: [],
    bccParticipants: [],
    ccParticipants: [],
    subject: '',
    sendCustomEmail: true,
    emailTemplate: DEFAULT_EMAIL_TEMPLATE, // ✅ FIX: Always initialize with template
    sendQuestionsToInterviewers: false,
    questionsSendTime: 60,
    selectedQuestionIds: [],
    skipAvailabilityCheck: false,
    provider: 'google',
  });

  // Use the appropriate steps based on interview type
  const STEPS = data.interviewType === 'single' ? SINGLE_STEPS : MULTI_STEPS;
  const VISIBLE_STEPS = shouldSkipTypeSelection
    ? STEPS.filter(step => step.id !== 1)
    : STEPS;
  const currentVisibleStepIndex = Math.max(
    0,
    VISIBLE_STEPS.findIndex(step => step.id === currentStep)
  );
  const currentVisibleStep = VISIBLE_STEPS[currentVisibleStepIndex] || VISIBLE_STEPS[0];

  const updateData = (updates: Partial<InterviewSchedulerData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const extractApiErrorData = (error: any) => error?.data || error?.response?.data || null;

  const isTeamsScopeErrorCode = (code?: string) =>
    code === 'TEAMS_SCOPE_MISSING' || code === 'TEAMS_PROVIDER_MISMATCH';

  const handleSchedule = async () => {
    if (!state.user?._id) {
      toast.error('Please log in to schedule interviews');
      return;
    }

    setIsLoading(true);
    try {
      if (data.interviewType === 'single') {
        // Always ensure endTime is startTime + duration before sending
        let startISO = data.startTime;
        let endISO = data.endTime;
        try {
          const startDate = new Date(data.startTime);
          const computedEnd = new Date(startDate.getTime() + (data.duration || 0) * 60000);
          startISO = startDate.toISOString();
          endISO = computedEnd.toISOString();
        } catch {}
        // Single interview scheduling
        const scheduleData = {
          candidateId: data.candidateId,
          jobId: data.jobId,
          stageId: data.stageId,
          startTime: startISO,
          endTime: endISO,
          duration: data.duration,
          notes: data.notes,
          subject: data.subject,
          addNotetaker: data.addNotetaker,
          skipAvailabilityCheck: data.skipAvailabilityCheck,
          forceSchedule: true, // ✅ CRITICAL: Force schedule without blocking on conflicts (pipeline behavior)
          provider: data.provider,
          additionalParticipants: data.additionalParticipants,
          bccParticipants: data.bccParticipants,
          ccParticipants: data.ccParticipants,
          sendCustomEmail: data.sendCustomEmail,
          emailTemplate: data.emailTemplate,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          sendQuestionsToInterviewers: data.sendQuestionsToInterviewers,
          questionsSendTime: data.questionsSendTime,
          selectedQuestionIds: data.selectedQuestionIds,
          autocreate: true,
          useDirectISO: true,
        };

        console.log('📤 Sending single interview schedule data:', scheduleData);
        const interview = await interviewService.scheduleFromPipeline(scheduleData);

        toast.success(
          data.addNotetaker
            ? 'Interview scheduled successfully with AI notetaker!'
            : 'Interview scheduled successfully!'
        );
        onScheduled?.(interview);
      } else {
        // Multi-candidate scheduling
        // Ensure sessionEndTime is baseStartTime + totalDuration
        let baseStartISO = data.startTime;
        let sessionEndISO = data.endTime;
        try {
          const baseStartDate = new Date(data.startTime);
          const totalDuration = data.multiCandidateSlots.reduce((sum, slot) => sum + slot.duration, 0);
          const computedEnd = new Date(baseStartDate.getTime() + totalDuration * 60000);
          baseStartISO = baseStartDate.toISOString();
          sessionEndISO = computedEnd.toISOString();
        } catch {}

        const multiScheduleData = {
          sessionType: 'multi-candidate',
          baseStartTime: baseStartISO,
          sessionEndTime: sessionEndISO,
          totalDuration: data.multiCandidateSlots.reduce((sum, slot) => sum + slot.duration, 0),
          interviewType: data.type,
          location: data.location,
          subject: data.subject,
          provider: data.provider,
          addNotetaker: data.addNotetaker,
          additionalInterviewers: data.additionalParticipants,
          candidateSlots: data.multiCandidateSlots,
          skipAvailabilityCheck: data.skipAvailabilityCheck,
          sendCustomEmail: data.sendCustomEmail,
          emailTemplate: data.emailTemplate,
          bccParticipants: data.bccParticipants,
          ccParticipants: data.ccParticipants,
          sendQuestionsToInterviewers: data.sendQuestionsToInterviewers,
          questionsSendTime: data.questionsSendTime,
          selectedQuestionIds: data.selectedQuestionIds,
          jobId: jobId,  // Pass session-level jobId
          stageId: stageId,  // Pass session-level stageId
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        console.log('📤 Sending multi-candidate schedule data:', multiScheduleData);
        const result = await interviewService.scheduleMultiCandidateInterview(multiScheduleData);

        const successCount = result?.successCount ?? result?.interviews?.length ?? 0;
        const queuedRetryCount = result?.queuedRetryCount ?? result?.queuedRetries?.length ?? 0;
        const failedCount = result?.failedCount ?? result?.errors?.length ?? 0;

        if (queuedRetryCount > 0 || failedCount > 0) {
          toast.success(
            `Scheduled ${successCount} interviews. ${queuedRetryCount} slot(s) queued for retry.`
          );
        } else {
          toast.success(`Successfully scheduled ${successCount} interviews!`);
        }
        onScheduled?.(result);
      }
    } catch (error: any) {
      console.error('Scheduling error:', error);
      
      // Check if it's a credit error first
      const isCreditError = handleCreditError(error);
      
      if (!isCreditError) {
        const apiErrorData = extractApiErrorData(error) || {};
        const errorCode = apiErrorData?.error || error?.message;
        const errorMessage = apiErrorData?.message ||
                            error?.response?.data?.message ||
                            error?.response?.data?.error ||
                            error?.message ||
                            'Failed to schedule interview';

        if (isTeamsScopeErrorCode(errorCode)) {
          const details = apiErrorData?.details || {};
          const missingScopes = Array.isArray(details?.missingScopes) ? details.missingScopes : [];
          const missingScopesText = missingScopes.length > 0
            ? missingScopes.join(', ')
            : 'Calendars.ReadWrite, OnlineMeetings.ReadWrite';

          setErrorDetails({
            title: 'Microsoft Teams Scopes Required',
            message: apiErrorData?.message || 'Microsoft Teams scheduling requires additional permissions.',
            details: `Missing scopes: ${missingScopesText}`,
            suggestions: [
              'Click "Fix Teams Scopes" below',
              'Reconnect Microsoft calendar and accept all requested permissions',
              'Return to review and schedule again'
            ],
            code: errorCode
          });
          setShowErrorModal(true);
          return;
        }

        setErrorDetails({
          title: 'Interview Scheduling Failed',
          message: errorMessage,
          details: apiErrorData?.details || error?.response?.data?.details || error?.stack?.split('\n')[0],
          suggestions: [
            'Check all required fields are filled correctly',
            'Verify your calendar is still connected',
            'Ensure all participant emails are valid',
            'Try refreshing the page and attempting again',
            'Contact support if the error persists'
          ]
        });
        setShowErrorModal(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    // Step 1 is always Interview Type
    if (currentStep === 1) {
      return (
        <InterviewTypeStep
          interviewType={data.interviewType}
          onTypeSelect={(type) => updateData({ interviewType: type })}
          onNext={handleNext}
        />
      );
    }

    // For single interview flow
    if (data.interviewType === 'single') {
      switch (currentStep) {
        case 2:
          return (
            <CalendarConnectionStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
            />
          );
        case 3:
          return (
            <InterviewDetailsStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          );
        case 4:
          return (
            <ParticipantsStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          );
        case 5:
          return (
            <CommunicationStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
              mode="email"
            />
          );
        case 6:
          return (
            <CommunicationStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
              mode="questions"
            />
          );
        case 7:
          return (
            <ReviewScheduleStep
              data={data}
              updateData={updateData}
              onPrevious={handlePrevious}
              onSchedule={handleSchedule}
              isLoading={isLoading}
            />
          );
      }
    } else {
      // Multi-candidate flow
      switch (currentStep) {
        case 2:
          return (
            <CalendarConnectionStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
            />
          );
        case 3:
          // Multi-candidate session setup step
          return (
            <MultiCandidateSessionStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          );
        case 4:
          // Add candidates step
          return (
            <MultiCandidateSlotsStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onNavigateToShortlist={onNavigateToShortlist}
            />
          );
        case 5:
          return (
            <MultiCandidateParticipantsStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          );
        case 6:
          return (
            <CommunicationStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
              mode="email"
            />
          );
        case 7:
          return (
            <CommunicationStep
              data={data}
              updateData={updateData}
              onNext={handleNext}
              onPrevious={handlePrevious}
              mode="questions"
            />
          );
        case 8:
          return (
            <MultiCandidateReviewStep
              data={data}
              updateData={updateData}
              onPrevious={handlePrevious}
              onSchedule={handleSchedule}
              isLoading={isLoading}
            />
          );
      }
    }
    
    return null;
  };

  const minimumStep = shouldSkipTypeSelection ? 2 : 1;
  const isFirstStep = currentStep === 1;
  const canGoPrevious = currentStep > minimumStep;
  const isReviewStep = currentStep === STEPS.length;
  const isCalendarStep = currentStep === 2;

  const triggerStepAction = (action: 'next' | 'schedule' | 'refresh') => {
    const target = stepContentRef.current?.querySelector(
      `[data-step-action="${action}"]`
    ) as HTMLButtonElement | null;

    if (!target) return { found: false, disabled: false };
    if (target.disabled) return { found: true, disabled: true };

    target.click();
    return { found: true, disabled: false };
  };

  const handleFooterPrimaryAction = async () => {
    if (isReviewStep) {
      const result = triggerStepAction('schedule');
      if (result.disabled) {
        toast.error('Resolve required fields before scheduling');
        return;
      }
      if (!result.found) {
        await handleSchedule();
      }
      return;
    }

    const result = triggerStepAction('next');
    if (result.disabled) {
      toast.error('Please complete required fields before continuing');
      return;
    }
    if (!result.found) {
      handleNext();
    }
  };

  const handleFooterRefresh = () => {
    const result = triggerStepAction('refresh');
    if (result.disabled) {
      toast.info('Calendar status check is already running');
    }
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-background">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              {data.interviewType === 'multi' 
                ? 'Schedule Multi-Candidate Interviews' 
                : `Schedule Interview with ${candidateName}`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.interviewType === 'multi' 
                ? 'Interview multiple candidates in one session' 
                : jobTitle}
            </p>
          </div>
          
          {/* Progress indicator */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Step {currentVisibleStepIndex + 1} of {VISIBLE_STEPS.length}</span>
              <span>{currentVisibleStep?.title}</span>
            </div>
            <Progress value={((currentVisibleStepIndex + 1) / VISIBLE_STEPS.length) * 100} />
          </div>
          
          {/* Step indicators */}
          <div className="flex justify-between">
            {VISIBLE_STEPS.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "flex items-center",
                  index < VISIBLE_STEPS.length - 1 && "flex-1"
                )}
              >
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                      index < currentVisibleStepIndex
                        ? "bg-primary text-primary-foreground"
                        : index === currentVisibleStepIndex
                        ? "bg-primary/20 text-primary border-2 border-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {index < currentVisibleStepIndex ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      shouldSkipTypeSelection ? index + 1 : step.id
                    )}
                  </div>
                  <span className="text-xs mt-1 hidden sm:block text-center max-w-[100px]">
                    {step.title}
                  </span>
                </div>
                {index < VISIBLE_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-[2px] mx-2 mt-4",
                      index < currentVisibleStepIndex ? "bg-primary" : "bg-muted"
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Scrollable Content Area */}
      <div ref={stepContentRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
        {renderStep()}
      </div>
      
      {/* Fixed Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            {canGoPrevious && (
              <Button variant="outline" onClick={handlePrevious}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isCalendarStep && (
              <Button variant="outline" onClick={handleFooterRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Status
              </Button>
            )}

            {!isFirstStep && (
              <Button onClick={handleFooterPrimaryAction} disabled={isLoading}>
                {isReviewStep ? (
                  isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Scheduling...
                    </>
                  ) : data.interviewType === 'multi' ? (
                    `Schedule ${data.multiCandidateSlots.length} Interviews`
                  ) : (
                    'Schedule Interview'
                  )
                ) : (
                  <>
                    Continue
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error Modal */}
      <Dialog open={showErrorModal} onOpenChange={setShowErrorModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              {errorDetails?.title || 'Error'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Main error message */}
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800 font-medium">
                {errorDetails?.message}
              </p>
            </div>

            {/* Technical details (if available) */}
            {errorDetails?.details && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-600 uppercase">
                  Technical Details
                </Label>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <code className="text-xs text-gray-700 font-mono break-all">
                    {errorDetails.details}
                  </code>
                </div>
              </div>
            )}

            {/* Suggestions */}
            {errorDetails?.suggestions && errorDetails.suggestions.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-600 uppercase">
                  Suggested Actions
                </Label>
                <ul className="space-y-2">
                  {errorDetails.suggestions.map((suggestion, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-blue-500 font-bold mt-0.5">•</span>
                      <span>{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2">
              {(errorDetails?.code === 'TEAMS_SCOPE_MISSING' || errorDetails?.code === 'TEAMS_PROVIDER_MISMATCH') && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowErrorModal(false);
                    updateData({
                      calendarConnected: false,
                      calendarProvider: 'microsoft',
                      provider: 'microsoft'
                    });
                    setCurrentStep(2);
                    toast.info('Reconnect Microsoft calendar and accept Calendars.ReadWrite + OnlineMeetings.ReadWrite.');
                  }}
                >
                  Fix Teams Scopes
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  // Copy error details to clipboard
                  const errorText = `${errorDetails?.title}\n\n${errorDetails?.message}\n\n${errorDetails?.details || ''}`;
                  navigator.clipboard.writeText(errorText);
                  toast.success('Error details copied to clipboard');
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Details
              </Button>
              <Button
                onClick={() => setShowErrorModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  );
}
