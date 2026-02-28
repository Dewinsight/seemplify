import { apiRequest } from './apiConfig';

export interface InterviewStage {
  _id: string;
  jobId: string;
  name: string;
  order: number;
  type: 'phone_screen' | 'technical' | 'behavioral' | 'panel' | 'hr' | 'executive' | 'case_study' | 'culture_fit' | 'custom';
  description?: string;
  isActive: boolean;
  defaultDuration: number;
  requiredInterviewers: number;
  interviewerRoles: string[];
  evaluationCriteria: EvaluationCriterion[];
  aiQuestionGeneration: AIQuestionConfig;
  defaultQuestions: string[];
  progressionRules: ProgressionRules;
  interviewCount?: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    profile: {
      firstName: string;
      lastName: string;
    };
  };
}

export interface EvaluationCriterion {
  name: string;
  description?: string;
  weight: number;
  type: 'technical' | 'behavioral' | 'cultural' | 'communication' | 'leadership';
  scoringGuidelines?: string;
}

export interface AIQuestionConfig {
  enabled: boolean;
  questionTypes: string[];
  questionCount: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  focusAreas: string[];
}

export interface ProgressionRules {
  autoProgress: boolean;
  minimumScore?: number;
  requiredApprovals: number;
  conditions: ProgressionCondition[];
}

export interface ProgressionCondition {
  type: 'score_threshold' | 'unanimous_approval' | 'manager_approval' | 'ai_recommendation' | 'custom';
  value: any;
  action: 'advance' | 'reject' | 'hold_for_review';
  priority: number;
}

export interface StageTemplate {
  name: string;
  description: string;
  stages: number;
  estimatedDays: number;
}

export interface StageTemplateDetail {
  name: string;
  stages: Partial<InterviewStage>[];
}

export interface StageAnalytics {
  totalInterviews: number;
  completedInterviews: number;
  scheduledInterviews: number;
  averageDuration: number;
  averageScore: number;
  passRate: number;
  commonConcerns: Array<{ type: string; count: number }>;
  topSkills: Array<{ skill: string; count: number; averageRelevance: number }>;
}

class InterviewStageService {
  /**
   * Get all stages for a job
   */
  async getStagesForJob(jobId: string): Promise<InterviewStage[]> {
    try {
      const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages`, {
        method: 'GET'
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.stages || [];
      }
    } catch (error: any) {
      // Silently handle 404 and network errors
      if (error.status !== 404) {
        console.warn('Interview stages API not available:', error.message);
      }
    }
    
    // Return empty array when API is not available
    return [];
  }

  /**
   * Get single stage by ID
   */
  async getStage(stageId: string): Promise<InterviewStage> {
    const response = await apiRequest(`/api/interview-stages/stages/${stageId}`, {
      method: 'GET'
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch stage');
    }
    
    return response.stage;
  }

  /**
   * Create default stages for a job
   */
  async createDefaultStages(jobId: string, template: string): Promise<InterviewStage[]> {
    try {
      const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages/default`, {
        method: 'POST',
        body: JSON.stringify({ template })
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.stages || [];
      }
    } catch (error: any) {
      // Silently handle 404 and network errors - this is expected for testing
      if (error.status !== 404) {
        console.warn('Interview stages API not available, using mock stages');
      }
    }
    
    // Fallback mock stages based on template
    const templateStages = this.getMockTemplateStages(template, jobId);
    return templateStages;
  }

  /**
   * Get mock template stages for testing
   */
  private getMockTemplateStages(template: string, jobId: string): InterviewStage[] {
    const now = new Date().toISOString();
    const baseId = Date.now();
    
    const stageTemplates: Record<string, Partial<InterviewStage>[]> = {
      standard: [
        { name: 'Phone Screen', type: 'phone_screen', order: 1, defaultDuration: 30, description: 'Initial screening call' },
        { name: 'Technical Interview', type: 'technical', order: 2, defaultDuration: 60, description: 'Technical skills assessment' },
        { name: 'Panel Interview', type: 'panel', order: 3, defaultDuration: 90, description: 'Team interview' },
        { name: 'Final Interview', type: 'hr', order: 4, defaultDuration: 45, description: 'Final HR discussion' }
      ],
      technical: [
        { name: 'Initial Screening', type: 'phone_screen', order: 1, defaultDuration: 30, description: 'Technical screening call' },
        { name: 'Coding Challenge', type: 'technical', order: 2, defaultDuration: 90, description: 'Live coding assessment' },
        { name: 'System Design', type: 'technical', order: 3, defaultDuration: 60, description: 'Architecture discussion' },
        { name: 'Team Interview', type: 'panel', order: 4, defaultDuration: 60, description: 'Meet the team' },
        { name: 'Executive Round', type: 'executive', order: 5, defaultDuration: 45, description: 'Leadership interview' }
      ],
      sales: [
        { name: 'Phone Screen', type: 'phone_screen', order: 1, defaultDuration: 30, description: 'Initial qualification' },
        { name: 'Sales Presentation', type: 'behavioral', order: 2, defaultDuration: 60, description: 'Sales skills demo' },
        { name: 'Final Interview', type: 'executive', order: 3, defaultDuration: 45, description: 'Leadership alignment' }
      ],
      executive: [
        { name: 'Executive Screening', type: 'phone_screen', order: 1, defaultDuration: 45, description: 'Initial leadership assessment' },
        { name: 'Strategic Interview', type: 'behavioral', order: 2, defaultDuration: 90, description: 'Strategic thinking evaluation' },
        { name: 'Panel Interview', type: 'panel', order: 3, defaultDuration: 120, description: 'Leadership team interview' },
        { name: 'Board Interview', type: 'executive', order: 4, defaultDuration: 60, description: 'Board member interview' },
        { name: 'Case Study', type: 'case_study', order: 5, defaultDuration: 90, description: 'Business case presentation' },
        { name: 'Final Round', type: 'executive', order: 6, defaultDuration: 45, description: 'CEO/final decision maker' }
      ]
    };

    const stages = stageTemplates[template] || stageTemplates.standard;
    
    return stages.map((stage, index) => ({
      _id: `mock-stage-${baseId + index}`,
      jobId,
      name: stage.name!,
      order: stage.order!,
      type: stage.type!,
      description: stage.description || '',
      isActive: true,
      defaultDuration: stage.defaultDuration!,
      requiredInterviewers: 1,
      interviewerRoles: [],
      evaluationCriteria: this.getDefaultEvaluationCriteria(stage.type!),
      aiQuestionGeneration: {
        enabled: true,
        questionTypes: ['behavioral', 'technical'],
        questionCount: 10,
        difficulty: 'medium',
        focusAreas: []
      },
      defaultQuestions: [],
      progressionRules: {
        autoProgress: false,
        requiredApprovals: 1,
        conditions: []
      },
      createdAt: now,
      updatedAt: now
    }));
  }

  /**
   * Create custom stage
   */
  async createCustomStage(jobId: string, stageData: Partial<InterviewStage>): Promise<InterviewStage> {
    try {
      const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages`, {
        method: 'POST',
        body: JSON.stringify(stageData)
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.stage;
      }
    } catch (error: any) {
      // Silently handle 404 and network errors - this is expected for testing
      if (error.status !== 404) {
        console.warn('Interview stages API not available, creating mock stage');
      }
    }
    
    // Fallback mock stage for testing
    const mockStage: InterviewStage = {
      _id: `mock-stage-${Date.now()}`,
      jobId,
      name: stageData.name || 'New Stage',
      order: 1,
      type: stageData.type || 'custom',
      description: stageData.description || '',
      isActive: stageData.isActive !== false,
      defaultDuration: stageData.defaultDuration || 60,
      requiredInterviewers: stageData.requiredInterviewers || 1,
      interviewerRoles: stageData.interviewerRoles || [],
      evaluationCriteria: stageData.evaluationCriteria || this.getDefaultEvaluationCriteria(stageData.type || 'custom'),
      aiQuestionGeneration: stageData.aiQuestionGeneration || {
        enabled: true,
        questionTypes: ['behavioral'],
        questionCount: 10,
        difficulty: 'medium',
        focusAreas: []
      },
      defaultQuestions: [],
      progressionRules: stageData.progressionRules || {
        autoProgress: false,
        requiredApprovals: 1,
        conditions: []
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    return mockStage;
  }

  /**
   * Update stage
   */
  async updateStage(stageId: string, updateData: Partial<InterviewStage>): Promise<InterviewStage> {
    const response = await apiRequest(`/api/interview-stages/stages/${stageId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Failed to update stage');
    }
    
    const data = await response.json();
    return data.stage;
  }

  /**
   * Delete stage
   */
  async deleteStage(stageId: string): Promise<boolean> {
    try {
      console.log(`🗑️ Deleting stage with ID: ${stageId}`);
      const response = await apiRequest(`/api/interview-stages/stages/${stageId}`, {
        method: 'DELETE'
      });
      
      // Check if response is ok
      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Delete stage API error:', errorData);
        throw new Error(errorData.error || errorData.message || 'Failed to delete stage');
      }
      
      // Try to parse the response
      try {
        const result = await response.json();
        console.log('✅ Delete stage API success:', result);
        return true;
      } catch (parseError) {
        // If we can't parse the response but it was ok, still return success
        console.log('⚠️ Could not parse delete response, but status was ok');
        return true;
      }
    } catch (error) {
      console.error('❌ Delete stage error:', error);
      throw error;
    }
  }

  /**
   * Reorder stages
   */
  async reorderStages(jobId: string, stageOrder: Array<{ stageId: string; newOrder: number }>): Promise<InterviewStage[]> {
    const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ stageOrder })
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to reorder stages');
    }
    
    return response.stages;
  }

  /**
   * Toggle stage active status
   */
  async toggleStageActive(stageId: string): Promise<InterviewStage> {
    const response = await apiRequest(`/api/interview-stages/stages/${stageId}/toggle-active`, {
      method: 'PATCH'
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to toggle stage status');
    }
    
    return response.stage;
  }

  /**
   * Get available templates
   */
  async getTemplates(): Promise<Record<string, StageTemplate>> {
    try {
      const response = await apiRequest(`/api/interview-stages/templates`, {
        method: 'GET'
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.templates || {};
      }
    } catch (error: any) {
      // Silently handle 404 and network errors - this is expected for testing
      if (error.status !== 404) {
        console.warn('Interview stages templates API not available, using fallback');
      }
    }
    
    // Fallback templates for testing
    return {
      standard: {
        name: 'Standard Pipeline',
        description: 'A balanced 4-stage process suitable for most positions',
        stages: 4,
        estimatedDays: 14
      },
      technical: {
        name: 'Technical Focus',
        description: 'Engineering-focused pipeline with multiple technical assessments',
        stages: 5,
        estimatedDays: 18
      },
      sales: {
        name: 'Sales Pipeline',
        description: 'Sales-oriented process emphasizing communication and results',
        stages: 3,
        estimatedDays: 10
      },
      executive: {
        name: 'Executive Search',
        description: 'Comprehensive process for senior leadership positions',
        stages: 6,
        estimatedDays: 28
      }
    };
  }

  /**
   * Get template details
   */
  async getTemplateDetails(templateName: string): Promise<StageTemplateDetail> {
    const response = await apiRequest(`/api/interview-stages/templates/${templateName}`, {
      method: 'GET'
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch template details');
    }
    
    return response.template;
  }

  /**
   * Clone stages from another job
   */
  async cloneStages(jobId: string, sourceJobId: string): Promise<InterviewStage[]> {
    const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages/clone`, {
      method: 'POST',
      body: JSON.stringify({ sourceJobId })
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to clone stages');
    }
    
    return response.stages;
  }

  /**
   * Bulk update stages
   */
  async bulkUpdateStages(jobId: string, stages: Array<{ stageId: string; [key: string]: any }>): Promise<InterviewStage[]> {
    const response = await apiRequest(`/api/interview-stages/jobs/${jobId}/stages/bulk`, {
      method: 'PUT',
      body: JSON.stringify({ stages })
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to bulk update stages');
    }
    
    return response.stages;
  }

  /**
   * Get stage analytics
   */
  async getStageAnalytics(stageId: string): Promise<StageAnalytics> {
    const response = await apiRequest(`/api/interview-stages/stages/${stageId}/analytics`, {
      method: 'GET'
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch stage analytics');
    }
    
    return response.analytics;
  }

  /**
   * Update stage feedback form configuration
   */
  async updateStageFeedbackConfig(
    stageId: string, 
    config: { 
      useTemplate?: boolean; 
      templateId?: string | null; 
      overrides?: any;
    }
  ): Promise<any> {
    try {
      const response = await apiRequest(`/api/interview-stages/stages/${stageId}/feedback-config`, {
        method: 'PUT',
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update stage feedback config');
      }
      
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error updating stage feedback config:', error);
      throw error;
    }
  }

  /**
   * Get stage feedback form configuration
   */
  async getStageFeedbackConfig(stageId: string): Promise<any> {
    try {
      const response = await apiRequest(`/api/interview-stages/stages/${stageId}/feedback-config`, {
        method: 'GET'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch stage feedback config');
      }
      
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching stage feedback config:', error);
      throw error;
    }
  }

  /**
   * Get stage type options
   */
  getStageTypeOptions() {
    return [
      { value: 'phone_screen', label: 'Phone Screen', description: 'Initial screening call' },
      { value: 'technical', label: 'Technical Interview', description: 'Technical skills assessment' },
      { value: 'behavioral', label: 'Behavioral Interview', description: 'Culture and behavior evaluation' },
      { value: 'panel', label: 'Panel Interview', description: 'Multiple interviewer session' },
      { value: 'hr', label: 'HR Interview', description: 'HR and policy discussion' },
      { value: 'executive', label: 'Executive Interview', description: 'Leadership team interview' },
      { value: 'case_study', label: 'Case Study', description: 'Problem-solving presentation' },
      { value: 'culture_fit', label: 'Culture Fit', description: 'Company culture alignment' },
      { value: 'custom', label: 'Custom', description: 'Custom interview type' }
    ];
  }

  /**
   * Get evaluation criteria type options
   */
  getEvaluationCriteriaTypes() {
    return [
      { value: 'technical', label: 'Technical', description: 'Technical skills and knowledge' },
      { value: 'behavioral', label: 'Behavioral', description: 'Behavior and soft skills' },
      { value: 'cultural', label: 'Cultural', description: 'Cultural fit and values' },
      { value: 'communication', label: 'Communication', description: 'Communication abilities' },
      { value: 'leadership', label: 'Leadership', description: 'Leadership and management skills' }
    ];
  }

  /**
   * Get AI question types
   */
  getAIQuestionTypes() {
    return [
      { value: 'technical', label: 'Technical' },
      { value: 'behavioral', label: 'Behavioral' },
      { value: 'situational', label: 'Situational' },
      { value: 'cultural_fit', label: 'Cultural Fit' },
      { value: 'skills_based', label: 'Skills Based' },
      { value: 'experience_based', label: 'Experience Based' }
    ];
  }

  /**
   * Get progression condition types
   */
  getProgressionConditionTypes() {
    return [
      { value: 'score_threshold', label: 'Score Threshold', description: 'Advance if score meets minimum' },
      { value: 'unanimous_approval', label: 'Unanimous Approval', description: 'All interviewers must approve' },
      { value: 'manager_approval', label: 'Manager Approval', description: 'Hiring manager must approve' },
      { value: 'ai_recommendation', label: 'AI Recommendation', description: 'AI suggests advancement' },
      { value: 'custom', label: 'Custom Rule', description: 'Custom progression logic' }
    ];
  }

  /**
   * Get interviewer role options
   */
  getInterviewerRoleOptions() {
    return [
      { value: 'hiring_manager', label: 'Hiring Manager' },
      { value: 'recruiter', label: 'Recruiter' },
      { value: 'technical_lead', label: 'Technical Lead' },
      { value: 'hr', label: 'HR Representative' },
      { value: 'executive', label: 'Executive' },
      { value: 'peer', label: 'Peer/Team Member' }
    ];
  }

  /**
   * Validate stage data
   */
  validateStage(stage: Partial<InterviewStage>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!stage.name?.trim()) {
      errors.push('Stage name is required');
    }

    if (!stage.type) {
      errors.push('Stage type is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create default evaluation criteria for stage type
   */
  getDefaultEvaluationCriteria(stageType: string): EvaluationCriterion[] {
    const defaultCriteria: Record<string, EvaluationCriterion[]> = {
      phone_screen: [
        { name: 'Communication Skills', type: 'communication', weight: 30, description: 'Clarity and effectiveness of communication' },
        { name: 'Basic Qualifications', type: 'technical', weight: 40, description: 'Meets minimum job requirements' },
        { name: 'Interest & Motivation', type: 'behavioral', weight: 30, description: 'Enthusiasm for the role and company' }
      ],
      technical: [
        { name: 'Technical Skills', type: 'technical', weight: 50, description: 'Relevant technical expertise' },
        { name: 'Problem Solving', type: 'technical', weight: 30, description: 'Approach to technical challenges' },
        { name: 'Code Quality', type: 'technical', weight: 20, description: 'Writing clean, maintainable code' }
      ],
      behavioral: [
        { name: 'Cultural Fit', type: 'cultural', weight: 35, description: 'Alignment with company values' },
        { name: 'Problem Solving', type: 'behavioral', weight: 35, description: 'Analytical thinking and decision making' },
        { name: 'Team Collaboration', type: 'behavioral', weight: 30, description: 'Working effectively with others' }
      ],
      panel: [
        { name: 'Overall Competency', type: 'technical', weight: 40, description: 'Job-related skills and knowledge' },
        { name: 'Communication', type: 'communication', weight: 30, description: 'Clear and effective communication' },
        { name: 'Cultural Fit', type: 'cultural', weight: 30, description: 'Team and company alignment' }
      ],
      executive: [
        { name: 'Leadership Experience', type: 'leadership', weight: 40, description: 'Track record of leadership success' },
        { name: 'Strategic Thinking', type: 'leadership', weight: 30, description: 'Vision and strategic planning abilities' },
        { name: 'Cultural Impact', type: 'cultural', weight: 30, description: 'Ability to drive cultural change' }
      ]
    };

    return defaultCriteria[stageType] || [
      { name: 'Overall Assessment', type: 'behavioral', weight: 100, description: 'General evaluation of candidate fit' }
    ];
  }
}

export default new InterviewStageService(); 