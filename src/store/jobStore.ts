import crypto from 'node:crypto';
import type { CreateJobInput, Job, JobPatch, JobStatus } from '../types.js';

export interface JobStore {
  create(input: CreateJobInput): Promise<Job>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: JobPatch): Promise<Job>;
  /**
   * Atomically move a job from `from` status to `to`. Returns the updated job
   * if the transition succeeded, or `null` if the job was not in `from` (e.g.
   * another worker already picked it up). In production this maps to a
   * conditional UPDATE in Postgres — see README.
   */
  transition(id: string, from: JobStatus, to: JobStatus): Promise<Job | null>;
  list(limit?: number): Promise<Job[]>;
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();

  async create(input: CreateJobInput): Promise<Job> {
    const now = new Date();
    const job: Job = {
      id: crypto.randomUUID(),
      status: 'pending',
      audio_path: input.audio_path,
      mime_type: input.mime_type,
      transcript: null,
      segments: null,
      attempts: 0,
      error: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async get(id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  async update(id: string, patch: JobPatch): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    const updated: Job = { ...job, ...patch, updated_at: new Date() };
    this.jobs.set(id, updated);
    return { ...updated };
  }

  async transition(id: string, from: JobStatus, to: JobStatus): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== from) return null;
    const updated: Job = { ...job, status: to, updated_at: new Date() };
    this.jobs.set(id, updated);
    return { ...updated };
  }

  async list(limit = 50): Promise<Job[]> {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)
      .map((j) => ({ ...j }));
  }
}
