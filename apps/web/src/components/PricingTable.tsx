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
      .catch(() => setError('Impossible de charger les tarifs pour le moment.'));
  }, []);

  if (error) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }

  if (plans.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Chargement des tarifs…</p>;
  }

  const particuliers = plans.filter((p) => p.segment === 'particulier');

  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {particuliers.map((plan) => (
        <article key={plan.id} className="ta-card flex flex-col p-6 transition hover:-translate-y-1 hover:shadow-soft">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Particulier</p>
              <h3 className="mt-2 text-xl font-black text-slate-950">{plan.name}</h3>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Disponible</span>
          </div>

          <div className="mt-6">
            <span className="text-3xl font-black tracking-tight text-slate-950">
              {plan.price_fcfa.toLocaleString('fr-FR')}
            </span>
            <span className="ml-1 text-sm font-semibold text-slate-500">FCFA</span>
            {plan.duration_minutes && (
              <p className="mt-1 text-sm text-slate-500">jusqu'à {plan.duration_minutes} min</p>
            )}
          </div>

          <p className="mt-5 flex-1 text-sm leading-6 text-slate-500">{plan.description}</p>

          <Link to="/diagnostic" className="ta-button-primary mt-6 w-full">
            Choisir cette formule
          </Link>
        </article>
      ))}
    </div>
  );
}
