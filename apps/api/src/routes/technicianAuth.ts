import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { DEVICE_TOKEN_DAYS, requireAuth, signAuthToken, signDeviceToken, signPreAuthToken, verifyPreAuthToken } from '../middleware/auth.js';
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
    `SELECT id, username, password_hash, role, is_active, approval_status, totp_enabled FROM technicians WHERE username = $1`,
    [username],
  );
  const technician = rows[0];
  if (!technician) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const valid = await bcrypt.compare(password, technician.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  if (!technician.is_active) {
    // Le mot de passe est bon : on peut dire à un partenaire où en est sa demande (jamais avant, pour ne rien révéler).
    if (technician.role === 'partner' && technician.approval_status === 'pending') {
      return res.status(403).json({ code: 'pending_approval', error: "Votre demande est en cours de validation. Vous pourrez vous connecter dès qu'elle sera acceptée." });
    }
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

const deviceSchema = z.object({
  label: z.string().trim().max(60).default(''),
  platform: z.enum(['windows', 'android', 'web']),
});

const MAX_ACTIVE_DEVICES = 10;

/**
 * Application technicien (Windows, Android) : après la connexion normale (mot de passe + 2FA), l'application demande un jeton d'APPAREIL
 * valable 30 jours pour rester connectée en arrière-plan et recevoir les alertes. Il est lié à cet appareil, révocable, et revérifié en base.
 * Il ne peut pas en fabriquer un autre : seule une vraie connexion le peut.
 */
technicianAuthRouter.post('/technician/device-token', authLimiter, requireAuth('technician', 'admin'), validateBody(deviceSchema), async (req, res) => {
  if (req.auth!.device) return res.status(403).json({ error: 'Reconnectez-vous avec votre mot de passe pour ajouter un appareil.' });
  const body = req.body as z.infer<typeof deviceSchema>;
  const { rows } = await pool.query(`INSERT INTO technician_devices (technician_id, label, platform) VALUES ($1, $2, $3) RETURNING id`, [req.auth!.sub, body.label, body.platform]);
  const deviceId = rows[0].id as string;
  // Au plus 10 appareils actifs : les plus anciens sont révoqués.
  await pool.query(
    `UPDATE technician_devices SET revoked_at = now()
     WHERE technician_id = $1 AND revoked_at IS NULL AND id NOT IN (
       SELECT id FROM technician_devices WHERE technician_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT $2)`,
    [req.auth!.sub, MAX_ACTIVE_DEVICES],
  );
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'auth.device_added', details: { platform: body.platform, label: body.label } });
  res.status(201).json({
    deviceId,
    deviceToken: signDeviceToken({ sub: req.auth!.sub, role: req.auth!.role, username: req.auth!.username }, deviceId),
    expiresInDays: DEVICE_TOKEN_DAYS,
  });
});

technicianAuthRouter.get('/technician/devices', requireAuth('technician', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, label, platform, created_at, last_seen_at, revoked_at FROM technician_devices WHERE technician_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [req.auth!.sub],
  );
  res.json({ devices: rows, current: req.auth!.device ?? null });
});

technicianAuthRouter.delete('/technician/devices/:id', requireAuth('technician', 'admin'), async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id!)) return res.status(404).json({ error: 'Appareil introuvable' });
  const { rowCount } = await pool.query(`UPDATE technician_devices SET revoked_at = now() WHERE id = $1 AND technician_id = $2 AND revoked_at IS NULL`, [req.params.id, req.auth!.sub]);
  if (!rowCount) return res.status(404).json({ error: 'Appareil introuvable' });
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'auth.device_revoked' });
  res.json({ revoked: true });
});

/** RS-08 : démarrage de l'activation — génère un secret en attente de confirmation. */
technicianAuthRouter.post('/technician/2fa/setup', requireAuth('technician', 'admin', 'partner'), async (req, res) => {
  const secret = generateTotpSecret();
  await pool.query('UPDATE technicians SET totp_pending_secret = $2 WHERE id = $1', [req.auth!.sub, secret]);
  res.json({ secret, otpauthUri: buildOtpauthUri(secret, req.auth!.username) });
});

const totpCodeSchema = z.object({ code: z.string().length(6) });

/** RS-08 : confirme l'activation avec un code généré à partir du secret en attente. */
technicianAuthRouter.post(
  '/technician/2fa/enable',
  authLimiter,
  requireAuth('technician', 'admin', 'partner'),
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
  requireAuth('technician', 'admin', 'partner'),
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
