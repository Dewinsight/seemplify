"use client";

import React, { useState, useEffect } from 'react';
import { Calendar, CheckCircle, AlertCircle, RefreshCw, Settings, ExternalLink, UserCheck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { GrantVerification } from '@/components/ui/grant-verification';
import interviewService from '@/services/interviewService';
import { grantService } from '@/services/grantService';
import { toast } from 'sonner';

interface CalendarStatus {
  connected: boolean;
  provider?: string;
  status?: string;
  verified?: boolean;
  error?: string;
  lastConnected?: string;
}

export default function CalendarSettingsPage() {
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  useEffect(() => {
    checkCalendarStatus();
    
    // Check for reauth query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const reauthStatus = urlParams.get('reauth');
    const message = urlParams.get('message');
    
    if (reauthStatus === 'success') {
      toast.success('Calendar re-authentication successful!');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (reauthStatus === 'error') {
      toast.error(`Re-authentication failed: ${message || 'Unknown error'}`);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (reauthStatus === 'required') {
      toast.warning('Calendar re-authentication is required. Please reconnect your calendar.');
    }
  }, []);

  const checkCalendarStatus = async () => {
    setLoading(true);
    try {
      // Dynamic verification: Check if grant actually exists in Nylas
      console.log('🔍 Checking calendar status with dynamic verification...');
      const verification = await grantService.verifyGrantStatus();
      
      console.log('📊 Grant verification result:', verification);
      
      setCalendarStatus({
        connected: verification.calendarConnected,
        provider: verification.grantInfo?.provider || 'google',
        status: verification.valid ? 'active' : verification.status,
        verified: verification.valid,
        error: !verification.valid ? verification.message : undefined
      });

      // Show warnings/errors
      if (!verification.valid) {
        if (verification.status === 'not_found') {
          toast.error('Your calendar connection has been revoked or deleted. Please reconnect.');
        } else if (verification.status === 'no_grant') {
          // No action needed - user hasn't connected yet
        } else {
          toast.warning(verification.message || 'Your calendar connection needs attention');
        }
      } else {
        console.log('✅ Calendar connected and verified with Nylas');
      }
    } catch (error) {
      console.error('Failed to check calendar status:', error);
      toast.error('Failed to check calendar status');
      setCalendarStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCalendar = async (provider: string = 'google', forceAccountSelection: boolean = false) => {
    if (forceAccountSelection) {
      setSwitchingAccount(true);
      // For Nylas v3, provide guidance to users
      toast.info('To switch accounts, please select a different Google account in the popup window, or log out of Google in your browser first.');
    } else {
      setConnecting(true);
      // Inform users about email permissions
      toast.info('You will be asked to grant email permissions for sending interview invitations');
    }
    
    try {
      const { authUrl } = await interviewService.connectCalendar(provider, forceAccountSelection);
      
      // Open OAuth window
      const authWindow = window.open(authUrl, '_blank', 'width=600,height=600');
      
      // Poll for connection status
      const pollInterval = setInterval(async () => {
        try {
          // Check if window is closed
          if (authWindow?.closed) {
            clearInterval(pollInterval);
            setConnecting(false);
            setSwitchingAccount(false);
            await checkCalendarStatus();
            return;
          }
          
          // Check connection status
          const status = await interviewService.getCalendarStatus('current-user-id');
          if (status.connected) {
            setCalendarStatus(status);
            clearInterval(pollInterval);
            setConnecting(false);
            setSwitchingAccount(false);
            authWindow?.close();
            toast.success(forceAccountSelection 
              ? 'Successfully switched Google account with email permissions!' 
              : 'Calendar connected successfully with email permissions!');
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      }, 2000);
      
      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setConnecting(false);
        setSwitchingAccount(false);
      }, 120000);
      
    } catch (error) {
      console.error('Connect calendar error:', error);
      toast.error(forceAccountSelection 
        ? 'Failed to switch Google account' 
        : 'Failed to connect calendar');
      setConnecting(false);
      setSwitchingAccount(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!confirm('Are you sure you want to disconnect your calendar? This will cancel all scheduled interviews.')) {
      return;
    }
    
    try {
      const result = await grantService.revokeGrant();
      toast.success(`Calendar disconnected. ${result.cancelledInterviews} interviews were cancelled.`);
      await checkCalendarStatus();
    } catch (error) {
      console.error('Disconnect calendar error:', error);
      toast.error('Failed to disconnect calendar');
    }
  };

  const handleSwitchAccountWithGuidance = async () => {
    const switchAccount = async () => {
      await handleConnectCalendar('google', true);
    };

    // Show a more detailed explanation
    if (confirm(
      'To switch to a different Google account:\n\n' +
      '1. Click "OK" to open the authentication window\n' +
      '2. If you see the same account, click "Use another account"\n' +
      '3. Or log out of Google in another browser tab first\n\n' +
      'Would you like to continue?'
    )) {
      await switchAccount();
    }
  };

  const getStatusBadge = () => {
    if (!calendarStatus.connected) {
      return <Badge variant="destructive">Not Connected</Badge>;
    }
    
    if (calendarStatus.verified === false) {
      return <Badge variant="outline">Needs Verification</Badge>;
    }
    
    switch (calendarStatus.status) {
      case 'active':
        return <Badge variant="default" className="bg-green-100 text-green-800">Connected</Badge>;
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
      case 'invalid':
        return <Badge variant="destructive">Invalid</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

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
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Calendar Settings</h1>
        <p className="text-muted-foreground">Manage your calendar integration for interview scheduling</p>
      </div>

      {/* Dynamic Grant Verification Alert */}
      {calendarStatus.connected && !calendarStatus.verified && (
        <Alert className="border-red-500 bg-red-50">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="font-semibold">⚠️ Calendar Connection Invalid</p>
                <p className="text-sm">
                  {calendarStatus.error || 'Your calendar connection is no longer valid. This can happen if you revoked access or the connection expired.'}
                </p>
                <p className="text-sm font-medium">
                  You won't be able to schedule interviews until you reconnect your calendar.
                </p>
              </div>
              <Button
                onClick={() => handleConnectCalendar('google', false)}
                variant="destructive"
                size="sm"
                className="ml-4 whitespace-nowrap"
              >
                Reconnect Now
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Calendar Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Calendar Connection
          </CardTitle>
          <CardDescription>
            Connect your calendar to automatically sync interviews and check availability
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                {getStatusBadge()}
              </div>
              
              {calendarStatus.provider && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Provider:</span>
                  <span className="text-sm font-medium capitalize">{calendarStatus.provider}</span>
                </div>
              )}
            </div>
            
            <Button
              onClick={checkCalendarStatus}
              variant="outline"
              size="sm"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {calendarStatus.error && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {calendarStatus.error}
              </AlertDescription>
            </Alert>
          )}

          {calendarStatus.connected ? (
            <div className="space-y-4">
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Your calendar is connected and ready for interview scheduling.
                  {calendarStatus.lastConnected && (
                    <span className="block text-sm mt-1">
                      Last connected: {new Date(calendarStatus.lastConnected).toLocaleString()}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectCalendar('google', false)}
                  variant="outline"
                  size="sm"
                  disabled={connecting}
                >
                  {connecting ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Reconnect
                </Button>
                
                <Button
                  onClick={handleDisconnectCalendar}
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect your calendar to enable automatic interview scheduling, availability checking, and calendar sync.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <p className="text-sm font-medium">Available Providers:</p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleConnectCalendar('google')}
                    disabled={connecting}
                    className="flex items-center gap-2"
                  >
                    {connecting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Connect Google Calendar
                  </Button>
                  
                  {/* Future providers */}
                  <Button
                    onClick={() => toast.info('Outlook integration coming soon')}
                    variant="outline"
                    disabled
                  >
                    Outlook (Coming Soon)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grant Verification */}
      <GrantVerification 
        onGrantStatusChange={(status) => {
          // Update calendar status based on grant status
          setCalendarStatus(prev => ({
            ...prev,
            connected: status.calendarConnected,
            status: status.status === 'valid' ? 'active' : status.status,
            verified: status.status === 'valid'
          }));
        }}
      />

      {/* Calendar Features */}
      <Card>
        <CardHeader>
          <CardTitle>Calendar Features</CardTitle>
          <CardDescription>
            What you can do with calendar integration
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Automatic Scheduling
              </h4>
              <p className="text-sm text-muted-foreground">
                Create calendar events automatically when interviews are scheduled
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Availability Checking
              </h4>
              <p className="text-sm text-muted-foreground">
                Prevent double-booking by checking availability before scheduling
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Real-time Sync
              </h4>
              <p className="text-sm text-muted-foreground">
                Keep interviews in sync with external calendar changes
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Meeting Links
              </h4>
              <p className="text-sm text-muted-foreground">
                Automatically generate video meeting links for remote interviews
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Information */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Details</CardTitle>
          <CardDescription>
            Technical information about the calendar integration
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <strong>API Version:</strong> Nylas v3
            </div>
            <div>
              <strong>Sync Method:</strong> Webhooks
            </div>
            <div>
              <strong>Permissions:</strong> Calendar Read/Write
            </div>
            <div>
              <strong>Data Storage:</strong> Encrypted
            </div>
          </div>
          
          <Separator />
          
          <div className="text-xs text-muted-foreground">
            <p>
              Your calendar data is securely encrypted and only used for interview scheduling purposes. 
              You can disconnect your calendar at any time.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 