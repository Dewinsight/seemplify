"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Video, Phone, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Textarea } from '../textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Checkbox } from '../checkbox';
import { Alert, AlertDescription } from '../alert';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface InterviewDetailsStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function InterviewDetailsStep({ data, updateData, onNext, onPrevious }: InterviewDetailsStepProps) {
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
    endTime: formatForDateTimeLocal(data.endTime || ''),
    duration: data.duration || 60,
    type: data.type || 'video',
    location: data.location || '',
    notes: data.notes || '',
    addNotetaker: data.addNotetaker !== undefined ? data.addNotetaker : true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    // Calculate end time when start time or duration changes
    if (localFormData.startTime && localFormData.duration) {
      const startDate = new Date(localFormData.startTime);
      const endDate = new Date(startDate.getTime() + localFormData.duration * 60000);
      // Keep the local display format for the input
      const endTimeDisplay = endDate.toISOString().slice(0, 16);
      setLocalFormData(prev => ({ ...prev, endTime: endTimeDisplay }));
    }
  }, [localFormData.startTime, localFormData.duration]);

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

    if (!localFormData.duration || localFormData.duration < 15) {
      newErrors.duration = 'Duration must be at least 15 minutes';
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

    // Convert the local datetime inputs to full ISO strings with timezone
    const startDate = new Date(localFormData.startTime);
    const endDate = new Date(localFormData.endTime);
    
    // Update the main data with full ISO strings
    updateData({
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      duration: localFormData.duration,
      type: localFormData.type,
      location: localFormData.location,
      notes: localFormData.notes,
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
      <div className="grid gap-4">
        {/* Date and Time */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startTime">Start Time</Label>
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (minutes)</Label>
            <Select
              value={localFormData.duration.toString()}
              onValueChange={(value) => handleInputChange('duration', parseInt(value))}
            >
              <SelectTrigger id="duration" className={errors.duration ? 'border-red-500' : ''}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="45">45 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="90">1.5 hours</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
              </SelectContent>
            </Select>
            {errors.duration && (
              <p className="text-sm text-red-500">{errors.duration}</p>
            )}
          </div>
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

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Notes (Optional)</Label>
          <Textarea
            id="notes"
            placeholder="Add any additional notes or instructions"
            value={localFormData.notes}
            onChange={(e) => handleInputChange('notes', e.target.value)}
            rows={3}
          />
        </div>

        {/* AI Notetaker */}
        {localFormData.type === 'video' && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="addNotetaker"
                checked={localFormData.addNotetaker}
                onCheckedChange={(checked) => handleInputChange('addNotetaker', checked)}
              />
              <div className="space-y-1">
                <Label htmlFor="addNotetaker" className="font-medium cursor-pointer">
                  Add AI Notetaker
                </Label>
                <p className="text-sm text-muted-foreground">
                  An AI assistant will join the meeting to take notes and provide a summary
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Timezone Notice */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          All times are shown in your timezone: {userTimezone}
        </AlertDescription>
      </Alert>

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
