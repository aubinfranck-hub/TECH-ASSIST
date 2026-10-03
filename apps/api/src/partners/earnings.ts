import { logAudit, type Db } from '../utils/audit.js';

/**
 * Rémunération des techniciens à l'assistance (D16). Une assistance terminée avec un technicien crédite UNE ligne de gain
 * (contrainte d'unicité par session : le crédit est rejouable sans doublon). Le montant vient de la grille `technician_pay_rates`
 * selon le type d'assistance. La ligne naît « pending » ; l'administrateur la valide (« approved »), puis un versement
 * la passe à « paid ». Rien n'est versé sans validation.
 */

export type EarningKind = 'ia_technicien' | 'complement' | 'entreprise';
export type EarningStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export type CreditResult =
  | { credited: true; earningId: string; kind: EarningKind; amountFcfa: number }
  | { credited: false; reason: 'not_found' | 'not_completed' | 'not_assistance' | 'no_technician' | 'not_staff' | 'no_human' | 'self_confirmed' | 'already_credited' | 'no_rate' };

/**
 * Crédite le technicien d'une assistance terminée. Appelé à la fin de l'assistance (par le technicien ou par l'arrêt de la session) :
 * sans effet si l'assistance n'a pas eu de technicien, si elle n'est pas terminée, ou si elle est déjà créditée.
 */
export async function creditEarningForSession(db: Db, sessionId: string): Promise<CreditResult> {
  const { rows } = await db.query(
    `SELECT s.id, s.kind, s.status, s.technician_id, s.human_included, s.started_at, s.stopped_at, s.order_id,
            t.role AS technician_role, o.paid_by_technician_id, o.amount_fcfa AS client_paid_fcfa,
            EXISTS (SELECT 1 FROM company_help_requests c WHERE c.session_id = s.id) AS is_company,
            EXISTS (SELECT 1 FROM orders u WHERE u.upgrade_session_id = s.id AND u.status = 'paid') AS is_upgrade
     FROM sessions s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN technicians t ON t.id = s.technician_id
     WHERE s.id = $1`,
    [sessionId],
  );
  const s = rows[0];
  if (!s) return { credited: false, reason: 'not_found' };
  if (s.kind !== 'assistance') return { credited: false, reason: 'not_assistance' };
  if (s.status !== 'completed') return { credited: false, reason: 'not_completed' };
  if (!s.technician_id) return { credited: false, reason: 'no_technician' };
  // Les partenaires paient leurs propres sessions ; les administrateurs ne se rémunèrent pas eux-mêmes.
  if (s.technician_role !== 'technician') return { credited: false, reason: 'not_staff' };
  if (!s.human_included) return { credited: false, reason: 'no_human' };
  // Un technicien ne se rémunère pas sur une commande qu'il a confirmée lui-même à la main.
  if (s.paid_by_technician_id && s.paid_by_technician_id === s.technician_id) return { credited: false, reason: 'self_confirmed' };

  const kind: EarningKind = s.is_company ? 'entreprise' : s.is_upgrade ? 'complement' : 'ia_technicien';
  const rate = await db.query('SELECT amount_fcfa FROM technician_pay_rates WHERE kind = $1', [kind]);
  if (!rate.rows[0]) return { credited: false, reason: 'no_rate' };
  const amount = Number(rate.rows[0].amount_fcfa);

  // Éléments de contrôle montrés à l'administrateur au moment de valider.
  const [messages, viewed] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM session_messages WHERE session_id = $1 AND sender = 'technician'`, [sessionId]),
    db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE session_id = $1 AND action = 'session.remote_credentials_viewed'`, [sessionId]),
  ]);
  const minutes = s.started_at && s.stopped_at ? Math.max(0, Math.round((new Date(s.stopped_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : 0;
  const evidence = {
    technicianMessages: messages.rows[0]?.n ?? 0,
    remoteAccessViewed: (viewed.rows[0]?.n ?? 0) > 0,
    minutes,
    clientPaidFcfa: Number(s.client_paid_fcfa),
    // Commande confirmée à la main par ce même technicien : à regarder de près avant de valider.
    selfConfirmedPayment: s.paid_by_technician_id === s.technician_id,
  };

  const inserted = await db.query(
    `INSERT INTO technician_earnings (technician_id, session_id, kind, amount_fcfa, evidence)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id) DO NOTHING RETURNING id`,
    [s.technician_id, sessionId, kind, amount, JSON.stringify(evidence)],
  );
  if (!inserted.rows[0]) return { credited: false, reason: 'already_credited' };
  await logAudit(db, { actorType: 'system', actorId: 'earnings', sessionId, action: 'earning.credited', details: { technicianId: s.technician_id, kind, amountFcfa: amount } });
  return { credited: true, earningId: inserted.rows[0].id, kind, amountFcfa: amount };
}

/** Crédit sans jamais faire échouer la fin d'une assistance : une erreur ici est journalisée, pas propagée. */
export async function creditEarningSafely(db: Db, sessionId: string): Promise<void> {
  try {
    await creditEarningForSession(db, sessionId);
  } catch (err) {
    console.error('[gains] crédit impossible', sessionId, err instanceof Error ? err.message : err);
  }
}

export interface Balance {
  /** En attente de validation par l'administrateur. */
  pending: number;
  /** Validé, à recevoir au prochain versement. */
  approved: number;
  /** Déjà versé. */
  paid: number;
}

export async function balanceFor(db: Db, technicianId: string): Promise<Balance> {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(amount_fcfa) FILTER (WHERE status = 'pending'), 0)::int AS pending,
            COALESCE(sum(amount_fcfa) FILTER (WHERE status = 'approved'), 0)::int AS approved,
            COALESCE(sum(amount_fcfa) FILTER (WHERE status = 'paid'), 0)::int AS paid
     FROM technician_earnings WHERE technician_id = $1`,
    [technicianId],
  );
  return rows[0] ?? { pending: 0, approved: 0, paid: 0 };
}
