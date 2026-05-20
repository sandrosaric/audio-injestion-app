import { Router, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import { upload } from '../middleware/upload.js';
import { transcribeAudio } from '../services/transcription.js';

const router = Router();

router.post(
  '/transcribe',
  upload.single('audio'),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded. Use form-data field "audio".' });
    }

    const filePath = req.file.path;
    try {
      const result = await transcribeAudio(filePath, req.file.mimetype);
      fs.unlinkSync(filePath);
      return res.status(200).json(result);
    } catch (err) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore — file may already be gone
      }
      return next(err);
    }
  },
);

export default router;
