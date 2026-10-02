import { describe, expect, it } from 'vitest';
import { AppApi, readHardwareHash, signIn, startCovered, type AccountStore, type SavedAccount } from '../appAccount.js';
import { ScriptedConversation, ScriptedRunner } from './fakeScripts.js';

function memoryStore(initial: SavedAccount = { installId: 'install-0123456789abcdef' }): AccountStore & { data: SavedAccount } {
  const box = { data: initial } as AccountStore & { data: SavedAccount };
  box.load = () => box.data;
  box.save = (a) => {
    box.data = a;
  };
  return box;
}

type Route = (body: Record<string, unknown>, auth: string | null) => { status: number; json: unknown };
function fakeFetch(routes: Record<string, Route>, calls: { path: string; body: Record<string, unknown> }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ path, body });
    const route = routes[path];
    if (!route) return new Response('{}', { status: 404 });
    const headers = init?.headers as Record<string, string> | undefined;
    const r = route(body, headers?.Authorization ?? null);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
}

const ENT = { freeOfferAvailable: true, subscription: null, aiAgentAvailable: true };

describe('connexion par email', () => {
  it('envoie le code, inscrit l\'appareil et mémorise le jeton', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/email-code': () => ({ status: 200, json: { sent: true } }),
      '/app/register': () => ({ status: 201, json: { token: 'T1', entitlements: ENT } }),
    }, calls));
    const store = memoryStore();
    const ui = new ScriptedConversation({ asks: ['Franck@Exemple.com', '0707 12 34 56', '123456'] });
    const login = await signIn({ ui, api, store, hardwareHash: 'h'.repeat(64) });
    expect(login?.token).toBe('T1');
    expect(store.data.token).toBe('T1');
    expect(calls[0]).toEqual({ path: '/app/email-code', body: { email: 'franck@exemple.com' } });
    const reg = calls[1]!.body;
    expect(reg).toMatchObject({ platform: 'windows', email: 'franck@exemple.com', code: '123456', phone: '0707123456', installId: 'install-0123456789abcdef' });
    expect(reg.hardwareHash).toBe('h'.repeat(64));
  });

  it('réutilise le jeton enregistré sans redemander l\'email', async () => {
    const api = new AppApi('https://x.test', fakeFetch({ '/app/me': (_b, auth) => (auth === 'Bearer OLD' ? { status: 200, json: { email: 'a@b.co', entitlements: ENT } } : { status: 401, json: {} }) }));
    const ui = new ScriptedConversation();
    const login = await signIn({ ui, api, store: memoryStore({ installId: 'install-0123456789abcdef', token: 'OLD' }) });
    expect(login?.token).toBe('OLD');
    expect(ui.prompts).toEqual([]);
  });

  it('refuse une adresse invalide après trois essais, sans rien envoyer', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const api = new AppApi('https://x.test', fakeFetch({}, calls));
    const ui = new ScriptedConversation({ asks: ['abc', 'def', 'ghi'] });
    expect(await signIn({ ui, api, store: memoryStore() })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('redemande le code s\'il est faux, puis abandonne après trois essais', async () => {
    let tries = 0;
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/email-code': () => ({ status: 200, json: { sent: true } }),
      '/app/register': () => {
        tries++;
        return { status: 400, json: { error: 'Code invalide ou expiré.' } };
      },
    }));
    const ui = new ScriptedConversation({ asks: ['a@b.co', '0707123456', '111111', '222222', '333333'] });
    expect(await signIn({ ui, api, store: memoryStore() })).toBeNull();
    expect(tries).toBe(3);
    expect(ui.said).toContain('Code invalide');
  });

  it('s\'arrête sur une erreur définitive (déjà inscrit avec un autre email)', async () => {
    let tries = 0;
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/email-code': () => ({ status: 200, json: { sent: true } }),
      '/app/register': () => {
        tries++;
        return { status: 409, json: { error: 'Cette installation est déjà enregistrée avec une autre adresse email.' } };
      },
    }));
    const ui = new ScriptedConversation({ asks: ['a@b.co', '0707123456', '111111', '222222'] });
    expect(await signIn({ ui, api, store: memoryStore() })).toBeNull();
    expect(tries).toBe(1);
  });

  it('explique clairement quand le serveur est injoignable', async () => {
    const api = new AppApi('https://x.test', (async () => {
      throw new Error('réseau');
    }) as unknown as typeof fetch);
    const ui = new ScriptedConversation({ asks: ['a@b.co'] });
    expect(await signIn({ ui, api, store: memoryStore() })).toBeNull();
    expect(ui.said).toContain('Impossible de joindre Tech Assist');
  });
});

describe('démarrage de l\'assistance', () => {
  it('démarre l\'offerte après accord du client', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/assistance': () => ({ status: 201, json: { session: { id: 'S1' }, coverage: 'free_offer', fallbackToHuman: false } }),
    }));
    const ui = new ScriptedConversation({ picks: [0] });
    const started = await startCovered({ ui, api, store: memoryStore() }, { token: 'T', entitlements: ENT });
    expect(started).toMatchObject({ sessionId: 'S1', coverage: 'free_offer', token: 'T' });
  });

  it('ne consomme PAS l\'offerte si le client dit non', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const api = new AppApi('https://x.test', fakeFetch({}, calls));
    const ui = new ScriptedConversation({ picks: [1] });
    expect(await startCovered({ ui, api, store: memoryStore() }, { token: 'T', entitlements: ENT })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('abonné : démarre sans poser de question', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/assistance': () => ({ status: 201, json: { session: { id: 'S2' }, coverage: 'subscription', fallbackToHuman: true } }),
    }));
    const ui = new ScriptedConversation();
    const started = await startCovered({ ui, api, store: memoryStore() }, { token: 'T', entitlements: { ...ENT, freeOfferAvailable: false, subscription: { endsAt: '2099-01-01' } } });
    expect(started?.fallbackToHuman).toBe(true);
    expect(ui.choices).toEqual([]);
  });

  it('offerte déjà utilisée : propose l\'abonnement de 10 000 FCFA et l\'enregistre si accepté', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/subscribe': () => ({ status: 201, json: { order: { id: 'abcdef12-0000', amount_fcfa: 10000 } } }),
    }));
    const ui = new ScriptedConversation({ picks: [0] });
    const started = await startCovered({ ui, api, store: memoryStore() }, { token: 'T', entitlements: { ...ENT, freeOfferAvailable: false } });
    expect(started).toBeNull();
    expect(ui.said).toContain('10 000 FCFA');
    expect(ui.said).toContain('abcdef12');
  });
});

describe('empreinte de l\'appareil', () => {
  it('hache l\'identifiant machine (jamais envoyé en clair)', async () => {
    const runner = { runPowerShell: async () => ({ stdout: '{"id":"3F2504E0-4F89-11D3-9A0C-0305E82C3301"}', stderr: '', exitCode: 0 }) };
    const hash = await readHardwareHash(runner);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('3f2504e0');
  });
  it('rend undefined si la lecture échoue ou rend n\'importe quoi', async () => {
    expect(await readHardwareHash({ runPowerShell: async () => ({ stdout: '{"id":"; rm -rf"}', stderr: '', exitCode: 0 }) })).toBeUndefined();
    expect(await readHardwareHash({ runPowerShell: async () => { throw new Error('x'); } })).toBeUndefined();
  });
});

describe('demande de diagnostic de l’entreprise', () => {
  it('refus : rien n’est analysé ni envoyé, le refus est transmis', async () => {
    const { answerCompanyRequest } = await import('../appAccount.js');
    const answers: unknown[] = [];
    const api = { pendingRequest: async () => ({ id: 'r1', companyName: 'Kassy SARL' }), answerRequest: async (_t: string, _id: string, b: unknown) => { answers.push(b); return { ok: true }; } };
    const runner = new ScriptedRunner([]);
    const ui = new ScriptedConversation({ picks: [1] });
    expect(await answerCompanyRequest({ ui, api: api as never, runner }, 'tok')).toBe('declined');
    expect(answers).toEqual([{ status: 'declined' }]);
    expect(runner.calls).toHaveLength(0);
  });

  it('aucune demande : ne pose aucune question', async () => {
    const { answerCompanyRequest } = await import('../appAccount.js');
    const api = { pendingRequest: async () => null };
    const ui = new ScriptedConversation();
    expect(await answerCompanyRequest({ ui, api: api as never, runner: new ScriptedRunner([]) }, 'tok')).toBe('none');
    expect(ui.choices).toEqual([]);
  });

  it('accord : analyse en lecture seule puis résumé envoyé (une analyse qui échoue est signalée, pas cachée)', async () => {
    const { answerCompanyRequest } = await import('../appAccount.js');
    const answers: { status: string; worst?: string; summary?: string }[] = [];
    const api = { pendingRequest: async () => ({ id: 'r1', companyName: 'Kassy SARL' }), answerRequest: async (_t: string, _id: string, b: never) => { answers.push(b); return { ok: true }; } };
    const ui = new ScriptedConversation({ picks: [0] });
    expect(await answerCompanyRequest({ ui, api: api as never, runner: new ScriptedRunner([]) }, 'tok')).toBe('done');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.status).toBe('done');
    expect(answers[0]!.worst).toBe('unknown');
    expect(answers[0]!.summary).toMatch(/Analyse impossible/);
    expect(ui.said).toContain('Résumé envoyé à Kassy SARL');
  });
});
