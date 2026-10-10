/**
 * Retrouver une procédure déjà apprise à partir de la phrase d'un client, sans IA.
 *
 * Chaque mot utile devient une « clé » : minuscules, sans accent, réduit à ses 5 premières lettres (« imprimante »,
 * « imprime », « imprimer » → « impri »). Une demande retrouve une procédure quand elle partage assez de clés avec elle.
 * Volontairement prudent : mieux vaut rappeler l'IA que servir la procédure d'un autre problème.
 */

const STOPWORDS = new Set(
  (
    'les des une aux que qui quoi dont pour par sur sous dans avec sans pas plus mon mes ton tes son ses notre votre nos vos leur leurs ce cet cette ces ' +
    'je tu il elle on nous vous ils elles est suis sont etait fait fais faire fait depuis comme tout tous toute toutes tres bien aussi encore comment pourquoi quand ' +
    'mais donc car puis alors ainsi chez entre vers sauf tant peu trop ordinateur ordi portable machine windows probleme souci marche marchent fonctionne ' +
    'rien truc chose choses hier aujourd toujours jamais impossible peux peut veux veut voudrais besoin aide aider bonjour merci svp salut'
  ).split(' '),
);

const KEY_LENGTH = 5;

/** Clé d'un mot : ses 5 premières lettres (le mot entier s'il est plus court). */
export function keyOf(word: string): string {
  return word.slice(0, KEY_LENGTH);
}

/** Les clés distinctes d'un texte libre (au plus 20, dans l'ordre d'apparition). */
export function tokenize(text: string): string[] {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words.map(keyOf))].slice(0, 20);
}

/** Part des clés de la demande que la procédure couvre (0 à 1), avec le nombre de clés communes. */
export function coverage(query: string[], procedure: string[]): { common: number; score: number } {
  if (query.length === 0) return { common: 0, score: 0 };
  const known = new Set(procedure);
  const common = query.filter((k) => known.has(k)).length;
  return { common, score: common / query.length };
}

/**
 * Seuils de service : au moins 2 clés communes ET 75 % de la demande couverte (« Word plante au démarrage » ne retrouve pas
 * la procédure d'Outlook). Quand l'IA recompose une procédure déjà connue, celle-ci apprend la nouvelle formulation (store.ts) :
 * la mémoire retrouve de plus en plus de formulations sans jamais servir le cas d'un autre.
 */
export const MIN_COMMON = 2;
export const MIN_SCORE = 0.75;

export interface Candidate {
  id: string;
  tokens: string[];
  status: 'candidate' | 'trusted';
  successes: number;
  uses: number;
}

const rank = (c: Candidate) => (c.status === 'trusted' ? 1 : 0);

/** La meilleure procédure pour cette demande, ou null si aucune n'est assez proche. */
export function bestMatch<T extends Candidate>(queryTokens: string[], candidates: T[]): { procedure: T; score: number; common: number } | null {
  let best: { procedure: T; score: number; common: number } | null = null;
  for (const procedure of candidates) {
    const { common, score } = coverage(queryTokens, procedure.tokens);
    if (common < MIN_COMMON || score < MIN_SCORE) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && (rank(procedure) > rank(best.procedure) || (rank(procedure) === rank(best.procedure) && (procedure.successes > best.procedure.successes || (procedure.successes === best.procedure.successes && procedure.uses > best.procedure.uses)))))
    ) {
      best = { procedure, score, common };
    }
  }
  return best;
}
