import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { markOrderPaid } from '../payments/markPaid.js';
import { logAudit } from '../utils/audit.js';

export const paymentsRouter = Router();

/** Signature HMAC-SHA256 (hex) du corps brut avec le secret partagé du prestataire. Comparaison à temps constant. */
export function validSignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = header.replace(/^sha256=/i, '').trim().toLowerCase();
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const webhookSchema = z.object({
  /** Identifiant de la commande Tech Assist, transmis au prestataire à la création du paiement. */
  orderId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  status: z.enum(['success', 'failed', 'pending']),
  /** Montant réellement payé, en FCFA. */
  amount: z.number().int().positive(),
  /** Référence de la transaction chez le prestataire. */
  transactionId: z.string().max(100).optional(),
});

/**
 * Confirmation automatique du paiement par le prestataire (Mobile Money). Sans secret configuré la route est fermée :
 * personne ne peut marquer une commande payée. Le montant doit correspondre à celui de la commande.
 */
paymentsRouter.post('/payments/webhook', async (req: Request, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Paiement automatique non configuré' });
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const header = (req.headers['x-signature'] ?? req.headers['x-webhook-signature']) as string | undefined;
  if (!validSignature(raw, header, secret)) return res.status(401).json({ error: 'Signature invalide' });

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Notification invalide' });
  const { orderId, status, amount, transactionId } = parsed.data;
  if (status !== 'success') return res.json({ ok: true, ignored: status });

  const found = await pool.query('SELECT status, amount_fcfa FROM orders WHERE id = $1', [orderId]);
  const order = found.rows[0];
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.status === 'paid') return res.json({ ok: true, alreadyPaid: true }); // le prestataire peut rejouer la notification
  if (Number(order.amount_fcfa) !== amount) {
    await logAudit(pool, { actorType: 'system', actorId: 'payment-provider', orderId, action: 'order.payment_amount_mismatch', details: { expected: order.amount_fcfa, received: amount, transactionId } });
    return res.status(409).json({ error: 'Montant différent de la commande' });
  }
  const result = await markOrderPaid(orderId, { technicianId: null, provider: process.env.PAYMENT_PROVIDER ?? 'geco', providerRef: transactionId });
  res.json({ ok: true, alreadyPaid: !result.ok });
});

/** Lien de paiement de la commande, construit depuis un modèle (ex. https://pay.exemple/…?amount={amount}&ref={orderId}). */
export function paymentLink(order: { id: string; amount_fcfa: number }, email?: string): string | null {
  const template = process.env.PAYMENT_LINK_TEMPLATE;
  if (!template) return null;
  return template
    .replaceAll('{orderId}', encodeURIComponent(order.id))
    .replaceAll('{amount}', String(order.amount_fcfa))
    .replaceAll('{email}', encodeURIComponent(email ?? ''));
}
