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
      <section className="relative overflow-hidden bg-[#11151b] text-white">
        <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="ta-container relative grid gap-12 py-14 sm:py-20 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-16 lg:py-24">
          <div>
            <div className="ta-badge-dark"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Assistance informatique à distance</div>
            <h1 className="mt-6 max-w-3xl font-display text-[2.7rem] font-extrabold leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-[4.35rem]">
              Votre PC a un problème.<br /><span className="text-brand-500">Tech Assist s’en occupe.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Un agent IA analyse votre ordinateur, vous explique le problème et vous accompagne pour le résoudre. Si nécessaire, un technicien humain prend le relais.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/assistance" className="ta-button bg-brand-600 text-white shadow-lg shadow-brand-900/30 hover:-translate-y-0.5 hover:bg-brand-500">Commencer maintenant →</Link>
              <Link to="/diagnostic" className="ta-button border border-white/15 bg-white/5 text-white hover:bg-white/10">Faire un diagnostic</Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-slate-400">
              <span>✓ Première assistance offerte</span><span>✓ Vous gardez le contrôle</span><span>✓ Côte d’Ivoire</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-brand-500/10 blur-xl" />
            <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white p-4 shadow-2xl sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><span className="text-xs font-bold text-slate-800">Tech Assist · Diagnostic</span></div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">EN DIRECT</span>
              </div>
              <div className="space-y-3 text-sm leading-6">
                <div className="ml-auto w-fit max-w-[84%] rounded-2xl rounded-br-md bg-[#14181f] px-4 py-2.5 text-white">Mon PC est très lent depuis ce matin.</div>
                <div className="max-w-[94%] rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-slate-800">
                  <p className="font-semibold">Diagnostic terminé — aucune modification effectuée.</p>
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl bg-white p-2.5"><b className="text-orange-600">3 Go</b><br />espace libre</div>
                    <div className="rounded-xl bg-white p-2.5"><b className="text-amber-600">14</b><br />apps au démarrage</div>
                    <div className="rounded-xl bg-white p-2.5"><b className="text-emerald-600">OK</b><br />antivirus</div>
                  </div>
                </div>
                <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-brand-100 bg-brand-50 px-4 py-3 text-slate-800">
                  <p>Je peux libérer environ <b>9 Go</b> sans toucher à vos documents.</p>
                  <div className="mt-3 flex gap-2"><span className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Autoriser</span><span className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold">Refuser</span></div>
                </div>
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
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service) => (
            <article key={service.title} className="ta-card group p-6 transition duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-700">{service.icon}</div>
              <h3 className="mt-5 text-lg font-extrabold">{service.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{service.text}</p>
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
