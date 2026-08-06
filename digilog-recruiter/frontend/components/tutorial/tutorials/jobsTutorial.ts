import { TutorialConfig } from "@/context/TutorialContext"

export const jobsListTutorial: TutorialConfig = {
  id: "jobs-list-tutorial",
  title: "Jobs Management Tutorial", 
  description: "Learn how to create, manage, and optimize your job postings",
  autoStart: false,
  showProgress: true,
  steps: [
    {
      id: "welcome",
      title: "Welcome to Job Management",
      content: "This is your jobs dashboard where you can create, manage, and track all your job postings. Let's explore the key features!",
      placement: "center",
    },
    {
      id: "job-overview",
      title: "Job Listings Overview",
      content: "Here you can see all your job postings with key information like status, applications received, and posting date. Each job card provides a quick overview of the role.",
      targetSelector: "[data-tutorial='jobs-grid'], [data-tutorial='jobs-table']",
      placement: "top",
      delay: 300,
    },
    {
      id: "create-job",
      title: "Create New Job",
      content: "Click this button to create a new job posting. You can add job details, requirements, and let our AI help optimize the job description.",
      targetSelector: "[data-tutorial='create-job-btn']",
      placement: "bottom",
    },
    {
      id: "search-filter",
      title: "Search & Filter Jobs",
      content: "Use the search bar to quickly find specific jobs by title, department, or keywords. Filter options help you organize jobs by status, department, or location.",
      targetSelector: "[data-tutorial='search-filter-section']",
      placement: "bottom",
    },
    {
      id: "job-status",
      title: "Job Status Management",
      content: "Each job has a status indicator. You can toggle jobs between active and inactive, and see how many applications each job has received.",
      targetSelector: "[data-tutorial='applications-count']",
      placement: "left",
    },
    {
      id: "job-actions",
      title: "Job Actions",
      content: "Click the three dots menu on any job to access actions like viewing details, editing the job, sharing the job link, or archiving the position.",
      targetSelector: "[data-tutorial='job-actions']",
      placement: "left",
      delay: 500,
    },
    {
      id: "applications-count",
      title: "Application Tracking",
      content: "Keep track of how many candidates have applied to each job. Click on the applications count to see candidate pipeline details.",
      targetSelector: "[data-tutorial='applications-count']",
      placement: "top",
    },
    {
      id: "completion",
      title: "You're Ready to Manage Jobs!",
      content: "Great! You now know how to manage your job postings effectively. Click on any job title to access the detailed job management view with candidate pipeline.",
      placement: "center",
    }
  ]
}

export const jobDetailTutorial: TutorialConfig = {
  id: "job-detail-tutorial",
  title: "Job Detail Management Tutorial",
  description: "Master the job detail page and candidate pipeline management",
  autoStart: false,
  showProgress: true,
  steps: [
    {
      id: "job-overview",
      title: "Job Detail Overview",
      content: "This is the detailed job management page where you can view job information, manage candidates in the pipeline, and track hiring progress.",
      placement: "center",
    },
    {
      id: "job-header",
      title: "Job Information",
      content: "Here you can see key job details including title, department, salary range, and job status. Use the action buttons to edit job details or share the job posting.",
      targetSelector: "[data-tutorial='job-header']",
      placement: "bottom",
      action: () => { try { (window as any).navigateToOverview?.() } catch {} },
    },
    {
      id: "pipeline-tabs",
      title: "Candidate Pipeline",
      content: "Navigate through different stages of your hiring pipeline. Each tab represents a stage in your hiring process from initial applications to final offers.",
      targetSelector: "[data-tutorial='pipeline-tabs']",
      placement: "bottom",
      action: () => { try { (window as any).navigateToHiringPipelineBoard?.() } catch {} },
    },
    {
      id: "candidate-matching",
      title: "AI Candidate Matching",
      content: "Our AI analyzes candidate profiles and matches them with your job requirements. View match scores and AI recommendations to find the best candidates.",
      targetSelector: "[data-tutorial='ai-matches']",
      placement: "right",
      action: () => { try { (window as any).navigateToCandidatesAiMatches?.() } catch {} },
    },
    {
      id: "shortlist-management",
      title: "Shortlist Management",
      content: "Review candidates you've shortlisted for this position. Move candidates between pipeline stages and schedule interviews directly from here.",
      targetSelector: "[data-tutorial='shortlist-section']",
      placement: "left",
      action: () => { try { (window as any).navigateToCandidatesShortlist?.() } catch {} },
    },
    {
      id: "interview-scheduling",
      title: "Interview Management",
      content: "Track scheduled interviews for this job. View upcoming interviews, past interview feedback, and schedule new interviews with candidates.",
      targetSelector: "[data-tutorial='interviews-pipeline']",
      placement: "bottom",
      action: () => { try { (window as any).navigateToInterviewsOverview?.() } catch {} },
    },
    {
      id: "job-analytics",
      title: "Job Performance Analytics",
      content: "Monitor job performance metrics including application rates, source effectiveness, and time-to-hire statistics to optimize your recruitment strategy.",
      targetSelector: "[data-tutorial='job-analytics']",
      placement: "top",
      action: () => { try { (window as any).navigateToInsightsAnalytics?.() } catch {} },
    },
    {
      id: "candidate-actions",
      title: "Candidate Pipeline Actions",
      content: "For each candidate, you can view detailed profiles, schedule interviews, add notes, or move them to different pipeline stages using bulk actions.",
      targetSelector: "[data-tutorial='candidate-pipeline-actions']",
      placement: "left",
    },
    {
      id: "job-settings",
      title: "Job Configuration",
      content: "Access job settings to modify posting details, update job requirements, configure pipeline stages, or close the job posting when filled.",
      targetSelector: "[data-tutorial='job-settings']",
      placement: "right",
      action: () => { try { (window as any).navigateToHiringPipelineConfiguration?.() } catch {} },
    },
    {
      id: "completion",
      title: "Job Management Mastery!",
      content: "Excellent! You're now equipped to effectively manage job postings and candidate pipelines. Use the insights and tools to make data-driven hiring decisions.",
      placement: "center",
    }
  ]
}
