# Terra and Groq activity benchmark

`compare-runtime-providers.cjs` runs the same fixed synthetic prompts, schemas,
normalization, single schema-repair attempt, and quality evaluators against Terra
and the production Groq model for each activity.

Providers run one after the other. The script never overlaps Terra and Groq.
Each provider is written to a separate JSON artifact before the next provider
starts. A summary is produced only after all requested providers finish.

## Safe validation

Validate all 29 activity fixtures without calling either provider:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --runs=1
```

Dry mode validates the harness but never recommends a provider.

## Live comparison

Run three repetitions per activity:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --live --runs=3
```

Terra uses the signed localhost gateway and requires the selected runtime to be
`codex / gpt-5.6-terra`. Groq credentials are resolved without printing secrets:

1. `GROQ_API_KEY` in the current process, or
2. an encrypted production credential when `MONGO_URI` is available. Set
   `AI_EVAL_CREDENTIAL_ID` to pin a specific enabled credential.

The production path accepts only fixture identifiers built into
`aiRuntimeGoldenFixtures.js`; it does not expose an arbitrary-prompt HTTP
endpoint. If no Groq credential is available, Groq is recorded as skipped and
the script does not claim a comparison.

Use `--fixtures=id-1,id-2` for a focused run and `--providers=local-codex` for a
Terra-only baseline. Interrupted runs can be consolidated without repeating
successful calls:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --live --providers=local-codex `
  --resume-from=.local-runtime/llm/reports/provider-comparison/RUN/local-codex.json
```

Resume artifacts must be inside the provider-comparison report directory.

## Evidence and gates

Artifacts are stored outside Git in:

```text
.local-runtime/llm/reports/provider-comparison/<run-id>/
```

They include schema validity, grounding and hallucination findings, domain
quality, latency, input/cached/output/reasoning tokens, output tokens per second,
errors, Groq quota headers, and estimated cost. Prompt and schema hashes prove
that both providers received the same fixture contract without duplicating raw
prompts in the summary.

Quality gates are applied before latency. A provider must have at least 95%
successful requests, 100% schema validity for successful responses, 100%
grounding, and zero hallucination or policy failures. Fewer than three samples
per provider and activity are labelled directional and must not be used as an
automatic production-routing decision.
