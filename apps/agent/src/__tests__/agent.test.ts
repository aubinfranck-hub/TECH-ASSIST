import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { soundSkill } from '../skills/sound.js';
import type { Reporter } from '../types.js';
import {
  FakeMachine,
  HEADSET_GUID,
  RecordingReporter,
  SPEAKER_GUID,
  ScriptedUi,
  healthyState,
  type MachineOptions,
  type MachineState,
} from './fakeMachine.js';

function setup(patch: Partial<MachineState> = {}, options: MachineOptions = {}, ui: ConstructorParameters<typeof ScriptedUi>[0] = {}) {
  const machine = new FakeMachine({ ...healthyState(), ...patch }, options);
  const reporter = new RecordingReporter();
  const screen = new ScriptedUi(ui);
  return { machine, reporter, screen, run: () => runSkill(soundSkill, { runner: machine, ui: screen, reporter }) };
}

// Fonction, pas constante : le faux Windows modifie son état, les tests ne doivent pas se le partager.
const disabledSpeaker = (): Partial<MachineState> => ({
  endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Speaker' }],
});

describe("l'agent : scénario réel (sortie désactivée)", () => {
  it('propose, attend le oui, répare, vérifie, demande au client, puis termine', async () => {
    const s = setup(disabledSpeaker());
    const outcome = await s.run();

    expect(outcome).toEqual({ status: 'fixed', actionsDone: ['enable_endpoint'] });
    expect(s.machine.state.endpoints[0]!.state).toBe(1);
    expect(s.reporter.types).toEqual(['diagnosed', 'action_proposed', 'action_approved', 'action_done', 'verified']);
    expect(s.screen.questions).toHaveLength(1);
  });

  it('ne modifie rien avant le oui du client', async () => {
    let modificationsAtProposal = -1;
    const s = setup(disabledSpeaker(), {}, { beforeConfirm: () => (modificationsAtProposal = s.machine.modifications.length) });
    await s.run();
    expect(modificationsAtProposal).toBe(0);
  });

  it('un refus du client : aucune modification, résultat « declined »', async () => {
    const s = setup(disabledSpeaker(), {}, { approve: { enable_endpoint: false } });
    const outcome = await s.run();
    expect(outcome.status).toBe('declined');
    expect(s.machine.modifications).toHaveLength(0);
    expect(s.reporter.types).toEqual(['diagnosed', 'action_proposed', 'action_declined']);
  });
});

describe("l'agent : autres problèmes", () => {
  it('sourdine + volume bas : deux corrections successives', async () => {
    const s = setup({ muted: true, volume: 0.01 });
    const outcome = await s.run();
    expect(outcome).toEqual({ status: 'fixed', actionsDone: ['unmute', 'set_volume'] });
    expect(s.machine.state).toMatchObject({ muted: false, volume: 0.5 });
  });

  it('services audio arrêtés : les démarre', async () => {
    const s = setup({ services: [{ name: 'Audiosrv', status: 'Stopped' }, { name: 'AudioEndpointBuilder', status: 'Stopped' }] });
    const outcome = await s.run();
    expect(outcome.status).toBe('fixed');
    expect(s.machine.state.services.every((x) => x.status === 'Running')).toBe(true);
  });

  it('un refus partiel : applique ce qui est accepté et vérifie quand même', async () => {
    const s = setup({ muted: true, volume: 0.01 }, {}, { approve: { set_volume: false } });
    const outcome = await s.run();
    // La sourdine est levée, mais le volume reste quasi nul : l'agent le voit à la vérification.
    expect(outcome.status).toBe('escalated');
    expect(s.machine.state.muted).toBe(false);
    expect(s.machine.state.volume).toBe(0.01);
    expect(s.reporter.types).toContain('verified');
  });

  it('rien d’anormal et le client entend : terminé sans rien modifier', async () => {
    const s = setup();
    const outcome = await s.run();
    expect(outcome).toEqual({ status: 'fixed', actionsDone: [] });
    expect(s.machine.modifications).toHaveLength(0);
  });

  it('rien d’anormal mais le client n’entend rien : passe la main à un technicien', async () => {
    const s = setup({}, {}, { heard: [false] });
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(s.reporter.types).toEqual(['diagnosed', 'escalated']);
  });

  it('sortie débranchée : donne le conseil, pas d’action ; si ça ne suffit pas, escalade', async () => {
    const s = setup({ endpoints: [{ flow: 'Render', guid: HEADSET_GUID, state: 8, name: 'Casque' }] }, {}, { heard: [false] });
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(s.screen.infos.join(' ')).toMatch(/Branchez/);
    expect(s.machine.modifications).toHaveLength(0);
  });

  it('aucune carte son : escalade immédiate, sans rien tenter', async () => {
    const s = setup({ endpoints: [] });
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(s.screen.proposed).toEqual([]);
    expect(s.screen.questions).toEqual([]);
    expect(s.machine.modifications).toHaveLength(0);
    expect(s.reporter.types).toEqual(['diagnosed', 'escalated']);
  });
});

describe("l'agent : quand ça se passe mal", () => {
  it('une action qui échoue : le dit, journalise, et passe la main sans insister', async () => {
    const s = setup(
      { services: [{ name: 'Audiosrv', status: 'Stopped' }, { name: 'AudioEndpointBuilder', status: 'Running' }] },
      { failStartServices: true },
    );
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(s.reporter.types).toEqual(['diagnosed', 'action_proposed', 'action_approved', 'action_failed', 'escalated']);
    expect(s.screen.infos.join(' ')).toMatch(/pas réussi/);
  });

  it('un échec arrête la suite : les actions suivantes ne sont pas tentées', async () => {
    const s = setup(
      { endpoints: [
        { flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'A' },
        { flow: 'Render', guid: HEADSET_GUID, state: 2, name: 'B' },
      ] },
      { failEnable: true },
    );
    await s.run();
    expect(s.machine.modifications).toHaveLength(1);
  });

  it('une action qui plante (délai dépassé) est traitée comme un échec', async () => {
    const s = setup(disabledSpeaker(), { crashOnAction: true });
    const outcome = await s.run();
    expect(outcome).toMatchObject({ status: 'escalated' });
    expect(s.reporter.types).toContain('action_failed');
  });

  it('action « réussie » sans effet réel : la relecture le détecte et escalade', async () => {
    const s = setup(disabledSpeaker(), { noEffect: true });
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(s.reporter.events.find((e) => e.type === 'verified')?.details).toMatchObject({ healthy: false });
    expect(s.screen.questions).toEqual([]); // inutile de demander au client : l'état est toujours cassé
  });

  it('corrigé côté Windows mais le client n’entend toujours rien : escalade', async () => {
    const s = setup(disabledSpeaker(), {}, { heard: [false] });
    const outcome = await s.run();
    expect(outcome.status).toBe('escalated');
    expect(outcome).toMatchObject({ actionsDone: ['enable_endpoint'] });
  });

  it('diagnostic impossible : escalade sans rien modifier', async () => {
    const s = setup({}, { failCollect: true });
    const outcome = await s.run();
    expect(outcome).toMatchObject({ status: 'escalated' });
    expect((outcome as { reason: string }).reason).toMatch(/Diagnostic impossible/);
    expect(s.machine.modifications).toHaveLength(0);
  });

  it('un journal serveur en panne n’empêche jamais le dépannage', async () => {
    const machine = new FakeMachine({ ...healthyState(), ...disabledSpeaker() });
    const broken: Reporter = {
      async event() {
        throw new Error('le serveur a répondu 503');
      },
    };
    const outcome = await runSkill(soundSkill, { runner: machine, ui: new ScriptedUi(), reporter: broken });
    expect(outcome.status).toBe('fixed');
  });
});
