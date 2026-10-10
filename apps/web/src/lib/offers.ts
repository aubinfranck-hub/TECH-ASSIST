import type { PricingPlan } from './api.js';

/** Offres à l'usage des particuliers : « Assistance IA » (500 FCFA) et « Assistance IA + technicien » (2 000 FCFA). */
export function particulierOffers(plans: PricingPlan[]): PricingPlan[] {
  return plans.filter((p) => p.segment === 'particulier' && p.metadata?.scope && !p.metadata.subscription);
}

/** Forfaits entreprise : le prix dépend du nombre de postes ; l'IA et le technicien sont toujours inclus. */
export function entrepriseOffers(plans: PricingPlan[]): PricingPlan[] {
  return plans.filter((p) => p.segment === 'pme' && typeof p.metadata?.maxDevices === 'number').sort((a, b) => (a.metadata!.maxDevices ?? 0) - (b.metadata!.maxDevices ?? 0));
}

export const postes = (n: number) => `${n} poste${n > 1 ? 's' : ''}`;

/** Ce que le client obtient avec une offre à l'usage — dit clairement, y compris ce qu'elle ne comprend pas. */
export function particulierIncludes(plan: PricingPlan): { ok: boolean; text: string }[] {
  const human = plan.metadata?.humanIncluded !== false;
  return [
    { ok: true, text: 'L’agent IA analyse et répare votre PC, avec votre accord à chaque action' },
    { ok: true, text: 'Résultats avant / après visibles à la fin' },
    human
      ? { ok: true, text: 'Un technicien prend le relais si le problème le demande' }
      : { ok: false, text: 'Sans technicien humain (ajoutable sur place pour 1 500 FCFA)' },
  ];
}

export function entrepriseIncludes(plan: PricingPlan): string[] {
  const m = plan.metadata ?? {};
  const lines = [`Jusqu’à ${postes(m.maxDevices ?? 0)}`, 'Agent IA + technicien toujours inclus'];
  lines.push(m.includedAssistances == null ? 'Assistances illimitées' : `${m.includedAssistances} assistances par mois`);
  if (m.responseTimeHours) lines.push(`Réponse d’un technicien sous ${m.responseTimeHours} h`);
  if (m.dedicatedTechnician) lines.push('Technicien attitré');
  if (m.monthlyReport) lines.push('Rapport mensuel pour le dirigeant');
  return lines;
}
