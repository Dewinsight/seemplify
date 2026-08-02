import { apiRequest } from './apiConfig';

export interface CacheStats {
  cachedCount: number;
  oldestCache: Date | null;
  newestCache: Date | null;
  averageAgeMinutes: number;
  types: {
    single: number;
    bulk: number;
  };
}

/**
 * Invalidate AI match cache for a specific job
 */
export async function invalidateJobCache(jobId: string): Promise<{ deletedCount: number; message: string }> {
  try {
    console.log('[AI Cache] Invalidating cache for job:', jobId);
    
    const response = await apiRequest(`/api/jobs/${jobId}/invalidate-ai-cache`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to invalidate cache');
    }

    const data = await response.json();
    console.log('[AI Cache] Cache invalidated:', data);
    
    return {
      deletedCount: data.deletedCount,
      message: data.message
    };
  } catch (error: any) {
    console.error('[AI Cache] Error invalidating cache:', error);
    throw new Error(error.message || 'Failed to invalidate AI match cache');
  }
}

/**
 * Get AI match cache statistics for a job
 */
export async function getCacheStats(jobId: string): Promise<CacheStats> {
  try {
    console.log('[AI Cache] Getting cache stats for job:', jobId);
    
    const response = await apiRequest(`/api/jobs/${jobId}/ai-cache-stats`);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get cache stats');
    }

    const data = await response.json();
    console.log('[AI Cache] Cache stats retrieved:', data.stats);
    
    return data.stats;
  } catch (error: any) {
    console.error('[AI Cache] Error getting cache stats:', error);
    throw new Error(error.message || 'Failed to get cache statistics');
  }
}

/**
 * Format cache age for display
 */
export function formatCacheAge(cacheAge: Date | null): string {
  if (!cacheAge) return 'Unknown';
  
  const minutes = Math.floor((Date.now() - new Date(cacheAge).getTime()) / (1000 * 60));
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

