// backend/agents/jobAgent.js
// This agent will handle all job-related functionalities,
// using AiJobService for DB/embedding tasks and its own
// intelligence for data processing, generation, and user interaction.

const AiJobServiceClass = require('../services/aiJobService');
const InterviewService = require('../services/interviewService');
const AIModelService = require('../services/aiModelService');
// const LangchainAgentService = require('./langchainAgentService'); // Assuming this will be passed or accessible

const SALARY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max', 'currency', 'period'],
    properties: {
        min: { type: ['integer', 'null'], minimum: 0 },
        max: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: ['string', 'null'] },
        period: { type: ['string', 'null'] }
    }
};

function normalizeMatchingResult(result) {
    if (Array.isArray(result)) return { matches: result };
    if (result && Array.isArray(result.matches)) return result;
    return { matches: [] };
}

class JobAgent {
    constructor(langchainAgentServiceInstance) {
        // this.langchainAgentService = langchainAgentServiceInstance; // For context, memory, communication
        this.aiJobService = new AiJobServiceClass(); // Create an instance of the service
        this.interviewService = new InterviewService(); // Create an instance of the interview service
        this.aiModelService = new AIModelService();
        console.log('JobAgent initialized with AiJobService, InterviewService, and AIModelService');
    }

    _organizationId(userContext = {}) {
        return userContext.organizationId || userContext.currentOrganization;
    }

    /**
     * Prepares and normalizes job data, applying mapping rules.
     * Enhanced to handle comprehensive job descriptions from AI extraction.
     * @param {object} initialJobData - The raw job data.
     * @returns {object} The prepared and normalized job data.
     */
    async _prepareJobData(initialJobData, userContext = {}, { partial = false } = {}) { // Added userContext
        const mappedParams = { ...initialJobData };
        
        // Ensure organization context is included in job data
        const organizationId = this._organizationId(userContext);
        if (organizationId) {
            mappedParams.organization = organizationId;
            console.log(`🔒 Including organization ${organizationId} in job data`);
        }
        
        console.log('🔧 JobAgent _prepareJobData - Processing job data:', {
            title: mappedParams.title,
            hasDescription: !!mappedParams.description,
            hasRequirements: !!mappedParams.requirements,
            hasResponsibilities: !!mappedParams.responsibilities,
            hasSalary: !!mappedParams.salary
        });

        // Normalize independent enum fields concurrently. Canonical values are
        // resolved locally by _normalizeFieldWithAI, so the runtime is only used
        // for genuinely ambiguous inputs.
        const enumNormalizations = [
            ['level', ['Entry', 'Mid', 'Senior', 'Lead', 'Executive'], 'job level', 'Mid'],
            ['experience', ['0-1', '1-3', '3-5', '5-10', '10+'], 'years of experience', '1-3'],
            ['education', ['High School', 'Associate', 'Bachelor', 'Master', 'PhD', 'Professional Certificate', 'Vocational', 'Other'], 'education level', 'Bachelor'],
            ['type', ['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance', 'Temporary'], 'employment type', 'Full-time']
        ];
        await Promise.all(enumNormalizations.map(async ([field, validValues, label, fallback]) => {
            if (mappedParams[field] && typeof mappedParams[field] === 'string') {
                mappedParams[field] = await this._normalizeFieldWithAI(
                    this.aiModelService,
                    mappedParams[field],
                    validValues,
                    label,
                    fallback
                );
            }
        }));

        // Only generate placeholder content if not already provided from extraction
        if (!partial && !mappedParams.responsibilities) {
            if (mappedParams.description && mappedParams.description.length > 100) {
                mappedParams.responsibilities = `Based on the job description: ${mappedParams.description.substring(0, 200)}...`; // Placeholder, AI can refine
            } else {
                mappedParams.responsibilities = 'Key responsibilities to be generated.';
            }
        }
        if (!partial && !mappedParams.requirements) {
            if (mappedParams.description && mappedParams.description.length > 100) {
                mappedParams.requirements = `Based on the job description for ${mappedParams.title || 'the position'}.`; // Placeholder, AI can refine
            } else {
                mappedParams.requirements = 'Specific requirements to be generated.';
            }
        }

        // Infer Department if missing or placeholder
        if ((!partial || Object.prototype.hasOwnProperty.call(mappedParams, 'department'))
            && (!mappedParams.department
                || mappedParams.department === 'To be determined'
                || (typeof mappedParams.department === 'string' && mappedParams.department.toLowerCase() === 'general'))) {
            mappedParams.department = await this._inferDepartmentWithAI(mappedParams.title, mappedParams.description);
        }

        // Infer/Standardize Location if missing or placeholder
        if ((!partial || Object.prototype.hasOwnProperty.call(mappedParams, 'location'))
            && (!mappedParams.location || mappedParams.location === 'To be determined' || mappedParams.location === 'Please specify location')) {
            mappedParams.location = await this._inferLocationWithAI(mappedParams.title, mappedParams.description, mappedParams.location);
        }

        // Parse Salary if provided as text
        if (mappedParams.salary && typeof mappedParams.salary === 'string') {
            const parsedSalary = await this._parseSalaryWithAI(mappedParams.salary);
            if (parsedSalary) {
                mappedParams.salary = parsedSalary;
            } else {
                // If parsing fails, decide on behavior: keep original string, or clear, or set to a default structure
                // For now, let's clear it if it's not parsable to avoid schema validation issues with a string.
                // The Job model might have defaults for salary subfields if salary object is present but empty.
                delete mappedParams.salary;
            }
        }

        // Set default values for core fields if still missing (as per Job model schema where applicable)
        // These are crucial for passing Mongoose validation if not provided by user/AI
        if (!partial) {
            mappedParams.type = mappedParams.type || 'Full-time';
            mappedParams.level = mappedParams.level || 'Mid';
            mappedParams.experience = mappedParams.experience || '1-3'; // Default if not mapped
            mappedParams.education = mappedParams.education || 'Bachelor'; // Default if not mapped
            mappedParams.status = mappedParams.status || 'active'; // Default status for new jobs by agent

            // Ensure required fields by schema are present, only use defaults if not extracted
            mappedParams.title = mappedParams.title || 'Untitled Job';
            mappedParams.department = mappedParams.department || 'To be determined';
            mappedParams.location = mappedParams.location || 'To be determined';

            // Only set default description if not already extracted (avoid overriding comprehensive JD)
            if (!mappedParams.description || mappedParams.description.length < 50) {
                mappedParams.description = 'Detailed job description to be generated.';
            }

            // Requirements and responsibilities already handled above - don't override
            if (!mappedParams.requirements) {
                mappedParams.requirements = 'Specific requirements to be generated.';
            }
            if (!mappedParams.responsibilities) {
                mappedParams.responsibilities = 'Key responsibilities to be generated.';
            }
        }


        console.log('JobAgent _prepareJobData - Mapped job parameters:', mappedParams);
        return mappedParams;
    }


    // Main handler
    async handleJobRequest(intent, initialData, userContext) {
        console.log(`JobAgent handling intent: ${intent} with data:`, initialData);
        // userContext might contain userId, session details, etc.
        // const userId = userContext?.userId; 

        switch (intent) {
            case 'create_job':
                return await this.processCreateJob(initialData, userContext);
            case 'list_jobs':
                return await this.processListJobs(initialData, userContext); // initialData here would be filters
            case 'get_job_by_id':
                return await this.processGetJobById(initialData.jobId, userContext); // initialData.jobId
            case 'update_job':
                return await this.processUpdateJob(initialData.jobId, initialData.updates, userContext);
            case 'delete_job':
                return await this.processDeleteJob(initialData.jobId, userContext);
            case 'delete_job_contextual':
                return await this.processContextualDeleteJob(initialData, userContext);
            case 'get_matching_candidates':
                return await this.processGetMatchingCandidates(initialData.jobId || initialData, initialData.criteria, userContext);
            case 'get_job_embedding_status':
                return await this.processGetJobEmbeddingStatus(initialData.jobId, userContext);
            case 'get_top_candidates':
                return await this.processGetTopCandidates(initialData.jobId || initialData, initialData.options, userContext);
            case 'generate_interview_questions':
                return await this.processGenerateInterviewQuestions(initialData.jobId, initialData.options, userContext);
            case 'get_interview_questions':
                return await this.processGetInterviewQuestions(initialData.jobId, initialData.options, userContext);
            case 'create_interview_question':
                return await this.processCreateInterviewQuestion(initialData, userContext);
            case 'update_interview_question':
                return await this.processUpdateInterviewQuestion(initialData.questionId, initialData.updates, userContext);
            case 'delete_interview_question':
                return await this.processDeleteInterviewQuestion(initialData.questionId, userContext);
            default:
                console.error(`JobAgent: Unknown intent '${intent}'`);
                return { success: false, message: `JobAgent: Unknown intent '${intent}'` };
        }
    }

    async processCreateJob(initialJobData, userContext) { // Added async
        console.log("🧠 SMART JobAgent: Processing create_job with enhanced context awareness...");
        
        // 1. Check if this is a simple job creation request that should trigger the form
        const shouldTriggerForm = this._shouldTriggerJobForm(initialJobData, userContext);
        
        if (shouldTriggerForm) {
            console.log('🚀 Triggering job creation form for user-friendly creation');
            console.log('📊 Initial job data for form:', JSON.stringify(initialJobData, null, 2));
            // Prepare data even if triggering form, to prefill with best possible values
            const preparedInitialData = await this._prepareJobData(initialJobData || {}, userContext);
            return {
                success: true,
                showJobForm: true, // Signal to frontend to show/focus the form
                message: "I'll help you create a professional job posting. I've pre-filled some details based on your request.",
                formData: preparedInitialData // Send prepared data for form pre-filling
            };
        }
        
        // 2. Detect creation context - determine if this is a comprehensive job description
        const isComprehensiveJD = this._detectComprehensiveJobDescription(initialJobData);
        console.log(`📊 Creation Context Analysis: isComprehensiveJD=${isComprehensiveJD}`);
        
        // 3. Enhanced validation with smart context detection
        if (!initialJobData.title || initialJobData.title.trim() === '' || initialJobData.title === 'a') {
            return { 
                success: false, 
                message: "Please provide a specific job title (e.g., 'Software Engineer', 'Marketing Manager', 'Data Scientist')",
                data: initialJobData,
                needsInteraction: true,
                interactionType: 'title_required'
            };
        }
        // 3. Initial preparation and normalization
        let preparedData = await this._prepareJobData(initialJobData, userContext); // Added userContext
        const userId = userContext?.userId;
        
        
        // 4. SMART DECISION LOGIC - Based on research findings
        if (isComprehensiveJD) {
            // User provided comprehensive job description - prioritize immediate creation
            console.log('🎯 DETECTED: Comprehensive JD provided - proceeding with intelligent creation');
            
            // Generate any missing critical fields using AI
            if (!preparedData.department || preparedData.department === 'To be determined') {
                preparedData.department = await this._generateDepartmentFromJobData(preparedData);
            }
            
            if (!preparedData.location || preparedData.location === 'To be determined') {
                preparedData.location = await this._generateLocationFromJobData(preparedData);
            }
            
            // Check if we need to enhance the job details with AI generation
            const needsEnhancement = this._needsJobDetailsEnhancement(preparedData);
            if (needsEnhancement) {
                console.log('🤖 Enhancing job details with comprehensive AI generation...');
                try {
                    const enhancedDetails = await this._generateComprehensiveJobDetails(preparedData);
                    
                    // Only update fields that are still placeholders or incomplete
                    if (this._isPlaceholderContent(preparedData.description)) {
                        preparedData.description = enhancedDetails.description;
                    }
                    if (this._isPlaceholderContent(preparedData.requirements)) {
                        preparedData.requirements = enhancedDetails.requirements;
                    }
                    if (this._isPlaceholderContent(preparedData.responsibilities)) {
                        preparedData.responsibilities = enhancedDetails.responsibilities;
                    }
                    if (!preparedData.skills || preparedData.skills.length < 20) {
                        preparedData.skills = enhancedDetails.skills;
                    }
                    
                    console.log('✅ Enhanced job details with AI generation');
                } catch (enhancementError) {
                    console.warn('⚠️ Failed to enhance job details with AI:', enhancementError.message);
                    // Continue with original data
                }
            }
            
            // Proceed with creation
            try {
                const createdJob = await this.aiJobService.createJobAndEmbed(preparedData, userId);
                
                return {
                    success: true,
                    message: `🎉 Successfully created the **${createdJob.title}** position! The job has been saved and is ready for applications.`,
                    data: createdJob, // This is the final created job
                    formData: preparedData, // This is the data that was used for creation, potentially useful for FE confirmation
                    needsInteraction: false,
                    context: 'comprehensive_creation'
                };
                
            } catch (error) {
                console.error('Error creating comprehensive job:', error);
                return {
                    success: false,
                    message: `Failed to create the job: ${error.message}`,
                    data: preparedData
                };
            }
        }
        
        // 5. Interactive workflow for basic job creation requests
        const missingFields = this._identifyMissingFields(preparedData);
        
        if (missingFields.length === 0) {
            // All required fields present - create the job
            try {
                const createdJob = await this.aiJobService.createJobAndEmbed(preparedData, userId);
                
                return {
                    success: true,
                    message: `🎉 Successfully created the **${createdJob.title}** position! The job has been saved and is ready for applications.`,
                    data: createdJob, // Final created job
                    formData: preparedData, // Data used for creation
                    needsInteraction: false
                };
                
            } catch (error) {
                console.error('Error creating job:', error);
                return {
                    success: false,
                    message: `Failed to create the job: ${error.message}`,
                    data: preparedData
                };
            }
        }
        
        // 6. Smart interaction flow - guide user intelligently
        console.log(`🔄 Missing fields detected (${missingFields.length}): ${missingFields.join(', ')}`);
        
        // Prepare interactive response with smart suggestions
        const interactionMessage = this._generateSmartInteractionMessage(preparedData, missingFields);
        
        return {
            success: false,
            message: interactionMessage,
            formData: preparedData, // Send the current state of job data for form update
            data: { // Keep original data structure for other backend logic if needed
                ...preparedData, // Deprecate this in favor of top-level formData for frontend form
                missingFields,
                awaitingInput: missingFields[0],
                pendingCreation: true,
                interactionStep: 1,
                totalSteps: missingFields.length
            },
            needsInteraction: true,
            interactionType: 'missing_fields'
        };
    }

    /**
     * Determine if we should trigger the job creation form
     * Based on user input patterns and data completeness
     */
    _shouldTriggerJobForm(jobData, userContext) {
        // Don't trigger form if we already have comprehensive job data
        if (this._detectComprehensiveJobDescription(jobData)) {
            return false;
        }
        
        // Don't trigger form if user explicitly wants to bypass it
        if (userContext?.skipForm || jobData?.skipForm) {
            return false;
        }
        
        // Trigger form for simple job creation requests
        const triggerIndicators = [
            // Simple job creation requests
            !jobData.description || jobData.description.length < 100,
            !jobData.requirements || jobData.requirements.length < 50,
            !jobData.responsibilities || jobData.responsibilities.length < 50,
            
            // Missing key fields that form can help with
            !jobData.department || jobData.department === 'To be determined',
            !jobData.location || jobData.location === 'To be determined',
            !jobData.salary,
            !jobData.benefits,
            !jobData.skills || (Array.isArray(jobData.skills) && jobData.skills.length < 3)
        ];
        
        const triggerCount = triggerIndicators.filter(Boolean).length;
        console.log(`🎯 Form trigger indicators: ${triggerCount}/8`);
        
        // Trigger form if we have enough missing information that the form would be helpful
        return triggerCount >= 4;
    }

    /**
     * Detect if the job data contains a comprehensive job description
     * Based on research on job posting analysis
     */
    _detectComprehensiveJobDescription(jobData) {
        const indicators = [
            // Length indicators
            (jobData.description && jobData.description.length > 200),
            (jobData.requirements && jobData.requirements.length > 100),
            (jobData.responsibilities && jobData.responsibilities.length > 100),
            
            // Content quality indicators
            (jobData.description && (
                jobData.description.includes('will be responsible') ||
                jobData.description.includes('we are looking for') ||
                jobData.description.includes('ideal candidate') ||
                jobData.description.includes('you will')
            )),
            
            // Structured content indicators
            (jobData.skills && jobData.skills.length > 20),
            (jobData.benefits && jobData.benefits.length > 20),
            (jobData.salary && typeof jobData.salary === 'object'),
            
            // Multiple field completion
            [jobData.description, jobData.requirements, jobData.responsibilities].filter(field => field && field.length > 50).length >= 2
        ];
        
        const indicatorCount = indicators.filter(Boolean).length;
        console.log(`📊 Comprehensive JD indicators: ${indicatorCount}/8`);
        
        return indicatorCount >= 3; // Threshold for comprehensive JD
    }

    /**
     * Generate smart interaction messages based on context
     */
    _generateSmartInteractionMessage(jobData, missingFields) {
        const title = jobData.title;
        const firstMissing = missingFields[0];
        
        let message = `🤖 **Smart Job Creation Assistant**\n\n`;
        message += `I'm helping you create the **${title}** position. `;
        
        if (missingFields.length === 1) {
            message += `We just need one more detail:\n\n`;
        } else {
            message += `I need ${missingFields.length} more details to complete the job:\n\n`;
        }
        
        // Provide smart suggestions based on the first missing field
        if (firstMissing === 'location') {
            message += `📍 **Location needed**: Where will this ${title} be based?\n`;
            message += `💡 *Examples: "New York, NY", "Remote", "London, UK", "Hybrid - Toronto"*\n`;
        } else if (firstMissing === 'description') {
            message += `📝 **Job description needed**: \n`;
            message += `You can either:\n`;
            message += `• Paste a complete job description\n`;
            message += `• Type "generate description" and I'll create one for you\n`;
            message += `• Provide a brief summary and I'll expand it\n`;
        } else if (firstMissing === 'department') {
            message += `🏢 **Department needed**: Which department will the ${title} join?\n`;
            message += `💡 *Examples: "Engineering", "Marketing", "Sales", "HR", "Product"*\n`;
        }
        
        return message;
    }

    /**
     * Identify missing critical fields with smart defaults
     */
    _identifyMissingFields(jobData) {
        const missingFields = [];
        
        // Location is critical and should be specified
        if (!jobData.location || jobData.location === 'To be determined') {
            missingFields.push('location');
        }
        
        // Description is important but can be generated
        if (!jobData.description || jobData.description === 'Detailed job description to be generated.' || jobData.description.length < 50) {
            missingFields.push('description');
        }
        
        // Department can be inferred but better to ask
        if (!jobData.department || jobData.department === 'To be determined') {
            missingFields.push('department');
        }
        
        return missingFields;
    }

    /**
     * Generate department from job data using AI
     */
    async _generateDepartmentFromJobData(jobData) {
        const title = jobData.title.toLowerCase();
        
        // Quick mapping for common titles
        const deptMap = {
            'engineer': 'Engineering',
            'developer': 'Engineering', 
            'software': 'Engineering',
            'data scientist': 'Data Science',
            'product manager': 'Product',
            'marketing': 'Marketing',
            'sales': 'Sales',
            'hr': 'Human Resources',
            'financial': 'Finance',
            'analyst': 'Analytics'
        };
        
        for (const [keyword, dept] of Object.entries(deptMap)) {
            if (title.includes(keyword)) {
                console.log(`🎯 Auto-detected department: ${dept} for ${jobData.title}`);
                return dept;
            }
        }
        
        return 'General'; // Fallback
    }

    /**
     * Generate location from job data using AI
     */
    async _generateLocationFromJobData(jobData) {
        // For now, return a default that prompts for specification
        return 'Please specify location';
    }

    async processListJobs(filterData, userContext) {
        console.log("JobAgent: Processing list_jobs with filters:", filterData);
        
        // Ensure organization context
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            throw new Error('Organization context is required for accessing jobs');
        }
        
        try {
            // Add organization filter to filterData
            const orgFilterData = { ...filterData, organization: organizationId };
            const jobs = await this.aiJobService.listJobs(orgFilterData);
            return { success: true, data: jobs, message: `Found ${jobs.length} jobs.` };
        } catch (error) {
            console.error("JobAgent: Error in processListJobs:", error);
            return { success: false, message: `JobAgent: Failed to list jobs. ${error.message}` };
        }
    }

    async processGetJobById(jobId, userContext) {
        console.log(`JobAgent: Processing get_job_by_id for ID: ${jobId}`);
        if (!jobId) {
            return { success: false, message: "JobAgent: Job ID is required." };
        }
        
        // Ensure organization context
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            throw new Error('Organization context is required for accessing jobs');
        }
        
        try {
            const job = await this.aiJobService.getJobById(jobId, organizationId);
            
            if (job) {
                return { success: true, data: job, message: "Job retrieved successfully." };
            } else {
                return { success: false, message: `JobAgent: Job with ID ${jobId} not found.` };
            }
        } catch (error) {
            console.error(`JobAgent: Error in processGetJobById for ID ${jobId}:`, error);
            return { success: false, message: `JobAgent: Failed to retrieve job. ${error.message}` };
        }
    }

    async processUpdateJob(jobId, updates, userContext) {
        console.log(`JobAgent: Processing update_job for ID: ${jobId} with updates:`, updates);
        if (!jobId || !updates) {
            return { success: false, message: "JobAgent: Job ID and update data are required." };
        }
        const userId = userContext?.userId;
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            return { success: false, message: 'Organization context is required for updating jobs.' };
        }
        
        // Apply the same preparation logic to updates if they contain fields that need mapping
        const preparedUpdates = await this._prepareJobData(updates, userContext, { partial: true }); // Added userContext
        // Note: _prepareJobData might add default fields if not present in 'updates'.
        // We only want to pass actual updates. A more refined _prepareUpdates method might be needed.
        // For now, this will ensure enums are mapped correctly if provided in updates.

        try {
            // A more robust approach for updates:
            // 1. Fetch the existing job.
            // 2. Merge `updates` onto it.
            // 3. Run the merged data through `_prepareJobData` to ensure consistency.
            // 4. Then pass to `aiJobService.updateJobAndEmbed`.
            // For now, directly passing preparedUpdates.
            const updatedJob = await this.aiJobService.updateJobAndEmbed(jobId, preparedUpdates, userId, organizationId);
            if (updatedJob) {
                return { success: true, data: updatedJob, message: "Job updated successfully." };
            } else {
                return { success: false, message: `JobAgent: Job with ID ${jobId} not found for update.` };
            }
        } catch (error) {
            console.error(`JobAgent: Error in processUpdateJob for ID ${jobId}:`, error);
            return { success: false, message: `JobAgent: Failed to update job. ${error.message}` };
        }
    }

    async processDeleteJob(jobId, userContext) {
        console.log(`JobAgent: Processing delete_job for ID: ${jobId}`);
        if (!jobId) {
            return { success: false, message: "JobAgent: Job ID is required." };
        }
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            return { success: false, message: 'Organization context is required for deleting jobs.' };
        }
        // TODO: Agent might ask for confirmation here
        try {
            const success = await this.aiJobService.deleteJobAndEmbed(jobId, organizationId);
            if (success) {
                return { success: true, message: `Job with ID ${jobId} deleted successfully.` };
            } else {
                return { success: false, message: `JobAgent: Failed to delete job with ID ${jobId} (possibly not found).` };
            }
        } catch (error) {
            console.error(`JobAgent: Error in processDeleteJob for ID ${jobId}:`, error);
            return { success: false, message: `JobAgent: Failed to delete job. ${error.message}` };
        }
    }

    async processContextualDeleteJob(initialData, userContext) {
        console.log(`JobAgent: Processing contextual delete_job with data:`, initialData);
        
        try {
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for deleting jobs.' };
            }
            // Strategy 1: Look for job ID in conversation history
            let recentJobId = null;
            let recentJobTitle = null;
            
            try {
                const memoryManager = require('../services/memoryManager');
                const memory = memoryManager.getMemoryInstance(userContext.userId, userContext.chatSessionId);
                const memoryVariables = await memory.loadMemoryVariables({});
                const chatHistory = memoryVariables[memory.memoryKey] || [];
                
                console.log(`🔍 Searching through ${chatHistory.length} messages for recent job context...`);
                
                // Search through recent messages for job information
                for (let i = chatHistory.length - 1; i >= Math.max(0, chatHistory.length - 15); i--) {
                    const message = chatHistory[i];
                    
                    if ((message.constructor.name === 'AIMessage' || message.type === 'ai') && message.content) {
                        const content = message.content;
                        
                        // Look for job display patterns (like the CTO job shown)
                        const jobDisplayMatch = content.match(/Chief Technology Officer \(CTO\).*?ID:\s*([0-9a-f]{24})/s);
                        if (jobDisplayMatch) {
                            recentJobId = jobDisplayMatch[1];
                            recentJobTitle = 'Chief Technology Officer (CTO)';
                            console.log(`🎯 Found displayed job: ${recentJobTitle} (ID: ${recentJobId})`);
                            break;
                        }
                        
                        // Look for any job with ID pattern
                        const jobIdMatches = content.match(/ID:\s*([0-9a-f]{24})/g);
                        if (jobIdMatches) {
                            // Get the most recent job ID
                            const lastMatch = jobIdMatches[jobIdMatches.length - 1];
                            const idMatch = lastMatch.match(/([0-9a-f]{24})/);
                            if (idMatch) {
                                recentJobId = idMatch[1];
                                
                                // Try to extract title from the same content
                                const titlePatterns = [
                                    /\*\*([^*]+)\*\*.*?ID:\s*[0-9a-f]{24}/s,
                                    /([A-Z][^:\n]+).*?ID:\s*[0-9a-f]{24}/s,
                                    /"title":\s*"([^"]+)"/
                                ];
                                
                                for (const pattern of titlePatterns) {
                                    const titleMatch = content.match(pattern);
                                    if (titleMatch && titleMatch[1]) {
                                        recentJobTitle = titleMatch[1].trim();
                                        break;
                                    }
                                }
                                
                                console.log(`🔍 Found job ID in context: ${recentJobTitle || 'Unknown'} (ID: ${recentJobId})`);
                                break;
                            }
                        }
                    }
                }
            } catch (memoryError) {
                console.warn('⚠️ Memory access failed, trying alternative approach:', memoryError.message);
            }
            
            // Strategy 2: If no job found in history, try to find the most recent job
            if (!recentJobId) {
                console.log('🔍 No job found in conversation, looking for most recent job...');
                
                try {
                    // Get all jobs and find the most recent one
                    const allJobs = await this.aiJobService.listJobs({ organization: organizationId, limit: 5, sort: { createdAt: -1 } });
                    
                    if (allJobs && allJobs.length > 0) {
                        const mostRecentJob = allJobs[0];
                        recentJobId = mostRecentJob._id;
                        recentJobTitle = mostRecentJob.title;
                        console.log(`🎯 Found most recent job: ${recentJobTitle} (ID: ${recentJobId})`);
                    }
                } catch (listError) {
                    console.warn('⚠️ Failed to list recent jobs:', listError.message);
                }
            }
            
            // Strategy 3: If still no job found, provide helpful guidance
            if (!recentJobId) {
                console.log('❌ No job found for contextual deletion');
                
                // Try to get available jobs to show user
                try {
                    const availableJobs = await this.aiJobService.listJobs({ organization: organizationId, limit: 5 });
                    
                    if (availableJobs && availableJobs.length > 0) {
                        let jobsList = availableJobs.map((job, index) => 
                            `${index + 1}. **${job.title}** (${job.department}) - ID: ${job._id}`
                        ).join('\n');
                        
                        return {
                            success: false,
                            message: `❌ **Unable to find specific job to delete**

I couldn't identify which job you want to delete from our conversation. Here are the available jobs:

${jobsList}

**To delete a job, please:**
1. **Use the job ID**: "delete job ${availableJobs[0]._id}"
2. **Or be specific**: "delete the ${availableJobs[0].title} job"
3. **Or use the number**: "delete job #1"

Which job would you like to delete?`
                        };
                    } else {
                        return {
                            success: false,
                            message: `❌ **No jobs found**

There are currently no jobs in the system to delete.

Would you like me to help you create a new job instead?`
                        };
                    }
                } catch (listError) {
                    return {
                        success: false,
                        message: `❌ **Unable to find job to delete**

I couldn't find a specific job to delete. Please provide:

1. **The job ID**: "delete job [job-id]"
2. **Or the job title**: "delete the [job title] job"
3. **Or list jobs first**: "show me all jobs"

Error details: ${listError.message}`
                    };
                }
            }
            
            // Strategy 4: Verify the job exists and attempt deletion
            console.log(`🔍 Verifying job exists: ${recentJobId}`);
            
            let job;
            try {
                job = await this.aiJobService.getJobById(recentJobId, organizationId);
            } catch (getError) {
                console.warn('⚠️ Error getting job by ID:', getError.message);
                job = null;
            }
            
            if (!job) {
                console.log(`❌ Job ${recentJobId} not found or already deleted`);
                
                // Try to get available jobs as fallback
                try {
                    const availableJobs = await this.aiJobService.listJobs({ organization: organizationId, limit: 3 });
                    
                    if (availableJobs && availableJobs.length > 0) {
                        let jobsList = availableJobs.map((job, index) => 
                            `${index + 1}. **${job.title}** (${job.department})`
                        ).join('\n');
                        
                        return {
                            success: false,
                            message: `❌ **Job not found**

The job I found in our conversation (ID: ${recentJobId}) no longer exists or has already been deleted.

**Available jobs:**
${jobsList}

Would you like to delete one of these jobs instead?`
                        };
                    } else {
                        return {
                            success: false,
                            message: `❌ **Job not found**

The job (ID: ${recentJobId}) no longer exists or has already been deleted, and there are no other jobs in the system.

Would you like me to help you create a new job?`
                        };
                    }
                } catch (listError) {
                    return {
                        success: false,
                        message: `❌ **Job not found**

The job I found in our conversation (ID: ${recentJobId}) no longer exists or has already been deleted.

Please list available jobs first: "show me all jobs"`
                    };
                }
            }
            
            // Strategy 5: Proceed with deletion
            console.log(`🗑️ Proceeding to delete job: ${job.title} (ID: ${recentJobId})`);
            
            try {
                const success = await this.aiJobService.deleteJobAndEmbed(recentJobId, organizationId);
                
                if (success) {
                    return {
                        success: true,
                        message: `✅ **Job deleted successfully!**

The **${job.title}** position has been deleted from the system.

**Details:**
- **Title:** ${job.title}
- **Department:** ${job.department || 'N/A'}
- **Location:** ${job.location || 'N/A'}
- **ID:** ${recentJobId}

The job posting is no longer active and has been removed from all listings.`
                    };
                } else {
                    return {
                        success: false,
                        message: `❌ **Failed to delete job**

Unable to delete the **${job.title}** position (ID: ${recentJobId}). The job may have already been deleted or there was a system error.

Please try again or list available jobs: "show me all jobs"`
                    };
                }
            } catch (deleteError) {
                console.error('❌ Delete operation failed:', deleteError);
                return {
                    success: false,
                    message: `❌ **Error deleting job**

Failed to delete the **${job.title}** position: ${deleteError.message}

Please try again or contact support if the issue persists.`
                };
            }
            
        } catch (error) {
            console.error(`JobAgent: Error in processContextualDeleteJob:`, error);
            return {
                success: false,
                message: `❌ **Error processing delete request**

${error.message}

Please try again with a specific job ID or list available jobs first: "show me all jobs"`
            };
        }
    }

    async processGetMatchingCandidates(jobIdOrData, criteria, userContext) {
        console.log(`JobAgent: Processing get_matching_candidates with:`, jobIdOrData, 'criteria:', criteria);
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            return { success: false, message: 'Organization context is required for candidate matching.' };
        }
        
        let jobId = null;
        let jobTitle = null;
        
        // Handle different input formats
        if (typeof jobIdOrData === 'string') {
            jobId = jobIdOrData;
        } else if (typeof jobIdOrData === 'object') {
            jobId = jobIdOrData.jobId;
            jobTitle = jobIdOrData.jobTitle;
        }
        
        // If no job ID but we have a job title, try to find the job
        if (!jobId && jobTitle) {
            console.log(`🔍 Searching for job with title: "${jobTitle}"`);
            try {
                const jobs = await this.aiJobService.listJobs({ 
                    search: jobTitle,
                    organization: organizationId,
                    limit: 5 
                });
                
                if (jobs && jobs.length > 0) {
                    // Find exact or best match
                    const exactMatch = jobs.find(job => 
                        job.title.toLowerCase().includes(jobTitle.toLowerCase()) ||
                        jobTitle.toLowerCase().includes(job.title.toLowerCase())
                    );
                    
                    if (exactMatch) {
                        jobId = exactMatch._id.toString();
                        console.log(`✅ Found matching job: ${exactMatch.title} (${jobId})`);
                    } else {
                        return {
                            success: false,
                            message: `❌ **No job found matching "${jobTitle}"**

Available jobs that might be similar:
${jobs.slice(0, 3).map(job => `• **${job.title}** (${job.department})`).join('\n')}

💡 Try being more specific with the job title or create the job first.`
                        };
                    }
                } else {
                    return {
                        success: false,
                        message: `❌ **No job found with title "${jobTitle}"**

Please check the job title or create the job first. You can:
1. Use "show all jobs" to see available positions
2. Create a new job posting
3. Try a different job title`
                    };
                }
            } catch (error) {
                console.error('Error searching for job by title:', error);
                return {
                    success: false,
                    message: `❌ Error searching for job "${jobTitle}": ${error.message}`
                };
            }
        }
        
        if (!jobId) {
            return { 
                success: false, 
                message: "JobAgent: Job ID or job title is required for matching candidates." 
            };
        }
        
        try {
            const topK = Math.min(Math.max(Number.parseInt(criteria?.topK, 10) || 10, 1), 100);
            const includeExplanations = criteria?.includeExplanations !== false; // Default to true
            
            console.log(`🔍 Finding matching candidates for job ${jobId}...`);

            // Get the job first
            const job = await this.aiJobService.getJobById(jobId, organizationId);
            if (!job) {
                return { 
                    success: false, 
                    message: `Job with ID ${jobId} not found.` 
                };
            }

            const matchResult = normalizeMatchingResult(
                await this.aiJobService.getMatchingCandidatesForJob(jobId, topK, organizationId)
            );
            const matches = matchResult.matches;
            
            if (!matches || matches.length === 0) {
                return {
                    success: true,
                    message: `📊 **No matching candidates found for ${job.title}**

It looks like there are no candidates in the system that match the requirements for this position yet.

**Suggestions:**
1. **Lower the matching criteria** - Reduce minimum similarity threshold
2. **Add more candidates** - Import more candidate profiles
3. **Review job requirements** - Make sure requirements aren't too restrictive

Would you like me to help you with any of these steps?`,
                    data: {
                        jobId,
                        jobTitle: job.title,
                        matches: [],
                        matchCount: 0
                    }
                };
            }

            // Enhanced response with better formatting
            const responseMessage = `🎯 **Found ${matches.length} matching candidates for ${job.title}**

${matches.slice(0, 6).map((match, index) => {
    const percentage = Math.round(match.similarity * 100);
    const candidate = match.candidate;
    const metadata = match.metadata || {};
    
    // Use proper name formatting - candidate.name is constructed correctly in embeddingService
    const candidateName = candidate.name || 
                         `${metadata.firstName || ''} ${metadata.lastName || ''}`.trim() || 
                         'Name not available';
    
    // Get proper status
    const candidateStatus = candidate.status || metadata.status || 'Status unknown';
    
    // Get experience info
    const experienceInfo = candidate.experience || metadata.experience || 'Experience not specified';
    
    // Get key strengths from explanation
    let keyStrengths = 'Strong overall match';
    if (match.explanation && includeExplanations) {
        const reasons = match.explanation.reasons || match.explanation.topReasons || [];
        if (reasons.length > 0) {
            keyStrengths = reasons.slice(0, 2).join(', ');
        }
    }
    
    return `**${index + 1}. ${candidateName}** (${percentage}% match) 🎯 ${metadata.status || candidate.status || 'Unknown'}
   📧 ${candidate.email || metadata.email || 'Email not available'}
   📱 ${candidate.phone || metadata.phone || 'Phone not available'}  
   💼 ${candidate.position || metadata.position || 'Position not specified'}
   🎓 ${experienceInfo}
   📍 ${candidate.location || metadata.location || 'Location not specified'}
   ${includeExplanations ? `✨ **Key Strengths:** ${keyStrengths}` : ''}`;
}).join('\n\n')}

${matches.length > 6 ? `\n*... and ${matches.length - 6} more candidates*` : ''}

---

🔍 **Quick Actions:**
• **View detailed analysis** - Say "analyze candidate [name]" for in-depth insights
• **Contact top candidate** - Get contact details and next steps
• **Compare candidates** - Ask "compare top 3 candidates"
• **Interview questions** - Generate questions for these candidates

💡 Would you like me to show detailed analysis for any specific candidate?`;

            return { 
                success: true, 
                data: {
                    jobId,
                    jobTitle: job.title,
                    matches,
                    matchCount: matches.length,
                    fromCache: matchResult.fromCache === true,
                    cacheAgeMinutes: matchResult.cacheAgeMinutes ?? null
                }, 
                message: responseMessage 
            };
        } catch (error) {
            console.error(`JobAgent: Error in processGetMatchingCandidates for job ID ${jobId}:`, error);
            return { success: false, message: `JobAgent: Failed to get matching candidates. ${error.message}` };
        }
    }

    async processGetJobEmbeddingStatus(jobId, userContext) {
        console.log(`JobAgent: Processing get_job_embedding_status for ID: ${jobId}`);
        if (!jobId) {
            return { success: false, message: "JobAgent: Job ID is required." };
        }
        try {
            const status = await this.aiJobService.getJobEmbeddingStatus(jobId);
            return { success: true, data: status, message: "Embedding status retrieved." };
        } catch (error) {
            console.error(`JobAgent: Error in processGetJobEmbeddingStatus for ID ${jobId}:`, error);
            return { success: false, message: `JobAgent: Failed to get embedding status. ${error.message}` };
        }
    }

    /**
     * Process user response to pending job creation
     * @param {object} pendingJobData - Current job creation state
     * @param {string} userInput - User's response
     * @param {object} userContext - User context
     * @returns {object} - Processing result
     */
    async processJobCreationResponse(pendingJobData, userInput, userContext) {
        console.log("🔄 JobAgent: Processing job creation response...");
        console.log("📊 Pending job data:", pendingJobData);
        console.log("💬 User input:", userInput);
        
        try {
            // Update the job data based on user input
            const updatedJobData = await this._updateJobDataFromUserResponse(pendingJobData, userInput);
            
            // Check if we now have all required fields
            const missingFields = this._identifyMissingFields(updatedJobData);
            
            if (missingFields.length === 0) {
                // All fields complete - create the job
                console.log("✅ All required fields collected, creating job...");
                
                const userId = userContext?.userId;
                const createdJob = await this.aiJobService.createJobAndEmbed(updatedJobData, userId);
                
                return {
                    success: true,
                    message: `🎉 Successfully created the **${createdJob.title}** position! The job has been saved and is ready for applications.`,
                    data: createdJob, // Final created job
                    formData: updatedJobData, // The complete data that led to creation
                    needsInteraction: false,
                    context: 'job_creation_completed'
                };
            } else {
                // Still missing fields - continue interaction
                console.log(`🔄 Still missing ${missingFields.length} fields: ${missingFields.join(', ')}`);
                
                const interactionMessage = this._generateSmartInteractionMessage(updatedJobData, missingFields);
                
                return {
                    success: false,
                    message: interactionMessage,
                    formData: updatedJobData, // Send the current state of job data for form update
                    data: { // Keep original data structure for other backend logic
                        ...updatedJobData,
                        missingFields,
                        awaitingInput: missingFields[0],
                        pendingCreation: true,
                        interactionStep: (pendingJobData.interactionStep || 1) + 1,
                        totalSteps: missingFields.length
                    },
                    needsInteraction: true,
                    interactionType: 'missing_fields'
                };
            }
            
        } catch (error) {
            console.error('Error processing job creation response:', error);
            return {
                success: false,
                message: `❌ **Error processing your response**\n\n${error.message}\n\nPlease try again or provide the information in a different format.`,
                data: pendingJobData
            };
        }
    }

    /**
     * Update job data based on user response
     * @param {object} currentJobData - Current job data state
     * @param {string} userInput - User's input
     * @returns {object} - Updated job data
     */
    async _updateJobDataFromUserResponse(currentJobData, userInput) {
        const inputLower = userInput.toLowerCase().trim();
        const updatedData = { ...currentJobData };
        
        console.log(`🔄 Updating job data based on user input: "${userInput}"`);
        
        // Handle location input
        if (inputLower.includes('location') || 
            this._isLocationInput(userInput)) {
            
            let location = this._extractLocationFromInput(userInput);
            if (location) {
                updatedData.location = location;
                console.log(`📍 Updated location: ${location}`);
                
                // Remove location from missing fields
                if (updatedData.missingFields) {
                    updatedData.missingFields = updatedData.missingFields.filter(field => field !== 'location');
                }
            }
        }
        
        // Handle description input
        else if (inputLower.includes('generate description') || inputLower.includes('create description')) {
            // User wants AI to generate comprehensive job details
            console.log('🤖 User requested AI-generated comprehensive job details');
            
            try {
                const comprehensiveJobDetails = await this._generateComprehensiveJobDetails(updatedData);
                
                // Update all generated fields
                updatedData.description = comprehensiveJobDetails.description;
                updatedData.requirements = comprehensiveJobDetails.requirements;
                updatedData.responsibilities = comprehensiveJobDetails.responsibilities;
                updatedData.skills = comprehensiveJobDetails.skills;
                
                console.log('✅ Generated comprehensive job details:', {
                    hasDescription: !!comprehensiveJobDetails.description,
                    hasRequirements: !!comprehensiveJobDetails.requirements,
                    hasResponsibilities: !!comprehensiveJobDetails.responsibilities,
                    hasSkills: !!comprehensiveJobDetails.skills
                });
                
                // Remove all generated fields from missing fields
                if (updatedData.missingFields) {
                    updatedData.missingFields = updatedData.missingFields.filter(field => 
                        !['description', 'requirements', 'responsibilities'].includes(field)
                    );
                }
            } catch (error) {
                console.error('❌ Error generating comprehensive job details:', error);
                // The user explicitly requested AI generation. Preserve the
                // runtime error so the assistant can request connection/retry
                // rather than returning template copy as a successful AI run.
                throw error;
            }
        }
        else if (userInput.length > 50 && !inputLower.includes('location')) {
            // User provided a description
            updatedData.description = userInput.trim();
            console.log(`📝 Updated description (${userInput.length} chars)`);
            
            // Remove description from missing fields
            if (updatedData.missingFields) {
                updatedData.missingFields = updatedData.missingFields.filter(field => field !== 'description');
            }
        }
        
        // Handle department input
        else if (inputLower.includes('department') || this._isDepartmentInput(userInput)) {
            let department = this._extractDepartmentFromInput(userInput);
            if (department) {
                updatedData.department = department;
                console.log(`🏢 Updated department: ${department}`);
                
                // Remove department from missing fields
                if (updatedData.missingFields) {
                    updatedData.missingFields = updatedData.missingFields.filter(field => field !== 'department');
                }
            }
        }
        
        return updatedData;
    }

    /**
     * Check if input is a location
     */
    _isLocationInput(input) {
        const locationKeywords = ['remote', 'hybrid', 'office', 'city', 'state', 'country'];
        const inputLower = input.toLowerCase();
        
        // Check for common location patterns
        return locationKeywords.some(keyword => inputLower.includes(keyword)) ||
               /\b(new york|london|paris|tokyo|san francisco|los angeles|chicago|boston|seattle|toronto|vancouver)\b/i.test(input) ||
               /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(input); // City, State pattern
    }

    /**
     * Extract location from input
     */
    _extractLocationFromInput(input) {
        const inputLower = input.toLowerCase().trim();
        
        // Remove "location" prefix if present
        let location = input.trim();
        if (inputLower.startsWith('location')) {
            location = input.replace(/^location\s*/i, '').trim();
        }
        
        // Handle common location formats
        if (location.length > 0 && location.length < 100) {
            return location;
        }
        
        return null;
    }

    /**
     * Check if input is a department
     */
    _isDepartmentInput(input) {
        const deptKeywords = ['engineering', 'marketing', 'sales', 'hr', 'finance', 'product', 'operations', 'it', 'legal'];
        const inputLower = input.toLowerCase();
        
        return deptKeywords.some(keyword => inputLower.includes(keyword));
    }

    /**
     * Extract department from input
     */
    _extractDepartmentFromInput(input) {
        const inputLower = input.toLowerCase().trim();
        
        // Remove "department" prefix if present
        let department = input.trim();
        if (inputLower.includes('department')) {
            department = input.replace(/department/i, '').trim();
        }
        
        // Capitalize first letter
        if (department.length > 0) {
            return department.charAt(0).toUpperCase() + department.slice(1);
        }
        
        return null;
    }

    /**
     * Generate job description using AI
     */
    async _generateJobDescription(jobData) {
        try {
            // For now, return a template-based description
            // This could be enhanced with AI generation later
            const title = jobData.title || 'Position';
            const department = jobData.department || 'our team';
            const location = jobData.location || 'our office';
            
            return `We are seeking a talented ${title} to join ${department} at ${location}. This role offers an exciting opportunity to contribute to our growing organization and make a meaningful impact. The ideal candidate will bring expertise, enthusiasm, and a collaborative spirit to help drive our mission forward.

Key aspects of this role include working with cutting-edge technologies, collaborating with cross-functional teams, and contributing to innovative projects that shape the future of our industry.

We offer a competitive compensation package, comprehensive benefits, and a supportive work environment that encourages professional growth and development.`;
            
        } catch (error) {
            console.error('Error generating job description:', error);
            return `Detailed job description for ${jobData.title || 'this position'} to be finalized.`;
        }
    }

    /**
     * Generate comprehensive job details using AI (description, requirements, responsibilities, skills)
     */
    async _generateComprehensiveJobDetails(jobData) {
        try {
            console.log('🤖 Generating comprehensive job details with AI...');
            
            // Prepare data for AI generation
            const promptData = {
                title: jobData.title || 'Position',
                department: jobData.department || 'General',
                location: jobData.location || 'To be determined',
                level: jobData.level || 'Mid',
                type: jobData.type || 'Full-time',
                experience: jobData.experience || '1-3 years',
                education: jobData.education || 'Bachelor',
                existingDescription: jobData.description // Pass any existing description as context
            };
            
            console.log('📊 AI generation prompt data:', promptData);
            
            // Call the AI service for comprehensive generation
            const generatedDetails = await this.aiJobService.generateJobDetailsWithAzureAI(promptData);
            
            console.log('✅ AI generated comprehensive job details successfully');
            
            return {
                description: generatedDetails.description || await this._generateJobDescription(jobData),
                requirements: generatedDetails.requirements || this._generateFallbackRequirements(jobData),
                responsibilities: generatedDetails.responsibilities || this._generateFallbackResponsibilities(jobData),
                skills: generatedDetails.skills || this._generateFallbackSkills(jobData)
            };
            
        } catch (error) {
            console.error('❌ Error generating comprehensive job details:', error);
            throw error;
        }
    }

    /**
     * Generate fallback requirements when AI fails
     */
    _generateFallbackRequirements(jobData) {
        const title = jobData.title || 'Position';
        const experience = jobData.experience || '1-3 years';
        const education = jobData.education || 'Bachelor';
        const department = jobData.department || 'relevant field';
        
        return `• ${education} degree in ${department} or related field
• ${experience} of professional experience in relevant role
• Strong analytical and problem-solving skills
• Excellent communication and interpersonal abilities
• Proficiency in relevant tools and technologies for ${title}
• Ability to work independently and collaboratively
• Strong attention to detail and organizational skills
• Adaptability and willingness to learn new technologies`;
    }

    /**
     * Generate fallback responsibilities when AI fails
     */
    _generateFallbackResponsibilities(jobData) {
        const title = jobData.title || 'Position';
        const department = jobData.department || 'team';
        
        return `• Execute ${title} duties and responsibilities effectively
• Collaborate with ${department} team members and stakeholders
• Analyze and improve existing processes and workflows
• Develop and maintain documentation and best practices
• Provide support and guidance to team members as needed
• Monitor industry trends and recommend innovative solutions
• Ensure compliance with company policies and quality standards
• Participate in meetings, planning sessions, and strategic initiatives`;
    }

    /**
     * Generate fallback skills when AI fails
     */
    _generateFallbackSkills(jobData) {
        const title = jobData.title || 'Position';
        const department = jobData.department || 'General';
        
        const titleSkills = title.toLowerCase().replace(/\s+/g, ',');
        const deptSkills = department.toLowerCase();
        
        return `${titleSkills},${deptSkills},communication,leadership,problem-solving,analytical thinking,project management,teamwork,time management,attention to detail`;
    }

    /**
     * Check if job details need enhancement with AI generation
     * @private
     */
    _needsJobDetailsEnhancement(jobData) {
        const needsEnhancement = [
            this._isPlaceholderContent(jobData.description),
            this._isPlaceholderContent(jobData.requirements),
            this._isPlaceholderContent(jobData.responsibilities),
            !jobData.skills || jobData.skills.length < 20
        ];
        
        const enhancementCount = needsEnhancement.filter(Boolean).length;
        console.log(`📊 Job details enhancement check: ${enhancementCount}/4 fields need enhancement`);
        
        // Need enhancement if at least 2 fields are incomplete
        return enhancementCount >= 2;
    }

    /**
     * Check if content is placeholder/template content
     * @private
     */
    _isPlaceholderContent(content) {
        if (!content || typeof content !== 'string') {
            return true;
        }
        
        const placeholderIndicators = [
            'to be generated',
            'to be determined',
            'detailed job description to be generated',
            'specific requirements to be generated',
            'key responsibilities to be generated',
            'based on the job description',
            content.length < 50, // Very short content is likely placeholder
            content.includes('placeholder'),
            content.includes('template')
        ];
        
        return placeholderIndicators.some(indicator => {
            if (typeof indicator === 'boolean') {
                return indicator;
            }
            return content.toLowerCase().includes(indicator);
        });
    }

    // ===== TOP CANDIDATES FUNCTIONALITY =====

    /**
     * Get top matching candidates for a job
     */
    async processGetTopCandidates(jobIdOrData, options, userContext) {
        console.log(`JobAgent: Processing get_top_candidates with:`, jobIdOrData);
        const organizationId = this._organizationId(userContext);
        if (!organizationId) {
            return { success: false, message: 'Organization context is required for candidate matching.' };
        }
        
        let jobId = null;
        let jobTitle = null;
        
        // Handle different input formats
        if (typeof jobIdOrData === 'string') {
            jobId = jobIdOrData;
        } else if (typeof jobIdOrData === 'object') {
            jobId = jobIdOrData.jobId;
            jobTitle = jobIdOrData.jobTitle;
        }
        
        // If no job ID but we have a job title, try to find the job
        if (!jobId && jobTitle) {
            console.log(`🔍 Searching for job with title: "${jobTitle}"`);
            try {
                const jobs = await this.aiJobService.listJobs({ 
                    search: jobTitle,
                    organization: organizationId,
                    limit: 5 
                });
                
                if (jobs && jobs.length > 0) {
                    // Find exact or best match
                    const exactMatch = jobs.find(job => 
                        job.title.toLowerCase().includes(jobTitle.toLowerCase()) ||
                        jobTitle.toLowerCase().includes(job.title.toLowerCase())
                    );
                    
                    if (exactMatch) {
                        jobId = exactMatch._id.toString();
                        console.log(`✅ Found matching job: ${exactMatch.title} (${jobId})`);
                    } else {
                        return {
                            success: false,
                            message: `❌ **No job found matching "${jobTitle}"**

Available jobs that might be similar:
${jobs.slice(0, 3).map(job => `• **${job.title}** (${job.department})`).join('\n')}

💡 Try being more specific with the job title or create the job first.`
                        };
                    }
                } else {
                    return {
                        success: false,
                        message: `❌ **No job found with title "${jobTitle}"**

Please check the job title or create the job first. You can:
1. Use "show all jobs" to see available positions
2. Create a new job posting
3. Try a different job title`
                    };
                }
            } catch (error) {
                console.error('Error searching for job by title:', error);
                return {
                    success: false,
                    message: `❌ Error searching for job "${jobTitle}": ${error.message}`
                };
            }
        }
        
        if (!jobId) {
            return { 
                success: false, 
                message: "JobAgent: Job ID or job title is required to find matching candidates." 
            };
        }

        try {
            const { 
                topK: rawTopK = 10,
                includeExplanations = true,
                minSimilarity = 0.5 
            } = options || {};
            const topK = Math.min(Math.max(Number.parseInt(rawTopK, 10) || 10, 1), 100);

            console.log(`🔍 Finding top ${topK} candidates for job ${jobId}...`);

            // Get the job first
            const job = await this.aiJobService.getJobById(jobId, organizationId);
            if (!job) {
                return { 
                    success: false, 
                    message: `Job with ID ${jobId} not found.` 
                };
            }

            // Get matching candidates using the existing method
            const matchResult = normalizeMatchingResult(
                await this.aiJobService.getMatchingCandidatesForJob(jobId, topK, organizationId)
            );
            const matches = matchResult.matches;

            if (!matches || matches.length === 0) {
                return {
                    success: true,
                    message: `No matching candidates found for **${job.title}** position.`,
                    data: {
                        jobId,
                        jobTitle: job.title,
                        matches: [],
                        matchCount: 0
                    }
                };
            }

            // Filter by minimum similarity if specified
            const filteredMatches = matches.filter(match => 
                match.similarity >= minSimilarity
            );

            const responseMessage = `🎯 **Found ${filteredMatches.length} top candidates for ${job.title}**

${filteredMatches.slice(0, 6).map((match, index) => {
    const percentage = Math.round(match.similarity * 100);
    const candidate = match.candidate;
    const metadata = match.metadata || {};
    
    // Use proper name formatting - candidate.name is constructed correctly in embeddingService
    const candidateName = candidate.name || 
                         `${metadata.firstName || ''} ${metadata.lastName || ''}`.trim() || 
                         'Name not available';
    
    // Get key strengths from explanation
    let keyStrengths = 'Strong overall match';
    if (match.explanation) {
        const reasons = match.explanation.reasons || match.explanation.topReasons || [];
        if (reasons.length > 0) {
            keyStrengths = reasons.slice(0, 2).join(', ');
        }
    }
    
    return `**${index + 1}. ${candidateName}** (${percentage}% match) 🎯 ${metadata.status || candidate.status || 'Unknown'}
   📧 ${candidate.email || metadata.email || 'Email not available'}
   📱 ${candidate.phone || metadata.phone || 'Phone not available'}  
   💼 ${candidate.position || metadata.position || 'Position not specified'}
   🎓 ${candidate.experience || metadata.experience || 'Experience not specified'}
   📍 ${candidate.location || metadata.location || 'Location not specified'}
   ✨ **Key Strengths:** ${keyStrengths}`;
}).join('\n\n')}

${filteredMatches.length > 6 ? `\n*... and ${filteredMatches.length - 6} more candidates*` : ''}

---

🔍 **Quick Actions:**
• **View detailed analysis** - Say "analyze candidate [name]" for in-depth insights  
• **Contact top candidate** - Get contact details and next steps
• **Compare candidates** - Ask "compare top 3 candidates"
• **Interview questions** - Generate questions for these candidates

💡 Would you like me to show details for any specific candidate or help you with the next steps?`;

            return {
                success: true,
                message: responseMessage,
                data: {
                    jobId,
                    jobTitle: job.title,
                    matches: filteredMatches,
                    matchCount: filteredMatches.length,
                    totalCandidatesFound: matches.length,
                    fromCache: matchResult.fromCache === true,
                    cacheAgeMinutes: matchResult.cacheAgeMinutes ?? null,
                    minSimilarityApplied: minSimilarity,
                    searchCriteria: {
                        topK,
                        includeExplanations,
                        minSimilarity
                    }
                }
            };

        } catch (error) {
            console.error(`JobAgent: Error in processGetTopCandidates for job ID ${jobId}:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to find matching candidates. ${error.message}` 
            };
        }
    }

    // ===== INTERVIEW QUESTIONS FUNCTIONALITY =====

    /**
     * Generate interview questions for a job
     */
    async processGenerateInterviewQuestions(jobId, options, userContext) {
        console.log(`JobAgent: Processing generate_interview_questions for job ID: ${jobId}`);
        
        if (!jobId) {
            return { 
                success: false, 
                message: "JobAgent: Job ID is required to generate interview questions." 
            };
        }

        try {
            const userId = userContext?.userId;
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for generating interview questions.' };
            }
            const {
                stage = 'first_round',
                questionCount = 10,
                difficulty = 'medium',
                includeTypes = ['technical', 'behavioral', 'situational']
            } = options || {};

            console.log(`🤖 Generating ${questionCount} interview questions for job ${jobId}...`);

            // Get the job first to provide context
            const job = await this.aiJobService.getJobById(jobId, organizationId);
            if (!job) {
                return { 
                    success: false, 
                    message: `Job with ID ${jobId} not found.` 
                };
            }

            const generationOptions = {
                stage,
                questionCount: parseInt(questionCount),
                difficulty,
                includeTypes: Array.isArray(includeTypes) ? includeTypes : [includeTypes],
                userId,
                organizationId
            };

            const questions = await this.interviewService.generateQuestionsWithAI(jobId, generationOptions);

            const responseMessage = `✅ **Successfully generated ${questions.length} interview questions for ${job.title}**

**Generation Details:**
- 🎯 **Stage:** ${stage.replace('_', ' ').toUpperCase()}
- 📊 **Difficulty:** ${difficulty.toUpperCase()}
- 🔢 **Count:** ${questions.length} questions
- 📝 **Types:** ${generationOptions.includeTypes.join(', ')}

**Sample Questions:**
${questions.slice(0, 3).map((q, index) => 
    `${index + 1}. **${q.type.replace('_', ' ').toUpperCase()}:** ${q.question}`
).join('\n')}

${questions.length > 3 ? `\n*... and ${questions.length - 3} more questions*` : ''}

💡 The questions are now ready to use for interviews. Would you like me to show more questions or help you organize them by interview stages?`;

            return {
                success: true,
                message: responseMessage,
                data: {
                    jobId,
                    jobTitle: job.title,
                    questions,
                    count: questions.length,
                    generationOptions
                }
            };

        } catch (error) {
            console.error(`JobAgent: Error in processGenerateInterviewQuestions for job ID ${jobId}:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to generate interview questions. ${error.message}` 
            };
        }
    }

    /**
     * Get interview questions for a job
     */
    async processGetInterviewQuestions(jobId, options, userContext) {
        console.log(`JobAgent: Processing get_interview_questions for job ID: ${jobId}`);
        
        if (!jobId) {
            return { 
                success: false, 
                message: "JobAgent: Job ID is required to get interview questions." 
            };
        }

        try {
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for accessing interview questions.' };
            }
            const {
                type,
                stage,
                difficulty
            } = options || {};

            console.log(`🔍 Getting interview questions for job ${jobId}...`);

            // Get the job first to provide context
            const job = await this.aiJobService.getJobById(jobId, organizationId);
            if (!job) {
                return { 
                    success: false, 
                    message: `Job with ID ${jobId} not found.` 
                };
            }

            const filterOptions = {};
            if (type) filterOptions.type = type;
            if (stage) filterOptions.stage = stage;
            if (difficulty) filterOptions.difficulty = difficulty;

            const questions = await this.interviewService.getQuestionsByJob(jobId, filterOptions, organizationId);

            if (!questions || questions.length === 0) {
                return {
                    success: true,
                    message: `📝 **No interview questions found for ${job.title}**

Would you like me to generate some interview questions for this position?

I can create questions for different stages:
- 🔍 **Screening** - Initial phone/video screening
- 💼 **First Round** - In-depth behavioral and technical questions  
- 🛠️ **Technical** - Role-specific technical assessments
- 🎯 **Final** - Culture fit and final decision questions

Just let me know what type of questions you'd like me to create!`,
                    data: {
                        jobId,
                        jobTitle: job.title,
                        questions: [],
                        count: 0
                    }
                };
            }

            // Group questions by type and stage for better presentation
            const questionsByType = {};
            const questionsByStage = {};

            questions.forEach(q => {
                if (!questionsByType[q.type]) questionsByType[q.type] = [];
                if (!questionsByStage[q.interviewStage]) questionsByStage[q.interviewStage] = [];
                
                questionsByType[q.type].push(q);
                questionsByStage[q.interviewStage].push(q);
            });

            let responseMessage = `📝 **Found ${questions.length} interview questions for ${job.title}**\n\n`;

            // Show breakdown by stage
            responseMessage += `**Questions by Interview Stage:**\n`;
            Object.entries(questionsByStage).forEach(([stage, stageQuestions]) => {
                responseMessage += `• **${stage.replace('_', ' ').toUpperCase()}:** ${stageQuestions.length} questions\n`;
            });

            responseMessage += `\n**Questions by Type:**\n`;
            Object.entries(questionsByType).forEach(([type, typeQuestions]) => {
                responseMessage += `• **${type.replace('_', ' ').toUpperCase()}:** ${typeQuestions.length} questions\n`;
            });

            // Show sample questions
            responseMessage += `\n**Sample Questions:**\n`;
            questions.slice(0, 5).forEach((q, index) => {
                responseMessage += `${index + 1}. **[${q.type.replace('_', ' ').toUpperCase()}]** ${q.question}\n`;
            });

            if (questions.length > 5) {
                responseMessage += `\n*... and ${questions.length - 5} more questions*`;
            }

            responseMessage += `\n\n💡 Would you like me to show questions for a specific stage or type, or help you generate additional questions?`;

            return {
                success: true,
                message: responseMessage,
                data: {
                    jobId,
                    jobTitle: job.title,
                    questions,
                    count: questions.length,
                    breakdown: {
                        byType: questionsByType,
                        byStage: questionsByStage
                    },
                    appliedFilters: filterOptions
                }
            };

        } catch (error) {
            console.error(`JobAgent: Error in processGetInterviewQuestions for job ID ${jobId}:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to get interview questions. ${error.message}` 
            };
        }
    }

    /**
     * Create a single interview question
     */
    async processCreateInterviewQuestion(questionData, userContext) {
        console.log(`JobAgent: Processing create_interview_question`);
        
        try {
            const userId = userContext?.userId;
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for creating interview questions.' };
            }
            
            if (!questionData.jobId) {
                return { 
                    success: false, 
                    message: "JobAgent: Job ID is required to create an interview question." 
                };
            }

            if (!questionData.question || questionData.question.trim().length === 0) {
                return { 
                    success: false, 
                    message: "JobAgent: Please provide the interview question text." 
                };
            }

            const question = await this.interviewService.createQuestion(questionData, userId, organizationId);

            return {
                success: true,
                message: `✅ **Interview question created successfully!**

**Question:** ${question.question}
**Type:** ${question.type.replace('_', ' ').toUpperCase()}
**Stage:** ${question.interviewStage.replace('_', ' ').toUpperCase()}
**Difficulty:** ${question.difficulty.toUpperCase()}

The question is now ready to use in your interviews.`,
                data: question
            };

        } catch (error) {
            console.error(`JobAgent: Error in processCreateInterviewQuestion:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to create interview question. ${error.message}` 
            };
        }
    }

    /**
     * Update an interview question
     */
    async processUpdateInterviewQuestion(questionId, updates, userContext) {
        console.log(`JobAgent: Processing update_interview_question for ID: ${questionId}`);
        
        if (!questionId) {
            return { 
                success: false, 
                message: "JobAgent: Question ID is required to update an interview question." 
            };
        }

        try {
            const userId = userContext?.userId;
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for updating interview questions.' };
            }
            const updatedQuestion = await this.interviewService.updateQuestion(questionId, updates, userId, organizationId);

            return {
                success: true,
                message: `✅ **Interview question updated successfully!**

**Updated Question:** ${updatedQuestion.question}
**Type:** ${updatedQuestion.type.replace('_', ' ').toUpperCase()}
**Stage:** ${updatedQuestion.interviewStage.replace('_', ' ').toUpperCase()}

The changes have been saved and are ready to use.`,
                data: updatedQuestion
            };

        } catch (error) {
            console.error(`JobAgent: Error in processUpdateInterviewQuestion for ID ${questionId}:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to update interview question. ${error.message}` 
            };
        }
    }

    /**
     * Delete an interview question
     */
    async processDeleteInterviewQuestion(questionId, userContext) {
        console.log(`JobAgent: Processing delete_interview_question for ID: ${questionId}`);
        
        if (!questionId) {
            return { 
                success: false, 
                message: "JobAgent: Question ID is required to delete an interview question." 
            };
        }

        try {
            const organizationId = this._organizationId(userContext);
            if (!organizationId) {
                return { success: false, message: 'Organization context is required for deleting interview questions.' };
            }
            const result = await this.interviewService.deleteQuestion(questionId, organizationId);

            return {
                success: true,
                message: `✅ **Interview question deleted successfully!**

The question has been permanently removed from the system.

**Deleted Question:** ${result.deletedQuestion.question}`,
                data: result
            };

        } catch (error) {
            console.error(`JobAgent: Error in processDeleteInterviewQuestion for ID ${questionId}:`, error);
            return { 
                success: false, 
                message: `JobAgent: Failed to delete interview question. ${error.message}` 
            };
        }
    }

    // --- AI-Powered Helper Methods ---

    /**
     * Normalizes a given text field to one of the valid enum values using an LLM.
     * @param {AIModelService} aiService - Runtime-backed model service.
     * @param {string} text - The raw text input for the field.
     * @param {string[]} validEnums - An array of valid enum string values.
     * @param {string} fieldNameForPrompt - Descriptive name of the field for the LLM prompt.
     * @param {string} defaultValue - The default value to return if normalization fails or is uncertain.
     * @returns {Promise<string>} The normalized enum value or the default.
     */
    async _normalizeFieldWithAI(aiService, text, validEnums, fieldNameForPrompt, defaultValue) {
        if (!text || typeof text !== 'string' || text.trim() === '') {
            return defaultValue;
        }
        const comparable = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9+]/g, '');
        const directMatch = validEnums.find((value) => comparable(value) === comparable(text));
        if (directMatch) return directMatch;

        const aliases = {
            'job level': {
                junior: 'Entry',
                entrylevel: 'Entry',
                intermediate: 'Mid',
                midlevel: 'Mid',
                seniorlevel: 'Senior',
                teamlead: 'Lead',
                csuite: 'Executive'
            },
            'education level': {
                bachelors: 'Bachelor',
                bachelordegree: 'Bachelor',
                masters: 'Master',
                mastersdegree: 'Master',
                doctorate: 'PhD',
                doctoraldegree: 'PhD',
                secondaryschool: 'High School'
            },
            'years of experience': {
                '0to1years': '0-1',
                '1to3years': '1-3',
                '3to5years': '3-5',
                '5to10years': '5-10',
                '10plusyears': '10+'
            }
        };
        const localAlias = aliases[fieldNameForPrompt]?.[comparable(text)];
        if (localAlias && validEnums.includes(localAlias)) return localAlias;

        const prompt = `Given the ${fieldNameForPrompt}: "${text.substring(0, 200)}"\nMap this to one of the following standard values: ${validEnums.join(', ')}.\nIf unsure or no clear match, default to "${defaultValue}".\nReturn only the single, most appropriate standard value string.`;
        try {
            const serviceToUse = aiService || this.aiModelService;
            const response = await serviceToUse.requestCompletion({
                activity: 'job.normalize',
                promptVersion: 'job-enum-normalize-v1',
                messages: [{ role: 'user', content: prompt }],
                model: serviceToUse.modelName, // Consider using a smaller/faster model if available for such tasks
                temperature: 0.1, // Low temperature for more deterministic output
                max_tokens: 20 // Expecting a short enum string
            });
            const normalizedValue = response.choices[0]?.message?.content?.trim();
            
            // Validate if the LLM returned one of the valid enums
            if (normalizedValue && validEnums.map(e => e.toLowerCase()).includes(normalizedValue.toLowerCase())) {
                // Find the original casing of the enum
                const originalCasedValue = validEnums.find(e => e.toLowerCase() === normalizedValue.toLowerCase());
                console.log(`AI Normalized ${fieldNameForPrompt}: "${text}" -> "${originalCasedValue}"`);
                return originalCasedValue;
            }
            console.warn(`AI normalization for ${fieldNameForPrompt} ("${text}") returned unexpected value: "${normalizedValue}". Defaulting to ${defaultValue}.`);
            return defaultValue;
        } catch (error) {
            console.error(`AI normalization failed for ${fieldNameForPrompt} ("${text}"): ${error.message}. Defaulting to ${defaultValue}.`);
            return defaultValue;
        }
    }

    async _inferDepartmentWithAI(jobTitle, jobDescription) {
        const prompt = `Job Title: "${jobTitle}"
Job Description (optional): "${jobDescription ? jobDescription.substring(0, 500) + '...' : 'Not provided'}"
Based on the above, what is the most appropriate department for this role?
Choose from: Engineering, Marketing, Sales, HR, Product, Operations, Finance, IT, Design, Customer Support, Legal, Research, Other.
If "Other", suggest a more specific department name if possible.
Return only the department name.`;
        try {
            const response = await this.aiModelService.requestCompletion({
                activity: 'job.normalize',
                promptVersion: 'job-department-v1',
                messages: [{ role: 'user', content: prompt }],
                model: this.aiModelService.modelName,
                temperature: 0.2,
                max_tokens: 20
            });
            const department = response.choices[0]?.message?.content?.trim();
            if (department) {
                console.log(`AI Inferred Department for "${jobTitle}": "${department}"`);
                return department;
            }
            return 'General'; // Fallback
        } catch (error) {
            console.error(`AI department inference failed for "${jobTitle}": ${error.message}. Defaulting to General.`);
            return 'General';
        }
    }

    async _inferLocationWithAI(jobTitle, jobDescription, userInputLocation) {
        const prompt = `User Input for Location: "${userInputLocation || 'Not provided'}"
Job Title: "${jobTitle}"
Job Description (optional): "${jobDescription ? jobDescription.substring(0, 500) + '...' : 'Not provided'}"
Standardize this location. If it's a physical location, provide "City, State/Country" (e.g., "San Francisco, CA", "London, UK").
If remote, specify "Remote". If hybrid, specify "Hybrid - City, State/Country".
If no clear location can be determined from the input, return "To be determined".
Return only the standardized location string.`;
        try {
            const response = await this.aiModelService.requestCompletion({
                activity: 'job.normalize',
                promptVersion: 'job-location-v1',
                messages: [{ role: 'user', content: prompt }],
                model: this.aiModelService.modelName,
                temperature: 0.2,
                max_tokens: 30
            });
            const location = response.choices[0]?.message?.content?.trim();
            if (location && location.toLowerCase() !== 'to be determined' && location.length > 2) {
                console.log(`AI Inferred/Standardized Location for "${jobTitle}": "${location}"`);
                return location;
            }
            return userInputLocation || 'To be determined'; // Fallback to original or placeholder
        } catch (error) {
            console.error(`AI location inference failed for "${jobTitle}": ${error.message}. Defaulting.`);
            return userInputLocation || 'To be determined';
        }
    }

    async _parseSalaryWithAI(salaryText) {
        if (!salaryText || typeof salaryText !== 'string' || salaryText.trim() === '') {
            return null;
        }
        const prompt = `Salary Description: "${salaryText}"
Parse this into a JSON object with fields: "min" (integer, e.g., 70000), "max" (integer, optional, e.g., 90000), "currency" (3-letter code, e.g., USD, EUR, GBP), "period" (e.g., annually, monthly, hourly).
If only one number is mentioned, use it for both min and max.
If currency or period is unclear, use reasonable defaults (USD, annually).
If no parsable salary numbers are found, return an object with null for all four fields.
Ensure min and max are numbers, not strings.
Return only the JSON object.`;
        try {
            const response = await this.aiModelService.requestStructuredCompletion({
                activity: 'job.normalize',
                promptVersion: 'job-salary-v2',
                messages: [{ role: 'user', content: prompt }],
                model: this.aiModelService.modelName,
                temperature: 0.1,
                max_tokens: 100
            }, { schema: SALARY_SCHEMA, schemaName: 'job_salary', schemaStrict: true });
            const content = response.choices[0]?.message?.content?.trim();
            if (content && content.toLowerCase() !== 'null') {
                // The runtime has already validated this against the salary schema.
                try {
                    const parsedSalary = JSON.parse(content);
                    // Basic validation
                    if (typeof parsedSalary.min === 'number' && parsedSalary.currency && parsedSalary.period) {
                        parsedSalary.max = typeof parsedSalary.max === 'number' ? parsedSalary.max : parsedSalary.min;
                         // Ensure min/max are integers
                        parsedSalary.min = parseInt(parsedSalary.min);
                        parsedSalary.max = parseInt(parsedSalary.max);
                        console.log(`AI Parsed Salary from "${salaryText}":`, parsedSalary);
                        return parsedSalary;
                    }
                } catch (e) {
                    console.warn(`AI salary parsing for "${salaryText}" returned non-JSON or invalid JSON: "${content}". Error: ${e.message}`);
                }
            }
            return null;
        } catch (error) {
            console.error(`AI salary parsing failed for "${salaryText}": ${error.message}.`);
            return null;
        }
    }
}

module.exports = JobAgent;
module.exports.normalizeMatchingResult = normalizeMatchingResult;
