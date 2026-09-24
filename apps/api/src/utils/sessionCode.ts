import { randomInt } from 'node:crypto';

/**
 * RS-03 : code de session à usage unique généré côté serveur (jamais côté navigateur).
 * 9 chiffres, tiré par un générateur cryptographique (pas Math.random()).
 */
export function generateSessionCode(): string {
  let code = '';
  for (let i = 0; i < 9; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

export const SESSION_CODE_TTL_MINUTES = 10;
