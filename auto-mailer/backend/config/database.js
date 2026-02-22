import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let db;
let client;

export const connectDatabase = async () => {
  try {
    const uri =
      process.env.AUTO_MAILER_MONGO_URI ||
      process.env.AUTO_MAILER_MONGODB_URL ||
      process.env.MONGO_URI ||
      process.env.MONGODB_URL;
    const dbName =
      process.env.AUTO_MAILER_MONGODB_DB_NAME ||
      process.env.MONGODB_DB_NAME ||
      'auto_mailer';
    
    if (!uri) {
      throw new Error(
        'Mongo URI is not defined. Set one of: AUTO_MAILER_MONGO_URI, AUTO_MAILER_MONGODB_URL, MONGO_URI, or MONGODB_URL'
      );
    }
    
    console.log('🔄 Attempting to connect to MongoDB...');
    
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4 // Use IPv4, skip trying IPv6
    });
    
    // Test the connection
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log('✅ Successfully connected to MongoDB Atlas');
    
    db = client.db(dbName);
    
    // Create indexes for users collection
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error message:', error.message);
    
    if (error.message.includes('SSL') || error.message.includes('TLS')) {
      console.error('💡 This appears to be an SSL/TLS connection issue.');
      console.error('💡 Please check your MongoDB Atlas configuration and network settings.');
    }
    
    // Don't exit process in development, just throw the error
    if (process.env.NODE_ENV === 'development') {
      console.error('🔧 Running in development mode - continuing without database');
      console.error('🔧 Some features requiring database will not work');
      return null;
    }
    
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    // Create unique index on email field
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  }
};

export const getDatabase = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return db;
};

export const isDatabaseConnected = () => {
  return db !== null && db !== undefined;
};

export const closeDatabase = async () => {
  if (client) {
    await client.close();
    console.log('🔌 Database connection closed');
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});
