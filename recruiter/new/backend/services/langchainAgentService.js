require('dotenv').config(); // Load .env from current directory (backend/)
const { ChatOpenAI, AzureChatOpenAI } = require('@langchain/openai');
const { AgentExecutor, createToolCallingAgent } = require('langchain/agents');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const allTools = require('./langchainTools');
const { Mem0ChatMemory } = require('./mem0LangchainWrapper'); // Import Mem0ChatMemory
const memoryManager = require('./memoryManager'); // Import memory manager
const JobAgent = require('../agents/jobAgent'); // Import JobAgent
const CandidateAgent = require('../agents/candidateAgent'); // Import CandidateAgent
const chatSessionService = require('./chatSessionService'); // Import for title generation

/**
 * Initializes and returns an instance of the ChatOpenAI model configured for Azure.
 * 
 * @returns {AzureChatOpenAI} Instance of AzureChatOpenAI.
 * @throws {Error} If essential Azure OpenAI environment variables are missing.
 */
function getOpenAIModel() {
  const requiredEnvVars = [
    'azure_openai_key',
    'azure_openai_model',
    'azure_openai_url'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required Azure OpenAI environment variable: ${envVar}. Please check your .env file.`);
    }
  }

  // Extract instance name and API version from the URL
  const urlMatch = process.env.azure_openai_url.match(/https:\/\/([^.]+)\.cognitiveservices\.azure\.com.*api-version=([^&]+)/);
  if (!urlMatch) {
    throw new Error('Could not parse Azure OpenAI instance name and API version from azure_openai_url');
  }
  
  const instanceName = urlMatch[1];
  const apiVersion = urlMatch[2];

  console.log('🔧 Configuring Azure OpenAI for LangChain:');
  console.log('  - Instance:', instanceName);
  console.log('  - Deployment:', process.env.azure_openai_model);
  console.log('  - API Version:', apiVersion);
  console.log('  - API Key present:', !!process.env.azure_openai_key);

  const config = {
    azureOpenAIApiKey: process.env.azure_openai_key,
    azureOpenAIApiInstanceName: instanceName,
    azureOpenAIApiDeploymentName: process.env.azure_openai_model,
    azureOpenAIApiVersion: apiVersion,
    streaming: true,
    temperature: 0.4, // Increased for faster decision-making and more varied responses
  };

  console.log('🔧 AzureChatOpenAI config:', JSON.stringify(config, (key, value) => 
    key.includes('Key') ? '[REDACTED]' : value, 2));

  return new AzureChatOpenAI(config);
}

const model = getOpenAIModel();
let agentExecutorInstance;
let jobAgentInstance;
let candidateAgentInstance;

/**
 * Initializes the LangChain agent and executor.
 * Uses OpenAI Functions Agent with a prompt from Langsmith Hub.
 */
async function initializeAgentExecutor() {
  if (agentExecutorInstance) {
    return agentExecutorInstance;
  }

  try {
    // Create a custom HR-specific prompt instead of using generic Langsmith Hub prompt
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", `You are SMART HR Assistant, a friendly and helpful AI GUIDE for the SmartHR platform.

🎯 YOUR ROLE - INFORMATION GUIDE & NAVIGATION EXPERT:

You are an **INFORMATION ASSISTANT** and **NAVIGATOR**. Your job is to:
- **PROVIDE INFORMATION** about where to find things in the system
- **GUIDE** users to the right pages with navigation buttons
- **ANSWER QUESTIONS** about SmartHR features and how they work
- **GENERATE CONTENT** (job descriptions, interview questions, advice)
- **EXPLAIN** features clearly with real examples

🧠 WHAT YOU CAN & CANNOT DO:

✅ **YOU CAN DO:**
- Answer questions about SmartHR features
- Generate job descriptions, interview questions, and HR content
- Explain how features work with clear examples
- Provide step-by-step guides with navigation buttons
- Direct users to where they can perform actions
- Show users where to find information in the system

❌ **YOU CANNOT DO:**
- Create, update, or delete anything in the database
- Schedule interviews or perform any actions
- Add candidates or jobs directly
- Make any changes to system data
- Execute any operations on behalf of users

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

🗺️ WHEN USERS WANT TO DO SOMETHING → PROVIDE NAVIGATION GUIDES:

**Action Requests** → Give directions + navigation button:
- "Create a job" → "Here's how to create a job: 1) Go to the Jobs page... [Button: Go to Jobs Page]"
- "Add a candidate" → "To add a candidate: 1) Navigate to Candidates... [Button: Go to Candidates]"
- "Schedule interview" → "To schedule an interview: 1) Open the job details... [Button: Go to Calendar]"
- "Show me jobs" → "You can find all jobs on the Jobs page [Button: View Jobs]"

📖 WHEN USERS WANT INFORMATION → ANSWER DIRECTLY (DO NOT USE TOOLS):

**Explanation Requests** → Explain directly WITHOUT using any tools:
- "What is multi candidate interview?" → Explain the feature directly
- "How does AI matching work?" → Explain with examples directly
- "What's a hiring pipeline?" → Describe the feature and benefits directly
- "Explain [feature]" → Provide clear explanation without searching

**Content Requests** → Generate actual content:
- "Give me a job description for [role]" → Generate full job description
- "What are good interview questions for [role]?" → Provide list of questions
- "Write a job posting for [position]" → Create comprehensive job content

🚨 CRITICAL: NEVER USE TOOLS FOR "WHAT IS" OR "HOW DOES" QUESTIONS 🚨
- Questions starting with "what is", "how does", "explain", "tell me about [feature]" = ANSWER DIRECTLY
- These are explanation requests, NOT data requests
- Do NOT search candidates, jobs, or use any tools
- Just explain the feature/concept clearly

🚨 CRITICAL RULES 🚨
1. NEVER claim you can execute actions - you're information-only
2. ALWAYS provide navigation buttons to the relevant pages
3. BE CLEAR that users must use the actual pages to perform actions
4. GENERATE helpful content for information requests
5. GUIDE users to where they need to go, don't do it for them

📚 HOW TO RESPOND INTELLIGENTLY:

**For ACTION Requests** (user wants to DO something in the system):
User: "Create a job"
✅ DO: Provide step-by-step guide with navigation button to the Jobs page
✅ DO: Include tips and best practices for creating jobs
✅ DO: Make it clear they need to use the actual page to create the job
❌ DON'T: Claim you can create the job for them
❌ DON'T: Ask for job details to "create it" - you can't execute actions

**For CONTENT Requests** (user wants content or information):
User: "Give me a job description for product manager"
✅ DO: Generate a helpful, detailed product manager job description
✅ DO: Include relevant sections (responsibilities, qualifications, benefits)
✅ DO: Add "To post this job, visit [Button: Go to Job Creation]" at the end
❌ DON'T: Just give a guide without the actual content

**For FINDING DATA** (user wants to see existing data):
User: "Show me all jobs" or "What candidates do we have?"
✅ DO: Direct them to the right page with a navigation button
✅ DO: Explain what they'll find there and how to filter/search
❌ DON'T: Claim you'll fetch or show the data directly
❌ DON'T: Try to list actual jobs/candidates - direct them to the page

**For EXPLANATION Requests** (user wants to understand):
User: "How does AI matching work?"
✅ DO: Explain clearly and conversationally with examples
✅ DO: Use analogies and real scenarios
✅ DO: Optionally include "Want to try it? [Button: Go to Matching]" at the end
❌ DON'T: Just point them to a page without explaining

**For CONVERSATIONAL Messages**:
User: "Thanks!" or "Hello"
✅ DO: Respond naturally and friendly
✅ DO: Be warm and personable
❌ DON'T: Force guides into every conversation

🗺️ NAVIGATION ASSISTANCE:
For every guide, provide:
1. **Clear Title**: What the user wants to do
2. **Step-by-Step Instructions**: Numbered list of actions
3. **Navigation Card**: Interactive card with "Go to [Page]" buttons
4. **Pro Tips**: Helpful advice and best practices
5. **Related Features**: Links to connected functionality

📖 GUIDE STRUCTURE TEMPLATE:

Title: [Feature Name]

Introduction: Brief explanation of what feature does

Steps:
1. [First Step] - Description + Tip
2. [Second Step] - Description + Tip
3. [etc...]

Navigation Card:
[Card with primary button to main page]
[Card with secondary button to tutorial/help]

💡 Pro Tips:
- Tip 1
- Tip 2
- Tip 3

Related Features:
→ Feature A - Description
→ Feature B - Description

🎯 INTENT ROUTING EXAMPLES:

**ACTION REQUESTS** → Return GUIDE:
- "Create a job" → Guide to /jobs/create with steps
- "Add candidates" → Guide to /candidates/upload with instructions
- "Schedule interview" → Guide to Calendar with process
- "Show me jobs" → Guide to /jobs with navigation
- "Show candidates" → Guide to /candidates with filtering tips

**CONTENT REQUESTS** → Return HELPFUL CONTENT:
- "Give me a job description for product manager" → Generate full job description
- "What are good technical interview questions?" → List of interview questions with tips
- "Write a job posting for senior developer" → Create comprehensive job content
- "What should I include in a job description?" → Advice on job description structure
- "Can you suggest interview questions for [role]?" → Role-specific questions

**EXPLANATION REQUESTS** → Be NATURALLY HELPFUL:
- "How does AI matching work?" → Clear explanation with examples
- "What is the hiring pipeline?" → Explain the feature and its benefits
- "What's the difference between stages and pipeline?" → Explain clearly
- "Why use AI notetaker?" → Explain benefits and how it works

**CONVERSATIONAL** → Be FRIENDLY & NATURAL:
- "Hello" → "Hi! How can I help you today?"
- "Thanks" → "You're welcome! Let me know if you need anything else!"
- "Can you help me?" → "Of course! What would you like help with?"

💡 CONTENT GENERATION GUIDELINES:

When generating job descriptions:
- Include: Title, About Role, Responsibilities, Qualifications, Nice-to-Have, Benefits
- Be specific and detailed
- Use professional language
- Tailor to the role mentioned

When providing interview questions:
- Give 8-12 relevant questions
- Include technical, behavioral, and situational
- Add tips for what to look for in answers
- Organize by category

When giving advice:
- Be thoughtful and experienced
- Provide specific examples
- Explain WHY things work
- Be conversational, not academic

🎨 RESPONSE STYLE:
- **Conversational**: Talk like a knowledgeable HR colleague, not a robot
- **Intelligent**: Understand context and user's actual need
- **Helpful**: Provide genuinely useful content
- **Friendly**: Use emojis naturally (📋 📅 👥 🎯 💡 ✨)
- **Adaptive**: Match response type to request type
- **Clear**: Keep instructions concise but complete

✅ DO:
- Generate actual content when asked (job descriptions, questions, advice)
- Explain features clearly when asked
- Provide guides when users want to take actions
- Be conversational and natural
- Include optional navigation links when relevant

❌ DON'T:
- Execute actions in the database
- Give robotic, templated responses
- Provide guides when users want content
- Ignore the user's actual question
- Be overly formal or stiff

Remember: You are an INTELLIGENT, CONVERSATIONAL guide who can:
- Answer questions with real content
- Explain features naturally
- Provide helpful guides for actions
- Generate job descriptions, interview questions, and advice
- Adapt to what the user actually needs

🏢 SMARTHR PLATFORM KNOWLEDGE:

**What SmartHR Does:**
SmartHR is an AI-powered recruitment platform with these core features:

1. **Jobs & Postings**: Create/manage job postings, AI job description generator, bulk upload, public job board
2. **Candidate Management**: Resume upload/parsing, AI skill extraction, advanced search, bulk import
3. **AI Matching**: Semantic candidate-job matching with 0-100% scores and detailed reasoning
4. **Hiring Pipeline**: Visual kanban board, drag-and-drop stages, customizable workflows
5. **Interviews**: Single/multi-candidate scheduling, calendar sync, AI Notetaker transcription
6. **Analytics**: Pipeline metrics, time-to-hire, conversion rates, team performance

**Key AI Features:**
- Resume parsing and skill extraction
- Semantic job-candidate matching
- Job description generation
- Interview transcript analysis
- Bias detection for fair hiring

**Interview Stages Examples:**
Phone Screen → Technical Interview → Team Fit → Final Round

**AI Matching Scores:**
- 90-100%: Exceptional fit
- 80-89%: Strong match
- 70-79%: Good fit
- 60-69%: Moderate match

📅 **MULTI-CANDIDATE INTERVIEW FEATURE:**

**What It Is:**
Multi-candidate interview scheduling allows you to schedule multiple candidates for separate interview time slots in one efficient batch operation. Instead of scheduling each candidate individually, you can set up a series of back-to-back interviews with different candidates for the same job, all at once.

**How It Works:**
1. **Select Multiple Candidates**: Choose multiple candidates from your job pipeline or shortlist
2. **Set Session Details**: Define the interview type (video/phone/in-person), duration per candidate, and interviewer team
3. **Create Time Slots**: The system automatically creates consecutive time slots for each candidate with buffer time between sessions
4. **Bulk Schedule**: All interviews are scheduled at once with calendar invites sent to each candidate and interviewer
5. **AI Notetaker Integration**: Optionally add AI notetaker to all sessions for automatic transcription and analysis

**Key Benefits:**
- ⏱️ **Time-Efficient**: Schedule 5, 10, or more interviews in minutes instead of hours
- 📅 **Consistent Scheduling**: All candidates get the same interview setup and duration
- 👥 **Team Coordination**: Same interviewer panel across all candidates for fair comparison
- 🤖 **Automated Invites**: Calendar invites and email notifications sent automatically to all participants
- 📝 **Smart Buffers**: Automatic buffer time between sessions to prevent overlap
- 🔗 **Pipeline Integration**: Works directly with your hiring pipeline stages

**Use Cases:**
- Interview all shortlisted candidates for a role in one day
- Schedule final round interviews for top 5 candidates
- Conduct phone screens for multiple applicants efficiently
- Organize assessment centers with multiple time slots

**Access:** From any job's pipeline view, select multiple candidates and click "Schedule Multi-Candidate Interview"

🎯 **HIRING PIPELINE FEATURE:**

**What It Is:**
Visual kanban-style board showing candidates moving through your interview stages (e.g., Applied → Phone Screen → Technical → Team Fit → Offer). Drag-and-drop candidates between stages to track progress.

**Key Features:**
- Customizable stages per job
- Automatic status history tracking
- Stage-specific actions and metrics
- Email notifications for stage changes
- Integration with interview scheduling

📋 **SHORTLIST FEATURE:**

**What It Is:**
A curated list of top candidates for a specific job who have been pre-screened and are ready for interviews. Different from the main pipeline - it's more like a "favorites" list before moving candidates into the formal hiring process.

**Key Features:**
- Add candidates directly from AI matching results
- Rank and compare shortlisted candidates
- Status tracking (pending, contacted, rejected)
- Bulk operations (bulk move to pipeline, bulk remove)
- Email notifications when moving to pipeline

**Workflow:**
1. Find candidates through AI matching
2. Add best matches to shortlist
3. Review and rank shortlisted candidates
4. Move selected candidates to hiring pipeline
5. Begin formal interview process

🤖 **AI NOTETAKER FEATURE:**

**What It Is:**
AI-powered meeting assistant that automatically joins your video interviews, records the conversation, generates real-time transcripts, and provides intelligent analysis and summaries.

**How It Works:**
1. Enable AI Notetaker when scheduling an interview
2. AI assistant (SmartHR Bot) joins the video call automatically
3. Records audio and generates real-time transcript
4. After interview: AI analyzes responses, extracts key insights, generates summary
5. Transcript and analysis are attached to candidate profile

**AI Analysis Includes:**
- Candidate strengths and weaknesses
- Technical skill assessment
- Communication quality evaluation
- Cultural fit indicators
- Red flags or concerns
- Hiring recommendation with reasoning

**Benefits:**
- Never miss important details from interviews
- Compare candidates objectively with data
- Share interview insights with hiring team
- Searchable transcripts for compliance
- Reduce bias with AI-powered analysis

🔍 **AI MATCHING FEATURE:**

**What It Is:**
Semantic AI-powered matching engine that analyzes candidate profiles against job requirements and provides 0-100% match scores with detailed reasoning.

**How It Works:**
1. Upload candidate CV or create profile
2. System extracts skills, experience, education
3. AI compares against job requirements
4. Generates match score and detailed breakdown
5. Provides reasoning for score (why they match or don't match)

**Match Score Breakdown:**
- Skills match percentage
- Experience level alignment
- Education requirements met
- Location/remote preferences
- Cultural fit indicators

Use this comprehensive knowledge to answer questions about SmartHR features!

Be smart, be helpful, be human! 🌟`],
      new MessagesPlaceholder("chat_history"),
      ["human", "{input}"],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = await createToolCallingAgent({
      llm: model,
      tools: allTools,
      prompt,
    });

    agentExecutorInstance = new AgentExecutor({
      agent,
      tools: allTools,
      verbose: true, // Always verbose to debug
      returnIntermediateSteps: true, // Return intermediate steps
      maxIterations: 15, // Increased for more persistence
      maxExecutionTime: 180000, // 3 minutes timeout
      earlyStoppingMethod: "generate", // Continue until completion
      handleParsingErrors: (err) => {
        console.error("Agent Parsing Error:", err);
        return "I encountered a parsing issue. Let me try a different approach to get your data.";
      }, // More robust error handling
    });

    console.log('LangchainAgentService: AgentExecutor initialized successfully.');
    return agentExecutorInstance;
  } catch (error) {
    console.error('LangchainAgentService: Failed to initialize AgentExecutor:', error);
    throw error; // Re-throw to indicate failure
  }
}

/**
 * Helper function to trigger chat title generation
 * @param {string} chatSessionId - The chat session ID
 * @param {string} userInput - The user's message
 * @param {string} assistantResponse - The assistant's response
 */
async function triggerTitleGeneration(chatSessionId, userInput, assistantResponse) {
  console.log('🔍 Title generation called with:', {
    chatSessionId: chatSessionId ? 'present' : 'missing',
    userInput: userInput ? `"${userInput.substring(0, 50)}..."` : 'missing',
    assistantResponse: assistantResponse ? `"${assistantResponse.substring(0, 50)}..."` : 'missing'
  });

  if (!chatSessionId || !userInput || !assistantResponse) {
    console.log('⚠️ Skipping title generation - missing required parameters');
    return;
  }

  try {
    // Check if this session needs title generation
    const session = await chatSessionService.getChatSession(chatSessionId);
    if (!session) {
      console.log('⚠️ Skipping title generation - session not found');
      return;
    }

    // Only generate title if it's still the default or if messageCount is low (first few messages)
    const needsTitle = !session.title || 
                      session.title === 'New Chat' || 
                      session.title.startsWith('Chat Session') ||
                      session.messageCount <= 2; // Allow title generation for first couple exchanges

    if (!needsTitle) {
      console.log('⚠️ Skipping title generation - session already has a meaningful title:', session.title);
      return;
    }

    console.log('🏷️ Triggering title generation for chat session:', chatSessionId, '(current title:', session.title, ')');
    const result = await chatSessionService.autoGenerateTitle(chatSessionId, userInput, assistantResponse);
    console.log('✅ Title generation completed successfully with title:', result);
  } catch (error) {
    console.error('❌ Error generating title:', error);
    // Don't throw - title generation failure shouldn't break the chat
  }
}

/**
 * Processes a user message using the LangChain agent (streaming version).
 * @param {string} userInput - The user's message.
 * @param {string} userId - The ID of the user.
 * @param {string | undefined} chatSessionId - The ID of the current chat session (optional).
 * @param {string | undefined} authToken - The authentication token for API calls.
 * @param {object} streamCallbacks - Callbacks for handling streamed data (onData, onError, onComplete).
 */
async function streamMessageWithAgent(userInput, userId, chatSessionId, authToken, streamCallbacks) {
  // 🔍 DEBUG: Log session information to track the issue
  console.log('🔍 DEBUG - streamMessageWithAgent called with:');
  console.log('  - userId:', userId);
  console.log('  - chatSessionId:', chatSessionId);
  console.log('  - chatSessionId type:', typeof chatSessionId);
  console.log('  - authToken present:', !!authToken);
  
  if (!agentExecutorInstance) {
    try {
      await initializeAgentExecutor(); // Ensures agent and executor are ready
    } catch (initError) {
      if (streamCallbacks && typeof streamCallbacks.onError === 'function') {
        streamCallbacks.onError(initError);
      }
      return;
    }
  }

  try {
    // Initialize JobAgent if not already done
    if (!jobAgentInstance) {
      jobAgentInstance = new JobAgent();
      console.log('🤖 JobAgent initialized for LangChain integration');
    }

    // Initialize CandidateAgent if not already done
    if (!candidateAgentInstance) {
      candidateAgentInstance = new CandidateAgent();
      console.log('🤖 CandidateAgent initialized for LangChain integration');
    }

    // Get memory instance to check for pending job creation
    const memory = memoryManager.getMemoryInstance(userId, chatSessionId);
    const memoryVariables = await memory.loadMemoryVariables({ [memory.inputKey]: userInput });
    const loadedChatHistory = memoryVariables[memory.memoryKey] || [];
    
    // Extract organization from auth token for data isolation
    let organizationId = null;
    if (authToken) {
      try {
        const jwt = require('jsonwebtoken');
        const token = authToken.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        organizationId = decoded.user.currentOrganization;
        console.log(`🔒 Organization context extracted: ${organizationId}`);
      } catch (error) {
        console.error('Error extracting organization from auth token:', error);
      }
    }
    
    const userContext = { 
      userId, 
      chatSessionId, 
      authToken,
      organizationId,
      currentOrganization: organizationId // Alias for compatibility
    };

    // 🚀 UNIFIED AI-POWERED INTENT ROUTING
    // Use AI to determine if this is a job or candidate operation
    const intentResult = await detectIntent(userInput);
    if (intentResult) {
      console.log(`🎯 Detected HR intent: ${intentResult.category}/${intentResult.intent} (confidence: ${intentResult.confidence})`);
      
      if (intentResult.category === 'job') {
        // Handle job operations with JobAgent
        try {
          const jobResult = await jobAgentInstance.handleJobRequest(
            intentResult.intent, 
            intentResult.data, 
            userContext
          );
          
          // Format the response for streaming (pass userInput for intelligent routing)
          const responseText = formatJobAgentResponse(jobResult, userInput);
          
          // Send the response through streaming callbacks
          if (streamCallbacks && typeof streamCallbacks.onData === 'function') {
            // Send thinking process first
            streamCallbacks.onData({
              event: "on_chain_start", // This is a generic LangChain event type
              data: {
                input: userInput,
                agent: "JobAgent",
                intent: intentResult.intent,
                status: "processing"
              },
              name: "JobAgent" // Identifies the source of this event
            });

            // NEW: Send JOB_FORM_DATA_UPDATE if formData is present in jobResult
            if (jobResult.formData) {
              streamCallbacks.onData({
                event: "custom_event", // Use a generic event type for custom data
                name: "JOB_FORM_DATA_UPDATE", // Custom event name
                data: { // Payload for our custom event
                  type: "JOB_FORM_DATA_UPDATE", // Explicitly state our custom type
                  formData: jobResult.formData,
                  updatedFields: jobResult.updatedFields || Object.keys(jobResult.formData) // Assume all fields if not specified
                }
              });
              console.log('📤 Sent JOB_FORM_DATA_UPDATE event with formData:', jobResult.formData);
            }
            
            // Send final conversational result
            streamCallbacks.onData({
              event: "on_chain_end", // Generic LangChain event
              data: {
                output: { output: responseText }, // Standard LangChain output structure
                agent: "JobAgent",
                status: "completed"
              },
              name: "JobAgent"
            });
          }
          
          // Save to memory
          const memory = memoryManager.getMemoryInstance(userId, chatSessionId);
          await memory.saveContext(
            { input: userInput },
            { output: responseText }
          );
          
          // Store intelligent memory (with deduplication check)
          try {
            await storeIntelligentMemoryOnce(userId, chatSessionId, userInput, responseText, intentResult.intent);
          } catch (memoryError) {
            console.warn('⚠️ Memory storage failed (non-critical):', memoryError.message);
          }
          
          // Trigger title generation after successful completion
          await triggerTitleGeneration(chatSessionId, userInput, responseText);
          
          if (streamCallbacks && typeof streamCallbacks.onComplete === 'function') {
            streamCallbacks.onComplete();
          }
          
          return; // Exit early, JobAgent handled the request
          
        } catch (jobError) {
          console.error('❌ JobAgent error, falling back to LangChain tools:', jobError.message);
          console.error('❌ JobAgent error stack:', jobError.stack);
          // Continue to LangChain tools as fallback
        }
        
      } else if (intentResult.category === 'candidate') {
        // Handle candidate operations with CandidateAgent
        try {
          const candidateResult = await candidateAgentInstance.handleCandidateRequest(userInput, userContext);
          
          // Format the response for streaming (pass userInput for intelligent routing)
          const responseText = await formatCandidateAgentResponse(candidateResult, userInput);
          
          // Send the response through streaming callbacks
          if (streamCallbacks && typeof streamCallbacks.onData === 'function') {
            // Send thinking process first
            streamCallbacks.onData({
              event: "on_chain_start",
              data: {
                input: userInput,
                agent: "CandidateAgent",
                intent: intentResult.intent,
                status: "processing"
              },
              name: "CandidateAgent"
            });
            
            // Send the actual response
            streamCallbacks.onData({
              event: "on_chain_stream",
              data: {
                chunk: responseText
              }
            });
            
            streamCallbacks.onData({
              event: "on_chain_end",
              data: {
                output: responseText
              },
              name: "CandidateAgent"
            });
          }
          
          // Save to memory
          const memory = memoryManager.getMemoryInstance(userId, chatSessionId);
          await memory.saveContext(
            { input: userInput },
            { output: responseText }
          );
          
          // Store intelligent memory (with deduplication check)
          try {
            await storeIntelligentMemoryOnce(userId, chatSessionId, userInput, responseText, intentResult.intent);
          } catch (memoryError) {
            console.warn('⚠️ Memory storage failed (non-critical):', memoryError.message);
          }
          
          // Trigger title generation after successful completion
          await triggerTitleGeneration(chatSessionId, userInput, responseText);
          
          if (streamCallbacks && typeof streamCallbacks.onComplete === 'function') {
            streamCallbacks.onComplete();
          }
          
          return; // Exit early, CandidateAgent handled the request
          
        } catch (candidateError) {
          console.error('❌ CandidateAgent error, falling back to LangChain tools:', candidateError.message);
          console.error('❌ CandidateAgent error stack:', candidateError.stack);
          // Continue to LangChain tools as fallback
        }
      }
    }

    // FALLBACK: Only check for pending job creation if NO explicit intent was detected
    const pendingJobCreation = await checkForPendingJobCreation(loadedChatHistory, userInput);
    if (pendingJobCreation) {
      console.log(`🔄 No new job intent detected, continuing pending job creation...`);
      
      try {
        const jobResult = await jobAgentInstance.processJobCreationResponse(
          pendingJobCreation.data, 
          userInput, 
          userContext
        );
        
        // Format the response for streaming (pass userInput for intelligent routing)
        const responseText = formatJobAgentResponse(jobResult, userInput);
        
        // Send the response through streaming callbacks
        if (streamCallbacks && typeof streamCallbacks.onData === 'function') {
          // Send thinking process first
          streamCallbacks.onData({
            event: "on_chain_start",
            data: {
              input: userInput,
              agent: "JobAgent",
              status: "processing_response"
            },
            name: "JobAgent"
          });

          // NEW: Send JOB_FORM_DATA_UPDATE if formData is present in jobResult
          if (jobResult.formData) {
            streamCallbacks.onData({
              event: "custom_event",
              name: "JOB_FORM_DATA_UPDATE",
              data: {
                type: "JOB_FORM_DATA_UPDATE",
                formData: jobResult.formData,
                updatedFields: jobResult.updatedFields || Object.keys(jobResult.formData)
              }
            });
            console.log('📤 Sent JOB_FORM_DATA_UPDATE event (pending creation) with formData:', jobResult.formData);
          }
          
          // Send final conversational result
          streamCallbacks.onData({
            event: "on_chain_end",
            data: {
              output: { output: responseText },
              agent: "JobAgent",
              status: "completed"
            },
            name: "JobAgent"
          });
        }
        
        // Save to memory
        await memory.saveContext(
          { input: userInput },
          { output: responseText }
        );
        
        // Store intelligent memory (with deduplication check)
        try {
          await storeIntelligentMemoryOnce(userId, chatSessionId, userInput, responseText, 'job_creation_response');
        } catch (memoryError) {
          console.warn('⚠️ Memory storage failed (non-critical):', memoryError.message);
        }
        
        // Trigger title generation after successful completion
        await triggerTitleGeneration(chatSessionId, userInput, responseText);
        
        if (streamCallbacks && typeof streamCallbacks.onComplete === 'function') {
          streamCallbacks.onComplete();
        }
        
        return; // Exit early, JobAgent handled the response
        
      } catch (jobError) {
        console.error('❌ JobAgent response handling error, falling back to LangChain tools:', jobError.message);
        console.error('❌ JobAgent error stack:', jobError.stack);
        // Continue to LangChain tools as fallback
      }
    }
    
    console.log(`🧠 LangchainAgentService: Loaded ${loadedChatHistory.length} messages including context for agent`);
    console.log(`📊 Memory stats:`, memoryManager.getStats());

    // Pass authToken through configurable so tools can access it
    const config = {
      configurable: {
        authToken: authToken
      }
    };

    // Track the final output for memory saving
    let finalOutput = null;
    let agentCompleted = false;

    // Use regular stream method which gives us the output directly
    console.log('🚀 Starting agent stream for input:', userInput);
    
    try {
      const stream = await agentExecutorInstance.stream({
        input: userInput,
        chat_history: loadedChatHistory, // Pass loaded history (BaseMessage[]) with Mem0 context
      }, config); // Pass config with authToken

      for await (const chunk of stream) {
        // Capture final output from stream
        if (chunk.output) {
          finalOutput = chunk.output;
          agentCompleted = true;
          console.log('🎯 Agent output captured:', finalOutput);
        }
        
        // Send data to callbacks with enhanced information
        if (streamCallbacks && typeof streamCallbacks.onData === 'function') {
          // Determine the type of chunk for better frontend handling
          let chunkType = 'thinking';
          let status = 'processing';
          
          if (chunk.output) {
            chunkType = 'final_result';
            status = 'completed';
          } else if (chunk.agent) {
            chunkType = 'agent_action';
            status = 'executing';
          } else if (chunk.tool) {
            chunkType = 'tool_execution';
            status = 'tool_running';
          }
          
          streamCallbacks.onData({
            event: "on_chain_stream",
            data: { 
              chunk: chunk,
              chunkType,
              status,
              timestamp: new Date().toISOString()
            },
            name: "AgentExecutor"
          });
        }
      }
    } catch (streamError) {
      console.error('❌ Error with streaming, falling back to invoke:', streamError);
      // Final fallback: use invoke and simulate streaming
      const result = await agentExecutorInstance.invoke({
        input: userInput,
        chat_history: loadedChatHistory,
      }, config);
      
      finalOutput = result;
      agentCompleted = true;
      
      // console.log('📦 LangChain invoke result:', JSON.stringify(result, null, 2));
      
      if (streamCallbacks && typeof streamCallbacks.onData === 'function') {
        // Simulate streaming events for the final result
        if (result.output) {
          streamCallbacks.onData({
            event: "on_chain_end",
            data: { output: result },
            name: "AgentExecutor"
          });
        }
      }
    }

    // Save conversation to memory after agent completes
    console.log(`🔍 Debug - agentCompleted: ${agentCompleted}, finalOutput:`, finalOutput);
    
    if (agentCompleted && finalOutput) {
      try {
        console.log('💾 Saving conversation to LangChain memory...');
        
        // Extract the actual response text from the final output
        let responseText = '';
        if (typeof finalOutput === 'string') {
          responseText = finalOutput;
        } else if (finalOutput.output) {
          responseText = finalOutput.output;
        } else if (finalOutput.content) {
          responseText = finalOutput.content;
        } else {
          responseText = JSON.stringify(finalOutput);
        }
        
        console.log(`📝 Saving - Input: "${userInput}", Output: "${responseText}"`);
        
        // Save to memory using LangChain's expected format
        await memory.saveContext(
          { [memory.inputKey]: userInput },
          { [memory.outputKey]: responseText }
        );
        
        console.log('✅ Conversation saved to LangChain memory successfully');
        
        // Trigger title generation after successful completion
        await triggerTitleGeneration(chatSessionId, userInput, responseText);
      } catch (memoryError) {
        console.error('❌ Error saving to LangChain memory:', memoryError);
      }
    } else {
      console.warn(`⚠️ Agent did not complete successfully - agentCompleted: ${agentCompleted}, finalOutput: ${finalOutput}`);
    }
    
    if (streamCallbacks && typeof streamCallbacks.onComplete === 'function') {
      streamCallbacks.onComplete();
    }
  } catch (error) {
    console.error('LangchainAgentService: Error during agent stream:', error);
    if (streamCallbacks && typeof streamCallbacks.onError === 'function') {
      streamCallbacks.onError(error);
    }
  }
}

// Initialize the agent executor when the module loads
initializeAgentExecutor().catch(err => {
  // Initialization failed, agent will not be available.
  // Error is already logged by initializeAgentExecutor.
});

// Basic test/log for model initialization (can be commented out or removed after verification)
// try {
//   const modelTest = getOpenAIModel(); // model is already initialized globally
//   console.log('LangchainAgentService: ChatOpenAI model was initialized successfully. Namespace:', model.lc_namespace);
// } catch (error) {
//   console.error('LangchainAgentService: Failed to initialize ChatOpenAI model on module load:', error.message);
// }

// Example test invocation (uncomment to test, ensure .env is set up)
/*
async function testAgent() {
  console.log("Attempting to test agent...");
  try {
    const executor = await initializeAgentExecutor(); // Ensure executor is ready
    if (!executor) {
        console.error("Agent executor not initialized for test.");
        return;
    }
    const result = await executor.invoke({
      input: "Show me all candidates with status New, limit to 2.",
      chat_history: [] // Empty history for this test
    });
    console.log("Agent test invocation result:", result);
  } catch (error) {
    console.error("Agent test invocation failed:", error);
  }
}
// testAgent(); // Call the test function
*/

/**
 * Use AI to extract job data from conversation message
 * @param {string} conversationContent - The assistant's message content
 * @param {string} userInput - Current user input
 * @returns {object|null} - Extracted job data or null
 */
async function extractJobDataFromConversation(conversationContent, userInput) {
  try {
    console.log('🔍 Extracting job data from conversation...');
    console.log('📝 User input:', userInput);
    console.log('📄 Conversation content preview:', conversationContent.substring(0, 200) + '...');
    
    // First, try to extract job data from HTML comment
    const commentMatch = conversationContent.match(/<!-- JOBDATA:(.+?) -->/);
    if (commentMatch) {
      try {
        const jobData = JSON.parse(commentMatch[1]);
        console.log('✅ Found job data in HTML comment:', jobData);
        
        // Update the job data based on user input
        const updatedJobData = await updateJobDataFromUserInput(jobData, userInput);
        return updatedJobData;
      } catch (parseError) {
        console.warn('Failed to parse job data from HTML comment:', parseError.message);
      }
    }
    
    // Fallback to AI extraction if HTML comment not found
    const AzureOpenAIService = require('./azureOpenAIService');
    const model = new AzureOpenAIService();
    
    const extractionPrompt = `You are an expert AI assistant analyzing a complete job posting. Extract ALL available information from this job description and return a comprehensive JSON object.

FULL JOB POSTING:
"${conversationContent}"

Extract and return ALL available fields in JSON format:
{
  "title": "exact job title from the posting",
  "department": "department name if mentioned",
  "location": "work location (city, state, remote, hybrid, etc.)",
  "level": "job level (entry, mid, senior, lead, executive, etc.)",
  "type": "employment type (full-time, part-time, contract, etc.)",
  "experience": "required years of experience (format as '3-5', '5-10', etc.)",
  "education": "required education level",
  "description": "complete job description and summary (2-3 paragraphs)",
  "requirements": "all requirements, qualifications, and skills needed",
  "responsibilities": "key responsibilities and duties",
  "skills": "required skills and competencies",
  "salary": {
    "min": "minimum salary if mentioned",
    "max": "maximum salary if mentioned", 
    "currency": "currency code (USD, EUR, etc.)",
    "period": "salary period (annually, monthly, hourly)"
  },
  "benefits": "benefits and perks offered",
  "companyDescription": "company overview if provided"
}

IMPORTANT: 
- Extract information exactly as written
- If salary range is given like "$75,000 - $95,000", extract min: 75000, max: 95000
- For experience like "3-5 years", use "3-5"
- Include ALL detailed text for description, requirements, responsibilities
- Return complete, comprehensive data - don't summarize

Return only the JSON object:`;

    const response = await model.client.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a job data extraction specialist. Extract job information from conversations and return only valid JSON or null.' },
        { role: 'user', content: extractionPrompt }
      ],
      max_completion_tokens: 500,
      temperature: 0.5, // Increased for faster job data extraction decisions
      model: model.modelName,
      response_format: { type: "json_object" }
    });
    
    try {
      const content = response.choices[0].message.content.trim();
      if (content === 'null' || content.toLowerCase() === 'null') {
        return null;
      }
      
      // Parse the JSON response directly (since we used response_format: json_object)
      const jobData = JSON.parse(content);
      
      // Validate that this looks like job creation data
      if (jobData && (jobData.pendingCreation || jobData.title)) {
        console.log('🤖 AI successfully extracted job data from conversation');
        console.log('📊 Extracted data:', {
          title: jobData.title,
          location: jobData.location,
          description: jobData.description ? 'Present' : 'Missing',
          missingFields: jobData.missingFields,
          awaitingInput: jobData.awaitingInput
        });
        return jobData;
      }
      
      return null;
      
    } catch (parseError) {
      console.warn('AI conversation extraction failed to parse JSON:', parseError.message);
      console.warn('AI response:', response.choices[0]?.message?.content || 'No content');
      return null;
    }
    
  } catch (error) {
    console.error('AI conversation extraction failed:', error.message);
    return null;
  }
}

/**
 * Update job data based on user input
 * @param {object} currentJobData - Current job data state
 * @param {string} userInput - User's input
 * @returns {object} - Updated job data
 */
async function updateJobDataFromUserInput(currentJobData, userInput) {
  try {
    const inputLower = userInput.toLowerCase().trim();
    const updatedData = { ...currentJobData };
    
    // Check if user is providing location
    if (inputLower.includes('location') || 
        inputLower.includes('london') || 
        inputLower.includes('new york') || 
        inputLower.includes('remote') ||
        inputLower.includes('office')) {
      
      // Extract location from user input
      let location = userInput.trim();
      if (inputLower.startsWith('location')) {
        location = userInput.replace(/^location\s*/i, '').trim();
      } else if (inputLower.includes('location')) {
        const locationMatch = userInput.match(/location\s+(.+)/i);
        if (locationMatch) {
          location = locationMatch[1].trim();
        }
      }
      
      if (location && location.length > 0) {
        updatedData.location = location;
        // Remove location from missing fields if it was there
        if (updatedData.missingFields) {
          updatedData.missingFields = updatedData.missingFields.filter(field => field !== 'location');
        }
      }
    }
    
    // Check if user is providing description or asking to generate one
    if (inputLower.includes('description') || 
        inputLower.includes('generate') || 
        inputLower.length > 50) { // Long input might be a description
      
      if (inputLower.includes('generate description') || inputLower.includes('generate')) {
        // User wants to generate description - keep awaitingInput as description
        updatedData.awaitingInput = 'description';
      } else if (inputLower.length > 50 && !inputLower.includes('location')) {
        // User provided a description
        updatedData.description = userInput.trim();
        // Remove description from missing fields
        if (updatedData.missingFields) {
          updatedData.missingFields = updatedData.missingFields.filter(field => field !== 'description');
        }
      }
    }
    
    // Update awaiting input to next missing field
    if (updatedData.missingFields && updatedData.missingFields.length > 0) {
      updatedData.awaitingInput = updatedData.missingFields[0];
    } else {
      updatedData.awaitingInput = null;
    }
    
    console.log('🔄 Updated job data based on user input:', updatedData);
    return updatedData;
    
  } catch (error) {
    console.error('Error updating job data from user input:', error);
    return currentJobData; // Return original data if update fails
  }
}

/**
 * Check if the user is responding to a pending job creation
 * @param {Array} chatHistory - The conversation history
 * @param {string} userInput - Current user input
 * @returns {object|null} - Pending job creation data or null
 */
async function checkForPendingJobCreation(chatHistory, userInput) {
  try {
    // Look for the most recent assistant message that indicates pending job creation
    // Check the last few messages to get the complete conversation context
    for (let i = chatHistory.length - 1; i >= Math.max(0, chatHistory.length - 3); i--) {
      const message = chatHistory[i];
      
      // Check if this is an assistant message with job creation data
      if (message.constructor.name === 'AIMessage' || message.type === 'ai') {
        const content = message.content || '';
        
        // Look for our specific pending job creation markers
        if (content.includes('needsInteraction: true') || 
            content.includes('interactionType: \'missing_fields\'') ||
            content.includes('What would you like to do for the') ||
            content.includes('I need more information to create') ||
            content.includes('pendingCreation": true') ||
            content.includes('missingFields')) {
          
          console.log('🔍 Found pending job creation message, extracting state...');
          
          // Use AI to extract job data from the conversation message
          const extractedJobData = await extractJobDataFromConversation(content, userInput);
          
          if (extractedJobData) {
            console.log('🔍 AI extracted pending job creation data:', extractedJobData);
            return { data: extractedJobData };
          }
          
          // Fallback: if we detect pending job creation but can't parse data,
          // check if the user input looks like a response to job creation
          const inputLower = userInput.toLowerCase().trim();
          if (inputLower.includes('generate') || 
              inputLower.length > 10 || // Likely a description or location
              inputLower.includes('description') ||
              inputLower.includes('location')) {
            
            // Try to find job data in previous messages
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              const prevMessage = chatHistory[j];
              if (prevMessage.constructor.name === 'HumanMessage' || prevMessage.type === 'human') {
                const prevContent = prevMessage.content || '';
                if (prevContent.toLowerCase().includes('create') && 
                    prevContent.toLowerCase().includes('job')) {
                  
                  // Extract basic job info from the original request
                  const extractedData = await extractJobDataFromInput(prevContent);
                  return {
                    data: {
                      ...extractedData,
                      pendingCreation: true,
                      missingFields: ['description', 'location'], // Default missing fields
                      awaitingInput: inputLower.includes('generate description') || inputLower.length > 50 ? 'description' : 'location'
                    }
                  };
                }
              }
            }
          }
        }
      }
    }
    
    return null; // No pending job creation found
    
  } catch (error) {
    console.error('Error checking for pending job creation:', error);
    return null;
  }
}

/**
 * AI-Powered Intent Router using LangChain
 * Uses advanced AI analysis to route between job and candidate operations
 * @param {string} userInput - The user's message.
 * @returns {object|null} - Intent routing object with type and details
 */
async function detectIntent(userInput) {
  console.log(`🧠 AI-POWERED Intent Router: "${userInput}"`);
  
  try {
    const model = getOpenAIModel();
    
    // Comprehensive intent routing prompt
    const routingPrompt = `You are an expert AI assistant for HR management system routing. Your job is to analyze user input and determine if they want to work with JOBS or CANDIDATES, and what specific operation they want to perform.

USER INPUT:
"${userInput}"

CRITICAL DISTINCTION:
- **JOBS/POSITIONS/ROLES** = Job postings, job openings, positions to be filled
- **CANDIDATES/APPLICANTS/PEOPLE** = People who apply for jobs, potential hires, talent

PRIMARY ROUTING CATEGORIES:

🎯 **JOB OPERATIONS** (when user wants to work with job postings):
1. **create_job** - Create new job postings
   - "create a job", "add a position", "post a new role"
   - Pasting comprehensive job descriptions
   - Long structured content with job requirements/responsibilities

2. **list_jobs** - View existing job postings  
   - "show jobs", "list positions", "find jobs", "get all jobs"
   - "what jobs do we have", "available positions"
   - "show me the marketing manager job"

3. **get_job_by_id** - Get specific job details
   - Contains 24-character MongoDB ObjectId
   - "show job details for [id]"

4. **update_job** - Modify existing job postings
   - "update job", "edit position", "modify job [id]"

5. **delete_job** - Remove job postings
   - "delete job", "remove position"

6. **get_matching_candidates** - Find candidates for a job
   - "find candidates for this job", "who fits this role"

👥 **CANDIDATE OPERATIONS** (when user wants to work with people/applicants):
1. **get_all_candidates** - View all candidate profiles
   - "show all candidates", "list candidates", "candidates table"
   - "what candidates do we have", "show me applicants"

2. **search_candidates** - Find specific candidates
   - "find candidate John Smith", "show me product manager candidates"
   - "candidates with React skills", "senior developers"

3. **create_candidate** - Add new candidate guidance
   - "create candidate", "add new applicant", "upload candidate"

4. **discuss_candidate** - Discuss specific candidates  
   - "tell me about candidate X", "discuss this applicant"

5. **analyze_candidate** - Detailed AI analysis of candidates
   - "analyze candidate", "analyze this candidate", "candidate analysis"
   - "analyze candidate [name/ID]", "detailed analysis", "AI analysis"

6. **update_candidate** - Modify candidate information
   - "update candidate profile", "edit applicant details"

🚨 **CRITICAL ROUTING RULES**:
- "list all candidates" = CANDIDATE operation (get_all_candidates)
- "list all jobs" = JOB operation (list_jobs)  
- "show candidates" = CANDIDATE operation
- "show jobs" = JOB operation
- If user mentions PEOPLE/NAMES/APPLICANTS = CANDIDATE operation
- If user mentions POSITIONS/POSTINGS/OPENINGS = JOB operation

RESPONSE FORMAT:
{
  "category": "job|candidate|null",
  "intent": "specific_operation_name|null",
  "confidence": "high|medium|low",
  "reasoning": "Clear explanation of routing decision",
  "context_signals": ["key", "words", "that", "led", "to", "decision"],
  "extracted_data": {
    "// Only if applicable": "relevant extracted information"
  }
}

EXAMPLES:
- "list all candidates" → {"category": "candidate", "intent": "get_all_candidates", "confidence": "high"}
- "show all jobs" → {"category": "job", "intent": "list_jobs", "confidence": "high"}
- "create a software engineer position" → {"category": "job", "intent": "create_job", "confidence": "high"}
- "find candidates with React skills" → {"category": "candidate", "intent": "search_candidates", "confidence": "high"}
- "analyze candidate John Doe" → {"category": "candidate", "intent": "analyze_candidate", "confidence": "high"}
- "tell me about candidate Sarah" → {"category": "candidate", "intent": "discuss_candidate", "confidence": "high"}

If no clear intent is detected, return: {"category": null, "intent": null, "confidence": "high", "reasoning": "No HR-related intent detected"}

Return only the JSON object:`;

    const response = await model.invoke([
      { role: 'system', content: 'You are an expert HR intent routing AI. Analyze user input and route to appropriate job or candidate operations. Return only valid JSON.' },
      { role: 'user', content: routingPrompt }
    ]);
    
    // Parse AI response
    let routingResult;
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        routingResult = JSON.parse(jsonMatch[0]);
      } else {
        routingResult = JSON.parse(response.content);
      }
    } catch (parseError) {
      console.warn('AI intent routing failed to parse JSON:', parseError.message);
      // Fallback to simplified rule-based detection
      return detectIntentFallback(userInput);
    }
    
    // Validate AI routing result
    if (!routingResult || (!routingResult.category && !routingResult.intent)) {
      console.warn('AI returned invalid routing structure');
      return detectIntentFallback(userInput);
    }
    
    console.log(`🤖 AI Intent Routing Result:`, {
      category: routingResult.category,
      intent: routingResult.intent,
      confidence: routingResult.confidence,
      reasoning: routingResult.reasoning?.substring(0, 100) + '...',
      signals: routingResult.context_signals?.length || 0
    });
    
    // If no intent detected, return null
    if (routingResult.category === null || routingResult.category === 'null' || 
        routingResult.intent === null || routingResult.intent === 'null') {
      console.log('🔍 AI determined: No HR-related intent');
      return null;
    }
    
    // Process based on detected category and intent
    let intentData = {};
    
    if (routingResult.category === 'job') {
      switch (routingResult.intent) {
        case 'create_job':
          intentData = await extractJobDataFromInput(userInput);
          break;
          
        case 'list_jobs':
          intentData = extractJobFiltersFromInput(userInput);
          break;
          
        case 'get_job_by_id':
          const jobId = extractJobIdFromInput(userInput);
          intentData = jobId ? { jobId } : {};
          break;
          
        case 'update_job':
          const updateJobId = extractJobIdFromInput(userInput);
          intentData = updateJobId ? { 
            jobId: updateJobId,
            updates: extractJobUpdatesFromInput(userInput)
          } : {};
          break;
          
        case 'delete_job':
          const deleteJobId = extractJobIdFromInput(userInput);
          if (deleteJobId) {
            intentData = { jobId: deleteJobId };
          } else {
            // Check for contextual delete patterns
            const inputLower = userInput.toLowerCase();
            if (inputLower.includes('this') || 
                inputLower.includes('it') || 
                inputLower.includes('that') ||
                inputLower.match(/delete\s+(job|position)$/i) ||
                inputLower.match(/remove\s+(job|position)$/i)) {
              return {
                category: 'job',
                intent: 'delete_job_contextual',
                confidence: routingResult.confidence,
                data: { contextual: true, userInput }
              };
            }
          }
          break;
          
        case 'get_matching_candidates':
          const matchJobId = extractJobIdFromInput(userInput);
          intentData = matchJobId ? { 
            jobId: matchJobId,
            criteria: { topK: 10 }
          } : {};
          break;
          
        default:
          console.warn(`Unknown job intent detected by AI: ${routingResult.intent}`);
          return null;
      }
      
      return {
        category: 'job',
        intent: routingResult.intent,
        confidence: routingResult.confidence,
        reasoning: routingResult.reasoning,
        context_signals: routingResult.context_signals,
        data: intentData
      };
      
    } else if (routingResult.category === 'candidate') {
      // For candidate operations, return the routing result for CandidateAgent to handle
      return {
        category: 'candidate', 
        intent: routingResult.intent,
        confidence: routingResult.confidence,
        reasoning: routingResult.reasoning,
        context_signals: routingResult.context_signals,
        query: userInput,
        extracted_data: routingResult.extracted_data
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('AI intent routing failed:', error.message);
    // Fallback to rule-based detection
    return detectIntentFallback(userInput);
  }
}

/**
 * Fallback rule-based intent detection for both jobs and candidates
 * Used when AI routing fails
 */
function detectIntentFallback(userInput) {
  const input = userInput.toLowerCase();
  console.log(`⚠️ FALLBACK: Rule-based intent routing for: "${userInput}"`);
  
  // Candidate operations (check first due to previous issue)
  if (input.includes('candidate') || input.includes('applicant') || 
      input.includes('recruit') || input.includes('hire')) {
    
    if (input.includes('all candidates') || input.includes('list candidates') || 
        input.includes('show candidates') || input.includes('candidates table')) {
      return {
        category: 'candidate',
        intent: 'get_all_candidates',
        confidence: 'medium',
        reasoning: 'Fallback: Contains list + candidate keywords'
      };
    }
    
    if (input.includes('find candidate') || input.includes('search candidate') ||
        input.includes('candidates with') || input.includes('candidates who')) {
      return {
        category: 'candidate',
        intent: 'search_candidates',
        query: userInput,
        confidence: 'medium',
        reasoning: 'Fallback: Contains search + candidate keywords'
      };
    }
    
    if (input.includes('create candidate') || input.includes('add candidate') ||
        input.includes('new candidate') || input.includes('upload candidate')) {
      return {
        category: 'candidate',
        intent: 'create_candidate',
        confidence: 'medium',
        reasoning: 'Fallback: Contains create + candidate keywords'
      };
    }
    
    // Default candidate operation
    return {
      category: 'candidate',
      intent: 'search_candidates',
      query: userInput,
      confidence: 'low',
      reasoning: 'Fallback: Contains candidate keywords, defaulting to search'
    };
  }
  
  // Job operations
  if (input.includes('job') || input.includes('position') || input.includes('role')) {
    
    if ((input.includes('create') || input.includes('add') || input.includes('post')) && 
        (input.includes('job') || input.includes('position'))) {
      return {
        category: 'job',
        intent: 'create_job',
        confidence: 'medium',
        reasoning: 'Fallback: Contains create + job keywords',
        data: { title: 'Job Title Needed' }
      };
    }
    
    if ((input.includes('show') || input.includes('list') || input.includes('get') || input.includes('find')) && 
        (input.includes('job') || input.includes('position'))) {
      return {
        category: 'job',
        intent: 'list_jobs',
        confidence: 'medium',
        reasoning: 'Fallback: Contains list + job keywords',
        data: {}
      };
    }
    
    // Check for delete requests
    if ((input.includes('delete') || input.includes('remove')) && 
        (input.includes('job') || input.includes('position') || 
         input.includes('this') || input.includes('it'))) {
      return {
        category: 'job',
        intent: 'delete_job_contextual',
        confidence: 'medium',
        reasoning: 'Fallback: Contains delete + job/contextual keywords',
        data: { contextual: true, userInput }
      };
    }
  }
  
  // Check for comprehensive job description (length-based heuristic)
  if (userInput.length > 300 && 
      (input.includes('responsible') || input.includes('requirement') || 
       input.includes('experience') || input.includes('skill'))) {
    return {
      category: 'job',
      intent: 'create_job',
      confidence: 'low',
      reasoning: 'Fallback: Long text with job-related content',
      data: { title: 'Position from Description' }
    };
  }
  
  console.log('⚠️ Fallback found no HR-related intent');
  return null;
}

/**
 * Extract job data from natural language input using AI
 * Enhanced to handle full job descriptions and detailed content
 */
async function extractJobDataFromInput(input) {
  try {
    const model = getOpenAIModel();
    
    // Detect if this looks like a full job description
    const isFullJD = input.length > 500 || 
                     input.includes('Job Description') || 
                     input.includes('Requirements') ||
                     input.includes('Responsibilities') ||
                     input.includes('Qualifications') ||
                     input.includes('## ') || input.includes('# ') ||
                     input.includes('Department:') ||
                     input.includes('Salary') ||
                     input.includes('Benefits');
    
    console.log(`📊 Input analysis: Length=${input.length}, IsFullJD=${isFullJD}`);
    
    let extractionPrompt;
    
    if (isFullJD) {
      // Enhanced prompt for full job descriptions
      extractionPrompt = `You are an expert HR assistant analyzing a complete job posting. Extract ALL available information from this job description and return a comprehensive JSON object.

FULL JOB POSTING:
"${input}"

Extract and return ALL available fields in JSON format:
{
  "title": "exact job title from the posting",
  "department": "department name if mentioned",
  "location": "work location (city, state, remote, hybrid, etc.)",
  "level": "job level (entry, mid, senior, lead, executive, etc.)",
  "type": "employment type (full-time, part-time, contract, etc.)",
  "experience": "required years of experience (format as '3-5', '5-10', etc.)",
  "education": "required education level",
  "description": "complete job description and summary (2-3 paragraphs)",
  "requirements": "all requirements, qualifications, and skills needed",
  "responsibilities": "key responsibilities and duties",
  "skills": "required skills and competencies",
  "salary": {
    "min": "minimum salary if mentioned",
    "max": "maximum salary if mentioned", 
    "currency": "currency code (USD, EUR, etc.)",
    "period": "salary period (annually, monthly, hourly)"
  },
  "benefits": "benefits and perks offered",
  "companyDescription": "company overview if provided"
}

IMPORTANT: 
- Extract information exactly as written
- If salary range is given like "$75,000 - $95,000", extract min: 75000, max: 95000
- For experience like "3-5 years", use "3-5"
- Include ALL detailed text for description, requirements, responsibilities
- Return complete, comprehensive data - don't summarize

Return only the JSON object:`;
    } else {
      // Simple prompt for basic requests
      extractionPrompt = `Extract job information from this user request. Return ONLY a JSON object with the extracted fields.

User Request: "${input}"

Extract these fields if mentioned:
- title: The job title/position name
- department: The department or team
- location: The work location
- level: Job level (entry, mid, senior, etc.)
- type: Employment type (full-time, part-time, contract, etc.)
- experience: Required experience level

Examples:
"Create a data scientist job" → {"title": "Data Scientist"}
"Create a senior software engineer position for the engineering department" → {"title": "Senior Software Engineer", "department": "Engineering", "level": "Senior"}
"Create a marketing manager job in New York" → {"title": "Marketing Manager", "location": "New York"}

Return only the JSON object, no other text:`;
    }

    const response = await model.invoke([
      { role: 'system', content: 'You are an expert job information extraction assistant. Extract comprehensive job details and return only valid JSON.' },
      { role: 'user', content: extractionPrompt }
    ]);
    
    // Parse the AI response
    let extractedData = {};
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        extractedData = JSON.parse(response.content);
      }
    } catch (parseError) {
      console.warn('AI extraction failed, using fallback parsing:', parseError.message);
      // Fallback: simple keyword extraction
      extractedData = fallbackJobExtraction(input);
    }
    
    console.log(`🤖 AI extracted job data (FullJD=${isFullJD}):`, {
      title: extractedData.title,
      department: extractedData.department,
      location: extractedData.location,
      hasDescription: !!extractedData.description,
      hasRequirements: !!extractedData.requirements,
      hasResponsibilities: !!extractedData.responsibilities,
      hasSalary: !!extractedData.salary
    });
    
    return extractedData;
    
  } catch (error) {
    console.error('AI job extraction failed:', error.message);
    // Fallback to simple extraction
    return fallbackJobExtraction(input);
  }
}

/**
 * Fallback job extraction using simple keyword matching
 */
function fallbackJobExtraction(input) {
  const data = {};
  const lowerInput = input.toLowerCase();
  
  // Simple title extraction - look for common job titles
  const jobTitles = [
    'data scientist', 'software engineer', 'product manager', 'marketing manager',
    'devops engineer', 'frontend developer', 'backend developer', 'full stack developer',
    'ui/ux designer', 'business analyst', 'project manager', 'sales manager',
    'hr manager', 'financial analyst', 'content writer', 'digital marketer'
  ];
  
  for (const title of jobTitles) {
    if (lowerInput.includes(title)) {
      data.title = title.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      break;
    }
  }
  
  // If no specific title found, try to extract from common patterns
  if (!data.title) {
    if (lowerInput.includes('engineer')) data.title = 'Engineer';
    else if (lowerInput.includes('manager')) data.title = 'Manager';
    else if (lowerInput.includes('developer')) data.title = 'Developer';
    else if (lowerInput.includes('analyst')) data.title = 'Analyst';
    else if (lowerInput.includes('designer')) data.title = 'Designer';
  }
  
  // Extract department
  if (lowerInput.includes('engineering')) data.department = 'Engineering';
  else if (lowerInput.includes('marketing')) data.department = 'Marketing';
  else if (lowerInput.includes('sales')) data.department = 'Sales';
  else if (lowerInput.includes('hr') || lowerInput.includes('human resources')) data.department = 'HR';
  else if (lowerInput.includes('finance')) data.department = 'Finance';
  else if (lowerInput.includes('product')) data.department = 'Product';
  
  return data;
}

/**
 * Extract job filters from input with enhanced job title detection
 */
function extractJobFiltersFromInput(input) {
  const filters = {};
  const lowerInput = input.toLowerCase();
  
  console.log(`🔍 Extracting filters from: "${input}"`);
  
  // Extract status filter
  const statusKeywords = ['active', 'paused', 'closed', 'draft'];
  for (const status of statusKeywords) {
    if (lowerInput.includes(status)) {
      filters.status = status;
      console.log(`📊 Extracted status filter: ${status}`);
      break;
    }
  }
  
  // Extract department filter
  const deptMatch = input.match(/(?:in|from)\s+(?:the\s+)?(.+?)\s+department/i);
  if (deptMatch) {
    filters.department = deptMatch[1].trim();
    console.log(`🏢 Extracted department filter: ${filters.department}`);
  }
  
  // Enhanced job title extraction for specific job requests
  // Look for patterns like "the [job title] job", "show me [job title]", "[job title] position"
  
  // Try to extract job title from common patterns
  let extractedTitle = null;
  
  // Pattern 1: "the [title] job" or "the [title] position"
  const titleJobMatch = input.match(/(?:the\s+|show\s+me\s+the\s+|find\s+the\s+|get\s+the\s+)([a-zA-Z\s]+?)\s+(?:job|position|posting)/i);
  if (titleJobMatch) {
    extractedTitle = titleJobMatch[1].trim();
  }
  
  // Pattern 2: "show me [title]" without job/position
  if (!extractedTitle) {
    const showMatch = input.match(/(?:show\s+me\s+|find\s+|get\s+|display\s+)(?:the\s+)?([a-zA-Z\s]+?)(?:\s+job|\s+position|$)/i);
    if (showMatch && !showMatch[1].match(/\b(all|jobs|positions|total)\b/i)) {
      extractedTitle = showMatch[1].trim();
    }
  }
  
  // Pattern 3: Look for common job titles directly
  const jobTitles = [
    'data scientist', 'software engineer', 'product manager', 'marketing manager',
    'devops engineer', 'frontend developer', 'backend developer', 'full stack developer',
    'ui/ux designer', 'business analyst', 'project manager', 'sales manager',
    'hr manager', 'human resources manager', 'it manager', 'financial analyst', 
    'content writer', 'digital marketer', 'senior product manager', 'technical lead',
    'engineering manager', 'operations manager', 'customer success manager'
  ];
  
  if (!extractedTitle) {
    for (const title of jobTitles) {
      if (lowerInput.includes(title)) {
        extractedTitle = title;
        break;
      }
    }
  }
  
  // Clean up and format the extracted title
  if (extractedTitle) {
    // Remove common words that aren't part of job titles
    extractedTitle = extractedTitle.replace(/\b(job|position|posting|role)\b/gi, '').trim();
    
    // Capitalize properly
    extractedTitle = extractedTitle.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    
    // Only add if it looks like a valid job title (not just common words)
    if (extractedTitle.length > 2 && !extractedTitle.match(/^(all|total|jobs|positions|list|show|find|get|display)$/i)) {
      filters.title = extractedTitle;
      console.log(`💼 Extracted job title filter: "${extractedTitle}"`);
    }
  }
  
  console.log(`🎯 Final extracted filters:`, filters);
  return filters;
}

/**
 * Extract job ID from input (24-character MongoDB ObjectId)
 */
function extractJobIdFromInput(input) {
  const objectIdPattern = /[0-9a-f]{24}/i;
  const match = input.match(objectIdPattern);
  return match ? match[0] : null;
}

/**
 * Extract job updates from input
 */
function extractJobUpdatesFromInput(input) {
  const updates = {};
  
  // This would need more sophisticated NLP
  // For now, return empty object - updates would need to be specified more explicitly
  
  return updates;
}

/**
 * Format JobAgent response for streaming - LET AI GENERATE DYNAMICALLY
 */
async function formatJobAgentResponse(jobResult, userInput = '') {
  const GuideTemplateService = require('./guideTemplateService');
  const guideService = new GuideTemplateService();
  
  // Determine if this is a CONTENT request vs ACTION request
  const isContentRequest = /give me|provide|generate|write|suggest|create a (description|job description|posting content)|what should i include|help me write|can you (give|provide|write|create)/i.test(userInput);
  const isActionRequest = /^create a job|^add a job|^post a job|how do i create|how can i create|how to create/i.test(userInput);
  
  console.log(`🧠 Request analysis: isContent=${isContentRequest}, isAction=${isActionRequest}`);
  console.log(`📝 User input: "${userInput.substring(0, 100)}"`);
  
  // For CONTENT requests, use OpenAI to generate dynamic response
  if (isContentRequest && !isActionRequest) {
    console.log('📝 User wants CONTENT - using OpenAI for dynamic generation');
    
    try {
      const model = getOpenAIModel();
      
      // Extract role from user input
      const roleMatch = userInput.match(/for (?:a |an )?(.+?)(?:\s+role|\s+position|$)/i);
      const role = roleMatch ? roleMatch[1].trim() : jobResult.data?.title || 'the position';
      
      const contentPrompt = `Generate a comprehensive, professional job description for a ${role} position.

User request: "${userInput}"

Generate a COMPLETE job description with these sections:
- **Position Title**
- **About the Role** (2-3 sentences about the opportunity)
- **Key Responsibilities** (6-8 bullet points)
- **Required Qualifications** (5-7 bullet points)
- **Technical Skills** (if applicable, 4-6 bullet points)
- **Nice to Have** (3-5 bullet points)
- **What We Offer** (5-7 benefits)

Make it professional, specific to the role, and compelling. Use markdown formatting.
Be conversational and helpful. At the end, mention they can use this to create a job in the system.

DO NOT include any system actions or guides - just the content they requested.`;

      const aiResponse = await model.invoke([{
        type: 'human',
        content: contentPrompt
      }]);
      
      let response = aiResponse.content;
      
      // Add guide card at the end for optional action
      response += `\n\n---\n\n💡 **Want to create this as a job posting?**`;
      const guide = guideService.generateJobCreationGuide({ jobTitle: role });
      const guideData = JSON.stringify(guide);
      response += `\n\n<!-- GUIDE_DATA:${guideData} -->`;
      
      return response;
      
    } catch (error) {
      console.error('Error generating content with AI:', error);
      // Fallback to guide
      const guide = guideService.generateJobCreationGuide({ jobTitle: userInput });
      const guideData = JSON.stringify(guide);
      return `I can help you with that! Here's how to create a job posting:\n\n<!-- GUIDE_DATA:${guideData} -->`;
    }
  }
  
  // For ACTION requests, provide guide
  if (jobResult.showJobForm || jobResult.intent === 'create_job' || isActionRequest) {
    console.log('📚 User wants to CREATE job in system - generating guide');
    
    const context = {
      jobTitle: jobResult.data?.title || 'your position'
    };
    
    const guide = guideService.generateJobCreationGuide(context);
    const guideData = JSON.stringify(guide);
    
    let response = `📋 **Creating a Job Posting**\n\n`;
    response += `I'll guide you through creating a job posting${context.jobTitle !== 'your position' ? ` for **${context.jobTitle}**` : ''}!\n\n`;
    response += `Click the "**Go to Job Creation**" button below to get started. I've included a complete step-by-step guide with all the details you need! 👇`;
    response += `\n\n<!-- GUIDE_DATA:${guideData} -->`;
    
    return response;
  }

  // Handle interactive responses (when user needs to provide more info)
  if (jobResult.needsInteraction) {
    let response = `🤖 **Interactive Job Creation**\n\n`;
    response += jobResult.message;
    
    // Include the job data in a user-friendly format
    if (jobResult.data) {
      response += `\n\n**Current Job Information:**\n`;
      
      // Show collected information in a nice format
      if (jobResult.data.title) response += `• **Title:** ${jobResult.data.title}\n`;
      if (jobResult.data.department) response += `• **Department:** ${jobResult.data.department}\n`;
      if (jobResult.data.location && jobResult.data.location !== 'To be determined') response += `• **Location:** ${jobResult.data.location}\n`;
      if (jobResult.data.type) response += `• **Type:** ${jobResult.data.type}\n`;
      if (jobResult.data.level) response += `• **Level:** ${jobResult.data.level}\n`;
      if (jobResult.data.experience) response += `• **Experience:** ${jobResult.data.experience}\n`;
      if (jobResult.data.education) response += `• **Education:** ${jobResult.data.education}\n`;
      
      // Show what's still needed in a user-friendly way
      if (jobResult.data.missingFields && jobResult.data.missingFields.length > 0) {
        response += `\n**What's still needed:**\n`;
        jobResult.data.missingFields.forEach(field => {
          let fieldName = field.charAt(0).toUpperCase() + field.slice(1);
          let hint = '';
          
          if (field === 'description') {
            hint = ' (you can type "generate description" to have AI create one)';
          } else if (field === 'location') {
            hint = ' (e.g., "New York", "Remote", "London")';
          }
          
          response += `• ${fieldName}${hint}\n`;
        });
      }
      
      // Add helpful instructions
      if (jobResult.data.awaitingInput) {
        const currentField = jobResult.data.awaitingInput;
        response += `\n💡 **Next step:** Please provide the ${currentField}`;
        
        if (currentField === 'description') {
          response += ` or type "generate description" to have AI create one for you.`;
        } else {
          response += `.`;
        }
      }
      
      // Embed the data as JSON in an HTML comment for parsing by checkForPendingJobCreation
      // This will be filtered out by MessageRenderer but can still be parsed by the backend
      response += `\n\n<!-- JOBDATA:${JSON.stringify(jobResult.data)} -->`;
    }
    
    return response;
  }
  
  // Handle failed operations
  if (!jobResult.success) {
    return `❌ **Job Operation Failed**\n\n${jobResult.message}`;
  }
  
  // Handle successful operations
  let response = `✅ **Job Operation Successful**\n\n`;
  
  if (jobResult.data) {
    if (Array.isArray(jobResult.data)) {
      // List of jobs - enhance formatting based on result context
      const jobCount = jobResult.data.length;
      
      if (jobCount === 1) {
        // Single result - show detailed view
        const job = jobResult.data[0];
        response += `📋 **Found the ${job.title} position:**\n\n`;
        response += `**${job.title}**\n`;
        response += `🏢 Department: ${job.department}\n`;
        response += `📍 Location: ${job.location}\n`;
        response += `🎯 Level: ${job.level}\n`;
        response += `⏰ Experience: ${job.experience}\n`;
        response += `📊 Status: ${job.status}\n`;
        response += `🆔 ID: ${job._id}\n\n`;
        
        if (job.description) {
          response += `📝 **Description:**\n${job.description.substring(0, 200)}${job.description.length > 200 ? '...' : ''}\n\n`;
        }
        
        // Add action buttons for single job
        response += `---\n\n`;
        response += `**Quick Actions:**\n\n`;
        response += `<button data-action="view-job" data-job-id="${job._id}">📋 View Full Details</button> `;
        response += `<button data-action="edit-job" data-job-id="${job._id}">✏️ Edit Job</button> `;
        response += `<button data-action="find-candidates" data-job-id="${job._id}">👥 Find Candidates</button> `;
        response += `<button data-action="job-analytics" data-job-id="${job._id}">📊 View Analytics</button>\n\n`;
      } else {
        // Multiple results - show list view
        const uniqueTitles = [...new Set(jobResult.data.map(job => job.title))];
        if (uniqueTitles.length === 1) {
          response += `📋 **Found ${jobCount} ${uniqueTitles[0]} positions:**\n\n`;
        } else {
          response += `📋 **Found ${jobCount} jobs:**\n\n`;
        }
        
        jobResult.data.slice(0, 5).forEach((job, index) => {
          response += `**${index + 1}. ${job.title}**\n`;
          response += `   🏢 Department: ${job.department}\n`;
          response += `   📍 Location: ${job.location}\n`;
          response += `   🎯 Status: ${job.status}\n`;
          response += `   🆔 ID: ${job._id}\n\n`;
        });
        
        if (jobResult.data.length > 5) {
          response += `... and ${jobResult.data.length - 5} more jobs.\n\n`;
        }
      }
    } else if (jobResult.data._id) {
      // Single job
      const job = jobResult.data;
      response += `📋 **Job Details:**\n\n`;
      response += `**${job.title}**\n`;
      response += `🏢 Department: ${job.department}\n`;
      response += `📍 Location: ${job.location}\n`;
      response += `🎯 Level: ${job.level}\n`;
      response += `⏰ Experience: ${job.experience}\n`;
      response += `🎓 Education: ${job.education}\n`;
      response += `📊 Status: ${job.status}\n`;
      response += `🆔 ID: ${job._id}\n\n`;
      
      if (job.description) {
        response += `📝 **Description:**\n${job.description}\n\n`;
      }
      
      if (job.requirements) {
        response += `📋 **Requirements:**\n${job.requirements}\n\n`;
      }
      
      if (job.responsibilities) {
        response += `🎯 **Responsibilities:**\n${job.responsibilities}\n\n`;
      }
      
      // Add action buttons for job operations
      response += `---\n\n`;
      response += `**Quick Actions:**\n\n`;
      response += `<button data-action="view-job" data-job-id="${job._id}">📋 View Full Job Details</button> `;
      response += `<button data-action="edit-job" data-job-id="${job._id}">✏️ Edit Job</button> `;
      response += `<button data-action="find-candidates" data-job-id="${job._id}">👥 Find Candidates</button> `;
      response += `<button data-action="job-analytics" data-job-id="${job._id}">📊 View Analytics</button>\n\n`;
      
    } else if (jobResult.data.matches) {
      // Matching candidates result
      const matches = jobResult.data.matches;
      response += `🎯 **Found ${matches.length} matching candidates:**\n\n`;
      
      matches.slice(0, 3).forEach((match, index) => {
        response += `**${index + 1}. ${match.candidate.firstName} ${match.candidate.lastName}** (${match.score}% match)\n`;
        response += `   📧 ${match.candidate.email}\n`;
        response += `   💼 ${match.candidate.position}\n`;
        response += `   🎯 Status: ${match.candidate.status}\n\n`;
      });
    }
  }
  
  response += jobResult.message;
  return response;
}



/**
 * Formats CandidateAgent response for streaming.
 * @param {object} candidateResult - Result from CandidateAgent.
 * @returns {string} Formatted response text.
 */
async function formatCandidateAgentResponse(candidateResult, userInput = '') {
  if (!candidateResult) {
    return "I couldn't process your candidate request. Please try again.";
  }
  
  const GuideTemplateService = require('./guideTemplateService');
  const guideService = new GuideTemplateService();
  
  // Detect if user wants information/advice vs system action
  const isContentRequest = /give me|provide|suggest|what should i|what makes a good|help me with|tell me about|explain/i.test(userInput);
  const isActionRequest = /show me|list|view|find me|get|add|create/i.test(userInput);
  
  // For information/advice requests, let AI respond dynamically
  if (isContentRequest && !isActionRequest) {
    console.log('💬 User wants information/advice - using AI for dynamic response');
    
    try {
      const model = getOpenAIModel();
      
      const advicePrompt = `The user asked: "${userInput}"

This is about candidate management in an HR/recruitment context.

Provide a helpful, conversational response with:
- Direct answer to their question
- Specific examples and best practices
- Professional but friendly tone
- Actionable advice they can use

Keep it concise (2-3 paragraphs max) and genuinely helpful.
At the end, briefly mention they can manage candidates in the SmartHR system.

DO NOT provide step-by-step guides or system instructions - just answer their question naturally.`;

      const aiResponse = await model.invoke([{
        type: 'human',
        content: advicePrompt
      }]);
      
      return aiResponse.content;
      
    } catch (error) {
      console.error('Error generating AI response:', error);
      return candidateResult.message || 'I can help you with candidate management. What would you like to know?';
    }
  }
  
  // For action requests, provide appropriate guide
  let response = '';
  let guide = null;
  
  if (candidateResult.type === 'candidates_table' || candidateResult.type === 'get_all_candidates') {
    console.log('📚 Generating view candidates guide');
    guide = guideService.generateViewCandidatesGuide({});
    response = `👥 **Viewing All Candidates**\n\nHere's how to access and manage your candidate database:`;
  } 
  else if (candidateResult.type === 'search_results' || candidateResult.type === 'search_candidates') {
    console.log('📚 Generating candidate search guide');
    const searchQuery = candidateResult.query || candidateResult.data?.query || 'candidates';
    guide = guideService.generateCandidateSearchGuide({ query: searchQuery });
    response = `🔍 **Finding Candidates**\n\nHere's how to search for ${searchQuery}:`;
  }
  else if (candidateResult.type === 'upload_options' || candidateResult.type === 'create_candidate') {
    console.log('📚 Generating add candidate guide');
    guide = guideService.generateAddCandidateGuide({});
    response = `➕ **Adding Candidates**\n\nHere's how to add candidates to your system:`;
  }
  else {
    response = candidateResult.message || 'I can help you with candidate management.';
  }
  
  if (guide) {
    const guideData = JSON.stringify(guide);
    response += `\n\n<!-- GUIDE_DATA:${guideData} -->`;
  }
  
  return response;
}

// Track recent memory storage to prevent duplicates
const recentMemoryStorage = new Map();

/**
 * Store intelligent memory with deduplication
 * @param {string} userId - User ID
 * @param {string} chatSessionId - Chat session ID
 * @param {string} userInput - User input
 * @param {string} responseText - Assistant response
 * @param {string} intent - Intent type
 */
async function storeIntelligentMemoryOnce(userId, chatSessionId, userInput, responseText, intent) {
  try {
    // Create a unique key for this conversation
    const conversationKey = `${userId}_${chatSessionId}_${userInput.substring(0, 50)}_${responseText.substring(0, 50)}`;
    const now = Date.now();
    
    // Check if we've stored this conversation recently (within 30 seconds)
    if (recentMemoryStorage.has(conversationKey)) {
      const lastStored = recentMemoryStorage.get(conversationKey);
      if (now - lastStored < 30000) { // 30 seconds
        console.log('🔄 Skipping duplicate memory storage for recent conversation');
        return;
      }
    }
    
    // Store the memory
    const chatSessionService = require('./chatSessionService');
    const memoryService = require('./memoryService');
    const globalMemoryId = chatSessionService.getGlobalUserMemoryId(userId);
    
    await memoryService.addIntelligentMemory(
      globalMemoryId,
      chatSessionId,
      {
        userMessage: userInput,
        assistantResponse: responseText,
        intent: intent,
        extractedEntities: {},
        confidence: 0.8,
        dataUsed: 'langchain_agent_integration'
      }
    );
    
    // Track this storage
    recentMemoryStorage.set(conversationKey, now);
    
    // Clean up old entries (keep only last 100)
    if (recentMemoryStorage.size > 100) {
      const entries = Array.from(recentMemoryStorage.entries());
      entries.sort((a, b) => a[1] - b[1]); // Sort by timestamp
      const toDelete = entries.slice(0, entries.length - 50); // Keep newest 50
      toDelete.forEach(([key]) => recentMemoryStorage.delete(key));
    }
    
    console.log('✅ Stored intelligent memory with deduplication check');
    
  } catch (error) {
    console.error('❌ Error storing intelligent memory:', error);
  }
}

module.exports = {
  getOpenAIModel,
  initializeAgentExecutor, // Export for potential external re-initialization or status check
  streamMessageWithAgent,
  detectIntent, // Export the unified AI intent detection function
  extractJobDataFromConversation, // Export for testing
  storeIntelligentMemoryOnce
  // processMessageWithAgent will be added if a non-streaming version is needed
};