import { describe, expect, it } from 'vitest';
import { HttpAssistant, type ChatTurn } from '../assistant.js';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { impl, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpAssistant', () => {
  it('envoie le message et l’historique à la route de chat de la session, avec le jeton', async () => {
    const { impl, seen } = fakeFetch(() => json({ answer: '  Voici comment faire.  ' }));
    const assistant = new HttpAssistant('https://api.exemple.ci/', 'jeton-app', 'sess-1', impl);
    const history: ChatTurn[] = [{ role: 'user', text: 'Bonjour' }];
    const reply = await assistant.answer('Comment ajouter une signature ?', history);

    expect(reply).toEqual({ available: true, text: 'Voici comment faire.' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.exemple.ci/api/app/sessions/sess-1/chat');
    expect(seen[0]!.init.method).toBe('POST');
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-app');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ message: 'Comment ajouter une signature ?', history });
  });

  it('borne ce qu’il envoie : message à 1000 caractères, 8 derniers tours', async () => {
    const { impl, seen } = fakeFetch(() => json({ answer: 'ok' }));
    const history: ChatTurn[] = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `tour ${i}` }));
    await new HttpAssistant('http://x', 't', 's', impl).answer('a'.repeat(5000), history);
    const body = JSON.parse(String(seen[0]!.init.body)) as { message: string; history: ChatTurn[] };
    expect(body.message).toHaveLength(1000);
    expect(body.history).toHaveLength(8);
    expect(body.history[0]!.text).toBe('tour 4');
  });

  it.each([
    ['réponse HTTP 503', () => json({ code: 'assistant_unavailable' }, 503)],
    ['réponse HTTP 401', () => json({}, 401)],
    ['réponse sans « answer »', () => json({ autre: 1 })],
    ['réponse vide', () => json({ answer: '   ' })],
    ['réponse qui n’est pas du texte', () => json({ answer: 42 })],
    ['corps illisible', () => new Response('pas du json', { status: 200 })],
  ])('indisponible sur %s (jamais d’exception)', async (_label, respond) => {
    const { impl } = fakeFetch(respond);
    expect(await new HttpAssistant('http://x', 't', 's', impl).answer('question', [])).toEqual({ available: false });
  });

  it('indisponible quand le réseau échoue', async () => {
    const impl = (async () => {
      throw new Error('réseau coupé');
    }) as typeof fetch;
    expect(await new HttpAssistant('http://x', 't', 's', impl).answer('question', [])).toEqual({ available: false });
  });
});
