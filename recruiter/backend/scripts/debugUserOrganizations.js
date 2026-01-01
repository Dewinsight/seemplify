const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');

// Connect to MongoDB
require('dotenv').config({ path: '../.env' });
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr');

async function debugUserOrganizations(email) {
  try {
    console.log(`🔍 Debugging organizations for user: ${email}`);
    
    // Find the user
    const user = await User.findOne({ email }).populate({
      path: 'organizationMemberships.organization',
      match: { isActive: true }
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log(`👤 User: ${user.email}`);
    console.log(`📊 Total memberships: ${user.organizationMemberships.length}`);
    console.log(`🏢 Current organization: ${user.currentOrganization}`);
    
    console.log('\n📋 Organization Memberships:');
    console.log('================================');
    
    user.organizationMemberships.forEach((membership, index) => {
      console.log(`\n${index + 1}. Organization:`);
      console.log(`   ID: ${membership.organization?._id || membership.organization}`);
      console.log(`   Name: ${membership.organization?.name || 'Not populated'}`);
      console.log(`   User Role: ${membership.role}`);
      console.log(`   Active: ${membership.isActive}`);
      console.log(`   Joined: ${membership.joinedAt}`);
      
      if (membership.organization) {
        console.log(`   Org Owner: ${membership.organization.owner}`);
        console.log(`   Org Active: ${membership.organization.isActive}`);
      }
    });
    
    // Check if there are any issues
    console.log('\n🔍 Checking for issues:');
    console.log('=======================');
    
    const activeMemberships = user.organizationMemberships.filter(m => m.isActive && m.organization);
    console.log(`✅ Active memberships with valid organizations: ${activeMemberships.length}`);
    
    // Check for duplicates
    const orgIds = activeMemberships.map(m => m.organization._id.toString());
    const uniqueOrgIds = [...new Set(orgIds)];
    
    if (orgIds.length !== uniqueOrgIds.length) {
      console.log('⚠️ DUPLICATE MEMBERSHIPS FOUND!');
      const duplicates = orgIds.filter((id, index) => orgIds.indexOf(id) !== index);
      console.log('   Duplicate org IDs:', duplicates);
    } else {
      console.log('✅ No duplicate memberships found');
    }
    
    // Check current organization validity
    if (user.currentOrganization) {
      const currentOrgMembership = activeMemberships.find(
        m => m.organization._id.toString() === user.currentOrganization.toString()
      );
      
      if (currentOrgMembership) {
        console.log(`✅ Current organization membership valid: ${currentOrgMembership.role}`);
      } else {
        console.log('❌ Current organization membership NOT FOUND!');
      }
    }
    
    // Show what each organization thinks about this user
    console.log('\n🏢 Organization perspective:');
    console.log('============================');
    
    for (const membership of activeMemberships) {
      if (membership.organization) {
        const fullOrg = await Organization.findById(membership.organization._id);
        const orgMember = fullOrg.members.find(m => m.user.toString() === user._id.toString());
        
        console.log(`\nOrganization: ${fullOrg.name}`);
        console.log(`  Owner: ${fullOrg.owner.toString() === user._id.toString() ? 'YES' : 'NO'}`);
        console.log(`  User membership role: ${membership.role}`);
        console.log(`  Org member record: ${orgMember ? orgMember.role : 'NOT FOUND'}`);
        
        if (membership.role !== orgMember?.role) {
          console.log(`  ⚠️ ROLE MISMATCH! User: ${membership.role}, Org: ${orgMember?.role}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function fixUserOrganizations(email) {
  try {
    console.log(`🔧 Fixing organizations for user: ${email}`);
    
    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    // Get all organizations the user should be a member of
    const organizations = await Organization.find({
      $or: [
        { owner: user._id },
        { 'members.user': user._id }
      ],
      isActive: true
    });
    
    console.log(`🏢 Found ${organizations.length} organizations user should be a member of`);
    
    // Clear existing memberships
    user.organizationMemberships = [];
    
    // Rebuild memberships from organization records
    for (const org of organizations) {
      let role;
      
      if (org.owner.toString() === user._id.toString()) {
        role = 'owner';
      } else {
        const member = org.members.find(m => m.user.toString() === user._id.toString());
        role = member?.role || 'recruiter';
      }
      
      user.organizationMemberships.push({
        organization: org._id,
        role: role,
        isActive: true,
        joinedAt: new Date()
      });
      
      console.log(`✅ Added membership: ${org.name} as ${role}`);
    }
    
    await user.save();
    console.log('✅ User memberships fixed!');
    
  } catch (error) {
    console.error('❌ Error fixing:', error);
  }
}

// Run the script
const email = process.argv[2] || 'michaelegbo@gmail.com';
const action = process.argv[3] || 'debug'; // 'debug' or 'fix'

if (action === 'fix') {
  fixUserOrganizations(email).then(() => {
    console.log('🏁 Done!');
    process.exit(0);
  });
} else {
  debugUserOrganizations(email).then(() => {
    console.log('🏁 Done!');
    process.exit(0);
  });
}