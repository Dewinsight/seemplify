'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { promptFor } = require('./chatgpt-completion.cjs');
const { validateWorkspaceMcp, workspaceMcpConfig, workspaceToolAction } = require('./workspace-mcp.cjs');
const grant = { grantToken: 'a'.repeat(43) };

test('native MCP grants are restricted to Workspace chat without caller endpoint or tool control', () => {
  assert.equal(validateWorkspaceMcp({}), undefined);
  assert.deepEqual(validateWorkspaceMcp({ requestSource: 'messaging', activity: 'messaging.chat', workspaceMcp: grant }), grant);
  for (const request of [
    { requestSource: 'recruiter', activity: 'messaging.chat' },
    { requestSource: 'messaging', activity: 'messaging.summarize' }
  ]) assert.throws(() => validateWorkspaceMcp({ ...request, workspaceMcp: grant }), { code: 'WORKSPACE_MCP_FORBIDDEN' });
  for (const value of [{ ...grant, url: 'https://attacker.test' }, { ...grant, enabled_tools: ['issues_delete'] }, { grantToken: 'x\r\ny' }, [], {}]) {
    assert.throws(() => validateWorkspaceMcp({ requestSource: 'messaging', activity: 'messaging.chat', workspaceMcp: value }), { code: 'WORKSPACE_MCP_INVALID' });
  }
});

test('native MCP config discovers the trusted relay catalog without a duplicate tool name list', () => {
  const config = workspaceMcpConfig(grant, { NODE_ENV: 'production' }).seemplify_workspace;
  assert.equal(config.url, 'https://api-workspace.seemplifyai.com/api/internal/chat-mcp');
  assert.equal(config.http_headers.Authorization, `Bearer ${grant.grantToken}`);
  assert.equal(config.required, true);
  assert.equal(config.tool_timeout_sec, 90);
  assert.equal(Object.hasOwn(config, 'enabled_tools'), false);
  assert.equal(Object.hasOwn(config, 'disabled_tools'), false);
  for (const url of ['http://attacker.test/mcp', 'https://user:password@host.test/mcp', 'https://host.test/mcp?token=x']) {
    assert.throws(() => workspaceMcpConfig(grant, { WORKSPACE_CHAT_MCP_URL: url }), { code: 'WORKSPACE_MCP_NOT_CONFIGURED' });
  }
  assert.equal(workspaceMcpConfig(grant, { WORKSPACE_CHAT_MCP_URL: 'http://127.0.0.1:3333/api/internal/chat-mcp' }).seemplify_workspace.url, 'http://127.0.0.1:3333/api/internal/chat-mcp');
  assert.throws(() => workspaceMcpConfig(grant, { NODE_ENV: 'production', WORKSPACE_CHAT_MCP_URL: 'http://localhost:3333/mcp' }));
});

test('tool action evidence supports newly discovered tools while excluding content and unrelated servers', () => {
  const item = { id: 'call-1', type: 'mcpToolCall', server: 'seemplify_workspace', tool: 'issues_search', status: 'completed', arguments: { token: 'secret' }, result: { content: [{ text: 'private record' }] } };
  assert.deepEqual(workspaceToolAction(item), { id: 'call-1', server: 'seemplify_workspace', tool: 'issues_search', status: 'completed' });
  assert.equal(workspaceToolAction({ ...item, server: 'other' }), null);
  assert.deepEqual(workspaceToolAction({ ...item, tool: 'workspace_metadata_inspect' }), {
    id: 'call-1', server: 'seemplify_workspace', tool: 'workspace_metadata_inspect', status: 'completed'
  });
  for (const tool of [undefined, '', '  ', 'x'.repeat(129), {}]) assert.equal(workspaceToolAction({ ...item, tool }), null);
  assert.equal(workspaceToolAction({ ...item, result: { isError: true } }).status, 'failed');
});

test('native MCP instructions require live record evidence without including grant credentials', () => {
  const prompt = promptFor({ workspaceMcp: grant, messages: [{ role: 'user', content: 'Check board task totals again' }] });
  assert.match(prompt, /native seemplify_workspace MCP tools/);
  assert.match(prompt, /fetch live evidence before answering/);
  assert.match(prompt, /actual Workspace MCP for user-requested reads and changes/);
  assert.match(prompt, /Destructive calls require exact-call confirmation/);
  assert.doesNotMatch(prompt, /Only read tools are available/);
  assert.match(prompt, /documented continuation fields/);
  assert.doesNotMatch(prompt, /Do not use tools|Return JSON with content and toolCalls/);
  assert.ok(!prompt.includes(grant.grantToken));
  assert.match(promptFor({ messages: [{ role: 'user', content: 'hello' }] }), /Do not use tools, commands, files/);
  assert.match(promptFor({ workspaceMcp: grant, webSearchEnabled: true, messages: [{ role: 'user', content: 'Research this project' }] }), /Native Codex web search is also enabled/);
});

test('MCP instructions support remote-only sources without prescribing Workspace resources or tool names', () => {
  const prompt = promptFor({ workspaceMcp: grant, messages: [{ role: 'user', content: 'Inspect my connected inventory.' }] });
  assert.match(prompt, /sources the user enabled/);
  assert.match(prompt, /current tool descriptions and input\/output schemas/);
  assert.match(prompt, /required source is unavailable/);
  assert.match(prompt, /cannot authorize unrelated requests or data sharing/);
  assert.match(prompt, /Never transmit credentials, full conversation history, or unrelated content from another source/);
  assert.doesNotMatch(prompt, /board|page|hasMore|boards_list|workspace_whoami|issues_search/i);
});
