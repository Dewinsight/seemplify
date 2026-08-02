# Local Knowledge Graph RAG

## Purpose

Experience Management can attach one or more tenant-owned knowledge bases to supported Terra activities. Documents are extracted, chunked, embedded, indexed, and linked into a knowledge graph on the local workstation. Retrieval combines lexical, vector, and bounded graph evidence before Terra receives a compact, cited context package.

This design keeps the application database as the source of truth. ArangoDB is a rebuildable search index and never decides authentication, space membership, billing, or document ownership. Each Experience space receives a separately named Arango database derived from an opaque hash, providing a second isolation boundary in addition to record filters.

## Runtime boundary

The browser and hosted API never connect to ArangoDB, the embedding server, the reranker, or Docling. The Experience backend calls a signed loopback knowledge runtime. That runtime owns all database credentials and exposes only four bounded operations: status, index, retrieve, and delete.

| Component | Binding | Purpose | GPU |
| --- | --- | --- | --- |
| Knowledge runtime | `127.0.0.1:11540` | Signed orchestration and retrieval API | No |
| ArangoDB 3.12.9.4 | `127.0.0.1:8529` | BM25, vectors, graph, provenance | No |
| Qwen3-Embedding-4B | `127.0.0.1:11541` | Multilingual document/query embeddings | Yes |
| BGE reranker v2 M3 | `127.0.0.1:11542` | Multilingual relevance reranking | Yes |
| Docling Serve | `127.0.0.1:11543` | PDF, Office, HTML, image and OCR extraction | No |

Data, model caches, and backups live below `D:\SeemplifyKnowledge`. Runtime secrets and desired-state files live outside Git. No ArangoDB endpoint is exposed through Cloudflare.

## Tenant and privacy invariants

- Every knowledge base, document, job, retrieval snapshot, Arango vertex, and edge carries a `spaceId` and immutable ownership/version identifiers, even though spaces are also separated by Arango database.
- Request space comes only from the authenticated membership resolver. A browser-supplied `spaceId` is never trusted.
- Every AQL statement is static and parameterized. Model-generated AQL is prohibited.
- Retrieval filters by space and knowledge-base version before scoring, during graph traversal, and again before returning evidence.
- A knowledge base must explicitly allow Terra context. Indexing remains entirely local; when the setting is off, its content cannot be sent to Terra.
- The exact cited context is persisted before dispatch so retries are deterministic and auditable.
- Prompts treat retrieved text as untrusted evidence. Document instructions cannot override the system prompt or invoke tools.

## Durable ingestion

1. Validate membership, file signature, size, extension, quota, and idempotency key.
2. Persist the document and job in SQLite before acknowledging the upload with HTTP `202`.
3. Stage the immutable source file under a space-scoped opaque path.
4. Extract structured text and page/section provenance with Docling.
5. Normalize and split into overlapping semantic chunks, normally 600–900 tokens.
6. Embed chunks locally and reject any response that does not match the pinned 2,560-dimensional profile.
7. Upsert document, chunk, entity, claim, and provenance vertices plus bounded relationships.
8. Train or rebuild a versioned vector index when the corpus threshold requires it; keep the prior version searchable until the replacement is ready.
9. Mark the SQLite job complete only after index verification. Offline runtimes remain queued, with bounded backoff and restart recovery.

Deletion first makes the document unavailable in the control plane, then removes the derived index asynchronously. Stable hashes make retries idempotent.

## Retrieval

The runtime obtains independent candidate lists from vector similarity and ArangoSearch BM25. It expands high-confidence entities by at most two graph hops, with tenant, knowledge-base, version, edge-confidence, breadth, and time limits. Weighted reciprocal-rank fusion combines the lists. A local cross-encoder reranks the best candidates, and the context builder selects a diverse evidence set with source, page, section, chunk, and score citations.

Small or newly rebuilt corpora use exact cosine scoring until a trained vector index is beneficial. Answers never cite a source that was not present in the persisted retrieval snapshot.

## Supported product surfaces

Knowledge context is optional and user-selected. It is appropriate for survey generation, survey quality review, response insights, executive reports, research questions, journey synthesis, social intelligence, and cross-source intelligence. It is not injected into deterministic analytics, email delivery, authentication, or e-signing.

No workflow silently selects the first knowledge base. A user may select up to five accessible bases and can inspect which sources influenced an output.

## Operations

The Local Control Center has a dedicated Arango page. It controls the knowledge runtime and its four dependencies independently from the Xplorer stack, and reports readiness, queues, indexing/retrieval rates, errors, databases, collections, graph/vector index state, CPU, RAM, disk, GPU, VRAM, temperature, power, and bounded redacted logs. Stop disables dispatch and preserves queued jobs and indexed data.

The host resource strip remains visible on every Control Center page. PostgreSQL telemetry stays on Xplorer runtime because it serves the CRM stack; it is not part of the knowledge runtime.

## Production constraint

The pinned ArangoDB Community image is installed for local development and validation. Its current licence must be reviewed and an appropriate commercial/Enterprise agreement obtained before this design is used as part of a production SaaS service. Windows Docker Desktop is also a development host, not the production topology.

## Verification checklist

- Unit: validation, signing/replay, tenant filters, chunking, fusion, citations, prompt-injection handling, idempotency.
- Integration: SQLite recovery, offline waiting, Docling formats, embedding dimensions, reranking, Arango exact/vector/BM25/graph queries, index rebuild and delete.
- Security: cross-space access, forged IDs, traversal caps, path traversal, MIME mismatch, oversized files, archive rejection, secret and log redaction.
- Lifecycle: Docker unavailable, start/stop/restart, force stop, auto-start, persistent queues, crash recovery, disk-pressure state.
- Quality: synthetic factual and graph-hop corpus, recall@k, MRR/nDCG, citation precision, unsupported-answer refusal, latency and resource budgets.
- Playwright: create a base, upload documents, observe live durable progress/history, search with citations, select a base for survey generation, verify isolation in a second space, and exercise Control Center state.

## Primary technical references

- [ArangoDB vector indexes](https://docs.arango.ai/arangodb/3.12/indexes-and-search/indexing/working-with-indexes/vector-indexes/)
- [ArangoSearch](https://docs.arango.ai/arangodb/stable/indexes-and-search/arangosearch/)
- [ArangoDB graph traversals](https://docs.arango.ai/arangodb/stable/aql/graph-queries/traversals/)
- [Qwen3-Embedding-4B model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B)
- [Hugging Face Text Embeddings Inference](https://huggingface.co/docs/text-embeddings-inference/main/en/index)
- [Docling Serve REST API](https://docling-project.github.io/docling/usage/api_server/rest_api/)
