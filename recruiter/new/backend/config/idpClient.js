/**
 * IdP API Client Configuration
 * 
 * Configures HTTP client for calling Identity Provider APIs
 * Handles authentication, token refresh, and error handling
 */

const axios = require('axios');

// Environment configuration
const IDP_API_BASE_URL = process.env.IDP_API_BASE_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';

/**
 * Create an axios instance configured for IdP API calls
 * @param {string} accessToken - OIDC access token for authentication
 * @returns {import('axios').AxiosInstance}
 */
const createIdpClient = (accessToken) => {
  const client = axios.create({
    baseURL: IDP_API_BASE_URL,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
    }
  });

  // Request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      console.log(`📤 IdP API Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      return config;
    },
    (error) => {
      console.error('❌ IdP API Request Error:', error.message);
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging and error handling
  client.interceptors.response.use(
    (response) => {
      console.log(`📥 IdP API Response: ${response.status} ${response.config.url}`);
      return response;
    },
    (error) => {
      if (error.response) {
        console.error(`❌ IdP API Error: ${error.response.status} ${error.response.config?.url}`, 
          error.response.data?.error || error.response.data?.message);
        
        // Handle specific error codes
        if (error.response.status === 401) {
          error.isTokenExpired = true;
        }
      } else if (error.request) {
        console.error('❌ IdP API Network Error: No response received');
        error.isNetworkError = true;
      } else {
        console.error('❌ IdP API Error:', error.message);
      }
      return Promise.reject(error);
    }
  );

  return client;
};

/**
 * Refresh IdP access token using refresh token
 * @param {string} refreshToken - OIDC refresh token
 * @returns {Promise<{accessToken: string, expiresIn: number, refreshToken?: string}>}
 */
const refreshIdpToken = async (refreshToken) => {
  const client = axios.create({
    baseURL: IDP_API_BASE_URL,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const clientId = process.env.OIDC_CLIENT_ID || 'smarthr';
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    ...(clientSecret && { client_secret: clientSecret })
  });

  try {
    const response = await client.post('/token', params.toString());
    
    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
      refreshToken: response.data.refresh_token || refreshToken
    };
  } catch (error) {
    console.error('❌ Token refresh failed:', error.response?.data || error.message);
    throw new Error('Failed to refresh IdP token');
  }
};

/**
 * Check if IdP API is available
 * @returns {Promise<boolean>}
 */
const checkIdpHealth = async () => {
  try {
    const client = createIdpClient();
    await client.get('/.well-known/openid-configuration');
    return true;
  } catch (error) {
    console.warn('⚠️ IdP health check failed:', error.message);
    return false;
  }
};

module.exports = {
  IDP_API_BASE_URL,
  createIdpClient,
  refreshIdpToken,
  checkIdpHealth
};
