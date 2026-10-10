import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { AppApi, humanAccessFor, startCovered, type StartedSession } from '../appAccount.js';
import { ChatUi } from '../chatServer.js';
import { converse } from '../conversation.js';
import { ensureHuman, HUMAN_REQUEST_TEXT, type HumanAccess } from '../humanAccess.js';
import { CompositeReporter, HttpReporter } from '../reporters.js';
import { repairMyPc } from '../repairPc.js';
import type { Diagnosis, Reporter, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner } from './fakeScripts.js';

/** Reporter qui sait si un technicien fait partie de l'offre (comme `HttpReporter`). */
class HumanReporter extends Recorder {
  constructor(readonly human: HumanAccess) {
    super();
  }
}

const diagnosis = (patch: Partial<Diagnosis> = {}): Diagnosis => ({ summary: 'Tout va bien.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...patch });
const needsHuman = (id = 'sound'): Skill => ({ id, title: id, verifyQuestion: '?', diagnose: async () => diagnosis({ healthy: false, needsHuman: true, summary: 'Matériel défectueux' }) });

describe('ensureHuman', () => {
  const ui = () => {
    const infos: string[] = [];
    return { infos, info: (m: string) => void infos.push(m) };
  };

  it('aucune information (tests, anciens serveurs) ou technicien inclus : passe sans rien dire', async () => {
    const a = ui();
    expect(await ensureHuman({}, a)).toBe(true);
    expect(await ensureHuman({ human: { included: true } }, a)).toBe(true);
    expect(a.infos).toEqual([]);
  });

  it('offre sans technicien et complément refusé : le dit honnêtement, et refuse le passage de main', async () => {
    const a = ui();
    const human: HumanAccess = { included: false, offerUpgrade: async () => false };
    expect(await ensureHuman({ human }, a)).toBe(false);
    expect(a.infos.join(' ')).toMatch(/n'en comprend pas/);
    expect(a.infos.join(' ')).toMatch(/je reste avec vous/i);
    expect(human.included).toBe(false);
  });

  it('offre sans technicien et aucun moyen de payer : refuse sans planter', async () => {
    expect(await ensureHuman({ human: { included: false } }, ui())).toBe(false);
  });

  it('complément payé : le technicien est désormais inclus, et ne sera plus redemandé', async () => {
    const a = ui();
    let asked = 0;
    const human: HumanAccess = { included: false, offerUpgrade: async () => (asked++, true) };
    expect(await ensureHuman({ human }, a)).toBe(true);
    expect(human.included).toBe(true);
    expect(await ensureHuman({ human }, a)).toBe(true);
    expect(asked).toBe(1);
  });
});

describe('agent — passage de main selon l’offre', () => {
  it('offre IA seule : aucun « Je passe la main », le client est informé, rien n’est prétendu', async () => {
    const reporter = new HumanReporter({ included: false });
    const ui = new ScriptedConversation();
    const out = await runSkill(needsHuman(), { runner: new ScriptedRunner([]), ui, reporter });
    expect(out).toMatchObject({ status: 'escalated', recorded: false });
    expect(ui.said).toMatch(/n'en comprend pas/);
    expect(ui.said).not.toMatch(/Je passe la main/);
    expect(reporter.types).toContain('escalated'); // la demande est notée pour le journal
  });

  it('offre IA seule + complément payé : le technicien est prévenu', async () => {
    const reporter = new HumanReporter({ included: false, offerUpgrade: async () => true });
    const ui = new ScriptedConversation();
    const out = await runSkill(needsHuman(), { runner: new ScriptedRunner([]), ui, reporter });
    expect(out).toMatchObject({ status: 'escalated', recorded: true });
    expect(ui.said).toMatch(/Je passe la main à un technicien/);
  });

  it('technicien inclus : comportement habituel', async () => {
    const reporter = new HumanReporter({ included: true });
    const ui = new ScriptedConversation();
    const out = await runSkill(needsHuman(), { runner: new ScriptedRunner([]), ui, reporter });
    expect(out).toMatchObject({ status: 'escalated', recorded: true });
    expect(ui.said).not.toMatch(/n'en comprend pas/);
  });
});

describe('conversation — « Parler à un technicien »', () => {
  it('offre IA seule : la conversation continue (pas de passage de main) tant que le complément n’est pas payé', async () => {
    const reporter = new HumanReporter({ included: false });
    const ui = new ScriptedConversation({ asks: [HUMAN_REQUEST_TEXT, null] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter });
    expect(out.handedOver).toBe(false);
    expect(ui.prompts.length).toBe(2); // la conversation a continué
    expect(ui.said).toMatch(/n'en comprend pas/);
    expect(ui.said).not.toMatch(/Je passe la main/);
  });

  it('offre IA seule + complément payé : le technicien prend la main', async () => {
    const reporter = new HumanReporter({ included: false, offerUpgrade: async () => true });
    const ui = new ScriptedConversation({ asks: [HUMAN_REQUEST_TEXT] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter });
    expect(out.handedOver).toBe(true);
    expect(reporter.events.some((e) => e.type === 'escalated' && e.message === 'Le client demande un technicien')).toBe(true);
  });

  it('technicien inclus : la demande passe la main tout de suite', async () => {
    const reporter = new HumanReporter({ included: true });
    const ui = new ScriptedConversation({ asks: [HUMAN_REQUEST_TEXT] });
    expect((await converse({ runner: new ScriptedRunner([]), ui, reporter })).handedOver).toBe(true);
  });
});

describe('RÉPARER MON PC — offre sans technicien', () => {
  it('l’enregistreur interne garde l’information : le complément est proposé, pas de passage de main en douce', async () => {
    const reporter = new HumanReporter({ included: false });
    const ui = new ScriptedConversation({ picks: [1] });
    const out = await repairMyPc({ runner: new ScriptedRunner([]), ui, reporter }, [{ id: 'sound', label: 'Son', build: () => needsHuman() }]);
    expect(out.escalated).toBe(false);
    expect(ui.said).toMatch(/n'en comprend pas/);
    expect(ui.said).not.toMatch(/Je passe la main/);
  });
});

describe('HttpReporter — l’information vient du serveur', () => {
  const answer = (body: unknown, status = 201) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('le serveur dit « pas de technicien » : l’agent le sait, même si l’offre annonçait le contraire', async () => {
    const human: HumanAccess = { included: true };
    await new HttpReporter('https://x', 't', 's', answer({ recorded: true, humanIncluded: false }), human).event({ type: 'escalated', message: 'x' });
    expect(human.included).toBe(false);
  });

  it('une réponse normale ou sans information ne change rien', async () => {
    const human: HumanAccess = { included: true };
    await new HttpReporter('https://x', 't', 's', answer({ id: 1 }), human).event({ type: 'escalated', message: 'x' });
    await new HttpReporter('https://x', 't', 's', (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, human).event({ type: 'escalated', message: 'x' });
    expect(human.included).toBe(true);
  });

  it('seul l’événement « escalated » est concerné', async () => {
    const human: HumanAccess = { included: true };
    await new HttpReporter('https://x', 't', 's', answer({ humanIncluded: false }), human).event({ type: 'diagnosed', message: 'x' });
    expect(human.included).toBe(true);
  });

  it('le reporter composite expose celui de son destinataire HTTP', () => {
    const human: HumanAccess = { included: false };
    const http = new HttpReporter('https://x', 't', 's', answer({}), human);
    const plain: Reporter = { event: async () => undefined };
    expect(new CompositeReporter([plain, http]).human).toBe(human);
    expect(new CompositeReporter([plain]).human).toBeUndefined();
  });
});

describe('startCovered / humanAccessFor', () => {
  type Call = { path: string; body: Record<string, unknown> };
  const fakeFetch = (routes: Record<string, (b: Record<string, unknown>) => { status: number; json: unknown }>, calls: Call[] = []) =>
    (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ path, body });
      const route = routes[path];
      if (!route) return new Response('{}', { status: 404 });
      const r = route(body);
      return new Response(JSON.stringify(r.json), { status: r.status });
    }) as unknown as typeof fetch;
  const ENT = { freeOfferAvailable: false, subscription: null, aiAgentAvailable: true };
  const noWait = { wait: async () => undefined, pollMs: 1, maxWaitMs: 3 };

  it('forfait 500 FCFA : la session démarre « sans technicien », avec le prix du complément', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/orders': () => ({ status: 201, json: { order: { id: 'o1', amount_fcfa: 500 }, plan: { name: 'Assistance IA', scope: 'full' }, payment: { amountFcfa: 500, reference: 'R1', instructions: 'Payez.' } } }),
      '/app/orders/o1': () => ({ status: 200, json: { order: { status: 'paid', used: false } } }),
      '/app/assistance': () => ({ status: 201, json: { session: { id: 'S1' }, coverage: 'paid_forfait', scope: 'full', fallbackToHuman: false, humanIncluded: false, upgrade: { planId: 'complement_technicien', priceFcfa: 1500 } } }),
    }));
    const ui = new ScriptedConversation({ picks: [0] });
    const started = await startCovered({ ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait }, { token: 'T', entitlements: ENT });
    expect(started).toMatchObject({ sessionId: 'S1', humanIncluded: false, upgradeFcfa: 1500 });
    const access = humanAccessFor({ ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait }, started!);
    expect(access).toMatchObject({ included: false, upgradeFcfa: 1500 });
    expect(typeof access.offerUpgrade).toBe('function');
  });

  it('forfait 2 000 FCFA, offerte, abonné : technicien inclus, aucun complément à proposer', async () => {
    const started: StartedSession = { token: 'T', sessionId: 'S', scope: 'full', coverage: 'paid_forfait', fallbackToHuman: false, humanIncluded: true };
    const access = humanAccessFor({ ui: new ScriptedConversation(), api: new AppApi('https://x.test', fakeFetch({})), store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined } }, started);
    expect(access).toEqual({ included: true });
  });

  it('un serveur qui ne dit rien (ancienne version) : le technicien est considéré inclus', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/assistance': () => ({ status: 201, json: { session: { id: 'S2' }, coverage: 'subscription', fallbackToHuman: true } }),
    }));
    const started = await startCovered({ ui: new ScriptedConversation(), api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined } }, { token: 'T', entitlements: { ...ENT, subscription: { endsAt: '2099-01-01' } } });
    expect(started?.humanIncluded).toBe(true);
  });

  it('complément : propose, crée la commande sur la session, attend le paiement puis confirme', async () => {
    const calls: Call[] = [];
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/sessions/S1/upgrade': () => ({ status: 201, json: { order: { id: 'up1', amount_fcfa: 1500 }, plan: { name: 'Technicien en plus', scope: 'full' }, payment: { amountFcfa: 1500, reference: 'UP1', instructions: 'Payez 1 500 FCFA.' } } }),
      '/app/orders/up1': () => ({ status: 200, json: { order: { status: 'paid', used: false } } }),
    }, calls));
    const ui = new ScriptedConversation({ picks: [0] });
    const deps = { ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait };
    const access = humanAccessFor(deps, { token: 'T', sessionId: 'S1', scope: 'full', coverage: 'paid_forfait', fallbackToHuman: false, humanIncluded: false, upgradeFcfa: 1500 });
    expect(await ensureHuman({ human: access }, ui)).toBe(true);
    expect(access.included).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(['/app/sessions/S1/upgrade', '/app/orders/up1']);
    expect(ui.choices[0]!.question).toContain('1 500 FCFA');
    expect(ui.said).toContain('UP1');
    expect(ui.said).toContain('Paiement confirmé');
  });

  it('complément : le client dit non → aucune commande créée', async () => {
    const calls: Call[] = [];
    const api = new AppApi('https://x.test', fakeFetch({}, calls));
    const ui = new ScriptedConversation({ picks: [1] });
    const access = humanAccessFor({ ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait }, { token: 'T', sessionId: 'S1', scope: 'full', coverage: 'paid_forfait', fallbackToHuman: false, humanIncluded: false });
    expect(await ensureHuman({ human: access }, ui)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('complément : paiement jamais confirmé → pas de technicien, et le client le sait', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/sessions/S1/upgrade': () => ({ status: 201, json: { order: { id: 'up2', amount_fcfa: 1500 }, plan: { name: 'Technicien en plus', scope: 'full' }, payment: { amountFcfa: 1500, reference: 'UP2', instructions: 'Payez.' } } }),
      '/app/orders/up2': () => ({ status: 200, json: { order: { status: 'pending_payment', used: false } } }),
    }));
    const ui = new ScriptedConversation({ picks: [0] });
    const access = humanAccessFor({ ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait }, { token: 'T', sessionId: 'S1', scope: 'full', coverage: 'paid_forfait', fallbackToHuman: false, humanIncluded: false });
    expect(await ensureHuman({ human: access }, ui)).toBe(false);
    expect(access.included).toBe(false);
    expect(ui.said).toContain("Je n'ai pas encore reçu la confirmation");
  });

  it('complément : le serveur refuse → message du serveur, pas de technicien', async () => {
    const api = new AppApi('https://x.test', fakeFetch({
      '/app/sessions/S1/upgrade': () => ({ status: 409, json: { error: 'Un technicien fait déjà partie de cette assistance.' } }),
    }));
    const ui = new ScriptedConversation({ picks: [0] });
    const access = humanAccessFor({ ui, api, store: { load: () => ({ installId: 'x'.repeat(16) }), save: () => undefined }, ...noWait }, { token: 'T', sessionId: 'S1', scope: 'full', coverage: 'paid_forfait', fallbackToHuman: false, humanIncluded: false });
    expect(await ensureHuman({ human: access }, ui)).toBe(false);
    expect(ui.said).toContain('fait déjà partie');
  });
});

describe('ChatUi — bouton « Parler à un technicien » sans technicien dans l’offre', () => {
  const open: ChatUi[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((u) => u.close()));
  });
  const start = async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    return ui;
  };
  const postHandoff = (ui: ChatUi) =>
    new Promise<number>((resolve, reject) => {
      const url = new URL(ui.url);
      const req = request({ host: '127.0.0.1', port: Number(url.port), path: `/handoff?t=${url.searchParams.get('t')}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end('{}');
    });

  it('technicien inclus (défaut) : le bouton passe la main et ferme les questions', async () => {
    const ui = await start();
    let calls = 0;
    ui.onHandoff = () => calls++;
    const text = ui.ask('Dites-moi');
    expect(await postHandoff(ui)).toBe(204);
    await expect(text).resolves.toBeNull();
    expect(ui.wasHandedOff()).toBe(true);
    expect(calls).toBe(1);
  });

  it('sans technicien : le bouton n’arrête rien, la demande arrive à l’agent comme un message du client', async () => {
    const ui = await start();
    ui.technicianIncluded = () => false;
    let calls = 0;
    ui.onHandoff = () => calls++;
    const text = ui.ask('Dites-moi');
    expect(await postHandoff(ui)).toBe(204);
    await expect(text).resolves.toBe(HUMAN_REQUEST_TEXT);
    expect(ui.wasHandedOff()).toBe(false);
    expect(calls).toBe(0);
  });

  it('sans technicien et agent occupé : la demande est gardée pour la prochaine question', async () => {
    const ui = await start();
    ui.technicianIncluded = () => false;
    expect(await postHandoff(ui)).toBe(204);
    expect(ui.wasHandedOff()).toBe(false);
    await expect(ui.ask('Autre chose ?')).resolves.toBe(HUMAN_REQUEST_TEXT);
    // une seule fois
    const next = ui.ask('Encore ?');
    await expect(Promise.race([next, new Promise((r) => setTimeout(() => r('attend'), 30))])).resolves.toBe('attend');
  });
});
