const aiRuntimeService = require('./aiRuntime/aiRuntimeService');
const { CHATGPT_MODEL } = require('../config/aiRuntimeCatalog');
const FLEXIBLE_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true
};

const CV_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: [
    'firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience',
    'education', 'skills', 'summary', 'strengths', 'potentialFlags', 'workExperience',
    'educationHistory', 'certifications', 'languages', 'awards', 'projects', 'publications',
    'volunteerWork', 'professionalMemberships', 'portfolioLinks', 'additionalSections', 'fullCVData'
  ],
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    location: { type: 'string' },
    position: { type: 'string' },
    experience: { type: 'string' },
    education: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    potentialFlags: { type: 'array', items: { type: 'string' } },
    workExperience: { type: 'object' },
    educationHistory: { type: 'array', items: { type: 'object' } },
    certifications: { type: 'array', items: { type: 'object' } },
    languages: { type: 'array', items: { type: 'object' } },
    awards: { type: 'array', items: { type: 'object' } },
    projects: { type: 'array', items: { type: 'object' } },
    publications: { type: 'array', items: { type: 'object' } },
    volunteerWork: { type: 'array', items: { type: 'object' } },
    professionalMemberships: { type: 'array', items: { type: 'object' } },
    portfolioLinks: { type: 'object' },
    additionalSections: { type: 'object' },
    fullCVData: { type: 'object' }
  }
};

const JOB_DESCRIPTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'responsibilities', 'requirements', 'skills', 'benefits'],
  properties: {
    description: { type: 'string', minLength: 900, maxLength: 1800 },
    responsibilities: {
      type: 'array', minItems: 8, maxItems: 8,
      items: { type: 'string', minLength: 12, maxLength: 180 }
    },
    requirements: {
      type: 'array', minItems: 8, maxItems: 8,
      items: { type: 'string', minLength: 12, maxLength: 180 }
    },
    skills: {
      type: 'array', minItems: 10, maxItems: 10,
      items: { type: 'string', minLength: 2, maxLength: 80 }
    },
    benefits: {
      type: 'array', minItems: 5, maxItems: 5,
      items: { type: 'string', minLength: 4, maxLength: 100 }
    }
  }
};

const JOB_REQUIREMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requiredQualifications', 'preferredQualifications'],
  properties: {
    requiredQualifications: {
      type: 'array', minItems: 6, maxItems: 8,
      items: { type: 'string', minLength: 12, maxLength: 220 }
    },
    preferredQualifications: {
      type: 'array', minItems: 4, maxItems: 6,
      items: { type: 'string', minLength: 12, maxLength: 220 }
    }
  }
};

const INTERVIEW_QUESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'type', 'difficulty', 'category', 'expectedAnswer', 'scoringCriteria', 'followUpQuestions', 'tags', 'timeLimit'],
        properties: {
          question: { type: 'string' },
          type: { type: 'string' },
          difficulty: { type: 'string' },
          category: { type: 'string' },
          expectedAnswer: { type: 'string' },
          scoringCriteria: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['criterion', 'weight', 'description'],
              properties: {
                criterion: { type: 'string' },
                weight: { type: 'number' },
                description: { type: 'string' }
              }
            }
          },
          followUpQuestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question', 'condition'],
              properties: { question: { type: 'string' }, condition: { type: 'string' } }
            }
          },
          tags: { type: 'array', items: { type: 'string' } },
          timeLimit: { type: 'number' }
        }
      }
    }
  }
};

const BIAS_ANALYSIS_REQUIRED_FIELDS = [
  'overallBiasScore',
  'isBiased',
  'detectedBiasFactors',
  'neutralityConfidence',
  'recommendation'
];

const BIAS_ANALYSIS_PROPERTIES = {
  overallBiasScore: { type: 'number', minimum: 0, maximum: 1 },
  isBiased: { type: 'boolean' },
  detectedBiasFactors: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'score', 'keywordsFound', 'explanation'],
      properties: {
        type: { type: 'string' },
        score: { type: 'number', minimum: 0, maximum: 1 },
        keywordsFound: { type: 'array', items: { type: 'string' } },
        explanation: { type: 'string' }
      }
    }
  },
  neutralityConfidence: { type: 'number', minimum: 0, maximum: 1 },
  recommendation: { type: 'string' }
};

const BIAS_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: BIAS_ANALYSIS_REQUIRED_FIELDS,
  properties: BIAS_ANALYSIS_PROPERTIES
};

const BIAS_ANALYSIS_BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analyses'],
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionIndex', ...BIAS_ANALYSIS_REQUIRED_FIELDS],
        properties: {
          questionIndex: { type: 'integer', minimum: 0 },
          ...BIAS_ANALYSIS_PROPERTIES
        }
      }
    }
  }
};

const STRUCTURED_CONTRACTS = {
  'candidate.cv_parse': { schema: CV_EXTRACTION_SCHEMA, schemaName: 'candidate_cv', schemaStrict: false },
  'ai_interview.cv_parse': { schema: CV_EXTRACTION_SCHEMA, schemaName: 'ai_interview_cv', schemaStrict: false },
  'interview.analysis': { schema: FLEXIBLE_OBJECT_SCHEMA, schemaName: 'interview_analysis', schemaStrict: false },
  'interview.questions': { schema: INTERVIEW_QUESTIONS_SCHEMA, schemaName: 'interview_questions', schemaStrict: true },
  'interview.summary': { schema: FLEXIBLE_OBJECT_SCHEMA, schemaName: 'interview_summary', schemaStrict: false },
  'interview.team_feedback': { schema: FLEXIBLE_OBJECT_SCHEMA, schemaName: 'interview_team_feedback', schemaStrict: false },
  'interview.bias': { schema: BIAS_ANALYSIS_SCHEMA, schemaName: 'interview_bias', schemaStrict: true }
};

/**
 * A failed wrapper result must keep the runtime error's identity: HTTP
 * handlers and the frontend runtime gate route on .code/.statusCode to tell
 * "connect your ChatGPT account" apart from a genuine server fault.
 */
function runtimeFailure(error, extra = {}) {
  return {
    success: false,
    error: error.message,
    code: error.code,
    statusCode: error.statusCode,
    retryable: error.retryable === true,
    ...extra
  };
}

class AIModelService {
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

    this.modelName = CHATGPT_MODEL;
    this.deployment = CHATGPT_MODEL;
    this.endpoint = 'managed-by-ai-runtime';
    this.apiVersion = 'chatgpt-connect-v1';
  }

  async requestCompletion(request = {}) {
    const { signal, ...runtimeRequest } = request;
    const result = await aiRuntimeService.complete(runtimeRequest.activity || 'recruiter.general', runtimeRequest, {
      context: request.context,
      signal
    });
    return result.raw;
  }

  async requestStructuredCompletion(request = {}, contractOverride = null) {
    const activity = request.activity || 'recruiter.general';
    const contract = contractOverride || STRUCTURED_CONTRACTS[activity];
    if (!contract) throw new Error(`No structured output contract is configured for ${activity}`);
    const { beforeAttempt, signal, ...runtimeRequest } = request;
    const result = await aiRuntimeService.structuredComplete(activity, {
      ...runtimeRequest,
      jsonSchema: contract.schema,
      schemaName: contract.schemaName,
      schemaStrict: contract.schemaStrict
    }, { beforeAttempt, signal });
    return result.raw;
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

    const parseCandidates = [];
    const addCandidate = (candidate) => {
      if (candidate && typeof candidate === 'string') {
        const cleaned = this.cleanJsonCandidate(candidate);
        if (cleaned && !parseCandidates.includes(cleaned)) {
          parseCandidates.push(cleaned);
        }
      }
    };

    addCandidate(content);

    const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
      addCandidate(fencedMatch[1]);
    }

    const balancedCandidate = this.extractBalancedJsonObject(content);
    if (balancedCandidate) {
      addCandidate(balancedCandidate);
    }

    let lastError = null;
    for (const candidate of parseCandidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Could not parse JSON object from model response.${lastError ? ` ${lastError.message}` : ''}`);
  }

  cleanJsonCandidate(candidate) {
    return candidate
      .trim()
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
  }

  extractBalancedJsonObject(content) {
    const start = content.indexOf('{');
    if (start === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < content.length; i += 1) {
      const char = content[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = inString;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return content.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  getResponsePreview(content, maxLength = 600) {
    const text = this.extractTextContent(content).replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  async generateJsonObject(messages, options = {}, contextLabel = 'AI JSON generation') {
    const activity = options.activity || 'recruiter.general';
    const result = await aiRuntimeService.structuredComplete(activity, {
      context: options.context,
      promptVersion: options.promptVersion,
      messages,
      max_tokens: options.max_completion_tokens ?? 1500,
      retryMaxTokens: options.retry_max_completion_tokens,
      compactMaxTokens: options.compact_max_completion_tokens,
      compactMaxChars: options.compact_max_chars,
      temperature: options.temperature ?? 0.4,
      top_p: options.top_p ?? 1,
      frequency_penalty: options.frequency_penalty ?? 0,
      presence_penalty: options.presence_penalty ?? 0,
      jsonSchema: options.jsonSchema || FLEXIBLE_OBJECT_SCHEMA,
      schemaName: options.schemaName || contextLabel.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64),
      schemaStrict: options.schemaStrict === true
    });
    return {
      parsed: result.data,
      rawContent: result.content,
      usage: result.usage,
      attempt: result.schemaRepairAttempted ? 2 : 1
    };
  }

  coerceStringArray(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => (item === null || item === undefined ? '' : String(item).trim()))
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(/\n|(?:^|\s)[\-*\u2022]\s+/)
        .map((item) => item.replace(/^\d+[.)]\s*/, '').trim())
        .filter(Boolean);
    }

    return [];
  }

  async chatCompletion(messages, options = {}) {
    const requestBody = {
      activity: options.activity || 'recruiter.general',
      context: options.context,
      promptVersion: options.promptVersion,
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

    const response = await this.requestCompletion(requestBody);
    const content = this.extractTextContent(response?.choices?.[0]?.message?.content);

    return {
      success: true,
      content,
      usage: response?.usage,
      rawResponse: response
    };
  }

  async structuredCompletion(messages, options = {}) {
    const result = await aiRuntimeService.structuredComplete(options.activity || 'recruiter.general', {
      messages,
      context: options.context,
      promptVersion: options.promptVersion,
      temperature: options.temperature,
      top_p: options.top_p,
      max_tokens: options.maxTokens ?? options.max_completion_tokens,
      jsonSchema: options.jsonSchema,
      schemaName: options.schemaName,
      schemaStrict: options.schemaStrict !== false
    });
    return {
      success: true,
      content: result.content,
      data: result.data,
      usage: result.usage,
      schemaRepairAttempted: result.schemaRepairAttempted
    };
  }

  async generateCompletion(prompt, options = {}) {
    const result = await this.chatCompletion(
      [{ role: 'user', content: prompt }],
      {
        temperature: options.temperature ?? 0.5,
        maxTokens: options.maxTokens,
        max_completion_tokens: options.max_completion_tokens,
        response_format: options.response_format,
        activity: options.activity,
        context: options.context,
        promptVersion: options.promptVersion
      }
    );

    return result.content;
  }

  async generateStructuredObject(prompt, options = {}) {
    const activity = options.activity || 'recruiter.general';
    const result = await aiRuntimeService.structuredComplete(activity, {
      messages: [{ role: 'user', content: prompt }],
      context: options.context,
      promptVersion: options.promptVersion,
      temperature: options.temperature,
      max_tokens: options.maxTokens ?? options.max_completion_tokens,
      jsonSchema: options.jsonSchema || FLEXIBLE_OBJECT_SCHEMA,
      schemaName: options.schemaName || activity.replace(/[^a-z0-9_-]/gi, '_'),
      schemaStrict: options.schemaStrict === true
    });
    return result.data;
  }

  async testConnection() {
    try {
      console.log("Testing managed AI runtime connection...");

      const response = await this.requestCompletion({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello world in JSON format with a message field." }
        ],
        max_completion_tokens: 100,
        temperature: 0,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const responseText = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("AI runtime connection successful.");
      console.log("AI runtime test response received.");
      return { success: true, response: responseText };

    } catch (error) {
      console.error("AI runtime connection failed:", error.message);
      return runtimeFailure(error);
    }
  }

  async analyzeCV(cvText, activity = 'candidate.cv_parse', options = {}) {
    try {
      console.log("Analyzing CV with ChatGPT Connect.");

      const messages = [
        {
          role: "system",
          content: `You are an AI assistant specialized in parsing CVs and extracting COMPLETE and detailed structured information.

          CRITICAL ANTI-HALLUCINATION RULES:
          1. ONLY extract information that is EXPLICITLY present in the CV text provided
          2. NEVER invent, generate, or hallucinate names, emails, phone numbers, or any other information
          3. If the CV text appears empty or contains minimal content, return mostly N/A/null values
          4. If you cannot find a string field, use "N/A"; for number fields, use null - DO NOT make up data
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
          - If a field is not found in the CV, use "N/A" for strings, null for numbers, empty array [] for arrays, or empty object {} for objects
          - NEVER make up or invent information that is not in the CV text
          - If the CV text is minimal or unclear, return minimal extracted data with mostly N/A/null values
          - For arrays (education, certifications, etc.), include ALL instances found in the CV
          - Extract complete details - don't summarize or skip information that EXISTS in the CV
          - For unlabeled sections (e.g., a section titled "Side Projects" or "Research Experience"), add them to additionalSections
          - Ensure the output is a valid JSON object
          - Be thorough with information that IS present, but never invent information that ISN'T`
        },
        {
          role: "user",
          content: `Analyze the following CV text and extract information. ONLY extract what is explicitly present. If the CV text is empty or minimal, return N/A for strings and null for numbers. DO NOT invent names or other information.

CV text:

${cvText}`
        }
      ];

      const response = await this.requestStructuredCompletion({
        activity,
        promptVersion: 'candidate-cv-v2',
        messages: messages,
        max_completion_tokens: 8_000,
        temperature: 0,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: this.modelName,
        response_format: { type: "json_object" },
        signal: options.signal
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const analysisContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("AI CV analysis response received.");

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
        console.error("Error parsing AI CV analysis JSON:", jsonError.message);
        return {
          success: false,
          error: "Failed to parse AI analysis"
        };
      }

    } catch (error) {
      console.error("Error calling the AI runtime for CV analysis:", error.message);
      return runtimeFailure(error);
    }
  }

  async generateJobDescription(jobData) {
    try {
      console.log("Generating job description with the managed AI runtime.");

      const { title, department, level, location, type, experience, education } = jobData;

      const messages = [
        {
          role: "system",
          content: `You are a senior talent partner. Create a role-specific job description from only the supplied facts.

Writing requirements:
- Use inclusive, direct, plain text with no Markdown.
- Describe concrete ownership, collaboration, decisions, deliverables, and outcomes.
- Avoid generic filler and do not repeat ideas across sections.
- Keep expectations realistic for the stated seniority.
- Do not invent a company, salary, stack, reporting line, metrics, entitlements, or confirmed benefits.
- Phrase benefits as options the employer can confirm or customise.

Content requirements:
- description: three concise paragraphs covering purpose, operating context, and expected impact.
- responsibilities: eight distinct, observable, outcome-oriented items.
- requirements: eight genuinely necessary criteria.
- skills: ten relevant technical and behavioural skills.
- benefits: five concise employer-confirmable options.

The response schema enforces field names, counts, and length limits.`
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

      const { parsed: parsedJson, rawContent, attempt } = await this.generateJsonObject(
        messages,
        {
          activity: 'job.description',
          promptVersion: 'job-description-v3',
          jsonSchema: JOB_DESCRIPTION_SCHEMA,
          schemaName: 'job_description',
          schemaStrict: true,
          max_completion_tokens: 3200,
          retry_max_completion_tokens: 4200,
          compact_max_completion_tokens: 1800,
          compact_max_chars: 7000,
          temperature: 0.3,
          frequency_penalty: 0,
          presence_penalty: 0,
          schemaHint: 'The runtime supplies and validates the job-description JSON Schema.'
        },
        "Job description generation"
      );

      console.log("AI job description parsed:", {
        attempt,
        responseLength: rawContent.length
      });

      const nestedJobDescription =
        parsedJson.jobDescription && typeof parsedJson.jobDescription === 'object'
          ? parsedJson.jobDescription
          : null;
      const source =
        parsedJson.job && typeof parsedJson.job === 'object'
          ? parsedJson.job
          : nestedJobDescription || parsedJson;
      const description =
        source.description ||
        (typeof source.jobDescription === 'string' ? source.jobDescription : '') ||
        nestedJobDescription?.description ||
        source.summary ||
        '';

      return {
        success: true,
        description: this.sanitizeAIContent(description),
        responsibilities: this.sanitizeArrayContent(
          this.coerceStringArray(source.responsibilities || source.keyResponsibilities || source.duties)
        ),
        requirements: this.sanitizeArrayContent(
          this.coerceStringArray(source.requirements || source.qualifications || source.requiredQualifications)
        ),
        skills: this.sanitizeArrayContent(
          this.coerceStringArray(source.skills || source.keySkills || source.competencies)
        ),
        benefits: this.sanitizeArrayContent(
          this.coerceStringArray(source.benefits || source.perks || source.compensationBenefits)
        )
      };

    } catch (error) {
      console.error("Error calling the AI runtime for job description:", error.message);
      return runtimeFailure(error);
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
      console.log("Generating job requirements with the managed AI runtime.");

      const { title, department, level, type, experience, education } = jobData;

      const messages = [
        {
          role: "system",
          content: `You are a senior talent partner. Create comprehensive, realistic job requirements from only the supplied role facts.

- Separate genuinely essential qualifications from useful preferences.
- Cover relevant experience, education, technical capability, and behavioural skills without padding.
- Keep every item specific, concise, measurable where appropriate, and realistic for the seniority.
- Use professional plain text with no Markdown or formatting symbols.
- Do not invent a company, technology stack, certification, or legal requirement.

The response schema enforces the two sections, item counts, and length limits.`
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

      const { parsed: generatedRequirementsJson, rawContent: generatedContent, attempt } = await this.generateJsonObject(
        messages,
        {
          activity: 'job.requirements',
          promptVersion: 'job-requirements-v2',
          jsonSchema: JOB_REQUIREMENTS_SCHEMA,
          schemaName: 'job_requirements',
          schemaStrict: true,
          max_completion_tokens: 1800,
          retry_max_completion_tokens: 2600,
          compact_max_completion_tokens: 900,
          compact_max_chars: 3200,
          temperature: 0.3,
          frequency_penalty: 0,
          presence_penalty: 0,
          schemaHint: 'The runtime supplies and validates the job-requirements JSON Schema.'
        },
        "Job requirements generation"
      );

      console.log("AI job requirements parsed:", {
        attempt,
        responseLength: generatedContent.length
      });

      try {
        const parsedJson = generatedRequirementsJson;

        const source =
          parsedJson.requirements && typeof parsedJson.requirements === 'object' && !Array.isArray(parsedJson.requirements)
            ? parsedJson.requirements
            : parsedJson;

        const requiredQualifications = this.coerceStringArray(
          source.requiredQualifications ||
            source.required ||
            source.mustHave ||
            source.mustHaveQualifications ||
            (Array.isArray(source.requirements) ? source.requirements : null)
        );

        const preferredQualifications = this.coerceStringArray(
          source.preferredQualifications ||
            source.preferred ||
            source.niceToHave ||
            source.niceToHaveQualifications
        );

        if (!requiredQualifications.length) {
          throw new Error("AI response did not include required qualifications");
        }

        const sanitized = {
          requiredQualifications: this.sanitizeArrayContent(requiredQualifications),
          preferredQualifications: this.sanitizeArrayContent(preferredQualifications)
        };

        // Format as readable text for backward compatibility and better display
        let formattedText = "Required Qualifications:\n\n";
        sanitized.requiredQualifications.forEach((qual) => {
          formattedText += `- ${qual}\n`;
        });

        if (sanitized.preferredQualifications.length) {
          formattedText += "\n\nPreferred Qualifications:\n\n";
          sanitized.preferredQualifications.forEach((qual) => {
            formattedText += `- ${qual}\n`;
          });
        }

        return {
          success: true,
          requirements: formattedText.trim(),
          structured: sanitized // Also return structured format for modern frontends
        };
      } catch (jsonError) {
        console.error("Error parsing AI job requirements JSON:", jsonError.message);
        return {
          success: false,
          error: "Failed to parse AI response",
          rawResponse: generatedContent
        };
      }

    } catch (error) {
      console.error("Error calling the AI runtime for job requirements:", error.message);
      return runtimeFailure(error);
    }
  }

  async generateChatResponse(userMessage, systemContext = '', options = {}) {
    try {
      console.log("Generating chat response with the managed AI runtime.");

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

      const response = await this.requestCompletion({
        activity: options.activity || 'assistant.chat',
        promptVersion: options.promptVersion || 'assistant-chat-v1',
        context: options.context,
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
      console.log("AI chat response received.");

      return {
        success: true,
        response: aiResponse,
        confidence: 0.85, // Could be enhanced with actual confidence scoring
        processingTime: processingTime
      };

    } catch (error) {
      console.error("Error calling the AI runtime for chat:", error.message);
      return runtimeFailure(error, {
        response: "I'm sorry, I'm having trouble processing your request right now. Please try again."
      });
    }
  }

  async analyzeCandidateInsights(candidateData) {
    try {
      console.log("Generating candidate insights with the managed AI runtime.");

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

      const response = await this.requestCompletion({
        activity: 'candidate.insights',
        promptVersion: 'candidate-insights-text-v1',
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
      console.log("AI candidate insights received.");

      return {
        success: true,
        response: insights
      };

    } catch (error) {
      console.error("Error calling the AI runtime for insights:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateReportAnalysis(reportData, reportType) {
    try {
      console.log(`Generating ${reportType} report analysis with the managed AI runtime.`);

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

      const response = await this.requestCompletion({
        activity: 'report.analysis',
        promptVersion: 'report-analysis-v1',
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
      console.log("AI report analysis received.");

      return {
        success: true,
        response: analysis
      };

    } catch (error) {
      console.error("Error calling the AI runtime for report analysis:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateChatTitle(firstUserMessage, firstAssistantMessage = null) {
    try {
      console.log("Generating chat title with the managed AI runtime.");

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

      const response = await this.requestCompletion({
        activity: 'assistant.title',
        promptVersion: 'assistant-title-v1',
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
      console.log("AI chat title generated.");

      return {
        success: true,
        title: generatedTitle
      };

    } catch (error) {
      console.error("Error generating chat title:", error.message);
      return runtimeFailure(error, { title: "HR Chat Session" });
    }
  }

  /**
   * Generate interview questions using AI
   */
  async analyzeInterview(analysisPrompt) {
    try {
      console.log("Analyzing interview transcript with the managed AI runtime.");

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

      const response = await this.requestStructuredCompletion({
        activity: 'interview.analysis',
        promptVersion: 'interview-analysis-v2',
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
      console.log("AI interview analysis completed.");

      return analysisContent;

    } catch (error) {
      console.error("Error calling the AI runtime for interview analysis:", error.message);
      throw error;
    }
  }

  async generateInterviewQuestions(prompt) {
    try {
      console.log("Generating interview questions with the managed AI runtime.");

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
      "type": "technical | behavioral | situational | cultural_fit | skills_based | experience_based",
      "difficulty": "easy | medium | hard",
      "category": "short job-relevant competency",
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
- Expected answers provide detailed evidence-based evaluation guidance
- Scoring criteria are objects with criterion, weight, and description
- Include 3 or 4 distinct scoring criteria with weights totalling 100
- Follow-up questions are objects with question and condition fields
- Tags reflect relevant skills and competencies
- Every question is grounded in a concrete skill, responsibility, outcome, or constraint from the supplied job context
- A role title alone is not sufficient grounding; use a named skill, deliverable, metric, stakeholder, system, or responsibility
- Questions are materially different from one another
- Expected-answer guidance must name question-specific evidence, decisions, trade-offs, and measurable outcomes; never use stock phrases such as "look for technical depth"
- Follow-ups must probe missing evidence and must not restate the main question
- Before returning, silently verify question count, type, difficulty, distinct scenarios, protected-trait safety, criteria weights, and job grounding

QUALITY CONTRAST:
- Weak: "Describe your approach to solving complex technical problems."
- Strong pattern: present a realistic job-specific situation, name a concrete constraint or competing priority, and ask for the candidate's decision process, evidence, trade-offs, and success measure
- Always return the questions array wrapped in a questions object`
        },
        {
          role: "user",
          content: prompt
        }
      ];

      const response = await this.requestStructuredCompletion({
        activity: 'interview.questions',
        promptVersion: 'interview-questions-v4',
        messages: messages,
        max_completion_tokens: 4000,
        temperature: 0.6,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        model: this.modelName,
        response_format: { type: "json_object" }
      });

      if (response?.error !== undefined && response.status !== "200") {
        throw response.error;
      }

      const generatedContent = this.extractTextContent(response.choices?.[0]?.message?.content);
      console.log("AI interview questions received.");

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
        console.error("Error parsing AI interview question JSON:", jsonError.message);
        throw new Error(`Failed to parse AI response: ${jsonError.message}`);
      }

    } catch (error) {
      console.error("Error generating interview questions:", error.message);
      throw error;
    }
  }

  async generateInterviewSummary(interviewData) {
    try {
      console.log("Generating AI interview summary with the managed AI runtime.");

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

      const response = await this.requestStructuredCompletion({
        activity: 'interview.summary',
        promptVersion: 'interview-summary-v2',
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
      console.log("AI interview summary generated.");

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
      return runtimeFailure(error);
    }
  }

  async analyzeTeamComments(commentsData) {
    try {
      console.log("Analyzing team comments with the managed AI runtime.");

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

      const response = await this.requestStructuredCompletion({
        activity: 'interview.team_feedback',
        promptVersion: 'interview-team-feedback-v2',
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
      console.log("AI team comments analysis generated.");

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
        console.error("AI team comments analysis returned invalid JSON.");
        return {
          success: false,
          error: "Failed to parse AI team comments analysis",
          rawResponse: analysisContent
        };
      }

    } catch (error) {
      console.error("Error analyzing team comments:", error.message);
      return runtimeFailure(error);
    }
  }

  _normalizeBiasAnalysis(rawAnalysis) {
    const analysis = rawAnalysis || {};
    const detectedBiasFactors = Array.isArray(analysis.detectedBiasFactors)
      ? analysis.detectedBiasFactors.map((factor) => ({
          type: String(factor?.type || '').trim(),
          score: Number(factor?.score),
          keywordsFound: Array.isArray(factor?.keywordsFound)
            ? factor.keywordsFound.map((keyword) => String(keyword || '').trim()).filter(Boolean).slice(0, 12)
            : [],
          explanation: String(factor?.explanation || '').trim()
        }))
      : [];

    if (!Number.isFinite(Number(analysis.overallBiasScore))
      || !Number.isFinite(Number(analysis.neutralityConfidence))
      || typeof analysis.isBiased !== 'boolean'
      || !String(analysis.recommendation || '').trim()) {
      throw new Error('Bias analysis is missing required assessment fields.');
    }
    if (detectedBiasFactors.some((factor) => !factor.type || !factor.explanation || !Number.isFinite(factor.score))) {
      throw new Error('Bias analysis contains an incomplete bias factor.');
    }
    if (analysis.isBiased && !detectedBiasFactors.length) {
      throw new Error('Bias analysis marked the question as biased without identifying a factor.');
    }
    if (!analysis.isBiased && Number(analysis.overallBiasScore) >= 0.5) {
      throw new Error('Bias analysis score conflicts with its bias decision.');
    }

    return {
      overallBiasScore: Number(analysis.overallBiasScore),
      isBiased: analysis.isBiased,
      detectedBiasFactors,
      neutralityConfidence: Number(analysis.neutralityConfidence),
      recommendation: String(analysis.recommendation).trim()
    };
  }

  async analyzeQuestionsForBias(questionTexts, jobContext = null) {
    const suppliedQuestions = (Array.isArray(questionTexts) ? questionTexts : [questionTexts]).slice(0, 20);
    const questions = suppliedQuestions
      .map((question, questionIndex) => ({
        questionIndex,
        question: String(question || '').trim()
      }))
      .filter(({ question }) => Boolean(question));
    if (!questions.length) {
      return {
        success: false,
        analyses: Array(suppliedQuestions.length).fill(null),
        error: 'At least one interview question is required for bias analysis.'
      };
    }

    const analyses = Array(suppliedQuestions.length).fill(null);
    const errors = questions.length === suppliedQuestions.length
      ? []
      : ['One or more blank questions were skipped and require manual review.'];
    let runtimeErrorCode;
    let runtimeErrorStatus;
    const batchSize = 5;
    const systemPrompt = `You are an employment-interview bias reviewer. Assess each supplied question independently and preserve its questionIndex.

Review only job-related fairness and protected-characteristic risk: age, disability, family or marital status, gender, nationality or origin, race or ethnicity, religion or belief, sexual orientation, socio-economic assumptions, and cultural stereotypes.

Decision policy:
- Mark isBiased true when wording requests protected information, relies on a stereotype, or creates a job-irrelevant disadvantage.
- A demanding or senior question is not biased merely because it is difficult.
- Use the job context only to judge whether a requirement is genuinely relevant and proportionate.
- keywordsFound must contain only exact triggering words or short phrases from the question. Use an empty array for conceptual bias without a direct phrase.
- If neutral, use an empty detectedBiasFactors array and keep overallBiasScore below 0.2.
- If isBiased is true, identify at least one factor and give a concrete rewrite recommendation.

Calibration examples:
- "Are you planning to have children?" is high family-status bias.
- "Describe how you prioritized competing roadmap requests using evidence" is neutral for a product role.
- "Will your accent make customers uncomfortable?" is high nationality or origin bias.

Return concise evidence-based assessments. Never infer candidate characteristics and never expose hidden reasoning.`;
    const boundedJobContext = String(jobContext || 'No specific job context supplied; use general professional hiring standards.').slice(0, 8000);

    for (let start = 0; start < questions.length; start += batchSize) {
      const batchQuestions = questions.slice(start, start + batchSize);
      try {
        const response = await this.structuredCompletion([
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              jobContext: boundedJobContext,
              questions: batchQuestions
            })
          }
        ], {
          activity: 'interview.bias',
          promptVersion: 'interview-bias-v3',
          temperature: 0.1,
          maxTokens: Math.min(3900, 1400 + (batchQuestions.length * 500)),
          jsonSchema: BIAS_ANALYSIS_BATCH_SCHEMA,
          schemaName: 'interview_bias_batch'
        });
        const batchAnalyses = response?.data?.analyses;
        if (!Array.isArray(batchAnalyses) || batchAnalyses.length !== batchQuestions.length) {
          throw new Error(`Bias analysis returned ${batchAnalyses?.length || 0} of ${batchQuestions.length} required results.`);
        }
        const expectedIndexes = new Set(batchQuestions.map(({ questionIndex }) => questionIndex));
        const returnedIndexes = new Set(batchAnalyses.map(({ questionIndex }) => Number(questionIndex)));
        if (returnedIndexes.size !== expectedIndexes.size
          || [...expectedIndexes].some((questionIndex) => !returnedIndexes.has(questionIndex))) {
          throw new Error('Bias analysis returned missing or duplicate question indexes.');
        }
        for (const rawAnalysis of batchAnalyses) {
          const questionIndex = Number(rawAnalysis.questionIndex);
          analyses[questionIndex] = this._normalizeBiasAnalysis(rawAnalysis);
        }
      } catch (error) {
        errors.push(`Questions ${start + 1}-${start + batchQuestions.length}: ${error.message}`);
        if (!runtimeErrorCode && error.code) {
          runtimeErrorCode = error.code;
          runtimeErrorStatus = error.statusCode;
        }
        console.error('AI bias analysis batch failed:', error.message);
      }
    }

    return {
      success: errors.length === 0,
      partial: errors.length > 0 && analyses.some(Boolean),
      analyses,
      code: runtimeErrorCode,
      statusCode: runtimeErrorStatus,
      error: errors.length ? errors.join(' ') : undefined
    };
  }

  async analyzeTextForBias(textToAnalyze, jobContext = null) {
    const result = await this.analyzeQuestionsForBias([textToAnalyze], jobContext);
    const analysis = result.analyses[0];
    if (!analysis) {
      return {
        success: false,
        error: result.error || 'Bias analysis failed; unable to assess question.',
        analysis: null
      };
    }
    return {
      success: true,
      analysis,
      warning: result.error
    };
  }
}

module.exports = AIModelService;
module.exports.CV_EXTRACTION_SCHEMA = CV_EXTRACTION_SCHEMA;
