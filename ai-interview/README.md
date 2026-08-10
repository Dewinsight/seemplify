# AI Interview Standalone

Standalone extraction of the Seemplify AI Interview product. This is a real app surface, not a mock: it has separate recruiter and admin authentication, its own Mongo database, wallet billing, email invitations through the Seemplify mail service, Azure Speech voice, connected ChatGPT generation, candidate proctoring, transcripts, and ranking.

## Apps

- `backend` - Express API for auth, admin, wallet, library data, interview creation, candidate links, chat workflow, proctoring, Azure Speech, ChatGPT scoring through the signed Seemplify gateway, mail-service invites, and scheduled sending.
- `frontend` - Next.js app with landing, recruiter login/signup, recruiter workspace, admin login/admin console, and public candidate interview flow.

## Data

The standalone app uses its own Mongo database:

```powershell
AI_INTERVIEW_MONGO_URI=mongodb://127.0.0.1:27017
AI_INTERVIEW_MONGO_DB=ai_recruiter
```

Collections are `jobs`, `candidates`, `questions`, `interviews`, `sessions`, `emailLog`, `walletLedger`, `users`, `cvProcessingJobs`, `cvProcessingIntakes`, `cvStorageCleanupTasks`, and singleton `settings`.

Production refuses to start without `AI_INTERVIEW_MONGO_URI` (or the shared `MONGO_URI`/`MONGODB_URI`). The JSON and filesystem stores are development-only; durable CV processing in production also requires persistent Redis.

## Required Services

Configure these in `backend/.env`:

- `AI_INTERVIEW_SESSION_SECRET`
- `AI_INTERVIEW_ADMIN_EMAIL` / `AI_INTERVIEW_ADMIN_PASSWORD`
- `AI_INTERVIEW_RECRUITER_EMAIL` / `AI_INTERVIEW_RECRUITER_PASSWORD`
- `SEEMPLIFY_PLATFORM_API_URL` for the central Seemplify feature switch (production defaults to `https://api.seemplifyai.com`)
- `SEEMPLIFY_AI_GATEWAY_URL`, `AI_GATEWAY_SERVICE_ID`, and `AI_GATEWAY_HMAC_SECRET` for signed central AI runtime calls
- `AI_INTERVIEW_REDIS_HOST`, `AI_INTERVIEW_REDIS_PORT`, and `AI_INTERVIEW_CV_STATUS_TOKEN_SECRET` for durable asynchronous CV parsing
- `MAIL_API_BASE_URL`, `MAIL_API_TOKEN`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`

The standalone app never receives a provider API key or chooses a provider credential. The recruiter backend signs and routes every request. CV parsing requires an idempotency key, commits a durable intake before writing the raw CV to GridFS, returns `202` after the processing job is bound, and waits in BullMQ while the ChatGPT gateway is unavailable. Restart and periodic recovery reclaim abandoned intake files without deleting bytes referenced by queued or retryable jobs. Azure remains configured only for interview speech.

## Local Run

```powershell
cd ai-interview/backend
npm install
npm run dev

cd ../frontend
pnpm install
pnpm dev
```

Default URLs:

- Frontend: `http://localhost:5200`
- Backend: `http://localhost:5101`
- Recruiter app: `http://localhost:5200/app`
- Admin app: `http://localhost:5200/admin`
- Demo candidate link: `http://localhost:5200/public/ai-interview/demo-token`

## Product Flow

1. Admin logs in and manages pricing, wallet funds, platform settings, users, email status, and demo resets.
2. Recruiter logs in or signs up, creates jobs, candidates, and questions in the Library tab.
3. Recruiter schedules an AI interview, selects saved candidates or guest recipients, selects questions, selects an Azure voice, and pays from the wallet.
4. The Seemplify mail service sends candidate magic links. Raw public tokens are never stored; only token hashes are stored.
5. Candidate completes the proctored AI interview through the public link.
6. Connected ChatGPT scores the completed session through the central runtime. Recruiter sees transcript, proctoring events, and ranked candidates.

## Checks

```powershell
cd ai-interview/backend
npm run check

cd ../frontend
pnpm typecheck
```
