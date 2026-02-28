const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

async function setupPineconeIndexes() {
  try {
    console.log('🔄 Setting up Pinecone indexes...');

    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const indexes = ['candidates', 'jobs'];
    const dimension = 3072; // text-embedding-3-large has 3072 dimensions

    // Get existing indexes
    const existingIndexes = await pinecone.listIndexes();
    console.log('📋 Existing indexes:', existingIndexes.indexes?.map(idx => idx.name) || []);

    for (const indexName of indexes) {
      // Check if index already exists
      const indexExists = existingIndexes.indexes?.some(index => index.name === indexName);

      if (indexExists) {
        console.log(`✅ Index '${indexName}' already exists!`);
        
        // Get index stats
        const index = pinecone.index(indexName);
        const stats = await index.describeIndexStats();
        console.log(`📊 Index '${indexName}' stats:`, stats);
        
        continue;
      }

      console.log(`🔨 Creating index '${indexName}'...`);

      // Create the index
      await pinecone.createIndex({
        name: indexName,
        dimension: dimension,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });

      console.log(`✅ Index '${indexName}' created successfully!`);
      
      // Wait a bit for the index to be ready
      console.log(`⏳ Waiting for index '${indexName}' to be ready...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    console.log('🎉 All indexes setup complete!');
    return true;

  } catch (error) {
    console.error('❌ Error setting up Pinecone indexes:', error);
    return false;
  }
}

// Run the setup if this script is called directly
if (require.main === module) {
  setupPineconeIndexes()
    .then(success => {
      if (success) {
        console.log('✅ Pinecone setup completed successfully!');
        process.exit(0);
      } else {
        console.log('❌ Pinecone setup failed!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('❌ Setup script error:', error);
      process.exit(1);
    });
}

module.exports = { setupPineconeIndexes }; 