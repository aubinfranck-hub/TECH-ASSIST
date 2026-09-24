import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { signAuthToken } from '../middleware/auth.js';

export const technicianAuthRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * RS-08 : comptes techniciens nominatifs (plus de mot de passe partagé).
 * TA[MANQUANT][RS-08] : 2FA (TOTP) pas encore branché sur ce endpoint.
 */
technicianAuthRouter.post('/technician/login', validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body as z.infer<typeof loginSchema>;

  const { rows } = await pool.query(
    `SELECT id, username, password_hash, role, is_active FROM technicians WHERE username = $1`,
    [username],
  );
  const technician = rows[0];
  if (!technician || !technician.is_active) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const valid = await bcrypt.compare(password, technician.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = signAuthToken({ sub: technician.id, role: technician.role, username: technician.username });
  res.json({ token, technician: { id: technician.id, username: technician.username, role: technician.role } });
});
