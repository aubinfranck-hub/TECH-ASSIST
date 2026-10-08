import { describe, expect, it } from 'vitest';
import { consumeTokenFromHash, isAppMode } from '../src/lib/appMode.js';
import { createSseParser } from '../src/lib/sse.js';
import { startTechnicianStream, type StreamState } from '../src/lib/technicianStream.js';

describe('lecture du flux SSE', () => {
  it('assemble les événements coupés en morceaux et ignore les battements', () => {
    const p = createSseParser();
    expect(p.push(': ouvert\n\nevent: hel')).toEqual([]);
    expect(p.push('lo\ndata: {"a":1}\n\nevent: ping\ndata: {}\n\n')).toEqual([
      { event: 'hello', data: '{"a":1}' },
      { event: 'ping', data: '{}' },
    ]);
  });
  it('accepte les fins de ligne Windows', () => {
    expect(createSseParser().push('event: x\r\ndata: 1\r\n\r\n')).toEqual([{ event: 'x', data: '1' }]);
  });
});

describe('mode application', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const TOKEN = 'a'.repeat(30) + '.' + 'b'.repeat(30);

  it('#token=… : le jeton est enregistré et retiré de l’adresse (la demande à ouvrir reste)', () => {
    const s = store();
    const next = consumeTokenFromHash({ pathname: '/technicien', search: '?session=123', hash: `#token=${TOKEN}&x=1` }, s);
    expect(s.m.get('tech_assist_token')).toBe(TOKEN);
    expect(next).toBe('/technicien?session=123#x=1');
  });
  it('un jeton mal formé est ignoré', () => {
    const s = store();
    expect(consumeTokenFromHash({ pathname: '/technicien', search: '', hash: '#token=<script>' }, s)).toBeNull();
    expect(s.m.size).toBe(0);
  });
  it('?app=1 est retenu pour la suite de la session', () => {
    const s = store();
    expect(isAppMode({ pathname: '/technicien', search: '?app=1', hash: '' }, s)).toBe(true);
    expect(isAppMode({ pathname: '/technicien', search: '', hash: '' }, s)).toBe(true);
    expect(isAppMode({ pathname: '/', search: '', hash: '' }, store())).toBe(false);
  });
});

describe('flux technicien : connexion, événements, reconnexion', () => {
  const sse = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });

  it('transmet les événements, puis se reconnecte quand le flux se ferme', async () => {
    const events: string[] = [];
    const states: StreamState[] = [];
    let calls = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls++;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer T');
      return sse(`event: request\ndata: {"request":{"id":"s${calls}"}}\n\n`);
    }) as unknown as typeof fetch;
    const stop = startTechnicianStream({ base: 'http://x', token: 'T', fetchImpl, backoff: [5], onEvent: (e, d) => events.push(`${e}:${(d.request as { id: string }).id}`), onState: (s) => states.push(s) });
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(events.slice(0, 2)).toEqual(['request:s1', 'request:s2']);
    expect(states).toContain('retrying');
  });

  it('jeton refusé (401) : aucune nouvelle tentative', async () => {
    let calls = 0;
    const states: StreamState[] = [];
    const fetchImpl = (async () => {
      calls++;
      return new Response('{}', { status: 401 });
    }) as unknown as typeof fetch;
    const stop = startTechnicianStream({ base: 'http://x', token: 'T', fetchImpl, backoff: [5], onEvent: () => undefined, onState: (s) => states.push(s) });
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(calls).toBe(1);
    expect(states.at(-1)).toBe('unauthorized');
  });
});
