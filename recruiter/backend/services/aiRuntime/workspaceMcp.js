'use strict';

// The signed Workspace consumer can delegate one short-lived, read-only MCP
// grant. It cannot choose an endpoint, headers, tools, or another app activity.
function validateWorkspaceMcp(value, { service, activity } = {}) {
  if (value === undefined || value === null) return undefined;
  if (service !== 'messaging' || activity !== 'messaging.chat') {
    throw Object.assign(new Error('Workspace MCP is only available to Workspace chat.'), {
      code: 'WORKSPACE_MCP_FORBIDDEN', statusCode: 403
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => key !== 'grantToken')
    || typeof value.grantToken !== 'string'
    || !/^[A-Za-z0-9_-]{43,128}$/.test(value.grantToken)) {
    throw new TypeError('Workspace MCP requires a valid temporary grant.');
  }
  return { grantToken: value.grantToken };
}

module.exports = { validateWorkspaceMcp };
