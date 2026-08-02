require('dotenv').config({ path: './backend/.env' });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Job = require('../models/Job');

const makeAllJobsPublic = async () => {
  try {
    await connectDB();

    const result = await Job.updateMany(
      {},
      { $set: { isPublic: true, status: 'active' } }
    );

    console.log(`Successfully updated ${result.modifiedCount} jobs to be public and active.`);

    mongoose.connection.close();
  } catch (error) {
    console.error('Error updating jobs to be public:', error);
    process.exit(1);
  }
};

makeAllJobsPublic();