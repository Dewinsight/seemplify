import { connectDatabase, getDatabase } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function resetEmailCheck() {
  try {
    console.log('🔄 Resetting lastEmailCheck to force re-sync...\n');
    
    await connectDatabase();
    const db = getDatabase();
    
    const users = db.collection('users');
    
    // Reset lastEmailCheck for all users with connected email
    // Set it to 1 hour ago to catch recent emails
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await users.updateMany(
      { emailConnected: true },
      { 
        $set: { 
          lastEmailCheck: oneHourAgo,
        } 
      }
    );
    
    console.log(`✅ Reset ${result.modifiedCount} user(s)`);
    console.log(`   New lastEmailCheck: ${oneHourAgo.toISOString()}`);
    console.log('\nEmails from the last hour will be fetched on next poll!');
    console.log('The backend should pick them up within 10 seconds.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetEmailCheck();

