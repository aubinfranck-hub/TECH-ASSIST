import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAppInstall } from '../middleware/appAuth.js';
import { validateBody } from '../middleware/validate.js';
import { synthesize, ttsHealth, TtsError, TTS_MAX_CHARS } from '../services/tts.js';

/**
 * Lecture à voix haute des réponses de l'IA (voix neuronale Google). Deux entrées : le site (le client prouve sa session par son
 * code secret) et l'application (installation authentifiée). Un plafond protège le coût ; sans clé, 503 propre : l'interface
 * retombe alors sur la lecture du texte.
 */
export const ttsRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const webSchema = z.object({
  sessionCode: z.string().regex(/^\d{9}$/),
  text: z.string().trim().min(1).max(4000),
});
const appSchema = z.object({ text: z.string().trim().min(1).max(4000) });

async function speak(text: string, res: import('express').Response) {
  try {
    const out = await synthesize(text);
    res.json({ audio: out.audioBase64, mime: out.mime, voice: out.voice, maxChars: TTS_MAX_CHARS });
  } catch (err) {
    if (err instanceof TtsError) {
      if (err.code !== 'not_configured') console.error(`[tts] ${err.code} : ${err.message}`);
      res.status(503).json({ code: `tts_${err.code}`, error: "La lecture à voix haute n'est pas disponible pour le moment." });
      return;
    }
    throw err;
  }
}

/** Le site demande si la voix est disponible (pour n'afficher le bouton que s'il peut fonctionner). */
ttsRouter.get('/tts/status', async (_req, res) => {
  res.json(await ttsHealth());
});

ttsRouter.post('/sessions/:id/tts', limiter, validateBody(webSchema), async (req, res) => {
  const body = req.body as z.infer<typeof webSchema>;
  const { rows } = await pool.query(`SELECT 1 FROM sessions WHERE id = $1 AND session_code = $2 AND status IN ('created','waiting_technician','active')`, [req.params.id, body.sessionCode]);
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });
  await speak(body.text, res);
});

ttsRouter.post('/app/tts', limiter, requireAppInstall, validateBody(appSchema), async (req, res) => {
  await speak((req.body as z.infer<typeof appSchema>).text, res);
});
