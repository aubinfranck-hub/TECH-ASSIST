import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAppInstall } from '../middleware/appAuth.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { generateProcedure } from '../learning/orchestrator.js';
import { CATALOG_VERSION } from '../learning/manifest.js';
import { tokenize } from '../learning/match.js';
import { aiBudget, failedAlternatives, findForQuery, insertCandidate, markServed, recordCall, recordGap, recordOutcome, tallyFor } from '../learning/store.js';
import { logAudit } from '../utils/audit.js';

/**
 * Mémoire de Tech Assist (D15) : pour un cas que l'agent ne connaît pas, on cherche d'abord une procédure déjà apprise
 * (aucun appel d'IA) ; sinon une IA en compose une à partir du catalogue fermé d'opérations, que l'agent revalide et exécute
 * avec l'accord du client. Le résultat est consigné : confirmée sur plusieurs postes, la procédure devient « trusted »
 * et l'IA n'est plus consultée pour ce cas.
 */
export const knowledgeRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const solveSchema = z.object({
  query: z.string().trim().min(1).max(300),
  windowsBuild: z.string().max(30).optional(),
  catalogVersion: z.number().int(),
});

const outcomeSchema = z.object({
  result: z.enum(['resolved', 'not_resolved', 'declined', 'unverified', 'rejected_by_agent']),
  note: z.string().max(200).optional(),
});

/** La session doit appartenir à CETTE installation, via sa commande. */
async function ownedSession(sessionId: string, installId: string) {
  if (!UUID.test(sessionId)) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.status, s.order_id FROM sessions s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.app_install_id = $2`,
    [sessionId, installId],
  );
  return rows[0] ?? null;
}

knowledgeRouter.post('/app/sessions/:id/knowledge/solve', limiter, requireAppInstall, validateBody(solveSchema), async (req, res) => {
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof solveSchema>;
  const session = await ownedSession(req.params.id!, install.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette assistance est terminée.' });
  // Un agent d'une autre version du catalogue ne saurait pas exécuter ce qu'on lui enverrait : il reprend son cheminement habituel.
  if (body.catalogVersion !== CATALOG_VERSION) return res.status(409).json({ code: 'catalog_mismatch', error: "Cette version de l'agent n'est pas à jour." });

  const tokens = tokenize(body.query);
  if (tokens.length < 2) return res.json({ status: 'needs_detail' });
  const audit = (details: Record<string, unknown>) =>
    logAudit(pool, { actorType: 'client', actorId: install.email, sessionId: session.id, orderId: session.order_id, action: 'agent.knowledge', details: { query: body.query.slice(0, 200), ...details } });

  // 1. La mémoire d'abord : un cas déjà résolu ne coûte aucun appel d'IA.
  const hit = await findForQuery(pool, tokens);
  if (hit) {
    await markServed(pool, hit.id, session.id, install.id, tokens);
    await audit({ status: 'memory', procedureId: hit.id, trust: hit.status });
    return res.json({ status: 'memory', procedureId: hit.id, trust: hit.status, procedure: hit.procedure });
  }

  // 2. Sinon l'IA compose un plan, dans la limite des plafonds de coût.
  const who = { sessionId: session.id as string, installId: install.id };
  const budget = await aiBudget(pool, who);
  if (!budget.ok) {
    await audit({ status: 'budget', reason: budget.reason });
    return res.status(429).json({ code: 'learning_limit', error: "La limite d'aide automatique est atteinte pour le moment." });
  }
  const avoid = await failedAlternatives(pool, tokens);
  const result = await generateProcedure(
    { query: body.query, windowsBuild: body.windowsBuild, avoid },
    { onCall: (call) => recordCall(pool, who, call) },
  );

  if (result.kind === 'unavailable') {
    console.error(`[apprentissage] aucune IA n'a pu répondre : ${result.reason}`);
    await audit({ status: 'unavailable' });
    return res.status(503).json({ code: 'learning_unavailable', error: "L'aide automatique n'est pas disponible pour le moment." });
  }
  if (result.kind === 'unsupported') {
    await recordGap(pool, tokens, body.query, result.reason);
    await audit({ status: 'unsupported', provider: result.provider, reason: result.reason.slice(0, 200) });
    return res.json({ status: 'unsupported', reason: result.reason });
  }

  const stored = await insertCandidate(pool, {
    procedure: result.procedure,
    queryTokens: tokens,
    source: `ai:${result.provider}`,
    exampleQuery: body.query,
    installId: install.id,
  });
  if (stored.kind === 'retired') {
    // L'IA n'a rien de nouveau à proposer : on le note comme un manque plutôt que de rejouer une piste qui a échoué.
    await recordGap(pool, tokens, body.query, 'Aucune nouvelle piste : les procédures connues pour ce cas ont échoué.');
    await audit({ status: 'no_new_lead', provider: result.provider });
    return res.json({ status: 'unsupported', reason: 'Aucune nouvelle piste pour ce cas.' });
  }
  await markServed(pool, stored.id, session.id, install.id, tokens);
  await audit({ status: stored.kind === 'created' ? 'generated' : 'memory', procedureId: stored.id, provider: result.provider, model: result.model });
  res.json({
    status: stored.kind === 'created' ? 'generated' : 'memory',
    procedureId: stored.id,
    trust: stored.status,
    procedure: result.procedure,
  });
});

knowledgeRouter.post('/app/sessions/:id/knowledge/:procedureId/outcome', limiter, requireAppInstall, validateBody(outcomeSchema), async (req, res) => {
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof outcomeSchema>;
  const session = await ownedSession(req.params.id!, install.id);
  if (!session || !UUID.test(req.params.procedureId!)) return res.status(404).json({ error: 'Introuvable' });

  const outcome = await recordOutcome(pool, { procedureId: req.params.procedureId!, sessionId: session.id, result: body.result, note: body.note });
  // Seule une procédure servie à CETTE session peut recevoir un résultat de sa part.
  if (!outcome.recorded) return res.status(404).json({ error: "Cette procédure n'a pas été proposée à cette session." });
  await logAudit(pool, {
    actorType: 'client',
    actorId: install.email,
    sessionId: session.id,
    orderId: session.order_id,
    action: 'agent.knowledge.outcome',
    details: { procedureId: req.params.procedureId, result: body.result, status: outcome.status },
  });
  res.status(201).json({ recorded: true, status: outcome.status });
});

// --- Administration : relire ce que l'IA a composé, valider ou écarter, voir les capacités qui manquent ---

export const knowledgeAdminRouter = Router();
knowledgeAdminRouter.use(requireAuth('admin'));

knowledgeAdminRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' && ['candidate', 'trusted', 'retired'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.status, p.locked, p.source, p.example_query, p.uses, p.created_at, p.approved_by, p.procedure,
            count(DISTINCT r.app_install_id) FILTER (WHERE r.result = 'resolved')::int AS successes,
            count(DISTINCT r.app_install_id) FILTER (WHERE r.result IN ('not_resolved', 'rejected_by_agent'))::int AS failures
     FROM learned_procedures p LEFT JOIN learned_procedure_runs r ON r.procedure_id = p.id
     WHERE $1::text IS NULL OR p.status = $1
     GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`,
    [status],
  );
  res.json({ procedures: rows });
});

knowledgeAdminRouter.get('/gaps', async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, sample_query, reason, occurrences, status, first_seen_at, last_seen_at FROM knowledge_gaps ORDER BY (status = 'open') DESC, occurrences DESC LIMIT 200`);
  res.json({ gaps: rows });
});

const gapSchema = z.object({ status: z.enum(['open', 'done', 'ignored']) });
knowledgeAdminRouter.post('/gaps/:id/status', validateBody(gapSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
  const { rowCount } = await pool.query(`UPDATE knowledge_gaps SET status = $2 WHERE id = $1`, [req.params.id, (req.body as z.infer<typeof gapSchema>).status]);
  if (!rowCount) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ok: true });
});

for (const [action, status] of [
  ['approve', 'trusted'],
  ['retire', 'retired'],
] as const) {
  // Validée ou écartée par un administrateur : les résultats des clients ne la font plus changer d'état.
  knowledgeAdminRouter.post(`/:id/${action}`, async (req, res) => {
    if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
    const { rows } = await pool.query(
      `UPDATE learned_procedures SET status = $2, locked = TRUE, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $1 RETURNING id, title, status`,
      [req.params.id, status, req.auth!.sub],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: `knowledge.${action}`, details: { procedureId: rows[0].id, title: rows[0].title } });
    res.json({ procedure: { ...rows[0], tally: await tallyFor(pool, rows[0].id) } });
  });
}
