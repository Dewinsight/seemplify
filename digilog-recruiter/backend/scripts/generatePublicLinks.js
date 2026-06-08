const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Import Job model
const Job = require('../models/Job');

const generatePublicLinksForExistingJobs = async () => {
  try {
    console.log('🔍 Finding jobs that are public but missing public links...');
    
    // Find jobs that are public but don't have publicUrl
    const jobsNeedingLinks = await Job.find({
      isPublic: true,
      $or: [
        { publicUrl: { $exists: false } },
        { publicUrl: null },
        { publicUrl: '' }
      ]
    });

    console.log(`📊 Found ${jobsNeedingLinks.length} jobs needing public links`);

    if (jobsNeedingLinks.length === 0) {
      console.log('✅ All public jobs already have public links!');
      return;
    }

    // Generate links for each job
    for (const job of jobsNeedingLinks) {
      console.log(`🔧 Generating public link for: ${job.title}`);
      
      // Generate URL using job ID
      job.publicUrl = `/public/jobs/${job._id}`;
      job.publicSlug = job._id.toString(); // Keep for backward compatibility
      
      await job.save();
      
      console.log(`✅ Generated: ${job._id} -> ${job.publicUrl}`);
    }

    console.log('🎉 All public links generated successfully!');
    
    // Show summary
    console.log('\n📋 Summary:');
    const updatedJobs = await Job.find({ isPublic: true, publicUrl: { $exists: true, $ne: null, $ne: '' } });
    updatedJobs.forEach(job => {
      console.log(`   📌 ${job.title} -> /public/jobs/${job._id}`);
    });
    
  } catch (error) {
    console.error('❌ Error generating public links:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  await generatePublicLinksForExistingJobs();
  mongoose.connection.close();
  console.log('✅ Database connection closed');
};

// Run the script
main(); 