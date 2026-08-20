"use client";

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Calendar, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/services/apiConfig';

interface GrantUsageBadgeProps {
  showDetails?: boolean;
  refreshInterval?: number; // in milliseconds, 0 to disable auto-refresh
  className?: string;
}

interface GrantUsageStats {
  currentCount: number;
  maxAllowed: number;
  availableSlots: number;
  utilizationPercentage: number;
  atLimit: boolean;
}

export default function GrantUsageBadge({ 
  showDetails = false, 
  refreshInterval = 0,
  className = "" 
}: GrantUsageBadgeProps) {
  const [stats, setStats] = useState<GrantUsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGrantUsage();
    
    // Set up auto-refresh if interval provided
    if (refreshInterval > 0) {
      const interval = setInterval(fetchGrantUsage, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refreshInterval]);

  const fetchGrantUsage = async () => {
    try {
      const response = await apiRequest('/api/grant/usage', { method: 'GET' });
      const data = await response.json();
      if (response.ok && data.success) setStats(data.usage);
    } catch (error) {
      console.error('Error fetching grant usage:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (percentage: number, atLimit: boolean) => {
    if (atLimit) return 'bg-red-500 text-white';
    if (percentage >= 80) return 'bg-yellow-500 text-white';
    if (percentage >= 60) return 'bg-blue-500 text-white';
    return 'bg-green-500 text-white';
  };

  const getStatusText = (percentage: number, atLimit: boolean) => {
    if (atLimit) return 'At Limit';
    if (percentage >= 80) return 'Nearly Full';
    if (percentage >= 60) return 'Moderate';
    return 'Available';
  };

  if (loading) {
    return (
      <Badge variant="outline" className={className}>
        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
        Loading...
      </Badge>
    );
  }

  if (!stats) {
    return (
      <Badge variant="destructive" className={className}>
        <Calendar className="w-3 h-3 mr-1" />
        Error
      </Badge>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Badge className={getStatusColor(stats.utilizationPercentage, stats.atLimit)}>
        <Calendar className="w-3 h-3 mr-1" />
        {stats.currentCount}/{stats.maxAllowed}
      </Badge>
      
      {showDetails && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>{getStatusText(stats.utilizationPercentage, stats.atLimit)}</span>
          <span>•</span>
          <span>{stats.availableSlots} slot{stats.availableSlots !== 1 ? 's' : ''} free</span>
        </div>
      )}
    </div>
  );
}

// Hook version for programmatic use
export function useGrantUsage() {
  const [stats, setStats] = useState<GrantUsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/api/grant/usage', { method: 'GET' });
      const data = await response.json();
      if (response.ok && data.success) setStats(data.usage);
    } catch (error) {
      console.error('Error fetching grant usage:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    stats,
    loading,
    refetch: fetchStats
  };
}
