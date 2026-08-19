const Candidate = require('../models/Candidate');
const crypto = require('crypto');
const Notification = require('../models/Notification');
const fs = require('fs');
const util = require('util');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
// Import the new services
const CVParsingService = require('../services/cvParsingService');
const CloudinaryUploadService = require('../services/cloudinaryUploadService');
const embeddingService = require('../services/embeddingService');
const gptAnalysisService = require('../services/gptAnalysisService');
const websocketService = require('../services/websocketService');
const RetryHelper = require('../utils/retryHelper');
const { decodeObjectHtmlEntities } = require('../utils/htmlDecode');
const { CHATGPT_MODEL } = require('../config/aiRuntimeCatalog');
const publicApplicationCapability = require('../services/publicApplicationCapabilityService');

// Promisify fs.unlink for deleting temporary files
const unlinkAsync = util.promisify(fs.unlink);

// Initialize services
const cvParsingService = new CVParsingService();
const cloudinaryUploadService = new CloudinaryUploadService();

// Helper function to create embedding for candidate with retry
const createCandidateEmbedding = async (candidate, waitForCompletion = false) => {
  const embeddingOperation = async () => {
    await embeddingService.createCandidateEmbedding(candidate);
    // Update candidate to mark as embedded
    await Candidate.findByIdAndUpdate(candidate._id, {
      isEmbedded: true,
      embeddingCreatedAt: new Date()
    });
    console.log(`✅ Embedding created for candidate: ${candidate._id}`);
    return true;
  };

  if (waitForCompletion) {
    // If we need to wait for embedding, use retry logic
    try {
      return await RetryHelper.withRetry(embeddingOperation, {
        maxRetries: 3,
        delay: 2000,
        backoffMultiplier: 2,
        operation: `Embedding for candidate ${candidate._id}`
      });
    } catch (error) {
      console.error(`💥 Failed to create embedding after retries for candidate ${candidate._id}:`, error);
      throw error;
    }
  } else {
    // Async embedding - don't wait, don't throw
    embeddingOperation().catch(error => {
      console.error(`❌ Failed to create embedding for candidate ${candidate._id}:`, error);
    });
  }
};


exports.uploadAndCreateCandidate = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const fileType = req.file.mimetype;

  try {
    console.log("🚀 Starting PARALLEL CV processing with retry logic...");
    console.log('CV upload processing started');

    // ⚡ PARALLEL EXECUTION with retry: Run both services simultaneously
    const uploadWithRetry = async () => {
      return await RetryHelper.withRetry(
        () => cloudinaryUploadService.uploadFile(filePath, fileType),
        {
          maxRetries: 3,
          delay: 1000,
          operation: 'Cloudinary upload'
        }
      );
    };

    const parseWithRetry = async () => {
      return await RetryHelper.withRetry(
        () => cvParsingService.parseAndAnalyze(filePath, fileType),
        {
          maxRetries: 3,
          delay: 1000,
          operation: 'CV parsing'
        }
      );
    };

    const [cloudinaryResult, cvParsingResult] = await Promise.all([
      uploadWithRetry(),
      parseWithRetry()
    ]);

    console.log("✅ Both services completed with retry support!");
    console.log('📊 Cloudinary result:', {
      success: cloudinaryResult.success,
      resumeUrl: cloudinaryResult.resumeUrl,
      publicId: cloudinaryResult.publicId
    });

    // ✅ MONITORING: Enhanced CV parsing metrics
    const parsingMetrics = {
      success: cvParsingResult.success,
      parseSuccess: cvParsingResult.parseSuccess,
      aiSuccess: cvParsingResult.aiSuccess,
      fieldsExtracted: Object.keys(cvParsingResult.extractedFields || {}).length,
      textLength: cvParsingResult.resumeText?.length || 0,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      hasMinimalData: cvParsingResult.resumeText?.length >= 50,
      extractedName: !!(cvParsingResult.extractedFields?.firstName && cvParsingResult.extractedFields?.lastName),
      extractedEmail: !!cvParsingResult.extractedFields?.email
    };

    console.log('📊 CV Processing Metrics:', parsingMetrics);

    // Log warning if parsing quality is low
    if (parsingMetrics.textLength < 100 && parsingMetrics.textLength > 0) {
      console.warn('⚠️ Low text extraction - possible scanned PDF or poor quality file');
    }

    if (!parsingMetrics.extractedName || !parsingMetrics.extractedEmail) {
      console.warn('⚠️ Missing critical candidate information in extraction');
    }

    // Check if both operations were successful
    if (!cloudinaryResult.success) {
      throw new Error(`Managed storage upload failed after retries: ${cloudinaryResult.error}`);
    }

    // ✅ CRITICAL FIX: Prevent candidate creation with insufficient data
    if (!cvParsingResult.success) {
      // Use the service's detailed error message if available (e.g. image-based CV)
      throw new Error(cvParsingResult.error || 'Could not extract text from CV');
    }

    // ✅ CRITICAL FIX: Validate we have sufficient text to prevent hallucinations
    if (!cvParsingResult.parseSuccess || !cvParsingResult.resumeText || cvParsingResult.resumeText.length < 50) {
      throw new Error('IMAGE_BASED_CV: Do NOT use image-based or scanned CVs — we cannot extract text from them. Please upload a text-based PDF or DOCX file with selectable text, or enter your information manually. Ensure the email in your CV is correct — a wrong email can cause issues.');
    }

    // Extract results and fix PDF URLs for Free Plan
    let resumeUrl = cloudinaryResult.resumeUrl;

    // 🔧 FIX: Generate accessible PDF URL for Free Plan limitations
    if (fileType === 'application/pdf' && (cloudinaryResult.storageProvider || 'cloudinary') === 'cloudinary') {
      console.log('📄 Generating accessible PDF URL for Free Plan...');
      try {
        resumeUrl = cloudinaryUploadService.getAccessiblePdfUrl(cloudinaryResult.publicId);
      } catch (urlError) {
        console.warn('⚠️ Could not generate accessible PDF URL, using original:', urlError.message);
        // Keep original URL as fallback
      }
    }

    const resumeText = cvParsingResult.resumeText || '';
    const extractedFields = cvParsingResult.extractedFields || {};
    const aiAnalysis = cvParsingResult.aiAnalysis || {
      summary: "AI analysis unavailable",
      strengths: [],
      potentialFlags: []
    };

    console.log(`🔍 Text extracted: ${resumeText.length} characters`);
    console.log(`🤖 AI analysis success: ${cvParsingResult.aiSuccess}`);

    // Get organization ID - for public uploads, require jobId and get org from job
    let organizationId = req.user?.currentOrganization;

    if (!organizationId && req.body.jobId) {
      // For public applications, get organization from the job being applied to
      const Job = require('../models/Job');
      const job = await Job.findById(req.body.jobId).select('organization');
      if (job) {
        organizationId = job.organization;
      }
    }

    if (!organizationId) {
      return res.status(400).json({
        msg: 'Organization required. For public applications, please provide a jobId.',
        error: 'Missing organization context'
      });
    }

    // Validate that we have essential data
    if (!resumeUrl) {
      throw new Error('Resume URL is missing - upload failed');
    }

    // Ensure we have at least minimal candidate information
    const hasMinimalInfo = (extractedFields.firstName && extractedFields.lastName) ||
      (req.body.firstName && req.body.lastName) ||
      resumeText.length > 100; // At least some text was extracted

    if (!hasMinimalInfo) {
      console.warn('⚠️ Minimal candidate information not available, but proceeding with defaults');
    }

    // Create Candidate Data with enhanced validation
    console.log('📝 Preparing candidate data...');
    console.log('Organization ID:', organizationId);
    console.log('Extracted fields:', {
      firstName: extractedFields.firstName,
      lastName: extractedFields.lastName,
      email: extractedFields.email
    });

    const candidateData = {
      firstName: extractedFields.firstName || req.body.firstName || 'PARSING_FAILED',
      lastName: extractedFields.lastName || req.body.lastName || 'REVIEW_REQUIRED',
      email: extractedFields.email || req.body.email || `failed-parse-${Date.now()}@placeholder.com`,
      phone: extractedFields.phone || req.body.phone || 'Not provided',
      location: extractedFields.location || req.body.location || 'Not specified',
      position: req.body.position || extractedFields.position || 'Position TBD', // Prioritize form input
      experience: extractedFields.experience || req.body.experience || 'See resume',
      education: extractedFields.education || req.body.education || 'See resume',
      skills: Array.isArray(extractedFields.skills)
        ? extractedFields.skills.join(', ')
        : (extractedFields.skills || req.body.skills || 'See resume'),
      resumeUrl,
      resumeText: resumeText || '', // Ensure it's at least an empty string
      coverLetter: req.body.coverLetter || '',
      status: 'New',
      source: 'Uploaded CV',
      organization: organizationId,
      createdBy: req.user?.id || null,
      jobAppliedFor: req.body.jobId || null, // Link to the job if provided
      // Store Cloudinary metadata
      cloudinaryPublicId: cloudinaryResult.publicId,
      resumeStorageProvider: cloudinaryResult.storageProvider || 'cloudinary',
      resumeStorageKey: cloudinaryResult.storageKey || cloudinaryResult.publicId,
      resumeStorageContainer: cloudinaryResult.storageContainer || null,
      resumeStorageResourceType: cloudinaryResult.resourceType,
      cloudinaryResourceType: cloudinaryResult.resourceType,
      // Store AI analysis results
      parsedData: extractedFields || {},
      aiAnalysis: aiAnalysis || {},
      ...(cvParsingResult.workExperience ? { workExperience: cvParsingResult.workExperience } : {}),

      // Store complete structured data for comprehensive candidate profiles
      educationHistory: extractedFields.educationHistory || [],
      certifications: extractedFields.certifications || [],
      languages: extractedFields.languages || [],
      awards: extractedFields.awards || [],
      projects: extractedFields.projects || [],
      publications: extractedFields.publications || [],
      volunteerWork: extractedFields.volunteerWork || [],
      professionalMemberships: extractedFields.professionalMemberships || [],
      portfolioLinks: extractedFields.portfolioLinks || {},
      additionalSections: extractedFields.additionalSections || {},
      fullCVData: extractedFields.fullCVData || extractedFields || {},

      // Processing metadata
      processingMetadata: {
        uploadSuccess: cloudinaryResult.success,
        parseSuccess: cvParsingResult.parseSuccess || false,
        aiSuccess: cvParsingResult.aiSuccess || false,
        fileSize: req.file.size,
        originalName: req.file.originalname,
        processedAt: new Date(),
        hasMinimalInfo: hasMinimalInfo,
        // Add counts for data completeness tracking
        educationCount: (extractedFields.educationHistory || []).length,
        certificationsCount: (extractedFields.certifications || []).length,
        languagesCount: (extractedFields.languages || []).length,
        awardsCount: (extractedFields.awards || []).length,
        projectsCount: (extractedFields.projects || []).length,
        publicationsCount: (extractedFields.publications || []).length
      }
    };

    console.log('💾 Candidate data prepared:', {
      firstName: candidateData.firstName,
      lastName: candidateData.lastName,
      email: candidateData.email,
      organization: candidateData.organization
    });

    // Save candidate to database with retry
    let newCandidate;
    try {
      console.log('💾 Attempting to save candidate to database...');

      const saveOperation = async () => {
        const candidate = new Candidate(candidateData);
        console.log('📝 Candidate model created, calling save()...');
        await candidate.save();
        console.log('✅ Candidate.save() completed');
        return candidate;
      };

      newCandidate = await RetryHelper.withRetry(saveOperation, {
        maxRetries: 3,
        delay: 1000,
        operation: 'Database save for candidate'
      });

      console.log(`✅ Candidate created successfully: ${newCandidate.firstName} ${newCandidate.lastName} (ID: ${newCandidate._id})`);
    } catch (saveError) {
      console.error('💥 Failed to save candidate after retries:', saveError);
      console.error('Error stack:', saveError.stack);
      throw new Error(`Database error: Could not save candidate - ${saveError.message}`);
    }

    // Handle public job application credit deduction
    if (req.body.jobId) {
      try {
        const Job = require('../models/Job');
        const Organization = require('../models/Organization');
        const Plan = require('../models/Plan');

        const job = await Job.findById(req.body.jobId);

        if (job && job.isPublic) {
          console.log(`🌐 Candidate applied to public job: ${job.title}`);

          // Check if job has reached its application limit - HARD FAIL
          if (job.candidateApplyLimit > 0 && job.publicApplicationCount >= job.candidateApplyLimit) {
            console.warn(`⚠️ Job "${job.title}" has reached its application limit (${job.candidateApplyLimit})`);
            // Don't add to job, but candidate is already created, so continue
          } else {
            // Get upload candidate cost
            const organization = await Organization.findById(organizationId);
            const plan = await Plan.findOne({ code: organization.subscription?.plan });
            const uploadCost = plan?.credits?.creditCosts?.uploadCandidate || 3;

            // Check if job has enough reserved credits
            const creditsNeeded = uploadCost;
            const creditsAvailable = job.reservedCredits - (job.publicApplicationCount * uploadCost);

            if (creditsAvailable >= creditsNeeded) {
              // Check if this application fills the job
              const newCount = (job.publicApplicationCount || 0) + 1;
              const isNowFull = job.candidateApplyLimit > 0 && newCount >= job.candidateApplyLimit;

              // Deduct from reserved credits by incrementing application count
              job.publicApplicationCount = newCount;

              // NOTE: Candidate is NOT added to job.applicants here
              // They will be added to job.shortlist when the application form is submitted
              // This prevents the "Candidate already in pipeline" error when applying

              await job.save();

              const creditsUsed = job.publicApplicationCount * uploadCost;
              const creditsRemaining = job.reservedCredits - creditsUsed;

              console.log(`💳 Deducted ${creditsNeeded} credits from public job's reserved pool`);
              console.log(`   Reserved: ${job.reservedCredits}, Used: ${creditsUsed}, Remaining: ${creditsRemaining}`);
              console.log(`   Applications: ${job.publicApplicationCount}/${job.candidateApplyLimit}`);

              // Send notification if job just reached limit
              if (isNowFull) {
                try {
                  await job.populate(['organization', 'hiringManager']);
                  const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
                  await candidateEmailNotificationService.sendJobApplicationLimitReachedEmail({ job });
                  console.log(`📧 Sent application limit reached notification for job: ${job.title}`);
                } catch (emailError) {
                  console.error('❌ Failed to send limit reached email:', emailError);
                }
              }
            } else {
              console.warn(`⚠️ Insufficient reserved credits for public job "${job.title}"`);
              console.warn(`   Needed: ${creditsNeeded}, Available: ${creditsAvailable}`);
            }
          }
        }
      } catch (publicJobError) {
        console.error(`⚠️ Error handling public job application:`, publicJobError);
        // Don't fail candidate creation if public job handling fails
      }
    }

    // Create activity notification for all organization members
    try {
      if (req.user?.id) {
        await Notification.createCandidateUploadedNotification(req.user.id, newCandidate);
        console.log(`📢 Candidate upload notifications sent to organization for: ${newCandidate.firstName} ${newCandidate.lastName}`);
      }
    } catch (notificationError) {
      console.error(`⚠️ Failed to create notifications for candidate ${newCandidate._id}:`, notificationError.message);
      // Don't fail candidate creation if notification fails
    }

    // 🔔 Notify GPT cache system of new candidate
    gptAnalysisService.cache.onCandidateAdded(newCandidate._id);

    // 📡 Real-time notification via WebSocket (if available)
    try {
      if (websocketService && websocketService.broadcast) {
        websocketService.broadcast('candidate-added', {
          candidateId: newCandidate._id,
          candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
          message: 'New candidate available for matching',
          timestamp: new Date().toISOString()
        });
      }
    } catch (wsError) {
      console.warn('⚠️ WebSocket notification failed:', wsError.message);
      // Don't fail the request if WebSocket is unavailable
    }

    // Create embedding with retry and wait for completion
    let embeddingSuccess = false;
    try {
      await createCandidateEmbedding(newCandidate, true); // Wait for completion
      embeddingSuccess = true;
      console.log(`✅ Embedding successfully created for candidate ${newCandidate._id}`);
    } catch (embeddingError) {
      console.error(`⚠️ Embedding failed but candidate was created: ${embeddingError.message}`);
      // Don't fail the entire request if embedding fails
      // We can retry embedding later
    }

    const responseData = {
      msg: 'Candidate created successfully from CV',
      candidate: newCandidate,
      processingResults: {
        cloudinaryUpload: cloudinaryResult.success,
        cvParsing: cvParsingResult.parseSuccess,
        aiAnalysis: cvParsingResult.aiSuccess,
        textExtracted: resumeText.length > 0,
        fieldsExtracted: Object.keys(extractedFields).length,
        embeddingCreated: embeddingSuccess
      }
    };

    console.log('📤 Sending response to client:', {
      status: 201,
      candidateId: newCandidate._id,
      candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
      processingResultsKeys: Object.keys(responseData.processingResults)
    });

    res.status(201).json(responseData);

  } catch (error) {
    console.error('❌ Error in parallel CV processing:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // ✅ Send the actual error message to frontend so users see helpful error text
    res.status(500).json({
      msg: error.message || 'Server error during CV processing.',
      error: error.message,
      details: error.message
    });
  } finally {
    // Clean up the uploaded file from the server
    if (filePath) {
      try {
        await unlinkAsync(filePath);
        console.log('🧹 Temporary file cleaned up');
      } catch (unlinkErr) {
        console.error('⚠️ Error deleting temporary file:', unlinkErr);
      }
    }
  }
};

exports.createCandidateManually = async (req, res) => {
  // Decode HTML entities from request body before saving
  const decodedBody = decodeObjectHtmlEntities(req.body);

  const {
    firstName,
    lastName,
    email,
    phone,
    location,
    position,
    experience,
    education,
    skills,
    coverLetter,
    status,
    source,
  } = decodedBody;

  try {
    const candidate = new Candidate({
      firstName,
      lastName,
      email,
      phone,
      location,
      position,
      experience,
      education,
      skills,
      coverLetter,
      status,
      source,
      organization: req.user.currentOrganization,
      createdBy: req.user.id,
    });

    await candidate.save();

    // 🔔 Notify GPT cache system of new candidate
    gptAnalysisService.cache.onCandidateAdded(candidate._id);

    // 📡 Real-time notification via WebSocket (if available)
    try {
      if (websocketService && websocketService.broadcast) {
        websocketService.broadcast('candidate-added', {
          candidateId: candidate._id,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          message: 'New candidate manually added',
          timestamp: new Date().toISOString()
        });
      }
    } catch (wsError) {
      console.warn('⚠️ WebSocket notification failed:', wsError.message);
      // Don't fail the request if WebSocket is unavailable
    }

    // Create embedding asynchronously (don't wait for it)
    createCandidateEmbedding(candidate);

    res.status(201).json({ msg: 'Candidate created successfully', candidate });

  } catch (error) {
    console.error('Error creating candidate manually:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// @desc    Create a candidate directly from a public job-application form,
//          before/without any CV parsing. Position/experience/education are
//          schema-required but unknown at this point, so they get the same
//          placeholder values the CV pipeline uses until/unless a background
//          CV upload later enriches this record.
exports.createPublicCandidate = async (req, res) => {
  const decodedBody = decodeObjectHtmlEntities(req.body);
  const {
    firstName,
    lastName,
    email,
    phone,
    jobId,
    isOrganizationStaff,
    coverLetter,
  } = decodedBody;

  try {
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ msg: 'firstName, lastName, email and phone are required' });
    }

    const Job = require('../models/Job');
    const publicApplicationCapacityService = require('../services/publicApplicationCapacityService');
    const job = await Job.findById(jobId)
      .select('_id title organization isPublic status candidateApplyLimit publicApplicationCount reservedCredits publicApplicationCreditUnitCost')
      .lean();
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }
    if (!job.isPublic || job.status !== 'active') {
      return res.status(403).json({ msg: 'This job is not accepting public applications', code: 'PUBLIC_JOB_NOT_PUBLIC' });
    }
    const Organization = require('../models/Organization');
    const activeOrganization = await Organization.exists({
      _id: job.organization,
      isActive: { $ne: false },
      erasureState: { $ne: 'tombstoned' }
    });
    if (!activeOrganization) {
      return res.status(403).json({
        msg: 'This organization is not accepting public applications',
        code: 'PUBLIC_JOB_NOT_PUBLIC'
      });
    }
    const organizationCvWriteFence = require('../services/organizationCvWriteFenceService');
    const publicApplicationFence = await organizationCvWriteFence.acquire(
      job.organization,
      'public-application'
    );
    const stopFenceHeartbeat = organizationCvWriteFence.startHeartbeat(publicApplicationFence);
    let fenceReleased = false;
    const originalJson = res.json.bind(res);
    res.json = async function fencedJson(body) {
      if (!fenceReleased) {
        fenceReleased = true;
        stopFenceHeartbeat();
        await organizationCvWriteFence.release(publicApplicationFence).catch(() => {});
      }
      return originalJson(body);
    };
    const renewPublicApplicationFence = () => (
      organizationCvWriteFence.renew(publicApplicationFence)
    );
    await renewPublicApplicationFence();

    const suppliedKey = String(req.get?.('Idempotency-Key') || '').trim().slice(0, 200);
    if (!suppliedKey) {
      return res.status(400).json({
        msg: 'An Idempotency-Key is required for public applications',
        code: 'PUBLIC_APPLICATION_IDEMPOTENCY_KEY_REQUIRED'
      });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      coverLetter: String(coverLetter || ''),
      isOrganizationStaff: Boolean(isOrganizationStaff)
    })).digest('hex');
    const publicApplicationKey = crypto
      .createHash('sha256')
      .update(`${job._id}:email:${normalizedEmail}`)
      .digest('hex');
    const publicApplicationRequestKey = crypto
      .createHash('sha256')
      .update(`${job._id}:request:${suppliedKey}`)
      .digest('hex');
    const deterministicId = new (require('mongoose').Types.ObjectId)(
      crypto.createHash('sha256')
        .update(`public-candidate:${job.organization}:${job._id}:${publicApplicationKey}`)
        .digest('hex')
      .slice(0, 24)
    );
    const commitApplication = async (candidate) => {
      await renewPublicApplicationFence();
      const commitStartedAt = new Date();
      const committing = await Candidate.updateOne(
        {
          _id: candidate._id,
          organization: job.organization,
          deletionState: { $ne: 'tombstoned' },
          $or: [
            { publicApplicationCommitState: { $in: ['provisional', 'committing'] } },
            { publicApplicationCommitState: { $exists: false } }
          ]
        },
        {
          $set: {
            publicApplicationCommitState: 'committing',
            publicApplicationCommitStartedAt: commitStartedAt
          },
          // Clear the TTL before changing Job capacity. A crash can now leave
          // only a hidden, repairable `committing` row, never delete a
          // shortlist-backed accepted applicant.
          $unset: { publicApplicationProvisionalExpiresAt: 1 }
        }
      );
      if (!Number(committing.matchedCount || committing.n || 0)) {
        const alreadyCommitted = await Candidate.exists({
          _id: candidate._id,
          organization: job.organization,
          publicApplicationCommitState: 'committed',
          deletionState: { $ne: 'tombstoned' }
        });
        if (!alreadyCommitted) {
          const stateError = new Error('Public application is no longer available');
          stateError.code = 'PUBLIC_APPLICATION_STATE_INVALID';
          stateError.statusCode = 409;
          throw stateError;
        }
      }

      let capacity;
      try {
        await renewPublicApplicationFence();
        capacity = await publicApplicationCapacityService.commit({
          jobId: job._id,
          organizationId: job.organization,
          candidateId: candidate._id,
          processingJobId: candidate._id,
          processingJobPublicId: `public-application:${candidate._id}`
        });
      } catch (error) {
        const jobCommitted = await Job.exists({
          _id: job._id,
          organization: job.organization,
          'shortlist.candidate': candidate._id
        });
        if (!jobCommitted) {
          await Candidate.updateOne(
            {
              _id: candidate._id,
              organization: job.organization,
              publicApplicationCommitState: 'committing',
              publicApplicationCommitStartedAt: commitStartedAt
            },
            {
              $set: {
                publicApplicationCommitState: 'provisional',
                publicApplicationProvisionalExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
              },
              $unset: { publicApplicationCommitStartedAt: 1 }
            }
          );
        }
        throw error;
      }
      await renewPublicApplicationFence();
      await Candidate.updateOne(
        {
          _id: candidate._id,
          organization: job.organization,
          deletionState: { $ne: 'tombstoned' }
        },
        {
          $set: { publicApplicationCommitState: 'committed' },
          $unset: {
            publicApplicationProvisionalExpiresAt: 1,
            publicApplicationCommitStartedAt: 1
          }
        }
      );
      if (!capacity.duplicate) {
        try {
          const notificationJob = await Job.findById(job._id);
          await notificationJob?.populate([
            { path: 'organization' },
            { path: 'department', select: 'name' }
          ]);
          if (notificationJob) {
            const candidateEmailNotificationService = require('../services/candidateEmailNotificationService');
            await candidateEmailNotificationService.sendApplicationConfirmationEmail({
              candidate,
              job: notificationJob
            });
            if (capacity.limitReached) {
              await candidateEmailNotificationService.sendJobApplicationLimitReachedEmail({
                job: notificationJob
              });
            }
          }
        } catch (emailError) {
          console.error('Public application confirmation could not be sent:', emailError.message);
        }
      }
      return capacity;
    };

    const existing = await Candidate.findOne({
      organization: job.organization,
      jobAppliedFor: job._id,
      $or: [
        { publicApplicationKey },
        ...(publicApplicationRequestKey ? [{ publicApplicationRequestKey }] : [])
      ]
    }).select(
      '+publicApplicationKey +publicApplicationRequestKey '
      + '+publicApplicationRequestFingerprint +publicApplicationCapabilityHash '
      + '+publicApplicationCapabilityExpiresAt'
    );
    if (existing) {
      const sameRequest = existing.publicApplicationRequestKey === publicApplicationRequestKey;
      if (!sameRequest) {
        // Do not reveal whether this email already applied, nor return its
        // candidate identifier to a caller holding a fresh request key.
        return res.status(202).json({
          msg: 'If this application was already submitted, it remains on file',
          duplicate: true,
          accessGranted: false
        });
      }
      if (
        existing.email !== normalizedEmail
        || existing.publicApplicationRequestFingerprint !== requestFingerprint
      ) {
        return res.status(409).json({
          msg: 'This application key was already used for different application details',
          code: 'PUBLIC_APPLICATION_IDEMPOTENCY_MISMATCH'
        });
      }
      const capability = publicApplicationCapability.issue({
        organizationId: job.organization,
        jobId: job._id,
        candidateId: existing._id,
        requestKey: publicApplicationRequestKey
      });
      await renewPublicApplicationFence();
      await Candidate.updateOne(
        { _id: existing._id, publicApplicationRequestKey },
        {
          $set: {
            publicApplicationCapabilityHash: capability.hash,
            publicApplicationCapabilityExpiresAt: capability.expiresAt
          }
        }
      );
      const capacity = await commitApplication(existing);
      return res.status(200).json({
        msg: 'Candidate application already received',
        duplicate: true,
        candidate: {
          _id: existing._id,
          firstName: existing.firstName,
          lastName: existing.lastName,
          email: existing.email,
          phone: existing.phone,
        },
        applicationCapability: {
          token: capability.token,
          expiresAt: capability.expiresAt
        },
        applicationCount: capacity.applicationCount,
        limitReached: capacity.limitReached
      });
    }

    const reconciliation = await publicApplicationCapacityService.reconcileInflatedCount({
      jobId: job._id,
      organizationId: job.organization
    });
    const applicationCount = Number(
      reconciliation?.applicationCount ?? job.publicApplicationCount ?? 0
    );
    const candidateLimit = Number(job.candidateApplyLimit || 0);
    if (candidateLimit <= 0 || applicationCount >= candidateLimit) {
      return res.status(409).json({
        msg: 'This job has reached its maximum number of public applications',
        code: 'PUBLIC_APPLICATION_LIMIT_REACHED'
      });
    }
    const unitCost = Number(
      job.publicApplicationCreditUnitCost
      || await publicApplicationCapacityService.uploadCandidateCost()
      || 0
    );
    if ((applicationCount + 1) * unitCost > Number(job.reservedCredits || 0)) {
      return res.status(409).json({
        msg: 'This job has no reserved public-application credits remaining',
        code: 'PUBLIC_APPLICATION_CREDITS_EXHAUSTED'
      });
    }

    const capability = publicApplicationCapability.issue({
      organizationId: job.organization,
      jobId: job._id,
      candidateId: deterministicId,
      requestKey: publicApplicationRequestKey
    });
    const candidatePayload = {
      _id: deterministicId,
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      position: job.title || 'Position TBD',
      experience: 'See CV',
      education: 'See CV',
      coverLetter: coverLetter || '',
      status: 'New',
      source: 'public',
      isInternalCandidate: Boolean(isOrganizationStaff),
      organization: job.organization,
      jobAppliedFor: job._id,
      publicApplicationKey,
      publicApplicationRequestKey,
      publicApplicationRequestFingerprint: requestFingerprint,
      publicApplicationCapabilityHash: capability.hash,
      publicApplicationCapabilityExpiresAt: capability.expiresAt,
      publicApplicationCommitState: 'provisional',
      publicApplicationProvisionalExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      processingMetadata: {
        cvIngestionState: 'not_received',
        cvProcessingStage: 'received',
        cvProcessingProgress: 0,
        cvProcessingUpdatedAt: new Date(),
        cvRetryEligible: false
      }
    };

    let candidate;
    try {
      await renewPublicApplicationFence();
      candidate = await Candidate.findOneAndUpdate(
        { _id: deterministicId },
        { $setOnInsert: candidatePayload },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
      ).select('+publicApplicationRequestKey +publicApplicationRequestFingerprint');
    } catch (error) {
      if (error?.code !== 11000) throw error;
      candidate = await Candidate.findOne({
        organization: job.organization,
        jobAppliedFor: job._id,
        publicApplicationKey
      }).select('+publicApplicationRequestKey +publicApplicationRequestFingerprint');
      if (!candidate) throw error;
    }

    if (
      candidate.publicApplicationRequestKey !== publicApplicationRequestKey
      || candidate.publicApplicationRequestFingerprint !== requestFingerprint
    ) {
      return res.status(202).json({
        msg: 'If this application was already submitted, it remains on file',
        duplicate: true,
        accessGranted: false
      });
    }

    const capacity = await commitApplication(candidate);

    // Concurrent exact replays converge on one candidate and one currently
    // valid capability. The conditional update makes the returned token own
    // that capability without exposing it to a different request key.
    await Candidate.updateOne(
      { _id: candidate._id, publicApplicationRequestKey },
      {
        $set: {
          publicApplicationCapabilityHash: capability.hash,
          publicApplicationCapabilityExpiresAt: capability.expiresAt
        }
      }
    );
    gptAnalysisService.cache.onCandidateAdded(candidate._id);

    return res.status(201).json({
      msg: 'Candidate created successfully',
      duplicate: false,
      candidate: {
        _id: candidate._id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
      },
      applicationCapability: {
        token: capability.token,
        expiresAt: capability.expiresAt
      },
      applicationCount: capacity.applicationCount,
      limitReached: capacity.limitReached
    });
  } catch (error) {
    console.error('Error creating public candidate:', error);
    const requestedStatus = Number(error?.statusCode);
    const statusCode = requestedStatus >= 400 && requestedStatus < 500 ? requestedStatus : 500;
    return res.status(statusCode).json({
      code: error?.code || 'PUBLIC_APPLICATION_FAILED',
      msg: statusCode < 500 ? error.message : 'Server error'
    });
  }
};

// Check if candidate embedding exists
exports.checkEmbeddingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    console.log(`Checking embedding status for candidate: ${id}`);

    const candidate = await Candidate.findOne({
      _id: id,
      organization: organizationId
    });
    if (!candidate) {
      console.log(`Candidate not found: ${id}`);
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    console.log(`Candidate found, checking vector store for: ${id}`);
    const existsInVectorStore = await embeddingService.checkEmbeddingExists(id);
    console.log(`Vector store check result: ${existsInVectorStore}`);

    const response = {
      candidateId: id,
      isEmbedded: candidate.isEmbedded,
      embeddingCreatedAt: candidate.embeddingCreatedAt,
      existsInVectorStore: existsInVectorStore,
      needsEmbedding: !candidate.isEmbedded || !existsInVectorStore
    };

    console.log(`Embedding status response:`, response);
    res.json(response);
  } catch (error) {
    console.error('Error checking embedding status:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Manually trigger embedding creation
exports.createEmbedding = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;

    const candidate = await Candidate.findOne({
      _id: id,
      organization: organizationId
    });
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Create embedding
    await embeddingService.createCandidateEmbedding(candidate);

    // Update candidate status
    await Candidate.findByIdAndUpdate(id, {
      isEmbedded: true,
      embeddingCreatedAt: new Date()
    });
    await require('../services/aiMatchCacheService').invalidateCandidateCache(id, organizationId);
    gptAnalysisService.cache.onCandidateAdded(id);

    res.json({
      msg: 'Embedding created successfully',
      candidateId: id,
      embeddingCreatedAt: new Date()
    });
  } catch (error) {
    console.error('Error creating embedding manually:', error);
    res.status(500).json({
      msg: 'Failed to create embedding',
      error: error.message
    });
  }
};

exports.exportCandidates = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { status, search } = req.query;

    // reuse the same query logic as getAllCandidates but without pagination
    const query = {
      organization: organizationId,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' }
    };

    if (status) query.status = status;
    if (search) {
      const searchTerms = search.trim().split(/\s+/).filter(term => term.length > 0);
      const searchRegex = new RegExp(searchTerms.join('|'), 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { position: searchRegex },
        { skills: searchRegex },
        { experience: searchRegex },
        { education: searchRegex },
        { location: searchRegex },
        { resumeText: searchRegex },
        { coverLetter: searchRegex },
        { source: searchRegex },
        { status: searchRegex }
      ];
    }

    // Fetch all matching candidates
    const candidates = await Candidate.find(query)
      .populate('createdBy', 'profile.firstName profile.lastName')
      .sort({ createdAt: -1 });

    // Prepare data for Excel
    const XLSX = require('xlsx');
    const workbook = XLSX.utils.book_new();

    // --- Sheet 1: Raw Data ---
    const rawData = candidates.map(c => ({
      'First Name': c.firstName,
      'Last Name': c.lastName,
      'Email': c.email,
      'Phone': c.phone || 'N/A',
      'Location': c.location || 'N/A',
      'Position': c.position || 'N/A',
      'Current Status': c.status,
      'Source': c.source || 'Direct',
      'Experience': c.experience || '',
      'Education': c.education || '',
      'Skills': Array.isArray(c.skills) ? c.skills.join(', ') : c.skills || '',
      'Application Date': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
      'Added By': c.createdBy ? `${c.createdBy.profile?.firstName} ${c.createdBy.profile?.lastName}` : 'System',
      'AI Overall Score': c.aiAnalysis?.overallScore || 'N/A',
      'Resume URL': c.resumeUrl || ''
    }));

    const rawDataSheet = XLSX.utils.json_to_sheet(rawData);
    XLSX.utils.book_append_sheet(workbook, rawDataSheet, 'Raw Data');

    // --- Sheet 2: Analytics ---

    // Check if pipeline stages are defined via pipelineService (helper)
    // For now, we'll just aggregate by status/source from the candidates list
    // Ideally we would fetch the pipeline config to get proper stage names if 'status' is just internal enum

    const candidatesByStatus = candidates.reduce((acc, c) => {
      const s = c.status || 'Unknown';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const candidatesBySource = candidates.reduce((acc, c) => {
      const s = c.source || 'Unknown';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const candidatesByPosition = candidates.reduce((acc, c) => {
      const p = c.position || 'Unknown';
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});

    const analyticsData = [
      ['Total Candidates', candidates.length],
      ['', ''], // Spacer
      ['Candidates by Stage', 'Count'],
      ...Object.entries(candidatesByStatus),
      ['', ''], // Spacer
      ['Candidates by Source', 'Count'],
      ...Object.entries(candidatesBySource),
      ['', ''], // Spacer
      ['Candidates by Position', 'Count'],
      ...Object.entries(candidatesByPosition)
    ];

    const analyticsSheet = XLSX.utils.aoa_to_sheet(analyticsData);
    XLSX.utils.book_append_sheet(workbook, analyticsSheet, 'Analytics');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Send response
    res.setHeader('Content-Disposition', 'attachment; filename="candidates_export.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (error) {
    console.error('Error exporting candidates:', error);
    res.status(500).json({ msg: 'Server error exporting candidates', error: error.message });
  }
};


exports.getAllCandidates = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const { page = 1, limit = 10, status, search } = req.query;

    const query = {
      organization: organizationId,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' }
    };

    if (status) query.status = status;
    if (search) {
      // Create flexible search pattern - split search terms for better matching
      const searchTerms = search.trim().split(/\s+/).filter(term => term.length > 0);

      // Create a single regex that matches any of the search terms
      const searchRegex = new RegExp(searchTerms.join('|'), 'i');

      // Log for debugging
      console.log('Search query:', search);
      console.log('Search terms:', searchTerms);
      console.log('Search regex:', searchRegex);

      query.$or = [
        // Basic info
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },

        // Professional info - NOW POSITION SEARCH WILL WORK!
        { position: searchRegex },
        { skills: searchRegex },
        { experience: searchRegex },
        { education: searchRegex },
        { location: searchRegex },

        // Resume content
        { resumeText: searchRegex },
        { coverLetter: searchRegex },

        // Source and status
        { source: searchRegex },
        { status: searchRegex }
      ];
    }

    const candidates = await Candidate.find(query)
      .populate('createdBy', 'profile.firstName profile.lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Candidate.countDocuments(query);

    res.json({
      candidates,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Error fetching candidates:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.getCandidateById = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const candidate = await Candidate.findOne({
      _id: req.params.id,
      organization: organizationId,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' }
    });

    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }
    res.json(candidate);
  } catch (error) {
    console.error('Error fetching candidate by ID:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error' });
  }
};

exports.updateCandidate = async (req, res) => {
  // Decode HTML entities from request body before saving
  const decodedBody = decodeObjectHtmlEntities(req.body);

  const {
    firstName,
    lastName,
    email,
    phone,
    location,
    position,
    experience,
    education,
    skills,
    coverLetter,
    status,
    source,
    isInternalCandidate,
    isOrganizationStaff,
    employeeId,
    notes // Expecting notes to be an array or an object to push
  } = decodedBody;

  const candidateFields = {};
  if (firstName) candidateFields.firstName = firstName;
  if (lastName) candidateFields.lastName = lastName;
  if (email) candidateFields.email = email;
  if (phone) candidateFields.phone = phone;
  if (location) candidateFields.location = location;
  if (position) candidateFields.position = position;
  if (experience) candidateFields.experience = experience;
  if (education) candidateFields.education = education;
  if (skills) candidateFields.skills = skills;
  if (coverLetter) candidateFields.coverLetter = coverLetter;
  if (status) candidateFields.status = status;
  if (source) candidateFields.source = source;
  if (typeof isInternalCandidate === 'boolean') {
    candidateFields.isInternalCandidate = isInternalCandidate;
  } else if (typeof isOrganizationStaff === 'boolean') {
    // Alias used by public job application form.
    candidateFields.isInternalCandidate = isOrganizationStaff;
  }
  if (employeeId !== undefined) candidateFields.employeeId = employeeId;
  // if (req.user) candidateFields.updatedBy = req.user.id; // If using authentication
  candidateFields.updatedAt = Date.now();

  try {
    // Handle both authenticated and public route updates
    const organizationId = req.user?.currentOrganization;

    // Build query based on whether we have organization context
    const query = { _id: req.params.id };
    query.publicApplicationCommitState = { $nin: ['provisional', 'committing'] };
    query.deletionState = { $ne: 'tombstoned' };
    if (organizationId) {
      query.organization = organizationId;
    }

    let candidate = await Candidate.findOne(query);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Handle notes update: push new note or update existing
    if (notes) {
      if (Array.isArray(notes)) { // If a full array of notes is sent
        candidateFields.notes = notes;
      } else {
        if (typeof notes === 'object' && notes.note) { // If a single note object is sent to be added
          candidate.notes.push(notes); // Mongoose handles pushing to the array
          // No need to assign to candidateFields.notes here if just pushing
        }
      }
    }


    candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      { $set: candidateFields },
      { new: true, runValidators: true }
    );

    // If notes were pushed directly, save the candidate document
    if (typeof notes === 'object' && notes.note) {
      await candidate.save();
    }

    // Invalidate AI match cache if candidate profile changed
    const cacheInvalidatingFields = [
      'firstName', 'lastName', 'experience', 'skills', 'position', 'education',
      'location', 'coverLetter', 'resumeText', 'workExperience', 'certifications', 'aiAnalysis'
    ];
    const shouldInvalidateCache = cacheInvalidatingFields.some(field => candidateFields[field] !== undefined);

    if (shouldInvalidateCache) {
      const aiMatchCacheService = require('../services/aiMatchCacheService');
      try {
        const invalidation = await aiMatchCacheService.invalidateCandidateCache(candidate._id, organizationId);
        console.log(`🗑️ Auto-invalidated ${invalidation.deletedCount} AI match cache entries for updated candidate`);
        await Candidate.findByIdAndUpdate(candidate._id, {
          isEmbedded: false,
          embeddingCreatedAt: null
        });
        await createCandidateEmbedding(candidate, true);
        candidate.isEmbedded = true;
        candidate.embeddingCreatedAt = new Date();
      } catch (embeddingError) {
        console.error(`Failed to refresh candidate embedding for ${candidate._id}:`, embeddingError.message);
      }
    }

    res.json({ msg: 'Candidate updated successfully', candidate });
  } catch (error) {
    console.error('Error updating candidate:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

exports.deleteCandidate = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const candidate = await Candidate.findOne({
      _id: req.params.id,
      organization: organizationId
    });
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Cancellation, CV/GridFS/Cloudinary removal, embedding removal, and audit
    // redaction are durable outbox-backed operations. They are registered
    // before the candidate record is removed, so transient provider failures
    // cannot strand PII without a retry target.
    const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
    const erasure = await cvAnalysisQueue.eraseCandidateProcessingData(
      organizationId,
      [candidate._id]
    );
    await require('../services/aiMatchCacheService')
      .invalidateCandidateCache(candidate._id, organizationId);

    res.status(erasure.candidates[0]?.hardDeleted === true ? 200 : 202).json({
      msg: erasure.candidates[0]?.hardDeleted === true
        ? 'Candidate removed successfully'
        : 'Candidate deletion accepted; final cleanup is pending',
      deletedCandidate: {
        id: req.params.id,
        erasureScheduled: true,
        pending: erasure.candidates[0]?.hardDeleted !== true,
        hardDeleted: erasure.candidates[0]?.hardDeleted === true
      }
    });
  } catch (error) {
    console.error('Error deleting candidate:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    if (['CV_ERASURE_REGISTRATION_FAILED', 'CV_ERASURE_TOMBSTONE_FAILED'].includes(error.code)) {
      return res.status(503).json({
        code: error.code,
        msg: error.message
      });
    }
    res.status(error.statusCode || 500).json({ msg: 'Server error' });
  }
};

// Bulk delete candidates
exports.bulkDeleteCandidates = async (req, res) => {
  try {
    const { candidateIds } = req.body || {};
    const organizationId = req.user.currentOrganization;

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ msg: 'candidateIds must be a non-empty array' });
    }

    const results = [];
    const failures = [];

    // Process deletions sequentially or in limited parallel to avoid DB pressure
    for (const id of candidateIds) {
      try {
        const candidate = await Candidate.findOne({ _id: id, organization: organizationId });
        if (!candidate) {
          failures.push({ id, error: 'Candidate not found or access denied' });
          continue;
        }

        const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
        const erasure = await cvAnalysisQueue.eraseCandidateProcessingData(
          organizationId,
          [candidate._id]
        );
        await require('../services/aiMatchCacheService')
          .invalidateCandidateCache(candidate._id, organizationId);
        results.push({
          id,
          success: true,
          hardDeleted: erasure.candidates[0]?.hardDeleted === true
        });
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
    console.error('Error bulk deleting candidates:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

function buildCandidateProfilePdf(candidate) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text(`${candidate.firstName} ${candidate.lastName}`, { underline: true });
      doc.moveDown(0.5);

      const field = (label, value) => {
        doc.fontSize(11).fillColor('#555555').text(label, { continued: false });
        doc.fontSize(12).fillColor('#000000').text(value || 'N/A');
        doc.moveDown(0.6);
      };

      field('Email', candidate.email);
      field('Phone', candidate.phone);
      field('Location', candidate.location);
      field('Position Applied For', candidate.position);
      field('Status', candidate.status);
      field('Source', candidate.source);
      field('Experience', candidate.experience);
      field('Education', candidate.education);
      field('Skills', Array.isArray(candidate.skills) ? candidate.skills.join(', ') : candidate.skills);
      field('Application Date', candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : '');
      if (candidate.coverLetter) field('Cover Letter', candidate.coverLetter);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Bulk download: one ZIP with a subfolder per selected candidate, each
// containing a generated profile.pdf and (if present) their CV file.
exports.bulkDownloadCandidates = async (req, res) => {
  try {
    const { candidateIds } = req.body || {};
    const organizationId = req.user.currentOrganization;

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ msg: 'candidateIds must be a non-empty array' });
    }

    const candidates = await Candidate.find({
      _id: { $in: candidateIds },
      organization: organizationId,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' }
    });

    if (candidates.length === 0) {
      return res.status(404).json({ msg: 'No accessible candidates found for the given IDs' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="candidates.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => {
      console.error('Error building candidates ZIP:', error);
      if (!res.headersSent) {
        res.status(500).json({ msg: 'Failed to build ZIP archive' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    const usedFolderNames = new Set();
    for (const candidate of candidates) {
      let folderName = `${candidate.lastName || 'candidate'}_${candidate.firstName || ''}`.trim().replace(/[^a-z0-9_-]/gi, '_');
      if (usedFolderNames.has(folderName)) {
        folderName = `${folderName}_${String(candidate._id).slice(-6)}`;
      }
      usedFolderNames.add(folderName);

      try {
        const profilePdf = await buildCandidateProfilePdf(candidate);
        archive.append(profilePdf, { name: `${folderName}/profile.pdf` });
      } catch (error) {
        console.warn(`⚠️ Failed to generate profile PDF for candidate ${candidate._id}:`, error.message);
      }

      if (candidate.cloudinaryPublicId) {
        try {
          const deliveryType = candidate.cloudinaryDeliveryType || 'upload';
          const downloadUrl = candidate.resumeStorageProvider === 'azure-blob'
            ? candidate.resumeUrl
            : cloudinaryUploadService.getDownloadUrl(candidate.cloudinaryPublicId, deliveryType);
          const response = await fetch(downloadUrl);
          if (!response.ok) throw new Error(`CV download failed: ${response.status}`);
          const cvBuffer = Buffer.from(await response.arrayBuffer());
          const extension = (candidate.resumeUrl || '').split('.').pop()?.split('?')[0] || 'pdf';
          archive.append(cvBuffer, { name: `${folderName}/cv.${extension}` });
        } catch (error) {
          console.warn(`⚠️ Failed to fetch CV for candidate ${candidate._id}:`, error.message);
        }
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Error bulk downloading candidates:', error);
    if (!res.headersSent) {
      res.status(500).json({ msg: 'Server error', error: error.message });
    } else {
      res.end();
    }
  }
};

// 🔧 FIX: Generate accessible PDF URL for existing candidates
exports.getAccessibleResumeUrl = async (req, res) => {
  try {
    // Handle both authenticated and public access
    const organizationId = req.user?.currentOrganization;

    // Build query based on whether we have organization context
    const query = {
      _id: req.params.id,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' }
    };
    if (organizationId) {
      query.organization = organizationId;
    }

    const candidate = await Candidate.findOne(query);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    if (!candidate.cloudinaryPublicId) {
      return res.status(400).json({
        msg: 'No managed resume asset found for this candidate'
      });
    }

    // Public feedback never receives a provider URL. Return revocable proxy
    // links that re-run interview capability verification on every view or
    // download, so cancellation/expiry closes already-generated links.
    if (req.publicFeedbackInterview) {
      const token = req.get('X-Public-Feedback-Token') || req.query?.accessToken;
      if (!token) return res.status(404).json({ msg: 'Resume access was not found' });
      const origin = `${req.protocol}://${req.get('host')}`;
      const route = `/api/candidates/public/interviews/${encodeURIComponent(String(req.params.interviewId))}`
        + `/candidates/${encodeURIComponent(String(candidate._id))}/resume`;
      const capabilityQuery = `accessToken=${encodeURIComponent(token)}`;
      res.setHeader?.('Cache-Control', 'private, no-store');
      res.setHeader?.('Referrer-Policy', 'no-referrer');
      return res.json({
        msg: 'Capability-bound resume proxy URLs generated successfully',
        resumeAvailable: true,
        accessible: true,
        viewUrl: `${origin}${route}?mode=view&${capabilityQuery}`,
        downloadUrl: `${origin}${route}?mode=download&${capabilityQuery}`,
        candidateId: candidate._id
      });
    }

    if (candidate.resumeStorageProvider === 'azure-blob') {
      return res.json({
        msg: 'Azure resume URL generated successfully',
        originalUrl: candidate.resumeUrl,
        accessibleUrl: candidate.resumeUrl,
        viewUrl: candidate.resumeUrl,
        downloadUrl: candidate.resumeUrl,
        previewUrl: candidate.resumeUrl,
        candidateId: candidate._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`
      });
    }

    // Check if it's a PDF that needs accessible URL
    const isPdf = candidate.resumeUrl && candidate.resumeUrl.includes('.pdf');

    if (!isPdf) {
      return res.json({
        msg: 'Resume is not a PDF, original URL should work',
        resumeUrl: candidate.resumeUrl,
        accessible: true
      });
    }

    // Generate accessible URL for PDF
    console.log(`📄 Generating accessible URL for candidate: ${candidate.firstName} ${candidate.lastName}`);
    const deliveryType = candidate.cloudinaryDeliveryType || 'upload';
    const accessibleUrl = cloudinaryUploadService.getAccessiblePdfUrl(candidate.cloudinaryPublicId, deliveryType);
    const downloadUrl = cloudinaryUploadService.getDownloadUrl(candidate.cloudinaryPublicId, deliveryType);
    const previewUrl = cloudinaryUploadService.getPdfPreviewUrl(candidate.cloudinaryPublicId, deliveryType);

    res.json({
      msg: 'Accessible URLs generated successfully',
      originalUrl: candidate.resumeUrl,
      accessibleUrl,
      viewUrl: accessibleUrl,
      downloadUrl,
      previewUrl,
      candidateId: candidate._id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`
    });

  } catch (error) {
    console.error('Error generating accessible URL:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

exports.streamPublicFeedbackResume = async (req, res) => {
  try {
    const interview = req.publicFeedbackInterview;
    const candidateQuery = {
      _id: req.params.id,
      publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
      deletionState: { $ne: 'tombstoned' },
      cloudinaryPublicId: { $exists: true, $ne: '' }
    };
    if (interview?.organizationId) candidateQuery.organization = interview.organizationId;
    const candidate = await Candidate.findOne(candidateQuery).select(
      '_id cloudinaryPublicId cloudinaryResourceType cloudinaryDeliveryType resumeUrl resumeStorageProvider resumeStorageKey resumeStorageContainer resumeStorageResourceType'
    );
    if (!candidate || String(interview?.candidateId || '') !== String(candidate._id)) {
      return res.status(404).json({ msg: 'Resume access was not found' });
    }

    const deliveryType = candidate.cloudinaryDeliveryType || 'authenticated';
    const providerUrl = candidate.resumeStorageProvider === 'azure-blob'
      ? candidate.resumeUrl
      : req.query?.mode === 'download'
        ? cloudinaryUploadService.getDownloadUrl(candidate.cloudinaryPublicId, deliveryType)
        : cloudinaryUploadService.getAccessiblePdfUrl(candidate.cloudinaryPublicId, deliveryType);
    const upstream = await fetch(providerUrl);
    if (!upstream.ok) {
      return res.status(502).json({ msg: 'Resume asset is temporarily unavailable' });
    }
    const content = Buffer.from(await upstream.arrayBuffer());
    const disposition = req.query?.mode === 'download' ? 'attachment' : 'inline';
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(content.length));
    res.setHeader('Content-Disposition', `${disposition}; filename="candidate-resume"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.send(content);
  } catch (error) {
    console.error('Error proxying public feedback resume:', error.message);
    return res.status(502).json({ msg: 'Resume asset is temporarily unavailable' });
  }
};

// Manually trigger embedding recreation/refresh
exports.refreshEmbedding = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;

    const candidate = await Candidate.findOne({
      _id: id,
      organization: organizationId
    });
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    console.log(`🔄 Refreshing embedding for candidate: ${candidate.firstName} ${candidate.lastName}`);

    // Delete existing embedding if it exists
    try {
      await embeddingService.deleteEmbedding(id);
      console.log('✅ Old embedding deleted');
    } catch (deleteError) {
      console.log('ℹ️ No existing embedding to delete');
    }

    // Create new embedding with enhanced metadata
    await embeddingService.createCandidateEmbedding(candidate);

    // Update candidate status
    await Candidate.findByIdAndUpdate(id, {
      isEmbedded: true,
      embeddingCreatedAt: new Date()
    });
    await require('../services/aiMatchCacheService').invalidateCandidateCache(id, organizationId);
    gptAnalysisService.cache.onCandidateAdded(id);

    res.json({
      msg: 'AI matching profile refreshed successfully',
      candidateId: id,
      embeddingCreatedAt: new Date(),
      candidateName: `${candidate.firstName} ${candidate.lastName}`
    });
  } catch (error) {
    console.error('Error refreshing embedding:', error);
    res.status(500).json({
      msg: 'Failed to refresh embedding',
      error: error.message
    });
  }
};

// Get AI cache statistics for monitoring
exports.getCacheStats = async (req, res) => {
  try {
    const stats = gptAnalysisService.getCacheStats();
    res.json({
      msg: 'Cache statistics retrieved successfully',
      stats: {
        hitRate: Math.round(stats.hitRate * 100) / 100, // Round to 2 decimal places
        totalRequests: stats.totalRequests,
        cacheSize: stats.cacheSize,
        candidatesTracked: stats.candidatesTracked,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Get AI matching system status and configuration
exports.getGPTStatus = async (req, res) => {
  try {
    const activeModel = CHATGPT_MODEL;
    const activeToggle = process.env.ENABLE_LLM_MATCHING ?? process.env.ENABLE_GPT_MATCHING;

    res.json({
      msg: 'AI matching system status retrieved successfully',
      status: {
        isEnabled: gptAnalysisService.isEnabled,
        cacheSize: gptAnalysisService.cache.cache.size,
        candidatesTracked: gptAnalysisService.cache.candidateTimestamps.size,
        environmentVariable: activeToggle,
        model: activeModel,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting GPT status:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Emergency AI matching toggle (admin only)
exports.toggleGPTSystem = async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ msg: 'Invalid enabled value. Must be true or false.' });
    }

    // Update the service configuration
    gptAnalysisService.isEnabled = enabled;

    console.log(`🔄 AI matching system ${enabled ? 'ENABLED' : 'DISABLED'} via admin toggle`);

    res.json({
      msg: `AI matching system ${enabled ? 'enabled' : 'disabled'} successfully`,
      status: {
        isEnabled: gptAnalysisService.isEnabled,
        previouslyEnabled: !enabled,
        timestamp: new Date().toISOString(),
        note: 'This is a runtime toggle. To persist, set ENABLE_LLM_MATCHING (or ENABLE_GPT_MATCHING for backward compatibility).'
      }
    });
  } catch (error) {
    console.error('Error toggling GPT system:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Add comment to candidate
exports.addComment = async (req, res) => {
  const { note } = req.body;

  if (!note || !note.trim()) {
    return res.status(400).json({ msg: 'Comment content is required' });
  }

  try {
    // Handle both authenticated and public route updates
    const organizationId = req.user?.currentOrganization;

    // Build query based on whether we have organization context
    const query = { _id: req.params.id };
    if (organizationId) {
      query.organization = organizationId;
    }

    let candidate = await Candidate.findOne(query);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Get user details from database
    let userName = 'Anonymous';
    if (req.user?.id) {
      try {
        const User = require('../models/User');
        const user = await User.findById(req.user.id);
        if (user && user.profile) {
          const firstName = user.profile.firstName || '';
          const lastName = user.profile.lastName || '';
          userName = `${firstName} ${lastName}`.trim() || user.email.split('@')[0] || 'Anonymous';
        }
      } catch (userError) {
        console.error('Error fetching user details:', userError);
        // userName remains 'Anonymous'
      }
    }

    // Create new comment object
    const newComment = {
      note: note.trim(),
      date: new Date(),
      user: req.user?.id || null,
      userName: userName
    };

    // Add comment to the notes array
    candidate.notes.push(newComment);
    candidate.updatedAt = new Date();

    // Save the updated candidate
    await candidate.save();

    // Populate user details in the response
    await candidate.populate('notes.user', 'profile.firstName profile.lastName email');

    res.json(candidate);
  } catch (error) {
    console.error('Error adding comment:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Delete comment from candidate
exports.deleteComment = async (req, res) => {
  const { commentId } = req.params;

  try {
    // Handle both authenticated and public route updates
    const organizationId = req.user?.currentOrganization;

    // Build query based on whether we have organization context
    const query = { _id: req.params.id };
    if (organizationId) {
      query.organization = organizationId;
    }

    let candidate = await Candidate.findOne(query);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    // Find the comment index
    const commentIndex = candidate.notes.findIndex(note => note._id.toString() === commentId);
    if (commentIndex === -1) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    // Check if user has permission to delete (comment owner or admin)
    const comment = candidate.notes[commentIndex];
    if (req.user && comment.user && comment.user.toString() !== req.user.id) {
      // For now, allow any authenticated user to delete any comment
      // You can add role-based permissions here later
    }

    // Remove the comment
    candidate.notes.splice(commentIndex, 1);
    candidate.updatedAt = new Date();

    // Save the updated candidate
    await candidate.save();

    // Populate user details in the response
    await candidate.populate('notes.user', 'profile.firstName profile.lastName email');

    res.json(candidate);
  } catch (error) {
    console.error('Error deleting comment:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};
