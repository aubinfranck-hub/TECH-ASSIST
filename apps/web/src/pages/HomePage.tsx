import { Link } from 'react-router-dom';
import { PmeRequestForm } from '../components/PmeRequestForm.js';
import { PricingTable } from '../components/PricingTable.js';
import { TechnicianApplyForm } from '../components/TechnicianApplyForm.js';
import { VisitRequestForm } from '../components/VisitRequestForm.js';

const STEPS = [
  { title: '1. Choisissez et payez', text: 'Sélectionnez une formule et réglez par Mobile Money.' },
  { title: '2. Téléchargez l\'outil', text: 'Un petit programme (Windows ou Android) ou votre navigateur suffit.' },
  { title: '3. Un technicien vous assiste', text: 'Diagnostic, guidage ou prise en main, jusqu\'à résolution.' },
];

const FAQ = [
  {
    q: 'Le technicien peut-il voir mes fichiers personnels ?',
    a: 'Non, sauf nécessité explicite liée au problème signalé et avec votre accord. Toutes les actions sont journalisées.',
  },
  {
    q: 'Comment puis-je arrêter une session ?',
    a: 'Un bouton "Arrêter" est visible en permanence pendant toute la session et coupe le flux immédiatement.',
  },
  {
    q: 'Que se passe-t-il si mon problème est matériel (écran cassé, etc.) ?',
    a: 'Ce type de panne ne peut pas être résolu à distance. Nous vous orientons vers une intervention sur place.',
  },
  {
    q: 'Comment se fait le paiement ?',
    a: 'Par Mobile Money (Orange, MTN, Moov, Wave), avant le début de chaque session.',
  },
];

export function HomePage() {
  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
            Votre PC ou téléphone réparé à distance
          </h1>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Un technicien vous assiste en direct, sans déplacement, à petit prix. Paiement
            Mobile Money, en toute confiance.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link to="/diagnostic" className="rounded-lg bg-brand-600 px-6 py-3 text-white font-medium hover:bg-brand-700">
              Démarrer un diagnostic — 500 FCFA
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold text-center mb-8">Deux offres, faites pour vous</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-brand-700">Particuliers</h3>
            <p className="mt-2 text-slate-600">
              Ton PC ou ton téléphone réparé à distance, sans te déplacer, à petit prix.
            </p>
            <ul className="mt-4 space-y-1 text-sm text-slate-600">
              <li>• Paiement à l'acte, Mobile Money, avant la session</li>
              <li>• Outil téléchargé pour l'occasion, s'efface après</li>
              <li>• Le premier technicien disponible</li>
            </ul>
            <Link to="/diagnostic" className="mt-4 inline-block text-brand-600 font-medium hover:underline">
              Voir les tarifs →
            </Link>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-brand-700">PME</h3>
            <p className="mt-2 text-slate-600">
              Un assistant dépanne vos ordinateurs dès qu'un souci apparaît.
            </p>
            <ul className="mt-4 space-y-1 text-sm text-slate-600">
              <li>• Abonnement mensuel, à partir de 9 900 FCFA/mois</li>
              <li>• Agent installé en permanence, bouton "Demander de l'aide"</li>
              <li>• Technicien attitré, réponse prioritaire</li>
            </ul>
            <a href="#pme" className="mt-4 inline-block text-brand-600 font-medium hover:underline">
              Être rappelé →
            </a>
          </div>
        </div>
      </section>

      <section className="bg-white border-y">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold text-center mb-8">Tarifs particuliers</h2>
          <PricingTable />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold text-center mb-8">Comment ça marche</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="rounded-xl border bg-white p-5">
              <h3 className="font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pme" className="bg-white border-y">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold text-center mb-6">Votre entreprise a besoin d'un contrat ?</h2>
          <PmeRequestForm />
        </div>
      </section>

      <section id="technicien" className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold text-center mb-6">Devenez technicien partenaire</h2>
        <p className="text-center text-slate-600 mb-6">
          Rejoignez la plateforme, assistez des clients, soyez payé à la session.
        </p>
        <TechnicianApplyForm />
      </section>

      <section id="visite" className="bg-white border-y">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold text-center mb-6">Besoin d'une intervention sur place ?</h2>
          <p className="text-center text-slate-600 mb-6">
            Réseau, réinstallation, installation matériel — pour Abidjan et environs.
          </p>
          <VisitRequestForm />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold text-center mb-8">Questions fréquentes</h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <details key={item.q} className="rounded-lg border bg-white p-4">
              <summary className="font-medium cursor-pointer">{item.q}</summary>
              <p className="mt-2 text-sm text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
