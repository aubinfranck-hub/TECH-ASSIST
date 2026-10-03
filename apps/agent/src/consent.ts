import type { Action, ConversationUi } from './types.js';

/**
 * Accord unique donné au début : il couvre l'analyse et les réparations de la session. Après ce « oui »,
 * l'agent ne redemande plus pour chaque correction — il dit ce qu'il fait, le journalise, et crée un point de
 * restauration avant les changements délicats. Deux choses restent soumises au client, parce qu'elles peuvent
 * lui faire perdre du travail : le redémarrage de l'ordinateur et ses propres réponses (« est-ce réglé ? »).
 */
export const CONSENT_TEXT = [
  'Avant de commencer, voici ce que je fais, et ce que je ne ferai jamais.',
  '',
  '✔ J’analyse votre ordinateur, puis je corrige directement ce qui ne va pas (services Windows, réseau, démarrage, nettoyage des fichiers temporaires, du cache des navigateurs et de la corbeille), sans vous redemander à chaque étape.',
  '✔ Avant un changement délicat, je crée un point de restauration Windows : on peut toujours revenir en arrière.',
  '✔ Tout ce que je fais est noté dans un rapport que vous recevez à la fin.',
  '✔ Les droits que Windows m’accorde ne servent que pour cette intervention : quand j’ai terminé, je me ferme et je ne garde aucun accès à votre ordinateur.',
  '✘ Je ne touche jamais à vos documents, photos, courriers ni mots de passe.',
  '✘ Je ne crée aucun compte utilisateur et je ne laisse rien de caché sur votre ordinateur.',
  '',
  'Vous pouvez m’arrêter à tout moment avec « Parler à un technicien » ou en fermant cette page.',
].join('\n');

export const CONSENT_YES = 'Oui, je vous fais confiance';
export const CONSENT_NO = 'Non, je préfère valider chaque étape';

/** Actions qui ne sont jamais approuvées d'office : elles peuvent coûter du travail non enregistré. */
const ALWAYS_ASK = new Set(['reboot']);

/**
 * Interface qui approuve d'office les corrections (l'accord unique a été donné), en les annonçant au client.
 * Le redémarrage et les questions restent posés au client.
 */
export function withStandingConsent(ui: ConversationUi): ConversationUi {
  const wrapped: ConversationUi = {
    info: (m) => ui.info(m),
    ask: (p) => ui.ask(p),
    choose: (q, o) => ui.choose(q, o),
    confirmFixed: (q) => ui.confirmFixed(q),
    confirmAction: async (action: Action) => {
      if (ALWAYS_ASK.has(action.id)) return ui.confirmAction(action);
      // « confirm_only » = accord de lot ou « continuer sans point de restauration » : déjà couvert par l'accord unique.
      if (action.id !== 'confirm_only') ui.info(`▶ ${action.title}…`);
      return true;
    },
  };
  if (ui.wasHandedOff) wrapped.wasHandedOff = () => ui.wasHandedOff!();
  if (ui.takeAttachment) wrapped.takeAttachment = () => ui.takeAttachment!();
  if (ui.progress) wrapped.progress = (step) => ui.progress!(step);
  return wrapped;
}
