import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

describe('encryptSecret / decryptSecret', () => {
  it('chiffre puis déchiffre fidèlement', () => {
    const secret = 'mot-de-passe-rustdesk-123';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
    const a = encryptSecret('même-secret');
    const b = encryptSecret('même-secret');
    expect(a).not.toBe(b);
  });

  it('rejette un secret altéré (intégrité AEAD)', () => {
    const encrypted = encryptSecret('secret');
    const tampered = encrypted.slice(0, -2) + 'zz';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
