import { createHash } from 'node:crypto';
import type { Db } from '../utils/audit.js';
import { CATALOG_VERSION, validateProcedure, type Procedure } from './manifest.js';
import { bestMatch, coverage, keyOf, type Candidate } from './match.js';
import type { AvoidItem } from './orchestrator.js';

/** Base de la mémoire : procédures, résultats par session, manques du catalogue, coûts des appels d'IA. */

type Env = Record<string, string | undefined>;
const intFrom = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/** Nombre de postes différents qui doivent avoir réglé leur problème avec une procédure pour qu'elle soit considérée comme sûre. */
export function promoteAfter(env: Env = process.env): number {
  return Math.max(1, intFrom(env.LEARNING_PROMOTE_AFTER, 2));
}

export type ProcedureStatus = 'candidate' | 'trusted' | 'retired';
export type RunResult = 'resolved' | 'not_resolved' | 'declined' | 'unverified' | 'rejected_by_agent';

/** Empreinte stable d'une procédure : deux réponses identiques de l'IA ne créent pas deux lignes. */
export function procedureHash(procedure: Procedure): string {
  return createHash('sha256').update(JSON.stringify(procedure)).digest('hex');
}

export interface ServedProcedure {
  id: string;
  procedure: Procedure;
  status: 'candidate' | 'trusted';
  score: number;
}

interface Row extends Candidate {
  procedure: unknown;
}

/** La procédure apprise qui correspond à la demande, sans aucun appel d'IA. */
export async function findForQuery(db: Db, queryTokens: string[]): Promise<ServedProcedure | null> {
  if (queryTokens.length === 0) return null;
  const { rows } = await db.query(
    `SELECT p.id, p.tokens, p.procedure, p.status, p.uses,
            (SELECT count(DISTINCT r.app_install_id)::int FROM learned_procedure_runs r WHERE r.procedure_id = p.id AND r.result = 'resolved') AS successes
     FROM learned_procedures p
     WHERE p.status IN ('candidate', 'trusted') AND p.catalog_version = $1 AND p.tokens && $2::text[]
     LIMIT 300`,
    [CATALOG_VERSION, queryTokens],
  );
  const candidates: Row[] = rows.map((r) => ({ id: r.id, tokens: r.tokens, procedure: r.procedure, status: r.status, uses: r.uses, successes: r.successes }));
  // La procédure est revalidée à la lecture : une ligne altérée en base n'est jamais servie.
  for (let tries = 0; tries < 3; tries++) {
    const best = bestMatch(queryTokens, candidates);
    if (!best) return null;
    const checked = validateProcedure(best.procedure.procedure);
    if (checked.ok) return { id: best.procedure.id, procedure: checked.value, status: best.procedure.status, score: best.score };
    candidates.splice(candidates.indexOf(best.procedure), 1);
  }
  return null;
}

export type InsertOutcome =
  | { kind: 'created' | 'existing'; id: string; status: 'candidate' | 'trusted' }
  /** L'IA a recomposé une procédure déjà écartée : aucune nouvelle piste. */
  | { kind: 'retired'; id: string };

/** Enregistre une procédure composée par l'IA (« candidate »). Identique à une procédure connue : celle-ci est réutilisée et apprend la nouvelle formulation. */
export async function insertCandidate(
  db: Db,
  p: { procedure: Procedure; queryTokens: string[]; source: string; exampleQuery: string; installId: string | null },
): Promise<InsertOutcome> {
  const hash = procedureHash(p.procedure);
  const tokens = [...new Set([...p.procedure.keywords.map(keyOf), ...p.queryTokens])].slice(0, 30);
  const inserted = await db.query(
    `INSERT INTO learned_procedures (title, tokens, procedure, proc_hash, catalog_version, source, example_query, created_by_install)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (proc_hash) DO NOTHING
     RETURNING id`,
    [p.procedure.title, tokens, JSON.stringify(p.procedure), hash, CATALOG_VERSION, p.source, p.exampleQuery.slice(0, 300), p.installId],
  );
  if (inserted.rows[0]) return { kind: 'created', id: inserted.rows[0].id, status: 'candidate' };

  const existing = await db.query(`SELECT id, status FROM learned_procedures WHERE proc_hash = $1`, [hash]);
  const row = existing.rows[0];
  if (row.status === 'retired') return { kind: 'retired', id: row.id };
  // Même empreinte = même procédure : on réécrit le contenu validé à l'instant, ce qui répare une ligne altérée en base.
  await db.query(
    `UPDATE learned_procedures
     SET tokens = (SELECT array_agg(t) FROM (SELECT DISTINCT unnest(tokens || $2::text[]) AS t LIMIT 40) u),
         procedure = $3, catalog_version = $4, updated_at = now()
     WHERE id = $1`,
    [row.id, p.queryTokens, JSON.stringify(p.procedure), CATALOG_VERSION],
  );
  return { kind: 'existing', id: row.id, status: row.status };
}

/** Note qu'une procédure a été servie à cette session (seule une procédure servie peut recevoir un résultat). */
export async function markServed(db: Db, procedureId: string, sessionId: string, installId: string | null, queryTokens: string[]): Promise<void> {
  const res = await db.query(
    `INSERT INTO learned_procedure_runs (procedure_id, session_id, app_install_id, query_tokens)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (procedure_id, session_id) DO NOTHING`,
    [procedureId, sessionId, installId, queryTokens],
  );
  if (res.rowCount) await db.query(`UPDATE learned_procedures SET uses = uses + 1 WHERE id = $1`, [procedureId]);
}

export interface Tally {
  successes: number;
  failures: number;
}

export async function tallyFor(db: Db, procedureId: string): Promise<Tally> {
  const { rows } = await db.query(
    `SELECT count(DISTINCT app_install_id) FILTER (WHERE result = 'resolved')::int AS successes,
            count(DISTINCT app_install_id) FILTER (WHERE result IN ('not_resolved', 'rejected_by_agent'))::int AS failures
     FROM learned_procedure_runs WHERE procedure_id = $1`,
    [procedureId],
  );
  return { successes: rows[0]?.successes ?? 0, failures: rows[0]?.failures ?? 0 };
}

/** Nouvel état d'une procédure d'après ses résultats (jamais pour une procédure validée ou écartée par un administrateur). */
export function nextStatus(current: ProcedureStatus, tally: Tally, promote: number): ProcedureStatus {
  if (tally.failures >= 2 && tally.failures > tally.successes) return 'retired';
  if (current === 'candidate' && tally.successes >= promote && tally.failures < tally.successes) return 'trusted';
  return current;
}

export type OutcomeStatus = { recorded: false } | { recorded: true; status: ProcedureStatus; tally: Tally };

/** Consigne le résultat d'une session et fait évoluer la procédure. */
export async function recordOutcome(db: Db, p: { procedureId: string; sessionId: string; result: RunResult; note?: string }, env: Env = process.env): Promise<OutcomeStatus> {
  const updated = await db.query(
    `UPDATE learned_procedure_runs SET result = $3, note = $4, updated_at = now()
     WHERE procedure_id = $1 AND session_id = $2
     RETURNING query_tokens`,
    [p.procedureId, p.sessionId, p.result, p.note?.slice(0, 200) ?? null],
  );
  if (!updated.rows[0]) return { recorded: false };

  const proc = await db.query(`SELECT status, locked FROM learned_procedures WHERE id = $1`, [p.procedureId]);
  const row = proc.rows[0];
  const tally = await tallyFor(db, p.procedureId);
  let status: ProcedureStatus = row.status;
  if (!row.locked) {
    status = nextStatus(row.status, tally, promoteAfter(env));
    if (status !== row.status) await db.query(`UPDATE learned_procedures SET status = $2, updated_at = now() WHERE id = $1`, [p.procedureId, status]);
  }
  // Une procédure qui a réellement réglé un problème retrouve désormais aussi les formulations voisines.
  if (p.result === 'resolved' && updated.rows[0].query_tokens.length > 0) {
    await db.query(
      `UPDATE learned_procedures
       SET tokens = (SELECT array_agg(t) FROM (SELECT DISTINCT unnest(tokens || $2::text[]) AS t LIMIT 40) u), updated_at = now()
       WHERE id = $1`,
      [p.procedureId, updated.rows[0].query_tokens],
    );
  }
  return { recorded: true, status, tally };
}

/** Ce qui a déjà été essayé pour un cas semblable sans résultat : l'IA doit proposer une autre piste. */
export async function failedAlternatives(db: Db, queryTokens: string[]): Promise<AvoidItem[]> {
  if (queryTokens.length === 0) return [];
  const { rows } = await db.query(
    `SELECT title, tokens, procedure FROM learned_procedures WHERE status = 'retired' AND tokens && $1::text[] LIMIT 50`,
    [queryTokens],
  );
  return rows
    .map((r) => ({ r, common: coverage(queryTokens, r.tokens).common }))
    .filter((x) => x.common >= 2)
    .sort((a, b) => b.common - a.common)
    .slice(0, 3)
    .map(({ r }) => ({ title: String(r.title), summary: String((r.procedure as { summary?: unknown })?.summary ?? '') }));
}

/** Une capacité qui manque au catalogue : comptée pour savoir quoi ajouter en premier. */
export async function recordGap(db: Db, queryTokens: string[], query: string, reason: string): Promise<void> {
  if (queryTokens.length < 2) return;
  const key = [...queryTokens].sort().join('|').slice(0, 200);
  await db.query(
    `INSERT INTO knowledge_gaps (gap_key, sample_query, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (gap_key) DO UPDATE SET occurrences = knowledge_gaps.occurrences + 1, last_seen_at = now()`,
    [key, query.slice(0, 300), reason.slice(0, 300)],
  );
}

export interface Budget {
  ok: boolean;
  reason?: 'session' | 'install' | 'global';
}

/** Plafonds d'appels d'IA (coût) : par session, par poste et par jour, et pour toute la plateforme. */
export async function aiBudget(db: Db, who: { sessionId: string; installId: string | null }, env: Env = process.env): Promise<Budget> {
  const perSession = intFrom(env.LEARNING_MAX_AI_PER_SESSION, 6);
  const perInstall = intFrom(env.LEARNING_MAX_AI_PER_INSTALL_DAY, 15);
  const perDay = intFrom(env.LEARNING_MAX_AI_PER_DAY, 600);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE session_id = $1)::int AS session_calls,
            count(*) FILTER (WHERE app_install_id = $2)::int AS install_calls,
            count(*)::int AS all_calls
     FROM learning_calls WHERE created_at > now() - interval '24 hours'`,
    [who.sessionId, who.installId],
  );
  const r = rows[0];
  if (r.session_calls >= perSession) return { ok: false, reason: 'session' };
  if (r.install_calls >= perInstall) return { ok: false, reason: 'install' };
  if (r.all_calls >= perDay) return { ok: false, reason: 'global' };
  return { ok: true };
}

export async function recordCall(db: Db, who: { sessionId: string; installId: string }, call: { provider: string; model: string; ok: boolean; error?: string; durationMs: number }): Promise<void> {
  await db.query(
    `INSERT INTO learning_calls (session_id, app_install_id, provider, model, ok, error, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [who.sessionId, who.installId, call.provider, call.model || null, call.ok, call.error?.slice(0, 200) ?? null, call.durationMs],
  );
}

