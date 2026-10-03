import { logAudit, type Db } from '../utils/audit.js';

/**
 * Session « viewer » (D16) : un technicien partenaire se connecte au poste de SON client par Tech Assist.
 * Les 3 premières minutes de connexion sont gratuites ; ensuite la session coûte 500 FCFA (une fois, pas par minute).
 *
 * Aucune tâche planifiée : l'état se calcule à la lecture (le partenaire et son client interrogent régulièrement la session)
 * et la coupure des impayés se fait au premier appel qui constate le dépassement.
 */

export const VIEWER_PLAN_ID = 'viewer_session';

const num = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Durée gratuite d'une session (secondes). */
export const freeSeconds = (env: NodeJS.ProcessEnv = process.env) => num(env.VIEWER_FREE_SECONDS, 180, 0, 3600);
/** Délai laissé pour payer après la fin de la durée gratuite, avant de couper la connexion. */
export const graceSeconds = (env: NodeJS.ProcessEnv = process.env) => num(env.VIEWER_GRACE_SECONDS, 60, 0, 900);
/** Nombre de sessions gratuites par partenaire et par jour. */
export const maxFreePerDay = (env: NodeJS.ProcessEnv = process.env) => num(env.VIEWER_MAX_FREE_PER_DAY, 10, 1, 1000);

export type ViewerState =
  /** Le client n'a pas encore ouvert son code, appairé son poste et autorisé le contrôle. */
  | 'waiting_client'
  /** Prête : le partenaire peut se connecter (la durée gratuite démarre à la connexion). */
  | 'ready'
  /** Connecté, durée gratuite en cours. */
  | 'free'
  /** Durée gratuite écoulée, non payée : la connexion sera coupée à l'issue du délai de grâce. */
  | 'payment_required'
  /** Session payée : connexion libre jusqu'à la fin de l'assistance. */
  | 'paid'
  | 'ended';

export interface ViewerRow {
  status: string;
  consent_control_at: Date | string | null;
  remote_peer_id: string | null;
  remote_paired_at: Date | string | null;
  viewer_connected_at: Date | string | null;
  viewer_free_seconds: number | null;
  order_status: string;
}

export interface ViewerView {
  state: ViewerState;
  /** Secondes gratuites restantes (état « free »). */
  freeLeft: number | null;
  /** Secondes avant la coupure (état « payment_required »). */
  cutIn: number | null;
  /** Vrai quand la durée gratuite plus le délai de grâce sont dépassés sans paiement : la session doit être coupée. */
  mustCut: boolean;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** État d'une session viewer à l'instant `now` (fonction pure : testable sans base). */
export function viewerView(row: ViewerRow, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): ViewerView {
  const none = { freeLeft: null, cutIn: null, mustCut: false };
  if (['completed', 'expired', 'cancelled'].includes(row.status)) return { state: 'ended', ...none };
  if (row.order_status === 'paid') return { state: 'paid', ...none };
  if (!row.viewer_connected_at) {
    return { state: row.remote_paired_at && row.consent_control_at ? 'ready' : 'waiting_client', ...none };
  }
  const free = row.viewer_free_seconds ?? freeSeconds(env);
  const elapsed = Math.max(0, (now - ms(row.viewer_connected_at)) / 1000);
  if (elapsed < free) return { state: 'free', freeLeft: Math.ceil(free - elapsed), cutIn: null, mustCut: false };
  const cutIn = Math.ceil(free + graceSeconds(env) - elapsed);
  return { state: 'payment_required', freeLeft: null, cutIn: Math.max(0, cutIn), mustCut: cutIn <= 0 };
}

const VIEW_SQL = `
  SELECT s.id, s.session_code, s.status, s.technician_id, s.created_at, s.stopped_at, s.stopped_by, s.viewer_label,
         s.consent_control_at, s.remote_peer_id, s.remote_paired_at, s.viewer_connected_at, s.viewer_free_seconds,
         s.code_expires_at, o.id AS order_id, o.status AS order_status, o.amount_fcfa
  FROM sessions s JOIN orders o ON o.id = s.order_id
  WHERE s.id = $1 AND s.kind = 'viewer'`;

export type ViewerSessionRow = ViewerRow & {
  id: string;
  session_code: string;
  technician_id: string;
  created_at: Date;
  stopped_at: Date | null;
  stopped_by: string | null;
  viewer_label: string | null;
  code_expires_at: Date;
  order_id: string;
  amount_fcfa: number;
};

export async function loadViewerSession(db: Db, sessionId: string): Promise<ViewerSessionRow | null> {
  const { rows } = await db.query(VIEW_SQL, [sessionId]);
  return rows[0] ?? null;
}

/**
 * Coupe une session viewer impayée dont le délai est dépassé : fin de la session, mot de passe distant effacé (RS-10),
 * commande de 500 FCFA annulée (rien n'est dû pour une session non payée). Renvoie la session à jour.
 */
export async function settleViewerSession(db: Db, sessionId: string, now: number = Date.now()): Promise<ViewerSessionRow | null> {
  const row = await loadViewerSession(db, sessionId);
  if (!row) return null;
  if (!viewerView(row, now).mustCut) return row;
  const ended = await db.query(
    `UPDATE sessions SET status = 'completed', stopped_at = now(), stopped_by = 'system', remote_password_encrypted = NULL
     WHERE id = $1 AND kind = 'viewer' AND status IN ('created', 'waiting_technician', 'active') RETURNING id`,
    [sessionId],
  );
  if (ended.rows[0]) {
    await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment'`, [row.order_id]);
    await logAudit(db, { actorType: 'system', actorId: 'viewer', sessionId, orderId: row.order_id, action: 'viewer.cut_unpaid', details: { partnerId: row.technician_id } });
  }
  return loadViewerSession(db, sessionId);
}

/** Une session terminée sans jamais avoir dépassé la durée gratuite ne coûte rien : sa commande est annulée. */
export async function closeViewerOrderIfUnpaid(db: Db, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE orders SET status = 'cancelled'
     WHERE id = (SELECT order_id FROM sessions WHERE id = $1 AND kind = 'viewer') AND status = 'pending_payment'`,
    [sessionId],
  );
}

/**
 * Durée gratuite à accorder à une connexion : 0 si ce même poste en a déjà bénéficié dans les dernières 24 h avec ce partenaire,
 * ou si le partenaire a atteint son plafond quotidien. Évite d'enchaîner des sessions gratuites de 3 minutes.
 */
export async function grantFreeSeconds(db: Db, p: { partnerId: string; sessionId: string; peerId: string | null }, env: NodeJS.ProcessEnv = process.env): Promise<{ seconds: number; reason?: 'same_machine' | 'daily_cap' }> {
  const base = freeSeconds(env);
  if (base === 0) return { seconds: 0 };
  if (p.peerId) {
    const sameMachine = await db.query(
      `SELECT 1 FROM sessions
       WHERE kind = 'viewer' AND technician_id = $1 AND id <> $2 AND remote_peer_id = $3
         AND viewer_connected_at > now() - interval '24 hours' AND COALESCE(viewer_free_seconds, 0) > 0
       LIMIT 1`,
      [p.partnerId, p.sessionId, p.peerId],
    );
    if (sameMachine.rows[0]) return { seconds: 0, reason: 'same_machine' };
  }
  const today = await db.query(
    `SELECT count(*)::int AS n FROM sessions
     WHERE kind = 'viewer' AND technician_id = $1 AND id <> $2 AND viewer_connected_at > now() - interval '24 hours' AND COALESCE(viewer_free_seconds, 0) > 0`,
    [p.partnerId, p.sessionId],
  );
  if ((today.rows[0]?.n ?? 0) >= maxFreePerDay(env)) return { seconds: 0, reason: 'daily_cap' };
  return { seconds: base };
}
