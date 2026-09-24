import { Link } from 'react-router-dom';
import { PmeRequestForm } from '../components/PmeRequestForm.js';
import { PricingTable } from '../components/PricingTable.js';
import { TechnicianApplyForm } from '../components/TechnicianApplyForm.js';
import { VisitRequestForm } from '../components/VisitRequestForm.js';

const STEPS = [
  { number: '01', title: 'Décrivez votre problème', text: 'Expliquez simplement ce qui ne fonctionne pas. Le diagnostic vous guide.' },
  { number: '02', title: 'Choisissez votre assistance', text: 'Sélectionnez la formule adaptée et effectuez votre paiement.' },
  { number: '03', title: 'Travaillez avec un technicien', text: 'Une session sécurisée vous permet d’être accompagné à distance.' },
];

const SERVICES = [
  { title: 'Ordinateur', text: 'Windows, logiciels, performances et configuration.', icon: '▣' },
  { title: 'Téléphone', text: 'Aide à la configuration et résolution des problèmes courants.', icon: '▯' },
  { title: 'Sécurité', text: 'Accompagnement pour les problèmes de sécurité et de protection.', icon: '◈' },
  { title: 'Réseau', text: 'Connexion, configuration et dépannage réseau.', icon: '⌁' },
];

const FAQ = [
  {
    q: 'Le technicien peut-il voir mes fichiers personnels ?',
    a: 'Non, sauf nécessité explicite liée au problème signalé et avec votre accord. Toutes les actions sont journalisées.',
  },
  {
    q: 'Comment puis-je arrêter une session ?',
    a: 'Un bouton « Arrêter » est visible pendant la session et permet de couper immédiatement l’assistance.',
  },
  {
    q: 'Que se passe-t-il si mon problème est matériel ?',
    a: 'Une panne matérielle ne peut pas toujours être résolue à distance. Nous pouvons vous orienter vers une intervention sur place.',
  },
  {
    q: 'Comment se fait le paiement ?',
    a: 'Le projet prévoit le paiement par Mobile Money avant le début de la session.',
  },
];

export function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-slate-950">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="ta-container relative grid gap-10 py-16 sm:py-20 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300">
              <span className="h-2 w-2 rounded-full bg-brand-500" />
              Assistance informatique à distance
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
              Votre problème informatique.
              <span className="block text-brand-500">Notre assistance.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Diagnostic, accompagnement et prise en main à distance avec un parcours simple,
              sécurisé et pensé pour les particuliers comme pour les PME.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/diagnostic" className="ta-button-primary">
                Démarrer mon diagnostic
              </Link>
              <a href="#tarifs" className="ta-button-secondary border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                Voir les tarifs
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-slate-400">
              <span>✓ Parcours guidé</span>
              <span>✓ Consentement avant contrôle</span>
              <span>✓ Arrêt de session à tout moment</span>
            </div>
          </div>

          <div className="lg:pl-8">
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-3 shadow-2xl backdrop-blur">
              <div className="rounded-2xl bg-white p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tech Assist</p>
                    <p className="mt-1 text-lg font-bold text-slate-950">Assistance en cours</p>
                  </div>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Sécurisée</span>
                </div>
                <div className="mt-6 rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 font-black text-brand-700">TA</span>
                    <div>
                      <p className="font-semibold text-slate-900">Session assistée</p>
                      <p className="text-xs text-slate-500">Contrôle soumis à votre consentement</p>
                    </div>
                  </div>
                  <div className="mt-5 h-2 rounded-full bg-slate-200">
                    <div className="h-2 w-2/3 rounded-full bg-brand-600" />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-slate-500">
                    <span>Connexion</span>
                    <span>Assistance</span>
                    <span>Terminé</span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Accès</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">Contrôlé</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Session</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">Temporaire</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ta-container py-14 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service) => (
            <div key={service.title} className="ta-card p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-lg font-black text-brand-700">
                {service.icon}
              </div>
              <h2 className="mt-4 font-bold text-slate-950">{service.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{service.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-16" id="tarifs">
        <div className="ta-container">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Tarifs particuliers</span>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Une formule claire avant de commencer</h2>
            <p className="mt-3 text-slate-500">Les prix affichés sont ceux configurés dans la plateforme.</p>
          </div>
          <div className="mt-9">
            <PricingTable />
          </div>
        </div>
      </section>

      <section className="ta-container py-16">
        <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Simple</span>
            <h2 className="mt-2 text-3xl font-black tracking-tight">De la demande à l’assistance.</h2>
            <p className="mt-3 text-slate-500">Un parcours conçu pour éviter les étapes inutiles.</p>
          </div>
          <div className="grid gap-4">
            {STEPS.map((step) => (
              <div key={step.number} className="ta-card flex gap-4 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">{step.number}</span>
                <div>
                  <h3 className="font-bold text-slate-950">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-100 py-16" id="pme">
        <div className="ta-container grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">PME</span>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Un besoin informatique récurrent ?</h2>
            <p className="mt-3 max-w-lg leading-7 text-slate-500">
              Présentez votre besoin. L’espace entreprise prévoit le suivi des demandes,
              le parc informatique et les rapports pour les comptes concernés.
            </p>
            <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-sm text-slate-300">
              <p className="font-semibold text-white">Espace entreprise</p>
              <p className="mt-2 leading-6">Demandes d’aide, historique, parc et informations de suivi dans un même espace.</p>
              <Link to="/entreprise" className="mt-4 inline-flex font-semibold text-brand-400 hover:text-brand-300">
                Accéder à l’espace entreprise →
              </Link>
            </div>
          </div>
          <div className="ta-card p-5 sm:p-7">
            <PmeRequestForm />
          </div>
        </div>
      </section>

      <section id="technicien" className="ta-container py-16">
        <div className="ta-card overflow-hidden">
          <div className="grid lg:grid-cols-2">
            <div className="bg-slate-950 p-7 sm:p-10">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-400">Techniciens</span>
              <h2 className="mt-2 text-3xl font-black text-white">Rejoignez le réseau Tech Assist</h2>
              <p className="mt-4 leading-7 text-slate-400">
                Candidatez pour assister les clients et travailler depuis la console technicien.
              </p>
            </div>
            <div className="p-5 sm:p-8">
              <TechnicianApplyForm />
            </div>
          </div>
        </div>
      </section>

      <section id="visite" className="bg-white py-16">
        <div className="ta-container grid gap-10 lg:grid-cols-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">Sur place</span>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Le problème nécessite un déplacement ?</h2>
            <p className="mt-3 leading-7 text-slate-500">
              Pour les interventions qui ne peuvent pas être résolues à distance, envoyez une demande d’intervention sur place.
            </p>
          </div>
          <div className="ta-card p-5 sm:p-7">
            <VisitRequestForm />
          </div>
        </div>
      </section>

      <section className="ta-container py-16">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">FAQ</span>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Questions fréquentes</h2>
          </div>
          <div className="mt-8 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="group ta-card p-5">
                <summary className="cursor-pointer list-none pr-8 font-semibold text-slate-900 marker:hidden">
                  {item.q}
                  <span className="float-right text-brand-600 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
