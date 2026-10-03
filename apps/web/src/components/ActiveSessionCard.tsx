import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';

export interface MySession {
  id: string;
  session_code: string;
  platform: string;
  status: string;
  ends_at: string | null;
  consent_screen_at: string | null;
  consent_control_at: string | null;
  client_phone: string;
  client_name: string | null;
}

interface Credentials {
  remotePeerId: string;
  remotePassword: string;
}

/** Identifiants de la prise en main à distance, une fois le client d'accord. */
export function RemoteAccess({ sessionId, controlGranted }: { sessionId: string; controlGranted: boolean }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadCredentials() {
    setLoading(true);
    setError(null);
    try {
      setCredentials(await api.get<Credentials>(`/api/technician/sessions/${sessionId}/remote-credentials`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    } finally {
      setLoading(false);
    }
  }

  if (!controlGranted) return <p className="text-sm text-amber-700">Prise en main à distance : le client ne l'a pas encore autorisée.</p>;
  return (
    <div className="space-y-2">
      {!credentials && (
        <button onClick={loadCredentials} disabled={loading} className="ta-button-secondary !w-auto !py-2 disabled:opacity-50">
          {loading ? 'Chargement…' : 'Se connecter à distance'}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {credentials && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 font-mono text-xs">
          <p>ID RustDesk : {credentials.remotePeerId}</p>
          <p>Mot de passe : {credentials.remotePassword}</p>
          <p className="font-sans text-slate-500">Saisissez ces identifiants dans votre propre client RustDesk pour vous connecter.</p>
        </div>
      )}
    </div>
  );
}

export function ActiveSessionCard({ session }: { session: MySession }) {
  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Code {session.session_code}</p>
          <p className="truncate text-sm text-slate-500">
            {session.client_name ?? 'Client'} · {session.client_phone} · {session.platform}
          </p>
        </div>
        <Link to={`/technicien?session=${session.id}`} className="shrink-0 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-brand-700">
          Ouvrir
        </Link>
      </div>
      <RemoteAccess sessionId={session.id} controlGranted={!!session.consent_control_at} />
    </li>
  );
}
