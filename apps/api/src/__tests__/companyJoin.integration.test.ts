import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { isWellFormedJoinCode, normalizeJoinCode } from '../utils/joinCodes.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

async function adminToken() {
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Admin', '+22500000010', 'admin_join', $1, 'admin')`,
    [await bcrypt.hash('secret123', 4)],
  );
  return (await request(app).post('/api/auth/technician/login').send({ username: 'admin_join', password: 'secret123' })).body.token as string;
}

async function company(name: string, username: string, phone: string) {
  const res = await request(app)
    .post('/api/admin/companies')
    .set('Authorization', `Bearer ${await adminToken().catch(async () => (await request(app).post('/api/auth/technician/login').send({ username: 'admin_join', password: 'secret123' })).body.token)}`)
    .send({ name, phone, subscriptionPlanId: 'pme_essentiel', adminFullName: 'Chef', adminPhone: `${phone.slice(0, -1)}1`, adminUsername: username });
  const login = await request(app).post('/api/auth/company/login').send({ username: res.body.adminUsername, password: res.body.adminPassword });
  return { companyId: res.body.companyId as string, token: login.body.token as string };
}

async function registerApp() {
  const email = `join${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email });
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1]!.text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `install-join-${Date.now()}-${++counter}-aaaaaaaa`, platform: 'windows', email, code, phone: '+2250700003333' });
  return { Authorization: `Bearer ${res.body.token as string}` };
}

describe('rattachement d’un PC à une entreprise', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('format du code : sans caractères ambigus, tolère espaces, tirets et minuscules', () => {
    expect(normalizeJoinCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(isWellFormedJoinCode('ABCDEFGHJK')).toBe(true);
    expect(isWellFormedJoinCode('ABCDE0GHJK')).toBe(false);
    expect(isWellFormedJoinCode('ABC')).toBe(false);
  });

  it('seul un administrateur d’entreprise génère un code ; il n’est pas stocké en clair', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    expect((await request(app).post('/api/company/join-codes')).status).toBe(401);
    const res = await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const stored = await pool.query('SELECT code_hash FROM company_join_codes');
    expect(stored.rows[0].code_hash).not.toContain(res.body.code.replace('-', ''));
  });

  it('parcours complet : code → rattachement → santé du poste visible dans la vue de parc', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const { code } = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c.token}`)).body;
    const auth = await registerApp();

    const joined = await request(app).post('/api/app/company/join').set(auth).send({ code: code.toLowerCase(), deviceName: 'PC-COMPTA-04' });
    expect(joined.status).toBe(201);
    expect(joined.body.companyName).toBe('Kassy SARL');

    const beat = await request(app).post('/api/app/company/heartbeat').set(auth).send({ diskFreePercent: 8, memoryUsedPercent: 70, antivirusOk: true, osUpToDate: false });
    expect(beat.status).toBe(202);

    const devices = await request(app).get('/api/company/devices').set('Authorization', `Bearer ${c.token}`);
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0]).toMatchObject({ device_name: 'PC-COMPTA-04', disk_free_percent: 8, antivirus_ok: true, os_up_to_date: false });
  });

  it('un code ne sert qu’une fois, et un mauvais code est refusé', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const { code } = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c.token}`)).body;
    const a = await registerApp();
    const b = await registerApp();
    expect((await request(app).post('/api/app/company/join').set(a).send({ code, deviceName: 'PC-1' })).status).toBe(201);
    expect((await request(app).post('/api/app/company/join').set(b).send({ code, deviceName: 'PC-2' })).status).toBe(400);
    expect((await request(app).post('/api/app/company/join').set(b).send({ code: 'AAAAA-BBBBB', deviceName: 'PC-2' })).status).toBe(400);
  });

  it('un code expiré est refusé', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const { code } = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c.token}`)).body;
    await pool.query(`UPDATE company_join_codes SET expires_at = now() - interval '1 minute'`);
    expect((await request(app).post('/api/app/company/join').set(await registerApp()).send({ code, deviceName: 'PC-1' })).status).toBe(400);
  });

  it('un PC déjà rattaché ne peut pas l’être à une autre entreprise', async () => {
    const c1 = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const c2 = await company('Autre SA', 'autre_admin', '+2250700008888');
    const code1 = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c1.token}`)).body.code;
    const code2 = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c2.token}`)).body.code;
    const auth = await registerApp();
    expect((await request(app).post('/api/app/company/join').set(auth).send({ code: code1, deviceName: 'PC-1' })).status).toBe(201);
    expect((await request(app).post('/api/app/company/join').set(auth).send({ code: code2, deviceName: 'PC-1' })).status).toBe(409);
    // le second code n'a pas été consommé
    const left = await pool.query('SELECT count(*)::int AS n FROM company_join_codes WHERE consumed_at IS NULL');
    expect(left.rows[0].n).toBe(1);
  });

  it('un nom de poste déjà pris restitue le code', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const token = `Bearer ${c.token}`;
    const first = (await request(app).post('/api/company/join-codes').set('Authorization', token)).body.code;
    const second = (await request(app).post('/api/company/join-codes').set('Authorization', token)).body.code;
    expect((await request(app).post('/api/app/company/join').set(await registerApp()).send({ code: first, deviceName: 'PC-1' })).status).toBe(201);
    const other = await registerApp();
    expect((await request(app).post('/api/app/company/join').set(other).send({ code: second, deviceName: 'PC-1' })).status).toBe(409);
    expect((await request(app).post('/api/app/company/join').set(other).send({ code: second, deviceName: 'PC-2' })).status).toBe(201);
  });

  it('la santé n’est acceptée que d’un PC rattaché ; valeurs invalides refusées', async () => {
    const auth = await registerApp();
    expect((await request(app).post('/api/app/company/heartbeat').set(auth).send({ diskFreePercent: 10 })).status).toBe(404);
    expect((await request(app).post('/api/app/company/heartbeat').set(auth).send({ diskFreePercent: 500 })).status).toBe(400);
    expect((await request(app).post('/api/app/company/heartbeat').send({ diskFreePercent: 10 })).status).toBe(401);
  });

  it('un PC rattaché à une entreprise à l’abonnement actif est couvert, même sans offre ni abonnement personnel', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const { code } = (await request(app).post('/api/company/join-codes').set('Authorization', `Bearer ${c.token}`)).body;
    const auth = await registerApp();
    await request(app).post('/api/app/company/join').set(auth).send({ code, deviceName: 'PC-COMPTA' });
    await pool.query('UPDATE app_installs SET free_offer_used_at = now()');

    // société pas encore active : refusé
    await pool.query("UPDATE companies SET subscription_status = 'trial'");
    expect((await request(app).post('/api/app/assistance').set(auth).send({ mode: 'humain' })).status).toBe(402);

    await pool.query("UPDATE companies SET subscription_status = 'active'");
    const me = await request(app).get('/api/app/me').set(auth);
    expect(me.body.entitlements.companyCovered).toBe(true);
    const res = await request(app).post('/api/app/assistance').set(auth).send({ mode: 'humain' });
    expect(res.status).toBe(201);
    expect(res.body.coverage).toBe('company');

    // un PC non rattaché n'est pas couvert
    const stranger = await registerApp();
    await pool.query('UPDATE app_installs SET free_offer_used_at = now()');
    expect((await request(app).post('/api/app/assistance').set(stranger).send({ mode: 'humain' })).status).toBe(402);
  });

  it('diagnostic à distance : demandé par l’administrateur, accepté ou refusé par le PC, résultat visible', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const adm = { Authorization: `Bearer ${c.token}` };
    const { code } = (await request(app).post('/api/company/join-codes').set(adm)).body;
    const auth = await registerApp();
    await request(app).post('/api/app/company/join').set(auth).send({ code, deviceName: 'PC-COMPTA' });
    const deviceId = (await request(app).get('/api/company/devices').set(adm)).body.devices[0].id;

    expect((await request(app).post(`/api/company/devices/${deviceId}/diagnostic`)).status).toBe(401);
    expect((await request(app).get('/api/app/company/requests')).status).toBe(401);
    expect((await request(app).get('/api/app/company/requests').set(auth)).body.request).toBeNull();

    const asked = await request(app).post(`/api/company/devices/${deviceId}/diagnostic`).set(adm);
    expect(asked.status).toBe(201);
    expect((await request(app).post(`/api/company/devices/${deviceId}/diagnostic`).set(adm)).status).toBe(409); // déjà en attente

    const pending = (await request(app).get('/api/app/company/requests').set(auth)).body.request;
    expect(pending).toMatchObject({ id: asked.body.request.id, companyName: 'Kassy SARL' });

    // un autre PC ne peut pas répondre à cette demande
    const stranger = await registerApp();
    expect((await request(app).post(`/api/app/company/requests/${pending.id}/answer`).set(stranger).send({ status: 'declined' })).status).toBe(404);

    const done = await request(app).post(`/api/app/company/requests/${pending.id}/answer`).set(auth).send({ status: 'done', worst: 'fixable', summary: '🟠 Disque : presque plein' });
    expect(done.status).toBe(200);
    expect((await request(app).post(`/api/app/company/requests/${pending.id}/answer`).set(auth).send({ status: 'declined' })).status).toBe(404); // déjà traitée
    expect((await request(app).get('/api/app/company/requests').set(auth)).body.request).toBeNull();

    const list = (await request(app).get('/api/company/diagnostics').set(adm)).body.diagnostics;
    expect(list[0]).toMatchObject({ device_name: 'PC-COMPTA', status: 'done', worst: 'fixable', summary: '🟠 Disque : presque plein' });

    // refus : rien n'est enregistré, et une nouvelle demande est possible
    await request(app).post(`/api/company/devices/${deviceId}/diagnostic`).set(adm);
    const second = (await request(app).get('/api/app/company/requests').set(auth)).body.request;
    await request(app).post(`/api/app/company/requests/${second.id}/answer`).set(auth).send({ status: 'declined', summary: 'ne doit pas être gardé' });
    const after = (await request(app).get('/api/company/diagnostics').set(adm)).body.diagnostics;
    expect(after[0]).toMatchObject({ status: 'declined', summary: null });
  });

  it('un employé ne peut pas demander de diagnostic', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const adm = { Authorization: `Bearer ${c.token}` };
    await request(app).post('/api/company/users').set(adm).send({ fullName: 'Employé', phone: '+2250700005555', username: 'emp1', password: 'motdepasse123', role: 'employee' });
    const emp = (await request(app).post('/api/auth/company/login').send({ username: 'emp1', password: 'motdepasse123' })).body.token;
    const res = await request(app).post('/api/company/devices/00000000-0000-0000-0000-000000000000/diagnostic').set('Authorization', `Bearer ${emp}`);
    expect(res.status).toBe(403);
  });

  it('action de groupe et réparation : une demande par poste rattaché, jamais deux en attente', async () => {
    const c = await company('Kassy SARL', 'kassy_admin', '+2250700009999');
    const adm = { Authorization: `Bearer ${c.token}` };
    const pcs: { Authorization: string }[] = [];
    for (const name of ['PC-1', 'PC-2']) {
      const { code } = (await request(app).post('/api/company/join-codes').set(adm)).body;
      const auth = await registerApp();
      await request(app).post('/api/app/company/join').set(auth).send({ code, deviceName: name });
      pcs.push(auth);
    }
    // un poste saisi à la main, sans programme : ignoré
    await request(app).post('/api/company/devices/heartbeat').set(adm).send({ deviceName: 'PC-MANUEL', platform: 'windows' });

    const first = await request(app).post('/api/company/devices/requests/all').set(adm).send({ kind: 'repair' });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(2);
    expect((await request(app).post('/api/company/devices/requests/all').set(adm).send({ kind: 'repair' })).body.created).toBe(0);

    const pending = (await request(app).get('/api/app/company/requests').set(pcs[0]!)).body.request;
    expect(pending.kind).toBe('repair');
    expect((await request(app).post('/api/company/devices/requests/all').send({})).status).toBe(401);
    expect((await request(app).post('/api/company/devices/requests/all').set(adm).send({ kind: 'format' })).status).toBe(400);
  });
});
