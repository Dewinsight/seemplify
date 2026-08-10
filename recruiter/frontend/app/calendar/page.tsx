"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Video, Phone, MapPin, Users, Plus, Settings, RefreshCw, Eye, X, AlertTriangle, FileText, Loader2, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import interviewService, { Interview } from '@/services/interviewService';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';
import { useSearchParams } from 'next/navigation';

interface CalendarPageProps {}

export default function CalendarPage({}: CalendarPageProps) {
  const { state, login } = useUser();
  const searchParams = useSearchParams();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState<Interview | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    provider?: string;
    status?: string;
    verified?: boolean;
    error?: string;
  }>({
    connected: false,
    provider: '',
    status: '',
    verified: false,
    error: ''
  });
  
  // Manual notetaker state
  const [showNotetakerDialog, setShowNotetakerDialog] = useState(false);
  const [meetingLink, setMeetingLink] = useState('');
  const [enablingNotetaker, setEnablingNotetaker] = useState(false);
  const [joiningMeeting, setJoiningMeeting] = useState(false);

  // Handle OAuth callback parameters
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    const message = searchParams.get('message');
    const token = searchParams.get('token');

    if (connected === 'true') {
      // Handle successful calendar connection
      if (token) {
        // Update authentication state using UserContext login method
        try {
          const decodedToken = decodeURIComponent(token);
          console.log('JWT token received from OAuth callback, updating authentication state');
          
          // Use the UserContext login method to properly update all authentication state
          login(decodedToken).then(() => {
            console.log('✅ Authentication state updated successfully');
            toast.success('Calendar connected successfully!');
            // Add a small delay to ensure authentication state is fully propagated
            setTimeout(() => {
              console.log('🔄 Reloading calendar status after authentication update...');
              checkCalendarStatus();
            }, 500);
          }).catch((error) => {
            console.error('❌ Failed to update authentication state:', error);
            toast.error('Authentication update failed');
          });
          
        } catch (err) {
          console.error('Failed to process JWT token:', err);
          toast.error('Failed to process authentication token');
        }
      } else {
        toast.success('Calendar connected successfully!');
        // Reload calendar status
        if (state.user?._id) {
          checkCalendarStatus();
        }
      }
    } else if (error) {
      // Handle OAuth errors
      const errorMessage = message ? decodeURIComponent(message) : 'Calendar connection failed';
      toast.error(errorMessage);
      console.error('OAuth callback error:', error, errorMessage);
    }

    // Clean up URL parameters
    if (connected || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('error');
      url.searchParams.delete('message');
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams, state.user?._id]);

  useEffect(() => {
    // Only load data when user is available
    if (state.user?._id) {
      loadData();
    }
  }, [state.user?._id]);
  
  // Polling mechanism for active interviews with notetakers
  useEffect(() => {
    // Only run polling if there are interviews with active notetakers
    const activeInterviews = interviews.filter(interview => 
      interview.notetakerEnabled && 
      interview.status !== 'completed' &&
      interview.status !== 'cancelled' &&
      ['scheduled', 'pending', 'enabled', 'joined', 'joining', 'recording'].includes(interview.notetakerStatus || '')
    );
    
    if (activeInterviews.length === 0) return;
    
    // Initial immediate check
    activeInterviews.forEach(interview => {
      if (interview._id) {
        interviewService.checkNotetakerStatus(interview._id)
          .then(result => {
            if (result.success && result.status) {
              if (result.status !== interview.notetakerStatus) {
                console.log(`Interview ${interview._id} status changed: ${interview.notetakerStatus} → ${result.status}`);
                
                setInterviews(prevInterviews => 
                  prevInterviews.map(i => 
                    i._id === interview._id 
                      ? { ...i, notetakerStatus: result.status as Interview['notetakerStatus'] } 
                      : i
                  )
                );
                
                if (selectedInterview && selectedInterview._id === interview._id) {
                  setSelectedInterview(prev => prev ? { ...prev, notetakerStatus: result.status as Interview['notetakerStatus'] } : null);
                }
              }
            }
          })
          .catch(error => {
            console.error(`Error checking initial status for interview ${interview._id}:`, error);
          });
      }
    });
    
    // Set up polling interval (every 15 seconds for more responsive updates)
    const pollInterval = setInterval(() => {
      console.log('Polling for notetaker status updates...');
      
      // Check status for each active interview
      activeInterviews.forEach(interview => {
        if (interview._id) {
          interviewService.checkNotetakerStatus(interview._id)
            .then(result => {
              if (result.success && result.status) {
                // Update the interview in the interviews array if status changed
                if (result.status !== interview.notetakerStatus) {
                  console.log(`Interview ${interview._id} status changed: ${interview.notetakerStatus} → ${result.status}`);
                  
                  setInterviews(prevInterviews => 
                    prevInterviews.map(i => 
                      i._id === interview._id 
                        ? { ...i, notetakerStatus: result.status as Interview['notetakerStatus'] } 
                        : i
                    )
                  );
                  
                  // Also update the selected interview if it's the same one
                  if (selectedInterview && selectedInterview._id === interview._id) {
                    setSelectedInterview(prev => prev ? { ...prev, notetakerStatus: result.status as Interview['notetakerStatus'] } : null);
                  }
                }
              }
            })
            .catch(error => {
              console.error(`Error polling status for interview ${interview._id}:`, error);
            });
        }
      });
    }, 15000); // Poll every 15 seconds for faster status updates
    
    // Clean up interval on unmount
    return () => clearInterval(pollInterval);
  }, [interviews, selectedInterview]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadInterviews(),
        checkCalendarStatus()
      ]);
    } catch (error) {
      console.error('Failed to load calendar data:', error);
      toast.error('Failed to load calendar data');
    } finally {
      setLoading(false);
    }
  };

  const loadInterviews = async () => {
    try {
      // Load interviews from 30 days ago to 30 days in the future to include completed interviews
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // Next 30 days
      
      const data = await interviewService.getInterviews({
        startDate,
        endDate
      });
      setInterviews(data);
    } catch (error) {
      console.error('Failed to load interviews:', error);
    }
  };

  const checkCalendarStatus = async () => {
    try {
      if (!state.user?._id) {
        console.warn('No user ID available');
        return;
      }
      console.log('🔍 Checking calendar status for user:', state.user._id);
      console.log('📧 User email:', state.user.email);
      console.log('🔑 Full user object:', JSON.stringify(state.user, null, 2));
      
      const status = await interviewService.getCalendarStatus(state.user._id);
      console.log('📅 Calendar status response:', status);
      
      // Also log what we're setting
      console.log('🎯 Setting calendar status to:', {
        connected: status.connected,
        provider: status.provider,
        verified: status.verified
      });
      
      setCalendarStatus(status);
    } catch (error) {
      console.error('Failed to check calendar status:', error);
      // Set default status on error
      setCalendarStatus({ connected: false });
    }
  };

  const handleConnectCalendar = async () => {
    try {
      if (!state.user?._id) {
        toast.error('User not authenticated');
        return;
      }
      
      const { authUrl } = await interviewService.connectCalendar('google');
      // Redirect to OAuth URL instead of opening popup
      window.location.href = authUrl;
    } catch (error) {
      toast.error('Failed to connect calendar');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success('Calendar refreshed');
  };

  const handleViewDetails = (interview: Interview) => {
    setSelectedInterview(interview);
    setShowDetailsDialog(true);
  };

  const handleShowCancelDialog = (interview: Interview) => {
    console.log('Cancel interview:', interview._id);
    setSelectedInterview(interview);
    setShowCancelDialog(true);
  };

  const handleCancelInterview = async () => {
    if (!selectedInterview) return;
    
    setCancelling(true);
    try {
      await interviewService.cancelInterview(
        selectedInterview._id, 
        cancelReason || 'Cancelled by user',
        true
      );
      
      // Refresh interviews list
      await loadInterviews();
      
      toast.success('Interview cancelled successfully');
      setShowCancelDialog(false);
      setShowDetailsDialog(false);
      setCancelReason('');
      setSelectedInterview(null);
    } catch (error) {
      console.error('Failed to cancel interview:', error);
      toast.error('Failed to cancel interview');
    } finally {
      setCancelling(false);
    }
  };

  const openCancelDialog = (interview: Interview) => {
    setSelectedInterview(interview);
    setShowCancelDialog(true);
  };
  
  const refreshNotetakerStatus = async (interview: Interview) => {
    if (!interview._id || !interview.notetakerEnabled) return;
    
    setRefreshingStatus(true);
    try {
      const result = await interviewService.checkNotetakerStatus(interview._id);
      
      if (result.success && result.status) {
        // Update the interview in the interviews array
        setInterviews(prevInterviews => 
          prevInterviews.map(i => 
            i._id === interview._id 
              ? { ...i, notetakerStatus: result.status as Interview['notetakerStatus'] } 
              : i
          )
        );
        
        // Also update the selected interview if it's the same one
        if (selectedInterview && selectedInterview._id === interview._id) {
          setSelectedInterview(prev => prev ? { ...prev, notetakerStatus: result.status as Interview['notetakerStatus'] } : null);
        }
        
        toast.success(`Notetaker status updated: ${result.status}`);
      } else {
        toast.error('Failed to update notetaker status');
      }
    } catch (error) {
      console.error('Error refreshing notetaker status:', error);
      toast.error('Error refreshing notetaker status');
    } finally {
      setRefreshingStatus(false);
    }
  };

  // Manual notetaker functions
  const handleEnableNotetaker = async () => {
    if (!selectedInterview || !meetingLink) return;
    
    try {
      setEnablingNotetaker(true);
      const result = await interviewService.enableNotetaker(selectedInterview._id, meetingLink);
      
      if (result.success) {
        toast.success('Notetaker enabled successfully');
        // Update the interview in the list
        setInterviews(prev => prev.map(i => 
          i._id === selectedInterview._id 
            ? { ...i, notetakerEnabled: true, notetakerId: result.notetakerId, notetakerStatus: 'enabled' }
            : i
        ));
        // Update selected interview
        setSelectedInterview(prev => prev ? {
          ...prev,
          notetakerEnabled: true,
          notetakerId: result.notetakerId,
          notetakerStatus: 'enabled'
        } : null);
        setShowNotetakerDialog(false);
        setMeetingLink('');
      }
    } catch (error) {
      console.error('Failed to enable notetaker:', error);
      toast.error('Failed to enable notetaker');
    } finally {
      setEnablingNotetaker(false);
    }
  };

  const handleCancelNotetaker = async () => {
    if (!selectedInterview?.notetakerId) return;
    
    try {
      const result = await interviewService.cancelNotetaker(selectedInterview._id);
      
      if (result.success) {
        toast.success('Notetaker cancelled successfully');
        // Update the interview in the list
        setInterviews(prev => prev.map(i => 
          i._id === selectedInterview._id 
            ? { ...i, notetakerStatus: 'cancelled' }
            : i
        ));
        // Update selected interview
        setSelectedInterview(prev => prev ? {
          ...prev,
          notetakerStatus: 'cancelled'
        } : null);
      }
    } catch (error) {
      console.error('Failed to cancel notetaker:', error);
      toast.error('Failed to cancel notetaker');
    }
  };

  const handleJoinMeetingNow = async () => {
    if (!selectedInterview) return;
    
    setJoiningMeeting(true);
    try {
      const result = await interviewService.joinMeetingNow(
        selectedInterview._id,
        selectedInterview.conferencing?.details?.url
      );
      
      const nextStatus = (result.status || 'joining') as Interview['notetakerStatus'];

      toast.success(result.message || 'Nyla is joining the call');
      
      // Update the interview in the list
      setInterviews(prev => prev.map(i => 
        i._id === selectedInterview._id 
          ? { ...i, notetakerStatus: nextStatus, notetakerId: result.notetakerId }
          : i
      ));
      // Update selected interview
      setSelectedInterview(prev => prev ? {
        ...prev,
        notetakerStatus: nextStatus,
        notetakerId: result.notetakerId
      } : null);
    } catch (error: any) {
      console.error('Send Nyla to call error:', error);
      toast.error(error.message || 'Failed to send Nyla to the call');
    } finally {
      setJoiningMeeting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-gray-100 text-gray-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="h-4 w-4" />;
      case 'phone': return <Phone className="h-4 w-4" />;
      case 'in_person': return <MapPin className="h-4 w-4" />;
      default: return <Users className="h-4 w-4" />;
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  };

  const upcomingInterviews = interviews.filter(interview => 
    new Date(interview.scheduledAt) > new Date() && 
    ['scheduled', 'confirmed'].includes(interview.status)
  );

  const todayInterviews = interviews.filter(interview => {
    const today = new Date();
    const interviewDate = new Date(interview.scheduledAt);
    return interviewDate.toDateString() === today.toDateString();
  });

  const completedInterviews = interviews.filter(interview => 
    interview.status === 'completed'
  ).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()); // Sort by most recent first

  const recentInterviews = interviews.filter(interview => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return new Date(interview.scheduledAt) >= weekAgo;
  }).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  // Show loading while user context is loading
  if (state.isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  // Redirect to login if user is not authenticated
  if (!state.isAuthenticated || !state.user) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Authentication Required</h2>
          <p className="text-gray-600">Please log in to access the calendar.</p>
          <Button onClick={() => window.location.href = '/login'}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  // Show loading while calendar data is loading
  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-600">Manage your interview schedule</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleRefresh}
            variant="outline"
            size="sm"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>


      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Interviews</p>
                <p className="text-2xl font-bold">{interviews.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Today</p>
                <p className="text-2xl font-bold">{todayInterviews.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Upcoming</p>
                <p className="text-2xl font-bold">{upcomingInterviews.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-bold">{completedInterviews.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-gray-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Calendar</p>
                <p className="text-sm font-bold">
                  {calendarStatus.connected ? (
                    <span className="text-green-600">Connected</span>
                  ) : (
                    <span className="text-red-600">Not Connected</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interview Tabs */}
      <Tabs defaultValue="upcoming" className="space-y-4">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
          <TabsTrigger value="all">All Interviews</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4">
          {upcomingInterviews.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No upcoming interviews</h3>
                <p className="text-gray-600">Schedule your first interview to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {upcomingInterviews.map((interview) => (
                <InterviewCard 
                  key={interview._id} 
                  interview={interview} 
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="today" className="space-y-4">
          {todayInterviews.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No interviews today</h3>
                <p className="text-gray-600">Your schedule is clear for today.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {todayInterviews.map((interview) => (
                <InterviewCard 
                  key={interview._id} 
                  interview={interview} 
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          {completedInterviews.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No completed interviews</h3>
                <p className="text-gray-600">Completed interviews will appear here after they finish.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {completedInterviews.map((interview) => (
                <InterviewCard 
                  key={interview._id} 
                  interview={interview} 
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recent" className="space-y-4">
          {recentInterviews.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No recent interviews</h3>
                <p className="text-gray-600">Interviews from the past week will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {recentInterviews.map((interview) => (
                <InterviewCard 
                  key={interview._id} 
                  interview={interview} 
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          {interviews.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No interviews scheduled</h3>
                <p className="text-gray-600">Start by scheduling interviews from the candidate pipeline.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {interviews.map((interview) => (
                <InterviewCard 
                  key={interview._id} 
                  interview={interview} 
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Interview Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Interview Details</DialogTitle>
            <DialogDescription>
              View and manage interview information
            </DialogDescription>
          </DialogHeader>
          
          {selectedInterview && (
            <div className="space-y-6">
              {/* Header Info */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{selectedInterview.title}</h3>
                  <Badge className={getStatusColor(selectedInterview.status)}>
                    {selectedInterview.status}
                  </Badge>
                </div>
                <div className="text-sm text-gray-500">
                  ID: {selectedInterview._id}
                </div>
              </div>

              {/* Time & Duration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Date & Time</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span>{formatDateTime(selectedInterview.scheduledAt).date} at {formatDateTime(selectedInterview.scheduledAt).time}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">Duration</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span>{selectedInterview.duration} minutes</span>
                  </div>
                </div>
              </div>

              {/* Type & Location */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Type</Label>
                  <div className="flex items-center gap-2 mt-1">
                    {getTypeIcon(selectedInterview.type)}
                    <span className="capitalize">{selectedInterview.type}</span>
                  </div>
                </div>
                {selectedInterview.location && (
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Location</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <MapPin className="h-4 w-4 text-gray-500" />
                      <span>{selectedInterview.location}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Candidate Info */}
              {selectedInterview.candidateId && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Candidate</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    {typeof selectedInterview.candidateId === 'object' ? (
                      <div>
                        <div className="font-medium">
                          {selectedInterview.candidateId.firstName} {selectedInterview.candidateId.lastName}
                        </div>
                        <div className="text-sm text-gray-600">{selectedInterview.candidateId.email}</div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-600">Candidate ID: {selectedInterview.candidateId}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Job Info */}
              {selectedInterview.jobId && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Job</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    {typeof selectedInterview.jobId === 'object' ? (
                      <div>
                        <div className="font-medium">{selectedInterview.jobId.title}</div>
                        {selectedInterview.jobId.company && (
                          <div className="text-sm text-gray-600">{selectedInterview.jobId.company}</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-600">Job ID: {selectedInterview.jobId}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Meeting Link */}
              {selectedInterview.conferencing?.details?.url && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Meeting Link</Label>
                  <div className="mt-1">
                    <Button asChild variant="outline" className="w-full">
                      <a href={selectedInterview.conferencing.details.url} target="_blank" rel="noopener noreferrer">
                        <Video className="h-4 w-4 mr-2" />
                        Join Meeting
                      </a>
                    </Button>
                  </div>
                </div>
              )}

              {/* Description */}
              {selectedInterview.description && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Description</Label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">
                    {selectedInterview.description}
                  </div>
                </div>
              )}

              {/* Participants */}
              {selectedInterview.participants && selectedInterview.participants.length > 0 && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Participants</Label>
                  <div className="mt-1 space-y-2">
                    {selectedInterview.participants.map((participant, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <div>
                          <div className="font-medium">{participant.name}</div>
                          <div className="text-sm text-gray-600">{participant.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {participant.role}
                          </Badge>
                          <Badge variant={participant.status === 'accepted' ? 'default' : 'secondary'} className="text-xs">
                            {participant.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notetaker Status */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">AI Notetaker</Label>
                  {selectedInterview.notetakerEnabled && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 px-2"
                      onClick={() => refreshNotetakerStatus(selectedInterview)}
                      disabled={refreshingStatus}
                      title="Refresh notetaker status"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshingStatus ? 'animate-spin' : ''}`} />
                      <span className="sr-only">Refresh</span>
                    </Button>
                  )}
                </div>
                <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                  {selectedInterview.notetakerEnabled ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-gray-500" />
                          <span className="text-sm">Recording & Transcription</span>
                        </div>
                        <Badge variant={selectedInterview.notetakerStatus === 'completed' ? 'default' : 'secondary'}>
                          {selectedInterview.notetakerStatus || 'pending'}
                        </Badge>
                      </div>
                      
                      <div className="mt-3 space-y-2">
                        {selectedInterview.notetakerStatus === 'completed' && (
                          <Button 
                            size="sm" 
                            variant="default" 
                            className="w-full bg-green-600 hover:bg-green-700"
                            onClick={() => {
                              window.location.href = `/interviews/${selectedInterview._id}/transcript?from=calendar`;
                            }}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            View Completed Transcript
                          </Button>
                        )}
                        
                        {selectedInterview.status === 'completed' && selectedInterview.recordingUrl && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="w-full"
                            asChild
                          >
                            <a href={selectedInterview.recordingUrl} target="_blank" rel="noopener noreferrer">
                              <Video className="h-4 w-4 mr-2" />
                              Download Recording
                            </a>
                          </Button>
                        )}
                        
                        {selectedInterview.notetakerStatus === 'enabled' && (
                          <Button
                            size="sm"
                            variant="default"
                            className="w-full"
                            onClick={handleJoinMeetingNow}
                            disabled={joiningMeeting}
                          >
                            {joiningMeeting ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Sending Nyla...
                              </>
                            ) : (
                              <>
                                <Video className="h-4 w-4 mr-2" />
                                Send Nyla to call
                              </>
                            )}
                          </Button>
                        )}
                        
                        {(selectedInterview.notetakerStatus === 'enabled' || 
                          selectedInterview.notetakerStatus === 'joined' ||
                          selectedInterview.notetakerStatus === 'recording') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={handleCancelNotetaker}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancel Notetaker
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">
                        No AI notetaker enabled for this interview.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setMeetingLink(selectedInterview.conferencing?.details?.url || '');
                          setShowNotetakerDialog(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add AI Notetaker
                      </Button>
                      {!selectedInterview.conferencing?.details?.url && (
                        <p className="text-xs text-amber-600">
                          💡 You'll need to provide the meeting link
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            {selectedInterview && selectedInterview.status !== 'cancelled' && selectedInterview.status !== 'completed' && (
              <Button
                variant="destructive"
                onClick={() => openCancelDialog(selectedInterview)}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel Interview
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Notetaker Dialog */}
      <Dialog open={showNotetakerDialog} onOpenChange={setShowNotetakerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add AI Notetaker</DialogTitle>
            <DialogDescription>
              Add an AI notetaker to record and transcribe this interview. The bot will join the meeting automatically.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="meetingLink">Meeting Link</Label>
              <Input
                id="meetingLink"
                type="url"
                placeholder="https://meet.google.com/..."
                value={meetingLink}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMeetingLink(e.target.value)}
                className="mt-1"
              />
              <p className="text-sm text-gray-500 mt-1">
                Enter the Google Meet, Zoom, or Teams link for this interview.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNotetakerDialog(false);
                setMeetingLink('');
              }}
              disabled={enablingNotetaker}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEnableNotetaker}
              disabled={!meetingLink || enablingNotetaker}
            >
              {enablingNotetaker ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enabling...
                </>
              ) : (
                'Enable Notetaker'
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
              <Label htmlFor="cancelReason">Reason for cancellation (optional)</Label>
              <Textarea
                id="cancelReason"
                placeholder="Please provide a reason for cancelling this interview..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1"
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
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Cancel Interview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InterviewCard({ interview, onViewDetails }: {
  interview: Interview, 
  onViewDetails: (interview: Interview) => void
}) {
  const { date, time } = formatDateTime(interview.scheduledAt);
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-gray-100 text-gray-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="h-4 w-4" />;
      case 'phone': return <Phone className="h-4 w-4" />;
      case 'in_person': return <MapPin className="h-4 w-4" />;
      default: return <Users className="h-4 w-4" />;
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-gray-900">{interview.title}</h3>
              <Badge className={getStatusColor(interview.status)}>
                {interview.status}
              </Badge>
              {interview.notetakerEnabled && (
                <Badge variant="outline" className="text-xs">
                  <Mic className="h-3 w-3 mr-1" />
                  AI Notetaker
                </Badge>
              )}
              {interview.status === 'completed' && interview.transcript && (
                <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                  <FileText className="h-3 w-3 mr-1" />
                  Transcript Available
                </Badge>
              )}
            </div>
            
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>{date} at {time}</span>
              </div>
              
              <div className="flex items-center gap-2">
                {getTypeIcon(interview.type)}
                <span className="capitalize">{interview.type}</span>
                {interview.duration && (
                  <span>• {interview.duration} minutes</span>
                )}
              </div>
              
              {interview.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{interview.location}</span>
                </div>
              )}
              
              {interview.participants && interview.participants.length > 0 && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>{interview.participants.length} participants</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onViewDetails(interview)}>
              <Eye className="h-4 w-4 mr-1" />
              View
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}
