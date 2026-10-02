/** Domaines d'adresses jetables : refusés pour l'assistance offerte (une adresse = une personne). */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'yopmail.com',
  'yopmail.fr',
  'guerrillamail.com',
  'guerrillamail.net',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'throwawaymail.com',
]);

/**
 * Forme canonique d'une adresse, pour qu'une même boîte ne puisse pas obtenir
 * plusieurs offres : casse ignorée, « +alias » retiré, et pour Gmail les points
 * (prenom.nom@gmail.com == prenomnom@gmail.com).
 */
export function normalizeEmail(raw: string): string {
  const [localRaw, domainRaw] = raw.trim().toLowerCase().split('@');
  let local = localRaw.split('+')[0];
  let domain = domainRaw;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1];
  return DISPOSABLE_DOMAINS.has(domain);
}
