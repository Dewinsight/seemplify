"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { ScrollArea } from './scroll-area';
import { Separator } from './separator';
import { FileText, Download, Users, Clock, Search, MessageSquare, Hash, Calendar, Copy, CheckCircle, UserCheck, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { Input } from './input';
import { Switch } from './switch';
import { Label } from './label';
import { toast } from 'sonner';
import { InterviewSummary } from './interview-summary';
import { interviewService } from '@/services/interviewService';

interface TranscriptViewerProps {
  transcript: {
    content: string;
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    participants: Array<{
      name: string;
      email: string;
      speakingTime: number;
    }>;
    duration: number;
    confidence: number;
  };
  notetakerStatus: string;
  transcriptAvailableAt: string;
  recordingUrl?: string;
  aiSummary?: {
    generated: boolean;
    generatedAt: string;
    content: string;
    keyInsights: string[];
    candidateStrengths: string[];
    candidateConcerns: string[];
    recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
    confidence: number;
    methodology: string;
  };
  onGenerateSummary?: (summary: any) => void;
  interviewId?: string;
  // Multi-candidate interview support
  isMultiCandidate?: boolean;
  candidateName?: string;
  candidateEmail?: string;
  sessionId?: string;
  overflow?: {
    segments: any[];
    duration: number;
  };
  fullSession?: any;
  viewMode?: 'candidate_segment' | 'full_session';
  onViewModeChange?: (mode: 'candidate_segment' | 'full_session') => void;
}

interface TranscriptSegment {
  speaker?: string;
  text: string;
  timestamp?: string;
  confidence?: number;
}

export function TranscriptViewer({ 
  transcript, 
  notetakerStatus, 
  transcriptAvailableAt, 
  recordingUrl,
  aiSummary,
  onGenerateSummary,
  interviewId,
  isMultiCandidate = false,
  candidateName,
  candidateEmail,
  sessionId,
  overflow,
  fullSession,
  viewMode = 'candidate_segment',
  onViewModeChange
}: TranscriptViewerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [localViewMode, setLocalViewMode] = useState(viewMode);
  const [segmentedTranscript, setSegmentedTranscript] = useState<any>(null);
  const [sessionTranscript, setSessionTranscript] = useState<any>(null);
  const [loadingSegmented, setLoadingSegmented] = useState(false);
  const [multiCandidateAnalysis, setMultiCandidateAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  const formatDuration = (seconds: number) => {
    // Handle invalid values
    if (!seconds || isNaN(seconds) || seconds < 0) {
      return '0:00';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatSpeakingTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  // Load segmented transcript for multi-candidate interviews
  useEffect(() => {
    if (isMultiCandidate && interviewId && localViewMode === 'candidate_segment') {
      loadSegmentedTranscript();
    }
  }, [isMultiCandidate, interviewId, localViewMode]);

  // Load session transcript when switching to full session view
  useEffect(() => {
    if (isMultiCandidate && sessionId && localViewMode === 'full_session') {
      loadSessionTranscript();
    }
  }, [isMultiCandidate, sessionId, localViewMode]);

  const loadSegmentedTranscript = async () => {
    if (!interviewId) return;
    
    try {
      setLoadingSegmented(true);
      const response = await interviewService.getSegmentedTranscript(interviewId, true);
      
      if (response.success) {
        setSegmentedTranscript(response.data);
      }
    } catch (error) {
      console.error('Error loading segmented transcript:', error);
      toast.error('Failed to load candidate-specific transcript');
    } finally {
      setLoadingSegmented(false);
    }
  };

  const loadSessionTranscript = async () => {
    if (!sessionId) return;
    
    try {
      setLoadingSegmented(true);
      const response = await interviewService.getSessionTranscript(sessionId);
      
      if (response.success) {
        setSessionTranscript(response);
      }
    } catch (error) {
      console.error('Error loading session transcript:', error);
      toast.error('Failed to load full session transcript');
    } finally {
      setLoadingSegmented(false);
    }
  };

  const loadMultiCandidateAnalysis = async () => {
    if (!sessionId) return;
    
    try {
      setLoadingAnalysis(true);
      const response = await interviewService.getMultiCandidateAnalysis(sessionId);
      
      if (response.success) {
        setMultiCandidateAnalysis(response);
      }
    } catch (error) {
      console.error('Error loading multi-candidate analysis:', error);
      toast.error('Failed to load comparative analysis');
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const triggerMultiCandidateAnalysis = async () => {
    if (!sessionId) return;
    
    try {
      setLoadingAnalysis(true);
      toast.info('Starting comparative analysis...');
      
      const response = await interviewService.analyzeMultiCandidateSession(sessionId);
      
      if (response.success) {
        setMultiCandidateAnalysis(response);
        toast.success('Comparative analysis completed!');
      }
    } catch (error) {
      console.error('Error triggering multi-candidate analysis:', error);
      toast.error('Failed to generate comparative analysis');
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleViewModeChange = (mode: 'candidate_segment' | 'full_session') => {
    setLocalViewMode(mode);
    if (onViewModeChange) {
      onViewModeChange(mode);
    }
  };

  // Parse transcript content - handle both JSON and plain text
  const parsedTranscript = useMemo(() => {
    // For multi-candidate interviews, use segmented data if available
    if (isMultiCandidate && localViewMode === 'candidate_segment' && segmentedTranscript) {
      try {
        const content = segmentedTranscript.transcript?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            return parsed as TranscriptSegment[];
          }
        }
      } catch (e) {
        console.warn('Failed to parse segmented transcript:', e);
      }
    }
    
    // For full session view, use session transcript data
    if (isMultiCandidate && localViewMode === 'full_session' && sessionTranscript) {
      try {
        // Combine all segments from all candidates
        const allSegments: TranscriptSegment[] = [];
        
        if (sessionTranscript.segments) {
          Object.values(sessionTranscript.segments).forEach((candidateSegments: any) => {
            if (candidateSegments.transcript && Array.isArray(candidateSegments.transcript)) {
              candidateSegments.transcript.forEach((segment: any) => {
                allSegments.push({
                  text: segment.text,
                  speaker: segment.speaker || candidateSegments.candidateName,
                  timestamp: segment.timestamp
                });
              });
            }
          });
        }
        
        // Sort by timestamp if available
        allSegments.sort((a, b) => {
          const timeA = parseTimestamp(a.timestamp || '0:00');
          const timeB = parseTimestamp(b.timestamp || '0:00');
          return timeA - timeB;
        });
        
        return allSegments;
      } catch (e) {
        console.warn('Failed to parse session transcript:', e);
      }
    }
    
    // Fallback to original transcript parsing
    if (!transcript.content) return [];
    
    try {
      // Try to parse as JSON first (structured transcript)
      const parsed = JSON.parse(transcript.content);
      if (Array.isArray(parsed)) {
        return parsed as TranscriptSegment[];
      } else if (parsed.segments && Array.isArray(parsed.segments)) {
        return parsed.segments as TranscriptSegment[];
      } else if (parsed.transcript && Array.isArray(parsed.transcript)) {
        return parsed.transcript as TranscriptSegment[];
      }
    } catch (e) {
      // If JSON parsing fails, treat as plain text and try to segment it
      const lines = transcript.content.split('\n').filter(line => line.trim());
      return lines.map((line, index) => ({
        text: line.trim(),
        speaker: extractSpeakerFromLine(line),
        timestamp: `${Math.floor(index * 30)}s` // Approximate timestamps
      }));
    }
    
    return [{
      text: transcript.content,
      speaker: 'Unknown',
      timestamp: '0:00'
    }];
  }, [transcript.content, isMultiCandidate, localViewMode, segmentedTranscript, sessionTranscript]);

  // Helper function to extract speaker from a line like "John Doe: Hello there"
  const extractSpeakerFromLine = (line: string): string => {
    const speakerMatch = line.match(/^([A-Za-z\s]+):\s*/);
    return speakerMatch ? speakerMatch[1].trim() : 'Speaker';
  };

  // Helper function to parse timestamp strings to seconds
  const parseTimestamp = (timestamp: string): number => {
    const match = timestamp.match(/(\d+):(\d+)(?::(\d+))?/);
    if (match) {
      const hours = parseInt(match[1]) || 0;
      const minutes = parseInt(match[2]) || 0;
      const seconds = parseInt(match[3]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
  };

  // Filter transcript based on search term
  const filteredTranscript = useMemo(() => {
    if (!searchTerm) return parsedTranscript;
    return parsedTranscript.filter(segment => 
      segment.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (segment.speaker && segment.speaker.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [parsedTranscript, searchTerm]);

  // Get unique speakers
  const speakers = useMemo(() => {
    const speakerSet = new Set<string>();
    parsedTranscript.forEach(segment => {
      if (segment.speaker) speakerSet.add(segment.speaker);
    });
    return Array.from(speakerSet);
  }, [parsedTranscript]);

  // Copy transcript to clipboard
  const copyTranscript = async () => {
    try {
      const textToCopy = parsedTranscript
        .map(segment => `${segment.speaker || 'Speaker'}: ${segment.text}`)
        .join('\n\n');
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("Transcript copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy transcript");
    }
  };

  // Get speaker color
  const getSpeakerColor = (speaker: string) => {
    const colors = [
      'bg-blue-100 text-blue-800 border-blue-200',
      'bg-green-100 text-green-800 border-green-200',
      'bg-purple-100 text-purple-800 border-purple-200',
      'bg-orange-100 text-orange-800 border-orange-200',
      'bg-pink-100 text-pink-800 border-pink-200',
      'bg-indigo-100 text-indigo-800 border-indigo-200',
    ];
    const index = speakers.indexOf(speaker) % colors.length;
    return colors[index];
  };

  return (
    <div className="space-y-6">
      {/* Multi-Candidate Interview Controls */}
      {isMultiCandidate && (
        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200 mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-purple-900">
                  <Users className="h-5 w-5" />
                  Multi-Candidate Interview Session
                </CardTitle>
                <CardDescription className="text-purple-700">
                  {candidateName && (
                    <div className="flex items-center gap-2 mt-1">
                      <UserCheck className="h-4 w-4" />
                      <span>Current View: {candidateName}</span>
                      {candidateEmail && <span className="text-xs">({candidateEmail})</span>}
                    </div>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="view-toggle" className="text-sm">
                    View Full Session
                  </Label>
                  <Switch
                    id="view-toggle"
                    checked={localViewMode === 'full_session'}
                    onCheckedChange={(checked) => {
                      const newMode = checked ? 'full_session' : 'candidate_segment';
                      handleViewModeChange(newMode);
                    }}
                  />
                </div>
                {/* Show overflow button based on segmented data or props */}
                {localViewMode === 'candidate_segment' && (
                  (segmentedTranscript?.transcript?.hasOverflow || (overflow && overflow.segments.length > 0)) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowOverflow(!showOverflow)}
                      className="text-purple-700 border-purple-300 hover:bg-purple-100"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      {showOverflow ? 'Hide' : 'Show'} Overflow 
                      {segmentedTranscript?.overflow?.segments?.length && (
                        <> ({segmentedTranscript.overflow.segments.length} segments)</>
                      )}
                      {overflow?.segments?.length && (
                        <> ({overflow.segments.length} segments)</>
                      )}
                    </Button>
                  )
                )}
                
                {/* Comparative Analysis Button */}
                {sessionId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadingAnalysis ? undefined : triggerMultiCandidateAnalysis}
                    disabled={loadingAnalysis}
                    className="text-purple-700 border-purple-300 hover:bg-purple-100"
                  >
                    {loadingAnalysis ? (
                      <>
                        <Clock className="h-4 w-4 mr-1 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Compare
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Status Header */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <FileText className="h-5 w-5" />
                Meeting Transcript & Recording
              </CardTitle>
              <CardDescription className="text-blue-700">
                <Calendar className="h-4 w-4 inline mr-1" />
                Available since {new Date(transcriptAvailableAt).toLocaleString()}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={notetakerStatus === 'completed' ? 'default' : 'secondary'} className="px-3 py-1">
                {notetakerStatus}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={copyTranscript}
                className="hover:bg-blue-100"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? 'Copied!' : 'Copy Transcript'}
              </Button>
              {recordingUrl && (
                <Button variant="outline" size="sm" asChild className="hover:bg-blue-100">
                  <a href={recordingUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4 mr-2" />
                    Download Recording
                  </a>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Meeting Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Duration</p>
                <p className="text-2xl font-bold text-gray-900">{formatDuration(transcript.duration)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Participants</p>
                <p className="text-2xl font-bold text-gray-900">{speakers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <MessageSquare className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Segments</p>
                <p className="text-2xl font-bold text-gray-900">{parsedTranscript.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Hash className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Confidence</p>
                <p className="text-2xl font-bold text-gray-900">
                  {transcript.confidence && !isNaN(transcript.confidence) 
                    ? `${Math.round(transcript.confidence * 100)}%` 
                    : '95%'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className={`grid w-full ${isMultiCandidate && sessionId ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="participants">Participants</TabsTrigger>
          {isMultiCandidate && sessionId && (
            <TabsTrigger value="comparison">Compare</TabsTrigger>
          )}
        </TabsList>

        {/* Transcript Tab */}
        <TabsContent value="transcript" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Conversation Transcript</CardTitle>
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground/70" />
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
                    filteredTranscript.map((segment, index) => (
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
                            <p className="text-gray-900 leading-relaxed">
                              {searchTerm ? (
                                segment.text.split(new RegExp(`(${searchTerm})`, 'gi')).map((part, i) =>
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
        </TabsContent>

        {/* Summary Tab */}
        <TabsContent value="summary" className="space-y-4">
          {interviewId ? (
            <InterviewSummary 
              interviewId={interviewId}
              summary={aiSummary} 
              hasTranscript={!!transcript?.content}
              onSummaryGenerated={onGenerateSummary} 
            />
          ) : (
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="h-8 w-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">AI Interview Summary</h3>
                <p className="text-muted-foreground mb-4">
                  The AI Interview Summary will appear here once generated from the transcript.
                </p>
                <p className="text-sm text-muted-foreground">
                  Interview ID is required to generate the summary.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Speaking Time Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {transcript.participants && transcript.participants.length > 0 ? (
                    transcript.participants.map((participant, index) => {
                      const percentage = transcript.duration > 0 ? (participant.speakingTime / transcript.duration) * 100 : 0;
                      return (
                        <div key={index} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{participant.name}</span>
                            <span className="text-sm text-muted-foreground">{formatSpeakingTime(participant.speakingTime)}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">{percentage.toFixed(1)}% of total time</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No participant data available.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Transcript Quality</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Confidence Score</span>
                    <Badge variant="outline" className="text-sm">
                      {Math.round(transcript.confidence * 100)}%
                    </Badge>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        transcript.confidence > 0.8 ? 'bg-green-600' : 
                        transcript.confidence > 0.6 ? 'bg-yellow-600' : 'bg-red-600'
                      }`}
                      style={{ width: `${transcript.confidence * 100}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4">
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-gray-900">{parsedTranscript.length}</p>
                      <p className="text-sm text-muted-foreground">Total Segments</p>
                    </div>
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-gray-900">{speakers.length}</p>
                      <p className="text-sm text-muted-foreground">Speakers Detected</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Participants Tab */}
        <TabsContent value="participants" className="space-y-4">
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
                  transcript.participants.map((participant, index) => (
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
                          <div className="w-full bg-gray-200 rounded-full h-1">
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
                  speakers.map((speaker, index) => (
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
        </TabsContent>

        {/* Comparative Analysis Tab */}
        {isMultiCandidate && sessionId && (
          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Comparative Analysis
                </CardTitle>
                <CardDescription>
                  AI-powered comparison of all candidates in this interview session
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!multiCandidateAnalysis && !loadingAnalysis && (
                  <div className="text-center py-8">
                    <MessageSquare className="h-12 w-12 text-muted-foreground/70 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      No Comparative Analysis Available
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      Generate an AI-powered comparative analysis to see how all candidates performed.
                    </p>
                    <Button 
                      onClick={triggerMultiCandidateAnalysis}
                      disabled={loadingAnalysis}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {loadingAnalysis ? (
                        <>
                          <Clock className="h-4 w-4 mr-2 animate-spin" />
                          Generating Analysis...
                        </>
                      ) : (
                        <>
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Generate Comparative Analysis
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {loadingAnalysis && (
                  <div className="text-center py-8">
                    <Clock className="h-8 w-8 text-purple-600 mx-auto mb-4 animate-spin" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Analyzing Interview Session...
                    </h3>
                    <p className="text-muted-foreground">
                      Our AI is comparing all candidates' performances. This may take a few moments.
                    </p>
                  </div>
                )}

                {multiCandidateAnalysis && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {multiCandidateAnalysis.interviews?.map((interview: any) => (
                        <Card key={interview.interviewId} className="border-l-4 border-l-purple-500">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <UserCheck className="h-4 w-4" />
                              {interview.candidateName}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {interview.candidateEmail}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            {interview.hasAnalysis ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">Overall Score</span>
                                  <Badge variant="secondary">
                                    {interview.analysis?.overallScore || 'N/A'}%
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {interview.analysis?.summary?.substring(0, 100)}...
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4">
                                <Clock className="h-6 w-6 text-muted-foreground/70 mx-auto mb-2" />
                                <p className="text-xs text-muted-foreground">
                                  Analysis pending
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {multiCandidateAnalysis.hasComparativeAnalysis && (
                      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
                        <CardHeader>
                          <CardTitle className="text-lg text-purple-900">
                            🏆 Session Summary
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <h4 className="font-medium text-purple-900 mb-2">Top Performers</h4>
                                <div className="space-y-1">
                                  {multiCandidateAnalysis.interviews
                                    ?.filter((i: any) => i.hasAnalysis)
                                    .sort((a: any, b: any) => (b.analysis?.overallScore || 0) - (a.analysis?.overallScore || 0))
                                    .slice(0, 3)
                                    .map((interview: any, index: number) => (
                                      <div key={interview.interviewId} className="flex items-center gap-2 text-sm">
                                        <span className="text-purple-600 font-medium">#{index + 1}</span>
                                        <span>{interview.candidateName}</span>
                                        <Badge variant="outline" className="text-xs">
                                          {interview.analysis?.overallScore}%
                                        </Badge>
                                      </div>
                                    ))}
                                </div>
                              </div>
                              
                              <div>
                                <h4 className="font-medium text-purple-900 mb-2">Key Insights</h4>
                                <div className="text-sm text-purple-800">
                                  <p>• {multiCandidateAnalysis.interviews?.length || 0} candidates evaluated</p>
                                  <p>• Session completed successfully</p>
                                  <p>• Comparative analysis available</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
} 