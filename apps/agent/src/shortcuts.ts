import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Installation « douce » au premier lancement : l'exécutable se copie dans le dossier de l'utilisateur
 * (%LOCALAPPDATA%\TechAssist, aucun droit administrateur) et crée un raccourci « Tech Assist » avec son icône
 * sur le Bureau et dans le menu Démarrer. Ainsi l'application ne dépend plus du dossier Téléchargements, se
 * retrouve facilement, et se met à jour toute seule. Une seule fois : si le client supprime le raccourci, il ne revient pas.
 * Jamais bloquant : toute erreur est ignorée.
 */

export interface ShortcutDeps {
  platform?: string;
  exePath?: string;
  version?: string;
  env?: NodeJS.ProcessEnv;
  /** Création des raccourcis (remplaçable dans les tests). */
  makeLinks?: (target: string, workDir: string) => Promise<void>;
}

export type ShortcutResult = { status: 'skipped'; reason: string } | { status: 'installed'; target: string };

const MARKER = 'raccourcis.ok';
const TECHNICIAN_EXE = /^tech-assist-technicien\.exe$/i;

const LINK_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
foreach ($d in $dirs) {
  if (-not $d -or -not (Test-Path $d)) { continue }
  $lnk = $ws.CreateShortcut((Join-Path $d ($env:TA_NAME + '.lnk')))
  $lnk.TargetPath = $env:TA_TARGET
  $lnk.WorkingDirectory = $env:TA_WORKDIR
  $lnk.IconLocation = $env:TA_TARGET + ',0'
  $lnk.Description = $env:TA_DESCRIPTION
  $lnk.Save()
}
`;

function defaultMakeLinks(target: string, workDir: string): Promise<void> {
  const technician = TECHNICIAN_EXE.test(basename(target));
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LINK_SCRIPT],
      { env: { ...process.env, TA_TARGET: target, TA_WORKDIR: workDir, TA_NAME: technician ? 'Tech Assist Technicien' : 'Tech Assist', TA_DESCRIPTION: technician ? 'Tech Assist - espace technicien (alertes en direct)' : 'Tech Assist - votre technicien informatique' }, timeout: 15_000, windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function installShortcuts(deps: ShortcutDeps = {}): Promise<ShortcutResult> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const exePath = deps.exePath ?? process.execPath;
  const version = deps.version ?? 'dev';
  if (platform !== 'win32') return { status: 'skipped', reason: 'pas Windows' };
  if (!/^\d+(\.\d+)+$/.test(version)) return { status: 'skipped', reason: 'version de développement' };
  if (env.TECH_ASSIST_NO_SHORTCUT === '1') return { status: 'skipped', reason: 'désactivé' };
  const name = basename(exePath);
  if (!/^tech-assist-(agent(-console)?|technicien)\.exe$/i.test(name)) return { status: 'skipped', reason: 'exécutable inattendu' };
  const base = env.LOCALAPPDATA;
  if (!base) return { status: 'skipped', reason: 'dossier utilisateur introuvable' };

  const installDir = join(base, 'TechAssist');
  const marker = join(installDir, TECHNICIAN_EXE.test(name) ? 'raccourcis-technicien.ok' : MARKER);
  try {
    if (await exists(marker)) return { status: 'skipped', reason: 'déjà fait' };
    await mkdir(installDir, { recursive: true });
    const target = join(installDir, name);
    // Déjà lancé depuis le dossier d'installation : rien à copier. Sinon on copie (sans écraser une version déjà installée, qui se met à jour seule).
    if (dirname(exePath).toLowerCase() !== installDir.toLowerCase() && !(await exists(target))) await copyFile(exePath, target);
    await (deps.makeLinks ?? defaultMakeLinks)(target, installDir);
    await writeFile(marker, new Date().toISOString());
    return { status: 'installed', target };
  } catch (err) {
    return { status: 'skipped', reason: err instanceof Error ? err.message : 'erreur' };
  }
}
