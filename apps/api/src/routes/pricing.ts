import { Router } from 'express';
import { pool } from '../db/pool.js';

export const pricingRouter = Router();

/** RF-41 : tarifs lus depuis la base, jamais codés en dur côté client. */
pricingRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, segment, price_fcfa, duration_minutes, description
     FROM pricing_plans WHERE active = TRUE ORDER BY sort_order ASC`,
  );
  res.json({ plans: rows });
});
