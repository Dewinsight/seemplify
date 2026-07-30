# Seemplify local knowledge runtime

This service family provides the private GraphRAG data plane for Experience Management. It is disabled by default, binds every port to `127.0.0.1`, and has no Cloudflare route.

## Pinned components

| Component | Pin | Host port | Resource ceiling |
| --- | --- | ---: | --- |
| ArangoDB Community | `3.12.9.4` plus repository digest | 8529 | 4 CPU, 8 GB RAM |
| Qwen3-Embedding-4B TEI | model revision `5cf213...`, TEI `1.8.0` plus digest | 11541 | GPU, 8 CPU, 20 GB host RAM |
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
- `/v1/retrieve` for up to five pinned bases and graph depth zero through two.
- `/v1/graph` for a bounded node/edge snapshot with source support counts and grounded edge provenance.
- `/v1/delete` for verified physical document or base purging, including text, embeddings, claims, relations, scoped index receipts, entity provenance, and unsupported entities.
- `/v1/status` for signed operational telemetry.

Indexing calls the existing signed Terra gateway activity `experience.knowledge_graph_extract` with a strict schema. Entities, claims, and relations must contain exact grounded spans. If Terra is unavailable, indexing returns a retryable error so the hosted durable job waits; production never falls back to heuristic graph extraction.

Retrieval fuses four bounded stages: Arango vector search (ANN after training, exact cosine before or during training), language-agnostic ArangoSearch BM25, confidence-filtered one/two-hop graph evidence, and the local BGE reranker. Weighted reciprocal-rank fusion ensures a vector-only, lexical-only, or graph-only result can enter the reranker. Index version is an upper-bound watermark over active document revisions, so adding a document does not hide older active documents.

Docling markdown is chunked on headings, paragraphs, tables, and page anchors using a deterministic 600-900 token approximation with overlap. This is not Docling `HybridChunker`: the Node service estimates one token per four characters because it does not embed the model tokenizer. Page and section provenance are preserved or estimated from Docling page counts, and every chunk gets a stable content hash.

## Operations

Read-only status does not create or start anything:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local-knowledge\manage.ps1 -Action status -Json
```

Lifecycle actions are `start`, `graceful-stop`, `restart`, `force-stop`, `load`, `unload`, `enable-auto-start`, `disable-auto-start`, `reconcile`, `bootstrap`, and `logs`. The manager only changes containers labelled `ai.seemplify.owner=local-knowledge`; a colliding unowned container causes a hard failure.

Both TEI services mount the shared Hugging Face cache at `D:\SeemplifyKnowledge\models`; the pinned embedding and reranker snapshots remain separate `models--...` directories inside that cache. Status includes per-model and total cache byte counts. Startup distinguishes a listening Node process from a ready runtime and waits up to 20 minutes for all pinned services to report healthy.

The signed `/v1/test/cleanup` route can drop only a synthetic tenant whose ID matches the reserved `knowledge-live-benchmark-<32 hex>` namespace and whose request carries the fixed explicit confirmation. It cannot accept an arbitrary Experience space. Both live harnesses invoke it in `finally` so benchmark tenant databases do not accumulate.

Run the offline contract tests with:

```powershell
node --test tools\local-knowledge\*.test.cjs
```

After all services are healthy and the Terra activity is registered, run the synthetic exact/semantic/graph-hop/injection corpus with:

```powershell
node tools\local-knowledge\harness.cjs --live
```

To verify the real Arango ANN path without spending Terra inference, run:

```powershell
npm run test:knowledge:ann:live
```

The ANN harness creates only a reserved `knowledge-live-benchmark-<32 hex>` tenant, injects an empty graph extractor in-process, indexes at least 120 chunks through the real Qwen embedding service, waits for Arango `trainingState=ready`, requires retrieval mode `ann`, exercises widths 1/2/4/8 through the bounded retrieval queue, and calls the restricted tenant-drop operation in `finally`. Reports are written under `.local-runtime\knowledge\benchmarks`; staged documents and the tenant database are removed even on failure. An exclusive in-flight manifest enables the next run to recover a tenant left by process or machine failure, while SIGINT/SIGTERM stop only after the current cohort so cleanup can complete.

ArangoDB Community Edition is configured for local development use. Review licensing and topology before any production deployment.
