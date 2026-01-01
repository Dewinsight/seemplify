require('dotenv').config({ path: './backend/.env' });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Job = require('../models/Job');

const investigateJobs = async () => {
  try {
    await connectDB();

    const jobs = await Job.find({}, 'title status isPublic');

    if (jobs.length === 0) {
      console.log('No jobs found in the database.');
    } else {
      console.log(`Found ${jobs.length} jobs. Here are their details:`);
      jobs.forEach(job => {
        console.log(`- Title: ${job.title}, Status: ${job.status}, Is Public: ${job.isPublic}`);
      });
    }

    mongoose.connection.close();
  } catch (error) {
    console.error('Error investigating jobs:', error);
    process.exit(1);
  }
};

investigateJobs();