const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Job = require('../models/Job');
const Department = require('../models/Department');
const Organization = require('../models/Organization');

// Load environment variables
dotenv.config();

async function migrateJobDepartments() {
  try {
    console.log('🚀 Starting job department migration...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all organizations
    const organizations = await Organization.find();
    console.log(`📊 Found ${organizations.length} organizations`);

    for (const org of organizations) {
      console.log(`\n🏢 Processing organization: ${org.name} (${org._id})`);
      
      // Get or create departments for this organization
      let departments = await Department.find({ organization: org._id });
      console.log(`📋 Found ${departments.length} existing departments`);
      
      if (departments.length === 0) {
        // Create default departments
        console.log('📝 Creating default departments...');
        departments = await Department.createDefaultDepartments(org._id, org.owner);
        console.log(`✅ Created ${departments.length} default departments`);
      }
      
      // Get jobs for this organization that still have string departments or null departments
      const jobs = await Job.find({ 
        organization: org._id,
        $or: [
          { department: { $type: 'string' } },
          { department: null },
          { department: { $exists: false } }
        ]
      });
      
      console.log(`💼 Found ${jobs.length} jobs with string departments to migrate`);
      
      for (const job of jobs) {
        try {
          // Handle null/undefined departments
          if (!job.department || job.department === '') {
            // Assign to first available department (Engineering by default)
            const defaultDepartment = departments.find(dept => dept.name === 'Engineering') || departments[0];
            job.department = defaultDepartment._id;
            await job.save();
            console.log(`✅ Migrated job "${job.title}" to default department "${defaultDepartment.name}"`);
            continue;
          }

          // Find matching department by name (case-insensitive)
          const department = departments.find(dept => 
            dept.name.toLowerCase() === job.department.toLowerCase()
          );
          
          if (department) {
            // Update job to reference department ObjectId
            job.department = department._id;
            await job.save();
            console.log(`✅ Migrated job "${job.title}" to department "${department.name}"`);
          } else {
            // Create new department for this job
            console.log(`📝 Creating new department "${job.department}" for job "${job.title}"`);
            const newDepartment = new Department({
              name: job.department,
              organization: org._id,
              createdBy: org.owner
            });
            await newDepartment.save();
            
            // Update job to reference new department
            job.department = newDepartment._id;
            await job.save();
            
            // Add to departments array for future jobs
            departments.push(newDepartment);
            console.log(`✅ Created department "${newDepartment.name}" and migrated job "${job.title}"`);
          }
        } catch (jobError) {
          console.error(`❌ Error migrating job "${job.title}":`, jobError.message);
        }
      }
      
      console.log(`✅ Completed migration for organization: ${org.name}`);
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
    // Verify migration
    console.log('\n🔍 Verifying migration...');
    const remainingStringDepartments = await Job.countDocuments({
      $or: [
        { department: { $type: 'string' } },
        { department: null },
        { department: { $exists: false } }
      ]
    });
    
    if (remainingStringDepartments === 0) {
      console.log('✅ All jobs have been successfully migrated to use Department references');
    } else {
      console.log(`⚠️ ${remainingStringDepartments} jobs still have string departments`);
    }
    
    // Show statistics
    const totalDepartments = await Department.countDocuments();
    const totalJobs = await Job.countDocuments();
    console.log(`\n📊 Final Statistics:`);
    console.log(`   - Total Departments: ${totalDepartments}`);
    console.log(`   - Total Jobs: ${totalJobs}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateJobDepartments()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = migrateJobDepartments;
