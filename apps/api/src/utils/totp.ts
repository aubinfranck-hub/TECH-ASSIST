import { createHmac, randomBytes } from 'node:crypto';

/**
 * RS-08 : TOTP (RFC 6238) implémenté sans dépendance externe — HMAC-SHA1,
 * 6 chiffres, pas de 30s, fenêtre de tolérance ±1 pas (horloges légèrement désynchronisées).
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const chunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secret TOTP invalide');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function generateTotpCode(secretBase32: string, forTime: number = Date.now()): string {
  const counter = Math.floor(forTime / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

export function verifyTotpCode(secretBase32: string, code: string, forTime: number = Date.now()): boolean {
  if (!/^[0-9]{6}$/.test(code)) return false;
  const counter = Math.floor(forTime / 1000 / STEP_SECONDS);
  const secret = base32Decode(secretBase32);
  for (const drift of [-1, 0, 1]) {
    const driftedCounter = counter + drift;
    if (driftedCounter < 0) continue;
    if (hotp(secret, driftedCounter) === code) return true;
  }
  return false;
}

export function buildOtpauthUri(secretBase32: string, accountName: string, issuer = 'Tech Assist'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
