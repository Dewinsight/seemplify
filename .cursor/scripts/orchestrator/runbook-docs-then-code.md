# Runbook: Docs then Code

**Task shape:** Look up library/framework/API docs, then implement (example, integration, or feature using that tech).

## Tools (in order)

1. **Context7** (`resolve-library-id` → `query-docs`) or **web-reader** — get docs
2. **dev-subagent** or **quick-flow-solo-dev-subagent** — implement
3. **cursor-ide-browser** (optional) — if the result needs to be tried in the app

## Steps

1. **Clarify:** Which library/framework/API? What to implement (snippet, component, endpoint)?
2. **Docs:** Prefer **Context7** for known libraries (React, Next.js, Supabase, etc.): `resolve-library-id` then `query-docs` with a concrete question. If it’s a specific URL, use **web-reader**.
3. **Handoff to dev:** Short brief: library, relevant doc snippets, target file/repo, “done” criteria.
4. **Implement:** dev-subagent or quick-flow-solo-dev. Use the fetched docs; don’t guess APIs.
5. **Browser (optional):** If the user wants to “see it” or “check it works” in the UI, use **cursor-ide-browser** to open the app and verify.

## Example prompts

- “How do React Server Components work? Build a small example.”
- “Look up Supabase auth and add email sign-in to the backend.”
- “Fetch the Stripe webhook docs from https://... and implement the handler.”
