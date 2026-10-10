import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';

export const leadsRouter = Router();

// Posé directement sur chaque route (pas au niveau du montage app.use('/api', ...))
// : ce préfixe est partagé par d'autres routers, donc un limiteur monté là-bas
// s'exécuterait pour toute requête /api/*, pas seulement celles-ci (voir app.ts).
const leadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const phoneSchema = z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide');

/** RT-01 : candidature technicien indépendant. */
const technicianApplicationSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: phoneSchema,
  idDocumentRef: z.string().max(200).optional(),
  skills: z.string().max(1000).optional(),
});

leadsRouter.post('/technicians/apply', leadsLimiter, validateBody(technicianApplicationSchema), async (req, res) => {
  const { fullName, phone, idDocumentRef, skills } = req.body as z.infer<typeof technicianApplicationSchema>;
  const { rows } = await pool.query(
    `INSERT INTO technician_applications (full_name, phone, id_document_ref, skills)
     VALUES ($1, $2, $3, $4) RETURNING id, status, created_at`,
    [fullName, phone, idDocumentRef ?? null, skills ?? null],
  );
  res.status(201).json({ application: rows[0] });
});

/** RP-01 : demande de contact PME (abonnement). */
const pmeRequestSchema = z.object({
  companyName: z.string().min(2).max(200),
  contactName: z.string().min(2).max(120),
  phone: phoneSchema,
  email: z.string().email().optional(),
  computersCount: z.number().int().positive().max(100000).optional(),
  message: z.string().max(2000).optional(),
});

leadsRouter.post('/pme/requests', leadsLimiter, validateBody(pmeRequestSchema), async (req, res) => {
  const body = req.body as z.infer<typeof pmeRequestSchema>;
  const { rows } = await pool.query(
    `INSERT INTO pme_requests (company_name, contact_name, phone, email, computers_count, message)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, created_at`,
    [body.companyName, body.contactName, body.phone, body.email ?? null, body.computersCount ?? null, body.message ?? null],
  );
  res.status(201).json({ request: rows[0] });
});

/** RV-01 : demande d'intervention sur place. */
const visitRequestSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: phoneSchema,
  address: z.string().min(5).max(300),
  zone: z.string().max(100).optional(),
  description: z.string().min(5).max(2000),
});

leadsRouter.post('/visits/requests', leadsLimiter, validateBody(visitRequestSchema), async (req, res) => {
  const body = req.body as z.infer<typeof visitRequestSchema>;
  const { rows } = await pool.query(
    `INSERT INTO visit_requests (full_name, phone, address, zone, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at`,
    [body.fullName, body.phone, body.address, body.zone ?? null, body.description],
  );
  res.status(201).json({ request: rows[0] });
});
