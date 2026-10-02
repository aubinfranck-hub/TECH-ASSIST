import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, formatBytes, guarded, nonNegative, readScript, runScript, tracked } from './common.js';

/**
 * Nettoyage : fichiers temporaires, cache des navigateurs, corbeille, composants Windows.
 * Ne touche jamais aux documents, images, courriers, mots de passe ni cookies.
 */

export interface CleanupFacts {
  tempBytes: number;
  windowsTempBytes: number;
  browserCacheBytes: number;
  recycleBytes: number;
  freeBytes: number | null;
  totalBytes: number | null;
  admin: boolean | null;
}

/** Lecture seule : tailles des dossiers temporaires, caches et corbeille ; espace libre du disque Windows. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Get-FolderSize([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return [double]0 }
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum
  if ($sum) { return [double]$sum } else { return [double]0 }
}
$temp = Get-FolderSize $env:TEMP
$winTemp = Get-FolderSize (Join-Path $env:windir 'Temp')
$browsers = 0
foreach ($rel in @('Google\Chrome\User Data\Default\Cache', 'Microsoft\Edge\User Data\Default\Cache', 'BraveSoftware\Brave-Browser\User Data\Default\Cache')) {
  $browsers += Get-FolderSize (Join-Path $env:LOCALAPPDATA $rel)
}
$recycle = 0
try { foreach ($i in (New-Object -ComObject Shell.Application).NameSpace(0xA).Items()) { $recycle += [double]$i.Size } } catch { }
$vol = Get-Volume -DriveLetter ($env:SystemDrive.Substring(0, 1))
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ tempBytes = $temp; windowsTempBytes = $winTemp; browserCacheBytes = $browsers; recycleBytes = $recycle; freeBytes = [double]$vol.SizeRemaining; totalBytes = [double]$vol.Size; admin = $admin } | ConvertTo-Json -Compress
`);

export function parseCleanupFacts(stdout: string): CleanupFacts {
  const raw = extractJson(stdout);
  return {
    tempBytes: nonNegative(raw.tempBytes) ?? 0,
    windowsTempBytes: nonNegative(raw.windowsTempBytes) ?? 0,
    browserCacheBytes: nonNegative(raw.browserCacheBytes) ?? 0,
    recycleBytes: nonNegative(raw.recycleBytes) ?? 0,
    freeBytes: nonNegative(raw.freeBytes),
    totalBytes: nonNegative(raw.totalBytes),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const MB = 1024 ** 2;
/** En dessous, le nettoyage n'apporterait rien : on ne dérange pas le client. */
const WORTH_CLEANING = 300 * MB;

const cleanTempAction = (bytes: number): Action => ({
  id: 'clean_temp',
  title: 'Supprimer les fichiers temporaires',
  explanation: `Je supprime les fichiers temporaires de Windows et des programmes (environ ${formatBytes(bytes)}), seulement ceux de plus d'un jour. Ce sont des copies de travail sans valeur : vos documents, photos et courriers ne sont pas touchés. Les fichiers en cours d'utilisation sont ignorés.`,
  requiresAdmin: false,
  verified: true,
  run: (runner) =>
    runScript(
      runner,
      guarded(String.raw`$ErrorActionPreference = 'SilentlyContinue'
$limit = (Get-Date).AddDays(-1)
foreach ($dir in @($env:TEMP, (Join-Path $env:windir 'Temp'))) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Recurse -Force -File | Where-Object { $_.LastWriteTime -lt $limit } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
}
Write-Output 'OK'`),
      10 * 60_000,
    ),
});

const browserCacheAction = (bytes: number): Action => ({
  id: 'clear_browser_cache',
  title: 'Vider le cache des navigateurs',
  explanation: `Je vide le cache de Chrome, Edge et Brave (environ ${formatBytes(bytes)}) : ce sont des copies de pages déjà visitées. Vos mots de passe, favoris, historique et connexions aux sites sont conservés. Fermez d'abord les navigateurs ; les sites seront un peu plus lents à la première visite.`,
  requiresAdmin: false,
  verified: true,
  run: (runner) =>
    runScript(
      runner,
      guarded(String.raw`$ErrorActionPreference = 'SilentlyContinue'
foreach ($rel in @('Google\Chrome\User Data\Default\Cache', 'Microsoft\Edge\User Data\Default\Cache', 'BraveSoftware\Brave-Browser\User Data\Default\Cache')) {
  $dir = Join-Path $env:LOCALAPPDATA $rel
  if (Test-Path -LiteralPath $dir) { Get-ChildItem -LiteralPath $dir -Recurse -Force -File | Remove-Item -Force -ErrorAction SilentlyContinue }
}
Write-Output 'OK'`),
      5 * 60_000,
    ),
});

const emptyRecycleAction = (bytes: number): Action => ({
  id: 'empty_recycle_bin',
  title: 'Vider la corbeille',
  explanation: `La corbeille contient environ ${formatBytes(bytes)} de fichiers supprimés. Je la vide : ces fichiers ne pourront PLUS être récupérés. Vérifiez qu'il n'y manque rien d'important, sinon refusez.`,
  requiresAdmin: false,
  verified: true,
  run: (runner) => runScript(runner, guarded(`Clear-RecycleBin -Force -ErrorAction Stop\nWrite-Output 'OK'`), 5 * 60_000),
});

const componentCleanupAction = (): Action => ({
  id: 'component_cleanup',
  title: 'Nettoyer les anciens composants Windows',
  explanation:
    "Windows garde d'anciennes versions de ses composants après chaque mise à jour. Je supprime celles qui ne servent plus (outil officiel Microsoft). Cela peut durer plusieurs minutes ; vos fichiers ne sont pas touchés. Après cela, on ne peut plus désinstaller les mises à jour déjà installées.",
  requiresAdmin: true,
  verified: true,
  run: (runner) =>
    runScript(
      runner,
      guarded(`Dism.exe /Online /Cleanup-Image /StartComponentCleanup | Out-Null\nif ($LASTEXITCODE -ne 0) { throw "Le nettoyage des composants Windows a échoué." }\nWrite-Output 'OK'`),
      30 * 60_000,
    ),
});

/** Fonction pure. `tried` : actions déjà lancées (le nettoyage des composants n'est proposé qu'en dernier recours, sur disque presque plein). */
export function diagnoseCleanup(facts: CleanupFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const actions: Action[] = [];
  const problems: string[] = [];
  const advice: string[] = [];
  const temp = facts.tempBytes + facts.windowsTempBytes;
  const reclaimable = temp + facts.browserCacheBytes + facts.recycleBytes;
  const freeRatio = facts.freeBytes !== null && facts.totalBytes ? facts.freeBytes / facts.totalBytes : null;
  const low = freeRatio !== null && freeRatio < 0.15;

  if (temp >= 100 * MB) actions.push(cleanTempAction(temp));
  if (facts.browserCacheBytes >= 100 * MB) actions.push(browserCacheAction(facts.browserCacheBytes));
  if (facts.recycleBytes >= 100 * MB) actions.push(emptyRecycleAction(facts.recycleBytes));
  const worth = reclaimable >= WORTH_CLEANING || (low && reclaimable >= 100 * MB);
  if (worth) problems.push('reclaimable_space');
  else actions.length = 0;

  if (low && tried.size > 0 && freeRatio !== null && freeRatio < 0.1) actions.push(componentCleanupAction());
  if (low && !worth) {
    advice.push('Le disque est presque plein mais il n\'y a presque rien à nettoyer automatiquement : regardez vos dossiers « Téléchargements », « Vidéos » et « Images », ou désinstallez les logiciels inutilisés.');
  }
  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) advice.push("L'agent n'est pas lancé en administrateur : certaines parties du nettoyage seront ignorées.");

  const healthy = problems.length === 0;
  return {
    summary: healthy
      ? 'Rien d\'encombrant à nettoyer.'
      : `On peut libérer environ ${formatBytes(reclaimable)} : fichiers temporaires ${formatBytes(temp)}, cache des navigateurs ${formatBytes(facts.browserCacheBytes)}, corbeille ${formatBytes(facts.recycleBytes)}.`,
    problems,
    actions,
    advice,
    healthy: healthy && !(low && facts.freeBytes !== null && freeRatio! < 0.05),
    needsHuman: false,
  };
}

export function cleanupSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'cleanup',
    title: 'Nettoyage : libérer de la place',
    verifyQuestion: 'Avez-vous retrouvé de la place sur votre disque ?',
    async diagnose(runner) {
      const d = diagnoseCleanup(parseCleanupFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic de nettoyage', 5 * 60_000)), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}

