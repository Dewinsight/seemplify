const mongoose = require('mongoose');
const { normalizeNumericValue } = require('../utils/normalizeCvExtraction');

const CandidateSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/\S+@\S+\.\S+/, 'Please use a valid email address.'],
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },
  position: { // Position applied for
    type: String,
    required: [true, 'Position applied for is required'],
    trim: true,
  },
  experience: { // Years of experience (e.g., "0-2", "3-5", "5-10", "10+")
    type: String,
    required: [true, 'Experience level is required'],
  },
  education: { // Highest education level (e.g., "high-school", "bachelors")
    type: String,
    required: [true, 'Education level is required'],
  },
  skills: { // Comma-separated string of skills
    type: String,
    trim: true,
  },
  location: { // Candidate's location/city
    type: String,
    trim: true,
  },
  resumeUrl: { // URL of the resume stored in Cloudinary
    type: String,
    trim: true,
  },
  resumeText: { // Extracted text from the resume
    type: String,
  },
  coverLetter: {
    type: String,
    trim: true,
  },
  status: { // e.g., 'New', 'Screening', 'Interviewing', 'Offered', 'Hired', 'Rejected'
    type: String,
    default: 'New',
    enum: ['New', 'Screening', 'Interviewing', 'Technical Test', 'HR Interview', 'Offered', 'Hired', 'Rejected', 'On Hold'],
  },
  source: { // How the candidate was found e.g. 'LinkedIn', 'Referral', 'Job Board', 'Uploaded CV'
    type: String,
    default: 'Uploaded CV',
  },
  notes: [{
    note: String,
    date: { type: Date, default: Date.now },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // User who added the comment
    userName: { type: String, default: 'Anonymous' } // Store the user's name for display
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // required: true // Depending on whether anonymous uploads are allowed
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  // Additional fields that might be useful from AI parsing
  parsedData: { // Raw or structured data from AI parsing
    type: mongoose.Schema.Types.Mixed,
  },
  aiAnalysis: { // Store insights from Azure OpenAI
    summary: String,
    strengths: [String],
    potentialFlags: [String],
    matchingScore: Number, // If you implement a scoring system
  },
  // Embedding metadata
  isEmbedded: {
    type: Boolean,
    default: false,
  },
  embeddingCreatedAt: {
    type: Date,
  },
  // Enhanced work experience analysis
  workExperience: {
    experienceSummary: String,
    totalYearsExperience: {
      type: Number,
      set: normalizeNumericValue,
    },
    careerProgression: String,
    jobHistory: [{
      company: String,
      position: String,
      duration: String,
      responsibilities: String,
      technologies: [String],
      impact: String
    }],
    keyAchievements: [String],
    industryExperience: [String],
    leadershipExperience: String,
    technicalDepth: String
  },
  
  // Enhanced education and qualifications (structured arrays for complete data capture)
  educationHistory: [{
    institution: String,
    degree: String,
    fieldOfStudy: String,
    graduationYear: String,
    gpa: String,
    honors: String,
    location: String,
    description: String
  }],
  
  certifications: [{
    name: String,
    issuingOrganization: String,
    issueDate: String,
    expiryDate: String,
    credentialId: String,
    credentialUrl: String,
    description: String
  }],
  
  languages: [{
    language: String,
    proficiency: String, // e.g., "Native", "Fluent", "Professional", "Basic"
    certifications: String
  }],
  
  awards: [{
    title: String,
    issuer: String,
    date: String,
    description: String
  }],
  
  projects: [{
    title: String,
    description: String,
    role: String,
    technologies: [String],
    startDate: String,
    endDate: String,
    url: String,
    highlights: [String]
  }],
  
  publications: [{
    title: String,
    publication: String,
    publishDate: String,
    authors: [String],
    url: String,
    description: String
  }],
  
  volunteerWork: [{
    organization: String,
    role: String,
    startDate: String,
    endDate: String,
    description: String,
    impact: String
  }],
  
  professionalMemberships: [{
    organization: String,
    role: String,
    startDate: String,
    endDate: String,
    description: String
  }],
  
  portfolioLinks: {
    github: String,
    linkedin: String,
    personalWebsite: String,
    portfolio: String,
    stackoverflow: String,
    medium: String,
    other: [String]
  },
  
  // Flexible object for ANY unlabeled or unique CV sections
  additionalSections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Complete AI-extracted data (ensures zero information loss)
  fullCVData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Cloudinary metadata
  cloudinaryPublicId: {
    type: String,
    trim: true,
  },
  cloudinaryResourceType: {
    type: String,
    trim: true,
  },
  // Processing metadata
  processingMetadata: {
    uploadSuccess: Boolean,
    parseSuccess: Boolean,
    aiSuccess: Boolean,
    fileSize: Number,
    originalName: String,
    processedAt: Date,
  },
  // Fields for tracking application process
  applicationDate: {
    type: Date,
    default: Date.now,
  },
  interviews: [{
    date: Date,
    interviewer: String, // or ObjectId ref to User
    type: String, // e.g., 'Phone Screen', 'Technical', 'HR'
    feedback: String,
    status: String, // e.g., 'Scheduled', 'Completed', 'Cancelled'
  }],
  jobAppliedFor: { // If you have a Job model
     type: mongoose.Schema.Types.ObjectId,
     ref: 'Job'
  },
  
  // Organization field - REQUIRED for data isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },

  // Internal/Employee candidate fields
  isInternalCandidate: {
    type: Boolean,
    default: false,
  },
  employeeId: {
    type: String,
    trim: true,
    sparse: true, // Optional field, only for internal candidates
  },
  currentDepartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  hireDate: {
    type: Date,
  },
  currentPosition: {
    type: String,
    trim: true,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }
});

// Update 'updatedAt' field before saving
CandidateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Organization-related indexes for better query performance
CandidateSchema.index({ organization: 1 });
CandidateSchema.index({ organization: 1, status: 1 });
CandidateSchema.index({ organization: 1, createdAt: -1 });
CandidateSchema.index({ organization: 1, email: 1 });

module.exports = mongoose.model('Candidate', CandidateSchema);
