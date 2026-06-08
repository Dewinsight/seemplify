import { useState, useEffect, useCallback } from 'react';
import * as React from 'react';
import { grantService, GrantStatus, GrantVerification, isGrantError } from '../services/grantService';
import { useToast } from '@/components/ui/use-toast';
import { useRouter } from 'next/navigation';
import { ToastAction, type ToastActionElement } from '@/components/ui/toast';

export interface UseGrantVerificationReturn {
  grantStatus: GrantStatus | null;
  verification: GrantVerification | null;
  loading: boolean;
  verifying: boolean;
  reauthenticating: boolean;
  checkStatus: () => Promise<void>;
  verifyGrant: () => Promise<void>;
  initiateReauth: () => Promise<void>;
  revokeGrant: () => Promise<void>;
  isGrantValid: boolean;
  requiresReauth: boolean;
}

interface GrantVerificationState {
  isVerifying: boolean;
  needsReauth: boolean;
  lastVerified: Date | null;
}

export function useGrantVerification(enabled: boolean = true): UseGrantVerificationReturn {
  const [grantStatus, setGrantStatus] = useState<GrantStatus | null>(null);
  const [verification, setVerification] = useState<GrantVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GrantVerificationState>({
    isVerifying: false,
    needsReauth: false,
    lastVerified: null,
  });
  const { toast } = useToast();
  const router = useRouter();

  const checkStatus = useCallback(async () => {
    try {
      setLoading(true);
      const status = await grantService.getGrantStatus();
      setGrantStatus(status);
    } catch (error) {
      console.error('Error checking grant status:', error);
      toast({
        title: "Error",
        description: "Failed to check grant status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const verifyGrant = useCallback(async () => {
    if (!enabled || state.isVerifying) return;

    setState(prev => ({ ...prev, isVerifying: true }));

    try {
      const verification = await grantService.verifyGrant();
      
      if (!verification.valid) {
        setState(prev => ({ 
          ...prev, 
          needsReauth: verification.requiresReauth || false,
          isVerifying: false 
        }));

        if (verification.requiresReauth) {
          toast({
            title: "Calendar Access Expired",
            description: "Your calendar access has expired. Please reconnect to continue scheduling interviews.",
            variant: "destructive",
            action: React.createElement(ToastAction, {
              altText: "Reconnect to calendar",
              onClick: () => router.push('/settings/calendar?reauth=required')
            }, "Reconnect") as unknown as ToastActionElement
          });
        }
      } else {
        setState(prev => ({ 
          ...prev, 
          needsReauth: false,
          lastVerified: new Date(),
          isVerifying: false 
        }));
        setVerification(verification);
        await checkStatus();
      }
    } catch (error) {
      console.error('Grant verification error:', error);
      setState(prev => ({ ...prev, isVerifying: false }));
    }
  }, [enabled, state.isVerifying, toast, router, checkStatus]);

  const initiateReauth = useCallback(async () => {
    try {
      setLoading(true);
      const authUrl = await grantService.generateReauthUrl();
      
      const authWindow = window.open(authUrl, 'grant-reauth', 'width=600,height=700,scrollbars=yes,resizable=yes');
      
      const pollTimer = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(pollTimer);
          setLoading(false);
          
          setTimeout(() => {
            checkStatus();
            toast({
              title: "Re-authentication Complete",
              description: "Please verify your grant status",
            });
          }, 2000);
        }
      }, 1000);
      
      toast({
        title: "Re-authentication Started",
        description: "Please complete the authentication in the popup window",
      });
    } catch (error) {
      console.error('Error initiating reauth:', error);
      toast({
        title: "Re-authentication Failed",
        description: "Failed to start re-authentication process",
        variant: "destructive",
      });
      setLoading(false);
    }
  }, [toast, checkStatus]);

  const revokeGrant = useCallback(async () => {
    if (!confirm('Are you sure you want to revoke calendar access? This will cancel all scheduled interviews.')) {
      return;
    }

    try {
      setLoading(true);
      const result = await grantService.revokeGrant();
      
      toast({
        title: "Grant Revoked",
        description: `Calendar access revoked. ${result.cancelledInterviews} interviews were cancelled.`,
      });
      
      await checkStatus();
    } catch (error) {
      console.error('Error revoking grant:', error);
      toast({
        title: "Revocation Failed",
        description: "Failed to revoke grant",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, checkStatus]);

  useEffect(() => {
    if (!enabled) return;

    // Initial verification
    verifyGrant();

    // Verify every 5 minutes
    const interval = setInterval(verifyGrant, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [enabled, verifyGrant]);

  // Also verify when window regains focus
  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => {
      // Only verify if last verification was more than 1 minute ago
      if (!state.lastVerified || 
          new Date().getTime() - state.lastVerified.getTime() > 60000) {
        verifyGrant();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [enabled, verifyGrant, state.lastVerified]);

  const isGrantValid = Boolean(grantStatus?.status === 'valid' && grantStatus?.calendarConnected);
  const requiresReauth = Boolean(state.needsReauth || 
    (grantStatus && ['expired', 'invalid', 'no_grant'].includes(grantStatus.status)));

  return {
    grantStatus,
    verification,
    loading,
    verifying: state.isVerifying,
    reauthenticating: loading,
    checkStatus,
    verifyGrant,
    initiateReauth,
    revokeGrant,
    isGrantValid,
    requiresReauth,
  };
}

// Hook to handle grant errors in API responses
export function useGrantErrorHandler() {
  const { toast } = useToast();
  const router = useRouter();

  const handleGrantError = useCallback((error: string) => {
    if (isGrantError(error)) {
      toast({
        title: "Calendar Access Required",
        description: "Your calendar access needs to be renewed. Click to reconnect.",
        variant: "destructive",
        action: React.createElement(ToastAction, {
          altText: "Reconnect calendar",
          onClick: () => router.push('/settings/calendar?reauth=required')
        }, "Reconnect Calendar") as unknown as ToastActionElement
      });
    }
  }, [toast, router]);

  return { handleGrantError };
} 