import { useEffect, useState } from 'react';
import { api, ApiError, type RemoteConfig } from '../lib/api.js';

interface Props {
  sessionId: string;
  alreadyPaired: boolean;
  onPaired: () => void;
}

interface DownloadsManifest {
  windows: { version: string; sha256: string; filename: string };
  android: { version: string; sha256: string; filename: string };
  publishedAt: string;
}

export function RemotePairingPanel({ sessionId, alreadyPaired, onPaired }: Props) {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  const [peerId, setPeerId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RemoteConfig>('/api/remote-config')
      .then(setConfig)
      .catch(() => setConfigError("Le service d'assistance à distance n'est pas encore configuré. Réessayez plus tard."));
    // Manifeste publié par .github/workflows/mirror-rustdesk-client.yml ; absent
    // tant que ce workflow n'a pas tourné une première fois (pas d'erreur bloquante).
    fetch('/downloads-manifest.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setManifest(data))
      .catch(() => setManifest(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/sessions/${sessionId}/pair`, { remotePeerId: peerId, remotePassword: password });
      onPaired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l\'appairage.');
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadyPaired) {
    return (
      <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
        Outil d'assistance appairé ✓ — le technicien pourra s'y connecter une fois votre accord donné ci-dessous.
      </p>
    );
  }

  if (configError) {
    return <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{configError}</p>;
  }

  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <h2 className="font-semibold">Installer et appairer l'outil</h2>
      <ol className="list-decimal pl-5 text-sm text-slate-600 space-y-2">
        <li>
          Téléchargez le client RustDesk portable{' '}
          {manifest ? (
            <>
              (
              <a
                href={`https://github.com/aubinfranck-hub/TECH-ASSIST/releases/tag/rustdesk-mirror-${manifest.windows.version}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 hover:underline"
              >
                version {manifest.windows.version}, hébergée par Tech Assist
              </a>
              , empreinte SHA-256 :{' '}
              <code className="text-xs break-all">{manifest.windows.sha256}</code>)
            </>
          ) : (
            <>
              officiel (
              <a
                href="https://github.com/rustdesk/rustdesk/releases"
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 hover:underline"
              >
                page des versions
              </a>
              )
            </>
          )}{' '}
          — aucune installation permanente n'est nécessaire.
        </li>
        {config && (
          <li>
            Dans <strong>Réseau</strong>, renseignez :
            <div className="mt-2 grid gap-1 rounded bg-slate-50 p-2 font-mono text-xs">
              <span>Serveur ID : {config.idServer}</span>
              <span>Serveur relais : {config.relayServer}</span>
              <span>Clé : {config.key}</span>
            </div>
          </li>
        )}
        <li>Notez l'ID affiché par l'outil et définissez un mot de passe temporaire.</li>
        <li>Renseignez ces deux informations ci-dessous.</li>
      </ol>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <input
          required
          placeholder="ID (affiché dans l'outil)"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          className="rounded-lg border px-3 py-2"
        />
        <input
          required
          placeholder="Mot de passe temporaire"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border px-3 py-2"
        />
        {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !config}
          className="sm:col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? 'Appairage…' : "Confirmer l'appairage"}
        </button>
      </form>
    </div>
  );
}
