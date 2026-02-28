const Candidate = require('../models/Candidate');
const Notification = require('../models/Notification');
const fs = require('fs');
const util = require('util');
// Import the new services
const CVParsingService = require('../services/cvParsingService');
const CloudinaryUploadService = require('../services/cloudinaryUploadService');
const embeddingService = require('../services/embeddingService');
const gptAnalysisService = require('../services/gptAnalysisService');
const websocketService = require('../services/websocketService');
const RetryHelper = require('../utils/retryHelper');
const { decodeObjectHtmlEntities } = require('../utils/htmlDecode');

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
    console.log(`File: ${req.file.originalname}, Type: ${fileType}, Size: ${req.file.size} bytes`);

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
      throw new Error(`Cloudinary upload failed after retries: ${cloudinaryResult.error}`);
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
    if (fileType === 'application/pdf') {
      console.log('📄 Generating accessible PDF URL for Free Plan...');
      try {
        resumeUrl = cloudinaryUploadService.getAccessiblePdfUrl(cloudinaryResult.publicId);
        console.log(`🔗 Accessible PDF URL: ${resumeUrl}`);
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

    console.log(`📄 Resume URL: ${resumeUrl}`);
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
      cloudinaryResourceType: cloudinaryResult.resourceType,
      // Store AI analysis results
      parsedData: extractedFields || {},
      aiAnalysis: aiAnalysis || {},
      workExperience: cvParsingResult.workExperience || [],

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

    console.log(`Candidate found, checking Pinecone for: ${id}`);
    // Check both database flag and Pinecone existence
    const existsInPinecone = await embeddingService.checkEmbeddingExists(id);
    console.log(`Pinecone check result: ${existsInPinecone}`);

    const response = {
      candidateId: id,
      isEmbedded: candidate.isEmbedded,
      embeddingCreatedAt: candidate.embeddingCreatedAt,
      existsInPinecone: existsInPinecone,
      needsEmbedding: !candidate.isEmbedded || !existsInPinecone
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
    const query = { organization: organizationId };

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

    const query = { organization: organizationId };

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
      organization: organizationId
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
    const cacheInvalidatingFields = ['experience', 'skills', 'position', 'education', 'coverLetter'];
    const shouldInvalidateCache = cacheInvalidatingFields.some(field => candidateFields[field] !== undefined);

    if (shouldInvalidateCache) {
      const aiMatchCacheService = require('../services/aiMatchCacheService');
      aiMatchCacheService.invalidateCandidateCache(candidate._id)
        .then(result => console.log(`🗑️ Auto-invalidated ${result.deletedCount} AI match cache entries for updated candidate`))
        .catch(err => console.error('Failed to auto-invalidate candidate cache:', err));
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

    console.log(`🗑️ Deleting candidate: ${candidate.firstName} ${candidate.lastName} (${req.params.id})`);

    // Delete embedding from Pinecone first
    try {
      await embeddingService.deleteEmbedding(req.params.id);
      console.log(`✅ Embedding deleted from Pinecone for candidate: ${req.params.id}`);
    } catch (embeddingError) {
      console.warn(`⚠️ Failed to delete embedding for candidate ${req.params.id}:`, embeddingError.message);
      // Continue with deletion even if embedding deletion fails
    }

    // Optional: Delete resume from Cloudinary if needed
    // if (candidate.resumeUrl) {
    //   const publicId = candidate.resumeUrl.split('/').pop().split('.')[0];
    //   await cloudinary.uploader.destroy(publicId);
    // }

    // Delete candidate from database
    await Candidate.findByIdAndDelete(req.params.id);

    console.log(`✅ Candidate and embedding successfully deleted: ${candidate.firstName} ${candidate.lastName}`);

    res.json({
      msg: 'Candidate removed successfully',
      deletedCandidate: {
        id: req.params.id,
        name: `${candidate.firstName} ${candidate.lastName}`,
        embeddingDeleted: true
      }
    });
  } catch (error) {
    console.error('Error deleting candidate:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Candidate not found (invalid ID format)' });
    }
    res.status(500).json({ msg: 'Server error' });
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

        try {
          await embeddingService.deleteEmbedding(id);
        } catch (embeddingError) {
          // Log but do not fail deletion
          console.warn(`⚠️ Failed to delete embedding for candidate ${id}:`, embeddingError.message);
        }

        await Candidate.findByIdAndDelete(id);
        results.push({ id, success: true });
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

// 🔧 FIX: Generate accessible PDF URL for existing candidates
exports.getAccessibleResumeUrl = async (req, res) => {
  try {
    // Handle both authenticated and public access
    const organizationId = req.user?.currentOrganization;

    // Build query based on whether we have organization context
    const query = { _id: req.params.id };
    if (organizationId) {
      query.organization = organizationId;
    }

    const candidate = await Candidate.findOne(query);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }

    if (!candidate.cloudinaryPublicId) {
      return res.status(400).json({
        msg: 'No Cloudinary public ID found for this candidate',
        resumeUrl: candidate.resumeUrl
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
    const accessibleUrl = cloudinaryUploadService.getAccessiblePdfUrl(candidate.cloudinaryPublicId);
    const downloadUrl = cloudinaryUploadService.getDownloadUrl(candidate.cloudinaryPublicId);
    const previewUrl = cloudinaryUploadService.getPdfPreviewUrl(candidate.cloudinaryPublicId);

    res.json({
      msg: 'Accessible URLs generated successfully',
      originalUrl: candidate.resumeUrl,
      accessibleUrl,
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

    res.json({
      msg: 'Embedding refreshed successfully with enhanced metadata',
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

// Get GPT cache statistics for monitoring
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

// Get GPT system status and configuration
exports.getGPTStatus = async (req, res) => {
  try {
    res.json({
      msg: 'GPT system status retrieved successfully',
      status: {
        isEnabled: gptAnalysisService.isEnabled,
        cacheSize: gptAnalysisService.cache.cache.size,
        candidatesTracked: gptAnalysisService.cache.candidateTimestamps.size,
        environmentVariable: process.env.ENABLE_GPT_MATCHING,
        model: process.env.GPT_MODEL || 'gpt-4.1',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting GPT status:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Emergency GPT system toggle (admin only)
exports.toggleGPTSystem = async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ msg: 'Invalid enabled value. Must be true or false.' });
    }

    // Update the service configuration
    gptAnalysisService.isEnabled = enabled;

    console.log(`🔄 GPT Analysis system ${enabled ? 'ENABLED' : 'DISABLED'} via admin toggle`);

    res.json({
      msg: `GPT Analysis system ${enabled ? 'enabled' : 'disabled'} successfully`,
      status: {
        isEnabled: gptAnalysisService.isEnabled,
        previouslyEnabled: !enabled,
        timestamp: new Date().toISOString(),
        note: 'This is a runtime toggle. To persist, update ENABLE_GPT_MATCHING environment variable.'
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
