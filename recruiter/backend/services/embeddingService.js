const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const rankingService = require('./rankingService');
const weaviateService = require('./weaviateService');

class EmbeddingService {
  constructor() {
    // Pinecone setup (keep for backward compatibility)
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    this.candidateIndexName = 'candidates';
    this.jobIndexName = 'jobs'; // New index for jobs
    
    // Weaviate setup
    this.weaviate = weaviateService;
    
    // Feature flag for migration
    this.useWeaviate = process.env.USE_WEAVIATE === 'true';
    
    console.log(`📊 Vector DB Mode: ${this.useWeaviate ? '✨ Weaviate' : '📌 Pinecone'}`);
  }

  /**
   * Create comprehensive structured text from candidate data for embedding
   * Now includes ALL available CV data for maximum matching accuracy
   */
  createCandidateEmbeddingText(candidate) {
    const parts = [];
    
    // === BASIC PROFILE INFORMATION ===
    if (candidate.firstName && candidate.lastName) {
      parts.push(`Name: ${candidate.firstName} ${candidate.lastName}`);
    }
    
    if (candidate.position) {
      parts.push(`Current/Target Position: ${candidate.position}`);
    }
    
    if (candidate.email) {
      parts.push(`Email: ${candidate.email}`);
    }
    
    // === CORE CV CONTENT ===
    if (candidate.resumeText) {
      parts.push(`Resume Content: ${candidate.resumeText}`);
    }
    
    if (candidate.coverLetter && candidate.coverLetter.trim()) {
      parts.push(`Cover Letter: ${candidate.coverLetter}`);
    }
    
    // === AI ANALYSIS INSIGHTS ===
    if (candidate.aiAnalysis) {
      if (candidate.aiAnalysis.summary && candidate.aiAnalysis.summary.trim() && candidate.aiAnalysis.summary !== 'N/A') {
        parts.push(`Professional Summary: ${candidate.aiAnalysis.summary}`);
      }
      
      if (candidate.aiAnalysis.strengths && Array.isArray(candidate.aiAnalysis.strengths) && candidate.aiAnalysis.strengths.length > 0) {
        parts.push(`Key Strengths: ${candidate.aiAnalysis.strengths.join(', ')}`);
      }
      
      if (candidate.aiAnalysis.potentialFlags && Array.isArray(candidate.aiAnalysis.potentialFlags) && candidate.aiAnalysis.potentialFlags.length > 0) {
        parts.push(`Areas of Consideration: ${candidate.aiAnalysis.potentialFlags.join(', ')}`);
      }
    }
    
    // === COMPREHENSIVE WORK EXPERIENCE ===
    if (candidate.workExperience) {
      if (candidate.workExperience.experienceSummary && candidate.workExperience.experienceSummary.trim()) {
        parts.push(`Career Summary: ${candidate.workExperience.experienceSummary}`);
    }
    
      if (candidate.workExperience.totalYearsExperience) {
        parts.push(`Total Years Experience: ${candidate.workExperience.totalYearsExperience} years`);
      }
      
      if (candidate.workExperience.careerProgression && candidate.workExperience.careerProgression.trim()) {
        parts.push(`Career Progression: ${candidate.workExperience.careerProgression}`);
      }
      
      // Detailed Job History
      if (candidate.workExperience.jobHistory && Array.isArray(candidate.workExperience.jobHistory) && candidate.workExperience.jobHistory.length > 0) {
        const jobHistoryDetails = candidate.workExperience.jobHistory.map(job => {
          const jobParts = [];
          if (job.position && job.company) {
            jobParts.push(`${job.position} at ${job.company}`);
          }
          if (job.duration) {
            jobParts.push(`Duration: ${job.duration}`);
          }
          if (job.responsibilities && job.responsibilities.trim()) {
            jobParts.push(`Responsibilities: ${job.responsibilities}`);
          }
          if (job.technologies && Array.isArray(job.technologies) && job.technologies.length > 0) {
            jobParts.push(`Technologies: ${job.technologies.join(', ')}`);
          }
          if (job.impact && job.impact.trim()) {
            jobParts.push(`Impact: ${job.impact}`);
          }
          return jobParts.join(' | ');
        }).filter(job => job.length > 0);
        
        if (jobHistoryDetails.length > 0) {
          parts.push(`Work History: ${jobHistoryDetails.join(' || ')}`);
        }
      }
      
      // Key Achievements
      if (candidate.workExperience.keyAchievements && Array.isArray(candidate.workExperience.keyAchievements) && candidate.workExperience.keyAchievements.length > 0) {
        parts.push(`Key Achievements: ${candidate.workExperience.keyAchievements.join(', ')}`);
      }
      
      // Industry Experience
      if (candidate.workExperience.industryExperience && Array.isArray(candidate.workExperience.industryExperience) && candidate.workExperience.industryExperience.length > 0) {
        parts.push(`Industry Experience: ${candidate.workExperience.industryExperience.join(', ')}`);
      }
      
      // Leadership Experience
      if (candidate.workExperience.leadershipExperience && candidate.workExperience.leadershipExperience.trim()) {
        parts.push(`Leadership Experience: ${candidate.workExperience.leadershipExperience}`);
      }
      
      // Technical Depth
      if (candidate.workExperience.technicalDepth && candidate.workExperience.technicalDepth.trim()) {
        parts.push(`Technical Expertise: ${candidate.workExperience.technicalDepth}`);
      }
    }
    
    // === TRADITIONAL PROFILE FIELDS ===
    if (candidate.skills) {
      const skillsText = Array.isArray(candidate.skills) 
        ? candidate.skills.join(', ')
        : candidate.skills;
      if (skillsText && skillsText.trim()) {
        parts.push(`Skills: ${skillsText}`);
      }
    }
    
    if (candidate.experience) {
      parts.push(`Experience Level: ${candidate.experience}`);
    }
    
    if (candidate.education) {
      parts.push(`Education: ${candidate.education}`);
    }
    
    if (candidate.location) {
      parts.push(`Location: ${candidate.location}`);
    }
    
    // === COMPLETE EDUCATION HISTORY ===
    if (candidate.educationHistory && Array.isArray(candidate.educationHistory) && candidate.educationHistory.length > 0) {
      const educationEntries = candidate.educationHistory.map(edu => {
        const eduParts = [];
        if (edu.degree && edu.institution) {
          eduParts.push(`${edu.degree} from ${edu.institution}`);
        } else if (edu.institution) {
          eduParts.push(`Studied at ${edu.institution}`);
        }
        if (edu.fieldOfStudy) {
          eduParts.push(`Field: ${edu.fieldOfStudy}`);
        }
        if (edu.graduationYear) {
          eduParts.push(`Graduated: ${edu.graduationYear}`);
        }
        if (edu.gpa) {
          eduParts.push(`GPA: ${edu.gpa}`);
        }
        if (edu.honors) {
          eduParts.push(`Honors: ${edu.honors}`);
        }
        if (edu.location) {
          eduParts.push(`Location: ${edu.location}`);
        }
        if (edu.description) {
          eduParts.push(`Details: ${edu.description}`);
        }
        return eduParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (educationEntries.length > 0) {
        parts.push(`Complete Education History: ${educationEntries.join(' || ')}`);
      }
    }
    
    // === ALL CERTIFICATIONS ===
    if (candidate.certifications && Array.isArray(candidate.certifications) && candidate.certifications.length > 0) {
      const certEntries = candidate.certifications.map(cert => {
        const certParts = [];
        if (cert.name) {
          certParts.push(`Certification: ${cert.name}`);
        }
        if (cert.issuingOrganization) {
          certParts.push(`Issued by: ${cert.issuingOrganization}`);
        }
        if (cert.issueDate) {
          certParts.push(`Date: ${cert.issueDate}`);
        }
        if (cert.credentialId) {
          certParts.push(`ID: ${cert.credentialId}`);
        }
        if (cert.description) {
          certParts.push(`${cert.description}`);
        }
        return certParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (certEntries.length > 0) {
        parts.push(`Professional Certifications: ${certEntries.join(' || ')}`);
      }
    }
    
    // === LANGUAGES ===
    if (candidate.languages && Array.isArray(candidate.languages) && candidate.languages.length > 0) {
      const langEntries = candidate.languages.map(lang => {
        if (lang.proficiency) {
          return `${lang.language} (${lang.proficiency})`;
        }
        return lang.language;
      }).filter(lang => lang);
      
      if (langEntries.length > 0) {
        parts.push(`Languages: ${langEntries.join(', ')}`);
      }
    }
    
    // === AWARDS AND HONORS ===
    if (candidate.awards && Array.isArray(candidate.awards) && candidate.awards.length > 0) {
      const awardEntries = candidate.awards.map(award => {
        const awardParts = [];
        if (award.title) {
          awardParts.push(award.title);
        }
        if (award.issuer) {
          awardParts.push(`from ${award.issuer}`);
        }
        if (award.date) {
          awardParts.push(`(${award.date})`);
        }
        if (award.description) {
          awardParts.push(`- ${award.description}`);
        }
        return awardParts.join(' ');
      }).filter(entry => entry.length > 0);
      
      if (awardEntries.length > 0) {
        parts.push(`Awards and Honors: ${awardEntries.join(' | ')}`);
      }
    }
    
    // === PROJECTS ===
    if (candidate.projects && Array.isArray(candidate.projects) && candidate.projects.length > 0) {
      const projectEntries = candidate.projects.map(proj => {
        const projParts = [];
        if (proj.title) {
          projParts.push(`Project: ${proj.title}`);
        }
        if (proj.role) {
          projParts.push(`Role: ${proj.role}`);
        }
        if (proj.description) {
          projParts.push(`${proj.description}`);
        }
        if (proj.technologies && Array.isArray(proj.technologies) && proj.technologies.length > 0) {
          projParts.push(`Technologies: ${proj.technologies.join(', ')}`);
        }
        if (proj.highlights && Array.isArray(proj.highlights) && proj.highlights.length > 0) {
          projParts.push(`Highlights: ${proj.highlights.join(', ')}`);
        }
        return projParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (projectEntries.length > 0) {
        parts.push(`Projects: ${projectEntries.join(' || ')}`);
      }
    }
    
    // === PUBLICATIONS ===
    if (candidate.publications && Array.isArray(candidate.publications) && candidate.publications.length > 0) {
      const pubEntries = candidate.publications.map(pub => {
        const pubParts = [];
        if (pub.title) {
          pubParts.push(`Publication: ${pub.title}`);
        }
        if (pub.publication) {
          pubParts.push(`in ${pub.publication}`);
        }
        if (pub.publishDate) {
          pubParts.push(`(${pub.publishDate})`);
        }
        if (pub.authors && Array.isArray(pub.authors)) {
          pubParts.push(`Authors: ${pub.authors.join(', ')}`);
        }
        if (pub.description) {
          pubParts.push(`${pub.description}`);
        }
        return pubParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (pubEntries.length > 0) {
        parts.push(`Publications: ${pubEntries.join(' || ')}`);
      }
    }
    
    // === VOLUNTEER WORK ===
    if (candidate.volunteerWork && Array.isArray(candidate.volunteerWork) && candidate.volunteerWork.length > 0) {
      const volEntries = candidate.volunteerWork.map(vol => {
        const volParts = [];
        if (vol.role && vol.organization) {
          volParts.push(`${vol.role} at ${vol.organization}`);
        } else if (vol.organization) {
          volParts.push(vol.organization);
        }
        if (vol.description) {
          volParts.push(vol.description);
        }
        if (vol.impact) {
          volParts.push(`Impact: ${vol.impact}`);
        }
        return volParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (volEntries.length > 0) {
        parts.push(`Volunteer Experience: ${volEntries.join(' || ')}`);
      }
    }
    
    // === PROFESSIONAL MEMBERSHIPS ===
    if (candidate.professionalMemberships && Array.isArray(candidate.professionalMemberships) && candidate.professionalMemberships.length > 0) {
      const memEntries = candidate.professionalMemberships.map(mem => {
        const memParts = [];
        if (mem.role && mem.organization) {
          memParts.push(`${mem.role} at ${mem.organization}`);
        } else if (mem.organization) {
          memParts.push(`Member of ${mem.organization}`);
        }
        if (mem.description) {
          memParts.push(mem.description);
        }
        return memParts.join(' | ');
      }).filter(entry => entry.length > 0);
      
      if (memEntries.length > 0) {
        parts.push(`Professional Memberships: ${memEntries.join(', ')}`);
      }
    }
    
    // === PORTFOLIO LINKS ===
    if (candidate.portfolioLinks && typeof candidate.portfolioLinks === 'object') {
      const linkParts = [];
      if (candidate.portfolioLinks.github) {
        linkParts.push(`GitHub: ${candidate.portfolioLinks.github}`);
      }
      if (candidate.portfolioLinks.linkedin) {
        linkParts.push(`LinkedIn: ${candidate.portfolioLinks.linkedin}`);
      }
      if (candidate.portfolioLinks.personalWebsite) {
        linkParts.push(`Website: ${candidate.portfolioLinks.personalWebsite}`);
      }
      if (candidate.portfolioLinks.portfolio) {
        linkParts.push(`Portfolio: ${candidate.portfolioLinks.portfolio}`);
      }
      if (candidate.portfolioLinks.stackoverflow) {
        linkParts.push(`StackOverflow: ${candidate.portfolioLinks.stackoverflow}`);
      }
      if (candidate.portfolioLinks.medium) {
        linkParts.push(`Blog: ${candidate.portfolioLinks.medium}`);
      }
      if (candidate.portfolioLinks.other && Array.isArray(candidate.portfolioLinks.other)) {
        linkParts.push(...candidate.portfolioLinks.other);
      }
      
      if (linkParts.length > 0) {
        parts.push(`Online Presence: ${linkParts.join(', ')}`);
      }
    }
    
    // === ADDITIONAL SECTIONS (unlabeled CV content) ===
    if (candidate.additionalSections && typeof candidate.additionalSections === 'object') {
      Object.entries(candidate.additionalSections).forEach(([sectionName, sectionContent]) => {
        if (sectionContent && sectionContent.trim && sectionContent.trim()) {
          parts.push(`${sectionName}: ${sectionContent}`);
        }
      });
    }
    
    // === FULL CV DATA (ensures zero information loss) ===
    if (candidate.fullCVData && typeof candidate.fullCVData === 'object') {
      // Extract any additional text content from fullCVData that hasn't been captured yet
      const fullCVText = JSON.stringify(candidate.fullCVData);
      // Only include if it contains substantial additional content
      if (fullCVText.length > 100 && !parts.join('').includes(fullCVText.substring(0, 50))) {
        parts.push(`Complete CV Data: ${fullCVText.substring(0, 1000)}`); // Limit to avoid token overflow
      }
    }
    
    // === CONTEXTUAL INFORMATION ===
    if (candidate.source && candidate.source !== 'Uploaded CV') {
      parts.push(`Source: ${candidate.source}`);
    }
    
    // Recent notes (limit to last 3 for relevance)
    if (candidate.notes && Array.isArray(candidate.notes) && candidate.notes.length > 0) {
      const recentNotes = candidate.notes
        .slice(-3) // Get last 3 notes
        .map(note => note.note)
        .filter(note => note && note.trim())
        .join(', ');
      if (recentNotes) {
        parts.push(`Recent Notes: ${recentNotes}`);
      }
    }
    
    // === PARSED DATA INSIGHTS ===
    if (candidate.parsedData && typeof candidate.parsedData === 'object') {
      // Extract any additional structured insights from parsed data
      const additionalInsights = [];
      
      if (candidate.parsedData.languages && Array.isArray(candidate.parsedData.languages)) {
        additionalInsights.push(`Languages: ${candidate.parsedData.languages.join(', ')}`);
      }
      
      if (candidate.parsedData.certifications && Array.isArray(candidate.parsedData.certifications)) {
        additionalInsights.push(`Certifications: ${candidate.parsedData.certifications.join(', ')}`);
    }
    
      if (candidate.parsedData.awards && Array.isArray(candidate.parsedData.awards)) {
        additionalInsights.push(`Awards: ${candidate.parsedData.awards.join(', ')}`);
      }
      
      if (additionalInsights.length > 0) {
        parts.push(`Additional Qualifications: ${additionalInsights.join(', ')}`);
      }
    }
    
    const result = parts.filter(part => part && part.trim()).join('\n');
    
    console.log(`📝 Enhanced embedding text created for candidate (${result.length} characters):`, 
      result.substring(0, 200) + '...');
    
    return result;
  }

  /**
   * Generate embedding using Azure OpenAI with built-in retry
   */
  async generateEmbedding(text) {
    const RetryHelper = require('../utils/retryHelper');
    
    const generateOperation = async () => {
      const response = await axios.post(
        process.env.azure_openai_embedding_url,
        {
          input: text,
          model: process.env.azure_openai_embedding_model?.trim() || 'text-embedding-3-large'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.azure_openai_embedding_key
          },
          timeout: 30000 // 30 second timeout
        }
      );

      if (!response.data?.data?.[0]?.embedding) {
        throw new Error('Invalid embedding response structure');
      }

      return response.data.data[0].embedding;
    };

    try {
      return await RetryHelper.withRetry(generateOperation, {
        maxRetries: 3,
        delay: 2000,
        backoffMultiplier: 2,
        operation: 'Azure OpenAI embedding generation'
      });
    } catch (error) {
      console.error('Error generating embedding after retries:', error.response?.data || error.message);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Store embedding in Weaviate or Pinecone (dual mode)
   */
  async storeEmbedding(entityId, embedding, metadata, indexName = this.candidateIndexName) {
    // Weaviate mode
    if (this.useWeaviate) {
      try {
        const isJob = indexName === this.jobIndexName || indexName === 'jobs';
        if (isJob) {
          return await this.weaviate.storeJobEmbedding(entityId, embedding, metadata);
        } else {
          return await this.weaviate.storeCandidateEmbedding(entityId, embedding, metadata);
        }
      } catch (error) {
        console.error('Error storing embedding in Weaviate:', error);
        throw new Error(`Failed to store embedding in Weaviate: ${error.message}`);
      }
    }
    
    // Pinecone mode (original code)
    const RetryHelper = require('../utils/retryHelper');
    
    const storeOperation = async () => {
      const index = this.pinecone.index(indexName);
      
      await index.upsert([
        {
          id: entityId,
          values: embedding,
          metadata: {
            ...metadata,
            createdAt: new Date().toISOString()
          }
        }
      ]);

      // Verify the embedding was stored
      const verifyResult = await index.fetch([entityId]);
      if (!verifyResult.records || !verifyResult.records[entityId]) {
        throw new Error('Embedding verification failed - not found after upsert');
      }

      return true;
    };

    try {
      return await RetryHelper.withRetry(storeOperation, {
        maxRetries: 3,
        delay: 1000,
        backoffMultiplier: 2,
        operation: `Pinecone storage for ${entityId}`
      });
    } catch (error) {
      console.error('Error storing embedding in Pinecone after retries:', error);
      throw new Error(`Failed to store embedding in Pinecone: ${error.message}`);
    }
  }

  /**
   * Check if embedding exists in Pinecone
   */
  async checkEmbeddingExists(entityId, indexName = this.candidateIndexName) {
    try {
      const index = this.pinecone.index(indexName);
      const result = await index.fetch([entityId]);
      
      console.log(`Pinecone fetch result for ${entityId}:`, result);
      
      return result.records && Object.keys(result.records).length > 0;
    } catch (error) {
      console.error('Error checking embedding existence:', error);
      return false;
    }
  }

  /**
   * Delete embedding from Weaviate or Pinecone (dual mode)
   */
  async deleteEmbedding(entityId, indexName = this.candidateIndexName) {
    // Weaviate mode
    if (this.useWeaviate) {
      try {
        const isJob = indexName === this.jobIndexName || indexName === 'jobs';
        return isJob
          ? await this.weaviate.deleteJob(entityId)
          : await this.weaviate.deleteCandidate(entityId);
      } catch (error) {
        console.error('Error deleting embedding from Weaviate:', error);
        throw new Error('Failed to delete embedding from Weaviate');
      }
    }
    
    // Pinecone mode (original code)
    try {
      const index = this.pinecone.index(indexName);
      await index.deleteOne(entityId);
      return true;
    } catch (error) {
      console.error('Error deleting embedding:', error);
      throw new Error('Failed to delete embedding');
    }
  }

  /**
   * Main function to create and store candidate embedding
   */
  async createCandidateEmbedding(candidate) {
    try {
      console.log(`📝 Creating enhanced embedding for candidate: ${candidate._id}`);
      console.log('Candidate data available:', {
        hasWorkExperience: !!candidate.workExperience,
        hasAIAnalysis: !!candidate.aiAnalysis,
        hasParsedData: !!candidate.parsedData,
        workExpKeys: candidate.workExperience ? Object.keys(candidate.workExperience) : [],
        aiAnalysisKeys: candidate.aiAnalysis ? Object.keys(candidate.aiAnalysis) : []
      });
      
      // Create comprehensive structured text for embedding
      const embeddingText = this.createCandidateEmbeddingText(candidate);
      
      if (!embeddingText.trim()) {
        throw new Error('No text content available for embedding');
      }

      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Extract work experience data properly
      const workExp = candidate.workExperience || {};
      const totalYears = workExp.totalYearsExperience || 
                        this.extractYearsFromExperience(candidate.experience) || 
                        0;
      
      // Extract companies and positions from job history
      const jobHistory = workExp.jobHistory || [];
      const companiesWorkedAt = jobHistory
        .map(job => job.company)
        .filter(company => company && company !== 'N/A');
      const positionsHeld = jobHistory
        .map(job => job.position)
        .filter(position => position && position !== 'N/A');
      const technologiesUsed = jobHistory
        .reduce((acc, job) => {
          if (job.technologies && Array.isArray(job.technologies)) {
            return [...acc, ...job.technologies];
          }
          return acc;
        }, []);
      
      // Extract AI analysis data
      const aiAnalysis = candidate.aiAnalysis || {};
      
      // Prepare enhanced metadata with comprehensive candidate information
      const metadata = {
        type: 'candidate',
        candidateId: candidate._id.toString(),
        // Organization for filtering - CRITICAL for data isolation
        organizationId: candidate.organization?.toString() || candidate.organization,
        // Basic Info
        firstName: candidate.firstName || '',
        lastName: candidate.lastName || '',
        position: candidate.position || '',
        experience: candidate.experience || '',
        skills: Array.isArray(candidate.skills) ? candidate.skills : (candidate.skills ? candidate.skills.split(',').map(s => s.trim()) : []),
        location: candidate.location || '',
        email: candidate.email || '',
        phone: candidate.phone || '',
        education: candidate.education || '',
        source: candidate.source || '',
        status: candidate.status || '',
        
        // AI Analysis Results - with proper null checks
        aiSummary: aiAnalysis.summary || '',
        aiStrengths: Array.isArray(aiAnalysis.strengths) ? aiAnalysis.strengths : [],
        aiFlags: Array.isArray(aiAnalysis.potentialFlags) ? aiAnalysis.potentialFlags : [],
        
        // Work Experience Insights - with proper extraction
        totalYearsExp: totalYears,
        careerProgression: workExp.careerProgression || '',
        keyAchievements: Array.isArray(workExp.keyAchievements) ? workExp.keyAchievements : [],
        industryExp: Array.isArray(workExp.industryExperience) ? workExp.industryExperience : [],
        hasLeadershipExp: !!(workExp.leadershipExperience && workExp.leadershipExperience.trim() && workExp.leadershipExperience !== 'N/A'),
        technicalDepth: workExp.technicalDepth || '',
        
        // Job History Summary
        companiesWorkedAt: companiesWorkedAt,
        positionsHeld: positionsHeld,
        technologiesUsed: [...new Set(technologiesUsed)], // Remove duplicates
        
        // Complete structured qualifications (from new fields)
        educationCount: (candidate.educationHistory || []).length,
        educationDegrees: (candidate.educationHistory || []).map(e => e.degree).filter(d => d),
        educationInstitutions: (candidate.educationHistory || []).map(e => e.institution).filter(i => i),
        
        certificationsCount: (candidate.certifications || []).length,
        certificationNames: (candidate.certifications || []).map(c => c.name).filter(n => n),
        
        languagesCount: (candidate.languages || []).length,
        languagesList: (candidate.languages || []).map(l => l.language).filter(lang => lang),
        
        awardsCount: (candidate.awards || []).length,
        awardsList: (candidate.awards || []).map(a => a.title).filter(t => t),
        
        projectsCount: (candidate.projects || []).length,
        projectNames: (candidate.projects || []).map(p => p.title).filter(t => t),
        
        publicationsCount: (candidate.publications || []).length,
        publicationTitles: (candidate.publications || []).map(p => p.title).filter(t => t),
        
        volunteerCount: (candidate.volunteerWork || []).length,
        volunteerOrgs: (candidate.volunteerWork || []).map(v => v.organization).filter(o => o),
        
        membershipsCount: (candidate.professionalMemberships || []).length,
        membershipOrgs: (candidate.professionalMemberships || []).map(m => m.organization).filter(o => o),
        
        hasGithub: !!(candidate.portfolioLinks?.github),
        hasLinkedIn: !!(candidate.portfolioLinks?.linkedin),
        hasPortfolio: !!(candidate.portfolioLinks?.portfolio || candidate.portfolioLinks?.personalWebsite),
        
        additionalSectionsCount: candidate.additionalSections ? Object.keys(candidate.additionalSections).length : 0,
        additionalSectionNames: candidate.additionalSections ? Object.keys(candidate.additionalSections) : [],
        
        // Smart data storage - Store only ESSENTIAL data in Pinecone metadata
        // Note: Pinecone has 40KB metadata limit per vector
        // Full candidate data remains in MongoDB - fetch when needed for detailed views
        
        // Store only the most critical complex data that's useful for matching/filtering
        // These are carefully selected to stay under the 40KB limit while providing rich context
        
        // Essential work history (most important for matching)
        jobHistory_summary: JSON.stringify((workExp.jobHistory || []).slice(0, 3).map(job => ({
          company: job.company,
          position: job.position,
          duration: job.duration,
          technologies: (job.technologies || []).slice(0, 5) // Limit to top 5 technologies per job
        }))),
        
        // Core qualifications (compact format)
        educationHistory_summary: JSON.stringify((candidate.educationHistory || []).slice(0, 2).map(edu => ({
          institution: edu.institution,
          degree: edu.degree,
          year: edu.graduationYear
        }))),
        
        certifications_summary: JSON.stringify((candidate.certifications || []).slice(0, 5).map(cert => ({
          name: cert.name,
          issuer: cert.issuingOrganization
        }))),
        
        projects_summary: JSON.stringify((candidate.projects || []).slice(0, 3).map(proj => ({
          title: proj.title,
          technologies: (proj.technologies || []).slice(0, 5)
        }))),
        
        // Compact portfolio links
        portfolioLinks_summary: JSON.stringify({
          github: candidate.portfolioLinks?.github || null,
          linkedin: candidate.portfolioLinks?.linkedin || null,
          website: candidate.portfolioLinks?.personalWebsite || candidate.portfolioLinks?.portfolio || null
        }),
        
        // AI insights (most valuable, keep concise)
        aiSummary_full: candidate.aiAnalysis?.summary?.substring(0, 500) || '', // Limit to 500 chars
        
        // Content flags for explanation
        hasCoverLetter: !!(candidate.coverLetter && candidate.coverLetter.trim()),
        hasDetailedWorkHistory: jobHistory.length > 0,
        hasAIAnalysis: !!(aiAnalysis.summary && aiAnalysis.summary !== 'N/A'),
        hasCompleteEducation: (candidate.educationHistory || []).length > 0,
        hasCertifications: (candidate.certifications || []).length > 0,
        hasProjects: (candidate.projects || []).length > 0,
        hasPublications: (candidate.publications || []).length > 0,
        hasAdditionalSections: candidate.additionalSections && Object.keys(candidate.additionalSections).length > 0,
        
        // Metadata for matching quality
        embeddingTextLength: embeddingText.length,
        dataCompleteness: this.calculateDataCompleteness(candidate),
        comprehensivenessScore: this.calculateComprehensivenessScore(candidate)
      };

      // Calculate metadata size (Pinecone limit is 40KB = 40960 bytes)
      const metadataSize = JSON.stringify(metadata).length;
      const maxSize = 40960; // 40KB in bytes
      
      console.log('📊 Embedding metadata created:', {
        totalYearsExp: metadata.totalYearsExp,
        companiesCount: metadata.companiesWorkedAt.length,
        positionsCount: metadata.positionsHeld.length,
        skillsCount: metadata.skills.length,
        hasLeadershipExp: metadata.hasLeadershipExp,
        dataCompleteness: metadata.dataCompleteness,
        metadataSize: metadataSize,
        sizeLimit: maxSize,
        withinLimit: metadataSize <= maxSize,
        utilizationPercent: Math.round((metadataSize / maxSize) * 100)
      });

      // Warn if approaching limit (>80% = 32KB)
      if (metadataSize > maxSize * 0.8) {
        console.warn(`⚠️ Metadata size is ${metadataSize} bytes (${Math.round((metadataSize / maxSize) * 100)}% of limit). Consider further optimization.`);
      }

      // Error if exceeds limit
      if (metadataSize > maxSize) {
        throw new Error(`Metadata size (${metadataSize} bytes) exceeds Pinecone limit (${maxSize} bytes). Cannot store embedding.`);
      }

      // Store in Pinecone
      await this.storeEmbedding(candidate._id.toString(), embedding, metadata, this.candidateIndexName);
      
      console.log(`✅ Enhanced embedding created for candidate: ${candidate._id} (${embeddingText.length} chars, ${metadata.dataCompleteness}% complete, ${totalYears} years exp)`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to create enhanced embedding for candidate ${candidate._id}:`, error);
      throw error;
    }
  }

  /**
   * Calculate data completeness score for candidate (0-100%)
   */
  calculateDataCompleteness(candidate) {
    const fields = [
      candidate.firstName,
      candidate.lastName,
      candidate.email,
      candidate.phone,
      candidate.position,
      candidate.experience,
      candidate.education,
      candidate.skills,
      candidate.location,
      candidate.resumeText,
      candidate.coverLetter,
      candidate.aiAnalysis?.summary,
      candidate.workExperience?.experienceSummary,
      candidate.workExperience?.jobHistory?.length > 0
    ];
    
    const completedFields = fields.filter(field => {
      if (typeof field === 'boolean') return field;
      if (typeof field === 'string') return field && field.trim() && field !== 'N/A';
      return !!field;
    }).length;
    
    return Math.round((completedFields / fields.length) * 100);
  }

  /**
   * Calculate comprehensiveness score based on structured data richness (0-100%)
   * This measures how much additional structured information we have beyond basics
   */
  calculateComprehensivenessScore(candidate) {
    let score = 0;
    let maxScore = 0;
    
    // Basic profile (10 points max)
    maxScore += 10;
    if (candidate.resumeText && candidate.resumeText.length > 100) score += 5;
    if (candidate.aiAnalysis?.summary) score += 3;
    if (candidate.coverLetter && candidate.coverLetter.length > 50) score += 2;
    
    // Education (15 points max)
    maxScore += 15;
    const eduCount = (candidate.educationHistory || []).length;
    if (eduCount > 0) score += Math.min(eduCount * 5, 15);
    
    // Certifications (10 points max)
    maxScore += 10;
    const certCount = (candidate.certifications || []).length;
    if (certCount > 0) score += Math.min(certCount * 3, 10);
    
    // Work experience (15 points max)
    maxScore += 15;
    const jobHistCount = (candidate.workExperience?.jobHistory || []).length;
    if (jobHistCount > 0) score += Math.min(jobHistCount * 3, 10);
    if (candidate.workExperience?.careerProgression) score += 3;
    if ((candidate.workExperience?.keyAchievements || []).length > 0) score += 2;
    
    // Languages (5 points max)
    maxScore += 5;
    const langCount = (candidate.languages || []).length;
    if (langCount > 0) score += Math.min(langCount * 2, 5);
    
    // Awards (5 points max)
    maxScore += 5;
    const awardCount = (candidate.awards || []).length;
    if (awardCount > 0) score += Math.min(awardCount * 2, 5);
    
    // Projects (10 points max)
    maxScore += 10;
    const projCount = (candidate.projects || []).length;
    if (projCount > 0) score += Math.min(projCount * 3, 10);
    
    // Publications (10 points max)
    maxScore += 10;
    const pubCount = (candidate.publications || []).length;
    if (pubCount > 0) score += Math.min(pubCount * 5, 10);
    
    // Volunteer work (5 points max)
    maxScore += 5;
    const volCount = (candidate.volunteerWork || []).length;
    if (volCount > 0) score += Math.min(volCount * 2, 5);
    
    // Professional memberships (5 points max)
    maxScore += 5;
    const memCount = (candidate.professionalMemberships || []).length;
    if (memCount > 0) score += Math.min(memCount * 2, 5);
    
    // Portfolio links (5 points max)
    maxScore += 5;
    if (candidate.portfolioLinks) {
      if (candidate.portfolioLinks.github) score += 1;
      if (candidate.portfolioLinks.linkedin) score += 1;
      if (candidate.portfolioLinks.personalWebsite || candidate.portfolioLinks.portfolio) score += 2;
      if (candidate.portfolioLinks.stackoverflow) score += 1;
    }
    
    // Additional sections (5 points max)
    maxScore += 5;
    const addlSections = candidate.additionalSections ? Object.keys(candidate.additionalSections).length : 0;
    if (addlSections > 0) score += Math.min(addlSections * 2, 5);
    
    return Math.round((score / maxScore) * 100);
  }

  /**
   * Search similar candidates (for job matching) - Dual mode
   * @param {string} queryText - Text to search for
   * @param {number} topK - Number of top matches to return
   * @param {string} organizationId - Organization ID to filter candidates by
   */
  async searchSimilarCandidates(queryText, topK = 10, organizationId = null) {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(queryText);
      
      // Weaviate mode - use hybrid search for better results
      if (this.useWeaviate) {
        return await this.weaviate.hybridSearchCandidates(
          queryText,
          queryEmbedding,
          organizationId,
          topK,
          0.7 // Favor vector search but include keyword matching
        );
      }
      
      // Pinecone mode (original code)
      const index = this.pinecone.index(this.candidateIndexName);
      const queryOptions = {
        vector: queryEmbedding,
        topK: topK,
        includeMetadata: true
      };

      // Add organization filter if provided
      if (organizationId) {
        queryOptions.filter = {
          organizationId: { $eq: organizationId }
        };
        console.log(`🏢 Filtering candidates by organization: ${organizationId}`);
      }

      const searchResults = await index.query(queryOptions);
      
      console.log(`🔍 Found ${searchResults.matches?.length || 0} candidates ${organizationId ? 'in organization' : 'globally'}`);
      return searchResults.matches || [];
    } catch (error) {
      console.error('Error searching similar candidates:', error);
      throw new Error('Failed to search similar candidates');
    }
  }

  /**
   * Create structured text from job data for embedding
   */
  createJobEmbeddingText(job) {
    const parts = [];
    
    // Extract key domain information for better matching
    const titleLower = (job.title || '').toLowerCase();
    const isFintech = titleLower.includes('payment') || titleLower.includes('fintech') || 
                      titleLower.includes('banking') || titleLower.includes('financial');
    
    if (job.title) {
      parts.push(`Job Title: ${job.title}`);
      // Repeat important domain keywords for emphasis
      if (isFintech) {
        parts.push(`Domain Focus: Fintech, Payments, Financial Services`);
      }
    }
    
    if (job.department) {
      parts.push(`Department: ${job.department}`);
    }
    
    if (job.location) {
      parts.push(`Location: ${job.location}`);
    }
    
    if (job.type) {
      parts.push(`Job Type: ${job.type}`);
    }
    
    if (job.level) {
      parts.push(`Job Level: ${job.level}`);
    }
    
    if (job.description) {
      parts.push(`Job Description: ${job.description}`);
      // Extract and emphasize domain keywords from description
      const descLower = job.description.toLowerCase();
      const domainKeywords = [];
      if (descLower.includes('payment')) domainKeywords.push('payments');
      if (descLower.includes('fintech')) domainKeywords.push('fintech');
      if (descLower.includes('financial')) domainKeywords.push('financial services');
      if (descLower.includes('banking')) domainKeywords.push('banking');
      if (domainKeywords.length > 0) {
        parts.push(`Key Domain Areas: ${domainKeywords.join(', ')}`);
      }
    }
    
    if (job.requirements) {
      parts.push(`Requirements: ${job.requirements}`);
    }
    
    if (job.responsibilities) {
      parts.push(`Responsibilities: ${job.responsibilities}`);
    }
    
    if (job.skills) {
      const skillsText = Array.isArray(job.skills) 
        ? job.skills.join(', ')
        : job.skills;
      if (skillsText && skillsText.trim()) {
        parts.push(`Required Skills: ${skillsText}`);
        // Emphasize fintech skills if present
        const skillsLower = skillsText.toLowerCase();
        if (skillsLower.includes('payment') || skillsLower.includes('fintech') || 
            skillsLower.includes('financial') || skillsLower.includes('banking')) {
          parts.push(`Domain Expertise Required: Fintech, Payments, Financial Technology`);
        }
      }
    }
    
    if (job.experience) {
      parts.push(`Experience Required: ${job.experience}`);
    }
    
    if (job.education) {
      parts.push(`Education Required: ${job.education}`);
    }
    
    if (job.benefits) {
      parts.push(`Benefits: ${job.benefits}`);
    }
    
    if (job.remote) {
      parts.push(`Remote Work: ${job.remote ? 'Yes' : 'No'}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Main function to create and store job embedding
   */
  async createJobEmbedding(job) {
    try {
      console.log(`Creating embedding for job: ${job._id}`);
      
      // Create structured text for embedding
      const embeddingText = this.createJobEmbeddingText(job);
      
      if (!embeddingText.trim()) {
        throw new Error('No text content available for embedding');
      }

      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Prepare metadata
      const metadata = {
        type: 'job',
        jobId: job._id.toString(),
        title: job.title || '',
        department: job.department || '',
        location: job.location || '',
        jobType: job.type || '',
        level: job.level || '',
        experience: job.experience || '',
        education: job.education || '',
        skills: Array.isArray(job.skills) ? job.skills : (job.skills ? job.skills.split(',').map(s => s.trim()) : []),
        remote: job.remote || false,
        status: job.status || ''
      };

      // Store in Pinecone
      await this.storeEmbedding(job._id.toString(), embedding, metadata, this.jobIndexName);
      
      console.log(`Successfully created embedding for job: ${job._id}`);
      return true;
    } catch (error) {
      console.error(`Failed to create embedding for job ${job._id}:`, error);
      throw error;
    }
  }

  /**
   * Find matching candidates for a job using cosine similarity
   * @param {Object} job - Job object with organization information
   * @param {number} topK - Number of top matches to return
   * @param {Object} options - Additional options { skipCache: boolean }
   */
  async findMatchingCandidatesForJob(job, topK = 10, options = {}) {
    try {
      const aiMatchCacheService = require('./aiMatchCacheService');
      const startTime = Date.now();
      
      // Check cache first unless explicitly skipped
      if (!options.skipCache) {
        const cached = await aiMatchCacheService.getCachedBulkMatch(job._id);
        if (cached) {
          console.log(`⚡ Cache hit! Returning cached matches for job ${job._id} (${cached.cacheAgeMinutes} minutes old)`);
          return {
            matches: cached.data,
            fromCache: true,
            cacheAge: cached.cacheAge,
            cacheAgeMinutes: cached.cacheAgeMinutes,
            metadata: cached.metadata
          };
        }
      }

      console.log(`🔄 Cache miss or skip - generating fresh AI matches for job ${job._id}`);

      // Create structured text from job for embedding
      const jobText = this.createJobEmbeddingText(job);
      
      if (!jobText.trim()) {
        throw new Error('No text content available for job matching');
      }

      // Get organization ID from job
      const organizationId = job.organization?.toString() || job.organization;
      
      if (!organizationId) {
        console.warn('⚠️ No organization ID found for job, searching all candidates');
      }

      // Search for similar candidates within the same organization
      const matches = await this.searchSimilarCandidates(jobText, topK, organizationId);
      
      console.log(`🔍 Found ${matches.length} matching candidates for job ${job._id}`);
      
      // Format results with similarity scores and full metadata
      const formattedMatches = matches.map((match, index) => {
        console.log(`Match ${index + 1}: Candidate ${match.metadata.candidateId} with score ${match.score}`);
        console.log(`Metadata available:`, {
          totalYearsExp: match.metadata.totalYearsExp,
          companiesCount: match.metadata.companiesWorkedAt?.length || 0,
          hasAIAnalysis: match.metadata.hasAIAnalysis,
          dataCompleteness: match.metadata.dataCompleteness
        });
        
        return {
        candidateId: match.metadata.candidateId,
        similarity: match.score,
          // Include full metadata for explanation generation
          metadata: match.metadata,
          // Keep candidate info for backward compatibility
        candidate: {
          name: `${match.metadata.firstName} ${match.metadata.lastName}`.trim(),
          position: match.metadata.position,
          experience: match.metadata.experience,
          skills: match.metadata.skills,
          location: match.metadata.location,
          email: match.metadata.email,
          phone: match.metadata.phone
        }
        };
      });

      // Cache the results (fire and forget - don't block response)
      const generationTime = Date.now() - startTime;
      aiMatchCacheService.setCachedBulkMatch(job._id, formattedMatches, {
        candidateCount: formattedMatches.length,
        generationTime,
        modelUsed: 'text-embedding-ada-002',
        version: 1
      }).catch(err => console.error('Failed to cache matches:', err));

      return {
        matches: formattedMatches,
        fromCache: false,
        generationTime,
        metadata: {
          candidateCount: formattedMatches.length,
          modelUsed: 'text-embedding-ada-002'
        }
      };
    } catch (error) {
      console.error('Error finding matching candidates for job:', error);
      throw new Error('Failed to find matching candidates');
    }
  }

  /**
   * Find matching candidates for a job using cosine similarity with detailed explanations
   */
  async findMatchingCandidatesWithExplanation(job, topK = 10) {
    try {
      const startTime = Date.now();
      
      // Get basic matches from vector search first
      console.log(`🔍 Finding top ${topK} candidates using vector similarity...`);
      const matchResult = await this.findMatchingCandidatesForJob(job, topK);
      
      // Handle new cache-aware response format
      const matches = matchResult.matches || matchResult;
      const fromCache = matchResult.fromCache || false;
      const cacheAge = matchResult.cacheAge || null;
      const cacheAgeMinutes = matchResult.cacheAgeMinutes || null;
      
      if (matches.length === 0) {
        console.log('ℹ️ No candidates found in vector search');
        return {
          matches: [],
          fromCache: fromCache,
          cacheAge: cacheAge,
          cacheAgeMinutes: cacheAgeMinutes
        };
      }
      
      // If data is from cache, log it
      if (fromCache) {
        console.log(`⚡ Using cached vector matches (${cacheAgeMinutes} minutes old)`);
      }

      const vectorSearchTime = Date.now() - startTime;
      console.log(`⚡ Vector search completed in ${vectorSearchTime}ms, found ${matches.length} candidates`);

      // Check if GPT analysis is enabled
      const gptAnalysisService = require('./gptAnalysisService');
      
      if (gptAnalysisService.isEnabled) {
        console.log('🧠 Using GPT-4.1 enhanced analysis...');
        
        // Convert matches to candidate objects for GPT analysis
        const candidatesForAnalysis = matches.map(match => {
          const candidateSkills = this.parseSkills(match.metadata?.skills);
          return {
            _id: match.candidateId,
            id: match.candidateId,
            name: match.metadata?.name || `${match.metadata?.firstName || ''} ${match.metadata?.lastName || ''}`.trim() || 'Unknown',
            skills: candidateSkills, // Already parsed as array
            experience: match.metadata?.totalYearsExp || match.metadata?.experience || 0,
            location: match.metadata?.location || '',
            currentRole: match.metadata?.currentPosition || '',
            education: match.metadata?.education || '',
            bio: match.metadata?.aiSummary || '',
            score: match.similarity // Include vector similarity score
          };
        });

        // Use GPT batch analysis
        const gptResults = await gptAnalysisService.batchAnalyzeCandidates(job, candidatesForAnalysis);
        
        const gptAnalysisTime = Date.now() - startTime - vectorSearchTime;
        console.log(`🧠 GPT analysis completed in ${gptAnalysisTime}ms`);

        // Format results for backward compatibility with existing frontend
        const formattedResults = gptResults.map(result => {
          const originalMatch = matches.find(m => m.candidateId === (result.candidate._id || result.candidate.id));
          
          return {
            candidateId: result.candidate._id || result.candidate.id,
            similarity: result.relevanceScore, // Use GPT-enhanced score
            metadata: originalMatch?.metadata || {},
            candidate: originalMatch?.candidate || result.candidate,
            
            // Enhanced explanation combining legacy structure with GPT insights
            explanation: {
              // Legacy structure for compatibility
              skillsMatch: {
                matchedSkills: result.gptAnalysis.technicalStrengths || [],
                missingSkills: result.gptAnalysis.skillGaps || [],
                bonusSkills: result.gptAnalysis.transferableSkills || [],
                matchPercentage: result.gptAnalysis.skillMatchPercentage || 0,
                totalRequired: (job.skills || []).length,
                totalMatched: result.gptAnalysis.technicalStrengths?.length || 0
              },
              experienceMatch: {
                isMatch: result.gptAnalysis.experienceFit >= 6,
                required: job.experience || 0,
                candidate: result.candidate.experience || 0,
                difference: (result.candidate.experience || 0) - (job.experience || 0),
                category: result.gptAnalysis.experienceFit >= 8 ? 'Strong' : result.gptAnalysis.experienceFit >= 6 ? 'Good' : 'Below'
              },
              locationMatch: {
                isMatch: true, // GPT handles this in overall analysis
                type: 'Enhanced',
                job: job.location || '',
                candidate: result.candidate.location || ''
              },
              industryMatch: {
                hasRelevantIndustry: result.gptAnalysis.skillMatchPercentage > 50,
                matchedIndustries: [],
                allIndustries: [],
                relevanceScore: result.gptAnalysis.skillMatchPercentage
              },
              leadershipMatch: {
                requiresLeadership: (job.level || '').toLowerCase().includes('senior') || (job.level || '').toLowerCase().includes('lead'),
                hasLeadership: result.gptAnalysis.experienceFit >= 7,
                isMatch: true,
                gap: false
              },
              aiInsights: {
                hasAIAnalysis: true,
                summary: result.gptAnalysis.explanation,
                strengths: result.gptAnalysis.technicalStrengths || [],
                potentialFlags: result.gptAnalysis.skillGaps || [],
                strengthsCount: result.gptAnalysis.technicalStrengths?.length || 0,
                flagsCount: result.gptAnalysis.skillGaps?.length || 0
              },
              careerFit: {
                totalYearsExp: result.candidate.experience || 0,
                hasCareerProgression: result.gptAnalysis.growthPotential >= 7,
                hasAchievements: result.gptAnalysis.culturalAlignment >= 7,
                companiesWorkedAt: 1,
                positionsHeld: 1,
                avgTenureYears: result.candidate.experience || 0,
                stabilityScore: result.gptAnalysis.culturalAlignment >= 7 ? 'High' : 'Medium',
                progressionIndicators: {
                  multiplePositions: true,
                  multipleCompanies: true,
                  documentedGrowth: result.gptAnalysis.growthPotential >= 7
                }
              },
              matchStrength: this.categorizeMatchStrength(result.relevanceScore),
              overallScore: Math.round(result.relevanceScore * 100),
              dataQuality: {
                completeness: 90, // GPT provides rich analysis
                hasDetailedHistory: true,
                hasAIAnalysis: true,
                hasCoverLetter: false
              },
              
              // Enhanced GPT-driven insights
              gptEnhanced: {
                skillMatchPercentage: result.gptAnalysis.skillMatchPercentage,
                experienceFit: result.gptAnalysis.experienceFit,
                culturalAlignment: result.gptAnalysis.culturalAlignment,
                growthPotential: result.gptAnalysis.growthPotential,
                interviewFocus: result.gptAnalysis.interviewFocus,
                confidenceScore: result.gptAnalysis.confidenceScore,
                contextualExplanation: result.gptAnalysis.explanation
              },
              
              reasons: [
                result.gptAnalysis.explanation,
                ...result.gptAnalysis.technicalStrengths.slice(0, 3).map(strength => `Strong in ${strength}`),
                result.gptAnalysis.skillMatchPercentage > 70 ? `${result.gptAnalysis.skillMatchPercentage}% skills match` : null,
                result.gptAnalysis.experienceFit >= 7 ? 'Excellent experience fit' : null
              ].filter(Boolean).slice(0, 5),
              
              concerns: [
                ...result.gptAnalysis.skillGaps.slice(0, 2).map(gap => `Missing: ${gap}`),
                result.gptAnalysis.skillMatchPercentage < 50 ? 'Low skills match' : null,
                result.gptAnalysis.experienceFit < 5 ? 'Experience may be insufficient' : null
              ].filter(Boolean).slice(0, 3)
            },
            
            // Add relevance score for sorting
            relevanceScore: result.relevanceScore
          };
        });

        const totalTime = Date.now() - startTime;
        console.log(`✅ GPT-enhanced matching completed in ${totalTime}ms total (${gptResults.length} candidates with rich insights)`);
        
        // Sort by enhanced relevance score and return with cache metadata
        const sortedResults = formattedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
        return {
          matches: sortedResults,
          fromCache: fromCache,
          cacheAge: cacheAge,
          cacheAgeMinutes: cacheAgeMinutes
        };
        
      } else {
        // Fallback to legacy explanation system
        console.log('📴 GPT analysis disabled, using legacy explanations...');
        
        // Create a map of explanations for efficient lookup
        const explanations = {};
        
        // Add explanations to each match with error handling
        const matchesWithExplanations = await Promise.all(matches.map(async match => {
          try {
            const explanation = await this.generateMatchExplanation(job, match);
            explanations[match.candidateId] = explanation;
            return {
              ...match,
              explanation
            };
          } catch (error) {
            console.error(`Error generating explanation for candidate ${match.candidateId}:`, error);
            // Return match without explanation if explanation fails
            return {
              ...match,
              explanation: {
                skillsMatch: { matchedSkills: [], missingSkills: [], bonusSkills: [], matchPercentage: 0, totalRequired: 0, totalMatched: 0 },
                experienceMatch: { isMatch: false, required: 0, candidate: 0, difference: 0, category: 'Unknown' },
                locationMatch: { isMatch: false, type: 'Unknown', job: '', candidate: '' },
                industryMatch: { hasRelevantIndustry: false, matchedIndustries: [], allIndustries: [], relevanceScore: 0 },
                leadershipMatch: { requiresLeadership: false, hasLeadership: false, isMatch: true, gap: false },
                aiInsights: { hasAIAnalysis: false, summary: '', strengths: [], potentialFlags: [], strengthsCount: 0, flagsCount: 0 },
                careerFit: { totalYearsExp: 0, hasCareerProgression: false, hasAchievements: false, companiesWorkedAt: 0, positionsHeld: 0, avgTenureYears: 0, stabilityScore: 'Unknown', progressionIndicators: { multiplePositions: false, multipleCompanies: false, documentedGrowth: false } },
                matchStrength: 'Low',
                overallScore: Math.round((match?.similarity || 0) * 100),
                dataQuality: { completeness: 0, hasDetailedHistory: false, hasAIAnalysis: false, hasCoverLetter: false },
                reasons: ['Basic similarity match available'],
                concerns: ['Error generating detailed analysis']
              }
            };
          }
        }));

        // Re-rank candidates using the ranking service  
        const rankingService = require('./rankingService');
        const rerankedCandidates = rankingService.rerankCandidates(matchesWithExplanations, job, explanations);
        
        const totalTime = Date.now() - startTime;
        console.log(`✅ Legacy matching completed in ${totalTime}ms`);
        
        // Return with cache metadata
        return {
          matches: rerankedCandidates,
          fromCache: fromCache,
          cacheAge: cacheAge,
          cacheAgeMinutes: cacheAgeMinutes
        };
      }
    } catch (error) {
      console.error('Error finding matches with explanations:', error);
      throw error;
    }
  }

  /**
   * Rank a specific list of candidates for a job (Dual mode)
   */
  async rankCandidatesByIds(job, candidateIds, topK = 10) {
    try {
      const startTime = Date.now();
      
      // Fetch candidate embeddings from Weaviate or Pinecone
      let candidateRecords;
      
      if (this.useWeaviate) {
        // Weaviate mode - batch fetch
        candidateRecords = await this.weaviate.batchFetchCandidates(candidateIds);
      } else {
        // Pinecone mode - original code
        const index = this.pinecone.index(this.candidateIndexName);
        const fetchResult = await index.fetch(candidateIds);
        candidateRecords = Object.values(fetchResult.records);
      }

      if (candidateRecords.length === 0) {
        return [];
      }

      // Check if GPT analysis is enabled
      const gptAnalysisService = require('./gptAnalysisService');
      
      if (gptAnalysisService.isEnabled) {
        console.log('🧠 Using GPT-4.1 enhanced analysis for ranking shortlist...');
        
        const candidatesForAnalysis = candidateRecords.map(record => {
          const candidateSkills = this.parseSkills(record.metadata?.skills);
          return {
            _id: record.id,
            id: record.id,
            name: record.metadata?.name || `${record.metadata?.firstName || ''} ${record.metadata?.lastName || ''}`.trim() || 'Unknown',
            skills: candidateSkills,
            experience: record.metadata?.totalYearsExp || record.metadata?.experience || 0,
            location: record.metadata?.location || '',
            currentRole: record.metadata?.currentPosition || '',
            education: record.metadata?.education || '',
            bio: record.metadata?.aiSummary || '',
            score: this.calculateCosineSimilarity(job.embedding, record.values)
          };
        });

        const gptResults = await gptAnalysisService.batchAnalyzeCandidates(job, candidatesForAnalysis);
        
        const formattedResults = gptResults.map(result => {
          const originalRecord = candidateRecords.find(r => r.id === (result.candidate._id || result.candidate.id));
          
          return {
            candidateId: result.candidate._id || result.candidate.id,
            similarity: result.relevanceScore,
            metadata: originalRecord?.metadata || {},
            candidate: {
              name: `${originalRecord.metadata.firstName} ${originalRecord.metadata.lastName}`.trim(),
              position: originalRecord.metadata.position,
              experience: originalRecord.metadata.experience,
              skills: originalRecord.metadata.skills,
              location: originalRecord.metadata.location,
              email: originalRecord.metadata.email,
              phone: originalRecord.metadata.phone
            },
            explanation: {
              gptEnhanced: {
                skillMatchPercentage: result.gptAnalysis.skillMatchPercentage,
                experienceFit: result.gptAnalysis.experienceFit,
                culturalAlignment: result.gptAnalysis.culturalAlignment,
                growthPotential: result.gptAnalysis.growthPotential,
                interviewFocus: result.gptAnalysis.interviewFocus,
                confidenceScore: result.gptAnalysis.confidenceScore,
                contextualExplanation: result.gptAnalysis.explanation
              },
              reasons: [
                result.gptAnalysis.explanation,
                ...result.gptAnalysis.technicalStrengths.slice(0, 3).map(strength => `Strong in ${strength}`)
              ].filter(Boolean),
              concerns: [
                ...result.gptAnalysis.skillGaps.slice(0, 2).map(gap => `Missing: ${gap}`)
              ].filter(Boolean)
            },
            relevanceScore: result.relevanceScore
          };
        });

        return formattedResults.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, topK);
      } else {
        // Fallback to legacy ranking
        const jobText = this.createJobEmbeddingText(job);
        const queryEmbedding = await this.generateEmbedding(jobText);
        
        const matches = candidateRecords.map(record => {
          const similarity = this.calculateCosineSimilarity(queryEmbedding, record.values);
          return {
            candidateId: record.id,
            similarity: similarity,
            metadata: record.metadata,
            candidate: {
              name: `${record.metadata.firstName} ${record.metadata.lastName}`.trim(),
              position: record.metadata.position,
              experience: record.metadata.experience,
              skills: record.metadata.skills,
              location: record.metadata.location,
              email: record.metadata.email,
              phone: record.metadata.phone
            }
          };
        });

        matches.sort((a, b) => b.similarity - a.similarity);
        const topMatches = matches.slice(0, topK);

        const matchesWithExplanations = await Promise.all(topMatches.map(async match => {
          const explanation = await this.generateMatchExplanation(job, match);
          return {
            ...match,
            explanation,
            relevanceScore: explanation.overallScore / 100
          };
        }));

        return matchesWithExplanations;
      }
    } catch (error) {
      console.error('Error ranking candidates by IDs:', error);
      throw new Error('Failed to rank candidates by IDs');
    }
  }

  /**
   * Generate detailed explanation for why a candidate matches a job
   * Now uses enhanced metadata for comprehensive insights
   */
  async generateMatchExplanation(job, candidateMatch) {
    try {
      // Debug logging to see data structure
      console.log('🔍 Generating explanation for:');
      console.log('Job:', { 
        id: job?._id, 
        title: job?.title, 
        skills: job?.skills,
        experience: job?.experience,
        location: job?.location,
        department: job?.department,
        level: job?.level
      });
      console.log('Candidate Match:', {
        candidateId: candidateMatch?.candidateId,
        similarity: candidateMatch?.similarity,
        hasMetadata: !!candidateMatch?.metadata,
        metadataKeys: candidateMatch?.metadata ? Object.keys(candidateMatch.metadata) : []
      });
      
      const metadata = candidateMatch?.metadata || {};
      const similarity = candidateMatch?.similarity || 0;
      
      // Enhanced skills analysis using job skills and candidate technologies
      const jobSkills = this.parseSkills(job?.skills);
      const candidateSkills = this.parseSkills(metadata.skills);
      const candidateTechnologies = metadata.technologiesUsed || [];
      
      console.log('📊 Skills Analysis:');
      console.log('- Job Skills:', jobSkills);
      console.log('- Candidate Skills:', candidateSkills);
      console.log('- Candidate Technologies:', candidateTechnologies);
      
      // Combine skills and technologies for comprehensive analysis
      const allCandidateSkills = [...candidateSkills, ...candidateTechnologies];
      const skillsAnalysis = await this.analyzeSkillsMatch(jobSkills, allCandidateSkills);
      
      // Enhanced experience analysis
      const experienceAnalysis = this.analyzeExperienceMatch(job?.experience, metadata.experience);
      
      // Location analysis - check multiple possible location fields
      const candidateLocation = metadata.location || candidateMatch.candidate?.location || '';
      
      // Debug logging for location issues
      if (!candidateLocation && metadata.location !== candidateMatch.candidate?.location) {
        console.log(`⚠️ Location missing for candidate ${candidateMatch.candidateId}:`, {
          metadataLocation: metadata.location,
          candidateObjectLocation: candidateMatch.candidate?.location,
          availableMetadataKeys: Object.keys(metadata).filter(k => k.toLowerCase().includes('loc'))
        });
      }
      
      const locationAnalysis = this.analyzeLocationMatch(job?.location, candidateLocation);
      
      // Industry experience analysis
      // Industry experience analysis
      const jobContextForIndustry = {
        title: job?.title,
        department: job?.department,
        description: job?.description,
        skills: this.parseSkills(job?.skills) // Ensure skills are parsed
      };
      const industryMatch = this.analyzeIndustryMatch(jobContextForIndustry, metadata.industryExp);
      
      // Leadership requirement analysis
      const leadershipMatch = this.analyzeLeadershipMatch(job?.level, metadata.hasLeadershipExp);
      
      // AI insights analysis
      const aiInsights = this.analyzeAIInsights(metadata);
      
      // Career progression analysis
      const careerFit = this.analyzeCareerFit(job, metadata);
      
      const result = {
        skillsMatch: skillsAnalysis,
        experienceMatch: experienceAnalysis,
        locationMatch: locationAnalysis,
        industryMatch: industryMatch,
        leadershipMatch: leadershipMatch,
        aiInsights: aiInsights,
        careerFit: careerFit,
        matchStrength: this.categorizeMatchStrength(similarity),
        overallScore: Math.round(similarity * 100),
        dataQuality: {
          completeness: metadata.dataCompleteness || 0,
          hasDetailedHistory: metadata.hasDetailedWorkHistory || false,
          hasAIAnalysis: metadata.hasAIAnalysis || false,
          hasCoverLetter: metadata.hasCoverLetter || false
        },
        reasons: this.generateEnhancedMatchReasons(skillsAnalysis, experienceAnalysis, locationAnalysis, industryMatch, leadershipMatch, aiInsights, careerFit),
        concerns: this.generateEnhancedMatchConcerns(skillsAnalysis, experienceAnalysis, locationAnalysis, industryMatch, leadershipMatch, metadata)
      };
      
      console.log('✅ Successfully generated explanation with', result.reasons.length, 'reasons and', result.concerns.length, 'concerns');
      return result;
    } catch (error) {
      console.error('❌ Error generating match explanation:', error);
      console.error('Stack trace:', error.stack);
      // Return a fallback explanation
      return {
        skillsMatch: { matchedSkills: [], missingSkills: [], bonusSkills: [], matchPercentage: 0, totalRequired: 0, totalMatched: 0 },
        experienceMatch: { isMatch: false, required: 0, candidate: 0, difference: 0, category: 'Unknown' },
        locationMatch: { isMatch: false, type: 'Unknown', job: '', candidate: '' },
        industryMatch: { hasRelevantIndustry: false, matchedIndustries: [], allIndustries: [], relevanceScore: 0 },
        leadershipMatch: { requiresLeadership: false, hasLeadership: false, isMatch: true, gap: false },
        aiInsights: { hasAIAnalysis: false, summary: '', strengths: [], potentialFlags: [], strengthsCount: 0, flagsCount: 0 },
        careerFit: { totalYearsExp: 0, hasCareerProgression: false, hasAchievements: false, companiesWorkedAt: 0, positionsHeld: 0, avgTenureYears: 0, stabilityScore: 'Unknown', progressionIndicators: { multiplePositions: false, multipleCompanies: false, documentedGrowth: false } },
        matchStrength: 'Low',
        overallScore: Math.round((candidateMatch?.similarity || 0) * 100),
        dataQuality: { completeness: 0, hasDetailedHistory: false, hasAIAnalysis: false, hasCoverLetter: false },
        reasons: ['Basic similarity match available'],
        concerns: ['Limited data available for detailed analysis']
      };
    }
  }

  /**
   * Analyze industry experience match
   */
  analyzeIndustryMatch(jobContext, candidateIndustries) { // Changed jobDepartment to jobContext
    if (!candidateIndustries || candidateIndustries.length === 0) {
      return {
        hasRelevantIndustry: false,
        matchedIndustries: [],
        allIndustries: [],
        relevanceScore: 0
      };
    }

    // Extract meaningful keywords with enhanced fintech/payments detection
    const jobKeywords = new Set();
    const fintechKeywords = ['fintech', 'payment', 'payments', 'banking', 'financial', 'finance', 'transaction', 'global payments'];
    
    // Check title for fintech keywords
    if (jobContext.title) {
      const titleLower = jobContext.title.toLowerCase();
      // Add full title words
      titleLower.split(/[\s,\-]+/).forEach(k => k.trim() && k.length > 2 && jobKeywords.add(k.trim()));
      
      // Check for fintech-related terms specifically
      fintechKeywords.forEach(keyword => {
        if (titleLower.includes(keyword)) {
          jobKeywords.add(keyword);
          // Add related terms
          if (keyword === 'payment' || keyword === 'payments') {
            jobKeywords.add('fintech');
            jobKeywords.add('financial');
          }
        }
      });
    }
    
    if (jobContext.department) {
      jobContext.department.toLowerCase().split(/[\s,\-]+/).forEach(k => k.trim() && k.length > 2 && jobKeywords.add(k.trim()));
    }
    
    if (jobContext.description) {
      const descLower = jobContext.description.toLowerCase();
      // Look for fintech keywords specifically
      fintechKeywords.forEach(keyword => {
        if (descLower.includes(keyword)) {
          jobKeywords.add(keyword);
        }
      });
    }
    
    if (jobContext.skills && jobContext.skills.length > 0) {
      jobContext.skills.forEach(skill => {
        const skillLower = skill.toLowerCase().trim();
        jobKeywords.add(skillLower);
        // Check for fintech-related skills
        fintechKeywords.forEach(keyword => {
          if (skillLower.includes(keyword)) {
            jobKeywords.add(keyword);
          }
        });
      });
    }
    
    const jobIndustryKeywords = Array.from(jobKeywords).filter(k => k && k.length > 0);

    if (jobIndustryKeywords.length === 0) {
        return { // Fallback if no job keywords found
            hasRelevantIndustry: false,
            matchedIndustries: [],
            allIndustries: candidateIndustries,
            relevanceScore: 0
        };
    }

    // Enhanced matching logic
    const matchedIndustries = candidateIndustries.filter(industry => {
      const candIndustryLower = industry.toLowerCase().trim();
      
      // Direct keyword match
      const directMatch = jobIndustryKeywords.some(keyword =>
        candIndustryLower.includes(keyword) || keyword.includes(candIndustryLower)
      );
      
      // Special fintech matching
      const fintechMatch = fintechKeywords.some(fKeyword => 
        jobIndustryKeywords.includes(fKeyword) && 
        (candIndustryLower.includes('fintech') || 
         candIndustryLower.includes('payment') || 
         candIndustryLower.includes('banking') ||
         candIndustryLower.includes('financial'))
      );
      
      return directMatch || fintechMatch;
    });
    
    return {
      hasRelevantIndustry: matchedIndustries.length > 0,
      matchedIndustries: matchedIndustries,
      allIndustries: candidateIndustries,
      relevanceScore: candidateIndustries.length > 0 ? Math.round((matchedIndustries.length / candidateIndustries.length) * 100) : 0
    };
  }

  /**
   * Analyze leadership requirement match
   */
  analyzeLeadershipMatch(jobLevel, hasLeadershipExp) {
    const leadershipLevels = ['lead', 'senior', 'manager', 'director', 'head', 'chief', 'executive'];
    const requiresLeadership = leadershipLevels.some(level => 
      jobLevel?.toLowerCase().includes(level)
    );
    
    return {
      requiresLeadership: requiresLeadership,
      hasLeadership: hasLeadershipExp,
      isMatch: !requiresLeadership || hasLeadershipExp,
      gap: requiresLeadership && !hasLeadershipExp
    };
  }

  /**
   * Analyze AI insights for additional context
   */
  analyzeAIInsights(metadata) {
    return {
      hasAIAnalysis: metadata.hasAIAnalysis,
      summary: metadata.aiSummary || '',
      strengths: metadata.aiStrengths || [],
      potentialFlags: metadata.aiFlags || [],
      strengthsCount: (metadata.aiStrengths || []).length,
      flagsCount: (metadata.aiFlags || []).length
    };
  }

  /**
   * Analyze career fit and progression
   */
  analyzeCareerFit(job, metadata) {
    const totalYears = metadata.totalYearsExp || 0;
    const hasProgression = !!(metadata.careerProgression && metadata.careerProgression.trim());
    const hasAchievements = (metadata.keyAchievements || []).length > 0;
    const companiesCount = (metadata.companiesWorkedAt || []).length;
    const positionsCount = (metadata.positionsHeld || []).length;
    
    // Calculate career stability (longer tenures generally better)
    const avgTenure = companiesCount > 0 ? totalYears / companiesCount : 0;
    
    return {
      totalYearsExp: totalYears,
      hasCareerProgression: hasProgression,
      hasAchievements: hasAchievements,
      companiesWorkedAt: companiesCount,
      positionsHeld: positionsCount,
      avgTenureYears: Math.round(avgTenure * 10) / 10,
      stabilityScore: avgTenure > 2 ? 'High' : avgTenure > 1 ? 'Medium' : 'Low',
      progressionIndicators: {
        multiplePositions: positionsCount > 1,
        multipleCompanies: companiesCount > 1,
        documentedGrowth: hasProgression
      }
    };
  }

  /**
   * Generate enhanced match reasons
   */
  generateEnhancedMatchReasons(skillsAnalysis, experienceAnalysis, locationAnalysis, industryMatch, leadershipMatch, aiInsights, careerFit) {
    const reasons = [];
    
    // Skills reasons
    if (skillsAnalysis.matchPercentage > 70) {
      reasons.push(`Strong skills match (${skillsAnalysis.matchPercentage}% of requirements met)`);
    }
    if (skillsAnalysis.bonusSkills.length > 0) {
      reasons.push(`Brings valuable additional skills: ${skillsAnalysis.bonusSkills.slice(0, 3).join(', ')}`);
    }
    
    // Experience reasons
    if (experienceAnalysis.isMatch) {
      if (experienceAnalysis.difference > 0) {
        reasons.push(`Exceeds experience requirement by ${experienceAnalysis.difference} year(s)`);
      } else {
        reasons.push(`Meets experience requirement exactly`);
      }
    }
    
    // Location reasons
    if (locationAnalysis.isMatch) {
      reasons.push(`Location alignment: ${locationAnalysis.candidate}`);
    }
    
    // Industry reasons
    if (industryMatch.hasRelevantIndustry) {
      reasons.push(`Relevant industry experience in: ${industryMatch.matchedIndustries.join(', ')}`);
    }
    
    // Leadership reasons
    if (leadershipMatch.requiresLeadership && leadershipMatch.hasLeadership) {
      reasons.push(`Has leadership experience for senior role`);
    }
    
    // AI insights reasons
    if (aiInsights.strengths.length > 0) {
      reasons.push(`AI-identified strengths: ${aiInsights.strengths.slice(0, 2).join(', ')}`);
    }
    
    // Career fit reasons
    if (careerFit.hasCareerProgression) {
      reasons.push(`Demonstrated career progression and growth`);
    }
    if (careerFit.hasAchievements) {
      reasons.push(`Track record of achievements and impact`);
    }
    if (careerFit.stabilityScore === 'High') {
      reasons.push(`Stable career history (avg ${careerFit.avgTenureYears} years per role)`);
    }
    
    return reasons.slice(0, 6); // Limit to top 6 reasons
  }

  /**
   * Generate enhanced match concerns
   */
  generateEnhancedMatchConcerns(skillsAnalysis, experienceAnalysis, locationAnalysis, industryMatch, leadershipMatch, metadata) {
    const concerns = [];
    
    // Skills concerns
    if (skillsAnalysis.missingSkills.length > 0) {
      concerns.push(`Missing key skills: ${skillsAnalysis.missingSkills.slice(0, 3).join(', ')}`);
    }
    
    // Experience concerns
    if (!experienceAnalysis.isMatch && experienceAnalysis.difference < 0) {
      concerns.push(`${Math.abs(experienceAnalysis.difference)} year(s) below experience requirement`);
    }
    
    // Location concerns - be more specific about the type of mismatch
    if (!locationAnalysis.isMatch) {
      if (locationAnalysis.type === 'Missing Candidate Location') {
        concerns.push(`Candidate location not specified (job requires: ${locationAnalysis.job})`);
      } else {
      concerns.push(`Location mismatch: candidate in ${locationAnalysis.candidate}, job in ${locationAnalysis.job}`);
      }
    }
    
    // Leadership concerns
    if (leadershipMatch.gap) {
      concerns.push(`No documented leadership experience for senior role`);
    }
    
    // Industry concerns
    if (!industryMatch.hasRelevantIndustry && industryMatch.allIndustries.length > 0) {
      concerns.push(`No direct industry experience (worked in: ${industryMatch.allIndustries.slice(0, 2).join(', ')})`);
    }
    
    // AI flags
    if (metadata.aiFlags && metadata.aiFlags.length > 0) {
      concerns.push(`AI-identified considerations: ${metadata.aiFlags.slice(0, 2).join(', ')}`);
    }
    
    // Career stability concerns
    const avgTenure = metadata.totalYearsExp && metadata.companiesWorkedAt ? 
      metadata.totalYearsExp / metadata.companiesWorkedAt.length : 0;
    if (avgTenure < 1 && metadata.companiesWorkedAt && metadata.companiesWorkedAt.length > 2) {
      concerns.push(`Frequent job changes (avg ${Math.round(avgTenure * 10) / 10} years per role)`);
    }
    
    // Data quality concerns
    if (metadata.dataCompleteness < 70) {
      concerns.push(`Limited profile information (${metadata.dataCompleteness}% complete)`);
    }
    
    return concerns.slice(0, 5); // Limit to top 5 concerns
  }

  /**
   * Analyze skills matching between job requirements and candidate skills
   */
  async analyzeSkillsMatch(jobSkills, candidateSkills) {
    if (!jobSkills || jobSkills.length === 0) {
      return {
        matchedSkills: [],
        missingSkills: [],
        bonusSkills: candidateSkills.slice(0, 5),
        matchPercentage: 0,
        totalRequired: 0,
        totalMatched: 0
      };
    }

    const jobSkillsLower = jobSkills.map(s => s.toLowerCase().trim());
    const candidateSkillsLower = candidateSkills.map(s => s.toLowerCase().trim());
    
    // Find exact and partial matches
    const matchedSkills = [];
    const checkedJobSkills = [];
    
    // Process skills in parallel for better performance
    const skillMatchPromises = jobSkillsLower.map(async (jobSkill) => {
      // First try exact or partial string match
      let match = candidateSkillsLower.find(candidateSkill => 
        candidateSkill === jobSkill ||
        candidateSkill.includes(jobSkill) || 
        jobSkill.includes(candidateSkill)
      );
      
      // If no direct match, use dynamic similarity check
      if (!match) {
        for (const candidateSkill of candidateSkillsLower) {
          const isSimilar = await this.areSkillsSimilarDynamic(jobSkill, candidateSkill);
          if (isSimilar) {
            match = candidateSkill;
            break;
          }
        }
      }
      
      return { jobSkill, matched: !!match };
    });
    
    const results = await Promise.all(skillMatchPromises);
    
    results.forEach(({ jobSkill, matched }) => {
      if (matched) {
        matchedSkills.push(jobSkill);
      }
      checkedJobSkills.push(jobSkill);
    });
    
    const missingSkills = jobSkillsLower.filter(skill => !matchedSkills.includes(skill));
    
    // Find bonus skills (skills candidate has that job doesn't require)
    const bonusSkillPromises = candidateSkillsLower.map(async (candidateSkill) => {
      for (const jobSkill of jobSkillsLower) {
        const isSimilar = await this.areSkillsSimilarDynamic(candidateSkill, jobSkill);
        if (isSimilar) {
          return null; // This skill matches a job requirement
        }
      }
      return candidateSkill; // This is a bonus skill
    });
    
    const bonusSkillResults = await Promise.all(bonusSkillPromises);
    const bonusSkills = bonusSkillResults.filter(skill => skill !== null);
    
    return {
      matchedSkills: matchedSkills,
      missingSkills: missingSkills,
      bonusSkills: bonusSkills.slice(0, 5), // Limit to top 5
      matchPercentage: jobSkills.length > 0 ? Math.round((matchedSkills.length / jobSkills.length) * 100) : 0,
      totalRequired: jobSkills.length,
      totalMatched: matchedSkills.length
    };
  }



  /**
   * Analyze experience matching between job requirements and candidate experience
   */
  analyzeExperienceMatch(jobExperience, candidateExperience) {
    const jobYears = this.extractYearsFromExperience(jobExperience);
    const candidateYears = this.extractYearsFromExperience(candidateExperience);
    
    const difference = candidateYears - jobYears;
    const isMatch = candidateYears >= jobYears;
    
    let category = "Unknown";
    if (difference >= 3) {
      category = "Highly Experienced";
    } else if (difference >= 0) {
      category = "Meets Requirements";
    } else if (difference >= -1) {
      category = "Close Match";
    } else {
      category = "Under-experienced";
    }
    
    return {
      isMatch: isMatch,
      required: jobYears,
      candidate: candidateYears,
      difference: difference,
      category: category
    };
  }

  /**
   * Analyze location matching between job and candidate
   */
  analyzeLocationMatch(jobLocation, candidateLocation) {
    // Clean and normalize inputs
    const cleanJobLoc = (jobLocation || '').trim();
    const cleanCandidateLoc = (candidateLocation || '').trim();
    
    // Handle missing locations
    if (!cleanJobLoc && !cleanCandidateLoc) {
      return {
        isMatch: true, // Both unspecified - no mismatch
        type: "Location Not Required",
        job: "Not specified",
        candidate: "Not specified"
      };
    }
    
    if (!cleanJobLoc) {
      return {
        isMatch: true, // Job doesn't specify location requirement
        type: "No Location Requirement",
        job: "Not specified",
        candidate: cleanCandidateLoc || "Not specified"
      };
    }
    
    if (!cleanCandidateLoc) {
      return {
        isMatch: false,
        type: "Missing Candidate Location",
        job: cleanJobLoc,
        candidate: "Not specified"
      };
    }
    
    const jobLoc = cleanJobLoc.toLowerCase();
    const candidateLoc = cleanCandidateLoc.toLowerCase();
    
    // Exact match
    if (jobLoc === candidateLoc) {
      return {
        isMatch: true,
        type: "Exact Location Match",
        job: cleanJobLoc,
        candidate: cleanCandidateLoc
      };
    }
    
    // Remote work consideration (check first for flexibility)
    if (jobLoc.includes('remote') || candidateLoc.includes('remote') || 
        jobLoc.includes('anywhere') || candidateLoc.includes('anywhere')) {
      return {
        isMatch: true,
        type: "Remote Work Compatible",
        job: cleanJobLoc,
        candidate: cleanCandidateLoc
      };
    }
    
    // City/State/Country partial match
    if (jobLoc.includes(candidateLoc) || candidateLoc.includes(jobLoc)) {
      return {
        isMatch: true,
        type: "Partial Location Match",
        job: cleanJobLoc,
        candidate: cleanCandidateLoc
      };
    }
    
    // Common city variations and international considerations
    const locationMappings = {
      'london': ['london, uk', 'london, england', 'greater london'],
      'new york': ['nyc', 'new york city', 'ny', 'manhattan'],
      'san francisco': ['sf', 'bay area', 'silicon valley'],
      'los angeles': ['la', 'hollywood', 'beverly hills'],
      'paris': ['paris, france'],
      'berlin': ['berlin, germany'],
      'toronto': ['toronto, canada', 'gta'],
      'sydney': ['sydney, australia'],
      'tokyo': ['tokyo, japan']
    };
    
    for (const [mainCity, variations] of Object.entries(locationMappings)) {
      if ((jobLoc.includes(mainCity) && variations.some(v => candidateLoc.includes(v))) ||
          (candidateLoc.includes(mainCity) && variations.some(v => jobLoc.includes(v)))) {
      return {
        isMatch: true,
          type: "Location Variation Match",
          job: cleanJobLoc,
          candidate: cleanCandidateLoc
      };
      }
    }
    
    return {
      isMatch: false,
      type: "Location Mismatch",
      job: cleanJobLoc,
      candidate: cleanCandidateLoc
    };
  }

  /**
   * Parse skills from various formats (string, array, comma-separated)
   */
  parseSkills(skills) {
    if (!skills) return [];
    if (Array.isArray(skills)) return skills.filter(s => s && s.trim());
    if (typeof skills === 'string') {
      return skills.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    return [];
  }

  /**
   * Extract years of experience from text
   */
  extractYearsFromExperience(experienceStr) {
    if (!experienceStr) return 0;
    
    // Look for patterns like "3 years", "3-5 years", "5+ years"
    const patterns = [
      /(\d+)\+?\s*(?:years?|yrs?)/i,
      /(\d+)-\d+\s*(?:years?|yrs?)/i,
      /(\d+)/
    ];
    
    for (const pattern of patterns) {
      const match = experienceStr.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }
    
    return 0;
  }

  /**
   * Categorize match strength based on similarity score
   */
  categorizeMatchStrength(similarity) {
    if (similarity >= 0.9) return "Excellent Match";
    if (similarity >= 0.8) return "Strong Match";
    if (similarity >= 0.7) return "Good Match";
    if (similarity >= 0.6) return "Moderate Match";
    if (similarity >= 0.5) return "Weak Match";
    return "Poor Match";
  }

  /**
   * Re-create embeddings for all jobs (fixes skills parsing issue)
   */
  async reEmbedAllJobs() {
    try {
      const Job = require('../models/Job');
      const jobs = await Job.find();
      
      console.log(`🔄 Starting re-embedding for ${jobs.length} jobs...`);
      
      let successCount = 0;
      let errorCount = 0;
      const results = [];
      
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        try {
          console.log(`📝 Re-embedding job ${i + 1}/${jobs.length}: ${job.title}`);
          
          // Delete existing embedding first
          try {
            await this.deleteEmbedding(job._id.toString(), this.jobIndexName);
            console.log(`🗑️ Deleted old embedding for job: ${job._id}`);
          } catch (deleteError) {
            console.warn(`⚠️ Could not delete old embedding for job ${job._id}:`, deleteError.message);
          }
          
          // Create new embedding with fixed skills parsing
          await this.createJobEmbedding(job);
          
          // Update job document
          job.isEmbedded = true;
          job.embeddingCreatedAt = new Date();
          await job.save();
          
          successCount++;
          results.push({
            jobId: job._id,
            title: job.title,
            status: 'success',
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Successfully re-embedded job: ${job.title}`);
          
        } catch (error) {
          errorCount++;
          results.push({
            jobId: job._id,
            title: job.title,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          console.error(`❌ Failed to re-embed job ${job.title}:`, error.message);
        }
      }
      
      console.log(`🎉 Job re-embedding completed: ${successCount} success, ${errorCount} errors`);
      
      return {
        success: true,
        totalJobs: jobs.length,
        successCount,
        errorCount,
        results
      };
      
    } catch (error) {
      console.error('❌ Error in bulk job re-embedding:', error);
      throw new Error(`Failed to re-embed jobs: ${error.message}`);
    }
  }

  /**
   * Re-create embeddings for all candidates (for consistency)
   */
  async reEmbedAllCandidates() {
    try {
      const Candidate = require('../models/Candidate');
      const candidates = await Candidate.find();
      
      console.log(`🔄 Starting re-embedding for ${candidates.length} candidates...`);
      
      let successCount = 0;
      let errorCount = 0;
      const results = [];
      
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
          console.log(`👤 Re-embedding candidate ${i + 1}/${candidates.length}: ${candidate.firstName} ${candidate.lastName}`);
          
          // Delete existing embedding first
          try {
            await this.deleteEmbedding(candidate._id.toString(), this.candidateIndexName);
            console.log(`🗑️ Deleted old embedding for candidate: ${candidate._id}`);
          } catch (deleteError) {
            console.warn(`⚠️ Could not delete old embedding for candidate ${candidate._id}:`, deleteError.message);
          }
          
          // Create new embedding
          await this.createCandidateEmbedding(candidate);
          
          // Update candidate document
          candidate.isEmbedded = true;
          candidate.embeddingCreatedAt = new Date();
          await candidate.save();
          
          successCount++;
          results.push({
            candidateId: candidate._id,
            name: `${candidate.firstName} ${candidate.lastName}`,
            status: 'success',
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Successfully re-embedded candidate: ${candidate.firstName} ${candidate.lastName}`);
          
        } catch (error) {
          errorCount++;
          results.push({
            candidateId: candidate._id,
            name: `${candidate.firstName} ${candidate.lastName}`,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          console.error(`❌ Failed to re-embed candidate ${candidate.firstName} ${candidate.lastName}:`, error.message);
        }
      }
      
      console.log(`🎉 Candidate re-embedding completed: ${successCount} success, ${errorCount} errors`);
      
      return {
        success: true,
        totalCandidates: candidates.length,
        successCount,
        errorCount,
        results
      };
      
    } catch (error) {
      console.error('❌ Error in bulk candidate re-embedding:', error);
      throw new Error(`Failed to re-embed candidates: ${error.message}`);
    }
  }

  /**
   * Re-create embeddings for both jobs and candidates
   */
  async reEmbedAll() {
    try {
      console.log('🚀 Starting complete re-embedding process...');
      
      const startTime = new Date();
      
      // Re-embed jobs first (most important for the skills fix)
      console.log('\n1️⃣ Re-embedding jobs...');
      const jobResults = await this.reEmbedAllJobs();
      
      // Re-embed candidates for consistency
      console.log('\n2️⃣ Re-embedding candidates...');
      const candidateResults = await this.reEmbedAllCandidates();
      
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);
      
      const summary = {
        success: true,
        duration: `${duration} seconds`,
        jobs: {
          total: jobResults.totalJobs,
          success: jobResults.successCount,
          errors: jobResults.errorCount
        },
        candidates: {
          total: candidateResults.totalCandidates,
          success: candidateResults.successCount,
          errors: candidateResults.errorCount
        },
        timestamp: new Date().toISOString()
      };
      
      console.log('\n🎉 COMPLETE RE-EMBEDDING FINISHED!');
      console.log('📊 Summary:', summary);
      
      return {
        ...summary,
        details: {
          jobs: jobResults.results,
          candidates: candidateResults.results
        }
      };
      
    } catch (error) {
      console.error('❌ Error in complete re-embedding:', error);
      throw new Error(`Failed to complete re-embedding: ${error.message}`);
    }
  }

  /**
   * Dynamic skill similarity check using embeddings
   * This is more scalable than static mappings
   */
  async areSkillsSimilarDynamic(skill1, skill2) {
    try {
      // Quick check for exact match or very similar strings
      if (skill1.toLowerCase() === skill2.toLowerCase()) return true;
      
      // Check if one skill contains the other (e.g., "React" and "React Native")
      const s1Lower = skill1.toLowerCase();
      const s2Lower = skill2.toLowerCase();
      if (s1Lower.includes(s2Lower) || s2Lower.includes(s1Lower)) return true;
      
      // Use embeddings for semantic similarity
      const [embedding1, embedding2] = await Promise.all([
        this.getSkillEmbedding(skill1),
        this.getSkillEmbedding(skill2)
      ]);
      
      // Calculate cosine similarity
      const similarity = this.calculateCosineSimilarity(embedding1, embedding2);
      
      // Consider skills similar if cosine similarity > 0.80
      // This threshold balances accuracy with practical matching needs
      return similarity > 0.80;
    } catch (error) {
      console.error(`Error checking skill similarity for "${skill1}" and "${skill2}":`, error);
      // No fallback - skills are considered different if API fails
      return false;
    }
  }

  /**
   * Get or generate embedding for a skill (with caching)
   */
  async getSkillEmbedding(skill) {
    // Use in-memory cache for skill embeddings during request
    if (!this.skillEmbeddingCache) {
      this.skillEmbeddingCache = new Map();
    }
    
    const cacheKey = skill.toLowerCase().trim();
    
    // Check in-memory cache first
    if (this.skillEmbeddingCache.has(cacheKey)) {
      return this.skillEmbeddingCache.get(cacheKey);
    }
    
    // For production, you could add Redis caching here:
    // const redisKey = `skill_embedding:${cacheKey}`;
    // const cached = await redis.get(redisKey);
    // if (cached) {
    //   const embedding = JSON.parse(cached);
    //   this.skillEmbeddingCache.set(cacheKey, embedding);
    //   return embedding;
    // }
    
    // Generate embedding for the skill
    const embedding = await this.generateEmbedding(`Skill: ${skill}`);
    
    // Cache in memory
    this.skillEmbeddingCache.set(cacheKey, embedding);
    
    // For production, cache in Redis with TTL:
    // await redis.setex(redisKey, 86400 * 30, JSON.stringify(embedding)); // 30 days TTL
    
    return embedding;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  calculateCosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Parse JSON metadata field from Pinecone (with error handling)
   * Use this to retrieve complex objects stored as JSON strings
   * @param {Object} metadata - Pinecone metadata object
   * @param {string} fieldName - Name of the JSON field to parse
   * @param {*} defaultValue - Default value if parsing fails (default: null)
   * @returns {*} Parsed object or default value
   */
  parseMetadataField(metadata, fieldName, defaultValue = null) {
    try {
      if (!metadata || !metadata[fieldName]) {
        return defaultValue;
      }
      
      const value = metadata[fieldName];
      
      // If already parsed (shouldn't happen, but defensive)
      if (typeof value !== 'string') {
        return value;
      }
      
      return JSON.parse(value);
    } catch (error) {
      console.warn(`Failed to parse metadata field '${fieldName}':`, error.message);
      return defaultValue;
    }
  }

  /**
   * Parse all available fields from Pinecone metadata
   * Returns a candidate-like object with essential data from summaries
   * Note: For complete data, fetch from MongoDB using candidateId
   * @param {Object} metadata - Pinecone metadata object
   * @returns {Object} Parsed candidate data (summary version)
   */
  parseCompleteMetadata(metadata) {
    if (!metadata) return {};
    
    return {
      // Basic fields (already simple types)
      candidateId: metadata.candidateId,
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      email: metadata.email,
      phone: metadata.phone,
      position: metadata.position,
      experience: metadata.experience,
      skills: metadata.skills,
      location: metadata.location,
      education: metadata.education,
      status: metadata.status,
      
      // Parse summary data (optimized for size)
      jobHistory: this.parseMetadataField(metadata, 'jobHistory_summary', []),
      educationHistory: this.parseMetadataField(metadata, 'educationHistory_summary', []),
      certifications: this.parseMetadataField(metadata, 'certifications_summary', []),
      projects: this.parseMetadataField(metadata, 'projects_summary', []),
      portfolioLinks: this.parseMetadataField(metadata, 'portfolioLinks_summary', {}),
      
      // AI insights
      aiSummary: metadata.aiSummary_full || metadata.aiSummary || '',
      aiStrengths: metadata.aiStrengths || [],
      aiFlags: metadata.aiFlags || [],
      
      // Summary fields (already simple types)
      totalYearsExp: metadata.totalYearsExp,
      companiesWorkedAt: metadata.companiesWorkedAt,
      positionsHeld: metadata.positionsHeld,
      technologiesUsed: metadata.technologiesUsed,
      dataCompleteness: metadata.dataCompleteness,
      comprehensivenessScore: metadata.comprehensivenessScore,
      
      // Flags and counts
      hasLeadershipExp: metadata.hasLeadershipExp,
      hasCertifications: metadata.hasCertifications,
      hasProjects: metadata.hasProjects,
      hasGithub: metadata.hasGithub,
      hasLinkedIn: metadata.hasLinkedIn,
      hasPortfolio: metadata.hasPortfolio,
      
      // Note: This is SUMMARY data only
      // For complete candidate details, fetch from MongoDB using candidateId
      _isPartialData: true,
      _fetchCompleteFrom: 'mongodb'
    };
  }
}

module.exports = new EmbeddingService(); 