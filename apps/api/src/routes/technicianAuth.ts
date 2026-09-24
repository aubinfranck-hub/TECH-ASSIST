import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, signAuthToken, signPreAuthToken, verifyPreAuthToken } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from '../utils/totp.js';

export const technicianAuthRouter = Router();

// Posé directement sur chaque route sensible (pas au niveau du montage
// app.use('/api/auth', ...)) pour ne jamais partager de quota avec des
// requêtes authentifiées et fréquentes d'un autre router (voir app.ts).
// Protège contre le bruteforce (login, code TOTP) sans jamais pouvoir être
// épuisé par autre chose.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const bootstrapAdminSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  username: z.string().min(3).max(60),
  password: z.string().min(8).max(200),
});

/**
 * Crée le tout premier compte admin d'un déploiement — uniquement tant
 * qu'aucun technicien n'existe encore. S'éteint définitivement (409) dès
 * qu'un compte existe : pas de porte dérobée permanente. Évite de dépendre
 * d'un accès direct à la base ou à un shell sur l'hébergeur pour amorcer une
 * instance fraîchement déployée.
 */
technicianAuthRouter.post(
  '/technician/bootstrap-admin',
  authLimiter,
  validateBody(bootstrapAdminSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof bootstrapAdminSchema>;
    const passwordHash = await bcrypt.hash(body.password, 12);

    const { rows } = await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role)
       SELECT $1, $2, $3, $4, 'admin'
       WHERE NOT EXISTS (SELECT 1 FROM technicians)
       RETURNING id, username, role`,
      [body.fullName, body.phone, body.username, passwordHash],
    );

    if (rows.length === 0) {
      return res.status(409).json({ error: 'Un compte existe déjà — ce point d\'amorçage est désactivé' });
    }

    await logAudit(pool, { actorType: 'system', actorId: rows[0].id, action: 'auth.bootstrap_admin_created' });
    res.status(201).json({ technician: rows[0] });
  },
);

const bootstrapIdentitySchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  username: z.string().min(3).max(60),
  password: z.string().min(8).max(200),
});

const bootstrapTeamSchema = z.object({
  admin: bootstrapIdentitySchema,
  technician: bootstrapIdentitySchema,
});

/**
 * Amorçage combiné : crée le premier compte admin ET un premier compte
 * technicien en un seul appel, dans la même transaction, sous la même garde
 * qu'un seul compte existant désactive définitivement (409). Utile pour
 * démarrer une instance fraîchement déployée sans accès direct à la base.
 */
technicianAuthRouter.post(
  '/technician/bootstrap-team',
  authLimiter,
  validateBody(bootstrapTeamSchema),
  async (req, res) => {
    const { admin, technician } = req.body as z.infer<typeof bootstrapTeamSchema>;

    if (admin.username === technician.username) {
      return res.status(400).json({ error: 'Les deux comptes doivent avoir des identifiants différents' });
    }

    const [adminHash, technicianHash] = await Promise.all([
      bcrypt.hash(admin.password, 12),
      bcrypt.hash(technician.password, 12),
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const adminResult = await client.query(
        `INSERT INTO technicians (full_name, phone, username, password_hash, role)
         SELECT $1, $2, $3, $4, 'admin'
         WHERE NOT EXISTS (SELECT 1 FROM technicians)
         RETURNING id, username, role`,
        [admin.fullName, admin.phone, admin.username, adminHash],
      );

      if (adminResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Un compte existe déjà — ce point d\'amorçage est désactivé' });
      }

      const technicianResult = await client.query(
        `INSERT INTO technicians (full_name, phone, username, password_hash, role)
         VALUES ($1, $2, $3, $4, 'technician')
         RETURNING id, username, role`,
        [technician.fullName, technician.phone, technician.username, technicianHash],
      );

      await client.query('COMMIT');

      await logAudit(pool, {
        actorType: 'system',
        actorId: adminResult.rows[0].id,
        action: 'auth.bootstrap_team_created',
        details: { technicianId: technicianResult.rows[0].id },
      });

      res.status(201).json({ admin: adminResult.rows[0], technician: technicianResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** RS-08 : comptes techniciens nominatifs. Si la 2FA est activée, un second appel est requis. */
technicianAuthRouter.post('/technician/login', authLimiter, validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body as z.infer<typeof loginSchema>;

  const { rows } = await pool.query(
    `SELECT id, username, password_hash, role, is_active, totp_enabled FROM technicians WHERE username = $1`,
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

  if (technician.totp_enabled) {
    return res.json({ requiresTotp: true, preAuthToken: signPreAuthToken(technician.id) });
  }

  const token = signAuthToken({ sub: technician.id, role: technician.role, username: technician.username });
  res.json({ token, technician: { id: technician.id, username: technician.username, role: technician.role } });
});

const totpLoginSchema = z.object({
  preAuthToken: z.string().min(1),
  code: z.string().length(6),
});

/** RS-08 : second facteur — complète la connexion après /technician/login. */
technicianAuthRouter.post('/technician/login/totp', authLimiter, validateBody(totpLoginSchema), async (req, res) => {
  const { preAuthToken, code } = req.body as z.infer<typeof totpLoginSchema>;

  let technicianId: string;
  try {
    technicianId = verifyPreAuthToken(preAuthToken).sub;
  } catch {
    return res.status(401).json({ error: 'Jeton de connexion invalide ou expiré, reconnectez-vous' });
  }

  const { rows } = await pool.query(
    `SELECT id, username, role, is_active, totp_enabled, totp_secret FROM technicians WHERE id = $1`,
    [technicianId],
  );
  const technician = rows[0];
  if (!technician || !technician.is_active || !technician.totp_enabled || !technician.totp_secret) {
    return res.status(401).json({ error: 'Compte introuvable ou 2FA non active' });
  }

  if (!verifyTotpCode(technician.totp_secret, code)) {
    await logAudit(pool, { actorType: 'technician', actorId: technician.id, action: 'auth.totp_failed' });
    return res.status(401).json({ error: 'Code incorrect' });
  }

  const token = signAuthToken({ sub: technician.id, role: technician.role, username: technician.username });
  res.json({ token, technician: { id: technician.id, username: technician.username, role: technician.role } });
});

/** RS-08 : démarrage de l'activation — génère un secret en attente de confirmation. */
technicianAuthRouter.post('/technician/2fa/setup', requireAuth('technician', 'admin'), async (req, res) => {
  const secret = generateTotpSecret();
  await pool.query('UPDATE technicians SET totp_pending_secret = $2 WHERE id = $1', [req.auth!.sub, secret]);
  res.json({ secret, otpauthUri: buildOtpauthUri(secret, req.auth!.username) });
});

const totpCodeSchema = z.object({ code: z.string().length(6) });

/** RS-08 : confirme l'activation avec un code généré à partir du secret en attente. */
technicianAuthRouter.post(
  '/technician/2fa/enable',
  authLimiter,
  requireAuth('technician', 'admin'),
  validateBody(totpCodeSchema),
  async (req, res) => {
    const { rows } = await pool.query('SELECT totp_pending_secret FROM technicians WHERE id = $1', [req.auth!.sub]);
    const pendingSecret = rows[0]?.totp_pending_secret as string | null;
    if (!pendingSecret) {
      return res.status(409).json({ error: 'Aucune activation en cours — relancez /2fa/setup' });
    }
    if (!verifyTotpCode(pendingSecret, req.body.code)) {
      return res.status(401).json({ error: 'Code incorrect' });
    }

    await pool.query(
      `UPDATE technicians SET totp_secret = $2, totp_enabled = TRUE, totp_pending_secret = NULL WHERE id = $1`,
      [req.auth!.sub, pendingSecret],
    );
    await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'auth.totp_enabled' });
    res.json({ enabled: true });
  },
);

/** RS-08 : désactivation par le titulaire du compte, avec un dernier code valide. */
technicianAuthRouter.post(
  '/technician/2fa/disable',
  authLimiter,
  requireAuth('technician', 'admin'),
  validateBody(totpCodeSchema),
  async (req, res) => {
    const { rows } = await pool.query('SELECT totp_secret, totp_enabled FROM technicians WHERE id = $1', [
      req.auth!.sub,
    ]);
    const technician = rows[0];
    if (!technician?.totp_enabled || !verifyTotpCode(technician.totp_secret, req.body.code)) {
      return res.status(401).json({ error: 'Code incorrect' });
    }

    await pool.query(
      `UPDATE technicians SET totp_secret = NULL, totp_enabled = FALSE, totp_pending_secret = NULL WHERE id = $1`,
      [req.auth!.sub],
    );
    await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'auth.totp_disabled' });
    res.json({ enabled: false });
  },
);
