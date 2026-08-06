# Seemplify local CV LLM

This Windows-only runtime keeps Ollama on `127.0.0.1:11434` and exposes the
signed Seemplify AI gateway on `127.0.0.1:11435`. CV requests use
`/v1/cv/analyze`; other catalogued AI activities use `/v1/complete`.

## Application runtime profiles

Signed `/v1/complete` and `/v1/status` requests can select an application
runtime with `runtimeProfile`. The `experience-management` profile defaults to
the Codex local-cloud `gpt-5.6-terra` runtime. Its selected engine and model are
exposed in `runtimeProfiles` and can be managed through the local-only control
API under `applicationDefaults.experienceManagement` or with
`-Action set-experience-default`.

Experience activities are deny-by-default: only activities registered in the
AI runtime catalog are accepted, including the governed
`experience.assistant.*` operations. Their scheduler lanes use the Experience
Management profile when evaluating approved concurrency. The gateway infers
that profile when the caller omits it, while an explicit unknown profile is
rejected.

Runtime state and secrets are written to `.local-runtime/llm` and are ignored by
Git. The public Cloudflare hostname routes to the gateway, never to Ollama.

```powershell
.\tools\local-llm\manage.ps1 -Action start
.\tools\local-llm\cloudflare-tunnel.ps1 -Action start
```

Configure the local recruiter backend without printing the service secret:

```powershell
.\tools\local-llm\configure-recruiter.ps1 -Target local
```

The configuration command reads the sustained CV approvals and refuses a
requested concurrency above them. Use `-Concurrency N` only to select a lower
operator cap.

Use `-Target public` only for a hosted recruiter environment with the same
secret installed in its secret manager.

Run the sequential model capability matrix (it never runs two GPU engines at
the same time and restores the originally selected model):

```powershell
cd recruiter\backend
npm run evaluate:local-models
```

## Global and activity concurrency

The runtime has two capacity boundaries:

- the shared engine ceiling limits all concurrent Terra work;
- each AI activity has its own FIFO lane and independently approved limit.

A request always enters its activity lane, including a single request. When a
lane or the shared ceiling is full, the request waits; it is not rejected as
busy. Dispatch rotates fairly between eligible activities. The gateway reports
lane depth, active work, limits, oldest wait, p95 wait/run time, completions,
failures, and sustained-approval state in `activityQueues`.

The activity lanes are short-lived gateway queues. CV uploads first enter the
durable MongoDB/BullMQ queue, so they survive gateway or machine restarts.
Question-generation callers retain their normal application retry behavior if
the gateway itself restarts.

Benchmark the four activities currently assigned to Terra:

```powershell
node tools/local-llm/benchmark-activities.cjs `
  --activities=candidate.cv_parse,ai_interview.cv_parse,interview.questions,ai_interview.question_generation `
  --levels=1,2,4,8,16,32,64 `
  --sustained-rounds=3 `
  --minimum-sustained-requests=12
```

The harness disables public ingress, runs synthetic golden fixtures directly
against the selected engine, checkpoints a PII-free report, and restores the
gateway state in `finally`. It records a limit only after both the independent
activity run and the mixed-workload sustained run pass.

Results are stored outside Git in:

```text
.local-runtime/llm/activity-concurrency-benchmark.json
.local-runtime/llm/approved-concurrency.json
```

Exercise the actual gateway waiting path after applying an approval:

```powershell
node tools/local-llm/soak.cjs --requests=40 --burst
```
