import { useEffect, useState } from 'react';

interface Props {
  sessionId: string;
  /** Appel authentifié vers l'API de l'application (jeton de l'installation). */
  call: <T>(path: string, body: unknown, method?: string) => Promise<T>;
}

interface Config {
  idServer: string;
  relayServer: string;
  key: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-2 py-1.5 text-xs">{value}</code>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 2000);
            }).catch(() => undefined);
          }}
        >
          {done ? 'Copié ✓' : 'Copier'}
        </button>
      </div>
    </div>
  );
}

/**
 * Prise en main du téléphone par le technicien, avec l'application RustDesk reliée au serveur Tech Assist.
 * Le client reste maître : il lance lui-même le partage dans RustDesk et accepte la demande sur son écran.
 */
export function AndroidRemoteGuide({ sessionId, call }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Config>(`/app/sessions/${sessionId}/android-remote`, null, 'GET')
      .then(setConfig)
      .catch(() => setUnavailable(true));
  }, [sessionId, call]);

  async function share(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(`/app/sessions/${sessionId}/android-remote`, { remotePeerId: peerId.replace(/\s/g, ''), remotePassword: password });
      setShared(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) return null;
  if (shared) {
    return <p className="mb-3 rounded-xl bg-green-50 p-3 text-sm font-medium text-green-800">✓ Le technicien peut se connecter. Acceptez la demande qui s’affiche sur votre écran. Pour tout arrêter, fermez RustDesk.</p>;
  }
  return (
    <details className="mb-3 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold">Laisser le technicien prendre la main sur mon téléphone</summary>
      <ol className="mt-3 list-decimal space-y-4 pl-5 text-sm text-slate-700">
        <li>
          Installez l’application gratuite <strong>RustDesk</strong> depuis le{' '}
          <a className="font-semibold underline" href="https://play.google.com/store/apps/details?id=com.carriez.flutter_hbb" target="_blank" rel="noreferrer">Play Store</a>.
        </li>
        <li>
          Dans RustDesk, ouvrez le menu ⋮ puis <strong>Serveur ID/Relais</strong> et collez ces deux valeurs, puis Valider.
          {config ? (
            <>
              <CopyField label="Serveur ID" value={config.idServer} />
              <CopyField label="Clé" value={config.key} />
            </>
          ) : (
            <span className="mt-1 block text-xs text-slate-500">Chargement…</span>
          )}
        </li>
        <li>Dans RustDesk, appuyez sur <strong>Démarrer le service</strong> et acceptez les autorisations demandées par Android (partage d’écran, accessibilité). Votre téléphone affiche alors un <strong>ID</strong> et un <strong>mot de passe</strong>.</li>
        <li>
          Recopiez-les ici :
          <form onSubmit={share} className="mt-2 space-y-2">
            <input className="ta-input" inputMode="numeric" placeholder="ID RustDesk (chiffres)" value={peerId} onChange={(e) => setPeerId(e.target.value)} required />
            <input className="ta-input" placeholder="Mot de passe affiché" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
            {error && <p className="text-xs font-medium text-brand-700">{error}</p>}
            <button className="ta-button-primary" disabled={busy || !peerId || !password}>{busy ? 'Envoi…' : 'Autoriser le technicien'}</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Ce mot de passe ne sert que pour cette assistance et n’est visible que par votre technicien. Vous devrez encore accepter la connexion sur votre écran.</p>
        </li>
      </ol>
    </details>
  );
}
