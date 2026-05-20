import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';

export interface TranscriptSegment {
  start_time: string;
  end_time: string;
  text: string;
}

export interface TranscriptionResult {
  transcript: string;
  segments: TranscriptSegment[];
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
}

const ai = new GoogleGenAI({ apiKey });

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start_time: { type: Type.STRING },
          end_time: { type: Type.STRING },
          text: { type: Type.STRING },
        },
        required: ['start_time', 'end_time', 'text'],
      },
    },
  },
  required: ['transcript', 'segments'],
};

export async function transcribeAudio(
  filePath: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  const fileBuffer = fs.readFileSync(filePath);
  const base64Audio = fileBuffer.toString('base64');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Transcribe this audio. Return the full transcript and a list of timestamped segments. Use MM:SS or HH:MM:SS format for start_time and end_time.',
          },
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  const parsed = JSON.parse(text) as TranscriptionResult;
  return parsed;
}
