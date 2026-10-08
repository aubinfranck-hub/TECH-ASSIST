import { Link } from 'react-router-dom';
import { SITE_IMAGES } from '../lib/imageSources.js';
import { PageHero } from '../components/PageHero.js';

export function RequestAssistancePage() {
  return (
    <div>
      <PageHero
        eyebrow="DEMANDER DE L’AIDE"
        title="Votre problème informatique commence ici."
        text="Choisissez votre appareil. TechAssist vous accompagne avec l’IA, puis transmet le dossier à un technicien si nécessaire."
        image={SITE_IMAGES.hero}
        imageAlt="Technicien au travail dans un environnement informatique"
      />
      <div className="ta-container py-10 sm:py-14">
        <div className="grid gap-6 lg:grid-cols-2">
          <Link to="/telephone" className="group overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card transition hover:-translate-y-1 hover:shadow-xl">
            <img src={SITE_IMAGES.office} alt="Assistance depuis un téléphone Android" className="h-56 w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
            <div className="p-7">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-wider text-brand-700">Application mobile</p><h2 className="mt-2 font-display text-2xl font-black">📱 Android</h2></div><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">APK</span></div>
              <p className="mt-3 text-sm leading-6 text-slate-600">Diagnostic IA, historique du dossier, passage au technicien et assistance distante depuis votre téléphone.</p>
              <span className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white">Ouvrir l’espace Android →</span>
            </div>
          </Link>

          <Link to="/diagnostic" className="group overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-card transition hover:-translate-y-1 hover:shadow-xl">
            <img src={SITE_IMAGES.pc} alt="Assistance informatique sur PC Windows" className="h-56 w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
            <div className="p-7">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-wider text-brand-700">Agent ordinateur</p><h2 className="mt-2 font-display text-2xl font-black">💻 Windows</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">EXE</span></div>
              <p className="mt-3 text-sm leading-6 text-slate-600">Diagnostic local et assistance distante sur votre PC, avec intervention du technicien lorsque nécessaire.</p>
              <span className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Ouvrir l’espace Windows →</span>
            </div>
          </Link>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ['01', 'Installez', 'Utilisez l’application adaptée à votre appareil.'],
            ['02', 'Expliquez', 'Décrivez votre problème à TechAssist.'],
            ['03', 'Résolvez', 'IA ou technicien : votre dossier continue sans recommencer.'],
          ].map(([n,t,d]) => <div key={n} className="rounded-2xl bg-slate-950 p-5 text-white"><span className="text-xs font-black text-brand-400">{n}</span><h3 className="mt-2 font-black">{t}</h3><p className="mt-1 text-sm leading-5 text-slate-400">{d}</p></div>)}
        </section>

        <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-5 sm:p-6">
          <p className="font-black text-green-950">🎉 Lancement gratuit</p>
          <p className="mt-1 text-sm leading-6 text-green-900"><s>500 FCFA</s> IA · <s>2 000 FCFA</s> IA + technicien · <strong>gratuit actuellement</strong>.</p>
        </div>
      </div>
    </div>
  );
}