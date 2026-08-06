// backend/services/guideTemplateService.js
// Service for generating tutorial-based guide responses instead of executing actions

class GuideTemplateService {
  
  /**
   * Generate guide for job creation
   */
  generateJobCreationGuide(context = {}) {
    const jobTitle = context.jobTitle || context.title || 'your position';
    
    return {
      type: 'guide',
      intent: 'create_job',
      title: '📋 Creating a Job Posting',
      introduction: `I'll guide you through creating a job posting${jobTitle !== 'your position' ? ` for **${jobTitle}**` : ''}. Here's how to do it step by step:`,
      steps: [
        {
          number: 1,
          title: 'Navigate to Job Creation',
          description: 'Click the "Jobs" menu in the navigation bar, then click "Create Job" or use the quick action button from your dashboard.',
          tip: 'You can also access this from the "+ New" button if available'
        },
        {
          number: 2,
          title: 'Fill in Basic Job Details',
          description: 'Enter the job title, department, location, employment type (Full-time/Part-time/Contract), and work arrangement (Remote/Hybrid/On-site).',
          tip: 'Use descriptive titles like "Senior Backend Developer" instead of just "Developer" for better candidate matching'
        },
        {
          number: 3,
          title: 'Add Job Description',
          description: 'Write or use the AI generator to create the job description. Include key responsibilities, requirements, and what makes your company special.',
          tip: 'The AI generator can create comprehensive descriptions in seconds - just click "Generate with AI"!'
        },
        {
          number: 4,
          title: 'Configure Interview Stages (Optional)',
          description: 'Set up your hiring process stages like Phone Screen → Technical Interview → Team Fit → Final Round.',
          tip: 'You can always add or modify stages later from the job detail page'
        },
        {
          number: 5,
          title: 'Publish Your Job',
          description: 'Review all details and click "Create Job" to publish. You can then share the job link or start adding candidates.',
          tip: 'Jobs are saved as drafts automatically - no need to worry about losing progress'
        }
      ],
      navigationCard: {
        title: '📝 Create Job Posting',
        description: `Set up your ${jobTitle} position in just a few steps`,
        primaryButton: {
          label: 'Go to Job Creation',
          url: '/jobs/new',
          icon: 'Plus'
        },
        secondaryButton: {
          label: 'View All Jobs',
          url: '/jobs',
          icon: 'Briefcase'
        }
      },
      tips: [
        'Use the AI job description generator for faster setup and professional content',
        'Set a competitive salary range to attract quality candidates',
        'Configure interview stages during creation for a smoother hiring workflow',
        'Add detailed requirements to get better AI candidate matching'
      ],
      relatedFeatures: [
        {
          name: 'Bulk Upload CVs',
          url: '/bulk-upload',
          description: 'Upload multiple candidate resumes at once'
        },
        {
          name: 'View All Jobs',
          url: '/jobs',
          description: 'See all your job postings and their status'
        }
      ]
    };
  }

  /**
   * Generate guide for candidate search
   */
  generateCandidateSearchGuide(context = {}) {
    const searchCriteria = context.query || context.skills || 'candidates';
    
    return {
      type: 'guide',
      intent: 'search_candidates',
      title: '🔍 Finding Candidates',
      introduction: `I'll show you how to find ${searchCriteria}. Here's your step-by-step guide:`,
      steps: [
        {
          number: 1,
          title: 'Navigate to Candidates Page',
          description: 'Click on "Candidates" in the main navigation menu to access the candidates database.',
          tip: 'This shows all candidates in your organization'
        },
        {
          number: 2,
          title: 'Use Search and Filters',
          description: 'Use the search bar to find candidates by name, or use filters to narrow down by skills, location, experience level, or other criteria.',
          tip: 'You can combine multiple filters for precise results'
        },
        {
          number: 3,
          title: 'Review Candidate Profiles',
          description: 'Click on any candidate card to view their full profile, including experience, skills, education, and AI analysis scores.',
          tip: 'Check the AI analysis tab for insights on candidate strengths and fit'
        },
        {
          number: 4,
          title: 'Take Action',
          description: 'Add promising candidates to job shortlists, schedule interviews, or export candidate data for review.',
          tip: 'Use the shortlist feature to compare multiple candidates side-by-side'
        }
      ],
      navigationCard: {
        title: '👥 Search Candidates',
        description: `Find ${searchCriteria} in your talent pool`,
        primaryButton: {
          label: 'Go to Candidates Page',
          url: '/candidates',
          icon: 'Users'
        },
        secondaryButton: {
          label: 'Upload New Candidates',
          url: '/bulk-upload',
          icon: 'Upload'
        }
      },
      tips: [
        'Use specific keywords for better search results (e.g., "React", "Senior", "Remote")',
        'Filter by location to find candidates in your area or open to remote work',
        'Check the AI analysis for automated skill verification and insights',
        'Save frequent searches as custom filters for quick access'
      ],
      relatedFeatures: [
        {
          name: 'AI Candidate Matching',
          url: '/jobs',
          description: 'Match candidates to specific jobs using AI'
        },
        {
          name: 'Bulk Candidate Upload',
          url: '/bulk-upload',
          description: 'Import multiple candidates from CSV/Excel'
        }
      ]
    };
  }

  /**
   * Generate guide for listing all candidates
   */
  generateViewCandidatesGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'view_candidates',
      title: '👥 Viewing All Candidates',
      introduction: 'Here\'s how to view and manage your candidate database:',
      steps: [
        {
          number: 1,
          title: 'Access Candidates Page',
          description: 'Click "Candidates" in the main navigation to see your complete talent pool.',
          tip: 'The candidates page shows all candidates across all jobs'
        },
        {
          number: 2,
          title: 'Browse Candidate Table',
          description: 'View candidates in a organized table with key information: name, email, phone, skills, and status.',
          tip: 'Click column headers to sort by different criteria'
        },
        {
          number: 3,
          title: 'Use Quick Actions',
          description: 'Each candidate has quick action buttons to view profile, schedule interview, or add to shortlist.',
          tip: 'Hover over a row to see all available actions'
        }
      ],
      navigationCard: {
        title: '👥 View All Candidates',
        description: 'Access your complete candidate database',
        primaryButton: {
          label: 'Go to Candidates Page',
          url: '/candidates',
          icon: 'Users'
        }
      },
      tips: [
        'Use filters to narrow down candidates by specific criteria',
        'Export candidate data for external review or reports',
        'Add tags to candidates for easy organization'
      ]
    };
  }

  /**
   * Generate guide for interview scheduling
   */
  generateInterviewScheduleGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'schedule_interview',
      title: '📅 Scheduling an Interview',
      introduction: 'I\'ll walk you through setting up an interview. Here\'s the process:',
      steps: [
        {
          number: 1,
          title: 'Choose Your Starting Point',
          description: 'You can schedule interviews from: (1) Hiring Pipeline board, (2) Interviews tab in job details, or (3) Calendar page.',
          tip: 'Hiring Pipeline is the easiest - just click on a candidate card'
        },
        {
          number: 2,
          title: 'Select Interview Type',
          description: 'Choose between single interview (one candidate) or multi-candidate session (multiple candidates back-to-back).',
          tip: 'Multi-candidate sessions are great for initial screening rounds'
        },
        {
          number: 3,
          title: 'Pick Date and Time',
          description: 'Select the interview date and time. The system checks interviewer availability if calendar is connected.',
          tip: 'Connect your Google or Microsoft calendar for automatic conflict detection'
        },
        {
          number: 4,
          title: 'Add Interview Details',
          description: 'Set interview duration, type (video/phone/in-person), location/meeting link, and any special notes.',
          tip: 'Enable AI Notetaker for automatic transcription and interview insights'
        },
        {
          number: 5,
          title: 'Invite Participants',
          description: 'Add other interviewers, set up email notifications, and optionally send interview questions to participants.',
          tip: 'You can send interview questions to interviewers automatically before the meeting'
        },
        {
          number: 6,
          title: 'Review and Send',
          description: 'Review all details and send calendar invites. Candidates and interviewers will receive email notifications.',
          tip: 'You can customize email templates in the communication step'
        }
      ],
      navigationCard: {
        title: '📅 Schedule Interview',
        description: 'Set up interviews with calendar integration and AI notetaker',
        primaryButton: {
          label: 'Go to Calendar',
          url: '/calendar',
          icon: 'Calendar'
        },
        secondaryButton: {
          label: 'View Hiring Pipeline',
          url: '/jobs',
          icon: 'Workflow'
        }
      },
      tips: [
        'Use AI Notetaker for automatic meeting transcription and analysis',
        'Multi-candidate sessions save time for screening rounds',
        'Connect your calendar to avoid double-booking',
        'Set up interview question banks for consistent evaluation'
      ],
      relatedFeatures: [
        {
          name: 'Interview Stages',
          url: '/jobs',
          description: 'Configure your interview process stages'
        },
        {
          name: 'Interview Questions',
          url: '/jobs',
          description: 'Create and manage interview question banks'
        }
      ]
    };
  }

  /**
   * Generate guide for viewing jobs
   */
  generateViewJobsGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'view_jobs',
      title: '💼 Viewing Your Jobs',
      introduction: 'Here\'s how to view and manage your job postings:',
      steps: [
        {
          number: 1,
          title: 'Navigate to Jobs Page',
          description: 'Click "Jobs" in the main navigation menu to see all your active job postings.',
          tip: 'You\'ll see jobs organized in a table or card view'
        },
        {
          number: 2,
          title: 'Browse Job Listings',
          description: 'View all jobs with key information: title, department, location, number of applicants, and status.',
          tip: 'Click on any job to see full details and manage candidates'
        },
        {
          number: 3,
          title: 'Use Job Filters',
          description: 'Filter jobs by status (Active/Closed), department, location, or search by title.',
          tip: 'Save common filter combinations for quick access'
        },
        {
          number: 4,
          title: 'Access Job Details',
          description: 'Click on a job to access: Overview, Candidates, Hiring Pipeline, Interviews, Analytics, and Questions.',
          tip: 'The Hiring Pipeline tab gives you the best visual overview of candidates'
        }
      ],
      navigationCard: {
        title: '💼 View All Jobs',
        description: 'See and manage all your job postings',
        primaryButton: {
          label: 'Go to Jobs Page',
          url: '/jobs',
          icon: 'Briefcase'
        },
        secondaryButton: {
          label: 'Create New Job',
          url: '/jobs/new',
          icon: 'Plus'
        }
      },
      tips: [
        'Use the Analytics tab in each job to track performance',
        'Check the Hiring Pipeline to see candidate progress',
        'Configure interview stages early for smoother workflow'
      ]
    };
  }

  /**
   * Generate guide for hiring pipeline navigation
   */
  generatePipelineGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'navigate_pipeline',
      title: '🎯 Using the Hiring Pipeline',
      introduction: 'The Hiring Pipeline is your visual board for managing candidates through interview stages. Here\'s how to use it:',
      steps: [
        {
          number: 1,
          title: 'Access the Pipeline',
          description: 'Go to a job posting and click the "Hiring Pipeline" tab to see your pipeline board.',
          tip: 'The board shows candidates organized by interview stage'
        },
        {
          number: 2,
          title: 'View Pipeline Board',
          description: 'See candidates as cards organized in columns by stage. Each card shows candidate info and status.',
          tip: 'Click the "Board" sub-tab to see the visual board'
        },
        {
          number: 3,
          title: 'Move Candidates Between Stages',
          description: 'Drag and drop candidate cards between stage columns to move them through your hiring process.',
          tip: 'The system automatically tracks stage history and timestamps'
        },
        {
          number: 4,
          title: 'Configure Stages',
          description: 'Click the "Configuration" sub-tab to add, edit, or reorder your interview stages.',
          tip: 'Standard stages: Phone Screen → Technical Interview → Team Fit → Final Round'
        },
        {
          number: 5,
          title: 'Take Actions on Candidates',
          description: 'Click any candidate card to schedule interviews, view details, or move them to different stages.',
          tip: 'You can schedule interviews directly from the pipeline board'
        }
      ],
      navigationCard: {
        title: '🎯 Hiring Pipeline Board',
        description: 'Visual board to manage candidates through interview stages',
        primaryButton: {
          label: 'Go to Jobs',
          url: '/jobs',
          icon: 'Workflow'
        },
        secondaryButton: {
          label: 'Learn More',
          url: '/jobs',
          icon: 'HelpCircle'
        }
      },
      tips: [
        'Drag and drop candidates between stages to track progress',
        'Each stage shows metrics like average time and success rate',
        'Use filters to find specific candidates in the pipeline',
        'Configure stages before adding candidates for best organization'
      ],
      relatedFeatures: [
        {
          name: 'Pipeline Analytics',
          url: '/jobs',
          description: 'See conversion rates and pipeline health metrics'
        },
        {
          name: 'Interview Stages',
          url: '/jobs',
          description: 'Configure your custom hiring workflow'
        }
      ]
    };
  }

  /**
   * Generate guide for adding candidates
   */
  generateAddCandidateGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'add_candidate',
      title: '➕ Adding Candidates',
      introduction: 'You have multiple ways to add candidates to your system. Here\'s how:',
      steps: [
        {
          number: 1,
          title: 'Choose Your Upload Method',
          description: 'Decide between single candidate upload (detailed profiles) or bulk upload (multiple candidates at once).',
          tip: 'Use bulk upload for importing from other systems or spreadsheets'
        },
        {
          number: 2,
          title: 'Single Candidate Upload',
          description: 'For detailed profiles: Go to Candidates → Add Candidate → Fill in all details → Upload resume (optional) → Save.',
          tip: 'You can add custom fields and tags for better organization'
        },
        {
          number: 3,
          title: 'Bulk Candidate Upload',
          description: 'For multiple candidates: Go to Candidates → Bulk Upload → Download template → Fill template → Upload CSV/Excel.',
          tip: 'The template shows exactly which fields are required'
        },
        {
          number: 4,
          title: 'Review and Confirm',
          description: 'Preview the candidate information before finalizing. Make any necessary edits.',
          tip: 'AI will analyze resumes automatically if you upload them'
        }
      ],
      navigationCard: {
        title: '➕ Add Candidates',
        description: 'Upload candidates to your talent pool',
        primaryButton: {
          label: 'Single Candidate Upload',
          url: '/candidates/new',
          icon: 'UserPlus'
        },
        secondaryButton: {
          label: 'Bulk Upload',
          url: '/bulk-upload',
          icon: 'Upload'
        }
      },
      tips: [
        'Upload resumes for automatic skill extraction and AI analysis',
        'Use bulk upload to save time when adding many candidates',
        'Add tags and notes for easy searching later',
        'The AI will automatically analyze resumes and extract key information'
      ],
      relatedFeatures: [
        {
          name: 'AI Candidate Analysis',
          url: '/candidates',
          description: 'Get AI-powered insights on candidate profiles'
        },
        {
          name: 'Candidate Matching',
          url: '/jobs',
          description: 'Automatically match candidates to open positions'
        }
      ]
    };
  }

  /**
   * Generate guide for AI matching
   */
  generateAIMatchingGuide(context = {}) {
    const jobTitle = context.jobTitle || 'your position';
    
    return {
      type: 'guide',
      intent: 'ai_matching',
      title: '🤖 AI Candidate Matching',
      introduction: `I'll show you how to use AI to find the best candidates${jobTitle !== 'your position' ? ` for ${jobTitle}` : ''}:`,
      steps: [
        {
          number: 1,
          title: 'Go to Job Details',
          description: 'Navigate to the specific job you want to find candidates for.',
          tip: 'Click on the job from your Jobs list'
        },
        {
          number: 2,
          title: 'Access Candidates Tab',
          description: 'Click the "Candidates" tab in the job details page.',
          tip: 'This tab has two sections: AI Matches and Shortlist'
        },
        {
          number: 3,
          title: 'View AI Matches',
          description: 'The AI Matches section shows candidates ranked by fit score, with explanations for each match.',
          tip: 'Match scores are based on skills, experience, and job requirements'
        },
        {
          number: 4,
          title: 'Review Match Details',
          description: 'Click on any matched candidate to see detailed reasoning, matching skills, and compatibility analysis.',
          tip: 'The AI explains why each candidate is a good or poor fit'
        },
        {
          number: 5,
          title: 'Add to Pipeline',
          description: 'Add promising candidates to your hiring pipeline with one click.',
          tip: 'You can add to shortlist first for comparison before moving to pipeline'
        }
      ],
      navigationCard: {
        title: '🤖 AI Candidate Matching',
        description: 'Find the perfect candidates using AI',
        primaryButton: {
          label: 'Go to Jobs',
          url: '/jobs',
          icon: 'Briefcase'
        },
        secondaryButton: {
          label: 'View Candidates',
          url: '/candidates',
          icon: 'Users'
        }
      },
      tips: [
        'AI matching considers skills, experience, education, and cultural fit',
        'Match scores are percentages - 80%+ are strong matches',
        'Review the AI reasoning to understand why candidates match',
        'You can refresh matches after updating job requirements'
      ],
      relatedFeatures: [
        {
          name: 'Job Requirements',
          url: '/jobs',
          description: 'Update job requirements for better matching'
        },
        {
          name: 'Candidate Search',
          url: '/candidates',
          description: 'Manual search and filtering options'
        }
      ]
    };
  }

  /**
   * Generate general help/welcome guide
   */
  generateWelcomeGuide(context = {}) {
    return {
      type: 'guide',
      intent: 'general_help',
      title: '👋 Welcome to SmartHR Assistant!',
      introduction: 'I\'m your guide to navigating and using the SmartHR platform. I don\'t perform actions for you - instead, I show you how to do things yourself!',
      steps: [
        {
          number: 1,
          title: 'Ask Me for Help',
          description: 'Simply ask me how to do something, like "How do I create a job?" or "How do I find candidates?"',
          tip: 'I understand natural language - just ask like you\'re talking to a colleague'
        },
        {
          number: 2,
          title: 'Follow the Guides',
          description: 'I\'ll provide step-by-step instructions, helpful tips, and direct links to the right pages.',
          tip: 'Each guide includes navigation cards with "Go to Page" buttons'
        },
        {
          number: 3,
          title: 'Learn Features',
          description: 'Ask about specific features to learn how they work and when to use them.',
          tip: 'Examples: "How does AI matching work?" or "What is the hiring pipeline?"'
        }
      ],
      navigationCard: {
        title: '🚀 Quick Start',
        description: 'Get started with SmartHR in minutes',
        primaryButton: {
          label: 'Start Tutorial',
          url: '/assistant',
          icon: 'GraduationCap'
        },
        secondaryButton: {
          label: 'Go to Dashboard',
          url: '/',
          icon: 'Home'
        }
      },
      tips: [
        'Ask me "How do I..." questions for any feature',
        'I can explain features, show you where to find things, and provide best practices',
        'Try: "How do I create a job?", "How do I add candidates?", or "How do I schedule interviews?"'
      ],
      commonTopics: [
        {
          title: 'Job Management',
          examples: [
            'How do I create a job?',
            'How do I view my jobs?',
            'How do I edit a job posting?'
          ]
        },
        {
          title: 'Candidate Management',
          examples: [
            'How do I add candidates?',
            'How do I search for candidates?',
            'How does AI matching work?'
          ]
        },
        {
          title: 'Interviews',
          examples: [
            'How do I schedule an interview?',
            'What is AI Notetaker?',
            'How do I set up interview stages?'
          ]
        },
        {
          title: 'Hiring Pipeline',
          examples: [
            'How do I use the hiring pipeline?',
            'How do I move candidates between stages?',
            'How do I configure stages?'
          ]
        }
      ]
    };
  }

  /**
   * Get guide based on intent
   */
  getGuideForIntent(intent, context = {}) {
    console.log(`📚 Generating guide for intent: ${intent}`);
    
    switch (intent) {
      case 'create_job':
        return this.generateJobCreationGuide(context);
      
      case 'list_jobs':
      case 'view_jobs':
      case 'get_all_jobs':
        return this.generateViewJobsGuide(context);
      
      case 'search_candidates':
      case 'find_candidates':
        return this.generateCandidateSearchGuide(context);
      
      case 'get_all_candidates':
      case 'view_candidates':
      case 'list_candidates':
        return this.generateViewCandidatesGuide(context);
      
      case 'create_candidate':
      case 'add_candidate':
      case 'upload_candidate':
        return this.generateAddCandidateGuide(context);
      
      case 'schedule_interview':
      case 'setup_interview':
        return this.generateInterviewScheduleGuide(context);
      
      case 'find_candidates_for_job':
      case 'ai_matching':
      case 'match_candidates':
        return this.generateAIMatchingGuide(context);
      
      case 'navigate_pipeline':
      case 'hiring_pipeline':
      case 'pipeline_board':
        return this.generatePipelineGuide(context);
      
      case 'general_help':
      case 'help':
      case 'welcome':
      default:
        return this.generateWelcomeGuide(context);
    }
  }
}

module.exports = GuideTemplateService;

