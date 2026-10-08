import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { resetTtsHealthCache, speechText, synthesize, ttsHealth, ttsVoice, TtsError } from '../services/tts.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
const AUDIO = Buffer.from('ID3-faux-mp3-0123456789').toString('base64');
const google = (body: unknown = { audioContent: AUDIO }, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Voix : nettoyage du texte et appel Google Text-to-Speech', () => {
  it('retire mise en forme, émojis et adresses avant de lire', () => {
    const t = speechText('**Étape 1** : ouvrez *Outlook* 🤖\n- puis cliquez\n```cmd\nnet stop x\n```\nVoir https://exemple.com/aide. Merci !');
    expect(t).not.toMatch(/[*`#]|https?:|🤖|net stop/);
    expect(t).toContain('Étape 1');
    expect(t).toContain('cliquez');
  });

  it('coupe à une fin de phrase', () => {
    const long = 'Première phrase complète. '.repeat(100);
    const t = speechText(long, 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith('.')).toBe(true);
  });

  it('voix la plus naturelle par défaut (Chirp 3 HD), nom invalide ignoré', () => {
    expect(ttsVoice({})).toBe('fr-FR-Chirp3-HD-Aoede');
    expect(ttsVoice({ GOOGLE_TTS_VOICE: 'fr-FR-Chirp3-HD-Charon' })).toBe('fr-FR-Chirp3-HD-Charon');
    expect(ttsVoice({ GOOGLE_TTS_VOICE: "x'; drop" })).toBe('fr-FR-Chirp3-HD-Aoede');
  });

  it('la clé voyage en en-tête (jamais dans l’adresse) et la requête demande du MP3 en voix Neural2', async () => {
    const fetchImpl = vi.fn(async () => google());
    const out = await synthesize('Bonjour, voici la marche à suivre.', { env: { GOOGLE_TTS_API_KEY: 'cle-secrete-tts' }, fetchImpl });
    expect(out).toMatchObject({ audioBase64: AUDIO, mime: 'audio/mpeg', voice: 'fr-FR-Chirp3-HD-Aoede' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(url).not.toContain('cle-secrete-tts');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('cle-secrete-tts');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ voice: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' }, audioConfig: { audioEncoding: 'MP3' } });
    expect(sent.audioConfig.pitch).toBeUndefined(); // les voix Chirp refusent le réglage de hauteur
  });

  it('voix Chirp non offerte (400) : repli sur Neural2 ; clé refusée (403) : aucun repli inutile', async () => {
    const calls: string[] = [];
    const chirpRefused = vi.fn(async (_u: string, init: RequestInit) => {
      const name = JSON.parse(String(init.body)).voice.name as string;
      calls.push(name);
      return name.includes('Chirp') ? google({}, 400) : google();
    });
    const out = await synthesize('Bonjour à tous.', { env: { GOOGLE_TTS_API_KEY: 'k' }, fetchImpl: chirpRefused as unknown as typeof fetch });
    expect(out.voice).toBe('fr-FR-Neural2-A');
    expect(calls).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Neural2-A']);

    const forbidden = vi.fn(async () => google({}, 403));
    const err = await synthesize('Bonjour.', { env: { GOOGLE_TTS_API_KEY: 'k' }, fetchImpl: forbidden as unknown as typeof fetch }).catch((e) => e as TtsError);
    expect(err).toMatchObject({ code: 'forbidden' });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it('le statut fait un VRAI essai : on sait si la voix Google marche, pas seulement si une clé existe', async () => {
    resetTtsHealthCache();
    expect(await ttsHealth({ env: {}, fetchImpl: vi.fn() as unknown as typeof fetch })).toEqual({ available: false, reason: 'not_configured' });
    expect(await ttsHealth({ env: { GOOGLE_TTS_API_KEY: 'k' }, fetchImpl: (async () => google({}, 403)) as unknown as typeof fetch })).toEqual({ available: false, reason: 'forbidden' });
    expect(await ttsHealth({ env: { GOOGLE_TTS_API_KEY: 'k' }, fetchImpl: (async () => google()) as unknown as typeof fetch })).toEqual({ available: true, voice: 'fr-FR-Chirp3-HD-Aoede' });
  });

  it('utilise la clé Gemini en secours ; sans aucune clé : not_configured ; erreur Google : unavailable sans fuite', async () => {
    const ok = vi.fn(async () => google());
    await synthesize('Bonjour à tous.', { env: { GEMINI_API_KEY: 'cle-gemini' }, fetchImpl: ok });
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-goog-api-key': 'cle-gemini' });
    await expect(synthesize('Bonjour.', { env: {}, fetchImpl: ok })).rejects.toMatchObject({ code: 'not_configured' });
    const err = await synthesize('Bonjour.', { env: { GOOGLE_TTS_API_KEY: 'cle-secrete-tts' }, fetchImpl: async () => google({}, 500) }).catch((e) => e as TtsError);
    expect(err).toMatchObject({ code: 'unavailable' });
    expect(String((err as Error).message)).not.toContain('cle-secrete-tts');
  });
});

describe('Voix : routes du site et de l’application', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
    process.env.GOOGLE_TTS_API_KEY = 'cle-tts-test';
    resetTtsHealthCache();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.FREE_LAUNCH;
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterAll(async () => {
    await pool.end();
  });

  async function startSession() {
    const start = await request(app).post('/api/assistance/start').send({ clientPhone: '+2250700004321', platform: 'web', requestedMode: 'humain' });
    return { id: start.body.session.id as string, code: start.body.session.session_code as string };
  }

  it('le client lit une réponse à voix haute avec son code de session', async () => {
    const { id, code } = await startSession();
    vi.stubGlobal('fetch', vi.fn(async () => google()));
    const res = await request(app).post(`/api/sessions/${id}/tts`).send({ sessionCode: code, text: 'Redémarrez votre ordinateur.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ audio: AUDIO, mime: 'audio/mpeg', voice: 'fr-FR-Chirp3-HD-Aoede' });
    resetTtsHealthCache();
    expect((await request(app).get('/api/tts/status')).body).toEqual({ available: true, voice: 'fr-FR-Chirp3-HD-Aoede' });
  });

  it('refuse un mauvais code, et ne dit rien d’exploitable sans clé', async () => {
    const { id, code } = await startSession();
    expect((await request(app).post(`/api/sessions/${id}/tts`).send({ sessionCode: '000000000', text: 'Bonjour.' })).status).toBe(404);
    delete process.env.GOOGLE_TTS_API_KEY;
    resetTtsHealthCache();
    expect((await request(app).get('/api/tts/status')).body).toEqual({ available: false, reason: 'not_configured' });
    const res = await request(app).post(`/api/sessions/${id}/tts`).send({ sessionCode: code, text: 'Bonjour.' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('tts_not_configured');
  });

  it('Google en panne : 503 propre pour que l’interface retombe sur le texte', async () => {
    const { id, code } = await startSession();
    vi.stubGlobal('fetch', vi.fn(async () => google({}, 500)));
    const res = await request(app).post(`/api/sessions/${id}/tts`).send({ sessionCode: code, text: 'Bonjour.' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('tts_unavailable');
  });

  it('clé sans l’API Text-to-Speech activée : le dit (tts_forbidden) pour que l’interface ne se contente pas d’une voix de secours muette', async () => {
    const { id, code } = await startSession();
    vi.stubGlobal('fetch', vi.fn(async () => google({}, 403)));
    const res = await request(app).post(`/api/sessions/${id}/tts`).send({ sessionCode: code, text: 'Bonjour.' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('tts_forbidden');
  });

  it('l’application exige une installation authentifiée', async () => {
    expect((await request(app).post('/api/app/tts').send({ text: 'Bonjour.' })).status).toBe(401);
  });
});
