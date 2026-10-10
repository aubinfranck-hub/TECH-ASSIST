import { PANNES, type Panne } from './pannesData.js';

const STOP = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'en', 'au', 'aux', 'je', 'mon', 'ma', 'mes', 'ne', 'pas', 'qui', 'que', 'est', 'sur', 'dans', 'avec', 'pour', 'plus', 'ca', 'ce', 'se', 'sa', 'son', 'ses', 'il', 'elle', 'quand', 'mais']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

const INDEX = PANNES.map((p) => ({ p, title: normalize(p.title), body: normalize(`${p.symptom} ${p.cause} ${p.category}`) }));

/** Solutions écrites en commandes : l'assistant n'en donne jamais au client, la fiche n'est donc pas transmise. */
const COMMAND = /\b(net (stop|start)|netsh|sfc|dism|chkdsk|w32tm|powercfg|regedit|gpedit|ipconfig|powershell|regsvr32|rename |reg add|cscript|wsreset|diskpart|msconfig)\b/i;

/** Les mots utiles d'une recherche (hors mots vides et mots trop courts). */
export function queryWordCount(query: string): number {
  return tokens(query).slice(0, 12).length;
}

/**
 * Une fiche répond-elle vraiment à la recherche ? Une seule correspondance dans le titre sur une recherche de plusieurs mots
 * (« étiquettes zebra vides » → « fichiers vidés ») est un faux ami : la base ne sait pas, mieux vaut interroger l'IA.
 */
export function isConfidentHit(hit: PanneHit, wordCount: number): boolean {
  if (wordCount <= 2) return hit.score >= 3;
  return hit.titleHits >= 2 || hit.score >= 6;
}

export interface PanneHit {
  panne: Panne;
  score: number;
  /** Nombre de mots du client trouvés dans le titre de la fiche. */
  titleHits: number;
}

/** Recherche par mots (sans accents) : le titre compte triple, le reste une fois ; préfixes acceptés (« démarr » trouve « démarrage »). */
export function searchPannes(query: string, limit = 5, minScore = 3): PanneHit[] {
  const words = tokens(query).slice(0, 12);
  if (words.length === 0) return [];
  const hits: PanneHit[] = [];
  for (const e of INDEX) {
    let score = 0;
    let titleHits = 0;
    for (const w of words) {
      const stem = w.length > 5 ? w.slice(0, w.length - 1) : w;
      if (e.title.includes(stem)) {
        score += 3;
        titleHits += 1;
      }
      else if (e.body.includes(stem)) score += 1;
    }
    if (score >= minScore) hits.push({ panne: e.p, score, titleHits });
  }
  hits.sort((a, b) => b.score - a.score || a.panne.id - b.panne.id);
  return hits.slice(0, limit);
}

/** Fiches utiles pour l'assistant IA : uniquement les solutions que le client peut faire lui-même (pas de matériel, BIOS, registre). */
export function referenceFor(query: string): string {
  // Seuil élevé : une fiche n'est donnée à l'IA que si plusieurs mots du client correspondent à son titre.
  const hits = searchPannes(query, 8, 6)
    .filter((h) => h.titleHits >= 2 && !h.panne.advanced && !COMMAND.test(h.panne.solution))
    .slice(0, 3);
  if (hits.length === 0) return '';
  const lines = hits.map((h) => `- ${h.panne.title} — cause : ${h.panne.cause || h.panne.symptom} — piste : ${h.panne.solution}`);
  return `\n\nFiches de référence internes (à reformuler en gestes simples dans les menus, jamais en commandes à copier ; si la piste ne correspond pas exactement au cas, ignore-la) :\n${lines.join('\n')}`;
}
