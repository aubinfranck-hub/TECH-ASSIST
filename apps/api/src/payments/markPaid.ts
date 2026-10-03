import { pool } from '../db/pool.js';
import { logAudit } from '../utils/audit.js';

export type MarkPaidResult =
  | { ok: true; order: { id: string; status: string; paid_at: Date }; subscription: { id: string; starts_at: Date; ends_at: Date } | null }
  | { ok: false; reason: 'already_processed' };

/**
 * Passe une commande en « payée » (et active l'abonnement lié, le cas échéant). Un seul chemin pour la confirmation
 * manuelle d'un technicien et pour la confirmation automatique du prestataire de paiement : idempotent, la
 * commande n'est payée qu'une fois. `technicianId` est null quand c'est le prestataire qui confirme.
 */
export async function markOrderPaid(orderId: string, by: { technicianId: string | null; provider?: string; providerRef?: string }): Promise<MarkPaidResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE orders SET status = 'paid', paid_at = now(), paid_by_technician_id = $2
       WHERE id = $1 AND (status = 'pending_payment'
         -- Paiement reçu après l'annulation d'une session partenaire : l'argent est bien encaissé, on le constate.
         OR (status = 'cancelled' AND $3::boolean AND plan_id IN (SELECT id FROM pricing_plans WHERE (metadata->>'viewerSession')::boolean = TRUE)))
       RETURNING id, status, paid_at`,
      [orderId, by.technicianId, by.technicianId === null],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already_processed' };
    }
    // Abonnement mensuel : l'activation suit la confirmation du paiement. Un renouvellement avant l'échéance
    // prolonge la période en cours au lieu de la raccourcir.
    const subscription = await client.query(
      `WITH base AS (
         SELECT s.id,
                GREATEST(now(), COALESCE((SELECT max(x.ends_at) FROM subscriptions x
                                          WHERE x.client_email = s.client_email AND x.status = 'active'), now())) AS start_at,
                COALESCE((p.metadata->>'periodDays')::int, 30) AS days
         FROM subscriptions s JOIN pricing_plans p ON p.id = s.plan_id
         WHERE s.order_id = $1 AND s.status = 'pending_payment'
       )
       UPDATE subscriptions s
       SET status = 'active', starts_at = b.start_at, ends_at = b.start_at + make_interval(days => b.days)
       FROM base b WHERE s.id = b.id
       RETURNING s.id, s.starts_at, s.ends_at`,
      [orderId],
    );
    // Complément « technicien » : dès le paiement confirmé, l'assistance concernée comprend un technicien.
    const upgraded = await client.query(
      `UPDATE sessions SET human_included = TRUE
       WHERE id = (SELECT upgrade_session_id FROM orders WHERE id = $1) AND human_included = FALSE
       RETURNING id`,
      [orderId],
    );
    await client.query('COMMIT');

    if (upgraded.rows[0]) await logAudit(pool, { actorType: 'system', orderId, sessionId: upgraded.rows[0].id, action: 'session.human_added' });
    await logAudit(pool, {
      actorType: by.technicianId ? 'technician' : 'system',
      actorId: by.technicianId ?? by.provider ?? 'payment-provider',
      orderId,
      action: 'order.payment_confirmed',
      details: by.technicianId ? {} : { provider: by.provider, providerRef: by.providerRef },
    });
    if (subscription.rows[0]) {
      await logAudit(pool, { actorType: 'system', orderId, action: 'subscription.activated', details: { endsAt: subscription.rows[0].ends_at } });
    }
    return { ok: true, order: rows[0], subscription: subscription.rows[0] ?? null };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
