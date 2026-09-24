import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

async function createAdminToken() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Admin', '+22500000010', 'admin_company', $1, 'admin')`,
    [passwordHash],
  );
  const res = await request(app).post('/api/auth/technician/login').send({ username: 'admin_company', password: 'secret123' });
  return res.body.token as string;
}

async function createCompanyWithAdmin(adminToken: string) {
  const res = await request(app)
    .post('/api/admin/companies')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Kassy SARL',
      phone: '+2250700009999',
      subscriptionPlanId: 'pme_essentiel',
      adminFullName: 'Dirigeant Kassy',
      adminPhone: '+2250700009998',
      adminUsername: 'kassy_admin',
    });
  return res.body as { companyId: string; adminUsername: string; adminPassword: string };
}

async function loginCompany(username: string, password: string) {
  const res = await request(app).post('/api/auth/company/login').send({ username, password });
  return res.body.token as string;
}

describe('Espace PME (RP-01 à RP-09)', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('un admin crée une entreprise avec son premier compte administrateur', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    expect(company.companyId).toBeDefined();
    expect(company.adminPassword).toBeDefined();

    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);
    expect(companyToken).toBeDefined();

    const me = await request(app).get('/api/company/me').set('Authorization', `Bearer ${companyToken}`);
    expect(me.status).toBe(200);
    expect(me.body.company.name).toBe('Kassy SARL');
    expect(me.body.company.plan_name).toBe('PME Essentiel');
  });

  it('refuse la création d\'une entreprise avec une formule PME inconnue (au lieu d\'une erreur 500)', async () => {
    const adminToken = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test',
        phone: '+2250700009995',
        subscriptionPlanId: '',
        adminFullName: 'X',
        adminPhone: '+2250700009994',
        adminUsername: 'planinvalide',
      });
    expect(res.status).toBe(400); // rejeté par la validation zod (min(1)) avant même la vérification en base
  });

  it('refuse la création d\'une entreprise avec un identifiant de formule PME qui n\'existe pas', async () => {
    const adminToken = await createAdminToken();
    const res = await request(app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test',
        phone: '+2250700009993',
        subscriptionPlanId: 'plan_qui_n_existe_pas',
        adminFullName: 'Dirigeant Test',
        adminPhone: '+2250700009992',
        adminUsername: 'planinexistant',
      });
    expect(res.status).toBe(404);
  });

  it('refuse un identifiant de connexion déjà utilisé sans planter le serveur, sans laisser d\'entreprise orpheline', async () => {
    const adminToken = await createAdminToken();
    await createCompanyWithAdmin(adminToken); // crée 'kassy_admin'

    const dup = await request(app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Autre entreprise',
        phone: '+2250700009991',
        subscriptionPlanId: 'pme_essentiel',
        adminFullName: 'Autre Dirigeant',
        adminPhone: '+2250700009990',
        adminUsername: 'kassy_admin', // déjà pris
      });
    expect(dup.status).toBe(409);

    const companies = await pool.query('SELECT count(*) FROM companies WHERE name = $1', ['Autre entreprise']);
    expect(Number(companies.rows[0].count)).toBe(0);

    // Le serveur répond toujours normalement juste après.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });

  it('un jeton entreprise ne fonctionne pas sur les routes technicien/admin', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);

    const res = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${companyToken}`);
    expect(res.status).toBe(401);
  });

  it('un employé ne peut pas créer d\'autres comptes (réservé à l\'admin entreprise)', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);

    const employee = await request(app)
      .post('/api/company/users')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ fullName: 'Employé Un', phone: '+2250700009997', username: 'employe1', password: 'motdepasse123', role: 'employee' });
    expect(employee.status).toBe(201);

    const employeeToken = await loginCompany('employe1', 'motdepasse123');
    const forbidden = await request(app)
      .post('/api/company/users')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ fullName: 'X', phone: '+2250700009996', username: 'employe2', password: 'motdepasse123' });
    expect(forbidden.status).toBe(403);
  });

  it('le bouton "Demander de l\'aide" crée une session assistée réutilisant le moteur existant', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);

    const help = await request(app)
      .post('/api/company/help-requests')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ description: 'Imprimante réseau injoignable', priority: 'urgent' });
    expect(help.status).toBe(201);
    expect(help.body.session.session_code).toMatch(/^[0-9]{9}$/);

    // La session doit apparaître dans la file d'attente technicien avec le contexte PME.
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${adminToken}`);
    const entry = queue.body.queue.find((q: { session_code: string }) => q.session_code === help.body.session.session_code);
    expect(entry).toBeDefined();
    expect(entry.company_name).toBe('Kassy SARL');
    expect(entry.company_priority).toBe('urgent');
  });

  it('calcule un rapport mensuel basique (RP-07)', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);

    await request(app)
      .post('/api/company/help-requests')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ description: 'Problème réseau', priority: 'normal' });

    const report = await request(app).get('/api/company/report').set('Authorization', `Bearer ${companyToken}`);
    expect(report.status).toBe(200);
    expect(report.body.requestsThisMonth).toBe(1);
  });

  it('remonte les postes à risque dans l\'inventaire (RP-05)', async () => {
    const adminToken = await createAdminToken();
    const company = await createCompanyWithAdmin(adminToken);
    const companyToken = await loginCompany(company.adminUsername, company.adminPassword);

    await request(app)
      .post('/api/company/devices/heartbeat')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ deviceName: 'PC-Comptabilité', platform: 'windows', diskFreePercent: 3, antivirusOk: true, osUpToDate: true });

    const report = await request(app).get('/api/company/report').set('Authorization', `Bearer ${companyToken}`);
    expect(report.body.riskyDevices.length).toBe(1);
    expect(report.body.riskyDevices[0].device_name).toBe('PC-Comptabilité');

    // Un second appel avec le même nom de poste met à jour au lieu de dupliquer.
    await request(app)
      .post('/api/company/devices/heartbeat')
      .set('Authorization', `Bearer ${companyToken}`)
      .send({ deviceName: 'PC-Comptabilité', platform: 'windows', diskFreePercent: 50, antivirusOk: true, osUpToDate: true });
    const devices = await request(app).get('/api/company/devices').set('Authorization', `Bearer ${companyToken}`);
    expect(devices.body.devices.length).toBe(1);
    expect(devices.body.devices[0].disk_free_percent).toBe(50);
  });
});
