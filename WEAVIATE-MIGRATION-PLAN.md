# Weaviate Migration Plan - Replace Pinecone

**Goal:** Deploy Weaviate in Dokploy and migrate from Pinecone to eliminate costs and gain better features.

**Status:** Planning Phase  
**Expected Savings:** $70-100/month  
**Timeline:** 2-3 days

---

## Table of Contents
1. [Overview](#overview)
2. [Phase 1: Deploy Weaviate](#phase-1-deploy-weaviate-in-dokploy)
3. [Phase 2: Schema Setup](#phase-2-schema-setup)
4. [Phase 3: Code Migration](#phase-3-code-migration)
5. [Phase 4: Data Migration](#phase-4-data-migration)
6. [Phase 5: Testing](#phase-5-testing)
7. [Phase 6: Production Cutover](#phase-6-production-cutover)
8. [Rollback Plan](#rollback-plan)
9. [Post-Migration](#post-migration)

---

## Overview

### Current State (Pinecone)
- **Service:** Pinecone Serverless
- **Indexes:** 
  - `candidates` (3072 dimensions)
  - `jobs` (3072 dimensions)
- **Operations:** Upsert, Query, Fetch, Delete
- **Filtering:** Organization-based filtering
- **Cost:** ~$70-100/month
- **Limitations:** 40KB metadata limit

### Target State (Weaviate)
- **Service:** Self-hosted Weaviate in Dokploy
- **Collections:** 
  - `Candidate` (3072 dimensions)
  - `Job` (3072 dimensions)
- **Operations:** Same + Hybrid Search
- **Filtering:** Complex filters with GraphQL
- **Cost:** $0 (uses existing VM)
- **Benefits:** No metadata limits, hybrid search, better filtering

### Why Migrate?
✅ **Cost Savings:** $840-1200/year  
✅ **No Metadata Limits:** Store unlimited candidate data  
✅ **Hybrid Search:** Combine vector + keyword search  
✅ **Better Filtering:** Complex AND/OR queries  
✅ **Self-Hosted:** Full control, no vendor lock-in  
✅ **Faster:** Internal Docker network = lower latency  

---

## Phase 1: Deploy Weaviate in Dokploy

### Step 1.1: Create Docker Compose File

Create `weaviate/docker-compose.yml`:

```yaml
version: '3.8'

services:
  weaviate:
    image: semitechnologies/weaviate:1.24.0
    container_name: weaviate
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "50051:50051"  # gRPC port
    environment:
      # Persistence
      PERSISTENCE_DATA_PATH: /var/lib/weaviate
      
      # Query defaults
      QUERY_DEFAULTS_LIMIT: 25
      
      # Authentication - Start with anonymous, add auth later
      AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED: 'true'
      AUTHENTICATION_APIKEY_ENABLED: 'true'
      AUTHENTICATION_APIKEY_ALLOWED_KEYS: '${WEAVIATE_API_KEY}'
      AUTHENTICATION_APIKEY_USERS: 'seemplify-admin'
      
      # Vectorizer - We use Azure OpenAI externally
      DEFAULT_VECTORIZER_MODULE: 'none'
      
      # No modules needed (we generate embeddings ourselves)
      ENABLE_MODULES: ''
      
      # Cluster settings
      CLUSTER_HOSTNAME: 'node1'
      CLUSTER_GOSSIP_BIND_PORT: '7100'
      CLUSTER_DATA_BIND_PORT: '7101'
      
      # Resource limits
      GOMEMLIMIT: '2GiB'
      GOGC: '100'
      
      # Logging
      LOG_LEVEL: 'info'
      LOG_FORMAT: 'text'
      
    volumes:
      - weaviate_data:/var/lib/weaviate
    
    networks:
      - dokploy-network
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/v1/.well-known/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

volumes:
  weaviate_data:
    driver: local

networks:
  dokploy-network:
    external: true
```

### Step 1.2: Deploy in Dokploy

**Option A: Via Dokploy UI**
1. Go to Dokploy dashboard: http://4.180.153.209:3000
2. Create New Application
3. Choose "Docker Compose"
4. Name: `weaviate`
5. Paste docker-compose.yml
6. Set Environment Variables:
   - `WEAVIATE_API_KEY`: Generate a secure key (e.g., `openssl rand -hex 32`)
7. Deploy

**Option B: Via PowerShell Script**

Create `scripts/deploy-weaviate.ps1`:
```powershell
# Deploy Weaviate to Dokploy
$DOKPLOY_URL = "http://4.180.153.209:3000"
$API_KEY = (openssl rand -hex 32)

Write-Host "🚀 Deploying Weaviate to Dokploy..." -ForegroundColor Cyan

# Login to Dokploy
$loginBody = @{ email = "admin@seemplifyai.com"; password = "Seemplify2026!" } | ConvertTo-Json
$session = Invoke-WebRequest -Uri "$DOKPLOY_URL/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -SessionVariable webSession

# Create Weaviate application
$createBody = @{
    name = "weaviate"
    appName = "weaviate"
    sourceType = "docker-compose"
    composeFile = (Get-Content "weaviate/docker-compose.yml" -Raw)
    env = "WEAVIATE_API_KEY=$API_KEY"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$DOKPLOY_URL/api/applications" -Method POST -Body $createBody -ContentType "application/json" -WebSession $webSession

Write-Host "✅ Weaviate deployed!" -ForegroundColor Green
Write-Host "API Key: $API_KEY" -ForegroundColor Yellow
Write-Host "Connection URL: http://weaviate:8080" -ForegroundColor Cyan
```

### Step 1.3: Verify Deployment

```bash
# SSH into server
ssh seemplify@4.180.153.209

# Check Weaviate is running
docker ps | grep weaviate

# Test connection
curl http://localhost:8080/v1/.well-known/ready

# Check health
curl http://localhost:8080/v1/.well-known/live

# View logs
docker logs weaviate -f
```

**Expected Response:**
```json
{"status": "healthy"}
```

---

## Phase 2: Schema Setup

### Step 2.1: Install Weaviate Client

Update `recruiter/backend/package.json`:
```json
{
  "dependencies": {
    "weaviate-ts-client": "^2.0.0"
  }
}
```

Run:
```bash
cd recruiter/backend
npm install weaviate-ts-client
```

### Step 2.2: Create Schema Setup Script

Create `recruiter/backend/scripts/setupWeaviate.js`:

```javascript
const weaviate = require('weaviate-ts-client');
require('dotenv').config();

async function setupWeaviateSchemas() {
  try {
    console.log('🔄 Setting up Weaviate schemas...');

    // Initialize Weaviate client
    const client = weaviate.client({
      scheme: 'http',
      host: process.env.WEAVIATE_HOST || 'weaviate:8080',
      apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    });

    // Check connection
    const isReady = await client.misc.readyChecker().do();
    console.log('✅ Weaviate is ready:', isReady);

    // Define Candidate schema
    const candidateSchema = {
      class: 'Candidate',
      description: 'Candidate profiles with embeddings for semantic search',
      vectorizer: 'none', // We generate embeddings via Azure OpenAI
      
      properties: [
        // Core identification
        { name: 'candidateId', dataType: ['string'], description: 'MongoDB candidate ID' },
        { name: 'organizationId', dataType: ['string'], description: 'Organization ID for filtering' },
        
        // Basic info
        { name: 'firstName', dataType: ['string'] },
        { name: 'lastName', dataType: ['string'] },
        { name: 'email', dataType: ['string'] },
        { name: 'position', dataType: ['string'] },
        
        // Resume content
        { name: 'resumeText', dataType: ['text'], description: 'Full resume text' },
        { name: 'coverLetter', dataType: ['text'] },
        
        // Skills and experience
        { name: 'skills', dataType: ['string[]'] },
        { name: 'totalYearsExperience', dataType: ['number'] },
        
        // Work history (stored as JSON string for complex data)
        { name: 'jobHistory', dataType: ['text'], description: 'JSON stringified job history' },
        { name: 'education', dataType: ['text'], description: 'JSON stringified education' },
        
        // AI analysis
        { name: 'aiSummary', dataType: ['text'] },
        { name: 'strengths', dataType: ['string[]'] },
        
        // Metadata
        { name: 'createdAt', dataType: ['date'] },
        { name: 'updatedAt', dataType: ['date'] },
        { name: 'isActive', dataType: ['boolean'] },
        
        // NO 40KB LIMIT - Add as much as needed!
        { name: 'fullMetadata', dataType: ['text'], description: 'Complete JSON metadata' },
      ],
      
      // Enable inverted index for faster filtering
      invertedIndexConfig: {
        indexTimestamps: true,
        indexNullState: true,
        indexPropertyLength: true,
      },
      
      // Vector index configuration
      vectorIndexConfig: {
        distance: 'cosine',
        efConstruction: 128,
        ef: 64,
      },
    };

    // Define Job schema
    const jobSchema = {
      class: 'Job',
      description: 'Job postings with embeddings for candidate matching',
      vectorizer: 'none',
      
      properties: [
        // Core identification
        { name: 'jobId', dataType: ['string'], description: 'MongoDB job ID' },
        { name: 'organizationId', dataType: ['string'] },
        
        // Job details
        { name: 'title', dataType: ['string'] },
        { name: 'department', dataType: ['string'] },
        { name: 'location', dataType: ['string'] },
        { name: 'type', dataType: ['string'] },
        { name: 'level', dataType: ['string'] },
        
        // Job content
        { name: 'description', dataType: ['text'] },
        { name: 'requirements', dataType: ['text'] },
        { name: 'responsibilities', dataType: ['text'] },
        
        // Skills
        { name: 'requiredSkills', dataType: ['string[]'] },
        { name: 'preferredSkills', dataType: ['string[]'] },
        
        // Salary
        { name: 'salaryMin', dataType: ['number'] },
        { name: 'salaryMax', dataType: ['number'] },
        { name: 'salaryCurrency', dataType: ['string'] },
        
        // Metadata
        { name: 'createdAt', dataType: ['date'] },
        { name: 'updatedAt', dataType: ['date'] },
        { name: 'isActive', dataType: ['boolean'] },
        { name: 'status', dataType: ['string'] },
        
        // Full metadata
        { name: 'fullMetadata', dataType: ['text'] },
      ],
      
      invertedIndexConfig: {
        indexTimestamps: true,
        indexNullState: true,
        indexPropertyLength: true,
      },
      
      vectorIndexConfig: {
        distance: 'cosine',
        efConstruction: 128,
        ef: 64,
      },
    };

    // Create or update Candidate schema
    try {
      await client.schema.classDeleter().withClassName('Candidate').do();
      console.log('🗑️  Deleted existing Candidate schema');
    } catch (e) {
      console.log('ℹ️  No existing Candidate schema to delete');
    }
    
    await client.schema.classCreator().withClass(candidateSchema).do();
    console.log('✅ Candidate schema created');

    // Create or update Job schema
    try {
      await client.schema.classDeleter().withClassName('Job').do();
      console.log('🗑️  Deleted existing Job schema');
    } catch (e) {
      console.log('ℹ️  No existing Job schema to delete');
    }
    
    await client.schema.classCreator().withClass(jobSchema).do();
    console.log('✅ Job schema created');

    // Verify schemas
    const schema = await client.schema.getter().do();
    console.log('📋 Current schemas:', schema.classes.map(c => c.class));

    console.log('🎉 Weaviate setup complete!');
    return true;

  } catch (error) {
    console.error('❌ Error setting up Weaviate:', error);
    return false;
  }
}

// Run setup
if (require.main === module) {
  setupWeaviateSchemas()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupWeaviateSchemas };
```

### Step 2.3: Add Environment Variables

Update `recruiter/backend/.env`:
```env
# Weaviate Configuration
WEAVIATE_HOST=weaviate:8080
WEAVIATE_API_KEY=<your-generated-api-key>
WEAVIATE_SCHEME=http

# Keep Pinecone for now (dual mode during migration)
PINECONE_API_KEY=<existing-key>
```

### Step 2.4: Run Schema Setup

```bash
cd recruiter/backend
node scripts/setupWeaviate.js
```

**Expected Output:**
```
✅ Weaviate is ready: true
✅ Candidate schema created
✅ Job schema created
📋 Current schemas: [ 'Candidate', 'Job' ]
🎉 Weaviate setup complete!
```

---

## Phase 3: Code Migration

### Step 3.1: Create Weaviate Service Wrapper

Create `recruiter/backend/services/weaviateService.js`:

```javascript
const weaviate = require('weaviate-ts-client');

class WeaviateService {
  constructor() {
    this.client = weaviate.client({
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'weaviate:8080',
      apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    });
  }

  /**
   * Store candidate embedding
   */
  async storeCandidateEmbedding(candidateId, embedding, metadata) {
    try {
      await this.client.data
        .creator()
        .withClassName('Candidate')
        .withId(candidateId)
        .withVector(embedding)
        .withProperties({
          candidateId: candidateId,
          organizationId: metadata.organizationId,
          firstName: metadata.firstName || '',
          lastName: metadata.lastName || '',
          email: metadata.email || '',
          position: metadata.position || '',
          resumeText: metadata.resumeText || '',
          coverLetter: metadata.coverLetter || '',
          skills: metadata.skills || [],
          totalYearsExperience: metadata.totalYearsExperience || 0,
          jobHistory: JSON.stringify(metadata.jobHistory || []),
          education: JSON.stringify(metadata.education || []),
          aiSummary: metadata.aiSummary || '',
          strengths: metadata.strengths || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true,
          fullMetadata: JSON.stringify(metadata), // NO SIZE LIMIT!
        })
        .do();
      
      return true;
    } catch (error) {
      console.error('Error storing candidate in Weaviate:', error);
      throw error;
    }
  }

  /**
   * Search similar candidates
   */
  async searchSimilarCandidates(queryEmbedding, organizationId, topK = 10) {
    try {
      let query = this.client.graphql
        .get()
        .withClassName('Candidate')
        .withNearVector({ vector: queryEmbedding })
        .withLimit(topK)
        .withFields('candidateId organizationId firstName lastName position skills totalYearsExperience _additional { distance }');

      // Add organization filter if provided
      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      return result.data.Get.Candidate || [];
    } catch (error) {
      console.error('Error searching candidates in Weaviate:', error);
      throw error;
    }
  }

  /**
   * Hybrid search (vector + keyword)
   */
  async hybridSearchCandidates(queryText, queryEmbedding, organizationId, topK = 10) {
    try {
      let query = this.client.graphql
        .get()
        .withClassName('Candidate')
        .withHybrid({
          query: queryText,
          vector: queryEmbedding,
          alpha: 0.5, // 0.5 = balanced, 0 = pure keyword, 1 = pure vector
        })
        .withLimit(topK)
        .withFields('candidateId organizationId firstName lastName position skills resumeText _additional { distance score }');

      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      return result.data.Get.Candidate || [];
    } catch (error) {
      console.error('Error in hybrid search:', error);
      throw error;
    }
  }

  /**
   * Check if candidate exists
   */
  async checkCandidateExists(candidateId) {
    try {
      const result = await this.client.data
        .getterById()
        .withClassName('Candidate')
        .withId(candidateId)
        .do();
      
      return !!result;
    } catch (error) {
      if (error.message.includes('not found')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete candidate
   */
  async deleteCandidate(candidateId) {
    try {
      await this.client.data
        .deleter()
        .withClassName('Candidate')
        .withId(candidateId)
        .do();
      
      return true;
    } catch (error) {
      console.error('Error deleting candidate from Weaviate:', error);
      throw error;
    }
  }

  /**
   * Store job embedding
   */
  async storeJobEmbedding(jobId, embedding, metadata) {
    try {
      await this.client.data
        .creator()
        .withClassName('Job')
        .withId(jobId)
        .withVector(embedding)
        .withProperties({
          jobId: jobId,
          organizationId: metadata.organizationId,
          title: metadata.title || '',
          department: metadata.department || '',
          location: metadata.location || '',
          type: metadata.type || '',
          level: metadata.level || '',
          description: metadata.description || '',
          requirements: metadata.requirements || '',
          responsibilities: metadata.responsibilities || '',
          requiredSkills: metadata.requiredSkills || [],
          preferredSkills: metadata.preferredSkills || [],
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
      
      return true;
    } catch (error) {
      console.error('Error storing job in Weaviate:', error);
      throw error;
    }
  }

  /**
   * Search similar jobs
   */
  async searchSimilarJobs(queryEmbedding, organizationId, topK = 10) {
    try {
      let query = this.client.graphql
        .get()
        .withClassName('Job')
        .withNearVector({ vector: queryEmbedding })
        .withLimit(topK)
        .withFields('jobId organizationId title department location requiredSkills _additional { distance }');

      if (organizationId) {
        query = query.withWhere({
          path: ['organizationId'],
          operator: 'Equal',
          valueString: organizationId,
        });
      }

      const result = await query.do();
      return result.data.Get.Job || [];
    } catch (error) {
      console.error('Error searching jobs in Weaviate:', error);
      throw error;
    }
  }

  /**
   * Get Weaviate stats
   */
  async getStats() {
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
        candidates: candidateStats.data.Aggregate.Candidate[0]?.meta?.count || 0,
        jobs: jobStats.data.Aggregate.Job[0]?.meta?.count || 0,
      };
    } catch (error) {
      console.error('Error getting Weaviate stats:', error);
      return { candidates: 0, jobs: 0 };
    }
  }
}

module.exports = new WeaviateService();
```

### Step 3.2: Update Embedding Service (Dual Mode)

Update `recruiter/backend/services/embeddingService.js` to support both Pinecone and Weaviate:

```javascript
const weaviateService = require('./weaviateService');

class EmbeddingService {
  constructor() {
    // Keep Pinecone for backward compatibility during migration
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    // Add Weaviate
    this.weaviate = weaviateService;
    
    // Migration flag - set to true to use Weaviate
    this.useWeaviate = process.env.USE_WEAVIATE === 'true';
    
    console.log(`📊 Vector DB: ${this.useWeaviate ? 'Weaviate' : 'Pinecone'}`);
  }

  /**
   * Store embedding (dual mode)
   */
  async storeEmbedding(entityId, embedding, metadata, indexName) {
    if (this.useWeaviate) {
      if (indexName === 'candidates' || indexName === this.candidateIndexName) {
        return await this.weaviate.storeCandidateEmbedding(entityId, embedding, metadata);
      } else {
        return await this.weaviate.storeJobEmbedding(entityId, embedding, metadata);
      }
    } else {
      // Original Pinecone code
      return await this._storePineconeEmbedding(entityId, embedding, metadata, indexName);
    }
  }

  /**
   * Search similar candidates (dual mode)
   */
  async searchSimilarCandidates(queryText, organizationId, topK = 10) {
    if (this.useWeaviate) {
      const queryEmbedding = await this.generateEmbedding(queryText);
      return await this.weaviate.searchSimilarCandidates(queryEmbedding, organizationId, topK);
    } else {
      // Original Pinecone code
      return await this._searchPineconeCandidates(queryText, organizationId, topK);
    }
  }

  // ... rest of dual-mode methods
}
```

---

## Phase 4: Data Migration

### Step 4.1: Create Migration Script

Create `recruiter/backend/scripts/migratePineconeToWeaviate.js`:

```javascript
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const embeddingService = require('../services/embeddingService');
const weaviateService = require('../services/weaviateService');

async function migrateData() {
  console.log('🔄 Starting Pinecone → Weaviate migration...');
  
  let candidateCount = 0;
  let jobCount = 0;
  let errors = [];

  try {
    // Migrate Candidates
    console.log('📋 Migrating candidates...');
    const candidates = await Candidate.find({ isEmbedded: true });
    
    for (const candidate of candidates) {
      try {
        // Fetch from Pinecone
        const pineconeIndex = embeddingService.pinecone.index('candidates');
        const result = await pineconeIndex.fetch([candidate._id.toString()]);
        
        if (result.records && result.records[candidate._id.toString()]) {
          const record = result.records[candidate._id.toString()];
          
          // Store in Weaviate
          await weaviateService.storeCandidateEmbedding(
            candidate._id.toString(),
            record.values,
            record.metadata
          );
          
          candidateCount++;
          if (candidateCount % 10 === 0) {
            console.log(`  ✓ Migrated ${candidateCount} candidates...`);
          }
        }
      } catch (error) {
        console.error(`  ✗ Error migrating candidate ${candidate._id}:`, error.message);
        errors.push({ type: 'candidate', id: candidate._id, error: error.message });
      }
    }

    // Migrate Jobs
    console.log('📋 Migrating jobs...');
    const jobs = await Job.find({ isEmbedded: true });
    
    for (const job of jobs) {
      try {
        const pineconeIndex = embeddingService.pinecone.index('jobs');
        const result = await pineconeIndex.fetch([job._id.toString()]);
        
        if (result.records && result.records[job._id.toString()]) {
          const record = result.records[job._id.toString()];
          
          await weaviateService.storeJobEmbedding(
            job._id.toString(),
            record.values,
            record.metadata
          );
          
          jobCount++;
          if (jobCount % 10 === 0) {
            console.log(`  ✓ Migrated ${jobCount} jobs...`);
          }
        }
      } catch (error) {
        console.error(`  ✗ Error migrating job ${job._id}:`, error.message);
        errors.push({ type: 'job', id: job._id, error: error.message });
      }
    }

    // Verify counts
    const stats = await weaviateService.getStats();
    
    console.log('\n🎉 Migration Complete!');
    console.log(`✅ Candidates migrated: ${candidateCount}`);
    console.log(`✅ Jobs migrated: ${jobCount}`);
    console.log(`📊 Weaviate stats:`, stats);
    
    if (errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${errors.length}`);
      console.log(errors);
    }

    return { candidateCount, jobCount, errors, stats };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
if (require.main === module) {
  migrateData()
    .then(result => {
      console.log('\n✅ Migration script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateData };
```

### Step 4.2: Run Migration

```bash
cd recruiter/backend
node scripts/migratePineconeToWeaviate.js
```

**Monitor Progress:**
```
🔄 Starting Pinecone → Weaviate migration...
📋 Migrating candidates...
  ✓ Migrated 10 candidates...
  ✓ Migrated 20 candidates...
  ...
✅ Candidates migrated: 156
✅ Jobs migrated: 24
📊 Weaviate stats: { candidates: 156, jobs: 24 }
🎉 Migration Complete!
```

---

## Phase 5: Testing

### Step 5.1: Unit Tests

Create test cases for Weaviate service:
```bash
cd recruiter/backend
npm test -- weaviate
```

### Step 5.2: Integration Testing

Test scenarios:
1. ✅ Create candidate embedding
2. ✅ Search candidates by similarity
3. ✅ Hybrid search (vector + keyword)
4. ✅ Filter by organization
5. ✅ Update candidate
6. ✅ Delete candidate
7. ✅ Create job embedding
8. ✅ Match candidates to jobs

### Step 5.3: Performance Testing

Compare Pinecone vs Weaviate:
- Query latency
- Batch insert speed
- Memory usage
- Search accuracy

### Step 5.4: Staging Test

Deploy to staging environment:
1. Set `USE_WEAVIATE=true`
2. Run full test suite
3. Monitor for 24 hours
4. Check logs for errors

---

## Phase 6: Production Cutover

### Step 6.1: Pre-Cutover Checklist

- [ ] Weaviate deployed and healthy
- [ ] All schemas created
- [ ] Data migration complete
- [ ] Code changes deployed
- [ ] Tests passing
- [ ] Backup created
- [ ] Team notified

### Step 6.2: Cutover Steps

1. **Enable Weaviate:**
   ```bash
   # Update environment variable in Dokploy
   USE_WEAVIATE=true
   ```

2. **Restart Recruiter Backend:**
   ```bash
   # Via Dokploy UI or API
   curl -X POST "$DOKPLOY_URL/api/trpc/application.deploy?batch=1" \
     -H "Authorization: Bearer $DOKPLOY_TOKEN" \
     -d '{"0":{"json":{"applicationId":"RECRUITER_BACKEND_APP_ID"}}}'
   ```

3. **Monitor for 1 Hour:**
   - Check logs: `docker logs recruiter-backend -f`
   - Monitor errors in Sentry/logs
   - Test search functionality
   - Verify candidate matching works

4. **Confirm Success:**
   - [ ] No errors in logs
   - [ ] Search results accurate
   - [ ] Performance acceptable
   - [ ] Users report no issues

### Step 6.3: Communication

**Before Cutover:**
- Email team about maintenance window
- Post in Slack
- Update status page

**After Cutover:**
- Confirm completion
- Share performance improvements
- Document any issues

---

## Rollback Plan

### If Issues Occur

**Quick Rollback (< 5 minutes):**

1. **Revert to Pinecone:**
   ```bash
   # In Dokploy, update env var
   USE_WEAVIATE=false
   ```

2. **Restart Backend:**
   ```bash
   # Redeploy
   curl -X POST "$DOKPLOY_URL/api/trpc/application.deploy?batch=1" ...
   ```

3. **Verify:** Test search functionality

**Data Issues:**
- Pinecone data is still intact (not deleted)
- Can re-run migration if needed
- MongoDB has original data

**Critical Issues:**
- Keep Weaviate running
- Debug in parallel
- Pinecone subscription still active

---

## Post-Migration

### Step 1: Monitor (Week 1)

- [ ] Daily log checks
- [ ] Performance monitoring
- [ ] User feedback collection
- [ ] Error rate tracking

### Step 2: Optimize (Week 2)

- [ ] Tune vector index settings
- [ ] Optimize query performance
- [ ] Add caching if needed
- [ ] Fine-tune hybrid search alpha

### Step 3: Cleanup (Week 3-4)

Once confident Weaviate is stable:

1. **Remove Pinecone Code:**
   - Delete Pinecone client initialization
   - Remove dual-mode logic
   - Clean up old methods

2. **Cancel Pinecone Subscription:**
   - Export final backup
   - Cancel subscription
   - Document cancellation

3. **Update Documentation:**
   - Update README
   - Update architecture diagrams
   - Document Weaviate setup

### Step 4: Enable Advanced Features

Now that we're on Weaviate, enable:

✅ **Hybrid Search:** Combine vector + keyword for better results  
✅ **Complex Filters:** Multi-condition filtering  
✅ **Full Metadata:** Store unlimited candidate data  
✅ **GraphQL Queries:** More flexible querying  
✅ **Monitoring:** Set up Weaviate monitoring dashboard  

---

## Cost Savings Calculation

### Before (Pinecone)
- Monthly cost: $70-100
- Annual cost: $840-1200
- Metadata limit: 40KB per vector
- Features: Basic vector search

### After (Weaviate)
- Monthly cost: $0 (uses existing VM)
- Annual cost: $0
- Metadata limit: None
- Features: Vector + hybrid + keyword search

**Annual Savings: $840-1200** 💰

---

## Timeline

| Day | Phase | Tasks |
|-----|-------|-------|
| **Day 1** | Setup | Deploy Weaviate, Create schemas, Install dependencies |
| **Day 2** | Migration | Code changes, Data migration, Initial testing |
| **Day 3** | Testing | Integration tests, Performance tests, Staging deployment |
| **Day 4** | Cutover | Production cutover, Monitoring, Verification |
| **Week 2** | Stabilization | Bug fixes, Performance tuning, Documentation |
| **Week 3-4** | Cleanup | Remove Pinecone code, Cancel subscription, Enable features |

---

## Success Metrics

### Technical Metrics
- ✅ 100% data migrated successfully
- ✅ Query latency < 100ms (vs Pinecone's ~150ms)
- ✅ Zero data loss
- ✅ 99.9% uptime

### Business Metrics
- ✅ $840-1200/year cost savings
- ✅ No metadata size constraints
- ✅ Improved search accuracy (hybrid search)
- ✅ Faster development (no external API limits)

---

## Support & Resources

### Weaviate Documentation
- Official Docs: https://weaviate.io/developers/weaviate
- Node.js Client: https://weaviate.io/developers/weaviate/client-libraries/typescript
- GraphQL API: https://weaviate.io/developers/weaviate/api/graphql

### Internal Resources
- Dokploy Dashboard: http://4.180.153.209:3000
- Weaviate Console: http://4.180.153.209:8080/v1
- MongoDB connection: `mongodb://localhost:27017/recruiter`

### Team Contacts
- Infrastructure: DevOps team
- Backend: Backend team lead
- QA: QA team for testing support

---

## Approval & Sign-off

| Role | Name | Approval | Date |
|------|------|----------|------|
| Tech Lead | | ☐ | |
| DevOps | | ☐ | |
| Product | | ☐ | |

---

**Status:** ✅ Plan Ready for Execution  
**Next Step:** Phase 1 - Deploy Weaviate in Dokploy  
**Est. Completion:** 3-4 days from start
