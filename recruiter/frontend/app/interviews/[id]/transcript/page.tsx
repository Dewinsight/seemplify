"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Mic, MicOff, RefreshCw, FileText, Calendar, Clock, Users, AlertCircle, Plus, Loader2, ExternalLink, Video, CheckCircle, XCircle, Clock3, Sparkles, AlertTriangle, Search, MessageSquare, Play, Zap, FileCheck, X } from 'lucide-react';
import interviewService from '@/services/interviewService';
import { toast } from 'sonner';
import { RealtimeTranscript } from '@/components/ui/realtime-transcript';
import { TranscriptViewer } from '@/components/ui/transcript-viewer';
import {
  calculateComprehensiveReport,
  getScoreColorClass
} from '@/utils/interview-scoring-utils';
import { InterviewSummary } from '@/components/ui/interview-summary';
import { InterviewFeedbackSimple } from '@/components/ui/interview-feedback-simple';
import { ScrollArea } from '@/components/ui/scroll-area';

// Helper component for transcript content
function TranscriptContent({ transcript }: { transcript: any }) {
  const [searchTerm, setSearchTerm] = useState('');

  // Parse transcript content
  const parsedTranscript = useMemo(() => {
    if (!transcript.content) return [];

    try {
      const parsed = JSON.parse(transcript.content);
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed.segments && Array.isArray(parsed.segments)) {
        return parsed.segments;
      } else if (parsed.transcript && Array.isArray(parsed.transcript)) {
        return parsed.transcript;
      }
    } catch (e) {
      const lines = transcript.content.split('\n').filter((line: string) => line.trim());
      return lines.map((line: string, index: number) => ({
        text: line.trim(),
        speaker: line.includes(':') ? line.split(':')[0] : 'Unknown',
        timestamp: `${Math.floor(index * 30)}s`
      }));
    }

    return [{
      text: transcript.content,
      speaker: 'Unknown',
      timestamp: '0:00'
    }];
  }, [transcript.content]);

  const filteredTranscript = useMemo(() => {
    if (!searchTerm) return parsedTranscript;
    return parsedTranscript.filter((segment: any) =>
      segment.text.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [parsedTranscript, searchTerm]);

  const getSpeakerColor = (speaker: string) => {
    const colors = [
      'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100',
      'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-100',
      'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100',
      'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100'
    ];
    const hash = speaker.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Conversation Transcript</CardTitle>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search transcript..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] w-full rounded-md border p-4">
          <div className="space-y-4">
            {filteredTranscript.length > 0 ? (
              filteredTranscript.map((segment: any, index: number) => (
                <div key={index} className="group">
                  <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-xs font-medium ${getSpeakerColor(segment.speaker || 'Unknown')}`}
                      >
                        {segment.speaker || 'Unknown'}
                      </Badge>
                    </div>
                    <div className="flex-1">
                      <p className="text-gray-900 dark:text-gray-100 leading-relaxed">
                        {searchTerm ? (
                          segment.text.split(new RegExp(`(${searchTerm})`, 'gi')).map((part: string, i: number) =>
                            part.toLowerCase() === searchTerm.toLowerCase() ? (
                              <mark key={i} className="bg-yellow-200 px-1 rounded">
                                {part}
                              </mark>
                            ) : (
                              part
                            )
                          )
                        ) : (
                          segment.text
                        )}
                      </p>
                      {segment.timestamp && (
                        <p className="text-xs text-muted-foreground mt-1">{segment.timestamp}</p>
                      )}
                    </div>
                  </div>
                  {index < filteredTranscript.length - 1 && (
                    <Separator className="my-2 opacity-30" />
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No transcript segments found matching your search.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Helper component for summary content
function SummaryContent({
  transcript,
  interviewId,
  aiSummary,
  teamAnalysis,
  comments
}: {
  transcript: any;
  interviewId: string;
  aiSummary?: any;
  teamAnalysis?: any;
  comments?: any[];
}) {
  const [showReport, setShowReport] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  const generateComprehensiveReport = () => {
    setGeneratingReport(true);

    // Simulate report generation (in real app, this would call an API)
    setTimeout(() => {
      const report = calculateComprehensiveReport(transcript, aiSummary, teamAnalysis, comments || []);
      setReportData(report);
      setShowReport(true);
      setGeneratingReport(false);
    }, 1500);
  };

  // Use the shared utility functions for calculations

  // Use the imported getScoreColorClass instead

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Interview Summary</CardTitle>
              <CardDescription>Key points and overview from the transcript</CardDescription>
            </div>
            <Button
              onClick={generateComprehensiveReport}
              disabled={generatingReport}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              {generatingReport ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Comprehensive Report
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {transcript.summary && (
              <div>
                <h3 className="font-semibold mb-2">Summary</h3>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{transcript.summary}</p>
              </div>
            )}

            {transcript.keyPoints && transcript.keyPoints.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Key Points</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  {transcript.keyPoints.map((point: string, index: number) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {transcript.actionItems && transcript.actionItems.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Action Items</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  {transcript.actionItems.map((item: string, index: number) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {(!transcript.summary && (!transcript.keyPoints || transcript.keyPoints.length === 0)) && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Summary information not available for this transcript.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Comprehensive Report Card */}
      {showReport && reportData && (
        <Card className="mt-6 border-2 border-blue-200 dark:border-blue-900">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Comprehensive Interview Report</CardTitle>
              <Badge variant="outline" className="text-sm">
                Generated: {new Date(reportData.timestamp).toLocaleString()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Overall Score */}
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-2">
                Overall Score: <span className={getScoreColorClass(reportData.percentage)}>
                  {reportData.percentage}%
                </span>
              </h2>
              <p className="text-lg text-muted-foreground mb-4">
                {reportData.finalScore} / {reportData.maxScore} points
              </p>
              <Badge className="text-lg px-4 py-2" variant={
                reportData.percentage >= 65 ? 'default' : 'secondary'
              }>
                {reportData.recommendation}
              </Badge>
            </div>

            <Separator className="my-6" />

            {/* Score Breakdown */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-4">Score Breakdown</h3>
              <div className="space-y-3">
                {reportData.scoreComponents.map((component: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-muted/30 dark:bg-white/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{component.category}</span>
                      {!component.available && (
                        <Badge variant="outline" className="text-xs">Not Available</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${component.available ? 'text-blue-600' : 'text-gray-400'}`}>
                        {component.score} / {component.maxScore}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        ({Math.round((component.score / component.maxScore) * 100)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator className="my-6" />

            {/* Data Availability */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-4">Data Sources</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className={`p-3 rounded-lg text-center ${reportData.dataAvailability.hasAIInsights
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-muted/30 dark:bg-white/5 border border-gray-200 dark:border-white/5'
                  }`}>
                  {reportData.dataAvailability.hasAIInsights ? (
                    <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-2" />
                  ) : (
                    <XCircle className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                  )}
                  <p className="text-sm font-medium">AI Insights</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${reportData.dataAvailability.hasTeamComments
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-muted/30 dark:bg-white/5 border border-gray-200 dark:border-white/5'
                  }`}>
                  {reportData.dataAvailability.hasTeamComments ? (
                    <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-2" />
                  ) : (
                    <XCircle className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                  )}
                  <p className="text-sm font-medium">Team Comments</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${reportData.dataAvailability.hasTeamAnalysis
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-muted/30 dark:bg-white/5 border border-gray-200 dark:border-white/5'
                  }`}>
                  {reportData.dataAvailability.hasTeamAnalysis ? (
                    <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-2" />
                  ) : (
                    <XCircle className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                  )}
                  <p className="text-sm font-medium">Team Analysis</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowReport(false)}>
                Close Report
              </Button>
              <Button
                onClick={() => {
                  // In a real app, this would download the report as PDF
                  toast.success('Report download started');
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// Helper component for participants content
function ParticipantsContent({ transcript }: { transcript: any }) {
  const formatSpeakingTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  const getSpeakerColor = (speaker: string) => {
    const colors = [
      'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100',
      'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-100',
      'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100',
      'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100'
    ];
    const hash = speaker.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  // Extract speakers from transcript if no participants data
  const speakers = useMemo(() => {
    if (!transcript.content) return [];

    try {
      const parsed = JSON.parse(transcript.content);
      const segments = Array.isArray(parsed) ? parsed :
        (parsed.segments || parsed.transcript || []);

      const speakerSet = new Set();
      segments.forEach((segment: any) => {
        if (segment.speaker) speakerSet.add(segment.speaker);
      });
      return Array.from(speakerSet) as string[];
    } catch (e) {
      const lines = transcript.content.split('\n').filter((line: string) => line.trim());
      const speakerSet = new Set<string>();
      lines.forEach((line: string) => {
        if (line.includes(':')) {
          speakerSet.add(line.split(':')[0].trim());
        }
      });
      return Array.from(speakerSet) as string[];
    }
  }, [transcript.content]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Participants</CardTitle>
        <CardDescription>
          Detailed breakdown of all participants in the meeting
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {transcript.participants && transcript.participants.length > 0 ? (
            transcript.participants.map((participant: any, index: number) => (
              <Card key={index} className="border-l-4 border-l-blue-500">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-lg">{participant.name}</h3>
                      <p className="text-sm text-muted-foreground">{participant.email}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Speaking Time</span>
                      <Badge variant="outline" className={getSpeakerColor(participant.name)}>
                        {formatSpeakingTime(participant.speakingTime)}
                      </Badge>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1">
                      <div
                        className="bg-blue-600 h-1 rounded-full"
                        style={{
                          width: `${transcript.duration > 0 ? (participant.speakingTime / transcript.duration) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : speakers.length > 0 ? (
            speakers.map((speaker: string, index: number) => (
              <Card key={index} className="border-l-4 border-l-blue-500">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-lg">{speaker}</h3>
                      <p className="text-sm text-muted-foreground">Detected from transcript</p>
                    </div>
                    <Badge variant="outline" className={getSpeakerColor(speaker)}>
                      Speaker {index + 1}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="col-span-2 text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No participant information available.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TranscriptPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const interviewId = params.id as string;

  // Get referrer information from URL parameters
  const referrerSource = searchParams.get('from');
  const jobId = searchParams.get('jobId');

  // Smart back navigation function
  const handleBackNavigation = () => {
    if (referrerSource === 'jobs' && jobId) {
      router.push(`/jobs/${jobId}`);
    } else if (referrerSource === 'calendar') {
      router.push('/calendar');
    } else {
      // Fallback to browser back if no referrer info
      router.back();
    }
  };
  const [interview, setInterview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [showNotetakerDialog, setShowNotetakerDialog] = useState(false);
  const [meetingLink, setMeetingLink] = useState('');
  const [enablingNotetaker, setEnablingNotetaker] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [completedTranscript, setCompletedTranscript] = useState<any>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [syncingTranscript, setSyncingTranscript] = useState(false);
  const [forcingCompletion, setForcingCompletion] = useState(false);
  const [aiSummary, setAiSummary] = useState<any>(null);
  const [teamAnalysis, setTeamAnalysis] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);

  // Cancel interview states
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Use ref instead of state to persist the flag across re-renders
  const hasAttemptedSyncRef = useRef(false);

  useEffect(() => {
    fetchInterview();
    fetchComments();
  }, [interviewId]);

  // Check for completed transcript when interview is loaded or status changes
  useEffect(() => {
    if (interview?.notetakerId && !completedTranscript) {
      // Check for completed transcript if status suggests it might be ready
      if (['completed', 'processing'].includes(interview.notetakerStatus)) {
        console.log('Checking for completed transcript, status:', interview.notetakerStatus);
        fetchCompletedTranscript();
      }
      // Also check if interview is past its scheduled end time
      else if (interview.scheduledAt && interview.duration) {
        const scheduledEnd = new Date(interview.scheduledAt);
        scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
        const now = new Date();

        if (now > scheduledEnd) {
          console.log('Interview should have ended, checking for completed transcript...');
          fetchCompletedTranscript();

          // If status is still pending and interview ended more than 15 minutes ago, 
          // try to sync notetaker status
          const minutesSinceEnd = Math.round((now.getTime() - scheduledEnd.getTime()) / (1000 * 60));
          if (interview.notetakerStatus === 'pending' && minutesSinceEnd > 15) {
            console.log(`Interview ended ${minutesSinceEnd} minutes ago but status is still pending, syncing...`);
            handleSyncNotetaker();
          }
        }
      }
    }
  }, [interview?.notetakerStatus, interview?.notetakerId, interview?.scheduledAt]);

  const fetchInterview = async () => {
    try {
      const data = await interviewService.getInterviewDetails(interviewId);
      console.log('Fetched interview data:', {
        id: data._id,
        notetakerEnabled: data.notetakerEnabled,
        notetakerId: data.notetakerId,
        notetakerStatus: data.notetakerStatus,
        scheduledAt: data.scheduledAt,
        duration: data.duration
      });

      setInterview(data);

      // Extract AI summary and team analysis if available
      if ((data as any).aiInterviewSummary?.generated) {
        setAiSummary((data as any).aiInterviewSummary);
      }
      if ((data as any).teamFeedbackAnalysis?.analyzed) {
        setTeamAnalysis((data as any).teamFeedbackAnalysis);
      }

      // Pre-fill meeting link if available
      if (data.conferencing?.details?.url) {
        setMeetingLink(data.conferencing.details.url);
      }

      // Check if we need to sync notetaker (only if we haven't attempted sync yet)
      if (data.notetakerEnabled && !data.notetakerId && !hasAttemptedSyncRef.current) {
        console.log('Notetaker enabled but ID missing, attempting to sync...');
        hasAttemptedSyncRef.current = true; // Set flag before attempting sync

        // Add a small delay to ensure component is fully mounted
        setTimeout(async () => {
          await handleSyncNotetaker(data);
        }, 500);
      }

      // Check if interview has ended but notetaker status is still pending
      if (data.notetakerEnabled && data.notetakerId && data.notetakerStatus === 'pending' &&
        data.scheduledAt && data.duration) {
        const scheduledEnd = new Date(data.scheduledAt);
        scheduledEnd.setMinutes(scheduledEnd.getMinutes() + data.duration);
        const now = new Date();
        const minutesSinceEnd = Math.round((now.getTime() - scheduledEnd.getTime()) / (1000 * 60));

        if (minutesSinceEnd > 15) {
          console.log(`Interview ended ${minutesSinceEnd} minutes ago but status is pending, auto-syncing...`);
          setTimeout(async () => {
            await handleSyncNotetaker(data);
          }, 1000);
        }
      }
    } catch (error: any) {
      console.error('Error fetching interview:', error);
      toast.error('Failed to load interview details');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNotetaker = async (interviewData?: any) => {
    const currentInterview = interviewData || interview;
    if (!currentInterview) return;

    console.log('Starting sync for interview:', {
      id: currentInterview._id,
      notetakerEnabled: currentInterview.notetakerEnabled,
      notetakerId: currentInterview.notetakerId
    });

    // Check if sync is actually needed
    if (currentInterview.notetakerId && currentInterview.notetakerEnabled) {
      console.log('Interview already has notetaker ID and is enabled - no sync needed');
      return;
    }

    setSyncing(true);
    try {
      const result = await interviewService.syncNotetakerStatus(currentInterview._id);
      console.log('Sync result:', result);

      if (result.success) {
        toast.success('Notetaker synced successfully!');
        // Update the interview state instead of reloading
        setInterview((prev: any) => ({
          ...prev,
          notetakerId: result.notetakerId,
          notetakerStatus: result.status || 'enabled'
        }));
        console.log('Updated interview state with notetaker ID:', result.notetakerId);
        // Don't reload the page - the state update will trigger the component to re-render
      }
    } catch (error: any) {
      console.error('Failed to sync notetaker:', error);

      // Handle the specific case where interview doesn't need syncing
      if (error.message && error.message.includes('Interview does not need syncing')) {
        console.log('Interview already synced or not eligible for syncing - this is expected');
        // Don't show error toast for this expected case
        return;
      }

      toast.error('Failed to sync notetaker: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  const refreshNotetakerStatus = async () => {
    if (!interview || !interview._id || !interview.notetakerEnabled || !interview.notetakerId) {
      toast.error('No active notetaker to refresh');
      return;
    }

    setRefreshingStatus(true);
    try {
      const result = await interviewService.checkNotetakerStatus(interview._id);

      if (result.success && result.status) {
        // Update the interview state with new status
        setInterview((prev: any) => ({
          ...prev,
          notetakerStatus: result.status
        }));

        toast.success(`Notetaker status updated: ${result.status}`);
      } else {
        toast.error('Failed to update notetaker status');
      }
    } catch (error: any) {
      console.error('Error refreshing notetaker status:', error);
      toast.error('Error refreshing status: ' + error.message);
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleManualSync = async () => {
    // Reset the flag to allow manual retry
    hasAttemptedSyncRef.current = false;
    await handleSyncNotetaker();
  };

  const handleManualTranscriptSync = async () => {
    if (!interview) return;

    setSyncingTranscript(true);
    try {
      const result = await interviewService.manualTranscriptSync(interview._id);

      if (result.success) {
        toast.success(result.message);

        // Update the completed transcript state
        if (result.transcript) {
          setCompletedTranscript({
            transcript: result.transcript,
            isMultiCandidate: result.isMultiCandidate || false,
            scheduledTime: (result as any).scheduledTime,
            actualTime: (result as any).actualTime,
            overflow: (result as any).overflow,
            sessionId: (result as any).sessionId
          });
        }

        // Refresh interview data
        await fetchInterview();

      }
    } catch (error: any) {
      console.error('Failed to sync transcript:', error);
      toast.error('Failed to sync transcript: ' + error.message);
    } finally {
      setSyncingTranscript(false);
    }
  };

  const handleForceCompletion = async () => {
    if (!interview) return;

    setForcingCompletion(true);
    try {
      const result = await interviewService.forceInterviewCompletion(interview._id);

      if (result.success) {
        toast.success(result.message);

        // Update interview status
        setInterview((prev: any) => ({
          ...prev,
          status: result.status
        }));

        // Refresh interview data
        await fetchInterview();

      }
    } catch (error: any) {
      console.error('Failed to force completion:', error);
      toast.error('Failed to force completion: ' + error.message);
    } finally {
      setForcingCompletion(false);
    }
  };

  const handleTranscriptReady = (transcript: string) => {
    setTranscriptReady(true);
    toast.success('Transcript is now available!');
    // Try to fetch the completed transcript
    fetchCompletedTranscript();
  };

  const handleShowCancelDialog = () => {
    setShowCancelDialog(true);
  };

  const handleCancelInterview = async () => {
    if (!interview || !cancelReason.trim()) {
      toast.error('Please provide a cancellation reason');
      return;
    }

    setCancelling(true);
    try {
      await interviewService.cancelInterview(
        interview._id,
        cancelReason,
        true // notifyParticipants
      );

      toast.success('Interview cancelled successfully');

      // Update local interview state
      setInterview((prev: any) => prev ? { ...prev, status: 'cancelled' } : null);

      // Close dialog and reset state
      setShowCancelDialog(false);
      setCancelReason('');

      // Optionally redirect back or refresh
      setTimeout(() => {
        router.push('/calendar');
      }, 1000);

    } catch (error: any) {
      console.error('Failed to cancel interview:', error);
      toast.error('Failed to cancel interview: ' + error.message);
    } finally {
      setCancelling(false);
    }
  };

  const fetchCompletedTranscript = async () => {
    if (!interview?.notetakerId || loadingTranscript) return;

    setLoadingTranscript(true);
    try {
      const data = await interviewService.getTranscript(interviewId);
      setCompletedTranscript(data);
      console.log('Completed transcript fetched:', data);
    } catch (error: any) {
      console.log('Completed transcript not ready yet:', error.message);
      // Don't show error toast - this is expected during the meeting
    } finally {
      setLoadingTranscript(false);
    }
  };

  const handleEnableNotetaker = async () => {
    if (!interview || !meetingLink) return;

    try {
      setEnablingNotetaker(true);
      const result = await interviewService.enableNotetaker(interview._id, meetingLink);

      if (result.success) {
        toast.success('Notetaker enabled successfully');
        // Update the interview state instead of reloading
        setInterview((prev: any) => ({
          ...prev,
          notetakerEnabled: true,
          notetakerId: result.notetakerId,
          notetakerStatus: 'enabled'
        }));
        setShowNotetakerDialog(false);
        // Don't reload the page - the state update will trigger the component to re-render
      }
    } catch (error) {
      console.error('Failed to enable notetaker:', error);
      toast.error('Failed to enable notetaker');
    } finally {
      setEnablingNotetaker(false);
    }
  };

  const handleSummaryGenerated = (summary: any) => {
    setAiSummary(summary);
  };

  const handleAnalysisGenerated = (analysis: any) => {
    setTeamAnalysis(analysis);
  };

  const fetchComments = async () => {
    try {
      const response = await interviewService.getInterviewComments(interviewId);
      if (response && response.comments) {
        setComments(response.comments);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'processing': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'enabled': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'recording': return 'bg-red-100 text-red-800 border-red-200';
      case 'failed': return 'bg-red-100 text-red-800 border-red-200';
      case 'deleted': return 'bg-muted/50 text-gray-800 border-gray-200';
      default: return 'bg-muted/50 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'processing': return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'pending': return <Clock3 className="h-4 w-4" />;
      case 'enabled': return <Mic className="h-4 w-4" />;
      case 'recording': return <Mic className="h-4 w-4" />;
      case 'failed': return <XCircle className="h-4 w-4" />;
      case 'deleted': return <XCircle className="h-4 w-4" />;
      default: return <XCircle className="h-4 w-4" />;
    }
  };

  const getStatusText = (status: string, interview: any) => {
    // Check if interview has ended
    const hasEnded = interview?.scheduledAt && interview?.duration ? (() => {
      const scheduledEnd = new Date(interview.scheduledAt);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
      return new Date() > scheduledEnd;
    })() : false;

    switch (status) {
      case 'completed':
        return 'Complete';
      case 'processing':
        return 'Processing';
      case 'pending':
        return hasEnded ? 'Updating Status...' : 'Pending';
      case 'enabled':
        return 'Active';
      case 'recording':
        return 'Recording';
      case 'failed':
        return 'Failed';
      case 'deleted':
        return 'Unavailable';
      default:
        return 'Unknown';
    }
  };

  const getStatusDescription = (status: string, interview: any) => {
    // Check if interview has ended
    const hasEnded = interview?.scheduledAt && interview?.duration ? (() => {
      const scheduledEnd = new Date(interview.scheduledAt);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
      return new Date() > scheduledEnd;
    })() : false;

    switch (status) {
      case 'completed':
        return 'Transcript and recording are ready';
      case 'processing':
        return 'Generating transcript...';
      case 'pending':
        return hasEnded ? 'Interview has ended, checking final status...' : 'Will start at scheduled time';
      case 'enabled':
        return 'AI notetaker is active';
      case 'recording':
        return 'AI notetaker is recording';
      case 'failed':
        return 'Recording failed or was interrupted';
      case 'deleted':
        return 'Notetaker was removed or expired';
      default:
        return 'Status unknown';
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  };

  const getMeetingTimeStatus = () => {
    if (!interview?.scheduledAt || !interview?.duration) return null;

    const scheduledStart = new Date(interview.scheduledAt);
    const scheduledEnd = new Date(interview.scheduledAt);
    scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
    const now = new Date();

    if (now < scheduledStart) {
      const minutesUntilStart = Math.round((scheduledStart.getTime() - now.getTime()) / (1000 * 60));
      return {
        status: 'upcoming',
        text: `Starts in ${minutesUntilStart} minutes`,
        color: 'text-blue-600'
      };
    } else if (now <= scheduledEnd) {
      const minutesRemaining = Math.round((scheduledEnd.getTime() - now.getTime()) / (1000 * 60));
      return {
        status: 'ongoing',
        text: `${minutesRemaining} minutes remaining`,
        color: 'text-green-600'
      };
    } else {
      const minutesSinceEnd = Math.round((now.getTime() - scheduledEnd.getTime()) / (1000 * 60));
      return {
        status: 'ended',
        text: `Ended ${minutesSinceEnd} minutes ago`,
        color: 'text-muted-foreground'
      };
    }
  };

  const getActualRecordingStatus = (interview: any, completedTranscript: any) => {
    // Priority 1: Check if we have actual recording/transcript content
    if (completedTranscript?.transcript?.content || interview?.transcript?.content) {
      return {
        status: 'completed',
        hasRecording: !!(completedTranscript?.recordingUrl || interview?.recordingUrl),
        hasTranscript: true,
        title: 'Recording Complete',
        description: 'Transcript and recording are ready for review',
        color: 'bg-green-100 text-green-800 border-green-200',
        icon: CheckCircle
      };
    }

    // Priority 2: Check if notetaker is processing or completed but we don't have content yet
    if (['processing', 'completed'].includes(interview?.notetakerStatus)) {
      return {
        status: 'processing',
        hasRecording: false,
        hasTranscript: false,
        title: 'Processing Recording',
        description: 'AI is generating transcript and processing recording...',
        color: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: Loader2
      };
    }

    // Priority 3: Check if interview has ended but notetaker status is unclear
    if (interview?.scheduledAt && interview?.duration) {
      const scheduledEnd = new Date(interview.scheduledAt);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
      const now = new Date();
      const minutesSinceEnd = Math.round((now.getTime() - scheduledEnd.getTime()) / (1000 * 60));

      if (minutesSinceEnd > 5) {
        return {
          status: 'checking',
          hasRecording: false,
          hasTranscript: false,
          title: 'Checking Recording Status',
          description: `Interview ended ${minutesSinceEnd} minutes ago, checking for recording...`,
          color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          icon: RefreshCw
        };
      }
    }

    // Priority 4: Check if waiting to start
    if (['pending', 'scheduled'].includes(interview?.notetakerStatus)) {
      return {
        status: 'waiting',
        hasRecording: false,
        hasTranscript: false,
        title: 'Waiting to Start',
        description: 'AI notetaker will join at the scheduled meeting time',
        color: 'bg-muted/50 text-gray-800 border-gray-200',
        icon: Clock3
      };
    }

    // Priority 5: Check if recording is in progress
    if (['recording', 'enabled', 'joined', 'joining'].includes(interview?.notetakerStatus)) {
      return {
        status: 'recording',
        hasRecording: false,
        hasTranscript: false,
        title: 'Recording Active',
        description: 'AI notetaker is currently recording the interview',
        color: 'bg-red-100 text-red-800 border-red-200',
        icon: Mic
      };
    }

    // Priority 6: Failed or deleted states
    if (['failed', 'deleted', 'cancelled'].includes(interview?.notetakerStatus)) {
      return {
        status: 'unavailable',
        hasRecording: false,
        hasTranscript: false,
        title: 'Recording Unavailable',
        description: 'Recording was not completed or has expired',
        color: 'bg-muted/50 text-muted-foreground border-gray-200',
        icon: XCircle
      };
    }

    // Default state
    return {
      status: 'unknown',
      hasRecording: false,
      hasTranscript: false,
      title: 'Status Unknown',
      description: 'Unable to determine recording status',
      color: 'bg-muted/50 text-muted-foreground border-gray-200',
      icon: AlertCircle
    };
  };

  const getRecordingMetadata = (interview: any, completedTranscript: any) => {
    const recordingUrl = completedTranscript?.recordingUrl || interview?.recordingUrl;
    const transcriptData = completedTranscript?.transcript || interview?.transcript;

    return {
      recordingUrl,
      transcriptUrl: transcriptData?.url,
      recordingSize: completedTranscript?.metadata?.size,
      availableUntil: completedTranscript?.metadata?.availableUntil,
      generatedAt: interview?.transcriptAvailableAt || completedTranscript?.transcriptAvailableAt,
      duration: interview?.duration,
      participants: interview?.participants?.length || 0
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="container mx-auto p-6 max-w-7xl">
          <div className="mb-8">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-24" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const timeStatus = getMeetingTimeStatus();

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={handleBackNavigation}
            className="mb-6 hover:bg-white dark:hover:bg-card"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to {referrerSource === 'jobs' ? 'Job Details' : referrerSource === 'calendar' ? 'Calendar' : 'Interview'}
          </Button>

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-foreground mb-2">Interview Transcript</h1>
              <p className="text-lg text-muted-foreground">
                AI-powered recording and analysis for your interview
              </p>
            </div>

            <div className="flex items-center gap-3">
              {interview?.notetakerEnabled && (
                (() => {
                  const recordingStatus = getActualRecordingStatus(interview, completedTranscript);
                  return (
                    <Badge
                      className={`${recordingStatus.color} border px-3 py-1.5 text-sm font-medium`}
                    >
                      <recordingStatus.icon className={`h-4 w-4 ${recordingStatus.status === 'processing' ? 'animate-spin' : ''
                        }`} />
                      <span className="ml-2">
                        AI Notetaker {recordingStatus.title.replace('Recording ', '')}
                      </span>
                    </Badge>
                  );
                })()
              )}

              {interview?.notetakerEnabled && interview?.notetakerId && !completedTranscript && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchCompletedTranscript}
                  disabled={loadingTranscript}
                  className="bg-white hover:bg-muted/30"
                >
                  {loadingTranscript ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </>
                  )}
                </Button>
              )}

              {/* Show additional sync button if status seems stuck */}
              {(() => {
                const recordingStatus = getActualRecordingStatus(interview, completedTranscript);
                return recordingStatus.status === 'checking' && getMeetingTimeStatus()?.status === 'ended' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualSync}
                    disabled={syncing}
                    className="bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Update Status
                      </>
                    )}
                  </Button>
                );
              })()}

              {/* Refresh Notetaker Status button - show if notetaker is enabled */}
              {interview?.notetakerEnabled && interview?.notetakerId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshNotetakerStatus}
                  disabled={refreshingStatus}
                  className="bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                  title="Check for latest notetaker status from Nylas API"
                >
                  {refreshingStatus ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh Status
                    </>
                  )}
                </Button>
              )}

              {/* Manual transcript sync button */}
              {interview?.notetakerEnabled && !completedTranscript && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualTranscriptSync}
                  disabled={syncingTranscript}
                  className="bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
                  title="Manually download and sync transcript from Nylas"
                >
                  {syncingTranscript ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Sync Transcript
                    </>
                  )}
                </Button>
              )}

              {/* Force completion button */}
              {interview?.status !== 'completed' && getMeetingTimeStatus()?.status === 'ended' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleForceCompletion}
                  disabled={forcingCompletion}
                  className="bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100"
                  title="Force mark interview as completed (manual override)"
                >
                  {forcingCompletion ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Completing...
                    </>
                  ) : (
                    <>
                      <FileCheck className="h-4 w-4 mr-2" />
                      Force Complete
                    </>
                  )}
                </Button>
              )}

              {/* Cancel interview button - only show if interview is not completed/cancelled and is before current time */}
              {interview?.status !== 'completed' &&
                interview?.status !== 'cancelled' &&
                interview?.scheduledAt &&
                new Date(interview.scheduledAt) > new Date() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShowCancelDialog}
                    className="bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                    title="Cancel this interview"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel Interview
                  </Button>
                )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Interview Overview Card */}
          {interview && (
            <Card className="bg-white dark:bg-card shadow-sm border-0 ring-1 ring-gray-200 dark:ring-border">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl font-semibold text-gray-900 dark:text-foreground">Interview Overview</CardTitle>
                  {timeStatus && (
                    <Badge variant="outline" className={`${timeStatus.color} border-current bg-transparent`}>
                      <Clock className="h-3 w-3 mr-1" />
                      {timeStatus.text}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                      <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-foreground">Candidate</p>
                      <p className="text-sm text-muted-foreground">
                        {interview.candidateId?.firstName} {interview.candidateId?.lastName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                      <Calendar className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-foreground">Scheduled</p>
                      <p className="text-sm text-muted-foreground">
                        {interview.scheduledAt ? new Date(interview.scheduledAt).toLocaleDateString('en-US', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        }) : 'Date not available'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {interview.scheduledAt ? new Date(interview.scheduledAt).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : 'Time not available'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                      <Clock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-foreground">Duration</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDuration(interview.duration)}
                      </p>
                    </div>
                  </div>
                </div>

                {interview.conferencing?.details?.url && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-900/30">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                          <Video className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Meeting Link</p>
                          <p className="text-xs text-blue-700 dark:text-blue-300">Click to join the interview</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                        asChild
                      >
                        <a
                          href={interview.conferencing.details.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Join Meeting
                        </a>
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* AI Analysis Status */}
            <Card className="bg-white dark:bg-card shadow-sm border-0 ring-1 ring-gray-200 dark:ring-border">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                  AI Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-gray-900 dark:text-foreground">Summary</span>
                  </div>
                  <Badge variant={aiSummary ? "default" : "secondary"} className="text-xs">
                    {aiSummary ? "Ready" : "Pending"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-gray-900 dark:text-foreground">Team Feedback</span>
                  </div>
                  <Badge variant={teamAnalysis ? "default" : "secondary"} className="text-xs">
                    {teamAnalysis ? "Analyzed" : "Pending"}
                  </Badge>
                </div>

                {(!aiSummary && !teamAnalysis) && (
                  <p className="text-xs text-muted-foreground mt-3">
                    AI analysis will be available after the interview transcript is complete.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Recording Status */}
            {interview?.notetakerEnabled && interview?.notetakerId && (
              <Card className="bg-white dark:bg-card shadow-sm border-0 ring-1 ring-gray-200 dark:ring-border">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-semibold text-gray-900 dark:text-foreground">Recording Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const recordingStatus = getActualRecordingStatus(interview, completedTranscript);
                    const metadata = getRecordingMetadata(interview, completedTranscript);
                    const IconComponent = recordingStatus.icon;

                    return (
                      <div className="space-y-4">
                        {/* Main Status Display */}
                        <div className={`p-4 rounded-lg border ${recordingStatus.color}`}>
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                              <IconComponent className={`h-6 w-6 ${recordingStatus.status === 'processing' ? 'animate-spin' : ''
                                }`} />
                            </div>
                            <div className="flex-1">
                              <h3 className="font-semibold text-lg">{recordingStatus.title}</h3>
                              <p className="text-sm opacity-90 mt-1">{recordingStatus.description}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </div>

          <Tabs defaultValue="transcript" className="w-full">
            <TabsList className="grid w-full grid-cols-5 h-12">
              <TabsTrigger value="transcript" className="text-base font-medium">Transcript</TabsTrigger>
              <TabsTrigger value="summary" className="text-base font-medium">Summary</TabsTrigger>
              <TabsTrigger value="insights" className="text-base font-medium">AI Insights</TabsTrigger>
              <TabsTrigger value="participants" className="text-base font-medium">Participants</TabsTrigger>
              <TabsTrigger value="feedback" className="text-base font-medium">Feedbacks</TabsTrigger>
            </TabsList>

            {/* Transcript Tab Content */}
            <TabsContent value="transcript">
              {completedTranscript && completedTranscript.transcript ? (
                <TranscriptViewer
                  transcript={completedTranscript.transcript}
                  notetakerStatus={interview?.notetakerStatus || 'unknown'}
                  transcriptAvailableAt={completedTranscript.transcriptAvailableAt || new Date().toISOString()}
                  recordingUrl={completedTranscript.recordingUrl}
                  aiSummary={aiSummary}
                  onGenerateSummary={handleSummaryGenerated}
                  interviewId={interviewId}
                  isMultiCandidate={interview?.isMultiCandidate || false}
                  candidateName={interview?.candidateId?.firstName && interview?.candidateId?.lastName
                    ? `${interview.candidateId.firstName} ${interview.candidateId.lastName}`
                    : undefined}
                  candidateEmail={interview?.candidateId?.email}
                  sessionId={interview?.multiCandidateSessionId}
                />
              ) : interview?.notetakerEnabled && interview?.notetakerId ? (
                <>
                  {loadingTranscript && (
                    <Card className="bg-white dark:bg-card shadow-sm border-0 ring-1 ring-gray-200 dark:ring-border">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                          <span className="font-medium">Checking for completed transcript...</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  <RealtimeTranscript
                    interviewId={interviewId}
                    onTranscriptReady={handleTranscriptReady}
                  />
                </>
              ) : (
                <Card className="bg-white dark:bg-card shadow-sm border-0 ring-1 ring-gray-200 dark:ring-border">
                  <CardContent className="pt-6">
                    <Alert className="border-amber-200 bg-amber-50">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                      <AlertDescription>
                        {interview?.notetakerEnabled && !interview?.notetakerId ? (
                          <div className="space-y-4">
                            <div>
                              <p className="font-medium text-amber-800 mb-2">AI notetaker configuration needed</p>
                              <p className="text-amber-700 text-sm">
                                The AI notetaker is enabled but not properly configured for this interview.
                              </p>
                            </div>
                            <div className="flex gap-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleManualSync}
                                disabled={syncing}
                                className="bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                              >
                                {syncing ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Syncing...
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Auto-Sync
                                  </>
                                )}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => setShowNotetakerDialog(true)}
                                className="bg-amber-600 hover:bg-amber-700 text-white"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Configure Manually
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <p className="font-medium text-amber-800 mb-2">No AI notetaker enabled</p>
                              <p className="text-amber-700 text-sm">
                                To get transcripts and recordings for future interviews, enable the AI notetaker when scheduling.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => setShowNotetakerDialog(true)}
                              className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add AI Notetaker Now
                            </Button>
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Summary Tab Content */}
            <TabsContent value="summary">
              {completedTranscript && completedTranscript.transcript ? (
                <SummaryContent
                  transcript={completedTranscript.transcript}
                  interviewId={interviewId}
                  aiSummary={aiSummary}
                  teamAnalysis={teamAnalysis}
                  comments={comments}
                />
              ) : (
                <Card>
                  <CardContent className="pt-6">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Summary will be available once the interview transcript is complete.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* AI Insights Tab Content */}
            <TabsContent value="insights">
              {completedTranscript && completedTranscript.transcript ? (
                <InterviewSummary
                  summary={aiSummary}
                  hasTranscript={true}
                  interviewId={interviewId}
                  onSummaryGenerated={handleSummaryGenerated}
                />
              ) : (
                <Card>
                  <CardContent className="pt-6">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        AI insights will be available once the interview transcript is complete.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Participants Tab Content */}
            <TabsContent value="participants">
              {completedTranscript && completedTranscript.transcript ? (
                <ParticipantsContent transcript={completedTranscript.transcript} />
              ) : (
                <Card>
                  <CardContent className="pt-6">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Participant information will be available once the interview transcript is complete.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Question-Based Feedback Tab Content */}
            <TabsContent value="feedback">
              <InterviewFeedbackSimple interviewId={interviewId} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Manual Notetaker Dialog */}
        <Dialog open={showNotetakerDialog} onOpenChange={setShowNotetakerDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5 text-blue-600" />
                Add AI Notetaker
              </DialogTitle>
              <DialogDescription>
                Add an AI notetaker to record and transcribe this interview. The bot will join the meeting automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div>
                <Label htmlFor="meetingLink" className="text-sm font-medium">Meeting Link</Label>
                <Input
                  id="meetingLink"
                  type="url"
                  placeholder="https://meet.google.com/..."
                  value={meetingLink}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMeetingLink(e.target.value)}
                  className="mt-2"
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Enter the Google Meet, Zoom, or Teams link for this interview.
                </p>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                variant="outline"
                onClick={() => setShowNotetakerDialog(false)}
                disabled={enablingNotetaker}
              >
                Cancel
              </Button>
              <Button
                onClick={handleEnableNotetaker}
                disabled={!meetingLink || enablingNotetaker}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {enablingNotetaker ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4 mr-2" />
                    Enable Notetaker
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel Interview Dialog */}
        <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Cancel Interview
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to cancel this interview? This action cannot be undone and will notify all participants.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="cancelReason">Reason for cancellation</Label>
                <Textarea
                  id="cancelReason"
                  placeholder="Please provide a reason for cancelling this interview..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="mt-1"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancelReason('');
                }}
                disabled={cancelling}
              >
                Keep Interview
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancelInterview}
                disabled={cancelling || !cancelReason.trim()}
              >
                {cancelling ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-2" />
                    Cancel Interview
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}