import { Link } from 'react-router-dom';
import { PmeRequestForm } from '../components/PmeRequestForm.js';
import { PricingTable } from '../components/PricingTable.js';
import { TechnicianApplyForm } from '../components/TechnicianApplyForm.js';
import { VisitRequestForm } from '../components/VisitRequestForm.js';


const STEPS = [
  { n: '01', title: 'Vous lancez l’assistance', text: 'Lancez votre demande directement depuis le site ou l’application.' },
  { n: '02', title: 'L’agent analyse, vous validez', text: 'L’assistant analyse votre problème, vous explique les étapes et demande votre accord lorsque l’intervention nécessite une action.' },
  { n: '03', title: 'Votre dossier est résolu ou transmis', text: 'Vous confirmez le résultat. Si le problème persiste, un technicien reprend le dossier avec l’historique.' },
];

const FAQ = [
  ['Le technicien peut-il voir mes fichiers personnels ?', 'Non, sauf nécessité explicite liée au problème signalé et avec votre accord. Les actions sont journalisées.'],
  ['Comment puis-je arrêter une session ?', 'Un bouton « Arrêter » permet de couper immédiatement l’assistance pendant la session.'],
  ['Et si mon problème est matériel ?', 'Une panne matérielle peut nécessiter une intervention sur place. Vous pouvez demander un déplacement.'],
  ['Comment se fait le paiement ?', 'Par Mobile Money. Vous choisissez une offre : 500 FCFA pour l’agent IA seul, ou 2 000 FCFA avec un technicien qui peut reprendre le dossier si nécessaire. Les entreprises choisissent un forfait mensuel selon le nombre de postes, avec l’IA et les techniciens toujours inclus.'],
];

export function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-[#07101d] text-white">
        <img
          src="/img/hero.jpg"
          alt="Technicien Tech Assist au casque, devant un ordinateur, dans un centre d’assistance"
          className="h-56 w-full object-cover object-[70%_center] sm:h-72 lg:absolute lg:inset-y-0 lg:right-0 lg:h-full lg:w-[66%] lg:object-center"
          fetchPriority="high"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-full bg-gradient-to-r from-[#07101d] from-35% via-[#07101d]/70 to-transparent lg:block" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-transparent via-transparent to-[#07101d] sm:h-72 lg:hidden" />
        <div className="ta-container relative">
          <div className="max-w-xl pb-10 pt-2 lg:py-16">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-300 sm:text-sm">Assistance informatique professionnelle</p>
            <h1 className="mt-3 font-display text-[2.5rem] font-extrabold leading-[1.02] sm:text-6xl">
              Votre support IT partout <span className="text-brand-500">en Afrique</span>
            </h1>
            <p className="mt-4 max-w-md text-base leading-7 text-slate-200 sm:text-lg">
              Assistance à distance et sur site pour particuliers, PME et entreprises. Nos techniciens vous accompagnent en temps réel pour résoudre tous vos problèmes informatiques.
            </p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                ['Sécurisé', 'Connexions chiffrées'],
                ['Rapide', 'Prise en main en quelques secondes'],
                ['Techniciens africains', 'Disponibles et qualifiés'],
              ].map(([t, d]) => (
                <li key={t} className="text-sm"><p className="font-bold">{t}</p><p className="mt-0.5 text-xs text-slate-400">{d}</p></li>
              ))}
            </ul>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to="/assistance" className="ta-button bg-brand-600 text-white hover:bg-brand-500 sm:px-7">Démarrer une assistance <span aria-hidden className="ml-2">→</span></Link>
              <Link to="/diagnostic" className="ta-button border border-white/30 text-white hover:bg-white/10 sm:px-7">Lancer un diagnostic</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ta-container pt-8 sm:pt-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['/img/pc.jpg', 'PC & Laptop', 'Dépannage, optimisation, mises à jour, remplacement de pièces, installation…'],
            ['/img/reseau.jpg', 'Réseau & Internet', 'Configuration, Wi-Fi, routeurs, partage de connexion, VPN, serveur…'],
            ['/img/office.jpg', 'Windows & Office', 'Installation, configuration, formation, dépannage de vos logiciels…'],
            ['/img/securite.jpg', 'Sécurité & Maintenance', 'Suppression de virus, sauvegarde de données, surveillance, maintenance…'],
          ].map(([image, title, text]) => (
            <Link key={title} to="/assistance" className="group flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card sm:flex-col">
              <img src={image} alt="" loading="lazy" className="h-auto w-32 shrink-0 object-cover sm:aspect-[343/103] sm:w-full" />
              <div className="flex flex-1 items-start justify-between gap-3 p-4">
                <div><h3 className="font-extrabold">{title}</h3><p className="mt-1 text-sm leading-5 text-slate-600">{text}</p></div>
                <span aria-hidden className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white sm:flex">›</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="ta-container ta-section">
        <h2 className="font-display text-3xl font-extrabold">Comment ça marche ?</h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr_1fr_1.1fr] lg:items-stretch">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 font-display text-lg font-extrabold text-white">{i + 1}</span>
              <div><h3 className="font-extrabold">{step.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{step.text}</p></div>
            </div>
          ))}
          <Link to="/entreprise" className="flex items-center gap-4 rounded-xl border border-red-100 bg-red-50 p-5 hover:bg-red-100">
            <div className="flex-1"><p className="font-extrabold text-brand-700">Pour les entreprises (PME)</p><p className="mt-1 text-sm leading-5 text-slate-600">Support IT pour vos équipes, maintenance, déploiement et gestion de parc informatique.</p></div>
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-600">›</span>
          </Link>
        </div>
      </section>

      <section className="bg-[#07101d] text-white">
        <div className="ta-container grid grid-cols-2 gap-x-4 gap-y-5 py-6 lg:grid-cols-[repeat(4,1fr)_auto] lg:items-center">
          {[
            ['100%', 'Connexions sécurisées'],
            ['Techniciens qualifiés', 'Disponibles en Afrique'],
            ['Assistance rapide', 'En quelques minutes'],
            ['Support humain', 'Des vrais techniciens'],
          ].map(([t, d]) => (
            <div key={t}><p className="font-extrabold">{t}</p><p className="mt-0.5 text-xs text-slate-400">{d}</p></div>
          ))}
          <Link to="/assistance" className="ta-button col-span-2 bg-brand-600 text-white hover:bg-brand-500 lg:col-span-1">Commencer maintenant <span aria-hidden className="ml-2">→</span></Link>
        </div>
      </section>

      <section className="ta-container ta-section" id="tarifs">
        <div className="mx-auto max-w-2xl text-center"><p className="ta-eyebrow">Tarifs transparents</p><h2 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Commencez sans engagement.</h2><p className="mt-3 text-slate-600">Le lancement actuel rend les assistances gratuites. Les tarifs habituels restent affichés à titre indicatif.</p></div>
        <div className="mt-9"><PricingTable /></div>
      </section>

      <section className="bg-[#11151b] py-16 text-white sm:py-20 lg:py-24" id="pme">
        <div className="ta-container grid gap-10 lg:grid-cols-2 lg:items-start">
          <div><p className="text-sm font-bold text-brand-400">POUR LES PME</p><h2 className="mt-2 max-w-lg font-display text-3xl font-extrabold sm:text-4xl">Un seul espace pour suivre tous vos postes.</h2><p className="mt-4 max-w-md leading-7 text-slate-300">Vos employés rejoignent avec un code. Vous suivez les demandes d’aide, l’état des postes et les interventions depuis un même espace.</p><Link to="/entreprise" className="mt-7 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-100">Découvrir l’espace entreprise →</Link></div>
          <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-2xl sm:p-7"><PmeRequestForm /></div>
        </div>
      </section>

      <section id="visite" className="ta-container ta-section">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div><p className="ta-eyebrow">Intervention sur place</p><h2 className="mt-2 max-w-md font-display text-3xl font-extrabold sm:text-4xl">Le problème est matériel ?</h2><p className="mt-4 max-w-md leading-7 text-slate-600">Écran, clavier, disque, câblage : décrivez la panne et votre quartier. Nous vous répondons avec un devis.</p></div>
          <div className="ta-card p-5 sm:p-7"><VisitRequestForm /></div>
        </div>
      </section>

      <section id="technicien" className="border-t border-slate-200 bg-white py-16 sm:py-20 lg:py-24">
        <div className="ta-container grid gap-10 lg:grid-cols-2">
          <div><p className="ta-eyebrow">Rejoindre le réseau</p><h2 className="mt-2 max-w-md font-display text-3xl font-extrabold sm:text-4xl">Vous êtes technicien informatique ?</h2><p className="mt-4 max-w-md leading-7 text-slate-600">Reprenez les dossiers que l’agent ne peut pas résoudre et intervenez depuis la console technicien.</p></div>
          <div className="ta-card p-5 sm:p-7"><TechnicianApplyForm /></div>
        </div>
      </section>

      <section className="ta-container ta-section">
        <div className="mx-auto max-w-3xl"><p className="ta-eyebrow">Besoin de réponses ?</p><h2 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Questions fréquentes</h2><div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">{FAQ.map(([q,a]) => <details key={q} className="group py-5"><summary className="cursor-pointer list-none pr-8 font-bold marker:hidden">{q}<span className="float-right text-xl font-normal text-brand-600 transition group-open:rotate-45">+</span></summary><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{a}</p></details>)}</div></div>
      </section>

      <section className="bg-brand-600">
        <div className="ta-container flex flex-col gap-6 py-12 text-white sm:flex-row sm:items-center sm:justify-between sm:py-14">
          <div><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Votre ordinateur vous bloque ?</h2><p className="mt-1 text-sm text-red-100">Commencez directement depuis le Web, sans installation.</p></div>
          <Link to="/assistance" className="ta-button shrink-0 bg-white text-brand-700 hover:bg-red-50">Commencer maintenant →</Link>
        </div>
      </section>
    </div>
  );
}
