import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PricingPlan } from '../lib/api.js';

const DOWNLOADS = [
  { id: 'windows', label: 'Windows', url: import.meta.env.VITE_APP_WINDOWS_URL },
  { id: 'android', label: 'Android et iPhone (sans téléchargement)', url: import.meta.env.VITE_APP_ANDROID_URL || '/telephone' },
] as const;

const STEPS = [
  {
    title: "Démarrez votre assistance",
    text: "Vous pouvez commencer immédiatement depuis le navigateur. L’application est proposée lorsqu’elle apporte des fonctions supplémentaires.",
  },
  {
    title: 'Décrivez votre problème',
    text: 'Décrivez simplement ce qui ne fonctionne pas. Le dossier est transmis à l’IA puis au technicien si nécessaire.',
  },
  {
    title: 'Demandez de l’aide',
    text: "Choisissez l’agent IA ou l’option IA + technicien. Rien n'est modifié sur votre appareil sans votre accord.",
  },
];

const MODES = [
  {
    title: 'Agent IA',
    badge: 'Mode principal',
    text: "L'agent regarde l'état de votre appareil (son, impression, Internet, mises à jour, Bluetooth, heure, ou tout autre service Windows), vous explique le problème, propose chaque correction et attend votre « oui ». Il vérifie ensuite que c'est réglé.",
  },
  {
    title: 'Technicien humain',
    badge: 'En option',
    text: "Dépannage ou aide sur un logiciel avec un technicien. L'agent lui transmet ce qu'il a constaté et fait, s'il doit passer la main.",
  },
];

/** Le site permet de démarrer l'assistance directement ; l'application reste disponible pour les usages compatibles. */
export function AssistancePage() {
  const [subscriptionPlan, setSubscriptionPlan] = useState<PricingPlan | null>(null);

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setSubscriptionPlan(res.plans.find((p) => p.metadata?.subscription) ?? null))
      .catch(() => undefined);
  }, []);

  const price = subscriptionPlan?.price_fcfa ?? 10000;
  const available = DOWNLOADS.filter((d) => d.url);

  return (
    <div className="ta-container max-w-3xl py-14">
      <p className="ta-eyebrow mb-2">Assistance</p>
      <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5"><p className="font-bold text-green-900">🎉 LANCEMENT TECH ASSIST — ASSISTANCE GRATUITE</p><p className="mt-1 text-sm text-green-800">Les tarifs habituels restent affichés mais barrés pendant le lancement.</p></div>
      <Link to="/demander-aide" className="ta-button-primary mb-8 w-full justify-center py-3 sm:w-auto">🆘 DEMANDER DE L’AIDE — GRATUIT</Link>
      <h1 className="mb-3 text-2xl font-bold sm:text-3xl">Une assistance, sur le web ou dans l’application</h1>
      <p className="mb-8 text-slate-600">
        Les demandes web et application utilisent la même API, la même file technicien et les mêmes sessions.
      </p>

      <section className="ta-card mb-8 p-6 sm:p-8">
        <h2 className="mb-4 text-lg font-bold">Commencer sur le Web</h2>
        {available.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {available.map((d) => (
              <a key={d.id} href={d.url} className="ta-button-primary w-auto px-6">
                Pour {d.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Vous pouvez démarrer maintenant depuis le navigateur, sans installation.
          </p>
        )}
        <Link to="/telephone" className="mt-4 mr-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
          Sur téléphone : ouvrir l’assistant, sans installation
        </Link>
        <Link to="/diagnostic" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Demander de l’aide maintenant
        </Link>
      </section>

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => (
          <article key={m.title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-slate-950">{m.title}</h2>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">{m.badge}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{m.text}</p>
          </article>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-lg font-bold">Comment ça marche</h2>
        <ol className="space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {index + 1}
              </span>
              <div>
                <p className="font-bold text-slate-950">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-green-200 bg-green-50 p-5 text-sm leading-6 text-green-900">
        <p className="font-bold">Tarifs habituels — lancement gratuit</p>
        <p className="mt-1">
          <s>500 FCFA</s> → <strong>GRATUIT actuellement</strong> · Assistance IA<br/><s>2 000 FCFA</s> → <strong>GRATUIT actuellement</strong> · IA + technicien<br/><s>{price.toLocaleString('fr-FR')} FCFA/mois</s> → <strong>GRATUIT actuellement</strong> · Entreprise
        </p>
      </section>
    </div>
  );
}
