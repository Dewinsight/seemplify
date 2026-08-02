const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const pipelineProgressionService = require('../services/pipelineProgressionService');
const { body, validationResult } = require('express-validator');

/**
 * POST /api/pipeline/batch
 * Batch operations for pipeline management
 */
router.post('/batch',
  auth,
  [
    body('operations').isArray().withMessage('Operations must be an array'),
    body('operations.*.type').isIn(['move', 'remove', 'reject']).withMessage('Invalid operation type'),
    body('operations.*.candidateId').isMongoId().withMessage('Invalid candidate ID'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { operations } = req.body;
      const results = [];
      const failed = [];

      console.log(`🔄 Processing ${operations.length} batch operations`);

      // Process operations in parallel for better performance
      const operationPromises = operations.map(async (operation, index) => {
        try {
          let result;
          
          switch (operation.type) {
            case 'move':
              if (!operation.stageId) {
                throw new Error('stageId is required for move operations');
              }
              result = await pipelineProgressionService.advanceCandidateToStage(
                operation.jobId || req.body.jobId,
                operation.candidateId,
                operation.stageId,
                operation.notes || 'Batch move operation',
                req.user._id
              );
              break;
              
            case 'remove':
              result = await pipelineProgressionService.removeCandidateFromPipeline(
                operation.jobId || req.body.jobId,
                operation.candidateId,
                operation.reason || 'Batch removal',
                req.user._id
              );
              break;
              
            case 'reject':
              result = await pipelineProgressionService.rejectCandidate(
                operation.jobId || req.body.jobId,
                operation.candidateId,
                operation.reason || 'Batch rejection',
                req.user._id
              );
              break;
              
            default:
              throw new Error(`Unsupported operation type: ${operation.type}`);
          }

          return {
            index,
            success: true,
            operation: operation.type,
            candidateId: operation.candidateId,
            result
          };
          
        } catch (error) {
          console.error(`❌ Batch operation ${index} failed:`, error);
          return {
            index,
            success: false,
            operation: operation.type,
            candidateId: operation.candidateId,
            error: error.message
          };
        }
      });

      // Wait for all operations to complete
      const operationResults = await Promise.allSettled(operationPromises);
      
      operationResults.forEach((promiseResult, index) => {
        if (promiseResult.status === 'fulfilled') {
          const result = promiseResult.value;
          if (result.success) {
            results.push(result);
          } else {
            failed.push(result);
          }
        } else {
          failed.push({
            index,
            success: false,
            operation: operations[index].type,
            candidateId: operations[index].candidateId,
            error: promiseResult.reason?.message || 'Unknown error'
          });
        }
      });

      console.log(`✅ Batch operations completed: ${results.length} successful, ${failed.length} failed`);

      res.json({
        success: true,
        processed: operations.length,
        successful: results.length,
        failed: failed.length,
        results,
        failures: failed
      });

    } catch (error) {
      console.error('❌ Batch operations error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to process batch operations', 
        error: error.message 
      });
    }
  }
);

/**
 * POST /api/pipeline/:jobId/candidates/bulk-move
 * Bulk move candidates to a specific stage
 */
router.post('/:jobId/candidates/bulk-move',
  auth,
  [
    body('candidateIds').isArray().withMessage('candidateIds must be an array'),
    body('candidateIds.*').isMongoId().withMessage('Invalid candidate ID'),
    body('targetStageId').isMongoId().withMessage('Invalid target stage ID'),
    body('notes').optional().isString().withMessage('Notes must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { jobId } = req.params;
      const { candidateIds, targetStageId, notes } = req.body;

      console.log(`🔄 Bulk moving ${candidateIds.length} candidates to stage ${targetStageId}`);

      const results = [];
      const failed = [];

      // Process moves in parallel
      const movePromises = candidateIds.map(async (candidateId) => {
        try {
          const result = await pipelineProgressionService.advanceCandidateToStage(
            jobId,
            candidateId,
            targetStageId,
            notes || 'Bulk move operation',
            req.user._id
          );

          return {
            candidateId,
            success: true,
            result
          };
        } catch (error) {
          console.error(`❌ Failed to move candidate ${candidateId}:`, error);
          return {
            candidateId,
            success: false,
            error: error.message
          };
        }
      });

      const moveResults = await Promise.allSettled(movePromises);
      
      moveResults.forEach((promiseResult) => {
        if (promiseResult.status === 'fulfilled') {
          const result = promiseResult.value;
          if (result.success) {
            results.push(result);
          } else {
            failed.push(result);
          }
        } else {
          failed.push({
            candidateId: 'unknown',
            success: false,
            error: promiseResult.reason?.message || 'Unknown error'
          });
        }
      });

      console.log(`✅ Bulk move completed: ${results.length} successful, ${failed.length} failed`);

      res.json({
        success: true,
        moved: results.length,
        failed: failed.length,
        results,
        failures: failed
      });

    } catch (error) {
      console.error('❌ Bulk move error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to bulk move candidates', 
        error: error.message 
      });
    }
  }
);

/**
 * DELETE /api/pipeline/:jobId/candidates/bulk-remove
 * Bulk remove candidates from pipeline
 */
router.delete('/:jobId/candidates/bulk-remove',
  auth,
  [
    body('candidateIds').isArray().withMessage('candidateIds must be an array'),
    body('candidateIds.*').isMongoId().withMessage('Invalid candidate ID'),
    body('reason').optional().isString().withMessage('Reason must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { jobId } = req.params;
      const { candidateIds, reason } = req.body;

      console.log(`🗑️ Bulk removing ${candidateIds.length} candidates from pipeline`);

      const results = [];
      const failed = [];

      // Process removals in parallel
      const removePromises = candidateIds.map(async (candidateId) => {
        try {
          const result = await pipelineProgressionService.removeCandidateFromPipeline(
            jobId,
            candidateId,
            reason || 'Bulk removal',
            req.user._id
          );

          return {
            candidateId,
            success: true,
            result
          };
        } catch (error) {
          console.error(`❌ Failed to remove candidate ${candidateId}:`, error);
          return {
            candidateId,
            success: false,
            error: error.message
          };
        }
      });

      const removeResults = await Promise.allSettled(removePromises);
      
      removeResults.forEach((promiseResult) => {
        if (promiseResult.status === 'fulfilled') {
          const result = promiseResult.value;
          if (result.success) {
            results.push(result);
          } else {
            failed.push(result);
          }
        } else {
          failed.push({
            candidateId: 'unknown',
            success: false,
            error: promiseResult.reason?.message || 'Unknown error'
          });
        }
      });

      console.log(`✅ Bulk removal completed: ${results.length} successful, ${failed.length} failed`);

      res.json({
        success: true,
        removed: results.length,
        failed: failed.length,
        results,
        failures: failed
      });

    } catch (error) {
      console.error('❌ Bulk removal error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to bulk remove candidates', 
        error: error.message 
      });
    }
  }
);

module.exports = router;
