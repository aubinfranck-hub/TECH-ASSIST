import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PricingPlan } from '../lib/api.js';

const DOWNLOADS = [
  { id: 'windows', label: 'Windows', url: import.meta.env.VITE_APP_WINDOWS_URL },
  { id: 'android', label: 'Android', url: import.meta.env.VITE_APP_ANDROID_URL },
] as const;

const STEPS = [
  {
    title: "Installez l'application",
    text: "L'application Tech Assist reconnaît votre appareil. C'est elle, et non ce site, qui démarre l'assistance.",
  },
  {
    title: 'Confirmez votre e-mail',
    text: 'Un code à 6 chiffres vous est envoyé. Votre e-mail identifie votre première assistance offerte et votre abonnement.',
  },
  {
    title: 'Demandez de l’aide',
    text: "Choisissez l'agent IA ou un technicien. Rien n'est modifié sur votre appareil sans votre accord.",
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

/** Le site est le miroir de l'application : il présente l'offre, l'assistance elle-même se fait dans l'application. */
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
      <h1 className="mb-3 text-2xl font-bold sm:text-3xl">L'assistance se fait dans l'application</h1>
      <p className="mb-8 text-slate-600">
        Votre première assistance est offerte. Ensuite, un abonnement de {price.toLocaleString('fr-FR')} FCFA par mois
        donne accès à l'assistance, avec l'agent IA ou un technicien.
      </p>

      <section className="ta-card mb-8 p-6 sm:p-8">
        <h2 className="mb-4 text-lg font-bold">Télécharger l'application</h2>
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
            L'application arrive bientôt. En attendant, le diagnostic en ligne reste disponible.
          </p>
        )}
        <Link to="/diagnostic" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Faire d'abord un diagnostic en ligne
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
        <p className="font-bold">Une assistance offerte par personne</p>
        <p className="mt-1">
          Elle est rattachée à votre e-mail vérifié et à votre appareil : se réinscrire avec une autre adresse sur le même
          appareil ne donne pas droit à une seconde assistance offerte. L'abonnement suit votre e-mail, même après une
          réinstallation. Le paiement se confirme avec un technicien (Mobile Money).
        </p>
      </section>
    </div>
  );
}
