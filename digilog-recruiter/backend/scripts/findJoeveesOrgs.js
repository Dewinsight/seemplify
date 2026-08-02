const mongoose = require('mongoose');
const Organization = require('../models/Organization');
require('dotenv').config();

const findJoeveesOrgs = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find all organizations with joevees in the name
    const orgs = await Organization.find({
      name: { $regex: 'joevees', $options: 'i' }
    });
    
    console.log(`\n📋 Found ${orgs.length} organizations with "joevees" in name:`);
    
    orgs.forEach((org, index) => {
      console.log(`\n🏢 Organization ${index + 1}:`);
      console.log('  - ID:', org._id);
      console.log('  - Name:', `"${org.name}"`);
      console.log('  - Plan:', org.subscription?.plan || 'undefined');
      console.log('  - Member Limit:', org.subscription?.memberLimit || 'undefined');
      console.log('  - Job Limit:', org.subscription?.jobLimit || 'undefined');
      console.log('  - Candidate Limit:', org.subscription?.candidateLimit || 'undefined');
      console.log('  - License Status:', org.subscription?.licenseStatus || 'undefined');
      console.log('  - Owner:', org.owner);
      console.log('  - Members:', org.members.length);
      console.log('  - Created:', org.createdAt);
      
      if (org.subscription?.adminNotes?.length > 0) {
        console.log('  - Admin Notes:');
        org.subscription.adminNotes.forEach((note, idx) => {
          console.log(`    ${idx + 1}. ${note.note} (${new Date(note.addedAt).toLocaleString()})`);
        });
      }
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error finding organizations:', error);
    process.exit(1);
  }
};

findJoeveesOrgs();
