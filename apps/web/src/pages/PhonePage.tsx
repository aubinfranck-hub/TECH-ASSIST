import { Link } from 'react-router-dom';
import { SITE_IMAGES } from '../lib/imageSources.js';
import { PageHero } from '../components/PageHero.js';

export function PhonePage() {
  return (
    <div>
      <PageHero
        eyebrow="APPLICATION ANDROID"
        title="Votre assistance dans votre poche."
        text="L’APK TechAssist transforme votre téléphone en point d’entrée direct vers le diagnostic IA et le technicien."
        image={SITE_IMAGES.office}
        imageAlt="Ordinateur et téléphone utilisés pour une assistance informatique"
        action={{ label: 'Demander de l’aide', to: '/demander-aide' }}
        dark
      />
      <div className="ta-container py-10 sm:py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['🤖','IA','Analyse et conseils guidés.'],
            ['🧠','Historique','Le dossier reste disponible.'],
            ['👨‍🔧','Technicien','Escalade sans répéter le problème.'],
            ['🛑','Contrôle','Vous arrêtez la session quand vous voulez.'],
          ].map(([i,t,d]) => <div key={t} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card"><span className="text-3xl">{i}</span><h2 className="mt-4 font-black">{t}</h2><p className="mt-1 text-sm leading-5 text-slate-600">{d}</p></div>)}
        </div>
        <section className="mt-10 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card">
          <div className="grid lg:grid-cols-2">
            <img src={SITE_IMAGES.security} alt="Sécurité informatique" className="h-64 w-full object-cover lg:h-full" loading="lazy" />
            <div className="p-7 sm:p-9"><p className="text-xs font-extrabold uppercase tracking-wider text-brand-700">APK Android</p><h2 className="mt-2 font-display text-3xl font-black">Une application native, pas une simple page web.</h2><p className="mt-4 text-sm leading-6 text-slate-600">Le client Android est intégré au projet TechAssist et son APK est construit automatiquement. Le site sert de portail et l’application porte l’assistance.</p><div className="mt-6 flex flex-wrap gap-3"><Link to="/demander-aide" className="ta-button-primary">Accéder au parcours →</Link><Link to="/" className="ta-button-secondary">Accueil</Link></div></div>
          </div>
        </section>
      </div>
    </div>
  );
}