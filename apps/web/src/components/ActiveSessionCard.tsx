import { useState } from 'react';
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

export function ActiveSessionCard({ session }: { session: MySession }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadCredentials() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Credentials>(`/api/technician/sessions/${session.id}/remote-credentials`);
      setCredentials(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="rounded-lg border bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">Code {session.session_code}</p>
          <p className="text-sm text-slate-500">
            {session.client_name ?? 'Client'} · {session.client_phone} · {session.platform}
          </p>
        </div>
        {!session.consent_control_at && (
          <span className="text-xs text-amber-700">En attente du consentement client</span>
        )}
      </div>

      {session.consent_control_at && !credentials && (
        <button
          onClick={loadCredentials}
          disabled={loading}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Se connecter'}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {credentials && (
        <div className="rounded bg-slate-50 p-2 font-mono text-xs space-y-1">
          <p>ID RustDesk : {credentials.remotePeerId}</p>
          <p>Mot de passe : {credentials.remotePassword}</p>
          <p className="text-slate-500 font-sans">
            Saisissez ces identifiants dans votre propre client RustDesk pour vous connecter.
          </p>
        </div>
      )}
    </li>
  );
}
