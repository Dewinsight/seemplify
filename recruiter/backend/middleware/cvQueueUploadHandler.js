const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

function queueUpload(source, queueService = cvAnalysisQueue) {
  return async (req, res) => {
    try {
      const result = await queueService.submitUpload(
        req,
        source,
        { deferEnqueue: source === 'private' }
      );
      const finalization = source === 'private'
        ? await queueService.finalizePrivateUploadSubmission(result.job, req)
        : {
          billing: { status: 'not_required', charged: false },
          enqueueDeferred: result.enqueueDeferred
        };
      if (source === 'private' && result.job.billing) {
        result.job.billing.state = finalization.billing.status;
        if (finalization.billing.error) {
          result.job.billing.lastAttemptAt = new Date();
          result.job.billing.lastError = finalization.billing.error;
        }
      }
      const state = queueService.publicState(result.job);
      return res.status(202).json({
        ...state,
        statusToken: result.statusToken,
        statusUrl: `/api/candidates/cv-jobs/${result.job.publicId}`,
        duplicate: result.duplicate,
        idempotentReplay: result.duplicate,
        queueAvailable: !finalization.enqueueDeferred,
        billing: finalization.billing
      });
    } catch (error) {
      console.error('CV queue submission failed:', error);
      return res.status(error.statusCode || 500).json({
        code: error.code || 'CV_QUEUE_SUBMISSION_FAILED',
        msg: error.message || 'CV upload could not be queued'
      });
    }
  };
}

module.exports = queueUpload;
