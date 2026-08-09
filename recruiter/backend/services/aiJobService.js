// backend/services/aiJobService.js
// This service will be used by the JobAgent to interact with the database
// and embedding services for job-related operations.

const Job = require('../models/Job');
const Department = require('../models/Department');
const Notification = require('../models/Notification');
const embeddingService = require('./embeddingService');
const AIModelService = require('./aiModelService');
const mongoose = require('mongoose');

class AiJobService {
    constructor() {
        this.aiModelService = new AIModelService();
        console.log('AiJobService initialized');
    }

    _requireOrganizationId(organizationId) {
        if (!organizationId) {
            const error = new Error('Organization context is required');
            error.code = 'ORGANIZATION_CONTEXT_REQUIRED';
            throw error;
        }
        return organizationId;
    }

    async _invalidateMatchingCaches(jobId) {
        const aiMatchCacheService = require('./aiMatchCacheService');
        const gptAnalysisService = require('./gptAnalysisService');
        await aiMatchCacheService.invalidateJobCache(jobId);
        gptAnalysisService.cache.invalidateJob(jobId);
    }

    _escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    async _resolveDepartmentId(organizationId, departmentValue, { required = true } = {}) {
        const tenantId = this._requireOrganizationId(organizationId);
        const rawValue = departmentValue && typeof departmentValue === 'object'
            ? (departmentValue._id || departmentValue.id || departmentValue.name)
            : departmentValue;

        if (!rawValue) {
            if (!required) return null;
            const error = new Error('Department is required');
            error.code = 'DEPARTMENT_REQUIRED';
            throw error;
        }

        const departmentQuery = mongoose.isValidObjectId(rawValue)
            ? { _id: rawValue, organization: tenantId, isActive: { $ne: false } }
            : {
                organization: tenantId,
                name: { $regex: new RegExp(`^${this._escapeRegex(String(rawValue).trim())}$`, 'i') },
                isActive: { $ne: false }
            };
        const department = await Department.findOne(departmentQuery).select('_id name');
        if (!department) {
            if (!required) return null;
            const error = new Error(`Department "${String(rawValue)}" was not found in the active organization`);
            error.code = 'DEPARTMENT_NOT_FOUND';
            throw error;
        }
        return department._id;
    }

    /**
     * Creates a new job and its embedding.
     * @param {object} jobData - The complete and validated job data from JobAgent.
     * @param {string} [userId] - Optional ID of the user creating the job.
     * @returns {Promise<object>} The created job object.
     * @throws {Error} If job creation or embedding fails.
     */
    async createJobAndEmbed(jobData, userId) {
        console.log(`[AiJobService] Attempting to create job with title: ${jobData.title}`);
        try {
            const organizationId = this._requireOrganizationId(jobData.organization);
            const jobToCreate = {
                ...jobData,
                organization: organizationId,
                createdBy: userId || null, // Handled by JobAgent's userContext
                uploadMetadata: jobData.uploadMetadata || { source: 'agent' }, // Default source if not provided
            };
            jobToCreate.department = await this._resolveDepartmentId(organizationId, jobData.department);

            // Remove createdBy if it's null and not explicitly required by schema
            if (!jobToCreate.createdBy && Job.schema.paths.createdBy?.isRequired === false) {
                delete jobToCreate.createdBy;
            }
            
            // Handle salary data structure from enhanced AI extraction
            if (jobData.salary && typeof jobData.salary === 'object' && (jobData.salary.min || jobData.salary.max)) {
                jobToCreate.salary = {
                    min: parseInt(jobData.salary.min) || 0,
                    max: parseInt(jobData.salary.max) || 0,
                    currency: jobData.salary.currency || 'USD', // Default to USD for AI-extracted jobs
                    period: jobData.salary.period || 'annually', // Default from Job model
                };
                console.log(`[AiJobService] 💰 Processed salary data:`, jobToCreate.salary);
            } else {
                // If no salary info, ensure it's not an empty object if schema doesn't allow
                delete jobToCreate.salary; 
            }
            
            // Handle additional fields from comprehensive job description extraction - DYNAMIC HANDLING
            if (jobData.benefits) {
                if (typeof jobData.benefits === 'string' && jobData.benefits.trim()) {
                    jobToCreate.benefits = jobData.benefits.trim();
                } else if (Array.isArray(jobData.benefits) && jobData.benefits.length > 0) {
                    jobToCreate.benefits = jobData.benefits.join(', ');
                } else if (typeof jobData.benefits === 'object' && jobData.benefits !== null) {
                    jobToCreate.benefits = JSON.stringify(jobData.benefits);
                }
            }
            
            if (jobData.skills) {
                if (typeof jobData.skills === 'string' && jobData.skills.trim()) {
                    jobToCreate.skills = jobData.skills.trim();
                } else if (Array.isArray(jobData.skills) && jobData.skills.length > 0) {
                    jobToCreate.skills = jobData.skills.join(', ');
                } else if (typeof jobData.skills === 'object' && jobData.skills !== null) {
                    jobToCreate.skills = JSON.stringify(jobData.skills);
                }
            }
            
            if (jobData.companyDescription) {
                if (typeof jobData.companyDescription === 'string' && jobData.companyDescription.trim()) {
                    jobToCreate.companyDescription = jobData.companyDescription.trim();
                } else if (Array.isArray(jobData.companyDescription) && jobData.companyDescription.length > 0) {
                    jobToCreate.companyDescription = jobData.companyDescription.join(', ');
                } else if (typeof jobData.companyDescription === 'object' && jobData.companyDescription !== null) {
                    jobToCreate.companyDescription = JSON.stringify(jobData.companyDescription);
                }
            }

            // Handle date fields if they exist
            if (jobData.applicationDeadline) {
                jobToCreate.applicationDeadline = new Date(jobData.applicationDeadline);
            }
            if (jobData.startDate) {
                jobToCreate.startDate = new Date(jobData.startDate);
            }

            const job = new Job(jobToCreate);
            await job.save();
            console.log(`[AiJobService] Job saved successfully: ${job.title} (ID: ${job._id})`);

            // Create activity notification for all organization members
            try {
                await Notification.createJobCreatedNotification(userId, job);
                console.log(`[AiJobService] 📢 Job creation notifications sent to organization for: ${job.title}`);
            } catch (notificationError) {
                console.error(`[AiJobService] ⚠️ Failed to create notifications for job ${job._id}:`, notificationError.message);
                // Don't fail job creation if notification fails
            }

            // Create embedding in background (following jobController.js pattern)
            try {
                await embeddingService.createJobEmbedding(job);
                    job.isEmbedded = true;
                    job.embeddingCreatedAt = new Date();
                    await job.save();
                console.log(`[AiJobService] Job embedding created for: ${job.title}`);
            } catch (embeddingError) {
                console.error(`[AiJobService] WARNING: Failed to create embedding for job ${job._id}:`, embeddingError.message);
                // Don't fail the job creation if embedding fails
            }

            return job.toObject({ virtuals: true }); // Return with virtuals
        } catch (error) {
            console.error(`[AiJobService] Error creating job: ${jobData.title}`, error);
            throw new Error(`Failed to create job in AiJobService: ${error.message}`);
        }
    }

    // --- Placeholder for other methods to be implemented based on AI_JOB_AGENT_REFACTOR_PLAN.md ---

    /**
     * Lists jobs based on filter parameters.
     * @param {object} filterParams - Filters for status, department, type, search.
     * @returns {Promise<Array<object>>} Array of job objects.
     */
    async listJobs(filterParams = {}) {
        console.log('[AiJobService] Listing jobs with filters:', filterParams);
        try {
            const {
                status,
                department,
                type,
                title,
                search,
                organization,
                organizationId,
                limit = 20,
                page = 1
            } = filterParams;
            const tenantId = this._requireOrganizationId(organization || organizationId);
            const query = { organization: tenantId };

            // Status filter (exact match)
            if (status) query.status = status;
            
            // Department filter (case-insensitive regex)
            if (department) {
                const departmentId = await this._resolveDepartmentId(tenantId, department, { required: false });
                if (!departmentId) return [];
                query.department = departmentId;
            }
            
            // Type filter (exact match)
            if (type) query.type = type;
            
            // Title filter (case-insensitive regex) - NEW
            if (title) {
                query.title = new RegExp(this._escapeRegex(title), 'i');
                console.log(`[AiJobService] 🎯 Filtering by job title: "${title}"`);
            }
            
            // Search filter (searches across multiple fields)
            if (search) {
                const safeSearch = new RegExp(this._escapeRegex(search), 'i');
                query.$or = [
                    { title: safeSearch },
                    { description: safeSearch },
                    { location: safeSearch },
                ];
            }
            
            console.log(`[AiJobService] 🔍 MongoDB query:`, JSON.stringify(query, null, 2));
            
            // Basic pagination can be added here if needed, or handled by JobAgent
            const jobs = await Job.find(query)
                .populate('hiringManager', 'firstName lastName email') // Example population
                .sort({ createdAt: -1 })
                .limit(parseInt(limit))
                .skip((parseInt(page) - 1) * parseInt(limit));
            
            console.log(`[AiJobService] Found ${jobs.length} jobs matching filters.`);
            
            // Log job titles for debugging
            if (jobs.length > 0) {
                console.log(`[AiJobService] 📋 Job titles found:`, jobs.map(job => job.title));
            }
            
            return jobs.map(job => job.toObject({ virtuals: true }));
        } catch (error) {
            console.error('[AiJobService] Error listing jobs:', error);
            throw new Error(`Failed to list jobs in AiJobService: ${error.message}`);
        }
    }

    /**
     * Gets a specific job by its ID.
     * @param {string} jobId - The ID of the job.
     * @returns {Promise<object|null>} The job object or null if not found.
     */
    async getJobById(jobId, organizationId) {
        console.log(`[AiJobService] Getting job by ID: ${jobId}`);
        try {
            const tenantId = this._requireOrganizationId(organizationId);
            const job = await Job.findOne({ _id: jobId, organization: tenantId })
                .populate('hiringManager', 'firstName lastName email'); // Example population
            
            if (!job) {
                console.log(`[AiJobService] Job not found with ID: ${jobId}`);
                return null;
            }
            console.log(`[AiJobService] Job found: ${job.title}`);
            return job.toObject({ virtuals: true });
        } catch (error) {
            console.error(`[AiJobService] Error getting job by ID ${jobId}:`, error);
            throw new Error(`Failed to get job by ID in AiJobService: ${error.message}`);
        }
    }

    /**
     * Updates an existing job and its embedding.
     * @param {string} jobId - The ID of the job to update.
     * @param {object} updateData - The data to update, from JobAgent.
     * @param {string} [userId] - Optional ID of the user updating the job.
     * @returns {Promise<object|null>} The updated job object or null if not found.
     */
    async updateJobAndEmbed(jobId, updateData, userId, organizationId) {
        console.log(`[AiJobService] Updating job ID: ${jobId}`);
        try {
            const tenantId = this._requireOrganizationId(organizationId);
            const dataToUpdate = {
                ...updateData,
                updatedBy: userId || null,
                // updatedAt is handled by Mongoose pre-save hook in JobSchema
            };
            delete dataToUpdate.organization;
            if (Object.prototype.hasOwnProperty.call(updateData, 'department')) {
                dataToUpdate.department = await this._resolveDepartmentId(tenantId, updateData.department);
            }

            // Handle date fields if they exist in updateData
            if (dataToUpdate.applicationDeadline) {
                dataToUpdate.applicationDeadline = new Date(dataToUpdate.applicationDeadline);
            }
            if (dataToUpdate.startDate) {
                dataToUpdate.startDate = new Date(dataToUpdate.startDate);
            }
            
            // Ensure salary is structured correctly or can be unset
            if (updateData.hasOwnProperty('salary')) { // Check if salary key is explicitly provided
                if (updateData.salary && (updateData.salary.min || updateData.salary.max)) {
                    dataToUpdate.salary = {
                        min: updateData.salary.min || 0,
                        max: updateData.salary.max || 0,
                        currency: updateData.salary.currency || 'NGN',
                        period: updateData.salary.period || 'annually',
                    };
                } else {
                    // If salary is provided as null or empty object, allow unsetting it
                    dataToUpdate.salary = undefined; // Or handle as per schema requirements for unsetting
                }
            }


            const job = await Job.findOneAndUpdate(
                { _id: jobId, organization: tenantId },
                dataToUpdate,
                { new: true, runValidators: true }
            );

            if (!job) {
                console.log(`[AiJobService] Job not found with ID: ${jobId} for update.`);
                return null;
            }
            console.log(`[AiJobService] Job updated successfully: ${job.title}`);

            // Update embedding in background (following jobController.js pattern)
            // For simplicity, re-embedding on any update. Could be optimized.
            try {
                await embeddingService.createJobEmbedding(job);
                job.isEmbedded = true;
                job.embeddingCreatedAt = new Date();
                await job.save();
                    console.log(`[AiJobService] Job embedding updated for: ${job.title}`);
            } catch (embeddingError) {
                    console.error(`[AiJobService] WARNING: Failed to update embedding for job ${job._id}:`, embeddingError.message);
                // Don't fail the update if embedding fails
            }

            await this._invalidateMatchingCaches(job._id);
            
            return job.toObject({ virtuals: true });
        } catch (error) {
            console.error(`[AiJobService] Error updating job ID ${jobId}:`, error);
            throw new Error(`Failed to update job in AiJobService: ${error.message}`);
        }
    }

    /**
     * Deletes a job and its embedding.
     * @param {string} jobId - The ID of the job to delete.
     * @returns {Promise<boolean>} True if successful, false otherwise.
     */
    async deleteJobAndEmbed(jobId, organizationId) {
        console.log(`[AiJobService] Deleting job ID: ${jobId}`);
        try {
            const tenantId = this._requireOrganizationId(organizationId);
            const job = await Job.findOne({ _id: jobId, organization: tenantId });
            if (!job) {
                console.log(`[AiJobService] Job not found with ID: ${jobId} for deletion.`);
                return false;
            }

            // Delete embedding from vector store first
            try {
                await embeddingService.deleteEmbedding(jobId, embeddingService.jobIndexName);
                console.log(`[AiJobService] Job embedding deleted from vector store for job: ${jobId}`);
            } catch (embeddingError) {
                console.warn(`[AiJobService] WARNING: Failed to delete job embedding for ${jobId}:`, embeddingError.message);
                // Continue with DB deletion even if embedding deletion fails
            }

            await Job.deleteOne({ _id: jobId, organization: tenantId });
            await this._invalidateMatchingCaches(jobId);
            console.log(`[AiJobService] Job deleted successfully from DB: ${job.title}`);
            return true;
        } catch (error) {
            console.error(`[AiJobService] Error deleting job ID ${jobId}:`, error);
            throw new Error(`Failed to delete job in AiJobService: ${error.message}`);
        }
    }

    /**
     * Gets the embedding status of a job.
     * @param {string} jobId - The ID of the job.
     * @returns {Promise<object>} Object with embedding status.
     */
    async getJobEmbeddingStatus(jobId) {
        console.log(`[AiJobService] Getting embedding status for job ID: ${jobId}`);
        try {
            const job = await Job.findById(jobId).select('isEmbedded embeddingCreatedAt');
            if (!job) {
                throw new Error('Job not found');
            }

            const vectorIndexExists = await embeddingService.checkEmbeddingExists(jobId, embeddingService.jobIndexName);
            
            return {
                jobId: job._id,
                isEmbeddedInDB: job.isEmbedded,
                embeddingCreatedAt: job.embeddingCreatedAt,
                vectorIndexExists,
                isConsistent: job.isEmbedded === vectorIndexExists
            };
        } catch (error) {
            console.error(`[AiJobService] Error getting embedding status for job ID ${jobId}:`, error);
            throw new Error(`Failed to get job embedding status: ${error.message}`);
        }
    }

    /**
     * Finds matching candidates for a given job.
     * @param {string} jobId - The ID of the job.
     * @param {number} [topK=10] - Number of matches to return.
     * @param {string} organizationId - Active organization scope.
     * @returns {Promise<{matches: Array<object>}>} Cache-aware matching result.
     */
    async getMatchingCandidatesForJob(jobId, topK = 10, organizationId) {
        console.log(`[AiJobService] Getting matching candidates for job ID: ${jobId}, topK: ${topK}`);
        try {
            const tenantId = this._requireOrganizationId(organizationId);
            const job = await Job.findOne({ _id: jobId, organization: tenantId });
            if (!job) {
                throw new Error('Job not found');
            }
            // Uses the enhanced method from embeddingService
            const requestedTopK = Math.min(Math.max(Number.parseInt(topK, 10) || 10, 1), 100);
            return await embeddingService.findMatchingCandidatesWithExplanation(job, requestedTopK);
        } catch (error) {
            console.error(`[AiJobService] Error getting matching candidates for job ID ${jobId}:`, error);
            throw new Error(`Failed to get matching candidates: ${error.message}`);
        }
    }
    
    /**
     * Generate comprehensive job details using the managed AI runtime.
     * Creates description, requirements, responsibilities, and skills based on job basics.
     * @param {object} promptData - Basic job data (title, department, level, etc.).
     * @returns {Promise<object>} Generated job details.
     */
    async generateJobDetailsWithAzureAI(promptData) {
        console.log('[AiJobService] Generating comprehensive job details.');
        try {
            const { title, department, location, level, type, experience, education, existingDescription } = promptData;
            
            // Use the shared model service, which returns structured job data.
            console.log('[AiJobService] Calling the managed AI runtime for comprehensive job generation.');
            const jobGenerationResult = await this.aiModelService.generateJobDescription(promptData);
            
            if (!jobGenerationResult.success) {
                console.error('[AiJobService] AI generation failed:', jobGenerationResult.error);
                const error = new Error(jobGenerationResult.error || 'AI generation failed');
                error.code = jobGenerationResult.code;
                error.statusCode = jobGenerationResult.statusCode;
                error.retryable = jobGenerationResult.retryable === true;
                throw error;
            }
            
            console.log('[AiJobService] AI runtime responded successfully.');
            console.log('[AiJobService] 📊 Response structure:', Object.keys(jobGenerationResult));

            // Extract the generated content - the generateJobDescription method returns structured data
            let generatedContent = jobGenerationResult;
            
            // Handle supported structured response formats.
            if (jobGenerationResult.extractedFields) {
                generatedContent = jobGenerationResult.extractedFields;
            } else if (jobGenerationResult.jobDescription) {
                generatedContent = jobGenerationResult.jobDescription;
            }

            console.log('[AiJobService] 🔍 Generated content keys:', Object.keys(generatedContent));
            
            // Validate and structure the response
            const comprehensiveJobDetails = {
                description: this._processDescription(generatedContent.description, promptData),
                requirements: this._processRequirements(generatedContent.requirements, promptData),
                responsibilities: this._processResponsibilities(generatedContent.responsibilities, promptData),
                skills: this._processSkills(generatedContent.skills, promptData)
            };

            console.log('[AiJobService] ✅ Successfully processed comprehensive job details:', {
                hasDescription: !!comprehensiveJobDetails.description,
                hasRequirements: !!comprehensiveJobDetails.requirements,
                hasResponsibilities: !!comprehensiveJobDetails.responsibilities,
                hasSkills: !!comprehensiveJobDetails.skills,
                descriptionLength: comprehensiveJobDetails.description?.length || 0,
                requirementsLength: comprehensiveJobDetails.requirements?.length || 0,
                responsibilitiesLength: comprehensiveJobDetails.responsibilities?.length || 0
            });
            
            return comprehensiveJobDetails;

        } catch (error) {
            console.error('[AiJobService] Error generating comprehensive job details:', error);
            
            // This path is explicitly presented as AI generation. Propagate
            // runtime/account failures so callers can show the connection or
            // retry action instead of silently labelling canned copy as AI.
            throw error;
        }
    }

    /**
     * Process and format job description from AI response
     * @private
     */
    _processDescription(description, promptData) {
        if (description && typeof description === 'string' && description.trim().length > 50) {
            return description.trim();
        }
        
        // Fallback description
        const { title, department, location, level } = promptData;
        return `We are seeking a ${level} ${title} to join our ${department} team in ${location}. This role offers an exciting opportunity to contribute to our organization's success while developing your career in ${department}.`;
    }

    /**
     * Process and format requirements from AI response
     * @private
     */
    _processRequirements(requirements, promptData) {
        if (requirements) {
            if (Array.isArray(requirements) && requirements.length > 0) {
                return requirements.map(req => req.startsWith('•') ? req : `• ${req}`).join('\n');
            } else if (typeof requirements === 'string' && requirements.trim().length > 20) {
                // If it's already formatted with bullets, return as is
                if (requirements.includes('•') || requirements.includes('-')) {
                    return requirements.trim();
                } else {
                    // Split by newlines and add bullets
                    return requirements.split('\n')
                        .map(req => req.trim())
                        .filter(req => req.length > 0)
                        .map(req => req.startsWith('•') ? req : `• ${req}`)
                        .join('\n');
                }
            }
        }
        
        // Fallback requirements
        const { experience, education, department } = promptData;
        return `• ${education} degree in ${department} or related field\n• ${experience} of relevant professional experience\n• Strong analytical and problem-solving skills\n• Excellent communication abilities`;
    }

    /**
     * Process and format responsibilities from AI response
     * @private
     */
    _processResponsibilities(responsibilities, promptData) {
        if (responsibilities) {
            if (Array.isArray(responsibilities) && responsibilities.length > 0) {
                return responsibilities.map(resp => resp.startsWith('•') ? resp : `• ${resp}`).join('\n');
            } else if (typeof responsibilities === 'string' && responsibilities.trim().length > 20) {
                // If it's already formatted with bullets, return as is
                if (responsibilities.includes('•') || responsibilities.includes('-')) {
                    return responsibilities.trim();
                } else {
                    // Split by newlines and add bullets
                    return responsibilities.split('\n')
                        .map(resp => resp.trim())
                        .filter(resp => resp.length > 0)
                        .map(resp => resp.startsWith('•') ? resp : `• ${resp}`)
                        .join('\n');
                }
            }
        }
        
        // Fallback responsibilities
        const { title, department } = promptData;
        return `• Execute ${title} duties and responsibilities effectively\n• Collaborate with ${department} team members\n• Analyze and improve existing processes\n• Develop and maintain documentation`;
    }

    /**
     * Process and format skills from AI response
     * @private
     */
    _processSkills(skills, promptData) {
        if (skills) {
            if (Array.isArray(skills) && skills.length > 0) {
                return skills.join(',');
            } else if (typeof skills === 'string' && skills.trim().length > 5) {
                return skills.trim();
            }
        }
        
        // Fallback skills
        const { title, department } = promptData;
        const titleSkills = title.toLowerCase().replace(/\s+/g, ',');
        const deptSkills = department.toLowerCase();
        return `${titleSkills},${deptSkills},communication,leadership,problem-solving,analytical thinking,project management,teamwork`;
    }

    /**
     * Generate fallback content when AI generation fails
     * @private
     */
    _generateFallbackContent(promptData) {
        const { title, department, location, level, type, experience, education } = promptData;
        
        return {
            description: `We are seeking a ${level} ${title} to join our ${department} team in ${location}. This ${type} position offers an exciting opportunity to contribute to our organization's success while developing your career in ${department}.

The ideal candidate will bring ${experience} of relevant experience and demonstrate strong technical and leadership capabilities. You will work in a collaborative environment with opportunities for professional growth and development.

Join our dynamic team and make a meaningful impact in the ${department} field while advancing your career with a forward-thinking organization.`,

            requirements: `• ${education} degree in relevant field
• ${experience} of professional experience in ${department} or related area
• Strong analytical and problem-solving skills
• Excellent communication and interpersonal abilities
• Proficiency in relevant tools and technologies
• Ability to work independently and as part of a team
• Strong attention to detail and organizational skills`,

            responsibilities: `• Lead and execute ${title} initiatives and projects
• Collaborate with cross-functional teams across the organization
• Analyze and improve existing processes and procedures
• Develop and maintain documentation and best practices
• Provide guidance and support to team members
• Monitor industry trends and recommend innovative solutions
• Ensure compliance with company policies and standards
• Participate in strategic planning and decision-making processes`,

            skills: `${title.toLowerCase().replace(/\s+/g, ',')},${department.toLowerCase()},communication,leadership,problem-solving,analytical thinking,project management,teamwork`
        };
    }
}

module.exports = AiJobService;
