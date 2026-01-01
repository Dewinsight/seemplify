"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Clock, Users, ChevronLeft, ChevronRight, UserPlus, Loader2, GripVertical } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Badge } from '../badge';
import { Card, CardContent } from '../card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Textarea } from '../textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { ScrollArea } from '../scroll-area';
import { InterviewSchedulerData, MultiCandidateSlot } from '../multi-step-interview-scheduler';
import { toast } from 'sonner';
import { getJobInterviewCandidates, getAllJobs } from '@/services/jobService';

interface MultiCandidateSlotsStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onNavigateToShortlist?: () => void;
}

export function MultiCandidateSlotsStep({ data, updateData, onNext, onPrevious, onNavigateToShortlist }: MultiCandidateSlotsStepProps) {
  const [slots, setSlots] = useState<MultiCandidateSlot[]>(data.multiCandidateSlots || []);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'shortlist'>('pipeline');
  
  // Candidates data
  const [allCandidates, setAllCandidates] = useState<any[]>([]);
  const [systemJobs, setSystemJobs] = useState<any[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [selectedJobId, setSelectedJobId] = useState(data.jobId || 'all');
  const [candidateSearchTerm, setCandidateSearchTerm] = useState('');
  
  // Separate pipeline and shortlist candidates
  const pipelineCandidates = allCandidates.filter(c => c.source === 'pipeline');
  const shortlistCandidates = allCandidates.filter(c => c.source === 'shortlist');

  useEffect(() => {
    loadSystemData();
  }, []);

  const loadSystemData = async () => {
    setLoadingCandidates(true);
    try {
      // If we have a specific jobId from the parent component, load only those candidates
      if (data.jobId && data.jobId !== 'all') {
        const candidatesData = await getJobInterviewCandidates(data.jobId);
        setAllCandidates(candidatesData || []);
        // No need to load all jobs if we're job-specific
        setSystemJobs([]);
      } else {
        // Load all jobs for job selection
        const jobsData = await getAllJobs();
        setSystemJobs(jobsData || []);
        setAllCandidates([]);
      }
    } catch (error) {
      console.error('Error loading system data:', error);
    } finally {
      setLoadingCandidates(false);
    }
  };

  // Load candidates when job selection changes
  useEffect(() => {
    if (selectedJobId && selectedJobId !== 'all') {
      loadJobCandidates(selectedJobId);
    }
  }, [selectedJobId]);

  const loadJobCandidates = async (jobId: string) => {
    setLoadingCandidates(true);
    try {
      const candidatesData = await getJobInterviewCandidates(jobId);
      setAllCandidates(candidatesData || []);
    } catch (error) {
      console.error('Error loading job candidates:', error);
      toast.error('Failed to load candidates for this job');
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleAddSystemCandidates = () => {
    if (selectedCandidateIds.size === 0) {
      toast.error('Please select at least one candidate');
      return;
    }

    const newSlots: MultiCandidateSlot[] = [];
    selectedCandidateIds.forEach(candidateId => {
      const candidate = allCandidates.find((c: any) => c._id === candidateId);
      if (candidate) {
        const job = systemJobs.find(j => j._id === (selectedJobId || candidate.jobAppliedFor));
        // Use jobId from context if available, otherwise use the job found
        const finalJobId = data.jobId || job?._id || candidate.jobAppliedFor;
        const finalJobTitle = job?.title || data.jobTitle || 'Position';
        
        newSlots.push({
          id: `slot-${Date.now()}-${candidateId}`,
          candidateId: candidate._id,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          candidateEmail: candidate.email,
          jobId: finalJobId,
          jobTitle: finalJobTitle,
          stageId: data.stageId, // Add stageId from context
          duration: 60,
          notes: '',
          order: slots.length + newSlots.length,
          startTime: '',
          endTime: ''
        });
      }
    });

    setSlots([...slots, ...newSlots]);
    setSelectedCandidateIds(new Set());
    setShowAddDialog(false);
  };

  const handleRemoveSlot = (slotId: string) => {
    setSlots(slots.filter(slot => slot.id !== slotId));
  };

  const handleUpdateSlotDuration = (slotId: string, duration: number) => {
    setSlots(slots.map(slot => 
      slot.id === slotId ? { ...slot, duration } : slot
    ));
  };

  const handleUpdateSlotNotes = (slotId: string, notes: string) => {
    setSlots(slots.map(slot => 
      slot.id === slotId ? { ...slot, notes } : slot
    ));
  };

  const moveSlot = (index: number, direction: 'up' | 'down') => {
    const newSlots = [...slots];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex >= 0 && newIndex < slots.length) {
      [newSlots[index], newSlots[newIndex]] = [newSlots[newIndex], newSlots[index]];
      // Update order
      newSlots.forEach((slot, i) => {
        slot.order = i;
      });
      setSlots(newSlots);
    }
  };

  const calculateSlotTimes = () => {
    if (!data.startTime) return slots;
    
    // Ensure we're working with a proper Date object from the ISO string
    let currentTime = new Date(data.startTime);
    return slots.map((slot, index) => {
      const slotStartTime = new Date(currentTime);
      const slotEndTime = new Date(currentTime.getTime() + slot.duration * 60000);
      currentTime = slotEndTime;
      
      return {
        ...slot,
        startTime: slotStartTime.toISOString(),
        endTime: slotEndTime.toISOString()
      };
    });
  };

  const getTotalDuration = () => {
    return slots.reduce((sum, slot) => sum + slot.duration, 0);
  };

  const handleContinue = () => {
    if (slots.length < 2) {
      toast.error('Please add at least 2 candidates for a multi-candidate interview');
      return;
    }

    const slotsWithTimes = calculateSlotTimes();
    const totalDuration = getTotalDuration();
    const endTime = data.startTime ? 
      new Date(new Date(data.startTime).getTime() + totalDuration * 60000).toISOString() : '';

    updateData({
      multiCandidateSlots: slotsWithTimes,
      endTime,
      duration: totalDuration
    });

    onNext();
  };

  // Filter candidates based on active tab and search
  const getFilteredCandidatesForTab = (source: 'pipeline' | 'shortlist') => {
    return allCandidates.filter(candidate => {
      const matchesSource = candidate.source === source;
      const matchesSearch = candidateSearchTerm === '' || 
        `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(candidateSearchTerm.toLowerCase()) ||
        candidate.email.toLowerCase().includes(candidateSearchTerm.toLowerCase());
      
      // Exclude already added candidates
      const notAlreadyAdded = !slots.some(slot => slot.candidateId === candidate._id);
      
      return matchesSource && matchesSearch && notAlreadyAdded;
    });
  };
  
  const filteredPipelineCandidates = getFilteredCandidatesForTab('pipeline');
  const filteredShortlistCandidates = getFilteredCandidatesForTab('shortlist');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Add Candidates</h3>
        <p className="text-sm text-muted-foreground">
          Add candidates to your multi-candidate interview session. Each candidate will have their own time slot.
        </p>
      </div>

      {/* Current slots */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h4 className="font-medium">Interview Slots ({slots.length})</h4>
          <div className="text-sm text-muted-foreground">
            Total duration: {getTotalDuration()} minutes
          </div>
        </div>

        {slots.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No candidates added yet</p>
              <p className="text-sm mt-2">Add at least 2 candidates to continue</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {calculateSlotTimes().map((slot, index) => (
              <Card key={slot.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveSlot(index, 'up')}
                        disabled={index === 0}
                        className="h-6 w-6 p-0"
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveSlot(index, 'down')}
                        disabled={index === slots.length - 1}
                        className="h-6 w-6 p-0"
                      >
                        ↓
                      </Button>
                    </div>
                    
                    <div className="flex-1 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h5 className="font-medium">{slot.candidateName}</h5>
                          <p className="text-sm text-muted-foreground">{slot.candidateEmail}</p>
                          {slot.jobTitle && (
                            <Badge variant="outline" className="mt-1">{slot.jobTitle}</Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveSlot(slot.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs">Duration</Label>
                          <Select
                            value={slot.duration.toString()}
                            onValueChange={(value) => handleUpdateSlotDuration(slot.id, parseInt(value))}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="15">15 minutes</SelectItem>
                              <SelectItem value="30">30 minutes</SelectItem>
                              <SelectItem value="45">45 minutes</SelectItem>
                              <SelectItem value="60">60 minutes</SelectItem>
                              <SelectItem value="90">90 minutes</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label className="text-xs">Start Time</Label>
                          <div className="flex items-center text-sm text-muted-foreground h-8">
                            <Clock className="h-3 w-3 mr-1" />
                            {slot.startTime ? new Date(slot.startTime).toLocaleTimeString() : 'TBD'}
                          </div>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Notes (Optional)</Label>
                        <Textarea
                          placeholder="Add notes for this candidate"
                          value={slot.notes || ''}
                          onChange={(e) => handleUpdateSlotNotes(slot.id, e.target.value)}
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Button onClick={() => setShowAddDialog(true)} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Add Candidate
        </Button>
      </div>

      {/* Add Candidate Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Candidates</DialogTitle>
            <DialogDescription>
              Select candidates from the job pipeline or shortlist
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipeline' | 'shortlist')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pipeline">From Pipeline</TabsTrigger>
              <TabsTrigger value="shortlist">From Shortlist</TabsTrigger>
            </TabsList>

            <TabsContent value="pipeline" className="space-y-4 mt-4">
              {loadingCandidates ? (
                <div className="py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                  <p className="mt-2 text-muted-foreground">Loading candidates...</p>
                </div>
              ) : (
                <>
                  {data.jobId && data.jobId !== 'all' ? (
                    <>
                      <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                        <p className="text-sm text-emerald-800 dark:text-emerald-200">
                          Showing pipeline candidates for this job
                        </p>
                      </div>
                      <div>
                        <Label>Search</Label>
                        <Input
                          placeholder="Search by name or email"
                          value={candidateSearchTerm}
                          onChange={(e) => setCandidateSearchTerm(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Select Job</Label>
                        <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a job" />
                          </SelectTrigger>
                          <SelectContent>
                            {systemJobs.map(job => (
                              <SelectItem key={job._id} value={job._id}>
                                {job.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Search</Label>
                        <Input
                          placeholder="Search by name or email"
                          value={candidateSearchTerm}
                          onChange={(e) => setCandidateSearchTerm(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    {filteredPipelineCandidates.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No pipeline candidates found
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {filteredPipelineCandidates.map(candidate => {
                          const job = systemJobs.find(j => j._id === candidate.jobAppliedFor);
                          return (
                            <label
                              key={candidate._id}
                              className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCandidateIds.has(candidate._id)}
                                onChange={(e) => {
                                  const newIds = new Set(selectedCandidateIds);
                                  if (e.target.checked) {
                                    newIds.add(candidate._id);
                                  } else {
                                    newIds.delete(candidate._id);
                                  }
                                  setSelectedCandidateIds(newIds);
                                }}
                                className="rounded"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">
                                    {candidate.firstName} {candidate.lastName}
                                  </p>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {candidate.email}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  {candidate.position && (
                                    <Badge variant="outline" className="text-xs">
                                      {candidate.position}
                                    </Badge>
                                  )}
                                  {job && (
                                    <Badge variant="outline" className="text-xs">
                                      {job.title}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Helpful message for pipeline tab */}
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                      Don't see the candidate you want? Add them to the shortlist first.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddDialog(false);
                        if (onNavigateToShortlist) {
                          setTimeout(() => {
                            onNavigateToShortlist();
                          }, 100);
                        }
                      }}
                      className="text-xs"
                    >
                      Go to Job Shortlist
                    </Button>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {selectedCandidateIds.size} candidate(s) selected
                    </span>
                    <Button
                      onClick={handleAddSystemCandidates}
                      disabled={selectedCandidateIds.size === 0}
                    >
                      Add Selected Candidates
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="shortlist" className="space-y-4 mt-4">
              {loadingCandidates ? (
                <div className="py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                  <p className="mt-2 text-muted-foreground">Loading candidates...</p>
                </div>
              ) : (
                <>
                  {data.jobId && data.jobId !== 'all' ? (
                    <>
                      <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                        <p className="text-sm text-purple-800 dark:text-purple-200">
                          Showing shortlisted candidates for this job
                        </p>
                      </div>
                      <div>
                        <Label>Search</Label>
                        <Input
                          placeholder="Search by name or email"
                          value={candidateSearchTerm}
                          onChange={(e) => setCandidateSearchTerm(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Select Job</Label>
                        <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a job" />
                          </SelectTrigger>
                          <SelectContent>
                            {systemJobs.map(job => (
                              <SelectItem key={job._id} value={job._id}>
                                {job.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Search</Label>
                        <Input
                          placeholder="Search by name or email"
                          value={candidateSearchTerm}
                          onChange={(e) => setCandidateSearchTerm(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <ScrollArea className="h-[300px] border rounded-lg p-4">
                    {filteredShortlistCandidates.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No shortlisted candidates found
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {filteredShortlistCandidates.map(candidate => {
                          const job = systemJobs.find(j => j._id === candidate.jobAppliedFor);
                          return (
                            <label
                              key={candidate._id}
                              className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCandidateIds.has(candidate._id)}
                                onChange={(e) => {
                                  const newIds = new Set(selectedCandidateIds);
                                  if (e.target.checked) {
                                    newIds.add(candidate._id);
                                  } else {
                                    newIds.delete(candidate._id);
                                  }
                                  setSelectedCandidateIds(newIds);
                                }}
                                className="rounded"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">
                                    {candidate.firstName} {candidate.lastName}
                                  </p>
                                  {candidate.relevanceScore && (
                                    <Badge variant="secondary" className="text-xs">
                                      {Math.round(candidate.relevanceScore * 100)}% Match
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {candidate.email}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  {candidate.position && (
                                    <Badge variant="outline" className="text-xs">
                                      {candidate.position}
                                    </Badge>
                                  )}
                                  {job && (
                                    <Badge variant="outline" className="text-xs">
                                      {job.title}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Helpful message for shortlist tab */}
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                      Don't see the candidate you want? Add them to the shortlist first.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddDialog(false);
                        if (onNavigateToShortlist) {
                          setTimeout(() => {
                            onNavigateToShortlist();
                          }, 100);
                        }
                      }}
                      className="text-xs"
                    >
                      Go to Job Shortlist
                    </Button>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {selectedCandidateIds.size} candidate(s) selected
                    </span>
                    <Button
                      onClick={handleAddSystemCandidates}
                      disabled={selectedCandidateIds.size === 0}
                    >
                      Add Selected Candidates
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button 
          onClick={handleContinue}
          disabled={slots.length < 2}
        >
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
