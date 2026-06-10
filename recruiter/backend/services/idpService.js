/**
 * IdP Service
 * 
 * Helper service for making Identity Provider API calls
 * Handles token refresh, retries, and provides high-level methods
 */

const { createIdpClient, refreshIdpToken, checkIdpHealth } = require('../config/idpClient');
const User = require('../models/User');

const DEFAULT_IDP_HUB_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : 'https://auth.seemplifyai.com';

/**
 * Execute an IdP API call with automatic token refresh on 401
 * @param {string} userId - SmartHR user ID
 * @param {Function} apiCall - Function that accepts axios client and makes the API call
 * @returns {Promise<any>} - API response data
 */
const executeWithTokenRefresh = async (userId, apiCall) => {
  // Get user with IdP tokens
  const user = await User.findById(userId)
    .select('+idpAccessToken +idpRefreshToken +idpTokenExpiry');

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.idpAccessToken) {
    throw new Error('No IdP access token available. User must re-authenticate.');
  }

  // Check if token is expired (with 60 second buffer)
  const isTokenExpired = user.idpTokenExpiry &&
    new Date(user.idpTokenExpiry) < new Date(Date.now() + 60000);

  let accessToken = user.idpAccessToken;

  // Refresh token if expired and refresh token is available
  if (isTokenExpired && user.idpRefreshToken) {
    console.log('🔄 IdP access token expired, refreshing...');
    try {
      const newTokens = await refreshIdpToken(user.idpRefreshToken);

      // Update user with new tokens
      user.idpAccessToken = newTokens.accessToken;
      user.idpTokenExpiry = new Date(Date.now() + (newTokens.expiresIn * 1000));
      if (newTokens.refreshToken !== user.idpRefreshToken) {
        user.idpRefreshToken = newTokens.refreshToken;
      }
      await user.save();

      accessToken = newTokens.accessToken;
      console.log('✅ IdP token refreshed successfully');
    } catch (refreshError) {
      console.error('❌ Token refresh failed:', refreshError.message);
      throw new Error('IdP token refresh failed. User must re-authenticate.');
    }
  }

  // Create client and execute API call
  const client = createIdpClient(accessToken);

  try {
    return await apiCall(client);
  } catch (error) {
    // If token expired error, try refresh once more
    if (error.isTokenExpired && user.idpRefreshToken) {
      console.log('🔄 Received 401, attempting token refresh...');
      try {
        const newTokens = await refreshIdpToken(user.idpRefreshToken);

        user.idpAccessToken = newTokens.accessToken;
        user.idpTokenExpiry = new Date(Date.now() + (newTokens.expiresIn * 1000));
        if (newTokens.refreshToken !== user.idpRefreshToken) {
          user.idpRefreshToken = newTokens.refreshToken;
        }
        await user.save();

        // Retry with new token
        const retryClient = createIdpClient(newTokens.accessToken);
        return await apiCall(retryClient);
      } catch (retryError) {
        console.error('❌ Retry after token refresh failed:', retryError.message);
        throw new Error('IdP authentication failed. User must re-authenticate.');
      }
    }
    throw error;
  }
};

/**
 * Get organization members from IdP
 * @param {string} idpOrganizationId - IdP organization ID
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Members data from IdP
 */
const getOrganizationMembers = async (idpOrganizationId, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.get(`/api/organizations/${idpOrganizationId}/members`);
    return response.data;
  });
};

/**
 * Get single member details from IdP
 * @param {string} idpOrganizationId - IdP organization ID
 * @param {string} memberId - IdP member/account ID
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Member data from IdP
 */
const getOrganizationMember = async (idpOrganizationId, memberId, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.get(`/api/organizations/${idpOrganizationId}/members/${memberId}`);
    return response.data;
  });
};

/**
 * Get organization details from IdP
 * @param {string} idpOrganizationId - IdP organization ID
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Organization data from IdP
 */
const getOrganization = async (idpOrganizationId, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.get(`/api/organizations/${idpOrganizationId}`);
    return response.data;
  });
};

/**
 * Create organization in IdP
 * @param {Object} organizationData - Organization data { name }
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Created organization from IdP
 */
const createOrganization = async (organizationData, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.post('/api/organizations', organizationData);
    return response.data;
  });
};

/**
 * Get organization invitations from IdP
 * @param {string} idpOrganizationId - IdP organization ID
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Invitations data from IdP
 */
const getOrganizationInvitations = async (idpOrganizationId, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.get(`/api/organizations/${idpOrganizationId}/invitations`);
    return response.data;
  });
};

/**
 * Get organization teams from IdP
 * @param {string} idpOrganizationId - IdP organization ID
 * @param {string} userId - SmartHR user ID for authentication
 * @returns {Promise<Object>} - Teams data from IdP
 */
const getOrganizationTeams = async (idpOrganizationId, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.get(`/api/organizations/${idpOrganizationId}/teams`);
    return response.data;
  });
};

/**
 * Check if IdP service is available
 * @returns {Promise<boolean>}
 */
const isIdpAvailable = async () => {
  return checkIdpHealth();
};

/**
 * Get IdP management URL for redirecting users
 * @param {string} idpOrganizationId - IdP organization ID (optional)
 * @param {string} section - Section to redirect to (members, invitations, teams)
 * @returns {string} - IdP management URL
 */
const getIdpManagementUrl = (idpOrganizationId = null, section = 'members') => {
  const baseUrl = process.env.IDP_HUB_URL || process.env.OIDC_ISSUER || DEFAULT_IDP_HUB_URL;

  // Map section names to correct IdP routes
  // IdP routes follow pattern: /organizations/:orgId/{section}
  if (idpOrganizationId) {
    switch (section) {
      case 'members':
        return `${baseUrl}/organizations/${idpOrganizationId}/members`;
      case 'invitations':
        return `${baseUrl}/organizations/${idpOrganizationId}/invitations`;
      case 'teams':
        return `${baseUrl}/organizations/${idpOrganizationId}/teams`;
      default:
        return `${baseUrl}/organizations/${idpOrganizationId}`;
    }
  }
  return `${baseUrl}/organizations`;
};

/**
 * Get all organizations from IdP admin API (no user auth required)
 * Used by SmartHR admin panel to sync organizations
 * @param {Object} options - Query options { page, limit, search }
 * @returns {Promise<Object>} - Organizations list from IdP
 */
const getAllOrganizations = async (options = {}) => {
  const { createIdpClient } = require('../config/idpClient');
  const client = createIdpClient(); // No token needed for admin API

  try {
    const response = await client.get('/api/admin/organizations', {
      params: {
        page: options.page || 1,
        limit: options.limit || 100,
        search: options.search || ''
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching organizations from IdP admin API:', error.message);
    // Return empty data on error so admin panel still works with local data
    return { organizations: [], total: 0, page: 1, totalPages: 0 };
  }
};

/**
 * Push collected onboarding profile data (name/personalInfo/banking/dependents)
 * to an existing IdP member via the payroll-sync endpoint. The IdP remains the
 * source of truth for the employee profile.
 * @param {string} idpOrganizationId
 * @param {string} memberId - IdP account id (or sub)
 * @param {Object} profilePayload - payroll-sync body
 * @param {string} userId - recruiter User id whose IdP token authenticates the call
 */
const updateEmployeeProfile = async (idpOrganizationId, memberId, profilePayload, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.put(
      `/api/organizations/${idpOrganizationId}/members/${memberId}/payroll-sync`,
      profilePayload
    );
    return response.data;
  });
};

/**
 * Set an IdP member's onboarding status override (e.g. mark as completed once a
 * recruiter onboarding finishes).
 * @param {string} idpOrganizationId
 * @param {string} memberId - IdP account id (or sub)
 * @param {string} status - one of not_started|pending|in_progress|completed
 * @param {string} userId - recruiter User id whose IdP token authenticates the call
 */
const setMemberOnboardingStatus = async (idpOrganizationId, memberId, status, userId) => {
  return executeWithTokenRefresh(userId, async (client) => {
    const response = await client.put(
      `/api/organizations/${idpOrganizationId}/members/${memberId}/onboarding-status`,
      { status }
    );
    return response.data;
  });
};

module.exports = {
  getOrganizationMembers,
  getOrganizationMember,
  getOrganization,
  createOrganization,
  getOrganizationInvitations,
  getOrganizationTeams,
  isIdpAvailable,
  getIdpManagementUrl,
  executeWithTokenRefresh,
  updateEmployeeProfile,
  setMemberOnboardingStatus,
  getAllOrganizations
};

