# Orchestrator Tool-Pick Test Matrix

Use this to validate that the Master Orchestrator’s Auto-Choose Logic and Multi-Tool Combinations produce the right tools. Run `tool-pick-test.ps1` to check known tools are referenced.

## Test cases

| # | Task (user request) | Expected tool(s) in order | Runbook / notes |
|---|---------------------|---------------------------|------------------|
| 1 | Deploy the approver app to dev | deploy-agent or deploy-server | Single-tool |
| 2 | Search the web for Next.js 15 features | web-research or web-search-prime | Single-tool |
| 3 | How does Supabase auth work? Build a small example | Context7 → dev-subagent | docs-then-code |
| 4 | Research OAuth2 with Google and add sign-in to the backend | web-research or Context7 → dev-subagent | research-then-implement |
| 5 | Add the export button, run tests, and deploy | dev-subagent → tea-subagent → deploy-agent | build-test-deploy |
| 6 | Fix the login bug | dev-subagent | Single-tool (or dev → tea if “with tests”) |
| 7 | Search Notion for "auth design" and add a summary page | Notion (search, fetch) → tech-writer or analyst → Notion (create-pages) | notion-summarize-update |
| 8 | Should we use microservices or monolith? | sequential-thinking → web-research → architect-subagent | reason-then-design |
| 9 | Create a PRD for the notification feature | pm-subagent | Single-tool |
| 10 | Design the API for the new billing module | architect-subagent | Single-tool |
| 11 | Open the approver app and check if the login button works | cursor-ide-browser | Single-tool (MCP) |
| 12 | List all BMAD tasks and workflows | bmad-master | Single-tool |
| 13 | Create a Cursor rule for TypeScript in this project | create-rule | Single-tool |
| 14 | Quick prototype of a login form | quick-flow-solo-dev-subagent; optionally web-research | Single-tool or research first |
| 15 | Full cycle: new auth feature from requirements to deploy | web-research → pm-subagent → architect-subagent → dev-subagent → tea-subagent → deploy-agent | Complex; use only steps the task implies |
| 16 | Find what we decided about auth in Notion, check Supabase docs, update design doc | Notion → Context7 or web-reader → tech-writer or Notion update | Multi-tool; notion-summarize + docs-then-code |
| 17 | Add OAuth with Google, live by end of day | web-research or Context7 → architect-subagent → dev-subagent → deploy-agent | research-then-implement + deploy |
| 18 | Sprint planning for next week | sm-subagent | Single-tool |
| 19 | Document the approver project | tech-writer-subagent or document-project workflow | Single-tool |
| 20 | Discuss authentication strategies with the team | party-mode-subagent | Single-tool |

## Edge cases / clarifications

- **“Fix the login bug”** → dev-subagent. If user says “and add a test”, add tea-subagent before or after.
- **“Deploy”** alone → deploy-agent. If “deploy the X I just built”, dev is assumed done; deploy-agent.
- **“Research X”** (no implement) → web-research or web-search-prime; if “synthesize” or “document”, add analyst and/or tech-writer.
- **“Create a skill for X”** → create-skill. “Create a BMAD bridge skill” → create-bmad-skills.
