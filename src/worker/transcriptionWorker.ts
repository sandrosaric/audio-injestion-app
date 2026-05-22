import fs from 'node:fs';
import type { JobStore } from '../store/jobStore.js';
import type { JobQueue } from '../queue/jobQueue.js';
import { transcribeAudio } from '../services/transcription.js';

export interface WorkerConfig {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  maxAttempts: 3,
  baseBackoffMs: 2_000,
  maxBackoffMs: 30_000,
};

export function startTranscriptionWorker(
  store: JobStore,
  queue: JobQueue,
  config: Partial<WorkerConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  queue.subscribe(async (jobId) => {
    const claimed = await store.transition(jobId, 'pending', 'processing');
    if (!claimed) {
      console.warn(`[worker] skipping ${jobId} — not in 'pending' state`);
      return;
    }

    console.log(`[worker] processing ${jobId} (attempt ${claimed.attempts + 1})`);

    try {
      const result = await transcribeAudio(claimed.audio_path, claimed.mime_type);
      await store.update(jobId, {
        status: 'completed',
        transcript: result.transcript,
        segments: result.segments,
        completed_at: new Date(),
      });
      safeUnlink(claimed.audio_path);
      console.log(`[worker] completed ${jobId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = claimed.attempts + 1;

      if (attempts < cfg.maxAttempts) {
        const backoff = computeBackoff(attempts, cfg);
        await store.update(jobId, {
          status: 'pending',
          attempts,
          error: message,
        });
        console.warn(
          `[worker] transient failure for ${jobId}: ${message} — retrying in ${backoff}ms`,
        );
        await queue.enqueue(jobId, backoff);
      } else {
        await store.update(jobId, {
          status: 'failed',
          attempts,
          error: message,
          completed_at: new Date(),
        });
        await queue.deadLetter(jobId, message);
        safeUnlink(claimed.audio_path);
        console.error(`[worker] permanent failure for ${jobId}: ${message}`);
      }
    }
  });

  console.log('[worker] transcription worker started');
}

function computeBackoff(attempt: number, cfg: WorkerConfig): number {
  const exp = Math.min(cfg.baseBackoffMs * 2 ** (attempt - 1), cfg.maxBackoffMs);
  const jitter = Math.random() * cfg.baseBackoffMs;
  return Math.floor(exp + jitter);
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // file may already be gone (e.g. retry path) — ignore
  }
}
