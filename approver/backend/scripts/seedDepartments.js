const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Department = require('../models/Department');
const Organization = require('../models/Organization');

const seedDepartments = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        // Find or create Testing org
        let org = await Organization.findOne({ slug: 'testing' });
        if (!org) {
            org = await new Organization({
                name: 'Testing',
                slug: 'testing',
                description: 'Default organization'
            }).save();
            console.log('Created Testing organization');
        }

        const depts = [
            { name: 'IT', description: 'Information Technology' },
            { name: 'HR', description: 'Human Resources' },
            { name: 'Finance', description: 'Financial Operations' },
            { name: 'Legal', description: 'Legal & Compliance' },
            { name: 'Operations', description: 'Business Operations' },
            { name: 'Marketing', description: 'Marketing & Communications' }
        ];

        for (const d of depts) {
            const exists = await Department.findOne({ name: d.name, organization: org._id });
            if (!exists) {
                await Department.create({ ...d, organization: org._id });
                console.log(`Created: ${d.name}`);
            } else {
                console.log(`Exists: ${d.name}`);
            }
        }

        console.log('Seeding Complete');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

seedDepartments();
