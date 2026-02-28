"use client";

import { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckCircle, X, RefreshCw } from 'lucide-react';

export default function OrganizationUpdateNotice() {
  const { currentOrganization, forceRefresh } = useOrganization();
  const [lastKnownPlan, setLastKnownPlan] = useState<string | null>(null);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!currentOrganization?.subscription?.plan) return;

    const currentPlan = currentOrganization.subscription.plan;
    
    // If we have a previous plan and it's different from current, show notice
    if (lastKnownPlan && lastKnownPlan !== currentPlan) {
      console.log('🔄 Plan change detected:', lastKnownPlan, '→', currentPlan);
      setShowUpdateNotice(true);
    }
    
    setLastKnownPlan(currentPlan);
  }, [currentOrganization?.subscription?.plan, lastKnownPlan]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await forceRefresh();
      setShowUpdateNotice(false);
    } catch (error) {
      console.error('Error refreshing organization data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDismiss = () => {
    setShowUpdateNotice(false);
  };

  if (!showUpdateNotice) return null;

  return (
    <Alert className="mb-6 border-blue-200 bg-blue-50">
      <CheckCircle className="h-4 w-4 text-blue-600" />
      <AlertDescription className="flex items-center justify-between w-full">
        <div>
          <span className="font-medium text-blue-900">
            Your organization plan has been updated!
          </span>
          <p className="text-sm text-blue-700 mt-1">
            Your plan is now: <strong>{currentOrganization?.subscription?.plan?.toUpperCase()}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            {isRefreshing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="text-blue-700 hover:bg-blue-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
