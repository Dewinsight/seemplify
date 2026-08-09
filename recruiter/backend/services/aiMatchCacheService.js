const AIMatchCache = require('../models/AIMatchCache');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { fingerprintMatchingInput } = require('./matchingCacheIdentityService');

// Existing deployments may still have the historic unique {jobId,candidateId}
// index. Distinct, deterministic ObjectIds let bulk and report entries coexist
// safely even before that index is migrated.
const CACHE_SENTINELS = Object.freeze({
  bulk: '000000000000000000000001',
  report: '000000000000000000000002'
});

function normalizeTopK(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 1), 5000);
}

function normalizeIdentity(identity = {}) {
  const normalized = {};
  for (const key of [
    'provider', 'model', 'routeVersion', 'promptVersion', 'reasoningEffort', 'inputFingerprint'
  ]) {
    if (identity[key] !== undefined && identity[key] !== null && identity[key] !== '') {
      normalized[key] = String(identity[key]);
    }
  }
  return normalized;
}

function identityKey(identity = {}) {
  const normalized = normalizeIdentity(identity);
  return Object.keys(normalized).length ? fingerprintMatchingInput(normalized) : null;
}

function cacheIdentityMatches(metadata = {}, expectedIdentity = {}) {
  const expected = normalizeIdentity(expectedIdentity);
  if (!Object.keys(expected).length) return true;
  const stored = normalizeIdentity(metadata.cacheIdentity || {});
  return Object.entries(expected).every(([key, value]) => stored[key] === value);
}

function canServeTopK(cache, requestedTopK) {
  if (!cache || !Array.isArray(cache.matchData)) return false;
  const requested = normalizeTopK(requestedTopK);
  if (!requested) return true;
  if (cache.matchData.length >= requested) return true;
  return cache.metadata?.exhausted === true;
}

function sliceBulkPayload(matchData, requestedTopK) {
  if (!Array.isArray(matchData)) return matchData;
  const requested = normalizeTopK(requestedTopK);
  return requested ? matchData.slice(0, requested) : matchData;
}

function sliceReportPayload(reportData, requestedTopK) {
  if (!reportData || typeof reportData !== 'object') return reportData;
  const requested = normalizeTopK(requestedTopK);
  if (!requested || !Array.isArray(reportData.topCandidates)) return reportData;
  const topCandidates = reportData.topCandidates.slice(0, requested);
  return {
    ...reportData,
    topCandidates,
    totalMatches: topCandidates.length
  };
}

class AIMatchCacheService {
  constructor({ CacheModel = AIMatchCache, JobModel = Job, CandidateModel = Candidate } = {}) {
    this.Cache = CacheModel;
    this.Job = JobModel;
    this.Candidate = CandidateModel;
  }

  async getCachedMatch(jobId, candidateId, options = {}) {
    try {
      const cache = await this.Cache.findOne({
        jobId,
        candidateId,
        cacheType: 'single',
        expiresAt: { $gt: new Date() }
      }).lean();

      if (!cache || !cacheIdentityMatches(cache.metadata, options.identity)) return null;
      return this._response(cache, cache.matchData);
    } catch (error) {
      console.error('Error getting cached match:', error);
      return null;
    }
  }

  async getCachedBulkMatch(jobId, options = {}) {
    try {
      const cache = await this.Cache.findOne({
        jobId,
        candidateId: { $in: [CACHE_SENTINELS.bulk, null] },
        cacheType: 'bulk',
        expiresAt: { $gt: new Date() }
      }).sort({ updatedAt: -1 }).lean();

      if (
        !cache
        || !cacheIdentityMatches(cache.metadata, options.identity)
        || !canServeTopK(cache, options.topK)
      ) return null;

      return this._response(cache, sliceBulkPayload(cache.matchData, options.topK));
    } catch (error) {
      console.error('Error getting cached bulk match:', error);
      return null;
    }
  }

  async setCachedMatch(jobId, candidateId, matchData, options = {}) {
    return this._set({ jobId, candidateId, cacheType: 'single', matchData, options });
  }

  async setCachedBulkMatch(jobId, matchData, options = {}) {
    return this._set({
      jobId,
      candidateId: CACHE_SENTINELS.bulk,
      cacheType: 'bulk',
      matchData,
      options
    });
  }

  async getCachedReport(jobId, options = {}) {
    try {
      const cache = await this.Cache.findOne({
        jobId,
        candidateId: { $in: [CACHE_SENTINELS.report, null] },
        cacheType: 'report',
        expiresAt: { $gt: new Date() }
      }).sort({ updatedAt: -1 }).lean();

      const topCandidates = cache?.matchData?.topCandidates;
      const requested = normalizeTopK(options.topK);
      const enoughResults = !requested
        || (Array.isArray(topCandidates) && topCandidates.length >= requested)
        || cache?.metadata?.exhausted === true;
      if (!cache || !enoughResults || !cacheIdentityMatches(cache.metadata, options.identity)) return null;

      return this._response(cache, sliceReportPayload(cache.matchData, options.topK));
    } catch (error) {
      console.error('Error getting cached report:', error);
      return null;
    }
  }

  async setCachedReport(jobId, reportData, options = {}) {
    return this._set({
      jobId,
      candidateId: CACHE_SENTINELS.report,
      cacheType: 'report',
      matchData: reportData,
      options: { ...options, hasInsights: true }
    });
  }

  async _set({ jobId, candidateId, cacheType, matchData, options }) {
    try {
      const ttl = options.ttl || this.Cache.getDefaultTTL();
      const expiresAt = new Date(Date.now() + ttl);
      const requestedTopK = normalizeTopK(options.requestedTopK ?? options.topK);
      const resultCount = Array.isArray(matchData)
        ? matchData.length
        : (matchData?.topCandidates?.length || options.candidateCount || 0);
      const cacheIdentity = normalizeIdentity(options.identity || {});

      await this.Cache.findOneAndUpdate(
        { jobId, candidateId, cacheType },
        {
          jobId,
          candidateId,
          matchData,
          cacheType,
          version: options.version || 1,
          metadata: {
            candidateCount: options.candidateCount ?? resultCount,
            resultCount,
            requestedTopK,
            exhausted: options.exhausted === true,
            generationTime: options.generationTime,
            modelUsed: options.modelUsed || cacheIdentity.model,
            tokensUsed: options.tokensUsed,
            hasInsights: options.hasInsights === true,
            cacheIdentity,
            identityKey: identityKey(cacheIdentity)
          },
          expiresAt
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (cacheType !== 'single') {
        await this.Cache.deleteMany({ jobId, candidateId: null, cacheType }).catch(() => {});
      }
      return true;
    } catch (error) {
      console.error(`Error caching ${cacheType} match data:`, error);
      return false;
    }
  }

  _response(cache, data) {
    // findOneAndUpdate preserves createdAt when a cache entry is refreshed.
    // Report the most recent generation time so the UI does not present a
    // freshly replaced result set as hours or days old.
    const refreshedAt = cache.updatedAt || cache.createdAt;
    const cacheTimestamp = refreshedAt instanceof Date ? refreshedAt : new Date(refreshedAt);
    return {
      data,
      fromCache: true,
      cacheAge: refreshedAt,
      cacheAgeMinutes: Math.max(0, Math.floor((Date.now() - cacheTimestamp.getTime()) / (1000 * 60))),
      metadata: cache.metadata
    };
  }

  async invalidateJobCache(jobId) {
    const result = await this.Cache.deleteMany({ jobId });
    return { success: true, deletedCount: result.deletedCount || 0 };
  }

  async invalidateOrganizationCaches(organizationId) {
    if (!organizationId) return { success: true, deletedCount: 0 };
    const jobIds = await this.Job.distinct('_id', { organization: organizationId });
    if (!jobIds.length) return { success: true, deletedCount: 0 };
    const result = await this.Cache.deleteMany({
      jobId: { $in: jobIds },
      cacheType: { $in: ['bulk', 'report'] }
    });
    return { success: true, deletedCount: result.deletedCount || 0 };
  }

  async invalidateCandidateCache(candidateId, organizationId = null) {
    let resolvedOrganizationId = organizationId;
    if (!resolvedOrganizationId && candidateId) {
      const candidate = await this.Candidate.findById(candidateId).select('organization').lean();
      resolvedOrganizationId = candidate?.organization || null;
    }

    const clauses = [{ candidateId }];
    if (resolvedOrganizationId) {
      const jobIds = await this.Job.distinct('_id', { organization: resolvedOrganizationId });
      if (jobIds.length) {
        clauses.push({ jobId: { $in: jobIds }, cacheType: { $in: ['bulk', 'report'] } });
      }
    }

    const result = await this.Cache.deleteMany({ $or: clauses });
    return { success: true, deletedCount: result.deletedCount || 0 };
  }

  async invalidateSpecificMatch(jobId, candidateId) {
    const result = await this.Cache.deleteOne({ jobId, candidateId, cacheType: 'single' });
    return { success: true, deletedCount: result.deletedCount || 0 };
  }

  async clearAllCache() {
    const result = await this.Cache.deleteMany({});
    return { success: true, deletedCount: result.deletedCount || 0 };
  }

  async getCacheStats(jobId) {
    const caches = await this.Cache.find({ jobId, expiresAt: { $gt: new Date() } }).lean();
    if (!caches.length) {
      return { cachedCount: 0, oldestCache: null, newestCache: null, averageAgeMinutes: 0 };
    }
    const now = Date.now();
    const ages = caches.map((cache) => now - new Date(cache.createdAt).getTime());
    return {
      cachedCount: caches.length,
      oldestCache: caches.reduce((value, cache) => (!value || cache.createdAt < value ? cache.createdAt : value), null),
      newestCache: caches.reduce((value, cache) => (!value || cache.createdAt > value ? cache.createdAt : value), null),
      averageAgeMinutes: Math.floor((ages.reduce((sum, age) => sum + age, 0) / ages.length) / (1000 * 60)),
      types: {
        single: caches.filter((cache) => cache.cacheType === 'single').length,
        bulk: caches.filter((cache) => cache.cacheType === 'bulk').length,
        report: caches.filter((cache) => cache.cacheType === 'report').length
      }
    };
  }
}

const service = new AIMatchCacheService();

module.exports = service;
module.exports.AIMatchCacheService = AIMatchCacheService;
module.exports.CACHE_SENTINELS = CACHE_SENTINELS;
module.exports.cacheIdentityMatches = cacheIdentityMatches;
module.exports.canServeTopK = canServeTopK;
module.exports.normalizeTopK = normalizeTopK;
module.exports.sliceBulkPayload = sliceBulkPayload;
module.exports.sliceReportPayload = sliceReportPayload;
