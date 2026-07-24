# Seemplify local CV LLM

This Windows-only runtime keeps Ollama on `127.0.0.1:11434` and exposes the
signed Seemplify AI gateway on `127.0.0.1:11435`. CV requests use
`/v1/cv/analyze`; other catalogued AI activities use `/v1/complete`.

Runtime state and secrets are written to `.local-runtime/llm` and are ignored by
Git. The public Cloudflare hostname routes to the gateway, never to Ollama.

```powershell
.\tools\local-llm\manage.ps1 -Action start
.\tools\local-llm\cloudflare-tunnel.ps1 -Action start
```

Configure the local recruiter backend without printing the service secret:

```powershell
.\tools\local-llm\configure-recruiter.ps1 -Target local -Concurrency 1
```

Use `-Target public` only for a hosted recruiter environment with the same
secret installed in its secret manager.

Run the sequential model capability matrix (it never runs two GPU engines at
the same time and restores the originally selected model):

```powershell
cd recruiter\backend
npm run evaluate:local-models
```
