import { Link } from 'react-router-dom';

export function DiagnosticPage() {
  return (
    <div className="ta-container max-w-3xl py-14">
      <div className="mb-8">
        <p className="ta-eyebrow mb-2">Diagnostic Tech Assist</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Décrivez votre problème, nous commençons l’analyse.</h1>
        <p className="mt-4 max-w-2xl text-slate-600 leading-7">
          Le diagnostic démarre directement sur le Web. L’assistant IA analyse votre demande et vous guide.
          Si le problème persiste, vous pouvez demander la reprise du dossier par un technicien.
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-bold text-green-900">🎉 Lancement Tech Assist — gratuit actuellement</p>
        <p className="mt-1 text-sm leading-6 text-green-800">
          Aucun paiement n’est demandé pendant le lancement. Les tarifs habituels restent affichés sur le site à titre indicatif.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['01', 'Décrivez', 'Expliquez simplement ce qui ne fonctionne pas.'],
          ['02', 'Analysez', 'L’IA recherche une piste et vous accompagne étape par étape.'],
          ['03', 'Escaladez', 'Si nécessaire, un technicien reprend le dossier avec l’historique.'],
        ].map(([n, title, text]) => (
          <article key={n} className="ta-card p-5">
            <span className="text-sm font-black text-brand-600">{n}</span>
            <h2 className="mt-2 font-bold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
          </article>
        ))}
      </div>

      <Link to="/demander-aide" className="ta-button-primary mt-8 w-full justify-center py-3 sm:w-auto">
        🆘 DÉMARRER LE DIAGNOSTIC — GRATUIT
      </Link>
    </div>
  );
}
