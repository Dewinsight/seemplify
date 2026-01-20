const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Project = require('../models/Project');
const Department = require('../models/Department');

dotenv.config({ path: '.env' });

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        // 1. Create General Department
        let general = await Department.findOne({ name: 'General' });
        if (!general) {
            general = new Department({ name: 'General', description: 'Default department for all users' });
            await general.save();
            console.log('Created General Department:', general._id);
        } else {
            console.log('General Department exists:', general._id);
        }

        // 2. Migrate Users
        // We need to access the raw documents because the schema might have changed
        // forcing strict mode issues? No, usually fine.
        // But I commented out 'role' in schema, so I might not be able to read it via Mongoose model if strict is true.
        // Let's use collection directly or rely on Mongoose yielding lean objects.

        // Actually, if I commented out 'role' in Schema, User.find() won't return it unless I use lean().
        // Wait, Mongoose schema defines what's returned.
        // I should have kept 'role' in schema for migration...
        // Recommendation: Read raw collection for migration.

        const users = await User.collection.find({}).toArray();
        for (const u of users) {
            let updates = {};
            // Check valid role from raw doc
            const oldRole = u.role || 'Requester';

            if (oldRole === 'Admin') {
                updates.isAdmin = true;
            }

            // Check if permissions already exist
            if (!u.permissions || u.permissions.length === 0) {
                // Assign to General
                // Role mapping: Admin -> Requester in General (but global admin), 
                // Approver -> Approver in General.
                // Requester -> Requester in General.

                const deptRole = oldRole === 'Approver' ? 'Approver' : 'Requester';
                updates.permissions = [{
                    department: general._id,
                    role: deptRole
                }];
            }

            if (Object.keys(updates).length > 0) {
                await User.updateOne({ _id: u._id }, { $set: updates });
                console.log(`Migrated User: ${u.username}`);
            }
        }

        // 3. Migrate Projects
        const projects = await Project.find({ department: { $exists: false } });
        for (const p of projects) {
            p.department = general._id;
            await p.save();
            console.log(`Migrated Project: ${p.name}`);
        }

        console.log('Migration Complete');
        process.exit();
    } catch (error) {
        console.error('Migration Error:', error);
        process.exit(1);
    }
};

migrate();
