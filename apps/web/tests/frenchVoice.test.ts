import { describe, expect, it } from 'vitest';
import { pickFrenchVoice } from '../src/lib/frenchVoice.js';

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });

describe('Meilleure voix française gratuite du navigateur', () => {
  it('Edge : préfère la voix « Online (Natural) » à l’ancienne voix Windows', () => {
    const picked = pickFrenchVoice([v('Microsoft Hortense - French (France)', 'fr-FR'), v('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', false), v('Microsoft David - English (United States)', 'en-US')]);
    expect(picked?.name).toContain('Denise Online (Natural)');
  });

  it('Chrome : préfère « Google français » à une voix locale', () => {
    expect(pickFrenchVoice([v('Microsoft Julie - French (France)', 'fr-FR'), v('Google français', 'fr-FR', false)])?.name).toBe('Google français');
  });

  it('une voix naturelle canadienne passe avant une vieille voix de France', () => {
    expect(pickFrenchVoice([v('Microsoft Paul - French (France)', 'fr-FR'), v('Microsoft Sylvie Online (Natural) - French (Canada)', 'fr-CA', false)])?.name).toContain('Sylvie');
  });

  it('aucune voix française : null (le navigateur garde sa voix par défaut) ; les voix étrangères sont ignorées', () => {
    expect(pickFrenchVoice([v('Microsoft David - English (United States)', 'en-US')])).toBeNull();
    expect(pickFrenchVoice([])).toBeNull();
  });

  it('une seule voix française : on la prend', () => {
    expect(pickFrenchVoice([v('Voix FR', 'fr_FR')])?.name).toBe('Voix FR');
  });
});
