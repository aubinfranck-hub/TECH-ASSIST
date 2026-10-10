import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('Limiteurs de débit isolés par route sensible', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Le limiteur est ignoré quand NODE_ENV==='test' ; on simule un
    // environnement réel pour observer son comportement.
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("épuiser le quota d'une route ne bloque pas une route non liée sous le même préfixe /api", async () => {
    const app = createApp();

    // Plusieurs routers (diagnostics, sessions, remote, leads) sont tous
    // montés sur le préfixe générique '/api'. Un middleware de limitation
    // posé au niveau du montage app.use('/api', ...) s'exécuterait pour
    // TOUTE requête /api/*, y compris celles destinées à un autre router —
    // épuisant un quota partagé sans rapport avec la route réellement
    // appelée. Le correctif pose chaque limiteur directement sur sa route.
    for (let i = 0; i < 31; i++) {
      await request(app).post('/api/technicians/apply').send({});
    }
    const exhausted = await request(app).post('/api/technicians/apply').send({});
    expect(exhausted.status).toBe(429);

    // Une route sous un préfixe distinct (/api/auth) mais qui passe aussi
    // par le préfixe générique '/api' dans la chaîne de montage doit rester
    // utilisable.
    const login = await request(app)
      .post('/api/auth/technician/login')
      .send({ username: 'inconnu', password: 'x' });
    expect(login.status).not.toBe(429);

    // Un autre endpoint public sous le même préfixe '/api' générique
    // (diagnostics) doit lui aussi rester utilisable.
    const diagnostic = await request(app)
      .post('/api/orders/00000000-0000-0000-0000-000000000000/diagnostic')
      .send({ platform: 'windows', problemDescription: 'test' });
    expect(diagnostic.status).not.toBe(429);
  });
});
