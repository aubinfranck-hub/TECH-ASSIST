import { Link } from 'react-router-dom';
import { PageHero } from '../components/PageHero.js';

const benefits = [
  ['🤖', 'IA TechAssist', 'Une première analyse claire avant de faire intervenir un technicien.'],
  ['🧑‍🔧', 'Technicien humain', 'Le dossier, l’historique et les échanges suivent le même parcours.'],
  ['🔐', 'Assistance sécurisée', 'Vous gardez le contrôle et autorisez l’accès distant lorsque nécessaire.'],
  ['📱', 'Android & Windows', 'Une expérience adaptée au téléphone et au PC.'],
];

export function AssistancePage() {
  return (
    <div>
      <PageHero
        eyebrow="COMMENT ÇA MARCHE"
        title="Un support informatique pensé pour aller jusqu’à la résolution."
        text="TechAssist combine portail web, applications natives, IA et techniciens. Vous expliquez une fois votre problème : le dossier suit son parcours jusqu’à la résolution."
        image="/img/office.jpg"
        imageAlt="Ordinateur portable utilisé pour une assistance informatique"
        action={{ label: 'Demander de l’aide', to: '/demander-aide' }}
        dark
      />
      <div className="ta-container py-12 sm:py-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map(([icon, title, text]) => (
            <article key={title} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg">
              <span className="text-3xl">{icon}</span>
              <h2 className="mt-4 font-display text-xl font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>

        <section className="mt-12 overflow-hidden rounded-[28px] bg-slate-950 text-white">
          <div className="grid lg:grid-cols-2">
            <div className="p-7 sm:p-10">
              <p className="text-xs font-extrabold uppercase tracking-[.16em] text-brand-400">Le parcours</p>
              <h2 className="mt-3 font-display text-3xl font-black">Du problème au technicien, sans repartir de zéro.</h2>
              <div className="mt-7 space-y-5">
                {[
                  ['01', 'Décrire', 'Vous indiquez le problème et le contexte.'],
                  ['02', 'Analyser', 'TechAssist cherche une piste et vous guide.'],
                  ['03', 'Valider', 'Vous confirmez si la solution fonctionne.'],
                  ['04', 'Transmettre', 'Si nécessaire, le technicien récupère le dossier complet.'],
                ].map(([n, t, d]) => (
                  <div key={n} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-black">{n}</span>
                    <div><h3 className="font-bold">{t}</h3><p className="mt-1 text-sm leading-5 text-slate-400">{d}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <img src="/img/pc.jpg" alt="Technicien travaillant sur un ordinateur" className="h-64 w-full object-cover lg:h-full" loading="lazy" />
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
            <img src="/img/reseau.jpg" alt="Réseau informatique" className="h-44 w-full object-cover" loading="lazy" />
            <div className="p-6"><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Pour les entreprises</p><h2 className="mt-2 text-2xl font-black">Suivre tout votre parc</h2><p className="mt-2 text-sm leading-6 text-slate-600">Postes, demandes, diagnostics et interventions depuis un espace dédié.</p><Link to="/entreprise" className="mt-4 inline-flex font-bold text-brand-700">Espace entreprise →</Link></div>
          </article>
          <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
            <img src="/img/securite.jpg" alt="Sécurité informatique" className="h-44 w-full object-cover" loading="lazy" />
            <div className="p-6"><p className="text-xs font-bold uppercase tracking-wider text-brand-700">À distance</p><h2 className="mt-2 text-2xl font-black">Vous gardez le contrôle</h2><p className="mt-2 text-sm leading-6 text-slate-600">Les outils distants sont utilisés uniquement lorsque l’intervention le nécessite et avec votre autorisation.</p><Link to="/demander-aide" className="mt-4 inline-flex font-bold text-brand-700">Commencer →</Link></div>
          </article>
        </section>
      </div>
    </div>
  );
}