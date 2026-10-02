import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { formatDuration, formatReport, type InterventionReport } from '../report.js';
import { rebootAction, restorePointAction, withRestorePoint } from '../skills/safety.js';
import type { Action, Diagnosis, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, fail, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const diagnosis = (patch: Partial<Diagnosis>): Diagnosis => ({ summary: 'Tout va bien.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...patch });

/** Compétence bouchon : un problème tant qu'une action n'a pas été exécutée. */
function stub(options: { actions: () => Action[]; reboot?: boolean }) {
  const state = { fixed: false, diagnoses: 0 };
  const skill: Skill = {
    id: 'stub',
    title: 'Tâche de test',
    verifyQuestion: 'Est-ce réglé ?',
    async diagnose() {
      state.diagnoses += 1;
      return state.fixed
        ? diagnosis({ summary: 'Corrigé.' })
        : diagnosis({ summary: 'Un problème.', problems: ['p'], healthy: false, actions: options.actions() });
    },
  };
  return { skill, state };
}

const action = (id: string, run: Action['run'], patch: Partial<Action> = {}): Action => ({
  id,
  title: `Action ${id}`,
  explanation: `Explication ${id}.`,
  requiresAdmin: false,
  verified: true,
  run,
  ...patch,
});

describe('point de restauration avant une action sensible', () => {
  function machine() {
    const order: string[] = [];
    const runner = new ScriptedRunner([
      { label: 'restore', test: (s) => s.includes('Checkpoint-Computer'), reply: () => { order.push('restore'); return ok(); } },
      { label: 'work', test: (s) => s.includes('Faire-Un-Truc'), reply: () => { order.push('work'); return ok(); } },
    ]);
    return { runner, order };
  }
  const sensitive = (id: string, state: { fixed: boolean }) =>
    withRestorePoint(action(id, async (r) => { const res = await r.runPowerShell('Faire-Un-Truc'); state.fixed = true; return { ok: res.exitCode === 0, message: 'ok' }; }));

  it('crée le point de restauration APRÈS l’accord et AVANT la modification, une seule fois pour plusieurs actions', async () => {
    const { runner, order } = machine();
    const s = stub({ actions: () => [sensitive('a', s.state), sensitive('b', s.state)] });
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    const out = await runSkill(s.skill, { runner, ui, reporter });
    expect(out.status).toBe('fixed');
    expect(order).toEqual(['restore', 'work', 'work']);
    expect(ui.said).toMatch(/Créer un point de restauration Windows : fait/);
    expect(reporter.events.filter((e) => e.action === 'restore_point' && e.type === 'action_done')).toHaveLength(1);
  });

  it('l’explication de l’action annonce le point de restauration', () => {
    const wrapped = withRestorePoint(action('x', async () => ({ ok: true, message: '' })));
    expect(wrapped.risk).toBe('sensitive');
    expect(wrapped.explanation).toMatch(/point de restauration Windows sera créé/);
    expect(wrapped.prepare!.id).toBe('restore_point');
  });

  it('refus de l’action : aucun point de restauration, rien de modifié', async () => {
    const { runner, order } = machine();
    const s = stub({ actions: () => [sensitive('a', s.state)] });
    const out = await runSkill(s.skill, { runner, ui: new ScriptedConversation({ approve: { a: false } }), reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(order).toEqual([]);
  });

  it('échec du point de restauration : le client choisit ; « oui » poursuit', async () => {
    const runner = new ScriptedRunner([
      { label: 'restore', test: (s) => s.includes('Checkpoint-Computer'), reply: () => fail('Protection du système désactivée') },
      { label: 'work', test: (s) => s.includes('Faire-Un-Truc'), reply: () => ok() },
    ]);
    const s = stub({ actions: () => [sensitive('a', s.state)] });
    const ui = new ScriptedConversation();
    const out = await runSkill(s.skill, { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    expect(ui.proposed).toEqual(['a', 'confirm_only']);
    expect(runner.count('work')).toBe(1);
  });

  it('échec du point de restauration : « non » renonce à l’action (rien n’est modifié)', async () => {
    const runner = new ScriptedRunner([
      { label: 'restore', test: (s) => s.includes('Checkpoint-Computer'), reply: () => fail('Protection du système désactivée') },
      { label: 'work', test: (s) => s.includes('Faire-Un-Truc'), reply: () => ok() },
    ]);
    const s = stub({ actions: () => [sensitive('a', s.state)] });
    const ui = new ScriptedConversation({ approve: { confirm_only: false } });
    const out = await runSkill(s.skill, { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(runner.count('work')).toBe(0);
  });

  it('le point de restauration exige les droits administrateur et n’est pas présenté comme validé', () => {
    const action = restorePointAction();
    expect(action.requiresAdmin).toBe(true);
    expect(action.verified).toBe(false);
  });

  it('le script exécuté contient les commandes attendues et se termine par le « catch » de l’enveloppe', async () => {
    const runner = new ScriptedRunner([{ label: 'restore', test: () => true, reply: () => ok() }]);
    await restorePointAction().run(runner);
    const script = runner.calls[0]!.script;
    checkStructure(script);
    expect(script).toContain('Enable-ComputerRestore');
    expect(script).toContain('Checkpoint-Computer');
    expect(script).toContain('Get-ComputerRestorePoint');
  });
});

describe('correction qui exige un redémarrage', () => {
  function build(accept: boolean, shutdownOk = true) {
    const runner = new ScriptedRunner([
      { label: 'work', test: (s) => s.includes('Faire-Un-Truc'), reply: () => ok() },
      { label: 'shutdown', test: (s) => s.includes('shutdown.exe'), reply: () => (shutdownOk ? ok() : fail('Accès refusé')) },
    ]);
    const s = stub({ actions: () => [action('reset', async (r) => { await r.runPowerShell('Faire-Un-Truc'); s.state.fixed = true; return { ok: true, message: 'ok' }; }, { needsReboot: true })] });
    const ui = new ScriptedConversation({ approve: { reboot: accept } });
    return { runner, s, ui };
  }

  it('ne relit pas l’état, ne demande pas « est-ce réglé ? », propose le redémarrage (60 s, annulable) et le lance après accord', async () => {
    const { runner, s, ui } = build(true);
    const out = await runSkill(s.skill, { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'reboot_needed', actionsDone: ['reset'], rebooting: true });
    expect(s.state.diagnoses).toBe(1);
    expect(ui.questions).toEqual([]);
    const script = runner.calls.find((c) => c.label === 'shutdown')!.script;
    expect(script).toContain('/r /t 60');
    expect(ui.said).toMatch(/Je ne peux donc pas encore vérifier/);
    expect(ui.said).toContain('EN ATTENTE DE REDÉMARRAGE');
    expect(ui.said).toMatch(/Non vérifié/);
  });

  it('refus du redémarrage : rien n’est lancé, le client est guidé', async () => {
    const { runner, s, ui } = build(false);
    const out = await runSkill(s.skill, { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'reboot_needed', actionsDone: ['reset'], rebooting: false });
    expect(runner.count('shutdown')).toBe(0);
    expect(ui.said).toMatch(/Redémarrez l'ordinateur quand vous voulez/);
  });

  it('redémarrage refusé par Windows : le client est prévenu, sans faux espoir', async () => {
    const { runner, s, ui } = build(true, false);
    const out = await runSkill(s.skill, { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'reboot_needed', actionsDone: ['reset'], rebooting: false });
    expect(ui.said).toMatch(/Redémarrez l'ordinateur vous-même/);
  });

  it('le script de redémarrage est bien formé', async () => {
    const runner = new ScriptedRunner([{ label: 'shutdown', test: () => true, reply: () => ok() }]);
    await rebootAction().run(runner);
    checkStructure(runner.calls[0]!.script);
  });
});

describe('rapport d’intervention', () => {
  const clock = (...times: number[]) => {
    let i = 0;
    return () => times[Math.min(i++, times.length - 1)]!;
  };

  it('résolu : tâche, diagnostic, actions, test, statut et durée', async () => {
    const runner = new ScriptedRunner([{ label: 'work', test: () => true, reply: () => ok() }]);
    const s = stub({ actions: () => [action('fix', async () => { s.state.fixed = true; return { ok: true, message: 'ok' }; })] });
    const ui = new ScriptedConversation();
    await runSkill(s.skill, { runner, ui, reporter: new Recorder(), now: clock(0, 134_000) });
    const report = ui.infos.find((m) => m.startsWith("RAPPORT D'INTERVENTION"))!;
    expect(report).toContain('TÂCHE\nTâche de test');
    expect(report).toContain('DIAGNOSTIC\nUn problème.');
    expect(report).toContain('✔ Action fix');
    expect(report).toContain('Relecture de Windows : Corrigé. Confirmé par le client.');
    expect(report).toContain('STATUT\n🟢 RÉSOLU');
    expect(report).toContain('DURÉE\n2 min 14 s');
  });

  it('refusé : « aucune modification », avec l’action refusée', async () => {
    const s = stub({ actions: () => [action('fix', async () => ({ ok: true, message: '' }))] });
    const ui = new ScriptedConversation({ approve: { fix: false } });
    await runSkill(s.skill, { runner: new ScriptedRunner([]), ui, reporter: new Recorder() });
    expect(ui.said).toContain('○ refusée : Action fix');
    expect(ui.said).toContain('AUCUNE MODIFICATION');
  });

  it('échec puis passage de main : l’échec est dans le rapport, statut « non résolu »', async () => {
    const s = stub({ actions: () => [action('fix', async () => ({ ok: false, message: 'Accès refusé' }))] });
    const ui = new ScriptedConversation();
    await runSkill(s.skill, { runner: new ScriptedRunner([]), ui, reporter: new Recorder() });
    expect(ui.said).toContain('✖ échec : Action fix');
    expect(ui.said).toContain('🔴 NON RÉSOLU');
  });

  it('correction faite mais problème qui persiste : « partiellement résolu »', async () => {
    const s = stub({ actions: () => [action('fix', async () => ({ ok: true, message: 'ok' }))] }); // l'état reste cassé
    const ui = new ScriptedConversation();
    await runSkill(s.skill, { runner: new ScriptedRunner([]), ui, reporter: new Recorder() });
    expect(ui.said).toContain('🟠 PARTIELLEMENT RÉSOLU');
  });

  it('formatDuration', () => {
    expect(formatDuration(200)).toBe("moins d'une seconde");
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(134_000)).toBe('2 min 14 s');
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
    expect(formatDuration(-5)).toBe("moins d'une seconde");
  });

  it('formatReport : sans action ni test', () => {
    const text = formatReport({ task: 'T', diagnosis: '', actions: [], test: '', status: 'unresolved', durationMs: 1000 } satisfies InterventionReport);
    expect(text).toContain('Aucune modification effectuée');
    expect(text).toContain('Non vérifié');
    expect(text).toContain('Aucun diagnostic');
  });
});
