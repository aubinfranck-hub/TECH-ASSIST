import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('CORS_ORIGIN=*', () => {
  const original = process.env.CORS_ORIGIN;

  beforeEach(() => {
    process.env.CORS_ORIGIN = '*';
  });

  afterEach(() => {
    process.env.CORS_ORIGIN = original;
  });

  it('autorise réellement toute origine (pas seulement la chaîne littérale "*")', async () => {
    const app = createApp();
    const res = await request(app).get('/').set('Origin', 'https://claude.ai');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('autorise aussi une origine complètement différente', async () => {
    const app = createApp();
    const res = await request(app).get('/').set('Origin', 'https://n-importe-quel-site.example');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
