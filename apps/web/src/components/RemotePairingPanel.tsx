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
  rustdesk: { idServer: string; relayServer: string; key: string };
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
    const lines = [
      '$ErrorActionPreference = "Stop"',
      '$ProgressPreference = "SilentlyContinue"',
      '$dir = Join-Path $env:TEMP "TechAssist-RustDesk"',
      'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
      '$exe = Join-Path $dir "TechAssist-RustDesk.exe"',
      '$url = ' + JSON.stringify(bootstrap.windows.url),
      '$expectedSha = ' + JSON.stringify(bootstrap.windows.sha256),
      '$apiBase = ' + JSON.stringify(apiBase),
      '$sessionId = ' + JSON.stringify(bootstrap.sessionId),
      '$token = ' + JSON.stringify(bootstrap.bootstrapToken),
      '$idServer = ' + JSON.stringify(bootstrap.rustdesk.idServer),
      '$relayServer = ' + JSON.stringify(bootstrap.rustdesk.relayServer),
      '$key = ' + JSON.stringify(bootstrap.rustdesk.key),
      'Write-Host "Tech Assist - préparation de votre assistance..."',
      'Invoke-WebRequest -Uri $url -OutFile $exe',
      '$sha = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLowerInvariant()',
      'if ($sha -ne $expectedSha) { Remove-Item $exe -Force; throw "Empreinte RustDesk invalide." }',
      '$cfgDir = Join-Path $env:APPDATA "RustDesk\config"',
      'New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null',
      '$cfg = Join-Path $cfgDir "RustDesk2.toml"',
      '$lines = @(',
      '  "rendezvous_server = ''{0}:21116''" -f $idServer',
      '  "nat_type = 1"',
      '  "serial = 0"',
      '  ""',
      '  "[options]"',
      '  "custom-rendezvous-server = ''{0}''" -f $idServer',
      '  "relay-server = ''{0}''" -f $relayServer',
      '  "key = ''{0}''" -f $key',
      '  "approve-mode = ''password-click''"',
      '  "verification-method = ''use-permanent-password''"',
      '  "allow-only-conn-window-open = ''Y''"',
      ')',
      '$lines | Set-Content -Path $cfg -Encoding UTF8',
      'Start-Process -FilePath $exe',
      'Start-Sleep -Seconds 8',
      '$id = (& $exe --get-id | Out-String).Trim()',
      'if (-not $id) { throw "Impossible de récupérer l''ID RustDesk." }',
      '$bytes = New-Object byte[] 9; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $password = ([Convert]::ToBase64String($bytes) -replace "[^A-Za-z0-9]", "").Substring(0,8)',
      '& $exe --password $password | Out-Null',
      '$payload = @{ remotePeerId = $id; remotePassword = $password; bootstrapToken = $token } | ConvertTo-Json -Compress',
      'Invoke-RestMethod -Uri "$apiBase/api/sessions/$sessionId/pair" -Method Post -ContentType "application/json" -Body $payload | Out-Null',
      'Write-Host ""',
      'Write-Host "Tech Assist est prêt. ID RustDesk :" $id',
      'Write-Host "Le technicien pourra se connecter après votre consentement."',
      'Read-Host "Appuyez sur Entrée pour fermer"',
    ];
    const blob = new Blob([lines.join("\r\n")], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TechAssist-Connexion.ps1';
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
        <p className="ta-eyebrow">Connexion sécurisée</p>
        <h2 className="mt-1 text-lg font-black text-slate-950">Préparer mon ordinateur</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Plus besoin de saisir le serveur, la clé ou l'ID RustDesk. Tech Assist prépare automatiquement la connexion.
        </p>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <button type="button" onClick={downloadAndRun} disabled={!bootstrap} className="ta-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50">
          {!bootstrap ? 'Préparation…' : 'Télécharger l’outil Tech Assist'}
        </button>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500">
          <p className="font-semibold text-slate-800">1 clic</p>
          <p className="mt-1">L’outil configure automatiquement le serveur Tech Assist, démarre RustDesk et transmet l’ID et le mot de passe de session.</p>
        </div>
        <button type="button" onClick={() => setManual((v) => !v)} className="text-sm font-semibold text-slate-600 hover:text-brand-700">
          {manual ? 'Masquer la configuration manuelle' : 'Je préfère configurer manuellement'}
        </button>
        {manual && (
          <form onSubmit={submitManual} className="grid gap-3 sm:grid-cols-2">
            <input required placeholder="ID RustDesk" value={peerId} onChange={(e) => setPeerId(e.target.value)} className="ta-input" />
            <input required placeholder="Mot de passe temporaire" value={password} onChange={(e) => setPassword(e.target.value)} className="ta-input" />
            {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={submitting || !bootstrap} className="ta-button-primary sm:col-span-2 disabled:opacity-50">
              {submitting ? 'Appairage…' : "Confirmer l'appairage"}
            </button>
          </form>
        )}
        {error && !manual && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
