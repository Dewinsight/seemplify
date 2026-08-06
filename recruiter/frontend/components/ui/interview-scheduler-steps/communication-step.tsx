"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Mail, MessageCircle, ChevronLeft, ChevronRight, AlertCircle, Clock, Plus, Sparkles, Loader2, Shield } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Textarea } from '../textarea';
import { Checkbox } from '../checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Alert, AlertDescription } from '../alert';
import { Card, CardContent } from '../card';
import { Badge } from '../badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import { InterviewQuestionSelector } from '../interview-question-selector';
import { EmailTemplateDesigner } from '../email-template-designer';
import interviewService, { InterviewQuestionCreateData, GenerateQuestionsOptions } from '@/services/interviewService';
import { Slider } from '../slider';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';
import { useOrganization } from '@/context/OrganizationContext';
import { getDefaultEmailTemplate } from '@/lib/emailTemplatePresets';
import { resolveEmailPreviewOrganizationName } from '@/lib/emailOrganizationContext';

interface CommunicationStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  mode?: 'email' | 'questions' | 'both';
}

export function CommunicationStep({
  data,
  updateData,
  onNext,
  onPrevious,
  mode = 'both'
}: CommunicationStepProps) {
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
  const [dialogTab, setDialogTab] = useState<'select' | 'create' | 'generate'>('select');
  const isEmailOnly = mode === 'email';
  const isQuestionsOnly = mode === 'questions';
  const isDualMode = mode === 'both';
  const [settingsTab, setSettingsTab] = useState<'invitation' | 'questions'>(
    isEmailOnly
      ? 'invitation'
      : isQuestionsOnly
      ? 'questions'
      : data.sendQuestionsToInterviewers || (data.selectedQuestionIds?.length || 0) > 0
      ? 'questions'
      : 'invitation'
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Question creation state
  const [isCreating, setIsCreating] = useState(false);
  const [questionSelectorKey, setQuestionSelectorKey] = useState(0);
  const [newQuestion, setNewQuestion] = useState<InterviewQuestionCreateData>({
    question: '',
    type: 'general',
    difficulty: 'medium',
    interviewStage: 'first_round',
    category: '',
    expectedAnswer: '',
    tags: [],
    timeLimit: undefined,
  });

  // AI Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateOptions, setGenerateOptions] = useState<GenerateQuestionsOptions>({
    stage: 'first_round',
    questionCount: 5,
    difficulty: 'medium',
    includeTypes: ['technical', 'behavioral', 'situational'],
    ensureDiversity: true,
    maxBiasScore: 0.3,
  });

  // Initialize email template on mount
  useEffect(() => {
    if (!localData.emailTemplate) {
      initializeEmailTemplate();
    }
  }, []);

  const initializeEmailTemplate = () => {
    setLocalData(prev => ({ ...prev, emailTemplate: getDefaultEmailTemplate() }));
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

    if (!isEmailOnly && localData.sendQuestionsToInterviewers && localData.selectedQuestionIds.length === 0) {
      newErrors.questions = 'Please select at least one question to send to interviewers';
      setSettingsTab('questions');
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
  };

  const handleCloseQuestionSelector = () => {
    setShowQuestionSelector(false);
    setDialogTab('select');
    // Reset create form
    setNewQuestion({
      question: '',
      type: 'general',
      difficulty: 'medium',
      interviewStage: 'first_round',
      category: '',
      expectedAnswer: '',
      tags: [],
      timeLimit: undefined,
    });
  };

  const handleCreateQuestion = async () => {
    if (!data.jobId || !newQuestion.question.trim()) {
      toast.error('Please enter a question');
      return;
    }

    setIsCreating(true);
    try {
      const createdQuestion = await interviewService.createQuestion(data.jobId, newQuestion);
      toast.success('Question created successfully');

      // Auto-select the newly created question
      handleInputChange('selectedQuestionIds', [...localData.selectedQuestionIds, createdQuestion._id]);

      // Refresh question list
      setQuestionSelectorKey(prev => prev + 1);

      // Reset form and switch to select tab
      setNewQuestion({
        question: '',
        type: 'general',
        difficulty: 'medium',
        interviewStage: 'first_round',
        category: '',
        expectedAnswer: '',
        tags: [],
        timeLimit: undefined,
      });
      setDialogTab('select');
    } catch (error: any) {
      console.error('Error creating question:', error);
      toast.error(error.message || 'Failed to create question');
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerateQuestions = async () => {
    if (!data.jobId) {
      toast.error('No job selected');
      return;
    }

    setIsGenerating(true);
    try {
      const questions = await interviewService.generateQuestions(data.jobId, generateOptions);
      toast.success(`Generated ${questions.length} questions successfully`);

      // Auto-select all newly generated questions
      const newIds = questions.map(q => q._id);
      handleInputChange('selectedQuestionIds', [...localData.selectedQuestionIds, ...newIds]);

      // Refresh question list
      setQuestionSelectorKey(prev => prev + 1);

      // Switch to select tab to show new questions
      setDialogTab('select');
    } catch (error: any) {
      console.error('Error generating questions:', error);
      toast.error(error.message || 'Failed to generate questions');
    } finally {
      setIsGenerating(false);
    }
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

  const previewTemplateData = useMemo(() => {
    const getInterviewTypeLabel = (type: InterviewSchedulerData['type']) => {
      if (type === 'phone') return 'Phone Call';
      if (type === 'in_person') return 'In Person';
      return 'Video Call';
    };

    const formatPreviewDateTime = (isoValue?: string) => {
      if (!isoValue) {
        return { interviewDate: '', interviewTime: '' };
      }

      const parsed = new Date(isoValue);
      if (Number.isNaN(parsed.getTime())) {
        return { interviewDate: '', interviewTime: '' };
      }

      return {
        interviewDate: parsed.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        interviewTime: parsed.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        })
      };
    };

    const firstSlot = data.multiCandidateSlots?.[0];
    const isMulti = data.interviewType === 'multi';
    const previewStartTime = isMulti ? firstSlot?.startTime || data.startTime : data.startTime;
    const { interviewDate, interviewTime } = formatPreviewDateTime(previewStartTime);

    const interviewerName =
      [state.user?.profile?.firstName, state.user?.profile?.lastName]
        .filter(Boolean)
        .join(' ') ||
      (state.user as any)?.fullName ||
      state.user?.email ||
      '';

    const organizationName = resolveEmailPreviewOrganizationName(currentOrganization);

    const previewCandidateName = isMulti ? firstSlot?.candidateName || data.candidateName : data.candidateName;
    const previewJobTitle = isMulti ? firstSlot?.jobTitle || data.jobTitle : data.jobTitle;
    const previewDuration = isMulti ? firstSlot?.duration || data.duration : data.duration;

    const meetingLinkCandidate = data.location || '';
    const previewMeetingLink = /^https?:\/\//i.test(meetingLinkCandidate) ? meetingLinkCandidate : '';
    const previewJobLink =
      data.jobId && typeof window !== 'undefined'
        ? `${window.location.origin}/public/jobs/${data.jobId}`
        : '';

    return {
      candidateName: previewCandidateName || '',
      jobTitle: previewJobTitle || '',
      interviewDate,
      interviewTime,
      duration: previewDuration || '',
      interviewType: getInterviewTypeLabel(data.type),
      meetingLink: previewMeetingLink,
      notes: data.notes || '',
      interviewerName,
      interviewerEmail: state.user?.email || '',
      organizationName,
      jobLink: previewJobLink,
      jobDetailsPdfAttached: true
    };
  }, [
    data.candidateName,
    data.duration,
    data.interviewType,
    data.jobId,
    data.jobTitle,
    data.location,
    data.multiCandidateSlots,
    data.notes,
    data.startTime,
    data.type,
    currentOrganization?.name,
    state.user
  ]);

  const invitationPanel = (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Invitation Email</h4>
            <p className="text-sm text-muted-foreground">
              Choose whether to send a custom branded invitation and edit the template.
            </p>
          </div>
          <Badge variant={localData.sendCustomEmail ? 'secondary' : 'outline'}>
            {localData.sendCustomEmail ? 'Custom Enabled' : 'Standard Invite'}
          </Badge>
        </div>

        <div className="flex items-start space-x-3 rounded-lg border bg-muted/30 p-3">
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
              Send a personalized email invitation to the candidate.
            </p>
          </div>
        </div>

        {localData.sendCustomEmail && (
          <div className="space-y-2">
            <EmailTemplateDesigner
              value={localData.emailTemplate}
              onChange={(nextTemplate) => handleInputChange('emailTemplate', nextTemplate)}
              previewData={previewTemplateData}
              helperText="Pick one of the design presets, then customize with variables and HTML."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );

  const questionsPanel = (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Interviewer Questions</h4>
            <p className="text-sm text-muted-foreground">
              Select question sets and control when interviewers receive them.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{localData.selectedQuestionIds.length} selected</Badge>
            <Badge variant={localData.sendQuestionsToInterviewers ? 'secondary' : 'outline'}>
              {localData.sendQuestionsToInterviewers ? 'Auto Send On' : 'Auto Send Off'}
            </Badge>
          </div>
        </div>

        <div className="flex items-start space-x-3 rounded-lg border bg-muted/30 p-3">
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
              Email selected interview questions to all interviewers before the interview.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label>When to Send Questions</Label>
            <Select
              value={localData.questionsSendTime.toString()}
              onValueChange={(value) => handleInputChange('questionsSendTime', parseInt(value))}
            >
              <SelectTrigger disabled={!localData.sendQuestionsToInterviewers}>
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
            {!localData.sendQuestionsToInterviewers && (
              <p className="text-xs text-muted-foreground">
                Enable auto-send to dispatch selected questions automatically.
              </p>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowQuestionSelector(true)}
            className="h-10"
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Select Questions
          </Button>
        </div>

        {errors.questions && (
          <p className="text-sm text-red-500">{errors.questions}</p>
        )}

        {localData.selectedQuestionIds.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No questions selected. Click "Select Questions" to select or create interview questions.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">
          {isQuestionsOnly ? 'Interviewer Questions' : 'Communication Settings'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {isQuestionsOnly
            ? 'Select and schedule questions to be sent to interviewers.'
            : 'Configure invitation email notifications and templates.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!isQuestionsOnly && (
          <Badge variant={localData.sendCustomEmail ? 'secondary' : 'outline'}>
            {localData.sendCustomEmail ? 'Custom Invitation Enabled' : 'Standard Invitation'}
          </Badge>
        )}
        <Badge variant="outline">
          {localData.selectedQuestionIds.length} Question{localData.selectedQuestionIds.length !== 1 ? 's' : ''} Selected
        </Badge>
        {!isEmailOnly && (
          <Badge variant={localData.sendQuestionsToInterviewers ? 'secondary' : 'outline'}>
            {localData.sendQuestionsToInterviewers ? `Send ${getQuestionSendTimeLabel(localData.questionsSendTime)}` : 'Questions Not Auto-Sent'}
          </Badge>
        )}
      </div>

      {/* Email Subject */}
      {!isQuestionsOnly && (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-4 space-y-2">
            <Label htmlFor="subject">Email Subject (Optional)</Label>
            <Input
              id="subject"
              type="text"
              placeholder="Leave blank to use default subject line"
              value={localData.subject}
              onChange={(e) => handleInputChange('subject', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Override the subject for this interview invitation.
            </p>
          </CardContent>
        </Card>
      )}

      {isDualMode ? (
        <Tabs
          value={settingsTab}
          onValueChange={(value) => setSettingsTab(value as 'invitation' | 'questions')}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="invitation" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Invitation Email
            </TabsTrigger>
            <TabsTrigger value="questions" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Interviewer Questions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invitation" className="mt-0">
            {invitationPanel}
          </TabsContent>

          <TabsContent value="questions" className="mt-0">
            {questionsPanel}
          </TabsContent>
        </Tabs>
      ) : isEmailOnly ? (
        invitationPanel
      ) : (
        questionsPanel
      )}

      {/* Enhanced Question Selector Dialog with Tabs */}
      <Dialog open={showQuestionSelector} onOpenChange={handleCloseQuestionSelector}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Interview Questions</DialogTitle>
            <DialogDescription>
              Select existing questions, create new ones, or generate with AI
            </DialogDescription>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="select" className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                Select Questions
              </TabsTrigger>
              <TabsTrigger value="create" className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Create Question
              </TabsTrigger>
              <TabsTrigger value="generate" className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </TabsTrigger>
            </TabsList>

            {/* Select Questions Tab */}
            <TabsContent value="select" className="flex-1 overflow-auto mt-4">
              <InterviewQuestionSelector
                key={questionSelectorKey}
                jobId={data.jobId}
                selectedQuestionIds={localData.selectedQuestionIds}
                onSelectionChange={handleQuestionSelection}
              />
            </TabsContent>

            {/* Create Question Tab */}
            <TabsContent value="create" className="flex-1 overflow-auto mt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newQuestion">Question *</Label>
                  <Textarea
                    id="newQuestion"
                    placeholder="Enter your interview question..."
                    value={newQuestion.question}
                    onChange={(e) => setNewQuestion(prev => ({ ...prev, question: e.target.value }))}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Question Type</Label>
                    <Select
                      value={newQuestion.type}
                      onValueChange={(value: any) => setNewQuestion(prev => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="behavioral">Behavioral</SelectItem>
                        <SelectItem value="situational">Situational</SelectItem>
                        <SelectItem value="cultural_fit">Cultural Fit</SelectItem>
                        <SelectItem value="skills_based">Skills Based</SelectItem>
                        <SelectItem value="experience_based">Experience Based</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Difficulty</Label>
                    <Select
                      value={newQuestion.difficulty}
                      onValueChange={(value: any) => setNewQuestion(prev => ({ ...prev, difficulty: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Interview Stage</Label>
                    <Select
                      value={newQuestion.interviewStage}
                      onValueChange={(value: any) => setNewQuestion(prev => ({ ...prev, interviewStage: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="screening">Screening</SelectItem>
                        <SelectItem value="first_round">First Round</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                        <SelectItem value="hr">HR</SelectItem>
                        <SelectItem value="panel">Panel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Category (Optional)</Label>
                    <Input
                      placeholder="e.g., Leadership, Problem Solving"
                      value={newQuestion.category || ''}
                      onChange={(e) => setNewQuestion(prev => ({ ...prev, category: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Expected Answer / Notes (Optional)</Label>
                  <Textarea
                    placeholder="What should a good answer include..."
                    value={newQuestion.expectedAnswer || ''}
                    onChange={(e) => setNewQuestion(prev => ({ ...prev, expectedAnswer: e.target.value }))}
                    rows={3}
                  />
                </div>

                <Button
                  onClick={handleCreateQuestion}
                  disabled={isCreating || !newQuestion.question.trim()}
                  className="w-full"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Question
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* Generate with AI Tab */}
            <TabsContent value="generate" className="flex-1 overflow-auto mt-4">
              <div className="space-y-4">
                <Alert>
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription>
                    AI will generate interview questions based on the job description and your preferences.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Number of Questions</Label>
                    <Select
                      value={generateOptions.questionCount?.toString()}
                      onValueChange={(value) => setGenerateOptions(prev => ({ ...prev, questionCount: parseInt(value) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3 questions</SelectItem>
                        <SelectItem value="5">5 questions</SelectItem>
                        <SelectItem value="10">10 questions</SelectItem>
                        <SelectItem value="15">15 questions</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Interview Stage</Label>
                    <Select
                      value={generateOptions.stage}
                      onValueChange={(value: any) => setGenerateOptions(prev => ({ ...prev, stage: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="screening">Screening</SelectItem>
                        <SelectItem value="first_round">First Round</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                        <SelectItem value="hr">HR</SelectItem>
                        <SelectItem value="panel">Panel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Difficulty Level</Label>
                  <Select
                    value={generateOptions.difficulty}
                    onValueChange={(value: any) => setGenerateOptions(prev => ({ ...prev, difficulty: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Question Types to Include</Label>
                  <div className="flex flex-wrap gap-2">
                    {['technical', 'behavioral', 'situational', 'cultural_fit'].map((type) => (
                      <Button
                        key={type}
                        size="sm"
                        variant={generateOptions.includeTypes?.includes(type as any) ? "default" : "outline"}
                        onClick={() => {
                          const current = generateOptions.includeTypes || [];
                          const newTypes = current.includes(type as any)
                            ? current.filter(t => t !== type)
                            : [...current, type as any];
                          setGenerateOptions(prev => ({ ...prev, includeTypes: newTypes }));
                        }}
                      >
                        {type.replace('_', ' ')}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Bias Level Control */}
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600" />
                    <Label>Bias Filter Level: {generateOptions.maxBiasScore}</Label>
                  </div>
                  <Slider
                    value={[generateOptions.maxBiasScore || 0.3]}
                    onValueChange={([value]) => setGenerateOptions(prev => ({ ...prev, maxBiasScore: value }))}
                    max={1}
                    min={0}
                    step={0.1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Strict (0.0)</span>
                    <span>Balanced (0.3)</span>
                    <span>Relaxed (1.0)</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Filter out AI-generated questions with bias scores above this threshold.
                  </p>
                </div>

                <Button
                  onClick={handleGenerateQuestions}
                  disabled={isGenerating}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating Questions...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate {generateOptions.questionCount} Questions
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between mt-4 pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {localData.selectedQuestionIds.length} question{localData.selectedQuestionIds.length !== 1 ? 's' : ''} selected
            </div>
            <Button onClick={handleCloseQuestionSelector}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Navigation */}
      <div className="step-nav-actions hidden flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious} data-step-action="previous">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>

        <Button onClick={handleContinue} data-step-action="next">
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
