// Test script to create organization via IDP API
const https = require('https');

const IDP_URL = 'auth.seemplifyai.com';
const testOrgData = {
  name: 'SSH Test Org 0420',
  description: 'Testing realm provisioning'
};

console.log('=== Creating Test Organization ===');
console.log('Organization:', testOrgData);
console.log('');

// Note: This requires authentication
// For testing, we'll need to either:
// 1. Use a valid session cookie
// 2. Use an API token
// 3. Create the org directly in the database

console.log('⚠️  This script requires authentication.');
console.log('Please use one of the following methods:');
console.log('1. Login to https://auth.seemplifyai.com and copy session cookie');
console.log('2. Create an API token with organizations:write scope');
console.log('3. Use direct database creation (below)');
console.log('');

// Direct database approach
console.log('=== Alternative: Direct Database Creation ===');
console.log('Run this inside the IDP container:');
console.log(`
const { Organization } = require('./src/models/Organization.js');
const { Account } = require('./src/models/Account.js');
const zulipService = require('./src/services/zulipService.js');

async function createTestOrg() {
  try {
    // Find test user
    const user = await Account.findOne({ email: 'michaelegbo@gmail.com' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    // Create organization
    const organization = await Organization.create({
      name: 'SSH Test Org 0420',
      description: 'Testing realm provisioning',
      owner: user._id,
      members: [{
        account: user._id,
        role: 'owner',
        joinedAt: new Date(),
        status: 'active'
      }]
    });
    
    console.log('✅ Organization created:', organization._id);
    
    // Provision Zulip realm
    const zulipRealmInfo = await zulipService.createZulipRealm(organization, user);
    console.log('✅ Zulip realm provisioned:', zulipRealmInfo);
    
    // Update user
    await Account.updateOne(
      { _id: user._id },
      {
        $push: {
          organizations: {
            organization: organization._id,
            role: 'owner',
            joinedAt: new Date(),
            isActive: true
          }
        },
        $set: { 
          currentOrganization: organization._id,
          updatedAt: new Date()
        }
      }
    );
    
    console.log('✅ Test organization created successfully!');
    console.log('Organization ID:', organization._id);
    console.log('Zulip Realm ID:', zulipRealmInfo.realmId);
    console.log('Zulip String ID:', zulipRealmInfo.realmStringId);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createTestOrg();
`);
