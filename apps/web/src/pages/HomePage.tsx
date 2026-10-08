import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SITE_IMAGES } from '../lib/imageSources.js';

const RELEASES = 'https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download';
export const WINDOWS_URL = `${RELEASES}/agent-latest/tech-assist-agent.exe`;
export const ANDROID_URL = `${RELEASES}/android-latest/tech-assist-android.apk`;
export const TECH_WINDOWS_URL = `${RELEASES}/agent-latest/tech-assist-technicien.exe`;
export const TECH_ANDROID_URL = `${RELEASES}/android-latest/tech-assist-technicien.apk`;

const STEPS = [
  { title: 'Vous téléchargez et vous ouvrez', text: 'Sur votre ordinateur Windows ou votre téléphone Android. Pas de compte à créer : un numéro d’aide s’affiche tout de suite.' },
  { title: 'L’IA vous aide, tout de suite', text: 'Décrivez votre problème comme à un technicien, par écrit ou à voix haute. Elle cherche, vous guide et, sur Windows, répare avec votre accord.' },
  { title: 'Un technicien prend le relais', text: 'Si elle n’y arrive pas, un technicien est alerté. Vous lui donnez votre numéro, vous acceptez, et il règle le problème avec vous, à distance.' },
];

const FAQ = [
  ['Est-ce que c’est gratuit ?', 'Oui pendant le lancement. Les prix habituels seront annoncés avant toute facturation.'],
  ['Le technicien voit-il mes fichiers ?', 'Il ne voit votre écran qu’après votre accord, et vous pouvez tout arrêter à tout moment. Il n’accède ni à vos documents, ni à vos photos, ni à vos mots de passe.'],
  ['Et si mon problème est matériel ?', 'Un technicien peut vous orienter, ou intervenir sur place si nécessaire.'],
];

function DownloadCard({ icon, title, text, href, action, note }: { icon: string; title: string; text: string; href: string; action: string; note: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <span className="text-4xl" aria-hidden>{icon}</span>
      <h3 className="mt-4 font-display text-xl font-extrabold">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{text}</p>
      <a href={href} className="ta-button-primary mt-5 w-full">{action}</a>
      <p className="mt-2 text-center text-xs text-slate-500">{note}</p>
    </div>
  );
}

/**
 * Le site n'est qu'une vitrine : il explique et fait télécharger. Tout le reste (aide de l'IA, demande de technicien, partage d'écran)
 * se passe dans l'application, comme avec AnyDesk ou TeamViewer.
 */
export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '');

  return (
    <div>
      <section className="relative overflow-hidden bg-[#07101d] text-white">
        <img src={SITE_IMAGES.hero} alt="" className="h-48 w-full object-cover object-[70%_center] sm:h-64 lg:absolute lg:inset-y-0 lg:right-0 lg:h-full lg:w-[60%] lg:object-center" fetchPriority="high" />
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-full bg-gradient-to-r from-[#07101d] from-40% via-[#07101d]/70 to-transparent lg:block" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-transparent via-transparent to-[#07101d] sm:h-64 lg:hidden" />
        <div className="ta-container relative">
          <div className="max-w-xl pb-10 pt-2 lg:py-20">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-300 sm:text-sm">Assistance informatique à distance</p>
            <h1 className="mt-3 font-display text-[2.4rem] font-extrabold leading-[1.04] sm:text-5xl">
              Un technicien dans votre ordinateur et votre téléphone.
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-200 sm:text-lg">
              Téléchargez Tech Assist et ouvrez-le. Une IA vous aide tout de suite ; si elle n’y arrive pas, un technicien prend la main à distance, avec votre accord.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href={WINDOWS_URL} className="ta-button bg-brand-600 text-white hover:bg-brand-500 sm:px-7">↓ Windows</a>
              <a href={ANDROID_URL} className="ta-button border border-white/30 text-white hover:bg-white/10 sm:px-7">↓ Android</a>
            </div>
            <p className="mt-3 text-xs text-slate-400">Gratuit pendant le lancement · aucun compte à créer</p>
          </div>
        </div>
      </section>

      <section id="telecharger" className="ta-container ta-section">
        <h2 className="font-display text-3xl font-extrabold">Téléchargez l’application</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Tout se passe dans l’application : vous ne revenez plus sur le site.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <DownloadCard icon="🖥️" title="Windows" text="L’IA analyse et répare votre PC avec votre accord. Un technicien peut prendre la main si besoin." href={WINDOWS_URL} action="Télécharger pour Windows" note="Fichier .exe · ouvrez-le, acceptez la demande de Windows" />
          <DownloadCard icon="📱" title="Android" text="Conseils de l’IA pas à pas sur votre téléphone, puis un technicien si nécessaire." href={ANDROID_URL} action="Télécharger pour Android" note="Fichier .apk · autorisez l’installation depuis ce navigateur" />
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <span className="text-4xl" aria-hidden>🧑‍💻</span>
            <h3 className="mt-4 font-display text-xl font-extrabold">Vous êtes technicien ?</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">Installez l’application technicien : un ding-dong vous alerte dès qu’un client demande de l’aide, en même temps que vos confrères. Le premier qui prend la demande l’obtient.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <a href={TECH_WINDOWS_URL} className="ta-button-primary">↓ Windows</a>
              <a href={TECH_ANDROID_URL} className="ta-button-primary">↓ Android</a>
            </div>
            <Link to="/technicien" className="mt-3 block text-center text-sm font-bold text-brand-700 hover:underline">Ou ouvrir la console dans le navigateur</Link>
            <p className="mt-2 text-center text-xs text-slate-500">Accès réservé aux techniciens Tech Assist</p>
          </div>
        </div>
      </section>

      <section id="comment" className="bg-white">
        <div className="ta-container ta-section">
          <h2 className="font-display text-3xl font-extrabold">Comment ça marche ?</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="rounded-2xl border border-slate-200 bg-[#f7f8fa] p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 font-display text-lg font-extrabold text-white">{i + 1}</span>
                <h3 className="mt-5 font-extrabold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="suivre" className="ta-container ta-section">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (digits.length === 9) navigate(`/session?code=${digits}`);
          }}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:flex sm:items-end sm:gap-6"
        >
          <div className="sm:flex-1">
            <h2 className="font-display text-xl font-extrabold">Suivre ma demande</h2>
            <p className="mt-1 text-sm text-slate-600">Vous avez déjà ouvert l’application ? Tapez votre numéro d’aide pour voir où en est votre demande.</p>
          </div>
          <div className="mt-4 flex gap-2 sm:mt-0">
            <input inputMode="numeric" autoComplete="off" placeholder="123 456 789" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))} className="ta-input w-44 text-center font-mono text-lg tracking-[0.15em]" aria-label="Votre numéro d’aide" />
            <button disabled={digits.length !== 9} className="ta-button-secondary !w-auto px-5 disabled:opacity-50">Voir</button>
          </div>
        </form>
      </section>

      <section className="ta-container pb-4">
        <h2 className="font-display text-2xl font-extrabold">Questions fréquentes</h2>
        <div className="mt-5 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="cursor-pointer list-none font-bold text-slate-900 marker:hidden">{q}</summary>
              <p className="mt-2 text-sm leading-6 text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
