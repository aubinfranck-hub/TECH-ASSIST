import { Link } from 'react-router-dom';
import { PageHero } from '../components/PageHero.js';
import { SITE_IMAGES } from '../lib/imageSources.js';

const benefits = [
  ['🤖', 'IA TechAssist', 'Des conseils clairs par écrit avant de faire intervenir un technicien (elle ne voit pas votre PC).'],
  ['🧑‍🔧', 'Technicien humain', 'Le dossier, l’historique et les échanges suivent le même parcours.'],
  ['🔐', 'Assistance sécurisée', 'Vous gardez le contrôle et autorisez l’accès distant lorsque nécessaire.'],
  ['⚡', 'Résolution', 'Une seule continuité de dossier, de la première question à l’intervention.'],
];

const products = [
  ['📱', 'Android', 'APK natif pour le diagnostic IA, le suivi du dossier et le passage au technicien.', '/telephone', SITE_IMAGES.office],
  ['💻', 'Windows', 'L’agent analyse et répare votre PC avec votre accord ; un technicien peut prendre la main à distance.', '/diagnostic', SITE_IMAGES.pc],
  ['📄', 'Office', 'Accompagnement Word, Excel, Outlook et problèmes courants de productivité.', '/diagnostic', SITE_IMAGES.office],
];

export function AssistancePage() {
  return (
    <div>
      <PageHero
        eyebrow="COMMENT ÇA MARCHE"
        title="Le support informatique qui continue jusqu’à la résolution."
        text="TechAssist combine portail web, applications, IA et techniciens. Vous expliquez votre problème une fois : le dossier suit son parcours sans vous faire recommencer."
        image={SITE_IMAGES.office}
        imageAlt="Poste de travail utilisé pour une assistance informatique"
        action={{ label: 'Demander de l’aide', to: '/demander-aide' }}
        dark
      />

      <div className="ta-container py-12 sm:py-16">
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map(([icon, title, text]) => (
            <article key={title} className="group rounded-[24px] border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-2xl">{icon}</span>
              <h2 className="mt-5 font-display text-xl font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </section>

        <section className="mt-12">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="ta-eyebrow">L’ÉCOSYSTÈME TECHASSIST</p>
              <h2 className="mt-2 font-display text-3xl font-black sm:text-4xl">Un produit pour chaque besoin.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-600">Le site présente le service. Les applications exécutent l’assistance lorsque votre appareil le nécessite.</p>
          </div>

          <div className="mt-7 grid gap-5 md:grid-cols-3">
            {products.map(([icon, title, text, to, image]) => (
              <Link key={title} to={to} className="group overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card transition hover:-translate-y-1 hover:shadow-xl">
                <div className="relative overflow-hidden">
                  <img src={image} alt={title} className="h-48 w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" />
                  <span className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-xl shadow-lg">{icon}</span>
                </div>
                <div className="p-6">
                  <h3 className="font-display text-2xl font-black">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                  <span className="mt-5 inline-flex font-black text-brand-700">Découvrir →</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-12 overflow-hidden rounded-[30px] bg-slate-950 text-white">
          <div className="grid lg:grid-cols-2">
            <div className="p-7 sm:p-10">
              <p className="text-xs font-extrabold uppercase tracking-[.16em] text-brand-400">LE PARCOURS</p>
              <h2 className="mt-3 font-display text-3xl font-black">Du problème au technicien, sans repartir de zéro.</h2>
              <div className="mt-7 space-y-5">
                {[
                  ['01', 'Décrire', 'Vous indiquez le problème et le contexte.'],
                  ['02', 'Conseiller', 'L’IA vous guide par écrit ; l’agent Windows peut analyser votre PC.'],
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
            <img src={SITE_IMAGES.pc} alt="Technicien travaillant sur un ordinateur" className="h-72 w-full object-cover lg:h-full" loading="lazy" />
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          <article className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card">
            <img src={SITE_IMAGES.network} alt="Réseau informatique d'entreprise" className="h-48 w-full object-cover" loading="lazy" />
            <div className="p-6"><p className="ta-eyebrow">POUR LES ENTREPRISES</p><h2 className="mt-2 font-display text-2xl font-black">Suivre tout votre parc</h2><p className="mt-2 text-sm leading-6 text-slate-600">Postes, demandes, diagnostics et interventions depuis un espace dédié.</p><Link to="/entreprise" className="mt-5 inline-flex font-black text-brand-700">Espace entreprise →</Link></div>
          </article>
          <article className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card">
            <img src={SITE_IMAGES.security} alt="Sécurité informatique" className="h-48 w-full object-cover" loading="lazy" />
            <div className="p-6"><p className="ta-eyebrow">À DISTANCE</p><h2 className="mt-2 font-display text-2xl font-black">Vous gardez le contrôle</h2><p className="mt-2 text-sm leading-6 text-slate-600">Les outils distants sont utilisés lorsque l’intervention le nécessite et avec votre autorisation.</p><Link to="/demander-aide" className="mt-5 inline-flex font-black text-brand-700">Commencer →</Link></div>
          </article>
        </section>
      </div>
    </div>
  );
}
