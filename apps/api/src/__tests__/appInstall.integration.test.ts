import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { createHmac } from 'node:crypto';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

let counter = 0;
const nextInstall = () => `install-${Date.now()}-${++counter}-aaaaaaaaaaaa`;

interface Registered {
  token: string;
  installId: string;
  email: string;
}

/** Parcours complet d'une inscription : demande de code → lecture de l'email → enregistrement. */
async function register(opts: { email?: string; hardwareHash?: string; installId?: string; phone?: string } = {}): Promise<Registered> {
  const email = opts.email ?? `client${++counter}@example.com`;
  const installId = opts.installId ?? nextInstall();
  testOutbox.length = 0;
  const codeRes = await request(app).post('/api/app/email-code').send({ email });
  expect(codeRes.status).toBe(200);
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
  const res = await request(app).post('/api/app/register').send({
    installId,
    platform: 'windows',
    email,
    code,
    phone: opts.phone ?? '+2250700001111',
    hardwareHash: opts.hardwareHash,
  });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, installId, email };
}

const auth = (r: Registered) => ({ Authorization: `Bearer ${r.token}` });

async function technicianToken() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Agent Test', '+22500000009', 'agent_test', $1, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [passwordHash],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username: 'agent_test', password: 'secret123' });
  return login.body.token as string;
}

async function subscribe(r: Registered) {
  const token = await technicianToken();
  const sub = await request(app).post('/api/app/subscribe').set(auth(r));
  expect(sub.status).toBe(201);
  const confirm = await request(app).post(`/api/orders/${sub.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${token}`);
  expect(confirm.status).toBe(200);
  return { token, order: sub.body.order, confirm };
}

describe('Application : inscription par email, assistance offerte en base, abonnement', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('code email et inscription', () => {
    it('refuse une inscription avec un mauvais code, et bloque après 5 essais', async () => {
      const email = 'bad@example.com';
      await request(app).post('/api/app/email-code').send({ email });
      const body = { installId: nextInstall(), platform: 'windows', email, phone: '+2250700001111' };
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/app/register').send({ ...body, code: '000000' });
        expect(res.status).toBe(400);
      }
      const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
      const locked = await request(app).post('/api/app/register').send({ ...body, code });
      expect(locked.status).toBe(429);
    });

    it('un code ne sert qu\'une fois', async () => {
      const r = await register({ email: 'once@example.com' });
      const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
      const again = await request(app).post('/api/app/register').send({
        installId: nextInstall(),
        platform: 'windows',
        email: r.email,
        code,
        phone: '+2250700001111',
      });
      expect(again.status).toBe(400);
    });

    it('refuse les adresses jetables', async () => {
      const res = await request(app).post('/api/app/email-code').send({ email: 'x@mailinator.com' });
      expect(res.status).toBe(400);
    });

    it('n\'enregistre pas le code en clair en base', async () => {
      await request(app).post('/api/app/email-code').send({ email: 'hash@example.com' });
      const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
      const { rows } = await pool.query('SELECT code_hash FROM email_verifications');
      expect(rows[0].code_hash).not.toContain(code);
      expect(rows[0].code_hash).toHaveLength(64);
    });

    it('refuse une installation déjà liée à une autre adresse', async () => {
      const installId = nextInstall();
      await register({ email: 'a@example.com', installId });
      testOutbox.length = 0;
      await request(app).post('/api/app/email-code').send({ email: 'b@example.com' });
      const code = /: ([0-9]{6})/.exec(testOutbox[0].text)![1];
      const res = await request(app).post('/api/app/register').send({
        installId,
        platform: 'windows',
        email: 'b@example.com',
        code,
        phone: '+2250700001111',
      });
      expect(res.status).toBe(409);
    });

    it('les routes de l\'application exigent un jeton valide', async () => {
      expect((await request(app).get('/api/app/me')).status).toBe(401);
      expect((await request(app).get('/api/app/me').set('Authorization', 'Bearer nimporte.quoi.xx')).status).toBe(401);
    });

    it('un jeton technicien n\'ouvre pas les routes de l\'application', async () => {
      const tech = await technicianToken();
      const res = await request(app).get('/api/app/me').set('Authorization', `Bearer ${tech}`);
      expect(res.status).toBe(401);
    });
  });

  describe('forfaits à l\'usage', () => {
    async function useFreeOffer(r: Registered) {
      expect((await request(app).post('/api/app/assistance').set(auth(r)).send({})).status).toBe(201);
    }

    it('commande, paiement confirmé par un technicien, puis assistance démarrée une seule fois', async () => {
      const r = await register();
      await useFreeOffer(r);
      const tech = await technicianToken();

      const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'assistance_rapide' });
      expect(order.status).toBe(201);
      expect(order.body.order.amount_fcfa).toBe(2000);
      expect(order.body.plan.scope).toBe('full');
      expect(order.body.payment.reference).toHaveLength(8);

      // Avant paiement : pas d'assistance.
      const early = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: order.body.order.id });
      expect(early.status).toBe(402);
      expect(early.body.code).toBe('payment_required');

      const status = await request(app).get(`/api/app/orders/${order.body.order.id}`).set(auth(r));
      expect(status.body.order.status).toBe('pending_payment');

      await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${tech}`).expect(200);
      expect((await request(app).get(`/api/app/orders/${order.body.order.id}`).set(auth(r))).body.order.status).toBe('paid');

      const me = await request(app).get('/api/app/me').set(auth(r));
      expect(me.body.entitlements.paidForfait).toMatchObject({ orderId: order.body.order.id, scope: 'full', humanIncluded: true });

      const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: order.body.order.id });
      expect(started.status).toBe(201);
      expect(started.body.coverage).toBe('paid_forfait');
      expect((await request(app).get('/api/app/me').set(auth(r))).body.entitlements.paidForfait).toBeNull();
      expect(started.body.scope).toBe('full');
      expect(started.body.humanIncluded).toBe(true);
      expect(started.body.session.duration_minutes).toBe(60);

      // Le forfait est consommé : impossible de le réutiliser.
      const again = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: order.body.order.id });
      expect(again.status).toBe(402);
    });

    it('l\'offre à 500 FCFA (IA seule) : portée complète, sans technicien', async () => {
      process.env.AI_AGENT_ENABLED = 'true';
      const r = await register();
      const tech = await technicianToken();
      const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'diagnostic_express' });
      expect(order.status).toBe(201);
      expect(order.body.plan.scope).toBe('full');
      await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${tech}`).expect(200);
      const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: order.body.order.id });
      expect(started.status).toBe(201);
      expect(started.body.scope).toBe('full');
      expect(started.body.humanIncluded).toBe(false);
      expect(started.body.session.mode).toBe('ia');
    });

    it('refuse les formules gratuites, abonnement et PME, et la commande d\'un autre appareil', async () => {
      const r = await register();
      for (const planId of ['assistance_offerte', 'abonnement_mensuel', 'assistance_abonne', 'pme_pro', 'inconnu']) {
        expect((await request(app).post('/api/app/orders').set(auth(r)).send({ planId })).status).toBe(404);
      }
      const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'assistance_rapide' });
      const other = await register();
      expect((await request(app).get(`/api/app/orders/${order.body.order.id}`).set(auth(other))).status).toBe(404);
      expect((await request(app).post('/api/app/assistance').set(auth(other)).send({ orderId: order.body.order.id })).status).toBe(402);
    });

    it('une nouvelle commande en attente remplace la précédente au lieu de s\'empiler', async () => {
      const r = await register();
      const a = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'assistance_rapide' });
      const b = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'diagnostic_express' });
      expect(b.body.order.id).toBe(a.body.order.id);
      expect(b.body.order.amount_fcfa).toBe(500);
    });
  });

  describe('paiement automatique Jèko', () => {
    const SECRET = 'whsec_test';
    const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
    const jeko = (orderId: string, over: Record<string, unknown> = {}) => ({
      id: 'txn_1',
      status: 'success',
      amount: { amount: 2000, currency: 'XOF' },
      transactionType: 'payment',
      storeId: 'store-1',
      paymentMethod: 'wave',
      transactionDetails: { reference: orderId },
      ...over,
    });
    const hook = (payload: object, signature?: string) => {
      const body = JSON.stringify(payload);
      return request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('Jeko-Event', 'TRANSACTION_COMPLETED')
        .set('Jeko-Signature', signature ?? sign(body))
        .send(body);
    };
    const configure = () => {
      process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
      process.env.JEKO_API_KEY = 'k';
      process.env.JEKO_API_KEY_ID = 'kid';
      process.env.JEKO_STORE_ID = 'store-1';
      process.env.PUBLIC_WEB_URL = 'https://site.example';
    };
    afterEach(() => {
      for (const k of ['PAYMENT_WEBHOOK_SECRET', 'JEKO_API_KEY', 'JEKO_API_KEY_ID', 'JEKO_STORE_ID', 'PUBLIC_WEB_URL']) delete process.env[k];
    });

    async function pendingOrder() {
      const r = await register();
      await request(app).post('/api/app/assistance').set(auth(r)).send({});
      const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'assistance_rapide' });
      return { r, order, id: order.body.order.id as string };
    }

    it('fermé tant qu\'aucun secret n\'est configuré', async () => {
      const { id } = await pendingOrder();
      expect((await hook(jeko(id))).status).toBe(503);
    });

    it('la commande propose les méthodes Jèko quand le paiement est configuré', async () => {
      configure();
      const { order } = await pendingOrder();
      expect(order.body.payment.automatic).toBe(true);
      expect(order.body.payment.methods).toEqual(['wave', 'orange', 'mtn', 'moov', 'djamo']);
    });

    it('crée le paiement chez Jèko en centimes avec la référence de la commande', async () => {
      configure();
      const { r, id } = await pendingOrder();
      const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
      const real = globalThis.fetch;
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ id: 'pr_1', redirectUrl: 'https://pay.jeko.africa/abc', status: 'pending' }), { status: 200 });
      }) as typeof fetch;
      try {
        const res = await request(app).post(`/api/app/orders/${id}/pay`).set(auth(r)).send({ method: 'wave' });
        expect(res.status).toBe(200);
        expect(res.body.url).toBe('https://pay.jeko.africa/abc');
        expect(seen[0]!.url).toBe('https://api.jeko.africa/partner_api/payment_requests');
        expect(seen[0]!.headers['X-API-KEY']).toBe('k');
        expect(seen[0]!.body).toMatchObject({ storeId: 'store-1', amountCents: 200000, currency: 'XOF', reference: id });
        expect((seen[0]!.body.paymentDetails as { data: { paymentMethod: string } }).data.paymentMethod).toBe('wave');
        expect((await request(app).post(`/api/app/orders/${id}/pay`).set(auth(r)).send({ method: 'bitcoin' })).status).toBe(400);
        const other = await register();
        expect((await request(app).post(`/api/app/orders/${id}/pay`).set(auth(other)).send({ method: 'wave' })).status).toBe(404);
      } finally {
        globalThis.fetch = real;
      }
    });

    it('notification signée, bon montant : commande payée, l\'assistance démarre sans technicien, rejeu sans effet', async () => {
      configure();
      const { r, id } = await pendingOrder();
      expect((await hook(jeko(id))).status).toBe(200);
      expect((await request(app).get(`/api/app/orders/${id}`).set(auth(r))).body.order.status).toBe('paid');
      expect((await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: id })).status).toBe(201);
      const replay = await hook(jeko(id));
      expect(replay.status).toBe(200);
      expect(replay.body.alreadyPaid).toBe(true);
    });

    it('mauvaise signature, mauvais montant, autre boutique, paiement en erreur : jamais payée', async () => {
      configure();
      const { r, id } = await pendingOrder();
      expect((await hook(jeko(id), 'deadbeef')).status).toBe(401);
      expect((await hook(jeko(id, { amount: { amount: 500, currency: 'XOF' } }))).body.ignored).toBe('montant');
      expect((await hook(jeko(id, { storeId: 'autre' }))).body.ignored).toBe('store');
      expect((await hook(jeko(id, { status: 'error' }))).body.ignored).toBe('error');
      expect((await request(app).get(`/api/app/orders/${id}`).set(auth(r))).body.order.status).toBe('pending_payment');
    });
  });

  describe('assistance offerte (retenue en base)', () => {
    it('offre la première assistance sans paiement, puis la base s\'en souvient', async () => {
      const r = await register();
      const me = await request(app).get('/api/app/me').set(auth(r));
      expect(me.body.entitlements.freeOfferAvailable).toBe(true);

      const first = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'humain' });
      expect(first.status).toBe(201);
      expect(first.body.coverage).toBe('free_offer');
      expect(first.body.order.amount_fcfa).toBe(0);
      expect(first.body.session.session_code).toMatch(/^[0-9]{9}$/);

      const { rows } = await pool.query('SELECT free_offer_used_at FROM app_installs');
      expect(rows[0].free_offer_used_at).not.toBeNull();

      const second = await request(app).post('/api/app/assistance').set(auth(r)).send({});
      expect(second.status).toBe(402);
      expect(second.body.code).toBe('subscription_required');
    });

    it('réinstaller l\'application avec la même adresse ne redonne pas l\'offre', async () => {
      const first = await register({ email: 'same@example.com' });
      await request(app).post('/api/app/assistance').set(auth(first)).send({});

      const reinstall = await register({ email: 'same@example.com' }); // nouvel installId
      const me = await request(app).get('/api/app/me').set(auth(reinstall));
      expect(me.body.entitlements.freeOfferAvailable).toBe(false);
      expect((await request(app).post('/api/app/assistance').set(auth(reinstall)).send({})).status).toBe(402);
    });

    it('une alias email (+tag, points Gmail) ne redonne pas l\'offre', async () => {
      const first = await register({ email: 'jean.dupont@gmail.com' });
      await request(app).post('/api/app/assistance').set(auth(first)).send({});
      const alias = await register({ email: 'jeandupont+promo@gmail.com' });
      expect((await request(app).post('/api/app/assistance').set(auth(alias)).send({})).status).toBe(402);
    });

    it('changer d\'adresse sur le même appareil ne redonne pas l\'offre (empreinte d\'appareil)', async () => {
      const hw = 'hardware-fingerprint-0123456789';
      const first = await register({ email: 'one@example.com', hardwareHash: hw });
      await request(app).post('/api/app/assistance').set(auth(first)).send({});
      const second = await register({ email: 'two@example.com', hardwareHash: hw });
      const res = await request(app).post('/api/app/assistance').set(auth(second)).send({});
      expect(res.status).toBe(402);
    });

    it('deux adresses et deux appareils différents ont chacun leur offre', async () => {
      const a = await register({ email: 'p@example.com', hardwareHash: 'hardware-aaaaaaaaaaaaaaaa' });
      const b = await register({ email: 'q@example.com', hardwareHash: 'hardware-bbbbbbbbbbbbbbbb' });
      expect((await request(app).post('/api/app/assistance').set(auth(a)).send({})).status).toBe(201);
      expect((await request(app).post('/api/app/assistance').set(auth(b)).send({})).status).toBe(201);
    });

    it('deux demandes simultanées ne donnent qu\'une seule offre', async () => {
      const r = await register();
      const [x, y] = await Promise.all([
        request(app).post('/api/app/assistance').set(auth(r)).send({}),
        request(app).post('/api/app/assistance').set(auth(r)).send({}),
      ]);
      expect([x.status, y.status].sort()).toEqual([201, 402]);
    });
  });

  describe('correctifs issus de la relecture indépendante', () => {
    it('la route publique ne fabrique pas de sessions supplémentaires à partir d\'une commande de l\'application', async () => {
      const r = await register();
      const first = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'humain' });
      expect(first.status).toBe(201);

      const extra = await request(app).post(`/api/orders/${first.body.order.id}/session`).send({ platform: 'web' });
      expect(extra.status).toBe(403);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions');
      expect(rows[0].n).toBe(1);
    });

    it('si la session ne peut pas être créée, l\'assistance offerte n\'est pas consommée', async () => {
      const r = await register();
      await pool.query(`UPDATE pricing_plans SET duration_minutes = NULL WHERE id = 'assistance_offerte'`);
      try {
        const failed = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'humain' });
        expect(failed.status).toBe(400);
      } finally {
        await pool.query(`UPDATE pricing_plans SET duration_minutes = 30 WHERE id = 'assistance_offerte'`);
      }
      const used = await pool.query('SELECT free_offer_used_at FROM app_installs');
      expect(used.rows[0].free_offer_used_at).toBeNull();
      const orders = await pool.query('SELECT count(*)::int AS n FROM orders');
      expect(orders.rows[0].n).toBe(0);

      const retry = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'humain' });
      expect(retry.status).toBe(201);
    });

    it('beaucoup de demandes simultanées ne bloquent pas l\'API (pas d\'attente croisée sur le pool de connexions)', async () => {
      const r = await register();
      const results = await Promise.all(
        Array.from({ length: 30 }, () => request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'humain' })),
      );
      const statuses = results.map((x) => x.status);
      expect(statuses.filter((x) => x === 201)).toHaveLength(1);
      expect(statuses.filter((x) => x === 402)).toHaveLength(29);
    }, 30_000);

    it('la première empreinte d\'appareil reste liée à l\'installation', async () => {
      const email = 'hash@example.com';
      const installId = nextInstall();
      await register({ email, installId, hardwareHash: 'hardware-hash-AAAAAAAAAAAA' });
      await register({ email, installId, hardwareHash: 'hardware-hash-BBBBBBBBBBBB' });
      const { rows } = await pool.query('SELECT hardware_hash FROM app_installs WHERE install_id = $1', [installId]);
      expect(rows[0].hardware_hash).toBe('hardware-hash-AAAAAAAAAAAA');
    });

    it('des essais de code en parallèle ne dépassent pas 5 essais', async () => {
      const email = 'race@example.com';
      await request(app).post('/api/app/email-code').send({ email });
      const attempts = await Promise.all(
        Array.from({ length: 15 }, () =>
          request(app).post('/api/app/register').send({
            installId: nextInstall(),
            platform: 'windows',
            email,
            code: '000000',
            phone: '+2250700001111',
          }),
        ),
      );
      expect(attempts.every((x) => x.status === 400 || x.status === 429)).toBe(true);
      const { rows } = await pool.query('SELECT attempts FROM email_verifications WHERE email = $1', [email]);
      expect(rows[0].attempts).toBe(5);
    });
  });

  describe('abonnement 10 000 FCFA / mois', () => {
    it('reste inactif tant que le paiement n\'est pas confirmé, puis couvre les assistances', async () => {
      const r = await register();
      await request(app).post('/api/app/assistance').set(auth(r)).send({}); // consomme l'offre

      const sub = await request(app).post('/api/app/subscribe').set(auth(r));
      expect(sub.body.order.amount_fcfa).toBe(10000);
      expect(sub.body.order.status).toBe('pending_payment');
      expect((await request(app).post('/api/app/assistance').set(auth(r)).send({})).status).toBe(402);

      const token = await technicianToken();
      const confirm = await request(app).post(`/api/orders/${sub.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${token}`);
      const days =
        (new Date(confirm.body.subscription.ends_at).getTime() - new Date(confirm.body.subscription.starts_at).getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);

      const first = await request(app).post('/api/app/assistance').set(auth(r)).send({});
      const second = await request(app).post('/api/app/assistance').set(auth(r)).send({});
      expect(first.status).toBe(201);
      expect(first.body.coverage).toBe('subscription');
      expect(second.status).toBe(201); // illimité pendant la période
    });

    it('l\'abonnement suit l\'adresse email : une réinstallation reste couverte', async () => {
      const r = await register({ email: 'abo@example.com' });
      await request(app).post('/api/app/assistance').set(auth(r)).send({});
      await subscribe(r);
      const reinstall = await register({ email: 'abo@example.com' });
      const res = await request(app).post('/api/app/assistance').set(auth(reinstall)).send({});
      expect(res.status).toBe(201);
      expect(res.body.coverage).toBe('subscription');
    });

    it('refuse l\'assistance quand l\'abonnement est expiré', async () => {
      const r = await register();
      await request(app).post('/api/app/assistance').set(auth(r)).send({});
      await subscribe(r);
      await pool.query(`UPDATE subscriptions SET ends_at = now() - interval '1 day'`);
      expect((await request(app).post('/api/app/assistance').set(auth(r)).send({})).status).toBe(402);
    });

    it('un renouvellement avant l\'échéance prolonge la période', async () => {
      const r = await register();
      await subscribe(r);
      const { confirm } = await subscribe(r);
      const days = (new Date(confirm.body.subscription.ends_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(59);
    });
  });

  describe('contournements et modes', () => {
    it('interdit de commander les formules internes via /api/orders', async () => {
      for (const planId of ['assistance_offerte', 'assistance_abonne', 'abonnement_mensuel']) {
        const res = await request(app).post('/api/orders').send({ clientPhone: '+2250700001111', planId });
        expect(res.status).toBe(400);
      }
    });

    it('masque les formules internes du catalogue public', async () => {
      const ids = (await request(app).get('/api/pricing')).body.plans.map((p: { id: string }) => p.id);
      expect(ids).toContain('abonnement_mensuel');
      expect(ids).not.toContain('assistance_offerte');
      expect(ids).not.toContain('assistance_abonne');
    });

    it('IA demandée mais agent non activé : repli sur un technicien, visible dans la file', async () => {
      const r = await register();
      const res = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'ia' });
      expect(res.body.session.mode).toBe('humain');
      expect(res.body.fallbackToHuman).toBe(true);
      const tech = await technicianToken();
      const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`);
      expect(queue.body.queue).toHaveLength(1);
    });

    it('IA par défaut quand l\'agent est activé : hors de la file des techniciens', async () => {
      process.env.AI_AGENT_ENABLED = 'true';
      const r = await register();
      const res = await request(app).post('/api/app/assistance').set(auth(r)).send({});
      expect(res.body.session.mode).toBe('ia');
      const tech = await technicianToken();
      const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`);
      expect(queue.body.queue).toHaveLength(0);
    });
  });

  describe('journal des actions de l\'agent', () => {
    async function startedSession() {
      process.env.AI_AGENT_ENABLED = 'true';
      const r = await register();
      const res = await request(app).post('/api/app/assistance').set(auth(r)).send({});
      return { r, sessionId: res.body.session.id as string };
    }

    it('enregistre chaque étape dans le journal d\'audit', async () => {
      const { r, sessionId } = await startedSession();
      const ev = await request(app)
        .post(`/api/app/sessions/${sessionId}/events`)
        .set(auth(r))
        .send({ type: 'action_approved', skill: 'sound', action: 'unmute', message: 'Le client accepte' });
      expect(ev.status).toBe(201);
      const { rows } = await pool.query(`SELECT action, details FROM audit_logs WHERE action = 'agent.action_approved'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].details.skill).toBe('sound');
    });

    it('refuse un événement sur la session d\'un autre client', async () => {
      const { sessionId } = await startedSession();
      const other = await register({ email: 'intrus@example.com' });
      const ev = await request(app)
        .post(`/api/app/sessions/${sessionId}/events`)
        .set(auth(other))
        .send({ type: 'action_done', skill: 'sound' });
      expect(ev.status).toBe(404);
    });

    it('refuse un type d\'événement inconnu', async () => {
      const { r, sessionId } = await startedSession();
      const ev = await request(app).post(`/api/app/sessions/${sessionId}/events`).set(auth(r)).send({ type: 'rm_rf', skill: 'sound' });
      expect(ev.status).toBe(400);
    });

    it('« escalated » fait passer la session à un technicien', async () => {
      const { r, sessionId } = await startedSession();
      await request(app).post(`/api/app/sessions/${sessionId}/events`).set(auth(r)).send({ type: 'escalated', skill: 'sound' });
      const tech = await technicianToken();
      const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`);
      expect(queue.body.queue).toHaveLength(1);
    });
  });


  describe('inscription sans code (EMAIL_VERIFICATION=off)', () => {
    it("enregistre l'email tel que saisi, sans envoi de code", async () => {
      process.env.EMAIL_VERIFICATION = 'off';
      try {
        testOutbox.length = 0;
        const ask = await request(app).post('/api/app/email-code').send({ email: 'sans-code@example.com' });
        expect(ask.status).toBe(200);
        expect(ask.body.verification).toBe(false);
        expect(testOutbox).toHaveLength(0);
        const res = await request(app).post('/api/app/register').send({
          installId: nextInstall(),
          platform: 'windows',
          email: 'sans-code@example.com',
          phone: '+2250700002222',
        });
        expect(res.status).toBe(201);
        expect(res.body.token).toBeTruthy();
      } finally {
        delete process.env.EMAIL_VERIFICATION;
      }
    });
    it('exige toujours le code quand la vérification est active', async () => {
      const res = await request(app).post('/api/app/register').send({
        installId: nextInstall(),
        platform: 'windows',
        email: 'avec-code@example.com',
        phone: '+2250700003333',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('lancement gratuit (FREE_LAUNCH)', () => {
    it("offre chaque assistance sans consommer l'offre", async () => {
      process.env.FREE_LAUNCH = 'true';
      try {
        const r = await register();
        for (let i = 0; i < 2; i += 1) {
          const res = await request(app).post('/api/app/assistance').set(auth(r)).send({});
          expect(res.status).toBe(201);
          expect(res.body.coverage).toBe('free_offer');
        }
      } finally {
        delete process.env.FREE_LAUNCH;
      }
    });
  });
});
