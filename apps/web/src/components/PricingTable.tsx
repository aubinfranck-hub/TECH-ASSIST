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

  // Forfaits à l'usage : un prix fixe par assistance, la portée est annoncée clairement.
  const forfaits = plans.filter((p) => p.segment === 'particulier' && p.metadata?.scope);
  const INCLUS: Record<string, string[]> = {
    diagnostic: ['Analyse de votre PC ou de votre problème', 'Explication claire de la cause', 'Rien n’est modifié'],
    fix: ['Un problème précis réglé avec vous', 'Windows, Office, Outlook, imprimante, Wi-Fi…', 'Chaque action expliquée et validée par vous'],
    full: ['Analyse et réparation complètes', 'Jusqu’à résolution du problème', 'Technicien humain si nécessaire'],
  };

  return (
    <>
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="font-bold text-green-900">Première assistance offerte</p>
        <p className="mt-1 text-sm text-green-800">Pour essayer, sans paiement. Ensuite, vous payez uniquement l’assistance dont vous avez besoin.</p>
        <Link to="/assistance" className="ta-button-primary mt-4">Installer l’application</Link>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {forfaits.map((plan) => (
          <article key={plan.id} className="ta-card flex flex-col p-6">
            <p className="text-sm font-semibold text-brand-700">Particulier · par assistance</p>
            <h3 className="mt-2 text-xl font-black text-slate-950">{plan.name}</h3>
            <div className="mt-5">
              <span className="text-3xl font-black tracking-tight text-slate-950">{plan.price_fcfa.toLocaleString('fr-FR')}</span>
              <span className="ml-1 text-sm font-semibold text-slate-500">FCFA</span>
              {plan.duration_minutes && <p className="mt-1 text-sm text-slate-500">jusqu’à {plan.duration_minutes} min</p>}
            </div>
            <ul className="mt-5 flex-1 space-y-2 text-sm leading-6 text-slate-600">
              {(INCLUS[plan.metadata?.scope ?? 'fix'] ?? []).map((line) => (
                <li key={line} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{line}</li>
              ))}
            </ul>
            <Link to="/assistance" className="ta-button-primary mt-6 w-full">Choisir ce forfait</Link>
          </article>
        ))}
        <article className="flex flex-col rounded-2xl bg-[#11151b] p-6 text-white">
          <p className="text-sm font-semibold text-brand-400">Entreprise · contrat mensuel</p>
          <h3 className="mt-2 text-xl font-black">Assistance entreprise</h3>
          <div className="mt-5">
            <span className="text-3xl font-black tracking-tight">10 000</span>
            <span className="ml-1 text-sm font-semibold text-slate-400">FCFA / mois</span>
          </div>
          <ul className="mt-5 flex-1 space-y-2 text-sm leading-6 text-slate-300">
            <li className="flex gap-2"><span aria-hidden className="text-brand-400">✓</span>Assistance pour vos postes, sans payer à chaque demande</li>
            <li className="flex gap-2"><span aria-hidden className="text-brand-400">✓</span>Suivi de l’état des postes</li>
            <li className="flex gap-2"><span aria-hidden className="text-brand-400">✓</span>Des techniciens derrière l’écran</li>
          </ul>
          <Link to="/entreprise" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-100">Parler de votre entreprise</Link>
        </article>
      </div>
    </>
  );
}
