# Qwen-to-GTE migration evaluation

This tool compares an existing Qwen retrieval path with a candidate GTE retrieval path from the same **redacted, provider-neutral evaluation set**. It measures initial retrieval and post-reranker quality, reliability, latency, no-answer behavior, and migration gates. It does not call either provider; an upstream benchmark runner supplies both providers' opaque ranked results.

Synthetic results are useful for validating the harness, not approving a migration. A decision can become `PASS` or `FAIL` only when the input is marked `real-redacted` and contains at least 100 cases. Fewer cases, or any synthetic set, returns `INSUFFICIENT_REAL_DATA` even when the provisional metric checks pass.

## Run it

Use a stable secret when hashes must be comparable across reports. The secret must contain at least 32 UTF-8 bytes and is never written to output.

```powershell
$env:EXPERIENCE_MIGRATION_EVAL_HASH_KEY = '<secret-from-the-local-secret-store>'
node tools/local-knowledge/migration-evaluation.cjs `
  --input tools/local-knowledge/migration-evaluation.synthetic.json `
  --json-output .local/migration-evaluation/report.json `
  --markdown-output .local/migration-evaluation/report.md
```

Useful options:

- `--hit5-min 0.8` sets the minimum GTE post-reranker Hit@5.
- `--mrr-tolerance 0.02` allows at most a two-percentage-point GTE post-reranker MRR drop relative to Qwen.
- `--critical-rr-tolerance 0` controls tolerated reciprocal-rank loss on critical cases.
- `--minimum-real-cases 100` controls the real-data sufficiency threshold.
- `--hash-key-env NAME` reads the HMAC key from another environment variable.
- `--no-write` emits only a redacted machine-readable report to standard output.

The included synthetic fixture represents Nigerian terminology, a paraphrase, a near-duplicate policy pair, a no-answer query, and a multilingual Yoruba-marked case.

## Input contract

The top-level shape is:

```json
{
  "schemaVersion": 1,
  "dataset": {
    "id": "opaque-dataset-id",
    "kind": "real-redacted",
    "redaction": {
      "status": "redacted",
      "confirmedNoRawSensitiveText": true
    }
  },
  "cases": []
}
```

Each case includes:

- an opaque `id`;
- a redacted `query`, used in memory and replaced by an HMAC-SHA-256 hash in reports;
- optional `critical`, `noAnswer`, `multilingual`, and non-sensitive slug `tags`;
- graded relevance judgments as opaque `documentId` plus positive `gain`;
- `qwen` and `gte` provider results containing `retrieved`, `reranked`, `abstained`, end-to-end/phase latency, and optionally a safe failure category.

Rankings may contain only opaque document identifiers and numeric scores. Failures may contain only an uppercase category such as `TIMEOUT`; never put exception messages, filenames, excerpts, document titles, user identifiers, or provider response bodies in a fixture.

No-answer cases must have no relevance judgments. Answerable cases must have at least one. A failed provider result must have empty rankings and may omit latency.

## Metrics and gates

Quality metrics use answerable cases as their denominator. A provider failure therefore contributes an empty ranking, rather than disappearing from the quality calculation.

- **Hit@1 / Hit@5:** fraction of answerable cases with any relevant result in the first one or five results.
- **Recall@20:** mean fraction of judged relevant documents found in the first 20 results.
- **MRR:** mean reciprocal rank of the first relevant result.
- **nDCG@20:** graded normalized discounted cumulative gain at 20.
- **Failure rate:** failed cases divided by all cases.
- **No-answer false-positive rate:** successful no-answer cases that did not abstain, divided by all no-answer cases. The evaluated count is also reported separately.
- **Latency:** nearest-rank p50, p95, and p99 for queue, embedding, retrieval, reranker, and total latency.

The provisional gate passes only when all of these are true:

1. GTE post-reranker MRR is no more than 0.02 below Qwen by default.
2. GTE post-reranker Hit@5 meets the configured minimum.
3. No critical case regresses through a new GTE failure, a post-reranker Hit@5 loss, an excessive reciprocal-rank loss, or a new no-answer false positive.

The final gate additionally requires a `real-redacted` dataset with at least 100 cases. This tool deliberately makes no migration approval from the bundled synthetic data.

## Privacy behavior

Before evaluation, the validator requires a redaction attestation, rejects unexpected fields, scans queries for common email, URL, phone, and long-number patterns, and rejects raw-text field names. Saved diagnostics contain query hashes, case IDs, tags, flags, metrics, failure categories, and latency only.

When no HMAC secret is supplied, the tool generates a report-local key. That still keeps queries out of the report, but hashes cannot be correlated across runs. Reports declare this as `queryHashScope: report-local`.

Outputs are written atomically with private file permissions where the operating system supports them. Keep the redacted input and reports in an access-controlled location and do not commit a real evaluation set.

## Focused tests

```powershell
node --test tools/local-knowledge/migration-evaluation.test.cjs
```

The tests cover every metric family, critical regressions, failures, no-answer false positives, the 100-case sufficiency boundary, raw-text rejection, query hashing, representative synthetic cases, CLI output, and report leak checks.
