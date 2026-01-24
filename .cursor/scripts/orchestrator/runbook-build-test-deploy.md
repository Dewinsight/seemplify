# Runbook: Build, Test, Deploy

**Task shape:** Implement a change, add/run tests, and deploy (or “ship it”, “get it live”).

## Tools (in order)

1. **dev-subagent** — implement
2. **tea-subagent** — tests (if the task asks for tests or “with tests”)
3. **deploy-agent** or **deploy-server** skill — deploy

## Steps

1. **Clarify:** What to build? Which app? Deploy to dev or prod?
2. **Implement:** dev-subagent (or quick-flow-solo-dev for small changes). Get to a clear “implemented” state.
3. **Test (if required):** tea-subagent for test design/automation, or run existing tests. Skip if user didn’t ask for tests.
4. **Deploy:** deploy-agent or deploy-server skill. Use `access/` for credentials; Dokploy API or `gh workflow run` as appropriate.

## Example prompts

- “Add the new API field, run tests, and deploy to dev.”
- “Fix the login bug and deploy the approver app.”
- “Implement the export button, add a quick test, and ship to production.”
