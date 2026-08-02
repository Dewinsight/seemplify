# Runbook: Notion — Find, Summarize, Add/Update Page

**Task shape:** Search Notion for something, summarize or analyze, then create or update a page (or database).

## Tools (in order)

1. **Notion MCP** — `notion-search`, then `notion-fetch` on relevant hits
2. **tech-writer** skill or **analyst-subagent** — summarize or structure content (if the summary is non-trivial)
3. **Notion MCP** — `notion-create-pages` or `notion-update-page` for the output

## Steps

1. **Clarify:** Search query? Where to put the new/updated page (parent page or database)?
2. **Search:** `notion-search` with the user’s topic/query.
3. **Fetch:** `notion-fetch` on 1–3 most relevant pages. Extract decisions, action items, or requested structure.
4. **Summarize (if needed):** Use tech-writer or analyst to produce the summary. If it’s a simple concatenation, skip.
5. **Create or update:** `notion-create-pages` (new) or `notion-update-page` (existing). Use the summary and any structure the user asked for.

## Example prompts

- “Search Notion for ‘auth design’ and add a summary page under Design.”
- “Find what we decided about the API in Notion and update the spec page with a short summary.”
- “Search for ‘Q4 goals’ and create a one-pager in the Goals DB.”
