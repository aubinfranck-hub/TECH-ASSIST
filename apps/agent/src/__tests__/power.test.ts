import { describe, expect, it } from 'vitest';
import { diagnosePower, parsePowerFacts, type PowerFacts } from '../skills/power.js';

const base: PowerFacts = {
  ctrlAltDelRequired: null, domainJoined: false, sleepMinutesAc: null, screenMinutesAc: null, passwordOnWake: null, lastWake: '',
  fastStartup: false, modernStandby: false, displayDriverResets: 0, gpuName: '', gpuDriverAgeDays: null,
};

describe('veille : réveil qui échoue', () => {
  it('pilote graphique planté : cause probable, technicien proposé', () => {
    const d = diagnosePower({ ...base, displayDriverResets: 3, gpuName: 'Intel(R) UHD Graphics' });
    expect(d.problems).toContain('display_driver_resets');
    expect(d.summary).toContain('3 fois');
    expect(d.needsHuman).toBe(true);
  });
  it('démarrage rapide activé : conseil précis', () => {
    const d = diagnosePower({ ...base, fastStartup: true });
    expect(d.problems).toContain('fast_startup');
    const a = d.actions.find((x) => x.id === 'disable_fast_startup')!;
    expect(a.requiresAdmin).toBe(true);
    expect(a.needsReboot).toBe(true);
    expect(a.explanation).toContain('réactiver');
  });
  it('pilote très ancien signalé, jamais de modification automatique', () => {
    const d = diagnosePower({ ...base, gpuDriverAgeDays: 1200, gpuName: 'NVIDIA GeForce' });
    expect(d.problems).toContain('old_gpu_driver');
    expect(d.actions).toEqual([]);
  });
  it('rien d\'anormal : message utile au lieu d\'un simple « tout va bien »', () => {
    const d = diagnosePower(base);
    expect(d.problems).toEqual([]);
    expect(d.summary).toContain('carte graphique');
  });
  it('lecture robuste : champs absents ou invalides ignorés', () => {
    const f = parsePowerFacts('{"gpuName":"X<script>","displayDriverResets":-2,"fastStartup":"oui"}');
    expect(f.displayDriverResets).toBeNull();
    expect(f.fastStartup).toBeNull();
    expect(f.gpuName).not.toContain('<');
  });
});
