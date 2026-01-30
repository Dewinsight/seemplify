const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const DepartmentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: String,
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

const Department = mongoose.model('Department', DepartmentSchema);

const seedDepartments = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        const depts = [
            { name: 'IT', description: 'Information Technology' },
            { name: 'HR', description: 'Human Resources' },
            { name: 'Finance', description: 'Financial Operations' },
            { name: 'Legal', description: 'Legal & Compliance' },
            { name: 'Operations', description: 'Business Operations' },
            { name: 'Marketing', description: 'Marketing & Communications' }
        ];

        for (const d of depts) {
            const exists = await Department.findOne({ name: d.name });
            if (!exists) {
                await Department.create(d);
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
