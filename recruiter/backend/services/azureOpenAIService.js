const { AzureOpenAI } = require("openai");
const { resolveLlmRuntimeConfig } = require("../config/llmRuntimeConfig");

class AzureOpenAIService {
  constructor() {
    // TEMPERATURE OPTIMIZATION STRATEGY:
    // - Chat Responses: 0.8 (fast, creative responses for better user experience)
    // - Job Description: 0.8 (creative job descriptions) 
    // - Interview Questions: 0.9 (highly creative and diverse questions)
    // - Interview Analysis: 0.5 (balanced for speed vs accuracy)
    // - CV Analysis: 0.7 (good balance for parsing CVs)
    // - Job Requirements: 0.7 (standard creativity for requirements)
    // - Candidate Insights: 0.6 (slightly creative insights)
    // - Report Analysis: 0.5 (factual analysis)
    // - Chat Titles: 0.7 (creative but focused titles)
    // - Bias Analysis: 0.3 (conservative for consistency)
    
    const config = resolveLlmRuntimeConfig();
    const { endpoint, apiKey, deployment, apiVersion, modelName } = config;

    if (!endpoint || !apiKey || !deployment) {
      const missing = [];
      if (!endpoint) missing.push('endpoint');
      if (!apiKey) missing.push('apiKey');
      if (!deployment) missing.push('deployment');
      throw new Error(`Missing Azure OpenAI configuration: ${missing.join(', ')}.`);
    }

    const options = { endpoint, apiKey, deployment, apiVersion };
    
    console.log('🔧 Initializing Azure OpenAI Service...');
    console.log('   Endpoint:', endpoint);
    console.log('   Model:', modelName);
    console.log('   Deployment:', deployment);
    console.log('   API Version:', apiVersion);
    console.log('   API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET');
    
    this.client = new AzureOpenAI(options);
    this.modelName = modelName;
    this.deployment = deployment;
    this.endpoint = endpoint;
    this.apiVersion = apiVersion;
  }

  /**
   * Sanitize AI-generated content to remove formatting artifacts
   * @param {string} text - The text to sanitize
   * @returns {string} - Sanitized text
   */
  sanitizeAIContent(text) {
    if (!text) return text;
    
    // Remove markdown formatting characters
    let sanitized = text
      // Remove asterisks used for bold/italic
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      // Remove underscores used for italic
      .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
      // Remove backticks
      .replace(/`([^`]+)`/g, '$1')
      // Remove hashtags at start of lines (headers)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove remaining standalone hashtags
      .replace(/#([^#\s]+)/g, '$1')
      // Clean up any double spaces
      .replace(/\s{2,}/g, ' ')
      // Trim whitespace
      .trim();
    
    return sanitized;
  }

  /**
   * Sanitize array of strings (for responsibilities, requirements, etc.)
   * @param {string[]} items - Array of strings to sanitize
   * @returns {string[]} - Sanitized array
   */
  sanitizeArrayContent(items) {
    if (!Array.isArray(items)) return items;
    return items.map(item => this.sanitizeAIContent(item));
  }

  extractTextContent(rawContent) {
    if (!rawContent) {
      return '';
    }

    if (typeof rawContent === 'string') {
      return rawContent.trim();
    }

    if (Array.isArray(rawContent)) {
      return rawContent
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }

          if (part && typeof part === 'object') {
            return part.text || part.content || '';
          }

          return '';
        })
        .join('')
        .trim();
    }

    return String(rawContent).trim();
  }

  extractJsonObject(responseContent) {
    const content = this.extractTextContent(responseContent);

    if (!content) {
      throw new Error('Empty model response.');
    }

    try {
      return JSON.parse(content);
    } catch (_error) {
      // Handle fenced JSON blocks or stray text around JSON
      const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fencedMatch?.[1]) {
        return JSON.parse(fencedMatch[1]);
      }

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(content.slice(firstBrace, lastBrace + 1));
      }

      throw new Error('Could not parse JSON object from model response.');
    }
  }

  async chatCompletion(messages, options = {}) {
    const requestBody = {
      messages,
      model: options.model || this.modelName,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 1,
      frequency_penalty: options.frequency_penalty ?? 0,
      presence_penalty: options.presence_penalty ?? 0
    };

    if (options.maxTokens !== undefined) {
      requestBody.max_tokens = options.maxTokens;
    } else {
      requestBody.max_completion_tokens = options.max_completion_tokens ?? 1000;
    }

    if (options.response_format) {
      requestBody.response_format = options.response_format;
    }

    const response = await this.client.chat.completions.create(requestBody);
    const content = this.extractTextContent(response?.choices?.[0]?.message?.content);

    return {
      success: true,
      content,
      usage: response?.usage,
      rawResponse: response
    };
  }

  async generateCompletion(prompt, options = {}) {
    const result = await this.chatCompletion(
      [{ role: 'user', content: prompt }],
      {
        temperature: options.temperature ?? 0.5,
        maxTokens: options.maxTokens,
        max_completion_tokens: options.max_completion_tokens,
        response_format: options.response_format
      }
    );

    return result.content;
  }

  async testConnection() {
    try {
      console.log("Testing Azure OpenAI connection...");
      
      const response = await this.client.chat.completions.create({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello world in JSON format with a message field." }
        ],
        max_completion_tokens: 100,
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const responseText = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("✅ Azure OpenAI connection successful!");
      console.log("Response:", responseText);
      return { success: true, response: responseText };

    } catch (error) {
      console.error("❌ Azure OpenAI connection failed:", error.message);
      return { success: false, error: error.message };
    }
  }

  async analyzeCV(cvText) {
    try {
      console.log("Analyzing CV with Azure OpenAI...");
      
      const messages = [
        {
          role: "system",
          content: `You are an AI assistant specialized in parsing CVs and extracting COMPLETE and detailed structured information.

          CRITICAL ANTI-HALLUCINATION RULES:
          1. ONLY extract information that is EXPLICITLY present in the CV text provided
          2. NEVER invent, generate, or hallucinate names, emails, phone numbers, or any other information
          3. If the CV text appears empty or contains minimal content, return mostly N/A values
          4. If you cannot find a field in the CV, use "N/A" - DO NOT make up data
          5. Every piece of extracted data MUST come directly from the CV text
          
          Your goal is to extract ALL information from the CV, including both standard labeled sections and any unique/unlabeled sections.
          
          CRITICAL INSTRUCTIONS:
          1. Extract EVERY piece of information from the CV that IS PRESENT - nothing should be missed
          2. For sections that don't fit standard categories, include them in "additionalSections" with the section heading as the key
          3. If you find multiple entries (e.g., multiple degrees, certifications, projects), capture ALL of them in arrays
          4. Preserve ALL details including dates, descriptions, URLs, and specific metrics that ARE IN THE CV
          
          Analyze the provided CV text and extract the following fields in a JSON format:
          
          BASIC FIELDS:
          - firstName (string) - ONLY if clearly stated in CV
          - lastName (string) - ONLY if clearly stated in CV
          - email (string, valid email format) - ONLY if found in CV
          - phone (string, phone number) - ONLY if found in CV
          - location (string, candidate's location/city/address) - ONLY if found in CV
          - position (string, current or most recent position) - ONLY if found in CV
          - experience (string, total years of experience)
          - education (string, summary of highest level of education - for backward compatibility)
          - skills (array of strings, list of ALL skills mentioned)
          - summary (string, a brief professional summary)
          - strengths (array of strings, 2-3 key strengths)
          - potentialFlags (array of strings, 2-3 potential concerns)
          
          DETAILED WORK EXPERIENCE ANALYSIS:
          - workExperience (object with the following structure):
            {
              "experienceSummary": "A comprehensive 2-3 sentence summary of their career progression and key achievements",
              "totalYearsExperience": number (total years of professional experience),
              "careerProgression": "Brief analysis of their career growth pattern",
              "jobHistory": [
                {
                  "company": "Company name",
                  "position": "Job title",
                  "duration": "Time period (e.g., '2020-2023' or '2 years')",
                  "responsibilities": "Key responsibilities and achievements in this role",
                  "technologies": ["Array of technologies/tools used"],
                  "impact": "Measurable impact or achievements in this role"
                }
              ],
              "keyAchievements": ["Array of standout achievements across all roles"],
              "industryExperience": ["Array of industries they've worked in"],
              "leadershipExperience": "Summary of any leadership or management experience",
              "technicalDepth": "Assessment of their technical expertise progression"
            }
          
          COMPLETE EDUCATION HISTORY (extract ALL education entries):
          - educationHistory (array of ALL education entries):
            [
              {
                "institution": "University/School name",
                "degree": "Degree type (e.g., Bachelor of Science, Master of Arts, High School Diploma)",
                "fieldOfStudy": "Major/field of study",
                "graduationYear": "Year of graduation",
                "gpa": "GPA if mentioned",
                "honors": "Any honors, awards, or distinctions",
                "location": "Location of institution",
                "description": "Any additional details like thesis, relevant coursework, etc."
              }
            ]
          
          ALL CERTIFICATIONS (capture every certification mentioned):
          - certifications (array of ALL certifications):
            [
              {
                "name": "Certification name",
                "issuingOrganization": "Organization that issued it",
                "issueDate": "Date issued",
                "expiryDate": "Expiry date if applicable",
                "credentialId": "Credential/License ID if provided",
                "credentialUrl": "Verification URL if provided",
                "description": "Any additional details"
              }
            ]
          
          LANGUAGES:
          - languages (array of ALL languages):
            [
              {
                "language": "Language name",
                "proficiency": "Proficiency level (e.g., Native, Fluent, Professional, Conversational, Basic)",
                "certifications": "Any language certifications (e.g., TOEFL, IELTS)"
              }
            ]
          
          AWARDS AND HONORS:
          - awards (array of ALL awards):
            [
              {
                "title": "Award title",
                "issuer": "Who gave the award",
                "date": "When received",
                "description": "Details about the award"
              }
            ]
          
          PROJECTS:
          - projects (array of ALL projects):
            [
              {
                "title": "Project name",
                "description": "Detailed description of the project",
                "role": "Your role in the project",
                "technologies": ["Technologies used"],
                "startDate": "Start date",
                "endDate": "End date or 'Present'",
                "url": "Project URL/link if available",
                "highlights": ["Key achievements or results"]
              }
            ]
          
          PUBLICATIONS:
          - publications (array of ALL publications):
            [
              {
                "title": "Publication title",
                "publication": "Journal/Conference/Book name",
                "publishDate": "Publication date",
                "authors": ["List of authors"],
                "url": "Link to publication if available",
                "description": "Brief description or abstract"
              }
            ]
          
          VOLUNTEER WORK:
          - volunteerWork (array of ALL volunteer experiences):
            [
              {
                "organization": "Organization name",
                "role": "Your role/position",
                "startDate": "Start date",
                "endDate": "End date or 'Present'",
                "description": "What you did",
                "impact": "Impact or achievements"
              }
            ]
          
          PROFESSIONAL MEMBERSHIPS:
          - professionalMemberships (array of ALL memberships):
            [
              {
                "organization": "Organization name",
                "role": "Member type or position",
                "startDate": "Start date",
                "endDate": "End date or 'Present'",
                "description": "Additional details"
              }
            ]
          
          PORTFOLIO LINKS:
          - portfolioLinks (object with links):
            {
              "github": "GitHub profile URL",
              "linkedin": "LinkedIn profile URL",
              "personalWebsite": "Personal website URL",
              "portfolio": "Portfolio website URL",
              "stackoverflow": "Stack Overflow profile",
              "medium": "Medium/blog URL",
              "other": ["Any other relevant URLs"]
            }
          
          ADDITIONAL SECTIONS (capture ANY sections not covered above):
          - additionalSections (object where keys are section headings):
            {
              "Patents": "Text content from Patents section",
              "Speaking Engagements": "Text content from Speaking section",
              "Hobbies and Interests": "Text content",
              "[Any Other Section Heading]": "Full text content from that section"
            }
          
          FULL CV DATA (complete structured extraction for zero information loss):
          - fullCVData (object containing ALL extracted information in structured format)
          
          IMPORTANT RULES:
          - If a field is not found in the CV, use "N/A" for strings, empty array [] for arrays, or empty object {} for objects
          - NEVER make up or invent information that is not in the CV text
          - If the CV text is minimal or unclear, return minimal extracted data with mostly N/A values
          - For arrays (education, certifications, etc.), include ALL instances found in the CV
          - Extract complete details - don't summarize or skip information that EXISTS in the CV
          - For unlabeled sections (e.g., a section titled "Side Projects" or "Research Experience"), add them to additionalSections
          - Ensure the output is a valid JSON object
          - Be thorough with information that IS present, but never invent information that ISN'T`
        },
        { 
          role: "user", 
          content: `Analyze the following CV text and extract information. ONLY extract what is explicitly present. If the CV text is empty or minimal, return N/A values. DO NOT invent names or other information. 

CV text:

${cvText}` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 8000, // Increased to handle comprehensive extraction
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysisContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI CV Analysis Response:", analysisContent);
      
      try {
        const parsedJson = this.extractJsonObject(analysisContent);
        return {
          success: true,
          summary: parsedJson.summary || "N/A",
          strengths: parsedJson.strengths || [],
          potentialFlags: parsedJson.potentialFlags || [],
          extractedFields: parsedJson
        };
      } catch (jsonError) {
        console.error("Error parsing JSON from Azure OpenAI:", jsonError);
        return {
          success: false,
          error: "Failed to parse AI analysis",
          rawResponse: analysisContent
        };
      }

    } catch (error) {
      console.error("Error calling Azure OpenAI for CV analysis:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateJobDescription(jobData) {
    try {
      console.log("Generating job description with Azure OpenAI...");
      
      const { title, department, level, location, type, experience, education } = jobData;
      
      const messages = [
        {
          role: "system",
          content: `You are an expert HR professional and job description writer. Create comprehensive, engaging, and professional job descriptions that attract top talent.
          
          CRITICAL FORMATTING RULES:
          1. DO NOT use any markdown formatting (no *, #, _, \`, etc.)
          2. DO NOT use asterisks for bullet points or emphasis
          3. DO NOT use hashtags or number signs
          4. DO NOT use any special formatting characters
          5. Write in plain, clean text only
          6. Use natural language for emphasis instead of formatting symbols
          
          Your job descriptions should be:
          - Clear and compelling
          - Well-structured with proper sections
          - Include specific responsibilities and requirements
          - Tailored to the specific role and industry
          - Professional yet engaging tone
          - Include growth opportunities and company culture elements
          
          Format the response as a JSON object with these fields:
          - description: A comprehensive job description (3-4 paragraphs) in plain text
          - responsibilities: Array of 6-8 key responsibilities as plain text strings
          - requirements: Array of 6-8 requirements (mix of must-have and nice-to-have) as plain text strings
          - skills: Array of 8-12 relevant skills as plain text strings
          - benefits: Array of 5-7 compelling benefits and perks as plain text strings
          
          Remember: Each string should be clean, plain text with NO formatting symbols.`
        },
        { 
          role: "user", 
          content: `Generate a professional job description for:
          
          Job Title: ${title}
          Department: ${department}
          Level: ${level}
          Location: ${location}
          Job Type: ${type}
          Experience Required: ${experience} years
          Education Required: ${education}
          
          Create a compelling job description that would attract qualified candidates for this position.` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 1500,
        temperature: 0.8,
        top_p: 1,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const generatedContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Job Description Response:", generatedContent);
      
      try {
        const parsedJson = this.extractJsonObject(generatedContent);
        return {
          success: true,
          description: this.sanitizeAIContent(parsedJson.description || ""),
          responsibilities: this.sanitizeArrayContent(parsedJson.responsibilities || []),
          requirements: this.sanitizeArrayContent(parsedJson.requirements || []),
          skills: this.sanitizeArrayContent(parsedJson.skills || []),
          benefits: this.sanitizeArrayContent(parsedJson.benefits || [])
        };
      } catch (jsonError) {
        console.error("Error parsing JSON from Azure OpenAI:", jsonError);
        return {
          success: false,
          error: "Failed to parse AI response",
          rawResponse: generatedContent
        };
      }

    } catch (error) {
      console.error("Error calling Azure OpenAI for job description:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate job requirements using AI
   * 
   * This method generates structured job requirements with separate sections for:
   * - Required Qualifications (must-have skills, experience, education)
   * - Preferred Qualifications (nice-to-have skills and experience)
   * 
   * Returns both a formatted text version (for backward compatibility) and 
   * a structured JSON version (for modern UIs) with clean, readable qualifications.
   * 
   * @param {Object} jobData - Job information including title, department, level, etc.
   * @returns {Object} Result object with formatted requirements and structured data
   */
  async generateJobRequirements(jobData) {
    try {
      console.log("Generating job requirements with Azure OpenAI...");
      
      const { title, department, level, type, experience, education } = jobData;
      
      const messages = [
        {
          role: "system",
          content: `You are an expert HR professional specializing in creating detailed job requirements.
          
          CRITICAL FORMATTING RULES:
          1. Return ONLY valid JSON format
          2. NO markdown formatting (no *, #, _, \`, etc.)
          3. NO asterisks, hashtags, or special formatting characters
          4. Write in plain, clean text only
          5. Each qualification should be a separate string in the array
          6. Use natural language for emphasis instead of formatting symbols
          
          Generate comprehensive and realistic job requirements that are:
          - Specific to the role and industry
          - Balanced between must-have and nice-to-have qualifications
          - Include both technical and soft skills
          - Realistic for the experience level
          - Include education, certifications, and experience requirements
          
          Return a JSON object with this EXACT structure:
          {
            "requiredQualifications": [
              "First required qualification as plain text",
              "Second required qualification as plain text",
              "Third required qualification as plain text"
            ],
            "preferredQualifications": [
              "First preferred qualification as plain text",
              "Second preferred qualification as plain text",
              "Third preferred qualification as plain text"
            ]
          }
          
          Each qualification string should be:
          - Clear and concise (1-2 sentences maximum)
          - Written in plain text without any formatting symbols
          - Specific and measurable when possible
          - Professional and grammatically correct`
        },
        { 
          role: "user", 
          content: `Generate detailed job requirements for:
          
          Job Title: ${title}
          Department: ${department}
          Level: ${level}
          Job Type: ${type}
          Experience Required: ${experience} years
          Education Required: ${education}
          
          Provide 6-8 required qualifications and 4-6 preferred qualifications. Make them comprehensive but realistic for the level.` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 1000,
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const generatedContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Requirements Response:", generatedContent);

      try {
        const parsedJson = this.extractJsonObject(generatedContent);
        
        // Validate structure
        if (!parsedJson.requiredQualifications || !Array.isArray(parsedJson.requiredQualifications)) {
          throw new Error("Missing or invalid requiredQualifications array");
        }
        if (!parsedJson.preferredQualifications || !Array.isArray(parsedJson.preferredQualifications)) {
          throw new Error("Missing or invalid preferredQualifications array");
        }

        // Sanitize each qualification string
        const sanitized = {
          requiredQualifications: this.sanitizeArrayContent(parsedJson.requiredQualifications),
          preferredQualifications: this.sanitizeArrayContent(parsedJson.preferredQualifications)
        };

        // Format as readable text for backward compatibility and better display
        let formattedText = "Required Qualifications:\n\n";
        sanitized.requiredQualifications.forEach((qual) => {
          formattedText += `• ${qual}\n`;
        });
        
        formattedText += "\n\nPreferred Qualifications:\n\n";
        sanitized.preferredQualifications.forEach((qual) => {
          formattedText += `• ${qual}\n`;
        });

        return {
          success: true,
          requirements: formattedText.trim(),
          structured: sanitized // Also return structured format for modern frontends
        };
      } catch (jsonError) {
        console.error("Error parsing JSON from Azure OpenAI:", jsonError);
        return {
          success: false,
          error: "Failed to parse AI response",
          rawResponse: generatedContent
        };
      }

    } catch (error) {
      console.error("Error calling Azure OpenAI for job requirements:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateChatResponse(userMessage, systemContext = '') {
    try {
      console.log("Generating chat response with Azure OpenAI...");
      
      const defaultSystemContext = `You are SMART HR Assistant, an AI-powered HR management system assistant. You help with recruiting, candidate management, job postings, interviews, and HR analytics. 

      CRITICAL RULE: NEVER GENERATE FAKE OR DEMO DATA
      - ONLY use the actual data provided in the system context
      - If no real data is available, clearly state "No data found" or "No candidates/jobs in the system"
      - NEVER invent names, emails, positions, or any other candidate/job information
      - ALWAYS use the exact real data from the database that is provided to you
      - If asked for specific candidates and none exist, say "There are currently no candidates in the system"

      RESPONSE FORMATTING GUIDELINES:
      - Use **bold** for important terms and headings
      - Use *italics* for emphasis
      - Use bullet points (-) for lists
      - Use numbered lists (1.) for step-by-step instructions
      - Use \`code blocks\` for technical terms, IDs, or specific values
      - Use > blockquotes for important notes or tips
      - Use tables when presenting structured data
      - Use ## headings for major sections
      - Use ### subheadings for subsections
      
      CONTENT GUIDELINES:
      - Provide helpful, professional responses using ONLY real data
      - Suggest specific actions when appropriate
      - Be concise but comprehensive
      - Use a friendly, professional tone
      - Focus on HR-related tasks and solutions
      - Include relevant data and metrics when available (from real data only)
      - Provide actionable next steps
      - Format responses for easy scanning and readability`;

      const messages = [
        {
          role: "system",
          content: systemContext || defaultSystemContext
        },
        { 
          role: "user", 
          content: userMessage
        }
      ];

      const startTime = Date.now();

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 1000,
        temperature: 0.8, // Increased for faster and more creative chat responses
        top_p: 1,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        model: this.modelName
      });

      const processingTime = Date.now() - startTime;

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const aiResponse = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Chat Response:", aiResponse.substring(0, 200) + "...");
      
      return {
        success: true,
        response: aiResponse,
        confidence: 0.85, // Could be enhanced with actual confidence scoring
        processingTime: processingTime
      };

    } catch (error) {
      console.error("Error calling Azure OpenAI for chat:", error.message);
      return {
        success: false,
        error: error.message,
        response: "I'm sorry, I'm having trouble processing your request right now. Please try again."
      };
    }
  }

  async analyzeCandidateInsights(candidateData) {
    try {
      console.log("Generating candidate insights with Azure OpenAI...");
      
      const messages = [
        {
          role: "system",
          content: `You are an expert HR analyst specializing in candidate evaluation. Analyze candidate profiles and provide comprehensive insights including:
          
          - Overall assessment and fit
          - Key strengths and advantages
          - Areas of concern or gaps
          - Suitable role recommendations
          - Market competitiveness
          - Development recommendations
          
          Be objective, constructive, and provide actionable insights.`
        },
        { 
          role: "user", 
          content: `Analyze this candidate profile and provide detailed insights:
          
          ${candidateData}
          
          Provide a comprehensive analysis with specific recommendations.` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 1200,
        temperature: 0.6,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const insights = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Insights Response:", insights.substring(0, 200) + "...");
      
      return {
        success: true,
        response: insights
      };

    } catch (error) {
      console.error("Error calling Azure OpenAI for insights:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateReportAnalysis(reportData, reportType) {
    try {
      console.log(`Generating ${reportType} report analysis with Azure OpenAI...`);
      
      const messages = [
        {
          role: "system",
          content: `You are an expert HR data analyst. Generate comprehensive reports and insights based on HR data. Provide:
          
          - Key findings and trends
          - Actionable recommendations
          - Data-driven insights
          - Strategic recommendations
          - Areas for improvement
          
          Format your response clearly with sections and bullet points for easy reading.`
        },
        { 
          role: "user", 
          content: `Generate a ${reportType} report analysis based on this data:
          
          ${JSON.stringify(reportData, null, 2)}
          
          Provide insights, trends, and recommendations.` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 1500,
        temperature: 0.5,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysis = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Report Analysis Response:", analysis.substring(0, 200) + "...");
      
      return {
        success: true,
        response: analysis
      };

    } catch (error) {
      console.error("Error calling Azure OpenAI for report analysis:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateChatTitle(firstUserMessage, firstAssistantMessage = null) {
    try {
      console.log("Generating chat title with Azure OpenAI...");
      
      let content = `Generate a concise, descriptive title (max 50 characters) for this conversation.

User Message: "${firstUserMessage}"`;

      if (firstAssistantMessage) {
        content += `\nAssistant Response: "${firstAssistantMessage.substring(0, 200)}..."`;
      }

      content += `\n\nReturn ONLY the title text, no quotes or extra formatting. Make it specific and informative.`;

      const messages = [
        {
          role: "system",
          content: "You are a helpful assistant that creates concise, descriptive titles for conversations. Return only the title text without quotes or formatting."
        },
        { 
          role: "user", 
          content: content
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 50,
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const generatedTitle = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Generated chat title:", generatedTitle);
      
      return {
        success: true,
        title: generatedTitle
      };

    } catch (error) {
      console.error("Error generating chat title:", error.message);
      return {
        success: false,
        title: "HR Chat Session",
        error: error.message
      };
    }
  }

  /**
   * Generate interview questions using AI
   */
  async analyzeInterview(analysisPrompt) {
    try {
      console.log("Analyzing interview transcript with Azure OpenAI...");
      
      const messages = [
        {
          role: "system",
          content: `You are an expert interview analyst with extensive experience in talent acquisition and behavioral psychology. You analyze interview transcripts to provide objective, comprehensive insights about candidates.

Your analysis must be:
- Objective and evidence-based
- Fair and unbiased
- Specific with examples and quotes
- Actionable with clear recommendations
- Formatted as valid JSON

Always provide structured, detailed analysis covering sentiment, skills, concerns, strengths, communication, and recommendations.`
        },
        { 
          role: "user", 
          content: analysisPrompt
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 2500,
        temperature: 0.5, // Balanced temperature for faster yet accurate analysis
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysisContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Interview Analysis completed");
      
      return analysisContent;

    } catch (error) {
      console.error("Error calling Azure OpenAI for interview analysis:", error.message);
      throw error;
    }
  }

  async generateInterviewQuestions(prompt) {
    try {
      console.log("Generating interview questions with Azure OpenAI...");
      
      const messages = [
        {
          role: "system",
          content: `You are an expert interview designer with 20+ years of experience in talent acquisition and behavioral psychology. You create high-quality, unbiased, and legally compliant interview questions.

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON format
- Questions must be specific, actionable, and measurable
- Include diverse question types and difficulty levels
- Ensure cultural sensitivity and legal compliance
- Avoid bias, leading questions, or discriminatory content
- Focus on job-relevant competencies and skills

JSON STRUCTURE REQUIRED:
Return a JSON object with a "questions" array containing question objects:
{
  "questions": [
    {
      "question": "The interview question text",
      "expectedAnswer": "Detailed guidelines for what to look for in responses",
      "scoringCriteria": [
        {
          "criterion": "Criterion name",
          "weight": 10,
          "description": "What to evaluate"
        }
      ],
      "followUpQuestions": [
        {
          "question": "Follow-up question text",
          "condition": "When to ask this question"
        }
      ],
      "tags": ["skill1", "skill2", "competency1"],
      "timeLimit": 5
    }
  ]
}

ENSURE:
- All questions are professional and appropriate
- Expected answers provide clear evaluation guidance
- Scoring criteria are objects with criterion, weight, and description
- Follow-up questions are objects with question and condition fields
- Tags reflect relevant skills and competencies
- Always return the questions array wrapped in a questions object`
        },
        { 
          role: "user", 
          content: prompt
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 2500,
        temperature: 0.9, // High temperature for creative and diverse question generation
        top_p: 0.95,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const generatedContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Interview Questions Response:", generatedContent.substring(0, 200) + "...");
      
      try {
        const parsedResponse = this.extractJsonObject(generatedContent);
        
        // Handle different response formats
        if (parsedResponse.questions && Array.isArray(parsedResponse.questions)) {
          return parsedResponse.questions;
        } else if (Array.isArray(parsedResponse)) {
          return parsedResponse;
        } else if (parsedResponse.question) {
          // Single question object, wrap in array
          return [parsedResponse];
        } else {
          // Try to extract any question-like objects
          const questionKeys = Object.keys(parsedResponse).filter(key => 
            parsedResponse[key] && 
            typeof parsedResponse[key] === 'object' && 
            parsedResponse[key].question
          );
          
          if (questionKeys.length > 0) {
            return questionKeys.map(key => parsedResponse[key]);
          }
          
          throw new Error('Invalid response format: no questions found in response');
        }
      } catch (jsonError) {
        console.error("Error parsing JSON from Azure OpenAI:", jsonError);
        throw new Error(`Failed to parse AI response: ${jsonError.message}`);
      }

    } catch (error) {
      console.error("Error generating interview questions:", error.message);
      throw error;
    }
  }

  async generateInterviewSummary(interviewData) {
    try {
      console.log("🎯 Generating AI interview summary with Azure OpenAI...");
      
      const { transcript, jobContext, candidateInfo, interviewType, duration } = interviewData;
      
      const messages = [
        {
          role: "system",
          content: `You are an expert interview analyst with extensive experience in talent acquisition and comprehensive interview assessment. Generate a detailed, professional interview summary that provides actionable insights for hiring decisions.

Your analysis should be:
- Objective and evidence-based from the transcript
- Comprehensive covering all key areas
- Actionable with specific recommendations
- Professional and fair
- Structured with clear sections

Always respond in valid JSON format with the following structure:
{
  "summary": "A comprehensive 3-4 paragraph summary of the interview",
  "keyInsights": [
    "Key insight 1 with specific evidence",
    "Key insight 2 with examples from transcript",
    "Key insight 3 about performance or behavior"
  ],
  "candidateStrengths": [
    "Specific strength with evidence from transcript",
    "Another strength with examples"
  ],
  "candidateConcerns": [
    "Specific concern with evidence",
    "Another area for improvement"
  ],
  "recommendation": "strong_yes|yes|maybe|no|strong_no",
  "confidence": 85,
  "methodology": "Brief description of analysis approach and key factors considered"
}`
        },
        { 
          role: "user", 
          content: `Please analyze this interview and provide a comprehensive summary:

**INTERVIEW CONTEXT:**
Job Role: ${jobContext?.title || 'Not specified'}
Department: ${jobContext?.department || 'Not specified'}
Level: ${jobContext?.level || 'Not specified'}
Required Skills: ${jobContext?.skills || 'Not specified'}
Interview Type: ${interviewType || 'General Interview'}
Duration: ${duration ? `${duration} minutes` : 'Not specified'}

**CANDIDATE INFORMATION:**
Name: ${candidateInfo?.name || 'Not specified'}
Current Role: ${candidateInfo?.position || 'Not specified'}
Experience: ${candidateInfo?.experience || 'Not specified'}
Background: ${candidateInfo?.background || 'From transcript'}

**INTERVIEW TRANSCRIPT:**
${transcript}

**ANALYSIS REQUIREMENTS:**
1. Provide a comprehensive summary of the interview performance
2. Identify key strengths demonstrated during the conversation
3. Note any concerns or areas for improvement
4. Give specific examples and evidence from the transcript
5. Provide a hiring recommendation with confidence level
6. Consider role requirements and cultural fit

Focus on:
- Technical competency (if applicable)
- Communication skills and clarity
- Problem-solving approach
- Cultural fit and team dynamics
- Growth potential and learning mindset
- Specific examples from the conversation

Return only valid JSON.` 
        }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 2000,
        temperature: 0.5, // Balanced for thorough analysis
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const summaryContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Interview Summary Generated");
      
      try {
        const parsedSummary = this.extractJsonObject(summaryContent);
        return {
          success: true,
          summary: parsedSummary
        };
      } catch (jsonError) {
        console.error("Error parsing interview summary JSON:", jsonError);
        return {
          success: false,
          error: "Failed to parse AI interview summary",
          rawResponse: summaryContent
        };
      }

    } catch (error) {
      console.error("Error generating interview summary:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async analyzeTeamComments(commentsData) {
    try {
      console.log("🤝 Analyzing team comments with Azure OpenAI...");
      
      const { comments, interviewContext, candidateInfo } = commentsData;
      
      if (!comments || comments.length === 0) {
        return {
          success: false,
          error: "No comments provided for analysis"
        };
      }

      // Prepare comments for analysis
      const formattedComments = comments.map((comment, index) => {
        return `**Comment ${index + 1}** (by ${comment.authorName || 'Anonymous'} - ${comment.authorRole || 'Team Member'}):
Type: ${comment.commentType || 'general'}
Rating: ${comment.rating ? `Overall: ${comment.rating.overall}/5, Technical: ${comment.rating.technical}/5, Communication: ${comment.rating.communication}/5` : 'Not rated'}
Content: ${comment.content}
Categories: ${comment.categories ? comment.categories.join(', ') : 'None specified'}
Sentiment: ${comment.aiFlags?.sentiment || 'Not analyzed'}
Posted: ${comment.createdAt || 'Unknown time'}`;
      }).join('\n\n');

      const messages = [
        {
          role: "system",
          content: `You are an expert HR analyst specializing in team consensus building and comprehensive candidate evaluation. Analyze team feedback to provide objective, data-driven insights for hiring decisions.

Your analysis should:
- Identify patterns and consensus across team feedback
- Weight feedback based on role relevance and expertise
- Provide balanced, objective recommendations
- Highlight areas of agreement and disagreement
- Consider diverse perspectives and potential biases
- Generate actionable next steps

Always respond in valid JSON format with this exact structure:
{
  "overallSentiment": "very_positive|positive|neutral|negative|very_negative",
  "sentimentScore": 75,
  "consensus": {
    "level": "strong_consensus|consensus|mixed|no_consensus|polarized",
    "areas": [
      {
        "topic": "Technical Skills",
        "agreement": "unanimous|majority|split|minority", // IMPORTANT: Use ONLY these 4 values, NOT 'single'
        "details": "Specific details about this area"
      }
    ]
  },
  "commonThemes": [
    {
      "theme": "Communication Excellence",
      "frequency": 4,
      "sentiment": "positive",
      "examples": ["Specific example 1", "Example 2"]
    }
  ],
  "identifiedStrengths": [
    {
      "strength": "Strong technical background",
      "mentionedBy": 3,
      "priority": "critical|important|moderate|minor"
    }
  ],
  "identifiedConcerns": [
    {
      "concern": "Limited experience in X",
      "severity": "critical|high|medium|low",
      "mentionedBy": 2,
      "consensus": "unanimous|majority|split|single" // Note: 'single' is ONLY valid here, NOT in consensus.areas.agreement
    }
  ],
  "finalRecommendation": {
    "decision": "strong_yes|yes|maybe|no|strong_no",
    "confidence": 82,
    "reasoning": "Detailed reasoning for the recommendation",
    "keyFactors": ["Factor 1", "Factor 2"],
    "riskFactors": ["Risk 1", "Risk 2"],
    "nextSteps": ["Next step 1", "Next step 2"]
  }
}

CRITICAL: The 'agreement' field in consensus.areas MUST be one of: unanimous, majority, split, or minority.
The 'consensus' field in identifiedConcerns can be: unanimous, majority, split, or single.
Never use 'single' for consensus.areas.agreement!`
        },
        {
          role: "user",
          content: `Please analyze the following team feedback and provide comprehensive insights:

**INTERVIEW CONTEXT:**
Position: ${interviewContext?.jobTitle || 'Not specified'}
Department: ${interviewContext?.department || 'Not specified'}
Interview Type: ${interviewContext?.interviewType || 'Not specified'}
Date: ${interviewContext?.interviewDate || 'Not specified'}

**CANDIDATE:**
Name: ${candidateInfo?.name || 'Not specified'}
Current Role: ${candidateInfo?.position || 'Not specified'}
Experience Level: ${candidateInfo?.experience || 'Not specified'}

**TEAM FEEDBACK (${comments.length} comments):**
${formattedComments}

**ANALYSIS REQUIREMENTS:**

1. **Sentiment Analysis**: Determine overall team sentiment and calculate a sentiment score (0-100)

2. **Consensus Analysis**:
   - Identify level of consensus among team members
   - Break down agreement by key areas (technical, cultural, communication, etc.)
   - Note any polarized opinions

3. **Theme Identification**:
   - Extract common themes across all feedback
   - Identify frequency and sentiment of each theme
   - Provide specific examples

4. **Strengths & Concerns**:
   - Aggregate strengths mentioned by team members
   - Prioritize by frequency and impact
   - Identify concerns with severity levels
   - Note consensus level for each concern

5. **Final Recommendation**:
   - Provide hiring recommendation based on all feedback
   - Include confidence level and detailed reasoning
   - List key supporting factors and risk factors
   - Suggest specific next steps

Consider:
- Weight feedback based on interviewer role and expertise
- Look for bias or inconsistencies in feedback
- Balance different perspectives fairly
- Focus on job-relevant criteria
- Consider team dynamics and cultural fit

Return only valid JSON.`
        }
      ];
      
      console.log("--- PROMPT FOR AI ANALYSIS ---");
      console.log(JSON.stringify(messages, null, 2));
      console.log("-----------------------------");

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 2500,
        temperature: 0.4, // Lower temperature for more consistent analysis
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysisContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Team Comments Analysis Generated. Raw response:", analysisContent);
      
      try {
        const parsedAnalysis = this.extractJsonObject(analysisContent);
        return {
          success: true,
          analysis: parsedAnalysis,
          metadata: {
            totalComments: comments.length,
            participantCount: new Set(comments.map(c => c.authorId)).size,
            analysisTimestamp: new Date().toISOString()
          }
        };
      } catch (jsonError) {
        console.error("Error parsing team comments analysis JSON:", jsonError);
        console.error("Raw response that failed to parse:", analysisContent);
        return {
          success: false,
          error: "Failed to parse AI team comments analysis",
          rawResponse: analysisContent
        };
      }

    } catch (error) {
      console.error("Error analyzing team comments:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async analyzeTextForBias(textToAnalyze, jobContext = null) {
    try {
      console.log("🧠 Analyzing text for bias with Azure OpenAI...");
      const systemPrompt = `You are an expert AI assistant specializing in identifying and quantifying bias in text. Your goal is to analyze the provided interview question for various forms of bias, considering the provided job context if available, and provide a structured assessment.

Focus on detecting bias related to:
- Age
- Gender (including gendered language, stereotypes)
- Race and Ethnicity
- Nationality and Origin (including accent, native language)
- Religion or Belief
- Disability
- Sexual Orientation
- Socio-economic status
- Marital or Family Status
- Cultural assumptions or stereotypes

CRITICAL JSON OUTPUT REQUIREMENTS:
You MUST return a valid JSON object with the following EXACT structure:
{
  "overallBiasScore": 0.0, // A score from 0.0 (no bias) to 1.0 (high bias).
  "isBiased": false, // True if any significant bias is detected, false otherwise.
  "detectedBiasFactors": [ // An array of objects, one for each type of bias detected. Empty if no bias.
    {
      "type": "Age", // e.g., "Age", "Gender", "Nationality"
      "score": 0.0, // A score from 0.0 to 1.0 for this specific factor.
      "keywordsFound": ["example"], // Optional: specific keywords or phrases that triggered this.
      "explanation": "Explanation for this factor."
    }
  ],
  "neutralityConfidence": 1.0, // Your confidence (0.0 to 1.0) that the question is truly neutral given the context.
  "recommendation": "Question appears neutral."
}

SCORING GUIDELINES for overallBiasScore and factor scores:
- 0.0 - 0.1: No discernible bias / Very Low
- 0.2 - 0.4: Low potential bias, may warrant review
- 0.5 - 0.7: Medium potential bias, review strongly recommended
- 0.8 - 1.0: High potential bias, revision likely necessary

If JOB_CONTEXT is provided, use it to assess if any part of the question, while seemingly neutral in isolation, could become biased or inappropriate when considered for that specific job. For example, a question about physical prowess might be unbiased for a firefighter role but biased for an office role.
Be objective and base your analysis solely on the provided text and context. Ensure the "detectedBiasFactors" array is empty if no bias is detected, and "isBiased" is false, with an "overallBiasScore" close to 0.0. If bias is detected, populate "detectedBiasFactors" accurately.`;

      const userPrompt = `Please analyze the following interview question for any potential bias according to the detailed instructions and JSON output format provided in the system prompt.

JOB_CONTEXT:
${jobContext ? jobContext : "No specific job context provided. Analyze based on general professional hiring standards."}

INTERVIEW_QUESTION_TEXT:
"${textToAnalyze}"`;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ];

      const response = await this.client.chat.completions.create({
        messages: messages,
        max_completion_tokens: 800, // Adjusted for potentially detailed analysis
        temperature: 0.3, // Lower temperature for more deterministic bias analysis
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysisContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("Azure OpenAI Bias Analysis Response:", analysisContent);
      
      try {
        const parsedJson = this.extractJsonObject(analysisContent);
        // Basic validation of the expected structure
        if (typeof parsedJson.overallBiasScore !== 'number' || typeof parsedJson.isBiased !== 'boolean') {
            throw new Error("AI response for bias analysis is missing critical fields.");
        }
        return { success: true, analysis: parsedJson };
      } catch (jsonError) {
        console.error("Error parsing JSON from Azure OpenAI bias analysis:", jsonError);
        return {
          success: false,
          error: "Failed to parse AI bias analysis response",
          rawResponse: analysisContent
        };
      }

    } catch (error) {
      console.error("Error calling Azure OpenAI for bias analysis:", error.message);
      return {
        success: false,
        error: error.message,
        // Fallback structure in case of error, mirroring a "neutral" assessment but indicating failure
        analysis: {
          overallBiasScore: 0.0,
          isBiased: false,
          detectedBiasFactors: [],
          neutralityConfidence: 0.0, // Low confidence due to error
          recommendation: "Bias analysis failed; unable to assess question."
        }
      };
    }
  }
}

module.exports = AzureOpenAIService; 
