import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { generateSessionCode, SESSION_CODE_TTL_MINUTES } from '../utils/sessionCode.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { alertInBackground } from '../notify/technicianAlerts.js';
import { logAudit, type Db } from '../utils/audit.js';
import { freeLaunch, humanIncludedFor, upgradeOffer } from '../utils/offers.js';
import { HUMAN_MIN_MINUTES, expireOverdueSessions } from '../utils/sessionClock.js';
import { progressView, STALE_PROGRESS_SECONDS } from '../utils/taskProgress.js';
import { creditEarningSafely } from '../partners/earnings.js';
import { closeViewerOrderIfUnpaid, settleViewerSession } from '../partners/viewer.js';
import { AssistantUnavailableError, MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS, MAX_TURN_CHARS, askOfficeAssistant } from '../assistant/officeAssistant.js';
import { generateProcedure } from '../learning/orchestrator.js';
import { tokenize } from '../learning/match.js';
import { aiBudget, failedAlternatives, findForQuery, insertCandidate, markServed, recordCall, recordGap, recordOutcome } from '../learning/store.js';
import rateLimit from 'express-rate-limit';

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  platform: z.enum(['web', 'windows', 'android']),
});

export type SessionMode = 'ia' | 'humain' | 'hybride';

export type CreateSessionResult =
  | { ok: true; session: { id: string; session_code: string; status: string; code_expires_at: Date; duration_minutes: number; mode: SessionMode; human_included: boolean } }
  | { ok: false; status: number; error: string; code?: 'human_not_included' | 'ai_unavailable' };

/**
 * RS-03 : code de session à usage unique, généré côté serveur, expire en 10 min
 * si non utilisé, toujours lié à une commande payée. Partagé entre la commande
 * classique (particuliers) et les demandes d'aide PME (RP-03), qui passent
 * toutes deux par une commande — à 0 FCFA et déjà payée pour les PME couvertes
 * par un abonnement.
 */
export async function createSessionForOrder(
  orderId: string,
  platform: 'web' | 'windows' | 'android',
  requestedMode: SessionMode = 'humain',
  /** Client de transaction : la session est alors créée ou annulée avec le reste (ex. offerte + commande). */
  db: Db = pool,
): Promise<CreateSessionResult> {
  // L'agent IA n'est appliqué que s'il est réellement activé (AI_AGENT_ENABLED) ;
  // sinon la demande est servie par un technicien (file d'attente classique).
  const mode: SessionMode = (requestedMode === 'ia' || requestedMode === 'hybride') && process.env.AI_AGENT_ENABLED === 'true' ? 'ia' : 'humain';
  const orderResult = await db.query(
    `SELECT o.id, o.status, p.duration_minutes, p.metadata
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order) return { ok: false, status: 404, error: 'Commande introuvable' };
  if (order.status !== 'paid') {
    return { ok: false, status: 402, error: 'Paiement requis avant de démarrer une session' };
  }
  if (!order.duration_minutes) {
    return { ok: false, status: 400, error: 'Cette formule ne donne pas droit à une session assistée' };
  }

  // Offre « IA seule » : jamais de technicien sans complément payé. Si l'assistance devait être servie par un humain
  // (technicien demandé, ou agent IA désactivé), elle est refusée ici et la commande payée reste utilisable.
  const humanIncluded = humanIncludedFor(order.metadata);
  if ((mode === 'humain' || requestedMode === 'hybride') && !humanIncluded) {
    return requestedMode === 'humain' || requestedMode === 'hybride'
      ? { ok: false, status: 402, code: 'human_not_included', error: "Votre offre « Assistance IA » ne comprend pas de technicien. Passez à « IA + technicien » pour qu'il prenne le relais." }
      : { ok: false, status: 503, code: 'ai_unavailable', error: "L'agent IA n'est pas disponible pour le moment. Votre forfait n'est pas consommé : réessayez dans un instant." };
  }
  // Le temps du forfait court dès le début d'une assistance IA ; pour un technicien, dès sa prise en charge.
  // Pendant le lancement gratuit, aucune limite de durée n'est appliquée.
  const clockNow = mode === 'ia' && !freeLaunch();

  let code = generateSessionCode();
  // Garantit l'unicité même en cas de collision improbable.
  for (let attempts = 0; attempts < 5; attempts++) {
    const clash = await db.query('SELECT 1 FROM sessions WHERE session_code = $1', [code]);
    if (clash.rows.length === 0) break;
    code = generateSessionCode();
  }

  const { rows } = await db.query(
    `INSERT INTO sessions (order_id, session_code, platform, code_expires_at, duration_minutes, mode, requested_mode, human_included, started_at, ends_at)
     VALUES ($1, $2, $3, now() + interval '${SESSION_CODE_TTL_MINUTES} minutes', $4, $5, $6, $7,
             CASE WHEN $8::boolean THEN now() END, CASE WHEN $8::boolean THEN now() + make_interval(mins => $4::int) END)
     RETURNING id, session_code, status, code_expires_at, duration_minutes, mode, human_included`,
    [orderId, code, platform, order.duration_minutes, mode, requestedMode, humanIncluded, clockNow],
  );
  const session = rows[0];

  await logAudit(db, {
    actorType: 'system',
    orderId,
    sessionId: session.id,
    action: 'session.created',
  });

  return { ok: true, session };
}

sessionsRouter.post(
  '/orders/:orderId/session',
  validateBody(createSessionSchema),
  async (req, res) => {
    // Les commandes créées par l'application (offerte, abonné) ont leur session créée par l'application,
    // une seule fois : cette route publique ne doit pas pouvoir en fabriquer d'autres.
    const owner = await pool.query('SELECT app_install_id FROM orders WHERE id = $1', [req.params.orderId]);
    if (owner.rows[0]?.app_install_id) {
      return res.status(403).json({ error: "Cette assistance se démarre depuis l'application Tech Assist." });
    }
    const result = await createSessionForOrder(req.params.orderId, req.body.platform);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ session: result.session });
  },
);

const publicAssistanceSchema = z.object({
  clientPhone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  clientName: z.string().max(120).optional(),
  problem: z.string().trim().max(1000).optional(),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
  requestedMode: z.enum(['ia', 'humain', 'hybride']).default('ia'),
});

sessionsRouter.post('/assistance/start', validateBody(publicAssistanceSchema), async (req, res) => {
  const { clientPhone, clientName, problem, platform, requestedMode } = req.body as z.infer<typeof publicAssistanceSchema>;

  const planResult = await pool.query(
    `SELECT id, price_fcfa, duration_minutes, metadata
     FROM pricing_plans
     WHERE active = TRUE
       AND COALESCE((metadata->>'subscription')::boolean, FALSE) = FALSE
       AND duration_minutes IS NOT NULL
       AND COALESCE((metadata->>'viewerSession')::boolean, FALSE) = FALSE
     ORDER BY
       CASE WHEN $1::text IN ('humain','hybride') THEN CASE WHEN COALESCE((metadata->>'humanIncluded')::boolean, FALSE) THEN 0 ELSE 1 END
            ELSE CASE WHEN COALESCE((metadata->>'aiIncluded')::boolean, TRUE) THEN 0 ELSE 1 END END,
       CASE WHEN $1::text = 'hybride' THEN CASE WHEN COALESCE((metadata->>'aiIncluded')::boolean, TRUE) THEN 0 ELSE 1 END ELSE 0 END,
       price_fcfa ASC
     LIMIT 1`,
    [requestedMode],
  );
  const plan = planResult.rows[0];
  if (!plan) return res.status(503).json({ error: 'Aucune formule d’assistance disponible' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paidNow = freeLaunch();
    const orderResult = await client.query(
      `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, platform, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'paid' THEN now() END)
       RETURNING id, status, amount_fcfa, platform, created_at`,
      [clientPhone, clientName ?? null, plan.id, paidNow ? 0 : plan.price_fcfa, platform, paidNow ? 'paid' : 'pending_payment'],
    );
    const order = orderResult.rows[0];

    if (!paidNow) {
      await client.query('COMMIT');
      return res.status(402).json({ error: 'Paiement requis', order });
    }

    const sessionResult = await createSessionForOrder(order.id, platform, requestedMode, client);
    if (!sessionResult.ok) {
      await client.query('ROLLBACK');
      return res.status(sessionResult.status).json({ error: sessionResult.error });
    }

    if (problem) {
      await client.query(
        `INSERT INTO session_messages (session_id, sender, body) VALUES ($1, 'client', $2)`,
        [sessionResult.session.id, problem],
      );
      await logAudit(client, {
        actorType: 'client',
        actorId: clientPhone,
        orderId: order.id,
        sessionId: sessionResult.session.id,
        action: 'assistance.web_problem_recorded',
        details: { problem: problem.slice(0, 300) },
      });
    }

    await logAudit(client, {
      actorType: 'client',
      actorId: clientPhone,
      orderId: order.id,
      sessionId: sessionResult.session.id,
      action: 'assistance.web_started',
      details: { platform, requestedMode, freeLaunch: true },
    });

    await client.query('COMMIT');
    return res.status(201).json({ order, session: sessionResult.session, freeLaunch: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[assistance] démarrage web en échec', error);
    return res.status(500).json({ error: 'Impossible de démarrer l’assistance' });
  } finally {
    client.release();
  }
});

const publicChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const publicSessionCodeSchema = z.object({
  sessionCode: z.string().regex(/^\\d{9}$/),
});

const publicChatSchema = z.object({
  sessionCode: z.string().regex(/^\\d{9}$/),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  initial: z.boolean().optional(),
});

async function publicSession(id: string, code: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.status, s.order_id, s.platform, s.mode, s.human_included
     FROM sessions s WHERE s.id = $1 AND s.session_code = $2`,
    [id, code],
  );
  return rows[0];
}

sessionsRouter.get('/sessions/:id/messages', async (req, res) => {
  const parsed = publicSessionCodeSchema.safeParse({ sessionCode: req.query.sessionCode });
  if (!parsed.success) return res.status(400).json({ error: 'Code de session invalide' });
  const session = await publicSession(req.params.id, parsed.data.sessionCode);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });

  const { rows } = await pool.query(
    `SELECT m.id, m.sender, m.body, m.created_at
     FROM session_messages m
     WHERE m.session_id = $1
     ORDER BY m.id ASC LIMIT 100`,
    [session.id],
  );
  res.json({ messages: rows.map((m) => ({ id: Number(m.id), sender: m.sender, body: m.body, at: m.created_at })) });
});

sessionsRouter.post('/sessions/:id/chat', publicChatLimiter, validateBody(publicChatSchema), async (req, res) => {
  const body = req.body as z.infer<typeof publicChatSchema>;
  const session = await publicSession(req.params.id, body.sessionCode);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) {
    return res.status(409).json({ error: 'Cette assistance est terminée.' });
  }
  if (session.mode !== 'ia') {
    return res.status(409).json({ error: 'Cette session est actuellement suivie par un technicien.' });
  }

  const stored = await pool.query(
    `SELECT sender, body FROM session_messages
     WHERE session_id = $1 AND sender IN ('client', 'assistant')
     ORDER BY id DESC LIMIT $2`,
    [session.id, MAX_HISTORY_TURNS * 2],
  );
  const history = stored.rows.reverse().map((m) => ({
    role: m.sender === 'assistant' ? 'assistant' as const : 'user' as const,
    text: String(m.body).slice(0, MAX_TURN_CHARS),
  }));

  if (!body.initial) {
    await pool.query(
      `INSERT INTO session_messages (session_id, sender, body) VALUES ($1, 'client', $2)`,
      [session.id, body.message],
    );
  }

  let procedureId: string | null = null;
  let memoryContext = '';
  const tokens = tokenize(body.message);
  if (tokens.length >= 2) {
    const hit = await findForQuery(pool, tokens);
    if (hit) {
      procedureId = hit.id;
      await markServed(pool, hit.id, session.id, null, tokens);
      memoryContext = [
        'Solution apprise : ' + hit.procedure.title,
        'Cause probable : ' + hit.procedure.summary,
        hit.procedure.checks.length ? 'Vérifications : ' + hit.procedure.checks.map((c) => c.problem).join(' | ') : '',
        hit.procedure.fixes.length ? 'Pistes de correction : ' + hit.procedure.fixes.map((f) => f.why).join(' | ') : '',
        hit.procedure.advice.length ? 'Conseils : ' + hit.procedure.advice.join(' | ') : '',
      ].filter(Boolean).join('\\n');
    }
  }

  try {
    const answer = await askOfficeAssistant(body.message, history, {
      platform: session.platform === 'android' ? 'android' : 'windows',
      context: memoryContext,
    });
    await pool.query(
      `INSERT INTO session_messages (session_id, sender, body) VALUES ($1, 'assistant', $2)`,
      [session.id, answer.text],
    );
    await logAudit(pool, {
      actorType: 'client',
      actorId: 'public-session',
      sessionId: session.id,
      orderId: session.order_id,
      action: 'agent.chat',
      details: { question: body.message.slice(0, 300), answer: answer.text.slice(0, 500), model: answer.model, source: 'public_web' },
    });
    return res.json({ answer: answer.text, model: answer.model, procedureId });
  } catch (err) {
    if (err instanceof AssistantUnavailableError) {
      return res.status(503).json({ code: 'assistant_unavailable', error: "L'assistant IA n'est pas disponible pour le moment. Un technicien peut prendre le relais." });
    }
    throw err;
  }
});

const aiFeedbackSchema = z.object({ sessionCode: z.string().regex(/^\\d{9}$/), procedureId: z.string().uuid().optional(), result: z.enum(['resolved', 'not_resolved']), note: z.string().max(200).optional() });

sessionsRouter.post('/sessions/:id/ai-feedback', publicChatLimiter, validateBody(aiFeedbackSchema), async (req, res) => {
  const body = req.body as z.infer<typeof aiFeedbackSchema>;
  const session = await publicSession(req.params.id, body.sessionCode);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette assistance est terminée.' });
  if (body.procedureId) await recordOutcome(pool, { procedureId: body.procedureId, sessionId: session.id, result: body.result, note: body.note });
  if (body.result === 'resolved') {
    await pool.query('INSERT INTO session_messages (session_id, sender, body) VALUES ($1, \'system\', $2)', [session.id, '✓ Solution confirmée. TechAssist mémorise cette réussite pour les prochains cas similaires.']);
    return res.json({ status: 'resolved' });
  }
  const recent = await pool.query('SELECT sender, body FROM session_messages WHERE session_id = $1 AND sender IN (\'client\',\'assistant\') ORDER BY id DESC LIMIT $2', [session.id, MAX_HISTORY_TURNS * 2]);
  const history = recent.rows.reverse().map((m) => ({ role: m.sender === 'assistant' ? 'assistant' as const : 'user' as const, text: String(m.body).slice(0, MAX_TURN_CHARS) }));
  const query = [...history].reverse().find((m) => m.role === 'user')?.text ?? '';
  const tokens = tokenize(query);
  const budget = await aiBudget(pool, { sessionId: session.id, installId: null });
  if (!budget.ok) {
    await pool.query('UPDATE sessions SET mode = \'humain\', status = \'waiting_technician\' WHERE id = $1', [session.id]);
    alertInBackground(session.id);
    return res.json({ status: 'technician' });
  }
  const learned = await generateProcedure({ query, avoid: await failedAlternatives(pool, tokens) }, { env: { ...process.env, LEARNING_PROVIDERS: 'gemini' }, onCall: (call) => recordCall(pool, { sessionId: session.id, installId: null }, call) });
  if (learned.kind !== 'procedure') {
    await pool.query('UPDATE sessions SET mode = \'humain\', status = \'waiting_technician\' WHERE id = $1', [session.id]);
    if (tokens.length >= 2) await recordGap(pool, tokens, query, learned.kind === 'unsupported' ? learned.reason : learned.reason);
    await pool.query('INSERT INTO session_messages (session_id, sender, body) VALUES ($1, \'system\', $2)', [session.id, 'Je n’ai pas une piste suffisamment fiable. Je transmets maintenant votre dossier à un technicien avec tout l’historique.']);
    alertInBackground(session.id);
    return res.json({ status: 'technician' });
  }
  const stored = await insertCandidate(pool, { procedure: learned.procedure, queryTokens: tokens, source: 'ai:web:' + learned.provider, exampleQuery: query, installId: null });
  if (stored.kind === 'retired') {
    await pool.query('UPDATE sessions SET mode = \'humain\', status = \'waiting_technician\' WHERE id = $1', [session.id]);
    alertInBackground(session.id);
    return res.json({ status: 'technician' });
  }
  await markServed(pool, stored.id, session.id, null, tokens);
  const p = learned.procedure;
  const context = ['Nouvelle piste : ' + p.title, 'Cause probable : ' + p.summary, p.checks.length ? 'Vérifications : ' + p.checks.map((c) => c.problem).join(' | ') : '', p.fixes.length ? 'Corrections possibles : ' + p.fixes.map((f) => f.why).join(' | ') : '', p.advice.length ? 'Conseils : ' + p.advice.join(' | ') : ''].filter(Boolean).join('\\n');
  try {
    const answer = await askOfficeAssistant('La première piste n’a pas résolu le problème. Propose la nouvelle piste et demande de confirmer le résultat.\\n\\n' + query, history, { platform: session.platform === 'android' ? 'android' : 'windows', context });
    await pool.query('INSERT INTO session_messages (session_id, sender, body) VALUES ($1, \'assistant\', $2)', [session.id, answer.text]);
    return res.json({ status: 'next_attempt', procedureId: stored.id, answer: answer.text });
  } catch (err) {
    if (err instanceof AssistantUnavailableError) {
      await pool.query('UPDATE sessions SET mode = \'humain\', status = \'waiting_technician\' WHERE id = $1', [session.id]);
      alertInBackground(session.id);
      return res.json({ status: 'technician' });
    }
    throw err;
  }
});

sessionsRouter.get('/sessions/:code', async (req, res) => {
  await expireOverdueSessions(pool);
  const { rows } = await pool.query(
    `SELECT id, session_code, status, code_expires_at, duration_minutes,
            started_at, ends_at, consent_screen_at, consent_control_at, technician_id,
            remote_peer_id, remote_paired_at, mode, requested_mode, kind
     FROM sessions WHERE session_code = $1`,
    [req.params.code],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });
  const { kind, ...session } = rows[0];
  // Session d'un partenaire : la fenêtre du client qui interroge la session fait aussi respecter la coupure des impayés.
  if (kind === 'viewer') {
    const settled = await settleViewerSession(pool, session.id);
    if (settled) session.status = settled.status;
  }
  res.json({ session });
});

const SESSION_CODE = z.string().regex(/^\d{9}$/);
const consentSchema = z.object({ stage: z.enum(['screen', 'control']), sessionCode: SESSION_CODE });
const escalateSchema = z.object({ sessionCode: SESSION_CODE });

/** Le code de session est le secret du client : seul lui le connaît (il est masqué dans les écrans technicien). */
async function clientOwnsSession(id: string | undefined, code: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM sessions WHERE id = $1 AND session_code = $2', [id, code]);
  return rows.length > 0;
}

/**
 * « Passer à un technicien » : le client peut quitter l'agent IA à tout moment ;
 * la session rejoint alors la file d'attente des techniciens.
 */
sessionsRouter.post('/sessions/:id/escalate', validateBody(escalateSchema), async (req, res) => {
  if (!(await clientOwnsSession(req.params.id, req.body.sessionCode))) return res.status(403).json({ error: 'Code de session invalide' });
  // Offre « IA seule » : le technicien n'en fait pas partie (le complément se paie depuis l'application).
  const current = await pool.query(`SELECT human_included FROM sessions WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')`, [req.params.id]);
  if (current.rows[0] && current.rows[0].human_included === false) {
    return res.status(402).json({
      code: 'human_not_included',
      error: "Votre offre « Assistance IA » ne comprend pas de technicien. Passez à « IA + technicien » depuis l'application pour qu'il prenne le relais.",
      upgrade: await upgradeOffer(),
    });
  }
  const { rows } = await pool.query(
    `UPDATE sessions SET mode = 'humain'
     WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')
     RETURNING id, mode, status`,
    [req.params.id],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session terminée ou introuvable' });
  }

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: 'session.escalated_to_human',
  });
  alertInBackground(req.params.id!);

  res.json({ session: rows[0] });
});


/** RS-01 : consentement explicite en deux étapes distinctes (partage, puis contrôle). */
sessionsRouter.post('/sessions/:id/consent', validateBody(consentSchema), async (req, res) => {
  if (!(await clientOwnsSession(req.params.id, req.body.sessionCode))) return res.status(403).json({ error: 'Code de session invalide' });
  const column = req.body.stage === 'screen' ? 'consent_screen_at' : 'consent_control_at';
  const { rows } = await pool.query(
    `UPDATE sessions SET ${column} = now() WHERE id = $1 RETURNING id, ${column}`,
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: `session.consent.${req.body.stage}`,
  });

  res.json({ session: rows[0] });
});

const stopSchema = z.object({ stoppedBy: z.literal('client'), sessionCode: SESSION_CODE });

/** RS-02 : bouton d'arrêt immédiat, effectif quel que soit qui l'actionne. */
sessionsRouter.post('/sessions/:id/stop', validateBody(stopSchema), async (req, res) => {
  if (!(await clientOwnsSession(req.params.id, req.body.sessionCode))) return res.status(403).json({ error: 'Code de session invalide' });
  // RS-10 : le mot de passe de connexion à distance ne survit pas à la session.
  const { rows } = await pool.query(
    `UPDATE sessions
     SET status = 'completed', stopped_at = now(), stopped_by = $2, remote_password_encrypted = NULL
     WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')
     RETURNING id, status, stopped_at`,
    [req.params.id, req.body.stoppedBy],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session déjà terminée ou introuvable' });
  }

  await logAudit(pool, {
    actorType: req.body.stoppedBy === 'client' ? 'client' : 'system',
    sessionId: req.params.id,
    action: 'session.stopped',
    details: { stoppedBy: req.body.stoppedBy },
  });
  // Session partenaire arrêtée sans paiement : rien n'est dû. Assistance avec technicien : son gain est crédité.
  await closeViewerOrderIfUnpaid(pool, req.params.id!);
  await creditEarningSafely(pool, req.params.id!);

  res.json({ session: rows[0] });
});

/**
 * File d'attente technicien (RF-30). Les demandes PME (RP-03/RT-04) sont
 * signalées avec le nom de l'entreprise et la priorité, en tête de liste
 * pour les demandes urgentes.
 */
sessionsRouter.get('/technician/queue', requireAuth('technician', 'admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, right(s.session_code, 4) AS session_code, s.platform, s.created_at, s.duration_minutes, s.human_requested_at,
            s.requested_mode, o.client_phone, o.client_name,
            c.name AS company_name, chr.priority AS company_priority
     FROM sessions s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN company_help_requests chr ON chr.session_id = s.id
     LEFT JOIN companies c ON c.id = chr.company_id
     WHERE s.status IN ('created', 'waiting_technician') AND s.technician_id IS NULL
       AND s.mode = 'humain' AND s.human_included = TRUE
     ORDER BY (chr.priority = 'urgent') DESC, s.created_at ASC`,
  );
  res.json({ queue: rows });
});

/** Sessions actives assignées au technicien connecté (console, après prise en charge). */
sessionsRouter.get('/technician/my-sessions', requireAuth('technician', 'admin'), async (req, res) => {
  await expireOverdueSessions(pool);
  const { rows } = await pool.query(
    `SELECT s.id, right(s.session_code, 4) AS session_code, s.platform, s.status, s.ends_at,
            s.consent_screen_at, s.consent_control_at,
            o.client_phone, o.client_name,
            s.task_progress, EXTRACT(EPOCH FROM (now() - s.task_progress_at)) AS progress_age
     FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.technician_id = $1 AND s.status = 'active'
     ORDER BY s.started_at ASC`,
    [req.auth!.sub],
  );
  // En un coup d'œil : ce que l'agent fait en ce moment sur le PC du client (détail dans le dossier de la demande).
  res.json({
    sessions: rows.map(({ task_progress, progress_age, ...s }) => {
      const view = progressView(task_progress, progress_age);
      const running = view?.items.find((t) => t.state === 'running');
      return { ...s, agent_task: running && view!.ageSeconds < STALE_PROGRESS_SECONDS ? running.title : null };
    }),
  });
});

/** RF-30 : le technicien prend une demande de la file. */
sessionsRouter.patch('/technician/sessions/:id/claim', requireAuth('technician', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE sessions
     SET technician_id = $2, status = 'active', started_at = COALESCE(started_at, now()),
         -- Une seule horloge par assistance : déjà lancée par l'agent IA, elle n'est pas remise à zéro ;
         -- le technicien garde au moins HUMAN_MIN_MINUTES pour intervenir.
         ends_at = GREATEST(COALESCE(ends_at, now() + make_interval(mins => duration_minutes)), now() + make_interval(mins => $3::int))
     WHERE id = $1 AND technician_id IS NULL AND human_included = TRUE AND kind = 'assistance'
       AND status IN ('created', 'waiting_technician')
     RETURNING id, status, started_at, ends_at`,
    [req.params.id, req.auth!.sub, HUMAN_MIN_MINUTES],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session déjà prise en charge' });
  }

  await logAudit(pool, {
    actorType: 'technician',
    actorId: req.auth!.sub,
    sessionId: req.params.id,
    action: 'session.claimed',
  });
  // Le client le voit tout de suite dans la fenêtre de l'agent.
  const name = (await pool.query('SELECT full_name FROM technicians WHERE id = $1', [req.auth!.sub])).rows[0]?.full_name as string | undefined;
  const first = name?.trim().split(/\s+/)[0] ?? 'Un technicien';
  await pool.query(`INSERT INTO session_messages (session_id, sender, technician_id, body) VALUES ($1, 'system', $2, $3)`, [
    req.params.id,
    req.auth!.sub,
    `${first}, technicien Tech Assist, a pris votre demande. Écrivez-lui ici : il voit tout ce que j'ai fait.`,
  ]);

  res.json({ session: rows[0] });
});
