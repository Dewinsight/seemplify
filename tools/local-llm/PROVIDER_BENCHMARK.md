# Terra and Groq activity benchmark

`compare-runtime-providers.cjs` evaluates 29 fixed fixtures covering all 28
configured AI activities. `job.normalize` has separate text and structured
fixtures.

Both providers receive the same source fixture contract: messages, schema,
sampling settings, output ceiling, reasoning level, and one schema-repair
allowance. They do not receive byte-identical wire prompts. Groq uses its native
chat-completions and `response_format` request, while Terra uses the managed
Codex adapter, which adds its local safety and schema instructions. Reports call
this **same source contract with provider-native adapters**.

Providers and requests run strictly sequentially. There is never more than one
provider request in flight.

## Safe validation

Validate the complete fixture set without calling either provider:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --runs=1
```

Dry mode validates contracts, scoring, checkpoints, artifact isolation, and
sequencing. It never produces a live provider recommendation.

## Live comparison

Run three repetitions per fixture:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --live --runs=3
```

Terra uses the signed localhost gateway and requires the selected runtime to be
`codex / gpt-5.6-terra`. Local requests are tagged
`requestSource: provider-benchmark` for runtime observability. Groq credentials
are resolved without printing them:

1. `GROQ_API_KEY` in the current process, or
2. an encrypted credential when `MONGO_URI` is available.

When database credentials are available, set `AI_EVAL_CREDENTIAL_ID` to pin one
enabled credential. Do not rotate credentials to bypass a shared quota. If no
Groq credential is available, Groq is recorded as skipped and the script does
not claim a comparison.

Use `--fixtures=id-1,id-2` for a focused run and
`--providers=local-codex` for a Terra-only baseline.

## Groq free-tier quota safety

Every Groq attempt, including schema repair and retry attempts, is reserved in
an atomic persistent ledger before dispatch. The reservation includes a
conservative input estimate, 20% input headroom, and the full configured output
ceiling. Successful metered calls reconcile the reservation to actual usage.
Unknown network or server consumption keeps the larger reservation.

Defaults stay below the documented 8K TPM, 200K TPD, 30 RPM, and 1K RPD limits:

| Limit | Safety default | Override |
| --- | ---: | --- |
| Tokens/minute | 7,200 | `--groq-tpm` or `AI_BENCHMARK_GROQ_TPM` |
| Tokens/day | 180,000 | `--groq-tpd` or `AI_BENCHMARK_GROQ_TPD` |
| Requests/minute | 27 | `--groq-rpm` or `AI_BENCHMARK_GROQ_RPM` |
| Requests/day | 900 | `--groq-rpd` or `AI_BENCHMARK_GROQ_RPD` |
| Input headroom | 20% | `--groq-input-headroom-percent` |

Overrides cannot exceed the documented limits. Provider quota headers can lower
the effective limits further. The governor honors token reset timestamps before
dispatch.

The fixed suite directionally estimates about 4.3K input tokens per repetition.
With current output ceilings, one repetition reserves at most about 71.1K
tokens without schema repair or 114.9K if all 16 structured fixtures repair.
Three worst-case repetitions therefore cannot fit safely within 200K TPD. The
governor stops before the safety ceiling, writes
`waiting_for_daily_quota` with a UTC `resumeAt`, and exits with temporary status
75. That outcome is resumable and is not counted as a model-quality failure.

429 and 5xx failures retry at most five times by default. Waiting uses the
largest of `Retry-After`, the provider token-reset timestamp, and exponential
backoff, plus bounded jitter. Configure this with:

- `--groq-retry-attempts` (maximum 8)
- `--groq-backoff-ms`
- `--groq-jitter-ms`

Authentication and authorization failures do not retry.

## Checkpoints and safe resume

The current provider report is atomically checkpointed after every completed
fixture/run result:

```text
.local-runtime/llm/reports/provider-comparison/<run-id>/<provider>.checkpoint.json
```

Resume from one or more checkpoint or final provider artifacts:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --live --runs=3 `
  --providers=groq `
  --resume-from=.local-runtime/llm/reports/provider-comparison/RUN/groq.checkpoint.json
```

Each artifact is bound to `benchmarkConfigSha256`. The digest covers every
fixture prompt, schema and quality contract; provider/model/reasoning/pricing
mapping; sampling, token, quota and retry options; timeout and repair policy;
and evaluator, schema-validator, usage, normalization, gateway,
provider-comparison, and engine-adapter code. A changed contract or
implementation is rejected instead of mixing evidence. Duplicate fixture/run
keys across resume artifacts are also rejected.

After both provider reports are complete, consolidate them without new calls:

```powershell
node tools/local-llm/compare-runtime-providers.cjs --live --runs=3 `
  --resume-from=.local-runtime/llm/reports/provider-comparison/TERRA/local-codex.json,.local-runtime/llm/reports/provider-comparison/GROQ/groq.json
```

Completed non-retryable failures are durable evidence. Retryable provider
failures may be attempted again on resume. If all requested results are already
present, reports can be consolidated without starting Terra or loading a Groq
credential.

## Evidence, metering, and recommendations

Artifacts are stored outside Git in:

```text
.local-runtime/llm/reports/provider-comparison/<run-id>/
```

They include schema validity, grounding and hallucination findings, quality,
p50/p95/variance latency, input/cached/output/reasoning tokens, output tokens
per second, provider attempts, quota snapshots, and estimated cost. Terminal
schema failures retain usage and cost from both the original and repair calls.
Successful responses with no provider usage are explicitly `unmetered` and
cannot pass recommendation gates. Terra local-cloud pricing is reported as
`unpriced`, not as zero cost.

Comparison requires exact paired fixture/run coverage from two live reports
with one `benchmarkConfigSha256`. A provider must pass all of these gates:

- at least 95% request success;
- 100% schema validity among successful requests;
- 100% grounding and zero hallucination or policy failures;
- no unmetered successful requests;
- average quality of at least 8/10 and no more than two points below baseline;
- p95 within the activity ceiling; and
- bounded latency coefficient of variation and p95/p50 ratio.

Quality is considered before tail latency. Repeated runs of one fixture remain
`directional-only`; `benchmark-supported` requires at least three distinct
paired fixtures for that activity. CV parsing routes are policy-locked to local
inference, so a report can never recommend Groq for them.

All recommendations are advisory. This harness does not update production
routing.
