import { useEffect, useState } from 'react';
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
  /** Tâche que l'agent exécute en ce moment sur le PC du client. */
  agent_task?: string | null;
}

interface Credentials {
  remotePeerId: string;
  remotePassword: string;
}

/** Identifiants de la prise en main à distance, une fois le client d'accord. */
export function RemoteAccess({ sessionId, controlGranted, android = false }: { sessionId: string; controlGranted: boolean; android?: boolean }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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

  useEffect(() => {
    if (!controlGranted || credentials || loading) return;
    void loadCredentials();
    // Le parent rafraîchit la session toutes les quelques secondes. Dès que le
    // client valide le contrôle, les identifiants sont donc récupérés sans clic.
  }, [controlGranted]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // Le bouton principal reste utilisable même si le presse-papiers est bloqué.
    }
  }

  if (!controlGranted) {
    return (
      <p className="text-sm text-amber-700">
        {android
          ? "Prise en main du téléphone : le client n'a pas encore partagé son identifiant RustDesk. Guidez-le par la discussion (l'écran « Contrôle à distance » de son application)."
          : "Prise en main à distance : le client ne l'a pas encore autorisée."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {loading && !credentials && <p className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-800">Connexion autorisée. Préparation de la prise en main…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {credentials && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <p className="font-black text-emerald-950">✓ Connexion distante prête</p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">Le client a autorisé le contrôle. Ouvrez RustDesk pour afficher son écran.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void copy(credentials.remotePeerId, 'id')} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-left text-xs">
              <span className="block text-slate-500">ID RustDesk</span>
              <span className="font-mono font-black text-slate-900">{copied === 'id' ? '✓ Copié' : credentials.remotePeerId}</span>
            </button>
            <button type="button" onClick={() => void copy(credentials.remotePassword, 'password')} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-left text-xs">
              <span className="block text-slate-500">Mot de passe</span>
              <span className="font-mono font-black text-slate-900">{copied === 'password' ? '✓ Copié' : credentials.remotePassword}</span>
            </button>
          </div>
          {!android && (
            <a
              href={`rustdesk://connection/new/${encodeURIComponent(credentials.remotePeerId)}?password=${encodeURIComponent(credentials.remotePassword)}`}
              className="ta-button-primary w-full"
            >
              🚀 Ouvrir RustDesk et voir l’écran
            </a>
          )}
          <p className="text-xs leading-5 text-slate-600">
            {android
              ? "Pour Android, ouvrez RustDesk côté technicien et utilisez l’ID ci-dessus. Le téléphone doit avoir autorisé le partage/contrôle."
              : "Si rien ne s’ouvre, RustDesk n’est probablement pas installé ou votre poste n’a pas encore enregistré le protocole rustdesk://. Installez/configurez RustDesk une seule fois."}
          </p>
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
      {session.agent_task && (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600 motion-reduce:animate-none" />
          <span className="min-w-0 break-words">L'agent travaille : {session.agent_task}</span>
        </p>
      )}
      <RemoteAccess sessionId={session.id} controlGranted={!!session.consent_control_at} android={session.platform === 'android'} />
    </li>
  );
}
