"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  MessageSquare,
  Send,
  User,
  Mail,
  FileText,
  Heart,
  ExternalLink,
  Loader2,
  Download,
  AlertCircle,
  CheckCircle,
  Shield,
  Calendar,
  Clock,
  MapPin,
  Award,
  TrendingUp,
  Users,
  Briefcase,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';
import interviewService from '@/services/interviewService';
import { apiRequest } from '@/services/apiConfig';
import { evaluateFormula } from '@/utils/formulaEvaluator';

interface InterviewQuestion {
  _id: string;
  question: string;
  type: string;
  category?: string;
  difficulty?: string;
}

interface CandidateInfo {
  id: string;
  name: string;
  email: string;
  resumeAvailable: boolean;
}

interface AccessibleResumeUrls {
  resumeAvailable: boolean;
  accessible: boolean;
  viewUrl?: string;
  downloadUrl?: string;
  candidateId?: string;
}

interface JobInfo {
  id: string;
  title: string;
  description?: string;
}

interface StageInfo {
  id: string;
  name: string;
  description?: string;
}

interface InterviewInfo {
  id: string;
  scheduledAt: string;
  duration: number;
  type: string;
  status: string;
}

interface PublicFeedbackForm {
  name: string;
  email: string;
}

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

interface ValidationState {
  userInfo: {
    name: { isValid: boolean; error?: string; touched: boolean };
    email: { isValid: boolean; error?: string; touched: boolean };
  };
  ratings: {
    overall: { isValid: boolean; error?: string };
    technical: { isValid: boolean; error?: string };
    communication: { isValid: boolean; error?: string };
    cultural: { isValid: boolean; error?: string };
  };
  feedback: {
    general: { isValid: boolean; error?: string; touched: boolean };
  };
  form: {
    isValid: boolean;
    canSubmit: boolean;
  };
}

export default function PublicFeedbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const interviewId = params.interviewId as string;
  const feedbackTokenFromUrl = searchParams.get('accessToken')?.trim() || null;
  const feedbackTokenStorageKey = `public-feedback-access:${interviewId}`;
  const [feedbackAccessToken, setFeedbackAccessToken] = useState<string | null>(() => feedbackTokenFromUrl);
  const [feedbackAccessResolved, setFeedbackAccessResolved] = useState(() => Boolean(feedbackTokenFromUrl));
  
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo | null>(null);
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [stageInfo, setStageInfo] = useState<StageInfo | null>(null);
  const [interviewInfo, setInterviewInfo] = useState<InterviewInfo | null>(null);
  const [feedbackFormConfig, setFeedbackFormConfig] = useState<any>(null);
  
  const [userInfo, setUserInfo] = useState<PublicFeedbackForm>({
    name: '',
    email: ''
  });

  // Check if user is logged in and auto-fill info
  const [isInternalUser, setIsInternalUser] = useState(false);
  const [internalUserData, setInternalUserData] = useState<any>(null);
  const isAuthenticatedInternalAccess = isInternalUser && !feedbackAccessToken;

  useEffect(() => {
    let storedToken = feedbackTokenFromUrl;

    try {
      if (storedToken) {
        sessionStorage.setItem(feedbackTokenStorageKey, storedToken);
      } else {
        storedToken = sessionStorage.getItem(feedbackTokenStorageKey)?.trim() || null;
      }
    } catch {
      // Storage can be unavailable in hardened/private browser contexts. The URL
      // capability still works for this page load and the server enforces expiry.
    }

    setFeedbackAccessToken(storedToken);
    setFeedbackAccessResolved(true);

    if (!feedbackTokenFromUrl) return;

    const url = new URL(window.location.href);
    url.searchParams.delete('accessToken');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [feedbackTokenFromUrl, feedbackTokenStorageKey]);

  useEffect(() => {
    try {
      const token = localStorage.getItem('jwt');
      if (token) {
        // Try to get user info from local storage or context
        const userString = localStorage.getItem('user');
        if (userString) {
          const user = JSON.parse(userString);
          setIsInternalUser(true);
          setInternalUserData(user);
          
          if (user.profile?.firstName && user.profile?.lastName) {
            setUserInfo({
              name: `${user.profile.firstName} ${user.profile.lastName}`,
              email: user.email || ''
            });
          } else if (user.email) {
            setUserInfo({
              name: user.email.split('@')[0], // Use email username as fallback
              email: user.email
            });
          }
        }
      }
    } catch (err) {
      // Ignore errors - just means no auto-fill
    }
  }, []);
  
  const [overallFeedback, setOverallFeedback] = useState({
    generalContent: '',
    generalRating: undefined as number | undefined,
    technicalRating: undefined as number | undefined,
    communicationRating: undefined as number | undefined,
    culturalRating: undefined as number | undefined,
    questionFeedback: {} as {[questionId: string]: {content: string; rating?: number}}
  });

  const [customFieldResponses, setCustomFieldResponses] = useState<{[fieldId: string]: any}>({});
  const [calculatedValues, setCalculatedValues] = useState<{[fieldId: string]: number | null}>({});
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // CV/Resume handling state
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [accessibleUrls, setAccessibleUrls] = useState<AccessibleResumeUrls | null>(null);

  // Validation state
  const [validationState, setValidationState] = useState<ValidationState>({
    userInfo: {
      name: { isValid: true, touched: false },
      email: { isValid: true, touched: false }
    },
    ratings: {
      overall: { isValid: true },
      technical: { isValid: true },
      communication: { isValid: true },
      cultural: { isValid: true }
    },
    feedback: {
      general: { isValid: true, touched: false }
    },
    form: {
      isValid: false,
      canSubmit: false
    }
  });

  // Resume bytes remain behind the capability-checked backend proxy. Never
  // fall back to a persisted provider URL that could outlive revocation.
  const getResumeUrls = useCallback(() => {
    if (!candidateInfo?.resumeAvailable || !accessibleUrls?.accessible) return null;
    return {
      viewUrl: accessibleUrls.viewUrl,
      downloadUrl: accessibleUrls.downloadUrl,
    };
  }, [candidateInfo?.resumeAvailable, accessibleUrls]);

  // Fetch accessible URLs for PDF resumes
  const fetchAccessibleUrls = useCallback(async (candidateId: string) => {
    try {
      setLoadingUrls(true);
      setAccessibleUrls(null);
      const response = await apiRequest(
        `/api/candidates/public/interviews/${encodeURIComponent(interviewId)}/candidates/${encodeURIComponent(candidateId)}/accessible-resume-url`,
        {
          skipAuth: Boolean(feedbackAccessToken),
          headers: feedbackAccessToken ? { 'X-Public-Feedback-Token': feedbackAccessToken } : {},
        },
      );
      if (response.ok) {
        const data = await response.json();
        setAccessibleUrls(data);
      }
    } catch (error) {
      console.warn('Failed to fetch accessible URLs:', error);
    } finally {
      setLoadingUrls(false);
    }
  }, [feedbackAccessToken, interviewId]);

  useEffect(() => {
    if (!feedbackAccessResolved) return;
    fetchQuestions();
  }, [feedbackAccessResolved, feedbackAccessToken, interviewId]);

  // Fetch accessible URLs when candidate info is available
  useEffect(() => {
    if (candidateInfo?.resumeAvailable && candidateInfo.id) {
      fetchAccessibleUrls(candidateInfo.id);
    }
  }, [candidateInfo, fetchAccessibleUrls]);

  // Real-time validation for user info - only if visible and required
  useEffect(() => {
    if (!isAuthenticatedInternalAccess) {
      let nameValidation = { isValid: true };
      let emailValidation = { isValid: true };
      
      if (isFieldVisible('name') && isFieldRequired('name')) {
        nameValidation = validateName(userInfo.name);
      }
      
      if (isFieldVisible('email') && isFieldRequired('email')) {
        emailValidation = validateEmail(userInfo.email);
      }
      
      setValidationState(prev => ({
        ...prev,
        userInfo: {
          name: { ...nameValidation, touched: prev.userInfo.name.touched },
          email: { ...emailValidation, touched: prev.userInfo.email.touched }
        }
      }));
    }
  }, [userInfo.name, userInfo.email, isAuthenticatedInternalAccess, feedbackFormConfig]);

  // Real-time validation for ratings - only validate if visible and required
  useEffect(() => {
    const overallValidation = isFieldVisible('overallRating') && isFieldRequired('overallRating')
      ? validateRating(overallFeedback.generalRating, 'overall')
      : { isValid: true };
      
    const technicalValidation = isFieldVisible('technicalRating') && isFieldRequired('technicalRating')
      ? validateRating(overallFeedback.technicalRating, 'technical skills')
      : { isValid: true };
      
    const communicationValidation = isFieldVisible('communicationRating') && isFieldRequired('communicationRating')
      ? validateRating(overallFeedback.communicationRating, 'communication skills')
      : { isValid: true };
      
    const culturalValidation = isFieldVisible('culturalRating') && isFieldRequired('culturalRating')
      ? validateRating(overallFeedback.culturalRating, 'cultural fit')
      : { isValid: true };
    
    setValidationState(prev => ({
      ...prev,
      ratings: {
        overall: overallValidation,
        technical: technicalValidation,
        communication: communicationValidation,
        cultural: culturalValidation
      }
    }));
  }, [overallFeedback.generalRating, overallFeedback.technicalRating, overallFeedback.communicationRating, overallFeedback.culturalRating, feedbackFormConfig]);

  // Real-time validation for feedback content - only if visible and required
  useEffect(() => {
    let feedbackValidation;
    if (isFieldVisible('generalFeedback') && isFieldRequired('generalFeedback')) {
      feedbackValidation = validateFeedback(overallFeedback.generalContent);
    } else {
      feedbackValidation = { isValid: true };
    }
    
    setValidationState(prev => ({
      ...prev,
      feedback: {
        general: { ...feedbackValidation, touched: prev.feedback.general.touched }
      }
    }));
  }, [overallFeedback.generalContent, feedbackFormConfig]);

  // Form-level validation
  useEffect(() => {
    const formValidation = validateForm();
    
    setValidationState(prev => ({
      ...prev,
      form: {
        isValid: formValidation.isValid,
        canSubmit: formValidation.canSubmit
      }
    }));
  }, [userInfo, overallFeedback, isAuthenticatedInternalAccess]);

  // Real-time calculation for calculated fields
  useEffect(() => {
    const calculatedFields = feedbackFormConfig?.customFields?.filter(
      (f: any) => f.customFieldRef?.type === 'calculated' && f.isVisible !== false
    ) || [];
    
    if (calculatedFields.length > 0) {
      const newCalculatedValues: {[key: string]: number | null} = {};
      
      // Gather all current field values
      const fieldValues: Record<string, number> = {};
      
      // Add system ratings
      if (overallFeedback.generalRating) fieldValues.overall = overallFeedback.generalRating;
      if (overallFeedback.generalRating) fieldValues.overallRating = overallFeedback.generalRating;
      if (overallFeedback.technicalRating) fieldValues.technical = overallFeedback.technicalRating;
      if (overallFeedback.technicalRating) fieldValues.technicalRating = overallFeedback.technicalRating;
      if (overallFeedback.communicationRating) fieldValues.communication = overallFeedback.communicationRating;
      if (overallFeedback.communicationRating) fieldValues.communicationRating = overallFeedback.communicationRating;
      if (overallFeedback.culturalRating) fieldValues.cultural = overallFeedback.culturalRating;
      if (overallFeedback.culturalRating) fieldValues.culturalRating = overallFeedback.culturalRating;
      
      // Add custom field values (only numeric ones for calculations)
      Object.entries(customFieldResponses).forEach(([fieldId, value]) => {
        if (typeof value === 'number') {
          fieldValues[fieldId] = value;
        }
      });
      
      // Evaluate each calculated field
      calculatedFields.forEach((field: any) => {
        if (field.customFieldRef?.calculationFormula) {
          const result = evaluateFormula(
            field.customFieldRef.calculationFormula,
            fieldValues
          );
          newCalculatedValues[field.customFieldRef._id] = result;
        }
      });
      
      setCalculatedValues(newCalculatedValues);
    }
  }, [
    overallFeedback.generalRating, 
    overallFeedback.technicalRating, 
    overallFeedback.communicationRating, 
    overallFeedback.culturalRating,
    customFieldResponses,
    feedbackFormConfig
  ]);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // For public page, we fetch without authentication
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/questions`, {
        skipAuth: Boolean(feedbackAccessToken),
        headers: feedbackAccessToken ? { 'X-Public-Feedback-Token': feedbackAccessToken } : {},
      });
      
      if (!response.ok) {
        const failure = await response.clone().json().catch(() => ({}))
        const capabilityRejected = response.status === 404
          && failure.code === 'PUBLIC_FEEDBACK_ACCESS_NOT_FOUND'
        if (feedbackAccessToken && capabilityRejected) {
          try {
            sessionStorage.removeItem(feedbackTokenStorageKey);
          } catch {
            // Ignore storage failures; the rejected capability remains unusable.
          }
          setFeedbackAccessToken(null);
        }
        throw new Error(failure.msg || 'Interview not found or questions not available');
      }
      
      const data = await response.json();
      setQuestions(data.questions || []);
      setCandidateInfo(data.candidateInfo);
      setJobInfo(data.jobInfo);
      setStageInfo(data.stageInfo);
      setInterviewInfo(data.interviewInfo);
      setFeedbackFormConfig(data.feedbackFormConfig);
      
      // Debug logging
      console.log('🔍 [PUBLIC-FORM] Feedback form config received:', data.feedbackFormConfig);
      if (data.feedbackFormConfig) {
        console.log('   - System fields:', data.feedbackFormConfig.systemFields?.length || 0);
        console.log('   - Custom fields:', data.feedbackFormConfig.customFields?.length || 0);
        if (data.feedbackFormConfig.customFields) {
          data.feedbackFormConfig.customFields.forEach((f: any) => {
            console.log(`     - ${f.customField?.name}: visible=${f.isVisible}, required=${f.isRequired}`);
          });
        }
      }
      
    } catch (err: any) {
      console.error('Error fetching questions:', err);
      setError(err.message || 'Failed to load interview questions');
    } finally {
      setLoading(false);
    }
  };

  const updateGeneralFeedback = (field: string, value: any) => {
    setOverallFeedback(prev => {
      if (field === 'content') {
        return { ...prev, generalContent: value };
      } else if (field.includes('Rating')) {
        return { ...prev, [field]: value };
      } else if (field === 'rating') {
        return { ...prev, generalRating: value };
      }
      return prev;
    });
  };

  const updateCustomField = (fieldId: string, value: any) => {
    setCustomFieldResponses(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  // Helper to check if a system field is visible
  const isFieldVisible = (fieldId: string): boolean => {
    if (!feedbackFormConfig) return true; // Show all if no config
    const field = feedbackFormConfig.systemFields?.find((f: any) => f.fieldId === fieldId);
    return field ? field.isVisible !== false : true;
  };

  // Helper to check if a field is required
  const isFieldRequired = (fieldId: string): boolean => {
    if (!feedbackFormConfig) {
      // Default required fields
      return ['name', 'email', 'overallRating'].includes(fieldId);
    }
    const field = feedbackFormConfig.systemFields?.find((f: any) => f.fieldId === fieldId);
    return field ? field.isRequired === true : false;
  };

  const updateQuestionFeedback = (questionId: string, field: 'content' | 'rating', value: any) => {
    setOverallFeedback(prev => ({
      ...prev,
      questionFeedback: {
        ...prev.questionFeedback,
        [questionId]: {
          ...prev.questionFeedback[questionId] || { content: '', rating: undefined },
          [field]: value
        }
      }
    }));
  };

  // Validation functions
  const validateName = (name: string): ValidationResult => {
    if (!name.trim()) {
      return { isValid: false, error: 'Please enter your name' };
    }
    
    if (name.trim().length < 2) {
      return { isValid: false, error: 'Name must be at least 2 characters' };
    }
    
    if (name.length > 100) {
      return { isValid: false, error: 'Name must be less than 100 characters' };
    }
    
    const nameRegex = /^[a-zA-Z\s\-']+$/;
    if (!nameRegex.test(name)) {
      return { isValid: false, error: 'Name can only contain letters, spaces, hyphens, and apostrophes' };
    }
    
    return { isValid: true };
  };

  const validateEmail = (email: string): ValidationResult => {
    if (!email.trim()) {
      return { isValid: false, error: 'Please enter your email address' };
    }
    
    if (email.length > 254) {
      return { isValid: false, error: 'Email must be less than 254 characters' };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }
    
    return { isValid: true };
  };

  const validateRating = (rating: number | undefined, fieldName: string): ValidationResult => {
    if (!rating || rating < 1 || rating > 5) {
      return { isValid: false, error: `Please provide a ${fieldName} rating` };
    }
    
    return { isValid: true };
  };

  const validateFeedback = (content: string, minLength: number = 10, maxLength: number = 2000): ValidationResult => {
    const trimmedContent = content.trim();
    
    if (trimmedContent.length < minLength) {
      return { isValid: false, error: `Please provide at least ${minLength} characters of feedback` };
    }
    
    if (content.length > maxLength) {
      return { isValid: false, error: `Feedback must be less than ${maxLength} characters` };
    }
    
    return { isValid: true };
  };

  const validateForm = (): { isValid: boolean; errors: string[]; canSubmit: boolean } => {
    const errors: string[] = [];
    
    // Validate user info (public users only) - only if visible and required
    if (!isAuthenticatedInternalAccess) {
      if (isFieldVisible('name') && isFieldRequired('name')) {
        const nameValidation = validateName(userInfo.name);
        if (!nameValidation.isValid) {
          errors.push(nameValidation.error!);
        }
      }
      
      if (isFieldVisible('email') && isFieldRequired('email')) {
        const emailValidation = validateEmail(userInfo.email);
        if (!emailValidation.isValid) {
          errors.push(emailValidation.error!);
        }
      }
    }
    
    // Validate ratings - only if visible and required
    if (isFieldVisible('overallRating') && isFieldRequired('overallRating')) {
      const overallRatingValidation = validateRating(overallFeedback.generalRating, 'overall');
      if (!overallRatingValidation.isValid) {
        errors.push(overallRatingValidation.error!);
      }
    }
    
    if (isFieldVisible('technicalRating') && isFieldRequired('technicalRating')) {
      const technicalRatingValidation = validateRating(overallFeedback.technicalRating, 'technical skills');
      if (!technicalRatingValidation.isValid) {
        errors.push(technicalRatingValidation.error!);
      }
    }
    
    if (isFieldVisible('communicationRating') && isFieldRequired('communicationRating')) {
      const communicationRatingValidation = validateRating(overallFeedback.communicationRating, 'communication skills');
      if (!communicationRatingValidation.isValid) {
        errors.push(communicationRatingValidation.error!);
      }
    }
    
    if (isFieldVisible('culturalRating') && isFieldRequired('culturalRating')) {
      const culturalRatingValidation = validateRating(overallFeedback.culturalRating, 'cultural fit');
      if (!culturalRatingValidation.isValid) {
        errors.push(culturalRatingValidation.error!);
      }
    }
    
    // Validate general feedback - only if visible
    if (isFieldVisible('generalFeedback')) {
      if (isFieldRequired('generalFeedback')) {
        // If required, validate minimum length
        const feedbackValidation = validateFeedback(overallFeedback.generalContent);
        if (!feedbackValidation.isValid) {
          errors.push(feedbackValidation.error!);
        }
      } else {
        // If optional, only require feedback if no question feedback exists
        const hasGeneralFeedback = overallFeedback.generalContent.trim().length >= 10;
        const hasQuestionFeedback = Object.values(overallFeedback.questionFeedback).some(q => q.content.trim().length >= 10);
        
        if (!hasGeneralFeedback && !hasQuestionFeedback) {
          errors.push('Please provide at least some detailed feedback (minimum 10 characters)');
        }
      }
    }
    
    // Validate custom fields - only if visible and required
    if (feedbackFormConfig?.customFields) {
      feedbackFormConfig.customFields.forEach((fieldConfig: any) => {
        const customField = fieldConfig.customField;
        // Skip if field doesn't exist or is hidden
        if (!customField || fieldConfig.isVisible === false) {
          return;
        }
        
        // Only validate if required
        if (fieldConfig.isRequired === true) {
          const fieldValue = customFieldResponses[customField._id];
          
          // Check if field has a value based on type
          let hasValue = false;
          if (customField.type === 'text' || customField.type === 'textarea') {
            hasValue = fieldValue && String(fieldValue).trim().length > 0;
          } else if (customField.type === 'rating') {
            hasValue = fieldValue !== undefined && fieldValue !== null;
          } else if (customField.type === 'radio' || customField.type === 'checkbox') {
            hasValue = fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
          }
          
          if (!hasValue) {
            errors.push(`${fieldConfig.label || customField.label} is required`);
          }
        }
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      canSubmit: errors.length === 0
    };
  };

  const validateUserInfo = (): { isValid: boolean; error?: string } => {
    if (!userInfo.name.trim()) {
      return { isValid: false, error: 'Please enter your name' };
    }
    
    if (!userInfo.email.trim()) {
      return { isValid: false, error: 'Please enter your email address' };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userInfo.email)) {
      return { isValid: false, error: 'Please enter a valid email address' };
    }
    
    return { isValid: true };
  };


  const handleSubmitAllFeedback = async () => {
    // Mark all fields as touched to show validation errors
    setValidationState(prev => ({
      ...prev,
      userInfo: {
        name: { ...prev.userInfo.name, touched: true },
        email: { ...prev.userInfo.email, touched: true }
      },
      feedback: {
        general: { ...prev.feedback.general, touched: true }
      }
    }));

    // Validate the entire form
    const formValidation = validateForm();
    
    if (!formValidation.isValid) {
      // Show first error message
      toast.error(formValidation.errors[0]);
      return;
    }

    // For both internal and public users, submit directly
    await submitFeedback();
  };

  const submitFeedback = async () => {
    const hasGeneralFeedback = overallFeedback.generalContent.trim().length > 0;
    const hasQuestionFeedback = Object.values(overallFeedback.questionFeedback).some(q => q.content.trim().length > 0);

    try {
      setIsSubmitting(true);

      // A capability is the authority for a public invitation even when this
      // browser also carries an unrelated or stale Recruiter login. Keep the
      // same token-first contract used by the read endpoints for submission.
      if (isAuthenticatedInternalAccess) {
        // Submit as internal user (using existing individual endpoints)
        if (hasGeneralFeedback) {
          await interviewService.addQuestionFeedback(interviewId, {
            content: overallFeedback.generalContent.trim(),
            rating: overallFeedback.generalRating,
            technicalRating: overallFeedback.technicalRating,
            communicationRating: overallFeedback.communicationRating,
            culturalRating: overallFeedback.culturalRating,
            isGeneral: true
          });
        }

        // Submit each question feedback if provided
        for (const [questionId, feedback] of Object.entries(overallFeedback.questionFeedback)) {
          if (feedback.content.trim().length > 0) {
            await interviewService.addQuestionFeedback(interviewId, {
              questionId,
              content: feedback.content.trim(),
              rating: feedback.rating,
              isGeneral: false
            });
          }
        }
      } else {
        // Submit as public user using new bulk endpoint
        const bulkFeedbackData = {
          name: userInfo.name.trim(),
          email: userInfo.email.trim(),
          generalFeedback: hasGeneralFeedback ? {
            content: overallFeedback.generalContent.trim(),
            rating: overallFeedback.generalRating,
            technicalRating: overallFeedback.technicalRating,
            communicationRating: overallFeedback.communicationRating,
            culturalRating: overallFeedback.culturalRating
          } : undefined,
          questionFeedback: hasQuestionFeedback ? 
            Object.fromEntries(
              Object.entries(overallFeedback.questionFeedback)
                .filter(([_, feedback]) => feedback.content.trim().length > 0)
                .map(([questionId, feedback]) => [
                  questionId,
                  {
                    content: feedback.content.trim(),
                    rating: feedback.rating
                  }
                ])
            ) : undefined,
          customFieldResponses: customFieldResponses
        };

        await interviewService.addBulkPublicFeedback(interviewId, bulkFeedbackData, feedbackAccessToken || undefined);
      }
      
      toast.success('Thank you! Your feedback has been submitted successfully.');
      
      // Set feedback as submitted to show success screen
      setFeedbackSubmitted(true);
      
      // If internal user, close window/redirect back after showing success
      if (isAuthenticatedInternalAccess) {
        setTimeout(() => {
          window.close(); // Try to close if opened in new tab
          // If can't close, redirect back
          if (!window.closed) {
            window.location.href = `/interviews/${interviewId}/transcript`;
          }
        }, 3000); // Give more time to see the success message
      }
      
    } catch (err: any) {
      console.error('Error submitting feedback:', err);
      toast.error(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span>Loading interview details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success screen after feedback submission
  if (feedbackSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 dark:from-green-900 dark:to-blue-900 p-4 flex items-center justify-center">
        <div className="max-w-2xl mx-auto text-center">
          <Card className="shadow-2xl bg-white dark:bg-gray-800 border-green-200 dark:border-green-700">
            <CardContent className="pt-8 pb-8 px-8">
              <div className="mb-6">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                  Thank You for Your Feedback!
                </h1>
                <div className="text-lg text-gray-600 dark:text-gray-300 space-y-3">
                  <p>Your feedback has been successfully submitted and recorded.</p>
                  {candidateInfo && (
                    <p className="text-blue-600 dark:text-blue-400">
                      Feedback for: <strong>{candidateInfo.name}</strong>
                    </p>
                  )}
                  {jobInfo && (
                    <p className="text-blue-600 dark:text-blue-400">
                      Position: <strong>{jobInfo.title}</strong>
                    </p>
                  )}
                </div>
              </div>
              
              <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-6 mb-6">
                <div className="flex items-start gap-3">
                  <Heart className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="text-left">
                    <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
                      Your Input Makes a Difference
                    </h3>
                    <p className="text-green-700 dark:text-green-200 text-sm">
                      Your honest feedback helps us improve our hiring process and ensures we make the best decisions for both candidates and our team. We truly appreciate the time you took to share your insights.
                    </p>
                  </div>
                </div>
              </div>

              {!isAuthenticatedInternalAccess && (
                <div className="mb-6">
                  <Button 
                    variant="outline" 
                    onClick={() => setFeedbackSubmitted(false)}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    Submit Additional Feedback
                  </Button>
                </div>
              )}

              <div className="text-sm text-gray-500 dark:text-gray-400">
                <p>This feedback was submitted on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
                {!isAuthenticatedInternalAccess && (
                  <p className="mt-2">You can now safely close this window.</p>
                )}
                {isAuthenticatedInternalAccess && (
                  <p className="mt-2">Redirecting you back to the interview page...</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(156,146,172,0.3)_1px,transparent_0)] bg-[length:20px_20px]"></div>
      </div>
      
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        {/* Enhanced Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-lg">
            <MessageSquare className="h-8 w-8 text-white" />
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 dark:from-white dark:via-blue-100 dark:to-indigo-100 bg-clip-text text-transparent mb-4">
            {candidateInfo ? `Feedback for ${candidateInfo.name}` : 'Interview Feedback'}
          </h1>
          
          <div className="max-w-3xl mx-auto space-y-4">
            <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
              {isAuthenticatedInternalAccess ? (
                <>Share your detailed assessment to help the team make informed hiring decisions. Your insights are valuable for evaluating candidate performance.</>
              ) : (
                <>Your feedback helps us make better hiring decisions. Please share your honest assessment of the candidate's interview performance.</>
              )}
            </p>
            
            {jobInfo && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-full border border-blue-200 dark:border-blue-700 shadow-sm">
                <Briefcase className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-blue-700 dark:text-blue-300 font-medium">{jobInfo.title}</span>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Interview & Candidate Information */}
        {(candidateInfo || jobInfo || stageInfo || interviewInfo) && (
          <Card className="shadow-xl mb-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-0 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 p-6 border-b border-slate-200/50 dark:border-slate-700/50">
              <CardTitle className="flex items-center gap-3 text-slate-900 dark:text-white text-xl">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                Interview Details
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300 mt-2">
                Please confirm you're providing feedback for the correct interview
              </CardDescription>
            </div>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {candidateInfo && (
                  <div className="group">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/50 dark:to-emerald-800/50 rounded-lg group-hover:scale-105 transition-transform duration-200">
                        <User className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Candidate</h4>
                    </div>
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-600 hover:shadow-md transition-all duration-200">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                          {candidateInfo.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </div>
                        <div>
                          <p className="text-slate-900 dark:text-white font-semibold">{candidateInfo.name}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-300">{candidateInfo.email}</p>
                        </div>
                      </div>
                      {candidateInfo.resumeAvailable && (() => {
                        const resumeUrls = getResumeUrls();

                        return (
                          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-600">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Resume/CV</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {resumeUrls?.viewUrl && (
                                <Button variant="outline" size="sm" asChild className="h-8 px-3 text-xs bg-white hover:bg-slate-50 border-slate-300 hover:border-blue-400 transition-all duration-200">
                                  <a href={resumeUrls.viewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                                    <ExternalLink className="h-3 w-3" />
                                    View
                                  </a>
                                </Button>
                              )}
                              {resumeUrls?.downloadUrl && (
                                <Button variant="outline" size="sm" asChild className="h-8 px-3 text-xs bg-white hover:bg-slate-50 border-slate-300 hover:border-green-400 transition-all duration-200">
                                  <a href={resumeUrls.downloadUrl} download className="flex items-center gap-1">
                                    <Download className="h-3 w-3" />
                                    Download
                                  </a>
                                </Button>
                              )}
                              {!resumeUrls && !loadingUrls && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded-md">
                                  <AlertCircle className="h-3 w-3 text-amber-500" />
                                  <span className="text-xs text-amber-600 dark:text-amber-400">Resume unavailable</span>
                                </div>
                              )}
                              {loadingUrls && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                  <span className="text-xs text-blue-600 dark:text-blue-400">Loading...</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
                
                {jobInfo && (
                  <div className="group">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/50 dark:to-blue-800/50 rounded-lg group-hover:scale-105 transition-transform duration-200">
                        <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Position</h4>
                    </div>
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-600 hover:shadow-md transition-all duration-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                          <Briefcase className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <p className="text-slate-900 dark:text-white font-semibold">{jobInfo.title}</p>
                          {jobInfo.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{jobInfo.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {stageInfo && (
                  <div className="group">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900/50 dark:to-purple-800/50 rounded-lg group-hover:scale-105 transition-transform duration-200">
                        <Award className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Interview Stage</h4>
                    </div>
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-600 hover:shadow-md transition-all duration-200">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center">
                          <Award className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <p className="text-slate-900 dark:text-white font-semibold">{stageInfo.name}</p>
                          {stageInfo.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-300">{stageInfo.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {interviewInfo && (
                  <div className="group">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-indigo-100 to-indigo-200 dark:from-indigo-900/50 dark:to-indigo-800/50 rounded-lg group-hover:scale-105 transition-transform duration-200">
                        <Calendar className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-lg">Interview Details</h4>
                    </div>
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-600 hover:shadow-md transition-all duration-200">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                          <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</p>
                            <p className="text-slate-900 dark:text-white">{new Date(interviewInfo.scheduledAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Clock className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                          <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Duration</p>
                            <p className="text-slate-900 dark:text-white">{interviewInfo.duration} minutes</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <MessageSquare className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                          <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Type</p>
                            <p className="text-slate-900 dark:text-white">{interviewInfo.type?.replace('_', ' ') || 'Interview'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Enhanced User Information Card - Only show for public users */}
        {!isAuthenticatedInternalAccess && (
          <Card className="shadow-xl mb-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-0 rounded-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 p-6 border-b border-slate-200/50 dark:border-slate-700/50">
              <CardTitle className="flex items-center gap-3 text-slate-900 dark:text-white text-xl">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg">
                  <User className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                Your Information
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300 mt-2">
                {candidateInfo ? `Feedback for ${candidateInfo.name}'s interview` : 'Please provide your information before submitting feedback'}
              </CardDescription>
            </div>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
                    <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Your Name *
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={userInfo.name}
                    onChange={(e) => {
                      setUserInfo(prev => ({ ...prev, name: e.target.value }));
                      setValidationState(prev => ({
                        ...prev,
                        userInfo: {
                          ...prev.userInfo,
                          name: { ...prev.userInfo.name, touched: true }
                        }
                      }));
                    }}
                    onBlur={() => {
                      setValidationState(prev => ({
                        ...prev,
                        userInfo: {
                          ...prev.userInfo,
                          name: { ...prev.userInfo.name, touched: true }
                        }
                      }));
                    }}
                    required
                    className={`h-11 transition-all duration-200 ${
                      validationState.userInfo.name.touched && !validationState.userInfo.name.isValid
                        ? 'border-red-500 dark:border-red-400 focus:border-red-500 dark:focus:border-red-400 focus:ring-red-500/20 dark:focus:ring-red-400/20'
                        : 'border-slate-300 dark:border-slate-600 focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-emerald-500/20 dark:focus:ring-emerald-400/20'
                    }`}
                  />
                  {validationState.userInfo.name.touched && !validationState.userInfo.name.isValid && (
                    <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {validationState.userInfo.name.error}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
                    <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Your Email *
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email address"
                    value={userInfo.email}
                    onChange={(e) => {
                      setUserInfo(prev => ({ ...prev, email: e.target.value }));
                      setValidationState(prev => ({
                        ...prev,
                        userInfo: {
                          ...prev.userInfo,
                          email: { ...prev.userInfo.email, touched: true }
                        }
                      }));
                    }}
                    onBlur={() => {
                      setValidationState(prev => ({
                        ...prev,
                        userInfo: {
                          ...prev.userInfo,
                          email: { ...prev.userInfo.email, touched: true }
                        }
                      }));
                    }}
                    required
                    className={`h-11 transition-all duration-200 ${
                      validationState.userInfo.email.touched && !validationState.userInfo.email.isValid
                        ? 'border-red-500 dark:border-red-400 focus:border-red-500 dark:focus:border-red-400 focus:ring-red-500/20 dark:focus:ring-red-400/20'
                        : 'border-slate-300 dark:border-slate-600 focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-emerald-500/20 dark:focus:ring-emerald-400/20'
                    }`}
                  />
                  {validationState.userInfo.email.touched && !validationState.userInfo.email.isValid && (
                    <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {validationState.userInfo.email.error}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Enhanced logged in user info for internal users */}
        {isAuthenticatedInternalAccess && (
          <Card className="shadow-xl mb-8 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border-emerald-200 dark:border-emerald-700 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/50 dark:to-emerald-800/50 rounded-xl">
                  <Shield className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white text-lg">Logged in as {userInfo.name}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{userInfo.email}</p>
                </div>
                <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 rounded-full">
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Team Member</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Enhanced Consolidated Feedback Form */}
        <Card className="shadow-xl mb-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-0 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 p-6 border-b border-slate-200/50 dark:border-slate-700/50">
            <CardTitle className="flex items-center gap-3 text-slate-900 dark:text-white text-xl">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              Interview Feedback Form
            </CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-300 mt-2">
              Provide your detailed assessment of the candidate's interview performance
            </CardDescription>
          </div>
          <CardContent className="p-6 space-y-8">
            {/* Enhanced General Feedback Section */}
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-700 dark:to-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-600">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900/50 dark:to-indigo-800/50 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h4 className="font-semibold text-xl text-slate-900 dark:text-white">Overall Interview Assessment</h4>
                </div>
                <div className="space-y-6">
                  {/* Enhanced Detailed Rating Section */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Overall Rating */}
                    {isFieldVisible('overallRating') && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <span className="text-yellow-500 text-lg font-bold">★</span>
                        Overall Rating {isFieldRequired('overallRating') ? '*' : ''}
                      </Label>
                      <div className="flex gap-2 items-center">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((num) => (
                            <Button
                              key={num}
                              type="button"
                              variant={overallFeedback.generalRating === num ? "default" : "outline"}
                              size="sm"
                              className={`h-10 w-10 p-0 font-semibold transition-all duration-200 ${
                                overallFeedback.generalRating === num 
                                  ? 'bg-gradient-to-br from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-white shadow-lg scale-105' 
                                  : 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:border-yellow-300 dark:hover:border-yellow-600'
                              } ${
                                !validationState.ratings.overall.isValid ? 'border-red-500 dark:border-red-400' : ''
                              }`}
                              onClick={() => updateGeneralFeedback('generalRating', overallFeedback.generalRating === num ? undefined : num)}
                              aria-label={`Rate overall ${num} out of 5`}
                            >
                              {num}
                            </Button>
                          ))}
                        </div>
                        {overallFeedback.generalRating && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {overallFeedback.generalRating}/5
                          </span>
                        )}
                      </div>
                      {!validationState.ratings.overall.isValid && (
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          {validationState.ratings.overall.error}
                        </p>
                      )}
                    </div>
                    )}

                    {/* Technical Skills Rating */}
                    {isFieldVisible('technicalRating') && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Zap className="h-4 w-4 text-blue-500" />
                        Technical Skills {isFieldRequired('technicalRating') ? '*' : ''}
                      </Label>
                      <div className="flex gap-2 items-center">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((num) => (
                            <Button
                              key={num}
                              type="button"
                              variant={overallFeedback.technicalRating === num ? "default" : "outline"}
                              size="sm"
                              className={`h-10 w-10 p-0 font-semibold transition-all duration-200 ${
                                overallFeedback.technicalRating === num 
                                  ? 'bg-gradient-to-br from-blue-400 to-blue-600 hover:from-blue-500 hover:to-blue-700 text-white shadow-lg scale-105' 
                                  : 'hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-600'
                              } ${
                                !validationState.ratings.technical.isValid ? 'border-red-500 dark:border-red-400' : ''
                              }`}
                              onClick={() => updateGeneralFeedback('technicalRating', overallFeedback.technicalRating === num ? undefined : num)}
                              aria-label={`Rate technical skills ${num} out of 5`}
                            >
                              {num}
                            </Button>
                          ))}
                        </div>
                        {overallFeedback.technicalRating && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {overallFeedback.technicalRating}/5
                          </span>
                        )}
                      </div>
                      {!validationState.ratings.technical.isValid && (
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          {validationState.ratings.technical.error}
                        </p>
                      )}
                    </div>
                    )}

                    {/* Communication Skills Rating */}
                    {isFieldVisible('communicationRating') && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Users className="h-4 w-4 text-green-500" />
                        Communication Skills {isFieldRequired('communicationRating') ? '*' : ''}
                      </Label>
                      <div className="flex gap-2 items-center">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((num) => (
                            <Button
                              key={num}
                              type="button"
                              variant={overallFeedback.communicationRating === num ? "default" : "outline"}
                              size="sm"
                              className={`h-10 w-10 p-0 font-semibold transition-all duration-200 ${
                                overallFeedback.communicationRating === num 
                                  ? 'bg-gradient-to-br from-green-400 to-green-600 hover:from-green-500 hover:to-green-700 text-white shadow-lg scale-105' 
                                  : 'hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-300 dark:hover:border-green-600'
                              } ${
                                !validationState.ratings.communication.isValid ? 'border-red-500 dark:border-red-400' : ''
                              }`}
                              onClick={() => updateGeneralFeedback('communicationRating', overallFeedback.communicationRating === num ? undefined : num)}
                              aria-label={`Rate communication skills ${num} out of 5`}
                            >
                              {num}
                            </Button>
                          ))}
                        </div>
                        {overallFeedback.communicationRating && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {overallFeedback.communicationRating}/5
                          </span>
                        )}
                      </div>
                      {!validationState.ratings.communication.isValid && (
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          {validationState.ratings.communication.error}
                        </p>
                      )}
                    </div>
                    )}

                    {/* Cultural Fit Rating */}
                    {isFieldVisible('culturalRating') && (
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Heart className="h-4 w-4 text-purple-500" />
                        Cultural Fit {isFieldRequired('culturalRating') ? '*' : ''}
                      </Label>
                      <div className="flex gap-2 items-center">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((num) => (
                            <Button
                              key={num}
                              type="button"
                              variant={overallFeedback.culturalRating === num ? "default" : "outline"}
                              size="sm"
                              className={`h-10 w-10 p-0 font-semibold transition-all duration-200 ${
                                overallFeedback.culturalRating === num 
                                  ? 'bg-gradient-to-br from-purple-400 to-purple-600 hover:from-purple-500 hover:to-purple-700 text-white shadow-lg scale-105' 
                                  : 'hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-600'
                              } ${
                                !validationState.ratings.cultural.isValid ? 'border-red-500 dark:border-red-400' : ''
                              }`}
                              onClick={() => updateGeneralFeedback('culturalRating', overallFeedback.culturalRating === num ? undefined : num)}
                              aria-label={`Rate cultural fit ${num} out of 5`}
                            >
                              {num}
                            </Button>
                          ))}
                        </div>
                        {overallFeedback.culturalRating && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {overallFeedback.culturalRating}/5
                          </span>
                        )}
                      </div>
                      {!validationState.ratings.cultural.isValid && (
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          {validationState.ratings.cultural.error}
                        </p>
                      )}
                    </div>
                    )}
                  </div>

                  {/* Enhanced Feedback Text */}
                  {isFieldVisible('generalFeedback') && (
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-indigo-500" />
                      Written Feedback {isFieldRequired('generalFeedback') ? '*' : ''}
                    </Label>
                    <Textarea
                      placeholder="Share your overall thoughts about the candidate's interview performance..."
                      value={overallFeedback.generalContent}
                      onChange={(e) => {
                        updateGeneralFeedback('content', e.target.value);
                        setValidationState(prev => ({
                          ...prev,
                          feedback: {
                            ...prev.feedback,
                            general: { ...prev.feedback.general, touched: true }
                          }
                        }));
                      }}
                      onBlur={() => {
                        setValidationState(prev => ({
                          ...prev,
                          feedback: {
                            ...prev.feedback,
                            general: { ...prev.feedback.general, touched: true }
                          }
                        }));
                      }}
                      rows={4}
                      className={`transition-all duration-200 resize-none ${
                        validationState.feedback.general.touched && !validationState.feedback.general.isValid
                          ? 'border-red-500 dark:border-red-400 focus:border-red-500 dark:focus:border-red-400 focus:ring-red-500/20 dark:focus:ring-red-400/20'
                          : 'border-slate-300 dark:border-slate-600 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20'
                      }`}
                    />
                    <div className="flex justify-between items-center">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {overallFeedback.generalContent.length} / 2000 characters
                      </div>
                      {overallFeedback.generalContent.length < 10 && overallFeedback.generalContent.length > 0 && (
                        <div className="text-xs text-amber-600 dark:text-amber-400">
                          Minimum 10 characters required
                        </div>
                      )}
                    </div>
                    {validationState.feedback.general.touched && !validationState.feedback.general.isValid && (
                      <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {validationState.feedback.general.error}
                      </p>
                    )}
                  </div>
                  )}

                  {/* Custom Fields */}
                  {(() => {
                    console.log('🔍 [CUSTOM-FIELDS-CHECK]', {
                      hasConfig: !!feedbackFormConfig,
                      hasCustomFields: !!feedbackFormConfig?.customFields,
                      customFieldsLength: feedbackFormConfig?.customFields?.length,
                      visibleCount: feedbackFormConfig?.customFields?.filter((f: any) => f.isVisible !== false && f.customField).length
                    });
                    return feedbackFormConfig?.customFields && feedbackFormConfig.customFields.some((f: any) => f.isVisible !== false && f.customField);
                  })() && (
                    <div className="space-y-4">
                      <h4 className="font-semibold text-lg text-slate-900 dark:text-white">Additional Information</h4>
                      {feedbackFormConfig.customFields.map((fieldConfig: any, index: number) => {
                        const customField = fieldConfig.customField;
                        console.log(`🔍 [CUSTOM-FIELD-${index}]`, {
                          hasCustomField: !!customField,
                          isVisible: fieldConfig.isVisible,
                          fieldType: customField?.type,
                          fieldLabel: customField?.label,
                          fieldConfig,
                          fieldConfigKeys: Object.keys(fieldConfig),
                          customFieldKeys: customField ? Object.keys(customField) : []
                        });
                        // Skip if field doesn't exist or is hidden
                        if (!customField || fieldConfig.isVisible === false) {
                          console.log(`⏭️ [CUSTOM-FIELD-${index}] Skipped:`, !customField ? 'No customField' : 'Not visible');
                          return null;
                        }

                        return (
                          <div key={customField._id} className="space-y-3">
                            <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                              {fieldConfig.label || customField.label}
                              {fieldConfig.isRequired && ' *'}
                            </Label>
                            {customField.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                                {customField.description}
                              </p>
                            )}

                            {/* Text Input */}
                            {customField.type === 'text' && (
                              <Input
                                value={customFieldResponses[customField._id] || ''}
                                onChange={(e) => updateCustomField(customField._id, e.target.value)}
                                placeholder={`Enter ${customField.label.toLowerCase()}`}
                                required={fieldConfig.isRequired}
                              />
                            )}

                            {/* Textarea */}
                            {customField.type === 'textarea' && (
                              <Textarea
                                value={customFieldResponses[customField._id] || ''}
                                onChange={(e) => updateCustomField(customField._id, e.target.value)}
                                placeholder={`Enter ${customField.label.toLowerCase()}`}
                                required={fieldConfig.isRequired}
                                rows={3}
                              />
                            )}

                            {/* Rating */}
                            {customField.type === 'rating' && (
                              <div className="flex gap-2 items-center">
                                <div className="flex gap-1">
                                  {Array.from({ length: customField.ratingConfig?.scale || 5 }, (_, i) => i + 1).map((num) => (
                                    <Button
                                      key={num}
                                      type="button"
                                      variant={customFieldResponses[customField._id] === num ? "default" : "outline"}
                                      size="sm"
                                      className={`h-10 w-10 p-0 font-semibold transition-all duration-200 ${
                                        customFieldResponses[customField._id] === num
                                          ? 'bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-lg scale-105'
                                          : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
                                      }`}
                                      onClick={() => updateCustomField(customField._id, customFieldResponses[customField._id] === num ? undefined : num)}
                                    >
                                      {customField.ratingConfig?.displayStyle === 'stars' ? '★' : num}
                                    </Button>
                                  ))}
                                </div>
                                {customFieldResponses[customField._id] && (
                                  <span className="text-xs text-muted-foreground">
                                    {customFieldResponses[customField._id]}/{customField.ratingConfig?.scale || 5}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Radio */}
                            {customField.type === 'radio' && customField.options && (
                              <div className="space-y-2">
                                {customField.options.map((option: any, idx: number) => (
                                  <label key={idx} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={customField._id}
                                      value={option.value}
                                      checked={customFieldResponses[customField._id] === option.value}
                                      onChange={(e) => updateCustomField(customField._id, e.target.value)}
                                      className="h-4 w-4"
                                    />
                                    <span className="text-sm">{option.label}</span>
                                  </label>
                                ))}
                              </div>
                            )}

                            {/* Checkbox */}
                            {customField.type === 'checkbox' && customField.options && (
                              <div className="space-y-2">
                                {customField.options.map((option: any, idx: number) => {
                                  const selectedValues = customFieldResponses[customField._id] || [];
                                  return (
                                    <label key={idx} className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        value={option.value}
                                        checked={Array.isArray(selectedValues) && selectedValues.includes(option.value)}
                                        onChange={(e) => {
                                          const currentValues = Array.isArray(customFieldResponses[customField._id]) 
                                            ? customFieldResponses[customField._id] 
                                            : [];
                                          const newValues = e.target.checked
                                            ? [...currentValues, option.value]
                                            : currentValues.filter((v: string) => v !== option.value);
                                          updateCustomField(customField._id, newValues);
                                        }}
                                        className="h-4 w-4"
                                      />
                                      <span className="text-sm">{option.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {/* Calculated Field - Read-Only Display with Live Preview */}
                            {customField.type === 'calculated' && (
                              <div className="p-4 bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-700 dark:to-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                                <div className="text-sm text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                                  <Sparkles className="h-4 w-4" />
                                  This value is calculated automatically
                                </div>
                                <div className="text-3xl font-bold text-slate-900 dark:text-white">
                                  {calculatedValues[customField._id] !== null && calculatedValues[customField._id] !== undefined
                                    ? calculatedValues[customField._id]?.toFixed(2)
                                    : '—'}
                                </div>
                                {customField.calculationFormula && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded">
                                    Formula: {customField.calculationFormula}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Question-Specific Feedback */}
              {questions.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-lg">Question-Specific Feedback</h4>
                  <p className="text-sm text-muted-foreground">Rate and comment on how the candidate handled each interview question (optional)</p>
                  
                  {questions.map((question, index) => {
                    const questionData = overallFeedback.questionFeedback[question._id] || { content: '', rating: undefined };
                    
                    return (
                      <div key={question._id} className="border rounded-lg p-4 space-y-3 bg-muted/30">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {question.type.replace('_', ' ')}
                            </Badge>
                            {question.difficulty && (
                              <Badge variant="outline" className="text-xs">
                                {question.difficulty}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">Question {index + 1}</span>
                          </div>
                          <p className="text-sm font-medium">{question.question}</p>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="flex gap-2 items-center">
                            <Label className="text-xs font-medium">Rating</Label>
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((num) => (
                                <Button
                                  key={num}
                                  type="button"
                                  variant={questionData.rating === num ? "default" : "outline"}
                                  size="sm"
                                  className={`h-8 w-8 p-0 font-semibold transition-all ${
                                    questionData.rating === num 
                                      ? 'bg-blue-600 text-white hover:bg-blue-700 scale-110' 
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-105'
                                  }`}
                                  onClick={() => updateQuestionFeedback(question._id, 'rating', questionData.rating === num ? undefined : num)}
                                  aria-label={`Rate ${num} out of 5`}
                                >
                                  {num}
                                </Button>
                              ))}
                            </div>
                            {questionData.rating && (
                              <span className="text-xs text-muted-foreground ml-2">
                                {questionData.rating}/5
                              </span>
                            )}
                          </div>
                          <Textarea
                            placeholder="How well did the candidate answer this question? (optional)"
                            value={questionData.content}
                            onChange={(e) => updateQuestionFeedback(question._id, 'content', e.target.value)}
                            rows={2}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Enhanced Submit Button */}
        <div className="flex justify-center mb-8">
          <Button
            size="lg"
            onClick={handleSubmitAllFeedback}
            disabled={isSubmitting || !validationState.form.canSubmit}
            className={`h-14 px-12 font-semibold text-lg shadow-xl transition-all duration-200 ${
              validationState.form.canSubmit && !isSubmitting
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:shadow-2xl transform hover:scale-105'
                : 'bg-slate-300 dark:bg-slate-600 text-slate-500 dark:text-slate-400 cursor-not-allowed transform-none'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-6 w-6 mr-3 animate-spin" />
                Submitting Feedback...
              </>
            ) : !validationState.form.canSubmit ? (
              <>
                <AlertCircle className="h-6 w-6 mr-3" />
                Complete Required Fields
              </>
            ) : (
              <>
                <Send className="h-6 w-6 mr-3" />
                Submit Feedback
                <ArrowRight className="h-5 w-5 ml-2" />
              </>
            )}
          </Button>
        </div>


        {/* Enhanced Privacy Notice */}
        <Alert className="mb-8 bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800 dark:to-slate-700 border-slate-200 dark:border-slate-600 rounded-xl">
          <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900/50 dark:to-indigo-800/50 rounded-lg">
            <Heart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <AlertDescription className="text-slate-700 dark:text-slate-300">
            {isAuthenticatedInternalAccess ? (
              <><strong className="text-slate-900 dark:text-white">Team Member Notice:</strong> Your feedback will be recorded and visible to other team members involved in the hiring process.</>
            ) : (
              <><strong className="text-slate-900 dark:text-white">Privacy Notice:</strong> Your feedback will be shared with the hiring team to help evaluate this candidate. 
              Your personal information will only be used for this purpose and will not be shared externally.</>
            )}
          </AlertDescription>
        </Alert>

        {/* Enhanced Footer */}
        <div className="text-center mt-12 pt-8 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-slate-600 dark:text-slate-400 font-medium">Powered by SmartHR</span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <a href="#" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1 transition-colors duration-200">
              Learn more about our feedback system
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>

    </div>
  );
}
