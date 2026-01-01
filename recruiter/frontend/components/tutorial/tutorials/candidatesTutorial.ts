import { TutorialConfig } from "@/context/TutorialContext"

export const candidatesListTutorial: TutorialConfig = {
  id: "candidates-list-tutorial",
  title: "Candidates Management Tutorial",
  description: "Learn how to manage and work with candidates effectively",
  autoStart: false, // Don't auto-start, let users trigger manually
  showProgress: true,
  steps: [
    {
      id: "welcome",
      title: "Welcome to Candidates",
      content: "This is your candidates dashboard where you can view, search, and manage all your candidates. Let's walk through the key features!",
      placement: "center",
    },
    {
      id: "search-functionality",
      title: "Search Candidates",
      content: "Use this search box to quickly find candidates by name, email, skills, or any other information. The search is real-time and will filter results as you type.",
      targetSelector: "[data-tutorial='search-input']",
      placement: "bottom",
    },
    {
      id: "filter-options",
      title: "Filter Your Results",
      content: "Use these filters to narrow down your candidate list by various criteria like source, rating, or other attributes.",
      targetSelector: "[data-tutorial='filter-section']",
      placement: "bottom",
    },
    {
      id: "candidate-list",
      title: "Candidate Overview",
      content: "Each row shows key candidate information including name, contact details, rating, and source. You can sort by any column by clicking the headers.",
      targetSelector: "[data-tutorial='candidates-table']",
      placement: "top",
    },
    {
      id: "candidate-actions",
      title: "Candidate Actions",
      content: "Click the three dots menu to access actions for each candidate like viewing details, editing, or adding to shortlists.",
      targetSelector: "[data-tutorial='candidate-actions']",
      placement: "left",
      delay: 500,
    },
    {
      id: "add-candidate",
      title: "Add New Candidates",
      content: "Click this button to add new candidates manually or upload their resumes for automatic parsing.",
      targetSelector: "[data-tutorial='add-candidate-btn']",
      placement: "bottom",
    },
    {
      id: "bulk-actions",
      title: "Bulk Operations",
      content: "Select multiple candidates using checkboxes to perform bulk operations like adding to shortlists or exporting data.",
      targetSelector: "[data-tutorial='select-all-checkbox']",
      placement: "bottom",
    },
    {
      id: "pagination",
      title: "Navigate Pages",
      content: "Use these controls to navigate through your candidates list. You can also change how many candidates are shown per page.",
      targetSelector: "[data-tutorial='pagination']",
      placement: "top",
    },
    {
      id: "next-steps",
      title: "Next Steps",
      content: "Great! You now know how to navigate the candidates list. Click on any candidate name to view their detailed profile and access advanced features.",
      placement: "center",
    }
  ]
}

export const candidateDetailTutorial: TutorialConfig = {
  id: "candidate-detail-tutorial", 
  title: "Candidate Profile Tutorial",
  description: "Learn how to work with individual candidate profiles",
  autoStart: false,
  showProgress: true,
  steps: [
    {
      id: "candidate-overview",
      title: "Candidate Profile Overview",
      content: "This is the detailed candidate profile page where you can view all information about a candidate including their resume, contact details, and interview history.",
      placement: "center",
    },
    {
      id: "candidate-header",
      title: "Candidate Information",
      content: "Here you can see the candidate's basic information, contact details, and overall rating. You can edit this information by clicking the edit button.",
      targetSelector: "[data-tutorial='candidate-header']",
      placement: "bottom",
    },
    {
      id: "tabs-navigation",
      title: "Profile Sections",
      content: "Use these tabs to navigate between different sections of the candidate's profile including overview, resume, interviews, and notes.",
      targetSelector: "[data-tutorial='profile-tabs']",
      placement: "bottom",
    },
    {
      id: "resume-section",
      title: "Resume & Documents",
      content: "View and download the candidate's resume and other uploaded documents. You can also preview PDFs directly in the browser.",
      targetSelector: "[data-tutorial='resume-section']",
      placement: "bottom",
      action: () => {
        // Switch to resume tab if it exists
        const resumeTab = document.querySelector('[data-value="resume"]') as HTMLElement
        if (resumeTab) resumeTab.click()
      }
    },
    {
      id: "interview-history",
      title: "Interview Management",
      content: "Track all interviews conducted with this candidate, view feedback, and schedule new interviews from this section.",
      targetSelector: "[data-tutorial='interviews-section']",
      placement: "top",
      action: () => {
        // Switch to interviews tab if it exists
        const interviewTab = document.querySelector('[data-value="interviews"]') as HTMLElement
        if (interviewTab) interviewTab.click()
      }
    },
    {
      id: "candidate-actions",
      title: "Candidate Actions",
      content: "Use these action buttons to perform common tasks like scheduling interviews, adding to job shortlists, or sharing the candidate profile.",
      targetSelector: "[data-tutorial='candidate-actions']",
      placement: "bottom",
    },
    {
      id: "ai-insights",
      title: "AI-Powered Insights", 
      content: "Our AI analyzes the candidate's resume and provides insights, skill matching, and recommendations to help you make better hiring decisions.",
      targetSelector: "[data-tutorial='ai-insights']",
      placement: "left",
    },
    {
      id: "notes-feedback",
      title: "Notes & Feedback",
      content: "Add internal notes and feedback about the candidate that will be visible to your team members but not to the candidate.",
      targetSelector: "[data-tutorial='notes-section']",
      placement: "right",
    },
    {
      id: "completion",
      title: "Profile Management Complete!",
      content: "You're now ready to effectively manage candidate profiles. Remember to keep notes updated and use the AI insights to make informed decisions.",
      placement: "center",
    }
  ]
}
