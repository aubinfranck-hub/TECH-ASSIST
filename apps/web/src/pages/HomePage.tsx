import { Link } from 'react-router-dom';
import { PmeRequestForm } from '../components/PmeRequestForm.js';
import { PricingTable } from '../components/PricingTable.js';
import { TechnicianApplyForm } from '../components/TechnicianApplyForm.js';
import { VisitRequestForm } from '../components/VisitRequestForm.js';

const SERVICES = [
  { icon: '⚡', title: 'PC lent ou instable', text: 'Démarrage lent, disque plein, mises à jour, pilotes, batterie et performances.' },
  { icon: '◉', title: 'Réseau & Wi-Fi', text: 'Internet, Wi-Fi, serveur, lecteur réseau, imprimante et problèmes de connexion.' },
  { icon: '▣', title: 'Windows & Office', text: 'Windows, Outlook, Word, Excel, logiciels bloqués ou qui plantent.' },
  { icon: '✓', title: 'Sécurité', text: 'Antivirus, pare-feu, programmes suspects et contrôles de sécurité.' },
];

const STEPS = [
  { n: '01', title: 'Diagnostic', text: 'L’agent examine votre PC et vous explique ce qu’il trouve avant toute action.' },
  { n: '02', title: 'Votre accord', text: 'Chaque correction est expliquée. Rien n’est modifié sans votre « oui ».' },
  { n: '03', title: 'Vérification', text: 'L’agent contrôle le résultat et passe la main à un technicien si nécessaire.' },
];

const FAQ = [
  ['Le technicien peut-il voir mes fichiers personnels ?', 'Non, sauf nécessité explicite liée au problème signalé et avec votre accord. Les actions sont journalisées.'],
  ['Comment puis-je arrêter une session ?', 'Un bouton « Arrêter » permet de couper immédiatement l’assistance pendant la session.'],
  ['Et si mon problème est matériel ?', 'Une panne matérielle peut nécessiter une intervention sur place. Vous pouvez demander un déplacement.'],
  ['Comment se fait le paiement ?', 'L’abonnement de 10 000 FCFA par mois se règle par Mobile Money depuis l’application.'],
];

export function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-[#0b1220] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_30%,rgba(239,68,68,.20),transparent_34%),linear-gradient(90deg,#07101d_0%,#0b1220_48%,rgba(11,18,32,.42)_100%)]" />
        <div className="ta-container relative py-8 sm:py-12 lg:py-16">
          <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900 shadow-2xl">
            <img
              src="https://assets.zyrosite.com/cdn-cgi/image/format%3Dauto%2Cw%3D1536%2Ch%3D900%2Cfit%3Dcrop/jl6el4uMpAe2TySk/5a63946a-c873-4cc3-8190-b1df4e6becad-4iXbdJ44xqTMF7zN.jpg"
              alt="Technicien informatique travaillant sur un laptop et un écran"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07101d] via-[#07101d]/90 to-[#07101d]/15" />
            <div className="relative z-10 flex min-h-[520px] max-w-2xl flex-col justify-center p-7 sm:p-10 lg:p-14">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[.16em] text-slate-200 backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Assistance informatique professionnelle
              </div>
              <h1 className="mt-6 font-display text-[2.8rem] font-extrabold leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-[4.5rem]">
                Votre informatique.<br /><span className="text-brand-500">Toujours opérationnelle.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-200 sm:text-lg">
                Assistance à distance pour PC et laptops, diagnostic, Windows, réseau et sécurité. Une aide rapide, claire et sécurisée, avec un technicien quand c’est nécessaire.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/assistance" className="ta-button bg-brand-600 text-white shadow-xl shadow-red-950/30 hover:-translate-y-0.5 hover:bg-brand-500">Démarrer une assistance <span aria-hidden>→</span></Link>
                <Link to="/diagnostic" className="ta-button border border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/15">Lancer un diagnostic</Link>
              </div>
              <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 border-t border-white/10 pt-5">
                <div><p className="text-sm font-extrabold">PC & Laptop</p><p className="mt-1 text-xs text-slate-400">Windows & logiciels</p></div>
                <div><p className="text-sm font-extrabold">Réseau</p><p className="mt-1 text-xs text-slate-400">Wi-Fi & Internet</p></div>
                <div><p className="text-sm font-extrabold">Humain + IA</p><p className="mt-1 text-xs text-slate-400">Relais technicien</p></div>
              </div>
            </div>
            <div className="absolute bottom-6 right-6 z-10 hidden rounded-2xl border border-white/15 bg-slate-950/75 p-4 shadow-xl backdrop-blur sm:block">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">✓</span>
                <div><p className="text-sm font-bold">Assistance sécurisée</p><p className="text-xs text-slate-400">Vous gardez le contrôle</p></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <div className="ta-container grid grid-cols-2 divide-x divide-slate-200 sm:grid-cols-4">
          {[
            ['24/7', 'Accès à l’assistance'], ['IA + humain', 'Deux niveaux d’aide'], ['100%', 'Actions contrôlées'], ['CI', 'Service local'],
          ].map(([value, label]) => <div key={label} className="px-3 py-5 text-center sm:px-6"><p className="font-display text-xl font-extrabold text-slate-950 sm:text-2xl">{value}</p><p className="mt-1 text-[11px] font-medium text-slate-500 sm:text-xs">{label}</p></div>)}
        </div>
      </section>

      <section className="ta-container ta-section">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="ta-eyebrow">Nos interventions</p><h2 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Les problèmes du quotidien, simplement.</h2></div>
          <Link to="/assistance" className="text-sm font-bold text-brand-700 hover:underline">Voir l’assistance →</Link>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['https://assets.zyrosite.com/cdn-cgi/image/format%3Dauto%2Cw%3D900%2Ch%3D650%2Cfit%3Dcrop/jl6el4uMpAe2TySk/5a63946a-c873-4cc3-8190-b1df4e6becad-4iXbdJ44xqTMF7zN.jpg','PC & Laptop','Dépannage Windows, lenteurs, pilotes, logiciels et performances.'],
            ['https://pcsunlimited.co.uk/assets/onsite-support-bg-BFhK_F52.png','Réseau & Internet','Wi-Fi, routeurs, connexion, partage réseau et configuration.'],
            ['https://www.stuermer-maschinen.de/fileadmin/_processed_/c/0/csm_14_Junior_Web_Entwickler_IMG_4131_dc9fb269b6.jpg','Windows & Office','Installation, configuration, Microsoft 365 et accompagnement utilisateur.'],
            ['https://bcomservices.com/images/computer-repair-service-gold-coast-1.webp','Sécurité & Maintenance','Virus, optimisation, maintenance et problèmes matériels.'],
          ].map(([image,title,text]) => (
            <article key={title} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="h-44 overflow-hidden bg-slate-100"><img src={image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /></div>
              <div className="p-5"><h3 className="text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p><Link to="/assistance" className="mt-4 inline-flex text-sm font-bold text-brand-700">En savoir plus →</Link></div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="ta-container grid gap-12 py-16 lg:grid-cols-[.8fr_1.2fr] lg:py-24">
          <div><p className="ta-eyebrow">Simple & sécurisé</p><h2 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Vous gardez toujours la main.</h2><p className="mt-4 max-w-md leading-7 text-slate-600">Tech Assist ne doit pas être une boîte noire. Vous savez ce qui est analysé, ce qui va être modifié et pourquoi.</p></div>
          <div className="grid gap-3">
            {STEPS.map((step) => <div key={step.n} className="flex gap-5 rounded-2xl border border-slate-200 p-5 sm:p-6"><span className="font-display text-sm font-extrabold text-brand-600">{step.n}</span><div><h3 className="font-extrabold">{step.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{step.text}</p></div></div>)}
          </div>
        </div>
      </section>

      <section className="ta-container ta-section" id="tarifs">
        <div className="mx-auto max-w-2xl text-center"><p className="ta-eyebrow">Tarifs transparents</p><h2 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Commencez sans engagement.</h2><p className="mt-3 text-slate-600">Votre première assistance est offerte. Ensuite, choisissez la formule adaptée à votre besoin.</p></div>
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
          <div><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Votre ordinateur vous bloque ?</h2><p className="mt-1 text-sm text-red-100">Commencez par un diagnostic ou installez Tech Assist.</p></div>
          <Link to="/assistance" className="ta-button shrink-0 bg-white text-brand-700 hover:bg-red-50">Commencer maintenant →</Link>
        </div>
      </section>
    </div>
  );
}
