import { release } from 'node:os';
import { CATALOG_VERSION } from './procedures/manifest.js';

/**
 * Mémoire de Tech Assist : pour un cas que l'agent ne connaît pas, le serveur cherche d'abord une procédure déjà apprise
 * (aucun appel d'IA), sinon fait composer un plan par une IA, qu'il mémorise. L'agent n'exécute jamais ce qui arrive ici
 * tel quel : tout passe par `compileProcedure`, qui revalide chaque étape contre le catalogue fermé.
 */

export type LearnResult =
  /** Corrections appliquées et le client confirme que c'est réglé. */
  | 'resolved'
  /** Le problème persiste, ou la procédure n'a rien trouvé alors que le client a toujours son problème. */
  | 'not_resolved'
  /** Le client a refusé les modifications, ou les droits manquaient : ni succès ni échec de la procédure. */
  | 'declined'
  /** Rien n'a pu être vérifié (redémarrage nécessaire, ou rien à corriger). */
  | 'unverified'
  /** L'agent a refusé la procédure (étape hors catalogue, version inconnue) : elle ne doit plus être servie telle quelle. */
  | 'rejected_by_agent';

export type SolveReply =
  | {
      status: 'memory' | 'generated';
      procedureId: string;
      /** « trusted » : confirmée par plusieurs clients ou par un technicien ; « candidate » : proposée par l'IA, pas encore confirmée. */
      trust: 'trusted' | 'candidate';
      procedure: unknown;
    }
  /** Rien dans le catalogue ne permet de traiter ce cas : le serveur le note pour qu'on ajoute la capacité. */
  | { status: 'unsupported'; reason: string }
  /** Phrase trop courte pour chercher quoi que ce soit. */
  | { status: 'needs_detail' }
  | { status: 'unavailable' };

export interface Knowledge {
  solve(query: string): Promise<SolveReply>;
  outcome(procedureId: string, result: LearnResult, note?: string): Promise<void>;
}

const SOLVE_TIMEOUT_MS = 60_000;

/** Mémoire fournie par l'API Tech Assist (routes de la session). */
export class HttpKnowledge implements Knowledge {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly windowsBuild: string = release(),
  ) {}

  private url(path: string): string {
    return `${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/knowledge${path}`;
  }

  async solve(query: string): Promise<SolveReply> {
    try {
      const res = await this.fetchImpl(this.url('/solve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ query: query.slice(0, 300), windowsBuild: this.windowsBuild.slice(0, 30), catalogVersion: CATALOG_VERSION }),
        signal: AbortSignal.timeout(SOLVE_TIMEOUT_MS),
      });
      if (!res.ok) return { status: 'unavailable' };
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status === 'needs_detail') return { status: 'needs_detail' };
      if (body.status === 'unsupported') return { status: 'unsupported', reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : '' };
      if ((body.status === 'memory' || body.status === 'generated') && typeof body.procedureId === 'string' && body.procedure !== undefined) {
        return { status: body.status, procedureId: body.procedureId, trust: body.trust === 'trusted' ? 'trusted' : 'candidate', procedure: body.procedure };
      }
      return { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  async outcome(procedureId: string, result: LearnResult, note?: string): Promise<void> {
    try {
      await this.fetchImpl(this.url(`/${encodeURIComponent(procedureId)}/outcome`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ result, ...(note ? { note: note.slice(0, 200) } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Le résultat est une aide à l'apprentissage : s'il ne part pas, l'intervention du client n'en souffre pas.
    }
  }
}
