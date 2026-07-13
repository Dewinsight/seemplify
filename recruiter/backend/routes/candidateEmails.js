const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
const pipelineProgressionService = require('../services/pipelineProgressionService');
const authMiddleware = require('../middleware/authMiddleware');
const { decodeObjectHtmlEntities } = require('../utils/htmlDecode');

/**
 * POST /api/candidate-emails/send-rejection
 * Send rejection email to single candidate
 */
router.post('/send-rejection',
  authMiddleware,
  [
    body('candidateId').isMongoId().withMessage('Invalid candidate ID'),
    body('jobId').isMongoId().withMessage('Invalid job ID'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    body('stage').optional().isString().withMessage('Stage must be a string'),
    body('isShortlistRejection').optional().isBoolean().withMessage('isShortlistRejection must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { candidateId, jobId, reason, stage, isShortlistRejection = false } = req.body;
      const organizationId = req.user?.currentOrganization;
      
      console.log('🔍 BACKEND ROUTE - Rejection email request:', {
        candidateId,
        jobId,
        reason,
        reasonType: typeof reason,
        reasonLength: reason?.length || 0,
        stage,
        isShortlistRejection
      });

      // Build query to ensure job belongs to organization
      const query = { _id: jobId };
      if (organizationId) {
        query.organization = organizationId;
      }

      const job = await Job.findOne(query).populate('organization');
      if (!job) {
        return res.status(404).json({ msg: 'Job not found' });
      }

      const candidate = await Candidate.findById(candidateId);
      if (!candidate) {
        return res.status(404).json({ msg: 'Candidate not found' });
      }

      // If trying to reject from shortlist, check if candidate is already in pipeline
      if (isShortlistRejection) {
        const isInPipeline = job.applicants.some(app => 
          app.candidate.toString() === candidateId
        );
        if (isInPipeline) {
          return res.status(400).json({ 
            msg: 'Cannot reject from shortlist. This candidate is already in the pipeline. Please reject from the pipeline instead.' 
          });
        }
      }

      // Send rejection email (force manual sending)
      const emailResult = await candidateEmailNotificationService.sendRejectionEmail({
        candidate,
        job,
        reason: reason || 'Thank you for your interest in this position',
        stage: stage || 'Application Review',
        isShortlistRejection,
        forceManual: true
      });

      console.log(`📧 Manual rejection email sent to ${candidate.email} by ${req.user.email}`);

      // Update candidate status after sending rejection email
      try {
        if (isShortlistRejection) {
          // Update shortlist status to rejected
          const shortlistItem = job.shortlist.find(item => item.candidate.toString() === candidateId);
          if (shortlistItem && shortlistItem.status !== 'rejected') {
            shortlistItem.status = 'rejected';
            await job.save();
            console.log(`✅ Updated shortlist candidate ${candidateId} status to rejected`);
          }
        } else {
          // Update pipeline status to rejected
          const applicant = job.applicants.find(app => app.candidate._id.toString() === candidateId);
          if (applicant && applicant.status !== 'rejected') {
            await pipelineProgressionService.rejectCandidate(jobId, candidateId, reason || 'Rejected via email', req.user.id);
            console.log(`✅ Updated pipeline candidate ${candidateId} status to rejected`);
          }
        }
      } catch (statusError) {
        console.error('⚠️ Error updating candidate status after rejection email:', statusError);
        // Don't fail the email operation if status update fails
      }

      res.json({
        success: true,
        message: 'Rejection email sent successfully and candidate status updated',
        emailResult,
        candidate: {
          id: candidate._id,
          name: `${candidate.firstName} ${candidate.lastName}`,
          email: candidate.email
        }
      });

    } catch (error) {
      console.error('❌ Error sending rejection email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send rejection email',
        error: error.message
      });
    }
  }
);

/**
 * POST /api/candidate-emails/send-bulk-rejection
 * Send rejection emails to multiple candidates
 */
router.post('/send-bulk-rejection',
  authMiddleware,
  [
    body('candidates').isArray().withMessage('Candidates must be an array'),
    body('candidates.*.candidateId').isMongoId().withMessage('Invalid candidate ID'),
    body('candidates.*.jobId').isMongoId().withMessage('Invalid job ID'),
    body('candidates.*.stage').optional().isString().withMessage('Stage must be a string'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    body('isShortlistRejection').optional().isBoolean().withMessage('isShortlistRejection must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { candidates, reason, isShortlistRejection = false } = req.body;
      const organizationId = req.user?.currentOrganization;

      if (candidates.length === 0) {
        return res.status(400).json({ msg: 'No candidates provided' });
      }

      // Prepare candidate data for bulk email sending
      const candidateEmailData = [];
      const candidateJobMap = new Map(); // Track candidateId -> jobId mapping
      const skippedCandidates = []; // Track candidates that are in pipeline (if trying to reject from shortlist)
      
      for (const candidateData of candidates) {
        const { candidateId, jobId, stage } = candidateData;

        // Build query to ensure job belongs to organization
        const query = { _id: jobId };
        if (organizationId) {
          query.organization = organizationId;
        }

        const job = await Job.findOne(query).populate('organization');
        const candidate = await Candidate.findById(candidateId);

        if (job && candidate) {
          // If trying to reject from shortlist, check if candidate is already in pipeline
          if (isShortlistRejection) {
            const isInPipeline = job.applicants.some(app => 
              app.candidate.toString() === candidateId
            );
            if (isInPipeline) {
              skippedCandidates.push({
                candidateId,
                name: `${candidate.firstName} ${candidate.lastName}`,
                reason: 'Already in pipeline'
              });
              console.log(`⚠️ Skipping candidate ${candidateId} - already in pipeline, cannot reject from shortlist`);
              continue; // Skip this candidate
            }
          }

          candidateEmailData.push({
            candidate,
            job,
            stage: stage || 'Application Review'
          });
          candidateJobMap.set(candidateId, jobId); // Store mapping
        }
      }

      if (candidateEmailData.length === 0) {
        return res.status(404).json({ msg: 'No valid candidates found' });
      }

      // Send bulk rejection emails
      const bulkResult = await candidateEmailNotificationService.sendBulkRejectionEmails(
        candidateEmailData,
        reason || 'Thank you for your interest in this position',
        isShortlistRejection
      );

      console.log(`📧 Bulk rejection emails processed: ${bulkResult.sent} sent, ${bulkResult.failed} failed by ${req.user.email}`);

      // Update candidate statuses after sending bulk rejection emails
      try {
        let statusUpdatedCount = 0;
        for (const candidateData of candidateEmailData) {
          const candidateId = candidateData.candidate._id.toString();
          const jobId = candidateJobMap.get(candidateId);
          
          if (isShortlistRejection) {
            // Update shortlist status to rejected
            const shortlistItem = candidateData.job.shortlist.find(item => item.candidate.toString() === candidateId);
            if (shortlistItem && shortlistItem.status !== 'rejected') {
              shortlistItem.status = 'rejected';
              await candidateData.job.save();
              statusUpdatedCount++;
              console.log(`✅ Updated shortlist status for candidate ${candidateId}`);
            }
          } else {
            // Update pipeline status to rejected - need to reload job to get applicants with full candidate data
            const jobForUpdate = await Job.findById(jobId).populate('applicants.candidate');
            if (jobForUpdate) {
              const applicant = jobForUpdate.applicants.find(app => 
                app.candidate && app.candidate._id.toString() === candidateId
              );
              if (applicant && applicant.status !== 'rejected') {
                await pipelineProgressionService.rejectCandidate(
                  jobId, 
                  candidateId, 
                  reason || 'Rejected via bulk email', 
                  req.user.id
                );
                statusUpdatedCount++;
                console.log(`✅ Updated pipeline status for candidate ${candidateId}`);
              }
            }
          }
        }
        console.log(`✅ Updated ${statusUpdatedCount} candidate statuses to rejected`);
      } catch (statusError) {
        console.error('⚠️ Error updating candidate statuses after bulk rejection emails:', statusError);
        // Don't fail the email operation if status update fails
      }

      res.json({
        success: true,
        message: `Bulk rejection emails processed and candidate statuses updated`,
        results: bulkResult,
        skippedCandidates: skippedCandidates.length > 0 ? skippedCandidates : undefined
      });

    } catch (error) {
      console.error('❌ Error sending bulk rejection emails:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send bulk rejection emails',
        error: error.message
      });
    }
  }
);

/**
 * GET /api/candidate-emails/job/:jobId/email-settings
 * Get email notification settings for a job
 */
router.get('/job/:jobId/email-settings', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const organizationId = req.user?.currentOrganization;

    // Build query to ensure job belongs to organization
    const query = { _id: jobId };
    if (organizationId) {
      query.organization = organizationId;
    }

    const job = await Job.findOne(query).select('emailSettings title');
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    res.json({
      success: true,
      emailSettings: decodeObjectHtmlEntities(job.emailSettings || {}),
      jobTitle: job.title
    });

  } catch (error) {
    console.error('❌ Error getting email settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get email settings',
      error: error.message
    });
  }
});

/**
 * PUT /api/candidate-emails/job/:jobId/email-settings
 * Update email notification settings for a job
 */
router.put('/job/:jobId/email-settings',
  authMiddleware,
  [
    body('enableAdvancementEmails').optional().isBoolean(),
    body('enableRejectionEmails').optional().isBoolean(),
    body('enableShortlistEmails').optional().isBoolean(),
    body('autoSendRejections').optional().isBoolean(),
    body('senderEmail').optional().isEmail().normalizeEmail(),
    body('customTemplates').optional().isObject(),
    body('emailSignature').optional().isString().trim(),
    body('ccEmails').optional().isArray(),
    body('ccEmails.*').optional().isEmail().normalizeEmail(),
    body('bccEmails').optional().isArray(),
    body('bccEmails.*').optional().isEmail().normalizeEmail()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { jobId } = req.params;
      const organizationId = req.user?.currentOrganization;
      const emailSettings = decodeObjectHtmlEntities(req.body || {});
      delete emailSettings.senderName;

      // Build query to ensure job belongs to organization
      const query = { _id: jobId };
      if (organizationId) {
        query.organization = organizationId;
      }

      const job = await Job.findOne(query);
      if (!job) {
        return res.status(404).json({ msg: 'Job not found' });
      }

      // Update email settings without carrying forward the retired senderName field.
      const currentEmailSettings = typeof job.emailSettings?.toObject === 'function'
        ? job.emailSettings.toObject()
        : { ...(job.emailSettings || {}) };
      delete currentEmailSettings.senderName;
      job.emailSettings = {
        ...currentEmailSettings,
        ...emailSettings,
        lastUpdated: new Date(),
        updatedBy: req.user._id
      };

      await job.save();

      console.log(`📧 Email settings updated for job ${job.title} by ${req.user.email}`);

      res.json({
        success: true,
        message: 'Email settings updated successfully',
        emailSettings: decodeObjectHtmlEntities(job.emailSettings)
      });

    } catch (error) {
      console.error('❌ Error updating email settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update email settings',
        error: error.message
      });
    }
  }
);

/**
 * POST /api/candidate-emails/test-email
 * Send a test email to verify configuration
 */
router.post('/test-email',
  authMiddleware,
  [
    body('jobId').isMongoId().withMessage('Invalid job ID'),
    body('testEmail').isEmail().withMessage('Valid test email required'),
    body('templateType').isIn(['advancement', 'shortlist', 'rejection', 'shortlist-rejection']).withMessage('Invalid template type')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { jobId, testEmail, templateType } = req.body;
      const organizationId = req.user?.currentOrganization;

      // Build query to ensure job belongs to organization
      const query = { _id: jobId };
      if (organizationId) {
        query.organization = organizationId;
      }

      const job = await Job.findOne(query).populate('organization');
      if (!job) {
        return res.status(404).json({ msg: 'Job not found' });
      }

      // Create test candidate data
      const testCandidate = {
        firstName: 'Test',
        lastName: 'Candidate',
        email: testEmail,
        _id: 'test-candidate-id'
      };

      // Send test email based on template type
      let emailResult;
      switch (templateType) {
        case 'advancement':
          emailResult = await candidateEmailNotificationService.sendAdvancementEmail({
            candidate: testCandidate,
            job,
            fromStage: { name: 'Phone Screen' },
            toStage: { name: 'Technical Interview', description: 'A comprehensive technical assessment' },
            notes: 'This is a test email'
          });
          break;
        case 'shortlist':
          emailResult = await candidateEmailNotificationService.sendShortlistEmail({
            candidate: testCandidate,
            job
          });
          break;
        case 'rejection':
          emailResult = await candidateEmailNotificationService.sendRejectionEmail({
            candidate: testCandidate,
            job,
            reason: 'This is a test rejection email',
            stage: 'Technical Interview',
            isShortlistRejection: false,
            forceManual: true
          });
          break;
        case 'shortlist-rejection':
          emailResult = await candidateEmailNotificationService.sendRejectionEmail({
            candidate: testCandidate,
            job,
            reason: 'This is a test shortlist rejection email',
            stage: 'Shortlist Review',
            isShortlistRejection: true,
            forceManual: true
          });
          break;
      }

      console.log(`📧 Test ${templateType} email sent to ${testEmail} by ${req.user.email}`);

      res.json({
        success: true,
        message: `Test ${templateType} email sent successfully`,
        emailResult
      });

    } catch (error) {
      console.error('❌ Error sending test email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send test email',
        error: error.message
      });
    }
  }
);

/**
 * GET /api/email-templates/:templateName
 * Serve default email template HTML for editing
 */
router.get('/templates/:templateName', async (req, res) => {
  try {
    const { templateName } = req.params;
    const fs = require('fs').promises;
    const path = require('path');
    
    // Validate template name to prevent directory traversal
    const validTemplates = [
      'rejection-notice',
      'shortlist-rejection',
      'shortlist-congratulations',
      'advancement-congratulations'
    ];
    
    if (!validTemplates.includes(templateName)) {
      return res.status(400).json({ msg: 'Invalid template name' });
    }
    
    const templatePath = path.join(__dirname, '..', 'templates', 'candidate-emails', `${templateName}.hbs`);
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    
    res.setHeader('Content-Type', 'text/html');
    res.send(templateContent);
    
  } catch (error) {
    console.error('Error loading template:', error);
    res.status(500).json({ msg: 'Failed to load template', error: error.message });
  }
});

module.exports = router;
