import { Link } from 'react-router-dom';

export function PhonePage() {
  return (
    <div className="ta-container max-w-3xl py-12 sm:py-16">
      <div className="max-w-2xl">
        <p className="ta-eyebrow">Assistance mobile</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">
          Besoin d’aide sur votre téléphone ?
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Commencez directement une demande. Tech Assist analyse votre problème et peut transmettre
          le même dossier à un technicien si une intervention humaine est nécessaire.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="ta-card p-5">
          <span className="text-2xl">💬</span>
          <h2 className="mt-3 font-extrabold">Décrire</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Expliquez le problème depuis votre navigateur mobile.</p>
        </article>
        <article className="ta-card p-5">
          <span className="text-2xl">🤖</span>
          <h2 className="mt-3 font-extrabold">Être guidé</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">L’IA vous propose des vérifications et attend votre retour.</p>
        </article>
        <article className="ta-card p-5">
          <span className="text-2xl">👨‍🔧</span>
          <h2 className="mt-3 font-extrabold">Être accompagné</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Un technicien reprend le dossier si l’IA ne suffit pas.</p>
        </article>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="font-extrabold">Contrôle à distance du téléphone Android</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Le diagnostic et le guidage peuvent commencer sur le Web. Pour une véritable prise en main
          d’un téléphone Android, l’application native Tech Assist devra obtenir les autorisations
          Android nécessaires, notamment pour le partage d’écran et, lorsque le système l’autorise,
          l’accessibilité. Le contrôle ne doit jamais être présenté comme actif sans le consentement du client.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/demander-aide" className="ta-button-primary justify-center">
          🆘 Demander de l’aide — gratuit
        </Link>
        <Link to="/assistance" className="ta-button-secondary justify-center">
          Voir le parcours complet
        </Link>
      </div>
    </div>
  );
}
