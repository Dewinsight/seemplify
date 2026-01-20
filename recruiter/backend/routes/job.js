const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');
const multer = require('multer');
const path = require('path');
const Job = require('../models/Job');
const Notification = require('../models/Notification');
const User = require('../models/User');

// Screening questions routes
const screeningQuestionsRouter = require('./screeningQuestions');

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

// Apply authentication middleware
router.use(authMiddleware);

// Screening questions routes
router.use('/jobs/:id', screeningQuestionsRouter);
  try {
    const {
      search,
      location,
      department,
      type,
      remote,
      company,
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
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { requirements: { $regex: search, $options: 'i' } },
        { skills: { $regex: search, $options: 'i' } }
      ];
    }

    // Location filter (comma-separated values)
    if (location) {
      const locations = location.split(',').map(l => l.trim());
      query.location = { $in: locations };
    }

    // Department filter (comma-separated values)
    if (department) {
      const departmentNames = department.split(',').map(d => d.trim());
      const Department = require('../models/Department');
      const departmentIds = await Department.find({ name: { $in: departmentNames } }).select('_id');
      query.department = { $in: departmentIds.map(d => d._id) };
    }

    // Type filter (comma-separated values)
    if (type) {
      const types = type.split(',').map(t => t.trim());
      query.type = { $in: types };
    }

    // Remote filter
    if (remote === 'true') {
      query.remote = true;
    }

    // Company filter (organization IDs)
    if (company) {
      const companies = company.split(',').map(c => c.trim());
      query.organization = { $in: companies };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sort options
    const sortOptions = {};
    sortOptions[sort] = order === 'asc' ? 1 : -1;

    // Execute query
    const jobs = await Job.find(query)
      .populate('organization', 'name logo website industry size')
      .populate('department', 'name')
      .select(
        'title department location type level description requirements ' +
        'skills experience education salary benefits remote openings ' +
        'applicationDeadline createdAt'
      )
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Job.countDocuments(query);

    // Get unique filter options (for dropdown lists)
    // Fetch each job individually and populate, skipping ones with errors
    const allPublicJobsRaw = await Job.find({ isPublic: true, status: 'active' })
      .select('location department type organization')
      .lean();

    console.log('[Filters] Fetched', allPublicJobsRaw.length, 'public jobs');

    // Populate departments manually to handle invalid ObjectIds gracefully
    const Department = require('../models/Department');
    const allPublicJobs = [];
    
    for (const job of allPublicJobsRaw) {
      const jobCopy = { ...job };
      
      // Populate organization
      if (job.organization) {
        try {
          const Organization = require('../models/Organization');
          const org = await Organization.findById(job.organization).select('name').lean();
          if (org) jobCopy.organization = org;
        } catch (e) {
          console.warn('[Filters] Invalid organization for job:', job._id);
        }
      }
      
      // Populate department
      if (job.department) {
        try {
          const dept = await Department.findById(job.department).select('name').lean();
          if (dept) {
            jobCopy.department = dept;
          } else {
            console.warn('[Filters] Department not found for job:', job._id, 'deptId:', job.department);
          }
        } catch (e) {
          console.warn('[Filters] Invalid department ObjectId for job:', job._id, 'value:', job.department);
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
    
    const job = await Job.findOne({ 
      _id: id,
      isPublic: true,
      status: 'active'
    }).select(
      'title department location type level description requirements responsibilities ' +
      'skills experience education salary benefits remote openings applicationDeadline ' +
      'publicSlug publicUrl createdAt organization candidateApplyLimit publicApplicationCount'
    ).populate('department', 'name')
     .populate('organization', 'name logo website industry size');

    if (!job) {
      return res.status(404).json({ msg: 'Public job not found' });
    }

    // Increment public view count
    await Job.findByIdAndUpdate(job._id, {
      $inc: { 'analytics.publicViews': 1 }
    });

    res.json(job);
  } catch (error) {
    console.error('Error fetching public job:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Internal recruitment endpoints (no authentication for viewing/applying)
// Get internal job by ID
router.get('/internal/:jobId', jobController.getInternalJobById);

// Submit internal application
router.post('/internal/:jobId/apply', jobController.submitInternalApplication);

// Internal recruitment management endpoints (authenticated)
// Enable internal recruitment for a job
router.post('/:jobId/internal/enable', authMiddleware, requireOrganization, jobController.enableInternalRecruitment);

// Disable internal recruitment for a job
router.post('/:jobId/internal/disable', authMiddleware, requireOrganization, jobController.disableInternalRecruitment);

// Public endpoint to submit job application (no authentication required)
router.post('/public/apply', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, coverLetter, jobId, cvData, source } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !jobId) {
      return res.status(400).json({ msg: 'Missing required fields' });
    }

    // Find the job
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Check if job is public and active
    if (!job.isPublic || job.status !== 'active') {
      return res.status(400).json({ msg: 'Job is not accepting public applications' });
    }

    // Create or find candidate
    const Candidate = require('../models/Candidate');
    let candidate = await Candidate.findOne({ email });
    
    if (!candidate) {
      // Create new candidate
      candidate = new Candidate({
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
        // Store parsed CV data
        cvData: {
          resumeText: cvData?.resumeText || '',
          summary: cvData?.summary || '',
          strengths: cvData?.strengths || [],
          parseSuccess: cvData?.parseSuccess || false,
          aiSuccess: cvData?.aiSuccess || false
        }
      });
      
      await candidate.save();

      // Create activity notification for all organization members
      try {
        if (job.createdBy) {
          await Notification.createCandidateUploadedNotification(job.createdBy, candidate);
          console.log(`📢 Public candidate application notifications sent to organization for: ${candidate.firstName} ${candidate.lastName}`);
        }
      } catch (notificationError) {
        console.error(`⚠️ Failed to create notifications for candidate ${candidate._id}:`, notificationError.message);
        // Don't fail candidate creation if notification fails
      }
    } else {
      // Update existing candidate with new information if provided
      if (phone && !candidate.phone) candidate.phone = phone;
      if (cvData?.personalInfo?.position && !candidate.position) candidate.position = cvData.personalInfo.position;
      if (cvData?.experience && !candidate.experience) candidate.experience = cvData.experience;
      if (cvData?.skills && !candidate.skills) candidate.skills = cvData.skills.join(', ');
      if (cvData?.education && !candidate.education) candidate.education = cvData.education;
      if (cvData?.personalInfo?.location && !candidate.location) candidate.location = cvData.personalInfo.location;
      
      await candidate.save();
    }

    // Check if candidate is already applied to this job
    const existingApplication = job.applicants.find(app => 
      app.candidate.toString() === candidate._id.toString()
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
    const InterviewStage = require('../models/InterviewStage');
    const firstStage = await InterviewStage.findOne({ 
      jobId: job._id, 
      isActive: true 
    }).sort('order');
    
    // Build applicant data
    // For public applications, use job's createdBy or organization as changedBy for statusHistory
    const statusHistoryChangedBy = job.createdBy || job.organization;
    
    const applicantData = {
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
      }],
      // Save screening question answers if provided
      screeningAnswers: req.body.screeningAnswers ? req.body.screeningAnswers.map(answer => ({
        questionId: answer.questionId,
        answer: answer.answer,
        answeredAt: new Date()
      })) : []
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

    await job.save();

    // Send application confirmation email
    try {
      // Populate job organization for email service
      await job.populate('organization');
      
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
        await job.populate(['organization', 'hiringManager']);
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
router.get('/:jobId/pipeline/analytics', authMiddleware, requireOrganization, jobController.getPipelineAnalytics);
router.post('/:jobId/candidates/:candidateId/advance', authMiddleware, requireOrganization, jobController.advanceCandidateToStage);
router.get('/:jobId/pipeline/stage-analytics', authMiddleware, requireOrganization, jobController.getStageAnalytics);
router.put('/:jobId/candidates/:candidateId/stages/:stageId/result', authMiddleware, requireOrganization, jobController.updateStageResult);
router.post('/:jobId/candidates/:candidateId/stages/:stageId/schedule-interview', authMiddleware, requireOrganization, jobController.scheduleInterview);
router.delete('/:jobId/candidates/:candidateId', authMiddleware, requireOrganization, jobController.removeCandidateFromPipeline);
router.post('/:jobId/pipeline/bulk-move', authMiddleware, requireOrganization, jobController.bulkMoveCandidates);

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
    const publicJobs = await Job.find({ 
      organization: organizationId,
      isPublic: true 
    });
    
    let fixed = 0;
    let skipped = 0;
    const results = [];
    
    for (const job of publicJobs) {
      // Count applicants with 'public' source
      const publicApplicants = job.applicants.filter(app => 
        app.source === 'public' || 
        (app.statusHistory && app.statusHistory.some(h => h.notes?.includes('public') || h.notes?.includes('Public')))
      );
      
      const actualCount = publicApplicants.length;
      const currentCount = job.publicApplicationCount || 0;
      
      if (actualCount !== currentCount) {
        job.publicApplicationCount = actualCount;
        await job.save();
        
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
