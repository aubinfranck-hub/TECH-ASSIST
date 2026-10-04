import { describe, expect, it } from 'vitest';
import { PANNES } from '../assistant/pannesData.js';
import { referenceFor, searchPannes } from '../assistant/pannes.js';

describe('Base de pannes', () => {
  it('contient plus de 380 fiches complètes (titre, solution) sans doublon de titre', () => {
    expect(PANNES.length).toBeGreaterThan(380);
    expect(PANNES.every((p) => p.title.length > 5 && p.solution.length > 5)).toBe(true);
    expect(new Set(PANNES.map((p) => p.title)).size).toBe(PANNES.length);
  });

  it('trouve une fiche par symptôme, sans tenir compte des accents', () => {
    const hits = searchPannes('outlook bloque sur traitement en cours');
    expect(hits[0]?.panne.title).toMatch(/Outlook/);
    expect(searchPannes('ecran noir curseur souris').some((h) => /curseur/i.test(h.panne.title))).toBe(true);
    expect(searchPannes('zzzz qqqq')).toEqual([]);
  });

  it("ne glisse à l'assistant que des pistes faisables par le client (pas de matériel, BIOS, registre)", () => {
    const ref = referenceFor('mon outlook demande le mot de passe en boucle');
    expect(ref).toContain('Fiches de référence');
    expect(referenceFor('soudure condensateur carte mère')).not.toMatch(/soud|multimètre/i);
  });
});
