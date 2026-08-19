const Job = require('../models/Job');
const Department = require('../models/Department');
const Notification = require('../models/Notification');
const Candidate = require('../models/Candidate');
const CVProcessingJob = require('../models/CVProcessingJob');
const Organization = require('../models/Organization');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const fs = require('fs');
const util = require('util');
const embeddingService = require('../services/embeddingService');
const rankingService = require('../services/rankingService');
const {
  MATCHING_CANDIDATE_PROJECTION,
  mergeProfileIntoMatch
} = require('../services/candidateMatchingProfileService');
const InterviewService = require('../services/interviewService');
const pipelineProgressionService = require('../services/pipelineProgressionService');
const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
const pipelineReportExportService = require('../services/pipelineReportExportService');
const publicJobCreditService = require('../services/publicJobCreditService');
const publicApplicationCapacityService = require('../services/publicApplicationCapacityService');
const publicApplicationCapability = require('../services/publicApplicationCapabilityService');
const { decodeObjectHtmlEntities } = require('../utils/htmlDecode');
const interviewController = require('./interviewController');

const unlinkAsync = util.promisify(fs.unlink);
const interviewService = new InterviewService();

/**
 * Helper: Refund unused reserved credits back to organization
 */
async function refundReservedCredits(organizationId, jobId, creditsToRefund, reason = 'Job unpublished') {
  if (creditsToRefund <= 0) return 0;
  
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    console.warn(`Cannot refund credits: Organization ${organizationId} not found`);
    return 0;
  }
  
  const creditUsage = organization.subscription?.creditUsage || {};
  
  // Add back to organization's credit pool
  creditUsage.usedCredits = Math.max(0, (creditUsage.usedCredits || 0) - creditsToRefund);
  creditUsage.remainingCredits = (creditUsage.remainingCredits || 0) + creditsToRefund;
  
  // Record transaction
  if (!creditUsage.transactions) creditUsage.transactions = [];
  const newBalance = (creditUsage.remainingCredits || 0) + creditsToRefund;
  creditUsage.transactions.push({
    action: 'creditRefund',
    credits: creditsToRefund,
    entityId: jobId,
    entityType: 'job',
    timestamp: new Date(),
    balanceAfter: newBalance,
    metadata: {
      type: 'public_job_refund',
      reason: reason,
      description: `Refunded ${creditsToRefund} credits from job`
    }
  });
  
  organization.subscription.creditUsage = creditUsage;
  await organization.save();
  
  console.log(`💰 Refunded ${creditsToRefund} credits from job ${jobId}. Reason: ${reason}`);
  return creditsToRefund;
}

exports.createJob = async (req, res) => {
  try {
    // Decode HTML entities from request body before saving
    const decodedBody = decodeObjectHtmlEntities(req.body);
    
    const jobData = { 
      ...decodedBody, 
      createdBy: req.user?.id || null, 
      organization: req.user.currentOrganization,
      uploadMetadata: { source: 'manual' } 
    };
    
    // Validate department belongs to organization
    if (jobData.department) {
      const department = await Department.findOne({
        _id: jobData.department,
        organization: req.user.currentOrganization,
        isActive: true
      });
      
      if (!department) {
        return res.status(400).json({
          success: false,
          error: 'Invalid department selected'
        });
      }
    }
    
    if (req.body.salary && (req.body.salary.min || req.body.salary.max)) {
      jobData.salary = {
        min: req.body.salary.min || 0,
        max: req.body.salary.max || 0,
        currency: req.body.salary.currency || 'NGN',
        period: req.body.salary.period || 'annually',
      };
    }
    if (req.body.applicationDeadline) jobData.applicationDeadline = new Date(req.body.applicationDeadline);
    if (req.body.startDate) jobData.startDate = new Date(req.body.startDate);
    if (!jobData.createdBy) delete jobData.createdBy;
    delete jobData.reservedCredits;
    delete jobData.publicApplicationCount;
    delete jobData.publicApplicationReservations;
    delete jobData.publicApplicationCreditUnitCost;

    const job = jobData.isPublic
      ? await publicJobCreditService.createJob({
        jobData,
        actorId: req.user?.id
      })
      : await new Job(jobData).save();
    console.log(`✅ Job created successfully: ${job.title}`);

    // Create activity notification for all organization members
    try {
      await Notification.createJobCreatedNotification(req.user.id, job);
      console.log(`📢 Job creation notifications sent to organization for: ${job.title}`);
    } catch (notificationError) {
      console.error(`⚠️ Failed to create notifications for job ${job._id}:`, notificationError.message);
      // Don't fail job creation if notification fails
    }

    embeddingService.createJobEmbedding(job).then(() => {
      job.isEmbedded = true;
      job.embeddingCreatedAt = new Date();
      return job.save();
    }).then(() => {
      console.log(`✅ Job embedding created for: ${job.title}`);
    }).catch(embeddingError => {
      console.error(`⚠️ Failed to create embedding for job ${job._id}:`, embeddingError.message);
    });

    res.status(201).json({ msg: 'Job created successfully', job });
  } catch (error) {
    console.error('❌ Error creating job:', error);
    res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : 'Server error creating job',
      error: error.code || error.message
    });
  }
};

exports.getAllJobs = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { status, department, type, search } = req.query;
    const filter = { organization: organizationId };
    
    if (status) filter.status = status;
    if (department) filter.department = new RegExp(department, 'i');
    if (type) filter.type = type;
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { department: new RegExp(search, 'i') },
      ];
    }
    const jobs = await Job.find(filter)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit || 20));
    res.json(jobs);
  } catch (error) {
    console.error('❌ Error fetching jobs:', error);
    res.status(500).json({ msg: 'Server error fetching jobs', error: error.message });
  }
};

exports.getJobById = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    await publicApplicationCapacityService.reconcileInflatedCount({
      jobId: req.params.id,
      organizationId
    });
    const job = await Job.findOne({ _id: req.params.id, organization: organizationId })
      .populate('department', 'name description')
      .populate('hiringManager', 'firstName lastName email')
      .populate({ path: 'applicants.candidate', select: 'firstName lastName email phone position experience education skills location resumeUrl' })
      .populate({ path: 'applicants.statusHistory.changedBy', select: 'firstName lastName email' })
      .populate({ path: 'applicants.addedBy', select: 'firstName lastName email' });
    
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    
    // Clean up any null candidate references in applicants
    const originalApplicantsLength = job.applicants.length;
    job.applicants = job.applicants.filter(applicant => applicant.candidate !== null);
    
    // If we found deleted candidates, clean up the database
    if (job.applicants.length !== originalApplicantsLength) {
      console.log(`🧹 Cleaning up ${originalApplicantsLength - job.applicants.length} deleted candidate(s) from job ${req.params.id} applicants`);
      await job.save();
    }
    
    res.json(job);
  } catch (error) {
    console.error('❌ Error fetching job:', error);
    res.status(500).json({ msg: 'Server error fetching job', error: error.message });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const decodedBody = decodeObjectHtmlEntities(req.body);
    const {
      isPublic,
      candidateApplyLimit,
      // These fields are server-owned financial state.
      reservedCredits: ignoredReservedCredits,
      publicApplicationCount: ignoredApplicationCount,
      publicApplicationReservations: ignoredReservations,
      publicApplicationCreditUnitCost: ignoredUnitCost,
      ...otherUpdateData
    } = decodedBody;
    void ignoredReservedCredits;
    void ignoredApplicationCount;
    void ignoredReservations;
    void ignoredUnitCost;

    const mutateJob = (jobToUpdate) => {
      Object.assign(jobToUpdate, otherUpdateData);
      jobToUpdate.updatedBy = req.user?.id || null;
      jobToUpdate.updatedAt = new Date();
      if (otherUpdateData.applicationDeadline) {
        jobToUpdate.applicationDeadline = new Date(otherUpdateData.applicationDeadline);
      }
      if (otherUpdateData.startDate) {
        jobToUpdate.startDate = new Date(otherUpdateData.startDate);
      }
    };

    let job;
    if (isPublic !== undefined || candidateApplyLimit !== undefined) {
      job = await publicJobCreditService.updatePublicSettings({
        jobId: req.params.id,
        organizationId,
        isPublic,
        candidateApplyLimit,
        actorId: req.user?.id,
        mutateJob
      });
    } else {
      job = await Job.findOne({ _id: req.params.id, organization: organizationId });
      if (!job) {
        return res.status(404).json({ msg: 'Job not found' });
      }
      mutateJob(job);
      await job.save();
    }

    // Invalidate AI match cache if relevant fields changed
    const cacheInvalidatingFields = [
      'title', 'description', 'requirements', 'responsibilities', 'skills',
      'experience', 'education', 'level', 'location', 'department', 'type', 'remote'
    ];
    const shouldInvalidateCache = cacheInvalidatingFields.some(field => otherUpdateData[field] !== undefined);
    if (shouldInvalidateCache) {
      const aiMatchCacheService = require('../services/aiMatchCacheService');
      try {
        const invalidation = await aiMatchCacheService.invalidateJobCache(job._id);
        console.log(`🗑️ Auto-invalidated ${invalidation.deletedCount} AI match cache entries for updated job`);
      } catch (cacheError) {
        console.error('Failed to auto-invalidate cache:', cacheError);
      }
      require('../services/gptAnalysisService').cache.invalidateJob(job._id);

      // Cache invalidation alone is not sufficient: quick matching reuses the
      // stored job vector. Refresh it now so the next match cannot use stale
      // job content.
      try {
        job.isEmbedded = false;
        job.embeddingCreatedAt = null;
        await job.save();
        await embeddingService.createJobEmbedding(job);
        job.isEmbedded = true;
        job.embeddingCreatedAt = new Date();
        await job.save();
      } catch (embeddingError) {
        console.error(`Failed to refresh job embedding for ${job._id}:`, embeddingError.message);
      }
    }

    res.json({ msg: 'Job updated successfully', job });
  } catch (error) {
    console.error('❌ Error updating job:', error);
    res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : 'Server error updating job',
      error: error.code || error.message
    });
  }
};

exports.deleteJob = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const job = await publicJobCreditService.deleteJob({
      jobId: req.params.id,
      organizationId,
      actorId: req.user?.id
    });
    console.log(`🗑️ Deleting job: ${job.title} (${req.params.id})`);

    try {
      await embeddingService.deleteEmbedding(req.params.id, embeddingService.jobIndexName);
      console.log(`✅ Job embedding deleted from vector store for job: ${req.params.id}`);
    } catch (embeddingError) {
      console.warn(`⚠️ Failed to delete job embedding for ${req.params.id}:`, embeddingError.message);
    }
    const aiMatchCacheService = require('../services/aiMatchCacheService');
    await aiMatchCacheService.invalidateJobCache(req.params.id);
    require('../services/gptAnalysisService').cache.invalidateJob(req.params.id);
    console.log(`✅ Job and embedding successfully deleted: ${job.title}`);
    res.json({ msg: 'Job deleted successfully', deletedJob: { id: job._id, title: job.title, embeddingDeleted: true } });
  } catch (error) {
    console.error('❌ Error deleting job:', error);
    res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : 'Server error deleting job',
      error: error.code || error.message
    });
  }
};

// Bulk delete jobs
exports.bulkDeleteJobs = async (req, res) => {
  try {
    const { jobIds } = req.body || {};
    const organizationId = req.user.currentOrganization;

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ msg: 'jobIds must be a non-empty array' });
    }

    const results = [];
    const failures = [];

    for (const id of jobIds) {
      try {
        const job = await publicJobCreditService.deleteJob({
          jobId: id,
          organizationId,
          actorId: req.user?.id
        });

        try {
          await embeddingService.deleteEmbedding(id, embeddingService.jobIndexName);
        } catch (embeddingError) {
          console.warn(`⚠️ Failed to delete job embedding for ${id}:`, embeddingError.message);
        }

        const aiMatchCacheService = require('../services/aiMatchCacheService');
        await aiMatchCacheService.invalidateJobCache(id);
        require('../services/gptAnalysisService').cache.invalidateJob(id);

        results.push({ id, title: job.title, success: true });
      } catch (err) {
        failures.push({ id, error: err.message });
      }
    }

    return res.json({
      success: failures.length === 0,
      deleted: results.length,
      failed: failures.length,
      results,
      failures
    });
  } catch (error) {
    console.error('❌ Error bulk deleting jobs:', error);
    res.status(500).json({ msg: 'Server error bulk deleting jobs', error: error.message });
  }
};

exports.bulkUploadJobs = async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'No file uploaded.' });
  const filePath = req.file.path;
  const batchId = `batch_${Date.now()}`;
  try {
    console.log(`🚀 Starting bulk job upload: ${req.file.originalname}`);
    let jobsData = [];
    if (req.file.originalname.endsWith('.csv')) jobsData = await parseCSV(filePath);
    else if (req.file.originalname.endsWith('.xlsx')) jobsData = await parseExcel(filePath);
    else throw new Error('Unsupported file type. Please upload CSV or Excel files.');
    console.log(`📊 Parsed ${jobsData.length} job records from file`);
    const results = { successful: [], failed: [], total: jobsData.length };
    for (let i = 0; i < jobsData.length; i++) {
      try {
        const rowData = jobsData[i];
        const jobData = {
          title: rowData.title || rowData['Job Title'] || rowData['Position'],
          department: rowData.department || rowData['Department'],
          location: rowData.location || rowData['Location'],
          type: rowData.type || rowData['Job Type'] || 'Full-time',
          level: rowData.level || rowData['Level'] || 'Mid',
          description: rowData.description || rowData['Description'],
          requirements: rowData.requirements || rowData['Requirements'],
          responsibilities: rowData.responsibilities || rowData['Responsibilities'],
          skills: rowData.skills || rowData['Skills'],
          experience: rowData.experience || rowData['Experience'] || '1-3',
          education: rowData.education || rowData['Education'] || 'Bachelor',
          status: 'active',
          createdBy: req.user?.id || null,
          organization: req.user.currentOrganization,
          uploadMetadata: { source: 'bulk_upload', batchId, originalData: rowData },
        };
        if (!jobData.title || !jobData.department || !jobData.location) throw new Error('Missing required fields: title, department, or location');
        const job = new Job(jobData);
        await job.save();
        embeddingService.createJobEmbedding(job).then(() => {
          job.isEmbedded = true;
          job.embeddingCreatedAt = new Date();
          return job.save();
        }).catch(err => console.error(err.message));
        results.successful.push({ row: i + 1, job: { id: job._id, title: job.title, department: job.department } });
      } catch (error) {
        results.failed.push({ row: i + 1, data: jobsData[i], error: error.message });
      }
    }
    console.log(`🎉 Bulk upload completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    res.status(201).json({ msg: 'Bulk upload completed', results, batchId });
  } catch (error) {
    console.error('❌ Error in bulk job upload:', error);
    res.status(500).json({ msg: 'Server error during bulk upload', error: error.message });
  } finally {
    if (filePath) await unlinkAsync(filePath).catch(err => console.error('⚠️ Error deleting temporary file:', err));
  }
};

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath).pipe(csv()).on('data', data => results.push(data)).on('end', () => resolve(results)).on('error', error => reject(error));
  });
}

function parseExcel(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    return jsonData;
  } catch (error) {
    throw new Error(`Error parsing Excel file: ${error.message}`);
  }
}

exports.getJobEmbeddingStatus = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const job = await Job.findOne({ _id: req.params.id, organization: organizationId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const vectorIndexExists = await embeddingService.checkEmbeddingExists(job._id.toString(), embeddingService.jobIndexName);
    res.json({
      jobId: job._id,
      isEmbedded: job.isEmbedded && vectorIndexExists,
      embeddingCreatedAt: job.embeddingCreatedAt,
      vectorIndexExists,
    });
  } catch (error) {
    console.error('❌ Error checking job embedding status:', error);
    res.status(500).json({ msg: 'Server error checking embedding status', error: error.message });
  }
};

exports.createJobEmbedding = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const job = await Job.findOne({ _id: req.params.id, organization: organizationId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    await embeddingService.createJobEmbedding(job);
    job.isEmbedded = true;
    job.embeddingCreatedAt = new Date();
    await job.save();
    res.json({ msg: 'Job embedding created successfully', jobId: job._id, embeddingCreatedAt: job.embeddingCreatedAt });
  } catch (error) {
    console.error('❌ Error creating job embedding:', error);
    res.status(500).json({ msg: 'Server error creating job embedding', error: error.message });
  }
};

exports.getMatchingCandidates = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const topK = Math.min(Math.max(Number.parseInt(req.query.topK, 10) || 10, 1), 5000);
    const includeExplanations = req.query.includeExplanations !== 'false';
    const requestedMode = String(req.query.analysisMode || '').trim().toLowerCase();
    if (requestedMode && !['quick', 'deep'].includes(requestedMode)) {
      return res.status(400).json({ msg: 'analysisMode must be quick or deep', code: 'INVALID_MATCHING_MODE' });
    }
    // Explicit mode is preferred. The includeExplanations fallback preserves
    // behavior for older API clients that have not adopted quick/deep yet.
    const analysisMode = requestedMode || (includeExplanations && topK <= 100 ? 'deep' : 'quick');
    if (analysisMode === 'deep' && topK > 100) {
      return res.status(400).json({
        msg: 'Deep analysis supports up to 100 candidates per request. Use quick matching for larger result sets.',
        code: 'DEEP_MATCHING_LIMIT'
      });
    }
    const job = await Job.findOne({ _id: req.params.id, organization: organizationId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    if (!job.isEmbedded) {
      await embeddingService.createJobEmbedding(job);
      job.isEmbedded = true;
      job.embeddingCreatedAt = new Date();
      await job.save();
    }

    let matchResult;
    if (analysisMode === 'quick') {
      console.log(`⚡ Quick deterministic matching: topK=${topK} for job ${job.title}`);
      matchResult = await embeddingService.findMatchingCandidatesForJob(job, topK);
    } else {
      console.log(`🧠 Deep AI matching: topK=${topK} for job ${job.title}`);
      matchResult = await embeddingService.findMatchingCandidatesWithExplanation(job, topK);
    }

    const matches = matchResult.matches || (Array.isArray(matchResult) ? matchResult : []);
    const fromCache = matchResult.fromCache || false;
    const cacheAge = matchResult.cacheAge || null;
    const cacheAgeMinutes = matchResult.cacheAgeMinutes || null;

    res.json({
      jobId: job._id,
      jobTitle: job.title,
      matchCount: matches.length,
      matches: matches.map(m => ({
        ...m,
        relevanceScore: m.relevanceScore ?? m.similarity ?? 0,
        similarityPercentage: Math.round((m.relevanceScore ?? m.similarity ?? 0) * 100),
      })),
      fromCache,
      cacheAge,
      cacheAgeMinutes,
      mode: analysisMode === 'deep' ? 'deep-analysis' : 'quick-ranking',
      analysisMode,
      explanationsIncluded: analysisMode === 'deep',
    });
  } catch (error) {
    console.error('❌ Error getting matching candidates:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error finding matching candidates', code: error.code, error: error.message });
  }
};

exports.getCandidateExplanation = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { jobId, candidateId } = req.params;

    const job = await Job.findOne({ _id: jobId, organization: organizationId });
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    const Candidate = require('../models/Candidate');
    const candidate = await Candidate.findOne({ _id: candidateId, organization: organizationId })
      .select(MATCHING_CANDIDATE_PROJECTION);
    if (!candidate) return res.status(404).json({ msg: 'Candidate not found' });

    const gptAnalysisService = require('../services/gptAnalysisService');
    const authoritativeMatch = rankingService.rerankQuickCandidates([
      mergeProfileIntoMatch({ candidateId, similarity: 0.5, metadata: {} }, candidate.toObject())
    ], job)[0];
    const profile = authoritativeMatch.metadata._matchingProfile;

    if (gptAnalysisService.isEnabled) {
      const candidateObj = {
        _id: candidate._id.toString(),
        id: candidate._id.toString(),
        name: profile.name,
        skills: profile.skills,
        experience: profile.totalYearsExp,
        location: profile.location,
        currentRole: profile.currentRole,
        education: profile.education,
        bio: profile.aiSummary,
        profileText: profile.profileText,
        matchingProfile: profile,
        matchingSignals: authoritativeMatch.quickSignals,
        deterministicScore: authoritativeMatch.relevanceScore,
        score: authoritativeMatch.vectorSimilarity,
      };

      const gptResults = await gptAnalysisService.batchAnalyzeCandidates(job, [candidateObj]);
      const result = gptResults[0];

      if (result) {
        const requiredSkills = embeddingService.parseSkills(job.skills);
        const requiredExperienceYears = embeddingService.extractYearsFromExperience(
          String(job.experience || '')
        );
        return res.json({
          candidateId,
          jobId,
          explanation: {
            skillsMatch: {
              matchedSkills: result.gptAnalysis.technicalStrengths || [],
              missingSkills: result.gptAnalysis.skillGaps || [],
              bonusSkills: result.gptAnalysis.transferableSkills || [],
              matchPercentage: result.gptAnalysis.skillMatchPercentage || 0,
              totalRequired: requiredSkills.length,
              totalMatched: (result.gptAnalysis.technicalStrengths || []).length,
            },
            experienceMatch: {
              isMatch: result.gptAnalysis.experienceFit >= 6,
              required: requiredExperienceYears,
              candidate: candidateObj.experience,
              difference: candidateObj.experience - requiredExperienceYears,
              category: result.gptAnalysis.experienceFit >= 8 ? 'Strong' : result.gptAnalysis.experienceFit >= 6 ? 'Good' : 'Below',
            },
            aiInsights: {
              hasAIAnalysis: true,
              summary: result.gptAnalysis.explanation,
              strengths: result.gptAnalysis.technicalStrengths || [],
              potentialFlags: result.gptAnalysis.skillGaps || [],
              strengthsCount: (result.gptAnalysis.technicalStrengths || []).length,
              flagsCount: (result.gptAnalysis.skillGaps || []).length,
            },
            careerFit: {
              totalYearsExp: profile.totalYearsExp,
              hasCareerProgression: Boolean(profile.careerProgression),
              hasAchievements: profile.keyAchievements.length > 0,
              companiesWorkedAt: profile.companies.length,
              positionsHeld: profile.positions.length,
              avgTenureYears: profile.companies.length
                ? Math.round((profile.totalYearsExp / profile.companies.length) * 10) / 10
                : 0,
              stabilityScore: profile.companies.length && profile.totalYearsExp / profile.companies.length > 2 ? 'High' : 'Medium',
            },
            matchStrength: (result.relevanceScore || 0) >= 0.9 ? 'Excellent Match' : (result.relevanceScore || 0) >= 0.8 ? 'Strong Match' : (result.relevanceScore || 0) >= 0.7 ? 'Good Match' : (result.relevanceScore || 0) >= 0.6 ? 'Moderate Match' : (result.relevanceScore || 0) >= 0.5 ? 'Weak Match' : 'Poor Match',
            overallScore: Math.round((result.relevanceScore || 0) * 100),
            gptEnhanced: {
              skillMatchPercentage: result.gptAnalysis.skillMatchPercentage,
              experienceFit: result.gptAnalysis.experienceFit,
              culturalAlignment: result.gptAnalysis.culturalAlignment,
              growthPotential: result.gptAnalysis.growthPotential,
              interviewFocus: result.gptAnalysis.interviewFocus,
              confidenceScore: result.gptAnalysis.confidenceScore,
              contextualExplanation: result.gptAnalysis.explanation,
            },
            reasons: [
              result.gptAnalysis.explanation,
              ...(result.gptAnalysis.technicalStrengths || []).slice(0, 3).map(s => `Strong in ${s}`),
            ].filter(Boolean).slice(0, 5),
            concerns: [
              ...(result.gptAnalysis.skillGaps || []).slice(0, 2).map(g => `Missing: ${g}`),
            ].filter(Boolean).slice(0, 3),
          },
        });
      }
    }

    const explanation = await embeddingService.generateMatchExplanation(job, authoritativeMatch);

    res.json({ candidateId, jobId, explanation });
  } catch (error) {
    console.error('❌ Error generating candidate explanation:', error);
    res.status(error.statusCode || 500).json({ msg: 'Failed to generate explanation', code: error.code, error: error.message });
  }
};

// ===== SHORTLIST FUNCTIONALITY =====

exports.getShortlist = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user?.currentOrganization;

    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }

    const job = await Job.findOne(query).populate({
      path: 'shortlist.candidate',
      select: 'firstName lastName position experience skills location email phone isInternalCandidate employeeId'
    });

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Get current pipeline candidates to check actual pipeline status
    const pipelineCandidateIds = job.applicants?.map(app => app.candidate._id.toString()) || [];

    // Create a map of candidate IDs to application types for quick lookup
    const applicationTypeMap = new Map();
    job.applicants?.forEach(app => {
      applicationTypeMap.set(app.candidate._id.toString(), app.applicationType || 'manual');
    });

    // Filter out any null/deleted candidate references and construct full names
    const validShortlistItems = job.shortlist
      .filter(item => item.candidate !== null)
      .map(item => {
        // Determine actual status: check if in pipeline first, then shortlist status
        let actualStatus = item.status || 'shortlisted';
        if (pipelineCandidateIds.includes(item.candidate._id.toString())) {
          actualStatus = 'moved_to_pipeline';
        }

        // Get application type from the applicants array
        const applicationType = applicationTypeMap.get(item.candidate._id.toString()) || 'manual';

        return {
          ...item.toObject(),
          status: actualStatus, // Use actual status
          applicationType, // Include application type (public, internal, manual)
          candidate: {
            ...item.candidate.toObject(),
            name: item.candidate.firstName && item.candidate.lastName 
              ? `${item.candidate.firstName} ${item.candidate.lastName}`.trim()
              : item.candidate.firstName || item.candidate.lastName || 'Unnamed Candidate'
          }
        };
      });

    // Check if rankings exist and sort by relevance score if they do
    const hasRankings = validShortlistItems.some(item => item.relevanceScore && item.relevanceScore > 0);
    if (hasRankings) {
      // Sort by relevance score (highest first), putting unranked items at the end
      validShortlistItems.sort((a, b) => {
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        return scoreB - scoreA; // Descending order (highest match first)
      });
    }
    
    res.json({
      jobId: job._id,
      jobTitle: job.title,
      shortlist: validShortlistItems,
      hasRankings: hasRankings // Include ranking status
    });
  } catch (error) {
    console.error('❌ Error fetching shortlist:', error);
    res.status(500).json({ msg: 'Server error fetching shortlist', error: error.message });
  }
};

exports.addCandidateToShortlist = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateId, coverLetter, isOrganizationStaff } = req.body;
    
    // Handle both authenticated and public route access
    const organizationId = req.user?.currentOrganization;
    const isPublicApplication = !req.user; // Public if no user context
    
    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    let job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Ensure candidate exists and belongs to the same organization context.
    const candidateQuery = { _id: candidateId };
    if (organizationId) candidateQuery.organization = organizationId;
    else if (job.organization) candidateQuery.organization = job.organization;
    if (isPublicApplication) {
      candidateQuery.source = 'public';
      candidateQuery.jobAppliedFor = job._id;
    }
    const candidate = isPublicApplication
      ? await publicApplicationCapability.verify({
        candidateId,
        jobId: job._id,
        organizationId: job.organization,
        token: req.get?.('X-Public-Application-Token') || req.body?.applicationToken
      })
      : await Candidate.findOne(candidateQuery);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Public retries are idempotent: the first successful submission already
    // owns the slot, so a network retry must not look like a failure.
    if (job.shortlist.some(item => item.candidate.toString() === candidateId)) {
      if (isPublicApplication) {
        return res.status(200).json({
          msg: 'Application already submitted',
          shortlist: job.shortlist,
          duplicate: true
        });
      }
      return res.status(400).json({ msg: 'Candidate already in shortlist' });
    }
    if (job.applicants.some(item => item.candidate.toString() === candidateId)) {
      return res.status(400).json({ msg: 'Candidate already in pipeline' });
    }

    if (isPublicApplication) {
      if (!job.isPublic || job.status !== 'active') {
        return res.status(403).json({
          msg: 'This job is not accepting public applications',
          code: 'PUBLIC_JOB_NOT_PUBLIC'
        });
      }

      // Undo slots consumed by CV parses that never became submitted
      // applications, then atomically commit this real application.
      await publicApplicationCapacityService.reconcileInflatedCount({
        jobId: job._id,
        organizationId: job.organization
      });
      const processingPublicId = candidate.processingMetadata?.cvProcessingJobId;
      const processingJob = processingPublicId
        ? await CVProcessingJob.findOne({
          publicId: processingPublicId,
          organization: job.organization,
          jobAppliedFor: job._id,
          source: 'public'
        }).select('_id publicId')
        : null;

      // Candidates created before durable processing jobs still get a stable,
      // replay-safe reservation identity.
      const capacity = await publicApplicationCapacityService.commit({
        jobId: job._id,
        organizationId: job.organization,
        candidateId: candidate._id,
        processingJobId: processingJob?._id || candidate._id,
        processingJobPublicId: processingJob?.publicId || `legacy-candidate:${candidate._id}`
      });
      job = Job.hydrate(capacity.job);

      if (typeof isOrganizationStaff !== 'undefined') {
        const staffValue = typeof isOrganizationStaff === 'string'
          ? isOrganizationStaff.toLowerCase() === 'true'
          : Boolean(isOrganizationStaff);
        await Candidate.updateOne(
          { _id: candidate._id, organization: job.organization },
          { $set: { isInternalCandidate: staffValue } }
        );
      }

      try {
        await job.populate([
          { path: 'organization' },
          { path: 'department', select: 'name' }
        ]);
        await candidateEmailNotificationService.sendApplicationConfirmationEmail({
          candidate,
          job
        });
        if (capacity.limitReached && !capacity.duplicate) {
          await candidateEmailNotificationService.sendJobApplicationLimitReachedEmail({ job });
        }
      } catch (emailError) {
        console.error('Error sending public application email:', emailError);
      }

      return res.status(capacity.duplicate ? 200 : 201).json({
        msg: capacity.duplicate
          ? 'Application already submitted'
          : 'Candidate added to shortlist successfully',
        shortlist: job.shortlist,
        duplicate: capacity.duplicate,
        applicationCount: capacity.applicationCount,
        limitReached: capacity.limitReached,
        emailSent: true
      });
    }

    job.shortlist.push({ candidate: candidateId, addedBy: req.user?.id });
    await job.save();

    res.status(201).json({ 
      msg: 'Candidate added to shortlist successfully', 
      shortlist: job.shortlist,
      emailSent: false
    });
  } catch (error) {
    console.error('❌ Error adding candidate to shortlist:', error);
    res.status(error.statusCode || 500).json({
      msg: error.statusCode ? error.message : 'Server error adding candidate to shortlist',
      code: error.code,
      error: error.message
    });
  }
};

// Bulk add candidates to shortlist
exports.bulkAddCandidatesToShortlist = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateIds } = req.body || {};
    const organizationId = req.user?.currentOrganization;

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ msg: 'candidateIds must be a non-empty array' });
    }

    const query = { _id: jobId };
    if (organizationId) query.organization = organizationId;

    const job = await Job.findOne(query);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    const alreadyInShortlist = new Set(job.shortlist.map(i => i.candidate.toString()));
    const alreadyInPipeline = new Set((job.applicants || []).map(i => i.candidate.toString()));

    const added = [];
    const skipped = [];

    for (const cid of candidateIds) {
      if (alreadyInShortlist.has(cid)) {
        skipped.push({ id: cid, reason: 'already_in_shortlist' });
        continue;
      }
      if (alreadyInPipeline.has(cid)) {
        skipped.push({ id: cid, reason: 'already_in_pipeline' });
        continue;
      }
      job.shortlist.push({ candidate: cid, addedBy: req.user?.id });
      added.push(cid);
    }

    await job.save();

    res.json({
      success: true,
      addedCount: added.length,
      skippedCount: skipped.length,
      added,
      skipped,
      shortlist: job.shortlist
    });
  } catch (error) {
    console.error('❌ Error bulk adding candidates to shortlist:', error);
    res.status(500).json({ msg: 'Server error bulk adding to shortlist', error: error.message });
  }
};

exports.getRankedShortlist = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user?.currentOrganization;
    
    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query).populate({
      path: 'shortlist.candidate',
      select: 'firstName lastName position experience skills location email phone isInternalCandidate employeeId'
    });

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    if (!job.isEmbedded) {
      return res.status(400).json({ msg: 'Job embedding not created. Cannot rank candidates.' });
    }
    
    // Filter out any null/deleted candidate references and clean up the shortlist
    const validShortlistItems = job.shortlist.filter(item => item.candidate !== null);
    
    // If we found deleted candidates, clean up the database
    if (validShortlistItems.length !== job.shortlist.length) {
      console.log(`🧹 Cleaning up ${job.shortlist.length - validShortlistItems.length} deleted candidate(s) from job ${jobId} shortlist`);
      job.shortlist = validShortlistItems;
      await job.save();
    }
    
    const candidateIds = validShortlistItems.map(item => item.candidate._id);

    if (candidateIds.length === 0) {
      return res.json({
        jobId: job._id,
        jobTitle: job.title,
        matchCount: 0,
        matches: [],
        cleanedUp: job.shortlist.length !== validShortlistItems.length
      });
    }

    const matches = await embeddingService.rankCandidatesByIds(job, candidateIds);

    // Get current pipeline candidates to check actual pipeline status
    const pipelineCandidateIds = job.applicants?.map(app => app.candidate._id.toString()) || [];

    // Merge ranking results with shortlist metadata and actual pipeline status
    const enrichedMatches = matches.map(match => {
      const shortlistItem = validShortlistItems.find(item => 
        item.candidate._id.toString() === match.candidateId
      );
      const shortlistCandidate = shortlistItem?.candidate;
      const normalizedCandidate = shortlistCandidate && typeof shortlistCandidate.toObject === 'function'
        ? shortlistCandidate.toObject()
        : shortlistCandidate;
      
      // Determine actual status: check if in pipeline first, then shortlist status
      let actualStatus = shortlistItem?.status || 'shortlisted';
      if (pipelineCandidateIds.includes(match.candidateId)) {
        actualStatus = 'moved_to_pipeline';
      }
      
      return {
        ...match,
        candidate: {
          ...(match.candidate || {}),
          ...(normalizedCandidate || {}),
          _id: match.candidateId,
          id: match.candidateId,
          name: normalizedCandidate?.firstName && normalizedCandidate?.lastName
            ? `${normalizedCandidate.firstName} ${normalizedCandidate.lastName}`.trim()
            : normalizedCandidate?.name || match.candidate?.name || 'Unnamed Candidate'
        },
        similarityPercentage: Math.round(match.similarity * 100),
        // Use actual status (pipeline takes precedence)
        status: actualStatus,
        addedAt: shortlistItem?.addedAt,
        movedToPipelineAt: shortlistItem?.movedToPipelineAt,
        addedBy: shortlistItem?.addedBy,
        relevanceScore: match.similarity // Save the relevance score
      };
    });

    // Save the ranking results back to the database
    for (const match of enrichedMatches) {
      const shortlistItem = job.shortlist.find(item => 
        item.candidate._id.toString() === match.candidateId
      );
      if (shortlistItem) {
        shortlistItem.relevanceScore = match.relevanceScore;
      }
    }
    await job.save();

    res.json({
      jobId: job._id,
      jobTitle: job.title,
      matchCount: enrichedMatches.length,
      matches: enrichedMatches,
      cleanedUp: job.shortlist.length !== validShortlistItems.length
    });
  } catch (error) {
    console.error('❌ Error ranking shortlist:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error ranking shortlist', code: error.code, error: error.message });
  }
};

exports.removeCandidateFromShortlist = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;
    const organizationId = req.user?.currentOrganization;
    
    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    job.shortlist = job.shortlist.filter(item => item.candidate.toString() !== candidateId);
    await job.save();

    res.json({ msg: 'Candidate removed from shortlist', shortlist: job.shortlist });
  } catch (error) {
    console.error('❌ Error removing candidate from shortlist:', error);
    res.status(500).json({ msg: 'Server error removing candidate from shortlist', error: error.message });
  }
};

exports.updateShortlistCandidateStatus = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;
    const { status } = req.body;
    const organizationId = req.user?.currentOrganization;
    
    // Validate status
    const validStatuses = ['shortlisted', 'moved_to_pipeline', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ msg: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }
    
    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Find the shortlist item and update its status
    const shortlistItem = job.shortlist.find(item => item.candidate.toString() === candidateId);
    if (!shortlistItem) {
      return res.status(404).json({ msg: 'Candidate not found in shortlist' });
    }

    shortlistItem.status = status;
    if (status === 'moved_to_pipeline') {
      shortlistItem.movedToPipelineAt = new Date();
    } else if (status === 'shortlisted') {
      // Clear the movedToPipelineAt when returning to shortlist
      shortlistItem.movedToPipelineAt = undefined;
      
      // ALSO remove candidate from pipeline (job.applicants array)
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId
      );
      
      if (applicantIndex !== -1) {
        job.applicants.splice(applicantIndex, 1);
        console.log(`✅ Removed candidate ${candidateId} from pipeline when returning to shortlist`);
      }
    }

    await job.save();

    // Send appropriate email notifications
    try {
      // Get full candidate data for email
      const candidate = await Candidate.findById(candidateId);
      if (candidate) {
        // Populate job organization for email service
        await job.populate('organization');

        if (status === 'moved_to_pipeline') {
          // Send congratulations email for moving from shortlist to pipeline
          await candidateEmailNotificationService.sendShortlistEmail({
            candidate,
            job
          });
        } else if (status === 'rejected') {
          // Send shortlist rejection email
          await candidateEmailNotificationService.sendRejectionEmail({
            candidate,
            job,
            reason: 'Your application was not selected to move forward from the shortlist',
            stage: 'Shortlist Review',
            isShortlistRejection: true
          });
        }
      }
    } catch (emailError) {
      console.error('❌ Error sending shortlist status email:', emailError);
      // Don't fail the status update if email fails
    }

    res.json({ 
      msg: `Candidate status updated to ${status}`, 
      shortlistItem: {
        candidate: shortlistItem.candidate,
        status: shortlistItem.status,
        addedAt: shortlistItem.addedAt,
        movedToPipelineAt: shortlistItem.movedToPipelineAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating shortlist candidate status:', error);
    res.status(500).json({ msg: 'Server error updating candidate status', error: error.message });
  }
};

exports.clearShortlistRanking = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user?.currentOrganization;
    
    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Clear relevanceScore from all shortlist items
    job.shortlist.forEach(item => {
      if (item.relevanceScore !== undefined) {
        item.relevanceScore = undefined;
      }
    });

    await job.save();

    res.json({ 
      msg: 'Shortlist ranking cleared successfully',
      clearedCount: job.shortlist.length
    });
  } catch (error) {
    console.error('❌ Error clearing shortlist ranking:', error);
    res.status(500).json({ msg: 'Server error clearing shortlist ranking', error: error.message });
  }
};

/**
 * Bulk move candidates from shortlist to pipeline
 */
exports.bulkMoveShortlistToPipeline = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateIds } = req.body;
    const organizationId = req.user?.currentOrganization;
    
    // Validate input
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ msg: 'candidateIds must be a non-empty array' });
    }

    console.log(`🔄 Bulk moving ${candidateIds.length} candidates from shortlist to pipeline`);
    console.log('🔍 req.user:', req.user);
    console.log('🔍 req.user._id:', req.user?._id);
    console.log('🔍 req.user.id:', req.user?.id);

    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    const results = [];
    const failed = [];

    // Determine the user ID once - try both _id and id
    const userId = req.user._id || req.user.id || req.user._doc?._id;
    console.log('🔍 Using userId:', userId);
    
    if (!userId) {
      return res.status(400).json({ msg: 'User ID not found in request' });
    }

    // Process each candidate
    for (const candidateId of candidateIds) {
      try {
        console.log(`🔍 Processing candidate ${candidateId} for bulk move to pipeline`);
        
        // Refetch job to get latest version
        const freshJob = await Job.findOne(query);
        if (!freshJob) {
          throw new Error('Job not found during processing');
        }
        
        // Check if candidate is in shortlist
        const shortlistItem = freshJob.shortlist.find(item => 
          item.candidate.toString() === candidateId.toString()
        );

        if (!shortlistItem) {
          console.log(`❌ Candidate ${candidateId} not found in shortlist`);
          failed.push({
            candidateId,
            reason: 'Candidate not found in shortlist'
          });
          continue;
        }

        // Check if candidate is already in pipeline
        const existingApplicant = freshJob.applicants.find(app => 
          app.candidate.toString() === candidateId.toString()
        );

        if (existingApplicant) {
          console.log(`⚠️ Candidate ${candidateId} already in pipeline, skipping`);
          failed.push({
            candidateId,
            reason: 'Candidate already in pipeline'
          });
          continue;
        }

        console.log(`✅ Candidate ${candidateId} found in shortlist, adding to pipeline`);

        // Add to pipeline using pipelineProgressionService with correct signature
        // This will save the job with the new applicant
        await pipelineProgressionService.addCandidateToPipeline(jobId, {
          candidate: candidateId,
          addedBy: userId,
          notes: 'Moved from shortlist via bulk action',
          source: 'shortlist',
          initialStatus: 'shortlisted'
        });

        console.log(`✅ Successfully added candidate ${candidateId} to pipeline`);

        // Now refetch again to update shortlist status
        const jobForShortlistUpdate = await Job.findOne(query);
        if (jobForShortlistUpdate) {
          const shortlistItemToUpdate = jobForShortlistUpdate.shortlist.find(item => 
            item.candidate.toString() === candidateId.toString()
          );

          if (shortlistItemToUpdate) {
            shortlistItemToUpdate.status = 'moved_to_pipeline';
            shortlistItemToUpdate.movedToPipelineAt = new Date();
            await jobForShortlistUpdate.save();
            console.log(`✅ Updated shortlist status for candidate ${candidateId}`);
          }
        }

        // Send email notification to candidate about moving to pipeline
        try {
          const candidate = await Candidate.findById(candidateId);
          if (candidate) {
            // Populate job organization for email service
            const jobForEmail = await Job.findOne(query).populate('organization');
            
            if (jobForEmail) {
              console.log(`📧 Sending shortlist email to candidate ${candidateId}`);
              await candidateEmailNotificationService.sendShortlistEmail({
                candidate,
                job: jobForEmail
              });
              console.log(`✅ Email sent to candidate ${candidateId}`);
            }
          }
        } catch (emailError) {
          console.error(`❌ Error sending email to candidate ${candidateId}:`, emailError);
          // Don't fail the operation if email fails
        }

        results.push({
          candidateId,
          success: true
        });
      } catch (error) {
        console.error(`❌ Failed to move candidate ${candidateId}:`, error);
        console.error(`❌ Error details:`, error.stack);
        failed.push({
          candidateId,
          reason: error.message
        });
      }
    }

    console.log(`✅ Bulk move completed: ${results.length} successful, ${failed.length} failed`);

    res.json({
      success: true,
      moved: results.length,
      failed: failed.length,
      results,
      failures: failed
    });
  } catch (error) {
    console.error('❌ Error in bulk move shortlist to pipeline:', error);
    res.status(500).json({ 
      msg: 'Server error during bulk move', 
      error: error.message 
    });
  }
};

/**
 * Bulk remove candidates from shortlist
 */
exports.bulkRemoveFromShortlist = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateIds } = req.body;
    const organizationId = req.user?.currentOrganization;
    
    // Validate input
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ msg: 'candidateIds must be a non-empty array' });
    }

    console.log(`🗑️ Bulk removing ${candidateIds.length} candidates from shortlist`);

    // Build query based on whether we have organization context
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }
    
    const job = await Job.findOne(query);

    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    const results = [];
    const failed = [];

    // Process each candidate
    for (const candidateId of candidateIds) {
      try {
        const initialLength = job.shortlist.length;
        
        console.log(`🔍 Looking for candidate ${candidateId} in shortlist of ${initialLength} items`);
        
        // Log the candidate IDs in the shortlist for debugging
        const shortlistIds = job.shortlist.map(item => item.candidate.toString());
        console.log(`📋 Current shortlist IDs:`, shortlistIds);
        
        // Remove from shortlist
        job.shortlist = job.shortlist.filter(item => 
          item.candidate.toString() !== candidateId.toString()
        );

        if (job.shortlist.length === initialLength) {
          console.log(`❌ Candidate ${candidateId} not found in shortlist`);
          failed.push({
            candidateId,
            reason: 'Candidate not found in shortlist'
          });
        } else {
          console.log(`✅ Successfully removed candidate ${candidateId}, new length: ${job.shortlist.length}`);
          results.push({
            candidateId,
            success: true
          });
        }
      } catch (error) {
        console.error(`❌ Failed to remove candidate ${candidateId}:`, error);
        failed.push({
          candidateId,
          reason: error.message
        });
      }
    }

    // Save job with updated shortlist
    await job.save();

    console.log(`✅ Bulk removal completed: ${results.length} successful, ${failed.length} failed`);

    res.json({
      success: true,
      removed: results.length,
      failed: failed.length,
      results,
      failures: failed
    });
  } catch (error) {
    console.error('❌ Error in bulk remove from shortlist:', error);
    res.status(500).json({ 
      msg: 'Server error during bulk removal', 
      error: error.message 
    });
  }
};


// ===== INTERVIEW QUESTIONS FUNCTIONALITY =====

exports.createInterviewQuestion = async (req, res) => {
  try {
    const { jobId } = req.params;
    const question = await interviewService.createQuestion(
      { ...req.body, jobId },
      req.user?.id,
      req.user?.currentOrganization
    );
    res.status(201).json({ msg: 'Interview question created successfully', question });
  } catch (error) {
    console.error('❌ Error creating interview question:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error creating interview question', code: error.code, error: error.message });
  }
};

exports.getInterviewQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { type, stage, difficulty } = req.query;
    const options = { type, stage, difficulty };
    for (let key in options) if (!options[key]) delete options[key];
    const questions = await interviewService.getQuestionsByJob(jobId, options, req.user?.currentOrganization);
    res.json({ msg: 'Interview questions retrieved successfully', questions, count: questions.length });
  } catch (error) {
    console.error('❌ Error fetching interview questions:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error fetching interview questions', code: error.code, error: error.message });
  }
};

exports.getInterviewQuestion = async (req, res) => {
  try {
    const question = await interviewService.getQuestionById(req.params.questionId, req.user?.currentOrganization);
    res.json({ msg: 'Interview question retrieved successfully', question });
  } catch (error) {
    console.error('❌ Error fetching interview question:', error);
    res.status(404).json({ msg: 'Interview question not found', error: error.message });
  }
};

exports.updateInterviewQuestion = async (req, res) => {
  try {
    const question = await interviewService.updateQuestion(
      req.params.questionId,
      req.body,
      req.user?.id,
      req.user?.currentOrganization
    );
    res.json({ msg: 'Interview question updated successfully', question });
  } catch (error) {
    console.error('❌ Error updating interview question:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error updating interview question', code: error.code, error: error.message });
  }
};

exports.deleteInterviewQuestion = async (req, res) => {
  try {
    const result = await interviewService.deleteQuestion(req.params.questionId, req.user?.currentOrganization);
    res.json({ msg: 'Interview question deleted successfully', deletedQuestion: result.deletedQuestion });
  } catch (error) {
    console.error('❌ Error deleting interview question:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error deleting interview question', code: error.code, error: error.message });
  }
};

exports.generateInterviewQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { questionCount = 10, ...otherOptions } = req.body;
    const options = {
      questionCount: parseInt(questionCount),
      ...otherOptions,
      userId: req.user?.id,
      organizationId: req.user?.currentOrganization
    };
    console.log(`🤖 Generating ${options.questionCount} interview questions for job ${jobId}`);
    const questions = await interviewService.generateQuestionsWithAI(jobId, options);
    res.status(201).json({
      msg: `Successfully generated ${questions.length} interview questions`,
      jobId,
      questions,
      count: questions.length,
      generationOptions: options
    });
  } catch (error) {
    console.error('❌ Error generating interview questions:', error);
    res.status(error.statusCode || 500).json({
      msg: error.code === 'AI_QUESTION_QUALITY_FAILED'
        ? 'AI could not produce a sufficiently job-specific question set. No questions were saved.'
        : 'Server error generating interview questions',
      code: error.code,
      error: error.message
    });
  }
};

exports.generateOptimizedInterviewQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    const options = {
      ...req.body,
      userId: req.user?.id,
      organizationId: req.user?.currentOrganization
    };
    console.log(`🎯 Generating optimized question suite for job ${jobId}`, options);
    const result = await interviewService.generateOptimizedQuestionSet(jobId, options);
    res.status(201).json({ msg: 'Successfully generated optimized question suite', jobId, ...result });
  } catch (error) {
    console.error('❌ Error generating optimized interview questions:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error generating optimized interview questions', code: error.code, error: error.message });
  }
};

exports.analyzeInterviewQuestionQuality = async (req, res) => {
  try {
    const { questionId } = req.params;
    console.log(`🔍 Analyzing question quality for question ${questionId}`);
    const analysis = await interviewService.analyzeQuestionQuality(questionId, req.user?.currentOrganization);
    res.json({ msg: 'Question quality analysis completed', analysis });
  } catch (error) {
    console.error('❌ Error analyzing question quality:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error analyzing question quality', code: error.code, error: error.message });
  }
};

exports.submitInterviewQuestionFeedback = async (req, res) => {
  try {
    const { questionId } = req.params;
    const feedback = { ...req.body, submittedBy: req.user?.id, submittedAt: new Date() };
    console.log(`📝 Submitting feedback for question ${questionId}`);
    await interviewService.submitQuestionFeedback(questionId, feedback, req.user?.currentOrganization);
    res.json({ msg: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('❌ Error submitting question feedback:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error submitting question feedback', code: error.code, error: error.message });
  }
};

exports.getInterviewQuestionsPerformanceInsights = async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log(`📊 Getting performance insights for job ${jobId}`);
    const insights = await interviewService.getPerformanceInsights(jobId, req.user?.currentOrganization);
    res.json({ msg: 'Performance insights retrieved successfully', insights });
  } catch (error) {
    console.error('❌ Error getting performance insights:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error getting performance insights', code: error.code, error: error.message });
  }
};

exports.bulkCreateInterviewQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!Array.isArray(req.body.questions) || req.body.questions.length === 0) {
      return res.status(400).json({ msg: 'Please provide an array of questions' });
    }
    const questionsWithJobId = req.body.questions.map(q => ({ ...q, jobId }));
    const createdQuestions = await interviewService.bulkCreateQuestions(
      questionsWithJobId,
      req.user?.id,
      req.user?.currentOrganization
    );
    res.status(201).json({ msg: `Successfully created ${createdQuestions.length} interview questions`, questions: createdQuestions, count: createdQuestions.length });
  } catch (error) {
    console.error('❌ Error bulk creating interview questions:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error bulk creating interview questions', code: error.code, error: error.message });
  }
};

exports.getInterviewQuestionsStats = async (req, res) => {
  try {
    const { jobId } = req.params;
    const stats = await interviewService.getQuestionStatistics(jobId, req.user?.currentOrganization);
    res.json({ msg: 'Interview questions statistics retrieved successfully', stats });
  } catch (error) {
    console.error('❌ Error fetching interview questions statistics:', error);
    res.status(error.statusCode || 500).json({ msg: 'Server error fetching statistics', code: error.code, error: error.message });
  }
};

exports.getPipelineAnalytics = async (req, res) => {
  try {
    const { jobId } = req.params;
    console.log(`📊 Fetching enhanced pipeline analytics for job ${jobId}`);
    
    // Use the enhanced pipeline service to get proper stage-based analytics
    const stageAnalytics = await pipelineProgressionService.getStageAnalytics(jobId);
    const detailedPipeline = await pipelineProgressionService.getDetailedPipeline(jobId);
    
         // Color palette for stages
     const stageColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];
     
     // Transform to match frontend expected structure
     const analytics = {
       totalApplicants: detailedPipeline.analytics.totalApplicants,
       stageBreakdown: stageAnalytics.stages.map((stage, index) => ({
         stageId: stage._id,
         stageName: stage.name,
         candidateCount: stage.candidateCount,
         passRate: stage.passRate,
         averageTimeInStage: stage.avgTimeInStage || 7, // Default value
         conversionRate: 0, // Will be calculated from conversions
         color: stageColors[index % stageColors.length] // Use consistent color palette
       })),
      conversions: stageAnalytics.conversions || [],
      bottlenecks: detailedPipeline.analytics.bottlenecks || [],
      timeMetrics: {
        averageTimeToHire: stageAnalytics.averageTimeToHire,
        timeToHireTrend: stageAnalytics.timeToHireTrend || 0,
        stageTimings: stageAnalytics.stages.map(stage => ({
          stage: stage.name,
          avgDays: stage.avgTimeInStage || 7,
          minDays: Math.max(1, (stage.avgTimeInStage || 7) - 3),
          maxDays: (stage.avgTimeInStage || 7) + 5
        }))
      },
      overallPassRate: stageAnalytics.overallPassRate,
      trends: [] // Could be enhanced with historical data
    };

    // Update conversion rates in stage breakdown
    analytics.stageBreakdown.forEach((stage, index) => {
      const conversion = analytics.conversions.find(c => c.from === stage.stageName);
      if (conversion) {
        stage.conversionRate = conversion.rate;
      } else if (index === 0) {
        // First stage conversion rate is 100%
        stage.conversionRate = 100;
      }
    });

    console.log(`✅ Enhanced pipeline analytics generated for job ${jobId}`, {
      stages: analytics.stageBreakdown.length,
      totalApplicants: analytics.totalApplicants,
      bottlenecks: analytics.bottlenecks.length
    });

    res.json(analytics);
  } catch (error) {
    console.error('❌ Error fetching enhanced pipeline analytics:', error);
    
    // Fallback to basic analytics if enhanced fails
    try {
      const job = await Job.findById(jobId);
      if (!job) return res.status(404).json({ msg: 'Job not found' });

      const fallbackAnalytics = {
        totalApplicants: job.applicants.length,
        stageBreakdown: [],
        conversions: [],
        bottlenecks: [],
        timeMetrics: {
          averageTimeToHire: 0,
          timeToHireTrend: 0,
          stageTimings: []
        },
        overallPassRate: 0,
        trends: []
      };

      console.log('⚠️ Using fallback analytics due to error');
      res.json(fallbackAnalytics);
    } catch (fallbackError) {
      console.error('❌ Error in fallback analytics:', fallbackError);
      res.status(500).json({ msg: 'Server error fetching pipeline analytics', error: error.message });
    }
  }
};


// ===== NEW PIPELINE MANAGEMENT METHODS =====

exports.addCandidateToJobPipeline = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateId, ...otherData } = req.body;
    
    console.log('🔍 Debug - req.user:', req.user);
    console.log('🔍 Debug - req.user.id:', req.user?.id);
    console.log('🔍 Debug - candidateId:', candidateId);
    console.log('🔍 Debug - otherData:', otherData);
    
    if (!candidateId) {
      return res.status(400).json({ msg: 'Candidate ID is required' });
    }
    
    const candidateData = { 
      candidate: candidateId,
      ...otherData, 
      addedBy: req.user.id 
    };
    
    console.log('🔍 Debug - candidateData being sent to service:', candidateData);
    
    const applicant = await pipelineProgressionService.addCandidateToPipeline(jobId, candidateData);
    res.status(201).json({ msg: 'Candidate added to job pipeline successfully', applicant });
  } catch (error) {
    console.error('❌ Error adding candidate to pipeline:', error);
    res.status(500).json({ msg: 'Server error adding candidate to pipeline', error: error.message });
  }
};

exports.getDetailedPipeline = async (req, res) => {
  try {
    const { jobId } = req.params;
    const pipeline = await pipelineProgressionService.getDetailedPipeline(jobId);
    res.json({ pipeline });
  } catch (error) {
    console.error('❌ Error getting detailed pipeline:', error);
    res.status(500).json({ msg: 'Server error getting detailed pipeline', error: error.message });
  }
};

exports.exportPipelineExcelReport = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;

    const { buffer, fileName } = await pipelineReportExportService.buildDetailedPipelineWorkbook({
      jobId,
      organizationId
    });

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ msg: 'Job not found' });
    }
    console.error('Error exporting detailed pipeline report:', error);
    res.status(500).json({ msg: 'Server error exporting pipeline report', error: error.message });
  }
};

exports.advanceCandidateToStage = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;
    const { stageId, notes } = req.body;
    const result = await pipelineProgressionService.advanceCandidateToStage(
      jobId,
      candidateId,
      stageId,
      notes,
      req.user.id
    );
    res.json(result);
      } catch (error) {
    console.error('❌ Error advancing candidate to stage:', error);
    res.status(500).json({ msg: 'Server error advancing candidate', error: error.message });
  }
};

exports.keepCandidateInView = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;
    const { reason } = req.body;

    const applicant = await pipelineProgressionService.keepCandidateInView(
      jobId,
      candidateId,
      reason,
      req.user.id
    );

    res.json({
      msg: 'Candidate moved to keep in view successfully',
      applicant
    });
  } catch (error) {
    console.error('❌ Error moving candidate to keep in view:', error);
    if (error.message === 'Job not found' || error.message === 'Candidate not found in job applicants') {
      return res.status(404).json({ msg: error.message });
    }
    if (error.message.includes('cannot be moved')) {
      return res.status(400).json({ msg: error.message });
    }
    res.status(500).json({ msg: 'Server error moving candidate to keep in view', error: error.message });
  }
};

exports.getStageAnalytics = async (req, res) => {
  try {
    const { jobId } = req.params;
    const analytics = await pipelineProgressionService.getStageAnalytics(jobId);
    res.json({ analytics });
  } catch (error) {
    console.error('❌ Error getting stage analytics:', error);
    res.status(500).json({ msg: 'Server error getting stage analytics', error: error.message });
  }
};

exports.updateStageResult = async (req, res) => {
  try {
    const { jobId, candidateId, stageId } = req.params;
    const { result, feedback } = req.body;
    
    if (!result || !['passed', 'failed', 'on_hold'].includes(result)) {
      return res.status(400).json({ msg: 'Invalid result. Must be passed, failed, or on_hold' });
    }
    
    const updatedApplicant = await pipelineProgressionService.updateStageResult(
      jobId,
      candidateId,
      stageId,
      result,
      feedback,
      req.user.id
    );
    
    res.json({ msg: 'Stage result updated successfully', applicant: updatedApplicant });
  } catch (error) {
    console.error('❌ Error updating stage result:', error);
    res.status(500).json({ msg: 'Server error updating stage result', error: error.message });
  }
};

exports.scheduleInterview = async (req, res) => {
  try {
    const { jobId, candidateId, stageId } = req.params;
    const interviewData = req.body;
    
    if (!interviewData.scheduledAt) {
      return res.status(400).json({ msg: 'Scheduled date/time is required' });
    }
    
    const interview = await pipelineProgressionService.scheduleInterview(
      jobId,
      candidateId,
      stageId,
      interviewData,
      req.user.id
    );
    
    res.status(201).json({ msg: 'Interview scheduled successfully', interview });
  } catch (error) {
    console.error('❌ Error scheduling interview:', error);
    res.status(500).json({ msg: 'Server error scheduling interview', error: error.message });
  }
};

exports.removeCandidateFromPipeline = async (req, res) => {
  try {
    const { jobId, candidateId } = req.params;
    const { reason } = req.body;

    const result = await pipelineProgressionService.removeCandidateFromPipeline(
      jobId,
      candidateId,
      reason,
      req.user.id
    );
    
    res.json({ msg: 'Candidate removed from pipeline successfully', ...result });
  } catch (error) {
    console.error('❌ Error removing candidate from pipeline:', error);
    res.status(500).json({ msg: 'Server error removing candidate from pipeline:', error: error.message });
  }
};

exports.bulkMoveCandidates = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateIds, targetStageId } = req.body;
    const userId = req.user.id;
    
    // Validate inputs
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ 
        msg: 'candidateIds must be a non-empty array' 
      });
    }
    
    if (!targetStageId) {
      return res.status(400).json({ 
        msg: 'targetStageId is required' 
      });
    }
    
    // Execute bulk move
    const result = await pipelineProgressionService.bulkMoveCandidates(
      jobId,
      candidateIds,
      targetStageId,
      userId
    );
    
    // Return appropriate response
    if (result.success) {
      return res.status(200).json({
        msg: `Successfully moved ${result.results.successful.length} candidates`,
        result
      });
    } else if (result.partialSuccess) {
      return res.status(207).json({
        msg: `Partially successful: ${result.results.successful.length} moved, ${result.results.failed.length} failed`,
        result
      });
    } else {
      return res.status(400).json({
        msg: 'Bulk move failed',
        result
      });
    }
    
  } catch (error) {
    console.error('❌ Error in bulk move candidates:', error);
    res.status(500).json({ 
      msg: 'Server error during bulk move', 
      error: error.message 
    });
  }
};

exports.bulkKeepCandidatesInView = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateIds, reason } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({
        msg: 'candidateIds must be a non-empty array'
      });
    }

    const result = await pipelineProgressionService.bulkKeepCandidatesInView(
      jobId,
      candidateIds,
      reason,
      userId
    );

    if (result.success) {
      return res.status(200).json({
        msg: `Successfully moved ${result.results.successful.length} candidates to keep in view`,
        result
      });
    }

    if (result.partialSuccess) {
      return res.status(207).json({
        msg: `Partially successful: ${result.results.successful.length} moved, ${result.results.failed.length} failed`,
        result
      });
    }

    return res.status(400).json({
      msg: 'Bulk keep in view failed',
      result
    });
  } catch (error) {
    console.error('❌ Error in bulk keep in view:', error);
    if (error.message === 'Job not found') {
      return res.status(404).json({ msg: error.message });
    }
    res.status(500).json({
      msg: 'Server error during bulk keep in view',
      error: error.message
    });
  }
};

/**
 * Get ALL feedback for a job
 * Returns all feedback comments with populated interview, candidate, and stage data
 * Frontend will organize by stage and calculate rankings
 */
exports.getAllJobFeedback = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user?.currentOrganization;

    console.log('📊 [JOB-FEEDBACK] Fetching all feedback for job:', jobId);

    // Verify job exists and user has access
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }

    const job = await Job.findOne(query);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const Interview = require('../models/Interview');
    const InterviewComment = require('../models/InterviewComment');

    // Get ALL interviews for this job
    const interviews = await Interview.find({ jobId }).select('_id');
    const interviewIds = interviews.map(i => i._id);

    console.log('📊 [JOB-FEEDBACK] Found', interviews.length, 'interviews for job');

    // Get ALL feedback for these interviews
    const feedback = await InterviewComment.find({
      interviewId: { $in: interviewIds },
      commentType: 'feedback',
      organization: organizationId
    })
    .populate({
      path: 'interviewId',
      select: 'title scheduledAt status structuredFeedback candidateId stageId stageName stageOrder',
      populate: [
        {
          path: 'candidateId',
          select: 'firstName lastName email position avatar'
        },
        {
          path: 'stageId',
          select: 'name order type'
        }
      ]
    })
    .populate('authorId', 'profile.firstName profile.lastName email')
    .populate('questionId', 'question type')
    .sort({ createdAt: -1 });

    console.log('📊 [JOB-FEEDBACK] Found', feedback.length, 'feedback comments');

    // Get stages for reference
    const InterviewStage = require('../models/InterviewStage');
    const stages = await InterviewStage.find({ jobId }).sort({ order: 1 });

    res.json({
      success: true,
      jobId: job._id,
      jobTitle: job.title,
      totalFeedback: feedback.length,
      totalInterviews: interviews.length,
      stages: stages.map(s => ({
        _id: s._id,
        name: s.name,
        order: s.order,
        type: s.type
      })),
      feedback
    });

  } catch (error) {
    console.error('❌ [JOB-FEEDBACK] Error fetching job feedback:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error fetching job feedback',
      details: error.message 
    });
  }
};

/**
 * Get feedback leaderboard for a job (DEPRECATED - use getAllJobFeedback instead)
 * Aggregates all candidate feedback and ranks candidates by stage
 */
exports.getFeedbackLeaderboard = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { stageId, sortBy = 'overallScore', sortOrder = 'desc' } = req.query;
    const organizationId = req.user?.currentOrganization;

    console.log('📊 [LEADERBOARD] Fetching feedback leaderboard for job:', jobId);

    // Verify job exists and user has access
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }

    const job = await Job.findOne(query);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Get interview stages for this job
    const InterviewStage = require('../models/InterviewStage');
    const Interview = require('../models/Interview');
    const InterviewComment = require('../models/InterviewComment');
    const Candidate = require('../models/Candidate');
    
    let stages = await InterviewStage.find({ jobId }).sort({ order: 1 });
    
    // Filter by specific stage if requested
    if (stageId && stageId !== 'all') {
      stages = stages.filter(s => s._id.toString() === stageId);
    }

    console.log('📊 [LEADERBOARD] Found', stages.length, 'stages');

    // Process each stage
    const stageLeaderboards = await Promise.all(stages.map(async (stage) => {
      // First, get all feedback comments for this job/stage to find which interviews have feedback
      const stageComments = await InterviewComment.find({
        stageId: stage._id,
        commentType: 'feedback',
        'rating.overall': { $exists: true, $ne: null }
      });

      const interviewIdsWithFeedback = [...new Set(stageComments.map(c => c.interviewId.toString()))];

      console.log('📊 [LEADERBOARD] Stage:', stage.name, '- Found', interviewIdsWithFeedback.length, 'interviews with feedback comments');

      // Build query conditions
      const orConditions = [
        { 'structuredFeedback.overallScore': { $exists: true, $ne: null } },
        { status: 'completed' }
      ];

      // Only add the $in condition if there are interviews with feedback
      if (interviewIdsWithFeedback.length > 0) {
        orConditions.push({ _id: { $in: interviewIdsWithFeedback } });
      }

      // Get all interviews for this stage that either:
      // 1. Have feedback comments, OR
      // 2. Have structured feedback, OR  
      // 3. Are completed
      const interviews = await Interview.find({
        jobId,
        stageId: stage._id,
        $or: orConditions
      }).populate('candidateId', 'firstName lastName email position avatar');

      console.log('📊 [LEADERBOARD] Stage:', stage.name, '- Total interviews to process:', interviews.length);

      if (interviews.length === 0) {
        return {
          stageId: stage._id,
          stageName: stage.name,
          stageOrder: stage.order,
          statistics: {
            totalCandidates: 0,
            averageScore: 0,
            completionRate: 0,
            topPerformer: null,
            scoreDistribution: {
              excellent: 0,
              strong: 0,
              good: 0,
              fair: 0,
              needsImprovement: 0
            }
          },
          leaderboard: []
        };
      }

      // Get feedback for all interviews
      const interviewIds = interviews.map(i => i._id);
      const allComments = await InterviewComment.find({
        interviewId: { $in: interviewIds },
        commentType: 'feedback'
      }).populate('authorId', 'profile.firstName profile.lastName email');

      // Process each candidate
      const candidateScores = await Promise.all(interviews.map(async (interview) => {
        const candidateComments = allComments.filter(c => 
          c.interviewId.toString() === interview._id.toString()
        );

        // Use comprehensive analytics for dynamic scoring
        let scoreData;
        try {
          const analytics = await interviewController.getComprehensiveAnalyticsForInterview(interview._id);
          if (analytics) {
            // Convert to 0-100 scale for leaderboard display
            scoreData = {
              overallScore: (analytics.normalizedScore / 5) * 100,
              breakdown: analytics.breakdown
            };
          } else {
            // Fallback to old calculation if comprehensive analytics fails
            scoreData = calculateCandidateScore(interview, candidateComments);
          }
        } catch (error) {
          console.error(`Error getting comprehensive analytics for interview ${interview._id}:`, error);
          // Fallback to old calculation
          scoreData = calculateCandidateScore(interview, candidateComments);
        }
        
        if (!scoreData || scoreData.overallScore === 0) {
          return null; // Skip candidates without scores
        }

        // Get unique assessors (include both internal and public)
        const assessors = new Set();
        candidateComments.forEach(c => {
          if (c.authorId) assessors.add(c.authorId._id.toString());
          if (c.publicFeedback?.email) assessors.add(c.publicFeedback.email);
        });

        // Determine recommendation
        let recommendation = interview.structuredFeedback?.recommendation || 'pending';
        
        // Get performance rating based on comprehensive score
        const performanceRating = getPerformanceRating(scoreData.overallScore);

        return {
          candidateId: interview.candidateId._id,
          candidateName: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
          candidateEmail: interview.candidateId.email,
          candidatePosition: interview.candidateId.position,
          candidateAvatar: interview.candidateId.avatar,
          overallScore: scoreData.overallScore,
          performanceRating,
          scoreBreakdown: scoreData.breakdown,
          recommendation,
          feedbackStats: {
            totalResponses: candidateComments.length,
            totalAssessors: assessors.size,
            lastFeedbackAt: candidateComments.length > 0 
              ? candidateComments.reduce((latest, c) => 
                  c.createdAt > latest ? c.createdAt : latest, 
                  candidateComments[0].createdAt
                )
              : null
          },
          interviewDetails: {
            interviewId: interview._id,
            scheduledAt: interview.scheduledAt,
            completedAt: interview.completedAt,
            status: interview.status
          }
        };
      }));

      // Filter out null entries (candidates without scores)
      const validScores = candidateScores.filter(s => s !== null);

      // Sort candidates
      validScores.sort((a, b) => {
        const field = sortBy || 'overallScore';
        const order = sortOrder === 'asc' ? 1 : -1;
        return (b[field] - a[field]) * order;
      });

      // Add ranks
      const leaderboard = validScores.map((candidate, index) => ({
        rank: index + 1,
        ...candidate
      }));

      // Calculate statistics
      const scores = leaderboard.map(c => c.overallScore);
      const averageScore = scores.length > 0 
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
        : 0;

      const scoreDistribution = {
        excellent: leaderboard.filter(c => c.overallScore >= 90).length,
        strong: leaderboard.filter(c => c.overallScore >= 80 && c.overallScore < 90).length,
        good: leaderboard.filter(c => c.overallScore >= 70 && c.overallScore < 80).length,
        fair: leaderboard.filter(c => c.overallScore >= 60 && c.overallScore < 70).length,
        needsImprovement: leaderboard.filter(c => c.overallScore < 60).length
      };

      const topPerformer = leaderboard.length > 0 ? {
        candidateId: leaderboard[0].candidateId,
        name: leaderboard[0].candidateName,
        score: leaderboard[0].overallScore
      } : null;

      return {
        stageId: stage._id,
        stageName: stage.name,
        stageOrder: stage.order,
        statistics: {
          totalCandidates: leaderboard.length,
          averageScore: Math.round(averageScore * 10) / 10,
          completionRate: leaderboard.length / interviews.length,
          topPerformer,
          scoreDistribution
        },
        leaderboard
      };
    }));

    // Calculate overall statistics
    const allLeaderboards = stageLeaderboards.flatMap(s => s.leaderboard);
    const totalScores = allLeaderboards.map(c => c.overallScore);
    const totalFeedback = allLeaderboards.reduce((sum, c) => sum + c.feedbackStats.totalResponses, 0);
    const assessorsSet = new Set();
    allLeaderboards.forEach(c => {
      // This is approximate since we don't track unique assessors across stages
      assessorsSet.add(c.feedbackStats.totalAssessors);
    });

    const overallStatistics = {
      totalCandidatesInterviewed: allLeaderboards.length,
      averageScoreAllStages: totalScores.length > 0
        ? Math.round((totalScores.reduce((sum, s) => sum + s, 0) / totalScores.length) * 10) / 10
        : 0,
      totalFeedbackResponses: totalFeedback,
      totalStages: stages.length
    };

    console.log('✅ [LEADERBOARD] Successfully generated leaderboard');

    res.json({
      success: true,
      jobId: job._id,
      jobTitle: job.title,
      stages: stageLeaderboards,
      overallStatistics
    });

  } catch (error) {
    console.error('❌ [LEADERBOARD] Error generating leaderboard:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error generating feedback leaderboard',
      details: error.message 
    });
  }
};

/**
 * Helper function to calculate candidate score from interview and feedback
 */
function calculateCandidateScore(interview, feedbackComments) {
  // 1. Use structuredFeedback if available
  if (interview.structuredFeedback?.overallScore) {
    const scores = interview.structuredFeedback.scores || [];
    const breakdown = {};
    
    scores.forEach(score => {
      const key = score.criterionName?.toLowerCase().replace(/\s+/g, '') || 'other';
      breakdown[key] = score.score * 10; // Convert to 0-100 scale if needed
    });

    // Ensure we have the main categories
    if (!breakdown.technical && feedbackComments.length > 0) {
      // Calculate from feedback comments
      const ratings = extractRatingsFromComments(feedbackComments);
      Object.assign(breakdown, ratings);
    }

    return {
      overallScore: interview.structuredFeedback.overallScore,
      breakdown
    };
  }
  
  // 2. Calculate from feedback comments
  if (feedbackComments.length > 0) {
    const ratings = {
      overall: [],
      technical: [],
      communication: [],
      cultural: []
    };
    
    feedbackComments.forEach(comment => {
      if (comment.rating) {
        if (comment.rating.overall) ratings.overall.push(comment.rating.overall);
        if (comment.rating.technical) ratings.technical.push(comment.rating.technical);
        if (comment.rating.communication) ratings.communication.push(comment.rating.communication);
        if (comment.rating.cultural) ratings.cultural.push(comment.rating.cultural);
      }
    });
    
    const average = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    
    return {
      overallScore: (average(ratings.overall) / 5) * 100, // Convert 1-5 to 0-100
      breakdown: {
        technical: (average(ratings.technical) / 5) * 100,
        communication: (average(ratings.communication) / 5) * 100,
        cultural: (average(ratings.cultural) / 5) * 100
      }
    };
  }
  
  // 3. No feedback available
  return null;
}

/**
 * Helper function to extract ratings from comments
 */
function extractRatingsFromComments(comments) {
  const ratings = {
    overall: [],
    technical: [],
    communication: [],
    cultural: []
  };
  
  comments.forEach(comment => {
    if (comment.rating) {
      if (comment.rating.overall) ratings.overall.push(comment.rating.overall);
      if (comment.rating.technical) ratings.technical.push(comment.rating.technical);
      if (comment.rating.communication) ratings.communication.push(comment.rating.communication);
      if (comment.rating.cultural) ratings.cultural.push(comment.rating.cultural);
    }
  });
  
  const average = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  
  return {
    technical: (average(ratings.technical) / 5) * 100,
    communication: (average(ratings.communication) / 5) * 100,
    cultural: (average(ratings.cultural) / 5) * 100
  };
}

/**
 * Helper function to get performance rating category
 */
function getPerformanceRating(score) {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 60) return 'fair';
  return 'needs_improvement';
}

/**
 * Save job's interview stages as a template
 */
exports.saveStagesAsTemplate = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { templateName, templateDescription } = req.body;
    const InterviewStage = require('../models/InterviewStage');
    const stageTemplateService = require('../services/stageTemplateService');

    if (!templateName) {
      return res.status(400).json({
        success: false,
        error: 'Template name is required'
      });
    }

    // Validate user context
    if (!req.user || (!req.user.id && !req.user._id)) {
      console.error('No user ID found in request:', req.user);
      return res.status(401).json({
        success: false,
        error: 'User authentication required'
      });
    }

    if (!req.user.currentOrganization) {
      console.error('No organization found for user:', req.user);
      return res.status(400).json({
        success: false,
        error: 'Organization context required'
      });
    }

    // Get job and verify ownership
    const job = await Job.findOne({
      _id: jobId,
      organization: req.user.currentOrganization
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Get job's interview stages
    const stages = await InterviewStage.find({ jobId })
      .sort('order')
      .lean();

    if (stages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot create template from job with no stages'
      });
    }

    // Extract stage configurations (exclude jobId and _id)
    const templateStages = stages.map((stage, index) => {
      const { _id, jobId, createdAt, updatedAt, __v, organization, ...stageConfig } = stage;
      
      // Ensure required fields are present and fix ordering
      const cleanStage = {
        ...stageConfig,
        // Explicitly include required fields
        name: stage.name,
        type: stage.type,
        order: index + 1  // Force sequential ordering starting from 1
      };
      
      return cleanStage;
    });

    console.log('Extracted template stages:', templateStages.length);
    console.log('Sample template stage:', templateStages[0]);

    // Create template
    const userId = req.user.id || req.user._id;
    console.log('Creating template with userId:', userId, 'orgId:', req.user.currentOrganization);
    
    const template = await stageTemplateService.createTemplate(
      req.user.currentOrganization,
      userId,
      {
        name: templateName,
        description: templateDescription,
        stages: templateStages
      }
    );

    // Link template to job
    job.pipelineConfiguration = job.pipelineConfiguration || {};
    job.pipelineConfiguration.customTemplateId = template._id;
    await job.save();

    res.status(201).json({
      success: true,
      template,
      message: 'Template created successfully from job stages'
    });
  } catch (error) {
    console.error('Error saving stages as template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
};

/**
 * Apply template to job (create stages from template)
 */
exports.applyTemplate = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { templateId } = req.body;
    const InterviewStage = require('../models/InterviewStage');
    const stageTemplateService = require('../services/stageTemplateService');
    const mongoose = require('mongoose');

    console.log('Apply template request:', { jobId, templateId, userId: req.user?.id, orgId: req.user?.currentOrganization });

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: 'Template ID is required'
      });
    }

    // Get job and verify ownership
    const job = await Job.findOne({
      _id: jobId,
      organization: req.user.currentOrganization
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Check if job already has stages
    const existingStages = await InterviewStage.countDocuments({ jobId });
    console.log('Existing stages count:', existingStages);
    
    if (existingStages > 0) {
      console.log('Job already has stages, blocking template application');
      return res.status(400).json({
        success: false,
        error: `This job already has ${existingStages} stage(s). You can only apply templates to jobs without stages. Please delete existing stages first.`
      });
    }

    // Get template
    console.log('Fetching template:', templateId);
    const template = await stageTemplateService.getTemplateById(
      templateId,
      req.user.currentOrganization
    );
    console.log('Template found:', template?.name, 'with', template?.stages?.length, 'stages');

    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create InterviewStage documents from template
      const stagesToCreate = template.stages.map((stage, index) => ({
        ...stage,
        jobId,
        organization: req.user.currentOrganization,
        // Ensure required fields are present with sequential ordering
        order: index + 1,  // Force sequential ordering starting from 1
        name: stage.name || `Stage ${index + 1}`,
        type: stage.type || 'screening'
      }));

      console.log('Creating stages from template:', stagesToCreate.length, 'stages');
      console.log('Sample stage data:', stagesToCreate[0]);

      const createdStages = await InterviewStage.insertMany(stagesToCreate, { session });

      // Update job with template reference
      job.pipelineConfiguration = job.pipelineConfiguration || {};
      job.pipelineConfiguration.customTemplateId = template._id;
      job.pipelineConfiguration.totalStages = createdStages.length;
      await job.save({ session });

      // Increment template usage
      await template.incrementUsageCount();

      await session.commitTransaction();

      res.status(201).json({
        success: true,
        stages: createdStages,
        message: `Template applied successfully. ${createdStages.length} stages created.`
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Error applying template:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Server error',
      code: error.code
    });
  }
};

/**
 * Invalidate AI match cache for a job
 */
exports.invalidateAICache = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;
    const aiMatchCacheService = require('../services/aiMatchCacheService');

    const job = await Job.findOne({ _id: jobId, organization: organizationId }).select('_id');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    console.log(`🗑️ Invalidating AI match cache for job ${jobId}`);
    
    const result = await aiMatchCacheService.invalidateJobCache(jobId);
    require('../services/gptAnalysisService').cache.invalidateJob(jobId);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `AI match cache invalidated successfully. ${result.deletedCount} cache entries cleared.`
    });
  } catch (error) {
    console.error('Error invalidating AI cache:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

/**
 * Get AI cache statistics for a job
 */
exports.getAICacheStats = async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user.currentOrganization;
    const aiMatchCacheService = require('../services/aiMatchCacheService');

    const job = await Job.findOne({ _id: jobId, organization: organizationId }).select('_id');
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    const stats = await aiMatchCacheService.getCacheStats(jobId);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting AI cache stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

/**
 * Enable internal recruitment for a job
 */
exports.enableInternalRecruitment = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { internalCandidateApplyLimit, requireEmployeeId, notifyHiringManager } = req.body;
    const userId = req.user._id;
    const organizationId = req.user.currentOrganization;

    // Find the job
    const job = await Job.findOne({ _id: jobId, organization: organizationId });
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if already enabled
    if (job.isInternalEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Internal recruitment is already enabled for this job'
      });
    }

    // Calculate credits needed if limit is set
    let creditsNeeded = 0;
    if (internalCandidateApplyLimit && internalCandidateApplyLimit > 0) {
      creditsNeeded = internalCandidateApplyLimit;

      // Check organization credits (use subscription.creditUsage)
      const Organization = require('../models/Organization');
      const organization = await Organization.findById(organizationId);

      if (!organization) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found'
        });
      }

      // Ensure subscription.creditUsage exists (match creditsService structure)
      if (!organization.subscription) organization.subscription = {};
      if (!organization.subscription.creditUsage) {
        organization.subscription.creditUsage = {
          totalCredits: 100,
          usedCredits: 0,
          remainingCredits: 100
        };
      }
      const creditUsage = organization.subscription.creditUsage;
      const totalCredits = creditUsage.totalCredits || 100;
      // Match creditsService: when remainingCredits is undefined, fall back to totalCredits
      const remainingCredits = (creditUsage.remainingCredits != null)
        ? creditUsage.remainingCredits
        : totalCredits;

      if (remainingCredits < creditsNeeded) {
        return res.status(400).json({
          success: false,
          message: `Insufficient credits. Need ${creditsNeeded}, have ${remainingCredits} available`
        });
      }

      // Reserve credits: deduct from remainingCredits
      creditUsage.usedCredits = (creditUsage.usedCredits || 0) + creditsNeeded;
      creditUsage.remainingCredits = remainingCredits - creditsNeeded;

      if (!creditUsage.transactions) creditUsage.transactions = [];
      creditUsage.transactions.push({
        action: 'creditPurchase',
        credits: creditsNeeded,
        entityId: job._id,
        entityType: 'job',
        timestamp: new Date(),
        balanceAfter: remainingCredits - creditsNeeded,
        metadata: {
          type: 'internal_recruitment_reservation',
          description: `Reserved ${creditsNeeded} credits for internal recruitment`
        }
      });

      organization.subscription.creditUsage = creditUsage;
      await organization.save();
    }

    // Enable internal recruitment
    job.isInternalEnabled = true;
    job.internalCandidateApplyLimit = internalCandidateApplyLimit || 0;
    job.reservedInternalCredits = creditsNeeded;
    job.internalSettings = {
      requireEmployeeId: requireEmployeeId || false,
      notifyHiringManager: notifyHiringManager !== false // Default true
    };
    job.updatedBy = userId;

    await job.save();

    res.json({
      success: true,
      message: 'Internal recruitment enabled successfully',
      job: {
        _id: job._id,
        isInternalEnabled: job.isInternalEnabled,
        internalUrl: job.internalUrl,
        internalCandidateApplyLimit: job.internalCandidateApplyLimit,
        reservedInternalCredits: job.reservedInternalCredits
      }
    });
  } catch (error) {
    console.error('Error enabling internal recruitment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

/**
 * Disable internal recruitment for a job
 */
exports.disableInternalRecruitment = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;
    const organizationId = req.user.currentOrganization;

    // Find the job
    const job = await Job.findOne({ _id: jobId, organization: organizationId });
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if internal recruitment is enabled
    if (!job.isInternalEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Internal recruitment is not enabled for this job'
      });
    }

    // Calculate credits to refund
    const creditsToRefund = job.reservedInternalCredits - (job.internalApplicationCount || 0);

    if (creditsToRefund > 0) {
      // Refund unused credits (add back to subscription.creditUsage)
      await refundReservedCredits(organizationId, jobId, creditsToRefund, 'Internal recruitment disabled');
    }

    // Disable internal recruitment
    job.isInternalEnabled = false;
    job.updatedBy = userId;

    await job.save();

    res.json({
      success: true,
      message: 'Internal recruitment disabled successfully',
      creditsRefunded: creditsToRefund,
      job: {
        _id: job._id,
        isInternalEnabled: job.isInternalEnabled
      }
    });
  } catch (error) {
    console.error('Error disabling internal recruitment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

/**
 * Get internal job by ID (for internal candidates)
 */
exports.getInternalJobById = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Find the job
    const job = await Job.findById(jobId)
      .populate('department', 'name')
      .populate('hiringManager', 'firstName lastName email')
      .populate('interviewStages');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if internal recruitment is enabled
    if (!job.isInternalEnabled) {
      return res.status(404).json({
        success: false,
        message: 'This job is not available for internal applications'
      });
    }

    // Check if job is accepting applications
    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'This job is not currently accepting applications'
      });
    }

    // Check if internal application limit is reached
    if (job.internalCandidateApplyLimit > 0 &&
        job.internalApplicationCount >= job.internalCandidateApplyLimit) {
      return res.status(400).json({
        success: false,
        message: 'This job has reached its internal application limit'
      });
    }

    // Increment internal view count
    job.analytics.internalViews = (job.analytics.internalViews || 0) + 1;
    await job.save();

    res.json({
      success: true,
      job
    });
  } catch (error) {
    console.error('Error fetching internal job:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

/**
 * Submit internal application
 */
exports.submitInternalApplication = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { candidateId, employeeId, notes } = req.body;
    const organizationId = req.user?.currentOrganization || req.user?.organization;

    // Find the job (when unauthenticated, find by id only - internal URL is secret)
    const jobQuery = organizationId ? { _id: jobId, organization: organizationId } : { _id: jobId };
    const job = await Job.findOne(jobQuery);
    const orgId = organizationId || (job && job.organization?.toString());
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if internal recruitment is enabled
    if (!job.isInternalEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Internal recruitment is not enabled for this job'
      });
    }

    // Check if job is active
    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'This job is not currently accepting applications'
      });
    }

    // Check application limit
    if (job.internalCandidateApplyLimit > 0 &&
        job.internalApplicationCount >= job.internalCandidateApplyLimit) {
      return res.status(400).json({
        success: false,
        message: 'Internal application limit reached'
      });
    }

    // Find or create candidate
    const Candidate = require('../models/Candidate');
    let candidate = await Candidate.findOne({ _id: candidateId, organization: orgId });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Mark candidate as internal
    candidate.isInternalCandidate = true;
    if (employeeId) {
      candidate.employeeId = employeeId;
    }
    await candidate.save();

    // Check if already applied
    const alreadyApplied = job.applicants.some(
      app => app.candidate.toString() === candidateId
    );

    if (alreadyApplied) {
      return res.status(400).json({
        success: false,
        message: 'This candidate has already applied to this job'
      });
    }

    // Add to applicants with internal type (requires auth for addedBy/changedBy)
    const addedByUserId = req.user?._id;
    if (!addedByUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to submit internal application'
      });
    }
    job.applicants.push({
      candidate: candidateId,
      applicationType: 'internal',
      status: 'applied',
      addedBy: addedByUserId,
      notes: notes || 'Internal application',
      statusHistory: [{
        status: 'applied',
        changedBy: addedByUserId,
        changedAt: new Date(),
        notes: 'Internal application submitted'
      }]
    });

    // Update counters
    job.internalApplicationCount = (job.internalApplicationCount || 0) + 1;
    job.analytics.internalApplications = (job.analytics.internalApplications || 0) + 1;
    job.analytics.applications = (job.analytics.applications || 0) + 1;

    // Credits were already deducted when internal recruitment was enabled; no per-apply deduction needed

    await job.save();

    // Send notification if enabled
    if (job.internalSettings?.notifyHiringManager && job.hiringManager) {
      // TODO: Implement notification service
      console.log('Notification should be sent to hiring manager');
    }

    res.json({
      success: true,
      message: 'Internal application submitted successfully',
      applicationId: job.applicants[job.applicants.length - 1]._id
    });
  } catch (error) {
    console.error('Error submitting internal application:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
};

module.exports = exports; 
