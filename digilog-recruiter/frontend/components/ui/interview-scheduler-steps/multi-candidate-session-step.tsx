"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Video, Phone, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Alert, AlertDescription } from '../alert';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface MultiCandidateSessionStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function MultiCandidateSessionStep({ data, updateData, onNext, onPrevious }: MultiCandidateSessionStepProps) {
  // Convert ISO strings back to datetime-local format for display
  const formatForDateTimeLocal = (isoString: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toISOString().slice(0, 16);
    } catch {
      return isoString; // Return as-is if already in correct format
    }
  };

  const [localFormData, setLocalFormData] = useState({
    startTime: formatForDateTimeLocal(data.startTime || ''),
    type: data.type || 'video',
    location: data.location || '',
    addNotetaker: data.addNotetaker !== undefined ? data.addNotetaker : true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleInputChange = (field: string, value: any) => {
    setLocalFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!localFormData.startTime) {
      newErrors.startTime = 'Start time is required';
    } else {
      const startDate = new Date(localFormData.startTime);
      const now = new Date();
      if (startDate < now) {
        newErrors.startTime = 'Start time must be in the future';
      }
    }

    if (localFormData.type === 'in_person' && !localFormData.location) {
      newErrors.location = 'Location is required for in-person interviews';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (!validateForm()) {
      toast.error('Please fix the errors before continuing');
      return;
    }

    // Convert the local datetime input to full ISO string with timezone
    const startDate = new Date(localFormData.startTime);

    // Update the main data with full ISO string
    updateData({
      startTime: startDate.toISOString(),
      type: localFormData.type,
      location: localFormData.location,
      addNotetaker: localFormData.addNotetaker,
    });

    onNext();
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // At least 30 minutes from now
    return now.toISOString().slice(0, 16);
  };

  const formatDateTimeForDisplay = (dateTimeString: string) => {
    if (!dateTimeString) return '';
    try {
      const date = new Date(dateTimeString);
      return format(date, 'PPpp');
    } catch {
      return dateTimeString;
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Multi-Candidate Session Setup</h3>
        <p className="text-sm text-muted-foreground">
          Configure the base settings for your multi-candidate interview session
        </p>
      </div>

      <div className="grid gap-4">
        {/* Date and Time */}
        <div className="space-y-2">
          <Label htmlFor="startTime">Session Start Time</Label>
          <Input
            id="startTime"
            type="datetime-local"
            value={localFormData.startTime}
            onChange={(e) => handleInputChange('startTime', e.target.value)}
            min={getMinDateTime()}
            className={errors.startTime ? 'border-red-500' : ''}
          />
          {errors.startTime && (
            <p className="text-sm text-red-500">{errors.startTime}</p>
          )}
          {localFormData.startTime && (
            <p className="text-xs text-muted-foreground">
              {formatDateTimeForDisplay(localFormData.startTime)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Individual candidate slots will be scheduled sequentially from this time
          </p>
        </div>

        {/* Interview Type */}
        <div className="space-y-2">
          <Label htmlFor="type">Interview Type</Label>
          <Select
            value={localFormData.type}
            onValueChange={(value) => handleInputChange('type', value)}
          >
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="video">
                <div className="flex items-center">
                  <Video className="h-4 w-4 mr-2" />
                  Video Call
                </div>
              </SelectItem>
              <SelectItem value="phone">
                <div className="flex items-center">
                  <Phone className="h-4 w-4 mr-2" />
                  Phone Call
                </div>
              </SelectItem>
              <SelectItem value="in_person">
                <div className="flex items-center">
                  <MapPin className="h-4 w-4 mr-2" />
                  In Person
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Location (for in-person interviews) */}
        {localFormData.type === 'in_person' && (
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              type="text"
              placeholder="Enter the interview location"
              value={localFormData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              className={errors.location ? 'border-red-500' : ''}
            />
            {errors.location && (
              <p className="text-sm text-red-500">{errors.location}</p>
            )}
          </div>
        )}

        {/* AI Notetaker */}
        {localFormData.type === 'video' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>AI Notetaker for Multi-Candidate Sessions:</strong> The AI notetaker will join the main session and take notes for all candidates. Individual candidate segments will be identified in the transcript.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Info about multi-candidate sessions */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>How it works:</strong> You'll set individual time slots for each candidate in the next step. All candidates will receive the same meeting link but with different scheduled times.
        </AlertDescription>
      </Alert>

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
