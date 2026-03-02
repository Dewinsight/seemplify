const InterviewQuestion = require('../models/InterviewQuestion');
const Job = require('../models/Job');
const AzureOpenAIService = require('./azureOpenAIService');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

class InterviewService {
  constructor() {
    this.azureOpenAIService = new AzureOpenAIService();
  }

  /**
   * Create a new interview question
   */
  async createQuestion(questionData, userId) {
    try {
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
        diversityIndex: 0.8, // Default to high diversity for manually created questions
        biasScore: 0.0, // Default to no bias (will be updated by analysis)
        legalCompliance: true,
        biasAnalysis: {
          age: 0,
          gender: 0,
          nationality: 0,
          familyStatus: 0,
          religious: 0
        },
        aiNeutralityConfidence: 0.0,
        aiRecommendation: 'Manual question - analysis pending',
        lastAnalyzed: new Date()
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
  async getQuestionsByJob(jobId, options = {}) {
    try {
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
  async getQuestionById(questionId) {
    try {
      const question = await InterviewQuestion.findById(questionId)
        .populate('jobId', 'title department location')
        .populate('createdBy', 'profile.firstName profile.lastName email');

      if (!question) {
        throw new Error('Interview question not found');
      }

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
  async updateQuestion(questionId, updateData, userId) {
    try {
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

      const question = await InterviewQuestion.findByIdAndUpdate(
        questionId,
        { ...cleanedData, updatedBy: userId, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      if (!question) {
        throw new Error('Interview question not found');
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
  async deleteQuestion(questionId) {
    try {
      const question = await InterviewQuestion.findByIdAndDelete(questionId);
      if (!question) {
        throw new Error('Interview question not found');
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
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      // Use advanced AI generation if available, fallback to basic generation
      let questions;
      try {
        questions = await this._generateAdvancedQuestionsWithAI(job, options);
      } catch (aiError) {
        console.warn('⚠️ AI generation failed, falling back to basic generation:', aiError.message);
        questions = this._generateBasicQuestions(job, options);
      }
      
      // Save the generated questions
      const savedQuestions = await this.bulkCreateQuestions(questions, options.userId);
      
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

      // Prepare job context for AI
      const jobContext = this._prepareJobContext(job);
      
      // Generate different types of questions
      const questionTypes = this._distributeQuestionTypes(includeTypes, questionCount);
      const allQuestions = [];

      for (const [type, count] of Object.entries(questionTypes)) {
        if (count > 0) {
          const questions = await this._generateQuestionsByType(type, count, jobContext, difficulty, focusAreas);
          allQuestions.push(...questions);
        }
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
   * Generate questions by specific type using AI
   */
  async _generateQuestionsByType(type, count, jobContext, difficulty, focusAreas) {
    const prompt = this._buildPromptForType(type, count, jobContext, difficulty, focusAreas);
    
    try {
      console.log(`🎯 Generating ${count} ${type} questions...`);
      const response = await this.azureOpenAIService.generateInterviewQuestions(prompt);
      const parsedQuestions = this._parseAIResponse(response, type, difficulty);
      
      if (parsedQuestions.length === 0) {
        console.warn(`⚠️ No valid questions generated for type ${type}, using fallback`);
        return this._generateFallbackQuestions(type, count, difficulty);
      }
      
      console.log(`✅ Successfully generated ${parsedQuestions.length} ${type} questions`);
      return parsedQuestions;
    } catch (error) {
      console.error(`❌ Error generating ${type} questions:`, error.message);
      console.log(`🔄 Using fallback questions for type: ${type}`);
      return this._generateFallbackQuestions(type, count, difficulty);
    }
  }

  /**
   * Build specialized prompts for different question types
   */
  _buildPromptForType(type, count, jobContext, difficulty, focusAreas) {
    const basePrompt = `You are an expert interview designer with 20+ years of experience in talent acquisition and behavioral psychology.

COMPREHENSIVE JOB CONTEXT:
${jobContext}

IMPORTANT INSTRUCTIONS:
1. Analyze ALL provided job details carefully - including the full description, requirements, and responsibilities
2. Create questions that specifically assess skills mentioned in the job description
3. Align questions with the actual responsibilities listed
4. Consider the specific requirements and qualifications
5. Tailor questions to the company culture and team structure when provided
6. Focus on real challenges and success metrics mentioned in the job details
7. DO NOT create generic questions - every question must relate to specific job details provided above

Generate ${count} ${type} interview questions with ${difficulty} difficulty level.
${focusAreas.length > 0 ? `Focus on these areas: ${focusAreas.join(', ')}` : ''}

CRITICAL JSON FORMAT REQUIREMENTS:
You MUST return a JSON object with this EXACT structure:
{
  "questions": [
    {
      "question": "The interview question text (required)",
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
- Include clear evaluation criteria
- Avoid bias and leading questions
- Ensure legal compliance
- Each question must have at least 1 scoring criterion
- Include 1-2 relevant follow-up questions
- Add 2-3 relevant skill tags

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

    return basePrompt + (typeSpecificPrompts[type] || typeSpecificPrompts['behavioral']);
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
        // Ensure scoringCriteria is properly formatted
        let scoringCriteria = [];
        if (Array.isArray(q.scoringCriteria)) {
          scoringCriteria = q.scoringCriteria.map(criterion => {
            if (typeof criterion === 'string') {
              return {
                criterion: decodeHtmlEntities(criterion),
                weight: 10,
                description: decodeHtmlEntities(`Evaluate: ${criterion}`)
              };
            } else if (typeof criterion === 'object' && criterion.criterion) {
              return {
                criterion: decodeHtmlEntities(criterion.criterion),
                weight: criterion.weight || 10,
                description: decodeHtmlEntities(criterion.description || `Evaluate: ${criterion.criterion}`)
              };
            }
            return {
              criterion: 'General Assessment',
              weight: 10,
              description: 'Evaluate overall response quality'
            };
          });
        }

        // Ensure followUpQuestions is properly formatted
        let followUpQuestions = [];
        if (Array.isArray(q.followUpQuestions)) {
          followUpQuestions = q.followUpQuestions.map(followUp => {
            if (typeof followUp === 'string') {
              return {
                question: decodeHtmlEntities(followUp),
                condition: 'Based on candidate response'
              };
            } else if (typeof followUp === 'object' && followUp.question) {
              return {
                question: decodeHtmlEntities(followUp.question),
                condition: followUp.condition || 'Based on candidate response'
              };
            }
            return {
              question: 'Can you provide more details about your approach?',
              condition: 'If response needs clarification'
            };
          });
        }

        // Ensure tags is an array of strings
        let tags = [];
        if (Array.isArray(q.tags)) {
          tags = q.tags.filter(tag => typeof tag === 'string');
        }

        return {
          question: decodeHtmlEntities(q.question || 'Question text not provided'),
          type: type,
          difficulty: difficulty,
          expectedAnswer: decodeHtmlEntities(q.expectedAnswer || 'Look for specific examples and clear reasoning.'),
          scoringCriteria: scoringCriteria,
          followUpQuestions: followUpQuestions,
          tags: tags.map(tag => decodeHtmlEntities(tag)),
          timeLimit: q.timeLimit || 5,
          order: index,
          isAIGenerated: true,
          aiGenerationMetadata: {
            generatedAt: new Date(),
            model: process.env.LLAMA_AZURE_DEPLOYMENT || process.env.azure_openai_model || 'Llama-3.3-70B-Instruct',
            confidence: 0.9,
            questionType: type
          },
          // Initialize quality metrics with realistic values
          qualityMetrics: {
            difficultyCalibration: difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.7 : 0.9,
            diversityIndex: 0.8,
            biasScore: 0.0, // Start with no bias detected
            legalCompliance: true,
            biasAnalysis: {
              age: 0.0,
              gender: 0.0,
              nationality: 0.0,
              familyStatus: 0.0,
              religious: 0.0
            },
            aiNeutralityConfidence: 0.9,
            aiRecommendation: 'AI-generated question with initial quality assessment',
            lastAnalyzed: new Date()
          }
        };
      });
    } catch (error) {
      console.error('❌ Error parsing AI response:', error);
      return [];
    }
  }

  /**
   * Validate and enhance generated questions
   */
  async _validateAndEnhanceQuestions(questions, job, options) {
    const validQuestions = [];
    const maxBiasScore = options.maxBiasScore !== undefined ? options.maxBiasScore : 0.3;

    console.log(`🔍 Validating questions with max bias tolerance: ${maxBiasScore}`);

    for (const question of questions) {
      try {
        // Basic validation
        if (!question.question || question.question.trim().length < 10) {
          console.warn('⚠️ Skipping question with insufficient content:', question.question?.substring(0, 50));
          continue;
        }

        // Calculate actual quality metrics
        // Prepare job context for bias analysis
        const jobContextForAnalysis = this._prepareJobContext(job);
        const aiBiasCheckResult = await this._analyzeBias(question.question, jobContextForAnalysis);
        
        // Check if question meets bias tolerance based on AI analysis
        if (aiBiasCheckResult.biasScore > maxBiasScore) {
          console.warn(`⚠️ AI Skipping question due to high bias score (${aiBiasCheckResult.biasScore} > ${maxBiasScore}):`, question.question.substring(0, 100));
          console.warn(`   AI Recommendation: ${aiBiasCheckResult.recommendation}`);
          if (aiBiasCheckResult.detectedBiasFactors && aiBiasCheckResult.detectedBiasFactors.length > 0) {
            console.warn(`   AI Detected Factors: ${aiBiasCheckResult.detectedBiasFactors.map(f => `${f.type} (Score: ${f.score})`).join(', ')}`);
          }
          continue;
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
            difficultyCalibration: this._calculateDifficultyCalibration(question.difficulty),
            diversityIndex: diversityIndex,
            biasScore: aiBiasCheckResult.biasScore, // Use AI-determined bias score
            legalCompliance: !aiBiasCheckResult.hasBias, // Use AI-determined legal compliance
            biasAnalysis: { // Populate with detailed factors from AI
              age: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'age')?.score || 0,
              gender: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'gender')?.score || 0,
              nationality: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'nationality')?.score || 0,
              familyStatus: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase().includes('family'))?.score || 0,
              religious: aiBiasCheckResult.detectedBiasFactors?.find(f => f.type.toLowerCase() === 'religion')?.score || 0,
              // Potentially add other factors if the AI returns them
            },
            aiNeutralityConfidence: aiBiasCheckResult.neutralityConfidence, // Store AI's confidence
            aiRecommendation: aiBiasCheckResult.recommendation // Store AI's recommendation
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
        console.error('Question data:', JSON.stringify(question, null, 2));
      }
    }

    return validQuestions;
  }

  /**
   * Determine question category based on content and job
   */
  _determineCategory(question, job) {
    const questionText = question.question.toLowerCase();
    const jobSkills = (job.skills || '').toLowerCase();

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
  async bulkCreateQuestions(questionsData, userId) {
    try {
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
      const avgBias = questions.reduce((sum, q) => sum + (q.qualityMetrics?.biasScore || 0), 0) / questions.length;
      const avgDiversity = questions.reduce((sum, q) => sum + (q.qualityMetrics?.diversityIndex || 0), 0) / questions.length;
      const complianceRate = questions.filter(q => q.qualityMetrics?.legalCompliance).length / questions.length;
      
      console.log(`✅ Bulk created ${questions.length} interview questions with quality metrics:`, {
        avgBiasScore: Math.round(avgBias * 100) / 100,
        avgDiversityIndex: Math.round(avgDiversity * 100) / 100,
        legalComplianceRate: Math.round(complianceRate * 100) / 100
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
  async getQuestionStatistics(jobId) {
    try {
      const totalQuestions = await InterviewQuestion.countDocuments({ jobId, isActive: true });
      
      const typeDistribution = await InterviewQuestion.aggregate([
        { $match: { jobId: jobId, isActive: true } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]);

      const stageDistribution = await InterviewQuestion.aggregate([
        { $match: { jobId: jobId, isActive: true } },
        { $group: { _id: '$interviewStage', count: { $sum: 1 } } }
      ]);

      const qualityMetrics = await InterviewQuestion.aggregate([
        { $match: { jobId: jobId, isActive: true } },
        {
          $group: {
            _id: null,
            avgBiasScore: { $avg: '$qualityMetrics.biasScore' },
            avgDiversityIndex: { $avg: '$qualityMetrics.diversityIndex' },
            avgDifficultyCalibration: { $avg: '$qualityMetrics.difficultyCalibration' },
            legalComplianceCount: { $sum: { $cond: ['$qualityMetrics.legalCompliance', 1, 0] } },
            avgSuccessRate: { $avg: '$usage.successRate' },
            totalUsage: { $sum: '$usage.timesUsed' }
          }
        }
      ]);

      const stats = qualityMetrics[0];
      const complianceRate = stats ? (stats.legalComplianceCount / totalQuestions) : 0;

      return {
        totalQuestions,
        typeDistribution,
        stageDistribution,
        qualityMetrics: stats ? {
          avgBiasScore: Math.round((stats.avgBiasScore || 0) * 100) / 100,
          avgDiversityIndex: Math.round((stats.avgDiversityIndex || 0) * 100) / 100,
          avgDifficultyCalibration: Math.round((stats.avgDifficultyCalibration || 0) * 100) / 100,
          legalComplianceRate: Math.round(complianceRate * 100) / 100,
          avgSuccessRate: Math.round((stats.avgSuccessRate || 0) * 100) / 100,
          totalUsage: stats.totalUsage || 0
        } : {
          avgBiasScore: 0,
          avgDiversityIndex: 0,
          avgDifficultyCalibration: 0,
          legalComplianceRate: 0,
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
  async analyzeQuestionQuality(questionId) {
    try {
      const question = await InterviewQuestion.findById(questionId).populate('jobId');
      if (!question) {
        throw new Error('Question not found');
      }

      console.log(`🔍 Analyzing quality for question: ${question._id}`);

      // Perform fresh analysis
      const biasAnalysis = await this._analyzeBias(question.question);
      
      // Calculate difficulty calibration based on question difficulty
      const difficultyCalibration = this._calculateDifficultyCalibration(question.difficulty);
      
      // Calculate diversity index (for single question analysis, use a base score)
      const diversityIndex = 0.8; // Base diversity score for individual analysis
      
      // Generate recommendations
      const recommendations = [];
      
      if (biasAnalysis.hasBias || biasAnalysis.isBiased) {
        recommendations.push('🚨 HIGH PRIORITY: Address bias issues before using this question');
        if (biasAnalysis.detectedBiasFactors && biasAnalysis.detectedBiasFactors.length > 0) {
          recommendations.push(`Detected bias types: ${biasAnalysis.detectedBiasFactors.map(i => i.type).join(', ')}`);
        }
      } else {
        recommendations.push('✅ This question meets quality standards and is ready for use');
      }

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
        'qualityMetrics.biasScore': biasAnalysis.overallBiasScore || biasAnalysis.biasScore || 0,
        'qualityMetrics.diversityIndex': diversityIndex,
        'qualityMetrics.difficultyCalibration': difficultyCalibration,
        'qualityMetrics.legalCompliance': !(biasAnalysis.hasBias || biasAnalysis.isBiased),
        'qualityMetrics.biasAnalysis': biasBreakdown,
        'qualityMetrics.aiNeutralityConfidence': biasAnalysis.neutralityConfidence || 0.8,
        'qualityMetrics.aiRecommendation': biasAnalysis.recommendation || recommendations[0],
        'qualityMetrics.lastAnalyzed': new Date()
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
        biasScore: biasAnalysis.overallBiasScore || biasAnalysis.biasScore || 0,
        diversityIndex: diversityIndex,
        difficultyCalibration: difficultyCalibration,
        legalCompliance: !(biasAnalysis.hasBias || biasAnalysis.isBiased),
        detectedBiasFactors: biasAnalysis.detectedBiasFactors?.length || 0
      });
      
      return {
        biasScore: biasAnalysis.overallBiasScore || biasAnalysis.biasScore || 0,
        diversityIndex: diversityIndex,
        difficultyCalibration: difficultyCalibration,
        legalCompliance: !(biasAnalysis.hasBias || biasAnalysis.isBiased),
        recommendations,
        biasAnalysis: biasBreakdown,
        // Enhanced fields from AI analysis
        detectedBiasFactors: biasAnalysis.detectedBiasFactors || [],
        neutralityConfidence: biasAnalysis.neutralityConfidence,
        recommendation: biasAnalysis.recommendation,
        overallBiasScore: biasAnalysis.overallBiasScore,
        isBiased: biasAnalysis.isBiased,
        aiNeutralityConfidence: biasAnalysis.neutralityConfidence || 0.8,
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
  async submitQuestionFeedback(questionId, feedback) {
    try {
      const question = await InterviewQuestion.findById(questionId);
      if (!question) {
        throw new Error('Question not found');
      }

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
  async getPerformanceInsights(jobId) {
    try {
      const questions = await InterviewQuestion.find({ jobId, isActive: true });
      
      const insights = {
        totalQuestions: questions.length,
        averageQuality: 0,
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
        let totalQuality = 0;
        let totalUsage = 0;
        let totalSuccessRate = 0;
        const typeUsage = {};

        questions.forEach(q => {
          // Quality metrics
          if (q.qualityMetrics) {
            const quality = 1 - (q.qualityMetrics.biasScore || 0); // Lower bias = higher quality
            totalQuality += quality;

            // Bias distribution
            if (q.qualityMetrics.biasAnalysis) {
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

        insights.averageQuality = totalQuality / questions.length;
        insights.usageStats.totalUsage = totalUsage;
        insights.usageStats.averageSuccessRate = totalSuccessRate / questions.length;
        
        // Most used types
        insights.usageStats.mostUsedTypes = Object.entries(typeUsage)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([type, usage]) => ({ type, usage }));

        // Average bias scores
        Object.keys(insights.biasDistribution).forEach(key => {
          insights.biasDistribution[key] /= questions.length;
        });

        // Generate recommendations
        if (insights.averageQuality < 0.6) {
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

      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      // Generate questions for each stage
      const questionsByStage = {};
      const questionsPerStage = Math.floor(totalQuestions / stages.length);

      for (const stage of stages) {
        const stageOptions = {
          ...options,
          stage,
          questionCount: questionsPerStage,
          includeTypes: this._getOptimalTypesForStage(stage)
        };

        questionsByStage[stage] = await this._generateAdvancedQuestionsWithAI(job, stageOptions);
      }

      // Flatten and optimize
      let allQuestions = Object.values(questionsByStage).flat();

      if (ensureDiversity) {
        allQuestions = await this._optimizeQuestionDiversity(allQuestions, job);
      }

      // Filter by quality thresholds
      allQuestions = allQuestions.filter(q => 
        (q.qualityMetrics?.biasScore || 0) <= maxBiasScore
      );

      // Save optimized questions
      const savedQuestions = await this.bulkCreateQuestions(allQuestions.slice(0, totalQuestions), options.userId);

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
  async _analyzeBias(questionText, jobContext = null) {
    try {
      console.log(`🔬 Calling AI for bias analysis on: "${questionText.substring(0, 100)}..."`);
      const aiAnalysisResult = await this.azureOpenAIService.analyzeTextForBias(questionText, jobContext);

      if (aiAnalysisResult.success && aiAnalysisResult.analysis) {
        const analysis = aiAnalysisResult.analysis;
        // Map AI response to the structure expected by _validateAndEnhanceQuestions
        // The AI response has 'detectedBiasFactors' which is an array of objects like { type, score, keywordsFound, explanation }
        // This is used directly by _validateAndEnhanceQuestions for populating qualityMetrics.biasAnalysis
        // All code now consistently uses 'detectedBiasFactors' to match the AI response format.

        return {
          hasBias: analysis.isBiased, // Map AI's 'isBiased' to 'hasBias' for consistency
          biasScore: analysis.overallBiasScore, // Directly from AI
          detectedBiasFactors: analysis.detectedBiasFactors || [], // Directly from AI (ensure it's an array)
          recommendation: analysis.recommendation, // Directly from AI
          neutralityConfidence: analysis.neutralityConfidence // Store this as well
        };
      } else {
        console.error('❌ AI bias analysis failed or returned invalid data:', aiAnalysisResult.error || 'Unknown error');
        // Fallback to a default "analysis failed" state
        return {
          hasBias: false, // Default to not biased to avoid incorrectly blocking questions on analysis failure
          biasScore: 0,
          detectedBiasFactors: [],
          recommendation: 'AI bias analysis failed. Question requires manual review.',
          neutralityConfidence: 0.0
        };
      }
    } catch (error) {
      console.error('❌ Exception in _analyzeBias calling AI:', error);
      return {
        hasBias: false,
        biasScore: 0,
        detectedBiasFactors: [],
        recommendation: 'Exception during AI bias analysis. Question requires manual review.',
        neutralityConfidence: 0.0
      };
    }
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
        const aScore = 1 - (a.qualityMetrics?.biasScore || 0); // Lower bias = higher quality
        const bScore = 1 - (b.qualityMetrics?.biasScore || 0);
        return bScore - aScore;
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

    const totalQuality = questions.reduce((sum, q) => {
      const bias = q.qualityMetrics?.biasScore || 0;
      return sum + (1 - bias); // Higher quality = lower bias
    }, 0);

    return Math.round((totalQuality / questions.length) * 100) / 100;
  }

  /**
   * Generate basic questions for a job (fallback when AI is not available)
   */
  _generateBasicQuestions(job, options = {}) {
    const {
      stage = 'first_round',
      questionCount = 10,
      difficulty = 'medium'
    } = options;

    const baseQuestions = [
      {
        question: `Tell me about your experience with ${job.title} roles.`,
        type: 'experience_based',
        category: 'Experience',
        expectedAnswer: 'Look for specific examples, years of experience, and relevant accomplishments.'
      },
      {
        question: `What interests you most about working in ${job.department}?`,
        type: 'general',
        category: 'Motivation',
        expectedAnswer: 'Assess genuine interest and knowledge about the department.'
      },
      {
        question: `How do you handle challenging situations in your work?`,
        type: 'behavioral',
        category: 'Problem Solving',
        expectedAnswer: 'Look for specific examples and problem-solving approaches.'
      },
      {
        question: `What do you know about our company and this role?`,
        type: 'cultural_fit',
        category: 'Company Knowledge',
        expectedAnswer: 'Evaluate research skills and genuine interest in the company.'
      },
      {
        question: `Describe a time when you had to learn something new quickly.`,
        type: 'behavioral',
        category: 'Learning',
        expectedAnswer: 'Assess adaptability and learning methodology.'
      }
    ];

    // Add job-specific questions based on skills
    if (job.skills) {
      const skills = job.skills.split(',').map(s => s.trim()).slice(0, 3);
      skills.forEach(skill => {
        baseQuestions.push({
          question: `How would you apply your ${skill} skills in this role?`,
          type: 'skills_based',
          category: 'Technical Skills',
          expectedAnswer: `Look for specific examples of ${skill} usage and application.`
        });
      });
    }

    return baseQuestions.slice(0, questionCount).map((q, index) => ({
      jobId: job._id,
      question: q.question,
      type: q.type,
      category: q.category,
      difficulty,
      interviewStage: stage,
      expectedAnswer: q.expectedAnswer,
      order: index,
      isAIGenerated: false,
      aiGenerationMetadata: {
        generatedAt: new Date(),
        model: 'template-based',
        confidence: 0.7
      }
    }));
  }

  /**
   * Generate fallback questions when AI generation fails
   */
  _generateFallbackQuestions(type, count, difficulty) {
    const fallbackQuestions = {
      'technical': [
        {
          question: 'Describe your approach to solving complex technical problems.',
          expectedAnswer: 'Look for systematic problem-solving methodology and technical depth.',
          category: 'Technical Skills'
        },
        {
          question: 'How do you stay current with new technologies and best practices?',
          expectedAnswer: 'Assess continuous learning and professional development habits.',
          category: 'Learning & Development'
        }
      ],
      'behavioral': [
        {
          question: 'Tell me about a time when you had to work with a difficult team member.',
          expectedAnswer: 'Look for conflict resolution skills and emotional intelligence.',
          category: 'Teamwork'
        },
        {
          question: 'Describe a situation where you had to adapt to significant changes.',
          expectedAnswer: 'Assess adaptability and change management skills.',
          category: 'Adaptability'
        }
      ],
      'situational': [
        {
          question: 'How would you handle a situation where you disagree with your manager\'s decision?',
          expectedAnswer: 'Look for professional communication and conflict resolution.',
          category: 'Communication'
        },
        {
          question: 'What would you do if you discovered a mistake in your work after it was submitted?',
          expectedAnswer: 'Assess accountability and problem-solving approach.',
          category: 'Accountability'
        }
      ],
      'cultural_fit': [
        {
          question: 'What type of work environment do you thrive in?',
          expectedAnswer: 'Assess alignment with company culture and values.',
          category: 'Culture Fit'
        },
        {
          question: 'How do you handle feedback and criticism?',
          expectedAnswer: 'Look for growth mindset and professional maturity.',
          category: 'Professional Development'
        }
      ],
      'skills_based': [
        {
          question: 'Describe your experience with the key skills required for this role.',
          expectedAnswer: 'Assess relevant technical and soft skills.',
          category: 'Skills Assessment'
        }
      ],
      'experience_based': [
        {
          question: 'Walk me through your career progression and key achievements.',
          expectedAnswer: 'Look for growth trajectory and relevant accomplishments.',
          category: 'Experience'
        }
      ]
    };

    const questions = fallbackQuestions[type] || fallbackQuestions['behavioral'];
    return questions.slice(0, count).map((q, index) => ({
      question: decodeHtmlEntities(q.question),
      type: type,
      difficulty: difficulty,
      expectedAnswer: decodeHtmlEntities(q.expectedAnswer),
      category: decodeHtmlEntities(q.category),
      scoringCriteria: [
        {
          criterion: decodeHtmlEntities('Response Quality'),
          weight: 30,
          description: decodeHtmlEntities('Clarity and depth of response')
        },
        {
          criterion: decodeHtmlEntities('Relevance'),
          weight: 25,
          description: decodeHtmlEntities('Relevance to the question and role')
        },
        {
          criterion: decodeHtmlEntities('Examples'),
          weight: 25,
          description: decodeHtmlEntities('Use of specific examples and details')
        },
        {
          criterion: decodeHtmlEntities('Communication'),
          weight: 20,
          description: decodeHtmlEntities('Clear and professional communication')
        }
      ],
      followUpQuestions: [
        {
          question: decodeHtmlEntities('Can you provide more specific details about that situation?'),
          condition: 'If response lacks detail'
        },
        {
          question: decodeHtmlEntities('What would you do differently if faced with a similar situation?'),
          condition: 'To assess learning and improvement'
        }
      ],
      tags: [decodeHtmlEntities(type.replace('_', ' ')), 'interview', 'assessment'],
      timeLimit: 5,
      order: index,
      isAIGenerated: false,
      aiGenerationMetadata: {
        generatedAt: new Date(),
        model: 'fallback-template',
        confidence: 0.6,
        questionType: type
      }
    }));
  }
}

module.exports = InterviewService;
