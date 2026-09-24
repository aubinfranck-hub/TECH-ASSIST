import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PricingPlan } from '../lib/api.js';

export function PricingTable() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setPlans(res.plans))
      .catch(() => setError("Impossible de charger les tarifs pour le moment."));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (plans.length === 0) return <p className="text-slate-500">Chargement des tarifs…</p>;

  const particuliers = plans.filter((p) => p.segment === 'particulier');

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {particuliers.map((plan) => (
        <div key={plan.id} className="rounded-xl border bg-white p-5 shadow-sm flex flex-col">
          <h3 className="font-semibold text-lg">{plan.name}</h3>
          <p className="mt-2 text-2xl font-bold text-brand-700">
            {plan.price_fcfa.toLocaleString('fr-FR')} FCFA
          </p>
          {plan.duration_minutes && (
            <p className="text-sm text-slate-500">jusqu'à {plan.duration_minutes} min</p>
          )}
          <p className="mt-3 text-sm text-slate-600 flex-1">{plan.description}</p>
          <Link
            to="/diagnostic"
            className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-center text-white hover:bg-brand-700"
          >
            Choisir
          </Link>
        </div>
      ))}
    </div>
  );
}
