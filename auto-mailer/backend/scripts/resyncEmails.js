import { connectDatabase } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Script to clear emails and force re-sync with full bodies
async function clearEmailsForResync() {
  try {
    console.log('🔄 Connecting to database...');
    const db = await connectDatabase();
    
    const emails = db.collection('emails');
    const users = db.collection('users');
    
    // Delete all emails
    const result = await emails.deleteMany({});
    console.log(`🗑️  Deleted ${result.deletedCount} emails`);
    
    // Reset lastEmailCheck for all users to force re-sync
    const updateResult = await users.updateMany(
      { emailConnected: true },
      { 
        $set: { 
          lastEmailCheck: null,
          lastSentCheck: null 
        } 
      }
    );
    
    console.log(`🔄 Reset ${updateResult.modifiedCount} user(s) for re-sync`);
    console.log('✅ Done! Restart your backend to re-sync all emails with full bodies.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

clearEmailsForResync();

