import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { PricingCards } from '../src/components/PricingTable.js';
import type { PricingPlan } from '../src/lib/api.js';
import { entrepriseIncludes, entrepriseOffers, particulierIncludes, particulierOffers, postes } from '../src/lib/offers.js';

const plan = (over: Partial<PricingPlan> & Pick<PricingPlan, 'id'>): PricingPlan => ({ name: over.id, segment: 'particulier', price_fcfa: 0, duration_minutes: null, description: '', ...over });

const PLANS: PricingPlan[] = [
  plan({ id: 'diagnostic_express', name: 'Assistance IA', price_fcfa: 500, duration_minutes: 60, metadata: { scope: 'full', humanIncluded: false } }),
  plan({ id: 'assistance_rapide', name: 'Assistance IA + technicien', price_fcfa: 2000, duration_minutes: 60, metadata: { scope: 'full', humanIncluded: true } }),
  plan({ id: 'abonnement_mensuel', name: 'Abonnement', price_fcfa: 10000, metadata: { subscription: true, scope: 'full' } }),
  plan({ id: 'pme_pro', name: 'PME Pro', segment: 'pme', price_fcfa: 24900, metadata: { maxDevices: 15, includedAssistances: 10, responseTimeHours: 4, dedicatedTechnician: true, aiIncluded: true, humanIncluded: true } }),
  plan({ id: 'pme_essentiel', name: 'PME Essentiel', segment: 'pme', price_fcfa: 9900, metadata: { maxDevices: 5, includedAssistances: 3, responseTimeHours: 24, aiIncluded: true, humanIncluded: true } }),
  plan({ id: 'pme_entreprise', name: 'PME Entreprise', segment: 'pme', price_fcfa: 49900, metadata: { maxDevices: 40, includedAssistances: null, responseTimeHours: 1, dedicatedTechnician: true, monthlyReport: true } }),
  plan({ id: 'visite', name: 'Déplacement', segment: 'visite', price_fcfa: 5000 }),
];

describe('offres des particuliers', () => {
  it('deux offres à l’usage ; ni l’abonnement, ni les forfaits entreprise, ni les visites', () => {
    expect(particulierOffers(PLANS).map((p) => p.id)).toEqual(['diagnostic_express', 'assistance_rapide']);
  });

  it('500 FCFA : dit clairement qu’il n’y a pas de technicien et ce que coûte le complément', () => {
    const lines = particulierIncludes(PLANS[0]!);
    expect(lines.at(-1)).toMatchObject({ ok: false });
    expect(lines.at(-1)!.text).toMatch(/Sans technicien/);
    expect(lines.at(-1)!.text).toMatch(/1 500 FCFA/);
  });

  it('2 000 FCFA : le technicien est inclus', () => {
    const lines = particulierIncludes(PLANS[1]!);
    expect(lines.every((l) => l.ok)).toBe(true);
    expect(lines.map((l) => l.text).join(' ')).toMatch(/technicien prend le relais/);
  });
});

describe('forfaits entreprise (selon le nombre de postes)', () => {
  it('triés du plus petit au plus grand parc', () => {
    expect(entrepriseOffers(PLANS).map((p) => p.metadata!.maxDevices)).toEqual([5, 15, 40]);
  });

  it('IA + technicien toujours annoncés, quotas et engagements selon le forfait', () => {
    const [small, mid, big] = entrepriseOffers(PLANS);
    for (const p of [small!, mid!, big!]) expect(entrepriseIncludes(p)).toContain('Agent IA + technicien toujours inclus');
    expect(entrepriseIncludes(small!)).toEqual(expect.arrayContaining(['Jusqu’à 5 postes', '3 assistances par mois', 'Réponse d’un technicien sous 24 h']));
    expect(entrepriseIncludes(small!)).not.toContain('Technicien attitré');
    expect(entrepriseIncludes(mid!)).toContain('Technicien attitré');
    expect(entrepriseIncludes(big!)).toEqual(expect.arrayContaining(['Assistances illimitées', 'Rapport mensuel pour le dirigeant']));
  });

  it('pluriel des postes', () => {
    expect(postes(1)).toBe('1 poste');
    expect(postes(5)).toBe('5 postes');
  });
});

describe('PricingCards', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, createElement(PricingCards, { plans: PLANS })));

  it('affiche les deux offres particuliers avec leurs prix', () => {
    expect(html).toContain('Assistance IA + technicien');
    expect(html).toMatch(/>500</);
    expect(html).toMatch(/>2[\s  ]000</);
  });

  it('affiche les trois forfaits entreprise par postes, et plus l’ancien contrat unique ni le forfait à 5 000', () => {
    expect(html).toContain('Jusqu’à 40 postes');
    expect(html).toContain('PME Essentiel');
    expect(html).not.toMatch(/10[\s  ]000/);
    expect(html).not.toContain('Intervention complète');
    expect(html).not.toContain('Abonnement');
  });

  it('sans forfait entreprise listé : la section est simplement absente', () => {
    const none = renderToStaticMarkup(createElement(StaticRouter, { location: '/' }, createElement(PricingCards, { plans: PLANS.slice(0, 2) })));
    expect(none).not.toContain('selon le nombre de postes');
  });
});
