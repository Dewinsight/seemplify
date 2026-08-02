const mongoose = require('mongoose');
require('dotenv').config();
const Project = require('../models/Project'); // Adjust path if needed
const User = require('../models/User'); // Adjust path if needed

const checkData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const projectCount = await Project.countDocuments();
        console.log(`Total Projects: ${projectCount}`);

        const projects = await Project.find().limit(5);
        if (projects.length > 0) {
            console.log('Sample Projects:', JSON.stringify(projects, null, 2));
        } else {
            console.log('No projects found in DB.');
        }

        const users = await User.find();
        console.log('Users count:', users.length);

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkData();
