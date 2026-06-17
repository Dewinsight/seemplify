-- CreateTable
CREATE TABLE "Plan" (
    "id" CHAR(24) NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "billingCycle" TEXT,
    "features" JSONB,
    "limits" JSONB,
    "credits" JSONB,
    "trialDays" INTEGER,
    "isPublished" BOOLEAN DEFAULT true,
    "displayOrder" INTEGER,
    "planType" TEXT,
    "isDefault" BOOLEAN DEFAULT false,
    "isCustom" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPack" (
    "id" CHAR(24) NOT NULL,
    "name" TEXT,
    "code" TEXT,
    "credits" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "description" TEXT,
    "isPopular" BOOLEAN DEFAULT false,
    "isActive" BOOLEAN DEFAULT true,
    "displayOrder" INTEGER,
    "features" TEXT[],
    "bonusCredits" DOUBLE PRECISION,
    "totalCredits" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPurchaseRequest" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "requestedById" CHAR(24),
    "creditPackId" CHAR(24),
    "packDetails" JSONB,
    "status" TEXT,
    "notes" TEXT,
    "reviewedById" CHAR(24),
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "creditsGranted" BOOLEAN DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionRequest" (
    "id" CHAR(24) NOT NULL,
    "requestType" TEXT,
    "userId" CHAR(24),
    "organizationId" CHAR(24),
    "currentPlan" TEXT,
    "requestedPlan" TEXT,
    "status" TEXT,
    "notes" TEXT,
    "adminNotes" TEXT,
    "invoiceDetails" JSONB,
    "approvedById" CHAR(24),
    "approvalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" CHAR(24) NOT NULL,
    "code" TEXT,
    "symbol" TEXT,
    "name" TEXT,
    "locale" TEXT,
    "isSystem" BOOLEAN DEFAULT false,
    "organizationId" CHAR(24),
    "createdById" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NylasAccount" (
    "id" CHAR(24) NOT NULL,
    "name" TEXT,
    "clientId" TEXT,
    "apiKey" TEXT,
    "clientSecret" TEXT,
    "region" TEXT,
    "apiUri" TEXT,
    "redirectUri" TEXT,
    "maxGrants" INTEGER,
    "currentGrantCount" INTEGER,
    "active" BOOLEAN DEFAULT true,
    "verified" BOOLEAN DEFAULT false,
    "isDefault" BOOLEAN DEFAULT false,
    "priority" INTEGER,
    "accountType" TEXT,
    "notes" TEXT,
    "createdById" CHAR(24),
    "lastUsed" TIMESTAMP(3),
    "lastVerified" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NylasAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvite" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "email" TEXT,
    "role" TEXT,
    "token" TEXT,
    "invitedById" CHAR(24),
    "status" TEXT,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" CHAR(24),
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" CHAR(24) NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "experience" TEXT,
    "education" TEXT,
    "skills" TEXT,
    "location" TEXT,
    "resumeUrl" TEXT,
    "resumeText" TEXT,
    "coverLetter" TEXT,
    "status" TEXT,
    "source" TEXT,
    "notes" JSONB,
    "createdBy" CHAR(24),
    "updatedBy" CHAR(24),
    "parsedData" JSONB,
    "aiAnalysis" JSONB,
    "isEmbedded" BOOLEAN DEFAULT false,
    "embeddingCreatedAt" TIMESTAMP(3),
    "workExperience" JSONB,
    "educationHistory" JSONB,
    "certifications" JSONB,
    "languages" JSONB,
    "awards" JSONB,
    "projects" JSONB,
    "publications" JSONB,
    "volunteerWork" JSONB,
    "professionalMemberships" JSONB,
    "portfolioLinks" JSONB,
    "additionalSections" JSONB,
    "fullCVData" JSONB,
    "cloudinaryPublicId" TEXT,
    "cloudinaryResourceType" TEXT,
    "processingMetadata" JSONB,
    "applicationDate" TIMESTAMP(3),
    "interviews" JSONB,
    "jobAppliedForId" CHAR(24),
    "organizationId" CHAR(24),
    "isInternalCandidate" BOOLEAN DEFAULT false,
    "employeeId" TEXT,
    "currentDepartmentId" CHAR(24),
    "hireDate" TIMESTAMP(3),
    "currentPosition" TEXT,
    "managerId" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateList" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "name" TEXT,
    "description" TEXT,
    "source" TEXT,
    "sourceRef" JSONB,
    "entries" JSONB,
    "createdBy" CHAR(24),
    "updatedBy" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningQuestion" (
    "id" CHAR(24) NOT NULL,
    "jobId" CHAR(24),
    "type" TEXT,
    "question" TEXT,
    "description" TEXT,
    "isRequired" BOOLEAN DEFAULT true,
    "order" INTEGER,
    "options" JSONB,
    "condition" JSONB,
    "action" JSONB,
    "isActive" BOOLEAN DEFAULT true,
    "createdBy" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" CHAR(24) NOT NULL,
    "jobId" CHAR(24),
    "candidateId" CHAR(24),
    "interviewerId" CHAR(24),
    "stageId" CHAR(24),
    "stageName" TEXT,
    "stageOrder" INTEGER,
    "interviewRound" INTEGER,
    "nylasEventId" TEXT,
    "nylasGrantId" TEXT,
    "schedulingConfigurationId" TEXT,
    "bookingId" TEXT,
    "title" TEXT,
    "subject" TEXT,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "duration" INTEGER,
    "location" TEXT,
    "meetingLink" TEXT,
    "timezone" TEXT,
    "conferencing" JSONB,
    "participants" JSONB,
    "status" TEXT,
    "missedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "type" TEXT,
    "schedulingSource" TEXT,
    "rescheduleHistory" JSONB,
    "notes" TEXT,
    "feedback" JSONB,
    "structuredFeedback" JSONB,
    "notifications" JSONB,
    "cancellationReason" TEXT,
    "cancelledBy" CHAR(24),
    "webhookStatus" JSONB,
    "notetakerEnabled" BOOLEAN DEFAULT false,
    "notetakerId" TEXT,
    "notetakerType" TEXT,
    "notetakerStatus" TEXT,
    "notetakerError" TEXT,
    "transcript" JSONB,
    "transcriptAvailableAt" TIMESTAMP(3),
    "recordingUrl" TEXT,
    "teamComments" CHAR(24)[],
    "aiInterviewSummary" JSONB,
    "teamFeedbackAnalysis" JSONB,
    "aiAnalysis" JSONB,
    "isMultiCandidate" BOOLEAN DEFAULT false,
    "multiCandidateSessionId" TEXT,
    "multiCandidateOrder" INTEGER,
    "organizationId" CHAR(24),
    "analytics" JSONB,
    "comprehensiveAnalytics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewComment" (
    "id" CHAR(24) NOT NULL,
    "interviewId" CHAR(24),
    "questionId" CHAR(24),
    "stageId" CHAR(24),
    "stageName" TEXT,
    "stageOrder" INTEGER,
    "authorId" CHAR(24),
    "authorName" TEXT,
    "authorRole" TEXT,
    "publicFeedback" JSONB,
    "content" TEXT,
    "commentType" TEXT,
    "rating" JSONB,
    "categories" TEXT[],
    "visibility" TEXT,
    "organization" CHAR(24),
    "isEdited" BOOLEAN DEFAULT false,
    "editHistory" JSONB,
    "reactions" JSONB,
    "parentCommentId" CHAR(24),
    "replies" CHAR(24)[],
    "status" TEXT,
    "aiFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" CHAR(24) NOT NULL,
    "jobId" CHAR(24),
    "question" TEXT,
    "type" TEXT,
    "category" TEXT,
    "difficulty" TEXT,
    "interviewStage" TEXT,
    "expectedAnswer" TEXT,
    "scoringCriteria" JSONB,
    "tags" TEXT[],
    "isActive" BOOLEAN DEFAULT true,
    "order" INTEGER DEFAULT 0,
    "timeLimit" INTEGER,
    "followUpQuestions" JSONB,
    "isAIGenerated" BOOLEAN DEFAULT false,
    "aiGenerationMetadata" JSONB,
    "qualityMetrics" JSONB,
    "usage" JSONB,
    "candidateFeedback" JSONB,
    "interviewerFeedback" JSONB,
    "responsePatterns" JSONB,
    "createdBy" CHAR(24),
    "updatedBy" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewStage" (
    "id" CHAR(24) NOT NULL,
    "jobId" CHAR(24),
    "name" TEXT,
    "order" INTEGER,
    "type" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "defaultDuration" INTEGER DEFAULT 60,
    "requiredInterviewers" INTEGER DEFAULT 1,
    "interviewerRoles" TEXT[],
    "evaluationCriteria" JSONB,
    "aiQuestionGeneration" JSONB,
    "defaultQuestions" TEXT[],
    "feedbackFormConfig" JSONB,
    "progressionRules" JSONB,
    "interviewCount" INTEGER DEFAULT 0,
    "createdBy" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageTemplate" (
    "id" CHAR(24) NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "organizationId" CHAR(24),
    "stages" JSONB,
    "createdBy" CHAR(24),
    "usageCount" INTEGER DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSlotRetryTask" (
    "id" CHAR(24) NOT NULL,
    "sessionId" TEXT,
    "organizationId" CHAR(24),
    "interviewerId" CHAR(24),
    "reportEmail" TEXT,
    "provider" TEXT,
    "sharedMeetingLink" TEXT,
    "slot" JSONB,
    "sessionContext" JSONB,
    "attemptsMade" INTEGER DEFAULT 0,
    "maxAttempts" INTEGER DEFAULT 2,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "status" TEXT,
    "createdInterviewId" CHAR(24),
    "createdEventId" TEXT,
    "finalStatusEmailSent" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSlotRetryTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInterview" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "jobId" CHAR(24),
    "createdById" CHAR(24),
    "title" TEXT,
    "publicLink" TEXT,
    "guidelines" TEXT,
    "questionSnapshots" JSONB,
    "timers" JSONB,
    "schedule" JSONB,
    "status" TEXT,
    "candidateCount" INTEGER,
    "voice" JSONB,
    "creditCostPerCandidate" DOUBLE PRECISION,
    "costEstimate" JSONB,
    "stats" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" CHAR(24),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInterviewSession" (
    "id" CHAR(24) NOT NULL,
    "aiInterviewId" CHAR(24),
    "organizationId" CHAR(24),
    "jobId" CHAR(24),
    "candidateId" CHAR(24),
    "recipientType" TEXT,
    "createdById" CHAR(24),
    "candidateSnapshot" JSONB,
    "tokenHash" TEXT,
    "tokenGeneratedAt" TIMESTAMP(3),
    "status" TEXT,
    "currentQuestionIndex" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "questionStartedAt" TIMESTAMP(3),
    "questionDeadlineAt" TIMESTAMP(3),
    "totalDeadlineAt" TIMESTAMP(3),
    "messages" JSONB,
    "answers" JSONB,
    "scoring" JSONB,
    "email" JSONB,
    "credits" JSONB,
    "proctoring" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIInterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMatchCache" (
    "id" CHAR(24) NOT NULL,
    "jobId" CHAR(24),
    "candidateId" CHAR(24),
    "matchData" JSONB,
    "version" INTEGER,
    "cacheType" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIMatchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackFormTemplate" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "name" TEXT,
    "description" TEXT,
    "isDefault" BOOLEAN DEFAULT false,
    "systemFields" JSONB,
    "customFields" JSONB,
    "usageCount" INTEGER,
    "jobsUsingIds" CHAR(24)[],
    "createdById" CHAR(24),
    "updatedById" CHAR(24),
    "isDeleted" BOOLEAN DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedById" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "name" TEXT,
    "label" TEXT,
    "description" TEXT,
    "type" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "ratingConfig" JSONB,
    "calculationFormula" TEXT,
    "usageCount" INTEGER,
    "createdById" CHAR(24),
    "updatedById" CHAR(24),
    "isDeleted" BOOLEAN DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedById" CHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldResponse" (
    "id" CHAR(24) NOT NULL,
    "organizationId" CHAR(24),
    "interviewId" CHAR(24),
    "interviewCommentId" CHAR(24),
    "customFieldId" CHAR(24),
    "fieldName" TEXT,
    "fieldLabel" TEXT,
    "fieldType" TEXT,
    "responseValue" JSONB,
    "respondentType" TEXT,
    "respondentId" CHAR(24),
    "respondentName" TEXT,
    "respondentEmail" TEXT,
    "calculationFormula" TEXT,
    "sourceFieldValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackOTP" (
    "id" CHAR(24) NOT NULL,
    "email" TEXT,
    "otp" TEXT,
    "interviewId" CHAR(24),
    "name" TEXT,
    "attempts" INTEGER,
    "verified" BOOLEAN DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackOTP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" CHAR(24) NOT NULL,
    "title" TEXT,
    "departmentId" CHAR(24),
    "location" TEXT,
    "type" TEXT,
    "level" TEXT,
    "description" TEXT,
    "requirements" TEXT,
    "responsibilities" TEXT,
    "skills" TEXT,
    "experience" TEXT,
    "education" TEXT,
    "salary" JSONB,
    "benefits" TEXT,
    "status" TEXT,
    "priority" TEXT,
    "remote" BOOLEAN DEFAULT false,
    "openings" INTEGER DEFAULT 1,
    "shortlist" JSONB,
    "applicants" JSONB,
    "hiringManagerId" CHAR(24),
    "recruiterIds" CHAR(24)[],
    "interviewerIds" CHAR(24)[],
    "applicationDeadline" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "jobBoard" JSONB,
    "isPublic" BOOLEAN DEFAULT false,
    "publicSlug" TEXT,
    "publicUrl" TEXT,
    "isInternalEnabled" BOOLEAN DEFAULT false,
    "internalSlug" TEXT,
    "internalUrl" TEXT,
    "internalApplicationCount" INTEGER DEFAULT 0,
    "internalCandidateApplyLimit" INTEGER DEFAULT 0,
    "reservedInternalCredits" INTEGER DEFAULT 0,
    "internalSettings" JSONB,
    "analytics" JSONB,
    "interviewStageIds" CHAR(24)[],
    "pipelineConfiguration" JSONB,
    "createdById" CHAR(24),
    "updatedById" CHAR(24),
    "uploadMetadata" JSONB,
    "isEmbedded" BOOLEAN DEFAULT false,
    "embeddingCreatedAt" TIMESTAMP(3),
    "emailSettings" JSONB,
    "organizationId" CHAR(24),
    "candidateApplyLimit" INTEGER DEFAULT 0,
    "reservedCredits" INTEGER DEFAULT 0,
    "publicApplicationCount" INTEGER DEFAULT 0,
    "feedbackFormConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" CHAR(24) NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "organizationId" CHAR(24),
    "title" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "isPinned" BOOLEAN DEFAULT false,
    "messageCount" INTEGER DEFAULT 0,
    "lastMessage" JSONB,
    "metadata" JSONB,
    "lastActivity" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" CHAR(24) NOT NULL,
    "messageId" TEXT,
    "sessionId" TEXT,
    "chatSessionId" TEXT,
    "userId" TEXT,
    "role" TEXT,
    "content" TEXT,
    "metadata" JSONB,
    "isLoading" BOOLEAN DEFAULT false,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" CHAR(24) NOT NULL,
    "userId" CHAR(24),
    "type" TEXT,
    "title" TEXT,
    "message" TEXT,
    "data" JSONB,
    "read" BOOLEAN DEFAULT false,
    "actionUrl" TEXT,
    "actionText" TEXT,
    "priority" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" CHAR(24) NOT NULL,
    "sessionId" TEXT,
    "userId" CHAR(24),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN DEFAULT true,
    "lastActivity" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "totalInteractions" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
