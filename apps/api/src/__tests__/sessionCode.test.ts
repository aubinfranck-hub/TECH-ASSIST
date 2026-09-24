import { describe, expect, it } from 'vitest';
import { generateSessionCode } from '../utils/sessionCode.js';

describe('generateSessionCode', () => {
  it('génère un code de 9 chiffres', () => {
    const code = generateSessionCode();
    expect(code).toMatch(/^[0-9]{9}$/);
  });

  it('génère des codes différents (haute probabilité)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateSessionCode()));
    expect(codes.size).toBeGreaterThan(45);
  });
});
