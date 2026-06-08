// Test script to verify signup flow
// Run this in browser console to test signup behavior

async function testSignupFlow() {
  console.log('🧪 Starting signup flow test');

  // Clear any existing session data
  localStorage.removeItem('jwt');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('tokenExpiresAt');
  localStorage.removeItem('signupEmail');
  sessionStorage.removeItem('inSignupFlow');
  sessionStorage.removeItem('signupSuccess');
  sessionStorage.removeItem('signupTime');

  console.log('🧹 Cleared existing session data');
  
  // Mock successful signup response
  const mockResponse = {
    token: 'test-token-' + Date.now(),
    refreshToken: 'test-refresh-token-' + Date.now(),
    expiresIn: '10m',
    sessionId: 'test-session-id',
    user: {
      id: 'test-user-id',
      email: 'test@example.com'
    }
  };
  
  console.log('📦 Created mock response data:', mockResponse);
  
  // Simulate signup process
  console.log('🔐 Simulating signup process');
  
  // 1. Set signup flow flags in sessionStorage
  sessionStorage.setItem('inSignupFlow', 'true');
  sessionStorage.setItem('signupSuccess', 'true');
  sessionStorage.setItem('signupTime', Date.now().toString());
  
  // 2. Store tokens in localStorage
  localStorage.setItem('jwt', mockResponse.token);
  localStorage.setItem('refreshToken', mockResponse.refreshToken);
  localStorage.setItem('tokenExpiresAt', (Date.now() + 10 * 60 * 1000).toString());
  localStorage.setItem('signupEmail', mockResponse.user.email);
  
  console.log('💾 Stored tokens and session flags');
  
  // 3. Check storage state
  const storedData = {
    jwt: localStorage.getItem('jwt'),
    refreshToken: localStorage.getItem('refreshToken'),
    tokenExpiresAt: localStorage.getItem('tokenExpiresAt'),
    signupEmail: localStorage.getItem('signupEmail'),
    inSignupFlow: sessionStorage.getItem('inSignupFlow'),
    signupSuccess: sessionStorage.getItem('signupSuccess'),
    signupTime: sessionStorage.getItem('signupTime'),
  };
  
  console.log('🔍 Current storage state:', storedData);
  
  // 4. Test navigation to success page
  console.log('🧭 Navigating to success page...');
  
  // Navigation will happen after this test completes
  console.log('✅ Test completed. You should now be able to navigate to /signup/success without redirecting to login.');
  console.log('🔗 Try this URL: ' + window.location.origin + '/signup/success');
}

// Execute the test
testSignupFlow();