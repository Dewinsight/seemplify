'use strict';

const WORKSPACE_MCP_SERVER = 'seemplify_workspace';

function validateWorkspaceMcp(input) {
  const value = input.workspaceMcp;
  if (value === undefined || value === null) return undefined;
  if (input.requestSource !== 'messaging' || input.activity !== 'messaging.chat') {
    throw Object.assign(new Error('Workspace MCP is only available to Workspace chat.'), {
      code: 'WORKSPACE_MCP_FORBIDDEN', status: 403
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => key !== 'grantToken')
    || typeof value.grantToken !== 'string'
    || !/^[A-Za-z0-9_-]{43,128}$/.test(value.grantToken)) {
    throw Object.assign(new Error('Workspace MCP requires a valid temporary grant.'), {
      code: 'WORKSPACE_MCP_INVALID', status: 400
    });
  }
  return { grantToken: value.grantToken };
}

function workspaceMcpConfig(grant, env = process.env) {
  if (!grant) return {};
  let url;
  try {
    url = new URL(String(env.WORKSPACE_CHAT_MCP_URL
      || 'https://api-workspace.seemplifyai.com/api/internal/chat-mcp'));
  } catch { /* Report configuration failure without disclosing its value. */ }
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && env.NODE_ENV !== 'production'))) {
    throw Object.assign(new Error('The Workspace MCP endpoint configuration is invalid.'), {
      code: 'WORKSPACE_MCP_NOT_CONFIGURED', status: 503
    });
  }
  return {
    [WORKSPACE_MCP_SERVER]: {
      url: url.toString(),
      http_headers: { Authorization: `Bearer ${grant.grantToken}` },
      enabled: true,
      required: true,
      // Workspace's grant-scoped relay discovers and authorizes its registered
      // MCP tools. A second name list here would silently hide new server tools.
      default_tools_approval_mode: 'approve',
      startup_timeout_sec: 30,
      tool_timeout_sec: 90
    }
  };
}

function workspaceToolAction(item) {
  if (item?.type !== 'mcpToolCall' || item.server !== WORKSPACE_MCP_SERVER
    || typeof item.tool !== 'string' || !item.tool.trim() || item.tool.length > 128) return null;
  return {
    id: String(item.id || '').slice(0, 160),
    server: WORKSPACE_MCP_SERVER,
    tool: item.tool,
    status: item.status === 'completed' && !item.error && !item.result?.isError ? 'completed' : 'failed'
  };
}

module.exports = { WORKSPACE_MCP_SERVER, validateWorkspaceMcp, workspaceMcpConfig, workspaceToolAction };
