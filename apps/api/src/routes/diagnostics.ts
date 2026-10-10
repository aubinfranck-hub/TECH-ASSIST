import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { runDiagnostic } from '../diagnostics/index.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';

export const diagnosticsRouter = Router();

// Posé directement sur la route (pas au niveau du montage app.use('/api', ...))
// : ce préfixe est partagé par d'autres routers, donc un limiteur monté là-bas
// s'exécuterait pour toute requête /api/*, pas seulement celles-ci (voir app.ts).
const diagnosticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const diagnosticSchema = z.object({
  platform: z.enum(['windows', 'android']),
  problemDescription: z.string().min(5).max(2000),
  answers: z.record(z.string().max(500)).default({}),
});

/**
 * RF-01/RF-05 : le diagnostic IA n'est révélé qu'après paiement de la commande
 * 'diagnostic_express' (ou de toute formule qui l'inclut) — pas de contournement gratuit.
 */
diagnosticsRouter.post(
  '/orders/:orderId/diagnostic',
  diagnosticLimiter,
  validateBody(diagnosticSchema),
  async (req, res) => {
    const { orderId } = req.params;

    const orderResult = await pool.query(
      `SELECT id, status FROM orders WHERE id = $1`,
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.status !== 'paid') {
      return res.status(402).json({ error: 'Paiement requis avant le diagnostic' });
    }

    const existing = await pool.query('SELECT id FROM diagnostics WHERE order_id = $1', [orderId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un diagnostic existe déjà pour cette commande' });
    }

    const input = req.body as z.infer<typeof diagnosticSchema>;
    const result = await runDiagnostic(input);

    const { rows } = await pool.query(
      `INSERT INTO diagnostics (order_id, platform, answers, ai_result, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, ai_result, source, confidence, created_at`,
      [orderId, input.platform, JSON.stringify(input.answers), JSON.stringify(result), result.source, result.confidence],
    );

    await logAudit(pool, {
      actorType: 'system',
      orderId,
      action: 'diagnostic.completed',
      details: { source: result.source },
    });

    res.status(201).json({ diagnostic: rows[0] });
  },
);
