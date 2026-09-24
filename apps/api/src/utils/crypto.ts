import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * RS-10 : secrets chiffrés au repos (ex : mot de passe de connexion RustDesk
 * d'une session), jamais en clair en base. AES-256-GCM, clé unique du serveur.
 */
function getKey(): Buffer {
  const raw = process.env.SESSION_SECRETS_KEY;
  if (!raw) throw new Error('SESSION_SECRETS_KEY manquant (voir .env.example)');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SESSION_SECRETS_KEY doit être 32 octets encodés en base64');
  }
  return key;
}

/** Retourne "iv:authTag:ciphertext" encodé en base64url, séparé par des ':'. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join(':');
}

export function decryptSecret(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Secret chiffré malformé');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
