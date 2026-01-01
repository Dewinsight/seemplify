/**
 * Test script for user removal functionality
 * This script tests the admin API endpoint for user removal
 */

const fetch = require('node-fetch');

// Configuration
const baseUrl = 'http://localhost:5000'; // Change to your API URL
const adminToken = process.argv[2]; // Pass admin token as command line argument
const testUserId = process.argv[3]; // Pass test user ID as command line argument

if (!adminToken || !testUserId) {
  console.error('Usage: node test-user-removal.js <admin-token> <user-id>');
  process.exit(1);
}

async function testUserRemoval() {
  console.log('=== User Removal Test ===');
  console.log(`Testing removal of user ID: ${testUserId}`);
  
  try {
    // First get user details to verify it exists
    console.log('\n1. Fetching user details...');
    const userResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}`, {
      headers: {
        'x-admin-auth-token': adminToken
      }
    });
    
    if (!userResponse.ok) {
      if (userResponse.status === 404) {
        console.error('User not found. Please provide a valid user ID.');
        process.exit(1);
      } else {
        throw new Error(`Failed to fetch user: ${userResponse.statusText}`);
      }
    }
    
    const userData = await userResponse.json();
    console.log(`Found user: ${userData.email}`);
    
    // Test initial removal without force flag (should fail if user owns organizations)
    console.log('\n2. Testing removal without force flag...');
    const normalDeleteResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}`, {
      method: 'DELETE',
      headers: {
        'x-admin-auth-token': adminToken
      }
    });
    
    const normalDeleteData = await normalDeleteResponse.json();
    
    if (normalDeleteResponse.ok) {
      console.log('✅ User removal succeeded without force flag');
      console.log('Result:', normalDeleteData);
      return; // Exit early since user was already deleted
    } else if (normalDeleteResponse.status === 400 && normalDeleteData.ownsOrganizations) {
      console.log('⚠️ User owns organizations. Testing force delete...');
      
      // Test removal with force flag
      console.log('\n3. Testing removal with force flag...');
      const forceDeleteResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}?force=true`, {
        method: 'DELETE',
        headers: {
          'x-admin-auth-token': adminToken
        }
      });
      
      if (forceDeleteResponse.ok) {
        const forceDeleteData = await forceDeleteResponse.json();
        console.log('✅ User removal succeeded with force flag');
        console.log('Result:', forceDeleteData);
      } else {
        const errorData = await forceDeleteResponse.json();
        console.error('❌ Force delete failed:', errorData);
      }
    } else {
      console.error('❌ User removal failed:', normalDeleteData);
    }
    
    // Verify user no longer exists
    console.log('\n4. Verifying user removal...');
    const verifyResponse = await fetch(`${baseUrl}/api/admin/users/${testUserId}`, {
      headers: {
        'x-admin-auth-token': adminToken
      }
    });
    
    if (verifyResponse.status === 404) {
      console.log('✅ User successfully removed from system');
    } else {
      console.error('❌ User still exists in system');
    }
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

testUserRemoval();
