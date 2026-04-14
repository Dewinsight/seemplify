const weaviate = require('weaviate-ts-client');
const { mongoIdToUuid } = require('../utils/uuidHelper');

class WeaviateService {
  constructor() {
    try {
      // Local dev: "weaviate" hostname only resolves inside Docker; use server IP instead
      let host = process.env.WEAVIATE_HOST || 'localhost:8080';
      if (process.env.NODE_ENV === 'development' && (host.startsWith('weaviate') || host === 'weaviate')) {
        host = '4.180.153.209:8080';
        console.log('🔧 Weaviate: using server IP for local dev (weaviate hostname not resolvable)');
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
      totalYearsExperience: metadata.totalYearsExperience || 0,
      jobHistory: JSON.stringify(metadata.jobHistory || []),
      education: JSON.stringify(metadata.education || []),
      aiSummary: metadata.aiSummary || '',
      strengths: Array.isArray(metadata.strengths) ? metadata.strengths : [],
      updatedAt: new Date().toISOString(),
      isActive: true,
      fullMetadata: JSON.stringify(metadata), // NO SIZE LIMIT!
    };
    
    try {
      // Try to create first
      await this.client.data
        .creator()
        .withClassName('Candidate')
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
            .withClassName('Candidate')
            .withId(uuid)
            .do();
          
          await this.client.data
            .creator()
            .withClassName('Candidate')
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
        .withClassName('Candidate')
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
      
      const candidates = result.data?.Get?.Candidate || [];
      console.log(`🔍 Found ${candidates.length} candidates in Weaviate ${organizationId ? `for org ${organizationId}` : 'globally'}`);
      
      return candidates;
    } catch (error) {
      console.error('❌ Error searching candidates in Weaviate:', error.message);
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
        .withClassName('Candidate')
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
      
      const candidates = result.data?.Get?.Candidate || [];
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
        .withClassName('Candidate')
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
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      const uuid = this._toUuid(candidateId);
      
      await this.client.data
        .deleter()
        .withClassName('Candidate')
        .withId(uuid)
        .do();
      
      console.log(`✅ Deleted candidate ${candidateId} from Weaviate`);
      return true;
    } catch (error) {
      // Don't throw if not found - just log
      if (error.message && error.message.includes('not found')) {
        console.log(`ℹ️ Candidate ${candidateId} not found in Weaviate (already deleted)`);
        return true;
      }
      console.error(`❌ Error deleting candidate from Weaviate: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store job embedding in Weaviate (with upsert support)
   */
  async storeJobEmbedding(jobId, embedding, metadata) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    const uuid = this._toUuid(jobId);
    const properties = {
      jobId: jobId, // Keep original MongoDB ID for reference
      organizationId: metadata.organizationId || '',
      title: metadata.title || '',
      department: metadata.department || '',
      location: metadata.location || '',
      type: metadata.type || '',
      level: metadata.level || '',
      description: (metadata.description || '').substring(0, 20000),
      requirements: (metadata.requirements || '').substring(0, 10000),
      responsibilities: (metadata.responsibilities || '').substring(0, 10000),
      requiredSkills: Array.isArray(metadata.requiredSkills) ? metadata.requiredSkills : [],
      preferredSkills: Array.isArray(metadata.preferredSkills) ? metadata.preferredSkills : [],
      salaryMin: metadata.salaryMin || 0,
      salaryMax: metadata.salaryMax || 0,
      salaryCurrency: metadata.salaryCurrency || 'USD',
      updatedAt: new Date().toISOString(),
      isActive: true,
      status: metadata.status || 'active',
      fullMetadata: JSON.stringify(metadata),
    };
    
    try {
      // Try to create first
      await this.client.data
        .creator()
        .withClassName('Job')
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
            .withClassName('Job')
            .withId(uuid)
            .do();
          
          await this.client.data
            .creator()
            .withClassName('Job')
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
        .withClassName('Job')
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
      
      const jobs = result.data?.Get?.Job || [];
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
        .withClassName('Job')
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
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      const uuid = this._toUuid(jobId);
      
      await this.client.data
        .deleter()
        .withClassName('Job')
        .withId(uuid)
        .do();
      
      console.log(`✅ Deleted job ${jobId} from Weaviate`);
      return true;
    } catch (error) {
      console.error(`❌ Error deleting job from Weaviate: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Weaviate stats
   */
  async getStats() {
    if (!this.client) return { candidates: 0, jobs: 0, error: 'Client not initialized' };
    
    try {
      const candidateStats = await this.client.graphql
        .aggregate()
        .withClassName('Candidate')
        .withFields('meta { count }')
        .do();

      const jobStats = await this.client.graphql
        .aggregate()
        .withClassName('Job')
        .withFields('meta { count }')
        .do();

      return {
        candidates: candidateStats.data?.Aggregate?.Candidate?.[0]?.meta?.count || 0,
        jobs: jobStats.data?.Aggregate?.Job?.[0]?.meta?.count || 0,
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
            .withClassName('Candidate')
            .withId(uuid)
            .withVector()
            .do();
          
          if (result) {
            // Normalize to embeddingService match shape
            results.push({
              id: result.properties.candidateId, // Original MongoDB ID
              values: result.vector,
              metadata: {
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
        batcher = batcher.withObject({
          class: 'Candidate',
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
