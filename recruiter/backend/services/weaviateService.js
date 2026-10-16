const weaviate = require('weaviate-ts-client');
const { getEmbeddingRuntimeConfig } = require('../config/embeddingRuntimeConfig');
const { mongoIdToUuid } = require('../utils/uuidHelper');

class WeaviateService {
  constructor() {
    try {
      // Local dev: "weaviate" hostname only resolves inside Docker; use server IP instead
      let host = process.env.WEAVIATE_HOST || 'localhost:8080';
      if (process.env.NODE_ENV === 'development' && (host.startsWith('weaviate') || host === 'weaviate')) {
        host = 'localhost:8080';
        console.log('🔧 Weaviate: using the local forwarded port for development');
      }
      this.client = weaviate.default.client({
        scheme: process.env.WEAVIATE_SCHEME || 'http',
        host,
        headers: {
          'Authorization': `Bearer ${process.env.WEAVIATE_API_KEY}`
        }
      });
      console.log('✅ Weaviate client initialized (host:', host, ')');
    } catch (error) {
      console.error('❌ Failed to initialize Weaviate client:', error);
      this.client = null;
    }
  }
  
  get candidateClass() { return getEmbeddingRuntimeConfig().candidateClass || 'Candidate'; }
  get jobClass() { return getEmbeddingRuntimeConfig().jobClass || 'Job'; }
  validateVector(vector) {
    const config = getEmbeddingRuntimeConfig();
    if (config.provider === 'nomic-node' && (!Array.isArray(vector) || vector.length !== config.dimensions || vector.some(value => !Number.isFinite(value)))) throw new Error('Embedding vector does not match the active Nomic profile.');
  }

  /**
   * Convert MongoDB ID to UUID for Weaviate
   */
  _toUuid(mongoId) {
    return mongoIdToUuid(mongoId);
  }

  /**
   * Store candidate embedding in Weaviate (with upsert support)
   */
  async storeCandidateEmbedding(candidateId, embedding, metadata) {
    this.validateVector(embedding);
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    const uuid = this._toUuid(candidateId);
    const properties = {
      candidateId: candidateId, // Keep original MongoDB ID for reference
      organizationId: metadata.organizationId || '',
      firstName: metadata.firstName || '',
      lastName: metadata.lastName || '',
      email: metadata.email || '',
      position: metadata.position || '',
      location: metadata.location || '',
      phone: metadata.phone || '',
      resumeText: (metadata.resumeText || '').substring(0, 50000),
      coverLetter: (metadata.coverLetter || '').substring(0, 10000),
      skills: Array.isArray(metadata.skills) ? metadata.skills : [],
      totalYearsExperience: Number(metadata.totalYearsExp ?? metadata.totalYearsExperience ?? 0) || 0,
      jobHistory: typeof metadata.jobHistory_summary === 'string'
        ? metadata.jobHistory_summary
        : JSON.stringify(metadata.jobHistory || []),
      education: typeof metadata.educationHistory_summary === 'string'
        ? metadata.educationHistory_summary
        : JSON.stringify(metadata.education || []),
      aiSummary: metadata.aiSummary || '',
      strengths: Array.isArray(metadata.aiStrengths)
        ? metadata.aiStrengths
        : (Array.isArray(metadata.strengths) ? metadata.strengths : []),
      updatedAt: new Date().toISOString(),
      isActive: true,
      fullMetadata: JSON.stringify(metadata),
      ...(getEmbeddingRuntimeConfig().provider === 'nomic-node' ? { embeddingProfile: getEmbeddingRuntimeConfig().vectorIndexVersion, embeddingSourceHash: metadata.embeddingSourceHash || '' } : {}), // NO SIZE LIMIT!
    };
    
    try {
      // Try to create first
      await this.client.data
        .creator()
        .withClassName(this.candidateClass)
        .withId(uuid)
        .withVector(embedding)
        .withProperties({
          ...properties,
          createdAt: new Date().toISOString(),
        })
        .do();
      
      console.log(`✅ Stored candidate ${candidateId} in Weaviate (created)`);
      return true;
    } catch (error) {
      // If already exists, update instead
      if (error.message && error.message.includes('already exists')) {
        try {
          // Delete and recreate (Weaviate doesn't support true upsert with vector update)
          await this.client.data
            .deleter()
            .withClassName(this.candidateClass)
            .withId(uuid)
            .do();
          
          await this.client.data
            .creator()
            .withClassName(this.candidateClass)
            .withId(uuid)
            .withVector(embedding)
            .withProperties({
              ...properties,
              createdAt: new Date().toISOString(),
            })
            .do();
          
          console.log(`✅ Stored candidate ${candidateId} in Weaviate (updated)`);
          return true;
        } catch (updateError) {
          console.error(`❌ Error updating candidate ${candidateId} in Weaviate:`, updateError.message);
          throw updateError;
        }
      }
      console.error(`❌ Error storing candidate ${candidateId} in Weaviate:`, error.message);
      throw error;
    }
  }

  /**
   * Search similar candidates using vector search
   */
  async searchSimilarCandidates(queryEmbedding, organizationId = null, topK = 10) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      let query = this.client.graphql
        .get()
        .withClassName(this.candidateClass)
        .withNearVector({ vector: queryEmbedding })
        .withLimit(topK)
        .withFields('candidateId organizationId firstName lastName email position skills totalYearsExperience aiSummary strengths location _additional { distance certainty }');

      // Add organization filter if provided
      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      
      const candidates = result.data?.Get?.[this.candidateClass] || [];
      console.log(`🔍 Found ${candidates.length} candidates in Weaviate ${organizationId ? `for org ${organizationId}` : 'globally'}`);
      
      return candidates;
    } catch (error) {
      console.error('❌ Error searching candidates in Weaviate:', error.message);
      throw error;
    }
  }

  /**
   * Fetch an already-generated job vector so quick matching does not pay for
   * the same embedding again on every cache miss.
   */
  async getJobVector(jobId) {
    if (!this.client) throw new Error('Weaviate client not initialized');

    try {
      const result = await this.client.data
        .getterById()
        .withClassName(this.jobClass)
        .withId(this._toUuid(jobId))
        .withVector()
        .do();
      return Array.isArray(result?.vector) && result.vector.length ? result.vector : null;
    } catch (error) {
      if (error.message?.includes('not found')) return null;
      throw error;
    }
  }

  /**
   * Hybrid search (vector + keyword) for better results
   */
  async hybridSearchCandidates(queryText, queryEmbedding, organizationId = null, topK = 10, alpha = 0.5) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      let query = this.client.graphql
        .get()
        .withClassName(this.candidateClass)
        .withHybrid({
          query: queryText,
          vector: queryEmbedding,
          alpha: alpha, // 0 = pure keyword, 1 = pure vector, 0.5 = balanced
        })
        .withLimit(topK)
        .withFields('candidateId organizationId firstName lastName position skills resumeText totalYearsExperience _additional { distance score }');

      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      
      const candidates = result.data?.Get?.[this.candidateClass] || [];
      console.log(`🔍 Hybrid search found ${candidates.length} candidates`);
      
      return candidates;
    } catch (error) {
      console.error('❌ Error in hybrid search:', error.message);
      throw error;
    }
  }

  /**
   * Check if candidate exists in Weaviate
   */
  async checkCandidateExists(candidateId) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      const uuid = this._toUuid(candidateId);
      const result = await this.client.data
        .getterById()
        .withClassName(this.candidateClass)
        .withId(uuid)
        .do();
      
      return !!result;
    } catch (error) {
      if (error.message && error.message.includes('not found')) {
        return false;
      }
      console.error(`Error checking candidate existence: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete candidate from Weaviate
   */
  async deleteCandidate(candidateId) {
    return this.deleteFromAllProfiles(candidateId, ['Candidate', 'RecruiterCandidateNomicV1']);
  }

  async deleteFromAllProfiles(entityId, classes) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    const schema = await this.client.schema.getter().do();
    const present = new Set(schema.classes.map(item => item.class));
    for (const className of classes.filter(name => present.has(name))) {
      try { await this.client.data.deleter().withClassName(className).withId(this._toUuid(entityId)).do(); }
      catch (error) { if (!/not found|404/i.test(error.message || '')) throw error; }
    }
    return true;
  }

  /**
   * Store job embedding in Weaviate (with upsert support)
   */
  async storeJobEmbedding(jobId, embedding, metadata) {
    this.validateVector(embedding);
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    const uuid = this._toUuid(jobId);
    const properties = {
      jobId: jobId, // Keep original MongoDB ID for reference
      organizationId: metadata.organizationId || '',
      title: metadata.title || '',
      department: String(metadata.department || ''),
      location: metadata.location || '',
      type: metadata.type || metadata.jobType || '',
      level: metadata.level || '',
      description: (metadata.description || '').substring(0, 20000),
      requirements: (metadata.requirements || '').substring(0, 10000),
      responsibilities: (metadata.responsibilities || '').substring(0, 10000),
      requiredSkills: Array.isArray(metadata.requiredSkills)
        ? metadata.requiredSkills
        : (Array.isArray(metadata.skills) ? metadata.skills : []),
      preferredSkills: Array.isArray(metadata.preferredSkills) ? metadata.preferredSkills : [],
      salaryMin: metadata.salaryMin || 0,
      salaryMax: metadata.salaryMax || 0,
      salaryCurrency: metadata.salaryCurrency || 'USD',
      updatedAt: new Date().toISOString(),
      isActive: true,
      status: metadata.status || 'active',
      fullMetadata: JSON.stringify(metadata),
      ...(getEmbeddingRuntimeConfig().provider === 'nomic-node' ? { embeddingProfile: getEmbeddingRuntimeConfig().vectorIndexVersion, embeddingSourceHash: metadata.embeddingSourceHash || '' } : {}),
    };
    
    try {
      // Try to create first
      await this.client.data
        .creator()
        .withClassName(this.jobClass)
        .withId(uuid)
        .withVector(embedding)
        .withProperties({
          ...properties,
          createdAt: new Date().toISOString(),
        })
        .do();
      
      console.log(`✅ Stored job ${jobId} in Weaviate (created)`);
      return true;
    } catch (error) {
      // If already exists, update instead
      if (error.message && error.message.includes('already exists')) {
        try {
          // Delete and recreate (Weaviate doesn't support true upsert with vector update)
          await this.client.data
            .deleter()
            .withClassName(this.jobClass)
            .withId(uuid)
            .do();
          
          await this.client.data
            .creator()
            .withClassName(this.jobClass)
            .withId(uuid)
            .withVector(embedding)
            .withProperties({
              ...properties,
              createdAt: new Date().toISOString(),
            })
            .do();
          
          console.log(`✅ Stored job ${jobId} in Weaviate (updated)`);
          return true;
        } catch (updateError) {
          console.error(`❌ Error updating job ${jobId} in Weaviate:`, updateError.message);
          throw updateError;
        }
      }
      console.error(`❌ Error storing job ${jobId} in Weaviate:`, error.message);
      throw error;
    }
  }

  /**
   * Search similar jobs
   */
  async searchSimilarJobs(queryEmbedding, organizationId = null, topK = 10) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      let query = this.client.graphql
        .get()
        .withClassName(this.jobClass)
        .withNearVector({ vector: queryEmbedding })
        .withLimit(topK)
        .withFields('jobId organizationId title department location requiredSkills _additional { distance certainty }');

      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      
      const jobs = result.data?.Get?.[this.jobClass] || [];
      console.log(`🔍 Found ${jobs.length} jobs in Weaviate`);
      
      return jobs;
    } catch (error) {
      console.error('❌ Error searching jobs in Weaviate:', error.message);
      throw error;
    }
  }

  /**
   * Check if job exists
   */
  async checkJobExists(jobId) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      const uuid = this._toUuid(jobId);
      const result = await this.client.data
        .getterById()
        .withClassName(this.jobClass)
        .withId(uuid)
        .do();
      
      return !!result;
    } catch (error) {
      if (error.message && error.message.includes('not found')) {
        return false;
      }
      return false;
    }
  }

  /**
   * Delete job from Weaviate
   */
  async deleteJob(jobId) {
    return this.deleteFromAllProfiles(jobId, ['Job', 'RecruiterJobNomicV1']);
  }

  /**
   * Get Weaviate stats
   */
  async getStats() {
    if (!this.client) return { candidates: 0, jobs: 0, error: 'Client not initialized' };
    
    try {
      const candidateStats = await this.client.graphql
        .aggregate()
        .withClassName(this.candidateClass)
        .withFields('meta { count }')
        .do();

      const jobStats = await this.client.graphql
        .aggregate()
        .withClassName(this.jobClass)
        .withFields('meta { count }')
        .do();

      return {
        candidates: candidateStats.data?.Aggregate?.[this.candidateClass]?.[0]?.meta?.count || 0,
        jobs: jobStats.data?.Aggregate?.[this.jobClass]?.[0]?.meta?.count || 0,
      };
    } catch (error) {
      console.error('Error getting Weaviate stats:', error.message);
      return { candidates: 0, jobs: 0, error: error.message };
    }
  }

  /**
   * Batch fetch candidates by MongoDB IDs
   * Used for AI ranking/matching
   */
  async batchFetchCandidates(candidateIds) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      // Convert MongoDB IDs to UUIDs
      const uuids = candidateIds.map(id => this._toUuid(id));
      
      // Fetch all candidates by UUID
      const results = [];
      for (const uuid of uuids) {
        try {
          const result = await this.client.data
            .getterById()
            .withClassName(this.candidateClass)
            .withId(uuid)
            .withVector()
            .do();
          
          if (result) {
            // Normalize to embeddingService match shape
            const fullMetadata = this._safeJsonParse(result.properties.fullMetadata) || {};
            results.push({
              id: result.properties.candidateId, // Original MongoDB ID
              values: result.vector,
              metadata: {
                ...fullMetadata,
                candidateId: result.properties.candidateId,
                organizationId: result.properties.organizationId,
                firstName: result.properties.firstName,
                lastName: result.properties.lastName,
                name: `${result.properties.firstName} ${result.properties.lastName}`.trim(),
                email: result.properties.email,
                position: result.properties.position,
                skills: result.properties.skills,
                totalYearsExp: result.properties.totalYearsExperience,
                experience: result.properties.totalYearsExperience,
                resumeText: result.properties.resumeText,
                aiSummary: result.properties.aiSummary,
                strengths: result.properties.strengths,
                // Parse complex fields from JSON
                education: this._safeJsonParse(result.properties.education),
                jobHistory: this._safeJsonParse(result.properties.jobHistory),
              }
            });
          }
        } catch (error) {
          // Skip candidates that don't exist
          if (!error.message?.includes('not found')) {
            console.error(`Error fetching candidate UUID ${uuid}:`, error.message);
          }
        }
      }
      
      console.log(`📦 Batch fetched ${results.length}/${candidateIds.length} candidates from Weaviate`);
      return results;
    } catch (error) {
      console.error('❌ Error in batch fetch:', error.message);
      throw error;
    }
  }

  /**
   * Batch insert candidates
   */
  async batchInsertCandidates(candidates) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      let batcher = this.client.batch.objectsBatcher();
      
      for (const candidate of candidates) {
        this.validateVector(candidate.vector);
        batcher = batcher.withObject({
          class: this.candidateClass,
          id: candidate.id,
          vector: candidate.vector,
          properties: candidate.properties,
        });
      }
      
      const result = await batcher.do();
      console.log(`✅ Batch inserted ${candidates.length} candidates`);
      return result;
    } catch (error) {
      console.error('❌ Error in batch insert:', error.message);
      throw error;
    }
  }
  
  /**
   * Safely parse JSON string
   */
  _safeJsonParse(jsonString) {
    try {
      return jsonString ? JSON.parse(jsonString) : null;
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
module.exports = new WeaviateService();
