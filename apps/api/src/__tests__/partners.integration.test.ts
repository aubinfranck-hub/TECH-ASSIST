import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { generateTotpCode } from '../utils/totp.js';
import { applyMigrations, truncateAll, codeOf } from './testDb.js';

const app = createApp();
const PASSWORD = 'motdepasse-solide-1';
const SECRET = 'secret-webhook-test';
let counter = 0;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function account(role: 'admin' | 'technician', name: string) {
  const username = `${name}${++counter}`;
  const { rows } = await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`Tech ${name}`, `+22507${String(100000 + counter)}`, username, await bcrypt.hash(PASSWORD, 4), role],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username, password: PASSWORD });
  expect(login.status).toBe(200);
  return { id: rows[0].id as string, token: login.body.token as string, username };
}

/** Un partenaire inscrit, validé par l'admin, connecté (et avec la 2FA si demandé). */
async function partner(adminToken: string, opts: { twoFactor?: boolean; name?: string } = {}) {
  const username = `${opts.name ?? 'part'}${++counter}`;
  const reg = await request(app)
    .post('/api/partner/register')
    .send({ fullName: `Partenaire ${username}`, phone: `+22505${String(100000 + counter)}`, username, password: PASSWORD, businessName: 'Dépannage Express' });
  expect(reg.status).toBe(201);
  const id = (await pool.query('SELECT id FROM technicians WHERE username = $1', [username])).rows[0].id as string;
  const decision = await request(app).post(`/api/admin/partners/${id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' });
  expect(decision.status).toBe(200);
  const login = await request(app).post('/api/auth/technician/login').send({ username, password: PASSWORD });
  expect(login.status).toBe(200);
  const token = login.body.token as string;
  if (opts.twoFactor !== false) {
    const setup = await request(app).post('/api/auth/technician/2fa/setup').set(bearer(token));
    const enable = await request(app).post('/api/auth/technician/2fa/enable').set(bearer(token)).send({ code: generateTotpCode(setup.body.secret) });
    expect(enable.status).toBe(200);
  }
  return { id, token, username };
}

const jeko = (orderId: string, over: Record<string, unknown> = {}) => ({
  id: 'txn_viewer_1',
  status: 'success',
  amount: { amount: 500, currency: 'XOF' },
  transactionType: 'payment',
  storeId: 'store-1',
  transactionDetails: { reference: orderId },
  ...over,
});
function hook(payload: object) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('Jeko-Event', 'TRANSACTION_COMPLETED')
    .set('Jeko-Signature', createHmac('sha256', SECRET).update(body).digest('hex'))
    .send(body);
}

/** Le client du partenaire ouvre le code, appaire son poste et autorise le contrôle (parcours existant des sessions). */
async function clientJoins(code: string, sessionId: string, peerId = '123456789') {
  const boot = await request(app).get(`/api/sessions/${code}/remote-bootstrap`);
  expect(boot.status).toBe(200);
  const pair = await request(app).post(`/api/sessions/${sessionId}/pair`).send({ remotePeerId: peerId, remotePassword: 'mdp-distant-xyz', bootstrapToken: boot.body.bootstrapToken });
  expect(pair.status).toBe(201);
  const consent = await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'control', sessionCode: await codeOf(sessionId) });
  expect(consent.status).toBe(200);
}

const minutesAgo = (sessionId: string, seconds: number) =>
  pool.query(`UPDATE sessions SET viewer_connected_at = now() - make_interval(secs => $2) WHERE id = $1`, [sessionId, seconds]);

describe('Partenaires (viewer) : 3 minutes gratuites puis 500 FCFA la session', () => {
  let adminToken: string;

  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    await pool.query(`UPDATE pricing_plans SET price_fcfa = 500, active = TRUE WHERE id = 'viewer_session'`);
    process.env.RUSTDESK_ID_SERVER = 'id.example.com';
    process.env.RUSTDESK_RELAY_SERVER = 'relay.example.com';
    process.env.RUSTDESK_PUBLIC_KEY = 'cle-publique-test';
    process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
    process.env.JEKO_API_KEY = 'k';
    process.env.JEKO_API_KEY_ID = 'kid';
    process.env.JEKO_STORE_ID = 'store-1';
    process.env.PUBLIC_WEB_URL = 'https://site.example';
    adminToken = (await account('admin', 'admin')).token;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['PAYMENT_WEBHOOK_SECRET', 'JEKO_API_KEY', 'JEKO_API_KEY_ID', 'JEKO_STORE_ID', 'PUBLIC_WEB_URL', 'RUSTDESK_ID_SERVER', 'RUSTDESK_RELAY_SERVER', 'RUSTDESK_PUBLIC_KEY', 'VIEWER_FREE_SECONDS', 'VIEWER_GRACE_SECONDS', 'VIEWER_MAX_FREE_PER_DAY']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('compte partenaire', () => {
    it('une demande reste fermée jusqu’à la validation de l’administrateur', async () => {
      const username = `nouveau${++counter}`;
      const reg = await request(app).post('/api/partner/register').send({ fullName: 'Awa Koné', phone: '+2250701010101', username, password: PASSWORD });
      expect(reg.status).toBe(201);
      const row = (await pool.query('SELECT role, is_active, approval_status FROM technicians WHERE username = $1', [username])).rows[0];
      expect(row).toEqual({ role: 'partner', is_active: false, approval_status: 'pending' });

      const pending = await request(app).post('/api/auth/technician/login').send({ username, password: PASSWORD });
      expect(pending.status).toBe(403);
      expect(pending.body.code).toBe('pending_approval');
      // Un mauvais mot de passe ne révèle rien sur l'état du compte.
      const wrong = await request(app).post('/api/auth/technician/login').send({ username, password: 'faux-mot-de-passe' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error).toBe('Identifiants incorrects');

      const id = (await pool.query('SELECT id FROM technicians WHERE username = $1', [username])).rows[0].id;
      expect((await request(app).post(`/api/admin/partners/${id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' })).status).toBe(200);
      expect((await request(app).post('/api/auth/technician/login').send({ username, password: PASSWORD })).status).toBe(200);
      // Déjà validé : on ne « revalide » pas.
      expect((await request(app).post(`/api/admin/partners/${id}/decision`).set(bearer(adminToken)).send({ decision: 'approve' })).status).toBe(409);
    });

    it('refuse les demandes invalides ou en double', async () => {
      const ok = { fullName: 'Awa Koné', phone: '+2250701010102', username: `dup${++counter}`, password: PASSWORD };
      expect((await request(app).post('/api/partner/register').send({ ...ok, password: 'court' })).status).toBe(400);
      expect((await request(app).post('/api/partner/register').send({ ...ok, phone: 'abc' })).status).toBe(400);
      expect((await request(app).post('/api/partner/register').send({ ...ok, username: 'a b' })).status).toBe(400);
      expect((await request(app).post('/api/partner/register').send(ok)).status).toBe(201);
      expect((await request(app).post('/api/partner/register').send({ ...ok, phone: '+2250701010103' })).status).toBe(409);
    });

    it('un partenaire n’accède à aucune route du personnel ni de l’administration', async () => {
      const p = await partner(adminToken);
      for (const path of ['/api/technician/queue', '/api/technician/my-sessions', '/api/technician/alerts', '/api/technician/earnings', '/api/admin/partners', '/api/admin/earnings']) {
        const res = await request(app).get(path).set(bearer(p.token));
        expect(res.status, path).toBe(403);
      }
      // Et le personnel n'entre pas dans l'espace partenaire.
      const staff = await account('technician', 'staff');
      expect((await request(app).get('/api/partner/me').set(bearer(staff.token))).status).toBe(403);
      expect((await request(app).get('/api/partner/me')).status).toBe(401);
    });

    it('un compte suspendu perd l’accès immédiatement', async () => {
      const p = await partner(adminToken);
      expect((await request(app).get('/api/partner/me').set(bearer(p.token))).status).toBe(200);
      expect((await request(app).post(`/api/admin/partners/${p.id}/decision`).set(bearer(adminToken)).send({ decision: 'suspend' })).status).toBe(200);
      expect((await request(app).get('/api/partner/me').set(bearer(p.token))).status).toBe(403);
      expect((await request(app).post('/api/auth/technician/login').send({ username: p.username, password: PASSWORD })).status).toBe(401);
      expect((await request(app).post(`/api/admin/partners/${p.id}/decision`).set(bearer(adminToken)).send({ decision: 'reactivate' })).status).toBe(200);
      expect((await request(app).get('/api/partner/me').set(bearer(p.token))).status).toBe(200);
    });

    it('la double authentification est obligatoire avant d’ouvrir une session', async () => {
      const p = await partner(adminToken, { twoFactor: false });
      const res = await request(app).post('/api/partner/viewer-sessions').set(bearer(p.token)).send({ label: 'Boutique de Marie' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('two_factor_required');
    });

    it('l’offre affichée vient de la base (prix, durée gratuite)', async () => {
      const p = await partner(adminToken);
      const me = await request(app).get('/api/partner/me').set(bearer(p.token));
      expect(me.body.offer).toMatchObject({ freeSeconds: 180, priceFcfa: 500 });
      expect(me.body.offer.methods).toContain('wave');
      await pool.query(`UPDATE pricing_plans SET price_fcfa = 700 WHERE id = 'viewer_session'`);
      expect((await request(app).get('/api/partner/me').set(bearer(p.token))).body.offer.priceFcfa).toBe(700);
    });
  });

  describe('session viewer', () => {
    async function openSession(p: { token: string }, label = 'Cabinet Diallo') {
      const res = await request(app).post('/api/partner/viewer-sessions').set(bearer(p.token)).send({ label });
      expect(res.status).toBe(201);
      return res.body.session as { id: string; code: string; state: string };
    }

    it('parcours complet : le client autorise, 3 minutes gratuites, paiement de 500 FCFA, connexion libre', async () => {
      const p = await partner(adminToken);
      const s = await openSession(p);
      expect(s.code).toMatch(/^[0-9]{9}$/);
      expect(s.state).toBe('waiting_client');

      // Tant que le client n'a pas autorisé : aucune connexion.
      const early = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('waiting_client');
      expect(JSON.stringify(early.body)).not.toContain('mdp-distant-xyz');

      await clientJoins(s.code, s.id);
      const ready = await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token));
      expect(ready.body.session.state).toBe('ready');

      // Première connexion : les identifiants sont remis et la durée gratuite démarre.
      const first = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ remotePeerId: '123456789', remotePassword: 'mdp-distant-xyz', state: 'free' });
      expect(first.body.freeLeft).toBeGreaterThan(170);
      expect(first.body.freeLeft).toBeLessThanOrEqual(180);

      // Reconnexion pendant la durée gratuite : autorisée, sans repartir de zéro.
      await minutesAgo(s.id, 100);
      const again = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(again.status).toBe(200);
      expect(again.body.freeLeft).toBeLessThanOrEqual(80);

      // Durée gratuite écoulée, impayée : plus d'identifiants, le prix est annoncé.
      await minutesAgo(s.id, 200);
      const late = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(late.status).toBe(402);
      expect(late.body).toMatchObject({ code: 'payment_required', amountFcfa: 500 });
      expect(late.body.cutIn).toBeGreaterThan(0);
      expect(JSON.stringify(late.body)).not.toContain('mdp-distant-xyz');
      expect((await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token))).body.session.state).toBe('payment_required');

      // Paiement Jèko : la demande part pour 500 FCFA, la notification signée la confirme.
      const jekoFetch = vi.fn(async () => new Response(JSON.stringify({ id: 'pay_1', redirectUrl: 'https://pay.jeko.example/abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      vi.stubGlobal('fetch', jekoFetch);
      const pay = await request(app).post(`/api/partner/viewer-sessions/${s.id}/pay`).set(bearer(p.token)).send({ method: 'wave' });
      expect(pay.status).toBe(200);
      expect(pay.body.url).toBe('https://pay.jeko.example/abc');
      const sent = JSON.parse(((jekoFetch.mock.calls[0] as unknown[])[1] as { body: string }).body);
      expect(sent.amountCents).toBe(50000);
      const orderId = (await pool.query('SELECT order_id FROM sessions WHERE id = $1', [s.id])).rows[0].order_id as string;
      expect(sent.reference).toBe(orderId);

      const wrongAmount = await hook(jeko(orderId, { amount: { amount: 100, currency: 'XOF' } }));
      expect(wrongAmount.body.ok).toBe(false);
      expect((await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token))).body.session.state).toBe('payment_required');

      expect((await hook(jeko(orderId))).status).toBe(200);
      const paid = await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token));
      expect(paid.body.session).toMatchObject({ state: 'paid', paid: true });
      const reconnect = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(reconnect.status).toBe(200);
      expect(reconnect.body.remotePassword).toBe('mdp-distant-xyz');

      // Même bien plus tard, une session payée n'est pas coupée.
      await minutesAgo(s.id, 3600);
      expect((await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token))).status).toBe(200);
      const stop = await request(app).post(`/api/partner/viewer-sessions/${s.id}/stop`).set(bearer(p.token));
      expect(stop.status).toBe(200);
      expect((await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token))).body.session.state).toBe('ended');
      expect((await pool.query('SELECT remote_password_encrypted FROM sessions WHERE id = $1', [s.id])).rows[0].remote_password_encrypted).toBeNull();
      expect((await pool.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0].status).toBe('paid');
    });

    it('une session impayée est coupée à l’issue du délai de grâce, des deux côtés', async () => {
      const p = await partner(adminToken);
      const s = await openSession(p);
      await clientJoins(s.code, s.id);
      await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      const orderId = (await pool.query('SELECT order_id FROM sessions WHERE id = $1', [s.id])).rows[0].order_id as string;

      await minutesAgo(s.id, 180 + 61); // durée gratuite + délai de grâce dépassés
      // La fenêtre du client qui interroge la session suffit à faire respecter la coupure.
      const clientView = await request(app).get(`/api/sessions/${s.code}`);
      expect(clientView.body.session.status).toBe('completed');
      expect(clientView.body.session.kind).toBeUndefined();

      const row = (await pool.query('SELECT status, stopped_by, remote_password_encrypted FROM sessions WHERE id = $1', [s.id])).rows[0];
      expect(row).toEqual({ status: 'completed', stopped_by: 'system', remote_password_encrypted: null });
      expect((await pool.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0].status).toBe('cancelled');
      const connect = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(connect.status).toBe(409);
      expect(connect.body.code).toBe('ended');
      expect((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'viewer.cut_unpaid'`)).rows[0].n).toBe(1);
    });

    it('une session terminée pendant la durée gratuite ne coûte rien', async () => {
      const p = await partner(adminToken);
      const s = await openSession(p);
      await clientJoins(s.code, s.id);
      await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      const orderId = (await pool.query('SELECT order_id FROM sessions WHERE id = $1', [s.id])).rows[0].order_id as string;
      expect((await request(app).post(`/api/partner/viewer-sessions/${s.id}/stop`).set(bearer(p.token))).status).toBe(200);
      expect((await pool.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0].status).toBe('cancelled');
      expect((await request(app).post(`/api/partner/viewer-sessions/${s.id}/stop`).set(bearer(p.token))).status).toBe(409);
      // Arrêt par le client (bouton d'arrêt immédiat) : même résultat.
      const s2 = await openSession(p);
      const order2 = (await pool.query('SELECT order_id FROM sessions WHERE id = $1', [s2.id])).rows[0].order_id as string;
      await request(app).post(`/api/sessions/${s2.id}/stop`).send({ stoppedBy: 'client', sessionCode: await codeOf(s2.id) });
      expect((await pool.query('SELECT status FROM orders WHERE id = $1', [order2])).rows[0].status).toBe('cancelled');
    });

    it('un même poste n’a pas droit à une seconde durée gratuite dans la journée', async () => {
      const p = await partner(adminToken);
      const first = await openSession(p);
      await clientJoins(first.code, first.id, '555000111');
      expect((await request(app).post(`/api/partner/viewer-sessions/${first.id}/connect`).set(bearer(p.token))).status).toBe(200);
      await request(app).post(`/api/partner/viewer-sessions/${first.id}/stop`).set(bearer(p.token));

      const second = await openSession(p);
      await clientJoins(second.code, second.id, '555000111');
      const res = await request(app).post(`/api/partner/viewer-sessions/${second.id}/connect`).set(bearer(p.token));
      expect(res.status).toBe(402);
      expect(res.body.code).toBe('payment_required');
      const audit = (await pool.query(`SELECT details FROM audit_logs WHERE action = 'viewer.connected' AND session_id = $1`, [second.id])).rows[0];
      expect(audit.details).toMatchObject({ freeSeconds: 0, noFreeBecause: 'same_machine' });

      // Un autre poste, lui, a sa durée gratuite.
      const third = await openSession(p);
      await clientJoins(third.code, third.id, '999000222');
      expect((await request(app).post(`/api/partner/viewer-sessions/${third.id}/connect`).set(bearer(p.token))).status).toBe(200);
    });

    it('plafond quotidien de sessions gratuites par partenaire', async () => {
      process.env.VIEWER_MAX_FREE_PER_DAY = '2';
      const p = await partner(adminToken);
      const results: number[] = [];
      for (let i = 0; i < 3; i++) {
        const s = await openSession(p);
        await clientJoins(s.code, s.id, `70000000${i}`);
        results.push((await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token))).status);
        await request(app).post(`/api/partner/viewer-sessions/${s.id}/stop`).set(bearer(p.token));
      }
      expect(results).toEqual([200, 200, 402]);
    });

    it('durée gratuite et délai de grâce réglables', async () => {
      process.env.VIEWER_FREE_SECONDS = '60';
      process.env.VIEWER_GRACE_SECONDS = '0';
      const p = await partner(adminToken);
      const s = await openSession(p);
      await clientJoins(s.code, s.id);
      const first = await request(app).post(`/api/partner/viewer-sessions/${s.id}/connect`).set(bearer(p.token));
      expect(first.body.freeLeft).toBeLessThanOrEqual(60);
      await minutesAgo(s.id, 61);
      // Sans délai de grâce, la coupure est immédiate.
      expect((await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token))).body.session.state).toBe('ended');
    });

    it('au plus trois sessions ouvertes à la fois', async () => {
      const p = await partner(adminToken);
      for (let i = 0; i < 3; i++) await openSession(p);
      const res = await request(app).post('/api/partner/viewer-sessions').set(bearer(p.token)).send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('too_many_open');
    });

    it('une session n’appartient qu’à son partenaire', async () => {
      const a = await partner(adminToken, { name: 'alice' });
      const b = await partner(adminToken, { name: 'bruno' });
      const s = await openSession(a);
      await clientJoins(s.code, s.id);
      for (const [method, path] of [
        ['get', ''],
        ['post', '/connect'],
        ['post', '/stop'],
        ['post', '/pay'],
      ] as const) {
        const res = await request(app)[method](`/api/partner/viewer-sessions/${s.id}${path}`).set(bearer(b.token)).send({ method: 'wave' });
        expect(res.status, path).toBe(404);
      }
      expect((await request(app).get('/api/partner/viewer-sessions').set(bearer(b.token))).body.sessions).toEqual([]);
      expect((await request(app).get('/api/partner/viewer-sessions/pas-un-uuid').set(bearer(a.token))).status).toBe(404);
      // Le personnel non plus ne peut pas lire les identifiants d'une session de partenaire.
      const staff = await account('technician', 'staff');
      const creds = await request(app).get(`/api/technician/sessions/${s.id}/remote-credentials`).set(bearer(staff.token));
      expect(creds.status).toBe(403);
      expect(JSON.stringify(creds.body)).not.toContain('mdp-distant-xyz');
    });

    it('les sessions partenaires n’apparaissent ni dans la file du personnel, ni dans les tarifs, et ne se commandent pas', async () => {
      const p = await partner(adminToken);
      const s = await openSession(p);
      const staff = await account('technician', 'staff');
      expect((await request(app).get('/api/technician/queue').set(bearer(staff.token))).body.queue).toEqual([]);
      expect((await request(app).get('/api/orders/pending-payment').set(bearer(staff.token))).body.orders).toEqual([]);
      const plans = (await request(app).get('/api/pricing')).body.plans as { id: string }[];
      expect(plans.some((x) => x.id === 'viewer_session')).toBe(false);
      const order = await request(app).post('/api/orders').send({ clientPhone: '+2250700000000', planId: 'viewer_session' });
      expect(order.status).toBe(400);
      expect((await request(app).patch(`/api/technician/sessions/${s.id}/claim`).set(bearer(staff.token))).status).toBe(409);

      // Le personnel ne confirme pas le paiement d'une session partenaire à la main ; l'administrateur, si.
      const orderId = (await pool.query('SELECT order_id FROM sessions WHERE id = $1', [s.id])).rows[0].order_id as string;
      expect((await request(app).post(`/api/orders/${orderId}/confirm-payment`).set(bearer(staff.token))).status).toBe(403);
      expect((await request(app).post(`/api/orders/${orderId}/confirm-payment`).set(bearer(adminToken))).status).toBe(200);
      expect((await request(app).get(`/api/partner/viewer-sessions/${s.id}`).set(bearer(p.token))).body.session.state).toBe('paid');
    });

    it('sans Jèko configuré, le paiement en ligne est indisponible mais la référence est donnée', async () => {
      delete process.env.JEKO_API_KEY;
      const p = await partner(adminToken);
      const s = await openSession(p);
      const res = await request(app).post(`/api/partner/viewer-sessions/${s.id}/pay`).set(bearer(p.token)).send({ method: 'wave' });
      expect(res.status).toBe(503);
      expect(res.body.reference).toMatch(/^[0-9A-F]{8}$/);
    });

    it('l’historique du partenaire garde ses sessions, avec leur état', async () => {
      const p = await partner(adminToken);
      const a = await openSession(p, 'Boutique A');
      await request(app).post(`/api/partner/viewer-sessions/${a.id}/stop`).set(bearer(p.token));
      await openSession(p, 'Boutique B');
      const list = (await request(app).get('/api/partner/viewer-sessions').set(bearer(p.token))).body.sessions as { label: string; state: string; code: string | null }[];
      expect(list.map((x) => [x.label, x.state]).sort()).toEqual([['Boutique A', 'ended'], ['Boutique B', 'waiting_client']]);
      expect(list.find((x) => x.label === 'Boutique A')!.code).toBeNull(); // le code d'une session terminée n'est plus montré
    });
  });

  describe('gains des techniciens', () => {
    /** Une assistance « IA + technicien » payée, prise en charge puis terminée par le technicien. */
    async function finishedAssistance(staff: { id: string; token: string }, opts: { confirmedBy?: string; finish?: boolean } = {}) {
      const order = await request(app).post('/api/orders').send({ clientPhone: '+2250700000001', planId: 'assistance_rapide' });
      expect(order.status).toBe(201);
      const orderId = order.body.order.id as string;
      expect((await request(app).post(`/api/orders/${orderId}/confirm-payment`).set(bearer(opts.confirmedBy ?? adminToken))).status).toBe(200);
      const session = await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'web' });
      expect(session.status).toBe(201);
      const sessionId = session.body.session.id as string;
      expect((await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set(bearer(staff.token))).status).toBe(200);
      if (opts.finish !== false) expect((await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bearer(staff.token))).status).toBe(200);
      return { orderId, sessionId };
    }

    it('une assistance terminée crédite le technicien, une seule fois, en attente de validation', async () => {
      const staff = await account('technician', 'staff');
      const { sessionId } = await finishedAssistance(staff);
      const earnings = (await request(app).get('/api/technician/earnings').set(bearer(staff.token))).body;
      expect(earnings.balance).toEqual({ pending: 1000, approved: 0, paid: 0 });
      expect(earnings.earnings).toHaveLength(1);
      expect(earnings.earnings[0]).toMatchObject({ label: 'Assistance IA + technicien', amountFcfa: 1000, status: 'pending' });
      // L'arrêt de la session (bouton du client) après la fin ne crédite pas une seconde fois.
      await request(app).post(`/api/sessions/${sessionId}/stop`).send({ stoppedBy: 'client', sessionCode: await codeOf(sessionId) });
      expect((await pool.query('SELECT count(*)::int AS n FROM technician_earnings')).rows[0].n).toBe(1);
      expect((await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bearer(staff.token))).status).toBe(409);
      expect((await pool.query('SELECT count(*)::int AS n FROM technician_earnings')).rows[0].n).toBe(1);
    });

    it('le montant dépend du type d’assistance : complément et entreprise', async () => {
      const staff = await account('technician', 'staff');
      await pool.query(`UPDATE technician_pay_rates SET amount_fcfa = 1500 WHERE kind = 'complement'`);
      const { sessionId, orderId } = await finishedAssistance(staff, { finish: false });
      // Complément payé pour cette assistance : le technicien y est arrivé par le complément.
      await pool.query(`INSERT INTO orders (client_phone, plan_id, amount_fcfa, platform, status, upgrade_session_id) VALUES ('+2250700000001', 'complement_technicien', 1500, 'web', 'paid', $1)`, [sessionId]);
      await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bearer(staff.token));
      expect((await pool.query('SELECT kind, amount_fcfa FROM technician_earnings WHERE session_id = $1', [sessionId])).rows[0]).toEqual({ kind: 'complement', amount_fcfa: 1500 });

      const second = await finishedAssistance(staff, { finish: false });
      const company = await pool.query(`INSERT INTO companies (name, phone) VALUES ('Société Test', '+2250700000009') RETURNING id`);
      const user = await pool.query(`INSERT INTO company_users (company_id, full_name, phone, username, password_hash, role) VALUES ($1, 'Chef', '+2250700000008', 'chef-societe', 'x', 'admin') RETURNING id`, [company.rows[0].id]);
      await pool.query(`INSERT INTO company_help_requests (company_id, company_user_id, description, session_id) VALUES ($1, $2, 'Imprimante', $3)`, [company.rows[0].id, user.rows[0].id, second.sessionId]);
      await request(app).post(`/api/technician/sessions/${second.sessionId}/finish`).set(bearer(staff.token));
      expect((await pool.query('SELECT kind FROM technician_earnings WHERE session_id = $1', [second.sessionId])).rows[0].kind).toBe('entreprise');
      expect(orderId).toBeTruthy();
    });

    it('un administrateur ne se rémunère pas, une session partenaire ne rémunère personne', async () => {
      const admin = await account('admin', 'chef');
      await finishedAssistance(admin);
      expect((await pool.query('SELECT count(*)::int AS n FROM technician_earnings')).rows[0].n).toBe(0);
      const p = await partner(adminToken);
      const s = (await request(app).post('/api/partner/viewer-sessions').set(bearer(p.token)).send({})).body.session;
      await request(app).post(`/api/partner/viewer-sessions/${s.id}/stop`).set(bearer(p.token));
      expect((await pool.query('SELECT count(*)::int AS n FROM technician_earnings')).rows[0].n).toBe(0);
    });

    it('une assistance « IA seule » n’a pas de technicien : aucun gain', async () => {
      const staff = await account('technician', 'staff');
      const { sessionId } = await finishedAssistance(staff, { finish: false });
      await pool.query('UPDATE sessions SET human_included = FALSE WHERE id = $1', [sessionId]);
      await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bearer(staff.token));
      expect((await pool.query('SELECT count(*)::int AS n FROM technician_earnings')).rows[0].n).toBe(0);
    });

    it('l’administrateur voit de quoi décider : paiement confirmé par le technicien lui-même, messages, durée', async () => {
      const staff = await account('technician', 'staff');
      const { sessionId } = await finishedAssistance(staff, { confirmedBy: undefined, finish: false });
      await request(app).post(`/api/technician/sessions/${sessionId}/messages`).set(bearer(staff.token)).send({ body: 'Bonjour, je regarde.' });
      await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bearer(staff.token));
      const list = (await request(app).get('/api/admin/earnings?status=pending').set(bearer(adminToken))).body.earnings;
      expect(list).toHaveLength(1);
      expect(list[0].evidence).toMatchObject({ technicianMessages: 1, selfConfirmedPayment: false, clientPaidFcfa: 2000 });
      expect(list[0]).toMatchObject({ technician_name: 'Tech staff', label: 'Assistance IA + technicien' });

      // Le technicien qui confirme lui-même la commande qu'il traite.
      const self = await account('technician', 'self');
      await finishedAssistance(self, { confirmedBy: self.token });
      // Et il n'est pas crédité du tout : un technicien ne se rémunère pas sur sa propre confirmation.
      const flagged = (await request(app).get('/api/admin/earnings?status=pending').set(bearer(adminToken))).body.earnings.filter((e: { technician_id: string }) => e.technician_id === self.id);
      expect(flagged).toHaveLength(0);
    });

    it('validation, correction, rejet puis versement : le solde suit chaque étape', async () => {
      const staff = await account('technician', 'staff');
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) await finishedAssistance(staff);
      const list = (await request(app).get('/api/admin/earnings?status=pending').set(bearer(adminToken))).body.earnings as { id: string }[];
      expect(list).toHaveLength(3);
      ids.push(...list.map((e) => e.id));

      // Rien n'est versé sans validation.
      const early = await request(app).post(`/api/admin/technicians/${staff.id}/payouts`).set(bearer(adminToken)).send({ reference: 'WAVE-0001' });
      expect(early.status).toBe(409);

      // Correction (raison obligatoire), rejet, validation.
      expect((await request(app).post(`/api/admin/earnings/${ids[0]}/adjust`).set(bearer(adminToken)).send({ amountFcfa: 1500 })).status).toBe(400);
      expect((await request(app).post(`/api/admin/earnings/${ids[0]}/adjust`).set(bearer(adminToken)).send({ amountFcfa: 1500, note: 'Intervention longue' })).status).toBe(200);
      expect((await request(app).post(`/api/admin/earnings/${ids[2]}/cancel`).set(bearer(adminToken)).send({ note: 'Assistance non réalisée' })).status).toBe(200);
      const approve = await request(app).post('/api/admin/earnings/approve').set(bearer(adminToken)).send({ ids });
      expect(approve.body).toEqual({ approved: 2, skipped: 1 }); // le gain écarté n'est pas validé

      const mid = (await request(app).get('/api/technician/earnings').set(bearer(staff.token))).body;
      expect(mid.balance).toEqual({ pending: 0, approved: 2500, paid: 0 });
      expect(mid.earnings.some((e: { status: string }) => e.status === 'cancelled')).toBe(false);

      // Un gain validé ne se corrige plus (seulement s'écarte).
      expect((await request(app).post(`/api/admin/earnings/${ids[0]}/adjust`).set(bearer(adminToken)).send({ amountFcfa: 5, note: 'Triche' })).status).toBe(409);

      const balances = (await request(app).get('/api/admin/earnings/balances').set(bearer(adminToken))).body.balances;
      expect(balances[0]).toMatchObject({ id: staff.id, approved: 2500 });

      const payout = await request(app).post(`/api/admin/technicians/${staff.id}/payouts`).set(bearer(adminToken)).send({ reference: 'WAVE-0002', note: 'Versement de la semaine' });
      expect(payout.status).toBe(201);
      expect(payout.body.payout).toMatchObject({ amount_fcfa: 2500, reference: 'WAVE-0002', earnings: 2 });
      expect(payout.body.balance).toEqual({ pending: 0, approved: 0, paid: 2500 });
      // Jamais deux fois.
      expect((await request(app).post(`/api/admin/technicians/${staff.id}/payouts`).set(bearer(adminToken)).send({ reference: 'WAVE-0003' })).status).toBe(409);
      // Un gain versé ne s'écarte plus.
      expect((await request(app).post(`/api/admin/earnings/${ids[0]}/cancel`).set(bearer(adminToken)).send({ note: 'Trop tard' })).status).toBe(409);

      const final = (await request(app).get('/api/technician/earnings').set(bearer(staff.token))).body;
      expect(final.balance).toEqual({ pending: 0, approved: 0, paid: 2500 });
      expect(final.payouts).toHaveLength(1);
      expect(final.payouts[0]).toMatchObject({ amountFcfa: 2500, reference: 'WAVE-0002' });
      const actions = (await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'earning.%' ORDER BY action`)).rows.map((r) => r.action);
      expect(new Set(actions)).toEqual(new Set(['earning.credited', 'earning.adjusted', 'earning.cancelled', 'earning.approved', 'earning.paid_out']));
    });

    it('deux versements simultanés ne paient pas deux fois les mêmes gains', async () => {
      const staff = await account('technician', 'staff');
      for (let i = 0; i < 2; i++) await finishedAssistance(staff);
      const ids = ((await request(app).get('/api/admin/earnings').set(bearer(adminToken))).body.earnings as { id: string }[]).map((e) => e.id);
      await request(app).post('/api/admin/earnings/approve').set(bearer(adminToken)).send({ ids });
      const [a, b] = await Promise.all([
        request(app).post(`/api/admin/technicians/${staff.id}/payouts`).set(bearer(adminToken)).send({ reference: 'REF-A' }),
        request(app).post(`/api/admin/technicians/${staff.id}/payouts`).set(bearer(adminToken)).send({ reference: 'REF-B' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect((await pool.query('SELECT sum(amount_fcfa)::int AS total FROM technician_payouts')).rows[0].total).toBe(2000);
    });

    it('grille de rémunération : modifiable, n’affecte que les assistances à venir', async () => {
      const staff = await account('technician', 'staff');
      await finishedAssistance(staff);
      const put = await request(app).put('/api/admin/pay-rates/ia_technicien').set(bearer(adminToken)).send({ amountFcfa: 1200 });
      expect(put.status).toBe(200);
      await finishedAssistance(staff);
      const amounts = (await pool.query('SELECT amount_fcfa FROM technician_earnings ORDER BY created_at')).rows.map((r) => r.amount_fcfa);
      expect(amounts).toEqual([1000, 1200]);
      expect((await request(app).put('/api/admin/pay-rates/inconnu').set(bearer(adminToken)).send({ amountFcfa: 10 })).status).toBe(404);
      expect((await request(app).put('/api/admin/pay-rates/ia_technicien').set(bearer(adminToken)).send({ amountFcfa: -5 })).status).toBe(400);
      expect((await request(app).get('/api/admin/pay-rates').set(bearer(adminToken))).body.rates).toHaveLength(3);
    });

    it('le profil de versement du technicien (Mobile Money) est enregistré et visible de l’administrateur', async () => {
      const staff = await account('technician', 'staff');
      expect((await request(app).put('/api/technician/payout-profile').set(bearer(staff.token)).send({ phone: 'abc', operator: 'wave' })).status).toBe(400);
      expect((await request(app).put('/api/technician/payout-profile').set(bearer(staff.token)).send({ phone: '+2250707070707', operator: 'bitcoin' })).status).toBe(400);
      expect((await request(app).put('/api/technician/payout-profile').set(bearer(staff.token)).send({ phone: '+2250707070707', operator: 'wave' })).status).toBe(200);
      expect((await request(app).get('/api/technician/earnings').set(bearer(staff.token))).body.payout).toEqual({ phone: '+2250707070707', operator: 'wave' });
      await finishedAssistance(staff);
      const balances = (await request(app).get('/api/admin/earnings/balances').set(bearer(adminToken))).body.balances;
      expect(balances[0]).toMatchObject({ payout_phone: '+2250707070707', payout_operator: 'wave' });
    });

    it('un technicien ne voit que ses propres gains et ne peut rien valider', async () => {
      const a = await account('technician', 'alice');
      const b = await account('technician', 'bruno');
      await finishedAssistance(a);
      expect((await request(app).get('/api/technician/earnings').set(bearer(b.token))).body.earnings).toEqual([]);
      const id = (await pool.query('SELECT id FROM technician_earnings')).rows[0].id;
      expect((await request(app).post('/api/admin/earnings/approve').set(bearer(a.token)).send({ ids: [id] })).status).toBe(403);
      expect((await request(app).post(`/api/admin/technicians/${a.id}/payouts`).set(bearer(a.token)).send({ reference: 'REF-X' })).status).toBe(403);
    });
  });
});
