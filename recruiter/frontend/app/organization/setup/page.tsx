'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, ExternalLink, RefreshCw, LogOut } from 'lucide-react';

export default function OrganizationSetupPage() {
  const { currentOrganization, isLoading, organizations, forceRefresh } = useOrganization();
  const { logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';

  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Redirect if user already has an organization
  useEffect(() => {
    if (!isLoading && currentOrganization) {
      console.log('✅ User already has organization, redirecting to dashboard');
      router.push('/dashboard');
    }
  }, [currentOrganization, isLoading, router]);

  // Auto-redirect to IdP after a short delay
  useEffect(() => {
    if (!isLoading && !currentOrganization && organizations.length === 0) {
      const timer = setTimeout(() => {
        handleGoToIdp();
      }, 2000); // 2 second delay before auto-redirect

      return () => clearTimeout(timer);
    }
  }, [isLoading, currentOrganization, organizations.length]);

  const handleGoToIdp = () => {
    setIsRedirecting(true);
    const returnUrl = encodeURIComponent(window.location.origin + '/organization/check');
    window.location.href = `${idpUrl}/organizations?return_url=${returnUrl}`;
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await forceRefresh();
      // If after refresh we have an org, the useEffect will redirect to dashboard
    } catch (error) {
      console.error('Failed to refresh organizations:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Building2 className="w-8 h-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl">Organization Required</CardTitle>
          <CardDescription className="text-base mt-2">
            You need to create or join an organization to use SmartHR.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* IdP Redirect Info */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-medium text-blue-900 mb-2">
              Organizations are managed in the Identity Provider
            </h3>
            <p className="text-sm text-blue-700">
              Create a new organization or accept an invitation to join an existing one through the Identity Provider Hub.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button
              onClick={handleGoToIdp}
              disabled={isRedirecting}
              className="w-full bg-blue-600 hover:bg-blue-700"
              size="lg"
            >
              {isRedirecting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Redirecting to Identity Provider...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Go to Identity Provider
                </>
              )}
            </Button>

            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {isRefreshing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Checking for organizations...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  I already joined an organization
                </>
              )}
            </Button>

            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full text-gray-500 hover:text-gray-700"
              size="lg"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>

          {/* Auto-redirect notice */}
          <p className="text-center text-sm text-gray-500">
            You will be automatically redirected to the Identity Provider...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
