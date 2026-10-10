/**
 * Choix de la meilleure voix française GRATUITE du navigateur (aucun service payant, aucune clé) :
 *  - Edge : voix « Online (Natural) » (Denise, Henri…), très naturelles ;
 *  - Chrome : voix réseau « Google français » ;
 *  - sinon : la voix française installée, en évitant les vieilles voix Windows (Hortense…) quand mieux existe.
 */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

export function voiceScore(v: VoiceLike): number {
  if (!/^fr([-_]|$)/i.test(v.lang)) return -1000;
  const n = v.name.toLowerCase();
  let score = 0;
  if (n.includes('natural') || n.includes('neural')) score += 100;
  if (n.includes('online')) score += 40;
  if (n.includes('google')) score += 60;
  if (n.includes('multilingual')) score += 10;
  if (/^fr[-_]fr$/i.test(v.lang)) score += 20;
  else if (/^fr[-_](ca|be|ch)$/i.test(v.lang)) score += 5;
  if (v.localService === false) score += 15; // les voix réseau sont en général meilleures
  if (n.includes('hortense') || n.includes('julie') || n.includes('paul') || n.includes('espeak')) score -= 30; // anciennes voix de synthèse
  return score;
}

export function pickFrenchVoice<T extends VoiceLike>(voices: T[]): T | null {
  const french = voices.filter((v) => voiceScore(v) > -1000);
  if (french.length === 0) return null;
  return [...french].sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null;
}
