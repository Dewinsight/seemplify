const mongoose = require('mongoose');

/**
 * Appraisal Document Schema
 * Handles document uploads with text extraction and AI analysis
 */
const appraisalDocumentSchema = new mongoose.Schema({
  // References
  appraisalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appraisal',
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },

  // Document Info
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true,
    enum: ['pdf', 'docx', 'doc', 'txt', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg']
  },
  mimeType: String,
  fileSize: Number, // in bytes

  // Storage
  storageProvider: {
    type: String,
    enum: ['local', 'azure', 's3', 'cloudinary'],
    default: 'local'
  },
  storagePath: String,
  storageUrl: String,
  publicUrl: String,

  // Document Category
  category: {
    type: String,
    enum: [
      'achievement_evidence',    // Proof of achievements
      'project_documentation',   // Project deliverables
      'certification',          // Certifications/training
      'feedback_received',      // Feedback from others
      'performance_data',       // Metrics/KPIs
      'self_reflection',        // Self-assessment documents
      'development_plan',       // Development/training plans
      'recognition',            // Awards/recognition
      'other'
    ],
    default: 'other'
  },
  description: String,

  // Upload Info
  uploadedBy: {
    userId: String,
    name: String,
    email: String,
    role: { type: String, enum: ['employee', 'manager', 'hr'] }
  },

  // === TEXT EXTRACTION ===
  textExtraction: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'not_applicable'],
      default: 'pending'
    },
    extractedText: String,
    extractedAt: Date,
    pageCount: Number,
    wordCount: Number,
    language: String,
    error: String,

    // For images (OCR)
    ocrUsed: { type: Boolean, default: false },
    ocrConfidence: Number
  },

  // === AI ANALYSIS ===
  aiAnalysis: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    analyzedAt: Date,
    modelUsed: String,

    // Summary
    summary: String,
    keyPoints: [String],

    // Relevance to appraisal
    relevanceScore: { type: Number, min: 0, max: 100 },
    relevanceExplanation: String,

    // Extracted achievements/evidence
    extractedAchievements: [{
      description: String,
      category: String, // 'technical', 'leadership', 'innovation', etc.
      impact: String,
      confidence: Number
    }],

    // Skills/competencies mentioned
    identifiedSkills: [{
      skill: String,
      context: String,
      proficiencyLevel: String
    }],

    // Metrics found
    extractedMetrics: [{
      metricName: String,
      value: String,
      context: String
    }],

    // Sentiment
    sentiment: {
      overall: { type: String, enum: ['positive', 'neutral', 'negative', 'mixed'] },
      score: Number
    },

    // Suggestions for appraisal
    suggestions: [String],

    error: String
  },

  // Visibility
  visibility: {
    type: String,
    enum: ['employee_only', 'employee_manager', 'all_reviewers', 'hr_only'],
    default: 'employee_manager'
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active'
  },

  // Metadata
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// Indexes
appraisalDocumentSchema.index({ appraisalId: 1, category: 1 });
appraisalDocumentSchema.index({ organizationId: 1, 'uploadedBy.userId': 1 });

// Virtual for file size in human readable format
appraisalDocumentSchema.virtual('fileSizeFormatted').get(function() {
  const bytes = this.fileSize;
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Check if text extraction is supported
appraisalDocumentSchema.methods.supportsTextExtraction = function() {
  return ['pdf', 'docx', 'doc', 'txt', 'pptx'].includes(this.fileType);
};

// Check if OCR might be needed
appraisalDocumentSchema.methods.needsOCR = function() {
  return ['png', 'jpg', 'jpeg', 'pdf'].includes(this.fileType);
};

module.exports = mongoose.model('AppraisalDocument', appraisalDocumentSchema);
