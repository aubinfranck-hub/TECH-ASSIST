/**
 * Scripts PowerShell remis dans un fichier .cmd (voir cmdLauncher.ts) : un pour le technicien (installer et régler son outil), un pour
 * le client (installer RustDesk, lire son identifiant, poser un mot de passe, prévenir le serveur). RustDesk doit être INSTALLÉ (service
 * Windows) : en mode portable, le mot de passe n'est pas appliqué.
 */

export interface WindowsTool {
  url: string;
  sha256: string;
}

const PRELUDE = [
  '$ErrorActionPreference = "Stop"',
  '$ProgressPreference = "SilentlyContinue"',
  '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
  '$dir = Join-Path $env:ProgramData "TechAssist\\rustdesk"',
  'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
  '$setup = Join-Path $dir "rustdesk-setup.exe"',
];

const INSTALL = [
  '$rd = Join-Path $env:ProgramFiles "RustDesk\\rustdesk.exe"',
  'if (-not (Test-Path $rd)) { Start-Process -FilePath $setup -ArgumentList "--silent-install" -Wait; for ($i = 0; $i -lt 30 -and -not (Test-Path $rd); $i++) { Start-Sleep -Seconds 2 } }',
];

const CONFIG_STRING = /^[A-Za-z0-9+/=]{20,2000}$/;

/** Format d'import de RustDesk : {host, relay, key, api} en base64, à l'envers. */
export function serverConfigString(server: { idServer: string; relayServer: string; key: string }): string {
  return btoa(JSON.stringify({ host: server.idServer, relay: server.relayServer, key: server.key, api: '' })).split('').reverse().join('');
}

/** Technicien : installe RustDesk et le règle sur le serveur Tech Assist, une seule fois. */
export function toolInstallerLines(cfg: { configString?: string; windows: WindowsTool }): string[] {
  if (cfg.configString && !CONFIG_STRING.test(cfg.configString)) throw new Error('Configuration invalide');
  return [
    ...PRELUDE,
    '$url = ' + JSON.stringify(cfg.windows.url),
    '$expected = ' + JSON.stringify(cfg.windows.sha256),
    'Write-Host "Tech Assist - installation de votre outil technicien (une minute environ)..."',
    '$ok = (Test-Path $setup) -and ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -eq $expected)',
    'if (-not $ok) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $setup }',
    'if ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -ne $expected) { Remove-Item $setup -Force; throw "Verification de l outil echouee." }',
    ...INSTALL,
    'if (-not (Test-Path $rd)) { throw "Installation impossible." }',
    ...(cfg.configString ? [`& $rd --config '${cfg.configString}' | Out-Null`] : []),
    'Write-Host ""',
    'Write-Host "Termine. Revenez sur la console : le bouton Ouvrir RustDesk fonctionne maintenant."',
  ];
}

const safeHost = (v: string) => /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(v);
const safeKey = (v: string) => /^[A-Za-z0-9+/=_-]{20,100}$/.test(v);

export interface ClientScriptInput {
  apiBase: string;
  sessionId: string;
  bootstrapToken: string;
  windows: WindowsTool;
  /** null : réseau public RustDesk (aucun serveur auto-hébergé). */
  rustdesk: { idServer: string; relayServer: string; key: string } | null;
}

/** Client : installe RustDesk, lit son identifiant, pose un mot de passe et prévient le serveur (l'appairage vaut accord). */
export function clientScriptLines(input: ClientScriptInput): string[] {
  const { rustdesk: server } = input;
  // Les valeurs viennent de notre API ; on refuse tout ce qui n'a pas la forme d'un nom de serveur ou d'une clé.
  if (server && !(safeHost(server.idServer) && safeHost(server.relayServer) && safeKey(server.key))) {
    throw new Error("Configuration du serveur d'assistance invalide. Contactez Tech Assist.");
  }
  const configString = server ? serverConfigString(server) : null;
  return [
    ...PRELUDE,
    '$url = ' + JSON.stringify(input.windows.url),
    '$expectedSha = ' + JSON.stringify(input.windows.sha256),
    '$apiBase = ' + JSON.stringify(input.apiBase),
    '$sessionId = ' + JSON.stringify(input.sessionId),
    '$token = ' + JSON.stringify(input.bootstrapToken),
    'Write-Host "Tech Assist - préparation de votre assistance (une minute environ)..."',
    '$ok = (Test-Path $setup) -and ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -eq $expectedSha)',
    'if (-not $ok) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $setup }',
    'if ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -ne $expectedSha) { Remove-Item $setup -Force; throw "Vérification de l’outil échouée." }',
    ...INSTALL,
    'if (-not (Test-Path $rd)) { throw "Installation de l’outil impossible." }',
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
    'Write-Host "Le technicien peut maintenant se connecter : cliquez sur Accepter dans la fenêtre RustDesk quand elle s’affiche."',
  ];
}
