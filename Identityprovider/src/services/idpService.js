import dotenv from 'dotenv';

dotenv.config();

/**
 * IdP Service
 * Provides methods for SmartHR admin service to query Identity Provider
 * Admin service account has special permissions to access organization member data
 */

const IDP_BASE_URL = process.env.IDP_BASE_URL || process.env.ISSUER_URL;
const ADMIN_SERVICE_TOKEN = process.env.IDENTITY_PROVIDER_ADMIN_TOKEN;

if (!IDP_BASE_URL) {
  throw new Error('IDP_BASE_URL environment variable is required');
}

if (!ADMIN_SERVICE_TOKEN) {
  throw new Error('IDENTITY_PROVIDER_ADMIN_TOKEN environment variable is required');
}

/**
 * Make authenticated request to IdP API
 * @param {string} endpoint - API endpoint path (e.g., '/api/admin/organizations/:orgId/member-count')
 * @param {object} payload - Request body
 * @returns {Promise<object>} Response data
 */
async function idpRequest(endpoint, payload = {}) {
  const url = `${IDP_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SERVICE_TOKEN}`
    },
    ...(Object.keys(payload).length > 0 && { body: JSON.stringify(payload) })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`IdP API error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * Get member count for an organization
 * @param {string} orgId - Organization ID from IdP
 * @returns {Promise<number>} Number of active members
 */
async function getOrganizationMemberCount(orgId) {
  try {
    const response = await idpRequest(`/api/admin/organizations/${orgId}/member-count`);
    
    if (!response.success) {
      console.error('Failed to fetch member count from IdP:', response.error);
      return 0;
    }

    console.log(`✅ Fetched member count for org ${orgId}:`, response.memberCount);
    return response.memberCount;
  } catch (error) {
    console.error('Error fetching member count from IdP:', error.message);
    return 0;
  }
}

module.exports = {
  getOrganizationMemberCount
};

