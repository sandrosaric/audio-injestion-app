import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import transcribeRouter from './routes/transcribe.js';
import { createJobsRouter } from './routes/jobs.js';
import { InMemoryJobStore } from './store/jobStore.js';
import { InMemoryJobQueue } from './queue/jobQueue.js';
import { startTranscriptionWorker } from './worker/transcriptionWorker.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Synchronous path (kept for the simpler demo) ---
app.use('/api/v1', transcribeRouter);

// --- Async path: store + queue + worker, all in-process ---
const jobStore = new InMemoryJobStore();
const jobQueue = new InMemoryJobQueue();
startTranscriptionWorker(jobStore, jobQueue);
app.use('/api/v1', createJobsRouter(jobStore, jobQueue));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Audio transcription service listening on http://localhost:${PORT}`);
});
