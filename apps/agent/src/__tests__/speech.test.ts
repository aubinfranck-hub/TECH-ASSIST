import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatUi } from '../chatServer.js';
import { makeSpeaker } from '../speech.js';

const open: ChatUi[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((ui) => ui.close()));
});

function post(ui: ChatUi, path: string, body: unknown, token?: string): Promise<{ status: number; body: string }> {
  const url = new URL(ui.url);
  const t = token ?? url.searchParams.get('t')!;
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port: Number(url.port), path: `${path}?t=${encodeURIComponent(t)}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let out = '';
      res.on('data', (c: Buffer) => (out += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

describe('Voix de l’agent', () => {
  it('le serveur Tech Assist renvoie l’audio, jeton et corps vérifiés', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ audio: 'QUJD', mime: 'audio/mpeg' }), { status: 200 }));
    const speak = makeSpeaker('https://api.example.com/', 'jeton-app', fetchImpl as unknown as typeof fetch);
    expect(await speak('Bonjour, ouvrez Outlook.')).toEqual({ audio: 'QUJD', mime: 'audio/mpeg' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/app/tts');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-app');
  });

  it('hors ligne ou erreur serveur : null (la fenêtre lira avec la voix du navigateur)', async () => {
    expect(await makeSpeaker('https://x', 't', (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch)('Bonjour')).toBeNull();
    expect(await makeSpeaker('https://x', 't', (async () => { throw new Error('réseau'); }) as unknown as typeof fetch)('Bonjour')).toBeNull();
    expect(await makeSpeaker('https://x', 't', (async () => new Response(JSON.stringify({ audio: 'x', mime: 'text/html' }), { status: 200 })) as unknown as typeof fetch)('Bonjour')).toBeNull();
  });

  it('la fenêtre : /speak répond l’audio, 503 sans voix, 403 sans jeton', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    expect((await post(ui, '/speak', { text: 'Bonjour à tous, voici la marche à suivre.' })).status).toBe(503); // pas de voix configurée
    ui.speaker = async (text) => (text.includes('Bonjour') ? { audio: 'QUJD', mime: 'audio/mpeg' } : null);
    const ok = await post(ui, '/speak', { text: 'Bonjour à tous, voici la marche à suivre.' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ audio: 'QUJD', mime: 'audio/mpeg' });
    expect((await post(ui, '/speak', { text: 'autre' })).status).toBe(503);
    expect((await post(ui, '/speak', { text: 'Bonjour' }, 'mauvais-jeton')).status).toBe(403);
  });
});
