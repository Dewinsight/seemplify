Experience uses the local CPU model `nomic-ai/nomic-embed-text-v1.5` at revision
`e9b6763023c676ca8431644204f50c2b100d9aab`, q8, mean pooling, layer normalization,
768 dimensions and L2 normalization. Queries use `search_query:`; documents use
`search_document:`. The embedding-space version is `nomic-embed-text-v1.5-q8-v1`.

The worker runs inside the private HMAC-authenticated knowledge runtime, without
an embedding API key or a public inference port. Its container has 1.5 CPUs and
2 GiB memory with no additional swap. One inference worker handles batches of
up to eight texts, at most two logical requests per batch and 32 queued requests.
Queries have priority over ingestion and backfills; existing deadline, circuit
breaker, worker restart and graceful-drain behavior applies. The immutable model
cache is the `seemplify-nomic-model-cache` volume and is included in backups.

The deployment retains the original `chunks` and GTE collections. Nomic vectors
live in `experience_chunks_nomic_v1`, with a separate vector index. Runtime schema
35 adds the immutable profile without repointing any existing profile identity.

Before the first cutover, deployment takes a consistent backup, stops the old
Experience worker and runs `scripts/migrate-nomic-knowledge.mjs`. It locks the
PostgreSQL base rows, refuses active jobs or unfinished documents, then requests
a signed, bounded parallel backfill. The runtime checks source checksums, counts,
the Azure profile, every target vector and unchanged source fingerprints. It
must retrieve citations from the new corpus before the transaction changes the
primary profile. Historical Azure base/document profile records remain intact.
Failure leaves the PostgreSQL primary unchanged; retrying the backfill is safe.
Do not bypass this gate, relabel old vectors or replay historical jobs with a
different embedding profile. The cutover proof is stored privately under the
Experience runtime knowledge directory.

Run focused contracts with `node --test nomic.test.cjs` in this directory. Run
`node nomic-live-smoke.cjs --live` explicitly to load the real model and verify
eight concurrent semantic searches. The first model load needs download access;
subsequent starts use the persistent pinned cache.
