const mongoose = require('mongoose');
const Job = require('../models/Job');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
  fixPublicApplicationCounts();
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

async function fixPublicApplicationCounts() {
  try {
    console.log('\n🔧 Fixing public application counts...\n');
    
    // Find all public jobs
    const publicJobs = await Job.find({ isPublic: true });
    console.log(`Found ${publicJobs.length} public jobs`);
    
    let fixed = 0;
    let skipped = 0;
    
    for (const job of publicJobs) {
      // Count applicants with 'public' source
      const publicApplicants = job.applicants.filter(app => 
        app.source === 'public' || 
        (app.statusHistory && app.statusHistory.some(h => h.notes?.includes('public')))
      );
      
      const actualCount = publicApplicants.length;
      const currentCount = job.publicApplicationCount || 0;
      
      if (actualCount !== currentCount) {
        console.log(`\n📋 Job: ${job.title}`);
        console.log(`   Current count: ${currentCount}`);
        console.log(`   Actual count: ${actualCount}`);
        console.log(`   Updating...`);
        
        job.publicApplicationCount = actualCount;
        await job.save();
        
        console.log(`   ✅ Fixed!`);
        fixed++;
      } else {
        skipped++;
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Jobs fixed: ${fixed}`);
    console.log(`   Jobs already correct: ${skipped}`);
    console.log(`\n✅ Done!`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}


