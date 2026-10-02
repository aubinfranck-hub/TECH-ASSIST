import { Link } from 'react-router-dom';
import { PmeRequestForm } from '../components/PmeRequestForm.js';
import { PricingTable } from '../components/PricingTable.js';
import { TechnicianApplyForm } from '../components/TechnicianApplyForm.js';
import { VisitRequestForm } from '../components/VisitRequestForm.js';

const STEPS = [
  { title: 'Diagnostic', text: 'L’agent examine votre PC sans rien modifier et vous dit ce qu’il trouve, avec un niveau de gravité.' },
  { title: 'Votre accord', text: 'Chaque correction vous est expliquée. Rien n’est fait sans votre « oui ».' },
  { title: 'Vérification', text: 'L’agent contrôle que le problème a disparu. Sinon, un technicien prend le relais.' },
];

const SERVICES = [
  { title: 'Ordinateur lent ou qui plante', text: 'Disque plein, démarrage long, mises à jour, pilotes, batterie.' },
  { title: 'Internet, Wi-Fi et imprimante', text: 'Connexion coupée, lecteur réseau, accès au serveur, imprimante qui ne répond plus.' },
  { title: 'Outlook, Excel et Word', text: 'Application bloquée, plantages répétés, messagerie qui ne s’ouvre plus.' },
  { title: 'Sécurité', text: 'Antivirus, pare-feu, programmes suspects.' },
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
    a: 'L’abonnement de 10 000 FCFA par mois se règle par Mobile Money depuis l’application.',
  },
];

export function HomePage() {
  return (
    <div>
      <section className="border-b border-slate-200 bg-white">
        <div className="ta-container grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-14 lg:py-24">
          <div>
            <h1 className="max-w-xl font-display text-[2.4rem] font-extrabold leading-[1.04] text-[#14181f] sm:text-5xl lg:text-[3.6rem]">
              Un technicien informatique, dans votre PC, quand vous en avez besoin.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 sm:text-lg">
              Installez Tech Assist sur Windows. L’agent trouve la panne, vous explique ce qu’il va faire, corrige avec votre accord, puis vérifie. Un technicien reste disponible.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to="/assistance" className="ta-button-primary">Installer l’application</Link>
              <a href="#tarifs" className="ta-button-secondary">Voir les tarifs</a>
            </div>
            <p className="mt-4 text-sm text-slate-500">La première assistance est offerte.</p>
          </div>

          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <div
              className="rounded-2xl border border-slate-200 bg-[#f6f7f9] p-4 shadow-soft sm:p-5"
              role="img"
              aria-label="Exemple de conversation entre un client et l’agent Tech Assist"
            >
              <div className="space-y-3 text-[15px] leading-6">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-white">
                  Mon PC est très lent depuis ce matin.
                </div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-slate-800">
                  <p>J’ai examiné votre PC, rien n’a été modifié.</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    <li>🟠 Disque presque plein : 3 Go libres</li>
                    <li>🟡 14 programmes se lancent au démarrage</li>
                    <li>🟢 Antivirus actif, Windows à jour</li>
                  </ul>
                </div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-slate-800">
                  <p>Je peux supprimer les fichiers temporaires et libérer environ 9 Go. Vos documents ne sont pas touchés.</p>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Oui, nettoyer</span>
                    <span className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Non merci</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ta-container ta-section">
        <h2 className="max-w-xl font-display text-3xl font-extrabold sm:text-4xl">Ce que nous réglons à distance</h2>
        <div className="mt-8 grid border-t border-slate-300 sm:grid-cols-2">
          {SERVICES.map((service, i) => (
            <div key={service.title} className={`border-b border-slate-300 py-6 sm:pr-8 ${i % 2 === 1 ? 'sm:border-l sm:pl-8' : ''}`}>
              <h3 className="text-lg font-bold">{service.title}</h3>
              <p className="mt-1.5 max-w-sm text-slate-600">{service.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-slate-500">Une panne matérielle (écran cassé, disque mort) demande une intervention sur place : voir plus bas.</p>
      </section>

      <section className="border-y border-slate-200 bg-white py-14 sm:py-16 lg:py-24">
        <div className="ta-container grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Vous gardez la main</h2>
            <p className="mt-3 max-w-sm text-slate-600">Chaque assistance suit le même chemin, du début à la fin.</p>
          </div>
          <ol className="relative space-y-8 border-l-2 border-brand-600/30 pl-7">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                <span className="absolute -left-[41px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                <h3 className="text-lg font-bold">{step.title}</h3>
                <p className="mt-1 max-w-md text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="ta-container ta-section" id="tarifs">
        <h2 className="max-w-xl font-display text-3xl font-extrabold sm:text-4xl">Des prix annoncés avant de commencer</h2>
        <div className="mt-8">
          <PricingTable />
        </div>
      </section>

      <section className="bg-[#14181f] py-14 text-white sm:py-16 lg:py-24" id="pme">
        <div className="ta-container grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="max-w-md font-display text-3xl font-extrabold sm:text-4xl">Une entreprise, plusieurs PC, un seul suivi</h2>
            <p className="mt-4 max-w-md leading-7 text-slate-300">
              Vos employés rejoignent avec un code. Vous voyez l’état de chaque poste, les demandes d’aide et un rapport mensuel.
            </p>
            <Link to="/entreprise" className="mt-6 inline-flex font-semibold text-white underline decoration-brand-500 decoration-2 underline-offset-4 hover:decoration-white">
              Ouvrir l’espace entreprise
            </Link>
          </div>
          <div className="rounded-xl bg-white p-5 text-slate-900 sm:p-7">
            <PmeRequestForm />
          </div>
        </div>
      </section>

      <section id="visite" className="ta-container ta-section">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="max-w-md font-display text-3xl font-extrabold sm:text-4xl">Si le problème est matériel, nous nous déplaçons</h2>
            <p className="mt-3 max-w-md leading-7 text-slate-600">
              Écran, clavier, disque, câblage : décrivez la panne et votre quartier, nous vous répondons avec un devis.
            </p>
          </div>
          <div className="ta-card p-5 sm:p-7">
            <VisitRequestForm />
          </div>
        </div>
      </section>

      <section id="technicien" className="border-t border-slate-200 bg-white py-14 sm:py-16 lg:py-24">
        <div className="ta-container grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="max-w-md font-display text-3xl font-extrabold sm:text-4xl">Vous êtes technicien ?</h2>
            <p className="mt-3 max-w-md leading-7 text-slate-600">
              Candidatez pour reprendre les dossiers que l’agent ne peut pas résoudre, depuis la console technicien.
            </p>
          </div>
          <div className="ta-card p-5 sm:p-7">
            <TechnicianApplyForm />
          </div>
        </div>
      </section>

      <section className="ta-container ta-section">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Questions fréquentes</h2>
          <div className="mt-8 divide-y divide-slate-300 border-y border-slate-300">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="cursor-pointer list-none pr-8 font-semibold marker:hidden">
                  {item.q}
                  <span className="float-right text-brand-600 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
