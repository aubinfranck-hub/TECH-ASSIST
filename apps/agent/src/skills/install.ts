import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, readScript, runScript, tracked } from './common.js';

/**
 * Installation d'un logiciel. Catalogue FERMÉ : l'identifiant winget vient de cette liste, jamais d'un texte libre.
 * Source unique « winget » (dépôt officiel de Microsoft). Les licences payantes (Office…) ne sont pas dans la liste.
 */

export interface CatalogApp {
  key: string;
  label: string;
  wingetId: string;
  /** Mots (sans accents, minuscules) par lesquels le client désigne le logiciel. */
  keywords?: string[];
}

export const INSTALL_CATALOG: readonly CatalogApp[] = [
  { key: 'chrome', keywords: ['chrome', 'google chrome'], label: 'Google Chrome', wingetId: 'Google.Chrome' },
  { key: 'firefox', keywords: ['firefox'], label: 'Mozilla Firefox', wingetId: 'Mozilla.Firefox' },
  { key: '7zip', keywords: ['7zip', '7-zip', 'winrar', 'zip'], label: '7-Zip (fichiers compressés)', wingetId: '7zip.7zip' },
  { key: 'vlc', keywords: ['vlc'], label: 'VLC (vidéo et musique)', wingetId: 'VideoLAN.VLC' },
  { key: 'acrobat', keywords: ['acrobat', 'adobe reader', 'lecteur pdf'], label: 'Adobe Acrobat Reader (PDF)', wingetId: 'Adobe.Acrobat.Reader.64-bit' },
  { key: 'libreoffice', keywords: ['libreoffice', 'libre office'], label: 'LibreOffice (bureautique gratuite)', wingetId: 'TheDocumentFoundation.LibreOffice' },
  { key: 'notepadpp', keywords: ['notepad++', 'notepad'], label: 'Notepad++', wingetId: 'Notepad++.Notepad++' },
  { key: 'zoom', keywords: ['zoom'], label: 'Zoom (visioconférence)', wingetId: 'Zoom.Zoom' },
];

export function findApp(key: string): CatalogApp | undefined {
  return INSTALL_CATALOG.find((a) => a.key === key);
}

export interface InstallFacts {
  wingetAvailable: boolean;
  installed: boolean;
}

/** Lecture seule : winget est-il présent, le logiciel est-il déjà installé ? (code de sortie de « winget list », pas de texte) */
export function installCollectScript(app: CatalogApp): string {
  if (!findApp(app.key) || findApp(app.key)!.wingetId !== app.wingetId) throw new Error('Logiciel hors catalogue');
  return guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$winget = [bool](Get-Command winget.exe)
$installed = $false
if ($winget) {
  winget.exe list --id ${app.wingetId} --exact --source winget --accept-source-agreements | Out-Null
  $installed = ($LASTEXITCODE -eq 0)
}
[pscustomobject]@{ wingetAvailable = $winget; installed = $installed } | ConvertTo-Json -Compress
`);
}

export function parseInstallFacts(stdout: string): InstallFacts {
  const raw = extractJson(stdout);
  return { wingetAvailable: raw.wingetAvailable === true, installed: raw.installed === true };
}

const installAction = (app: CatalogApp): Action => ({
  id: 'install_app',
  title: `Installer ${app.label}`,
  explanation: `J'installe ${app.label} depuis le dépôt officiel de Microsoft (winget). Une connexion Internet est nécessaire ; cela peut durer quelques minutes. Rien d'autre n'est installé et vos fichiers ne sont pas touchés. Pour le retirer plus tard : Paramètres > Applications.`,
  requiresAdmin: true,
  verified: true,
  run: (runner) =>
    runScript(
      runner,
      guarded(`winget.exe install --id ${app.wingetId} --exact --source winget --silent --accept-package-agreements --accept-source-agreements | Out-Null\nif ($LASTEXITCODE -ne 0) { throw "L'installation a échoué (code $LASTEXITCODE)." }\nWrite-Output 'OK'`),
      20 * 60_000,
    ),
});

export function diagnoseInstall(app: CatalogApp, f: InstallFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  if (!f.wingetAvailable) {
    return { summary: "L'outil d'installation de Windows (winget) n'est pas disponible sur cet ordinateur.", problems: ['no_winget'], actions: [], advice: ["Installez « Programme d'installation d'applications » depuis le Microsoft Store, puis redemandez."], healthy: false, needsHuman: true };
  }
  if (f.installed) return { summary: `${app.label} est installé.`, problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
  if (tried.has('install_app')) return { summary: `${app.label} n'apparaît toujours pas comme installé.`, problems: ['install_failed'], actions: [], advice: [], healthy: false, needsHuman: true };
  return { summary: `${app.label} n'est pas installé.`, problems: ['not_installed'], actions: [installAction(app)], advice: [], healthy: false, needsHuman: false };
}

export function installSkill(key: string): Skill {
  const app = findApp(key);
  if (!app) throw new Error('Logiciel hors catalogue');
  const script = installCollectScript(app);
  const tried = new Set<string>();
  return {
    id: 'install',
    title: `Installer ${app.label}`,
    verifyQuestion: `${app.label} s'ouvre-t-il correctement ?`,
    async diagnose(runner) {
      const d = diagnoseInstall(app, parseInstallFacts(await readScript(runner, script, "La vérification de l'installation", 60_000)), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
