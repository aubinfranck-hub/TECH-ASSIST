import { describe, expect, it } from 'vitest';
import { buildOtpauthUri, generateTotpCode, generateTotpSecret, verifyTotpCode } from '../utils/totp.js';

// Vecteurs de test RFC 4226 (HOTP, secret ASCII "12345678901234567890"),
// réutilisés ici en TOTP en fixant le compteur via le temps (pas de 30s).
function base32(bufferAscii: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const buf = Buffer.from(bufferAscii, 'ascii');
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  const rem = bits.length % 5;
  if (rem > 0) out += alphabet[parseInt(bits.slice(bits.length - rem).padEnd(5, '0'), 2)];
  return out;
}

const RFC_SECRET_B32 = base32('12345678901234567890');
const EXPECTED_CODES = ['755224', '287082', '359152', '969429', '338314'];

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('produit les codes attendus par les vecteurs de test RFC 4226', () => {
    EXPECTED_CODES.forEach((expected, counter) => {
      const forTime = counter * 30 * 1000;
      expect(generateTotpCode(RFC_SECRET_B32, forTime)).toBe(expected);
    });
  });

  it('vérifie un code valide au bon pas de temps', () => {
    expect(verifyTotpCode(RFC_SECRET_B32, '755224', 0)).toBe(true);
  });

  it('rejette un code incorrect', () => {
    expect(verifyTotpCode(RFC_SECRET_B32, '000000', 0)).toBe(false);
  });

  it('tolère une dérive de ±1 pas de temps', () => {
    // Code du pas 0, vérifié à un instant situé dans le pas 1 (30-59s).
    expect(verifyTotpCode(RFC_SECRET_B32, '755224', 45 * 1000)).toBe(true);
    // Mais pas à 2 pas d'écart.
    expect(verifyTotpCode(RFC_SECRET_B32, '755224', 75 * 1000)).toBe(false);
  });

  it('génère des secrets aléatoires distincts en base32 valide', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z2-7]+$/);
  });

  it('construit une URI otpauth:// exploitable par une appli d\'authentification', () => {
    const uri = buildOtpauthUri('ABCDEFGH', 'admin', 'Tech Assist');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=Tech');
  });
});
