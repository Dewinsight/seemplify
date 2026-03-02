// backend/services/aiCandidateService.js
// This service will be used by the CandidateAgent to interact with the database
// and embedding services for candidate-related operations.

const Candidate = require('../models/Candidate');
const embeddingService = require('./embeddingService');
const AzureOpenAIService = require('./azureOpenAIService');

class AiCandidateService {
    constructor() {
        this.azureOpenAIService = new AzureOpenAIService();
        console.log('AiCandidateService initialized');
    }

    /**
     * Builds searchable text from candidate data.
     * @param {object} candidate - The candidate object.
     * @returns {string} Searchable text.
     */
    buildCandidateSearchText(candidate) {
        const parts = [
            `Name: ${candidate.firstName} ${candidate.lastName}`,
            `Email: ${candidate.email}`,
            `Position: ${candidate.position}`,
            `Experience: ${candidate.experience}`,
            `Education: ${candidate.education}`,
            `Skills: ${candidate.skills || 'Not specified'}`,
            `Location: ${candidate.location || 'Not specified'}`,
            `Status: ${candidate.status}`,
            `Source: ${candidate.source}`,
        ];

        if (candidate.resumeText) {
            parts.push(`Resume: ${candidate.resumeText}`);
        }

        if (candidate.coverLetter) {
            parts.push(`Cover Letter: ${candidate.coverLetter}`);
        }

        if (candidate.notes && candidate.notes.length > 0) {
            const allNotes = candidate.notes.map(note => note.note).join(' ');
            parts.push(`Notes: ${allNotes}`);
        }

        return parts.join('\n');
    }

    /**
     * Searches candidates using vector similarity.
     * @param {string} query - The search query.
     * @param {object} [filters] - Additional filters.
     * @param {number} [limit=10] - Maximum number of results.
     * @returns {Promise<Array>} Array of candidate results with scores.
     */
    async searchCandidatesByDescription(query, filters = {}, limit = 10) {
        console.log(`[AiCandidateService] Searching candidates with query: "${query}"`);
        
        try {
            // Use embedding service to find similar candidates
            const results = await embeddingService.searchSimilar(query, {
                type: 'candidate',
                ...filters
            }, limit);

            console.log(`[AiCandidateService] Found ${results.length} candidate matches`);

            // Get full candidate data for the results
            const candidateIds = results.map(result => result.metadata.candidateId);
            const candidates = await Candidate.find({ _id: { $in: candidateIds } });

            // Combine with similarity scores
            const enrichedResults = results.map(result => {
                const candidate = candidates.find(c => c._id.toString() === result.metadata.candidateId);
                return {
                    candidate,
                    score: result.score,
                    metadata: result.metadata
                };
            }).filter(result => result.candidate); // Remove any null candidates

            return enrichedResults;
        } catch (error) {
            console.error('[AiCandidateService] Error searching candidates:', error);
            // Fallback to simple text search
            return await this.fallbackCandidateSearch(query, filters, limit);
        }
    }

    /**
     * Fallback search using MongoDB text search or regex.
     * @param {string} query - The search query.
     * @param {object} [filters] - Additional filters.
     * @param {number} [limit=10] - Maximum number of results.
     * @returns {Promise<Array>} Array of candidates.
     */
    async fallbackCandidateSearch(query, filters = {}, limit = 10) {
        console.log(`[AiCandidateService] Using fallback search for: "${query}"`);
        
        const searchFilters = { ...filters };
        
        // Create regex pattern for flexible matching
        const regex = new RegExp(query.split(' ').join('|'), 'i');
        
        searchFilters.$or = [
            { firstName: regex },
            { lastName: regex },
            { position: regex },
            { skills: regex },
            { education: regex },
            { location: regex },
            { resumeText: regex }
        ];

        const candidates = await Candidate.find(searchFilters).limit(limit);
        
        return candidates.map(candidate => ({
            candidate,
            score: 0.5, // Default score for fallback
            metadata: {
                type: 'candidate',
                candidateId: candidate._id.toString(),
                searchMethod: 'fallback'
            }
        }));
    }

    /**
     * Gets all candidates with pagination.
     * @param {number} [page=1] - Page number.
     * @param {number} [limit=50] - Number of candidates per page.
     * @param {object} [filters] - Additional filters.
     * @returns {Promise<object>} Paginated candidates with metadata.
     */
    async getAllCandidates(page = 1, limit = 50, filters = {}) {
        console.log(`[AiCandidateService] Getting all candidates - Page: ${page}, Limit: ${limit}`);
        
        try {
            const skip = (page - 1) * limit;
            const totalCandidates = await Candidate.countDocuments(filters);
            const candidates = await Candidate.find(filters)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            return {
                candidates,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalCandidates / limit),
                    totalCandidates,
                    hasNextPage: page < Math.ceil(totalCandidates / limit),
                    hasPrevPage: page > 1
                }
            };
        } catch (error) {
            console.error('[AiCandidateService] Error getting all candidates:', error);
            throw new Error(`Failed to get candidates: ${error.message}`);
        }
    }

    /**
     * Gets a candidate by ID.
     * @param {string} candidateId - The candidate ID.
     * @returns {Promise<object|null>} The candidate object or null.
     */
    async getCandidateById(candidateId) {
        console.log(`[AiCandidateService] Getting candidate by ID: ${candidateId}`);
        
        try {
            const candidate = await Candidate.findById(candidateId);
            return candidate;
        } catch (error) {
            console.error('[AiCandidateService] Error getting candidate by ID:', error);
            return null;
        }
    }

    /**
     * Updates a candidate.
     * @param {string} candidateId - The candidate ID.
     * @param {object} updateData - The data to update.
     * @param {string} [userId] - ID of the user making the update.
     * @returns {Promise<object|null>} The updated candidate or null.
     */
    async updateCandidate(candidateId, updateData, userId) {
        console.log(`[AiCandidateService] Updating candidate: ${candidateId}`);
        
        try {
            const updatedCandidate = await Candidate.findByIdAndUpdate(
                candidateId,
                { 
                    ...updateData, 
                    updatedBy: userId,
                    updatedAt: new Date()
                },
                { new: true }
            );

            if (updatedCandidate) {
                // Update embedding if candidate was found and updated
                // await this.createCandidateEmbedding(updatedCandidate);
                console.log(`[AiCandidateService] ✅ Candidate updated successfully: ${candidateId}`);
            }

            return updatedCandidate;
        } catch (error) {
            console.error('[AiCandidateService] Error updating candidate:', error);
            throw new Error(`Failed to update candidate: ${error.message}`);
        }
    }

    /**
     * Deletes a candidate.
     * @param {string} candidateId - The candidate ID.
     * @returns {Promise<boolean>} True if deleted successfully.
     */
    async deleteCandidate(candidateId) {
        console.log(`[AiCandidateService] Deleting candidate: ${candidateId}`);
        
        try {
            const result = await Candidate.findByIdAndDelete(candidateId);
            
            if (result) {
                // Also delete the embedding
                // await embeddingService.deleteEmbedding({
                //     type: 'candidate',
                //     candidateId: candidateId
                // });
                console.log(`[AiCandidateService] ✅ Candidate deleted successfully: ${candidateId}`);
            }

            return !!result;
        } catch (error) {
            console.error('[AiCandidateService] Error deleting candidate:', error);
            throw new Error(`Failed to delete candidate: ${error.message}`);
        }
    }

    /**
     * Adds a note to a candidate.
     * @param {string} candidateId - The candidate ID.
     * @param {string} noteText - The note text.
     * @param {string} [userId] - ID of the user adding the note.
     * @returns {Promise<object|null>} The updated candidate or null.
     */
    async addNoteToCandidate(candidateId, noteText, userId) {
        console.log(`[AiCandidateService] Adding note to candidate: ${candidateId}`);
        
        try {
            const candidate = await Candidate.findByIdAndUpdate(
                candidateId,
                {
                    $push: {
                        notes: {
                            note: noteText,
                            date: new Date()
                        }
                    },
                    updatedBy: userId,
                    updatedAt: new Date()
                },
                { new: true }
            );

            if (candidate) {
                // Update embedding to include the new note
                // await this.createCandidateEmbedding(candidate);
                console.log(`[AiCandidateService] ✅ Note added to candidate: ${candidateId}`);
            }

            return candidate;
        } catch (error) {
            console.error('[AiCandidateService] Error adding note to candidate:', error);
            throw new Error(`Failed to add note to candidate: ${error.message}`);
        }
    }

    /**
     * Analyzes a candidate using AI.
     * @param {object} candidate - The candidate object.
     * @returns {Promise<object>} AI analysis results.
     */
    async analyzeCandidateWithAI(candidate) {
        console.log(`[AiCandidateService] Analyzing candidate with AI: ${candidate._id}`);
        
        try {
            const candidateContext = `
                Candidate: ${candidate.firstName} ${candidate.lastName}
                Position: ${candidate.position}
                Experience: ${candidate.experience}
                Education: ${candidate.education}
                Skills: ${candidate.skills || 'Not specified'}
                Location: ${candidate.location || 'Not specified'}
                Resume: ${candidate.resumeText || 'Not available'}
                Cover Letter: ${candidate.coverLetter || 'Not available'}
                Current Status: ${candidate.status}
            `;

            const analysis = await this.azureOpenAIService.chatCompletion([
                {
                    role: 'system',
                    content: `You are an expert HR analyst. Analyze the candidate profile and provide insights in JSON format with the following structure:
                    {
                        "summary": "Brief summary of the candidate",
                        "strengths": ["strength1", "strength2", "strength3"],
                        "potentialConcerns": ["concern1", "concern2"],
                        "skillsAssessment": {
                            "technical": "assessment of technical skills",
                            "soft": "assessment of soft skills"
                        },
                        "fitAssessment": {
                            "overallFit": "percentage as number (0-100)",
                            "reasoning": "explanation of fit assessment"
                        },
                        "recommendations": ["recommendation1", "recommendation2"]
                    }`
                },
                {
                    role: 'user',
                    content: candidateContext
                }
            ]);

            let parsedAnalysis;
            try {
                parsedAnalysis = this.azureOpenAIService.extractJsonObject(analysis.content);
            } catch (parseError) {
                console.warn('[AiCandidateService] Failed to parse AI analysis as JSON, using text response');
                parsedAnalysis = {
                    summary: analysis.content,
                    strengths: [],
                    potentialConcerns: [],
                    skillsAssessment: { technical: 'N/A', soft: 'N/A' },
                    fitAssessment: { overallFit: 50, reasoning: 'Analysis could not be parsed' },
                    recommendations: []
                };
            }

            // Update candidate with AI analysis
            await Candidate.findByIdAndUpdate(candidate._id, {
                aiAnalysis: {
                    summary: parsedAnalysis.summary,
                    strengths: parsedAnalysis.strengths || [],
                    potentialFlags: parsedAnalysis.potentialConcerns || [],
                    matchingScore: parsedAnalysis.fitAssessment?.overallFit || 50
                }
            });

            console.log(`[AiCandidateService] ✅ AI analysis completed for candidate: ${candidate._id}`);
            return parsedAnalysis;
        } catch (error) {
            console.error('[AiCandidateService] Error analyzing candidate with AI:', error);
            throw new Error(`Failed to analyze candidate: ${error.message}`);
        }
    }
}

module.exports = AiCandidateService;
