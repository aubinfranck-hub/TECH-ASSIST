import { Link } from 'react-router-dom';

export function PhonePage() {
  return (
    <div className="ta-container max-w-3xl py-12 sm:py-16">
      <p className="ta-eyebrow">Application TechAssist</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">Assistance Android</h1>
      <p className="mt-4 text-base leading-7 text-slate-600">
        Pour une vraie assistance de l’appareil, utilisez l’application Android TechAssist.
        Le site sert uniquement de portail.
      </p>
      <div className="ta-card mt-8 p-6">
        <h2 className="font-extrabold">Dans l’application</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">🤖 Diagnostic IA</div>
          <div className="rounded-xl bg-slate-50 p-4">🧠 Historique du dossier</div>
          <div className="rounded-xl bg-slate-50 p-4">👨‍🔧 Passage au technicien</div>
          <div className="rounded-xl bg-slate-50 p-4">🛑 Arrêt de session</div>
        </div>
      </div>
      <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-6">
        <p className="font-bold">APK Android</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Le client Android natif est maintenant dans le dépôt TechAssist et son build APK est automatisé par GitHub Actions.
        </p>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/demander-aide" className="ta-button-primary justify-center">Voir les applications</Link>
        <Link to="/" className="ta-button-secondary justify-center">Retour à l’accueil</Link>
      </div>
    </div>
  );
}
