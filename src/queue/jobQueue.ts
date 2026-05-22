export type JobHandler = (jobId: string) => Promise<void>;

export interface DeadLetterEntry {
  job_id: string;
  reason: string;
  failed_at: Date;
}

export interface JobQueue {
  enqueue(jobId: string, delayMs?: number): Promise<void>;
  subscribe(handler: JobHandler): void;
  deadLetter(jobId: string, reason: string): Promise<void>;
  listDeadLetters(): Promise<DeadLetterEntry[]>;
}

export class InMemoryJobQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private readonly dlq: DeadLetterEntry[] = [];

  subscribe(handler: JobHandler): void {
    this.handler = handler;
  }

  async enqueue(jobId: string, delayMs = 0): Promise<void> {
    const fire = () => {
      if (!this.handler) {
        console.warn(`[queue] no subscriber; dropping job ${jobId}`);
        return;
      }
      this.handler(jobId).catch((err) => {
        console.error(`[queue] unhandled handler error for ${jobId}:`, err);
      });
    };
    if (delayMs > 0) setTimeout(fire, delayMs);
    else setImmediate(fire);
  }

  async deadLetter(jobId: string, reason: string): Promise<void> {
    this.dlq.push({ job_id: jobId, reason, failed_at: new Date() });
  }

  async listDeadLetters(): Promise<DeadLetterEntry[]> {
    return this.dlq.map((entry) => ({ ...entry }));
  }
}
