const weaviate = require('weaviate-ts-client');

class WeaviateService {
  constructor() {
    try {
      this.client = weaviate.default.client({
        scheme: process.env.WEAVIATE_SCHEME || 'http',
        host: process.env.WEAVIATE_HOST || 'localhost:8080',
        headers: {
          'Authorization': `Bearer ${process.env.WEAVIATE_API_KEY}`
        }
      });
      console.log('✅ Weaviate client initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Weaviate client:', error);
      this.client = null;
    }
  }

  /**
   * Store candidate embedding in Weaviate
   */
  async storeCandidateEmbedding(candidateId, embedding, metadata) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      await this.client.data
        .creator()
        .withClassName('Candidate')
        .withId(candidateId)
        .withVector(embedding)
        .withProperties({
          candidateId: candidateId,
          organizationId: metadata.organizationId || '',
          firstName: metadata.firstName || '',
          lastName: metadata.lastName || '',
          email: metadata.email || '',
          position: metadata.position || '',
          resumeText: (metadata.resumeText || '').substring(0, 50000), // Limit to 50k chars
          coverLetter: (metadata.coverLetter || '').substring(0, 10000),
          skills: Array.isArray(metadata.skills) ? metadata.skills : [],
          totalYearsExperience: metadata.totalYearsExperience || 0,
          jobHistory: JSON.stringify(metadata.jobHistory || []),
          education: JSON.stringify(metadata.education || []),
          aiSummary: metadata.aiSummary || '',
          strengths: Array.isArray(metadata.strengths) ? metadata.strengths : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true,
          fullMetadata: JSON.stringify(metadata), // NO SIZE LIMIT!
        })
        .do();
      
      console.log(`✅ Stored candidate ${candidateId} in Weaviate`);
      return true;
    } catch (error) {
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
        .withFields('candidateId organizationId firstName lastName position skills totalYearsExperience _additional { distance certainty }');

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
      const result = await this.client.data
        .getterById()
        .withClassName('Candidate')
        .withId(candidateId)
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
      await this.client.data
        .deleter()
        .withClassName('Candidate')
        .withId(candidateId)
        .do();
      
      console.log(`✅ Deleted candidate ${candidateId} from Weaviate`);
      return true;
    } catch (error) {
      console.error(`❌ Error deleting candidate from Weaviate: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store job embedding in Weaviate
   */
  async storeJobEmbedding(jobId, embedding, metadata) {
    if (!this.client) throw new Error('Weaviate client not initialized');
    
    try {
      await this.client.data
        .creator()
        .withClassName('Job')
        .withId(jobId)
        .withVector(embedding)
        .withProperties({
          jobId: jobId,
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true,
          status: metadata.status || 'active',
          fullMetadata: JSON.stringify(metadata),
        })
        .do();
      
      console.log(`✅ Stored job ${jobId} in Weaviate`);
      return true;
    } catch (error) {
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
      const result = await this.client.data
        .getterById()
        .withClassName('Job')
        .withId(jobId)
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
      await this.client.data
        .deleter()
        .withClassName('Job')
        .withId(jobId)
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
}

// Export singleton instance
module.exports = new WeaviateService();
