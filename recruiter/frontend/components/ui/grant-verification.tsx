"use client";

import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Alert, AlertDescription } from './alert';
import { Loader2, Calendar, AlertTriangle, CheckCircle, XCircle, RefreshCw, UserCheck } from 'lucide-react';
import { grantService, GrantStatus, GrantVerification } from '../../services/grantService';
import { useToast } from './use-toast';

interface GrantVerificationProps {
  onGrantStatusChange?: (status: GrantStatus) => void;
  showAdminControls?: boolean;
}

export function GrantVerification({ onGrantStatusChange, showAdminControls = false }: GrantVerificationProps) {
  const [grantStatus, setGrantStatus] = useState<GrantStatus | null>(null);
  const [verification, setVerification] = useState<GrantVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadGrantStatus();
  }, []);

  const loadGrantStatus = async () => {
    try {
      setLoading(true);
      const status = await grantService.getGrantStatus();
      setGrantStatus(status);
      onGrantStatusChange?.(status);
    } catch (error) {
      console.error('Error loading grant status:', error);
      toast({
        title: "Error",
        description: "Failed to load grant status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const verifyGrant = async () => {
    try {
      setVerifying(true);
      const result = await grantService.verifyGrant();
      setVerification(result);
      
      if (result.valid) {
        toast({
          title: "Grant Verified",
          description: "Your calendar access is working correctly",
        });
        // Reload status to get updated information
        await loadGrantStatus();
      } else if (result.requiresReauth) {
        toast({
          title: "Re-authentication Required",
          description: result.error || "Your calendar access needs to be renewed",
          variant: "destructive",
        });
      } else if (result.temporaryError) {
        toast({
          title: "Temporary Error",
          description: "There was a temporary issue verifying your grant. Please try again later.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error verifying grant:', error);
      toast({
        title: "Verification Failed",
        description: "Failed to verify grant status",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const initiateReauth = async (forceAccountSelection: boolean = false) => {
    try {
      if (forceAccountSelection) {
        setSwitchingAccount(true);
      } else {
        setReauthenticating(true);
      }
      
      const authUrl = await grantService.generateReauthUrl(undefined, forceAccountSelection);
      
      // Open the auth URL in a new window
      const authWindow = window.open(authUrl, 'grant-reauth', 'width=600,height=700,scrollbars=yes,resizable=yes');
      
      // Poll for window closure to detect completion
      const pollTimer = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(pollTimer);
          setReauthenticating(false);
          setSwitchingAccount(false);
          
          // Wait a moment then reload status
          setTimeout(() => {
            loadGrantStatus();
            toast({
              title: forceAccountSelection ? "Account Switch Complete" : "Re-authentication Complete",
              description: "Please verify your grant status",
            });
          }, 2000);
        }
      }, 1000);
      
      toast({
        title: forceAccountSelection ? "Account Selection Started" : "Re-authentication Started",
        description: forceAccountSelection 
          ? "Please select the calendar account you want to use in the popup window"
          : "Please complete the authentication in the popup window",
      });
    } catch (error) {
      console.error('Error initiating reauth:', error);
      toast({
        title: forceAccountSelection ? "Account Switch Failed" : "Re-authentication Failed",
        description: forceAccountSelection 
          ? "Failed to start account switching process"
          : "Failed to start re-authentication process",
        variant: "destructive",
      });
      setReauthenticating(false);
      setSwitchingAccount(false);
    }
  };

  const revokeGrant = async () => {
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
      
      await loadGrantStatus();
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
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
      case 'active':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Valid</Badge>;
      case 'expired':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Expired</Badge>;
      case 'invalid':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Invalid</Badge>;
      case 'revoked':
        return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Revoked</Badge>;
      case 'reauth_pending':
        return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Re-auth Pending</Badge>;
      case 'no_grant':
        return <Badge variant="outline"><AlertTriangle className="w-3 h-3 mr-1" />No Grant</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading && !grantStatus) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading grant status...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Calendar Grant Status
        </CardTitle>
        <CardDescription>
          Manage your calendar integration and authentication status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {grantStatus && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Status:</span>
              {getStatusBadge(grantStatus.status)}
            </div>
            
            <div className="flex items-center justify-between">
              <span className="font-medium">Calendar Connected:</span>
              <Badge variant={grantStatus.calendarConnected ? "default" : "secondary"}>
                {grantStatus.calendarConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            
            {grantStatus.hasGrantId && (
              <div className="flex items-center justify-between">
                <span className="font-medium">Grant ID:</span>
                <Badge variant="outline">Present</Badge>
              </div>
            )}
            
            {grantStatus.lastGrantRefresh && (
              <div className="flex items-center justify-between">
                <span className="font-medium">Last Refresh:</span>
                <span className="text-sm text-gray-600">
                  {new Date(grantStatus.lastGrantRefresh).toLocaleString()}
                </span>
              </div>
            )}
            
            {grantStatus.lastGrantExpiry && (
              <div className="flex items-center justify-between">
                <span className="font-medium">Last Expiry:</span>
                <span className="text-sm text-red-600">
                  {new Date(grantStatus.lastGrantExpiry).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {verification && !verification.valid && (
          <Alert variant={verification.requiresReauth ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Verification Failed:</strong> {verification.error}
              {verification.requiresReauth && (
                <span className="block mt-1">Re-authentication is required to restore calendar access.</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={verifyGrant}
            disabled={verifying || loading}
            variant="outline"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Verify Grant
              </>
            )}
          </Button>
          
          {grantStatus && ['expired', 'invalid', 'no_grant'].includes(grantStatus.status) && (
            <Button
              onClick={() => initiateReauth(false)}
              disabled={reauthenticating || loading}
            >
              {reauthenticating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Re-authenticating...
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4 mr-2" />
                  Reconnect Calendar
                </>
              )}
            </Button>
          )}
          
          {grantStatus && grantStatus.calendarConnected && (
            <Button
              onClick={() => initiateReauth(true)}
              disabled={switchingAccount || loading}
              variant="outline"
            >
              {switchingAccount ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Switching Account...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4 mr-2" />
                  Switch Google Account
                </>
              )}
            </Button>
          )}
          
          {grantStatus && grantStatus.hasGrantId && (
            <Button
              onClick={revokeGrant}
              disabled={loading}
              variant="destructive"
            >
              Revoke Access
            </Button>
          )}
          
          <Button
            onClick={loadGrantStatus}
            disabled={loading}
            variant="ghost"
            size="sm"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
} 
