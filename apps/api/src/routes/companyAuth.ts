import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { signCompanyToken } from '../middleware/companyAuth.js';
import { validateBody } from '../middleware/validate.js';

export const companyAuthRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** RP-01/RP-08 : connexion à l'espace entreprise (compte admin ou employé). */
companyAuthRouter.post('/company/login', validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body as z.infer<typeof loginSchema>;

  const { rows } = await pool.query(
    `SELECT id, company_id, username, password_hash, role, is_active FROM company_users WHERE username = $1`,
    [username],
  );
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = signCompanyToken({ sub: user.id, companyId: user.company_id, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, companyId: user.company_id } });
});
