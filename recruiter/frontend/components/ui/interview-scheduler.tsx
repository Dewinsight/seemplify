"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, MapPin, Video, Phone, Users, AlertCircle, AlertTriangle, CheckCircle, RefreshCw, UserCheck, ExternalLink, X, Plus, Mail, UserPlus, Trash2, Copy, ChevronUp, ChevronDown, Loader2, MessageCircle } from 'lucide-react';
import { InterviewQuestionSelector } from './interview-question-selector';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Textarea } from './textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
// Card components removed - using Dialog wrapper from parent
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Badge } from './badge';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { Checkbox } from './checkbox';
import { ScrollArea } from './scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
import { EmailTemplateDesigner } from './email-template-designer';
import interviewService from '@/services/interviewService';
import { useCreditError } from '@/hooks/useCreditError';
import { CreditErrorDialog } from '@/components/ui/credit-error-dialog';
import organizationService from '@/services/organizationService';
import { grantService, isGrantError } from '@/services/grantService';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';
import { getAllCandidates } from '@/services/candidateService';
import { getAllJobs } from '@/services/jobService';
import { getDefaultEmailTemplate } from '@/lib/emailTemplatePresets';

interface InterviewSchedulerProps {
  candidateId: string;
  candidateName: string;
  jobTitle: string;
  jobId?: string;
  stageId?: string;
  onScheduled?: (interview: any) => void;
  onCancel?: () => void;
}

interface CalendarStatus {
  connected: boolean;
  provider?: string;
  verified?: boolean;
  error?: string;
}

interface ProviderOption {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
}

interface Participant {
  id: string;
  email: string;
  name: string;
  role: 'candidate' | 'interviewer' | 'observer' | 'external';
  isRequired: boolean;
  status?: 'pending' | 'accepted' | 'declined';
  type: 'member' | 'external';
  userId?: string;
}

interface OrganizationMember {
  _id: string;
  user: {
    _id: string;
    email: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
  };
  role: string;
  status: string;
}

interface MultiCandidateSlot {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId?: string;
  jobTitle: string;
  startTime: string;
  duration: number; // in minutes
  notes?: string;
  order: number;
}

export function InterviewScheduler({ 
  candidateId, 
  candidateName, 
  jobTitle, 
  jobId,
  stageId,
  onScheduled, 
  onCancel 
}: InterviewSchedulerProps) {
  const { state } = useUser();
  
  const DEFAULT_EMAIL_TEMPLATE = getDefaultEmailTemplate();

  const [formData, setFormData] = useState({
    startTime: '',
    endTime: '',
    duration: 60,
    type: 'video' as 'video' | 'phone' | 'in_person',
    location: '',
    notes: '',
    subject: '', // Custom email subject line
    sendCustomEmail: true,
    emailTemplate: DEFAULT_EMAIL_TEMPLATE, // ✅ FIX: Always initialize with template
    // New fields for interviewer questions
    sendQuestionsToInterviewers: false,
    questionsSendTime: 60, // default 60 minutes before interview
  });
  const [addNotetaker, setAddNotetaker] = useState(true);
  
  const [isScheduling, setIsScheduling] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>({ connected: false });
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [skipAvailabilityCheck, setSkipAvailabilityCheck] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('google');
  const [serverError, setServerError] = useState<string | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string>('google');
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [showMultiInterviewModal, setShowMultiInterviewModal] = useState(false);
  
  // Participant management state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [bccParticipants, setBccParticipants] = useState<Participant[]>([]);
  const [ccParticipants, setCcParticipants] = useState<Participant[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [showAddParticipantDialog, setShowAddParticipantDialog] = useState(false);
  const [newParticipantEmail, setNewParticipantEmail] = useState('');
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantRole, setNewParticipantRole] = useState<'observer' | 'interviewer'>('observer');
  const [loadingMembers, setLoadingMembers] = useState(false);
  
  // Multi-candidate interview state
  const [multiCandidateSlots, setMultiCandidateSlots] = useState<MultiCandidateSlot[]>([]);
  const [multiBaseStartTime, setMultiBaseStartTime] = useState('');
  const [multiInterviewType, setMultiInterviewType] = useState<'video' | 'phone' | 'in_person'>('video');
  const [multiLocation, setMultiLocation] = useState('');
  const [multiAddNotetaker, setMultiAddNotetaker] = useState(true);
  const [multiInterviewers, setMultiInterviewers] = useState<Participant[]>([]);
  const [showAddCandidateDialog, setShowAddCandidateDialog] = useState(false);
  const [newCandidateName, setNewCandidateName] = useState('');
  const [newCandidateEmail, setNewCandidateEmail] = useState('');
  const [newCandidateJobTitle, setNewCandidateJobTitle] = useState('');
  const [newCandidateDuration, setNewCandidateDuration] = useState(60);
  const [newCandidateNotes, setNewCandidateNotes] = useState('');
  
  // Multi-candidate interview questions
  const [multiSendQuestionsToInterviewers, setMultiSendQuestionsToInterviewers] = useState(false);
  const [multiQuestionsSendTime, setMultiQuestionsSendTime] = useState(60);
  const [multiCommunicationTab, setMultiCommunicationTab] = useState<'email' | 'questions'>('email');
  
  // System candidates and jobs
  const [systemCandidates, setSystemCandidates] = useState<any[]>([]);
  const [systemJobs, setSystemJobs] = useState<any[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [selectedJobId, setSelectedJobId] = useState('');
  const [candidateSearchTerm, setCandidateSearchTerm] = useState('');
  
  // Interview questions for interviewers
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [singleCommunicationTab, setSingleCommunicationTab] = useState<'email' | 'questions'>('email');
  
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
  
  // Multi-candidate email template
  const [multiSendCustomEmail, setMultiSendCustomEmail] = useState(true);
  const [multiEmailTemplate, setMultiEmailTemplate] = useState('');
  
  // Additional participants for multi-candidate
  const [multiAdditionalParticipants, setMultiAdditionalParticipants] = useState<Participant[]>([]);
  const [showMultiAddParticipantDialog, setShowMultiAddParticipantDialog] = useState(false);
  
  // Provider options
  const providers: ProviderOption[] = [
    {
      id: 'google',
      name: 'Google Meet',
      icon: <Video className="h-4 w-4" />,
      color: 'bg-blue-500'
    },
    {
      id: 'microsoft',
      name: 'Microsoft Teams',
      icon: <Video className="h-4 w-4" />,
      color: 'bg-purple-500'
    }
  ];

  useEffect(() => {
    if (state.user?._id) {
      checkCalendarStatus();
      loadDefaultProvider();
      loadOrganizationMembers();
      initializeParticipants();
      initializeEmailTemplate();
      loadSystemCandidates();
      loadSystemJobs();
    }
  }, [state.user?._id, candidateName, stageId]);

  const initializeParticipants = () => {
    // Initialize with candidate and current user
    const initialParticipants: Participant[] = [
      {
        id: 'candidate',
        email: '', // Will be filled from candidate data
        name: candidateName,
        role: 'candidate',
        isRequired: true,
        status: 'pending',
        type: 'external'
      },
      {
        id: 'interviewer',
        email: state.user?.email || '',
        name: state.user?.email || 'You',
        role: 'interviewer',
        isRequired: true,
        status: 'accepted',
        type: 'member',
        userId: state.user?._id
      }
    ];
    setParticipants(initialParticipants);
  };

  const loadOrganizationMembers = async () => {
    try {
      setLoadingMembers(true);
      const response = await organizationService.getOrganizationMembers();
      setOrganizationMembers(response.members);
    } catch (error) {
      console.error('Failed to load organization members:', error);
      toast.error('Failed to load team members');
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadSystemCandidates = async () => {
    try {
      setLoadingCandidates(true);
      
      // Only load pipeline candidates for multi-candidate interviews
      // Single interviews already have a specific candidate selected
      if (jobId) {
        const { getJobById } = await import('@/services/jobService');
        const jobData = await getJobById(jobId);
        
        // If we have a stageId, filter to that specific stage
        // Otherwise, show all candidates in the pipeline
        const candidatesToShow = (jobData.applicants || [])
          .filter(applicant => {
            if (!applicant.candidate) return false;
            
            // If no stageId provided, show all candidates in pipeline
            if (!stageId) {
              return true;
            }
            
            // Check if they're in the specific stage
            const applicantStage = (applicant as any).currentStage;
            
            // If no currentStage is set, they're not in any stage yet
            if (!applicantStage) {
              return false;
            }
            
            // Check if the stage matches - handle multiple formats:
            // 1. currentStage could be just a string ID
            // 2. currentStage could be an object with stageId field
            // 3. currentStage could be a MongoDB ObjectId that needs toString()
            let stageMatch = false;
            
            if (typeof applicantStage === 'string' || applicantStage._bsontype === 'ObjectId') {
              // Direct string/ObjectId comparison
              stageMatch = applicantStage.toString() === stageId.toString();
            } else if (typeof applicantStage === 'object' && applicantStage.stageId) {
              // Object with stageId field (as per schema)
              stageMatch = applicantStage.stageId.toString() === stageId.toString();
            } else if (typeof applicantStage === 'object' && applicantStage._id) {
              // Object with _id field (populated stage)
              stageMatch = applicantStage._id.toString() === stageId.toString();
            }
            
            return stageMatch;
          })
          .map(applicant => ({
            _id: applicant.candidate._id,
            firstName: applicant.candidate.firstName,
            lastName: applicant.candidate.lastName,
            email: applicant.candidate.email,
            phone: applicant.candidate.phone,
            position: applicant.candidate.position,
            status: applicant.status,
            currentStage: (applicant as any).currentStage,
            appliedAt: applicant.appliedAt || (applicant as any).addedAt
          }));
        
        setSystemCandidates(candidatesToShow);
      } else {
        // Fallback to all candidates if no jobId (shouldn't happen in multi-candidate context)
        const candidates = await getAllCandidates();
        setSystemCandidates(candidates);
      }
    } catch (error) {
      console.error('Failed to load candidates:', error);
      toast.error('Failed to load candidates from stage');
    } finally {
      setLoadingCandidates(false);
    }
  };

  const loadSystemJobs = async () => {
    try {
      const jobs = await getAllJobs();
      setSystemJobs(jobs);
      // Set default job if provided
      if (jobId) {
        setSelectedJobId(jobId);
      }
    } catch (error) {
      console.error('Failed to load jobs:', error);
      toast.error('Failed to load jobs');
    }
  };

  const addMemberAsParticipant = (member: OrganizationMember) => {
    const memberName = member.user.profile?.firstName && member.user.profile?.lastName 
      ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
      : member.user.email;

    const newParticipant: Participant = {
      id: member._id,
      email: member.user.email,
      name: memberName,
      role: 'observer',
      isRequired: false,
      status: 'pending',
      type: 'member',
      userId: member.user._id
    };

    // Check if already added
    if (participants.some(p => p.email === member.user.email)) {
      toast.error('This member is already added to the interview');
      return;
    }

    setParticipants(prev => [...prev, newParticipant]);
    toast.success(`Added ${memberName} to the interview`);
  };

  const addExternalParticipant = () => {
    if (!newParticipantEmail.trim()) {
      toast.error('Email is required');
      return;
    }

    if (!newParticipantName.trim()) {
      toast.error('Name is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newParticipantEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    // Check if already added
    if (participants.some(p => p.email === newParticipantEmail)) {
      toast.error('This email is already added to the interview');
      return;
    }

    const newParticipant: Participant = {
      id: `external-${Date.now()}`,
      email: newParticipantEmail.trim(),
      name: newParticipantName.trim(),
      role: newParticipantRole,
      isRequired: false,
      status: 'pending',
      type: 'external'
    };

    setParticipants(prev => [...prev, newParticipant]);
    setNewParticipantEmail('');
    setNewParticipantName('');
    setShowAddParticipantDialog(false);
    toast.success(`Added ${newParticipant.name} to the interview`);
  };

  // Add participant to multi-candidate session
  const addParticipantToMulti = (member?: OrganizationMember) => {
    if (member) {
      // Adding an organization member
      const memberName = member.user.profile?.firstName && member.user.profile?.lastName 
        ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
        : member.user.email;

      const newParticipant: Participant = {
        id: member._id,
        email: member.user.email,
        name: memberName,
        role: 'observer',
        isRequired: false,
        status: 'pending',
        type: 'member',
        userId: member.user._id
      };

      // Check if already added
      if (multiAdditionalParticipants.some(p => p.email === member.user.email)) {
        toast.error('This member is already added to the session');
        return;
      }

      setMultiAdditionalParticipants(prev => [...prev, newParticipant]);
      toast.success(`Added ${memberName} to the multi-candidate session`);
    } else {
      // Adding an external participant
      if (!newParticipantEmail.trim() || !newParticipantName.trim()) {
        toast.error('Name and email are required');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newParticipantEmail)) {
        toast.error('Please enter a valid email address');
        return;
      }

      if (multiAdditionalParticipants.some(p => p.email === newParticipantEmail)) {
        toast.error('This email is already added to the session');
        return;
      }

      const newParticipant: Participant = {
        id: `external-${Date.now()}`,
        email: newParticipantEmail.trim(),
        name: newParticipantName.trim(),
        role: newParticipantRole,
        isRequired: false,
        status: 'pending',
        type: 'external'
      };

      setMultiAdditionalParticipants(prev => [...prev, newParticipant]);
      setNewParticipantEmail('');
      setNewParticipantName('');
      setShowMultiAddParticipantDialog(false);
      toast.success(`Added ${newParticipant.name} to the multi-candidate session`);
    }
  };

  const removeParticipant = (participantId: string) => {
    const participant = participants.find(p => p.id === participantId);
    if (participant?.isRequired) {
      toast.error('Required participants cannot be removed');
      return;
    }

    setParticipants(prev => prev.filter(p => p.id !== participantId));
    toast.success('Participant removed');
  };

  const updateParticipantRole = (participantId: string, newRole: 'observer' | 'interviewer') => {
    setParticipants(prev => prev.map(p => 
      p.id === participantId ? { ...p, role: newRole } : p
    ));
  };

  const getParticipantInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'candidate': return 'bg-blue-100 text-blue-800';
      case 'interviewer': return 'bg-green-100 text-green-800';
      case 'observer': return 'bg-gray-100 text-gray-800';
      case 'external': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  useEffect(() => {
    // Auto-calculate end time when start time or duration changes
    if (formData.startTime && formData.duration > 0) {
      // FIXED: Keep calculation in same timezone context to avoid UTC conversion
      const startTimeString = formData.startTime; // "2025-09-06T05:55"
      
      // Parse start time components
      const [datePart, timePart] = startTimeString.split('T');
      const [hours, minutes] = timePart.split(':').map(Number);
      
      // Calculate end time by adding duration to minutes
      let endHours = hours;
      let endMinutes = minutes + formData.duration;
      
      // Handle minute overflow
      if (endMinutes >= 60) {
        endHours += Math.floor(endMinutes / 60);
        endMinutes = endMinutes % 60;
      }
      
      // Handle hour overflow (to next day)
      if (endHours >= 24) {
        // For simplicity, just cap at 23:59 for same day
        endHours = Math.min(endHours, 23);
        endMinutes = Math.min(endMinutes, 59);
      }
      
      // Format back to datetime-local format
      const calculatedEndTime = `${datePart}T${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
      
      console.log('🕐 FIXED: Auto-calculating end time:', {
        startTime: formData.startTime,
        duration: formData.duration,
        calculatedEndTime,
        breakdown: {
          startHours: hours,
          startMinutes: minutes,
          addedMinutes: formData.duration,
          endHours,
          endMinutes
        }
      });
      
      setFormData(prev => ({
        ...prev,
        endTime: calculatedEndTime
      }));
    }
  }, [formData.startTime, formData.duration]);

  useEffect(() => {
    // Set up postMessage listener for OAuth completion
    const handlePostMessage = (event: MessageEvent) => {
      // Security: Only accept messages from expected origins
      const allowedOrigins = [
        'https://api.us.nylas.com',
        'https://api.eu.nylas.com', 
        'https://accounts.google.com',
        'http://localhost:3001', // Backend localhost
        'http://localhost:5000', // Frontend localhost
        window.location.origin
      ];
      
      if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) {
        console.warn('Ignoring postMessage from untrusted origin:', event.origin);
        return;
      }

      // Handle OAuth completion messages
      if (event.data && typeof event.data === 'object') {
        console.log('📨 Received postMessage:', event.data);
        console.log('🔍 Current states before handling:', { isConnecting, isSwitchingAccount });
        
        if (event.data.type === 'oauth_success' || event.data.type === 'calendar_connected') {
          console.log('✅ OAuth completion detected via postMessage - resetting states immediately');
          
          // Immediately reset loading states
          setIsConnecting(false);
          setIsSwitchingAccount(false);
          
          // Check status and show success message
          setTimeout(() => {
            checkCalendarStatus();
            toast.success('Calendar connected successfully!');
          }, 500);
          
        } else if (event.data.type === 'oauth_error') {
          console.error('❌ OAuth error detected via postMessage:', event.data.error);
          setIsConnecting(false);
          setIsSwitchingAccount(false);
          toast.error(event.data.error || 'Authentication failed');
          
        } else if (event.data.type === 'oauth_cancelled') {
          console.log('⚠️ OAuth cancelled by user');
          setIsConnecting(false);
          setIsSwitchingAccount(false);
          toast.info('Authentication cancelled');
        }
        
        console.log('🔍 States after handling:', { isConnecting: false, isSwitchingAccount: false });
      }
    };

    console.log('🎧 Setting up postMessage listener');
    window.addEventListener('message', handlePostMessage);
    
    return () => {
      console.log('🧹 Cleaning up postMessage listener');
      window.removeEventListener('message', handlePostMessage);
    };
  }, []); // Remove dependency on isSwitchingAccount to prevent re-renders

  const checkCalendarStatus = async () => {
    if (!state.user?._id) {
      console.log('No user ID available for calendar status check');
      return;
    }
    
    try {
      const status = await interviewService.getCalendarStatus(state.user._id);
      setCalendarStatus(status);
      const normalizedProvider = String(status?.provider || '').toLowerCase();
      if (
        normalizedProvider.includes('microsoft') ||
        normalizedProvider.includes('outlook') ||
        normalizedProvider.includes('azure') ||
        normalizedProvider.includes('teams')
      ) {
        setSelectedProvider('microsoft');
      } else if (normalizedProvider.includes('google') || normalizedProvider.includes('gmail')) {
        setSelectedProvider('google');
      }
    } catch (error) {
      console.error('Failed to check calendar status:', error);
    }
  };
  
  const loadDefaultProvider = () => {
    const savedProvider = localStorage.getItem('defaultCalendarProvider');
    if (savedProvider && providers.find(p => p.id === savedProvider)) {
      setDefaultProvider(savedProvider);
      setSelectedProvider(savedProvider);
    }
  };
  
  const saveDefaultProvider = (providerId: string) => {
    localStorage.setItem('defaultCalendarProvider', providerId);
    setDefaultProvider(providerId);
    toast.success(`Default provider set to ${providers.find(p => p.id === providerId)?.name}`);
  };

  const handleVerifyGrant = async () => {
    setIsVerifying(true);
    try {
      const verification = await grantService.verifyGrant();
      
      if (verification.valid) {
        toast.success('Calendar access verified successfully');
        await checkCalendarStatus();
      } else if (verification.requiresReauth) {
        toast.error('Calendar access expired. Please reconnect.');
        // Optionally open re-authentication
        await handleReconnectCalendar();
      } else {
        toast.error('Calendar verification failed. Please try again.');
      }
    } catch (error) {
      console.error('Grant verification error:', error);
      toast.error('Failed to verify calendar access');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleConnectCalendar = async (provider: string = selectedProvider, forceAccountSelection: boolean = false) => {
    if (!state.user?._id) {
      toast.error('Please log in to connect your calendar');
      return;
    }
    
    const providerName = providers.find(p => p.id === provider)?.name || provider;
    
    if (forceAccountSelection) {
      setIsSwitchingAccount(true);
      // For Nylas v3, we need to inform the user about the process
      toast.info(`To switch accounts, please select a different ${providerName} account in the popup or log out of ${providerName} in your browser first.`);
    } else {
      setIsConnecting(true);
    }

    // Set up a safety timeout to reset states if something goes wrong
    const safetyTimeout = setTimeout(() => {
      console.log('🚨 Safety timeout reached - resetting connection states');
      setIsConnecting(false);
      setIsSwitchingAccount(false);
      toast.error('Connection timeout. Please try again.');
    }, 180000); // 3 minutes safety timeout
    
    try {
      const { authUrl } = await interviewService.connectCalendar(provider, forceAccountSelection);
      
      // Open the auth window with specific parameters to help with postMessage communication
      const authWindow = window.open(
        authUrl, 
        'oauth_popup',
        'width=600,height=700,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no'
      );
      
      if (!authWindow) {
        clearTimeout(safetyTimeout);
        setIsConnecting(false);
        setIsSwitchingAccount(false);
        throw new Error('Failed to open authentication window. Please check your popup blocker settings.');
      }

      // Function to reset states and cleanup
      const resetStates = () => {
        console.log('🔄 Resetting connection states');
        setIsConnecting(false);
        setIsSwitchingAccount(false);
        clearTimeout(safetyTimeout);
      };

      // Simplified approach - just wait for postMessage or window close
      let isCompleted = false;
      
      // Check if window is closed every second
      const checkClosed = setInterval(() => {
        try {
          if (authWindow.closed && !isCompleted) {
            console.log('🔍 Auth window closed');
            isCompleted = true;
            clearInterval(checkClosed);
            resetStates();
            
            // Check status after window closes
            setTimeout(() => {
              checkCalendarStatus();
            }, 1500);
          }
        } catch (e) {
          // Ignore COOP errors
        }
      }, 1000);

      // Cleanup after 2 minutes regardless
      setTimeout(() => {
        clearInterval(checkClosed);
        if (!isCompleted) {
          console.log('⏰ Connection timeout - cleaning up');
          isCompleted = true;
          resetStates();
          try {
            if (!authWindow.closed) {
              authWindow.close();
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }, 120000);

    } catch (error: any) {
      console.error('Calendar connection error:', error);
      clearTimeout(safetyTimeout);
      toast.error(
        forceAccountSelection
          ? `Failed to switch ${providerName} account`
          : `Failed to connect ${providerName}`
      );
      setIsConnecting(false);
      setIsSwitchingAccount(false);
    }
  };

  const handleReconnectCalendar = async () => {
    try {
      const providerFromGrant = String(calendarStatus.provider || '').toLowerCase();
      const providerToReconnect =
        providerFromGrant.includes('microsoft') ||
        providerFromGrant.includes('outlook') ||
        providerFromGrant.includes('azure') ||
        providerFromGrant.includes('teams')
          ? 'microsoft'
          : providerFromGrant.includes('google') || providerFromGrant.includes('gmail')
            ? 'google'
            : selectedProvider;
      const authUrl = await grantService.generateReauthUrl(providerToReconnect, false);
      const authWindow = window.open(authUrl, 'grant-reauth', 'width=600,height=700,scrollbars=yes,resizable=yes');
      
      // Use similar postMessage approach for reconnection
      let hasCompleted = false;
      
      const handleReconnectMessage = (event: MessageEvent) => {
        if (event.data?.type === 'oauth_success' && !hasCompleted) {
          hasCompleted = true;
          window.removeEventListener('message', handleReconnectMessage);
          
          setTimeout(() => {
            checkCalendarStatus();
            toast.success('Calendar reconnected successfully');
          }, 2000);
        }
      };

      window.addEventListener('message', handleReconnectMessage);

      // Fallback polling for reconnection
      const pollTimer = setInterval(() => {
        try {
          if (authWindow?.closed && !hasCompleted) {
            clearInterval(pollTimer);
            window.removeEventListener('message', handleReconnectMessage);
            
            setTimeout(() => {
              checkCalendarStatus();
            }, 2000);
          }
        } catch (e) {
          // Ignore COOP errors
        }
      }, 1000);

      // Cleanup after timeout
      setTimeout(() => {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleReconnectMessage);
      }, 120000);

    } catch (error) {
      console.error('Error reconnecting calendar:', error);
      toast.error('Failed to reconnect calendar');
    }
  };

  const handleSwitchAccountWithGuidance = async () => {
    const switchAccount = async () => {
      await handleConnectCalendar(selectedProvider, true);
    };

    const providerName = providers.find(p => p.id === selectedProvider)?.name || 'calendar';
    // Show a more detailed explanation
    if (confirm(
      `To switch to a different ${providerName} account:\n\n` +
      '1. Click "OK" to open the authentication window\n' +
      '2. If you see the same account, click "Use another account"\n' +
      `3. Or log out of ${providerName} in another browser tab first\n\n` +
      'Would you like to continue?'
    )) {
      await switchAccount();
    }
  };

  // Manual reset function for when things get stuck
  const handleManualReset = () => {
    console.log('🔄 Manual reset triggered');
    setIsConnecting(false);
    setIsSwitchingAccount(false);
    toast.info('Connection states reset. You can try again.');
  };

  const extractApiErrorData = (error: any) => error?.data || error?.response?.data || null;

  const isTeamsScopeErrorCode = (code?: string) =>
    code === 'TEAMS_SCOPE_MISSING' || code === 'TEAMS_PROVIDER_MISMATCH';

  const showTeamsScopeErrorModal = (error: any) => {
    const apiErrorData = extractApiErrorData(error) || {};
    const details = apiErrorData?.details || {};
    const missingScopes = Array.isArray(details?.missingScopes) ? details.missingScopes : [];
    const missingScopesText = missingScopes.length > 0
      ? `Missing scopes: ${missingScopes.join(', ')}`
      : 'Missing required Microsoft scopes.';

    setErrorDetails({
      title: 'Microsoft Teams Scopes Required',
      message: apiErrorData?.message || 'Microsoft Teams scheduling requires additional permissions.',
      details: `${missingScopesText}\nCurrent scopes: ${JSON.stringify(details?.grantScopes || [])}`,
      suggestions: [
        'Click "Reconnect Microsoft Scopes" below',
        'Accept all requested Microsoft permissions in the popup',
        'Return and schedule the interview again'
      ],
      code: apiErrorData?.error || error?.message || 'TEAMS_SCOPE_MISSING'
    });
    setShowErrorModal(true);
  };

  const handleSchedule = async () => {
    if (!state.user?._id) {
      toast.error('Please log in to schedule interviews');
      return;
    }
    
    if (!calendarStatus.connected) {
      toast.error('Please connect your calendar first');
      return;
    }

    if (calendarStatus.verified === false) {
      toast.error('Please verify your calendar connection first');
      return;
    }

    if (!formData.startTime) {
      toast.error('Please select a start time');
      return;
    }

    // Validate that endTime is after startTime if both exist
    if (formData.endTime) {
      const startDate = new Date(formData.startTime + ':00');
      const endDate = new Date(formData.endTime + ':00');
      
      if (endDate <= startDate) {
        toast.error('End time must be after start time. Please adjust the duration or times.');
        return;
      }
    }

    setIsScheduling(true);
    setConflicts([]);
    setShowConflicts(false);
    setServerError(null);

    try {
      console.log('=== Frontend Scheduling Debug ===');
      console.log('Candidate ID:', candidateId);
      console.log('Job ID:', jobId);
      console.log('Candidate Name:', candidateName);
      console.log('Job Title:', jobTitle);
      console.log('Current User:', {
        id: state.user?._id,
        email: state.user?.email
      });
      console.log('Form Data:', {
        startTime: formData.startTime,
        endTime: formData.endTime,
        duration: formData.duration,
        notes: formData.notes
      });
      console.log('Participants:', participants);
      
      // Prepare additional participants (excluding candidate and main interviewer)
      const additionalParticipants = participants
        .filter(p => p.role !== 'candidate' && p.id !== 'interviewer')
        .map(p => ({
          email: p.email,
          name: p.name,
          role: p.role
        }));
      
      // Get user's timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log('🌍 User timezone detected:', userTimezone);
      
      // FIXED: Calculate endTime using string arithmetic to avoid timezone conversion
      const [datePart, timePart] = formData.startTime.split('T');
      const [hours, minutes] = timePart.split(':').map(Number);
      
      let endHours = hours;
      let endMinutes = minutes + formData.duration;
      
      // Handle minute overflow
      if (endMinutes >= 60) {
        endHours += Math.floor(endMinutes / 60);
        endMinutes = endMinutes % 60;
      }
      
      // Handle hour overflow (to next day)
      if (endHours >= 24) {
        // For simplicity, just cap at 23:59 for same day
        endHours = Math.min(endHours, 23);
        endMinutes = Math.min(endMinutes, 59);
      }
      
      // Format back to datetime-local format
      const calculatedEndTime = `${datePart}T${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
      
      console.log('🕐 FIXED Frontend time calculation:', {
        startTime: formData.startTime,
        duration: formData.duration,
        calculatedEndTime,
        originalEndTime: formData.endTime,
        breakdown: {
          startHours: hours,
          startMinutes: minutes,
          endHours,
          endMinutes
        }
      });

      // FIXED: Convert datetime-local to ISO in frontend (like multi-candidate does)
      // This avoids double timezone conversion in backend
      const startDate = new Date(formData.startTime + ':00');
      const calculatedEndDate = new Date(startDate.getTime() + formData.duration * 60000);
      const startTimeISO = startDate.toISOString();
      const endTimeISO = calculatedEndDate.toISOString();
      
      console.log('🔧 TIMEZONE FIX: Converting to ISO in frontend like multi-candidate:', {
        originalStartTime: formData.startTime,
        originalEndTime: calculatedEndTime,
        convertedStartTime: startTimeISO,
        convertedEndTime: endTimeISO,
        note: 'Backend will use these ISO times directly without timezone conversion'
      });
      
      const scheduleData = {
        candidateId,
        jobId,
        stageId,
        startTime: startTimeISO, // Send ISO time instead of datetime-local
        endTime: endTimeISO,     // Send ISO time instead of datetime-local
        duration: formData.duration,
        notes: formData.notes,
        subject: formData.subject, // Custom email subject line
        addNotetaker: addNotetaker,
        skipAvailabilityCheck: skipAvailabilityCheck,
        forceSchedule: true, // ✅ CRITICAL: Force schedule without blocking on conflicts (pipeline behavior)
        provider: selectedProvider,
        additionalParticipants: additionalParticipants,
        bccParticipants: bccParticipants, // BCC participants for email/calendar
        ccParticipants: ccParticipants, // CC participants for email/calendar
        sendCustomEmail: formData.sendCustomEmail,
        emailTemplate: formData.emailTemplate,
        timezone: userTimezone, // Send user's timezone to backend
        // New fields for interview questions
        sendQuestionsToInterviewers: formData.sendQuestionsToInterviewers,
        questionsSendTime: formData.questionsSendTime,
        selectedQuestionIds: selectedQuestionIds,
        autocreate: true,
        useDirectISO: true // Flag to indicate frontend converted to ISO
      };
      
      console.log('📤 Sending schedule data:', scheduleData);
      const interview = await interviewService.scheduleFromPipeline(scheduleData);

      toast.success(
        addNotetaker 
          ? 'Interview scheduled successfully with AI notetaker!' 
          : 'Interview scheduled successfully!'
      );
      onScheduled?.(interview);
    } catch (error: any) {
      console.error('Scheduling error:', error);
      
      // Check if it's a credit error first
      const isCreditError = handleCreditError(error);
      
      if (isCreditError) {
        // Credit error dialog is shown automatically
        return;
      }
      
      // Extract server error message for non-credit errors
      const errorMessage = error?.response?.data?.message || 
                          error?.response?.data?.error || 
                          error?.message || 
                          'Failed to schedule interview';
      setServerError(errorMessage);

      const apiErrorData = extractApiErrorData(error) || {};
      const errorCode = apiErrorData?.error || error?.message;
      if (isTeamsScopeErrorCode(errorCode)) {
        showTeamsScopeErrorModal(error);
        return;
      }
      
      // Check if it's a grant error
      if (isGrantError(error.message)) {
        setErrorDetails({
          title: 'Calendar Connection Expired',
          message: 'Your calendar access has expired and needs to be reconnected.',
          suggestions: [
            'Click "Reconnect Calendar" button below',
            'Grant the necessary permissions',
            'Try scheduling the interview again'
          ]
        });
        setShowErrorModal(true);
        await handleReconnectCalendar();
      } else if (error.message.includes('SCHEDULING_CONFLICT') || error.message.includes('not available')) {
        // Handle scheduling conflicts
        const shouldForceSchedule = confirm(
          'There is a scheduling conflict at this time.\n\n' +
          'This usually means you already have something scheduled in your calendar.\n\n' +
          'Do you want to schedule the interview anyway?'
        );
        
        if (shouldForceSchedule) {
          try {
            // Retry with force scheduling
            const additionalParticipants = participants
              .filter(p => p.role !== 'candidate' && p.id !== 'interviewer')
              .map(p => ({
                email: p.email,
                name: p.name,
                role: p.role
              }));
              
            const retryScheduleData = {
              candidateId,
              jobId,
              stageId,
              startTime: formData.startTime,
              endTime: formData.endTime,
              duration: formData.duration,
              notes: formData.notes,
              addNotetaker: addNotetaker,
              forceSchedule: true,  // Force schedule despite conflicts
              provider: selectedProvider,
              additionalParticipants: additionalParticipants,
              sendCustomEmail: formData.sendCustomEmail,
              emailTemplate: formData.emailTemplate,
              autocreate: true
            };
            
            console.log('📤 Sending retry schedule data:', retryScheduleData);
            const interview = await interviewService.scheduleFromPipeline(retryScheduleData);

            toast.success(
              addNotetaker 
                ? 'Interview scheduled successfully with AI notetaker!' 
                : 'Interview scheduled successfully!'
            );
            onScheduled?.(interview);
          } catch (retryError: any) {
            console.error('Force scheduling error:', retryError);
            const retryErrorMessage = retryError?.response?.data?.message || retryError?.message || 'Failed to force schedule interview';
            setErrorDetails({
              title: 'Force Scheduling Failed',
              message: retryErrorMessage,
              details: retryError?.response?.data?.details || retryError?.stack?.split('\n')[0],
              suggestions: [
                'Check your internet connection',
                'Verify your calendar is still connected',
                'Try scheduling at a different time',
                'Contact support if the issue persists'
              ]
            });
            setShowErrorModal(true);
          }
        } else {
          toast.error('Please choose a different time slot');
        }
      } else if (error.message.includes('CALENDAR_NOT_CONNECTED')) {
        setErrorDetails({
          title: 'Calendar Not Connected',
          message: 'You need to connect your calendar before scheduling interviews.',
          suggestions: [
            'Click "Connect Calendar" at the top of the page',
            'Follow the authorization process',
            'Return here to schedule your interview'
          ]
        });
        setShowErrorModal(true);
      } else {
        // Generic error - show detailed modal
        setErrorDetails({
          title: 'Interview Scheduling Failed',
          message: errorMessage,
          details: error?.response?.data?.details || error?.stack?.split('\n')[0],
          suggestions: [
            'Check all required fields are filled correctly',
            'Verify the candidate email address is valid',
            'Ensure your calendar is connected',
            'Try refreshing the page and attempting again',
            'Contact support if the error persists'
          ]
        });
        setShowErrorModal(true);
      }
    } finally {
      setIsScheduling(false);
    }
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // Minimum 30 minutes from now
    return now.toISOString().slice(0, 16);
  };
  
  // Multi-candidate interview functions
  const addCandidateSlots = () => {
    if (selectedCandidateIds.size === 0) {
      toast.error('Please select at least one candidate');
      return;
    }

    const selectedJob = systemJobs.find(j => j._id === selectedJobId);
    const newSlots: MultiCandidateSlot[] = [];
    const alreadyAddedCandidates: string[] = [];
    let addedCount = 0;

    // Process each selected candidate
    selectedCandidateIds.forEach(candidateId => {
      const candidate = systemCandidates.find(c => c._id === candidateId);
      if (!candidate) return;

      // Check if candidate is already added
      if (multiCandidateSlots.some(slot => slot.candidateId === candidateId)) {
        alreadyAddedCandidates.push(`${candidate.firstName} ${candidate.lastName}`);
        return;
      }

      const newSlot: MultiCandidateSlot = {
        id: `slot-${Date.now()}-${candidateId}`,
        candidateId: candidate._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        candidateEmail: candidate.email,
        jobId: selectedJobId || jobId,
        jobTitle: selectedJob?.title || jobTitle,
        duration: newCandidateDuration,
        notes: newCandidateNotes.trim(),
        order: multiCandidateSlots.length + newSlots.length,
        startTime: '' // Will be calculated based on order
      };

      newSlots.push(newSlot);
      addedCount++;
    });

    if (newSlots.length > 0) {
      setMultiCandidateSlots(prev => [...prev, ...newSlots]);
    }
    
    // Reset form
    setSelectedCandidateIds(new Set());
    setSelectedJobId(jobId || '');
    setNewCandidateDuration(60);
    setNewCandidateNotes('');
    setShowAddCandidateDialog(false);
    
    // Show appropriate messages
    if (addedCount > 0) {
      toast.success(`Added ${addedCount} candidate${addedCount > 1 ? 's' : ''} to the interview session`);
    }
    if (alreadyAddedCandidates.length > 0) {
      toast.warning(`Already added: ${alreadyAddedCandidates.join(', ')}`);
    }
  };

  const removeCandidateSlot = (slotId: string) => {
    setMultiCandidateSlots(prev => {
      const updated = prev.filter(slot => slot.id !== slotId);
      // Reorder remaining slots
      return updated.map((slot, index) => ({ ...slot, order: index }));
    });
    toast.success('Candidate removed from session');
  };

  const updateCandidateSlotDuration = (slotId: string, duration: number) => {
    setMultiCandidateSlots(prev => prev.map(slot => 
      slot.id === slotId ? { ...slot, duration } : slot
    ));
  };

  const moveCandidateSlot = (slotId: string, direction: 'up' | 'down') => {
    setMultiCandidateSlots(prev => {
      const index = prev.findIndex(slot => slot.id === slotId);
      if (index === -1) return prev;
      
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      
      const updated = [...prev];
      [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
      
      // Update order values
      return updated.map((slot, idx) => ({ ...slot, order: idx }));
    });
  };

  const calculateSlotTimes = () => {
    if (!multiBaseStartTime || multiCandidateSlots.length === 0) return [];
    
    // Use consistent ISO format for all times
    const baseStart = new Date(multiBaseStartTime);
    let currentTime = new Date(baseStart.getTime());
    
    return multiCandidateSlots.map(slot => {
      const startTime = new Date(currentTime.getTime());
      const endTime = new Date(currentTime.getTime() + slot.duration * 60000);
      currentTime = new Date(endTime.getTime()); // Move to next slot
      
      return {
        ...slot,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      };
    });
  };

  const getTotalDuration = () => {
    return multiCandidateSlots.reduce((total, slot) => total + slot.duration, 0);
  };

  const formatTimeRange = (startTime: string, duration: number) => {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + duration * 60000);
    
    const formatTime = (date: Date) => {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    };
    
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  const handleScheduleMultiInterview = async () => {
    if (!state.user?._id) {
      toast.error('Please log in to schedule interviews');
      return;
    }
    
    if (!calendarStatus.connected) {
      toast.error('Please connect your calendar first');
      return;
    }

    if (!multiBaseStartTime) {
      toast.error('Please select a start time');
      return;
    }

    if (multiCandidateSlots.length < 2) {
      toast.error('Please add at least 2 candidates for a multi-candidate interview');
      return;
    }

    setIsScheduling(true);
    setServerError(null);

    try {
      const slotsWithTimes = calculateSlotTimes();
      const totalDuration = getTotalDuration();
      
      // Fix timezone issue: ensure both start and end times are in the same format
      // multiBaseStartTime is a datetime-local string (e.g., '2025-09-06T02:55')
      // We need to keep both times consistent - either both as datetime-local or both as ISO
      const startDateTime = new Date(multiBaseStartTime);
      const endDateTime = new Date(startDateTime.getTime() + totalDuration * 60000);
      
      // Convert both to ISO format to ensure consistency
      const baseStartTimeISO = startDateTime.toISOString();
      const sessionEndTimeISO = endDateTime.toISOString();
      
      console.log('Multi-candidate time calculation:', {
        originalStartTime: multiBaseStartTime,
        startTimeISO: baseStartTimeISO,
        endTimeISO: sessionEndTimeISO,
        totalDurationMinutes: totalDuration
      });
      
      // Prepare additional participants
      const additionalParticipants = multiAdditionalParticipants.map(p => ({
        email: p.email,
        name: p.name,
        role: p.role
      }));

      const multiScheduleData = {
        sessionType: 'multi-candidate',
        baseStartTime: baseStartTimeISO,  // Use ISO format
        sessionEndTime: sessionEndTimeISO,  // Use ISO format
        totalDuration,
        interviewType: multiInterviewType,
        location: multiLocation,
        provider: selectedProvider,
        addNotetaker: multiAddNotetaker,
        // New fields for interview questions
        sendQuestionsToInterviewers: multiSendQuestionsToInterviewers,
        questionsSendTime: multiQuestionsSendTime,
        selectedQuestionIds: selectedQuestionIds,
        additionalInterviewers: additionalParticipants,
        candidateSlots: slotsWithTimes.map(slot => ({
          candidateName: slot.candidateName,
          candidateEmail: slot.candidateEmail,
          candidateId: slot.candidateId,
          jobId: slot.jobId || jobId,
          stageId: stageId, // Pass the stageId from props
          jobTitle: slot.jobTitle,
          startTime: slot.startTime,
          endTime: slot.endTime,
          duration: slot.duration,
          notes: slot.notes,
          order: slot.order
        })),
        skipAvailabilityCheck: skipAvailabilityCheck,
        sendCustomEmail: multiSendCustomEmail,
        emailTemplate: multiEmailTemplate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      
      console.log('📤 Sending multi-candidate schedule data:', multiScheduleData);
      
      const response = await interviewService.scheduleMultiCandidateInterview(multiScheduleData);

      const successCount = response?.successCount ?? response?.interviews?.length ?? 0;
      const queuedRetryCount = response?.queuedRetryCount ?? response?.queuedRetries?.length ?? 0;
      const failedCount = response?.failedCount ?? response?.errors?.length ?? 0;

      if (queuedRetryCount > 0 || failedCount > 0) {
        toast.success(`Scheduled ${successCount} interviews. ${queuedRetryCount} slot(s) queued for retry.`);
      } else {
        toast.success(`Successfully scheduled ${successCount} interviews in one session!`);
      }
      onScheduled?.(response);
    } catch (error: any) {
      console.error('Multi-interview scheduling error:', error);
      
      const errorMessage = error?.response?.data?.message || 
                          error?.response?.data?.error || 
                          error?.message || 
                          'Failed to schedule multi-candidate interview';
      setServerError(errorMessage);

      const apiErrorData = extractApiErrorData(error) || {};
      const errorCode = apiErrorData?.error || error?.message;
      if (isTeamsScopeErrorCode(errorCode)) {
        showTeamsScopeErrorModal(error);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsScheduling(false);
    }
  };

  const initializeEmailTemplate = () => {
    // No need to hardcode organization name here - template uses {{organizationName}} variable
    // which is replaced by the backend with the correct organization name
    // Use the DEFAULT_EMAIL_TEMPLATE constant defined at component initialization
    setFormData(prev => ({ ...prev, emailTemplate: DEFAULT_EMAIL_TEMPLATE }));
    setMultiEmailTemplate(DEFAULT_EMAIL_TEMPLATE);
  };

  const getInterviewTypeLabel = (type: 'video' | 'phone' | 'in_person') => {
    if (type === 'phone') return 'Phone Call';
    if (type === 'in_person') return 'In Person';
    return 'Video Call';
  };

  const formatPreviewDateTime = (dateValue?: string) => {
    if (!dateValue) {
      return { interviewDate: '', interviewTime: '' };
    }

    const parsed = new Date(dateValue);
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

  const interviewerName =
    [state.user?.profile?.firstName, state.user?.profile?.lastName]
      .filter(Boolean)
      .join(' ') ||
    (state.user as any)?.fullName ||
    state.user?.email ||
    '';

  const organizationName =
    (state.user as any)?.organization?.name ||
    (state.user as any)?.currentOrganizationName ||
    state.user?.company?.name ||
    'Organization';

  const singleTemplatePreviewData = useMemo(() => {
    const { interviewDate, interviewTime } = formatPreviewDateTime(formData.startTime);
    const meetingLinkCandidate = formData.location || '';
    const previewMeetingLink = /^https?:\/\//i.test(meetingLinkCandidate) ? meetingLinkCandidate : '';
    const previewJobLink =
      jobId && typeof window !== 'undefined'
        ? `${window.location.origin}/public/jobs/${jobId}`
        : '';

    return {
      candidateName: candidateName || '',
      jobTitle: jobTitle || '',
      interviewDate,
      interviewTime,
      duration: formData.duration,
      interviewType: getInterviewTypeLabel(formData.type),
      meetingLink: previewMeetingLink,
      notes: formData.notes || '',
      interviewerName,
      interviewerEmail: state.user?.email || '',
      organizationName,
      jobLink: previewJobLink,
      jobDetailsPdfAttached: true
    };
  }, [
    candidateName,
    formData.duration,
    formData.location,
    formData.notes,
    formData.startTime,
    formData.type,
    interviewerName,
    jobId,
    jobTitle,
    organizationName,
    state.user?.email
  ]);

  const multiTemplatePreviewData = useMemo(() => {
    const firstSlot = multiCandidateSlots?.[0];
    const previewStartTime = firstSlot?.startTime || multiBaseStartTime;
    const { interviewDate, interviewTime } = formatPreviewDateTime(previewStartTime);
    const meetingLinkCandidate = multiLocation || '';
    const previewMeetingLink = /^https?:\/\//i.test(meetingLinkCandidate) ? meetingLinkCandidate : '';
    const previewJobId = (firstSlot as any)?.jobId || jobId;
    const previewJobLink =
      previewJobId && typeof window !== 'undefined'
        ? `${window.location.origin}/public/jobs/${previewJobId}`
        : '';

    return {
      candidateName: firstSlot?.candidateName || candidateName || '',
      jobTitle: firstSlot?.jobTitle || jobTitle || '',
      interviewDate,
      interviewTime,
      duration: firstSlot?.duration || formData.duration || '',
      interviewType: getInterviewTypeLabel(multiInterviewType),
      meetingLink: previewMeetingLink,
      notes: firstSlot?.notes || '',
      interviewerName,
      interviewerEmail: state.user?.email || '',
      organizationName,
      jobLink: previewJobLink,
      jobDetailsPdfAttached: true
    };
  }, [
    candidateName,
    formData.duration,
    interviewerName,
    jobId,
    jobTitle,
    multiBaseStartTime,
    multiCandidateSlots,
    multiInterviewType,
    multiLocation,
    organizationName,
    state.user?.email
  ]);

  return (
    <div className="flex flex-col h-full max-h-[calc(80vh-120px)] overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab = value as 'single' | 'multi';
          setActiveTab(nextTab);
          if (nextTab === 'multi') {
            setShowMultiInterviewModal(true);
          }
        }}
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
      >
        <div className="pb-2">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="single" className="text-xs sm:text-sm">Single interview</TabsTrigger>
            <TabsTrigger value="multi" className="text-xs sm:text-sm relative">
              Multi-candidate
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded font-medium">
                BETA
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

          <TabsContent value="single" className="mt-0 flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto p-3 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
          {/* Participants Section */}
          <div className="space-y-3 sm:space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <Label className="text-sm sm:text-base font-medium">Interview Participants</Label>
              <Dialog open={showAddParticipantDialog} onOpenChange={setShowAddParticipantDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                    <span className="text-xs sm:text-sm">Add Participant</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl w-[95vw] sm:w-[90vw] max-h-[85vh] flex flex-col overflow-hidden min-h-0 scheduler-dialog">
                  <DialogHeader className="pb-2">
                    <DialogTitle className="text-base sm:text-lg">Add Interview Participant</DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm">
                      Add team members or external participants to this interview
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="flex-1 overflow-y-auto space-y-4 sm:space-y-6 px-4 sm:px-6 pb-4">
                    {/* Organization Members */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Team Members
                      </h4>
                      {loadingMembers ? (
                        <div className="space-y-2">
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className="flex items-center space-x-3 p-3 border rounded-lg">
                              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
                              <div className="flex-1 space-y-1">
                                <div className="w-1/3 h-3 bg-gray-200 rounded animate-pulse" />
                                <div className="w-1/4 h-2 bg-gray-200 rounded animate-pulse" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : organizationMembers.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto space-y-2 p-1">
                          {organizationMembers
                            .filter(member => member.user._id !== state.user?._id && member.status === 'active')
                            .map((member) => {
                              const memberName = member.user.profile?.firstName && member.user.profile?.lastName 
                                ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
                                : member.user.email;
                              
                              const isAlreadyAdded = participants.some(p => p.email === member.user.email);
                              
                              return (
                                <div key={member._id} className="flex items-center justify-between p-3 border rounded-lg">
                                  <div className="flex items-center space-x-3">
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback className="text-xs">
                                        {getParticipantInitials(memberName)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <p className="text-sm font-medium">{memberName}</p>
                                      <p className="text-xs text-gray-500">{member.user.email}</p>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={isAlreadyAdded ? "secondary" : "outline"}
                                    disabled={isAlreadyAdded}
                                    onClick={() => addMemberAsParticipant(member)}
                                  >
                                    {isAlreadyAdded ? 'Added' : 'Add'}
                                  </Button>
                                </div>
                              );
                            })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 text-center py-4">
                          No team members available
                        </p>
                      )}
                    </div>

                    {/* External Participant Form */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        External Participant
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="participantEmail">Email Address</Label>
                          <Input
                            id="participantEmail"
                            type="email"
                            placeholder="participant@company.com"
                            value={newParticipantEmail}
                            onChange={(e) => setNewParticipantEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="participantName">Full Name</Label>
                          <Input
                            id="participantName"
                            placeholder="John Doe"
                            value={newParticipantName}
                            onChange={(e) => setNewParticipantName(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="participantRole">Role in Interview</Label>
                        <Select value={newParticipantRole} onValueChange={(value: 'observer' | 'interviewer') => setNewParticipantRole(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                            <SelectItem value="observer">Observer</SelectItem>
                            <SelectItem value="interviewer">Interviewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button 
                        onClick={addExternalParticipant}
                        className="w-full"
                        disabled={!newParticipantEmail.trim() || !newParticipantName.trim()}
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add External Participant
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Current Participants */}
            <div className="space-y-3">
              {participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {getParticipantInitials(participant.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{participant.name}</p>
                        <Badge className={getRoleColor(participant.role)} variant="outline">
                          {participant.role}
                        </Badge>
                        {participant.isRequired && (
                          <Badge variant="secondary" className="text-xs">Required</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{participant.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!participant.isRequired && participant.role !== 'candidate' && (
                      <Select 
                        value={participant.role}
                        onValueChange={(value: 'observer' | 'interviewer') => updateParticipantRole(participant.id, value)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                          <SelectItem value="observer">Observer</SelectItem>
                          <SelectItem value="interviewer">Interviewer</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {!participant.isRequired && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeParticipant(participant.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        {/* Provider Selection */}
          <div className="space-y-2">
            <Label className="text-sm sm:text-base">Meeting Provider</Label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {providers.map((provider) => (
                <div key={provider.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedProvider(provider.id)}
                    className={`w-full p-2 sm:p-3 rounded-lg border-2 transition-all duration-200 ${
                      selectedProvider === provider.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-1 sm:gap-2">
                      <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full ${provider.color} flex items-center justify-center text-white`}>
                        {provider.icon}
                      </div>
                      <span className="text-xs sm:text-sm font-medium">{provider.name}</span>
                    </div>
                  </button>
                  {defaultProvider === provider.id && (
                    <Badge className="absolute -top-2 -right-2 bg-green-500 text-white text-xs">
                      Default
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            
            {/* Set Default Provider */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => saveDefaultProvider(selectedProvider)}
                disabled={defaultProvider === selectedProvider}
              >
                Set as Default
              </Button>
              <span className="text-xs text-gray-500">
                Default: {providers.find(p => p.id === defaultProvider)?.name}
              </span>
            </div>
          </div>

          {selectedProvider === 'microsoft' && (
            <Alert variant="warning" className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Microsoft Teams configuration required</AlertTitle>
              <AlertDescription>
                <p className="mt-2">
                  For the notetaker bot to join Teams meetings reliably, your Microsoft 365 admin must configure:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>
                    Allow participants to join before meeting organizer joins: <strong>ENABLED</strong>
                  </li>
                  <li>
                    Waiting room: <strong>DISABLED</strong> (or bot allowlisted)
                  </li>
                  <li>
                    Cloud recording: <strong>ENABLED</strong>
                  </li>
                  <li>
                    Transcription: <strong>ENABLED</strong>
                  </li>
                </ul>
                <p className="mt-2">
                  <a
                    href="/docs/teams-admin-setup"
                    className="text-blue-700 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View detailed setup guide -&gt;
                  </a>
                </p>
              </AlertDescription>
            </Alert>
          )}
          
          {/* Calendar Connection Status */}
          <div className="space-y-2">
            <Label className="text-sm sm:text-base">Calendar Connection</Label>
            {calendarStatus.connected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-700">
                  Calendar connected ({calendarStatus.provider})
                    </span>
                    {calendarStatus.verified === false && (
                      <Badge variant="outline" className="ml-2 bg-amber-50 text-amber-700 border-amber-300">
                        Verification needed
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Action buttons for connected calendar */}
                <div className="flex flex-wrap gap-2">
                  {calendarStatus.verified === false && (
                    <Button 
                      onClick={handleVerifyGrant} 
                      variant="outline" 
                      size="sm"
                      disabled={isVerifying}
                    >
                      {isVerifying ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Verify Access
                        </>
                      )}
                    </Button>
                  )}
                  
                  <Button 
                    onClick={() => handleConnectCalendar(selectedProvider, false)} 
                    variant="outline" 
                    size="sm"
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Reconnect {providers.find(p => p.id === selectedProvider)?.name}
                      </>
                    )}
                  </Button>
                  
                  {/* Show reset button if stuck in loading state */}
                  {(isConnecting || isSwitchingAccount) && (
                    <Button 
                      onClick={handleManualReset}
                      variant="destructive" 
                      size="sm"
                      title="Reset if stuck in loading state"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                  )}
                  
                  <Button 
                    onClick={checkCalendarStatus} 
                    variant="ghost" 
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Connect your calendar to check availability and create events automatically.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    onClick={() => handleConnectCalendar(selectedProvider, false)} 
                    variant="outline" 
                    size="sm"
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                Connect {providers.find(p => p.id === selectedProvider)?.name}
                      </>
                    )}
                  </Button>
                  
                  {/* Show reset button if stuck in connecting state */}
                  {isConnecting && (
                    <Button 
                      onClick={handleManualReset}
                      variant="destructive" 
                      size="sm"
                      title="Reset if stuck in connecting state"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Reset
              </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Interview Type */}
        <div className="space-y-2">
          <Label htmlFor="type" className="text-sm sm:text-base">Interview Type</Label>
          <Select
            value={formData.type}
            onValueChange={(value: any) => setFormData(prev => ({ ...prev, type: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[10001]">
              <SelectItem value="video">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  Video Call
                </div>
              </SelectItem>
              <SelectItem value="phone">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone Call
                </div>
              </SelectItem>
              <SelectItem value="in_person">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  In Person
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date and Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-2">
            <Label htmlFor="startTime" className="text-sm sm:text-base">
              Start Time
              <span className="text-xs text-muted-foreground ml-2">(24-hour format)</span>
            </Label>
            <div className="relative">
            <Input
              id="startTime"
              type="datetime-local"
              value={formData.startTime}
              min={getMinDateTime()}
              onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
            />
              {formData.startTime && (
                <div className="text-xs text-muted-foreground mt-1">
                  {(() => {
                    const date = new Date(formData.startTime + ':00');
                    return date.toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="duration" className="text-sm sm:text-base">Duration (minutes)</Label>
            <Select
              value={formData.duration.toString()}
              onValueChange={(value) => setFormData(prev => ({ ...prev, duration: parseInt(value) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[10001]">
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="45">45 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="90">1.5 hours</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Location (for in-person interviews) */}
        {formData.type === 'in_person' && (
          <div className="space-y-2">
            <Label htmlFor="location" className="text-sm sm:text-base">Location</Label>
            <Input
              id="location"
              placeholder="Enter meeting location"
              value={formData.location}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
            />
          </div>
        )}

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes" className="text-sm sm:text-base">Notes (Optional)</Label>
          <Textarea
            id="notes"
            placeholder="Add any additional notes for the interview..."
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
          />
        </div>

        {/* Custom Subject Line */}
        <div className="space-y-2">
          <Label htmlFor="subject" className="text-sm sm:text-base">Email Subject Line (Optional)</Label>
          <Input
            id="subject"
            placeholder={`Interview Invitation: ${jobTitle} - [Auto Date]`}
            value={formData.subject}
            onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to use default subject line. You can customize the email subject for this interview.
          </p>
        </div>

        {/* AI Notetaker */}
        {formData.type === 'video' && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="addNotetaker"
                checked={addNotetaker}
                onCheckedChange={(checked) => setAddNotetaker(checked as boolean)}
              />
              <label htmlFor="addNotetaker" className="text-sm font-medium text-gray-700">
                Add AI Notetaker to record and transcribe the interview
              </label>
            </div>
            <p className="text-xs text-gray-500 ml-6">
              The AI notetaker will automatically join the meeting to provide transcripts and summaries.
              All participants will be notified that the meeting is being recorded.
            </p>
          </div>
        )}
        
        {/* Communication Tabs */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <Tabs
            value={singleCommunicationTab}
            onValueChange={(value) => setSingleCommunicationTab(value as 'email' | 'questions')}
            className="space-y-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email" className="text-xs sm:text-sm">Email Notification</TabsTrigger>
              <TabsTrigger value="questions" className="text-xs sm:text-sm">Interviewer Questions</TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="mt-0">
              <div className="space-y-4 border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-medium">Email Notification</h4>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sendCustomEmail"
                      checked={formData.sendCustomEmail}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, sendCustomEmail: checked as boolean }))}
                    />
                    <label htmlFor="sendCustomEmail" className="text-sm font-medium text-gray-700">
                      Send custom email notification
                    </label>
                  </div>
                </div>

                {formData.sendCustomEmail && (
                  <div className="space-y-2">
                    <EmailTemplateDesigner
                      value={formData.emailTemplate}
                      onChange={(nextTemplate) => setFormData(prev => ({ ...prev, emailTemplate: nextTemplate }))}
                      previewData={singleTemplatePreviewData}
                      helperText="Pick one of the design presets, then customize with variables and HTML."
                    />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="questions" className="mt-0">
              <div className="space-y-4 border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-medium">Questions for Interviewers</h4>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sendQuestionsToInterviewers"
                      checked={formData.sendQuestionsToInterviewers}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, sendQuestionsToInterviewers: checked as boolean }))}
                    />
                    <label htmlFor="sendQuestionsToInterviewers" className="text-sm font-medium text-gray-700">
                      Send selected questions to interviewers
                    </label>
                  </div>
                </div>

                {formData.sendQuestionsToInterviewers && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="questionsSendTime">Send questions before interview</Label>
                      <Select
                        value={formData.questionsSendTime.toString()}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, questionsSendTime: parseInt(value) }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 minutes before</SelectItem>
                          <SelectItem value="10">10 minutes before</SelectItem>
                          <SelectItem value="15">15 minutes before</SelectItem>
                          <SelectItem value="30">30 minutes before</SelectItem>
                          <SelectItem value="45">45 minutes before</SelectItem>
                          <SelectItem value="60">1 hour before</SelectItem>
                          <SelectItem value="120">2 hours before</SelectItem>
                          <SelectItem value="240">4 hours before</SelectItem>
                          <SelectItem value="480">8 hours before</SelectItem>
                          <SelectItem value="1440">24 hours before</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border rounded-lg p-4 bg-gray-50">
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                          <MessageCircle className="h-5 w-5 text-primary" />
                          <h5 className="font-medium">Interview Questions</h5>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowQuestionSelector(!showQuestionSelector)}
                        >
                          {showQuestionSelector ? 'Hide Questions' : 'Select Questions'}
                        </Button>
                      </div>

                      {showQuestionSelector ? (
                        <InterviewQuestionSelector
                          jobId={jobId}
                          selectedQuestionIds={selectedQuestionIds}
                          onSelectionChange={setSelectedQuestionIds}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {selectedQuestionIds.length === 0 ? (
                            <p>No questions selected. Click "Select Questions" to choose questions to send to interviewers.</p>
                          ) : (
                            <p>{selectedQuestionIds.length} questions selected for interviewers. Click "Select Questions" to modify selection.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Skip Availability Check - Temporary for testing */}
        <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="skipAvailability"
              checked={skipAvailabilityCheck}
              onCheckedChange={(checked) => setSkipAvailabilityCheck(checked as boolean)}
            />
            <label htmlFor="skipAvailability" className="text-sm font-medium text-amber-700">
              Skip availability check (Testing only)
            </label>
          </div>
          <p className="text-xs text-amber-600 ml-6">
            This will bypass calendar conflict checking. Use only for testing.
          </p>
        </div>

        {/* Scheduling Conflicts */}
        {showConflicts && conflicts.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <div className="space-y-2">
                <p className="font-medium">Scheduling conflicts detected:</p>
                {conflicts.map((conflict, index) => (
                  <div key={index} className="text-sm">
                    <strong>{conflict.email}</strong> has conflicts during this time
                  </div>
                ))}
                <p className="text-sm">Please choose a different time slot.</p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Server Error Display */}
        {serverError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{serverError}</span>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setServerError(null)}
                className="h-auto p-1"
              >
                <X className="h-3 w-3" />
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <Button
            onClick={handleSchedule}
            disabled={isScheduling || !formData.startTime || !calendarStatus.connected || calendarStatus.verified === false}
            className="flex-1"
          >
            {isScheduling ? (
              <>
                <Clock className="mr-2 h-4 w-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Calendar className="mr-2 h-4 w-4" />
                Schedule Interview ({participants.length} participants)
              </>
            )}
          </Button>
          
          {onCancel && (
            <Button onClick={onCancel} variant="outline">
              Cancel
            </Button>
          )}
        </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="multi" className="mt-0 flex-1 overflow-hidden">
            <Dialog
              open={showMultiInterviewModal}
              onOpenChange={(open) => {
                setShowMultiInterviewModal(open);
                if (!open) {
                  setActiveTab('single');
                }
              }}
            >
              <DialogContent className="w-[98vw] max-w-[1600px] h-[96vh] max-h-[96vh] p-0 overflow-hidden flex flex-col gap-0 scheduler-dialog">
                <DialogHeader className="px-4 sm:px-6 py-3 border-b">
                  <DialogTitle className="text-base sm:text-lg">Multi-candidate Interview Scheduler</DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm">
                    Schedule an entire interview session with one shared workflow.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6">
                  <div className="space-y-4 sm:space-y-6">
              {/* Beta Disclaimer */}
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-orange-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-orange-800 mb-1">Beta Feature</h4>
                    <p className="text-sm text-orange-700">
                      Multi-candidate interviews are currently in testing. While fully functional, some features may be refined based on user feedback. Please report any issues to our support team.
                    </p>
                  </div>
                </div>
              </div>
              {/* Calendar Connection Status - Reuse from single */}
              <div className="space-y-2">
                <Label>Calendar Connection</Label>
                {calendarStatus.connected && calendarStatus.verified ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700">
                        Calendar connected ({calendarStatus.provider})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        onClick={() => handleConnectCalendar(selectedProvider, false)} 
                        variant="outline" 
                        size="sm"
                        disabled={isConnecting}
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Reconnect {providers.find(p => p.id === selectedProvider)?.name}
                          </>
                        )}
                      </Button>
                      
                      {/* Show reset button if stuck in loading state */}
                      {(isConnecting || isSwitchingAccount) && (
                        <Button 
                          onClick={handleManualReset}
                          variant="destructive" 
                          size="sm"
                          title="Reset if stuck in loading state"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                      
                      <Button 
                        onClick={checkCalendarStatus} 
                        variant="ghost" 
                        size="sm"
                        title="Refresh calendar status"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : calendarStatus.connected && !calendarStatus.verified ? (
                  <div className="space-y-2">
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Calendar Connection Expired</AlertTitle>
                      <AlertDescription>
                        Your calendar connection has expired. Please reconnect to schedule interviews.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        onClick={() => handleConnectCalendar(selectedProvider, false)} 
                        variant="outline" 
                        size="sm"
                        disabled={isConnecting}
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Reconnecting...
                          </>
                        ) : (
                          <>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Reconnect {providers.find(p => p.id === selectedProvider)?.name}
                          </>
                        )}
                      </Button>
                      
                      {/* Show reset button if stuck in connecting state */}
                      {isConnecting && (
                        <Button 
                          onClick={handleManualReset}
                          variant="destructive" 
                          size="sm"
                          title="Reset if stuck in connecting state"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                      
                      <Button 
                        onClick={checkCalendarStatus} 
                        variant="ghost" 
                        size="sm"
                        title="Refresh calendar status"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Calendar Not Connected</AlertTitle>
                      <AlertDescription>
                        Connect your calendar to schedule multi-candidate interviews.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        onClick={() => handleConnectCalendar(selectedProvider, false)} 
                        variant="outline" 
                        size="sm"
                        disabled={isConnecting}
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Connect {providers.find(p => p.id === selectedProvider)?.name}
                          </>
                        )}
                      </Button>
                      
                      {/* Show reset button if stuck in connecting state */}
                      {isConnecting && (
                        <Button 
                          onClick={handleManualReset}
                          variant="destructive" 
                          size="sm"
                          title="Reset if stuck in connecting state"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Session Configuration */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                <h4 className="text-base font-medium">Session Configuration</h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="multiStartTime">Session Start Time</Label>
                    <Input
                      id="multiStartTime"
                      type="datetime-local"
                      value={multiBaseStartTime}
                      min={getMinDateTime()}
                      onChange={(e) => setMultiBaseStartTime(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Total Duration</Label>
                    <div className="flex items-center gap-2 p-2 border rounded-md bg-muted">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {getTotalDuration()} minutes ({Math.floor(getTotalDuration() / 60)}h {getTotalDuration() % 60}m)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interview Type and Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="multiType">Interview Type</Label>
                  <Select
                    value={multiInterviewType}
                    onValueChange={(value: any) => setMultiInterviewType(value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[10001]">
                      <SelectItem value="video">
                        <div className="flex items-center gap-2">
                          <Video className="h-4 w-4" />
                          Video Call (Same link for all)
                        </div>
                      </SelectItem>
                      <SelectItem value="phone">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4" />
                          Phone Call
                        </div>
                      </SelectItem>
                      <SelectItem value="in_person">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          In Person
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {multiInterviewType === 'in_person' && (
                  <div className="space-y-2">
                    <Label htmlFor="multiLocation">Location</Label>
                    <Input
                      id="multiLocation"
                      placeholder="Enter meeting location"
                      value={multiLocation}
                      onChange={(e) => setMultiLocation(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {multiInterviewType === 'video' && (
                <Alert className="border-blue-200 bg-blue-50">
                  <Video className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    All candidates will use the same meeting link. Each candidate will receive a calendar invite for their specific time slot only.
                  </AlertDescription>
                </Alert>
              )}

              {/* Candidate Slots Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-medium">Candidate Time Slots</h4>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      loadSystemCandidates(); // Reload candidates when opening dialog
                      setShowAddCandidateDialog(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Candidate
                  </Button>
                </div>

                {/* Candidate List */}
                {multiCandidateSlots.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed rounded-lg">
                    <Users className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">No candidates added yet</p>
                    <p className="text-xs text-gray-500 mt-1">Add at least 2 candidates to create a multi-candidate session</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {multiCandidateSlots.map((slot, index) => {
                      const slotTimes = calculateSlotTimes();
                      const slotWithTime = slotTimes[index];
                      
                      return (
                        <div key={slot.id} className="flex items-center gap-3 p-4 border rounded-lg bg-white">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm">
                            {index + 1}
                          </div>
                          
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{slot.candidateName}</p>
                              <Badge variant="outline" className="text-xs">
                                {slot.jobTitle}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-500">{slot.candidateEmail}</p>
                            {multiBaseStartTime && slotWithTime && (
                              <p className="text-sm text-blue-600 mt-1">
                                {formatTimeRange(slotWithTime.startTime, slot.duration)}
                              </p>
                            )}
                            {slot.notes && (
                              <p className="text-xs text-gray-500 mt-1 italic">{slot.notes}</p>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Select
                              value={slot.duration.toString()}
                              onValueChange={(value) => updateCandidateSlotDuration(slot.id, parseInt(value))}
                            >
                              <SelectTrigger className="w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                                <SelectItem value="15">15 min</SelectItem>
                                <SelectItem value="30">30 min</SelectItem>
                                <SelectItem value="45">45 min</SelectItem>
                                <SelectItem value="60">1 hour</SelectItem>
                                <SelectItem value="90">1.5 hours</SelectItem>
                                <SelectItem value="120">2 hours</SelectItem>
                              </SelectContent>
                            </Select>
                            
                            <div className="flex flex-col gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => moveCandidateSlot(slot.id, 'up')}
                                disabled={index === 0}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => moveCandidateSlot(slot.id, 'down')}
                                disabled={index === multiCandidateSlots.length - 1}
                                className="h-6 w-6 p-0"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                            
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeCandidateSlot(slot.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* AI Notetaker for Multi */}
              {multiInterviewType === 'video' && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="multiAddNotetaker"
                      checked={multiAddNotetaker}
                      onCheckedChange={(checked) => setMultiAddNotetaker(checked as boolean)}
                    />
                    <label htmlFor="multiAddNotetaker" className="text-sm font-medium text-gray-700">
                      Add AI Notetaker for the entire session
                    </label>
                  </div>
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800">
                      <strong>One notetaker for all:</strong> The AI notetaker will record the entire session continuously. 
                      Transcripts will be automatically segmented by candidate based on their scheduled time slots.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Additional Participants for Multi */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">Additional Interviewers/Observers</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowMultiAddParticipantDialog(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Participant
                  </Button>
                </div>
                
                {multiAdditionalParticipants.length > 0 && (
                  <div className="space-y-2">
                    {multiAdditionalParticipants.map((participant) => (
                      <div key={participant.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {participant.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{participant.name}</p>
                            <p className="text-xs text-gray-500">{participant.email}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {participant.role}
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setMultiAdditionalParticipants(prev => 
                              prev.filter(p => p.id !== participant.id)
                            );
                          }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Communication Tabs */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <Tabs
                  value={multiCommunicationTab}
                  onValueChange={(value) => setMultiCommunicationTab(value as 'email' | 'questions')}
                  className="space-y-4"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="email" className="text-xs sm:text-sm">Email Notifications</TabsTrigger>
                    <TabsTrigger value="questions" className="text-xs sm:text-sm">Interviewer Questions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="email" className="mt-0">
                    <div className="space-y-4 border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-medium">Email Notifications</h4>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="multiSendCustomEmail"
                            checked={multiSendCustomEmail}
                            onCheckedChange={(checked) => setMultiSendCustomEmail(checked as boolean)}
                          />
                          <label htmlFor="multiSendCustomEmail" className="text-sm font-medium text-gray-700">
                            Send custom email to each candidate
                          </label>
                        </div>
                      </div>

                      {multiSendCustomEmail && (
                        <div className="space-y-2">
                          <EmailTemplateDesigner
                            value={multiEmailTemplate}
                            onChange={setMultiEmailTemplate}
                            previewData={multiTemplatePreviewData}
                            label="Email Template (sent to each candidate)"
                            helperText="Choose a template style, customize it, and each candidate gets their own rendered version."
                          />
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="questions" className="mt-0">
                    <div className="space-y-4 border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-medium">Questions for Interviewers</h4>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="multiSendQuestionsToInterviewers"
                            checked={multiSendQuestionsToInterviewers}
                            onCheckedChange={(checked) => setMultiSendQuestionsToInterviewers(checked as boolean)}
                          />
                          <label htmlFor="multiSendQuestionsToInterviewers" className="text-sm font-medium text-gray-700">
                            Send selected questions to interviewers
                          </label>
                        </div>
                      </div>

                      {multiSendQuestionsToInterviewers && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="multiQuestionsSendTime">Send questions before interview</Label>
                            <Select
                              value={multiQuestionsSendTime.toString()}
                              onValueChange={(value) => setMultiQuestionsSendTime(parseInt(value))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="5">5 minutes before</SelectItem>
                                <SelectItem value="15">15 minutes before</SelectItem>
                                <SelectItem value="30">30 minutes before</SelectItem>
                                <SelectItem value="60">1 hour before</SelectItem>
                                <SelectItem value="120">2 hours before</SelectItem>
                                <SelectItem value="1440">24 hours before</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="border rounded-lg p-4 bg-gray-50">
                            <div className="flex justify-between items-center mb-4">
                              <div className="flex items-center gap-2">
                                <MessageCircle className="h-5 w-5 text-primary" />
                                <h5 className="font-medium">Interview Questions</h5>
                              </div>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowQuestionSelector(!showQuestionSelector)}
                              >
                                {showQuestionSelector ? 'Hide Questions' : 'Select Questions'}
                              </Button>
                            </div>

                            {showQuestionSelector ? (
                              <InterviewQuestionSelector
                                jobId={selectedJobId || undefined}
                                selectedQuestionIds={selectedQuestionIds}
                                onSelectionChange={setSelectedQuestionIds}
                              />
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                {selectedQuestionIds.length === 0 ? (
                                  <p>No questions selected. Click "Select Questions" to choose questions to send to interviewers.</p>
                                ) : (
                                  <p>{selectedQuestionIds.length} questions selected for interviewers. Click "Select Questions" to modify selection.</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  onClick={handleScheduleMultiInterview}
                  disabled={
                    isScheduling || 
                    !multiBaseStartTime || 
                    multiCandidateSlots.length < 2 ||
                    !calendarStatus.connected
                  }
                  className="flex-1"
                >
                  {isScheduling ? (
                    <>
                      <Clock className="mr-2 h-4 w-4 animate-spin" />
                      Scheduling Session...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4" />
                      Schedule {multiCandidateSlots.length} Interviews ({getTotalDuration()} min total)
                    </>
                  )}
                </Button>
                
                {onCancel && (
                  <Button onClick={onCancel} variant="outline">
                    Cancel
                  </Button>
                )}
              </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>
      </Tabs>

      {/* Add Candidate Dialog */}
      <Dialog open={showAddCandidateDialog} onOpenChange={setShowAddCandidateDialog}>
            <DialogContent className="max-w-2xl w-[95vw] sm:w-[90vw] max-h-[85vh] flex flex-col overflow-hidden min-h-0 scheduler-dialog">
              <DialogHeader className="pb-2">
                <DialogTitle className="text-base sm:text-lg">Add Candidate {stageId ? 'from Stage' : 'from Pipeline'}</DialogTitle>
                <DialogDescription className="text-xs sm:text-sm">
                  Select a candidate {stageId ? 'from this interview stage' : 'from the job pipeline'} to add to the multi-candidate session
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-1 overflow-y-auto space-y-3 sm:space-y-4 px-4 sm:px-6">
                {/* Candidate Search and Selection */}
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <Label htmlFor="candidateSearch" className="text-sm font-medium">Search & Select Candidates</Label>
                    {systemCandidates.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const availableCandidates = systemCandidates.filter(c => 
                              !multiCandidateSlots.some(slot => slot.candidateId === c._id)
                            );
                            setSelectedCandidateIds(new Set(availableCandidates.map(c => c._id)));
                          }}
                          className="text-xs sm:text-sm"
                        >
                          Select All
                        </Button>
                        {selectedCandidateIds.size > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedCandidateIds(new Set())}
                            className="text-xs sm:text-sm"
                          >
                            Clear All
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      id="candidateSearch"
                      placeholder="Search candidates by name or email..."
                      value={candidateSearchTerm}
                      onChange={(e) => setCandidateSearchTerm(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadSystemCandidates}
                      disabled={loadingCandidates}
                      className="w-full sm:w-auto"
                    >
                      <RefreshCw className={`h-4 w-4 ${loadingCandidates ? 'animate-spin' : ''}`} />
                      <span className="ml-2 sm:hidden">Refresh</span>
                    </Button>
                  </div>
                  
                  {/* Candidate List */}
                  <div className="border rounded-md">
                    <ScrollArea className="h-[30vh] sm:h-[35vh] md:h-[40vh] p-2">
                    {loadingCandidates ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {systemCandidates
                          .filter(c => 
                            !candidateSearchTerm || 
                            `${c.firstName} ${c.lastName}`.toLowerCase().includes(candidateSearchTerm.toLowerCase()) ||
                            c.email?.toLowerCase().includes(candidateSearchTerm.toLowerCase()) ||
                            c.position?.toLowerCase().includes(candidateSearchTerm.toLowerCase())
                          )
                          .map((candidate) => {
                            const isSelected = selectedCandidateIds.has(candidate._id);
                            const isAlreadyAdded = multiCandidateSlots.some(slot => slot.candidateId === candidate._id);
                            
                            return (
                              <div
                                key={candidate._id}
                                onClick={() => {
                                  if (isAlreadyAdded) return;
                                  
                                  setSelectedCandidateIds(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(candidate._id)) {
                                      newSet.delete(candidate._id);
                                    } else {
                                      newSet.add(candidate._id);
                                    }
                                    return newSet;
                                  });
                                }}
                                className={`p-2 sm:p-3 rounded-lg cursor-pointer transition-colors ${
                                  isAlreadyAdded 
                                    ? 'bg-gray-50 opacity-50 cursor-not-allowed'
                                    : isSelected
                                    ? 'bg-blue-100 border-blue-500 border'
                                    : 'hover:bg-gray-100 border border-gray-200'
                                }`}
                              >
                                <div className="flex items-start gap-2 sm:gap-3">
                                  <Checkbox 
                                    checked={isSelected}
                                    disabled={isAlreadyAdded}
                                    className="pointer-events-none mt-1"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm sm:text-base truncate">
                                      {candidate.firstName} {candidate.lastName}
                                      {isAlreadyAdded && <span className="text-xs text-gray-500 ml-1 sm:ml-2">(Added)</span>}
                                    </p>
                                    <p className="text-xs sm:text-sm text-gray-500 truncate">{candidate.email}</p>
                                    {candidate.position && (
                                      <p className="text-xs text-gray-400 truncate">Position: {candidate.position}</p>
                                    )}
                                    {candidate.status && (
                                      <Badge variant="outline" className="mt-1 text-xs">
                                        {candidate.status}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        {systemCandidates.length === 0 && (
                          <div className="text-center py-4">
                            <p className="text-gray-500">
                              {stageId ? 'No candidates in this stage' : 'No candidates in the pipeline'}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {stageId ? 'Move candidates to this interview stage first' : 'Add candidates to the job pipeline first'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </ScrollArea>
                </div>
                </div>
                
                {/* Job Selection (Optional) */}
                <div className="space-y-2">
                  <Label htmlFor="jobSelection">Position for this Interview</Label>
                  <Select
                    value={selectedJobId || jobId || ''}
                    onValueChange={setSelectedJobId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a position..." />
                    </SelectTrigger>
                    <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                      {systemJobs.map((job) => (
                        <SelectItem key={job._id} value={job._id}>
                          {job.title} - {job.department}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Interview Duration */}
                <div className="space-y-2">
                  <Label htmlFor="candidateDuration">Interview Duration</Label>
                  <Select
                    value={newCandidateDuration.toString()}
                    onValueChange={(value) => setNewCandidateDuration(parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="candidateNotes">Notes (Optional)</Label>
                  <Textarea
                    id="candidateNotes"
                    placeholder="Any specific notes for this candidate's interview..."
                    value={newCandidateNotes}
                    onChange={(e) => setNewCandidateNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                
              </div>
              
              {/* Sticky Footer with Action Buttons */}
              <div className="border-t p-4 sm:p-6 bg-background">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <Button 
                    onClick={addCandidateSlots}
                    className="w-full sm:flex-1"
                    disabled={selectedCandidateIds.size === 0}
                  >
                    Add {selectedCandidateIds.size > 0 ? `${selectedCandidateIds.size} Candidate${selectedCandidateIds.size > 1 ? 's' : ''}` : 'to Session'}
                  </Button>
                  {selectedCandidateIds.size > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCandidateIds(new Set())}
                      className="w-full sm:w-auto"
                    >
                      Clear Selection
                    </Button>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Add Participant Dialog for Multi-Candidate */}
          <Dialog open={showMultiAddParticipantDialog} onOpenChange={setShowMultiAddParticipantDialog}>
            <DialogContent className="max-w-2xl w-[95vw] sm:w-[90vw] max-h-[85vh] flex flex-col overflow-hidden min-h-0 scheduler-dialog">
              <DialogHeader className="pb-2">
                <DialogTitle className="text-base sm:text-lg">Add Participant to Multi-Candidate Session</DialogTitle>
                <DialogDescription className="text-xs sm:text-sm">
                  Add team members or external participants who will join the entire interview session
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-1 overflow-y-auto space-y-4 sm:space-y-6 px-4 sm:px-6 pb-4">
                {/* Organization Members */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Team Members
                  </h4>
                  {loadingMembers ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-3 p-3 border rounded-lg">
                          <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
                          <div className="flex-1 space-y-1">
                            <div className="w-1/3 h-3 bg-gray-200 rounded animate-pulse" />
                            <div className="w-1/4 h-2 bg-gray-200 rounded animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : organizationMembers.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto space-y-2 p-1">
                      {organizationMembers
                        .filter(member => member.user._id !== state.user?._id && member.status === 'active')
                        .map((member) => {
                          const memberName = member.user.profile?.firstName && member.user.profile?.lastName 
                            ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
                            : member.user.email;
                          
                          const isAlreadyAdded = multiAdditionalParticipants.some(p => p.email === member.user.email);
                          
                          return (
                            <div key={member._id} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex items-center space-x-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-xs">
                                    {getParticipantInitials(memberName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">{memberName}</p>
                                  <p className="text-xs text-gray-500">{member.user.email}</p>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={isAlreadyAdded ? "secondary" : "outline"}
                                disabled={isAlreadyAdded}
                                onClick={() => addParticipantToMulti(member)}
                              >
                                {isAlreadyAdded ? 'Added' : 'Add'}
                              </Button>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No team members available
                    </p>
                  )}
                </div>

                {/* External Participant Form */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    External Participant
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="multiParticipantEmail">Email Address</Label>
                      <Input
                        id="multiParticipantEmail"
                        type="email"
                        placeholder="participant@company.com"
                        value={newParticipantEmail}
                        onChange={(e) => setNewParticipantEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="multiParticipantName">Full Name</Label>
                      <Input
                        id="multiParticipantName"
                        placeholder="John Doe"
                        value={newParticipantName}
                        onChange={(e) => setNewParticipantName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="multiParticipantRole">Role in Interview</Label>
                    <Select value={newParticipantRole} onValueChange={(value: 'observer' | 'interviewer') => setNewParticipantRole(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[10002]" style={{ position: 'fixed' }}>
                        <SelectItem value="observer">Observer</SelectItem>
                        <SelectItem value="interviewer">Interviewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button 
                    onClick={() => addParticipantToMulti()}
                    className="w-full"
                    disabled={!newParticipantEmail.trim() || !newParticipantName.trim()}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add External Participant
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

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
                      onClick={async () => {
                        setShowErrorModal(false);
                        setSelectedProvider('microsoft');
                        await handleConnectCalendar('microsoft', true);
                      }}
                    >
                      Reconnect Microsoft Scopes
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
