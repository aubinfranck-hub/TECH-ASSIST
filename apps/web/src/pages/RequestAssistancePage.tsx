import { useNavigate } from 'react-router-dom';

export function RequestAssistancePage() {
  const navigate = useNavigate();

  return (
    <div className="ta-container max-w-3xl py-14">
      <p className="ta-eyebrow mb-2">Tech Assist</p>
      <h1 className="text-2xl font-bold sm:text-3xl">🆘 Demander de l’aide</h1>
      <p className="mt-2 text-slate-600">
        L’assistance technique se fait désormais directement depuis l’application TechAssist.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <div className="ta-card p-6">
          <p className="text-2xl">📱</p>
          <h2 className="mt-3 text-xl font-bold">Android</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Installez l’APK TechAssist pour lancer le diagnostic IA, transmettre votre dossier au technicien et gérer votre session depuis votre téléphone.
          </p>
          <button onClick={() => navigate('/telephone')} className="ta-button-primary mt-5 w-full justify-center">
            Ouvrir l’espace Android
          </button>
        </div>

        <div className="ta-card p-6">
          <p className="text-2xl">💻</p>
          <h2 className="mt-3 text-xl font-bold">Windows</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Installez l’agent TechAssist Windows pour le diagnostic et l’assistance à distance sur votre PC.
          </p>
          <button onClick={() => navigate('/telephone')} className="ta-button-primary mt-5 w-full justify-center">
            Ouvrir l’espace Windows
          </button>
        </div>
      </div>

      <div className="ta-card mt-6 border-brand-200 bg-brand-50 p-6">
        <h2 className="font-bold text-brand-950">Pourquoi l’application ?</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-brand-900">
          <li>✓ Diagnostic directement sur l’appareil</li>
          <li>✓ IA TechAssist avec l’historique du dossier</li>
          <li>✓ Passage à un technicien sans recommencer l’explication</li>
          <li>✓ Assistance distante adaptée à Android et Windows</li>
          <li>✓ Le site reste un portail, pas l’outil d’assistance</li>
        </ul>
      </div>
    </div>
  );
}
