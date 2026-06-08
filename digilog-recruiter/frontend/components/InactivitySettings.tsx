'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getTimeUntilLogout } from '@/services/apiConfig';

// Timeout options in minutes
const TIMEOUT_OPTIONS = [
  { value: 15, label: '15 minutes', description: 'Short session' },
  { value: 30, label: '30 minutes', description: 'Default' },
  { value: 60, label: '1 hour', description: 'Extended session' },
  { value: 120, label: '2 hours', description: 'Long session' },
  { value: 240, label: '4 hours', description: 'Very long session' },
];

export function InactivitySettings() {
  const [currentTimeout, setCurrentTimeout] = useState(30); // Default 30 minutes
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    // Load saved timeout from localStorage
    const savedTimeout = localStorage.getItem('inactivityTimeout');
    if (savedTimeout) {
      setCurrentTimeout(parseInt(savedTimeout));
    }

    // Update time remaining every second
    const interval = setInterval(() => {
      setTimeRemaining(getTimeUntilLogout());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleTimeoutChange = (value: string) => {
    const newTimeout = parseInt(value);
    setCurrentTimeout(newTimeout);
    
    // Save to localStorage
    localStorage.setItem('inactivityTimeout', value);
    
    // Note: The actual timeout change would require restarting the inactivity tracking
    // For now, we'll show a message that it takes effect on next login
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  };

  const getTimeoutDescription = (minutes: number): string => {
    const option = TIMEOUT_OPTIONS.find(opt => opt.value === minutes);
    return option?.description || 'Custom';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">🕐</span>
          Session Timeout Settings
        </CardTitle>
        <CardDescription>
          Configure how long you can be inactive before being automatically logged out for security.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Current Status */}
        <div className="p-4 bg-muted rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Current Session Status</Label>
            <Badge variant="outline" className="font-mono">
              {timeRemaining > 0 ? `${formatTime(timeRemaining)} remaining` : 'Inactive'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Your session will expire automatically when the timer reaches zero.
          </p>
        </div>

        {/* Timeout Configuration */}
        <div className="space-y-3">
          <Label htmlFor="timeout-select" className="text-sm font-medium">
            Auto-logout Timeout
          </Label>
          <Select value={currentTimeout.toString()} onValueChange={handleTimeoutChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select timeout duration" />
            </SelectTrigger>
            <SelectContent>
              {TIMEOUT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  <div className="flex items-center justify-between w-full">
                    <span>{option.label}</span>
                    <Badge variant="secondary" className="ml-2">
                      {option.description}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Current setting: <strong>{currentTimeout} minutes</strong> ({getTimeoutDescription(currentTimeout)})
          </p>
        </div>

        {/* Security Information */}
        <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg dark:border-blue-800 dark:bg-blue-950">
          <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
            🛡️ Security Features
          </h4>
          <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
            <li>• Warning appears 5 minutes before timeout</li>
            <li>• Activity tracking includes mouse, keyboard, and touch events</li>
            <li>• API requests automatically extend your session</li>
            <li>• Settings take effect on your next login</li>
          </ul>
        </div>

        {/* Activity Tracking Info */}
        <div className="text-xs text-muted-foreground">
          <p>
            <strong>Tracked activities:</strong> Mouse movement, clicks, keyboard input, scrolling, and API requests.
          </p>
          <p className="mt-1">
            <strong>Note:</strong> Timeout changes will take effect when you log in next time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
} 