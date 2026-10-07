import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PricingPlan } from '../lib/api.js';

export function AssistancePage() {
  const [subscriptionPlan, setSubscriptionPlan] = useState<PricingPlan | null>(null);

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setSubscriptionPlan(res.plans.find((p) => p.metadata?.subscription) ?? null))
      .catch(() => undefined);
  }, []);

  const companyPrice = subscriptionPlan?.price_fcfa ?? 10000;

  return (
    <div className="ta-container max-w-4xl py-12 sm:py-16">
      <div className="max-w-2xl">
        <p className="ta-eyebrow">Le parcours Tech Assist</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Un seul parcours, du problème jusqu’à sa résolution.
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Vous décrivez votre problème. L’IA commence l’analyse. Si elle ne suffit pas,
          un technicien reprend exactement le même dossier avec son historique.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-bold text-green-900">🎉 Lancement : assistance gratuite</p>
        <p className="mt-1 text-sm leading-6 text-green-800">
          Aucun paiement n’est demandé pendant le lancement. Les tarifs habituels sont affichés barrés à titre indicatif.
        </p>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          ['1', 'Demander', 'Décrivez votre problème et indiquez si vous utilisez un navigateur, un PC Windows ou un téléphone.'],
          ['2', 'Analyser', 'L’IA pose des questions, propose des actions et attend votre confirmation.'],
          ['3', 'Résoudre', 'Si nécessaire, votre dossier passe à un technicien qui reprend l’historique.'],
        ].map(([n, title, text]) => (
          <article key={n} className="ta-card p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-black text-white">{n}</span>
            <h2 className="mt-5 font-extrabold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-brand-700">ÉTAPE 1</p>
            <h2 className="mt-1 text-2xl font-extrabold">Décrivez votre problème</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
              C’est le vrai point de départ. Pas besoin de créer une commande ou de chercher un produit :
              vous ouvrez directement un dossier d’assistance.
            </p>
          </div>
          <Link to="/demander-aide" className="ta-button-primary shrink-0 justify-center">
            🆘 Demander de l’aide — gratuit
          </Link>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-6">
          <p className="text-sm font-bold text-brand-700">PARCOURS IA</p>
          <h2 className="mt-1 text-xl font-extrabold">Agent IA</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            L’IA analyse votre description, vous guide et vous demande si la solution fonctionne.
            Si vous signalez que le problème persiste, le dossier peut être transmis à un technicien.
          </p>
          <p className="mt-4 text-sm font-bold"><s>500 FCFA</s> · GRATUIT actuellement</p>
        </article>

        <article className="rounded-2xl border-2 border-slate-200 bg-white p-6">
          <p className="text-sm font-bold text-slate-600">PARCOURS HYBRIDE</p>
          <h2 className="mt-1 text-xl font-extrabold">IA + technicien</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            L’IA commence le diagnostic. Si une intervention humaine est nécessaire, le technicien
            reçoit le même dossier et son historique au lieu de vous faire recommencer.
          </p>
          <p className="mt-4 text-sm font-bold"><s>2 000 FCFA</s> · GRATUIT actuellement</p>
        </article>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="font-extrabold">Selon votre appareil</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4"><p className="font-bold">🌐 Navigateur</p><p className="mt-1 text-xs leading-5 text-slate-500">Le parcours d’assistance fonctionne directement sur le site.</p></div>
          <div className="rounded-xl bg-white p-4"><p className="font-bold">💻 PC Windows</p><p className="mt-1 text-xs leading-5 text-slate-500">L’application/agent Windows peut être utilisé lorsqu’une prise en main distante est nécessaire.</p></div>
          <div className="rounded-xl bg-white p-4"><p className="font-bold">📱 Téléphone</p><p className="mt-1 text-xs leading-5 text-slate-500">Le site permet le diagnostic et le guidage. Le contrôle Android nécessite l’application native et les autorisations Android.</p></div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-extrabold">Et après le lancement ?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Les tarifs habituels sont affichés ici pour que le modèle économique reste compréhensible.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
          <div><s>500 FCFA</s><p className="font-semibold">Assistance IA</p></div>
          <div><s>2 000 FCFA</s><p className="font-semibold">IA + technicien</p></div>
          <div><s>{companyPrice.toLocaleString('fr-FR')} FCFA/mois</s><p className="font-semibold">Entreprise</p></div>
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/demander-aide" className="ta-button-primary justify-center">🆘 Démarrer maintenant</Link>
        <Link to="/entreprise" className="ta-button-secondary justify-center">Je suis une entreprise</Link>
      </div>
    </div>
  );
}
