"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Calendar, CheckCircle, AlertCircle, AlertTriangle, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../button';
import { Alert, AlertDescription, AlertTitle } from '../alert';
import { Badge } from '../badge';
import { Card, CardContent } from '../card';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import interviewService from '@/services/interviewService';
import { grantService } from '@/services/grantService';
import GrantLimitWarningModal from '@/components/GrantLimitWarningModal';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';

interface CalendarConnectionStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
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

export function CalendarConnectionStep({ data, updateData, onNext }: CalendarConnectionStepProps) {
  const { state } = useUser();
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>({ connected: false });
  const [isVerifying, setIsVerifying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [showAuthHelper, setShowAuthHelper] = useState(false);
  const [activeAuthUrl, setActiveAuthUrl] = useState<string | null>(null);
  const authWindowRef = useRef<Window | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>(data.calendarProvider || 'google');
  const [serverError, setServerError] = useState<string | null>(null);
  const [showGrantLimitWarning, setShowGrantLimitWarning] = useState(false);
  const [pendingAccountSwitch, setPendingAccountSwitch] = useState(false);

  const providers: ProviderOption[] = [
    {
      id: 'google',
      name: 'Google Calendar',
      icon: <Calendar className="h-5 w-5" />,
      color: 'bg-blue-500'
    },
    {
      id: 'microsoft',
      name: 'Microsoft Outlook',
      icon: <Calendar className="h-5 w-5" />,
      color: 'bg-purple-500'
    }
  ];

  const isMicrosoftGrantProvider = (provider?: string) => {
    const normalized = String(provider || '').toLowerCase();
    return normalized.includes('microsoft') || normalized.includes('outlook') || normalized.includes('azure');
  };

  const normalizeProviderId = (provider?: string): 'google' | 'microsoft' => {
    return isMicrosoftGrantProvider(provider) ? 'microsoft' : 'google';
  };

  const getMissingTeamsScopes = (scopes: any[] = []) => {
    const normalizedScopes = scopes.map(scope => String(scope).toLowerCase());
    const hasCalendarsReadWrite = normalizedScopes.some(scope => scope.includes('calendars.readwrite'));
    const hasOnlineMeetingsReadWrite = normalizedScopes.some(scope => scope.includes('onlinemeetings.readwrite'));

    return [
      !hasCalendarsReadWrite ? 'Calendars.ReadWrite' : null,
      !hasOnlineMeetingsReadWrite ? 'OnlineMeetings.ReadWrite' : null
    ].filter(Boolean) as string[];
  };

  useEffect(() => {
    if (state.user?._id) {
      checkCalendarStatus();
    }
  }, [state.user?._id]);

  const checkCalendarStatus = async () => {
    if (!state.user?._id) return null;
    
    setIsVerifying(true);
    setServerError(null);
    
    try {
      console.log(`🔍 DYNAMIC CHECK: Verifying calendar grant for user ${state.user._id}...`);
      
      // Use dynamic verification that checks with Nylas API
      const verification = await grantService.verifyGrantStatus();
      console.log('Grant verification result:', verification);
      
      if (verification.valid && verification.calendarConnected) {
        const grantProvider = verification.grantInfo?.provider || 'google';
        const providerId = normalizeProviderId(grantProvider);
        const missingTeamsScopes = isMicrosoftGrantProvider(grantProvider)
          ? getMissingTeamsScopes(verification.grantInfo?.scopes || [])
          : [];

        if (missingTeamsScopes.length > 0) {
          const missingScopeText = missingTeamsScopes.join(', ');
          const scopeErrorMessage = `Microsoft Teams permissions are incomplete. Missing: ${missingScopeText}. Reconnect Microsoft calendar and accept all requested scopes.`;
          console.warn(`Teams scope check failed: ${scopeErrorMessage}`);
          setServerError(scopeErrorMessage);
          setCalendarStatus({
            connected: false,
            provider: 'microsoft',
            verified: false,
            error: 'TEAMS_SCOPE_MISSING'
          });
          updateData({
            calendarConnected: false,
            calendarProvider: 'microsoft',
            provider: 'microsoft'
          });
          setSelectedProvider('microsoft');

          return { connected: false, provider: 'microsoft', missingScopes: missingTeamsScopes };
        }

        console.log(`Calendar verified with Nylas - Provider: ${grantProvider}`);
        setCalendarStatus({
          connected: true,
          provider: providerId,
          verified: true
        });
        updateData({ 
          calendarConnected: true, 
          calendarProvider: providerId,
          calendarEmail: verification.grantInfo?.email || '',
          provider: providerId
        });
        setSelectedProvider(providerId);
        
        return { connected: true, provider: providerId };
      } else {
        console.log(`❌ Calendar not connected or invalid - Status: ${verification.status}`);
        
        // Show specific error message
        if (verification.status === 'not_found') {
          setServerError('Your calendar connection has been revoked or deleted. Please reconnect.');
          toast.error('Calendar connection no longer valid. Please reconnect.');
        } else if (verification.status === 'no_grant') {
          // No error needed - user hasn't connected yet
        } else {
          setServerError(verification.message || 'Calendar connection is invalid');
        }
        
        setCalendarStatus({ 
          connected: false,
          verified: false,
          error: verification.message
        });
        updateData({ calendarConnected: false });
        
        return { connected: false };
      }
    } catch (error: any) {
      console.error('Error checking calendar status:', error);
      setServerError(error.message || 'Unable to verify calendar connection. Please try again.');
      setCalendarStatus({ 
        connected: false, 
        error: error.message || 'Unable to verify calendar connection' 
      });
      return null;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleConnectCalendar = async (forceAccountSelection = false) => {
    // NEW: Check grant limit before connecting (unless switching accounts)
    if (!forceAccountSelection) {
      try {
        const response = await fetch('/api/admin/grants/usage', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.usage.atLimit) {
            // Show warning modal instead of connecting directly
            setShowGrantLimitWarning(true);
            return;
          }
        }
      } catch (error) {
        console.log('Could not check grant usage, proceeding with connection');
        // If we can't check limit, proceed anyway (fail open)
      }
    }
    
    // Proceed with original connection logic
    await proceedWithConnection(forceAccountSelection);
  };

  const proceedWithConnection = async (forceAccountSelection = false) => {
    if (forceAccountSelection) {
      setIsSwitchingAccount(true);
    } else {
      setIsConnecting(true);
    }
    setShowAuthHelper(true);
    
    try {
      const result = await interviewService.connectCalendar(selectedProvider, forceAccountSelection);
      setActiveAuthUrl(result.authUrl || null);
      
      if (result.authUrl) {
        // Open OAuth in a popup window
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.innerWidth - width) / 2;
        const top = window.screenY + (window.innerHeight - height) / 2;
        
        const popup = window.open(
          result.authUrl,
          'calendar_oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
        );
        authWindowRef.current = popup;

        if (!popup) {
          // Fallback to new tab if popup blocked
          setIsConnecting(false);
          setIsSwitchingAccount(false);
          window.open(result.authUrl, '_blank');
          toast.info('Please complete the calendar connection in the new tab');
          return;
        }
        
        // Set up message listener for OAuth completion
        const messageHandler = async (event: MessageEvent) => {
          if (event.data.type === 'oauth_success') {
            console.log('✅ OAuth success message received');
            window.removeEventListener('message', messageHandler);
            
            // Close popup immediately
            try {
              if (popup && !popup.closed) {
                popup.close();
                console.log('✅ Popup closed from parent');
              }
            } catch (err) {
              console.error('❌ Error closing popup:', err);
            }
            
            // Reset loading states immediately
            setIsConnecting(false);
            setIsSwitchingAccount(false);
            setShowAuthHelper(false);
            
            toast.success('Calendar connected successfully!');
            
            // Refresh calendar status with polling
            await checkCalendarStatus();
            
            // Poll a few more times in case backend takes time to process
            let pollCount = 0;
            const maxPolls = 3;
            const pollInterval = setInterval(async () => {
              console.log(`Polling calendar status ${pollCount + 1}/${maxPolls}...`);
              const result = await checkCalendarStatus();
              pollCount++;
              
              if (pollCount >= maxPolls || (result && result.connected)) {
                clearInterval(pollInterval);
              }
            }, 2000);
            
          } else if (event.data.type === 'oauth_error') {
            console.error('❌ OAuth error:', event.data.error);
            window.removeEventListener('message', messageHandler);
            
            // Close popup if it exists
            try {
              if (popup && !popup.closed) {
                popup.close();
              }
            } catch (err) {
              console.error('Error closing popup on error:', err);
            }
            
            // Reset loading states
            setIsConnecting(false);
            setIsSwitchingAccount(false);
            
            // Handle specific error types
            if (event.data.error === 'GRANT_SLOTS_FULL') {
              toast.error(
                'Calendar slots are full. All available slots are occupied by users with upcoming interviews. Please contact your administrator.',
                { duration: 8000 }
              );
            } else {
              toast.error(event.data.message || event.data.error || 'Failed to connect calendar');
            }
          }
        };
        
        window.addEventListener('message', messageHandler);
        
        // Check if popup was closed without completing
        if (popup) {
          const checkClosed = setInterval(async () => {
            try {
              if (popup.closed) {
                console.log('🔍 Popup closed, checking calendar status');
                clearInterval(checkClosed);
                window.removeEventListener('message', messageHandler);

                // Reset loading states immediately
                setIsConnecting(false);
                setIsSwitchingAccount(false);

                // Check calendar status
                const initialResult = await checkCalendarStatus();

                // If not connected yet, poll a few times
                if (!initialResult?.connected) {
                  let pollCount = 0;
                  const maxPolls = 3;
                  const pollInterval = setInterval(async () => {
                    console.log(`Polling after popup close: ${pollCount + 1}/${maxPolls}...`);
                    const result = await checkCalendarStatus();
                    pollCount++;

                    if (pollCount >= maxPolls || (result && result.connected)) {
                      clearInterval(pollInterval);
                      
                      if (result && result.connected) {
                        toast.success('Calendar connected successfully!');
                      }
                    }
                  }, 1500);
                }
              }
            } catch (err) {
              // Ignore cross-origin errors
            }
          }, 500);
          
          // Safety timeout: reset states after 3 minutes regardless
          setTimeout(() => {
            setIsConnecting(false);
            setIsSwitchingAccount(false);
          }, 180000);
        }
      } else {
        throw new Error('Failed to get authorization URL');
      }
    } catch (error: any) {
      console.error('Calendar connection error:', error);
      toast.error(error.message || `Failed to connect ${selectedProvider} calendar. Please try again.`);
      setIsConnecting(false);
      setIsSwitchingAccount(false);
      setShowAuthHelper(false);
      setActiveAuthUrl(null);
      authWindowRef.current = null;
    }
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId);
    updateData({ calendarProvider: providerId, provider: providerId });
  };

  const handleContinue = () => {
    if (calendarStatus.connected && calendarStatus.verified) {
      onNext();
    } else if (calendarStatus.connected && !calendarStatus.verified) {
      toast.error('Your calendar connection is invalid. Please reconnect before continuing.');
    } else {
      toast.error('Please connect your calendar before continuing');
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium">Connect Your Calendar</h3>
        <p className="text-sm text-muted-foreground">
          We need access to your calendar to schedule interviews and check availability
        </p>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {/* Warning if grant exists in DB but not verified with Nylas */}
      {calendarStatus.connected && !calendarStatus.verified && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Calendar Connection Invalid</AlertTitle>
          <AlertDescription>
            Your calendar connection is no longer valid. This can happen if you revoked access.
            Please reconnect your calendar to continue.
          </AlertDescription>
        </Alert>
      )}

      {calendarStatus.connected && calendarStatus.verified ? (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-medium">Calendar Connected</p>
                    <p className="text-sm text-muted-foreground">
                      {calendarStatus.provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'} is connected
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setIsDisconnecting(true);
                      try {
                        // Disconnect the current calendar
                        await interviewService.disconnectCalendar();
                        toast.success('Calendar disconnected');
                        
                        // Update local state
                        setCalendarStatus({ connected: false });
                        updateData({ calendarConnected: false });
                        setSelectedProvider(calendarStatus.provider === 'google' ? 'microsoft' : 'google');
                      } catch (error: any) {
                        console.error('Failed to disconnect calendar:', error);
                        toast.error(error.message || 'Failed to disconnect calendar');
                      } finally {
                        setIsDisconnecting(false);
                      }
                    }}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      'Change Account'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="text-center text-sm text-muted-foreground">
            <p>Want to use a different calendar provider?</p>
            <p>Click "Change Account" to connect {calendarStatus.provider === 'google' ? 'Microsoft Outlook' : 'Google Calendar'} instead.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm font-medium mb-3">Choose a calendar provider:</p>
            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider.id)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedProvider === provider.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`p-3 rounded-full ${provider.color} text-white`}>
                      {provider.icon}
                    </div>
                    <span className="text-sm font-medium">{provider.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedProvider === 'microsoft' && (
            <Alert variant="warning" className="max-w-md mx-auto">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Microsoft Teams configuration required (for Notetaker)</AlertTitle>
              <AlertDescription>
                <p className="mt-2">
                  If you plan to use Teams meetings with the AI notetaker, your Microsoft 365 admin must enable:
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

          <div className="flex justify-center">
            <Button
              onClick={() => handleConnectCalendar(false)}
              disabled={isConnecting || isVerifying}
              className="w-full max-w-xs"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect {selectedProvider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Grant Limit Warning Modal */}
      <GrantLimitWarningModal
        isOpen={showGrantLimitWarning}
        onClose={() => {
          setShowGrantLimitWarning(false);
          setPendingAccountSwitch(false);
        }}
        onContinue={async () => {
          setShowGrantLimitWarning(false);
          const isSwitch = pendingAccountSwitch;
          setPendingAccountSwitch(false);
          await proceedWithConnection(isSwitch);
        }}
        onCancel={() => {
          setShowGrantLimitWarning(false);
          setPendingAccountSwitch(false);
          setIsConnecting(false);
          setIsSwitchingAccount(false);
          setShowAuthHelper(false);
        }}
      />

      {showAuthHelper && (
        <div className="fixed right-4 lg:right-8 top-1/2 -translate-y-1/2 z-[12000] w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-blue-200 bg-white shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 rounded-t-2xl">
            <div className="flex items-center gap-2 text-blue-900 font-semibold">
              <ExternalLink className="h-4 w-4" />
              Authentication Guide
            </div>
            <p className="text-xs text-blue-800 mt-1">
              Follow these exact steps in the popup to complete safely.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">1</span>
                  <div>
                    <p className="font-medium text-gray-900">On Nylas warning page</p>
                    <p className="text-gray-600">Click <strong>"I understand, continue"</strong>.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">2</span>
                  <div>
                    <p className="font-medium text-gray-900">Confirm sandbox warning</p>
                    <p className="text-gray-600">Click <strong>"Authenticate anyway"</strong>.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-white text-xs font-bold">3</span>
                  <div>
                    <p className="font-medium text-gray-900">On Google permission screen</p>
                    <p className="text-gray-600">Tick <strong>"Select all"</strong>, then continue/allow.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white text-xs font-bold">4</span>
                  <div>
                    <p className="font-medium text-gray-900">Return here and verify</p>
                    <p className="text-gray-600">Back in SmartHR, click <strong>"I Completed Authentication"</strong>.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 mt-0.5 text-blue-600" />
                <div>
                  <p className="font-semibold">Tip</p>
                  <p>If the popup is hidden behind windows, use <strong>Open Authentication Window</strong> below.</p>
                </div>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <Button
                className="w-full"
                variant="outline"
                disabled={!activeAuthUrl}
                onClick={() => {
                  if (!activeAuthUrl) return;
                  const reopened = window.open(
                    activeAuthUrl,
                    'calendar_oauth',
                    'width=600,height=700,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no'
                  );
                  if (reopened) {
                    authWindowRef.current = reopened;
                    reopened.focus();
                  } else {
                    toast.error('Popup was blocked. Please allow popups for this site.');
                  }
                }}
              >
                Open Authentication Window
              </Button>
              <Button
                className="w-full"
                onClick={async () => {
                  const result = await checkCalendarStatus();
                  if (result?.connected) {
                    setIsConnecting(false);
                    setIsSwitchingAccount(false);
                    setShowAuthHelper(false);
                    setActiveAuthUrl(null);
                    toast.success('Calendar connected successfully');
                  } else {
                    toast.info('Still waiting for authentication to complete');
                  }
                }}
              >
                I Completed Authentication
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => {
                  setShowAuthHelper(false);
                  setIsConnecting(false);
                  setIsSwitchingAccount(false);
                }}
              >
                Dismiss Guide
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="step-nav-actions hidden flex justify-between pt-6">
        <Button
          variant="outline"
          onClick={() => checkCalendarStatus()}
          disabled={isVerifying}
          data-step-action="refresh"
        >
          {isVerifying ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Status
            </>
          )}
        </Button>
        
        <Button
          onClick={handleContinue}
          disabled={!calendarStatus.connected || !calendarStatus.verified}
          data-step-action="next"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

