# Weaviate Grounding Plan

## Objective
Improve initiative rule-analysis reliability by grounding each rule evaluation with:
- Embedded rule representations
- Embedded initiative context chunks
- Similar prior initiative memory

## Scope
1. Embed and index all active rules per organization.
2. Embed and index each initiative run context (chunked).
3. Retrieve top-matching chunks for each rule before LLM evaluation.
4. Persist initiative memory vectors for future similarity retrieval.
5. Auto-sync embeddings whenever new rules are created or updated.

## Execution Steps
1. **Infrastructure check**
   - Run `npm run test:weaviate`
   - Confirm Weaviate readiness and schema access.
2. **Backfill embeddings**
   - Run `npm run embeddings:backfill`
   - Index all active rules and recent initiatives.
3. **Pipeline integration**
   - Enable `USE_WEAVIATE=true`
   - Enable `USE_WEAVIATE_RULE_GROUNDING=true`
   - Enable `USE_WEAVIATE_INITIATIVE_MEMORY=true`
4. **A/B quality test**
   - Run `npm run test:ab:weaviate`
   - Compare baseline vs grounded run using same initiative payload.

## Metrics for Improvement
- `unavailableCount` (target: lower)
- `hardFailures` (target: lower)
- `mandatoryFailed` drift (target: lower false negatives/positives)
- `passRatePercent` stability and consistency
- `groundingApplied` and `groundingChunksFetched` (target: non-zero)

## Operational Notes
- If embedding endpoint fails, service falls back to deterministic hash embeddings to keep pipeline running.
- For best semantic quality, configure Azure embedding endpoint + key in env.
- New rules are embedded automatically on create/update.
