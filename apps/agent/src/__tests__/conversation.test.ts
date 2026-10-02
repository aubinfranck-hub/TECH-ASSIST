import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assistant, AssistantReply, ChatTurn } from '../assistant.js';
import { converse } from '../conversation.js';
import { SKILL_MENU } from '../skills/index.js';
import type { InstalledProgram } from '../skills/uninstall.js';
import type { AgentEvent, Diagnosis, Reporter, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok, fail } from './fakeScripts.js';

const ROOTS = ['C:\\Program Files'];

const diagnosis = (patch: Partial<Diagnosis> = {}): Diagnosis => ({ summary: 'Tout va bien.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...patch });

/** Compétence bouchon : saine (le client confirme) ou qui passe la main. */
const stubSkill = (id: string, patch: Partial<Diagnosis> = {}): Skill => ({
  id,
  title: id,
  verifyQuestion: `Ça va pour ${id} ?`,
  diagnose: async () => diagnosis(patch),
});

function resolver(skills: Record<string, Skill>, asked: string[] = []) {
  return (id: string) => {
    asked.push(id);
    return skills[id];
  };
}

class FakeAssistant implements Assistant {
  readonly calls: { message: string; history: ChatTurn[] }[] = [];
  constructor(private readonly replies: AssistantReply[]) {}
  async answer(message: string, history: ChatTurn[]) {
    this.calls.push({ message, history: [...history] });
    return this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)]!;
  }
}

const noRunner = new ScriptedRunner([]);

afterEach(() => vi.restoreAllMocks());

describe('converse — déroulement général', () => {
  it('accueille le client, puis se termine proprement quand il ferme', async () => {
    const ui = new ScriptedConversation();
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder() });
    expect(out).toEqual({ turns: 0, handedOver: false, outcomes: [] });
    expect(ui.infos[0]).toMatch(/^Bonjour, je suis l'assistant Tech Assist/);
    expect(ui.infos.at(-1)).toMatch(/Merci/);
    expect(ui.prompts).toEqual(['Que puis-je faire pour vous ?']);
  });

  it('comprend la demande, lance la compétence, journalise la demande du client', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ["je n'ai plus de son", 'non merci'] });
    const reporter = new Recorder();
    const out = await converse({ runner: noRunner, ui, reporter, resolve: resolver({ sound: stubSkill('sound') }, asked) });
    expect(asked).toEqual(['sound']);
    expect(out.turns).toBe(1);
    expect(out.outcomes).toEqual([{ status: 'fixed', actionsDone: [] }]);
    expect(ui.said).toContain("Parfait, c'est réglé.");
    expect(reporter.events.find((e) => e.type === 'user_request')).toMatchObject({ skill: 'conversation', message: "je n'ai plus de son" });
    expect(ui.prompts[1]).toMatch(/Autre chose/);
  });

  it('« non, mais… » ne ferme pas la conversation ; « non » seul la ferme', async () => {
    const ui = new ScriptedConversation({ asks: ['plus de son', 'non, mais Outlook plante aussi', 'Non.'] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: resolver({ sound: stubSkill('sound'), office: stubSkill('office') }) });
    expect(out.turns).toBe(2);
    expect(out.outcomes).toHaveLength(2);
  });

  it('ignore un message vide sans compter un tour', async () => {
    const ui = new ScriptedConversation({ asks: ['   ', null] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder() });
    expect(out.turns).toBe(0);
  });

  it('tronque ce qui est journalisé et survit à un journal en panne', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: AgentEvent[] = [];
    const flaky: Reporter = {
      async event(e) {
        events.push(e);
        throw new Error('serveur indisponible');
      },
    };
    const ui = new ScriptedConversation({ asks: ['plus de son ' + 'x'.repeat(2000), null] });
    const out = await converse({ runner: noRunner, ui, reporter: flaky, resolve: resolver({ sound: stubSkill('sound') }) });
    expect(out.turns).toBe(1);
    expect(events.find((e) => e.type === 'user_request')!.message!.length).toBeLessThanOrEqual(500);
  });

  it('le bouton « technicien » de la page met fin à la conversation, sans message de clôture', async () => {
    const ui = new ScriptedConversation();
    ui.ask = async () => {
      ui.handedOff = true;
      return null;
    };
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder() });
    expect(out.handedOver).toBe(true);
    expect(ui.said).not.toMatch(/Merci\./);
  });
});

describe('converse — urgence', () => {
  it('rançongiciel : conseils, passage de main immédiat, aucune compétence lancée', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ['tous mes fichiers sont chiffrés et on demande une rançon', 'plus de son'] });
    const reporter = new Recorder();
    const out = await converse({ runner: noRunner, ui, reporter, resolve: resolver({ sound: stubSkill('sound') }, asked) });
    expect(out.handedOver).toBe(true);
    expect(asked).toEqual([]);
    expect(ui.said).toMatch(/débranchez/);
    expect(ui.said).toMatch(/aucune rançon/);
    expect(reporter.types).toContain('escalated');
    expect(ui.prompts).toHaveLength(1); // la conversation s'arrête là
  });
});

describe('converse — choix et menu', () => {
  it('plusieurs pistes : le client choisit par laquelle commencer', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ['mon casque bluetooth ne marche pas', null], picks: [1] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: resolver({ sound: stubSkill('sound'), bluetooth: stubSkill('bluetooth') }, asked) });
    expect(ui.choices[0]!.options).toHaveLength(2);
    expect(asked).toEqual(['bluetooth']);
  });

  it('s’il renonce à choisir, on lui redemande sans rien lancer', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ['mon casque bluetooth ne marche pas', null], picks: [null] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: resolver({}, asked) });
    expect(asked).toEqual([]);
    expect(out.outcomes).toEqual([]);
  });

  it('demande incomprise : menu complet, le client choisit une compétence', async () => {
    const asked: string[] = [];
    const ui = new ScriptedConversation({ asks: ['bidule truc machin', null], picks: [0] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: resolver({ sound: stubSkill('sound') }, asked) });
    const options = ui.choices[0]!.options;
    expect(options.slice(0, SKILL_MENU.length)).toEqual(SKILL_MENU.map((c) => c.label));
    expect(options.slice(SKILL_MENU.length)).toEqual(['Désinstaller un logiciel', 'Poser une question (Office, Windows…)', 'Parler à un technicien']);
    expect(asked).toEqual(['sound']);
  });

  it('demande incomprise : « Parler à un technicien » passe la main', async () => {
    const ui = new ScriptedConversation({ asks: ['bidule truc machin'], picks: [SKILL_MENU.length + 2] });
    const reporter = new Recorder();
    const out = await converse({ runner: noRunner, ui, reporter });
    expect(out.handedOver).toBe(true);
    expect(reporter.events.some((e) => e.type === 'escalated' && e.message === 'Le client demande un technicien')).toBe(true);
  });

  it('demande incomprise : le menu mène aussi à la désinstallation et aux questions', async () => {
    const assistant = new FakeAssistant([{ available: true, text: 'Voici.' }]);
    const ui = new ScriptedConversation({ asks: ['bidule truc machin', 'Quelque chose', null], picks: [SKILL_MENU.length + 1] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant });
    expect(assistant.calls.map((c) => c.message)).toEqual(['Quelque chose']);
  });

  it('compétence inconnue : on le dit et on propose un technicien (accord du client)', async () => {
    const ui = new ScriptedConversation({ asks: ['plus de son'], picks: [0] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: () => undefined });
    expect(ui.choices[0]!.question).toMatch(/technicien/);
    expect(out.handedOver).toBe(true);
  });
});

describe('converse — passage de main après une compétence', () => {
  const escalating = () => stubSkill('sound', { healthy: false, needsHuman: true, summary: 'Matériel défectueux' });

  it('enregistré par le serveur : la conversation se termine', async () => {
    const ui = new ScriptedConversation({ asks: ['plus de son', 'plus de son'] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), resolve: resolver({ sound: escalating() }) });
    expect(out.handedOver).toBe(true);
    expect(out.outcomes[0]).toMatchObject({ status: 'escalated', recorded: true });
    expect(ui.prompts).toHaveLength(1);
  });

  it('NON enregistré : la conversation continue (le client peut réessayer ou utiliser le bouton)', async () => {
    const failing: Reporter = {
      async event(e) {
        if (e.type === 'escalated') throw new Error('hors ligne');
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ui = new ScriptedConversation({ asks: ['plus de son', null] });
    const out = await converse({ runner: noRunner, ui, reporter: failing, resolve: resolver({ sound: escalating() }) });
    expect(out.outcomes[0]).toMatchObject({ status: 'escalated', recorded: false });
    expect(out.handedOver).toBe(false);
    expect(ui.prompts).toHaveLength(2);
  });
});

describe('converse — désinstallation', () => {
  const prog = (patch: Partial<InstalledProgram>): InstalledProgram => ({
    id: 'TikTok',
    scope: 'machine',
    name: 'TikTok',
    publisher: 'ByteDance',
    version: '3.0',
    uninstall: '"C:\\Program Files\\TikTok\\uninst.exe"',
    quiet: '',
    msi: false,
    ...patch,
  });

  function machine(programs: InstalledProgram[]) {
    const state = { programs };
    const runner = new ScriptedRunner([
      { label: 'collect-programs', test: (s) => s.includes('CurrentVersion\\Uninstall'), reply: () => ok(JSON.stringify({ programs: state.programs, admin: true })) },
      { label: 'uninstall', test: (s) => s.includes('Start-Process -FilePath'), reply: () => { state.programs = state.programs.filter((p) => p.id !== 'TikTok'); return ok(); } },
    ]);
    return runner;
  }

  it('un seul logiciel trouvé : annoncé, désinstallé après accord, vérifié', async () => {
    const runner = machine([prog({}), prog({ id: 'Other', name: 'VLC' })]);
    const ui = new ScriptedConversation({ asks: ['désinstalle TikTok', null] });
    const out = await converse({ runner, ui, reporter: new Recorder(), roots: ROOTS });
    expect(ui.said).toMatch(/J'ai trouvé : TikTok 3\.0 \(ByteDance\)/);
    expect(out.outcomes).toEqual([{ status: 'fixed', actionsDone: ['uninstall_program'] }]);
    expect(runner.count('uninstall')).toBe(1);
  });

  it('plusieurs logiciels : le client choisit, avec une sortie « aucun »', async () => {
    const runner = machine([prog({ id: 'A', name: 'Skype for Business' }), prog({ id: 'B', name: 'Skype' })]);
    const ui = new ScriptedConversation({ asks: ['supprime skype', null], picks: [2] });
    const out = await converse({ runner, ui, reporter: new Recorder(), roots: ROOTS });
    expect(ui.choices[0]!.options.at(-1)).toBe('Aucun de ceux-là');
    expect(ui.choices[0]!.options).toHaveLength(3);
    expect(out.outcomes).toEqual([]);
    expect(runner.count('uninstall')).toBe(0);
  });

  it('aucun logiciel correspondant : on le dit', async () => {
    const ui = new ScriptedConversation({ asks: ['désinstalle Photoshop', null] });
    await converse({ runner: machine([prog({})]), ui, reporter: new Recorder(), roots: ROOTS });
    expect(ui.said).toMatch(/aucun logiciel qui ressemble à « photoshop »/i);
  });

  it('logiciel protégé : explication, technicien proposé SANS passage de main automatique, rien exécuté', async () => {
    const runner = machine([prog({ id: 'KAV', name: 'Kaspersky Internet Security', publisher: 'Kaspersky' })]);
    const ui = new ScriptedConversation({ asks: ['désinstalle kaspersky', null], picks: [1] }); // « Non merci »
    const reporter = new Recorder();
    const out = await converse({ runner, ui, reporter, roots: ROOTS });
    expect(ui.said).toMatch(/Je ne désinstalle pas « Kaspersky Internet Security » moi-même/);
    expect(ui.choices[0]!.question).toMatch(/technicien/);
    expect(out.handedOver).toBe(false);
    expect(reporter.types).not.toContain('escalated');
    expect(runner.count('uninstall')).toBe(0);
  });

  it('logiciel protégé : si le client accepte, le technicien est prévenu', async () => {
    const runner = machine([prog({ id: 'KAV', name: 'Kaspersky', publisher: 'Kaspersky' })]);
    const ui = new ScriptedConversation({ asks: ['désinstalle kaspersky'], picks: [0] });
    const out = await converse({ runner, ui, reporter: new Recorder(), roots: ROOTS });
    expect(out.handedOver).toBe(true);
  });

  it('liste des logiciels illisible : passe la main', async () => {
    const runner = new ScriptedRunner([{ label: 'collect-programs', test: (s) => s.includes('CurrentVersion\\Uninstall'), reply: () => fail('Accès refusé') }]);
    const ui = new ScriptedConversation({ asks: ['désinstalle TikTok'] });
    const reporter = new Recorder();
    const out = await converse({ runner, ui, reporter, roots: ROOTS });
    expect(out.handedOver).toBe(true);
    expect(reporter.events.find((e) => e.type === 'escalated')!.message).toMatch(/Liste des logiciels illisible/);
  });
});

describe('converse — questions d’usage (assistant en ligne)', () => {
  it('transmet la question seule la première fois, puis garde le fil', async () => {
    const assistant = new FakeAssistant([
      { available: true, text: 'Réponse 1' },
      { available: true, text: 'Réponse 2' },
    ]);
    const ui = new ScriptedConversation({ asks: ['Comment faire un tableau croisé dans Excel ?', 'Et comment le filtrer dans Excel ?', null] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant });
    expect(assistant.calls[0]).toEqual({ message: 'Comment faire un tableau croisé dans Excel ?', history: [] });
    expect(assistant.calls[1]!.message).toBe('Et comment le filtrer dans Excel ?');
    expect(assistant.calls[1]!.history).toEqual([
      { role: 'user', text: 'Comment faire un tableau croisé dans Excel ?' },
      { role: 'assistant', text: 'Réponse 1' },
    ]);
    expect(ui.said).toContain('Réponse 1');
    expect(ui.questions).toEqual(['Cette réponse vous aide-t-elle ?', 'Cette réponse vous aide-t-elle ?']);
  });

  it('prévient une seule fois que la question part vers une IA en ligne, sans mot de passe ni carte', async () => {
    const assistant = new FakeAssistant([{ available: true, text: 'Réponse' }]);
    const ui = new ScriptedConversation({ asks: ['Comment trier un tableau dans Excel ?', 'Comment filtrer un tableau dans Excel ?', null] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant });
    expect(ui.infos.filter((m) => /transmise à notre assistant en ligne/.test(m))).toHaveLength(1);
    expect(ui.said).toMatch(/mot de passe/);
    // sans assistant, rien n'est transmis : pas d'avertissement
    const offline = new ScriptedConversation({ asks: ['Comment trier un tableau dans Excel ?', null], picks: [1] });
    await converse({ runner: noRunner, ui: offline, reporter: new Recorder() });
    expect(offline.said).not.toMatch(/transmise/);
  });

  it('réponse qui n’aide pas : un technicien est proposé', async () => {
    const assistant = new FakeAssistant([{ available: true, text: 'Essayez ceci.' }]);
    const ui = new ScriptedConversation({ asks: ['Comment faire un publipostage dans Word ?'], fixed: [false], picks: [0] });
    const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant });
    expect(out.handedOver).toBe(true);
  });

  it('assistant indisponible ou absent : on le dit et on propose un technicien', async () => {
    for (const assistant of [undefined, new FakeAssistant([{ available: false }])]) {
      const ui = new ScriptedConversation({ asks: ['Comment faire un publipostage dans Word ?', null], picks: [1] });
      const out = await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant });
      expect(ui.said).toMatch(/pas disponible/);
      expect(ui.choices).toHaveLength(1);
      expect(out.handedOver).toBe(false);
    }
  });

  it('une question d’usage ne lance jamais de compétence (rien ne s’exécute sur l’appareil)', async () => {
    const asked: string[] = [];
    const assistant = new FakeAssistant([{ available: true, text: 'Voici.' }]);
    const ui = new ScriptedConversation({ asks: ['Comment trier un tableau dans Excel ?', null] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), assistant, resolve: resolver({}, asked) });
    expect(asked).toEqual([]);
    expect(noRunner.calls).toEqual([]);
  });
});
