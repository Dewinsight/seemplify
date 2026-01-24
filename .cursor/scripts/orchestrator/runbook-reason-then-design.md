# Runbook: Reason then Design

**Task shape:** Complex trade-offs, “should we X or Y?”, or multi-step analysis, then an architecture or design decision.

## Tools (in order)

1. **sequential-thinking** — break down options, trade-offs, and criteria
2. **web-research** or **Context7** (optional) — latest patterns, benchmarks, or ecosystem facts
3. **architect-subagent** — produce the design or recommendation

## Steps

1. **Clarify:** What are the options? Constraints (scale, team, stack, timeline)?
2. **Reason:** Use sequential-thinking to compare options, list pros/cons, and rank by the user’s criteria.
3. **Research (optional):** If you need current best practices or data, use web-research or Context7. Feed results into the reasoning.
4. **Design:** architect-subagent to turn the conclusion into a short architecture or design (modules, boundaries, tech choices). If it’s only a recommendation (no doc), the orchestrator can produce it after step 2–3; use architect when a formal design doc or implementation-ready spec is needed.

## Example prompts

- “Should we use microservices or monolith for the new billing system?”
- “Compare tRPC vs REST for our next API and recommend one.”
- “We need to support 10x traffic; reason through options and then outline the architecture.”
