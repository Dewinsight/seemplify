"use client";

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  Calendar, 
  Clock, 
  RefreshCw,
  Users
} from 'lucide-react';
import { apiRequest } from '@/services/apiConfig';

interface GrantUsageStats {
  currentCount: number;
  maxAllowed: number;
  availableSlots: number;
  utilizationPercentage: number;
  atLimit: boolean;
  oldestGrant?: {
    userName: string;
    email: string;
    ageInDays: number;
    connectedAt: string;
    provider: string;
  };
}

interface GrantLimitWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

export default function GrantLimitWarningModal({
  isOpen,
  onClose,
  onContinue,
  onCancel
}: GrantLimitWarningModalProps) {
  const [stats, setStats] = useState<GrantUsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [continuing, setContinuing] = useState(false);

  // Fetch grant usage when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchGrantUsage();
    }
  }, [isOpen]);

  const fetchGrantUsage = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('GET', '/api/admin/grants/usage');
      
      if (response.success) {
        setStats(response.usage);
      }
    } catch (error) {
      console.error('Error fetching grant usage:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    setContinuing(true);
    await onContinue();
    setContinuing(false);
  };

  const getProviderBadge = (provider: string) => {
    const colors: Record<string, string> = {
      google: 'bg-blue-500',
      outlook: 'bg-indigo-500',
      microsoft: 'bg-indigo-500',
      yahoo: 'bg-purple-500'
    };
    return colors[provider?.toLowerCase()] || 'bg-gray-500';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Calendar Grant Limit Reached
          </DialogTitle>
          <DialogDescription>
            Your organization has reached the maximum number of calendar connections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2 text-muted-foreground">Loading grant information...</span>
            </div>
          ) : stats ? (
            <>
              {/* Current Usage */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-amber-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Current Usage
                  </h4>
                  <Badge className="bg-amber-500 text-white">
                    {stats.currentCount}/{stats.maxAllowed}
                  </Badge>
                </div>
                
                <div className="w-full bg-amber-200 rounded-full h-2 mb-2">
                  <div
                    className="bg-amber-500 h-2 rounded-full transition-all"
                    style={{ width: `${stats.utilizationPercentage}%` }}
                  />
                </div>
                
                <p className="text-sm text-amber-700">
                  All {stats.maxAllowed} calendar connection slots are currently in use.
                </p>
              </div>

              {/* What Will Happen */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-800 mb-3">What will happen:</h4>
                <ul className="space-y-2 text-sm text-blue-700">
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                    The oldest calendar connection will be automatically disconnected
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                    Your new calendar will be connected in its place
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                    The disconnected user can reconnect their calendar anytime
                  </li>
                </ul>
              </div>

              {/* Oldest Grant Info */}
              {stats.oldestGrant && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Oldest Connection (Will be removed)
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{stats.oldestGrant.userName}</p>
                      <p className="text-sm text-muted-foreground">{stats.oldestGrant.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className={`${getProviderBadge(stats.oldestGrant.provider)} text-white text-xs`}>
                          {stats.oldestGrant.provider}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Connected {stats.oldestGrant.ageInDays} days ago
                        </span>
                      </div>
                    </div>
                    <Users className="w-8 h-8 text-gray-400" />
                  </div>
                </div>
              )}

              {/* Note */}
              <div className="text-xs text-muted-foreground bg-gray-50 p-3 rounded-lg">
                <strong>Note:</strong> This is an automatic process to ensure smooth calendar connections. 
                The system always maintains the 5 most recently connected calendars.
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-4" />
              <p className="text-muted-foreground">Unable to load grant information</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={continuing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleContinue}
            disabled={continuing || loading}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {continuing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              'Continue & Connect Calendar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
