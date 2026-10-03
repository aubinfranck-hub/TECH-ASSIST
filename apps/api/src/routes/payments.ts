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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jekoSchema = z.object({
  id: z.string().max(100).optional(),
  status: z.enum(['pending', 'success', 'error']),
  amount: z.object({ amount: z.number().positive() }),
  storeId: z.string().optional(),
  transactionType: z.string().optional(),
  transactionDetails: z.object({ reference: z.string() }).partial().optional(),
});

/**
 * Confirmation automatique du paiement par Jèko (notification TRANSACTION_COMPLETED signée en HMAC-SHA256 hex
 * dans `Jeko-Signature`). Sans secret configuré la route est fermée : personne ne peut marquer une commande payée.
 * Réponse 200 pour toute notification authentique (Jèko désactive un webhook après 15 échecs consécutifs).
 */
paymentsRouter.post('/payments/webhook', async (req: Request, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Paiement automatique non configuré' });
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const header = (req.headers['jeko-signature'] ?? req.headers['x-signature']) as string | undefined;
  if (!validSignature(raw, header, secret)) return res.status(401).json({ error: 'Signature invalide' });

  const event = req.headers['jeko-event'];
  if (typeof event === 'string' && event !== 'TRANSACTION_COMPLETED') return res.json({ ok: true, ignored: event });

  const parsed = jekoSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ ok: true, ignored: 'format' });
  const p = parsed.data;
  if (p.status !== 'success') return res.json({ ok: true, ignored: p.status });
  if (p.transactionType && p.transactionType !== 'payment') return res.json({ ok: true, ignored: p.transactionType });
  if (process.env.JEKO_STORE_ID && p.storeId && p.storeId !== process.env.JEKO_STORE_ID) return res.json({ ok: true, ignored: 'store' });

  const orderId = p.transactionDetails?.reference ?? '';
  if (!UUID.test(orderId)) return res.json({ ok: true, ignored: 'reference' });

  const found = await pool.query('SELECT status, amount_fcfa FROM orders WHERE id = $1', [orderId]);
  const order = found.rows[0];
  if (!order) return res.json({ ok: true, ignored: 'commande inconnue' });
  if (order.status === 'paid') return res.json({ ok: true, alreadyPaid: true }); // notification rejouée
  // Le montant du webhook est en FCFA ; accepté aussi en centimes (x100) car la demande de paiement se fait en centimes.
  const expected = Number(order.amount_fcfa);
  if (p.amount.amount !== expected && p.amount.amount !== expected * 100) {
    await logAudit(pool, { actorType: 'system', actorId: 'jeko', orderId, action: 'order.payment_amount_mismatch', details: { expected, received: p.amount.amount, transactionId: p.id } });
    return res.json({ ok: false, ignored: 'montant' });
  }
  const result = await markOrderPaid(orderId, { technicianId: null, provider: 'jeko', providerRef: p.id });
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
