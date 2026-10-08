import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { TechnicianTool } from './TechnicianTool.js';

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
/** Outil de prise en main : installé et réglé en un clic, une seule fois (voir TechnicianTool). */
function TechnicianSetup() {
  return <TechnicianTool />;
}

/** Message prêt à envoyer : dit au client, pas à pas, comment partager son écran (la marche à suivre dépend d'où il vient). */
export function shareInstructions(platform: string): string {
  if (platform === 'windows') {
    return "Bonjour, pour que je voie votre écran et vous aide directement : 1) dans la fenêtre Tech Assist sur votre PC, répondez « Oui » quand on vous propose de partager l'écran ; 2) quand une fenêtre RustDesk s'affiche, cliquez sur « Accepter ». Je reste avec vous.";
  }
  return "Bonjour, pour que je voie votre écran et vous aide directement : 1) sur cette page, cliquez sur « Préparer mon ordinateur » puis ouvrez le fichier téléchargé (acceptez la demande de Windows) ; 2) cliquez sur « J'autorise le partage d'écran », puis sur « J'autorise le technicien à prendre le contrôle » ; 3) quand une fenêtre RustDesk s'affiche, cliquez sur « Accepter ». Je reste avec vous.";
}

export function RemoteAccess({ sessionId, controlGranted, android = false, platform = 'web', showTool = true }: { sessionId: string; controlGranted: boolean; android?: boolean; platform?: string; showTool?: boolean }) {
  const [asked, setAsked] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  async function askClient() {
    setAsked('sending');
    try {
      await api.post(`/api/technician/sessions/${sessionId}/messages`, { body: shareInstructions(platform) });
      setAsked('sent');
    } catch {
      setAsked('error');
    }
  }
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
    if (!controlGranted || credentials) return;
    void loadCredentials();
    const retry = window.setInterval(() => {
      if (!credentials && !loading) void loadCredentials();
    }, 2500);
    // Si l'autorisation arrive avant l'appairage, on réessaie automatiquement
    // jusqu'à ce que le poste distant soit prêt.
    return () => window.clearInterval(retry);
  }, [controlGranted, credentials, loading]);

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
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">Pour voir l'écran du client, il doit d'abord l'autoriser.</p>
        {android ? (
          <p>Guidez-le par la discussion : l'écran « Contrôle à distance » de son application lui demande son identifiant RustDesk.</p>
        ) : (
          <>
            <p>Envoyez-lui la marche à suivre (un clic). Dès qu'il aura accepté, l'identifiant et le mot de passe apparaîtront ici tout seuls.</p>
            <button type="button" disabled={asked === 'sending' || asked === 'sent'} onClick={() => void askClient()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60">
              {asked === 'sent' ? '✓ Instructions envoyées au client' : asked === 'sending' ? 'Envoi…' : 'Envoyer au client comment partager son écran'}
            </button>
            {asked === 'error' && <p className="text-xs text-red-700">Envoi impossible, réessayez ou écrivez-lui dans la discussion.</p>}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {showTool && <TechnicianSetup />}
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
      <RemoteAccess sessionId={session.id} controlGranted={!!session.consent_control_at} android={session.platform === 'android'} platform={session.platform} showTool={false} />
    </li>
  );
}
