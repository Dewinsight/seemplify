const { randomUUID } = require('crypto');
const creditsService = require('../services/creditsService');
const enrichmentService = require('../services/enrichmentService');
const matchingEnrichmentInputService = require('../services/matchingEnrichmentInputService');

function getSafeEnrichCount(rawCount, totalMatches) {
  const parsed = parseInt(rawCount, 10);
  if (Number.isNaN(parsed)) return Math.min(50, totalMatches);
  return Math.min(Math.max(parsed, 1), totalMatches);
}

function resolveBatchCost(creditCheck) {
  const cost = Number(creditCheck?.cost || 0);
  return Number.isFinite(cost) ? Math.max(0, cost) : 0;
}

function buildCreditErrorPayload({
  required,
  available,
  enrichCount,
  batchCount,
  costPerBatch,
}) {
  return {
    error: 'INSUFFICIENT_CREDITS',
    message: `Insufficient credits for enrichment. Required: ${required}, Available: ${available}`,
    details: {
      action: 'aiMatching',
      required,
      available,
      deficit: Math.max(0, required - available),
      enrichCount,
      batchCount,
      creditPerBatch: costPerBatch,
    },
    suggestions: [
      'Purchase additional credits',
      'Enrich fewer candidates',
      'Wait for cycle reset',
    ],
  };
}

exports.getEstimate = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { jobId } = req.params;
    const { enrichCount } = req.query;

    const requested = parseInt(enrichCount, 10);
    if (Number.isNaN(requested) || requested <= 0) {
      return res.status(400).json({ msg: 'enrichCount must be a positive number' });
    }
    if (requested > matchingEnrichmentInputService.MAX_ENRICHMENT_CANDIDATES) {
      return res.status(400).json({
        msg: `enrichCount cannot exceed ${matchingEnrichmentInputService.MAX_ENRICHMENT_CANDIDATES}`
      });
    }

    await matchingEnrichmentInputService.getScopedJob(jobId, organizationId);

    const batchCount = Math.ceil(requested / enrichmentService.BATCH_SIZE);
    const estimatedSeconds = batchCount * 8;

    const creditCheck = await creditsService.checkSufficientCredits(organizationId, 'aiMatching');
    const costPerBatch = resolveBatchCost(creditCheck);
    const totalCredits = batchCount * costPerBatch;
    const remaining = Number.isFinite(creditCheck.remaining) ? creditCheck.remaining : Infinity;
    const remainingAfter =
      Number.isFinite(remaining) && Number.isFinite(totalCredits)
        ? Math.max(0, remaining - totalCredits)
        : null;

    return res.json({
      jobId,
      enrichCount: requested,
      batchSize: enrichmentService.BATCH_SIZE,
      batchCount,
      costPerBatch,
      totalCredits,
      availableCredits: remaining,
      remainingCreditsAfter: remainingAfter,
      hasEnoughCredits: remaining >= totalCredits,
      estimatedSeconds,
      estimatedMinutes: Number((estimatedSeconds / 60).toFixed(1)),
    });
  } catch (error) {
    console.error('❌ Error getting enrichment estimate:', error);
    return res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : 'Failed to estimate enrichment',
      code: error.code,
      error: error.message
    });
  }
};

exports.startEnrichment = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;
    const { jobId } = req.params;
    const { enrichCount, matches } = req.body;

    const submittedIds = matchingEnrichmentInputService.uniqueSubmittedCandidateIds(matches);
    const minCount = submittedIds.length < 10 ? submittedIds.length : 10;
    const selectedCount = getSafeEnrichCount(enrichCount, submittedIds.length);
    if (selectedCount < minCount) {
      return res.status(400).json({
        msg: `enrichCount must be between ${minCount} and ${submittedIds.length}`,
      });
    }

    // Treat the browser payload as candidate selection only. Job ownership,
    // candidate ownership, profile fields, and vector scores are reloaded from
    // scoped server-side sources before credits are checked or work is queued.
    const authoritativeInput = await matchingEnrichmentInputService.load({
      jobId,
      organizationId,
      matches,
      enrichCount: selectedCount
    });

    const batchCount = Math.ceil(selectedCount / enrichmentService.BATCH_SIZE);
    const creditCheck = await creditsService.checkSufficientCredits(organizationId, 'aiMatching');
    const costPerBatch = resolveBatchCost(creditCheck);
    const totalCreditsNeeded = batchCount * costPerBatch;
    const available = Number.isFinite(creditCheck.remaining) ? creditCheck.remaining : Infinity;

    if (available < totalCreditsNeeded) {
      return res.status(402).json(
        buildCreditErrorPayload({
          required: totalCreditsNeeded,
          available,
          enrichCount: selectedCount,
          batchCount,
          costPerBatch,
        })
      );
    }

    const enrichmentId = randomUUID();
    await enrichmentService.startEnrichment({
      enrichmentId,
      jobId,
      organizationId,
      userId,
      matches: authoritativeInput.matches,
      enrichCount: selectedCount,
      estimatedCredits: totalCreditsNeeded,
      costPerBatch,
    });

    return res.status(202).json({
      success: true,
      enrichmentId,
      jobId,
      enrichCount: selectedCount,
      batchCount,
      estimatedCredits: totalCreditsNeeded,
      statusUrl: `/api/enrichment/status/${enrichmentId}`,
      resultsUrl: `/api/enrichment/results/${enrichmentId}`,
      message: 'Enrichment started. Poll status endpoint for progress.',
    });
  } catch (error) {
    console.error('❌ Error starting enrichment:', error);
    return res.status(error.statusCode || 500).json({ msg: 'Failed to start enrichment', code: error.code, error: error.message });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const { enrichmentId } = req.params;
    const status = enrichmentService.getEnrichmentStatus(enrichmentId);
    if (!status) {
      return res.status(404).json({ msg: 'Enrichment not found' });
    }

    if (String(status.organizationId) !== String(req.user.currentOrganization)) {
      return res.status(403).json({ msg: 'Access denied for this enrichment' });
    }

    const elapsedMs = Date.now() - new Date(status.startedAt).getTime();
    const completed = status.completedCandidates;
    const total = status.enrichCount || 0;
    const candidatesPerSecond = elapsedMs > 0 ? completed / (elapsedMs / 1000) : 0;
    const remainingCandidates = Math.max(0, total - completed);
    const etaSeconds = candidatesPerSecond > 0 ? Math.ceil(remainingCandidates / candidatesPerSecond) : null;

    return res.json({
      ...status,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
      etaSeconds,
      candidatesPerSecond: Number(candidatesPerSecond.toFixed(2)),
      previewTopMatches: (status.rankedMatches || []).slice(0, 10),
    });
  } catch (error) {
    console.error('❌ Error getting enrichment status:', error);
    return res.status(error.statusCode || 500).json({ msg: 'Failed to get enrichment status', code: error.code, error: error.message });
  }
};

exports.getResults = async (req, res) => {
  try {
    const { enrichmentId } = req.params;
    const status = enrichmentService.getEnrichmentStatus(enrichmentId);
    if (!status) {
      return res.status(404).json({ msg: 'Enrichment not found' });
    }

    if (String(status.organizationId) !== String(req.user.currentOrganization)) {
      return res.status(403).json({ msg: 'Access denied for this enrichment' });
    }

    if (status.state !== 'completed') {
      return res.status(409).json({
        msg: 'Enrichment not completed yet',
        state: status.state,
        progressPercent: status.progressPercent,
      });
    }

    return res.json({
      enrichmentId,
      jobId: status.jobId,
      totalCandidates: status.totalCandidates,
      enrichCount: status.enrichCount,
      completedAt: status.completedAt,
      rankedMatches: status.rankedMatches,
    });
  } catch (error) {
    console.error('❌ Error getting enrichment results:', error);
    return res.status(error.statusCode || 500).json({ msg: 'Failed to get enrichment results', code: error.code, error: error.message });
  }
};
