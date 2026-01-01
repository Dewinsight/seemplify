const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
require('dotenv').config();

async function checkRealData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all organizations
    const Organization = require('../models/Organization');
    const orgs = await Organization.find({}).select('name').limit(3);
    
    if (orgs.length === 0) {
      console.log('❌ No organizations found!');
      await mongoose.disconnect();
      return;
    }

    const orgId = orgs[0]._id;
    console.log(`📊 Checking data for organization: ${orgs[0].name} (${orgId})\n`);

    // Check candidates
    const totalCandidates = await Candidate.countDocuments({ organization: orgId });
    console.log(`Total Candidates: ${totalCandidates}`);

    if (totalCandidates > 0) {
      // Get candidate timeline
      const candidatesTimeline = await Candidate.aggregate([
        { $match: { organization: orgId } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        { $limit: 5 }
      ]);
      console.log('\nCandidate Timeline (first 5):');
      candidatesTimeline.forEach(item => {
        console.log(`  ${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}: ${item.count} candidates`);
      });

      // Get candidate status distribution
      const candidatesByStatus = await Candidate.aggregate([
        { $match: { organization: orgId } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      console.log('\nCandidate Status Distribution:');
      candidatesByStatus.forEach(item => {
        console.log(`  ${item._id}: ${item.count}`);
      });
    }

    // Check jobs
    const totalJobs = await Job.countDocuments({ organization: orgId });
    console.log(`\nTotal Jobs: ${totalJobs}`);

    if (totalJobs > 0) {
      // Get job timeline
      const jobsTimeline = await Job.aggregate([
        { $match: { organization: orgId } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        { $limit: 5 }
      ]);
      console.log('\nJob Timeline (first 5):');
      jobsTimeline.forEach(item => {
        console.log(`  ${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}: ${item.count} jobs`);
      });

      // Get job status distribution
      const jobsByStatus = await Job.aggregate([
        { $match: { organization: orgId } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      console.log('\nJob Status Distribution:');
      jobsByStatus.forEach(item => {
        console.log(`  ${item._id}: ${item.count}`);
      });
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkRealData();

