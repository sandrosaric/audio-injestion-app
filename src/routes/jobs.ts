import { Router, Request, Response, NextFunction } from 'express';
import { upload } from '../middleware/upload.js';
import type { JobStore } from '../store/jobStore.js';
import type { JobQueue } from '../queue/jobQueue.js';

export function createJobsRouter(store: JobStore, queue: JobQueue): Router {
  const router = Router();

  // POST /api/v1/jobs — accept upload, create job, enqueue, return 202 + job_id
  router.post(
    '/jobs',
    upload.single('audio'),
    async (req: Request, res: Response, next: NextFunction) => {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: 'No audio file uploaded. Use form-data field "audio".' });
      }
      try {
        const job = await store.create({
          audio_path: req.file.path,
          mime_type: req.file.mimetype,
        });
        await queue.enqueue(job.id);
        return res.status(202).json({
          job_id: job.id,
          status: job.status,
          status_url: `/api/v1/jobs/${job.id}`,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /api/v1/jobs — list jobs (newest first)
  router.get('/jobs', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const jobs = await store.list(50);
      return res.json({
        jobs: jobs.map((j) => ({
          id: j.id,
          status: j.status,
          attempts: j.attempts,
          created_at: j.created_at,
          completed_at: j.completed_at,
        })),
      });
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/v1/jobs/:id — status of a single job
  router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const job = await store.get(id);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      return res.json({
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
        completed_at: job.completed_at,
      });
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/v1/jobs/:id/transcript — full result (404 until completed)
  router.get(
    '/jobs/:id/transcript',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id);
        const job = await store.get(id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'completed') {
          return res.status(409).json({
            error: `Job is ${job.status}; transcript not available yet`,
            status: job.status,
          });
        }
        return res.json({
          transcript: job.transcript,
          segments: job.segments,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  // POST /api/v1/jobs/:id/retry — re-enqueue a failed job
  router.post(
    '/jobs/:id/retry',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id);
        const job = await store.get(id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.status !== 'failed') {
          return res.status(409).json({
            error: `Only 'failed' jobs can be retried; this job is '${job.status}'`,
          });
        }
        const reset = await store.update(job.id, {
          status: 'pending',
          attempts: 0,
          error: null,
          completed_at: null,
        });
        await queue.enqueue(reset.id);
        return res.status(202).json({ job_id: reset.id, status: reset.status });
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /api/v1/dlq — inspect the dead-letter queue
  router.get('/dlq', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await queue.listDeadLetters();
      return res.json({ entries });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
