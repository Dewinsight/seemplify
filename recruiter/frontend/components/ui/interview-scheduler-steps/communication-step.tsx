"use client";

import React, { useState, useEffect, useContext } from 'react';
import { Mail, MessageCircle, ChevronLeft, ChevronRight, AlertCircle, Clock } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Textarea } from '../textarea';
import { Checkbox } from '../checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Alert, AlertDescription } from '../alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import { InterviewQuestionSelector } from '../interview-question-selector';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';
import { useOrganization } from '@/context/OrganizationContext';

interface CommunicationStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function CommunicationStep({ data, updateData, onNext, onPrevious }: CommunicationStepProps) {
  const { state } = useUser();
  const { currentOrganization } = useOrganization();
  const [localData, setLocalData] = useState({
    subject: data.subject || '',
    sendCustomEmail: data.sendCustomEmail !== undefined ? data.sendCustomEmail : true,
    emailTemplate: data.emailTemplate || '',
    sendQuestionsToInterviewers: data.sendQuestionsToInterviewers || false,
    questionsSendTime: data.questionsSendTime || 60,
    selectedQuestionIds: data.selectedQuestionIds || [],
  });

  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize email template on mount
  useEffect(() => {
    if (!localData.emailTemplate) {
      initializeEmailTemplate();
    }
  }, []);

  const initializeEmailTemplate = () => {
    const organizationName = currentOrganization?.name || 'Our Company';
    const defaultTemplate = `Dear {{candidateName}},

We're pleased to confirm your upcoming interview for the {{jobTitle}} position.

Date: {{interviewDate}}
Time: {{interviewTime}}
Duration: {{duration}} minutes
Format: {{interviewType}}
{{#if meetingLink}}
Meeting Link: {{meetingLink}}
{{/if}}

{{#if notes}}
Additional Notes:
{{notes}}
{{/if}}

Please be prepared to discuss your experience and qualifications. If you need to reschedule or have any questions, please contact us as soon as possible.

Best regards,
{{interviewerName}}
{{organizationName}}`;

    setLocalData(prev => ({ ...prev, emailTemplate: defaultTemplate }));
  };

  const handleInputChange = (field: string, value: any) => {
    setLocalData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (localData.sendQuestionsToInterviewers && localData.selectedQuestionIds.length === 0) {
      newErrors.questions = 'Please select at least one question to send to interviewers';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (!validateForm()) {
      toast.error('Please fix the errors before continuing');
      return;
    }

    // Update the main data
    updateData({
      subject: localData.subject,
      sendCustomEmail: localData.sendCustomEmail,
      emailTemplate: localData.emailTemplate,
      sendQuestionsToInterviewers: localData.sendQuestionsToInterviewers,
      questionsSendTime: localData.questionsSendTime,
      selectedQuestionIds: localData.selectedQuestionIds,
    });

    onNext();
  };

  const handleQuestionSelection = (selectedIds: string[]) => {
    handleInputChange('selectedQuestionIds', selectedIds);
    // Don't auto-close the selector to allow multiple selections
  };

  const handleCloseQuestionSelector = () => {
    setShowQuestionSelector(false);
  };

  const getQuestionSendTimeLabel = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} minutes before`;
    } else if (minutes === 60) {
      return '1 hour before';
    } else {
      const hours = Math.floor(minutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} before`;
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Communication Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure email notifications and interview preparation
        </p>
      </div>

      {/* Email Subject */}
      <div className="space-y-2">
        <Label htmlFor="subject">Email Subject (Optional)</Label>
        <Input
          id="subject"
          type="text"
          placeholder="Leave blank to use default subject line"
          value={localData.subject}
          onChange={(e) => handleInputChange('subject', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Customize the email subject for this interview invitation
        </p>
      </div>

      {/* Custom Email */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start space-x-3">
          <Checkbox
            id="sendCustomEmail"
            checked={localData.sendCustomEmail}
            onCheckedChange={(checked) => handleInputChange('sendCustomEmail', checked)}
          />
          <div className="space-y-1">
            <Label htmlFor="sendCustomEmail" className="font-medium cursor-pointer">
              Send Custom Email Invitation
            </Label>
            <p className="text-sm text-muted-foreground">
              Send a personalized email invitation to the candidate
            </p>
          </div>
        </div>

        {localData.sendCustomEmail && (
          <div className="space-y-2 mt-4">
            <Label htmlFor="emailTemplate">Email Template</Label>
            <Textarea
              id="emailTemplate"
              value={localData.emailTemplate}
              onChange={(e) => handleInputChange('emailTemplate', e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Available variables:</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <code className="bg-muted px-2 py-1 rounded">{'{{candidateName}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{jobTitle}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{interviewDate}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{interviewTime}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{duration}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{interviewType}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{meetingLink}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{notes}}'}</code>
                <code className="bg-muted px-2 py-1 rounded">{'{{interviewerName}}'}</code>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interview Questions for Interviewers */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start space-x-3">
          <Checkbox
            id="sendQuestionsToInterviewers"
            checked={localData.sendQuestionsToInterviewers}
            onCheckedChange={(checked) => handleInputChange('sendQuestionsToInterviewers', checked)}
          />
          <div className="space-y-1 flex-1">
            <Label htmlFor="sendQuestionsToInterviewers" className="font-medium cursor-pointer">
              Send Interview Questions to Interviewers
            </Label>
            <p className="text-sm text-muted-foreground">
              Email selected interview questions to all interviewers before the interview
            </p>
          </div>
        </div>

        {localData.sendQuestionsToInterviewers && (
          <div className="space-y-4 mt-4">
            {/* Send Time */}
            <div className="space-y-2">
              <Label>When to Send Questions</Label>
              <Select
                value={localData.questionsSendTime.toString()}
                onValueChange={(value) => handleInputChange('questionsSendTime', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 minutes before interview</SelectItem>
                  <SelectItem value="60">1 hour before interview</SelectItem>
                  <SelectItem value="120">2 hours before interview</SelectItem>
                  <SelectItem value="240">4 hours before interview</SelectItem>
                  <SelectItem value="1440">1 day before interview</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground flex items-center">
                <Clock className="h-3 w-3 mr-1" />
                Questions will be sent {getQuestionSendTimeLabel(localData.questionsSendTime)} the interview
              </p>
            </div>

            {/* Question Selection */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Selected Questions</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowQuestionSelector(true)}
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Select Questions
                </Button>
              </div>
              
              {errors.questions && (
                <p className="text-sm text-red-500">{errors.questions}</p>
              )}

              {localData.selectedQuestionIds.length > 0 ? (
                <div className="text-sm text-muted-foreground">
                  {localData.selectedQuestionIds.length} question{localData.selectedQuestionIds.length > 1 ? 's' : ''} selected
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No questions selected. Click "Select Questions" to choose interview questions.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Question Selector Dialog */}
      <Dialog open={showQuestionSelector} onOpenChange={handleCloseQuestionSelector}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Interview Questions</DialogTitle>
            <DialogDescription>
              Choose questions to send to interviewers before the interview
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-auto max-h-[60vh]">
            <InterviewQuestionSelector
              jobId={data.jobId}
              selectedQuestionIds={localData.selectedQuestionIds}
              onSelectionChange={handleQuestionSelection}
            />
          </div>
          <div className="flex justify-end mt-4 pt-4 border-t">
            <Button onClick={handleCloseQuestionSelector}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button onClick={handleContinue}>
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
