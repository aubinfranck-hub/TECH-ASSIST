import { Link } from 'react-router-dom';
import { PageHero } from '../components/PageHero.js';

const windowsFeatures = [
  ['🖥️', 'Diagnostic PC', 'Analyse guidée des problèmes Windows, performances, démarrage et périphériques.'],
  ['🧰', 'Dépannage', 'Des étapes concrètes, expliquées simplement, avant l’intervention humaine.'],
  ['🔐', 'Accès contrôlé', 'Une intervention distante n’est possible qu’avec votre autorisation.'],
  ['👨‍🔧', 'Technicien', 'Si l’IA ne suffit pas, le dossier et son historique passent au technicien.'],
];

const officeFeatures = [
  ['Word', 'Documents qui ne s’ouvrent plus, mise en page, impression et erreurs courantes.'],
  ['Excel', 'Formules, fichiers, lenteurs et problèmes de fonctionnement.'],
  ['Outlook', 'Messagerie, synchronisation, configuration et incidents courants.'],
];

export function DiagnosticPage() {
  return (
    <div>
      <PageHero
        eyebrow="WINDOWS & OFFICE"
        title="Un PC qui fonctionne. Un travail qui continue."
        text="TechAssist vous accompagne sur Windows et les outils Office avec une première analyse IA, puis un technicien reprend le dossier lorsque la situation l’exige."
        image="/img/pc.jpg"
        imageAlt="Ordinateur Windows utilisé pour une assistance informatique"
        action={{ label: 'Démarrer mon assistance', to: '/demander-aide' }}
        dark
      />

      <div className="ta-container py-10 sm:py-14">
        <section>
          <div className="max-w-2xl">
            <p className="ta-eyebrow">ASSISTANCE WINDOWS</p>
            <h2 className="mt-2 font-display text-3xl font-black sm:text-4xl">Du problème au diagnostic, sans jargon.</h2>
            <p className="mt-4 leading-7 text-slate-600">
              Décrivez ce qui se passe. TechAssist vous guide étape par étape et conserve le contexte pour éviter de recommencer l’explication.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {windowsFeatures.map(([icon, title, text]) => (
              <article key={title} className="group rounded-[24px] border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:shadow-xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-2xl">{icon}</span>
                <h3 className="mt-5 font-display text-xl font-black">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
          <div className="grid lg:grid-cols-[.9fr_1.1fr]">
            <img src="/img/office.jpg" alt="Environnement de travail avec les outils Office" className="h-72 w-full object-cover lg:h-full" loading="lazy" />
            <div className="p-7 sm:p-10">
              <p className="ta-eyebrow">MICROSOFT OFFICE</p>
              <h2 className="mt-2 font-display text-3xl font-black">Word, Excel, Outlook : votre travail ne doit pas rester bloqué.</h2>
              <p className="mt-4 leading-7 text-slate-600">
                TechAssist vous aide à identifier les erreurs courantes et à suivre une procédure claire. Lorsque le problème demande une intervention, le technicien reçoit le contexte déjà établi.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {officeFeatures.map(([title, text]) => (
                  <div key={title} className="rounded-2xl bg-slate-50 p-4">
                    <p className="font-black">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/demander-aide" className="ta-button-primary">Obtenir de l’aide →</Link>
                <a
                  href="https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download/agent-latest/tech-assist-agent.exe"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-900 hover:bg-slate-50"
                >
                  ↓ Télécharger l’agent Windows
                </a>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">Téléchargez l’agent sur le PC à assister, ouvrez-le puis connectez-vous. Il ouvre automatiquement l’assistant TechAssist et peut reprendre un dossier transmis par l’IA.</p>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-3">
          {[
            ['01', 'Décrivez', 'Expliquez votre problème avec vos mots.'],
            ['02', 'Diagnostiquez', 'L’IA vous guide et construit le contexte du dossier.'],
            ['03', 'Escaladez', 'Un technicien reprend la main si nécessaire.'],
          ].map(([number, title, text]) => (
            <article key={number} className="rounded-[24px] bg-slate-950 p-6 text-white">
              <span className="text-xs font-black tracking-[.2em] text-brand-400">{number}</span>
              <h3 className="mt-4 font-display text-xl font-black">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-[30px] bg-brand-600 p-7 text-white sm:p-10">
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[.16em] text-white/70">LANCEMENT</p>
              <h2 className="mt-2 font-display text-3xl font-black">Commencez maintenant.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/80">
                L’assistance TechAssist est actuellement gratuite pendant le lancement.
              </p>
            </div>
            <Link to="/demander-aide" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 font-black text-slate-950 shadow-lg">
              🆘 Demander de l’aide
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
