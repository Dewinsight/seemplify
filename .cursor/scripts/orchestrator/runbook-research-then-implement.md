# Runbook: Research then Implement

**Task shape:** User wants to research a topic (or “latest on X”) and then implement something (feature, example, integration).

## Tools (in order)

1. **web-research** or **MCP web-search-prime** or **Context7** — gather info
2. **dev-subagent** or **quick-flow-solo-dev-subagent** — implement

## Steps

1. **Clarify** (if fuzzy): What exactly to implement? In which repo/app?
2. **Research:** Use web-research, web-search-prime, or Context7 (if it’s library/framework docs). Capture: APIs, patterns, constraints, version compatibility.
3. **Handoff to dev:** Pass a short brief: topic, key findings, target (file/repo), and “done” criteria.
4. **Implement:** dev-subagent or quick-flow-solo-dev for the code. If it’s a tiny example, quick-flow is enough.
5. **Optional:** If implementation needs to be tried in a browser, add **cursor-ide-browser** after dev.

## Example prompts

- “Research OAuth2 with Google and add sign-in to the approver app.”
- “Find how to use React Server Components and build a small demo.”
- “Latest on Supabase RLS, then implement RLS for our projects table.”
