"use client";

import React, { useState } from 'react';
import { Calendar, Clock, MapPin, Video, Phone, Users, Mail, MessageCircle, AlertCircle, CheckCircle, ChevronLeft, Loader2, Bot, Eye, EyeOff } from 'lucide-react';
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
import interviewService from '@/services/interviewService';

interface ReviewScheduleStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onPrevious: () => void;
  onSchedule: () => Promise<void>;
  isLoading: boolean;
}

export function ReviewScheduleStep({ 
  data, 
  updateData, 
  onPrevious, 
  onSchedule,
  isLoading 
}: ReviewScheduleStepProps) {
  const { state } = useUser();
  const [skipAvailabilityCheck, setSkipAvailabilityCheck] = useState(data.skipAvailabilityCheck || false);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

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

  const checkAvailability = async () => {
    setCheckingAvailability(true);
    try {
      const availability = await interviewService.getAvailability(
        state.user?._id || '',
        data.startTime,
        data.endTime,
        data.duration
      );
      
      // Filter for busy slots which indicate conflicts
      const busySlots = availability.filter(slot => slot.status === 'busy');
      
      if (busySlots.length > 0) {
        setConflicts(busySlots.map(slot => ({
          title: 'Busy',
          start: slot.startTime,
          end: slot.endTime
        })));
        toast.warning('Scheduling conflicts detected');
      } else {
        setConflicts([]);
        toast.success('No scheduling conflicts found');
      }
    } catch (error) {
      console.error('Error checking availability:', error);
      toast.error('Failed to check availability');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleSchedule = async () => {
    // Update skip availability check
    updateData({ skipAvailabilityCheck });
    
    // Call the parent's schedule function
    await onSchedule();
  };

  const totalParticipants =
    2 + data.additionalParticipants.length + data.ccParticipants.length + data.bccParticipants.length;

  const SectionCard = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
          {icon}
          <h4 className="font-semibold">{title}</h4>
        </div>
        <div className="p-4">{children}</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Review Interview Details</h3>
        <p className="text-sm text-muted-foreground">
          Please review all details before scheduling the interview
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Scheduled Start</p>
            <p className="mt-1 text-sm font-semibold">{formatDateTime(data.startTime)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Interview Duration</p>
            <p className="mt-1 text-2xl font-semibold">{data.duration}m</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Participants</p>
            <p className="mt-1 text-2xl font-semibold">{totalParticipants}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Interview Details */}
          <SectionCard title="Interview Details" icon={<Calendar className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm text-muted-foreground">Date & Time</span>
                <div className="text-right">
                  <p className="text-sm font-medium">{formatDateTime(data.startTime)}</p>
                  <p className="text-xs text-muted-foreground">{data.duration} minutes</p>
                </div>
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

              {data.notes && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{data.notes}</p>
                </div>
              )}

              {data.addNotetaker && data.type === 'video' && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="text-sm">AI Notetaker will join this meeting</span>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Participants */}
          <SectionCard title="Participants" icon={<Users className="h-4 w-4" />}>
            <div className="space-y-3">
              {/* Primary Participants */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Primary</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{data.candidateName}</span>
                    <Badge variant="outline">Candidate</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">
                      {state.user?.profile?.firstName && state.user?.profile?.lastName
                        ? `${state.user.profile.firstName} ${state.user.profile.lastName}`
                        : state.user?.email}
                    </span>
                    <Badge variant="secondary">Interviewer</Badge>
                  </div>
                </div>
              </div>

              {/* Additional Participants */}
              {data.additionalParticipants.length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Additional ({data.additionalParticipants.length})</p>
                  <div className="space-y-1">
                    {data.additionalParticipants.map((p) => (
                      <div key={p.email} className="flex justify-between items-center">
                        <span className="text-sm">{p.name}</span>
                        <Badge variant="outline" className="text-xs">{p.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(data.ccParticipants.length > 0 || data.bccParticipants.length > 0) && (
                <div className="pt-2 border-t space-y-2">
                  {data.ccParticipants.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      <span>CC: {data.ccParticipants.length} recipient{data.ccParticipants.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {data.bccParticipants.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <EyeOff className="h-3 w-3" />
                      <span>BCC: {data.bccParticipants.length} recipient{data.bccParticipants.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Communication Settings */}
          <SectionCard title="Communication" icon={<Mail className="h-4 w-4" />}>
            <div className="space-y-3">
              {data.subject && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Custom Subject</p>
                  <p className="text-sm">{data.subject}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                {data.sendCustomEmail ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm">Custom email invitation will be sent</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Standard calendar invite only</span>
                  </>
                )}
              </div>

              {data.sendQuestionsToInterviewers && (
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      {data.selectedQuestionIds.length} interview questions will be sent {data.questionsSendTime} minutes before
                    </span>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {conflicts.length > 0 && !skipAvailabilityCheck && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Scheduling conflicts detected:</strong>
                <ul className="mt-2 space-y-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="text-sm">
                      {conflict.title} at {formatDateTime(conflict.start)}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-4">
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

                {!skipAvailabilityCheck && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkAvailability}
                    disabled={checkingAvailability}
                    className="w-full"
                  >
                    {checkingAvailability ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      'Check Availability'
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardContent className="p-4 space-y-2">
              <h4 className="text-sm font-semibold">Final Checklist</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>1. Date and duration confirmed</li>
                <li>2. Participants and recipients reviewed</li>
                <li>3. Communication preferences set</li>
                <li>4. Timezone verified: {userTimezone}</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Navigation */}
      <div className="step-nav-actions hidden flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious} data-step-action="previous">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button 
          onClick={handleSchedule}
          disabled={isLoading || (conflicts.length > 0 && !skipAvailabilityCheck)}
          data-step-action="schedule"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Scheduling...
            </>
          ) : (
            'Schedule Interview'
          )}
        </Button>
      </div>
    </div>
  );
}
