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

Deployment also runs `nomic-runtime-smoke.cjs --live` inside the bounded runtime.
It indexes a synthetic document in a reserved temporary tenant, verifies eight
concurrent retrievals, scan and physical deletion, then proves that its temporary
database is absent. Graph extraction is stubbed for that synthetic fixture, so
the check makes no external AI generation request.


## Recruiter embeddings

Recruiter uses the same pinned CPU model through `POST /v1/embeddings` on the private Docker network. A distinct root-managed `recruiter-embedding-hmac` credential authorizes only pure embedding requests, with HMAC timestamp/nonce/replay checks. It cannot access Experience data or administration. Requests share the existing worker, 32-slot bounded queue, query priority and 1.5 CPU / 2 GiB cap. No new public inference endpoint or second model process is created.

`RecruiterCandidateNomicV1` and `RecruiterJobNomicV1` isolate 768-dimensional Nomic vectors from the retained 3072-dimensional `Candidate` and `Job` classes. Candidate privacy erasure removes both profiles. Matching cache identity includes the vector profile. Free-text queries use `search_query`; indexed profiles and stored job comparisons use `search_document`.

The core, Experience and ChatGPT gateway deployment owners preflight the model, back up before the first cutover, stop Recruiter and its workers, and run a bounded resumable MongoDB-to-Weaviate migration. Tombstoned and provisional candidate records are excluded. Tenant IDs, source fingerprints, counts, model profile and every vector dimension must agree before the new application starts. A failed migration restarts the previous container. A completed proof lives at `/opt/seemplify/recruiter-nomic-index-proof.json`; detailed logs remain root-only. Weaviate snapshots are paused consistently and opened in an isolated restore target.
