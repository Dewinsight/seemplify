const weaviate = require('weaviate-ts-client');
require('dotenv').config();

async function setupWeaviateSchemas() {
  try {
    console.log('🔄 Setting up Weaviate schemas...');

    // Initialize Weaviate client
    const client = weaviate.client({
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'localhost:8080',
      apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    });

    // Check connection
    console.log('📡 Checking Weaviate connection...');
    const meta = await client.misc.metaGetter().do();
    console.log('✅ Connected to Weaviate version:', meta.version);

    // Define Candidate schema
    const candidateSchema = {
      class: 'Candidate',
      description: 'Candidate profiles with embeddings for semantic search',
      vectorizer: 'none', // We generate embeddings via Azure OpenAI
      
      properties: [
        // Core identification
        { name: 'candidateId', dataType: ['string'], description: 'MongoDB candidate ID', indexInverted: true },
        { name: 'organizationId', dataType: ['string'], description: 'Organization ID for filtering', indexInverted: true },
        
        // Basic info
        { name: 'firstName', dataType: ['string'], indexInverted: true },
        { name: 'lastName', dataType: ['string'], indexInverted: true },
        { name: 'email', dataType: ['string'], indexInverted: true },
        { name: 'position', dataType: ['string'], indexInverted: true },
        
        // Resume content (searchable)
        { name: 'resumeText', dataType: ['text'], description: 'Full resume text', indexInverted: true },
        { name: 'coverLetter', dataType: ['text'], indexInverted: true },
        
        // Skills and experience
        { name: 'skills', dataType: ['string[]'], indexInverted: true },
        { name: 'totalYearsExperience', dataType: ['number'], indexInverted: true },
        
        // Work history (stored as JSON string for complex data)
        { name: 'jobHistory', dataType: ['text'], description: 'JSON stringified job history' },
        { name: 'education', dataType: ['text'], description: 'JSON stringified education' },
        
        // AI analysis
        { name: 'aiSummary', dataType: ['text'], indexInverted: true },
        { name: 'strengths', dataType: ['string[]'], indexInverted: true },
        
        // Metadata
        { name: 'createdAt', dataType: ['date'], indexInverted: true },
        { name: 'updatedAt', dataType: ['date'], indexInverted: true },
        { name: 'isActive', dataType: ['boolean'], indexInverted: true },
        
        // NO 40KB LIMIT - Add as much as needed!
        { name: 'fullMetadata', dataType: ['text'], description: 'Complete JSON metadata' },
      ],
      
      // Vector index configuration (cosine similarity)
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
        { name: 'jobId', dataType: ['string'], description: 'MongoDB job ID', indexInverted: true },
        { name: 'organizationId', dataType: ['string'], indexInverted: true },
        
        // Job details
        { name: 'title', dataType: ['string'], indexInverted: true },
        { name: 'department', dataType: ['string'], indexInverted: true },
        { name: 'location', dataType: ['string'], indexInverted: true },
        { name: 'type', dataType: ['string'], indexInverted: true },
        { name: 'level', dataType: ['string'], indexInverted: true },
        
        // Job content
        { name: 'description', dataType: ['text'], indexInverted: true },
        { name: 'requirements', dataType: ['text'], indexInverted: true },
        { name: 'responsibilities', dataType: ['text'], indexInverted: true },
        
        // Skills
        { name: 'requiredSkills', dataType: ['string[]'], indexInverted: true },
        { name: 'preferredSkills', dataType: ['string[]'], indexInverted: true },
        
        // Salary
        { name: 'salaryMin', dataType: ['number'], indexInverted: true },
        { name: 'salaryMax', dataType: ['number'], indexInverted: true },
        { name: 'salaryCurrency', dataType: ['string'], indexInverted: true },
        
        // Metadata
        { name: 'createdAt', dataType: ['date'], indexInverted: true },
        { name: 'updatedAt', dataType: ['date'], indexInverted: true },
        { name: 'isActive', dataType: ['boolean'], indexInverted: true },
        { name: 'status', dataType: ['string'], indexInverted: true },
        
        // Full metadata
        { name: 'fullMetadata', dataType: ['text'] },
      ],
      
      vectorIndexConfig: {
        distance: 'cosine',
        efConstruction: 128,
        ef: 64,
      },
    };

    // Get existing schemas
    const existingSchema = await client.schema.getter().do();
    const existingClasses = existingSchema.classes?.map(c => c.class) || [];
    
    console.log('📋 Existing schemas:', existingClasses.length > 0 ? existingClasses.join(', ') : 'None');

    // Create or update Candidate schema
    if (existingClasses.includes('Candidate')) {
      console.log('🗑️  Deleting existing Candidate schema...');
      await client.schema.classDeleter().withClassName('Candidate').do();
    }
    
    console.log('✨ Creating Candidate schema...');
    await client.schema.classCreator().withClass(candidateSchema).do();
    console.log('✅ Candidate schema created');

    // Create or update Job schema
    if (existingClasses.includes('Job')) {
      console.log('🗑️  Deleting existing Job schema...');
      await client.schema.classDeleter().withClassName('Job').do();
    }
    
    console.log('✨ Creating Job schema...');
    await client.schema.classCreator().withClass(jobSchema).do();
    console.log('✅ Job schema created');

    // Verify schemas
    const finalSchema = await client.schema.getter().do();
    console.log('📊 Final schemas:', finalSchema.classes.map(c => c.class).join(', '));

    // Get stats
    const candidateStats = await client.graphql
      .aggregate()
      .withClassName('Candidate')
      .withFields('meta { count }')
      .do();

    const jobStats = await client.graphql
      .aggregate()
      .withClassName('Job')
      .withFields('meta { count }')
      .do();

    console.log('📈 Stats:');
    console.log('  - Candidates:', candidateStats.data?.Aggregate?.Candidate?.[0]?.meta?.count || 0);
    console.log('  - Jobs:', jobStats.data?.Aggregate?.Job?.[0]?.meta?.count || 0);

    console.log('');
    console.log('🎉 Weaviate setup complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: npm install');
    console.log('  2. Update .env with Weaviate credentials');
    console.log('  3. Run migration script to import data from Pinecone');
    
    return true;

  } catch (error) {
    console.error('❌ Error setting up Weaviate:', error);
    if (error.message) console.error('Message:', error.message);
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
