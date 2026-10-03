import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { balanceFor } from '../partners/earnings.js';
import { logAudit } from '../utils/audit.js';

/**
 * Administration des partenaires et des gains (D16) : valider les comptes partenaires, grille de rémunération,
 * validation des gains par assistance, versements aux techniciens.
 */
export const adminPartnersRouter = Router();
adminPartnersRouter.use(requireAuth('admin'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 100_000;

// --- Comptes partenaires ---

adminPartnersRouter.get('/partners', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.full_name, t.phone, t.username, t.business_name, t.approval_status, t.is_active, t.totp_enabled, t.created_at, t.approved_at,
            (SELECT count(*)::int FROM sessions s WHERE s.kind = 'viewer' AND s.technician_id = t.id AND s.viewer_connected_at IS NOT NULL) AS sessions,
            (SELECT count(*)::int FROM sessions s JOIN orders o ON o.id = s.order_id
              WHERE s.kind = 'viewer' AND s.technician_id = t.id AND o.status = 'paid') AS paid_sessions
     FROM technicians t WHERE t.role = 'partner'
     ORDER BY (t.approval_status = 'pending') DESC, t.created_at DESC LIMIT 200`,
  );
  res.json({ partners: rows });
});

const decisionSchema = z.object({ decision: z.enum(['approve', 'reject', 'suspend', 'reactivate']) });

adminPartnersRouter.post('/partners/:id/decision', validateBody(decisionSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
  const { decision } = req.body as z.infer<typeof decisionSchema>;
  // approve/reactivate ouvrent le compte ; reject/suspend le ferment. Une demande rejetée ne se réactive pas : il faut une nouvelle demande.
  const sql: Record<typeof decision, string> = {
    approve: `UPDATE technicians SET approval_status = 'approved', is_active = TRUE, approved_by = $2, approved_at = now() WHERE id = $1 AND role = 'partner' AND approval_status = 'pending' RETURNING id, username, approval_status, is_active`,
    reject: `UPDATE technicians SET approval_status = 'rejected', is_active = FALSE WHERE id = $1 AND role = 'partner' AND approval_status = 'pending' RETURNING id, username, approval_status, is_active`,
    suspend: `UPDATE technicians SET is_active = FALSE WHERE id = $1 AND role = 'partner' AND approval_status = 'approved' RETURNING id, username, approval_status, is_active`,
    reactivate: `UPDATE technicians SET is_active = TRUE WHERE id = $1 AND role = 'partner' AND approval_status = 'approved' RETURNING id, username, approval_status, is_active`,
  };
  const { rows } = await pool.query(sql[decision], decision === 'approve' ? [req.params.id, req.auth!.sub] : [req.params.id]);
  if (!rows[0]) return res.status(409).json({ error: "Cette décision n'est pas possible dans l'état actuel du compte." });
  await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: `partner.${decision}`, details: { partnerId: rows[0].id, username: rows[0].username } });
  res.json({ partner: rows[0] });
});

// --- Grille de rémunération ---

adminPartnersRouter.get('/pay-rates', async (_req, res) => {
  const { rows } = await pool.query('SELECT kind, label, amount_fcfa, updated_at FROM technician_pay_rates ORDER BY kind');
  res.json({ rates: rows });
});

const rateSchema = z.object({ amountFcfa: z.number().int().min(0).max(MAX_AMOUNT) });

adminPartnersRouter.put('/pay-rates/:kind', validateBody(rateSchema), async (req, res) => {
  const { amountFcfa } = req.body as z.infer<typeof rateSchema>;
  const { rows } = await pool.query(`UPDATE technician_pay_rates SET amount_fcfa = $2, updated_at = now() WHERE kind = $1 RETURNING kind, label, amount_fcfa`, [req.params.kind, amountFcfa]);
  if (!rows[0]) return res.status(404).json({ error: "Ce type d'assistance n'existe pas." });
  // Le nouveau montant ne vaut que pour les assistances à venir : les gains déjà crédités gardent leur montant.
  await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: 'earning.rate_changed', details: { kind: rows[0].kind, amountFcfa } });
  res.json({ rate: rows[0] });
});

// --- Gains ---

adminPartnersRouter.get('/earnings', async (req, res) => {
  const status = typeof req.query.status === 'string' && ['pending', 'approved', 'paid', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(
    `SELECT e.id, e.technician_id, t.full_name AS technician_name, e.kind, r.label, e.amount_fcfa, e.status, e.evidence, e.note, e.created_at, e.approved_at,
            s.session_code
     FROM technician_earnings e
     JOIN technicians t ON t.id = e.technician_id
     JOIN technician_pay_rates r ON r.kind = e.kind
     JOIN sessions s ON s.id = e.session_id
     WHERE $1::text IS NULL OR e.status = $1
     ORDER BY e.created_at DESC LIMIT 200`,
    [status],
  );
  res.json({ earnings: rows });
});

/** Soldes par technicien : ce qui attend validation, ce qui est validé (à verser), ce qui est versé. */
adminPartnersRouter.get('/earnings/balances', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.full_name, t.payout_phone, t.payout_operator,
            COALESCE(sum(e.amount_fcfa) FILTER (WHERE e.status = 'pending'), 0)::int AS pending,
            COALESCE(sum(e.amount_fcfa) FILTER (WHERE e.status = 'approved'), 0)::int AS approved,
            COALESCE(sum(e.amount_fcfa) FILTER (WHERE e.status = 'paid'), 0)::int AS paid
     FROM technicians t JOIN technician_earnings e ON e.technician_id = t.id
     GROUP BY t.id ORDER BY approved DESC, pending DESC LIMIT 200`,
  );
  res.json({ balances: rows });
});

const approveSchema = z.object({ ids: z.array(z.string().regex(UUID)).min(1).max(100) });

/** Valide des gains en attente (en lot). */
adminPartnersRouter.post('/earnings/approve', validateBody(approveSchema), async (req, res) => {
  const { ids } = req.body as z.infer<typeof approveSchema>;
  const { rows } = await pool.query(
    `UPDATE technician_earnings SET status = 'approved', approved_by = $2, approved_at = now()
     WHERE id = ANY($1::uuid[]) AND status = 'pending' RETURNING id, technician_id, amount_fcfa`,
    [ids, req.auth!.sub],
  );
  for (const r of rows) await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: 'earning.approved', details: { earningId: r.id, technicianId: r.technician_id, amountFcfa: r.amount_fcfa } });
  res.json({ approved: rows.length, skipped: ids.length - rows.length });
});

const adjustSchema = z.object({ amountFcfa: z.number().int().min(0).max(MAX_AMOUNT), note: z.string().trim().min(3).max(300) });

/** Corrige le montant d'un gain en attente (assistance plus longue, prime…) : la raison est obligatoire et journalisée. */
adminPartnersRouter.post('/earnings/:id/adjust', validateBody(adjustSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
  const { amountFcfa, note } = req.body as z.infer<typeof adjustSchema>;
  const { rows } = await pool.query(
    `UPDATE technician_earnings SET amount_fcfa = $2, note = $3 WHERE id = $1 AND status = 'pending' RETURNING id, amount_fcfa, status, technician_id`,
    [req.params.id, amountFcfa, note],
  );
  if (!rows[0]) return res.status(409).json({ error: "Seul un gain en attente de validation peut être corrigé." });
  await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: 'earning.adjusted', details: { earningId: rows[0].id, technicianId: rows[0].technician_id, amountFcfa, note } });
  res.json({ earning: rows[0] });
});

const cancelSchema = z.object({ note: z.string().trim().min(3).max(300) });

/** Écarte un gain (assistance non réalisée, fraude…) : il ne sera jamais versé. */
adminPartnersRouter.post('/earnings/:id/cancel', validateBody(cancelSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
  const { note } = req.body as z.infer<typeof cancelSchema>;
  const { rows } = await pool.query(
    `UPDATE technician_earnings SET status = 'cancelled', note = $2 WHERE id = $1 AND status IN ('pending', 'approved') RETURNING id, status, technician_id, amount_fcfa`,
    [req.params.id, note],
  );
  if (!rows[0]) return res.status(409).json({ error: 'Ce gain est déjà versé, écarté ou introuvable.' });
  await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: 'earning.cancelled', details: { earningId: rows[0].id, technicianId: rows[0].technician_id, amountFcfa: rows[0].amount_fcfa, note } });
  res.json({ earning: rows[0] });
});

const payoutSchema = z.object({ reference: z.string().trim().min(3).max(120), note: z.string().trim().max(300).optional() });

/**
 * Verse à un technicien TOUT ce qui est validé : l'administrateur a envoyé l'argent (Mobile Money) et note la référence du transfert.
 * Les gains validés passent à « paid » dans la même transaction que l'écriture du versement, pour ne jamais être versés deux fois.
 */
adminPartnersRouter.post('/technicians/:id/payouts', validateBody(payoutSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Introuvable' });
  const { reference, note } = req.body as z.infer<typeof payoutSchema>;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou sur les gains validés de ce technicien : deux versements simultanés ne peuvent pas prendre les mêmes lignes.
    const lines = await client.query(
      `SELECT id, amount_fcfa FROM technician_earnings WHERE technician_id = $1 AND status = 'approved' FOR UPDATE`,
      [req.params.id],
    );
    const total = lines.rows.reduce((sum, r) => sum + Number(r.amount_fcfa), 0);
    if (lines.rows.length === 0 || total <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Aucun gain validé à verser à ce technicien.' });
    }
    const payout = (
      await client.query(
        `INSERT INTO technician_payouts (technician_id, amount_fcfa, reference, note, paid_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, amount_fcfa, reference, paid_at`,
        [req.params.id, total, reference, note ?? null, req.auth!.sub],
      )
    ).rows[0];
    await client.query(`UPDATE technician_earnings SET status = 'paid', payout_id = $2 WHERE id = ANY($1::uuid[])`, [lines.rows.map((r) => r.id), payout.id]);
    await logAudit(client, { actorType: 'admin', actorId: req.auth!.sub, action: 'earning.paid_out', details: { technicianId: req.params.id, payoutId: payout.id, amountFcfa: total, earnings: lines.rows.length, reference } });
    await client.query('COMMIT');
    res.status(201).json({ payout: { ...payout, earnings: lines.rows.length }, balance: await balanceFor(pool, req.params.id!) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});
