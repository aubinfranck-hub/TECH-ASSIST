import { randomBytes } from 'node:crypto';
import type { CommandRunner, ConversationUi } from './types.js';

/**
 * Partage de l'écran avec le technicien. Après un passage de main, et SEULEMENT si le client l'accepte, l'agent prépare
 * RustDesk sur le PC (client officiel, version et empreinte épinglées ICI : le serveur ne dit jamais quoi télécharger ou
 * exécuter), puis envoie au serveur l'identifiant et un mot de passe à usage unique. Le technicien les reçoit une fois la
 * session prise en charge. À chaque connexion, RustDesk demande au client de cliquer « Accepter ».
 */
export const RUSTDESK_WINDOWS = {
  version: '1.4.9',
  url: 'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe',
  sha256: 'eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274',
} as const;

export interface RemoteSettings {
  /** false : réseau public RustDesk (aucun serveur auto-hébergé côté Tech Assist). */
  custom: boolean;
  idServer?: string;
  relayServer?: string;
  key?: string;
}

export interface Remote {
  settings(): Promise<RemoteSettings | { error: 'not_included' | 'unavailable' }>;
  share(peerId: string, password: string): Promise<boolean>;
}

const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
const KEY = /^[A-Za-z0-9+/=_-]{20,100}$/;

/** Les réglages viennent du réseau : rien n'entre dans un script sans avoir la forme attendue. */
export function checkSettings(raw: unknown): RemoteSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.custom === false) return { custom: false };
  if (r.custom !== true) return null;
  const { idServer, relayServer, key } = r;
  if (typeof idServer !== 'string' || typeof relayServer !== 'string' || typeof key !== 'string') return null;
  if (!HOST.test(idServer) || !HOST.test(relayServer) || !KEY.test(key)) return null;
  return { custom: true, idServer, relayServer, key };
}

export function newPassword(): string {
  return randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10).padEnd(10, 'k');
}

/**
 * Chaîne de configuration au format d'import/`--config` de RustDesk : JSON {host, relay, key, api} en base64, à l'envers.
 * C'est ce que le menu « Réseau » de RustDesk exporte et importe.
 */
export function encodeServerConfig(s: { idServer: string; relayServer: string; key: string }): string {
  const json = JSON.stringify({ host: s.idServer, relay: s.relayServer, key: s.key, api: '' });
  return Buffer.from(json, 'utf8').toString('base64').split('').reverse().join('');
}

/**
 * Script PowerShell (écrit par nous). RustDesk doit être INSTALLÉ (service Windows) et lancé en administrateur : en mode
 * « portable », `--password` n'est pas appliqué et le technicien recevrait un mot de passe qui ne correspond à rien.
 * Étapes : télécharger et vérifier → installer en silence → régler le serveur → lire l'identifiant → poser le mot de passe → vérifier.
 */
export function buildPrepareScript(settings: RemoteSettings, password: string): string {
  if (!/^[A-Za-z0-9]{8,64}$/.test(password)) throw new Error('mot de passe invalide');
  const config = settings.custom
    ? `& $rd --config '${encodeServerConfig({ idServer: settings.idServer!, relayServer: settings.relayServer!, key: settings.key! })}' | Out-Null
Start-Sleep -Seconds 2
`
    : '';
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'ADMIN_REQUIRED' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $env:ProgramData 'TechAssist\\rustdesk'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$setup = Join-Path $dir 'rustdesk-setup.exe'
$expected = '${RUSTDESK_WINDOWS.sha256}'
$ok = (Test-Path $setup) -and ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -eq $expected)
if (-not $ok) {
  Invoke-WebRequest -UseBasicParsing -Uri '${RUSTDESK_WINDOWS.url}' -OutFile $setup
  if ((Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLowerInvariant() -ne $expected) { Remove-Item $setup -Force; throw 'Verification de l outil echouee' }
}
$rd = Join-Path $env:ProgramFiles 'RustDesk\\rustdesk.exe'
if (-not (Test-Path $rd)) {
  Start-Process -FilePath $setup -ArgumentList '--silent-install' -Wait
  for ($i = 0; $i -lt 30 -and -not (Test-Path $rd); $i++) { Start-Sleep -Seconds 2 }
}
if (-not (Test-Path $rd)) { throw 'Installation de l outil impossible' }
Start-Service -Name 'RustDesk' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
${config}if (-not (Get-Process -Name 'rustdesk' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -ne 0 })) { Start-Process -FilePath $rd }
$id = ''
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  $id = ((& $rd --get-id | Out-String).Trim())
  if ($id -match '^\\d{6,12}$') { break }
}
if ($id -notmatch '^\\d{6,12}$') { throw 'Identifiant introuvable' }
$out = (& $rd --password '${password}' | Out-String)
if ($out -match 'required|denied|disabled|error') { throw ('Mot de passe non applique : ' + $out.Trim()) }
& $rd --option approve-mode password-click | Out-Null
& $rd --option verification-method use-permanent-password | Out-Null
Write-Output ('TECHASSIST_ID=' + $id)
`;
}

export function parsePeerId(stdout: string): string | null {
  return /TECHASSIST_ID=(\d{6,12})/.exec(stdout)?.[1] ?? null;
}

export const SHARE_OFFER =
  "Pour que le technicien puisse voir votre écran et vous aider directement, je peux préparer une connexion sécurisée (outil RustDesk). Il ne pourra se connecter qu'après sa prise en charge, et à chaque connexion votre ordinateur affichera une fenêtre où VOUS cliquez « Accepter ». Vous pouvez l'arrêter à tout moment.";

export type ShareResult = 'shared' | 'declined' | 'not_included' | 'failed';

export async function shareScreen(deps: { ui: Pick<ConversationUi, 'info' | 'choose'>; runner: CommandRunner; remote: Remote; password?: () => string }): Promise<ShareResult> {
  const { ui, runner, remote } = deps;
  const settings = await remote.settings();
  if ('error' in settings) {
    if (settings.error === 'not_included') return 'not_included';
    ui.info("Le partage d'écran n'est pas disponible pour le moment : le technicien vous guidera par la discussion.");
    return 'failed';
  }
  const checked = checkSettings(settings);
  if (!checked) {
    ui.info("Le partage d'écran n'est pas disponible pour le moment : le technicien vous guidera par la discussion.");
    return 'failed';
  }

  ui.info(SHARE_OFFER);
  const pick = await ui.choose("Autorisez-vous le technicien à voir votre écran ?", ["Oui, préparer la connexion", "Non, seulement par la discussion"]);
  if (pick !== 0) {
    ui.info("D'accord : le technicien vous guidera par la discussion, sans voir votre écran.");
    return 'declined';
  }

  ui.info("Je prépare la connexion (téléchargement et vérification de l'outil, une minute environ)…");
  const password = (deps.password ?? newPassword)();
  try {
    const run = await runner.runPowerShell(buildPrepareScript(checked, password), { timeoutMs: 180_000 });
    const peerId = parsePeerId(run.stdout);
    if (run.exitCode !== 0 || !peerId) {
      if (/ADMIN_REQUIRED/.test(run.stderr)) {
        ui.info("Il faut les droits administrateur pour préparer le partage d'écran. Relancez Tech Assist en choisissant « J'ai le mot de passe administrateur », ou laissez le technicien vous guider par la discussion.");
        return 'failed';
      }
      throw new Error(run.stderr.trim().slice(0, 200) || 'préparation impossible');
    }
    if (!(await remote.share(peerId, password))) throw new Error("le serveur n'a pas enregistré la connexion");
    ui.info("Connexion prête. Quand le technicien se connectera, une fenêtre RustDesk peut s'afficher : cliquez sur « Accepter » pour qu'il voie votre écran.");
    return 'shared';
  } catch (err) {
    console.error(`[partage d'écran] ${err instanceof Error ? err.message : String(err)}`);
    ui.info("Je n'ai pas réussi à préparer le partage d'écran. Ce n'est pas grave : le technicien vous guidera par la discussion.");
    return 'failed';
  }
}

/** Partage d'écran via l'API Tech Assist. */
export class HttpRemote implements Remote {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string): string {
    return `${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}${path}`;
  }

  async settings(): Promise<RemoteSettings | { error: 'not_included' | 'unavailable' }> {
    try {
      const res = await this.fetchImpl(this.url('/remote-config'), { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 402) return { error: 'not_included' };
      if (!res.ok) return { error: 'unavailable' };
      return checkSettings(await res.json()) ?? { error: 'unavailable' };
    } catch {
      return { error: 'unavailable' };
    }
  }

  async share(peerId: string, password: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url('/remote'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ remotePeerId: peerId, remotePassword: password }),
        signal: AbortSignal.timeout(20_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
