import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { downloadCmd } from '../lib/cmdLauncher.js';
import { clientScriptLines } from '../lib/rustdeskScripts.js';

interface Props {
  sessionId: string;
  sessionCode: string;
  alreadyPaired: boolean;
  onPaired: () => void;
}

interface Bootstrap {
  sessionId: string;
  bootstrapToken: string;
  /** null : réseau public RustDesk (aucun serveur auto-hébergé). */
  rustdesk: { idServer: string; relayServer: string; key: string } | null;
  windows: { version: string; url: string; sha256: string };
}

export function RemotePairingPanel({ sessionId, sessionCode, alreadyPaired, onPaired }: Props) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (alreadyPaired) return;
    api.get<Bootstrap>(`/api/sessions/${sessionCode}/remote-bootstrap`)
      .then(setBootstrap)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de préparer l'outil distant."));
  }, [sessionCode, alreadyPaired]);

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!bootstrap) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/sessions/${sessionId}/pair`, {
        remotePeerId: peerId,
        remotePassword: password,
        bootstrapToken: bootstrap.bootstrapToken,
      });
      onPaired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'appairage.");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadAndRun() {
    if (!bootstrap) return;
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
      downloadCmd('TechAssist-Connexion.cmd', clientScriptLines({ apiBase, sessionId: bootstrap.sessionId, bootstrapToken: bootstrap.bootstrapToken, windows: bootstrap.windows, rustdesk: bootstrap.rustdesk }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Préparation impossible.');
    }
  }

  if (alreadyPaired) {
    return <p className="rounded-xl bg-green-50 p-4 text-sm font-medium text-green-800">✓ Outil d'assistance connecté. Le technicien pourra intervenir après votre consentement.</p>;
  }

  return (
    <div className="ta-card overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-5 sm:p-6">
        <h2 className="text-lg font-black text-slate-950">Préparer mon ordinateur</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Un petit fichier s'installe et vous donne l'accès à un technicien — comme AnyDesk. Cliquez, ouvrez le fichier, acceptez la demande de Windows. C'est tout.
        </p>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <button type="button" onClick={downloadAndRun} disabled={!bootstrap} className="ta-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50">
          {!bootstrap ? 'Préparation…' : 'Préparer mon ordinateur'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
