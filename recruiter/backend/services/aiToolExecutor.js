const ToolService = require('./toolService');
const AIModelService = require('./aiModelService');

const TOOL_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'toolCalls'],
  properties: {
    message: { type: 'string' },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'parameters'],
        properties: {
          name: { type: 'string' },
          parameters: { type: 'object', additionalProperties: true }
        }
      }
    }
  }
};

/**
 * AI Tool Executor - Allows the AI to intelligently select and execute tools
 */
class AIToolExecutor {
  constructor() {
    this.toolService = new ToolService();
    this.aiModelService = new AIModelService();
  }

  /**
   * Process a user message and determine which tools to use
   */
  async processMessage(userMessage, context = {}, authToken = null) {
    try {
      console.log('🤖 AI Tool Executor processing:', userMessage);

      // Get available tools
      const availableTools = this.toolService.getAvailableTools();

      // Create system prompt with tool information
      const systemPrompt = this.createSystemPromptWithTools(availableTools, context);

      // Ask AI to determine which tools to use
      const selectionStartedAt = Date.now();
      const toolSelectionResponse = await this.aiModelService.structuredCompletion([
        {
          role: 'system',
          content: `${systemPrompt}\n\nReturn the direct user-facing answer in message and any required calls in toolCalls.`
        },
        { role: 'user', content: userMessage }
      ], {
        activity: 'assistant.tool_selection',
        promptVersion: 'assistant-tool-selection-v2',
        context,
        temperature: 0.2,
        maxTokens: 1200,
        jsonSchema: TOOL_SELECTION_SCHEMA,
        schemaName: 'assistant_tool_selection',
        schemaStrict: false
      });
      const selection = toolSelectionResponse.data;
      const toolCalls = selection.toolCalls.filter((toolCall) => this.toolService.tools[toolCall.name]);

      let finalResponse = '';
      let toolResults = [];

      if (toolCalls.length > 0) {
        console.log(`🔧 AI wants to execute ${toolCalls.length} tool(s)`);

        // Execute the tools
        for (const toolCall of toolCalls) {
          try {
            const result = await this.toolService.executeTool(
              toolCall.name,
              toolCall.parameters,
              authToken
            );
            toolResults.push({
              tool: toolCall.name,
              success: true,
              result: result
            });
          } catch (error) {
            toolResults.push({
              tool: toolCall.name,
              success: false,
              error: error.message
            });
          }
        }

        // Check if this is a matching query that needs a follow-up tool call
        console.log('🔍 Checking if follow-up is needed...');
        if (this.needsMatchingFollowUp(userMessage, toolCalls, toolResults)) {
          console.log('✅ Follow-up needed, generating matching tool call...');
          const followUpCalls = await this.generateMatchingFollowUp(userMessage, toolResults, authToken);
          toolResults = toolResults.concat(followUpCalls);
          console.log(`✅ Added ${followUpCalls.length} follow-up tools`);
        } else {
          console.log('❌ No follow-up needed');
        }

        // Generate final response based on tool results
        finalResponse = await this.generateFinalResponse(
          userMessage,
          toolResults,
          context
        );
      } else {
        // No tools needed, use the AI response directly
        finalResponse = selection.message;
      }

      return {
        success: true,
        message: finalResponse,
        toolsUsed: toolCalls.map(tc => tc.name),
        toolResults: toolResults,
        confidence: 0.85,
        processingTime: Date.now() - selectionStartedAt
      };

    } catch (error) {
      console.error('❌ Error in AI Tool Executor:', error.message);
      return {
        success: false,
        message: 'I encountered an error while processing your request. Please try again.',
        error: error.message,
        // Runtime identity survives so the HTTP layer can tell "connect your
        // ChatGPT account" apart from a generic failure.
        code: error.code,
        statusCode: error.statusCode
      };
    }
  }

  /**
   * Create system prompt that includes available tools
   */
  createSystemPromptWithTools(availableTools, context) {
    const toolDescriptions = availableTools.map(tool => {
      return `- **${tool.name}**: ${tool.description}
        Parameters: ${JSON.stringify(tool.parameters, null, 2)}`;
    }).join('\n');

    return `You are SMART HR Assistant, an AI-powered guide for the SmartHR platform. You help users find information and navigate to the right places.

🚨 CRITICAL RULES 🚨
1. YOU ARE INFORMATION-ONLY - You do NOT execute actions or make database changes
2. NEVER claim you can create, update, or delete data
3. ALWAYS provide navigation buttons to direct users to the right pages
4. For "show me" requests, direct users to the relevant page where they can view the data
5. Generate helpful content (job descriptions, interview questions) but don't execute actions

📍 NEXT.JS ROUTING - USE THESE EXACT PATHS:

**Main Navigation:**
- Dashboard/Home: \`/\`
- Jobs List: \`/jobs\`
- Candidates List: \`/candidates\`
- Calendar: \`/calendar\`
- AI Assistant: \`/assistant\`
- Analytics: \`/analytics\`
- Bulk Upload CVs: \`/bulk-upload\`

**Job Routes:**
- Create New Job: \`/jobs/new\`
- View Job Detail: \`/jobs/[jobId]\` (replace [jobId] with actual ID)
- Edit Job: \`/jobs/[jobId]/edit\`
- Job Shortlist Tab: \`/jobs/[jobId]?tab=shortlist\`
- Schedule Multi Interviews: \`/jobs/[jobId]/schedule-multi\`

**Candidate Routes:**
- Create New Candidate: \`/candidates/new\`
- View Candidate: \`/candidates/[id]\` (replace [id] with actual ID)
- Edit Candidate: \`/candidates/[id]/edit\`

**Settings Routes:**
- Main Settings: \`/settings\`
- Organization: \`/settings/organization\`
- Team: \`/settings/team\`
- Billing: \`/settings/billing\`
- Calendar Settings: \`/settings/calendar\`
- Notifications: \`/settings/notifications\`
- Credits: \`/settings/credits\`

**CRITICAL ROUTING RULES:**
- Always use forward slashes \`/\` for routes
- NEVER use backslashes \`\\\` 
- Replace [jobId] and [id] with actual IDs when you have them
- Use query params like \`?tab=shortlist\` for tab navigation
- All routes must start with \`/\`
- NEVER generate fake URLs like \`https://your-smarthr-domain.com\` or \`https://your-domain.com\`
- ONLY use the exact paths listed above (e.g., \`/jobs\`, \`/candidates/new\`)
- If you need to reference a URL in text, just say "the Jobs page" instead of making up a fake domain

🗺️ NAVIGATION RULES:
- If user wants to see candidates → Direct them to the Candidates page with a button
- If user wants to see jobs → Direct them to the Jobs page with a button
- If user wants to find matches → Direct them to AI Matching feature with explanation
- If user wants to create something → Provide a step-by-step guide with navigation button
- If user wants analytics → Direct them to the Analytics/Dashboard page

🚨 CRITICAL: NEVER USE TOOLS FOR EXPLANATION REQUESTS 🚨

**DO NOT USE TOOLS FOR:**
- "What is [feature]?" - Just explain it
- "How does [feature] work?" - Just explain it
- "Explain [something]" - Just explain it
- "Tell me about [feature]" - Just explain it
- "What's a [term]?" - Just explain it

**ONLY USE TOOLS FOR:**
- "Show me all jobs" - User wants to see actual data
- "Show me candidates" - User wants to see actual data
- Nothing else - tools are for data viewing only

⚠️ CRITICAL UNDERSTANDING:
- You are a GUIDE, not an executor
- Users must use the actual pages to view data and perform actions
- Provide clear directions on where to go and what they'll find there
- Include navigation buttons in your responses
- Answer explanation questions DIRECTLY without using any tools

🏢 SMARTHR PLATFORM KNOWLEDGE:

📅 **MULTI-CANDIDATE INTERVIEW FEATURE:**
Multi-candidate interview scheduling allows you to schedule multiple candidates for separate interview time slots in one efficient batch operation. You select multiple candidates from your job pipeline or shortlist, define interview details (type, duration, interviewer team), and the system automatically creates consecutive time slots for each candidate with calendar invites sent to everyone.

**Key Benefits:** Schedule 5, 10, or more interviews in minutes, consistent scheduling for all candidates, same interviewer panel for fair comparison, automated invites, smart buffer times between sessions.

**Access:** From any job's pipeline view, select multiple candidates and click "Schedule Multi-Candidate Interview" or go to \`/jobs/[jobId]/schedule-multi\`

🎯 **HIRING PIPELINE FEATURE:**
Visual kanban-style board showing candidates moving through interview stages (e.g., Applied → Phone Screen → Technical → Team Fit → Offer). Drag-and-drop candidates between stages to track progress. Customizable stages per job, automatic status history, stage-specific actions, email notifications.

📋 **SHORTLIST FEATURE:**
A curated "favorites" list of top candidates for a job who have been pre-screened and are ready for interviews. Add candidates from AI matching results, rank and compare them, then bulk move selected ones to the hiring pipeline to begin formal interviews. Different from the main pipeline - it's a pre-screening step.

🤖 **AI NOTETAKER FEATURE:**
AI-powered meeting assistant that joins video interviews automatically, records conversations, generates real-time transcripts, and provides intelligent analysis including candidate strengths/weaknesses, technical assessment, communication quality, cultural fit indicators, red flags, and hiring recommendations.

🔍 **AI MATCHING FEATURE:**
Semantic AI matching engine that analyzes candidate profiles against job requirements and provides 0-100% match scores with detailed reasoning. Includes skills match, experience alignment, education requirements, location preferences. Scores: 90-100% exceptional, 80-89% strong, 70-79% good, 60-69% moderate.

AVAILABLE INFORMATION (Read-Only):
You have access to limited read-only tools for providing context:

${toolDescriptions}

NAVIGATION GUIDANCE:
When the user asks to view or interact with data, provide navigation guidance:

Examples of how to respond:
- "Show me candidates" → "You can view all candidates on the Candidates page. [Button: Go to Candidates]"
- "Show me jobs" → "You can find all jobs on the Jobs page. [Button: View Jobs]"
- "Tell me about candidate John" → "You can search for John on the Candidates page. [Button: Go to Candidates]"
- "Create a new job" → "Here's how to create a job: 1) Go to Jobs page 2) Click Create Job... [Button: Go to Job Creation]"
- "Get analytics" → "You can view analytics on your Dashboard. [Button: Go to Dashboard]"

🚨 CANDIDATE ID LOOKUP RULES 🚨
If user mentions a candidate by name:
1. FIRST call get_all_candidates to find their ObjectId  
2. THEN call get_candidate_by_id with the actual ObjectId
3. NEVER use names directly as candidateId parameters
4. NEVER include candidate names in your final response if the lookup failed

❌ WRONG EXAMPLES:
- get_candidate_by_id with candidateId: "Tochii Achebe"  
- Responding with "Tochii Achebe's role and strengths" if the ID lookup failed
- Using names when you should be using IDs

✅ CORRECT EXAMPLES:
- get_all_candidates first, find Tochii's ID "6742f1234567890abcdef123", then get_candidate_by_id
- If candidate not found, say "I couldn't find information about that candidate"

🎯 JOB MATCHING SCENARIOS (CRITICAL):
- "Find the best candidate for job [ID]" → Use get_matching_candidates_for_job tool
- "Top candidate for [Job Title] position" → FIRST get_all_jobs to find the job ID, THEN get_matching_candidates_for_job
- "Match candidates to job ID 123" → Use get_matching_candidates_for_job tool
- "Who should I hire for [Job Title] role" → FIRST get_all_jobs to find the job ID, THEN get_matching_candidates_for_job
- "Show me matching candidates for [Job Title]" → FIRST get_all_jobs to find the job ID, THEN get_matching_candidates_for_job
- "Best candidate for IT Manager" → FIRST get_all_jobs to find the job ID, THEN get_matching_candidates_for_job
- "Get matching report for job" → Use get_matching_report tool

MATCHING WORKFLOW (MUST FOLLOW):
1. If user provides job ID directly → Use get_matching_candidates_for_job immediately
2. If user mentions job title → Use get_all_jobs first, find the job ID, then use get_matching_candidates_for_job
3. NEVER stop after getting job details - ALWAYS continue to matching
4. NEVER check job.applicants field - we don't track applications, we do AI matching

🚨 CRITICAL ID HANDLING RULES 🚨
- ALWAYS use actual MongoDB ObjectIds (24-character hex strings) for jobId and candidateId parameters
- NEVER use placeholder text like "EXTRACT_FROM_PREVIOUS_RESULT" or candidate names
- If you don't have the actual ID, do NOT make the tool call
- ObjectIds look like: "684580f4b8c6f119aa86ebed" (not "John Doe" or "EXTRACT_ID")

❌ WRONG EXAMPLES:
- jobId: "EXTRACT_FROM_PREVIOUS_RESULT" 
- jobId: "Senior Product Manager"
- candidateId: "Tochii Achebe"
- candidateId: "EXTRACT_CANDIDATE_ID"

✅ CORRECT EXAMPLES:
- jobId: "684580f4b8c6f119aa86ebed"
- candidateId: "6742f1234567890abcdef123"

MATCHING WORKFLOW - SPLIT INTO TWO SEPARATE REQUESTS:
When user asks for job matching, make ONE tool call at a time:

Step 1 - Get Jobs First:
[TOOL_CALL]
{
  "name": "get_all_jobs",
  "parameters": {}
}
[/TOOL_CALL]

Step 2 - Wait for job results, then make follow-up matching call with actual job ID
(The system will automatically handle the follow-up if needed)

FOR THE USER'S REQUEST, YOU MUST IDENTIFY THE APPROPRIATE TOOL AND USE IT IMMEDIATELY.
Do not ask for clarification - use the tools to get the data first, then respond based on the results.

Use this exact format for tool calls:

[TOOL_CALL]
{
  "name": "tool_name",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
[/TOOL_CALL]

You can make multiple tool calls if needed. After tool calls, I will provide you with the real results to formulate your final response.

CONTEXT:
${JSON.stringify(context, null, 2)}

Remember: Use tools to get real data, never generate fake examples. Always provide helpful, accurate responses based on actual system data.`;
  }

  /**
   * Parse tool calls from AI response
   */
  parseToolCallsFromResponse(response) {
    const toolCalls = [];
    const toolCallRegex = /\[TOOL_CALL\](.*?)\[\/TOOL_CALL\]/gs;
    let match;

    while ((match = toolCallRegex.exec(response)) !== null) {
      try {
        const toolCallData = JSON.parse(match[1].trim());
        if (toolCallData.name && this.toolService.tools[toolCallData.name]) {
          toolCalls.push({
            name: toolCallData.name,
            parameters: toolCallData.parameters || {}
          });
        }
      } catch (error) {
        console.warn('⚠️ Failed to parse tool call:', match[1]);
      }
    }

    return toolCalls;
  }

  /**
   * Generate final response based on tool results
   */
  async generateFinalResponse(originalMessage, toolResults, context) {
    try {
      // Create context with tool results
      let toolResultsContext = 'TOOL EXECUTION RESULTS:\n\n';
      
      toolResults.forEach((result, index) => {
        if (result.success) {
          toolResultsContext += `Tool: ${result.tool}\n`;
          toolResultsContext += `Status: Success\n`;
          toolResultsContext += `Data: ${JSON.stringify(result.result, null, 2)}\n\n`;
        } else {
          toolResultsContext += `Tool: ${result.tool}\n`;
          toolResultsContext += `Status: Error\n`;
          toolResultsContext += `Error: ${result.error}\n\n`;
        }
      });

      const systemPrompt = `You are SMART HR Assistant. You just executed tools to get real data from the system.

🚨 CRITICAL: USE ONLY THE REAL DATA FROM TOOL RESULTS 🚨
- Use ONLY the data returned from the tool executions below
- Present the actual information clearly and helpfully
- If tools returned errors, acknowledge them appropriately
- Format the response professionally with proper structure
- NEVER add fake data or examples
- NEVER mention candidate names if the candidate lookup failed
- NEVER use placeholder text or extract instructions in your response

${toolResultsContext}

ORIGINAL USER REQUEST: ${originalMessage}

Based on the tool results above, provide a comprehensive, helpful response to the user's request. Use the real data returned by the tools and format it in a user-friendly way.`;

      const finalResponse = await this.aiModelService.generateChatResponse(
        `Please provide a comprehensive response based on the tool results for: ${originalMessage}`,
        systemPrompt,
        { activity: 'assistant.chat' }
      );

      return finalResponse.success ? finalResponse.response : 'I was unable to process the tool results properly.';

    } catch (error) {
      console.error('❌ Error generating final response:', error.message);
      return 'I executed the necessary tools but encountered an error while formatting the response.';
    }
  }

  /**
   * Get available tools list for display
   */
  getAvailableToolsList() {
    return this.toolService.getAvailableTools();
  }

  /**
   * Test a specific tool
   */
  async testTool(toolName, parameters = {}, authToken = null) {
    try {
      const result = await this.toolService.executeTool(toolName, parameters, authToken);
      return {
        success: true,
        result: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if a matching query needs a follow-up tool call
   */
  needsMatchingFollowUp(userMessage, toolCalls, toolResults) {
    const messageLower = userMessage.toLowerCase();
    const isMatchingQuery = messageLower.includes('best candidate') ||
                           messageLower.includes('top candidate') ||
                           messageLower.includes('matching') ||
                           messageLower.includes('who should') ||
                           messageLower.includes('hire for') ||
                           messageLower.includes('candidates for') ||
                           messageLower.includes('rank') ||
                           messageLower.includes('recommend') ||
                           messageLower.includes('shortlist');

    const hasJobTool = toolCalls.some(tc => tc.name === 'get_all_jobs');
    const hasMatchingTool = toolCalls.some(tc => tc.name.includes('matching'));

    const result = isMatchingQuery && hasJobTool && !hasMatchingTool;
    console.log(`🔍 Follow-up check: isMatchingQuery=${isMatchingQuery}, hasJobTool=${hasJobTool}, hasMatchingTool=${hasMatchingTool}, needsFollowUp=${result}`);
    
    // If it's a matching query and we only called get_all_jobs, we need to follow up
    return result;
  }

  /**
   * Generate follow-up matching tool calls
   */
  async generateMatchingFollowUp(userMessage, toolResults, authToken) {
    console.log('🔄 Generating follow-up matching tool call...');
    
    // Find the job result
    const jobResult = toolResults.find(r => r.tool === 'get_all_jobs' && r.success);
    if (!jobResult || !jobResult.result || jobResult.result.length === 0) {
      console.log('❌ No jobs found to match against');
      return [];
    }

    // Extract job from user message context
    const messageLower = userMessage.toLowerCase();
    const jobs = jobResult.result;
    
    // Try to find the job mentioned in the message
    let targetJob = null;
    
    // Look for specific job titles in the message
    if (messageLower.includes('senior product manager') || messageLower.includes('product manager')) {
      targetJob = jobs.find(j => j.title.toLowerCase().includes('product manager'));
    } else if (messageLower.includes('it manager')) {
      targetJob = jobs.find(j => j.title.toLowerCase().includes('it manager'));
    } else if (messageLower.includes('hr manager')) {
      targetJob = jobs.find(j => j.title.toLowerCase().includes('hr manager'));
    } else {
      // General fallback - try to match title or department
      for (const job of jobs) {
        if (messageLower.includes(job.title.toLowerCase()) ||
            messageLower.includes(job.department.toLowerCase())) {
          targetJob = job;
          break;
        }
      }
    }

    // If no specific job found, use the first active job
    if (!targetJob) {
      targetJob = jobs.find(j => j.status === 'active') || jobs[0];
    }

    if (!targetJob) {
      console.log('❌ Could not identify target job for matching');
      return [];
    }

    // Extract the actual job ID - handle both _id and id fields
    const jobId = targetJob._id || targetJob.id;
    if (!jobId) {
      console.log('❌ Job found but no valid ID:', targetJob);
      return [];
    }

    // Validate job ID format (MongoDB ObjectId should be 24 characters)
    const jobIdString = jobId.toString();
    if (jobIdString.length !== 24) {
      console.log('❌ Invalid job ID format:', jobIdString);
      return [];
    }

    console.log(`🎯 Found job for matching: ${targetJob.title} (ID: ${jobIdString})`);

    // Execute the matching tool
    try {
      const toolParams = { jobId: jobIdString };
      console.log(`🔧 Executing matching with job ID: ${jobIdString}`);
      
      const matchingResult = await this.toolService.executeTool(
        'get_matching_candidates_for_job',
        toolParams,
        authToken
      );

      return [{
        tool: 'get_matching_candidates_for_job',
        success: true,
        result: matchingResult
      }];
    } catch (error) {
      console.error('❌ Error executing matching tool:', error.message);
      return [{
        tool: 'get_matching_candidates_for_job',
        success: false,
        error: error.message
      }];
    }
  }
}

module.exports = AIToolExecutor;
