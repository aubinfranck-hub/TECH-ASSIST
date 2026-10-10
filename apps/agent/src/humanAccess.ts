import type { Reporter, Ui } from './types.js';

/**
 * Un technicien fait-il partie de l'assistance du client ?
 *  - offre « Assistance IA » (500 FCFA) : non, sauf complément payé ;
 *  - « Assistance IA + technicien » (2 000 FCFA), assistance offerte, abonnement, entreprise : oui.
 * Le serveur applique la règle (il n'alerte personne pour une session « IA seule ») ; l'agent la dit honnêtement au client.
 */
export interface HumanAccess {
  included: boolean;
  /** Complément annoncé par le serveur (FCFA). */
  upgradeFcfa?: number;
  /** Propose le complément au client et l'encaisse ; true si un technicien fait maintenant partie de l'assistance. */
  offerUpgrade?: () => Promise<boolean>;
}

/** Ce que la fenêtre écrit « à la place » du client quand il appuie sur « Parler à un technicien » sans technicien dans son offre. */
export const HUMAN_REQUEST_TEXT = 'Je veux parler à un technicien';

/**
 * À appeler avant tout passage de main. Vrai : un technicien peut être prévenu. Faux : l'offre n'en comprend pas et le client
 * n'a pas pris le complément (le client en a été informé, la conversation continue avec l'agent).
 */
export async function ensureHuman(reporter: Pick<Reporter, 'human'>, ui: Pick<Ui, 'info'>): Promise<boolean> {
  const human = reporter.human;
  if (!human || human.included) return true;
  ui.info("Ce point demande un technicien, et votre offre « Assistance IA » n'en comprend pas.");
  if (human.offerUpgrade && (await human.offerUpgrade())) {
    human.included = true;
    return true;
  }
  ui.info("D'accord : je reste avec vous pour tout ce que je peux faire seul. Vous pouvez ajouter un technicien à tout moment avec le bouton « Parler à un technicien ».");
  return false;
}
