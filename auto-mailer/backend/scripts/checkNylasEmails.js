import Nylas from 'nylas';
import dotenv from 'dotenv';
import { connectDatabase, getDatabase } from '../config/database.js';

dotenv.config();

// Initialize Nylas client
const nylasClient = new Nylas({
  apiKey: process.env.NYLAS_API_KEY,
  apiUri: process.env.NYLAS_API_URI || 'https://api.us.nylas.com',
});

async function checkNylasEmails() {
  try {
    console.log('🔍 Checking Nylas for latest emails...\n');
    
    await connectDatabase();
    const db = getDatabase();
    
    // Find user with Nylas connected
    const users = db.collection('users');
    const user = await users.findOne({ 
      emailConnected: true,
      nylasGrantId: { $ne: null }
    });

    if (!user) {
      console.error('❌ No user found with Nylas email connected');
      process.exit(1);
    }

    console.log('✅ Found user:', user.email);
    console.log('   Nylas Email:', user.nylasEmail);
    console.log('   Grant ID:', user.nylasGrantId);
    console.log('   Last Check:', user.lastEmailCheck ? new Date(user.lastEmailCheck).toISOString() : 'Never');
    console.log('');

    // Fetch latest emails WITHOUT timestamp filter
    console.log('📬 Fetching last 10 emails from Nylas (no filter)...\n');
    
    const response = await nylasClient.messages.list({
      identifier: user.nylasGrantId,
      queryParams: {
        limit: 10,
        select: 'id,subject,from,to,date,thread_id,snippet',
      },
    });

    if (!response.data || response.data.length === 0) {
      console.log('⚠️  No emails found in Nylas!');
      process.exit(0);
    }

    console.log(`📧 Found ${response.data.length} emails:\n`);
    
    response.data.forEach((msg, index) => {
      const receivedDate = new Date(msg.date * 1000);
      const isNew = user.lastEmailCheck ? receivedDate > new Date(user.lastEmailCheck) : true;
      
      console.log(`${index + 1}. ${isNew ? '🆕 NEW' : '   OLD'} - ${msg.subject || '(No Subject)'}`);
      console.log(`   From: ${msg.from?.[0]?.email || 'Unknown'}`);
      console.log(`   Date: ${receivedDate.toISOString()}`);
      console.log(`   ID: ${msg.id}`);
      console.log('');
    });

    // Now test with timestamp filter
    if (user.lastEmailCheck) {
      console.log('🔍 Testing with timestamp filter (like polling does)...\n');
      
      const timestamp = Math.floor(new Date(user.lastEmailCheck).getTime() / 1000);
      console.log(`   Filtering for emails received after: ${new Date(user.lastEmailCheck).toISOString()}`);
      console.log(`   Timestamp (seconds): ${timestamp}\n`);
      
      const filteredResponse = await nylasClient.messages.list({
        identifier: user.nylasGrantId,
        queryParams: {
          limit: 10,
          received_after: timestamp,
          select: 'id,subject,from,date',
        },
      });

      console.log(`📧 Emails after timestamp filter: ${filteredResponse.data?.length || 0}\n`);
      
      if (filteredResponse.data && filteredResponse.data.length > 0) {
        filteredResponse.data.forEach((msg, index) => {
          console.log(`${index + 1}. ${msg.subject || '(No Subject)'}`);
          console.log(`   Date: ${new Date(msg.date * 1000).toISOString()}`);
        });
      } else {
        console.log('⚠️  No new emails after timestamp filter!');
        console.log('   This means polling won\'t find new emails.');
        console.log('   Solution: Update lastEmailCheck or remove the timestamp filter temporarily.');
      }
    }

    console.log('\n✅ Diagnostic complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('API Error:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkNylasEmails();

