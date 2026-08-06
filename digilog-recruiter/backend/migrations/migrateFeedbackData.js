/**
 * Migration Script: Create Default Feedback Form Templates
 * 
 * This script:
 * 1. Creates default feedback form templates for all existing organizations
 * 2. Updates organizations to reference their default template
 * 3. Updates existing jobs to use the default template
 * 
 * Usage:
 *   node backend/migrations/migrateFeedbackData.js [--dry-run]
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Organization = require('../models/Organization');
const Job = require('../models/Job');
const FeedbackFormTemplate = require('../models/FeedbackFormTemplate');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr';

// Check if running in dry-run mode
const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function createDefaultTemplate(organizationId, userId) {
  const systemFields = [
    { fieldId: 'name', fieldType: 'system', isVisible: true, isRequired: true, order: 1, label: 'Your Name' },
    { fieldId: 'email', fieldType: 'system', isVisible: true, isRequired: true, order: 2, label: 'Your Email' },
    { fieldId: 'overallRating', fieldType: 'system', isVisible: true, isRequired: true, order: 3, label: 'Overall Rating' },
    { fieldId: 'technicalRating', fieldType: 'system', isVisible: true, isRequired: true, order: 4, label: 'Technical Skills' },
    { fieldId: 'communicationRating', fieldType: 'system', isVisible: true, isRequired: true, order: 5, label: 'Communication Skills' },
    { fieldId: 'culturalRating', fieldType: 'system', isVisible: true, isRequired: true, order: 6, label: 'Cultural Fit' },
    { fieldId: 'generalFeedback', fieldType: 'system', isVisible: true, isRequired: true, order: 7, label: 'General Feedback' }
  ];

  const template = new FeedbackFormTemplate({
    organization: organizationId,
    name: 'Default Feedback Form',
    description: 'Default feedback form template with all standard fields',
    isDefault: true,
    systemFields: systemFields,
    customFields: [],
    createdBy: userId || organizationId // Use owner if no user ID provided
  });

  return template;
}

async function migrateOrganizations() {
  console.log('\n📊 Starting organization migration...\n');

  try {
    // Find all organizations
    const organizations = await Organization.find({});
    console.log(`Found ${organizations.length} organizations to process\n`);

    let processed = 0;
    let skipped = 0;
    let created = 0;

    for (const org of organizations) {
      console.log(`Processing organization: ${org.name} (${org._id})`);

      // Check if default template already exists
      const existingTemplate = await FeedbackFormTemplate.findOne({
        organization: org._id,
        isDefault: true
      });

      if (existingTemplate) {
        console.log(`  ⏭️  Already has default template: ${existingTemplate.name}`);
        skipped++;
        
        // Update organization reference if missing
        if (!org.settings.defaultFeedbackTemplate) {
          if (!isDryRun) {
            org.settings.defaultFeedbackTemplate = existingTemplate._id;
            await org.save();
          }
          console.log(`  ✓ Updated organization reference ${isDryRun ? '(dry-run)' : ''}`);
        }
        
        processed++;
        continue;
      }

      // Create default template
      const template = await createDefaultTemplate(org._id, org.owner);
      
      if (!isDryRun) {
        await template.save();
        console.log(`  ✓ Created default template`);
        
        // Update organization
        org.settings.defaultFeedbackTemplate = template._id;
        await org.save();
        console.log(`  ✓ Updated organization reference`);
        
        // Update existing jobs to use this template
        const jobUpdateResult = await Job.updateMany(
          {
            organization: org._id,
            'feedbackFormConfig.templateId': { $exists: false }
          },
          {
            $set: {
              'feedbackFormConfig.useTemplate': true,
              'feedbackFormConfig.templateId': template._id
            }
          }
        );
        
        console.log(`  ✓ Updated ${jobUpdateResult.modifiedCount} jobs to use template`);
        created++;
      } else {
        console.log(`  ✓ Would create default template (dry-run)`);
        console.log(`  ✓ Would update organization reference (dry-run)`);
        created++;
      }

      processed++;
      console.log('');
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  Total organizations: ${organizations.length}`);
    console.log(`  Processed: ${processed}`);
    console.log(`  Templates created: ${created}`);
    console.log(`  Skipped (already had template): ${skipped}`);
    
    if (isDryRun) {
      console.log('\n⚠️  DRY RUN MODE - No changes were saved');
    } else {
      console.log('\n✅ Migration completed successfully');
    }

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

async function verifyMigration() {
  console.log('\n🔍 Verifying migration...\n');

  try {
    const organizations = await Organization.find({});
    const templates = await FeedbackFormTemplate.find({ isDefault: true });
    
    console.log(`Total organizations: ${organizations.length}`);
    console.log(`Default templates created: ${templates.length}`);
    
    const orgsWithoutTemplate = [];
    for (const org of organizations) {
      const template = await FeedbackFormTemplate.findOne({
        organization: org._id,
        isDefault: true
      });
      
      if (!template) {
        orgsWithoutTemplate.push(org.name);
      }
    }
    
    if (orgsWithoutTemplate.length > 0) {
      console.log('\n⚠️  Organizations without default template:');
      orgsWithoutTemplate.forEach(name => console.log(`  - ${name}`));
    } else {
      console.log('\n✅ All organizations have default templates');
    }
    
    // Check jobs
    const jobsWithTemplate = await Job.countDocuments({
      'feedbackFormConfig.templateId': { $exists: true }
    });
    const totalJobs = await Job.countDocuments({});
    
    console.log(`\nJobs with feedback form template: ${jobsWithTemplate}/${totalJobs}`);
    
  } catch (error) {
    console.error('❌ Verification error:', error);
    throw error;
  }
}

async function runMigration() {
  console.log('🚀 Feedback Form Migration Script');
  console.log('==================================\n');
  
  if (isDryRun) {
    console.log('⚠️  Running in DRY RUN mode - no changes will be saved\n');
  }

  try {
    await connectDB();
    await migrateOrganizations();
    await verifyMigration();
    
    console.log('\n✅ Migration script completed\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  migrateOrganizations,
  verifyMigration,
  createDefaultTemplate
};

