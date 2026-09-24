import { describe, expect, it } from 'vitest';
import { extractSearchPathSchema } from '../utils/dbSchema.js';

describe('extractSearchPathSchema', () => {
  it('extrait le schéma depuis une URL avec options search_path', () => {
    const url = 'postgresql://user:pass@host/db?options=-csearch_path%3Dtech_assist';
    expect(extractSearchPathSchema(url)).toBe('tech_assist');
  });

  it('retourne null sans paramètre options', () => {
    expect(extractSearchPathSchema('postgresql://user:pass@host/db')).toBeNull();
  });

  it('retourne null si options ne contient pas search_path', () => {
    const url = 'postgresql://user:pass@host/db?options=-cstatement_timeout%3D5000';
    expect(extractSearchPathSchema(url)).toBeNull();
  });

  it('rejette les caractères non alphanumériques (pas d\'injection SQL possible)', () => {
    const url = 'postgresql://user:pass@host/db?options=-csearch_path%3Dtech%3B DROP TABLE x--';
    // Le motif s'arrête au premier caractère non autorisé : rien d'exploitable n'est extrait tel quel.
    expect(extractSearchPathSchema(url)).toBe('tech');
  });
});
