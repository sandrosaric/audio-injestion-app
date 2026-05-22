import type { TranscriptSegment } from './services/transcription.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  audio_path: string;
  mime_type: string;
  transcript: string | null;
  segments: TranscriptSegment[] | null;
  attempts: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface CreateJobInput {
  audio_path: string;
  mime_type: string;
}

export type JobPatch = Partial<
  Pick<
    Job,
    'status' | 'transcript' | 'segments' | 'attempts' | 'error' | 'completed_at'
  >
>;
