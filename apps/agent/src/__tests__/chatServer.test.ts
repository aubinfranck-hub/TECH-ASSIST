import { request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatUi } from '../chatServer.js';
import type { Action } from '../types.js';

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const open: ChatUi[] = [];
async function start() {
  const ui = await ChatUi.start();
  open.push(ui);
  return ui;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((ui) => ui.close()));
});

const parts = (ui: ChatUi) => {
  const url = new URL(ui.url);
  return { port: Number(url.port), token: url.searchParams.get('t')! };
};

interface Options {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** undefined : bon jeton ; null : aucun ; chaîne : ce jeton. */
  token?: string | null;
}

function http(ui: ChatUi, options: Options = {}): Promise<Res> {
  const { port, token } = parts(ui);
  const given = options.token === undefined ? token : options.token;
  const path = `${options.path ?? '/'}${given === null ? '' : `?t=${encodeURIComponent(given)}`}`;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

const post = (ui: ChatUi, path: string, payload: unknown, extra: Options = {}) =>
  http(ui, { path, method: 'POST', headers: { 'Content-Type': 'application/json', ...extra.headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload), token: extra.token });

type Ev = { seq: number; type: string; id?: string; text?: string; options?: string[]; title?: string; yes?: string; no?: string };

/** Lit le flux d'événements (SSE) de la page. */
function stream(ui: ChatUi, headers: Record<string, string> = {}) {
  const { port, token } = parts(ui);
  const events: Ev[] = [];
  let ended = false;
  let buffer = '';
  const req = request({ host: '127.0.0.1', port, path: `/events?t=${token}`, headers }, (res) => {
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data) events.push(JSON.parse(data.slice(6)) as Ev);
      }
    });
    res.on('end', () => (ended = true));
  });
  req.on('error', () => undefined);
  req.end();
  const until = async (test: () => boolean, label: string) => {
    const deadline = Date.now() + 3000;
    while (!test()) {
      if (Date.now() > deadline) throw new Error(`délai dépassé : ${label} (reçu ${JSON.stringify(events)})`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return {
    events,
    get ended() {
      return ended;
    },
    waitFor: (type: string, count = 1) => until(() => events.filter((e) => e.type === type).length >= count, `événement ${type} ×${count}`),
    waitEnded: () => until(() => ended, 'fin du flux'),
    stop: () => req.destroy(),
  };
}

const action = (patch: Partial<Action> = {}): Action => ({
  id: 'x',
  title: 'Redémarrer le service',
  explanation: 'Je redémarre le service audio.',
  requiresAdmin: false,
  verified: true,
  run: async () => ({ ok: true, message: 'OK' }),
  ...patch,
});

describe('ChatUi — accès', () => {
  it('écoute uniquement en local et donne une adresse avec un jeton long et aléatoire', async () => {
    const a = await start();
    const b = await start();
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{48}$/);
    expect(parts(a).token).not.toBe(parts(b).token);
    expect(parts(a).port).not.toBe(parts(b).port);
  });

  it('sert la page avec le bon jeton, une politique CSP stricte et aucune ressource externe', async () => {
    const ui = await start();
    const res = await http(ui);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1]!;
    expect(res.body).toContain(`<script nonce="${nonce}">`);
    expect(res.body).not.toContain('__NONCE__');
    expect(res.body).not.toMatch(/https?:\/\//); // aucune ressource externe
    expect(res.headers['cache-control']).toBe('no-store');
    // un nonce différent à chaque chargement
    const again = await http(ui);
    expect(String(again.headers['content-security-policy'])).not.toContain(nonce);
  });

  it('la page n’interprète jamais le texte reçu comme du HTML', async () => {
    const res = await http(await start());
    expect(res.body).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(res.body).toContain('textContent');
  });

  it('refuse sans jeton ou avec un mauvais jeton (403), sur toutes les routes', async () => {
    const ui = await start();
    for (const token of [null, '', 'faux', parts(ui).token.slice(0, -1)]) {
      expect((await http(ui, { token })).status).toBe(403);
      expect((await http(ui, { path: '/events', token })).status).toBe(403);
      expect((await post(ui, '/handoff', {}, { token })).status).toBe(403);
      expect((await post(ui, '/reply', { id: 'p1', value: true }, { token })).status).toBe(403);
    }
    expect(ui.wasHandedOff()).toBe(false);
  });

  it('refuse un en-tête Host étranger (protection contre le « DNS rebinding »)', async () => {
    const ui = await start();
    const { port } = parts(ui);
    expect((await http(ui, { headers: { Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await http(ui, { headers: { Host: `127.0.0.1:${port + 1}` } })).status).toBe(403);
    expect((await http(ui, { headers: { Host: `localhost:${port}` } })).status).toBe(200);
  });

  it('route inconnue : 404 (avec le bon jeton)', async () => {
    expect((await http(await start(), { path: '/secret' })).status).toBe(404);
  });
});

describe('ChatUi — questions et réponses', () => {
  it('ask : la page affiche la question, la réponse libère l’agent et s’affiche côté client', async () => {
    const ui = await start();
    const s = stream(ui);
    const answer = ui.ask('Quel est votre souci ?');
    await s.waitFor('ask');
    const ev = s.events.find((e) => e.type === 'ask')!;
    expect(ev.text).toBe('Quel est votre souci ?');

    expect((await post(ui, '/reply', { id: ev.id, value: '  plus de son  ' })).status).toBe(204);
    await expect(answer).resolves.toBe('plus de son');
    await s.waitFor('resolved');
    expect(s.events.filter((e) => e.type === 'user').map((e) => e.text)).toEqual(['plus de son']);
    s.stop();
  });

  it('confirmAction : Autoriser / Refuser, avec mention des droits administrateur', async () => {
    const ui = await start();
    const s = stream(ui);
    const yes = ui.confirmAction(action({ requiresAdmin: true }));
    await s.waitFor('confirm');
    const ev = s.events.find((e) => e.type === 'confirm')!;
    expect(ev).toMatchObject({ title: 'Redémarrer le service', yes: 'Autoriser', no: 'Refuser' });
    expect(ev.text).toContain('droits administrateur');
    await post(ui, '/reply', { id: ev.id, value: true });
    await expect(yes).resolves.toBe(true);

    const no = ui.confirmAction(action());
    await s.waitFor('confirm', 2);
    const ev2 = s.events.filter((e) => e.type === 'confirm')[1]!;
    expect(ev2.text).not.toContain('droits administrateur');
    await post(ui, '/reply', { id: ev2.id, value: false });
    await expect(no).resolves.toBe(false);
    s.stop();
  });

  it('confirmFixed : Oui / Non', async () => {
    const ui = await start();
    const s = stream(ui);
    const fixed = ui.confirmFixed('Entendez-vous du son ?');
    await s.waitFor('confirm');
    const ev = s.events.find((e) => e.type === 'confirm')!;
    expect(ev).toMatchObject({ yes: 'Oui', no: 'Non', text: 'Entendez-vous du son ?' });
    await post(ui, '/reply', { id: ev.id, value: true });
    await expect(fixed).resolves.toBe(true);
    s.stop();
  });

  it('choose : renvoie l’index choisi', async () => {
    const ui = await start();
    const s = stream(ui);
    const pick = ui.choose('Lequel ?', ['A', 'B', 'C']);
    await s.waitFor('choose');
    const ev = s.events.find((e) => e.type === 'choose')!;
    expect(ev.options).toEqual(['A', 'B', 'C']);
    await post(ui, '/reply', { id: ev.id, value: 2 });
    await expect(pick).resolves.toBe(2);
    await s.waitFor('user');
    expect(s.events.filter((e) => e.type === 'user').map((e) => e.text)).toEqual(['C']);
    s.stop();
  });

  it('réponses invalides refusées (409) : l’agent reste en attente, rien n’est décidé à la place du client', async () => {
    const ui = await start();
    const s = stream(ui);
    let settled = false;
    const confirm = ui.confirmAction(action()).then((v) => ((settled = true), v));
    const choice = ui.choose('Lequel ?', ['A', 'B']);
    const text = ui.ask('Dites-moi');
    await s.waitFor('confirm');
    await s.waitFor('choose');
    await s.waitFor('ask');
    const [c, ch, a] = ['confirm', 'choose', 'ask'].map((t) => s.events.find((e) => e.type === t)!.id!);

    const bad = [
      [c, 'oui'], [c, 1], [c, null], // confirmation : booléen seulement
      [ch, 2], [ch, -1], [ch, 0.5], [ch, '0'], [ch, true], // liste : entier dans la plage
      [a, ''], [a, '   '], [a, 5], [a, null], // texte : non vide
      ['p999', true], [undefined, true], [42, true], // identifiant inconnu ou invalide
    ] as const;
    for (const [id, value] of bad) {
      expect((await post(ui, '/reply', { id, value })).status, JSON.stringify({ id, value })).toBe(409);
    }
    expect(settled).toBe(false);

    // les bonnes réponses passent, une seule fois
    expect((await post(ui, '/reply', { id: c, value: true })).status).toBe(204);
    expect((await post(ui, '/reply', { id: c, value: false })).status).toBe(409);
    await expect(confirm).resolves.toBe(true);
    await post(ui, '/reply', { id: ch, value: 0 });
    await post(ui, '/reply', { id: a, value: 'ok' });
    await expect(choice).resolves.toBe(0);
    await expect(text).resolves.toBe('ok');
    s.stop();
  });

  it('borne la longueur d’un texte libre', async () => {
    const ui = await start();
    const s = stream(ui);
    const answer = ui.ask('Dites-moi');
    await s.waitFor('ask');
    await post(ui, '/reply', { id: s.events.find((e) => e.type === 'ask')!.id, value: 'x'.repeat(5000) });
    expect((await answer)!.length).toBe(2000);
    s.stop();
  });
});

describe('ChatUi — requêtes d’envoi', () => {
  it('JSON illisible : 400 ; autre type de contenu : 415 ; origine étrangère : 403', async () => {
    const ui = await start();
    const { port } = parts(ui);
    expect((await post(ui, '/reply', '{pas du json')).status).toBe(400);
    expect((await http(ui, { path: '/reply', method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await post(ui, '/reply', { id: 'p1', value: true }, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await post(ui, '/handoff', {}, { headers: { Origin: 'http://localhost:9' } })).status).toBe(403);
    expect(ui.wasHandedOff()).toBe(false);
    // une origine locale correcte passe
    expect((await post(ui, '/reply', { id: 'p1', value: true }, { headers: { Origin: `http://127.0.0.1:${port}` } })).status).toBe(409);
  });

  it('refuse un corps trop volumineux (413 ou coupure) sans bloquer le serveur', async () => {
    const ui = await start();
    const outcome = await post(ui, '/reply', 'x'.repeat(50_000)).then(
      (r) => r.status,
      () => 'coupé',
    );
    expect([413, 'coupé']).toContain(outcome);
    expect((await http(ui)).status).toBe(200); // toujours en vie
  });
});

describe('ChatUi — flux d’événements', () => {
  it('rejoue l’historique à une page qui se connecte (ou se reconnecte) en retard', async () => {
    const ui = await start();
    ui.info('un');
    ui.info('deux');
    ui.info('trois');

    const full = stream(ui);
    await full.waitFor('say', 3);
    expect(full.events.map((e) => e.text)).toEqual(['un', 'deux', 'trois']);
    expect(full.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    full.stop();

    const partial = stream(ui, { 'Last-Event-ID': '2' });
    await partial.waitFor('say');
    await new Promise((r) => setTimeout(r, 30));
    expect(partial.events.map((e) => e.text)).toEqual(['trois']);
    partial.stop();
  });

  it('diffuse en direct à plusieurs pages ouvertes', async () => {
    const ui = await start();
    const a = stream(ui);
    const b = stream(ui);
    await new Promise((r) => setTimeout(r, 30));
    ui.info('bonjour');
    await a.waitFor('say');
    await b.waitFor('say');
    expect(a.events[0]!.text).toBe('bonjour');
    expect(b.events[0]!.text).toBe('bonjour');
    a.stop();
    b.stop();
  });

  it('le texte est transmis tel quel (jamais interprété) : la page l’affichera avec textContent', async () => {
    const ui = await start();
    ui.info('<img src=x onerror=alert(1)>');
    const s = stream(ui);
    await s.waitFor('say');
    expect(s.events[0]!.text).toBe('<img src=x onerror=alert(1)>');
    s.stop();
  });
});

describe('ChatUi — passage de main et fermeture', () => {
  it('le bouton « technicien » clôt toutes les questions en attente et prévient une seule fois', async () => {
    const ui = await start();
    let calls = 0;
    ui.onHandoff = () => calls++;
    const s = stream(ui);
    const confirm = ui.confirmAction(action());
    const text = ui.ask('Dites-moi');
    const pick = ui.choose('Lequel ?', ['A']);
    await s.waitFor('ask');

    expect((await post(ui, '/handoff', {})).status).toBe(204);
    await expect(confirm).resolves.toBe(false); // jamais « oui » par défaut
    await expect(text).resolves.toBeNull();
    await expect(pick).resolves.toBeNull();
    expect(ui.wasHandedOff()).toBe(true);
    expect(calls).toBe(1);
    await s.waitFor('resolved', 3);
    expect(s.events.filter((e) => e.type === 'resolved')).toHaveLength(3);
    expect(s.events.some((e) => e.type === 'say' && /Je préviens un technicien/.test(e.text ?? ''))).toBe(true);

    await post(ui, '/handoff', {});
    expect(calls).toBe(1);
    s.stop();
  });

  it('après le passage de main, la fenêtre reste ouverte : les réponses du technicien s’affichent et les questions redeviennent possibles', async () => {
    const ui = await start();
    const s = stream(ui);
    ui.requestHandoff();
    await expect(ui.ask('Dites-moi')).resolves.toBeNull();

    ui.resumeAfterHandoff();
    expect(ui.wasHandedOff()).toBe(false);
    ui.fromTechnician('Marc', 'Bonjour, je regarde votre dossier.');
    await s.waitFor('tech');
    const tech = s.events.find((e) => e.type === 'tech');
    expect(tech).toMatchObject({ name: 'Marc', text: 'Bonjour, je regarde votre dossier.' });

    const answer = ui.ask('Écrivez à votre technicien :');
    await s.waitFor('ask', 1);
    expect(await Promise.race([answer, Promise.resolve('en attente')])).toBe('en attente');
    await ui.close();
    await expect(answer).resolves.toBeNull();
    s.stop();
  });

  it('après le passage de main, toute nouvelle question reçoit tout de suite la réponse « non / fermé »', async () => {
    const ui = await start();
    ui.requestHandoff();
    await expect(ui.confirmAction(action())).resolves.toBe(false);
    await expect(ui.confirmFixed('Ça marche ?')).resolves.toBe(false);
    await expect(ui.ask('Dites-moi')).resolves.toBeNull();
    await expect(ui.choose('Lequel ?', ['A'])).resolves.toBeNull();
  });

  it('close : libère les questions en attente, termine les flux et arrête le serveur', async () => {
    const ui = await ChatUi.start();
    const { port } = parts(ui);
    const s = stream(ui);
    const pending = ui.ask('Dites-moi');
    await s.waitFor('ask');
    await ui.close();
    await expect(pending).resolves.toBeNull();
    await s.waitEnded();
    expect(s.events.at(-1)!.type).toBe('ended');
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => reject(new Error('le serveur écoute encore')));
      socket.once('error', () => resolve());
    });
    await ui.close(); // idempotent
  });
});
