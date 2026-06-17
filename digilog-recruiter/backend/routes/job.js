const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');
const multer = require('multer');
const path = require('path');
const prisma = require('../db/client');
const { oid, isObjectIdLike, newId } = require('../db/objectId');
const Notification = require('../db/notify');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `job-upload-${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'), false);
    }
  }
});

// Public endpoint to get all public, active jobs (no authentication required)
// IMPORTANT: This route MUST come before /public/:id to avoid route conflicts
router.get('/public', async (req, res) => {
  try {
    const {
      search,
      location,
      department,
      type,
      remote,
      company,
      orgName,
      sort = 'createdAt',
      order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    const query = {
      isPublic: true,
      status: 'active'
    };

    // Text search (title, description, requirements, skills)
    if (search) {
      query.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { requirements: { contains: search, mode: 'insensitive' } },
        { skills: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Location filter (comma-separated values)
    if (location) {
      const locations = location.split(',').map(l => l.trim());
      query.location = { in: locations };
    }

    // Department filter (comma-separated values)
    if (department) {
      const departmentNames = department.split(',').map(d => d.trim());
      const departmentIds = await prisma.department.findMany({ where: { name: { in: departmentNames } }, select: { id: true } });
      query.departmentId = { in: departmentIds.map(d => d.id) };
    }

    // Type filter (comma-separated values)
    if (type) {
      const types = type.split(',').map(t => t.trim());
      query.type = { in: types };
    }

    // Remote filter
    if (remote === 'true') {
      query.remote = true;
    }

    // Company filter (organization IDs)
    if (company) {
      const companies = company.split(',').map(c => c.trim());
      query.organizationId = { in: companies };
    }

    // orgName filter — case-insensitive partial match on organization name
    if (orgName) {
      const matchedOrgs = await prisma.organization.findMany({
        where: { name: { contains: orgName, mode: 'insensitive' } },
        select: { id: true }
      });
      query.organizationId = { in: matchedOrgs.map(o => o.id) };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sort options
    const sortOptions = {};
    sortOptions[sort] = order === 'asc' ? 'asc' : 'desc';

    // Execute query
    let jobs = await prisma.job.findMany({
      where: query,
      select: {
        id: true, title: true, departmentId: true, location: true, type: true, level: true,
        description: true, requirements: true, skills: true, experience: true, education: true,
        salary: true, benefits: true, remote: true, openings: true, applicationDeadline: true,
        createdAt: true, organizationId: true
      },
      orderBy: sortOptions,
      skip,
      take: limitNum
    });

    // Stitch organization + department soft-ref populates
    {
      const jobOrgIds = [...new Set(jobs.map(j => j.organizationId).filter(Boolean))];
      const jobDeptIds = [...new Set(jobs.map(j => j.departmentId).filter(Boolean))];
      const [jobOrgs, jobDepts] = await Promise.all([
        jobOrgIds.length ? prisma.organization.findMany({ where: { id: { in: jobOrgIds } }, select: { id: true, name: true, logo: true, website: true, industry: true, size: true } }) : [],
        jobDeptIds.length ? prisma.department.findMany({ where: { id: { in: jobDeptIds } }, select: { id: true, name: true } }) : []
      ]);
      const jobOrgMap = new Map(jobOrgs.map(o => [o.id, o]));
      const jobDeptMap = new Map(jobDepts.map(d => [d.id, d]));
      jobs = jobs.map(j => ({
        ...j,
        organization: j.organizationId ? (jobOrgMap.get(j.organizationId) || null) : null,
        department: j.departmentId ? (jobDeptMap.get(j.departmentId) || null) : null
      }));
    }

    // Get total count for pagination
    const total = await prisma.job.count({ where: query });

    // Get unique filter options (for dropdown lists)
    // Fetch each job individually and populate, skipping ones with errors
    const allPublicJobsRaw = await prisma.job.findMany({
      where: { isPublic: true, status: 'active' },
      select: { id: true, location: true, departmentId: true, type: true, organizationId: true }
    });

    console.log('[Filters] Fetched', allPublicJobsRaw.length, 'public jobs');

    // Populate departments manually to handle invalid ObjectIds gracefully
    const allPublicJobs = [];

    for (const job of allPublicJobsRaw) {
      const jobCopy = { ...job };

      // Populate organization
      if (job.organizationId) {
        try {
          const org = await prisma.organization.findUnique({ where: { id: job.organizationId }, select: { id: true, name: true } });
          if (org) jobCopy.organization = org;
        } catch (e) {
          console.warn('[Filters] Invalid organization for job:', job._id);
        }
      }

      // Populate department
      if (job.departmentId) {
        try {
          const dept = await prisma.department.findUnique({ where: { id: job.departmentId }, select: { id: true, name: true } });
          if (dept) {
            jobCopy.department = dept;
          } else {
            console.warn('[Filters] Department not found for job:', job._id, 'deptId:', job.departmentId);
          }
        } catch (e) {
          console.warn('[Filters] Invalid department ObjectId for job:', job._id, 'value:', job.departmentId);
        }
      }

      allPublicJobs.push(jobCopy);
    }

    console.log('[Filters] Jobs with populated department:', allPublicJobs.filter(j => j.department && j.department.name).length);

    const filterOptions = {
      locations: [...new Set(allPublicJobs.map(j => j.location).filter(Boolean))].sort(),
      departments: [...new Set(
        allPublicJobs
          .map(j => {
            // Handle both populated object and string ObjectId
            if (j.department && typeof j.department === 'object' && j.department.name) {
              return j.department.name;
            }
            return null;
          })
          .filter(Boolean)
      )].sort(),
      types: [...new Set(allPublicJobs.map(j => j.type).filter(Boolean))].sort(),
      companies: [...new Map(
        allPublicJobs
          .filter(j => j.organization && j.organization._id && j.organization.name)
          .map(j => [j.organization._id.toString(), {
            _id: j.organization._id,
            name: j.organization.name
          }])
      ).values()].sort((a, b) => a.name.localeCompare(b.name))
    };

    console.log('[Filters] Final filter options:', {
      locations: filterOptions.locations.length,
      departments: filterOptions.departments.length,
      departmentsList: filterOptions.departments,
      types: filterOptions.types.length,
      companies: filterOptions.companies.length
    });

    res.json({
      jobs,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      },
      filters: filterOptions
    });

  } catch (error) {
    console.error('Error fetching public jobs:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Public endpoint to get job by ID (no authentication required)
router.get('/public/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const job = await prisma.job.findFirst({
      where: { id, isPublic: true, status: 'active' },
      select: {
        id: true, title: true, departmentId: true, location: true, type: true, level: true,
        description: true, requirements: true, responsibilities: true, skills: true, experience: true,
        education: true, salary: true, benefits: true, remote: true, openings: true, applicationDeadline: true,
        publicSlug: true, publicUrl: true, createdAt: true, organizationId: true,
        candidateApplyLimit: true, publicApplicationCount: true, analytics: true
      }
    });

    if (!job) {
      return res.status(404).json({ msg: 'Public job not found' });
    }

    // Stitch department + organization soft-ref populates
    job.department = job.departmentId ? await prisma.department.findUnique({ where: { id: job.departmentId }, select: { id: true, name: true } }) : null;
    job.organization = job.organizationId ? await prisma.organization.findUnique({ where: { id: job.organizationId }, select: { id: true, name: true, logo: true, website: true, industry: true, size: true } }) : null;

    // Increment public view count (analytics is a Json column -> read-modify-write)
    const analytics = job.analytics || {};
    analytics.publicViews = (analytics.publicViews || 0) + 1;
    await prisma.job.update({ where: { id: job.id }, data: { analytics } });

    // analytics was only fetched for the view-count increment; not part of the response shape
    delete job.analytics;

    res.json(job);
  } catch (error) {
    console.error('Error fetching public job:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Public endpoint to submit job application (no authentication required)
router.post('/public/apply', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      coverLetter,
      jobId,
      cvData,
      source,
      isOrganizationStaff
    } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !jobId) {
      return res.status(400).json({ msg: 'Missing required fields' });
    }

    // Find the job
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Check if job is public and active
    if (!job.isPublic || job.status !== 'active') {
      return res.status(400).json({ msg: 'Job is not accepting public applications' });
    }

    // Create or find candidate
    let candidate = await prisma.candidate.findFirst({ where: { email } });

    if (!candidate) {
      // Create new candidate.
      // NOTE[pg]: `cvData` is not a Candidate column (Mongoose strict mode dropped it);
      // computed for parity but not persisted to avoid a Prisma unknown-field error.
      candidate = await prisma.candidate.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          position: cvData?.personalInfo?.position || '',
          experience: cvData?.experience || '',
          skills: cvData?.skills ? cvData.skills.join(', ') : '',
          education: cvData?.education || '',
          location: cvData?.personalInfo?.location || '',
          source: source || 'public',
          notes: coverLetter || '',
          isInternalCandidate: Boolean(isOrganizationStaff)
        }
      });

      // Create activity notification for all organization members
      try {
        if (job.createdById) {
          await Notification.createCandidateUploadedNotification(job.createdById, candidate);
          console.log(`📢 Public candidate application notifications sent to organization for: ${candidate.firstName} ${candidate.lastName}`);
        }
      } catch (notificationError) {
        console.error(`⚠️ Failed to create notifications for candidate ${candidate._id}:`, notificationError.message);
        // Don't fail candidate creation if notification fails
      }
    } else {
      // Update existing candidate with new information if provided
      const candidateUpdate = {};
      if (phone && !candidate.phone) candidateUpdate.phone = phone;
      if (cvData?.personalInfo?.position && !candidate.position) candidateUpdate.position = cvData.personalInfo.position;
      if (cvData?.experience && !candidate.experience) candidateUpdate.experience = cvData.experience;
      if (cvData?.skills && !candidate.skills) candidateUpdate.skills = cvData.skills.join(', ');
      if (cvData?.education && !candidate.education) candidateUpdate.education = cvData.education;
      if (cvData?.personalInfo?.location && !candidate.location) candidateUpdate.location = cvData.personalInfo.location;
      if (typeof isOrganizationStaff !== 'undefined') {
        candidateUpdate.isInternalCandidate = typeof isOrganizationStaff === 'string'
          ? isOrganizationStaff.toLowerCase() === 'true'
          : Boolean(isOrganizationStaff);
      }

      candidate = await prisma.candidate.update({ where: { id: candidate.id }, data: candidateUpdate });
    }

    const applicantsArr = Array.isArray(job.applicants) ? job.applicants : [];
    job.applicants = applicantsArr;

    // Check if candidate is already applied to this job
    const existingApplication = applicantsArr.find(app =>
      app.candidate && app.candidate.toString() === candidate._id.toString()
    );

    if (existingApplication) {
      return res.status(400).json({ msg: 'You have already applied to this job' });
    }

    // Check if job has reached its candidate apply limit
    if (job.candidateApplyLimit > 0 && job.publicApplicationCount >= job.candidateApplyLimit) {
      return res.status(400).json({
        msg: 'This job has reached its maximum number of applications',
        error: 'APPLICATION_LIMIT_REACHED',
        limit: job.candidateApplyLimit
      });
    }

    // Check if pipeline stages exist
    const firstStage = await prisma.interviewStage.findFirst({
      where: { jobId: job.id, isActive: true },
      orderBy: { order: 'asc' }
    });

    // Build applicant data
    // For public applications, use job's createdBy or organization as changedBy for statusHistory
    const statusHistoryChangedBy = job.createdById || job.organizationId;

    const applicantData = {
      _id: newId(),
      candidate: candidate._id,
      status: 'applied',
      appliedAt: new Date(),
      source: source || 'public',
      notes: coverLetter || 'Applied through public job page',
      statusHistory: [{
        status: 'applied',
        changedBy: statusHistoryChangedBy,
        changedAt: new Date(),
        notes: 'Applied through public job page'
      }]
    };
    
    // If pipeline stages exist, assign the first stage
    if (firstStage) {
      applicantData.currentStage = {
        stageId: firstStage._id,
        stageName: firstStage.name,
        enteredAt: new Date()
      };
      applicantData.stageHistory = [{
        stageId: firstStage._id,
        stageName: firstStage.name,
        enteredAt: new Date()
      }];
    }
    
    // Add candidate to job's applicants array
    job.applicants.push(applicantData);

    // Check if this application fills the job
    const newCount = (job.publicApplicationCount || 0) + 1;
    const isNowFull = job.candidateApplyLimit > 0 && newCount >= job.candidateApplyLimit;

    // Increment public application count (for limit tracking)
    job.publicApplicationCount = newCount;

    // Also update analytics
    if (!job.analytics) job.analytics = {};
    job.analytics.publicApplications = (job.analytics.publicApplications || 0) + 1;
    job.analytics.applications = (job.analytics.applications || 0) + 1;

    await prisma.job.update({ where: { id: job.id }, data: {
      applicants: job.applicants,
      publicApplicationCount: job.publicApplicationCount,
      analytics: job.analytics
    } });

    // Send application confirmation email
    try {
      // Populate job organization for email service
      job.organization = job.organizationId ? await prisma.organization.findUnique({ where: { id: job.organizationId } }) : null;

      const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
      await candidateEmailNotificationService.sendApplicationConfirmationEmail({
        candidate,
        job,
        coverLetter: coverLetter
      });
    } catch (emailError) {
      console.error('❌ Error sending application confirmation email:', emailError);
      // Don't fail the application if email fails
    }

    // Send notification if job just reached limit
    if (isNowFull) {
      try {
        job.organization = job.organizationId ? await prisma.organization.findUnique({ where: { id: job.organizationId } }) : null;
        job.hiringManager = job.hiringManagerId ? await prisma.user.findUnique({ where: { id: job.hiringManagerId } }) : null;
        const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
        await candidateEmailNotificationService.sendJobApplicationLimitReachedEmail({ job });
        console.log(`📧 Sent application limit reached notification for job: ${job.title}`);
      } catch (emailError) {
        console.error('❌ Failed to send limit reached email:', emailError);
        // Don't fail the application if email fails
      }
    }

    res.json({
      success: true,
      msg: 'Application submitted successfully',
      candidate: {
        id: candidate._id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email
      }
    });
  } catch (error) {
    console.error('Error submitting public application:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Job routes - with credits middleware
router.post('/bulk-upload', authMiddleware, requireOrganization, requireCredits('bulkUpload', 'job'), upload.single('jobsFile'), deductCredits, jobController.bulkUploadJobs);
router.post('/', authMiddleware, requireOrganization, requireCredits('createJob', 'job'), deductCredits, jobController.createJob);
router.get('/', authMiddleware, requireOrganization, jobController.getAllJobs);
// Bulk job deletion - place BEFORE dynamic :id routes
router.delete('/bulk', authMiddleware, requireOrganization, jobController.bulkDeleteJobs);
router.get('/:id', authMiddleware, requireOrganization, jobController.getJobById);
router.put('/:id', authMiddleware, requireOrganization, jobController.updateJob);
router.delete('/:id', authMiddleware, requireOrganization, jobController.deleteJob);

// Embedding routes - with credits middleware for AI matching
router.get('/:id/embedding-status', authMiddleware, requireOrganization, jobController.getJobEmbeddingStatus);
router.post('/:id/create-embedding', authMiddleware, requireOrganization, requireCredits('reEmbed', 'job'), deductCredits, jobController.createJobEmbedding);
router.get('/:id/matching-candidates', authMiddleware, requireOrganization, requireCredits('aiMatching', 'matching'), deductCredits, jobController.getMatchingCandidates);
router.get('/:jobId/candidate/:candidateId/explanation', authMiddleware, requireOrganization, jobController.getCandidateExplanation);

// Shortlist routes - IMPORTANT: Specific routes MUST come before generic ones
// Bulk shortlist operations (most specific first)
router.post('/:jobId/shortlist/bulk-move-to-pipeline', authMiddleware, requireOrganization, jobController.bulkMoveShortlistToPipeline);
router.post('/:jobId/shortlist/bulk-remove', authMiddleware, requireOrganization, jobController.bulkRemoveFromShortlist);
router.post('/:jobId/shortlist/bulk', authMiddleware, requireOrganization, jobController.bulkAddCandidatesToShortlist);

// Ranked shortlist
router.get('/:jobId/shortlist/rank', authMiddleware, requireOrganization, jobController.getRankedShortlist);
router.delete('/:jobId/shortlist-ranking', authMiddleware, requireOrganization, jobController.clearShortlistRanking);

// Single candidate operations
router.patch('/:jobId/shortlist/:candidateId/status', authMiddleware, requireOrganization, jobController.updateShortlistCandidateStatus);
router.delete('/:jobId/shortlist/:candidateId', authMiddleware, requireOrganization, jobController.removeCandidateFromShortlist);

// Generic shortlist operations (most generic last)
router.post('/:jobId/shortlist', authMiddleware, requireOrganization, jobController.addCandidateToShortlist);
router.get('/:jobId/shortlist', authMiddleware, requireOrganization, jobController.getShortlist);

// Public shortlist route for job applications
router.post('/public/:jobId/shortlist', jobController.addCandidateToShortlist);

// Interview Questions Routes - with credits for AI generation
router.post('/:jobId/interview-questions', authMiddleware, requireOrganization, jobController.createInterviewQuestion);
router.get('/:jobId/interview-questions', authMiddleware, requireOrganization, jobController.getInterviewQuestions);
router.get('/:jobId/interview-questions/stats', authMiddleware, requireOrganization, jobController.getInterviewQuestionsStats);
router.post('/:jobId/interview-questions/generate', authMiddleware, requireOrganization, requireCredits('generateQuestions', 'question'), deductCredits, jobController.generateInterviewQuestions);
router.post('/:jobId/interview-questions/generate-optimized', authMiddleware, requireOrganization, requireCredits('generateQuestions', 'question'), deductCredits, jobController.generateOptimizedInterviewQuestions);
router.post('/:jobId/interview-questions/bulk', authMiddleware, requireOrganization, jobController.bulkCreateInterviewQuestions);
router.get('/interview-questions/:questionId', authMiddleware, requireOrganization, jobController.getInterviewQuestion);
router.put('/interview-questions/:questionId', authMiddleware, requireOrganization, jobController.updateInterviewQuestion);
router.delete('/interview-questions/:questionId', authMiddleware, requireOrganization, jobController.deleteInterviewQuestion);
router.get('/interview-questions/:questionId/analyze-quality', authMiddleware, requireOrganization, jobController.analyzeInterviewQuestionQuality);
router.post('/interview-questions/:questionId/feedback', authMiddleware, requireOrganization, jobController.submitInterviewQuestionFeedback);
router.get('/:jobId/interview-questions/performance-insights', authMiddleware, requireOrganization, jobController.getInterviewQuestionsPerformanceInsights);

// New Pipeline Management Routes
router.post('/:jobId/applicants', authMiddleware, requireOrganization, jobController.addCandidateToJobPipeline);
router.get('/:jobId/pipeline/detailed', authMiddleware, requireOrganization, jobController.getDetailedPipeline);
router.get('/:jobId/pipeline/export/excel', authMiddleware, requireOrganization, jobController.exportPipelineExcelReport);
router.get('/:jobId/pipeline/analytics', authMiddleware, requireOrganization, jobController.getPipelineAnalytics);
router.post('/:jobId/candidates/:candidateId/advance', authMiddleware, requireOrganization, jobController.advanceCandidateToStage);
router.post('/:jobId/candidates/:candidateId/keep-in-view', authMiddleware, requireOrganization, jobController.keepCandidateInView);
router.get('/:jobId/pipeline/stage-analytics', authMiddleware, requireOrganization, jobController.getStageAnalytics);
router.put('/:jobId/candidates/:candidateId/stages/:stageId/result', authMiddleware, requireOrganization, jobController.updateStageResult);
router.post('/:jobId/candidates/:candidateId/stages/:stageId/schedule-interview', authMiddleware, requireOrganization, jobController.scheduleInterview);
router.delete('/:jobId/candidates/:candidateId', authMiddleware, requireOrganization, jobController.removeCandidateFromPipeline);
router.post('/:jobId/pipeline/bulk-move', authMiddleware, requireOrganization, jobController.bulkMoveCandidates);
router.post('/:jobId/pipeline/bulk-keep-in-view', authMiddleware, requireOrganization, jobController.bulkKeepCandidatesInView);

// Stage Template Routes
router.post('/:jobId/save-as-template', authMiddleware, requireOrganization, jobController.saveStagesAsTemplate);
router.post('/:jobId/apply-template', authMiddleware, requireOrganization, jobController.applyTemplate);

// Feedback Routes
router.get('/:jobId/all-feedback', authMiddleware, requireOrganization, jobController.getAllJobFeedback);
router.get('/:jobId/feedback-leaderboard', authMiddleware, requireOrganization, jobController.getFeedbackLeaderboard);

// Feedback Form Configuration Routes
const feedbackFormController = require('../controllers/feedbackFormController');
router.get('/:jobId/feedback-form-config', authMiddleware, requireOrganization, feedbackFormController.getJobFeedbackConfig);
router.put('/:jobId/feedback-form-config', authMiddleware, requireOrganization, feedbackFormController.updateJobFeedbackConfig);
router.get('/:jobId/feedback-form-preview', authMiddleware, requireOrganization, feedbackFormController.getJobFeedbackFormPreview);

// AI Match Cache Routes
router.post('/:jobId/invalidate-ai-cache', authMiddleware, requireOrganization, jobController.invalidateAICache);
router.get('/:jobId/ai-cache-stats', authMiddleware, requireOrganization, jobController.getAICacheStats);

// Admin/Fix Routes
router.post('/admin/fix-public-counts', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    
    // Find all public jobs for this organization
    const publicJobs = await prisma.job.findMany({
      where: { organizationId, isPublic: true }
    });

    let fixed = 0;
    let skipped = 0;
    const results = [];

    for (const job of publicJobs) {
      // Count applicants with 'public' source
      const applicantsArr = Array.isArray(job.applicants) ? job.applicants : [];
      const publicApplicants = applicantsArr.filter(app =>
        app.source === 'public' ||
        (app.statusHistory && app.statusHistory.some(h => h.notes?.includes('public') || h.notes?.includes('Public')))
      );

      const actualCount = publicApplicants.length;
      const currentCount = job.publicApplicationCount || 0;

      if (actualCount !== currentCount) {
        job.publicApplicationCount = actualCount;
        await prisma.job.update({ where: { id: job.id }, data: { publicApplicationCount: actualCount } });

        results.push({
          jobId: job._id,
          title: job.title,
          oldCount: currentCount,
          newCount: actualCount,
          fixed: true
        });
        fixed++;
      } else {
        skipped++;
      }
    }
    
    res.json({
      success: true,
      message: `Fixed ${fixed} jobs, ${skipped} were already correct`,
      totalJobs: publicJobs.length,
      fixed,
      skipped,
      results
    });
  } catch (error) {
    console.error('Error fixing public counts:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fix public application counts',
      error: error.message 
    });
  }
});

module.exports = router; 
