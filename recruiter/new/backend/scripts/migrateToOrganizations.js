const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');

// Load environment variables
dotenv.config();

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected for migration');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function migrateToOrganizations() {
  try {
    console.log('🚀 Starting migration to organization structure...');

    // Get all existing users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to migrate`);

    for (const user of users) {
      console.log(`\n👤 Processing user: ${user.email} (${user._id})`);

      // Skip if user already has organization setup
      if (user.hasCompletedOrganizationSetup && user.organizationMemberships.length > 0) {
        console.log(`  ⏭️  User already has organization setup, skipping...`);
        continue;
      }

      // Create organization for the user based on their company info
      const organizationData = {
        name: user.company?.name || `${user.profile?.firstName || 'User'}'s Organization`,
        description: 'Migrated from existing data',
        industry: user.company?.industry || '',
        size: user.company?.size || '1-10',
        website: user.company?.website || '',
        logo: user.company?.logo || '',
        owner: user._id,
        members: [{
          user: user._id,
          role: 'owner',
          status: 'active'
        }]
      };

      console.log(`  🏢 Creating organization: "${organizationData.name}"`);
      const organization = new Organization(organizationData);
      await organization.save();

      // Update user with organization membership
      console.log(`  👥 Adding user to organization as owner`);
      user.organizationMemberships = [{
        organization: organization._id,
        role: 'owner',
        isActive: true
      }];
      user.currentOrganization = organization._id;
      user.hasCompletedOrganizationSetup = true;
      await user.save();

      // Find and update all candidates created by this user
      const candidatesResult = await Candidate.updateMany(
        { 
          createdBy: user._id, 
          organization: { $exists: false } 
        },
        { 
          organization: organization._id 
        }
      );
      console.log(`  📝 Updated ${candidatesResult.modifiedCount} candidates`);

      // Find and update all jobs created by this user
      const jobsResult = await Job.updateMany(
        { 
          createdBy: user._id, 
          organization: { $exists: false } 
        },
        { 
          organization: organization._id 
        }
      );
      console.log(`  💼 Updated ${jobsResult.modifiedCount} jobs`);

      console.log(`  ✅ Successfully migrated user ${user.email}`);
    }

    // Handle orphaned candidates (those without createdBy)
    console.log(`\n🔍 Checking for orphaned candidates...`);
    const orphanedCandidates = await Candidate.find({ 
      organization: { $exists: false },
      $or: [
        { createdBy: { $exists: false } },
        { createdBy: null }
      ]
    });

    if (orphanedCandidates.length > 0) {
      console.log(`📝 Found ${orphanedCandidates.length} orphaned candidates`);
      
      // Create a default organization for orphaned data
      const defaultOrg = new Organization({
        name: 'Legacy Data Organization',
        description: 'Organization created for orphaned candidates during migration',
        industry: 'Various',
        size: '1-10',
        owner: users[0]._id, // Assign to first user as owner
        members: [{
          user: users[0]._id,
          role: 'owner',
          status: 'active'
        }]
      });
      await defaultOrg.save();
      console.log(`🏢 Created default organization for orphaned data`);

      // Assign orphaned candidates to default organization
      await Candidate.updateMany(
        { 
          organization: { $exists: false },
          $or: [
            { createdBy: { $exists: false } },
            { createdBy: null }
          ]
        },
        { 
          organization: defaultOrg._id,
          createdBy: users[0]._id
        }
      );
      console.log(`📝 Assigned ${orphanedCandidates.length} orphaned candidates to default organization`);
    }

    // Handle orphaned jobs
    console.log(`\n🔍 Checking for orphaned jobs...`);
    const orphanedJobs = await Job.find({ 
      organization: { $exists: false },
      $or: [
        { createdBy: { $exists: false } },
        { createdBy: null }
      ]
    });

    if (orphanedJobs.length > 0) {
      console.log(`💼 Found ${orphanedJobs.length} orphaned jobs`);
      
      // Find the default organization or use the first user's organization
      let defaultOrg = await Organization.findOne({ name: 'Legacy Data Organization' });
      if (!defaultOrg) {
        defaultOrg = await Organization.findOne({ owner: users[0]._id });
      }

      if (defaultOrg) {
        await Job.updateMany(
          { 
            organization: { $exists: false },
            $or: [
              { createdBy: { $exists: false } },
              { createdBy: null }
            ]
          },
          { 
            organization: defaultOrg._id,
            createdBy: users[0]._id
          }
        );
        console.log(`💼 Assigned ${orphanedJobs.length} orphaned jobs to default organization`);
      }
    }

    console.log('\n🎉 Migration completed successfully!');
    
    // Print summary
    const totalOrganizations = await Organization.countDocuments();
    const totalCandidatesWithOrg = await Candidate.countDocuments({ organization: { $exists: true } });
    const totalJobsWithOrg = await Job.countDocuments({ organization: { $exists: true } });
    const totalUsersWithOrg = await User.countDocuments({ hasCompletedOrganizationSetup: true });

    console.log('\n📊 Migration Summary:');
    console.log(`   Organizations created: ${totalOrganizations}`);
    console.log(`   Users with organization setup: ${totalUsersWithOrg}`);
    console.log(`   Candidates with organization: ${totalCandidatesWithOrg}`);
    console.log(`   Jobs with organization: ${totalJobsWithOrg}`);

  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
}

async function verifyMigration() {
  try {
    console.log('\n🔍 Verifying migration...');

    // Check for candidates without organization
    const candidatesWithoutOrg = await Candidate.countDocuments({ organization: { $exists: false } });
    console.log(`Candidates without organization: ${candidatesWithoutOrg}`);

    // Check for jobs without organization
    const jobsWithoutOrg = await Job.countDocuments({ organization: { $exists: false } });
    console.log(`Jobs without organization: ${jobsWithoutOrg}`);

    // Check for users without organization setup
    const usersWithoutOrg = await User.countDocuments({ hasCompletedOrganizationSetup: { $ne: true } });
    console.log(`Users without organization setup: ${usersWithoutOrg}`);

    if (candidatesWithoutOrg === 0 && jobsWithoutOrg === 0 && usersWithoutOrg === 0) {
      console.log('✅ Migration verification passed!');
    } else {
      console.log('⚠️ Some data still needs migration');
    }

  } catch (error) {
    console.error('❌ Verification error:', error);
  }
}

async function main() {
  await connectDB();
  await migrateToOrganizations();
  await verifyMigration();
  
  console.log('\n🔒 Closing database connection...');
  await mongoose.connection.close();
  process.exit(0);
}

// Run migration if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrateToOrganizations, verifyMigration }; 