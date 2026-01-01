/**
 * Test script for signup session handling
 * 
 * This script can be used to test the signup endpoint and verify
 * that it correctly returns both access and refresh tokens
 */

const fetch = require('node-fetch');
const crypto = require('crypto');

// Generate a unique test email
const testEmail = `test-${crypto.randomBytes(4).toString('hex')}@example.com`;
const testPassword = 'TestPassword123';

async function testSignupEndpoint() {
  console.log(`Testing signup with email: ${testEmail}`);
  
  try {
    // Make request to signup endpoint
    const response = await fetch('http://localhost:5000/api/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TestScript/1.0'
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });
    
    const data = await response.json();
    console.log('\nResponse status:', response.status);
    
    // Check for token and refreshToken
    console.log('\nResponse validation:');
    console.log('- Access token present:', !!data.token);
    console.log('- Refresh token present:', !!data.refreshToken);
    console.log('- Session ID present:', !!data.sessionId);
    console.log('- User data present:', !!data.user);
    
    if (data.token && data.refreshToken) {
      console.log('\n✅ SUCCESS: Signup response includes both access and refresh tokens');
    } else if (data.token && !data.refreshToken && data.fallback) {
      console.log('\n⚠️ PARTIAL SUCCESS: Using fallback authentication without refresh token');
    } else {
      console.log('\n❌ FAILURE: Missing required tokens');
    }
    
    // Print full response for debugging
    console.log('\nFull response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
  }
}

testSignupEndpoint();
