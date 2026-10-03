import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PricingPlan } from '../lib/api.js';
import { entrepriseIncludes, entrepriseOffers, particulierIncludes, particulierOffers, postes } from '../lib/offers.js';

export function PricingTable() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setPlans(res.plans))
      .catch(() => setError('Impossible de charger les tarifs pour le moment.'));
  }, []);

  if (error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }

  if (plans.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Chargement des tarifs…</p>;
  }

  return <PricingCards plans={plans} />;
}

/** Affichage seul (testable sans réseau). */
export function PricingCards({ plans }: { plans: PricingPlan[] }) {
  const forfaits = particulierOffers(plans);
  const entreprises = entrepriseOffers(plans);

  return (
    <>
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="font-bold text-green-900">Première assistance offerte</p>
        <p className="mt-1 text-sm text-green-800">Pour essayer, avec un technicien si besoin, sans paiement. Ensuite, vous payez uniquement l’assistance dont vous avez besoin.</p>
        <Link to="/assistance" className="ta-button-primary mt-4">Installer l’application</Link>
      </div>

      <h3 className="mb-3 text-lg font-extrabold text-slate-950">Particuliers · à l’usage</h3>
      <div className="grid gap-5 md:grid-cols-2">
        {forfaits.map((plan) => (
          <article key={plan.id} className="ta-card flex flex-col p-6">
            <p className="text-sm font-semibold text-brand-700">Par assistance</p>
            <h4 className="mt-2 text-xl font-black text-slate-950">{plan.name}</h4>
            <div className="mt-5">
              <span className="text-3xl font-black tracking-tight text-slate-950">{plan.price_fcfa.toLocaleString('fr-FR')}</span>
              <span className="ml-1 text-sm font-semibold text-slate-500">FCFA</span>
              {plan.duration_minutes && <p className="mt-1 text-sm text-slate-500">jusqu’à {plan.duration_minutes} min</p>}
            </div>
            <ul className="mt-5 flex-1 space-y-2 text-sm leading-6 text-slate-600">
              {particulierIncludes(plan).map((line) => (
                <li key={line.text} className="flex gap-2">
                  <span aria-hidden className={line.ok ? 'text-brand-600' : 'text-slate-400'}>{line.ok ? '✓' : '–'}</span>
                  {line.text}
                </li>
              ))}
            </ul>
            <Link to="/assistance" className="ta-button-primary mt-6 w-full">Choisir cette offre</Link>
          </article>
        ))}
      </div>

      {entreprises.length > 0 && (
        <>
          <h3 className="mb-1 mt-10 text-lg font-extrabold text-slate-950">Entreprises · selon le nombre de postes</h3>
          <p className="mb-3 text-sm text-slate-600">L’agent IA et les techniciens sont toujours inclus. Vous choisissez le forfait qui couvre vos machines.</p>
          <div className="grid gap-5 md:grid-cols-3">
            {entreprises.map((plan) => (
              <article key={plan.id} className="flex flex-col rounded-2xl bg-[#11151b] p-6 text-white">
                <p className="text-sm font-semibold text-brand-400">Jusqu’à {postes(plan.metadata?.maxDevices ?? 0)}</p>
                <h4 className="mt-2 text-xl font-black">{plan.name}</h4>
                <div className="mt-5">
                  <span className="text-3xl font-black tracking-tight">{plan.price_fcfa.toLocaleString('fr-FR')}</span>
                  <span className="ml-1 text-sm font-semibold text-slate-400">FCFA / mois</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm leading-6 text-slate-300">
                  {entrepriseIncludes(plan).map((line) => (
                    <li key={line} className="flex gap-2"><span aria-hidden className="text-brand-400">✓</span>{line}</li>
                  ))}
                </ul>
                <Link to="/entreprise" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-100">Équiper mon entreprise</Link>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
