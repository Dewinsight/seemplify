// backend/agents/candidateAgent.js
// This agent handles all candidate-related functionalities,
// using AiCandidateService for DB/embedding tasks and its own
// intelligence for data processing, generation, and user interaction.

const AiCandidateServiceClass = require('../services/aiCandidateService');
const { getOpenAIModel } = require('../services/langchainAgentService');

class CandidateAgent {
    constructor(langchainAgentServiceInstance) {
        this.aiCandidateService = new AiCandidateServiceClass();
        console.log('CandidateAgent initialized with AiCandidateService');
    }

    /**
     * Handles candidate-related requests with intelligent routing.
     * @param {string} userInput - The user's input message.
     * @param {object} context - Additional context (userId, etc.).
     * @returns {Promise<object>} The agent's response.
     */
    async handleCandidateRequest(userInput, context = {}) {
        console.log('🎯 CandidateAgent processing request:', userInput);
        
        try {
            // Determine the type of candidate operation using AI
            const intent = await this._detectCandidateIntent(userInput);
            console.log('🧠 Detected intent:', intent);

            switch (intent.type) {
                case 'get_all_candidates':
                    return await this._handleGetAllCandidates(intent, context);
                
                case 'search_candidates':
                    return await this._handleSearchCandidates(intent, context);
                
                case 'create_candidate':
                    return await this._handleCreateCandidateRequest(intent, context);
                
                case 'discuss_candidate':
                    return await this._handleDiscussCandidate(intent, context);
                
                case 'update_candidate':
                    return await this._handleUpdateCandidate(intent, context);
                
                case 'analyze_candidate':
                    return await this._handleAnalyzeCandidate(intent, context);
                
                default:
                    return {
                        success: false,
                        message: "I'm not sure how to help with that candidate request. You can ask me to:\n" +
                               "• Show all candidates in a table\n" +
                               "• Search for candidates by name, position, or skills\n" +
                               "• Discuss specific candidates\n" +
                               "• Create new candidates (I'll guide you to the upload pages)\n" +
                               "• Analyze candidate profiles",
                        type: 'help'
                    };
            }
        } catch (error) {
            console.error('❌ CandidateAgent error:', error);
            return {
                success: false,
                message: `Sorry, I encountered an error while processing your candidate request: ${error.message}`,
                type: 'error'
            };
        }
    }

    /**
     * AI-powered intent detection for candidate operations using LangChain.
     * @param {string} userInput - The user's input.
     * @returns {Promise<object>} Intent object with type and parameters.
     */
    async _detectCandidateIntent(userInput) {
        console.log(`🧠 CandidateAgent AI Intent Detection: "${userInput}"`);
        
        try {
            const model = getOpenAIModel();
            
            const candidateIntentPrompt = `You are an expert AI assistant for candidate management operations. Analyze the user's input and determine their exact intent for candidate-related tasks.

USER INPUT:
"${userInput}"

CANDIDATE OPERATION CATEGORIES:

1. **get_all_candidates** - User wants to view all candidates
   - "show all candidates", "list candidates", "candidates table", "view candidates"
   - "what candidates do we have", "display candidates", "candidate list"

2. **search_candidates** - User wants to find specific candidates
   - "find [name/position/skills]", "search for candidates", "candidates with [criteria]"
   - "show me product managers", "developers", "HR candidates", "React developers"
   - "candidates who have [skills]", "experienced candidates"

3. **create_candidate** - User wants to add new candidates (ANY VARIATION)
   - "create candidate", "create a candidate", "create new candidate"
   - "add candidate", "add a candidate", "add new candidate"
   - "upload candidate", "new candidate", "register candidate"
   - "I want to create candidate", "help me add candidate"

4. **discuss_candidate** - User wants to discuss/analyze a specific candidate
   - "tell me about [candidate]", "discuss [candidate name]", "what do you think about"
   - "analysis of [candidate]", "thoughts on [candidate]", "candidate with ID"

5. **update_candidate** - User wants to modify candidate information
   - "update candidate", "edit candidate", "change candidate", "modify candidate"
   - "update [candidate name]", "change status of"

6. **analyze_candidate** - User wants detailed AI analysis
   - "analyze candidate", "assessment of", "evaluate candidate", "review candidate"
   - "candidate analysis", "detailed analysis", "AI analysis"

CRITICAL RULES:
- ANY variation of "create" + "candidate" = create_candidate (including "create a candidate")
- If user mentions specific names/positions/skills = search_candidates
- If user wants to see "all" or "list" = get_all_candidates
- Pay attention to context and synonyms, not just exact matches

RESPONSE FORMAT:
{
  "type": "get_all_candidates|search_candidates|create_candidate|discuss_candidate|update_candidate|analyze_candidate|unknown",
  "confidence": "high|medium|low",
  "reasoning": "Why this intent was chosen",
  "query": "extracted search query if applicable",
  "context_signals": ["key", "words", "that", "led", "to", "decision"]
}

EXAMPLES:
- "create a candidate" → {"type": "create_candidate", "confidence": "high"}
- "create new candidate" → {"type": "create_candidate", "confidence": "high"}
- "show all candidates" → {"type": "get_all_candidates", "confidence": "high"}
- "find React developers" → {"type": "search_candidates", "query": "React developers", "confidence": "high"}

If unclear, return: {"type": "unknown", "confidence": "low", "reasoning": "Intent unclear"}

Return only the JSON object:`;

            const response = await model.invoke([
                { role: 'system', content: 'You are an expert candidate management intent detection AI. Analyze user input and return only valid JSON.' },
                { role: 'user', content: candidateIntentPrompt }
            ]);
            
            // Parse AI response
            let aiIntent;
            try {
                const jsonMatch = response.content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    aiIntent = JSON.parse(jsonMatch[0]);
                } else {
                    aiIntent = JSON.parse(response.content);
                }
            } catch (parseError) {
                console.warn('🟡 AI candidate intent parsing failed, using fallback:', parseError.message);
                return this._fallbackCandidateIntentDetection(userInput);
            }
            
            console.log(`🤖 CandidateAgent AI Intent Result:`, {
                type: aiIntent.type,
                confidence: aiIntent.confidence,
                reasoning: aiIntent.reasoning?.substring(0, 80) + '...',
                query: aiIntent.query
            });
            
            // Validate and return
            if (aiIntent.type && aiIntent.type !== 'unknown') {
                return {
                    type: aiIntent.type,
                    confidence: aiIntent.confidence,
                    reasoning: aiIntent.reasoning,
                    query: aiIntent.query || this._extractSearchQuery(userInput),
                    context_signals: aiIntent.context_signals
                };
            }
            
            // Fallback if AI returns unknown
            console.log('🟡 AI returned unknown intent, using fallback detection');
            return this._fallbackCandidateIntentDetection(userInput);
            
        } catch (error) {
            console.error('❌ AI candidate intent detection failed:', error.message);
            return this._fallbackCandidateIntentDetection(userInput);
        }
    }

    /**
     * Fallback rule-based intent detection for candidate operations.
     * @param {string} userInput - The user's input.
     * @returns {object} Intent object with type and parameters.
     */
    _fallbackCandidateIntentDetection(userInput) {
        console.log(`⚠️ Using fallback candidate intent detection for: "${userInput}"`);
        const input = userInput.toLowerCase().trim();
        
        // Get all candidates
        if (input.includes('all candidates') || input.includes('show candidates') || 
            input.includes('list candidates') || input.includes('candidates table') ||
            input.includes('view candidates')) {
            return { type: 'get_all_candidates', confidence: 'medium' };
        }
        
        // Create candidate (expanded patterns)
        if ((input.includes('create') && input.includes('candidate')) ||
            (input.includes('add') && input.includes('candidate')) ||
            input.includes('new candidate') || input.includes('upload candidate') ||
            input.includes('register candidate')) {
            return { type: 'create_candidate', confidence: 'medium' };
        }
        
        // Search candidates by description
        if (input.includes('find candidate') || input.includes('search candidate') ||
            input.includes('get candidate') || input.includes('candidates with') ||
            input.includes('candidates who') || input.includes('product manager') ||
            input.includes('hr ') || input.includes('developer') || input.includes('engineer')) {
            return { 
                type: 'search_candidates',
                query: this._extractSearchQuery(userInput),
                confidence: 'medium'
            };
        }
        
        // Discuss specific candidate
        if (input.includes('tell me about') || input.includes('discuss') ||
            input.includes('what do you think') || input.includes('analysis') ||
            input.includes('thoughts on')) {
            return { 
                type: 'discuss_candidate',
                query: userInput,
                confidence: 'medium'
            };
        }
        
        // Update candidate
        if (input.includes('update candidate') || input.includes('change candidate') ||
            input.includes('modify candidate') || input.includes('edit candidate')) {
            return { 
                type: 'update_candidate',
                query: userInput,
                confidence: 'medium'
            };
        }
        
        // Analyze candidate
        if (input.includes('analyze') || input.includes('assessment') ||
            input.includes('evaluate') || input.includes('review')) {
            return { 
                type: 'analyze_candidate',
                query: userInput,
                confidence: 'medium'
            };
        }
        
        return { type: 'unknown', query: userInput, confidence: 'low' };
    }

    /**
     * Extracts search query from user input.
     * @param {string} userInput - The user's input.
     * @returns {string} Extracted search query.
     */
    _extractSearchQuery(userInput) {
        // Remove common prefixes to get the actual search terms
        const cleanQuery = userInput
            .replace(/^(find|search|get|show|list)\s+(candidates?\s+)?(with|who|named|called)?\s*/i, '')
            .replace(/candidates?\s*/gi, '')
            .trim();
        
        return cleanQuery || userInput;
    }

    /**
     * Handles getting all candidates and returns HTML table.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response with HTML table.
     */
    async _handleGetAllCandidates(intent, context) {
        console.log('📊 Getting all candidates...');
        
        // Ensure organization context
        const organizationId = context.organizationId || context.currentOrganization;
        if (!organizationId) {
            throw new Error('Organization context is required for accessing candidates');
        }
        
        try {
            const result = await this.aiCandidateService.getAllCandidates(1, 50, { organization: organizationId });
            const { candidates, pagination } = result;
            
            if (!candidates || candidates.length === 0) {
                return {
                    success: true,
                    message: "No candidates found in the system.",
                    type: 'no_results',
                    content: `## No Candidates Found

There are currently no candidates in the system.

<button data-action="navigate" data-url="/candidates/new">➕ Single Upload</button> <button data-action="navigate" data-url="/bulk-upload">📄 Bulk Upload</button>`
                };
            }
            
            const htmlTable = this._generateCandidatesTable(candidates, pagination);
            
            return {
                success: true,
                message: `Found ${candidates.length} candidates (Page ${pagination.currentPage} of ${pagination.totalPages})`,
                type: 'candidates_table',
                data: { candidates, pagination },
                content: htmlTable
            };
        } catch (error) {
            console.error('❌ Error getting all candidates:', error);
            throw error;
        }
    }

    /**
     * Handles searching candidates by description.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response with search results.
     */
    async _handleSearchCandidates(intent, context) {
        console.log('🔍 Searching candidates with query:', intent.query);
        
        // Ensure organization context
        const organizationId = context.organizationId || context.currentOrganization;
        if (!organizationId) {
            throw new Error('Organization context is required for searching candidates');
        }
        
        try {
            const results = await this.aiCandidateService.searchCandidatesByDescription(intent.query, { organization: organizationId }, 20);
            
            if (!results || results.length === 0) {
                return {
                    success: true,
                    message: `No candidates found matching "${intent.query}". Try different search terms or check out all candidates.`,
                    type: 'no_results',
                    content: `## No Results Found

No candidates found matching "**${intent.query}**"

<button data-action="navigate" data-url="/candidates">👥 View All Candidates</button> <button data-action="navigate" data-url="/candidates/new">➕ Add New Candidate</button>`
                };
            }
            
            const candidates = results.map(r => r.candidate);
            const htmlTable = this._generateCandidatesTable(candidates, null, results);
            
            return {
                success: true,
                message: `Found ${results.length} candidates matching "${intent.query}"`,
                type: 'search_results',
                data: { results, query: intent.query },
                content: htmlTable
            };
        } catch (error) {
            console.error('❌ Error searching candidates:', error);
            throw error;
        }
    }

    /**
     * Handles create candidate requests by showing upload options.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response with upload options.
     */
    async _handleCreateCandidateRequest(intent, context) {
        console.log('➕ Handling create candidate request...');
        
        const uploadOptionsMarkdown = `## 📋 Add New Candidates

Choose how you'd like to add candidates to the system:

### 👤 Single Upload
Add one candidate at a time with detailed information

<button data-action="navigate" data-url="/candidates/new">➕ Single Upload</button>

### 👥 Bulk Upload  
Upload multiple candidates from a CSV file

<button data-action="navigate" data-url="/bulk-upload">📄 Bulk Upload</button>

---

**💡 Tip:** You can also drag and drop resume files directly onto the upload pages for quick processing!

**🚀 Quick Actions:**
- Use **Single Upload** for detailed candidate entry
- Use **Bulk Upload** for importing from spreadsheets  
- Both methods support resume parsing and auto-fill`;
        
        return {
            success: true,
            message: "I can help you add new candidates! Please choose your preferred upload method:",
            type: 'upload_options',
            content: uploadOptionsMarkdown
        };
    }

    /**
     * Generates markdown table for candidates (frontend uses ReactMarkdown).
     * @param {Array} candidates - Array of candidate objects.
     * @param {object} pagination - Pagination info.
     * @param {Array} [searchResults] - Search results with scores.
     * @returns {string} Markdown table string.
     */
    _generateCandidatesTable(candidates, pagination, searchResults = null) {
        const hasScores = searchResults && searchResults.length > 0;
        
        let markdown = `## 👥 Candidates ${pagination ? `(${pagination.totalCandidates} total)` : ''}\n\n`;
        
        // Add "Go to Candidates Page" button
        markdown += `<button data-action="navigate" data-url="/candidates">📋 Go to Candidates Page</button>\n\n`;
        
        // Create markdown table header
        let tableHeader = '| Name | Position | Experience | Skills | Location | Status |';
        let tableAlign = '|------|----------|------------|---------|----------|---------|';
        
        if (hasScores) {
            tableHeader += ' Match Score |';
            tableAlign += '-------------|';
        }
        
        tableHeader += ' Actions |';
        tableAlign += '---------|';
        
        markdown += tableHeader + '\n' + tableAlign + '\n';
        
        // Add candidate rows
        candidates.forEach((candidate, index) => {
            const matchScore = hasScores ? searchResults[index]?.score : null;
            const scoreDisplay = matchScore ? `**${Math.round(matchScore * 100)}%**` : '';
            
            // Truncate skills for table display
            const skillsDisplay = candidate.skills 
                ? (candidate.skills.length > 40 ? candidate.skills.substring(0, 40) + '...' : candidate.skills)
                : 'Not specified';
            
            let row = `| **${candidate.firstName} ${candidate.lastName}**<br/>📧 ${candidate.email} | ${candidate.position} | 🎯 ${candidate.experience} | ${skillsDisplay} | ${candidate.location || 'Not specified'} | 🟢 ${candidate.status} |`;
            
            if (hasScores) {
                row += ` ${scoreDisplay} |`;
            }
            
            row += ` <button data-action="discuss-candidate" data-candidate-id="${candidate._id}">💬 Discuss</button> |`;
            
            markdown += row + '\n';
        });
        
        // Add pagination info
        if (pagination && pagination.totalPages > 1) {
            markdown += `\n**📄 Page ${pagination.currentPage} of ${pagination.totalPages}**\n`;
            
            if (pagination.hasPrevPage || pagination.hasNextPage) {
                markdown += '\n';
                if (pagination.hasPrevPage) {
                    markdown += `<button data-action="paginate" data-page="${pagination.currentPage - 1}">⬅️ Previous</button> `;
                }
                if (pagination.hasNextPage) {
                    markdown += `<button data-action="paginate" data-page="${pagination.currentPage + 1}">➡️ Next</button>`;
                }
                markdown += '\n';
            }
        }
        
        // Add helpful instructions
        markdown += `\n---\n\n💡 **Quick Actions:**\n`;
        markdown += `- Click "💬 Discuss" to analyze any candidate\n`;
        markdown += `- Type "find candidates with [skills]" to search\n`;
        markdown += `- Type "create new candidate" to add more\n\n`;
        
        return markdown;
    }

    /**
     * Gets Bootstrap badge class for candidate status.
     * @param {string} status - Candidate status.
     * @returns {string} Badge class.
     */
    _getStatusBadgeClass(status) {
        const statusMap = {
            'New': 'bg-primary',
            'Screening': 'bg-info',
            'Interviewing': 'bg-warning',
            'Technical Test': 'bg-secondary',
            'HR Interview': 'bg-info',
            'Offered': 'bg-success',
            'Hired': 'bg-success',
            'Rejected': 'bg-danger',
            'On Hold': 'bg-secondary'
        };
        
        return statusMap[status] || 'bg-secondary';
    }

    /**
     * Handles discussing a specific candidate.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response with candidate discussion.
     */
    async _handleDiscussCandidate(intent, context) {
        console.log('💬 Handling candidate discussion:', intent.query);
        
        // Ensure organization context
        const organizationId = context.organizationId || context.currentOrganization;
        if (!organizationId) {
            throw new Error('Organization context is required for accessing candidates');
        }
        
        try {
            // Extract candidate ID or search for candidate by name/details
            const candidateId = this._extractCandidateId(intent.query);
            let candidate = null;
            
            if (candidateId) {
                candidate = await this.aiCandidateService.getCandidateById(candidateId);
                // Verify candidate belongs to user's organization
                if (candidate && candidate.organization?.toString() !== organizationId.toString()) {
                    candidate = null; // Hide candidates from other organizations
                }
            } else {
                // Try to find candidate by name or other details with organization filter
                const searchResults = await this.aiCandidateService.searchCandidatesByDescription(intent.query, { organization: organizationId }, 1);
                if (searchResults && searchResults.length > 0) {
                    candidate = searchResults[0].candidate;
                }
            }
            
            if (!candidate) {
                return {
                    success: false,
                    message: "I couldn't find the specific candidate you're referring to. Could you provide more details like their name or ID?",
                    type: 'candidate_not_found'
                };
            }
            
            // Analyze the candidate with AI if not already done
            let analysis = candidate.aiAnalysis;
            if (!analysis || !analysis.summary) {
                console.log('🧠 Running AI analysis for candidate...');
                analysis = await this.aiCandidateService.analyzeCandidateWithAI(candidate);
            }
            
            const discussionHtml = this._generateCandidateDiscussion(candidate, analysis);
            
            return {
                success: true,
                message: `Here's what I know about ${candidate.firstName} ${candidate.lastName}:`,
                type: 'candidate_discussion',
                data: { candidate, analysis },
                content: discussionHtml
            };
        } catch (error) {
            console.error('❌ Error in candidate discussion:', error);
            throw error;
        }
    }

    /**
     * Extracts candidate ID from query text.
     * @param {string} query - Query text.
     * @returns {string|null} Candidate ID or null.
     */
    _extractCandidateId(query) {
        // Look for MongoDB ObjectId pattern (24 character hex string)
        const idMatch = query.match(/[a-f\d]{24}/i);
        return idMatch ? idMatch[0] : null;
    }

    /**
     * Generates candidate discussion in markdown format.
     * @param {object} candidate - Candidate object.
     * @param {object} analysis - AI analysis.
     * @returns {string} Markdown content.
     */
    _generateCandidateDiscussion(candidate, analysis) {
        let markdown = `## 👤 ${candidate.firstName} ${candidate.lastName}\n\n`;
        markdown += `**Status:** 🟢 ${candidate.status}\n\n`;
        
        // Basic Information
        markdown += `### 📝 Basic Information\n\n`;
        markdown += `- **Position:** ${candidate.position}\n`;
        markdown += `- **Experience:** ${candidate.experience}\n`;
        markdown += `- **Education:** ${candidate.education}\n`;
        markdown += `- **Location:** ${candidate.location || 'Not specified'}\n`;
        markdown += `- **Email:** ${candidate.email}\n`;
        if (candidate.phone) markdown += `- **Phone:** ${candidate.phone}\n`;
        markdown += `- **Source:** ${candidate.source}\n\n`;
        
        // AI Analysis
        markdown += `### 🎯 AI Analysis\n\n`;
        if (analysis) {
            if (analysis.summary) {
                markdown += `**Summary:** ${analysis.summary}\n\n`;
            }
            
            if (analysis.fitAssessment?.overallFit) {
                const fitScore = analysis.fitAssessment.overallFit;
                const fitEmoji = fitScore > 70 ? '🟢' : fitScore > 50 ? '🟡' : '🔴';
                markdown += `**Overall Fit:** ${fitEmoji} **${fitScore}%**\n\n`;
            }
            
            if (analysis.strengths && analysis.strengths.length > 0) {
                markdown += `**Strengths:**\n`;
                analysis.strengths.forEach(strength => {
                    markdown += `- ✅ ${strength}\n`;
                });
                markdown += '\n';
            }
        } else {
            markdown += `AI analysis not available\n\n`;
        }
        
        // Skills
        if (candidate.skills) {
            markdown += `### 💼 Skills\n\n${candidate.skills}\n\n`;
        }
        
        // Notes
        if (candidate.notes && candidate.notes.length > 0) {
            markdown += `### 📝 Notes\n\n`;
            candidate.notes.forEach(note => {
                markdown += `**${new Date(note.date).toLocaleDateString()}:** ${note.note}\n\n`;
            });
        }
        
        // Action buttons
        markdown += `---\n\n`;
        markdown += `**Quick Actions:**\n\n`;
        markdown += `<button data-action="analyze-candidate" data-candidate-id="${candidate._id}">📊 Full Analysis</button> `;
        markdown += `<button data-action="navigate" data-url="/candidates/${candidate._id}">👁️ View Full Profile</button>\n\n`;
        
        return markdown;
    }

    /**
     * Handles analyzing a specific candidate.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response with analysis.
     */
    async _handleAnalyzeCandidate(intent, context) {
        console.log('🔬 Analyzing candidate:', intent.query);
        
        // Ensure organization context
        const organizationId = context.organizationId || context.currentOrganization;
        if (!organizationId) {
            throw new Error('Organization context is required for accessing candidates');
        }
        
        try {
            const candidateId = this._extractCandidateId(intent.query);
            let candidate = null;
            
            if (candidateId) {
                candidate = await this.aiCandidateService.getCandidateById(candidateId);
                // Verify candidate belongs to user's organization
                if (candidate && candidate.organization?.toString() !== organizationId.toString()) {
                    candidate = null; // Hide candidates from other organizations
                }
            } else {
                // Try to find candidate by name or other details with organization filter
                const searchResults = await this.aiCandidateService.searchCandidatesByDescription(intent.query, { organization: organizationId }, 1);
                if (searchResults && searchResults.length > 0) {
                    candidate = searchResults[0].candidate;
                }
            }
            
            if (!candidate) {
                return {
                    success: false,
                    message: "I couldn't find the candidate you want me to analyze. Please provide their name or ID.",
                    type: 'candidate_not_found'
                };
            }
            
            // Run fresh AI analysis
            const analysis = await this.aiCandidateService.analyzeCandidateWithAI(candidate);
            
            const analysisHtml = this._generateDetailedAnalysis(candidate, analysis);
            
            return {
                success: true,
                message: `Complete analysis for ${candidate.firstName} ${candidate.lastName}:`,
                type: 'candidate_analysis',
                data: { candidate, analysis },
                content: analysisHtml
            };
        } catch (error) {
            console.error('❌ Error analyzing candidate:', error);
            throw error;
        }
    }

    /**
     * Generates detailed analysis in markdown format.
     * @param {object} candidate - Candidate object.
     * @param {object} analysis - AI analysis.
     * @returns {string} Markdown content.
     */
    _generateDetailedAnalysis(candidate, analysis) {
        let markdown = `## 🔬 Detailed Analysis: ${candidate.firstName} ${candidate.lastName}\n\n`;
        
        // Overall Assessment
        markdown += `### 📊 Overall Assessment\n\n`;
        if (analysis.fitAssessment?.overallFit) {
            const fitScore = analysis.fitAssessment.overallFit;
            const fitEmoji = fitScore > 70 ? '🟢' : fitScore > 50 ? '🟡' : '🔴';
            
            // Create a visual progress bar using text
            const barLength = 20;
            const filledBars = Math.round((fitScore / 100) * barLength);
            const emptyBars = barLength - filledBars;
            const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);
            
            markdown += `**Overall Fit Score:** ${fitEmoji} **${fitScore}%**\n\n`;
            markdown += `\`${progressBar}\` ${fitScore}%\n\n`;
            
            if (analysis.fitAssessment.reasoning) {
                markdown += `**Reasoning:** ${analysis.fitAssessment.reasoning}\n\n`;
            }
        }
        
        // Strengths and Concerns
        markdown += `### ✅ Strengths\n\n`;
        if (analysis.strengths && analysis.strengths.length > 0) {
            analysis.strengths.forEach(strength => {
                markdown += `- ✅ ${strength}\n`;
            });
        } else {
            markdown += `No specific strengths identified\n`;
        }
        markdown += '\n';
        
        markdown += `### ⚠️ Potential Concerns\n\n`;
        if (analysis.potentialConcerns && analysis.potentialConcerns.length > 0) {
            analysis.potentialConcerns.forEach(concern => {
                markdown += `- ⚠️ ${concern}\n`;
            });
        } else {
            markdown += `No major concerns identified\n`;
        }
        markdown += '\n';
        
        // Skills Assessment
        if (analysis.skillsAssessment) {
            markdown += `### 🛠️ Skills Assessment\n\n`;
            
            if (analysis.skillsAssessment.technical) {
                markdown += `**Technical Skills:** ${analysis.skillsAssessment.technical}\n\n`;
            }
            
            if (analysis.skillsAssessment.soft) {
                markdown += `**Soft Skills:** ${analysis.skillsAssessment.soft}\n\n`;
            }
        }
        
        // Recommendations
        if (analysis.recommendations && analysis.recommendations.length > 0) {
            markdown += `### 💡 Recommendations\n\n`;
            analysis.recommendations.forEach(rec => {
                markdown += `- 💡 ${rec}\n`;
            });
            markdown += '\n';
        }
        
        // Footer
        markdown += `---\n\n`;
        markdown += `**Analysis generated on:** ${new Date().toLocaleString()}\n\n`;
        markdown += `<button data-action="navigate" data-url="/candidates/${candidate._id}">👁️ View Full Profile</button> `;
        markdown += `<button data-action="discuss-candidate" data-candidate-id="${candidate._id}">💬 Discuss Further</button>\n\n`;
        
        return markdown;
    }

    /**
     * Handles updating candidate information.
     * @param {object} intent - The intent object.
     * @param {object} context - Request context.
     * @returns {Promise<object>} Response.
     */
    async _handleUpdateCandidate(intent, context) {
        return {
            success: true,
            message: "To update candidate information, please visit the candidate's profile page where you can edit their details, add notes, or change their status.",
            type: 'update_info',
            content: `## Update Candidate Information

Candidate updates should be done through the web interface for security and data integrity.

<button data-action="navigate" data-url="/candidates">👥 Go to Candidates Page</button>`
        };
    }
}

module.exports = CandidateAgent;
