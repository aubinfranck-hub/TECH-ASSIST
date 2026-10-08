import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

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
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
    const server = bootstrap.rustdesk;
    // Les valeurs viennent de notre API ; on refuse tout ce qui n'a pas la forme d'un nom de serveur ou d'une clé.
    const safeHost = (v: string) => /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(v);
    const safeKey = (v: string) => /^[A-Za-z0-9+/=_-]{20,100}$/.test(v);
    if (server && !(safeHost(server.idServer) && safeHost(server.relayServer) && safeKey(server.key))) {
      setError("Configuration du serveur d'assistance invalide. Contactez Tech Assist.");
      return;
    }
    // Format d'import de RustDesk : {host, relay, key, api} en base64, à l'envers.
    const configString = server
      ? btoa(JSON.stringify({ host: server.idServer, relay: server.relayServer, key: server.key, api: '' })).split('').reverse().join('')
      : null;
    // RustDesk doit être INSTALLÉ (service Windows) : en mode portable, le mot de passe n'est pas appliqué.
    const lines = [
      '$ErrorActionPreference = "Stop"',
      '$ProgressPreference = "SilentlyContinue"',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
      '$dir = Join-Path $env:ProgramData "TechAssist\\rustdesk"',
      'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
      '$setup = Join-Path $dir "rustdesk-setup.exe"',
      '$url = ' + JSON.stringify(bootstrap.windows.url),
      '$expectedSha = ' + JSON.stringify(bootstrap.windows.sha256),
      '$apiBase = ' + JSON.stringify(apiBase),
      '$sessionId = ' + JSON.stringify(bootstrap.sessionId),
      '$token = ' + JSON.stringify(bootstrap.bootstrapToken),
      'Write-Host "Tech Assist - préparation de votre assistance (une minute environ)..."',
      '$ok = (Test-Path $setup) -and ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -eq $expectedSha)',
      'if (-not $ok) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $setup }',
      'if ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -ne $expectedSha) { Remove-Item $setup -Force; throw "Vérification de l\u2019outil échouée." }',
      '$rd = Join-Path $env:ProgramFiles "RustDesk\\rustdesk.exe"',
      'if (-not (Test-Path $rd)) { Start-Process -FilePath $setup -ArgumentList "--silent-install" -Wait; for ($i = 0; $i -lt 30 -and -not (Test-Path $rd); $i++) { Start-Sleep -Seconds 2 } }',
      'if (-not (Test-Path $rd)) { throw "Installation de l\u2019outil impossible." }',
      'Start-Service -Name "RustDesk" -ErrorAction SilentlyContinue',
      'Start-Sleep -Seconds 3',
      ...(configString ? [`& $rd --config '${configString}' | Out-Null`, 'Start-Sleep -Seconds 2'] : []),
      'if (-not (Get-Process -Name "rustdesk" -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -ne 0 })) { Start-Process -FilePath $rd }',
      '$id = ""',
      'for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 2; $id = ((& $rd --get-id | Out-String).Trim()); if ($id -match "^\\d{6,12}$") { break } }',
      'if ($id -notmatch "^\\d{6,12}$") { throw "Connexion sécurisée impossible." }',
      '$bytes = New-Object byte[] 9; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $password = ([Convert]::ToBase64String($bytes) -replace "[^A-Za-z0-9]", "").PadRight(8, "k").Substring(0,8)',
      '$out = (& $rd --password $password | Out-String)',
      'if ($out -match "required|denied|disabled|error") { throw ("Mot de passe non appliqué : " + $out.Trim()) }',
      '& $rd --option approve-mode password-click | Out-Null',
      '& $rd --option verification-method use-permanent-password | Out-Null',
      '$payload = @{ remotePeerId = $id; remotePassword = $password; bootstrapToken = $token } | ConvertTo-Json -Compress',
      'Invoke-RestMethod -Uri "$apiBase/api/sessions/$sessionId/pair" -Method Post -ContentType "application/json" -Body $payload | Out-Null',
      'Write-Host ""',
      'Write-Host "Tech Assist est prêt. Connexion sécurisée établie."',
      'Write-Host "Le technicien pourra se connecter après votre consentement."',
    ];
    // Un .ps1 s'ouvre dans le Bloc-notes ou est bloqué par Windows : on télécharge un .cmd qui se relance en administrateur
    // (nécessaire pour installer RustDesk) puis exécute le script lui-même.
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
    const content = [...launcher, '#PS#', ...lines];
    const blob = new Blob([content.join("\r\n")], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TechAssist-Connexion.cmd';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
