import { pool } from '../db/pool.js';
import { bestMatch, tokenize } from '../learning/match.js';
import { validateProcedure } from '../learning/manifest.js';
import { CATALOG_VERSION } from '../learning/manifest.js';
import { isConfidentHit, queryWordCount, searchPannes } from './pannes.js';
import { findLearned } from './pannesLearning.js';

/**
 * LE LEXIQUE : un seul endroit où se retrouve tout ce que Tech Assist sait.
 *  - « base »      : les ≈500 fiches de départ ;
 *  - « ia »        : fiches rédigées par l'IA lors d'une recherche (à confirmer par un technicien) ;
 *  - « client »    : solutions que des clients ont confirmées « résolu » dans le chat (à confirmer par un technicien) ;
 *  - « procedure » : procédures apprises par l'agent (plans d'étapes sûres, mémorisés après un cas inconnu).
 * Le technicien cherche ici ; le chat des clients s'appuie sur ce lexique ; l'IA n'est appelée que si rien n'y correspond.
 */

export type LexiqueOrigin = 'base' | 'ia' | 'client' | 'procedure';

export interface LexiqueEntry {
  id: number | string;
  origin: LexiqueOrigin;
  category: string;
  title: string;
  cause: string;
  solution: string;
  advanced: boolean;
  /** trusted : confirmée ; candidate : proposée, pas encore relue par un technicien. */
  status: 'trusted' | 'candidate';
}

/** Les procédures apprises qui correspondent à la recherche, sans appel d'IA. */
export async function findProcedures(query: string, limit = 3): Promise<LexiqueEntry[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT p.id, p.tokens, p.procedure, p.status, p.uses,
            (SELECT count(DISTINCT r.app_install_id)::int FROM learned_procedure_runs r WHERE r.procedure_id = p.id AND r.result = 'resolved') AS successes
     FROM learned_procedures p
     WHERE p.status IN ('candidate', 'trusted') AND p.catalog_version = $1 AND p.tokens && $2::text[] LIMIT 200`,
    [CATALOG_VERSION, tokens],
  );
  const pool_ = rows.map((r) => ({ id: r.id as string, tokens: r.tokens as string[], procedure: r.procedure, status: r.status as 'candidate' | 'trusted', uses: r.uses as number, successes: r.successes as number }));
  const out: LexiqueEntry[] = [];
  while (out.length < limit) {
    const best = bestMatch(tokens, pool_);
    if (!best) break;
    pool_.splice(pool_.indexOf(best.procedure), 1);
    const checked = validateProcedure(best.procedure.procedure);
    if (!checked.ok) continue;
    const p = checked.value;
    const steps = [...p.checks.map((c) => `Vérifier : ${c.problem}`), ...p.fixes.map((f, i) => `${i + 1}. ${f.why}`), ...p.advice];
    out.push({ id: best.procedure.id, origin: 'procedure', category: 'Procédure apprise', title: p.title, cause: p.summary, solution: steps.join('\n') || p.summary, advanced: false, status: best.procedure.status });
  }
  return out;
}

export interface LexiqueResult {
  entries: LexiqueEntry[];
  /** Le lexique contient-il une réponse sérieuse ? Sinon, il est temps d'interroger l'IA pour l'enrichir. */
  confident: boolean;
}

/** Cherche partout : fiches de départ, fiches apprises, retours clients, procédures apprises. */
export async function searchLexique(query: string): Promise<LexiqueResult> {
  const q = query.trim().slice(0, 200);
  const words = queryWordCount(q);
  const baseHits = searchPannes(q, 8, 2);
  const fromBase: LexiqueEntry[] = baseHits.map((h) => ({
    id: h.panne.id,
    origin: 'base',
    category: h.panne.category,
    title: h.panne.title,
    cause: h.panne.cause || h.panne.symptom,
    solution: h.panne.solution,
    advanced: h.panne.advanced,
    status: 'trusted',
  }));
  const learned = await findLearned(q, 5);
  const fromLearned: LexiqueEntry[] = learned.map((l) => ({
    id: l.id,
    origin: l.source.startsWith('client:') ? 'client' : 'ia',
    category: l.category,
    title: l.title,
    cause: l.cause,
    solution: l.solution,
    advanced: l.advanced,
    status: l.status,
  }));
  const procedures = await findProcedures(q, 3);
  const confident = baseHits.some((h) => isConfidentHit(h, words)) || fromLearned.length > 0 || procedures.length > 0;
  return { entries: [...fromLearned, ...procedures, ...fromBase], confident };
}

const COMMAND = /\b(net (stop|start)|netsh|sfc|dism|chkdsk|w32tm|powercfg|regedit|gpedit|ipconfig|powershell|regsvr32|rename |reg add|cscript|wsreset|diskpart|msconfig)\b/i;

/**
 * Contexte donné à l'IA du chat client : seules les entrées CONFIRMÉES du lexique, faisables par le client lui-même
 * (ni matériel, ni BIOS, ni registre, ni commande). Une proposition non relue n'est jamais ressortie à d'autres clients.
 */
export async function lexiqueContext(query: string): Promise<string> {
  const { entries } = await searchLexique(query);
  const usable = entries
    .filter((e) => e.origin !== 'base' && e.status === 'trusted' && !e.advanced && !COMMAND.test(e.solution))
    .slice(0, 3);
  if (usable.length === 0) return '';
  return usable.map((e) => `Fiche du lexique : ${e.title} — cause : ${e.cause || 'non précisée'} — piste : ${e.solution.slice(0, 600)}`).join('\n');
}
