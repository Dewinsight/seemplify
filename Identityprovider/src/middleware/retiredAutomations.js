/** Retirement is unconditional: stale flags or credentials must not reopen it. */
export function retiredAutomations(_req, res) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(410).json({
    allowed: false,
    code: 'AUTOMATIONS_REMOVED',
    message: 'Automations have been removed. Return to the app launcher to open Workspace.'
  })
}

export const RETIRED_AUTOMATION_CLIENT_IDS = new Set([
  'automation-hub', 'n8n', 'n8n-workspace-node'
])
