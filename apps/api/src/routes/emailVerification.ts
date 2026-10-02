import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { isDisposableEmail, normalizeEmail } from '../utils/email.js';
import { logAudit } from '../utils/audit.js';
import { MailNotConfiguredError, sendMail } from '../utils/mailer.js';

export const emailVerificationRouter = Router();

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15_MIN = 5;
const TOKEN_TTL = '30m';
const TOKEN_AUDIENCE = 'email-verification';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET manquant');
  return value;
}

function hashCode(email: string, code: string): string {
  return createHmac('sha256', secret()).update(`${email}:${code}`).digest('hex');
}

/** Pause minimale entre deux envois au même email (désactivable en test via EMAIL_CODE_COOLDOWN_SECONDS=0). */
function cooldownSeconds(): number {
  const value = Number(process.env.EMAIL_CODE_COOLDOWN_SECONDS ?? 60);
  return Number.isFinite(value) ? value : 60;
}

/** Jeton prouvant qu'une adresse a été vérifiée récemment ; inutilisable comme jeton technicien. */
export function signEmailVerificationToken(email: string): string {
  return jwt.sign({ kind: 'email_verified', email }, secret(), { expiresIn: TOKEN_TTL, audience: TOKEN_AUDIENCE });
}

/** Retourne l'adresse vérifiée contenue dans le jeton, ou null s'il est invalide/expiré. */
export function parseEmailVerificationToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, secret(), { audience: TOKEN_AUDIENCE }) as { kind?: string; email?: string };
    return payload.kind === 'email_verified' && payload.email ? payload.email : null;
  } catch {
    return null;
  }
}

const emailField = z.string().trim().toLowerCase().email('Adresse email invalide').max(254);

const requestSchema = z.object({ email: emailField });

/** Envoie un code à 6 chiffres à l'adresse indiquée. */
emailVerificationRouter.post('/email-verification/request', limiter, validateBody(requestSchema), async (req, res) => {
  const email = normalizeEmail((req.body as z.infer<typeof requestSchema>).email);
  if (isDisposableEmail(email)) {
    return res.status(400).json({ error: 'Utilisez une adresse email personnelle ou professionnelle.' });
  }

  const recent = await pool.query(
    `SELECT count(*)::int AS total, max(created_at) AS last
     FROM email_verifications WHERE email = $1 AND created_at > now() - interval '15 minutes'`,
    [email],
  );
  const { total, last } = recent.rows[0] as { total: number; last: Date | null };
  if (total >= MAX_CODES_PER_15_MIN) {
    return res.status(429).json({ error: 'Trop de demandes de code. Réessayez dans quelques minutes.' });
  }
  if (last && Date.now() - new Date(last).getTime() < cooldownSeconds() * 1000) {
    return res.status(429).json({ error: 'Un code vient d\'être envoyé. Patientez une minute avant d\'en demander un autre.' });
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const inserted = await pool.query(
    `INSERT INTO email_verifications (email, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '${CODE_TTL_MINUTES} minutes') RETURNING id`,
    [email, hashCode(email, code)],
  );

  try {
    await sendMail({
      to: email,
      subject: `Votre code Tech Assist : ${code}`,
      text:
        `Votre code de vérification Tech Assist est : ${code}\n\n` +
        `Il expire dans ${CODE_TTL_MINUTES} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    });
  } catch (err) {
    // Rien n'a été envoyé : on retire le code pour ne pas bloquer l'utilisateur par le plafond horaire.
    await pool.query('DELETE FROM email_verifications WHERE id = $1', [inserted.rows[0].id]);
    if (err instanceof MailNotConfiguredError) {
      console.error(err.message);
    } else {
      console.error('Échec de l\'envoi du code par email', err);
    }
    return res.status(503).json({ error: 'L\'envoi d\'email est indisponible pour le moment. Réessayez plus tard.' });
  }

  await logAudit(pool, { actorType: 'client', actorId: email, action: 'email_verification.requested' });
  res.json({ sent: true });
});

const confirmSchema = z.object({
  email: emailField,
  code: z.string().regex(/^[0-9]{6}$/, 'Le code comporte 6 chiffres'),
});

/** Vérifie le code ; en cas de succès, renvoie un jeton valable 30 minutes. */
emailVerificationRouter.post('/email-verification/confirm', limiter, validateBody(confirmSchema), async (req, res) => {
  const body = req.body as z.infer<typeof confirmSchema>;
  const email = normalizeEmail(body.email);

  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts FROM email_verifications
     WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = rows[0] as { id: string; code_hash: string; attempts: number } | undefined;
  if (!row) return res.status(400).json({ error: 'Code invalide ou expiré. Demandez un nouveau code.' });
  if (row.attempts >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Trop d\'essais. Demandez un nouveau code.' });
  }

  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(email, body.code), 'hex');
  const ok = expected.length === given.length && timingSafeEqual(expected, given);
  if (!ok) {
    await pool.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return res.status(400).json({ error: 'Code incorrect.' });
  }

  await pool.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [row.id]);
  await logAudit(pool, { actorType: 'client', actorId: email, action: 'email_verification.confirmed' });
  res.json({ verificationToken: signEmailVerificationToken(email), email });
});
