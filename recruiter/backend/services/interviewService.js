const InterviewQuestion = require('../models/InterviewQuestion');
const Job = require('../models/Job');
const AIModelService = require('./aiModelService');
const { CHATGPT_MODEL } = require('../config/aiRuntimeCatalog');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const {
  assessQuestionSet,
  buildQualityRepairInstructions
} = require('./interviewQuestionQualityService');

class InterviewService {
  constructor() {
    this.aiModelService = new AIModelService();
  }

  _notFound(message) {
    const error = new Error(message);
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    return error;
  }

  _requireOrganizationId(organizationId) {
    if (!organizationId) {
      const error = new Error('Organization context is required');
      error.code = 'ORGANIZATION_CONTEXT_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    return organizationId;
  }

  async _getJobForOrganization(jobId, organizationId) {
    const tenantId = this._requireOrganizationId(organizationId);
    const job = await Job.findOne({ _id: jobId, organization: tenantId });
    if (!job) throw this._notFound('Job not found');
    return job;
  }

  async _assertQuestionOrganization(question, organizationId) {
    const tenantId = this._requireOrganizationId(organizationId);
    const jobId = question?.jobId?._id || question?.jobId;
    if (!jobId) throw this._notFound('Interview question not found');
    const jobExists = await Job.exists({ _id: jobId, organization: tenantId });
    if (!jobExists) throw this._notFound('Interview question not found');
    return question;
  }

  /**
   * Create a new interview question
   */
  async createQuestion(questionData, userId, organizationId) {
    try {
      await this._getJobForOrganization(questionData.jobId, organizationId);
      console.log('🔧 InterviewService: Creating interview question...');
      
      // Decode HTML entities from question text fields before saving
      const cleanedData = {
        ...questionData,
        question: questionData.question ? decodeHtmlEntities(questionData.question) : questionData.question,
        category: questionData.category ? decodeHtmlEntities(questionData.category) : questionData.category,
        expectedAnswer: questionData.expectedAnswer ? decodeHtmlEntities(questionData.expectedAnswer) : questionData.expectedAnswer,
        // Decode scoring criteria descriptions
        scoringCriteria: questionData.scoringCriteria ? questionData.scoringCriteria.map(criterion => ({
          ...criterion,
          criterion: criterion.criterion ? decodeHtmlEntities(criterion.criterion) : criterion.criterion,
          description: criterion.description ? decodeHtmlEntities(criterion.description) : criterion.description
        })) : questionData.scoringCriteria,
        // Decode follow-up questions
        followUpQuestions: questionData.followUpQuestions ? questionData.followUpQuestions.map(fq => ({
          ...fq,
          question: fq.question ? decodeHtmlEntities(fq.question) : fq.question,
          condition: fq.condition ? decodeHtmlEntities(fq.condition) : fq.condition
        })) : questionData.followUpQuestions
      };
      
      // Initialize quality metrics with better default values for manually created questions
      const defaultQualityMetrics = {
        difficultyCalibration: this._calculateDifficultyCalibration(cleanedData.difficulty || 'medium'),
        diversityIndex: 0,
        semanticQualityScore: null,
        qualityIssues: [],
        analysisStatus: 'pending',
        biasScore: null,
        legalCompliance: null,
        biasAnalysis: {
          age: 0,
          gender: 0,
          nationality: 0,
          familyStatus: 0,
          religious: 0
        },
        aiNeutralityConfidence: 0.0,
        aiRecommendation: 'Manual question - analysis pending',
        lastAnalyzed: null
      };

      const question = new InterviewQuestion({
        ...cleanedData,
        createdBy: userId,
        updatedBy: userId,
        qualityMetrics: {
          ...defaultQualityMetrics,
          ...cleanedData.qualityMetrics // Allow override if provided
        }
      });

      await question.save();
      
      console.log(`✅ Interview question created: ${question._id}`);
      console.log(`📊 Initialized with quality metrics:`, {
        difficultyCalibration: question.qualityMetrics.difficultyCalibration,
        diversityIndex: question.qualityMetrics.diversityIndex,
        biasScore: question.qualityMetrics.biasScore
      });
      
      return question;
    } catch (error) {
      console.error('❌ Error creating interview question:', error);
      throw error;
    }
  }

  /**
   * Get all interview questions for a job
   */
  async getQuestionsByJob(jobId, options = {}, organizationId) {
    try {
      await this._getJobForOrganization(jobId, organizationId);
      console.log(`🔍 InterviewService: Getting questions for job ${jobId}`);
      
      const questions = await InterviewQuestion.findByJob(jobId, options)
        .populate('createdBy', 'profile.firstName profile.lastName email')
        .populate('updatedBy', 'profile.firstName profile.lastName email');

      // Decode HTML entities in question text fields for display
      const decodedQuestions = questions.map(q => {
        const questionObj = q.toObject ? q.toObject() : q;
        return {
          ...questionObj,
          question: questionObj.question ? decodeHtmlEntities(questionObj.question) : questionObj.question,
          category: questionObj.category ? decodeHtmlEntities(questionObj.category) : questionObj.category,
          expectedAnswer: questionObj.expectedAnswer ? decodeHtmlEntities(questionObj.expectedAnswer) : questionObj.expectedAnswer,
          scoringCriteria: questionObj.scoringCriteria ? questionObj.scoringCriteria.map(criterion => ({
            ...criterion,
            criterion: criterion.criterion ? decodeHtmlEntities(criterion.criterion) : criterion.criterion,
            description: criterion.description ? decodeHtmlEntities(criterion.description) : criterion.description
          })) : questionObj.scoringCriteria,
          followUpQuestions: questionObj.followUpQuestions ? questionObj.followUpQuestions.map(fq => ({
            ...fq,
            question: fq.question ? decodeHtmlEntities(fq.question) : fq.question,
            condition: fq.condition ? decodeHtmlEntities(fq.condition) : fq.condition
          })) : questionObj.followUpQuestions
        };
      });

      console.log(`✅ Found ${decodedQuestions.length} questions for job ${jobId}`);
      return decodedQuestions;
    } catch (error) {
      console.error('❌ Error fetching interview questions:', error);
      throw error;
    }
  }

  /**
   * Get a single interview question by ID
   */
  async getQuestionById(questionId, organizationId) {
    try {
      const question = await InterviewQuestion.findById(questionId)
        .populate('jobId', 'title department location')
        .populate('createdBy', 'profile.firstName profile.lastName email');

      if (!question) {
        throw this._notFound('Interview question not found');
      }
      await this._assertQuestionOrganization(question, organizationId);

      // Decode HTML entities in question text fields for display
      const questionObj = question.toObject ? question.toObject() : question;
      return {
        ...questionObj,
        question: questionObj.question ? decodeHtmlEntities(questionObj.question) : questionObj.question,
        category: questionObj.category ? decodeHtmlEntities(questionObj.category) : questionObj.category,
        expectedAnswer: questionObj.expectedAnswer ? decodeHtmlEntities(questionObj.expectedAnswer) : questionObj.expectedAnswer,
        scoringCriteria: questionObj.scoringCriteria ? questionObj.scoringCriteria.map(criterion => ({
          ...criterion,
          criterion: criterion.criterion ? decodeHtmlEntities(criterion.criterion) : criterion.criterion,
          description: criterion.description ? decodeHtmlEntities(criterion.description) : criterion.description
        })) : questionObj.scoringCriteria,
        followUpQuestions: questionObj.followUpQuestions ? questionObj.followUpQuestions.map(fq => ({
          ...fq,
          question: fq.question ? decodeHtmlEntities(fq.question) : fq.question,
          condition: fq.condition ? decodeHtmlEntities(fq.condition) : fq.condition
        })) : questionObj.followUpQuestions
      };
    } catch (error) {
      console.error('❌ Error fetching interview question:', error);
      throw error;
    }
  }

  /**
   * Update an interview question
   */
  async updateQuestion(questionId, updateData, userId, organizationId) {
    try {
      const existingQuestion = await InterviewQuestion.findById(questionId).select('jobId');
      if (!existingQuestion) throw this._notFound('Interview question not found');
      await this._assertQuestionOrganization(existingQuestion, organizationId);

      // Decode HTML entities from question text fields before saving
      const cleanedData = {
        ...updateData,
        question: updateData.question ? decodeHtmlEntities(updateData.question) : updateData.question,
        category: updateData.category ? decodeHtmlEntities(updateData.category) : updateData.category,
        expectedAnswer: updateData.expectedAnswer ? decodeHtmlEntities(updateData.expectedAnswer) : updateData.expectedAnswer,
        // Decode scoring criteria descriptions
        scoringCriteria: updateData.scoringCriteria ? updateData.scoringCriteria.map(criterion => ({
          ...criterion,
          criterion: criterion.criterion ? decodeHtmlEntities(criterion.criterion) : criterion.criterion,
          description: criterion.description ? decodeHtmlEntities(criterion.description) : criterion.description
        })) : updateData.scoringCriteria,
        // Decode follow-up questions
        followUpQuestions: updateData.followUpQuestions ? updateData.followUpQuestions.map(fq => ({
          ...fq,
          question: fq.question ? decodeHtmlEntities(fq.question) : fq.question,
          condition: fq.condition ? decodeHtmlEntities(fq.condition) : fq.condition
        })) : updateData.followUpQuestions
      };

      // Prevent cross-job re-parenting through the update payload.
      delete cleanedData.jobId;
      delete cleanedData.organization;

      const question = await InterviewQuestion.findOneAndUpdate(
        { _id: questionId, jobId: existingQuestion.jobId },
        { ...cleanedData, updatedBy: userId, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      if (!question) {
        throw this._notFound('Interview question not found');
      }

      // Decode HTML entities in returned question for display
      const questionObj = question.toObject ? question.toObject() : question;
      return {
        ...questionObj,
        question: questionObj.question ? decodeHtmlEntities(questionObj.question) : questionObj.question,
        category: questionObj.category ? decodeHtmlEntities(questionObj.category) : questionObj.category,
        expectedAnswer: questionObj.expectedAnswer ? decodeHtmlEntities(questionObj.expectedAnswer) : questionObj.expectedAnswer,
        scoringCriteria: questionObj.scoringCriteria ? questionObj.scoringCriteria.map(criterion => ({
          ...criterion,
          criterion: criterion.criterion ? decodeHtmlEntities(criterion.criterion) : criterion.criterion,
          description: criterion.description ? decodeHtmlEntities(criterion.description) : criterion.description
        })) : questionObj.scoringCriteria,
        followUpQuestions: questionObj.followUpQuestions ? questionObj.followUpQuestions.map(fq => ({
          ...fq,
          question: fq.question ? decodeHtmlEntities(fq.question) : fq.question,
          condition: fq.condition ? decodeHtmlEntities(fq.condition) : fq.condition
        })) : questionObj.followUpQuestions
      };
    } catch (error) {
      console.error('❌ Error updating interview question:', error);
      throw error;
    }
  }

  /**
   * Delete an interview question
   */
  async deleteQuestion(questionId, organizationId) {
    try {
      const existingQuestion = await InterviewQuestion.findById(questionId).select('jobId');
      if (!existingQuestion) throw this._notFound('Interview question not found');
      await this._assertQuestionOrganization(existingQuestion, organizationId);
      const question = await InterviewQuestion.findOneAndDelete({
        _id: questionId,
        jobId: existingQuestion.jobId
      });
      if (!question) {
        throw this._notFound('Interview question not found');
      }
      return { success: true, deletedQuestion: question };
    } catch (error) {
      console.error('❌ Error deleting interview question:', error);
      throw error;
    }
  }

  /**
   * Generate AI interview questions for a job
   */
  async generateQuestionsWithAI(jobId, options = {}) {
    try {
      console.log(`🤖 InterviewService: Generating AI questions for job ${jobId}`);
      
      // Get job details
      const job = await this._getJobForOrganization(jobId, options.organizationId);

      const questions = await this._generateAdvancedQuestionsWithAI(job, options);
      
      // Save the generated questions
      const savedQuestions = await this.bulkCreateQuestions(questions, options.userId, options.organizationId);
      
      return savedQuestions;
    } catch (error) {
      console.error('❌ Error generating AI questions:', error);
      throw error;
    }
  }

  /**
   * Generate advanced AI-powered interview questions
   */
  async _generateAdvancedQuestionsWithAI(job, options = {}) {
    try {
      console.log('🚀 Generating advanced AI questions...');
      
      const {
        stage = 'first_round',
        questionCount = 10,
        difficulty = 'medium',
        includeTypes = ['technical', 'behavioral', 'situational'],
        focusAreas = []
      } = options;
      const normalizedQuestionCount = Number(questionCount);
      const normalizedTypes = Array.isArray(includeTypes)
        ? [...new Set(includeTypes.map((type) => String(type || '').trim()).filter(Boolean))]
        : [];
      const normalizedFocusAreas = Array.isArray(focusAreas)
        ? focusAreas.map((area) => String(area || '').trim()).filter(Boolean)
        : [];
      if (!Number.isInteger(normalizedQuestionCount) || normalizedQuestionCount < 1 || normalizedQuestionCount > 50) {
        const error = new Error('questionCount must be an integer between 1 and 50');
        error.code = 'INVALID_QUESTION_COUNT';
        error.statusCode = 400;
        throw error;
      }
      if (!normalizedTypes.length) {
        const error = new Error('At least one interview question type is required');
        error.code = 'INTERVIEW_QUESTION_TYPES_REQUIRED';
        error.statusCode = 400;
        throw error;
      }

      // Prepare job context for AI
      const jobContext = this._prepareJobContext(job);
      
      // Generate the complete mixed-type set in one structured request. The
      // previous implementation made one sequential model call per type.
      const questionTypes = this._distributeQuestionTypes(normalizedTypes, normalizedQuestionCount);
      const allQuestions = await this._generateQuestionSet(
        questionTypes,
        normalizedQuestionCount,
        jobContext,
        difficulty,
        normalizedFocusAreas,
        job
      );

      const setAssessment = assessQuestionSet(allQuestions, {
        job,
        expectedCount: normalizedQuestionCount,
        difficulty
      });
      if (!setAssessment.passed) {
        const error = new Error(`Generated interview questions failed the quality gate: ${setAssessment.issues.join(' ')}`);
        error.code = 'AI_QUESTION_QUALITY_FAILED';
        error.statusCode = 503;
        throw error;
      }

      // Validate and enhance questions
      const validatedQuestions = await this._validateAndEnhanceQuestions(allQuestions, job, options);
      
      return validatedQuestions;
    } catch (error) {
      console.error('❌ Error in advanced AI generation:', error);
      throw error;
    }
  }

  /**
   * Generate a complete ordered question set in one call while retaining the
   * same deterministic semantic gate and one quality regeneration attempt.
   */
  async _generateQuestionSet(questionTypes, questionCount, jobContext, difficulty, focusAreas, job) {
    const expectedTypes = Object.entries(questionTypes)
      .flatMap(([type, count]) => Array(Math.max(0, Number(count) || 0)).fill(type));
    const basePrompt = this._buildPromptForSet(
      questionTypes,
      questionCount,
      jobContext,
      difficulty,
      focusAreas
    );
    let prompt = basePrompt;
    let lastAssessment = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(`🎯 Generating ${questionCount} mixed interview questions (quality attempt ${attempt}/2)...`);
      const response = await this.aiModelService.generateInterviewQuestions(prompt, { questionCount });
      const parsedQuestions = this._parseAIResponse(response, null, difficulty);
      const assessment = assessQuestionSet(parsedQuestions, {
        job,
        expectedCount: questionCount,
        expectedTypes,
        difficulty
      });
      lastAssessment = assessment;

      if (assessment.passed) {
        console.log(`✅ Generated ${parsedQuestions.length} mixed questions at ${Math.round(assessment.score * 100)}% semantic quality`);
        return parsedQuestions.map((question, index) => ({
          ...question,
          order: index,
          qualityMetrics: {
            ...question.qualityMetrics,
            semanticQualityScore: assessment.questions[index]?.score ?? assessment.score,
            qualityIssues: assessment.questions[index]?.issues || [],
            analysisStatus: 'pending'
          }
        }));
      }

      if (attempt === 1) {
        console.warn('⚠️ Mixed question set failed semantic quality; regenerating once', assessment.issues);
        prompt = basePrompt + buildQualityRepairInstructions(assessment);
      }
    }

    const error = new Error(`AI returned a low-quality interview question set after one regeneration: ${lastAssessment?.issues?.join(' ') || 'unknown quality failure'}`);
    error.code = 'AI_QUESTION_QUALITY_FAILED';
    error.statusCode = 503;
    throw error;
  }

  /**
   * Generate questions by specific type using AI
   */
  async _generateQuestionsByType(type, count, jobContext, difficulty, focusAreas, job) {
    const basePrompt = this._buildPromptForType(type, count, jobContext, difficulty, focusAreas);
    let prompt = basePrompt;
    let lastAssessment = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(`🎯 Generating ${count} ${type} questions (quality attempt ${attempt}/2)...`);
      const response = await this.aiModelService.generateInterviewQuestions(prompt, { questionCount: count });
      const parsedQuestions = this._parseAIResponse(response, type, difficulty);
      const assessment = assessQuestionSet(parsedQuestions, {
        job,
        expectedCount: count,
        expectedTypes: Array(count).fill(type),
        difficulty
      });
      lastAssessment = assessment;

      if (assessment.passed) {
        console.log(`✅ Generated ${parsedQuestions.length} ${type} questions at ${Math.round(assessment.score * 100)}% semantic quality`);
        return parsedQuestions.map((question, index) => ({
          ...question,
          qualityMetrics: {
            ...question.qualityMetrics,
            semanticQualityScore: assessment.questions[index]?.score ?? assessment.score,
            qualityIssues: assessment.questions[index]?.issues || [],
            analysisStatus: 'pending'
          }
        }));
      }

      if (attempt === 1) {
        console.warn(`⚠️ ${type} questions failed semantic quality; regenerating once`, assessment.issues);
        prompt = basePrompt + buildQualityRepairInstructions(assessment);
      }
    }

    const error = new Error(`AI returned low-quality ${type} interview questions after one regeneration: ${lastAssessment?.issues?.join(' ') || 'unknown quality failure'}`);
    error.code = 'AI_QUESTION_QUALITY_FAILED';
    error.statusCode = 503;
    throw error;
  }

  _buildPromptForSet(questionTypes, questionCount, jobContext, difficulty, focusAreas) {
    const orderedPlan = Object.entries(questionTypes)
      .filter(([, count]) => Number(count) > 0)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    return `Generate exactly ${questionCount} interview questions at ${difficulty} difficulty.

Return the questions in this exact type order: ${orderedPlan}.
${focusAreas.length ? `Prioritize these focus areas: ${focusAreas.join(', ')}.` : ''}

Requirements:
- Ground every question in a named skill, responsibility, deliverable, stakeholder, metric, system, or constraint from the source job context.
- Technical questions must test practical application of the supplied tools or responsibilities.
- Behavioral questions must request a concrete past example using evidence and measurable results.
- Situational questions must present a realistic hypothetical decision or trade-off.
- Make every scenario and expected-answer rubric materially different.
- Write each candidate-facing question for speech: use 1 to 3 short sentences, each under about 28 words.
- Put the scenario or context first, then finish with one clear primary ask ending in a question mark.
- Prefer familiar spoken phrasing. Avoid headings, bullet-like lists, nested brackets, slashes, semicolons, and unexplained abbreviations in the question text.
- Include 3 or 4 distinct scoring criteria totalling 100, 1 or 2 probing follow-ups, 2 or 3 grounded tags, and detailed question-specific answer guidance.
- Avoid protected-characteristic, personal-status, leading, or discriminatory content.
- Silently verify the exact count, ordered type distribution, difficulty, criteria totals, grounding, uniqueness, and safety before returning the structured response.

SOURCE JOB CONTEXT (do not invent missing facts):
${jobContext}`;
  }

  /**
   * Build specialized prompts for different question types
   */
  _buildPromptForType(type, count, jobContext, difficulty, focusAreas) {
    const basePrompt = `IMPORTANT INSTRUCTIONS:
1. Analyze ALL provided job details carefully - including the full description, requirements, and responsibilities
2. Create questions that specifically assess skills mentioned in the job description
3. Align questions with the actual responsibilities listed
4. Consider the specific requirements and qualifications
5. Tailor questions to the company culture and team structure when provided
6. Focus on real challenges and success metrics mentioned in the job details
7. DO NOT create generic questions - every question must relate to specific job details provided above
8. Do not treat the role title alone as job grounding; anchor each question in a named skill, deliverable, stakeholder, metric, system, or responsibility

Generate ${count} ${type} interview questions with ${difficulty} difficulty level.
${focusAreas.length > 0 ? `Focus on these areas: ${focusAreas.join(', ')}` : ''}

CRITICAL JSON FORMAT REQUIREMENTS:
You MUST return a JSON object with this EXACT structure:
{
  "questions": [
    {
      "question": "The interview question text (required)",
      "type": "${type}",
      "difficulty": "${difficulty}",
      "category": "Short job-relevant competency category",
      "expectedAnswer": "Detailed response guidelines (required)",
      "scoringCriteria": [
        {
          "criterion": "Specific evaluation criterion",
          "weight": 10,
          "description": "What to look for"
        }
      ],
      "followUpQuestions": [
        {
          "question": "Follow-up question text",
          "condition": "When to ask this"
        }
      ],
      "tags": ["skill1", "skill2"],
      "timeLimit": 5
    }
  ]
}

QUALITY STANDARDS:
- Questions must be specific, actionable, and measurable
- Include exactly 3 or 4 distinct evaluation criteria whose weights total 100
- Avoid bias and leading questions
- Ensure legal compliance
- Include 1-2 relevant follow-up questions with useful conditions
- Add 2-3 relevant skill tags
- Every question must mention or unmistakably apply at least one concrete skill, responsibility, outcome, or constraint from the job context
- Hard questions must involve ambiguity, scale, failure, trade-offs, risk, or competing constraints
- Make every question materially different from every other question
- Write each candidate-facing question for speech: 1 to 3 short sentences, each under about 28 words, with context first and one clear final ask
- Avoid headings, bullet-like lists, nested brackets, slashes, semicolons, and unexplained abbreviations in the question text
- Expected-answer guidance must be unique to the question and identify evidence, decisions, trade-offs, and measurable outcomes
- Follow-ups must probe missing evidence rather than paraphrase the main question
- Silently self-check question count, type, difficulty, criteria weights, protected-trait safety, and grounding before returning JSON

`;

    const typeSpecificPrompts = {
      'technical': `
TECHNICAL QUESTION REQUIREMENTS:
- Test practical application of SKILLS LISTED IN THE JOB DESCRIPTION
- Include real-world problem scenarios RELATED TO THE ACTUAL RESPONSIBILITIES
- Scale appropriately with THE SPECIFIED EXPERIENCE LEVEL (${jobContext.includes('Experience Required:') ? 'as stated in job' : 'entry level'})
- Cover both breadth and depth OF TECHNOLOGIES MENTIONED IN THE JOB
- Include system design or coding challenges RELEVANT TO THE SPECIFIC ROLE AND DEPARTMENT
- Focus on problem-solving approach FOR CHALLENGES MENTIONED IN THE JOB CONTEXT
- Reference specific tools, frameworks, and methodologies from the job description
`,
      'behavioral': `
BEHAVIORAL QUESTION REQUIREMENTS:
- Use STAR method structure (Situation, Task, Action, Result)
- Focus on past behavior RELEVANT TO THE LISTED RESPONSIBILITIES
- Assess competency-based skills MENTIONED IN THE REQUIREMENTS
- Include situational judgment scenarios BASED ON THE TEAM AND COMPANY CONTEXT
- Evaluate cultural alignment WITH THE STATED COMPANY CULTURE
- Look for specific examples related to THE SUCCESS METRICS AND KEY CHALLENGES listed
- Consider the reporting structure and team dynamics mentioned
`,
      'situational': `
SITUATIONAL QUESTION REQUIREMENTS:
- Present realistic workplace scenarios BASED ON THE JOB'S ACTUAL CONTEXT
- Test decision-making for CHALLENGES SPECIFIC TO THIS ROLE
- Include crisis management situations RELEVANT TO THE DEPARTMENT AND LEVEL
- Assess leadership and teamwork abilities AS REQUIRED BY THE POSITION
- Focus on thought process for SOLVING PROBLEMS MENTIONED IN THE JOB DESCRIPTION
- Include ethical dilemmas RELEVANT TO THE SPECIFIC INDUSTRY AND ROLE
- Use the company's actual work environment and team structure in scenarios
`,
      'cultural_fit': `
CULTURAL FIT QUESTION REQUIREMENTS:
- Assess alignment with company values
- Evaluate work style and preferences
- Test adaptability and flexibility
- Include team dynamics scenarios
- Focus on communication and collaboration
- Assess motivation and career goals
`,
      'skills_based': `
SKILLS-BASED QUESTION REQUIREMENTS:
- Focus on specific technical or soft skills
- Include practical application scenarios
- Test depth of knowledge and experience
- Assess learning ability and adaptability
- Include skill transfer and application examples
- Focus on continuous improvement mindset
`,
      'experience_based': `
EXPERIENCE-BASED QUESTION REQUIREMENTS:
- Leverage candidate's background and experience
- Focus on career progression and growth
- Include lessons learned and challenges overcome
- Assess industry knowledge and expertise
- Test ability to apply past experience to new situations
- Focus on achievements and impact
`
    };

    return `${basePrompt}${typeSpecificPrompts[type] || typeSpecificPrompts['behavioral']}

SOURCE JOB CONTEXT (use only this evidence and do not invent missing facts):
${jobContext}`;
  }

  /**
   * Prepare job context for AI prompts
   */
  _prepareJobContext(job) {
    // Validate job context richness
    this._validateJobContext(job);
    
    return `
JOB DETAILS:
- Title: ${job.title}
- Department: ${job.department || 'Not specified'}
- Level: ${job.level || 'Not specified'}
- Experience Required: ${job.experience || 'Not specified'} years
- Location: ${job.location || 'Not specified'}
- Job Type: ${job.type || 'Not specified'}
- Remote Work: ${job.remote ? 'Yes' : 'No'}
- Salary Range: ${job.salary && (job.salary.min || job.salary.max) ? `${job.salary.min || ''} - ${job.salary.max || ''} ${job.salary.currency || 'NGN'} ${job.salary.period || 'annually'}` : 'Not specified'}

SKILLS & QUALIFICATIONS:
- Required Skills: ${Array.isArray(job.skills) ? job.skills.join(', ') : job.skills || 'Not specified'}
- Education: ${job.education || 'Not specified'}
- Certifications: ${job.certifications || 'Not specified'}

FULL JOB DESCRIPTION:
${job.description || 'Not specified'}

COMPLETE REQUIREMENTS:
${job.requirements || 'Not specified'}

DETAILED RESPONSIBILITIES:
${job.responsibilities || 'Not specified'}

ADDITIONAL CONTEXT:
- Benefits: ${job.benefits || 'Not specified'}
- Priority: ${job.priority || 'Not specified'}
- Number of Openings: ${job.openings || 1}
- Current Status: ${job.status || 'Not specified'}
`;
  }

  /**
   * Validate job context richness
   */
  _validateJobContext(job) {
    const contextRichness = {
      hasDescription: !!job.description && job.description.length > 100,
      hasRequirements: !!job.requirements && job.requirements.length > 50,
      hasResponsibilities: !!job.responsibilities && job.responsibilities.length > 50,
      hasSkills: !!job.skills && (Array.isArray(job.skills) ? job.skills.length > 0 : job.skills.length > 0),
      hasDepartment: !!job.department,
      hasLevel: !!job.level
    };
    
    const richnessScore = Object.values(contextRichness).filter(v => v).length;
    
    if (richnessScore < 3) {
      console.warn('⚠️ Job context is limited. Questions may be generic. Consider adding more job details.');
      console.warn('   Missing/limited fields:', Object.entries(contextRichness).filter(([k, v]) => !v).map(([k]) => k).join(', '));
    }
    
    return contextRichness;
  }

  /**
   * Distribute question count across different types
   */
  _distributeQuestionTypes(includeTypes, totalCount) {
    const distribution = {};
    const typeCount = includeTypes.length;
    const baseCount = Math.floor(totalCount / typeCount);
    const remainder = totalCount % typeCount;

    includeTypes.forEach((type, index) => {
      distribution[type] = baseCount + (index < remainder ? 1 : 0);
    });

    return distribution;
  }

  /**
   * Parse AI response and format questions
   */
  _parseAIResponse(response, type, difficulty) {
    try {
      let questions;
      if (typeof response === 'string') {
        questions = JSON.parse(response);
      } else if (response.questions) {
        questions = response.questions;
      } else {
        questions = response;
      }

      if (!Array.isArray(questions)) {
        throw new Error('Invalid response format');
      }

      return questions.map((q, index) => {
        if (!q || typeof q !== 'object' || !q.question || !q.expectedAnswer) {
          throw new Error(`Question ${index + 1} is missing required content`);
        }
        return {
          question: decodeHtmlEntities(q.question),
          type: type || decodeHtmlEntities(q.type || ''),
          difficulty: difficulty,
          category: decodeHtmlEntities(q.category || ''),
          expectedAnswer: decodeHtmlEntities(q.expectedAnswer),
          scoringCriteria: (q.scoringCriteria || []).map((criterion) => ({
            criterion: decodeHtmlEntities(criterion.criterion),
            weight: Number(criterion.weight),
            description: decodeHtmlEntities(criterion.description)
          })),
          followUpQuestions: (q.followUpQuestions || []).map((followUp) => ({
            question: decodeHtmlEntities(followUp.question),
            condition: decodeHtmlEntities(followUp.condition)
          })),
          tags: (q.tags || []).map((tag) => decodeHtmlEntities(tag)),
          timeLimit: Number(q.timeLimit),
          order: index,
          isAIGenerated: true,
          aiGenerationMetadata: {
            generatedAt: new Date(),
            model: CHATGPT_MODEL,
            confidence: 0.9,
            questionType: type || q.type,
            promptVersion: 'interview-questions-v5'
          },
          qualityMetrics: {
            analysisStatus: 'pending',
            biasScore: null,
            legalCompliance: null,
            aiNeutralityConfidence: null,
            aiRecommendation: 'Bias analysis pending.'
          }
        };
      });
    } catch (error) {
      console.error('❌ Error parsing AI response:', error);
      throw error;
    }
  }

  /**
   * Validate and enhance generated questions
   */
  async _validateAndEnhanceQuestions(questions, job, options) {
    const validQuestions = [];
    const maxBiasScore = options.maxBiasScore !== undefined ? options.maxBiasScore : 0.3;
    const jobContextForAnalysis = this._prepareJobContext(job);
    const biasChecks = await this._analyzeBiasBatch(
      questions.map((question) => question.question),
      jobContextForAnalysis
    );

    console.log(`🔍 Validating questions with max bias tolerance: ${maxBiasScore}`);

    for (const [questionIndex, question] of questions.entries()) {
      try {
        // Basic validation
        if (!question.question || question.question.trim().length < 10) {
          console.warn('⚠️ Skipping question with insufficient content:', question.question?.substring(0, 50));
          continue;
        }

        const aiBiasCheckResult = biasChecks[questionIndex] || this._manualBiasReview(
          'AI bias analysis did not return a result. Question requires manual review.'
        );
        
        // Check if question meets bias tolerance based on AI analysis
        if (aiBiasCheckResult.analysisStatus === 'complete' && aiBiasCheckResult.biasScore > maxBiasScore) {
          console.warn(`⚠️ AI Skipping question due to high bias score (${aiBiasCheckResult.biasScore} > ${maxBiasScore}):`, question.question.substring(0, 100));
          console.warn(`   AI Recommendation: ${aiBiasCheckResult.recommendation}`);
          if (aiBiasCheckResult.detectedBiasFactors && aiBiasCheckResult.detectedBiasFactors.length > 0) {
            console.warn(`   AI Detected Factors: ${aiBiasCheckResult.detectedBiasFactors.map(f => `${f.type} (Score: ${f.score})`).join(', ')}`);
          }
          const error = new Error(`Generated question exceeded the configured bias threshold: ${aiBiasCheckResult.recommendation}`);
          error.code = 'AI_QUESTION_BIAS_THRESHOLD';
          error.statusCode = 422;
          throw error;
        }
        
        // Calculate diversity based on question uniqueness
        const diversityIndex = this._calculateQuestionDiversity(question, questions);
        
        // Enhance with job-specific data and AI bias results
        const enhancedQuestion = {
          ...question,
          jobId: job._id,
          category: decodeHtmlEntities(this._determineCategory(question, job)),
          interviewStage: options.stage || 'first_round',
          qualityMetrics: {
            ...question.qualityMetrics,
            difficultyCalibration: this._calculateDifficultyCalibration(question.difficulty),
            diversityIndex: diversityIndex,
            analysisStatus: aiBiasCheckResult.analysisStatus,
            biasScore: aiBiasCheckResult.analysisStatus === 'complete' ? aiBiasCheckResult.biasScore : null,
            legalCompliance: aiBiasCheckResult.analysisStatus === 'complete' ? !aiBiasCheckResult.hasBias : null,
            biasAnalysis: {
              age: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'age')?.score || 0,
              gender: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'gender')?.score || 0,
              nationality: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'nationality')?.score || 0,
              familyStatus: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase().includes('family'))?.score || 0,
              religious: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'religion')?.score || 0
            },
            detectedBiasFactors: aiBiasCheckResult.detectedBiasFactors || [],
            aiNeutralityConfidence: aiBiasCheckResult.neutralityConfidence,
            aiRecommendation: aiBiasCheckResult.recommendation,
            lastAnalyzed: aiBiasCheckResult.analysisStatus === 'complete' ? new Date() : null
          }
        };

        console.log('📊 AI Quality Metrics Calculated:', {
          question: enhancedQuestion.question.substring(0, 50) + '...',
          biasScore: enhancedQuestion.qualityMetrics.biasScore,
          diversityIndex: diversityIndex,
          difficultyCalibration: enhancedQuestion.qualityMetrics.difficultyCalibration,
          legalCompliance: enhancedQuestion.qualityMetrics.legalCompliance,
          neutralityConfidence: enhancedQuestion.qualityMetrics.aiNeutralityConfidence
        });

        // Validate the enhanced question structure
        if (!enhancedQuestion.scoringCriteria) {
          enhancedQuestion.scoringCriteria = [];
        }
        if (!enhancedQuestion.followUpQuestions) {
          enhancedQuestion.followUpQuestions = [];
        }
        if (!enhancedQuestion.tags) {
          enhancedQuestion.tags = [];
        }

        console.log('✅ Validated question:', {
          question: enhancedQuestion.question.substring(0, 100) + '...',
          type: enhancedQuestion.type,
          scoringCriteriaCount: enhancedQuestion.scoringCriteria.length,
          followUpQuestionsCount: enhancedQuestion.followUpQuestions.length,
          tagsCount: enhancedQuestion.tags.length
        });

        validQuestions.push(enhancedQuestion);
      } catch (error) {
        console.error('❌ Error validating question:', error.message);
        throw error;
      }
    }

    return validQuestions;
  }

  /**
   * Determine question category based on content and job
   */
  _determineCategory(question, job) {
    const questionText = question.question.toLowerCase();
    const jobSkills = (Array.isArray(job.skills) ? job.skills.join(' ') : job.skills || '').toLowerCase();

    // Technical categories
    if (questionText.includes('code') || questionText.includes('algorithm') || questionText.includes('system')) {
      return 'Technical Skills';
    }

    // Leadership categories
    if (questionText.includes('lead') || questionText.includes('manage') || questionText.includes('team')) {
      return 'Leadership';
    }

    // Problem solving
    if (questionText.includes('problem') || questionText.includes('challenge') || questionText.includes('solve')) {
      return 'Problem Solving';
    }

    // Communication
    if (questionText.includes('communicate') || questionText.includes('present') || questionText.includes('explain')) {
      return 'Communication';
    }

    // Default based on job skills
    if (jobSkills.includes('javascript') || jobSkills.includes('python') || jobSkills.includes('java')) {
      return 'Technical Skills';
    }

    return question.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Bulk create interview questions
   */
  async bulkCreateQuestions(questionsData, userId, organizationId) {
    try {
      if (!Array.isArray(questionsData) || questionsData.length === 0) {
        const error = new Error('At least one interview question is required');
        error.code = 'INTERVIEW_QUESTIONS_REQUIRED';
        error.statusCode = 422;
        throw error;
      }

      const jobIds = [...new Set(questionsData.map((question) => String(question.jobId || '')))];
      if (jobIds.includes('')) {
        const error = new Error('Every interview question must reference a job');
        error.code = 'JOB_REFERENCE_REQUIRED';
        error.statusCode = 422;
        throw error;
      }
      await Promise.all(jobIds.map((jobId) => this._getJobForOrganization(jobId, organizationId)));

      console.log(`🔧 InterviewService: Bulk creating ${questionsData.length} questions`);
      
      const questionsToCreate = questionsData.map(data => ({
        ...data,
        question: decodeHtmlEntities(data.question),
        expectedAnswer: decodeHtmlEntities(data.expectedAnswer),
        category: decodeHtmlEntities(data.category),
        scoringCriteria: data.scoringCriteria?.map(c => ({
          ...c,
          criterion: decodeHtmlEntities(c.criterion),
          description: decodeHtmlEntities(c.description)
        })),
        followUpQuestions: data.followUpQuestions?.map(fq => ({
          ...fq,
          question: decodeHtmlEntities(fq.question)
        })),
        tags: data.tags?.map(tag => decodeHtmlEntities(tag)),
        createdBy: userId,
        updatedBy: userId
      }));

      const questions = await InterviewQuestion.insertMany(questionsToCreate);
      
      // Log quality metrics summary
      const analyzedQuestions = questions.filter((question) => question.qualityMetrics?.analysisStatus === 'complete');
      const avgBias = analyzedQuestions.length
        ? analyzedQuestions.reduce((sum, q) => sum + Number(q.qualityMetrics?.biasScore || 0), 0) / analyzedQuestions.length
        : null;
      const avgSemanticQuality = questions.reduce((sum, q) => sum + Number(q.qualityMetrics?.semanticQualityScore || 0), 0) / questions.length;
      const avgDiversity = questions.reduce((sum, q) => sum + (q.qualityMetrics?.diversityIndex || 0), 0) / questions.length;
      const complianceRate = analyzedQuestions.length
        ? analyzedQuestions.filter(q => q.qualityMetrics?.legalCompliance).length / analyzedQuestions.length
        : null;
      
      console.log(`✅ Bulk created ${questions.length} interview questions with quality metrics:`, {
        avgSemanticQuality: Math.round(avgSemanticQuality * 100) / 100,
        avgBiasScore: avgBias == null ? 'not analyzed' : Math.round(avgBias * 100) / 100,
        avgDiversityIndex: Math.round(avgDiversity * 100) / 100,
        legalComplianceRate: complianceRate == null ? 'not analyzed' : Math.round(complianceRate * 100) / 100
      });
      
      return questions;
    } catch (error) {
      console.error('❌ Error bulk creating interview questions:', error);
      throw error;
    }
  }

  /**
   * Get interview question statistics for a job
   */
  async getQuestionStatistics(jobId, organizationId) {
    try {
      const job = await this._getJobForOrganization(jobId, organizationId);
      const scopedJobId = job._id;
      const totalQuestions = await InterviewQuestion.countDocuments({ jobId: scopedJobId, isActive: true });
      
      const typeDistribution = await InterviewQuestion.aggregate([
        { $match: { jobId: scopedJobId, isActive: true } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]);

      const stageDistribution = await InterviewQuestion.aggregate([
        { $match: { jobId: scopedJobId, isActive: true } },
        { $group: { _id: '$interviewStage', count: { $sum: 1 } } }
      ]);

      const qualityMetrics = await InterviewQuestion.aggregate([
        { $match: { jobId: scopedJobId, isActive: true } },
        {
          $group: {
            _id: null,
            avgSemanticQualityScore: { $avg: '$qualityMetrics.semanticQualityScore' },
            avgBiasScore: { $avg: '$qualityMetrics.biasScore' },
            avgDiversityIndex: { $avg: '$qualityMetrics.diversityIndex' },
            avgDifficultyCalibration: { $avg: '$qualityMetrics.difficultyCalibration' },
            analyzedBiasCount: { $sum: { $cond: [{ $eq: ['$qualityMetrics.analysisStatus', 'complete'] }, 1, 0] } },
            legalComplianceCount: { $sum: { $cond: [{ $and: [
              { $eq: ['$qualityMetrics.analysisStatus', 'complete'] },
              { $eq: ['$qualityMetrics.legalCompliance', true] }
            ] }, 1, 0] } },
            avgSuccessRate: { $avg: '$usage.successRate' },
            totalUsage: { $sum: '$usage.timesUsed' }
          }
        }
      ]);

      const stats = qualityMetrics[0];
      const analyzedBiasCount = Number(stats?.analyzedBiasCount || 0);
      const complianceRate = analyzedBiasCount
        ? Number(stats.legalComplianceCount || 0) / analyzedBiasCount
        : null;
      const roundedOrNull = (value) => value == null ? null : Math.round(Number(value) * 100) / 100;

      return {
        totalQuestions,
        typeDistribution,
        stageDistribution,
        qualityMetrics: stats ? {
          avgSemanticQualityScore: roundedOrNull(stats.avgSemanticQualityScore),
          avgBiasScore: roundedOrNull(stats.avgBiasScore),
          avgDiversityIndex: Math.round((stats.avgDiversityIndex || 0) * 100) / 100,
          avgDifficultyCalibration: Math.round((stats.avgDifficultyCalibration || 0) * 100) / 100,
          legalComplianceRate: roundedOrNull(complianceRate),
          analyzedBiasCount,
          unverifiedBiasCount: Math.max(0, totalQuestions - analyzedBiasCount),
          avgSuccessRate: Math.round((stats.avgSuccessRate || 0) * 100) / 100,
          totalUsage: stats.totalUsage || 0
        } : {
          avgSemanticQualityScore: null,
          avgBiasScore: null,
          avgDiversityIndex: 0,
          avgDifficultyCalibration: 0,
          legalComplianceRate: null,
          analyzedBiasCount: 0,
          unverifiedBiasCount: totalQuestions,
          avgSuccessRate: 0,
          totalUsage: 0
        }
      };
    } catch (error) {
      console.error('❌ Error getting question statistics:', error);
      throw error;
    }
  }

  /**
   * Analyze question quality and provide recommendations
   */
  async analyzeQuestionQuality(questionId, organizationId) {
    try {
      const question = await InterviewQuestion.findById(questionId).populate('jobId');
      if (!question) {
        throw this._notFound('Question not found');
      }
      await this._assertQuestionOrganization(question, organizationId);

      console.log(`🔍 Analyzing quality for question: ${question._id}`);

      // Perform fresh analysis
      const biasAnalysis = await this._analyzeBias(question.question);
      const semanticAnalysis = assessQuestionSet([question.toObject ? question.toObject() : question], {
        job: question.jobId || {},
        expectedCount: 1,
        expectedTypes: [question.type],
        difficulty: question.difficulty
      });
      
      // Calculate difficulty calibration based on question difficulty
      const difficultyCalibration = this._calculateDifficultyCalibration(question.difficulty);
      
      // Calculate diversity index (for single question analysis, use a base score)
      const diversityIndex = 0.8; // Base diversity score for individual analysis
      
      // Generate recommendations
      const recommendations = [];
      
      if (biasAnalysis.analysisStatus !== 'complete') {
        recommendations.push('AI bias analysis is unavailable. Complete a manual review before using this question.');
      } else if (biasAnalysis.hasBias || biasAnalysis.isBiased) {
        recommendations.push('🚨 HIGH PRIORITY: Address bias issues before using this question');
        if (biasAnalysis.detectedBiasFactors && biasAnalysis.detectedBiasFactors.length > 0) {
          recommendations.push(`Detected bias types: ${biasAnalysis.detectedBiasFactors.map(i => i.type).join(', ')}`);
        }
      } else if (semanticAnalysis.passed) {
        recommendations.push('This question passed the semantic quality and bias checks.');
      }
      recommendations.push(...semanticAnalysis.issues);

      if (difficultyCalibration < 0.5) {
        recommendations.push('⚠️ Consider adjusting question difficulty level for better calibration');
      }

      // Prepare bias analysis breakdown for legacy compatibility
      const biasBreakdown = {
        age: biasAnalysis.detectedBiasFactors?.find(i => i.type.toLowerCase().includes('age'))?.score || 0,
        gender: biasAnalysis.detectedBiasFactors?.find(i => i.type.toLowerCase().includes('gender'))?.score || 0,
        nationality: biasAnalysis.detectedBiasFactors?.find(i => i.type.toLowerCase().includes('nationality') || i.type.toLowerCase().includes('cultural'))?.score || 0,
        familyStatus: biasAnalysis.detectedBiasFactors?.find(i => i.type.toLowerCase().includes('family') || i.type.toLowerCase().includes('marital'))?.score || 0,
        religious: biasAnalysis.detectedBiasFactors?.find(i => i.type.toLowerCase().includes('religion'))?.score || 0
      };

      // Prepare the complete quality metrics update
      const qualityMetricsUpdate = {
        'qualityMetrics.semanticQualityScore': semanticAnalysis.score,
        'qualityMetrics.qualityIssues': semanticAnalysis.issues,
        'qualityMetrics.analysisStatus': biasAnalysis.analysisStatus,
        'qualityMetrics.biasScore': biasAnalysis.analysisStatus === 'complete' ? biasAnalysis.biasScore : null,
        'qualityMetrics.diversityIndex': diversityIndex,
        'qualityMetrics.difficultyCalibration': difficultyCalibration,
        'qualityMetrics.legalCompliance': biasAnalysis.analysisStatus === 'complete' ? !biasAnalysis.hasBias : null,
        'qualityMetrics.biasAnalysis': biasBreakdown,
        'qualityMetrics.aiNeutralityConfidence': biasAnalysis.neutralityConfidence,
        'qualityMetrics.aiRecommendation': biasAnalysis.recommendation || recommendations[0],
        'qualityMetrics.lastAnalyzed': biasAnalysis.analysisStatus === 'complete' ? new Date() : null
      };

      // Add detailed bias factors if available
      if (biasAnalysis.detectedBiasFactors && biasAnalysis.detectedBiasFactors.length > 0) {
        qualityMetricsUpdate['qualityMetrics.detectedBiasFactors'] = biasAnalysis.detectedBiasFactors;
      }

      // Add enhanced AI analysis fields
      if (biasAnalysis.overallBiasScore !== undefined) {
        qualityMetricsUpdate['qualityMetrics.overallBiasScore'] = biasAnalysis.overallBiasScore;
      }
      
      if (biasAnalysis.isBiased !== undefined) {
        qualityMetricsUpdate['qualityMetrics.isBiased'] = biasAnalysis.isBiased;
      }

      // Update question with comprehensive quality metrics
      await InterviewQuestion.findByIdAndUpdate(questionId, {
        $set: qualityMetricsUpdate
      });
      
      console.log(`✅ Quality analysis completed for question ${questionId}:`, {
        semanticQualityScore: semanticAnalysis.score,
        biasScore: biasAnalysis.analysisStatus === 'complete' ? biasAnalysis.biasScore : 'not analyzed',
        diversityIndex: diversityIndex,
        difficultyCalibration: difficultyCalibration,
        legalCompliance: biasAnalysis.analysisStatus === 'complete' ? !biasAnalysis.hasBias : 'not analyzed',
        detectedBiasFactors: biasAnalysis.detectedBiasFactors?.length || 0
      });
      
      return {
        semanticQualityScore: semanticAnalysis.score,
        qualityIssues: semanticAnalysis.issues,
        analysisStatus: biasAnalysis.analysisStatus,
        biasScore: biasAnalysis.analysisStatus === 'complete' ? biasAnalysis.biasScore : null,
        diversityIndex: diversityIndex,
        difficultyCalibration: difficultyCalibration,
        legalCompliance: biasAnalysis.analysisStatus === 'complete' ? !biasAnalysis.hasBias : null,
        recommendations,
        biasAnalysis: biasBreakdown,
        // Enhanced fields from AI analysis
        detectedBiasFactors: biasAnalysis.detectedBiasFactors || [],
        neutralityConfidence: biasAnalysis.neutralityConfidence,
        recommendation: biasAnalysis.recommendation,
        overallBiasScore: biasAnalysis.overallBiasScore,
        isBiased: biasAnalysis.isBiased,
        aiNeutralityConfidence: biasAnalysis.neutralityConfidence,
        aiRecommendation: biasAnalysis.recommendation || recommendations[0]
      };
    } catch (error) {
      console.error('❌ Error analyzing question quality:', error);
      throw error;
    }
  }

  /**
   * Submit feedback for a question
   */
  async submitQuestionFeedback(questionId, feedback, organizationId) {
    try {
      const question = await InterviewQuestion.findById(questionId);
      if (!question) {
        throw this._notFound('Question not found');
      }
      await this._assertQuestionOrganization(question, organizationId);

      const updateData = {};

      if (feedback.type === 'candidate') {
        updateData.$push = {
          'feedback.candidateFeedback': {
            rating: feedback.rating,
            comments: feedback.comments,
            submittedAt: feedback.submittedAt || new Date(),
            submittedBy: feedback.submittedBy
          }
        };
      } else if (feedback.type === 'interviewer') {
        updateData.$push = {
          'feedback.interviewerFeedback': {
            effectiveness: feedback.effectiveness,
            clarity: feedback.clarity,
            relevance: feedback.relevance,
            comments: feedback.comments,
            submittedAt: feedback.submittedAt || new Date(),
            submittedBy: feedback.submittedBy
          }
        };
      }

      await InterviewQuestion.findByIdAndUpdate(questionId, updateData);
      
      console.log(`✅ Feedback submitted for question ${questionId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error submitting feedback:', error);
      throw error;
    }
  }

  /**
   * Get performance insights for questions in a job
   */
  async getPerformanceInsights(jobId, organizationId) {
    try {
      await this._getJobForOrganization(jobId, organizationId);
      const questions = await InterviewQuestion.find({ jobId, isActive: true });
      
      const insights = {
        totalQuestions: questions.length,
        averageQuality: null,
        qualityAssessmentCount: 0,
        biasAnalysisCount: 0,
        biasDistribution: {
          age: 0,
          gender: 0,
          nationality: 0,
          familyStatus: 0,
          religious: 0
        },
        usageStats: {
          totalUsage: 0,
          averageSuccessRate: 0,
          mostUsedTypes: []
        },
        recommendations: []
      };

      if (questions.length > 0) {
        // Calculate averages
        const semanticScores = [];
        let analyzedBiasCount = 0;
        let totalUsage = 0;
        let totalSuccessRate = 0;
        const typeUsage = {};

        questions.forEach(q => {
          // Quality metrics
          if (q.qualityMetrics) {
            const semanticQuality = q.qualityMetrics.semanticQualityScore;
            if (typeof semanticQuality === 'number' && Number.isFinite(semanticQuality)) {
              semanticScores.push(semanticQuality);
            }

            // Bias distribution
            if (q.qualityMetrics.analysisStatus === 'complete' && q.qualityMetrics.biasAnalysis) {
              analyzedBiasCount += 1;
              Object.keys(insights.biasDistribution).forEach(key => {
                insights.biasDistribution[key] += q.qualityMetrics.biasAnalysis[key] || 0;
              });
            }
          }

          // Usage stats
          if (q.usage) {
            totalUsage += q.usage.timesUsed || 0;
            totalSuccessRate += q.usage.responsePatterns?.successRate || 0;
          }

          // Type distribution
          typeUsage[q.type] = (typeUsage[q.type] || 0) + (q.usage?.timesUsed || 0);
        });

        insights.averageQuality = semanticScores.length
          ? semanticScores.reduce((sum, score) => sum + score, 0) / semanticScores.length
          : null;
        insights.qualityAssessmentCount = semanticScores.length;
        insights.biasAnalysisCount = analyzedBiasCount;
        insights.usageStats.totalUsage = totalUsage;
        insights.usageStats.averageSuccessRate = totalSuccessRate / questions.length;
        
        // Most used types
        insights.usageStats.mostUsedTypes = Object.entries(typeUsage)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([type, usage]) => ({ type, usage }));

        // Average bias scores
        Object.keys(insights.biasDistribution).forEach(key => {
          insights.biasDistribution[key] = analyzedBiasCount
            ? insights.biasDistribution[key] / analyzedBiasCount
            : null;
        });

        // Generate recommendations
        if (insights.averageQuality == null) {
          insights.recommendations.push('Question quality has not been semantically assessed yet');
        } else if (insights.averageQuality < 0.6) {
          insights.recommendations.push('Consider reviewing and improving question quality');
        }
        
        const highBiasTypes = Object.entries(insights.biasDistribution)
          .filter(([, score]) => score > 0.3)
          .map(([type]) => type);
          
        if (highBiasTypes.length > 0) {
          insights.recommendations.push(`High bias detected in: ${highBiasTypes.join(', ')}`);
        }

        if (insights.usageStats.averageSuccessRate < 0.5) {
          insights.recommendations.push('Low success rates suggest questions may need revision');
        }
      }

      return insights;
    } catch (error) {
      console.error('❌ Error getting performance insights:', error);
      throw error;
    }
  }

  /**
   * Generate question set with optimal diversity
   */
  async generateOptimizedQuestionSet(jobId, options = {}) {
    try {
      const {
        totalQuestions = 15,
        stages = ['screening', 'first_round', 'technical'],
        ensureDiversity = true,
        maxBiasScore = 0.3
      } = options;

      console.log('🎯 Generating optimized question set...');

      const total = Number(totalQuestions);
      const selectedStages = Array.isArray(stages)
        ? [...new Set(stages.filter((stage) => typeof stage === 'string' && stage.trim()))]
        : [];
      if (!Number.isInteger(total) || total < 1 || total > 50) {
        const error = new Error('totalQuestions must be an integer between 1 and 50');
        error.code = 'INVALID_QUESTION_COUNT';
        error.statusCode = 400;
        throw error;
      }
      if (selectedStages.length === 0) {
        const error = new Error('At least one interview stage is required');
        error.code = 'INTERVIEW_STAGES_REQUIRED';
        error.statusCode = 400;
        throw error;
      }

      const job = await this._getJobForOrganization(jobId, options.organizationId);

      // Generate one complete set per stage with bounded concurrency. This
      // replaces the former stage × type sequence while avoiding an
      // unbounded burst against the connected-account runtime.
      const questionsPerStage = Math.floor(total / selectedStages.length);
      const stageRemainder = total % selectedStages.length;

      const stageEntries = await this._mapWithConcurrency(
        selectedStages.map((stage, stageIndex) => ({ stage, stageIndex })),
        2,
        async ({ stage, stageIndex }) => {
          const stageQuestionCount = questionsPerStage + (stageIndex < stageRemainder ? 1 : 0);
          if (stageQuestionCount === 0) return [stage, []];
          const stageOptions = {
            ...options,
            stage,
            questionCount: stageQuestionCount,
            includeTypes: this._getOptimalTypesForStage(stage)
          };

          return [stage, await this._generateAdvancedQuestionsWithAI(job, stageOptions)];
        }
      );
      const questionsByStage = Object.fromEntries(stageEntries);

      // Flatten and optimize
      let allQuestions = Object.values(questionsByStage).flat();

      const globalAssessment = assessQuestionSet(allQuestions, {
        job,
        expectedCount: total
      });
      if (!globalAssessment.passed) {
        const error = new Error(`Generated multi-stage questions failed the global quality gate: ${globalAssessment.issues.join(' ')}`);
        error.code = 'AI_QUESTION_QUALITY_FAILED';
        error.statusCode = 422;
        throw error;
      }

      if (ensureDiversity) {
        allQuestions = await this._optimizeQuestionDiversity(allQuestions, job);
      }

      // Filter by quality thresholds
      allQuestions = allQuestions.filter(q => 
        Number(q.qualityMetrics?.semanticQualityScore) >= 0.7
        && q.qualityMetrics?.analysisStatus === 'complete'
        && Number(q.qualityMetrics?.biasScore) <= maxBiasScore
      );

      if (allQuestions.length !== total) {
        const error = new Error(
          `AI produced ${allQuestions.length} questions that passed the quality gates; ${total} were requested. No questions were saved.`
        );
        error.code = 'AI_QUESTION_QUALITY_FAILED';
        error.statusCode = 422;
        error.details = { requested: total, passed: allQuestions.length };
        throw error;
      }

      // Save optimized questions
      const savedQuestions = await this.bulkCreateQuestions(
        allQuestions.slice(0, total),
        options.userId,
        options.organizationId
      );

      return {
        questions: savedQuestions,
        optimization: {
          totalGenerated: allQuestions.length,
          totalSaved: savedQuestions.length,
          diversityScore: this._calculateDiversityScore(savedQuestions),
          averageQuality: this._calculateAverageQuality(savedQuestions)
        }
      };
    } catch (error) {
      console.error('❌ Error generating optimized question set:', error);
      throw error;
    }
  }

  async _mapWithConcurrency(items, concurrency, mapper) {
    const values = Array.isArray(items) ? items : [];
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), values.length || 1);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(values[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Get optimal question types for interview stage
   */
  _getOptimalTypesForStage(stage) {
    const stageTypeMap = {
      'screening': ['general', 'cultural_fit', 'experience_based'],
      'first_round': ['behavioral', 'situational', 'skills_based'],
      'technical': ['technical', 'skills_based', 'situational'],
      'final': ['cultural_fit', 'behavioral', 'leadership'],
      'hr': ['cultural_fit', 'general', 'behavioral'],
      'panel': ['behavioral', 'situational', 'technical']
    };

    return stageTypeMap[stage] || ['behavioral', 'situational', 'technical'];
  }

  /**
   * Analyze potential bias in question text
   */
  _manualBiasReview(recommendation) {
    return {
      analysisStatus: 'manual_review',
      hasBias: null,
      biasScore: null,
      detectedBiasFactors: [],
      recommendation,
      neutralityConfidence: null
    };
  }

  _mapBiasAnalysis(analysis) {
    return {
      analysisStatus: 'complete',
      hasBias: analysis.isBiased,
      biasScore: analysis.overallBiasScore,
      detectedBiasFactors: analysis.detectedBiasFactors || [],
      recommendation: analysis.recommendation,
      neutralityConfidence: analysis.neutralityConfidence
    };
  }

  async _analyzeBiasBatch(questionTexts, jobContext = null) {
    try {
      console.log(`🔬 Calling AI bias analysis for ${questionTexts.length} question(s)`);
      const result = await this.aiModelService.analyzeQuestionsForBias(questionTexts, jobContext);
      if (result.error) console.warn('AI bias analysis completed with manual-review gaps:', result.error);
      return questionTexts.map((_, index) => result.analyses?.[index]
        ? this._mapBiasAnalysis(result.analyses[index])
        : this._manualBiasReview('AI bias analysis failed. Question requires manual review.'));
    } catch (error) {
      console.error('❌ Exception in batched AI bias analysis:', error);
      return questionTexts.map(() => this._manualBiasReview(
        'Exception during AI bias analysis. Question requires manual review.'
      ));
    }
  }

  async _analyzeBias(questionText, jobContext = null) {
    const [analysis] = await this._analyzeBiasBatch([questionText], jobContext);
    return analysis;
  }

  /**
   * Calculate difficulty calibration score
   */
  _calculateDifficultyCalibration(difficulty) {
    // Return a score based on how well the difficulty matches expectations
    const difficultyMap = {
      'easy': 0.3,
      'medium': 0.6,
      'hard': 0.9
    };
    return difficultyMap[difficulty] || 0.6;
  }

  /**
   * Calculate diversity index for a single question
   */
  _calculateQuestionDiversity(question, allQuestions) {
    if (!allQuestions || allQuestions.length <= 1) return 0.8; // Default for single question
    
    const questionText = question.question.toLowerCase();
    const questionWords = new Set(questionText.split(' ').filter(word => word.length > 3));
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (const otherQuestion of allQuestions) {
      if (otherQuestion === question) continue;
      
      const otherText = otherQuestion.question.toLowerCase();
      const otherWords = new Set(otherText.split(' ').filter(word => word.length > 3));
      
      // Calculate Jaccard similarity
      const intersection = new Set([...questionWords].filter(word => otherWords.has(word)));
      const union = new Set([...questionWords, ...otherWords]);
      const similarity = intersection.size / union.size;
      
      totalSimilarity += similarity;
      comparisons++;
    }
    
    // Diversity is inverse of average similarity
    const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0;
    const diversityScore = Math.max(0, 1 - avgSimilarity);
    
    return Math.round(diversityScore * 100) / 100;
  }

  /**
   * Optimize question diversity
   */
  async _optimizeQuestionDiversity(questions, job) {
    // Group questions by type and ensure balanced distribution
    const typeGroups = {};
    questions.forEach(q => {
      if (!typeGroups[q.type]) typeGroups[q.type] = [];
      typeGroups[q.type].push(q);
    });

    // Select best questions from each type
    const optimizedQuestions = [];
    const maxPerType = Math.ceil(questions.length / Object.keys(typeGroups).length);

    for (const [type, typeQuestions] of Object.entries(typeGroups)) {
      // Sort by quality and select top questions
      const sortedQuestions = typeQuestions.sort((a, b) => {
        const semanticDifference = Number(b.qualityMetrics?.semanticQualityScore || 0)
          - Number(a.qualityMetrics?.semanticQualityScore || 0);
        if (semanticDifference) return semanticDifference;
        const aBias = Number.isFinite(Number(a.qualityMetrics?.biasScore)) ? Number(a.qualityMetrics.biasScore) : 1;
        const bBias = Number.isFinite(Number(b.qualityMetrics?.biasScore)) ? Number(b.qualityMetrics.biasScore) : 1;
        return aBias - bBias;
      });

      optimizedQuestions.push(...sortedQuestions.slice(0, maxPerType));
    }

    return optimizedQuestions;
  }

  /**
   * Calculate diversity score for question set
   */
  _calculateDiversityScore(questions) {
    const types = new Set(questions.map(q => q.type));
    const categories = new Set(questions.map(q => q.category));
    const difficulties = new Set(questions.map(q => q.difficulty));

    // Diversity score based on variety in types, categories, and difficulties
    const typeScore = types.size / 7; // 7 possible types
    const categoryScore = categories.size / Math.max(questions.length, 1);
    const difficultyScore = difficulties.size / 3; // 3 difficulty levels

    return Math.round(((typeScore + categoryScore + difficultyScore) / 3) * 100) / 100;
  }

  /**
   * Calculate average quality score
   */
  _calculateAverageQuality(questions) {
    if (questions.length === 0) return 0;

    const assessedScores = questions
      .flatMap((question) => {
        const score = question.qualityMetrics?.semanticQualityScore;
        return typeof score === 'number' && Number.isFinite(score) ? [score] : [];
      });
    if (!assessedScores.length) return 0;
    const totalQuality = assessedScores.reduce((sum, score) => sum + score, 0);

    return Math.round((totalQuality / assessedScores.length) * 100) / 100;
  }

  /**
   * Generate basic questions for a job (fallback when AI is not available)
   */
  _generateBasicQuestions(job, options = {}) {
    const error = new Error('Template-based interview-question fallback is disabled. Retry AI generation instead.');
    error.code = 'AI_QUESTION_GENERATION_REQUIRED';
    error.statusCode = 503;
    throw error;
  }

  /**
   * Generate fallback questions when AI generation fails
   */
  _generateFallbackQuestions(type, count, difficulty) {
    const error = new Error('Generic interview-question fallback is disabled. Retry AI generation instead.');
    error.code = 'AI_QUESTION_GENERATION_REQUIRED';
    error.statusCode = 503;
    throw error;
  }
}

module.exports = InterviewService;
