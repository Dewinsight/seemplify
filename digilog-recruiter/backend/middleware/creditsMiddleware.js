const creditsService = require('../services/creditsService');

/**
 * Helper function to extract entity ID and details from various response structures
 * @param {Object} data - Response data object
 * @returns {Object} Entity details { id, title, type }
 */
const extractEntityDetails = (data) => {
  console.log('🔍 Extracting entity details from response structure:', Object.keys(data));
  
  // Direct ID on response
  if (data._id || data.id) {
    console.log('   Found direct ID on response');
    return {
      id: data._id || data.id,
      title: data.title || data.name || data.firstName,
      type: null // Will use default from req.creditsAction
    };
  }
  
  // Check for jobId field (used by AI matching endpoint)
  if (data.jobId) {
    console.log('   Found jobId field in response');
    // Convert ObjectId to string if needed
    const jobId = data.jobId.toString ? data.jobId.toString() : data.jobId;
    return {
      id: jobId,
      title: data.jobTitle || data.title || 'Job',
      type: 'job'
    };
  }
  
  // Nested job response (used by matching-report endpoint)
  if (data.job && (data.job._id || data.job.id)) {
    console.log('   Found nested job entity');
    const jobId = (data.job._id || data.job.id).toString ? (data.job._id || data.job.id).toString() : (data.job._id || data.job.id);
    return {
      id: jobId,
      title: data.job.title,
      type: 'job'
    };
  }
  
  // Nested candidate response
  if (data.candidate && (data.candidate._id || data.candidate.id)) {
    console.log('   Found nested candidate entity');
    return {
      id: data.candidate._id || data.candidate.id,
      title: data.candidate.firstName || data.candidate.name,
      type: 'candidate'
    };
  }
  
  // Nested interview response
  if (data.interview && (data.interview._id || data.interview.id)) {
    console.log('   Found nested interview entity');
    return {
      id: data.interview._id || data.interview.id,
      title: data.interview.title || 'Interview',
      type: 'interview'
    };
  }
  
  // Array responses (bulk operations)
  if (data.interviews && Array.isArray(data.interviews) && data.interviews.length > 0) {
    console.log('   Found interview array response');
    const interview = data.interviews[0];
    return {
      id: interview._id || interview.id,
      title: interview.title || 'Interview',
      type: 'interview'
    };
  }
  
  // Jobs array (bulk upload)
  if (data.jobs && Array.isArray(data.jobs) && data.jobs.length > 0) {
    console.log('   Found jobs array response');
    // For bulk operations, we'll handle each job separately
    return {
      id: 'bulk-operation',
      title: `Bulk upload of ${data.jobs.length} jobs`,
      type: 'bulk',
      entities: data.jobs.map(job => ({
        id: job._id || job.id,
        title: job.title,
        type: 'job'
      }))
    };
  }
  
  console.log('   No entity ID found in response structure');
  return null;
};

/**
 * Middleware to check if organization has sufficient credits before performing action
 * @param {String} action - Action name (e.g., 'createJob', 'uploadCandidate')
 * @param {String} entityType - Type of entity being created (optional, defaults from action)
 * @returns {Function} Express middleware function
 */
const requireCredits = (action, entityType = null) => {
  return async (req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`🔍 [${timestamp}] Credit check starting for action: ${action}`);
    
    // Flag to ensure we only send one response
    let responseSent = false;
    
    try {
      const organizationId = req.user?.currentOrganization;
      const userId = req.user?.id;
      
      console.log(`   Organization: ${organizationId}, User: ${userId}`);
      
      if (!organizationId) {
        console.log(`❌ [${timestamp}] No organization context for credit check`);
        responseSent = true;
        return res.status(400).json({
          error: 'ORGANIZATION_REQUIRED',
          message: 'Organization context is required for credit-based actions',
          timestamp
        });
      }

      // Check if organization has sufficient credits
      const creditCheck = await creditsService.checkSufficientCredits(organizationId, action);
      
      console.log(`📊 Credit check result:`, {
        action,
        allowed: creditCheck.allowed,
        cost: creditCheck.cost,
        remaining: creditCheck.remaining,
        message: creditCheck.message
      });

      if (!creditCheck.allowed) {
        console.log(`❌ [${timestamp}] Insufficient credits for ${action}: Required ${creditCheck.cost}, Available ${creditCheck.remaining}`);
        
        responseSent = true;
        return res.status(402).json({
          error: 'INSUFFICIENT_CREDITS',
          message: creditCheck.message,
          details: {
            action,
            required: creditCheck.cost,
            available: creditCheck.remaining,
            deficit: creditCheck.cost - creditCheck.remaining
          },
          suggestions: [
            'Purchase additional credits',
            'Upgrade to a higher plan',
            'Wait for cycle reset'
          ],
          timestamp
        });
      }

      // Store action info for post-processing
      req.creditsAction = {
        action,
        cost: creditCheck.cost,
        entityType: entityType || action.replace('create', '').replace('upload', '').replace('schedule', '').toLowerCase()
      };

      console.log(`✅ [${timestamp}] Credit check passed for ${action}: Cost ${creditCheck.cost}, Remaining ${creditCheck.remaining}`);
      
      // Ensure response hasn't been sent before calling next
      if (!responseSent) {
        next();
      }
    } catch (error) {
      console.error(`❌ [${timestamp}] Error in credits middleware:`, error);
      
      // STRICT MODE: Block action if credit check fails
      // This ensures credits are always enforced
      if (!responseSent) {
        responseSent = true;
        return res.status(500).json({
          error: 'CREDIT_CHECK_FAILED',
          message: 'Unable to verify credits. Please try again or contact support.',
          details: error.message,
          timestamp
        });
      }
    }
  };
};

/**
 * Middleware to deduct credits after successful action
 * Must be placed AFTER the route handler
 */
const deductCredits = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`💳 [${timestamp}] deductCredits middleware called for ${req.method} ${req.path}`);
  console.log(`💳 req.creditsAction:`, req.creditsAction);
  
  // Wrap res.json to intercept successful responses
  const originalJson = res.json.bind(res);
  const originalStatus = res.status.bind(res);
  
  let statusCode = 200;
  
  console.log('💳 Wrapping res.status and res.json functions');
  
  // Track status code changes
  res.status = function(code) {
    statusCode = code;
    console.log(`💳 Status code set to: ${code}`);
    return originalStatus(code);
  };
  
  res.json = async function(data) {
    console.log('💳 res.json called with status:', statusCode);
    console.log('💳 Response data keys:', Object.keys(data || {}));
    console.log('💳 Response fromCache value:', data?.fromCache, typeof data?.fromCache);
    // Only deduct credits if:
    // 1. We have a credits action stored
    // 2. The response is successful (2xx status code)
    // 3. An entity was created (has ID)
    console.log('💳 Checking deduction conditions:', {
      hasCreditsAction: !!req.creditsAction,
      statusCode,
      isSuccessStatus: statusCode >= 200 && statusCode < 300,
      fromCache: data?.fromCache,
      fromCacheType: typeof data?.fromCache
    });
    
    if (req.creditsAction && statusCode >= 200 && statusCode < 300) {
      // aiMatching: `fromCache` only means vector similarity was served from cache.
      // findMatchingCandidatesWithExplanation still runs GPT on those matches — that must be charged.
      // Skip only when we did not run the explanation/GPT pass (vector-only response).
      const skipAiMatchingForVectorCacheOnly =
        req.creditsAction.action === 'aiMatching' &&
        data?.fromCache === true &&
        data?.explanationsIncluded !== true;

      if (skipAiMatchingForVectorCacheOnly) {
        console.log(
          `💳 ✅ SKIPPING credit deduction for ${req.creditsAction.action} — vector matches from cache, no GPT explanation pass (explanationsIncluded=${data?.explanationsIncluded})`
        );
        return originalJson(data);
      }
      
      console.log('💳 Conditions met, extracting entity details...');
      // Extract entity details from various response structures
      const entityDetails = extractEntityDetails(data);
      console.log('💳 Extracted entity details:', entityDetails);
      
      // Determine entity ID - try extracted details first, then fallback to request params
      let entityId = null;
      let entityType = req.creditsAction.entityType;
      let entityTitle = null;
      
      if (entityDetails && entityDetails.id) {
        entityId = entityDetails.id;
        entityType = entityDetails.type || req.creditsAction.entityType;
        entityTitle = entityDetails.title;
      } else if (req.creditsAction.action === 'aiMatching') {
        // Fallback for AI matching: use job ID from request params
        entityId = req.params.id || req.params.jobId;
        entityType = 'job';
        entityTitle = data.jobTitle || data.job?.title || 'Job';
        console.log(`💳 Using fallback: job ID from params: ${entityId}`);
      }
      
      if (entityId) {
        try {
          // Handle bulk operations separately
          if (entityDetails && entityDetails.type === 'bulk' && entityDetails.entities) {
            console.log(`💳 [${timestamp}] Bulk operation detected: ${entityDetails.entities.length} entities`);
            
            // Deduct credits for each entity in bulk operation
            for (const entity of entityDetails.entities) {
              console.log(`💳 Deducting ${req.creditsAction.cost} credits for ${req.creditsAction.action}`);
              console.log(`   Entity: ${entity.type} - ${entity.id} - "${entity.title || 'N/A'}"`);
              
              await creditsService.consumeCredits(
                req.user.currentOrganization,
                req.creditsAction.action,
                entity.id,
                entity.type,
                req.user.id,
                {
                  statusCode,
                  bulkOperation: true,
                  totalEntities: entityDetails.entities.length,
                  entityData: entity
                }
              );
            }
            console.log(`✅ [${timestamp}] Credits deducted for ${entityDetails.entities.length} entities`);
          } else {
            // Single entity operation
            console.log(`💳 Deducting ${req.creditsAction.cost} credits for ${req.creditsAction.action}`);
            console.log(`   Entity: ${entityType} - ${entityId} - "${entityTitle || 'N/A'}"`);
            
            await creditsService.consumeCredits(
              req.user.currentOrganization,
              req.creditsAction.action,
              entityId,
              entityType,
              req.user.id,
              {
                statusCode,
                entityData: {
                  id: entityId,
                  type: entityType,
                  title: entityTitle
                }
              }
            );
            
            console.log(`✅ Credits deducted successfully for ${req.creditsAction.action}`);
          }
        } catch (creditError) {
          console.error(`❌ [${timestamp}] Failed to deduct credits:`, creditError);
          // Don't fail the main response if credit deduction fails
          // The action was successful, so return it
        }
      } else {
        console.log(`⚠️ No entity ID found in response or params for ${req.creditsAction.action}, skipping credit deduction`);
        console.log(`   Response keys: ${Object.keys(data || {}).join(', ')}`);
        console.log(`   Request params: ${JSON.stringify(req.params)}`);
      }
    }
    
    return originalJson(data);
  };
  
  console.log('💳 deductCredits middleware setup complete, calling next()');
  next();
};

/**
 * Middleware to add credit status to response headers
 */
const addCreditsHeader = async (req, res, next) => {
  try {
    if (req.user?.currentOrganization) {
      const credits = await creditsService.getOrganizationCredits(req.user.currentOrganization);
      
      res.setHeader('X-Credits-Remaining', credits.remainingCredits);
      res.setHeader('X-Credits-Total', credits.totalCredits);
      res.setHeader('X-Credits-Percentage', credits.percentageUsed);
    }
  } catch (error) {
    console.error('Error adding credits header:', error);
  }
  
  next();
};

module.exports = {
  requireCredits,
  deductCredits,
  addCreditsHeader
};

