const AIMatchCache = require('../models/AIMatchCache');

/**
 * AI Match Cache Service
 * Handles caching of AI matching results to improve performance and reduce costs
 */
class AIMatchCacheService {
  /**
   * Get cached match for a specific job-candidate pair
   */
  async getCachedMatch(jobId, candidateId) {
    try {
      const cache = await AIMatchCache.findOne({
        jobId,
        candidateId,
        cacheType: 'single',
        expiresAt: { $gt: new Date() } // Only return non-expired caches
      }).lean();

      if (cache) {
        console.log(`✅ Cache hit for job ${jobId}, candidate ${candidateId}`);
        return {
          data: cache.matchData,
          fromCache: true,
          cacheAge: cache.createdAt,
          cacheAgeMinutes: Math.floor((Date.now() - cache.createdAt.getTime()) / (1000 * 60))
        };
      }

      console.log(`❌ Cache miss for job ${jobId}, candidate ${candidateId}`);
      return null;
    } catch (error) {
      console.error('Error getting cached match:', error);
      return null; // Fail gracefully - just regenerate
    }
  }

  /**
   * Get cached bulk matches for a job
   */
  async getCachedBulkMatch(jobId) {
    try {
      const cache = await AIMatchCache.findOne({
        jobId,
        candidateId: null,
        cacheType: 'bulk',
        expiresAt: { $gt: new Date() }
      }).lean();

      if (cache) {
        console.log(`✅ Bulk cache hit for job ${jobId}`);
        return {
          data: cache.matchData,
          fromCache: true,
          cacheAge: cache.createdAt,
          cacheAgeMinutes: Math.floor((Date.now() - cache.createdAt.getTime()) / (1000 * 60)),
          metadata: cache.metadata
        };
      }

      console.log(`❌ Bulk cache miss for job ${jobId}`);
      return null;
    } catch (error) {
      console.error('Error getting cached bulk match:', error);
      return null;
    }
  }

  /**
   * Set cached match for a specific job-candidate pair
   */
  async setCachedMatch(jobId, candidateId, matchData, options = {}) {
    try {
      const ttl = options.ttl || AIMatchCache.getDefaultTTL();
      const expiresAt = new Date(Date.now() + ttl);

      await AIMatchCache.findOneAndUpdate(
        { jobId, candidateId, cacheType: 'single' },
        {
          jobId,
          candidateId,
          matchData,
          cacheType: 'single',
          version: options.version || 1,
          metadata: {
            generationTime: options.generationTime,
            modelUsed: options.modelUsed,
            tokensUsed: options.tokensUsed
          },
          expiresAt
        },
        { upsert: true, new: true }
      );

      console.log(`💾 Cached match for job ${jobId}, candidate ${candidateId} (expires: ${expiresAt})`);
      return true;
    } catch (error) {
      console.error('Error caching match:', error);
      return false; // Fail gracefully
    }
  }

  /**
   * Set cached bulk matches for a job
   */
  async setCachedBulkMatch(jobId, matchData, options = {}) {
    try {
      const ttl = options.ttl || AIMatchCache.getDefaultTTL();
      const expiresAt = new Date(Date.now() + ttl);

      await AIMatchCache.findOneAndUpdate(
        { jobId, candidateId: null, cacheType: 'bulk' },
        {
          jobId,
          candidateId: null,
          matchData,
          cacheType: 'bulk',
          version: options.version || 1,
          metadata: {
            candidateCount: options.candidateCount,
            generationTime: options.generationTime,
            modelUsed: options.modelUsed,
            tokensUsed: options.tokensUsed
          },
          expiresAt
        },
        { upsert: true, new: true }
      );

      console.log(`💾 Cached bulk matches for job ${jobId} (${options.candidateCount} candidates, expires: ${expiresAt})`);
      return true;
    } catch (error) {
      console.error('Error caching bulk matches:', error);
      return false;
    }
  }

  /**
   * Invalidate all caches for a specific job
   */
  async invalidateJobCache(jobId) {
    try {
      const result = await AIMatchCache.deleteMany({ jobId });
      console.log(`🗑️ Invalidated ${result.deletedCount} cache entries for job ${jobId}`);
      return {
        success: true,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Error invalidating job cache:', error);
      throw error;
    }
  }

  /**
   * Invalidate all caches involving a specific candidate
   */
  async invalidateCandidateCache(candidateId) {
    try {
      const result = await AIMatchCache.deleteMany({ candidateId });
      console.log(`🗑️ Invalidated ${result.deletedCount} cache entries for candidate ${candidateId}`);
      return {
        success: true,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Error invalidating candidate cache:', error);
      throw error;
    }
  }

  /**
   * Invalidate specific job-candidate match
   */
  async invalidateSpecificMatch(jobId, candidateId) {
    try {
      const result = await AIMatchCache.deleteOne({ jobId, candidateId, cacheType: 'single' });
      console.log(`🗑️ Invalidated cache for job ${jobId}, candidate ${candidateId}`);
      return {
        success: true,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Error invalidating specific match:', error);
      throw error;
    }
  }

  /**
   * Clear all AI match caches (admin function)
   */
  async clearAllCache() {
    try {
      const result = await AIMatchCache.deleteMany({});
      console.log(`🗑️ Cleared all AI match caches (${result.deletedCount} entries)`);
      return {
        success: true,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Error clearing all caches:', error);
      throw error;
    }
  }

  /**
   * Get cached report (matches + GPT insights) for a job
   */
  async getCachedReport(jobId) {
    try {
      const cache = await AIMatchCache.findOne({
        jobId,
        candidateId: null,
        cacheType: 'report',
        expiresAt: { $gt: new Date() }
      }).lean();

      if (cache) {
        console.log(`✅ Report cache hit for job ${jobId}`);
        return {
          data: cache.matchData,
          fromCache: true,
          cacheAge: cache.createdAt,
          cacheAgeMinutes: Math.floor((Date.now() - cache.createdAt.getTime()) / (1000 * 60)),
          metadata: cache.metadata
        };
      }

      console.log(`❌ Report cache miss for job ${jobId}`);
      return null;
    } catch (error) {
      console.error('Error getting cached report:', error);
      return null;
    }
  }

  /**
   * Set cached report (matches + GPT insights) for a job
   */
  async setCachedReport(jobId, reportData, options = {}) {
    try {
      const ttl = options.ttl || AIMatchCache.getDefaultTTL();
      const expiresAt = new Date(Date.now() + ttl);

      await AIMatchCache.findOneAndUpdate(
        { jobId, candidateId: null, cacheType: 'report' },
        {
          jobId,
          candidateId: null,
          matchData: reportData,
          cacheType: 'report',
          version: options.version || 1,
          metadata: {
            candidateCount: options.candidateCount || (reportData.matches?.length || reportData.topCandidates?.length || 0),
            generationTime: options.generationTime,
            modelUsed: options.modelUsed,
            tokensUsed: options.tokensUsed,
            hasInsights: true
          },
          expiresAt
        },
        { upsert: true, new: true }
      );

      console.log(`💾 Cached report for job ${jobId} (expires: ${expiresAt})`);
      return true;
    } catch (error) {
      console.error('Error caching report:', error);
      return false;
    }
  }

  /**
   * Get cache statistics for a job
   */
  async getCacheStats(jobId) {
    try {
      const caches = await AIMatchCache.find({
        jobId,
        expiresAt: { $gt: new Date() }
      }).lean();

      if (caches.length === 0) {
        return {
          cachedCount: 0,
          oldestCache: null,
          newestCache: null,
          averageAge: 0
        };
      }

      const now = Date.now();
      const ages = caches.map(c => now - c.createdAt.getTime());
      const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;

      return {
        cachedCount: caches.length,
        oldestCache: caches.reduce((oldest, c) => 
          !oldest || c.createdAt < oldest ? c.createdAt : oldest, null
        ),
        newestCache: caches.reduce((newest, c) => 
          !newest || c.createdAt > newest ? c.createdAt : newest, null
        ),
        averageAgeMinutes: Math.floor(averageAge / (1000 * 60)),
        types: {
          single: caches.filter(c => c.cacheType === 'single').length,
          bulk: caches.filter(c => c.cacheType === 'bulk').length,
          report: caches.filter(c => c.cacheType === 'report').length
        }
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      throw error;
    }
  }
}

module.exports = new AIMatchCacheService();

