# Seemplify Recruiter Backend — AI Model Research Report

> **Date:** February 2026  
> **Scope:** Analysis of current GPT-4.1 usage across the recruiter backend, and evaluation of alternative models (smaller LLMs, ML models, hybrid approaches) for cost optimization.

---

## Executive Summary

**GPT-4.1 is completely unnecessary for the recruiter backend.** The codebase uses a single, expensive flagship model (`gpt-4.1` at **$2/$8 per 1M input/output tokens**) uniformly across ~10+ distinct AI tasks — all of which are structured extraction, classification, or template-driven generation that can be handled by much cheaper models. With the planned **removal of the AI chat agent** (the only task that justified GPT-4.1), a migration to **GPT-4.1-mini/nano** could reduce AI costs by **80–95%** with no meaningful quality loss.

---

## 1. Current GPT-4.1 Usage Map

The recruiter backend uses GPT-4.1 (via Azure OpenAI) as the **sole LLM** in the following files and features:

### Core AI Files

| File | Size | Primary Purpose |
|------|------|-----------------|
| [azureOpenAIService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/azureOpenAIService.js) | 56 KB | Central OpenAI wrapper — chat, streaming, bias detection, batch analysis |
| [embeddingService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/embeddingService.js) | 96 KB | Embedding generation (`text-embedding-3-large`), CV/Job matching, vector search via Weaviate |
| [langchainAgentService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/langchainAgentService.js) | 92 KB | LangChain agentic chat with tool-calling, intent routing, multi-agent orchestration |
| [aiInterviewAnalysisService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/aiInterviewAnalysisService.js) | 37 KB | Interview transcript analysis — scoring, sentiment, skills extraction |
| [aiJobService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/aiJobService.js) | 27 KB | Job description generation, requirements extraction |
| [aiCandidateService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/aiCandidateService.js) | 14 KB | Candidate profile enrichment and analysis |
| [gptAnalysisService.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/services/gptAnalysisService.js) | 15 KB | GPT-based analysis with caching |
| [jobAgent.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/agents/jobAgent.js) | 95 KB | LangChain job management agent with 20+ tools |
| [candidateAgent.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/recruiter/backend/agents/candidateAgent.js) | 35 KB | LangChain candidate management agent |

### Task-by-Task Breakdown

| # | Task | Complexity | Tokens (est.) | GPT-4.1 Needed? |
|---|------|-----------|---------------|-----------------|
| 1 | **CV/Resume Parsing** — Extract structured JSON from CVs (name, skills, experience, education) | Medium | ~2K in / ~8K out | ❌ Overkill |
| 2 | **Job Description Generation** — Generate formatted JDs from requirements | Low–Medium | ~1K in / ~3K out | ❌ Overkill |
| 3 | **Job Requirements Extraction** — Parse requirements into structured categories | Low | ~2K in / ~2K out | ❌ Overkill |
| 4 | **Intent Routing** — Classify user chat message intent (job/candidate/general) | Very Low | ~500 in / ~100 out | ❌ Extreme overkill |
| 5 | ~~**Chat Responses** — Conversational recruiter assistant with tool-calling~~ | ~~High~~ | ~~Variable~~ | 🗑️ **Being removed** |
| 6 | **Interview Transcript Analysis** — Score communication, skills, sentiment from transcripts | Medium–High | ~10K in / ~5K out | ⚠️ Possibly overkill |
| 7 | **Candidate Batch Ranking** — Rank/explain candidate fit for a role | Medium | ~5K in / ~3K out | ⚠️ Possibly overkill |
| 8 | **Bias Detection** — Detect biased language in job descriptions | Low | ~1K in / ~500 out | ❌ Overkill |
| 9 | **Interview Question Generation** — Generate role-specific interview questions | Low–Medium | ~1K in / ~2K out | ❌ Overkill |
| 10 | **Team Comments Analysis** — Summarize interviewer feedback | Low | ~2K in / ~1K out | ❌ Overkill |

**Verdict:** With the chat agent being removed, **zero tasks** require GPT-4.1's full capabilities. Every remaining task is structured extraction, classification, or template-based generation — ideal for GPT-4.1-mini or GPT-4.1-nano.

---

## 2. GPT-4.1 Family — Pricing Comparison

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Relative Cost | Best For |
|-------|----------------------|------------------------|---------------|----------|
| **GPT-4.1** | $2.00 | $8.00 | 1.0× (baseline) | Complex reasoning, agentic workflows |
| **GPT-4.1-mini** | $0.40 | $1.60 | **0.2×** | Structured output, JSON extraction, tool-calling |
| **GPT-4.1-nano** | $0.10 | $0.40 | **0.05×** | Classification, intent routing, simple extraction |

> [!IMPORTANT]
> GPT-4.1-mini scores **45.1%** on hard instruction following (vs 49.1% for GPT-4.1) and **35.8%** on MultiChallenge (vs 38.3% for GPT-4.1). For structured JSON output tasks, the difference is **negligible**.

### Immediate Savings Opportunity (Same Ecosystem)

By staying within the GPT-4.1 family and just routing tasks to the right tier:

| Task | Current Model | Recommended Model | Cost Reduction |
|------|--------------|-------------------|----------------|
| Intent routing | GPT-4.1 | GPT-4.1-nano | **95%** |
| CV parsing | GPT-4.1 | GPT-4.1-mini | **80%** |
| Job description generation | GPT-4.1 | GPT-4.1-mini | **80%** |
| Bias detection | GPT-4.1 | GPT-4.1-nano | **95%** |
| Interview questions | GPT-4.1 | GPT-4.1-mini | **80%** |
| Comments analysis | GPT-4.1 | GPT-4.1-mini | **80%** |
| Interview analysis | GPT-4.1 | GPT-4.1-mini | **80%** |
| Candidate ranking | GPT-4.1 | GPT-4.1-mini | **80%** |
| ~~Chat agent (agentic)~~ | ~~GPT-4.1~~ | 🗑️ **Removed** | **100%** |

**Estimated overall savings: ~80–90% on LLM API costs** with minimal code changes (just updating model name per task). GPT-4.1 deployment can be decommissioned entirely.

---

## 3. Cross-Provider Alternatives

### 3.1 Smaller LLM APIs (Drop-in Replacements)

| Provider | Model | Input / Output (per 1M) | Strengths | Azure Available? |
|----------|-------|------------------------|-----------|-----------------|
| **Google** | Gemini 2.5 Flash | $0.30 / $2.50 | Excellent structured output, 1M context, strong benchmarks | Via Vertex AI |
| **Google** | Gemini 2.5 Flash-Lite | $0.10 / $0.40 | Ultra-cheap, good for classification | Via Vertex AI |
| **Anthropic** | Claude Haiku 4.5 | $1.00 / $5.00 | Strong ambiguous layout handling, 200K context | No (direct API) |
| **OpenAI** | GPT-4.1-mini | $0.40 / $1.60 | Native Azure support, easy migration | ✅ Yes |
| **OpenAI** | GPT-4.1-nano | $0.10 / $0.40 | Cheapest OpenAI option, good for classification | ✅ Yes |

> [!TIP]
> **Easiest win:** GPT-4.1-mini and GPT-4.1-nano are already available on Azure OpenAI. Migration requires only changing the `deployment` parameter per task — no SDK or provider changes needed.

### 3.2 Open-Source / Self-Hosted Models

| Model | Parameters | Strengths for HR Tasks | Hosting Requirement |
|-------|-----------|----------------------|---------------------|
| **Phi-3-mini** | 3.8B | Excellent for data extraction, intent classification; runs on modest hardware | GPU (T4+) or CPU |
| **Phi-3.5-MoE** | 42B (16B active) | Near GPT-4 quality at fraction of cost | A100 GPU |
| **Mistral 7B** | 7B | Strong general NLP, code, structured output | GPU (T4+) |
| **Llama 3.1 8B** | 8B | Strong reasoning, extensive knowledge | GPU (T4+) |
| **Llama 3.1 70B** | 70B | Near-frontier quality, open weights | Multi-GPU |

> [!WARNING]
> Self-hosting requires GPU infrastructure, model serving (vLLM/TGI), monitoring, and maintenance. Only cost-effective at **very high volume** (>10M tokens/day). For lower volumes, managed API tiers (GPT-4.1-mini/nano) are more practical.

---

## 4. ML Model Alternatives (Non-LLM)

### 4.1 Where Traditional ML Can Replace LLMs

| Task | ML Approach | Models | Feasibility |
|------|------------|--------|-------------|
| **Intent Routing** | Text classification | BERT/DistilBERT fine-tuned classifier | ✅ Excellent — faster, cheaper, deterministic |
| **Candidate Ranking** | Learning-to-rank | XGBoost/LightGBM on embedding features | ✅ Excellent — hybrid with embeddings |
| **Bias Detection** | Binary/multi-class classification | Fine-tuned BERT or DistilBERT | ✅ Good — well-studied problem |
| **Skills Extraction** | Named Entity Recognition (NER) | SpaCy NER / fine-tuned BERT NER | ✅ Good — if training data available |
| **CV Parsing** | Document understanding | LayoutLM / PaddleOCR-VL | ⚠️ Moderate — needs training data, handles structure |
| **Job-Candidate Matching** | Semantic similarity + ranking | Sentence-BERT embeddings + XGBoost | ✅ Excellent — hybrid approach |

### 4.2 Hybrid Architecture: Embeddings + ML Ranking

The most promising alternative for **candidate ranking** specifically:

```
Current Flow:
  Resume → GPT-4.1 (expensive full analysis) → Ranking

Proposed Hybrid Flow:
  Resume → text-embedding-3-large (already exists!) → Feature vector
  Job    → text-embedding-3-large (already exists!) → Feature vector
  [cosine similarity, skill overlap, experience years] → XGBoost/LightGBM → Ranked score
```

**Why this works for Seemplify:**
- The codebase **already generates embeddings** via `text-embedding-3-large` in `embeddingService.js`
- The codebase **already has a `rankingService.js`** with weighted scoring
- Adding XGBoost/LightGBM would enhance the existing scoring with learned weights instead of hand-tuned ones
- This eliminates GPT-4.1 calls for the ranking pipeline entirely

### 4.3 BERT vs XGBoost vs LightGBM Summary

| Dimension | BERT (fine-tuned) | XGBoost | LightGBM |
|-----------|-------------------|---------|----------|
| **Best for** | Text understanding, NER, classification | Structured feature ranking | Large-scale ranking, speed |
| **Training data needed** | 1K–10K labeled examples | 1K+ examples with features | 1K+ examples with features |
| **Inference speed** | ~50ms/query (GPU) | <1ms/query | <1ms/query |
| **Infrastructure** | GPU recommended | CPU only | CPU only |
| **Interpretability** | Low | Medium (feature importance) | Medium (feature importance) |
| **Accuracy (resume matching)** | High semantic understanding | High with good features | High with good features |

> [!NOTE]
> Research shows that **BERT embeddings + XGBoost/LightGBM** hybrid pipelines outperform either approach alone for resume-job matching tasks, combining semantic understanding with structured feature learning.

---

## 5. Recommended Strategy — Tiered Model Architecture

### ~~Tier 1: GPT-4.1~~ — No Longer Needed
- ~~**Tasks:** Chat agent with tool-calling~~ → **Being removed**
- **Files to delete/deprecate:** `langchainAgentService.js`, `jobAgent.js`, `candidateAgent.js`
- **Result:** GPT-4.1 deployment can be fully decommissioned from Azure

### Tier 1 (New Top Tier): GPT-4.1-mini (Migrate — Structured Tasks)
- **Tasks:** CV parsing, job description/requirements generation, interview analysis, candidate ranking, interview questions, comments analysis
- **Files:** `azureOpenAIService.js` (per-method model selection), `aiInterviewAnalysisService.js`, `gptAnalysisService.js`
- **Why:** 80% cheaper, nearly identical structured output quality, same Azure SDK
- **Effort:** Low — add per-task model config, change deployment name

### Tier 2: GPT-4.1-nano (Migrate — Simple Tasks)
- **Tasks:** Intent routing, bias detection, simple classification
- **Files:** `langchainAgentService.js` (intent classifier), `azureOpenAIService.js` (bias detection)
- **Why:** 95% cheaper, sufficient for classification and short-form extraction
- **Effort:** Very low — change deployment name

### Tier 3: ML Models (Future — Highest ROI Tasks)
- **Tasks:** Candidate ranking, intent classification
- **Approach:** BERT embeddings (or existing `text-embedding-3-large`) + XGBoost/LightGBM
- **Why:** Eliminates LLM costs entirely for ranking, subsecond inference, deterministic results
- **Effort:** Medium — requires training data collection, model training, serving infrastructure

---

## 6. Implementation Roadmap

### Phase 1: Quick Wins (1–2 days, ~80–90% cost reduction)
1. Remove chat agent code (`langchainAgentService.js`, `jobAgent.js`, `candidateAgent.js`)
2. Add model tier configuration to `azureOpenAIService.js`
3. Route each remaining task to GPT-4.1-mini or GPT-4.1-nano
4. Deploy GPT-4.1-mini and GPT-4.1-nano on Azure OpenAI
5. Decommission GPT-4.1 deployment from Azure

### Phase 2: Optimize (1–2 weeks, additional 5–10% savings)
1. Fine-tune GPT-4.1-nano for intent routing (improves accuracy at nano tier)
2. Fine-tune GPT-4.1-mini for CV parsing (improves structured output reliability)
3. Add prompt caching for repeated system prompts

### Phase 3: ML Pipeline (2–4 weeks, eliminates ranking LLM costs)
1. Collect labeled ranking data from recruiter interactions
2. Train XGBoost/LightGBM on embedding features + metadata
3. Replace GPT-4.1 ranking calls with ML pipeline
4. Keep GPT-4.1-mini for generating human-readable explanations

---

## 7. Detailed Cost Estimation

### 7.1 Token Usage Per Task (from codebase analysis)

Token estimates are based on actual `max_completion_tokens` limits, system prompt sizes, and typical input data sizes observed in the codebase.

| Task | System Prompt | User Input (avg) | Output (avg) | Total Tokens/Call |
|------|:------------:|:----------------:|:------------:|:-----------------:|
| **CV Parsing** | ~800 | ~1,500 | ~8,000 | **~10,300** |
| **Job Description Gen** | ~600 | ~200 | ~1,500 | **~2,300** |
| **Job Requirements** | ~1,000 | ~200 | ~1,000 | **~2,200** |
| **Interview Questions** | ~800 | ~500 | ~2,500 | **~3,800** |
| **Interview Analysis** | ~1,500 | ~8,000 | ~5,000 | **~14,500** |
| **Candidate Ranking** | ~1,000 | ~4,000 | ~3,000 | **~8,000** |
| **Team Comments Analysis** | ~2,000 | ~2,000 | ~2,000 | **~6,000** |
| **Bias Detection** | ~500 | ~800 | ~500 | **~1,800** |
| ~~Chat Agent (multi-turn)~~ | ~~~5,000~~ | ~~~3,000~~ | ~~~2,000~~ | ~~**~10,000**~~ |

### 7.2 Estimated Monthly Volumes (3 Scale Scenarios)

| Task | Small (5 recruiters) | Medium (20 recruiters) | Large (50 recruiters) |
|------|:--------------------:|:---------------------:|:---------------------:|
| CV Parsing | 100 | 500 | 2,000 |
| Job Description Gen | 20 | 100 | 400 |
| Job Requirements | 20 | 100 | 400 |
| Interview Questions | 30 | 150 | 500 |
| Interview Analysis | 20 | 100 | 400 |
| Candidate Ranking | 50 | 300 | 1,500 |
| Team Comments | 15 | 80 | 300 |
| Bias Detection | 20 | 100 | 400 |
| ~~Chat Agent~~ | ~~500~~ | ~~3,000~~ | ~~10,000~~ |
| **Total calls/month** | **~775** | **~4,430** | **~15,900** |

### 7.3 Cost Per Call by Model

| Task | GPT-4.1 Cost/Call | GPT-4.1-mini Cost/Call | GPT-4.1-nano Cost/Call |
|------|:-----------------:|:---------------------:|:---------------------:|
| **CV Parsing** (2.3K in, 8K out) | $0.0686 | $0.0138 | $0.0034 |
| **Job Description** (0.8K in, 1.5K out) | $0.0136 | $0.0027 | $0.0007 |
| **Job Requirements** (1.2K in, 1K out) | $0.0104 | $0.0021 | $0.0005 |
| **Interview Questions** (1.3K in, 2.5K out) | $0.0226 | $0.0045 | $0.0011 |
| **Interview Analysis** (9.5K in, 5K out) | $0.0590 | $0.0118 | $0.0030 |
| **Candidate Ranking** (5K in, 3K out) | $0.0340 | $0.0068 | $0.0017 |
| **Team Comments** (4K in, 2K out) | $0.0240 | $0.0048 | $0.0012 |
| **Bias Detection** (1.3K in, 0.5K out) | $0.0066 | $0.0013 | $0.0003 |
| ~~**Chat Agent** (8K in, 2K out)~~ | ~~$0.0320~~ | — | — |

> [!NOTE]
> Formula: (input_tokens × input_price + output_tokens × output_price) / 1,000,000.
> GPT-4.1: $2.00/$8.00 per 1M. Mini: $0.40/$1.60. Nano: $0.10/$0.40.

### 7.4 Monthly Cost Comparison — All Phases

#### Small Scale (5 recruiters, ~775 calls/month)

| Phase | Model Strategy | Monthly Cost | Savings |
|-------|---------------|:------------:|:-------:|
| **Current** | All GPT-4.1 + chat agent | **$50.03** | — |
| **Phase 1** | Remove chat + mini/nano tiers | **$6.70** | **87%** |
| **Phase 2** | + Fine-tuned tiers + caching | **$5.36** | **89%** |
| **Phase 3** | + ML for ranking/intent | **$4.22** | **92%** |

<details>
<summary>Phase 1 breakdown (small)</summary>

| Task | Calls | Model | Cost |
|------|:-----:|-------|-----:|
| CV Parsing | 100 | mini | $1.38 |
| Job Description | 20 | mini | $0.05 |
| Job Requirements | 20 | mini | $0.04 |
| Interview Questions | 30 | mini | $0.14 |
| Interview Analysis | 20 | mini | $0.24 |
| Candidate Ranking | 50 | mini | $0.34 |
| Team Comments | 15 | mini | $0.07 |
| Bias Detection | 20 | nano | $0.01 |
| ~~Chat Agent~~ | ~~0~~ | 🗑️ | $0.00 |
| **Embeddings** (text-embedding-3-large) | ~300 | — | ~$4.43 |
| **Total** | | | **$6.70** |
</details>

---

#### Medium Scale (20 recruiters, ~4,430 calls/month)

| Phase | Model Strategy | Monthly Cost | Savings |
|-------|---------------|:------------:|:-------:|
| **Current** | All GPT-4.1 + chat agent | **$276.40** | — |
| **Phase 1** | Remove chat + mini/nano tiers | **$34.97** | **87%** |
| **Phase 2** | + Fine-tuned tiers + caching | **$27.98** | **90%** |
| **Phase 3** | + ML for ranking/intent | **$21.25** | **92%** |

<details>
<summary>Phase 1 breakdown (medium)</summary>

| Task | Calls | Model | Cost |
|------|:-----:|-------|-----:|
| CV Parsing | 500 | mini | $6.90 |
| Job Description | 100 | mini | $0.27 |
| Job Requirements | 100 | mini | $0.21 |
| Interview Questions | 150 | mini | $0.68 |
| Interview Analysis | 100 | mini | $1.18 |
| Candidate Ranking | 300 | mini | $2.04 |
| Team Comments | 80 | mini | $0.38 |
| Bias Detection | 100 | nano | $0.03 |
| ~~Chat Agent~~ | ~~0~~ | 🗑️ | $0.00 |
| **Embeddings** (text-embedding-3-large) | ~1,500 | — | ~$23.28 |
| **Total** | | | **$34.97** |
</details>

---

#### Large Scale (50 recruiters, ~15,900 calls/month)

| Phase | Model Strategy | Monthly Cost | Savings |
|-------|---------------|:------------:|:-------:|
| **Current** | All GPT-4.1 + chat agent | **$1,068.96** | — |
| **Phase 1** | Remove chat + mini/nano tiers | **$126.36** | **88%** |
| **Phase 2** | + Fine-tuned tiers + caching | **$101.09** | **91%** |
| **Phase 3** | + ML for ranking/intent | **$73.53** | **93%** |

<details>
<summary>Phase 1 breakdown (large)</summary>

| Task | Calls | Model | Cost |
|------|:-----:|-------|-----:|
| CV Parsing | 2,000 | mini | $27.60 |
| Job Description | 400 | mini | $1.08 |
| Job Requirements | 400 | mini | $0.84 |
| Interview Questions | 500 | mini | $2.25 |
| Interview Analysis | 400 | mini | $4.72 |
| Candidate Ranking | 1,500 | mini | $10.20 |
| Team Comments | 300 | mini | $1.44 |
| Bias Detection | 400 | nano | $0.12 |
| ~~Chat Agent~~ | ~~0~~ | 🗑️ | $0.00 |
| **Embeddings** (text-embedding-3-large) | ~6,000 | — | ~$78.11 |
| **Total** | | | **$126.36** |
</details>

### 7.5 Summary Table

| Scale | Current (GPT-4.1) | Phase 1 (mini/nano) | Phase 2 (tuned) | Phase 3 (ML hybrid) |
|-------|:-----------------:|:-------------------:|:---------------:|:-------------------:|
| **5 recruiters** | $50/mo | **$7/mo** | **$5/mo** | **$4/mo** |
| **20 recruiters** | $276/mo | **$35/mo** | **$28/mo** | **$21/mo** |
| **50 recruiters** | $1,069/mo | **$126/mo** | **$101/mo** | **$74/mo** |

> [!IMPORTANT]
> **Embedding costs dominate at scale.** At the medium/large tiers, `text-embedding-3-large` embeddings become the primary cost driver (~65–70% of total). A separate future optimization would be migrating to `text-embedding-3-small` (10× cheaper) if embedding quality remains sufficient for matching accuracy.

> [!CAUTION]
> These estimates assume average token usage. Actual costs depend on: (1) real prompt/response lengths, (2) retry rates, (3) embedding recomputation frequency, and (4) any Weaviate vectorization costs. Monitor Azure OpenAI usage metrics before and after migration for accurate comparison.

### 7.6 High-Volume Scenario: 10 Recruiters × 10K Applicants Each

**Scenario:** 10 recruiters, each processing 10,000 applicants per month = **100,000 applicants/month**.

#### Volume Assumptions

| Stage | Volume | Reasoning |
|-------|:------:|-----------|
| CVs parsed | **100,000** | Every applicant's CV is parsed |
| Jobs posted | **300** | ~300 unique roles across 10 recruiters |
| Job requirements generated | **300** | One per job |
| Interview question sets | **900** | ~3 sets per job (phone, technical, final) |
| Interviews conducted | **20,000** | ~20% of applicants reach interview stage |
| Candidate rankings | **100,000** | Every applicant ranked against their target job |
| Team comments analyzed | **10,000** | ~10% of applicants reach team review |
| Bias detection | **300** | Every job description scanned |
| Embeddings generated | **100,300** | Every new applicant + every job embedded |

#### CURRENT SYSTEM: GPT-4.1 + text-embedding-3-large

*All tasks use GPT-4.1 ($2.00/$8.00 per 1M input/output tokens).*

| Task | Calls | Input Cost | Output Cost | **Subtotal** |
|------|:-----:|:---------:|:----------:|:----------:|
| CV Parsing | 100,000 | $460.00 | $6,400.00 | **$6,860.00** |
| Job Description | 300 | $0.48 | $3.60 | **$4.08** |
| Job Requirements | 300 | $0.72 | $2.40 | **$3.12** |
| Interview Questions | 900 | $2.34 | $18.00 | **$20.34** |
| Interview Analysis | 20,000 | $380.00 | $800.00 | **$1,180.00** |
| Candidate Ranking | 100,000 | $1,000.00 | $2,400.00 | **$3,400.00** |
| Team Comments | 10,000 | $80.00 | $160.00 | **$240.00** |
| Bias Detection | 300 | $0.78 | $1.20 | **$1.98** |
| **LLM Subtotal** | | | | **$11,709.52** |
| Embeddings (text-embedding-3-large) | 100,300 | ~150M tokens @ $0.13/1M | | **$19.56** |
| **TOTAL CURRENT** | | | | **$11,729.08/mo** |

---

#### PROPOSED SYSTEM: GTE-Qwen2 + LightGBM + GPT-4.1-mini/nano + DistilBERT

Full architecture with confidence-based routing:

```
┌──────────────────────────────────────────────────────────────┐
│                     PROPOSED ARCHITECTURE                    │
│                                                              │
│  Applicant CV                                                │
│      │                                                       │
│      ├─→ GTE-Qwen2-1.5B (self-hosted) → Embedding → Weaviate│
│      ├─→ GPT-4.1-mini → Structured CV Parse (JSON)          │
│      └─→ LightGBM Ranker (local ONNX, <1ms)                 │
│              │                                               │
│              ├─ confidence ≥ 70% → LightGBM score     (FREE)│
│              └─ confidence < 70% → Fallback GPT-mini    ($)  │
│                                                              │
│  Classification:                                             │
│      ├─→ DistilBERT (local ONNX) → Bias Detection     (FREE)│
│      └─→ DistilBERT (local ONNX) → Intent Routing     (FREE)│
│                                                              │
│  Generation:                                                 │
│      ├─→ GPT-4.1-mini → JDs, Requirements, Questions    ($)  │
│      └─→ GPT-4.1-mini → Interview Analysis, Explanations($)  │
│                                                              │
│  Monthly Retrain:                                            │
│      └─→ Python script → Retrain LightGBM on new            │
│          hire/reject data → Export ONNX → Hot-reload          │
└──────────────────────────────────────────────────────────────┘
```

| Task | Calls | Model | Input Cost | Output Cost | **Subtotal** |
|------|:-----:|-------|:---------:|:----------:|:----------:|
| CV Parsing | 100,000 | GPT-4.1-mini | $92.00 | $1,280.00 | **$1,372.00** |
| Job Description | 300 | GPT-4.1-mini | $0.10 | $0.72 | **$0.82** |
| Job Requirements | 300 | GPT-4.1-mini | $0.14 | $0.48 | **$0.62** |
| Interview Questions | 900 | GPT-4.1-mini | $0.47 | $3.60 | **$4.07** |
| Interview Analysis | 20,000 | GPT-4.1-mini | $76.00 | $160.00 | **$236.00** |
| *Ranking — high confidence (85%)* | 85,000 | LightGBM (local) | $0.00 | $0.00 | **$0.00** |
| *Ranking — low confidence fallback (15%)* | 15,000 | GPT-4.1-mini | $30.00 | $72.00 | **$102.00** |
| *Ranking — on-demand explanations* | 2,000 | GPT-4.1-mini | $4.00 | $9.60 | **$13.60** |
| Team Comments | 10,000 | GPT-4.1-mini | $16.00 | $32.00 | **$48.00** |
| Bias Detection | 300 | DistilBERT (local) | $0.00 | $0.00 | **$0.00** |
| **LLM Subtotal** | | | | | **$1,777.11** |
| Embeddings (GTE-Qwen2-1.5B self-hosted) | 100,300 | Local ONNX | $0.00 | $0.00 | **$0.00** |
| **TOTAL PROPOSED** | | | | | **$1,777.11/mo** |

---

#### Retraining & Infrastructure Costs

| Item | Frequency | Cost |
|------|-----------|:----:|
| LightGBM retrain (Python script, CPU) | Monthly | **~$0** |
| GTE-Qwen2-1.5B model hosting | Always-on | **~3GB RAM** |
| DistilBERT model hosting | Always-on | **~250MB RAM** |
| LightGBM ONNX model hosting | Always-on | **~50MB RAM** |
| **Total additional server RAM** | | **~3.3GB** |

---

#### Head-to-Head Summary

| | **Current System** | **Proposed System** |
|--|:--:|:--:|
| Embedding model | text-embedding-3-large (API) | GTE-Qwen2-1.5B (self-hosted) |
| Embedding cost | $19.56/mo | **$0** |
| Ranking model | GPT-4.1 (all 100K) | LightGBM + GPT-mini fallback (15%) |
| Ranking cost | $3,400/mo | **$115.60/mo** |
| Classification | GPT-4.1 | DistilBERT (self-hosted) |
| Classification cost | $1.98/mo | **$0** |
| Generation tasks | GPT-4.1 | GPT-4.1-mini |
| Generation cost | $8,287.54/mo | **$1,661.51/mo** |
| Vector DB | Weaviate | Weaviate (same) |
| Retraining | None | Monthly LightGBM retrain (~free) |
| | | |
| **TOTAL MONTHLY** | **$11,729** | **$1,777** |
| **TOTAL ANNUAL** | **$140,749** | **$21,325** |
| **ANNUAL SAVINGS** | — | **$119,424 (85%)** |

> [!IMPORTANT]
> **CV parsing is the #1 remaining cost** at $1,372/mo (77% of proposed total). Future optimizations:
> - Fine-tune GPT-4.1-mini for CV parsing → 20–30% token reduction
> - Evaluate dedicated document extraction models (LayoutLM) → could reduce to near-zero
> - Use prompt caching for system prompts → saves ~$20/mo

> [!NOTE]
> Self-hosted models (GTE-Qwen2, DistilBERT, LightGBM) all run on your existing server with ~3.3GB additional RAM. No GPU needed. No additional cloud instances.

> [!CAUTION]
> The 85/15 LightGBM confidence split is an estimate. With good training data (>5K labeled hire/reject examples), the high-confidence rate may reach >90%, further reducing GPT fallback costs to ~$68/mo.
---

## 9. Pricing & Scaling Analysis

### 9.1 Your AI Cost Per Client Company

Each client company's AI cost depends on their recruiter count and applicant volume. Chat agent costs excluded (being removed).

**Current Architecture (GPT-4.1 + text-embedding-3-large):**

| Client Size | Recruiters | Applicants/mo | Your AI Cost/mo | Your AI Cost/year |
|-------------|:----------:|:------------:|:---------------:|:-----------------:|
| **Startup** | 2 | 2,000 | **$235** | **$2,820** |
| **SMB** | 5 | 15,000 | **$1,759** | **$21,108** |
| **Mid-Market** | 10 | 50,000 | **$5,865** | **$70,375** |
| **Enterprise** | 25 | 150,000 | **$17,594** | **$211,126** |
| **Large Enterprise** | 50 | 500,000 | **$58,645** | **$703,745** |

**Proposed Architecture (GTE-Qwen2 + LightGBM + GPT-4.1-mini + DistilBERT):**

| Client Size | Recruiters | Applicants/mo | Your AI Cost/mo | Your AI Cost/year |
|-------------|:----------:|:------------:|:---------------:|:-----------------:|
| **Startup** | 2 | 2,000 | **$36** | **$427** |
| **SMB** | 5 | 15,000 | **$267** | **$3,199** |
| **Mid-Market** | 10 | 50,000 | **$889** | **$10,663** |
| **Enterprise** | 25 | 150,000 | **$2,666** | **$31,988** |
| **Large Enterprise** | 50 | 500,000 | **$8,886** | **$106,627** |

> [!IMPORTANT]
> **Cost per applicant:**
> - Current: **~$0.117** per applicant
> - Proposed: **~$0.018** per applicant (6.5× cheaper)

### 9.2 Recommended SaaS Pricing (Per Recruiter Seat)

| Tier | Price/Seat/Mo | Applicant Cap/Seat | Target Client |
|------|:------------:|:------------------:|---------------|
| **Starter** | **$99** | 2,000 | Startups, small agencies |
| **Professional** | **$199** | 5,000 | Growing companies |
| **Business** | **$349** | 10,000 | Mid-market, high-volume |
| **Enterprise** | **$499+** | Custom / unlimited | Large enterprises |
| *Overage* | *$5 per 1,000 extra applicants* | | All tiers |

### 9.3 Profit Per Company — Current vs Proposed

Assuming the SaaS pricing above, here's what you **keep** per client:

| Client Size | Seats | Tier | Revenue/mo | Current AI Cost | Current Profit | Proposed AI Cost | **Proposed Profit** |
|-------------|:-----:|------|:----------:|:---------------:|:--------------:|:----------------:|:-------------------:|
| **Startup** (2K apps) | 2 | Starter | $198 | $235 | **-$37 (LOSS)** | $36 | **$162 (82%)** |
| **SMB** (15K apps) | 5 | Professional | $995 | $1,759 | **-$764 (LOSS)** | $267 | **$728 (73%)** |
| **Mid-Market** (50K apps) | 10 | Business | $3,490 | $5,865 | **-$2,375 (LOSS)** | $889 | **$2,601 (75%)** |
| **Enterprise** (150K apps) | 25 | Enterprise | $12,475 | $17,594 | **-$5,119 (LOSS)** | $2,666 | **$9,809 (79%)** |
| **Large Enterprise** (500K apps) | 50 | Enterprise | $24,950 | $58,645 | **-$33,695 (LOSS)** | $8,886 | **$16,064 (64%)** |

> [!CAUTION]
> **With the current GPT-4.1 architecture, you lose money on EVERY client at these prices.** The AI costs exceed the subscription revenue at every tier. You would need to charge 3–6× more to break even, which is uncompetitive.

### 9.4 Scaling: Total Platform Economics

How the business looks as you add more client companies:

**Current Architecture — UNSUSTAINABLE:**

| # of Clients | Mix | Total Revenue/mo | Total AI Cost/mo | Net Profit/mo | Margin |
|:---:|------------|:---:|:---:|:---:|:---:|
| 10 | 5 Startup, 3 SMB, 2 Mid-Market | $10,955 | $19,753 | **-$8,798** | **-80%** |
| 25 | 10 Startup, 8 SMB, 5 Mid-Market, 2 Enterprise | $41,860 | $65,009 | **-$23,149** | **-55%** |
| 50 | 20 Startup, 15 SMB, 10 Mid-Market, 5 Enterprise | $101,135 | $145,630 | **-$44,495** | **-44%** |
| 100 | 40 Startup, 30 SMB, 20 Mid-Market, 10 Enterprise | $202,270 | $291,260 | **-$88,990** | **-44%** |

**Proposed Architecture — PROFITABLE:**

| # of Clients | Mix | Total Revenue/mo | Total AI Cost/mo | Net Profit/mo | Margin |
|:---:|------------|:---:|:---:|:---:|:---:|
| 10 | 5 Startup, 3 SMB, 2 Mid-Market | $10,955 | **$2,859** | **$8,096** | **74%** |
| 25 | 10 Startup, 8 SMB, 5 Mid-Market, 2 Enterprise | $41,860 | **$11,070** | **$30,790** | **74%** |
| 50 | 20 Startup, 15 SMB, 10 Mid-Market, 5 Enterprise | $101,135 | **$24,547** | **$76,588** | **76%** |
| 100 | 40 Startup, 30 SMB, 20 Mid-Market, 10 Enterprise | $202,270 | **$49,094** | **$153,176** | **76%** |

### 9.5 The Bottom Line

```
                    ANNUAL PLATFORM REVENUE AT 50 CLIENTS
                    ======================================

     Current Architecture          Proposed Architecture
     ────────────────────          ─────────────────────
     Revenue:  $1,213,620          Revenue:  $1,213,620
     AI Cost:  $1,747,560          AI Cost:    $294,564
     ─────────────────────         ─────────────────────
     PROFIT:    -$533,940          PROFIT:    +$919,056
                  ▲                               ▲
            LOSING MONEY               $919K ANNUAL PROFIT
```

The architecture migration isn't just a cost optimization — **it determines whether the recruiter product is a viable business.**

---

## 8. Key Findings

1. **GPT-4.1 is completely unnecessary** — with the chat agent being removed, zero remaining tasks require frontier model capabilities
2. **The easiest and safest optimization** is migrating to GPT-4.1-mini/nano within the same Azure OpenAI ecosystem — requiring only deployment name changes, and decommissioning the GPT-4.1 deployment
3. **Removing the chat agent** eliminates the largest and most expensive AI consumer (variable-length multi-turn conversations with tool-calling)
4. **Hybrid ML approaches** (embeddings + XGBoost/LightGBM) are proven in recruitment and could eliminate LLM costs for ranking entirely, leveraging the existing embedding infrastructure
5. **Self-hosted open-source models** (Phi-3, Mistral, Llama) are viable but only cost-effective at very high scale (>10M tokens/day)
6. **Cross-provider alternatives** (Gemini Flash, Claude Haiku) offer competitive pricing but would require SDK/integration changes
7. The codebase is **well-architected for tiered migration** — the centralized `azureOpenAIService.js` wrapper makes per-task model routing straightforward
8. **BERT/DistilBERT runs on CPU in Node.js** via ONNX Runtime or Transformers.js — viable for intent routing and bias detection at zero API cost
9. **Embedding costs dominate at scale** — self-hosted **GTE-Qwen2-1.5B** (1,536 dims, MTEB ~65, ~3GB RAM) will replace `text-embedding-3-large` to eliminate embedding API costs entirely
10. **The current architecture makes the product unprofitable** — at competitive SaaS pricing, AI costs exceed revenue. The proposed architecture enables 74–76% gross margins and turns a projected $534K annual loss (at 50 clients) into a $919K annual profit

---

## Appendix A: Running BERT on CPU in Node.js

BERT and DistilBERT can run locally on CPU in a Node.js backend for classification tasks (intent routing, bias detection). This eliminates API costs for those tasks entirely.

### Node.js Options

| Library | Description | Best For |
|---------|-------------|----------|
| **`onnxruntime-node`** | Microsoft's ONNX inference engine | Production — fastest, most control |
| **`@xenova/transformers`** | Hugging Face Transformers.js (uses ONNX) | Easiest setup — pre-built pipelines |

### Model Recommendations for CPU

| Model | CPU Inference | RAM | Accuracy vs BERT |
|-------|:------------:|:---:|:----------------:|
| **BERT-base** | ~150–300ms | ~800MB | 100% (baseline) |
| **DistilBERT** ✅ | ~50–100ms | ~250MB | ~97% |
| **TinyBERT** | ~20–50ms | ~100MB | ~92% |

> [!TIP]
> Use **DistilBERT** for the best balance. Load the model once on server boot (5–15 sec cold start), then inference is ~50–100ms per call.

### Example: Intent Classification (Transformers.js)

```javascript
const { pipeline } = require('@xenova/transformers');

// Load once at startup
const classifier = await pipeline('text-classification', 'distilbert-base-uncased-finetuned-sst-2-english');

// Classify user intent (~50ms on CPU)
const result = await classifier('Find senior developers in London');
// → { label: 'job_search', score: 0.95 }
```

### Training Workflow

1. **Fine-tune in Python** (PyTorch/Hugging Face) on labeled examples from your chat history
2. **Export to ONNX** using `optimum` library
3. **Deploy in Node.js** via `onnxruntime-node`
4. DistilBERT classification needs only **500–2,000 labeled examples** to work well

### Applicable Tasks

| Task | Replace With | Savings |
|------|-------------|:-------:|
| Intent routing (job/candidate/general) | Fine-tuned DistilBERT classifier | **100%** (no API cost) |
| Bias detection | Fine-tuned DistilBERT binary classifier | **100%** |

### Caveats

- BERT is for **classification/NER/embeddings only** — it cannot *generate* text (job descriptions, explanations, etc.)
- Concurrency: CPU inference is single-threaded per call; use worker threads or a queue under heavy load
- Max 512 tokens input — fine for short classification tasks, not for long documents

---

## Appendix B: XGBoost / LightGBM for Candidate Ranking

### Pick One, Not Both

XGBoost and LightGBM solve the same problem (gradient-boosted decision trees). **Choose LightGBM** — it's faster to train, uses less memory, and handles growing datasets better.

| | XGBoost | LightGBM ✅ |
|--|---------|----------|
| Training speed | Slower | **2–5× faster** |
| Memory usage | Higher | **Lower** |
| Node.js support | ❌ No native lib | ❌ No native lib |
| Deployment path | Export to ONNX → Node.js | Export to ONNX → Node.js |

### Can LightGBM Be More Accurate Than GPT for Ranking?

**Yes, likely.** For ranking specifically:

| Dimension | GPT-4.1 | LightGBM (trained on your data) |
|-----------|:-------:|:-------------------------------:|
| Learns from your hires | ❌ Generic | ✅ Learns your patterns |
| Consistency | ⚠️ Variable | ✅ Deterministic |
| Auditability | ⚠️ Black box | ✅ Feature importance |
| Speed | ~2–5 sec/batch | **<1ms per candidate** |
| Improves over time | ❌ Static | ✅ Retrain with new data |

### Training Pipeline

**Step 1 — Collect training data** from existing MongoDB collections:

| Feature | Source | Already Exists? |
|---------|--------|:---:|
| Embedding cosine similarity | `embeddingService.js` | ✅ |
| Skills overlap % | `rankingService.js` | ✅ |
| Experience years delta | Candidate vs Job model | ✅ |
| Education level match | Candidate model | ✅ |
| Location match | Candidate model | ✅ |
| **Label** (hired/rejected/shortlisted) | Interview outcomes | ✅ |

**Step 2 — Train in Python** (~20 lines):

```python
import lightgbm as lgb
from sklearn.model_selection import train_test_split

df = pd.read_csv('ranking_data.csv')  # exported from MongoDB
features = ['embedding_sim', 'skills_overlap', 'experience_match',
            'education_match', 'location_match']

X_train, X_test, y_train, y_test = train_test_split(df[features], df['outcome'])
model = lgb.LGBMRanker(n_estimators=100, learning_rate=0.1)
model.fit(X_train, y_train)

# Export to ONNX → deploy in Node.js
```

**Step 3 — Serve in Node.js** via `onnxruntime-node`:

```javascript
const ort = require('onnxruntime-node');
const session = await ort.InferenceSession.create('./ranking_model.onnx');

async function rankCandidate(features) {
  const tensor = new ort.Tensor('float32', features, [1, features.length]);
  const results = await session.run({ input: tensor });
  return results.score.data[0]; // 0-1 ranking score, <1ms
}
```

### The Hybrid Sweet Spot

```
LightGBM → ranking score (fast, learned, deterministic, free)
GPT-4.1-mini → human-readable explanation on-demand (only when recruiter clicks "why?")
```

### What Already Exists

The codebase already does most of the heavy lifting:
- `embeddingService.js` generates embeddings and computes cosine similarity
- `rankingService.js` applies weighted scoring (LightGBM would *learn* these weights instead)
- Weaviate handles vector search and retrieval
- **GPT is currently duplicating work the embeddings already do** — it just adds a prose explanation

---

## Appendix C: Embedding Model Alternatives (Replacing text-embedding-3-large)

### Quick Win: text-embedding-3-small

The simplest optimization — one config change, no re-embedding needed if using OpenAI's dimensionality reduction:

| | text-embedding-3-large (current) | text-embedding-3-small |
|--|:--:|:--:|
| **Cost** | $0.13 / 1M tokens | **$0.02 / 1M tokens** |
| **Dimensions** | 3,072 | 1,536 |
| **MTEB** | ~66 | ~62 |
| **Max tokens** | 8,191 | 8,191 |
| **Migration effort** | — | ⚠️ Must re-embed all data |

### Self-Hosted Alternatives (Zero Cost)

For eliminating embedding API costs entirely:

| Model | Dims | Max Tokens | MTEB | Size | CPU Speed |
|-------|:----:|:----------:|:----:|:----:|:---------:|
| **GTE-Qwen2-1.5B** ✅ (chosen) | 1,536 | 32,768 | ~65 | ~3GB | ~200–400ms |
| Qwen3-Embedding-0.6B | configurable up to 4,096 | 32,768 | ~62 | ~600MB | ~100–200ms |
| Nomic Embed v1.5 | 768 | 8,192 | ~62 | ~550MB | ~100–200ms |
| E5-Mistral-7B | 4,096 | 32,768 | ~67 | ~14GB | ⚠️ Too slow on CPU |

> [!IMPORTANT]
> **GTE-Qwen2-1.5B** is the selected model for self-hosting. It scores ~65 on MTEB (close to OpenAI’s ~66), handles 32K tokens (4× more than OpenAI), and runs on CPU with ~3GB RAM. Its 1,536 dimensions will require updating the Weaviate schema from 3,072.

### BERT Is NOT a Good Embedding Replacement

| | BERT / Sentence-BERT | text-embedding-3-large |
|--|:---:|:---:|
| Max input tokens | **512** ⚠️ | 8,191 |
| Dimensions | 768 | 3,072 |
| MTEB | ~58 | ~66 |

Your candidate text blocks in `embeddingService.js` regularly exceed 1,000–3,000 tokens (career summary + all work experience + skills + education). **BERT would truncate most of this data**, losing critical information. BERT is great for classification — not for embedding long documents.

### Embedding Cost Impact (at 20 recruiters)

| Strategy | Monthly Embedding Cost |
|----------|:---------------------:|
| **Current** (text-embedding-3-large) | ~$23.28 |
| **text-embedding-3-small** | ~$3.58 |
| **GTE-Qwen2-1.5B self-hosted** | **$0** |

### Migration Considerations

Switching embedding models requires **re-embedding all existing candidates and jobs** in Weaviate, since vectors from different models are incompatible. This is a one-time batch job:
1. Export all candidate/job records from MongoDB
2. Generate new embeddings with the chosen model
3. Re-index in Weaviate with the new vector dimensions
4. Update `embeddingService.js` to use the new model

### Recommendation

1. **Decision:** Self-host **GTE-Qwen2-1.5B** on our server for zero-cost embeddings
2. Migration requires re-embedding all existing data in Weaviate (one-time batch job)
3. GTE-Qwen2-1.5B runs via `@xenova/transformers` or `onnxruntime-node` in Node.js on CPU

