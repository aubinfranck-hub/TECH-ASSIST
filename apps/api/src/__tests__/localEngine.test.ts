import { describe, expect, it } from 'vitest';
import { runLocalDiagnostic } from '../diagnostics/localEngine.js';

describe('runLocalDiagnostic', () => {
  it('détecte un problème matériel comme hors périmètre', () => {
    const result = runLocalDiagnostic({
      platform: 'android',
      problemDescription: 'Mon téléphone est tombé et l\'écran est cassé',
      answers: {},
    });
    expect(result.outOfScope).toBe(true);
    expect(result.requiresRemoteSession).toBe(false);
  });

  it('propose des causes pour un problème de lenteur', () => {
    const result = runLocalDiagnostic({
      platform: 'windows',
      problemDescription: 'Mon PC est très lent depuis quelques jours',
      answers: {},
    });
    expect(result.outOfScope).toBe(false);
    expect(result.likelyCauses.length).toBeGreaterThan(0);
    expect(result.source).toBe('local_engine');
  });

  it('reste honnête (confiance basse) quand la description est trop vague', () => {
    const result = runLocalDiagnostic({
      platform: 'windows',
      problemDescription: 'ça marche pas',
      answers: {},
    });
    expect(result.confidence).toBeLessThan(50);
  });

  it('ne force jamais la confiance dans une fourchette artificielle', () => {
    const vague = runLocalDiagnostic({ platform: 'windows', problemDescription: 'bug', answers: {} });
    const precise = runLocalDiagnostic({
      platform: 'windows',
      problemDescription: 'wifi ne se connecte pas, virus détecté, PC très lent',
      answers: {},
    });
    expect(vague.confidence).not.toBe(precise.confidence);
  });
});
