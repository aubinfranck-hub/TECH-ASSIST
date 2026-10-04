import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import type { Skill } from '../types.js';
import { FakeMachine, RecordingReporter, ScriptedUi, healthyState } from './fakeMachine.js';

// Compétence qui ne trouve rien d'anormal : seul le client peut dire si c'est réglé.
const quiet: Skill = {
  id: 'quiet',
  title: 'Test',
  verifyQuestion: 'Est-ce réglé ?',
  async diagnose() {
    return { summary: 'Rien d\'anormal.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
  },
};

function ctx(ui: ScriptedUi, consult?: (i: { skill: string; summary: string; reason: string }) => Promise<boolean>) {
  return { runner: new FakeMachine(healthyState()), ui, reporter: new RecordingReporter(), ...(consult ? { consult } : {}) };
}

describe("l'IA essaie avant le technicien", () => {
  it('le client dit non, l\'IA le dépanne : pas de passage de main', async () => {
    let asked = 0;
    const out = await runSkill(quiet, ctx(new ScriptedUi({ heard: [false] }), async (i) => { asked++; expect(i.summary).toContain('Rien'); return true; }));
    expect(asked).toBe(1);
    expect(out.status).toBe('fixed');
  });
  it('l\'IA ne règle pas non plus : alors seulement le technicien, et une seule consultation', async () => {
    let asked = 0;
    const out = await runSkill(quiet, ctx(new ScriptedUi({ heard: [false] }), async () => { asked++; return false; }));
    expect(asked).toBe(1);
    expect(out.status).toBe('escalated');
  });
  it('sans IA disponible : passage de main direct comme avant', async () => {
    expect((await runSkill(quiet, ctx(new ScriptedUi({ heard: [false] })))).status).toBe('escalated');
  });
  it('même quand le diagnostic exige un technicien ou qu\'une action échoue, l\'IA est consultée d\'abord', async () => {
    const needs: Skill = { ...quiet, async diagnose() { return { summary: 'Réglage de sécurité.', problems: ['x'], actions: [], advice: [], healthy: false, needsHuman: true }; } };
    let asked = 0;
    const out = await runSkill(needs, ctx(new ScriptedUi({ heard: [true] }), async () => { asked++; return true; }));
    expect(asked).toBe(1);
    expect(out.status).toBe('fixed');
    const out2 = await runSkill(needs, ctx(new ScriptedUi({ heard: [false] }), async () => { asked++; return false; }));
    expect(asked).toBe(2);
    expect(out2.status).toBe('escalated');
  });
});
