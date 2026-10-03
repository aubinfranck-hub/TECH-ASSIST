import { describe, expect, it } from 'vitest';
import { fatalMessage } from '../fatal.js';

describe("message d'erreur au démarrage (sans fenêtre de terminal)", () => {
  it('est simple, en français, et contient le détail', () => {
    const text = fatalMessage(new Error('EADDRINUSE: port occupé'));
    expect(text).toContain("n'a pas pu démarrer");
    expect(text).toContain('Relancez le programme');
    expect(text).toContain('EADDRINUSE');
  });

  it('reste court et sur une ligne de détail, même avec un très long message', () => {
    const text = fatalMessage(new Error('a\n'.repeat(500)));
    expect(text.split('Détail : ')[1]!.length).toBeLessThanOrEqual(240);
    expect(text.split('Détail : ')[1]).not.toContain('\n');
  });

  it("gère une erreur qui n'est pas un objet Error", () => {
    expect(fatalMessage('boum')).toContain('boum');
    expect(fatalMessage(undefined)).toContain('undefined');
  });
});
