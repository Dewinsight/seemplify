"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { ScrollArea } from './scroll-area';
import { Skeleton } from './skeleton';
import { Alert, AlertDescription } from './alert';
import { Progress } from './progress';
import { 
  Mic, 
  MicOff, 
  RefreshCw, 
  Download, 
  Clock, 
  Users, 
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Radio
} from 'lucide-react';
import interviewService from '@/services/interviewService';
import { toast } from 'sonner';

interface RealtimeTranscriptProps {
  interviewId: string;
  className?: string;
  onTranscriptReady?: (transcript: string) => void;
}

interface TranscriptLine {
  speaker?: string;
  text: string;
  timestamp?: string;
}

export function RealtimeTranscript({ 
  interviewId, 
  className = '',
  onTranscriptReady 
}: RealtimeTranscriptProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [notetakerStatus, setNotetakerStatus] = useState<string>('unknown');
  const [meetingState, setMeetingState] = useState<string>('unknown');
  const [isPolling, setIsPolling] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [interview, setInterview] = useState<any>(null);
  const [isTranscriptReady, setIsTranscriptReady] = useState(false);
  
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Parse transcript into structured lines
  const parseTranscript = (rawTranscript: string): TranscriptLine[] => {
    const lines = rawTranscript.split('\n').filter(line => line.trim());
    return lines.map(line => {
      // Check if line has speaker format (e.g., "John Doe: Hello...")
      const speakerMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (speakerMatch) {
        return {
          speaker: speakerMatch[1].trim(),
          text: speakerMatch[2].trim()
        };
      }
      // Check if line has timestamp format (e.g., "[00:15:30] Hello...")
      const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
      if (timestampMatch) {
        return {
          timestamp: timestampMatch[1],
          text: timestampMatch[2].trim()
        };
      }
      return { text: line };
    });
  };

  const fetchTranscript = async () => {
    try {
      const response = await interviewService.getRealtimeTranscript(interviewId);
      
      if (!response.success) {
        // Handle the specific case where no notetaker is enabled
        if (response.message?.includes('No notetaker is enabled')) {
          setError('AI Notetaker is not active for this interview. Please enable it from the interview settings.');
          setNotetakerStatus('disabled');
          setIsPolling(false);
          setIsLoading(false);
          return;
        }
        throw new Error(response.message || 'Failed to fetch transcript');
      }

      // Update states
      setInterview(response.interview);
      setNotetakerStatus(response.notetaker?.status || 'unknown');
      setMeetingState(response.notetaker?.meetingState || 'unknown');
      setLastChecked(response.lastChecked);
      setEstimatedTime(response.estimatedTranscriptTime || null);
      setIsTranscriptReady(response.isTranscriptReady);

      // Update transcript if available
      if (response.transcript && response.transcript.content) {
        setTranscript(response.transcript.content);
        if (onTranscriptReady && !isTranscriptReady) {
          onTranscriptReady(response.transcript.content);
        }
      }

      // Determine if we should continue polling
      if (response.shouldPoll) {
        setIsPolling(true);
        // Don't set up new interval here - let useEffect handle it
      } else {
        setIsPolling(false);
        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
        }
      }

      setError(null);
    } catch (err: any) {
      // Check if it's a specific error we can handle gracefully
      if (err.message?.includes('No notetaker is enabled') || 
          err.message?.includes('No notetaker associated') ||
          err.message?.includes('notetaker_id is required')) {
        setError('AI Notetaker is not active for this interview. Please enable it from the interview settings.');
        setNotetakerStatus('disabled');
      } else {
        console.error('Error fetching transcript:', err);
        setError(err.message || 'Failed to fetch transcript');
      }
      setIsPolling(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchTranscript();
  }, [interviewId]);

  // Set up polling
  useEffect(() => {
    if (isPolling && !pollingInterval.current) {
      pollingInterval.current = setInterval(() => {
        fetchTranscript();
      }, 10000); // Poll every 10 seconds
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, [isPolling]);

  // Auto-scroll to bottom when transcript updates
  useEffect(() => {
    if (transcript && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleRefresh = () => {
    setIsLoading(true);
    fetchTranscript();
  };

  const handleDownload = () => {
    if (!transcript) return;

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${interview?.title || interviewId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Transcript downloaded');
  };

  const getStatusIcon = () => {
    switch (notetakerStatus) {
      case 'scheduled':
        return <Clock className="h-4 w-4" />;
      case 'joining':
      case 'joined':
        return <Radio className="h-4 w-4 animate-pulse" />;
      case 'recording':
        return <Mic className="h-4 w-4 text-red-500 animate-pulse" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <MicOff className="h-4 w-4" />;
    }
  };

  const getStatusColor = () => {
    switch (notetakerStatus) {
      case 'recording':
        return 'destructive';
      case 'completed':
        return 'success';
      case 'failed':
      case 'cancelled':
        return 'destructive';
      case 'processing':
        return 'secondary';
      default:
        return 'default';
    }
  };

  if (isLoading && !transcript) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Live Transcript
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !transcript) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Live Transcript
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} className="mt-4" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const parsedTranscript = transcript ? parseTranscript(transcript) : [];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Live Transcript
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={getStatusColor() as any} className="flex items-center gap-1">
              {getStatusIcon()}
              {notetakerStatus}
            </Badge>
            {meetingState && meetingState !== 'unknown' && (
              <Badge variant="outline">
                {meetingState}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {interview && (
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {interview.candidate?.firstName} {interview.candidate?.lastName}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {interview.scheduledAt ? new Date(interview.scheduledAt).toLocaleDateString() : 'Date TBD'}
              </span>
            </div>
          )}
          {lastChecked && (
            <div className="text-xs text-muted-foreground mt-1">
              Last updated: {new Date(lastChecked).toLocaleTimeString()}
            </div>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Status messages */}
        {!isTranscriptReady && notetakerStatus !== 'failed' && (
          <Alert className="mb-4">
            <AlertDescription className="flex items-center gap-2">
              {notetakerStatus === 'scheduled' && (
                <>
                  <Clock className="h-4 w-4" />
                  Waiting for meeting to start...
                </>
              )}
              {(notetakerStatus === 'joining' || notetakerStatus === 'joined') && (
                <>
                  <Radio className="h-4 w-4 animate-pulse" />
                  Bot is joining the meeting...
                </>
              )}
              {notetakerStatus === 'recording' && (
                <>
                  <Mic className="h-4 w-4 text-red-500 animate-pulse" />
                  Recording in progress...
                </>
              )}
              {notetakerStatus === 'processing' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing transcript...
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Progress indicator for recording */}
        {notetakerStatus === 'recording' && interview && (
          <div className="mb-4 space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Recording Progress</span>
              <span>{interview.duration || 60} min interview</span>
            </div>
            <Progress value={50} className="w-full" />
          </div>
        )}

        {/* Transcript content */}
        {transcript ? (
          <ScrollArea className="h-[400px] w-full rounded-md border p-4" ref={scrollAreaRef}>
            <div className="space-y-3">
              {parsedTranscript.map((line, index) => (
                <div key={index} className="space-y-1">
                  {line.timestamp && (
                    <span className="text-xs text-muted-foreground">[{line.timestamp}]</span>
                  )}
                  {line.speaker && (
                    <div className="font-medium text-sm text-primary">{line.speaker}</div>
                  )}
                  <div className={`text-sm ${line.speaker ? 'ml-4' : ''}`}>
                    {line.text}
                  </div>
                </div>
              ))}
              {isPolling && !isTranscriptReady && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm italic">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for more content...
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
            <FileText className="h-12 w-12 mb-4" />
            <p className="text-sm">No transcript available yet</p>
            {estimatedTime && (
              <p className="text-xs mt-2">
                Expected around {new Date(estimatedTime).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4">
          <Button
            onClick={handleRefresh}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {transcript && (
            <Button
              onClick={handleDownload}
              variant="outline"
              size="sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          )}
          {isPolling && (
            <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
              <Radio className="h-3 w-3 animate-pulse" />
              Live updates enabled
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
} 