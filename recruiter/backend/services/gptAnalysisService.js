const crypto = require('crypto');
const aiRuntimeService = require('./aiRuntime/aiRuntimeService');
const { CHATGPT_MODEL } = require('../config/aiRuntimeCatalog');

const MATCH_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis'],
  properties: {
    analysis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidate_id', 'candidate_name', 'skill_match_percentage', 'experience_fit',
          'technical_strengths', 'skill_gaps', 'transferable_skills', 'cultural_alignment',
          'growth_potential', 'interview_focus', 'contextual_explanation', 'confidence_score'
        ],
        properties: {
          candidate_id: { type: 'string' },
          candidate_name: { type: 'string' },
          skill_match_percentage: { type: 'number', minimum: 0, maximum: 100 },
          experience_fit: { type: 'number', minimum: 1, maximum: 10 },
          technical_strengths: { type: 'array', items: { type: 'string' } },
          skill_gaps: { type: 'array', items: { type: 'string' } },
          transferable_skills: { type: 'array', items: { type: 'string' } },
          cultural_alignment: { type: 'number', minimum: 1, maximum: 10 },
          growth_potential: { type: 'number', minimum: 1, maximum: 10 },
          interview_focus: { type: 'array', items: { type: 'string' } },
          contextual_explanation: { type: 'string' },
          confidence_score: { type: 'number', minimum: 1, maximum: 10 }
        }
      }
    }
  }
};

class GPTAnalysisCache {
  constructor(namespace = 'ai-match-v1') {
    this.namespace = namespace;
    this.cache = new Map();
    this.candidateTimestamps = new Map(); // Track when candidates were added
    this.ttl = 24 * 60 * 60 * 1000; // 24 hours
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0
    };
  }

  // Cache model analysis for common patterns
  getCacheKey(job, candidate) {
    const jobHash = this.hashSkills(job.skills || []);
    const candidateHash = this.hashSkills(candidate.skills || []);
    return `${this.namespace}-${jobHash}-${candidateHash}-${job.level || 'any'}-${candidate.experience || 0}`;
  }

  // Create batch key for job-candidate group analysis
  getBatchKey(job, candidates) {
    const candidateIds = candidates.map(c => c._id || c.id).sort().join(',');
    return `${this.namespace}-job-batch-${job._id || job.id}-${candidateIds}`;
  }

  hashSkills(skills) {
    if (!Array.isArray(skills)) return 'no-skills';
    return crypto.createHash('md5').update([...skills].sort().join(',')).digest('hex').substring(0, 8);
  }

  // Track when candidates are added to ensure they're included in searches
  onCandidateAdded(candidateId, timestamp = Date.now()) {
    this.candidateTimestamps.set(candidateId.toString(), timestamp);
    
    // Invalidate job-level caches that might miss this new candidate
    this.invalidateJobCaches();
    
    console.log(`📋 New candidate ${candidateId} added - cache invalidated for fresh matching`);
  }

  // Invalidate caches that might miss new candidates
  invalidateJobCaches() {
    const keysToDelete = [];
    
    for (const [key, cached] of this.cache.entries()) {
      // Invalidate job-level batch analyses that might miss new candidates
      if (key.includes('job-batch-') || key.includes('ranking-')) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    this.stats.invalidations += keysToDelete.length;
    console.log(`🗑️ Invalidated ${keysToDelete.length} job-level caches for new candidates`);
  }

  // Check if candidate was added after cache entry
  isCacheStaleForNewCandidates(cacheTimestamp, candidateIds) {
    return candidateIds.some(id => {
      const candidateAddedTime = this.candidateTimestamps.get(id.toString());
      return candidateAddedTime && candidateAddedTime > cacheTimestamp;
    });
  }

  async getOrAnalyze(job, candidate, analyzer) {
    const key = this.getCacheKey(job, candidate);
    
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      const isExpired = Date.now() - cached.timestamp > this.ttl;
      
      if (!isExpired) {
        this.stats.hits++;
        return cached.analysis;
      }
    }
    
    this.stats.misses++;
    const analysis = await analyzer(job, candidate);
    this.cache.set(key, { analysis, timestamp: Date.now() });
    return analysis;
  }

  // Enhanced batch analysis with new candidate awareness
  async getOrAnalyzeBatch(job, candidates, batchAnalyzer) {
    const batchKey = this.getBatchKey(job, candidates);
    
    if (this.cache.has(batchKey)) {
      const cached = this.cache.get(batchKey);
      const isExpired = Date.now() - cached.timestamp > this.ttl;
      
      // Check if any candidates were added after this cache entry
      const candidateIds = candidates.map(c => (c._id || c.id).toString());
      const isStale = this.isCacheStaleForNewCandidates(cached.timestamp, candidateIds);
      
      if (!isExpired && !isStale) {
        console.log(`💾 Cache hit for batch analysis (${candidates.length} candidates)`);
        this.stats.hits++;
        return cached.analysis;
      } else if (isStale) {
        console.log(`🔄 Cache stale due to new candidates - reanalyzing batch`);
      }
    }
    
    console.log(`🧠 LLM analyzing batch of ${candidates.length} candidates...`);
    this.stats.misses++;
    const analysis = await batchAnalyzer(job, candidates);
    
    this.cache.set(batchKey, { 
      analysis, 
      timestamp: Date.now(),
      candidateIds: candidates.map(c => (c._id || c.id).toString())
    });
    
    return analysis;
  }

  // Cleanup old entries
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    
    // Also cleanup old candidate timestamps (keep last 30 days)
    const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
    for (const [candidateId, timestamp] of this.candidateTimestamps.entries()) {
      if (timestamp < monthAgo) {
        this.candidateTimestamps.delete(candidateId);
      }
    }
    
    console.log(`🧹 Cleaned up ${keysToDelete.length} expired cache entries`);
  }

  logStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : 0;
    
    console.log(`📊 Cache Stats - Hit Rate: ${hitRate}% (${this.stats.hits}/${total}), Invalidations: ${this.stats.invalidations}`);
  }
}

class GPTAnalysisService {
  constructor() {
    this.modelName = CHATGPT_MODEL;
    
    this.cache = new GPTAnalysisCache(`chatgpt-connect:${CHATGPT_MODEL}:route-v2:prompt-v3`);
    const matchingToggle = process.env.ENABLE_LLM_MATCHING ?? process.env.ENABLE_GPT_MATCHING ?? 'false';
    this.isEnabled = matchingToggle === 'true';
    
    // Setup cleanup interval (run every 6 hours)
    this.cleanupTimer = setInterval(() => this.cache.cleanup(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
    
    console.log(`🚀 AI analysis service initialized - Enabled: ${this.isEnabled}, Model: ${this.modelName}`);
  }

  async refreshCacheNamespace() {
    const settings = await aiRuntimeService.getSettings();
    const route = settings.routes.find((item) => item.activity === 'matching.analysis');
    if (!route) return;
    this.modelName = route.model;
    this.cache.namespace = `${route.provider}:${route.model}:route-v${route.routeVersion || 1}:prompt-v3`;
  }

  // Batch analyze candidates for a job with rich contextual insights
  async batchAnalyzeCandidates(job, candidates) {
    if (!this.isEnabled) {
      console.log('📴 AI analysis disabled - falling back to legacy explanations');
      return this.generateLegacyExplanations(job, candidates);
    }

    try {
      await this.refreshCacheNamespace();
      // Use caching for batch analysis
      return await this.cache.getOrAnalyzeBatch(job, candidates, async (job, candidates) => {
        const startTime = Date.now();
        
        const prompt = this.buildBatchAnalysisPrompt(job, candidates);
        
        const response = (await aiRuntimeService.structuredComplete('matching.analysis', {
          promptVersion: 'matching-v3',
          model: this.modelName,
          messages: [
            {
              role: "system",
              content: "You are an expert technical recruiter and HR specialist. Analyze job-candidate matches with deep insights about technical skills, cultural fit, growth potential, and interview focus areas. Always respond in valid JSON format."
            },
            {
              role: "user", 
              content: prompt
            }
          ],
          jsonSchema: MATCH_ANALYSIS_SCHEMA,
          schemaName: 'matching_analysis',
          schemaStrict: true,
          temperature: 0.6 // Increased for faster decision-making while maintaining accuracy
        })).raw;

        const analysis = JSON.parse(response.choices[0].message.content);
        this.validateCandidateAlignment(analysis, candidates);
        const processingTime = Date.now() - startTime;
        
        console.log(`⚡ LLM batch analysis completed in ${processingTime}ms for ${candidates.length} candidates`);
        
        return this.formatBatchAnalysisResponse(analysis, candidates);
      });
      
    } catch (error) {
      console.error('❌ LLM analysis failed:', error);
      console.log('🔄 Falling back to legacy explanations');
      return this.generateLegacyExplanations(job, candidates);
    }
  }

  buildBatchAnalysisPrompt(job, candidates) {
    // Handle job.skills - could be string or array
    const jobSkills = this.normalizeSkills(job.skills);
    
    return `Analyze these ${candidates.length} candidates for the following position:

**JOB DETAILS:**
Title: ${job.title}
Level: ${job.level || 'Not specified'}
Required Skills: ${jobSkills.join(', ') || 'Not specified'}
Experience Required: ${job.experience || 'Not specified'} years
Location: ${job.location || 'Not specified'}
Department: ${job.department || 'Not specified'}
Job Type: ${job.type || 'Not specified'}

**REQUIREMENTS:**
${job.requirements || 'See skills above'}

**CANDIDATES:**
${candidates.map((candidate, index) => {
  const candidateSkills = this.normalizeSkills(candidate.skills);
  return `
${index + 1}. **${candidate.name}**
   - Candidate ID: ${this.candidateIdentifier(candidate, index)}
   - Skills: ${candidateSkills.join(', ') || 'Not specified'}
   - Experience: ${candidate.experience || 'Not specified'} years
   - Location: ${candidate.location || 'Not specified'}
   - Current Role: ${candidate.currentRole || 'Not specified'}
   - Education: ${candidate.education || 'Not specified'}
   - Bio: ${candidate.bio || 'No bio available'}`;
}).join('\n')}

**ANALYSIS REQUESTED:**
For each candidate, provide a comprehensive analysis including:

1. **skill_match_percentage** (0-100): How well their skills align with requirements
2. **experience_fit** (1-10): How well their experience level matches the role
3. **technical_strengths**: Array of their strongest technical assets
4. **skill_gaps**: Array of missing or weak skills for this role
5. **transferable_skills**: Skills that aren't exact matches but are valuable
6. **cultural_alignment** (1-10): Likely fit with role/company based on background
7. **growth_potential** (1-10): Potential for growth in this role
8. **interview_focus**: Array of 3-4 specific questions/topics to explore
9. **contextual_explanation**: 2-3 sentences explaining why they're a good/poor match
10. **confidence_score** (1-10): How confident you are in this assessment

Return as JSON in this exact format:
{
  "analysis": [
    {
      "candidate_id": "copy the exact Candidate ID supplied above",
      "candidate_name": "Name",
      "skill_match_percentage": 85,
      "experience_fit": 8,
      "technical_strengths": ["React", "Node.js", "AWS"],
      "skill_gaps": ["Kubernetes", "GraphQL"],
      "transferable_skills": ["Angular experience transfers to React"],
      "cultural_alignment": 9,
      "growth_potential": 8,
      "interview_focus": [
        "Ask about scaling React applications",
        "Discuss AWS deployment experience",
        "Explore leadership aspirations"
      ],
      "contextual_explanation": "Strong technical foundation with React and Node.js directly matching requirements. Startup background suggests good adaptability for fast-paced environment.",
      "confidence_score": 9
    }
  ]
}`;
  }

  candidateIdentifier(candidate, index) {
    return String(candidate?._id || candidate?.id || `candidate-${index + 1}`);
  }

  validateCandidateAlignment(gptAnalysis, candidates) {
    if (!Array.isArray(gptAnalysis?.analysis) || gptAnalysis.analysis.length !== candidates.length) {
      throw new Error('Matching analysis did not return exactly one result per candidate');
    }
    const expectedIds = candidates.map((candidate, index) => this.candidateIdentifier(candidate, index));
    const returnedIds = gptAnalysis.analysis.map((item) => String(item?.candidate_id || ''));
    if (new Set(returnedIds).size !== returnedIds.length || expectedIds.some((id) => !returnedIds.includes(id))) {
      throw new Error('Matching analysis candidate IDs do not exactly match the supplied candidates');
    }
  }

  formatBatchAnalysisResponse(gptAnalysis, candidates) {
    const formatted = candidates.map((candidate, index) => {
      const candidateId = this.candidateIdentifier(candidate, index);
      const analysis = gptAnalysis.analysis.find((item) => String(item.candidate_id || '') === candidateId);
      if (!analysis) throw new Error(`Matching analysis is missing candidate ${candidateId}`);
      const vectorScore = Math.max(0, Math.min(1, Number(candidate.score ?? candidate.relevanceScore ?? 0)));
      
      return {
        candidate: candidate,
        gptAnalysis: {
          skillMatchPercentage: analysis.skill_match_percentage,
          experienceFit: analysis.experience_fit,
          technicalStrengths: analysis.technical_strengths,
          skillGaps: analysis.skill_gaps,
          transferableSkills: analysis.transferable_skills,
          culturalAlignment: analysis.cultural_alignment,
          growthPotential: analysis.growth_potential,
          interviewFocus: analysis.interview_focus,
          explanation: analysis.contextual_explanation,
          confidenceScore: analysis.confidence_score
        },
        // Calculate enhanced relevance score
        relevanceScore: this.calculateEnhancedRelevanceScore(analysis, vectorScore)
      };
    });

    return formatted.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  calculateEnhancedRelevanceScore(gptAnalysis, vectorScore) {
    // Combine vector similarity with GPT insights for final score
    const skillWeight = 0.4;
    const experienceWeight = 0.25;
    const culturalWeight = 0.2;
    const growthWeight = 0.15;

    const skillScore = (gptAnalysis.skill_match_percentage || 0) / 100;
    const experienceScore = (gptAnalysis.experience_fit || 5) / 10;
    const culturalScore = (gptAnalysis.cultural_alignment || 5) / 10;
    const growthScore = (gptAnalysis.growth_potential || 5) / 10;

    const gptScore = (
      skillScore * skillWeight +
      experienceScore * experienceWeight +
      culturalScore * culturalWeight +
      growthScore * growthWeight
    );

    // Combine with vector score (70% GPT insights, 30% semantic similarity)
    return (gptScore * 0.7) + (vectorScore * 0.3);
  }

  // Helper method to normalize skills (handle both string and array)
  normalizeSkills(skills) {
    if (!skills) return [];
    if (Array.isArray(skills)) return skills;
    if (typeof skills === 'string') {
      return skills.split(',').map(skill => skill.trim()).filter(skill => skill.length > 0);
    }
    return [];
  }

  // Fallback to legacy explanations if GPT fails
  generateLegacyExplanations(job, candidates) {
    return candidates.map(candidate => {
      const vectorScore = Math.max(0, Math.min(1, Number(candidate.score || candidate.relevanceScore || 0)));
      return {
      candidate: candidate,
      gptAnalysis: {
        skillMatchPercentage: Math.round(vectorScore * 100),
        experienceFit: null,
        technicalStrengths: candidate.skills || [],
        skillGaps: [],
        transferableSkills: [],
        culturalAlignment: null,
        growthPotential: null,
        interviewFocus: [],
        explanation: 'AI analysis is unavailable. This result uses semantic vector similarity only.',
        confidenceScore: 0,
        fallback: 'vector_only'
      },
      relevanceScore: vectorScore
    };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  // Individual candidate analysis (for detailed views)
  async analyzeSingleCandidate(job, candidate) {
    if (!this.isEnabled) {
      return this.generateLegacyExplanations(job, [candidate])[0];
    }

    await this.refreshCacheNamespace();
    return await this.cache.getOrAnalyze(job, candidate, async (job, candidate) => {
      const batchResult = await this.batchAnalyzeCandidates(job, [candidate]);
      return batchResult[0];
    });
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    this.cache.logStats();
    return {
      hitRate: this.cache.stats.hits / (this.cache.stats.hits + this.cache.stats.misses) * 100,
      totalRequests: this.cache.stats.hits + this.cache.stats.misses,
      cacheSize: this.cache.cache.size,
      candidatesTracked: this.cache.candidateTimestamps.size
    };
  }
}

// Singleton instance
const gptAnalysisService = new GPTAnalysisService();

module.exports = gptAnalysisService;
module.exports.GPTAnalysisService = GPTAnalysisService;
module.exports.GPTAnalysisCache = GPTAnalysisCache;
