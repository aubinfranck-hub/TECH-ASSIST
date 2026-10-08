import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

interface ToolConfig {
  custom: boolean;
  configString?: string;
  windows: { url: string; sha256: string; version: string };
}

/** Fichier .cmd qui installe RustDesk et le règle sur le serveur Tech Assist : le technicien n'a plus rien à configurer à la main. */
function downloadToolInstaller(cfg: ToolConfig): void {
  if (cfg.configString && !/^[A-Za-z0-9+/=]{20,2000}$/.test(cfg.configString)) throw new Error('Configuration invalide');
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$dir = Join-Path $env:ProgramData "TechAssist\\rustdesk"',
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    '$setup = Join-Path $dir "rustdesk-setup.exe"',
    '$url = ' + JSON.stringify(cfg.windows.url),
    '$expected = ' + JSON.stringify(cfg.windows.sha256),
    'Write-Host "Tech Assist - installation de votre outil technicien (une minute environ)..."',
    '$ok = (Test-Path $setup) -and ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -eq $expected)',
    'if (-not $ok) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $setup }',
    'if ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -ne $expected) { Remove-Item $setup -Force; throw "Verification de l outil echouee." }',
    '$rd = Join-Path $env:ProgramFiles "RustDesk\\rustdesk.exe"',
    'if (-not (Test-Path $rd)) { Start-Process -FilePath $setup -ArgumentList "--silent-install" -Wait; for ($i = 0; $i -lt 30 -and -not (Test-Path $rd); $i++) { Start-Sleep -Seconds 2 } }',
    'if (-not (Test-Path $rd)) { throw "Installation impossible." }',
    ...(cfg.configString ? [`& $rd --config '${cfg.configString}' | Out-Null`] : []),
    'Write-Host ""',
    'Write-Host "Termine. Revenez sur la console : le bouton Ouvrir RustDesk fonctionne maintenant."',
  ];
  const launcher = [
    '@echo off',
    'net session >nul 2>&1',
    'if %errorlevel% neq 0 (',
    '  powershell -NoProfile -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"',
    '  exit /b',
    ')',
    'set "TA_SELF=%~f0"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $f = Get-Content -LiteralPath $env:TA_SELF -Raw -Encoding UTF8; iex $f.Substring($f.IndexOf(\'#PS#\') + 4) } catch { Write-Host (\'ERREUR : \' + $_.Exception.Message) -ForegroundColor Red }"',
    'pause',
    'exit /b',
  ];
  const blob = new Blob([[...launcher, '#PS#', ...lines].join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'TechAssist-Outil-Technicien.cmd';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
