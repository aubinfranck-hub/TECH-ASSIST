import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { isDisposableEmail, normalizeEmail } from '../utils/email.js';
import { MailNotConfiguredError, sendMail } from '../utils/mailer.js';

export const emailVerificationRouter = Router();

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15_MIN = 5;

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

export const emailField = z.string().trim().toLowerCase().email('Adresse email invalide').max(254);

export type ConsumeCodeResult = 'ok' | 'invalid' | 'too_many_attempts';

/**
 * Vérifie le code reçu par email et le consomme (usage unique). Appelé à
 * l'inscription de l'application : pas de jeton intermédiaire à faire circuler.
 */
export async function consumeEmailCode(email: string, code: string): Promise<ConsumeCodeResult> {
  // L'essai est compté AVANT la comparaison, en une seule requête atomique : des essais parallèles
  // ne peuvent pas dépasser MAX_ATTEMPTS (chacun réserve son numéro d'essai).
  const claimed = await pool.query(
    `UPDATE email_verifications SET attempts = attempts + 1
     WHERE id = (
       SELECT id FROM email_verifications
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1
     ) AND attempts < $2
     RETURNING id, code_hash`,
    [email, MAX_ATTEMPTS],
  );
  const row = claimed.rows[0] as { id: string; code_hash: string } | undefined;
  if (!row) {
    const live = await pool.query(
      'SELECT 1 FROM email_verifications WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() LIMIT 1',
      [email],
    );
    return live.rows.length > 0 ? 'too_many_attempts' : 'invalid';
  }

  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(hashCode(email, code), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';

  // Le « WHERE consumed_at IS NULL » garantit l'usage unique même en cas de deux confirmations simultanées.
  const consumed = await pool.query(
    'UPDATE email_verifications SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
    [row.id],
  );
  return consumed.rows.length === 1 ? 'ok' : 'invalid';
}

const requestSchema = z.object({ email: emailField });

/** L'application demande l'envoi d'un code à 6 chiffres à l'adresse saisie. */
emailVerificationRouter.post('/app/email-code', limiter, validateBody(requestSchema), async (req, res) => {
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
    return res.status(429).json({ error: "Un code vient d'être envoyé. Patientez une minute avant d'en demander un autre." });
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
    console.error(err instanceof MailNotConfiguredError ? err.message : "Échec de l'envoi du code par email", err);
    return res.status(503).json({ error: "L'envoi d'email est indisponible pour le moment. Réessayez plus tard." });
  }

  await logAudit(pool, { actorType: 'client', actorId: email, action: 'app.email_code_requested' });
  res.json({ sent: true });
});
