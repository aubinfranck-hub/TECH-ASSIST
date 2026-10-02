import { describe, expect, it } from 'vitest';
import { REPAIR_STEPS, classify, formatFindings, repairMyPc, scanPc, type RepairStep } from '../repairPc.js';
import type { Action, Diagnosis, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';

const diag = (p: Partial<Diagnosis>): Diagnosis => ({ summary: 'ok', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...p });
const act = (id: string, run: Action['run'], patch: Partial<Action> = {}): Action => ({ id, title: `Action ${id}`, explanation: `Explication ${id}`, requiresAdmin: false, verified: true, run, ...patch });

/** Compétence bouchon : cassée tant que son action n'a pas été exécutée. */
function fakeStep(id: string, patch: { critical?: boolean; reboot?: boolean; sensitive?: boolean; fails?: boolean; advice?: string[]; broken?: boolean } = {}) {
  const state = { fixed: false, ran: 0 };
  const skill: Skill = {
    id,
    title: `Tâche ${id}`,
    verifyQuestion: 'Réglé ?',
    async diagnose() {
      if (patch.critical) return diag({ summary: `Souci critique ${id}`, healthy: false, needsHuman: true, problems: [id] });
      if (patch.broken === false) return diag({ advice: patch.advice ?? [] });
      if (state.fixed) return diag({ summary: `Corrigé ${id}` });
      return diag({
        summary: `Problème ${id}`,
        healthy: false,
        problems: [id],
        actions: [
          act(`fix_${id}`, async () => {
            state.ran += 1;
            if (patch.fails) return { ok: false, message: 'Accès refusé' };
            state.fixed = true;
            return { ok: true, message: 'ok' };
          }, { needsReboot: patch.reboot, ...(patch.sensitive ? { risk: 'sensitive' as const, prepare: act('restore_point', async () => ({ ok: true, message: 'ok' })) } : {}) }),
        ],
      });
    },
  };
  const step: RepairStep = { id, label: `Étape ${id}`, build: () => skill };
  return { step, state };
}
const healthyStep = (id: string, advice: string[] = []): RepairStep => ({
  id,
  label: `Étape ${id}`,
  build: () => ({ id, title: id, verifyQuestion: '?', diagnose: async () => diag({ advice }) }),
});

const ctx = (ui: ScriptedConversation, reporter = new Recorder()) => ({ runner: new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]), ui, reporter, machine: 'PC-COMPTA-04' });

describe('classement par gravité', () => {
  it('🔴 / 🟠 / 🟡 / 🟢', () => {
    expect(classify(diag({ healthy: false, needsHuman: true }))).toBe('critical');
    expect(classify(diag({ healthy: false, actions: [act('a', async () => ({ ok: true, message: '' }))] }))).toBe('fixable');
    expect(classify(diag({ advice: ['x'] }))).toBe('watch');
    expect(classify(diag({ healthy: false }))).toBe('watch');
    expect(classify(diag({}))).toBe('ok');
  });
  it('la liste des étapes réelles est cohérente (ids uniques, réseau en premier)', () => {
    const ids = REPAIR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('network');
    expect(ids).toEqual(expect.arrayContaining(['security', 'disk', 'cleanup', 'windows-repair', 'drivers', 'crashes', 'startup', 'performance', 'battery']));
  });
  it('une analyse qui plante est signalée (⚪), jamais ignorée', async () => {
    const bad: RepairStep = { id: 'x', label: 'X', build: () => ({ id: 'x', title: 'x', verifyQuestion: '?', diagnose: async () => { throw new Error('boum'); } }) };
    const [f] = await scanPc(new ScriptedRunner([]), [bad]);
    expect(f).toMatchObject({ severity: 'unknown' });
    expect(f!.summary).toMatch(/Analyse impossible : boum/);
    expect(formatFindings([f!])).toContain('⚪');
  });
});

describe('RÉPARER MON PC', () => {
  it('rien à corriger : aucune question, aucune modification', async () => {
    const ui = new ScriptedConversation();
    const out = await repairMyPc(ctx(ui), [healthyStep('a'), healthyStep('b')]);
    expect(out.status).toBe('nothing_to_fix');
    expect(ui.proposed).toEqual([]);
    expect(ui.said).toMatch(/aucun problème à corriger/);
  });

  it('annonce « N problèmes détectés… [RÉPARER LES N PROBLÈMES] », corrige, relit, rapporte', async () => {
    const a = fakeStep('a');
    const b = fakeStep('b');
    const c = fakeStep('c', { critical: true });
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    const out = await repairMyPc(ctx(ui, reporter), [a.step, b.step, c.step, healthyStep('d', ['Un conseil'])]);
    expect(ui.said).toMatch(/3 problèmes détectés\. 2 peuvent être corrigés automatiquement, 1 nécessite un technicien/);
    expect(ui.proposed[0]).toBe('confirm_only');
    expect(ui.said).toMatch(/Un conseil/);
    expect(a.state.ran).toBe(1);
    expect(b.state.ran).toBe(1);
    // le critique n'est jamais « réparé » : passage de main enregistré
    expect(reporter.types).toContain('escalated');
    expect(out.status).toBe('partial');
    const report = ui.infos.find((m) => m.startsWith("RAPPORT D'INTERVENTION"))!;
    expect(report).toContain('ORDINATEUR\nPC-COMPTA-04');
    expect(report).toContain('✔ Action fix_a');
    expect(report).toContain('✔ Action fix_b');
    expect(report).toContain('Seconde analyse');
    expect(report).toMatch(/🔴 Étape c/);
    expect(report).toContain('🟠 PARTIELLEMENT RÉSOLU');
  });

  it('tout corrigé : 🟢 RÉSOLU, un seul rapport global', async () => {
    const a = fakeStep('a');
    const ui = new ScriptedConversation();
    const out = await repairMyPc(ctx(ui), [a.step, healthyStep('b')]);
    expect(out.status).toBe('repaired');
    expect(ui.infos.filter((m) => m.startsWith("RAPPORT D'INTERVENTION"))).toHaveLength(1);
    expect(ui.said).toContain('🟢 RÉSOLU');
  });

  it('refus du lot : rien n’est modifié', async () => {
    const a = fakeStep('a');
    const ui = new ScriptedConversation({ approve: { confirm_only: false } });
    const out = await repairMyPc(ctx(ui), [a.step]);
    expect(out.status).toBe('declined');
    expect(a.state.ran).toBe(0);
    expect(ui.said).toMatch(/AUCUNE MODIFICATION/);
  });

  it('chaque action garde son propre accord : un refus ponctuel est respecté et noté', async () => {
    const a = fakeStep('a');
    const b = fakeStep('b');
    const ui = new ScriptedConversation({ approve: { fix_a: false } });
    await repairMyPc(ctx(ui), [a.step, b.step]);
    expect(a.state.ran).toBe(0);
    expect(b.state.ran).toBe(1);
    expect(ui.said).toContain('○ refusée : Action fix_a');
  });

  it('pas de question « est-ce réglé ? » à chaque étape : la seconde analyse fait foi', async () => {
    const a = fakeStep('a');
    const b = fakeStep('b');
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(ui), [a.step, b.step]);
    expect(ui.questions).toEqual([]);
  });

  it('un échec d’action enregistré par le serveur compte comme passage de main pour la conversation', async () => {
    const a = fakeStep('a', { fails: true });
    const out = await repairMyPc(ctx(new ScriptedConversation()), [a.step]);
    expect(out).toMatchObject({ escalated: true });
  });

  it('un échec est dans le rapport et ne bloque pas les autres étapes', async () => {
    const a = fakeStep('a', { fails: true });
    const b = fakeStep('b');
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(ui), [a.step, b.step]);
    expect(b.state.ran).toBe(1);
    expect(ui.said).toContain('✖ échec : Action fix_a');
  });

  it('point de restauration créé UNE fois pour tout le lot', async () => {
    const a = fakeStep('a', { sensitive: true });
    const b = fakeStep('b', { sensitive: true });
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(ui), [a.step, b.step]);
    expect(ui.infos.filter((m) => m.startsWith('Action restore_point') || m.includes('restore_point'))).toBeDefined();
    expect(ui.infos.filter((m) => /: fait\./.test(m))).toHaveLength(1);
  });

  it('un seul redémarrage, proposé à la fin, après toutes les corrections', async () => {
    const a = fakeStep('a', { reboot: true });
    const b = fakeStep('b');
    const ui = new ScriptedConversation();
    const out = await repairMyPc(ctx(ui), [a.step, b.step]);
    expect(b.state.ran).toBe(1);
    expect(ui.proposed.filter((id) => id === 'reboot')).toHaveLength(1);
    expect(ui.proposed.indexOf('reboot')).toBeGreaterThan(ui.proposed.indexOf('fix_b'));
    expect(out).toMatchObject({ status: 'partial', reboot: 'accepted' });
    expect(ui.said).toContain('🟡 EN ATTENTE DE REDÉMARRAGE');
  });

  it('redémarrage refusé : le client est guidé, la seconde analyse a lieu', async () => {
    const a = fakeStep('a', { reboot: true });
    const ui = new ScriptedConversation({ approve: { reboot: false } });
    const out = await repairMyPc(ctx(ui), [a.step]);
    expect(out).toMatchObject({ reboot: 'declined' });
    expect(ui.said).toMatch(/Redémarrez l'ordinateur quand vous voulez/);
    expect(ui.said).toMatch(/Seconde analyse/);
  });

  it('problèmes critiques seuls : pas de bouton « réparer », passage de main', async () => {
    const c = fakeStep('c', { critical: true });
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    await repairMyPc(ctx(ui, reporter), [c.step]);
    expect(ui.proposed).toEqual([]);
    expect(reporter.types).toContain('escalated');
    expect(ui.said).toMatch(/À confier à un technicien/);
  });

  it('serveur injoignable pour l’escalade : le client est prévenu honnêtement', async () => {
    const c = fakeStep('c', { critical: true });
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    reporter.event = async () => { throw new Error('serveur injoignable'); };
    await repairMyPc(ctx(ui, reporter), [c.step]);
    expect(ui.said).toMatch(/Je n'ai pas pu prévenir le serveur/);
  });
});
