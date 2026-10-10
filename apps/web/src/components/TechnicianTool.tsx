import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { downloadCmd } from '../lib/cmdLauncher.js';
import { toolInstallerLines } from '../lib/rustdeskScripts.js';

interface ToolConfig {
  custom: boolean;
  configString?: string;
  windows: { url: string; sha256: string; version: string };
}

/** Fichier .cmd qui installe RustDesk et le règle sur le serveur Tech Assist : le technicien n'a plus rien à configurer à la main. */
function downloadToolInstaller(cfg: ToolConfig): void {
  downloadCmd('TechAssist-Outil-Technicien.cmd', toolInstallerLines(cfg));
}

/** Installation de l'outil de prise en main, une seule fois. */
export function TechnicianTool() {
  const [cfg, setCfg] = useState<ToolConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<ToolConfig>('/api/technician/remote-config').then(setCfg).catch(() => undefined);
  }, []);
  if (!cfg) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <p className="font-semibold text-slate-900">Mon outil de prise en main</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">À installer <strong>une seule fois</strong> sur votre ordinateur. Ensuite, le bouton « Ouvrir RustDesk et voir l'écran » ouvre directement l'écran du client.</p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          try {
            downloadToolInstaller(cfg);
          } catch (e) {
            setError(e instanceof ApiError || e instanceof Error ? e.message : 'Téléchargement impossible.');
          }
        }}
        className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
      >
        Installer mon outil (Windows)
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold">Le navigateur bloque le fichier ? Faites-le à la main (2 minutes)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Installez RustDesk : <a href="https://rustdesk.com" target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">rustdesk.com</a>.</li>
          <li>
            Copiez la configuration de notre serveur :{' '}
            {cfg.configString ? (
              <button type="button" onClick={() => void navigator.clipboard?.writeText(cfg.configString!)} className="font-bold text-brand-700 underline">Copier la configuration</button>
            ) : (
              <span>aucune à copier : le réseau public suffit.</span>
            )}
          </li>
          <li>Dans RustDesk : menu ⋮ → Réseau → « Importer la configuration du serveur » (le presse-papiers).</li>
        </ol>
      </details>
    </div>
  );
}

/** Comme AnyDesk : le client donne son numéro d'aide, le technicien le tape ici. */
export function ByCodeBox({ onFound }: { onFound: (sessionId: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = code.replace(/\D/g, '');
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (digits.length !== 9) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string }>('/api/technician/sessions/by-code', { code: digits });
      onFound(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Numéro introuvable. Réessayez.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={go} className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
      <p className="font-black text-slate-950">Se connecter à un client</p>
      <p className="mt-1 text-sm text-slate-600">Le client vous donne son <strong>numéro d'aide</strong> (affiché en haut de son application). Tapez-le ici.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="123 456 789"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))}
          className="ta-input flex-1 text-center font-mono text-xl tracking-[0.2em]"
          aria-label="Numéro d'aide du client"
        />
        <button disabled={busy || digits.length !== 9} className="ta-button-primary !w-auto px-6 disabled:opacity-50">{busy ? 'Recherche…' : 'Se connecter'}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </form>
  );
}
