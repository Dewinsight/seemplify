# Orchestrator Scripts & Runbooks

Scripts and runbooks for the **Master Orchestrator**. Use these when the task matches a known flow.

## Runbooks (follow when the flow fits)

| Runbook | Task shape | Tools (in order) |
|---------|------------|------------------|
| [runbook-research-then-implement.md](runbook-research-then-implement.md) | Research a topic, then implement | web-research or Context7 → dev-subagent or quick-flow-solo-dev |
| [runbook-build-test-deploy.md](runbook-build-test-deploy.md) | Implement, test, deploy | dev-subagent → tea-subagent → deploy-agent |
| [runbook-notion-summarize-update.md](runbook-notion-summarize-update.md) | Find in Notion, summarize, create/update page | Notion (search, fetch) → tech-writer or analyst → Notion (create/update) |
| [runbook-docs-then-code.md](runbook-docs-then-code.md) | Look up library docs, then implement | Context7 or web-reader → dev-subagent |
| [runbook-reason-then-design.md](runbook-reason-then-design.md) | Complex trade-offs, then architecture | sequential-thinking → architect-subagent |

## Helper scripts

| Script | Purpose |
|--------|---------|
| [tool-pick-test.ps1](tool-pick-test.ps1) | Run quick tool-pick tests (task → expected tools) |
| [test-matrix.md](test-matrix.md) | Test cases: input task + expected tool sequence |

## How the orchestrator uses these

1. **Analyze** the user request.
2. If it matches a **runbook** (by task shape), follow that runbook’s steps.
3. Otherwise use **Auto-Choose Logic** and **Multi-Tool Combinations** in `.cursor/agents/master-orchestrator.md`.
