import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpAssistant, type AnswerOptions, type Assistant, type AssistantReply, type ChatTurn } from '../assistant.js';
import { ChatUi, validAttachment } from '../chatServer.js';
import { converse } from '../conversation.js';
import { routeIntent, type Intent } from '../router.js';
import type { Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';

const first = (text: string): Intent | undefined => routeIntent(text)[0];
const kinds = (text: string) => routeIntent(text).map((i) => (i.kind === 'skill' ? `skill:${i.skillId}` : i.kind));

describe('routeur : AI PC', () => {
  it.each([
    ['Mon PC est lent', 'repair'],
    ['mon ordinateur est trop lent', 'repair'],
    ['Répare mon PC', 'repair'],
    ['ça rame', 'repair'],
    ['fais la maintenance de mon ordinateur', 'repair'],
  ])('« %s » → %s', (text, kind) => expect(first(text)?.kind).toBe(kind));

  it('lenteur d’Office : reste dans la compétence Office, pas de réparation générale', () => {
    expect(kinds('Excel est lent')).not.toContain('repair');
  });

  it.each([
    ['Mon ordinateur redémarre tout seul', 'skill:crashes'],
    ["j'ai un écran bleu", 'skill:crashes'],
    ['mon disque est plein', 'skill:disk'],
    ['nettoie mon ordinateur', 'skill:cleanup'],
    ['ma webcam ne marche pas', 'skill:drivers'],
    ['la batterie se décharge vite', 'skill:battery'],
    ['mon pare-feu est désactivé', 'skill:security'],
    ["l'ordinateur démarre lentement, trop de programmes au démarrage", 'skill:startup'],
    ['mon processeur chauffe, le ventilateur tourne fort', 'skill:performance'],
    ['répare les fichiers système de windows', 'skill:windows-repair'],
  ])('« %s » → %s', (text, id) => expect(kinds(text)).toContain(id));

  it('serveur : l’hôte n’est repris que s’il est explicite', () => {
    expect(first('Je n’arrive pas à accéder au serveur 192.168.1.10')).toEqual({ kind: 'server', host: '192.168.1.10' });
    expect(first('le serveur srv-compta est inaccessible')).toEqual({ kind: 'server', host: 'srv-compta' });
    expect(first('je ne joins pas le serveur compta.entreprise.ci')).toEqual({ kind: 'server', host: 'compta.entreprise.ci' });
    expect(first('Le serveur comptabilité est inaccessible')).toEqual({ kind: 'server', host: undefined }); // jamais deviné
  });

  it('lecteur réseau : chemin et lettre repris s’ils sont donnés', () => {
    expect(first('connecte le lecteur Z: à \\\\srv\\Compta')).toEqual({ kind: 'mapdrive', letter: 'Z', unc: '\\\\srv\\Compta' });
    expect(first('je veux un lecteur réseau')).toEqual({ kind: 'mapdrive' });
  });

  it('installation : seuls les logiciels du catalogue sont reconnus', () => {
    expect(first('installe VLC')).toEqual({ kind: 'install', app: 'vlc' });
    expect(first('peux-tu installer 7-Zip ?')).toEqual({ kind: 'install', app: '7zip' });
    expect(first('installe Photoshop')).toEqual({ kind: 'install', app: undefined });
  });

  it('désinstaller n’est pas installer', () => {
    expect(first('désinstalle VLC')?.kind).toBe('uninstall');
    expect(kinds('désinstalle VLC')).not.toContain('install');
  });

  it('formation', () => {
    expect(first("Apprends-moi Excel")).toMatchObject({ kind: 'training' });
    expect(kinds('je voudrais une formation Word niveau débutant')).toContain('training');
    expect(kinds('Comment faire une formule Excel ?')).not.toContain('training');
  });

  it.each([
    ['Vérifie le routeur', 'infrastructure'],
    ['Configure le nouveau routeur MikroTik', 'infrastructure'],
    ['Le VPN entre Bouaké et Abidjan ne marche plus', 'infrastructure'],
    ["Les utilisateurs ne peuvent plus se connecter à l'Active Directory", 'infrastructure'],
    ['Corrige tous les PC non critiques', 'fleet'],
    ['vérifie tout le parc informatique', 'fleet'],
    ['crée un compte utilisateur pour Awa', 'accounts'],
    ["j'ai oublié mon mot de passe Windows", 'accounts'],
  ])('« %s » → hors de portée (%s)', (text, topic) => expect(routeIntent(text)).toContainEqual({ kind: 'human_only', topic }));

  it('capture d’écran / bloqué : question d’usage', () => {
    expect(kinds('je suis bloqué sur cet écran')).toContain('chat');
  });

  it('rançongiciel : urgence prioritaire sur tout le reste', () => {
    expect(routeIntent('mes fichiers sont chiffrés, mon pc est lent')).toEqual([{ kind: 'emergency' }]);
  });
});

class FakeAssistant implements Assistant {
  readonly calls: { message: string; options?: AnswerOptions }[] = [];
  constructor(private readonly reply: AssistantReply = { available: true, text: 'Voici.' }) {}
  async answer(message: string, _h: ChatTurn[], options?: AnswerOptions) {
    this.calls.push({ message, options });
    return this.reply;
  }
}

const stub = (id: string): Skill => ({ id, title: id, verifyQuestion: 'Réglé ?', diagnose: async () => ({ summary: 'ok', problems: [], actions: [], advice: [], healthy: true, needsHuman: false }) });
const anyRunner = () => new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok(JSON.stringify({ services: [], items: [], printers: [], problems: [], volumes: [], disks: [], firewall: [] })) }]);

describe('conversation : AI PC', () => {
  it('« mon PC est lent » lance l’analyse complète (une seule question d’accord si tout est sain : aucune)', async () => {
    const runner = anyRunner();
    const ui = new ScriptedConversation({ asks: ['Mon PC est lent', null] });
    await converse({ runner, ui, reporter: new Recorder(), machine: 'PC-COMPTA-04' });
    expect(ui.said).toMatch(/Je commence par analyser votre ordinateur, sans rien modifier/);
    expect(runner.calls.length).toBeGreaterThan(5); // une lecture par étape
  });

  it('serveur sans nom : le demande, refuse une valeur dangereuse, accepte une valeur propre', async () => {
    const runner = anyRunner();
    const ui = new ScriptedConversation({ asks: ['Le serveur comptabilité est inaccessible', "x'; calc", 'srv-compta', null] });
    await converse({ runner, ui, reporter: new Recorder() });
    expect(ui.prompts[1]).toMatch(/nom ou l'adresse du serveur/);
    expect(ui.said).toMatch(/Je n'accepte qu'un nom ou une adresse IP/);
    // le script n'a reçu que la valeur propre
    expect(runner.calls.some((c) => c.script.includes("'srv-compta'"))).toBe(true);
    expect(runner.calls.some((c) => c.script.includes('calc'))).toBe(false);
  });

  it('lecteur réseau : chemin et lettre invalides sont refusés', async () => {
    const runner = anyRunner();
    const ui = new ScriptedConversation({ asks: ['connecte un lecteur réseau', '\\\\srv\\a"b', 'pas un chemin', null] });
    await converse({ runner, ui, reporter: new Recorder() });
    expect(ui.said).toMatch(/Le chemin doit avoir la forme/);
    expect(runner.calls).toEqual([]);
  });

  it('installation : logiciel hors catalogue → menu puis technicien', async () => {
    const runner = anyRunner();
    const ui = new ScriptedConversation({ asks: ['installe Photoshop', null], picks: [8, 0] }); // « Un autre logiciel » puis « Oui, un technicien »
    const reporter = new Recorder();
    const out = await converse({ runner, ui, reporter });
    expect(ui.choices[0]!.options.at(-1)).toBe('Un autre logiciel (technicien)');
    expect(out.handedOver).toBe(true);
    expect(runner.calls).toEqual([]);
  });

  it.each([
    ['Vérifie le routeur', /routeurs, commutateurs/],
    ['Corrige tous les PC non critiques', /plusieurs ordinateurs/],
    ["crée un compte utilisateur pour Awa", /mots de passe, aux comptes/],
  ])('« %s » : réponse honnête, rien n’est exécuté, technicien proposé', async (text, expected) => {
    const runner = anyRunner();
    const ui = new ScriptedConversation({ asks: [text, null], picks: [1] });
    await converse({ runner, ui, reporter: new Recorder() });
    expect(ui.said).toMatch(expected);
    expect(ui.choices[0]!.question).toMatch(/technicien/);
    expect(runner.calls).toEqual([]);
  });

  it('formation : passe par l’assistant en ligne, jamais par la machine', async () => {
    const runner = anyRunner();
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ["Apprends-moi Excel", 'passer', null], picks: [0, 1] });
    await converse({ runner, ui, reporter: new Recorder(), assistant });
    expect(assistant.calls.map((c) => c.options?.lesson?.step)).toEqual(['cours', 'exercice']);
    expect(runner.calls).toEqual([]);
  });

  it('formation sans assistant : technicien proposé', async () => {
    const ui = new ScriptedConversation({ asks: ['Apprends-moi Excel', null], picks: [1] });
    await converse({ runner: anyRunner(), ui, reporter: new Recorder() });
    expect(ui.said).toMatch(/pas disponible/);
    expect(ui.choices[0]!.question).toMatch(/technicien/);
  });

  it('capture d’écran : demandée quand le client est bloqué, puis envoyée avec la question', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['Je suis bloqué sur cet écran', 'ok', null] });
    (ui as unknown as { takeAttachment: () => unknown }).takeAttachment = (() => {
      let n = 0;
      return () => (++n === 2 ? { mime: 'image/jpeg', data: 'AAAA' } : null);
    })();
    await converse({ runner: anyRunner(), ui, reporter: new Recorder(), assistant });
    expect(ui.prompts[1]).toMatch(/joignez une capture/);
    expect(assistant.calls[0]!.options).toEqual({ image: { mime: 'image/jpeg', data: 'AAAA' } });
  });

  it('question sans capture : l’assistant ne reçoit aucune option', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['Comment trier un tableau Excel ?', null] });
    await converse({ runner: anyRunner(), ui, reporter: new Recorder(), assistant });
    expect(assistant.calls[0]!.options).toBeUndefined();
  });

  it('menu « Un problème précis » : choisir une compétence passe par la résolution habituelle', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ['bidule', null], picks: [1, 0] });
    await converse({ runner: anyRunner(), ui, reporter: new Recorder(), resolve: (id) => (asked.push(id), stub(id)) });
    expect(asked).toEqual(['sound']);
  });
});

describe('HttpAssistant : formation et capture', () => {
  it('envoie lesson et image, bornées', async () => {
    const seen: string[] = [];
    const impl = (async (_u: string, init?: RequestInit) => {
      seen.push(String(init?.body));
      return new Response(JSON.stringify({ answer: 'ok' }), { status: 200 });
    }) as typeof fetch;
    const a = new HttpAssistant('http://x', 't', 's', impl);
    await a.answer('Bonjour', [], { lesson: { track: 'excel', level: 1, step: 'cours', index: 1 }, image: { mime: 'image/png', data: 'AAAA' } });
    expect(JSON.parse(seen[0]!)).toMatchObject({ lesson: { track: 'excel', level: 1, step: 'cours', index: 1 }, image: { mime: 'image/png', data: 'AAAA' } });
    await a.answer('Bonjour', [], { image: { mime: 'image/png', data: 'A'.repeat(800_001) } });
    expect(JSON.parse(seen[1]!)).not.toHaveProperty('image');
    await a.answer('Bonjour', []);
    expect(Object.keys(JSON.parse(seen[2]!)).sort()).toEqual(['history', 'message']);
  });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');

describe('page de conversation : capture d’écran', () => {
  const open: ChatUi[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((u) => u.close()));
  });
  const send = (ui: ChatUi, body: string, token?: string, origin?: string) =>
    new Promise<number>((resolve, reject) => {
      const url = new URL(ui.url);
      const req = request({ host: '127.0.0.1', port: Number(url.port), path: `/attach?t=${token ?? url.searchParams.get('t')}`, method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end(body);
    });

  it('validAttachment : signature réelle, type et taille', () => {
    expect(validAttachment({ mime: 'image/jpeg', data: JPEG })).toEqual({ mime: 'image/jpeg', data: JPEG });
    expect(validAttachment({ mime: 'image/png', data: PNG })).not.toBeNull();
    for (const bad of [null, 'x', {}, { mime: 'image/png', data: JPEG }, { mime: 'image/svg+xml', data: PNG }, { mime: 'image/png', data: 'data:image/png;base64,AAAA' }, { mime: 'image/png', data: '' }, { mime: 'image/png', data: 5 }]) {
      expect(validAttachment(bad)).toBeNull();
    }
    expect(validAttachment({ mime: 'image/jpeg', data: JPEG + 'A'.repeat(800_000) })).toBeNull();
  });

  it('une capture valide est gardée UNE fois (takeAttachment la vide)', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    expect(await send(ui, JSON.stringify({ mime: 'image/jpeg', data: JPEG }))).toBe(204);
    expect(ui.takeAttachment()).toEqual({ mime: 'image/jpeg', data: JPEG });
    expect(ui.takeAttachment()).toBeNull();
  });

  it('refus : mauvais jeton, signature fausse, JSON cassé, origine étrangère, corps énorme', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    expect(await send(ui, JSON.stringify({ mime: 'image/jpeg', data: JPEG }), 'mauvais')).toBe(403);
    expect(await send(ui, JSON.stringify({ mime: 'image/png', data: JPEG }))).toBe(400);
    expect(await send(ui, '{pas du json')).toBe(400);
    expect(await send(ui, JSON.stringify({ mime: 'image/jpeg', data: JPEG }), undefined, 'https://evil.example')).toBe(403);
    const status = await send(ui, JSON.stringify({ mime: 'image/jpeg', data: 'A'.repeat(1_100_000) })).catch(() => 413);
    expect([413, 400]).toContain(status);
    expect(ui.takeAttachment()).toBeNull();
  });

  it('la page propose le bouton « Joindre une capture » avec l’avertissement de confidentialité', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    const url = new URL(ui.url);
    const html = await new Promise<string>((resolve) => {
      request({ host: '127.0.0.1', port: Number(url.port), path: `/?t=${url.searchParams.get('t')}` }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(b));
      }).end();
    });
    expect(html).toContain("Joindre une capture d'écran");
    expect(html).toContain('Masquez');
  });
});
