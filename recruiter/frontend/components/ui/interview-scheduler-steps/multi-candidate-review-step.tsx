"use client";

import React, { useState } from 'react';
import { Calendar, Clock, MapPin, Video, Phone, Users, Mail, AlertCircle, ChevronLeft, Loader2, Bot } from 'lucide-react';
import { Button } from '../button';
import { Card, CardContent } from '../card';
import { Badge } from '../badge';
import { Alert, AlertDescription } from '../alert';
import { Checkbox } from '../checkbox';
import { Label } from '../label';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';

interface MultiCandidateReviewStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onPrevious: () => void;
  onSchedule: () => Promise<void>;
  isLoading: boolean;
}

export function MultiCandidateReviewStep({ 
  data, 
  updateData, 
  onPrevious, 
  onSchedule,
  isLoading 
}: MultiCandidateReviewStepProps) {
  const { state } = useUser();
  const [skipAvailabilityCheck, setSkipAvailabilityCheck] = useState(data.skipAvailabilityCheck || false);

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const formatDateTime = (dateTimeString: string) => {
    if (!dateTimeString) return '';
    try {
      const date = new Date(dateTimeString);
      return format(date, 'PPpp');
    } catch {
      return dateTimeString;
    }
  };

  const formatTime = (dateTimeString: string) => {
    if (!dateTimeString) return '';
    try {
      const date = new Date(dateTimeString);
      return format(date, 'p');
    } catch {
      return dateTimeString;
    }
  };

  const getInterviewTypeIcon = () => {
    switch (data.type) {
      case 'video':
        return <Video className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      case 'in_person':
        return <MapPin className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getInterviewTypeLabel = () => {
    switch (data.type) {
      case 'video':
        return 'Video Call';
      case 'phone':
        return 'Phone Call';
      case 'in_person':
        return 'In Person';
      default:
        return data.type;
    }
  };

  const getTotalDuration = () => {
    return data.multiCandidateSlots.reduce((sum, slot) => sum + slot.duration, 0);
  };

  const handleSchedule = async () => {
    // Update skip availability check
    updateData({ skipAvailabilityCheck });
    
    // Call the parent's schedule function
    await onSchedule();
  };

  const SectionCard = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-4">
          {icon}
          <h4 className="font-medium">{title}</h4>
        </div>
        {children}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Review Multi-Candidate Interview Session</h3>
        <p className="text-sm text-muted-foreground">
          Please review all details before scheduling the interviews
        </p>
      </div>

      {/* Session Overview */}
      <SectionCard title="Session Overview" icon={<Calendar className="h-4 w-4" />}>
        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <span className="text-sm text-muted-foreground">Session Start</span>
            <div className="text-right">
              <p className="text-sm font-medium">{formatDateTime(data.startTime)}</p>
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Duration</span>
            <span className="text-sm font-medium">{getTotalDuration()} minutes</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Number of Candidates</span>
            <Badge>{data.multiCandidateSlots.length}</Badge>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Type</span>
            <div className="flex items-center gap-2">
              {getInterviewTypeIcon()}
              <span className="text-sm">{getInterviewTypeLabel()}</span>
            </div>
          </div>

          {data.location && (
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">Location</span>
              <span className="text-sm text-right">{data.location}</span>
            </div>
          )}

          {data.addNotetaker && data.type === 'video' && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm">AI Notetaker will join the session</span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Candidate Slots */}
      <SectionCard title="Candidate Schedule" icon={<Users className="h-4 w-4" />}>
        <div className="space-y-3">
          {data.multiCandidateSlots.map((slot, index) => (
            <div key={slot.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </div>
                <div>
                  <p className="font-medium">{slot.candidateName}</p>
                  <p className="text-sm text-muted-foreground">{slot.candidateEmail}</p>
                  {slot.jobTitle && (
                    <Badge variant="outline" className="mt-1 text-xs">{slot.jobTitle}</Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{formatTime(slot.startTime)}</p>
                <p className="text-xs text-muted-foreground">{slot.duration} min</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Additional Participants */}
      {data.additionalParticipants.length > 0 && (
        <SectionCard title="Additional Interviewers" icon={<Users className="h-4 w-4" />}>
          <div className="space-y-2">
            {data.additionalParticipants.map((p) => (
              <div key={p.email} className="flex justify-between items-center">
                <span className="text-sm">{p.name}</span>
                <Badge variant="outline" className="text-xs">{p.role}</Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Communication Settings */}
      <SectionCard title="Communication" icon={<Mail className="h-4 w-4" />}>
        <div className="space-y-3">
          {data.subject && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Custom Subject</p>
              <p className="text-sm">{data.subject}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Email Notifications:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Each candidate will receive an individual invitation with their specific time slot</li>
              <li>• All candidates will receive the same meeting link</li>
              {data.sendCustomEmail && <li>• Custom email template will be used</li>}
              {data.sendQuestionsToInterviewers && (
                <li>• Interview questions will be sent to interviewers {data.questionsSendTime} minutes before</li>
              )}
            </ul>
          </div>
        </div>
      </SectionCard>

      {/* Availability Check */}
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="skipAvailability"
                checked={skipAvailabilityCheck}
                onCheckedChange={(checked) => setSkipAvailabilityCheck(checked as boolean)}
              />
              <div className="space-y-1">
                <Label htmlFor="skipAvailability" className="font-medium cursor-pointer">
                  Skip Availability Check
                </Label>
                <p className="text-sm text-muted-foreground">
                  Schedule even if there are calendar conflicts (not recommended)
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Important Notes */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Important:</strong> All candidates will receive the same meeting link but with different scheduled times. 
          Make sure to manage the session transitions smoothly between candidates.
        </AlertDescription>
      </Alert>

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button 
          onClick={handleSchedule}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Scheduling...
            </>
          ) : (
            `Schedule ${data.multiCandidateSlots.length} Interviews`
          )}
        </Button>
      </div>
    </div>
  );
}
