# audio-injestion-app

Modular Node.js/TypeScript Express service that transcribes uploaded audio to
structured JSON via Google's Gemini 2.5 Flash model.

The service ships with **two paths** so you can pick the right one per use case:

| Path  | Endpoint                         | Behavior                                   | When to use                            |
|-------|----------------------------------|--------------------------------------------|----------------------------------------|
| Sync  | `POST /api/v1/transcribe`        | Blocks until Gemini returns the transcript | Small files, low concurrency, demos    |
| Async | `POST /api/v1/jobs` (+ polling)  | Returns `202 { job_id }`, processes in background with retry + DLQ | Production, high concurrency, large files |

```
POST /api/v1/transcribe              # sync — returns transcript inline
POST /api/v1/jobs                    # async — returns { job_id }, 202 Accepted
GET  /api/v1/jobs                    # list jobs
GET  /api/v1/jobs/:id                # status: pending|processing|completed|failed
GET  /api/v1/jobs/:id/transcript     # final transcript (409 until completed)
POST /api/v1/jobs/:id/retry          # re-enqueue a failed job
GET  /api/v1/dlq                     # inspect the dead-letter queue
GET  /health                         # liveness probe
```

## Quick start

```bash
cp .env.example .env           # then set GEMINI_API_KEY
npm install
npm run dev                    # tsx watch src/index.ts
```

### Sync (one-shot)

```bash
curl -F "audio=@sample.mp3" http://localhost:3000/api/v1/transcribe
```

### Async (production-shaped)

```bash
# 1. Upload + create job — returns immediately with a job_id
curl -F "audio=@sample.mp3" http://localhost:3000/api/v1/jobs
# → { "job_id": "…", "status": "pending", "status_url": "/api/v1/jobs/…" }

# 2. Poll for status
curl http://localhost:3000/api/v1/jobs/<job_id>
# → { "id": "…", "status": "processing", "attempts": 1, … }

# 3. Fetch the transcript once status == "completed"
curl http://localhost:3000/api/v1/jobs/<job_id>/transcript
# → { "transcript": "...", "segments": [ {start_time, end_time, text}, ... ] }

# Failed? Inspect the DLQ or retry:
curl http://localhost:3000/api/v1/dlq
curl -X POST http://localhost:3000/api/v1/jobs/<job_id>/retry
```

---

## Design decisions

### 1. Layered architecture (middleware → service → route)

Code is split into single-responsibility modules so each concern can change
independently:

| Layer       | File                                     | Responsibility                                  |
|-------------|------------------------------------------|-------------------------------------------------|
| Middleware  | `src/middleware/upload.ts`               | Accept + validate the upload, persist to disk   |
| Service     | `src/services/transcription.ts`          | Talk to Gemini, parse the structured response   |
| Store       | `src/store/jobStore.ts`                  | Persist job state (in-memory now, Postgres-shaped) |
| Queue       | `src/queue/jobQueue.ts`                  | Hand jobs to workers + dead-letter queue        |
| Worker      | `src/worker/transcriptionWorker.ts`      | Consume jobs, retry, escalate to DLQ            |
| Routes      | `src/routes/transcribe.ts`, `jobs.ts`    | HTTP glue                                       |
| Bootstrap   | `src/index.ts`                           | Wire everything, error middleware, port         |

Swapping the transcription provider, the database, or the queue means rewriting
exactly one file.

### 2. Multer disk storage, not memory storage

`multer.diskStorage` streams uploads to `./uploads/<unique>.<ext>` so a 25 MB
upload never sits in the Node heap. Filenames combine `Date.now()` + 8 random
bytes so concurrent uploads of `audio.mp3` never collide.

### 3. Mime-type allowlist + 25 MB hard cap

`fileFilter` only accepts WAV/MP3/OGG/M4A and their common aliases. Anything
else is rejected at the middleware boundary, before the service layer sees it.
`limits.fileSize` produces a clean Multer error rather than a runaway base64.

### 4. Synchronous `fs.unlinkSync` in both branches (sync path)

The sync route deletes the temp file in **both** success and catch blocks using
`fs.unlinkSync`. An async unlink whose error fires after the response is sent
can leak files; sync deletion guarantees the file is gone before the response
leaves the process. The catch-side unlink is wrapped so a missing-file race
doesn't mask the original error.

### 5. Strict `responseSchema` instead of prompt-engineered JSON

The transcription service sets `responseMimeType = 'application/json'` and
passes a strict `responseSchema` to Gemini. The model is constrained at decode
time to produce JSON matching the schema, so `JSON.parse` on the response is
safe and the shape already matches the TypeScript `TranscriptionResult` type —
no runtime validation glue needed.

### 6. Audio passed as `inlineData` (base64) rather than the Files API

For files under 25 MB inline base64 keeps the round-trip simple — no separate
upload step, no file-handle lifecycle. Above 25 MB I'd switch to the Files API.

### 7. ESM + NodeNext + strict TypeScript

`"type": "module"` with `"moduleResolution": "NodeNext"` matches how
`@google/genai` ships (ESM-first). `strict: true` catches the easy mistakes
early. Relative imports use the `.js` suffix as NodeNext requires.

### 8. `tsx` for dev, `tsc` for build

`tsx watch` gives instant restarts in development. `tsc` produces `dist/` for
production (`npm start`). No bundler needed for a server app.

### 9. Centralized error middleware

Multer errors, Gemini failures, JSON parse errors — all funnel through the
Express error handler in `index.ts`. Multer errors map to HTTP 400 with a
stable `code`; everything else returns 500. Routes only call `next(err)`.

---

## Async architecture — what it demonstrates

The async path (`POST /api/v1/jobs`) implements the **same production
architecture** described in the system-design answers — queue, worker, status
state machine, retries with exponential backoff, dead-letter queue — but with
in-process implementations so it runs on a laptop with zero infrastructure.

```
            ┌─────────────┐                 ┌──────────────┐
   client → │  POST       │ → multer-saves  │  ./uploads/  │
            │  /jobs      │   file to disk  │  (≈ S3)      │
            └──────┬──────┘                 └──────────────┘
                   │ 1. create job (status=pending)
                   ▼
            ┌─────────────┐                 ┌──────────────┐
            │  JobStore   │                 │   JobQueue   │
            │  (Map →     │                 │   (array →   │
            │   Postgres) │                 │    SQS)      │
            └──────┬──────┘                 └──────┬───────┘
                   │ 2. return 202 { job_id }      │ 3. enqueue
                   ▼                               ▼
              client polls                  ┌──────────────┐
              GET /jobs/:id                 │   Worker     │
                                            │  (in-proc →  │
                                            │   separate   │
                                            │   process)   │
                                            └──────┬───────┘
                                                   │ 4. claim (transition pending→processing)
                                                   │ 5. call Gemini
                                                   │ 6a. ok → update completed
                                                   │ 6b. fail → backoff + re-enqueue,
                                                   │     or DLQ after maxAttempts
```

### What stands in for what

| Production thing | Demo implementation | Swap requires |
|------------------|--------------------|-----|
| S3 object store         | `./uploads/` on local disk            | New `storage` adapter behind the existing path-as-key abstraction |
| Postgres `jobs` table   | `Map<string, Job>` in `InMemoryJobStore` | Reimplement the `JobStore` interface against `pg` |
| SQS / Redis Streams     | `setImmediate` + `setTimeout` array in `InMemoryJobQueue` | Reimplement the `JobQueue` interface against AWS SDK / ioredis |
| Separate worker process | Worker started inside the API process | Move `startTranscriptionWorker(...)` into its own `worker.ts` entrypoint |
| CloudWatch DLQ alarm    | `GET /api/v1/dlq` HTTP endpoint        | Watch SQS DLQ depth metric instead |

### Concurrency

Because uploads land on disk and the queue is `setImmediate`-driven, the API
process accepts uploads as fast as multer can write them — transcription
happens off the request path. The handler in `transcriptionWorker.ts`
runs one job at a time per subscription; running multiple workers in
production is just "start more subscribers" (or in our demo, call
`startTranscriptionWorker` multiple times).

### Retry + dead-letter queue

`transcriptionWorker.ts` implements:

- **Attempts counter** stored on the job (`attempts` column).
- **Exponential backoff with jitter**: `min(base * 2^(n-1), max) + jitter`, with
  defaults `base=2s`, `max=30s`.
- **maxAttempts = 3** by default. After the third failure the job is marked
  `failed` and pushed to the in-memory DLQ.
- **Manual retry**: `POST /api/v1/jobs/:id/retry` resets `attempts=0`, error,
  and `completed_at`, then re-enqueues. Maps to an operator runbook in
  production.

### Idempotency via status transition

`JobStore.transition(id, from, to)` is the in-memory equivalent of a
conditional Postgres `UPDATE … WHERE status = $from`. The worker only takes
ownership of a job if it successfully transitions it `pending → processing`.
With multiple workers (or SQS at-least-once redelivery) this is what prevents
double-processing — and it lives in the demo code, not just the design doc.

### What's intentionally **not** here

- **No auth.** Single-tenant service; sits behind a gateway. Five-line change.
- **No persistence across restarts.** In-memory store loses jobs on restart;
  that's the whole point of swapping to Postgres for production.
- **No webhook completion notifications.** Polling is the demo path; webhook
  would be a 30-line addition (sign with HMAC, retry on non-2xx).
- **No rate limiting / quota.** Add `express-rate-limit` or do it at the gateway.

---

## Project layout

```
src/
├── index.ts                              # Express app, error middleware, wiring
├── types.ts                              # Job, JobStatus, shared shapes
├── middleware/
│   └── upload.ts                         # multer (disk, 25MB, mime allowlist)
├── services/
│   └── transcription.ts                  # Gemini client + structured-output schema
├── store/
│   └── jobStore.ts                       # JobStore interface + InMemoryJobStore
├── queue/
│   └── jobQueue.ts                       # JobQueue interface + InMemoryJobQueue + DLQ
├── worker/
│   └── transcriptionWorker.ts            # Claim → call Gemini → retry/DLQ
└── routes/
    ├── transcribe.ts                     # POST /api/v1/transcribe (sync)
    └── jobs.ts                           # POST /jobs, GET /jobs/:id, retry, DLQ
uploads/                                  # ephemeral; gitignored
```

## Scripts

| Command          | What it does                                      |
|------------------|---------------------------------------------------|
| `npm run dev`    | `tsx watch src/index.ts` — hot reload             |
| `npm run build`  | `tsc` → `dist/`                                   |
| `npm start`      | `node dist/index.js` (run after build)            |

## Environment

| Variable          | Required | Description                          |
|-------------------|----------|--------------------------------------|
| `PORT`            | no       | HTTP port (default `3000`)           |
| `GEMINI_API_KEY`  | **yes**  | Google AI Studio API key             |
