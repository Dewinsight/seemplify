# Seemplify local knowledge runtime

This service family provides the private GraphRAG data plane for Experience Management. It is disabled by default, binds every port to `127.0.0.1`, and has no Cloudflare route.

## Hosted production

Hostinger/Dokploy runs the signed runtime, Docling, and ArangoDB only on the private `dokploy-network`; none of their ports or credentials are published through Traefik. Production selects the pinned Azure AI Services `text-embedding-3-large` deployment at 3,072 dimensions for both vector generation and cosine reranking. The Azure API key, Arango users, Docling key, ChatGPT gateway key, and runtime HMAC are mounted from root-owned files below `/opt/seemplify/secrets/knowledge` and never stored in Compose or an image.

`deploy/hostinger/shared-infrastructure.compose.yml` owns persistent Arango data. `deploy/hostinger/extended-apps.compose.yml` owns the runtime state/data volumes and the Experience staging mount. The Experience deployment refuses to start the application until Arango, Docling, Azure embeddings, the ChatGPT gateway, and the signed runtime status are healthy. Host backups include all three knowledge volumes.

ArangoDB Community Edition is operated within its published Community License limits. Monitor aggregate cluster data and move to an appropriately licensed edition before reaching the 100 GB Community limit.

## Pinned components

| Component | Pin | Host port | Resource ceiling |
| --- | --- | ---: | --- |
| ArangoDB Community | `3.12.9.4` plus repository digest | 8529 | 4 CPU, 8 GB RAM |
| Qwen3-Embedding-4B TEI | model revision `5cf213...`, TEI `1.8.0` plus digest | 11541 | GPU, 8 CPU, 20 GB host RAM |
| Alibaba-NLP/gte-modernbert-base | revision `e7f32e...`, Transformers.js `4.2.0`, ONNX `q8` | in-process worker | CPU, bounded to 8 logical requests |
| BAAI/bge-reranker-v2-m3 TEI | model revision `953dc6...`, TEI `1.8.0` plus digest | 11542 | GPU, 6 CPU, 10 GB host RAM |
| Docling Serve CPU | `v1.28.0` plus digest | 11543 | 4 CPU, 8 GB RAM, five-minute request timeout |
| Signed Node runtime | repository source | 11540 | bounded in-process dispatch |

TEI containers use Docker `--log-driver=none` because TEI includes its API key in startup arguments. The Control Center reports health and resources instead of persisting those raw logs.

## Storage and isolation

- Durable data, downloaded models, backups, staging, and logs live below `D:\SeemplifyKnowledge` by default. Set `SEEMPLIFY_KNOWLEDGE_DATA_ROOT` before first start to choose another absolute root.
- Runtime state and generated 384-bit secrets live in `.local-runtime/knowledge`, which is ignored by Git. `service-secret` is the single canonical HMAC secret shared with the Experience backend.
- Each Experience `spaceId` maps internally to `exp_<sha256>` and gets a separate Arango database. Callers never provide a database name. Every graph record still carries `spaceId`, knowledge-base ID, and index version as defense in depth.
- A provisioner has access only to `_system` so it can create a tenant database and grant the data app user. The data app user performs all collection and AQL work.

## Signed interface

All operations are `POST` requests. The signature is HMAC-SHA256 over:

```text
timestamp\nnonce\nPOST\n/path\nexact-json-body
```

Headers are `x-seemplify-timestamp`, `x-seemplify-nonce`, and `x-seemplify-signature`. Requests have a five-minute clock window, replay protection, a 1 MB JSON body cap, and a bounded per-minute rate. The service exposes:

- `/v1/index` for a validated staged source reference. Documents are capped at 50 MB. PDF, DOCX, PPTX, XLSX, HTML, CSV, Markdown, text, PNG, JPEG, and TIFF are accepted; archives are rejected.
- `/v1/backfill` for a bounded, resumable batch of existing chunks into the parallel GTE index. Interactive query and live-index work have priority over backfill work.
- `/v1/retrieve` for up to five pinned bases and graph depth zero through two.
- `/v1/scan` for bounded, tenant/base/document/version-pinned corpus pagination used by durable deep analysis.
- `/v1/graph` for a bounded node/edge snapshot with source support counts and grounded edge provenance.
- `/v1/delete` for verified physical document or base purging, including text, embeddings, claims, relations, scoped index receipts, entity provenance, and unsupported entities.
- `/v1/status` for signed operational telemetry.
- `/v1/shutdown` for a signed Control Center-only graceful drain. The manager waits up to 35 seconds before using a force-stop fallback.

Indexing calls the existing signed ChatGPT gateway activity `experience.knowledge_graph_extract` with a strict schema. Entities, claims, and relations must contain exact grounded spans. If ChatGPT is unavailable, indexing returns a retryable error so the hosted durable job waits; production never falls back to heuristic graph extraction.

Retrieval fuses four bounded stages: Arango vector search (ANN after training, exact cosine before or during training), language-agnostic ArangoSearch BM25, confidence-filtered one/two-hop graph evidence, and the local BGE reranker. Weighted reciprocal-rank fusion ensures a vector-only, lexical-only, or graph-only result can enter the reranker. Index version is an upper-bound watermark over active document revisions, so adding a document does not hide older active documents.

Docling markdown is chunked on headings, paragraphs, tables, and page anchors using a deterministic 600-900 token approximation with overlap. This is not Docling `HybridChunker`: the Node service estimates one token per four characters because it does not embed the model tokenizer. Page and section provenance are preserved or estimated from Docling page counts, and every chunk gets a stable content hash.

## Operations

Read-only status does not create or start anything:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local-knowledge\manage.ps1 -Action status -Json
```

Lifecycle actions are `start`, `graceful-stop`, `restart`, `force-stop`, `load`, `unload`, `enable-auto-start`, `disable-auto-start`, `reconcile`, `bootstrap`, and `logs`. The manager only changes containers labelled `ai.seemplify.owner=local-knowledge`; a colliding unowned container causes a hard failure.

Normal stop and restart request the signed loopback shutdown endpoint, stop accepting new work, drain the runtime and GTE queues, dispose the model worker, and only then stop the containers. `force-stop` is the explicit immediate path; the same force behavior is used as a bounded fallback if a graceful drain exceeds 35 seconds.

Both TEI services mount the shared Hugging Face cache at `D:\SeemplifyKnowledge\models`; the pinned embedding and reranker snapshots remain separate `models--...` directories inside that cache. Status includes per-model and total cache byte counts. Startup distinguishes a listening Node process from a ready runtime and waits up to 20 minutes for all pinned services to report healthy.

### Embedding migration controls

Qwen remains the default provider, its 2,560-dimensional `qwen-v1` collection remains intact, and the BGE reranker remains in every retrieval path. The GTE worker is not created by `status`, dependency checks, or an ordinary Qwen start. It is loaded only when at least one GTE feature is configured: GTE is the selected provider, dual-write is enabled, or shadow/rollout traffic is greater than zero.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `EXPERIENCE_EMBEDDING_PROVIDER` | `qwen-tei` | Primary provider: `azure-openai`, `qwen-tei`, or `gte-node`. Hosted production explicitly selects `azure-openai`. |
| `EXPERIENCE_EMBEDDING_DUAL_WRITE` | `false` | Index new/changed documents into both immutable embedding spaces. |
| `EXPERIENCE_EMBEDDING_SHADOW_PERCENT` | `0` | Hash-stable percentage of served Qwen searches also evaluated by GTE without changing user results. |
| `EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT` | Qwen `0`; GTE `100` | Hash-stable percentage eligible for GTE results after coverage is complete. Set 5, 25, or 50 for a staged GTE rollout. |
| `EXPERIENCE_EMBEDDING_CONCURRENCY` | `8` | GTE logical request ceiling; values above eight are rejected. |
| `EXPERIENCE_EMBEDDING_QUEUE_DEPTH` | `256` | Bounded GTE queue, from 8 through 4,096. |
| `EXPERIENCE_EMBEDDING_TIMEOUT_MS` | `120000` | Per-request timeout, from 1,000 through 1,800,000 ms. |
| `EXPERIENCE_QWEN_ROLLBACK_RETAINED` | `true` | Declares that the Qwen index remains available for rollback. This gated release rejects `false`; selecting GTE requires dual-write. |
| `EXPERIENCE_EMBEDDING_FORCE_QWEN` | `false` | Emergency one-flag rollback described below. |

The manager derives and validates the exact model identity from the provider. Qwen is pinned to `Qwen/Qwen3-Embedding-4B`, revision `5cf2132abc99cad020ac570b19d031efec650f2b`, `float16`, 2,560 dimensions, and `qwen-v1`. GTE is pinned to `Alibaba-NLP/gte-modernbert-base`, revision `e7f32e3c00f91d699e8c43b53106206bcc72bb22`, `q8`, 768 dimensions, and `gte-modernbert-v1`. A contradictory model, revision, dtype, dimension, or vector-index override is rejected before startup, preventing mixed embedding spaces. When `gte-node` is primary its default rollout is 100%, so explicit hosted GTE requests are not silently routed to Qwen. During this gated release, Qwen rollback retention cannot be disabled and `gte-node` is rejected unless dual-write remains enabled. A future, separately approved cleanup release must add and test GTE-only writes before allowing `EXPERIENCE_QWEN_ROLLBACK_RETAINED=false`.

Legacy untagged Qwen chunks are eligible for backfill only when both their 2,560-dimensional vectors and their active source document match the pinned Qwen model, exact source hash, index version, and chunker version. A mismatch fails closed before GTE inference. Operating-gate pauses immediately route even explicitly promoted GTE bases back to the retained Qwen index; evaluation-only comparisons remain available for diagnosis.

`tools/local-knowledge/package.json` and `package-lock.json` pin `@huggingface/transformers` exactly to `4.2.0`. When and only when a GTE feature requires the worker, the manager verifies Node 22+, verifies both pins and the installed package, and runs this deterministic installation if necessary:

```powershell
npm ci --omit=dev --no-audit --no-fund
```

It runs in `tools\local-knowledge`; it never mutates dependency declarations. Model files are cached persistently under `D:\SeemplifyKnowledge\models\transformers`.

Configure environment variables for both the Experience and local-knowledge manager processes, then restart both runtimes. For example, a safe shadow stage keeps Qwen primary:

```powershell
$env:EXPERIENCE_EMBEDDING_PROVIDER = 'qwen-tei'
$env:EXPERIENCE_EMBEDDING_SHADOW_PERCENT = '5'
$env:EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT = '0'
$env:EXPERIENCE_EMBEDDING_DUAL_WRITE = 'true'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local-knowledge\manage.ps1 -Action restart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File experience-management\scripts\manage.ps1 -Action restart
```

`status -Json` obtains `/v1/status` through the signed client. Its `embedding` object exposes the configured and active provider, GTE worker/readiness/circuit metrics, backfill activity, runtime and per-priority embedding queues, provider throughput/failures/latency, migration gates and shadow diagnostics, process CPU/RAM/event-loop telemetry, and the read-only exact dependency state. Reading status never downloads a model or starts GTE.

### One-flag Qwen rollback

Set `EXPERIENCE_EMBEDDING_FORCE_QWEN=true` in the environment inherited by both managers and restart them. This single safety flag overrides stale GTE settings: it selects `qwen-tei`, selects `qwen-v1`, disables dual-write, and sets rollout and shadow percentages to zero. No vectors are regenerated and the GTE collection is retained for investigation or a later approved retry.

```powershell
[Environment]::SetEnvironmentVariable('EXPERIENCE_EMBEDDING_FORCE_QWEN', 'true', 'User')
powershell.exe -NoProfile -ExecutionPolicy Bypass -File experience-management\scripts\manage.ps1 -Action restart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local-knowledge\manage.ps1 -Action restart
```

Use a new terminal after setting a persistent user variable so both managers inherit it. Restart Experience first so it stops issuing GTE-profile requests, then restart the ChatGPT gateway to drain and unload its GTE worker. Confirm `embedding.configured.forceQwenRollback=true`, `activeProvider=qwen-tei`, and GTE traffic settings are zero in signed status before closing the incident. Removing the flag does not itself approve GTE: the other explicit migration settings take effect only after the next restart.

The signed `/v1/test/cleanup` route can drop only a synthetic tenant whose ID matches the reserved `knowledge-live-benchmark-<32 hex>` namespace and whose request carries the fixed explicit confirmation. It cannot accept an arbitrary Experience space. Both live harnesses invoke it in `finally` so benchmark tenant databases do not accumulate.

Run the offline contract tests with:

```powershell
node --test tools\local-knowledge\*.test.cjs
```

After all services are healthy and the ChatGPT activity is registered, run the synthetic exact/semantic/graph-hop/injection corpus with:

```powershell
node tools\local-knowledge\harness.cjs --live
```

To verify the real Arango ANN path without spending ChatGPT inference, run:

```powershell
npm run test:knowledge:ann:live
```

The ANN harness creates only a reserved `knowledge-live-benchmark-<32 hex>` tenant, injects an empty graph extractor in-process, indexes at least 120 chunks through the real Qwen embedding service, waits for Arango `trainingState=ready`, requires retrieval mode `ann`, exercises widths 1/2/4/8 through the bounded retrieval queue, and calls the restricted tenant-drop operation in `finally`. Reports are written under `.local-runtime\knowledge\benchmarks`; staged documents and the tenant database are removed even on failure. An exclusive in-flight manifest enables the next run to recover a tenant left by process or machine failure, while SIGINT/SIGTERM stop only after the current cohort so cleanup can complete.

ArangoDB Community Edition is configured for local development use. Review licensing and topology before any production deployment.
