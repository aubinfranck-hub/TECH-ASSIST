import type { Assistant, ChatTurn, LessonRequest, TrainingStepId } from './assistant.js';
import type { ConversationUi } from './types.js';

/**
 * 3ᵉ rôle : assistant de formation (Windows, Office, métiers), niveaux 1 à 4.
 *
 * Le cours, l'exercice et la correction sont rédigés par l'assistant en ligne (une IA) à partir d'un catalogue fermé
 * côté serveur ; l'agent ne fait que mener la leçon : expliquer → démontrer → exercice → correction → évaluation → niveau suivant.
 * Rien de ce que l'IA écrit n'est exécuté. L'avancement est gardé le temps de la conversation seulement.
 */

export interface TrackInfo {
  id: string;
  label: string;
  kind: 'app' | 'profession';
  /** Mots (sans accents, minuscules) qui désignent ce parcours dans une phrase du client. */
  keywords: string[];
}

/** Mêmes identifiants que le catalogue du serveur (apps/api/src/assistant/trainingCatalog.ts) : les deux tests les figent. */
export const TRAINING_TRACKS: readonly TrackInfo[] = [
  { id: 'windows', label: 'Windows', kind: 'app', keywords: ['windows'] },
  { id: 'word', label: 'Word', kind: 'app', keywords: ['word', 'traitement de texte'] },
  { id: 'excel', label: 'Excel', kind: 'app', keywords: ['excel', 'tableur'] },
  { id: 'powerpoint', label: 'PowerPoint', kind: 'app', keywords: ['powerpoint', 'power point', 'presentation'] },
  { id: 'outlook', label: 'Outlook', kind: 'app', keywords: ['outlook'] },
  { id: 'teams', label: 'Teams', kind: 'app', keywords: ['teams'] },
  { id: 'onedrive', label: 'OneDrive', kind: 'app', keywords: ['onedrive', 'one drive'] },
  { id: 'm365', label: "Microsoft 365 (vue d'ensemble)", kind: 'app', keywords: ['microsoft 365', 'office 365', 'm365', 'office'] },
  { id: 'secretaire', label: 'Secrétariat', kind: 'profession', keywords: ['secretaire', 'secretariat'] },
  { id: 'comptable', label: 'Comptabilité', kind: 'profession', keywords: ['comptable', 'comptabilite'] },
  { id: 'commercial', label: 'Commercial / vente', kind: 'profession', keywords: ['commercial', 'vente', 'vendeur'] },
  { id: 'rh', label: 'Ressources humaines', kind: 'profession', keywords: ['ressources humaines', 'rh'] },
  { id: 'manager', label: "Manager / chef d'équipe", kind: 'profession', keywords: ['manager', "chef d'equipe"] },
  { id: 'direction', label: 'Direction', kind: 'profession', keywords: ['direction', 'directeur', 'directrice', 'dg'] },
  { id: 'technicien_it', label: 'Technicien informatique', kind: 'profession', keywords: ['technicien informatique', 'technicien it', 'informaticien', 'support informatique'] },
  { id: 'logistique', label: 'Logistique / stock', kind: 'profession', keywords: ['logistique', 'stock', 'magasinier'] },
  { id: 'administration', label: 'Administration', kind: 'profession', keywords: ['administration', 'administratif', 'administrative'] },
];

export const TRAINING_LEVELS: Record<1 | 2 | 3 | 4, string> = { 1: 'Niveau 1 — Débutant', 2: 'Niveau 2 — Intermédiaire', 3: 'Niveau 3 — Avancé', 4: 'Niveau 4 — Expert' };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'");

/** Parcours désigné par le client dans une phrase (« apprends-moi Excel », « formation secrétaire »), s'il y en a un. */
export function matchTrack(text: string): TrackInfo | undefined {
  const t = fold(text);
  const hits = TRAINING_TRACKS.filter((tr) => tr.keywords.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t)));
  // « microsoft 365 » ou « office » est plus général : un parcours précis mentionné en même temps l'emporte.
  const precise = hits.filter((h) => h.id !== 'm365');
  return (precise.length > 0 ? precise : hits)[0];
}

export interface TrainingDeps {
  ui: ConversationUi;
  assistant?: Assistant;
  /** Pour les tests : nombre maximal de leçons (sécurité contre une boucle sans fin). */
  maxLessons?: number;
}

export interface TrainingResult {
  track: string | null;
  lessons: number;
  /** Leçons dont le client dit avoir réussi l'exercice. */
  passed: number;
  level: 1 | 2 | 3 | 4;
  /** L'assistant en ligne n'a pas pu répondre : la formation s'est arrêtée. */
  unavailable: boolean;
}

const SKIP = /^\s*(passer|suivant|je passe|skip)\s*[.!]*\s*$/i;
/** Après deux exercices réussis sur le même niveau, on propose le bilan. */
export const PASSES_BEFORE_ASSESSMENT = 2;

export async function runTraining(deps: TrainingDeps, topic?: string): Promise<TrainingResult> {
  const { ui, assistant } = deps;
  const result: TrainingResult = { track: null, lessons: 0, passed: 0, level: 1, unavailable: false };

  if (!assistant) {
    ui.info("La formation passe par l'assistant en ligne, qui n'est pas disponible pour le moment. Vous pouvez demander l'aide d'un technicien.");
    result.unavailable = true;
    return result;
  }

  ui.info(
    "Formation : je vous explique, je vous montre, vous faites un exercice sur votre ordinateur, puis je corrige. Les cours sont rédigés par une IA : en cas de doute, demandez à un technicien. N'écrivez jamais de mot de passe ni de données confidentielles.",
  );

  let track = topic ? matchTrack(topic) : undefined;
  while (!track) {
    const kind = await ui.choose('Que voulez-vous apprendre ?', ['Une application (Windows, Word, Excel…)', 'Les outils de mon métier', 'Annuler']);
    if (kind === null || kind === 2) return result;
    const list = TRAINING_TRACKS.filter((t) => t.kind === (kind === 0 ? 'app' : 'profession'));
    const pick = await ui.choose(kind === 0 ? 'Quelle application ?' : 'Quel métier ?', [...list.map((t) => t.label), 'Retour']);
    if (pick === null) return result;
    if (pick < list.length) track = list[pick];
  }
  result.track = track.id;

  const levels = [1, 2, 3, 4] as const;
  const levelPick = await ui.choose(`${track.label} : quel est votre niveau ?`, [...levels.map((l) => TRAINING_LEVELS[l]), 'Annuler']);
  if (levelPick === null || levelPick >= 4) return result;
  let level: 1 | 2 | 3 | 4 = levels[levelPick]!;
  result.level = level;

  const history: ChatTurn[] = [];
  const maxLessons = deps.maxLessons ?? 30;
  let passesAtLevel = 0;

  /** Une étape confiée à l'assistant ; `null` si l'assistant est indisponible. */
  const step = async (name: TrainingStepId, message: string, image?: ReturnType<NonNullable<ConversationUi['takeAttachment']>>) => {
    const lesson: LessonRequest = { track: track!.id, level, step: name, index: Math.min(50, result.lessons + 1) };
    const reply = await assistant.answer(message.slice(0, 1000), history.slice(-8), { lesson, ...(image ? { image } : {}) });
    if (!reply.available) return null;
    history.push({ role: 'user', text: message.slice(0, 1000) }, { role: 'assistant', text: reply.text.slice(0, 1500) });
    ui.info(reply.text);
    return reply.text;
  };
  const unavailable = () => {
    result.unavailable = true;
    ui.info("L'assistant en ligne n'est plus disponible : la formation s'arrête ici. Vous pourrez la reprendre plus tard.");
  };

  for (let i = 0; i < maxLessons; i++) {
    ui.info(`— Leçon ${result.lessons + 1} · ${track.label} · ${TRAINING_LEVELS[level]} —`);
    if ((await step('cours', 'Donne-moi la leçon.')) === null) return unavailable(), result;
    if ((await step('exercice', "Donne-moi l'exercice.")) === null) return unavailable(), result;

    const answer = await ui.ask("Faites l'exercice sur votre ordinateur, puis écrivez ce que vous avez obtenu (vous pouvez joindre une capture d'écran). Écrivez « passer » pour sauter.");
    if (answer === null) break;
    result.lessons += 1;
    if (!SKIP.test(answer)) {
      const image = ui.takeAttachment?.() ?? undefined;
      if ((await step('correction', answer.trim() || 'Voici mon résultat.', image)) === null) return unavailable(), result;
      const success = await ui.confirmFixed('Avez-vous réussi cet exercice ?');
      if (success) {
        result.passed += 1;
        passesAtLevel += 1;
      }
    }

    // Évaluation : un court bilan quand le client a réussi assez d'exercices ; le niveau suivant se débloque s'il le réussit.
    if (passesAtLevel >= PASSES_BEFORE_ASSESSMENT) {
      const wantsAssessment = await ui.choose(`Vous avez réussi ${passesAtLevel} exercices de ce niveau. Voulez-vous passer le bilan du ${TRAINING_LEVELS[level]} ?`, ['Oui, passer le bilan', 'Non, continuer les leçons']);
      if (wantsAssessment === 0) {
        if ((await step('bilan', 'Donne-moi le bilan.')) === null) return unavailable(), result;
        const answers = await ui.ask('Écrivez vos réponses (par exemple : 1A, 2C, 3B).');
        if (answers === null) break;
        if ((await step('correction', answers.trim() || 'Voici mes réponses.')) === null) return unavailable(), result;
        const good = await ui.confirmFixed('Avez-vous au moins 2 bonnes réponses sur 3 ?');
        passesAtLevel = 0;
        if (good && level < 4) {
          level = (level + 1) as 1 | 2 | 3 | 4;
          result.level = level;
          ui.info(`Bravo ! Vous passez au ${TRAINING_LEVELS[level]}.`);
        } else if (good) {
          ui.info('Bravo ! Vous avez terminé le niveau le plus avancé de ce parcours.');
        } else {
          ui.info('Pas de souci : on reprend quelques leçons de ce niveau avant de retenter le bilan.');
        }
      }
    }

    const next = await ui.choose('Que voulez-vous faire ?', ['Leçon suivante', 'Arrêter la formation']);
    if (next !== 0) break;
  }

  ui.info(`Formation terminée pour aujourd'hui : ${result.lessons} leçon${result.lessons > 1 ? 's' : ''}, ${result.passed} exercice${result.passed > 1 ? 's' : ''} réussi${result.passed > 1 ? 's' : ''}. Vous pouvez me redemander une leçon à tout moment (votre avancement n'est gardé que pendant cette conversation).`);
  return result;
}
