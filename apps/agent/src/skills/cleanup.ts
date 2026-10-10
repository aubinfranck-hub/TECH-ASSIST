import type { Action, ActionResult, CommandRunner, Diagnosis, Skill } from '../types.js';
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
  /** Caches de Windows (téléchargements de mises à jour, rapports d'erreurs, optimisation de livraison) : sans risque, Windows les recrée au besoin. */
  systemCacheBytes?: number;
}

/** Taille d'un dossier (0 s'il n'existe pas ou n'est pas lisible). */
const GET_SIZE = String.raw`function Get-FolderSize([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return [double]0 }
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum
  if ($sum) { return [double]$sum } else { return [double]0 }
}`;

/** Dossiers de caches de Windows nettoyés par `clean_system_caches` (PowerShell : liste de chemins). */
const SYSTEM_CACHE_DIRS = String.raw`@(
  (Join-Path $env:windir 'SoftwareDistribution\Download'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportQueue'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportArchive'),
  (Join-Path $env:windir 'ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache')
)`;

/** Lecture seule : tailles des dossiers temporaires, caches et corbeille ; espace libre du disque Windows. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
${GET_SIZE}
$temp = Get-FolderSize $env:TEMP
$winTemp = Get-FolderSize (Join-Path $env:windir 'Temp')
$browsers = 0
foreach ($rel in @('Google\Chrome\User Data\Default\Cache', 'Microsoft\Edge\User Data\Default\Cache', 'BraveSoftware\Brave-Browser\User Data\Default\Cache')) {
  $browsers += Get-FolderSize (Join-Path $env:LOCALAPPDATA $rel)
}
$sysCache = 0
foreach ($dir in ${SYSTEM_CACHE_DIRS}) { $sysCache += Get-FolderSize $dir }
$recycle = 0
try { foreach ($i in (New-Object -ComObject Shell.Application).NameSpace(0xA).Items()) { $recycle += [double]$i.Size } } catch { }
$vol = Get-Volume -DriveLetter ($env:SystemDrive.Substring(0, 1))
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ tempBytes = $temp; windowsTempBytes = $winTemp; browserCacheBytes = $browsers; systemCacheBytes = $sysCache; recycleBytes = $recycle; freeBytes = [double]$vol.SizeRemaining; totalBytes = [double]$vol.Size; admin = $admin } | ConvertTo-Json -Compress
`);

export function parseCleanupFacts(stdout: string): CleanupFacts {
  const raw = extractJson(stdout);
  return {
    tempBytes: nonNegative(raw.tempBytes) ?? 0,
    windowsTempBytes: nonNegative(raw.windowsTempBytes) ?? 0,
    browserCacheBytes: nonNegative(raw.browserCacheBytes) ?? 0,
    systemCacheBytes: nonNegative(raw.systemCacheBytes) ?? 0,
    recycleBytes: nonNegative(raw.recycleBytes) ?? 0,
    freeBytes: nonNegative(raw.freeBytes),
    totalBytes: nonNegative(raw.totalBytes),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const MB = 1024 ** 2;
/** En dessous, le nettoyage n'apporterait rien : on ne dérange pas le client. */
const WORTH_CLEANING = 300 * MB;

/**
 * Suppression prudente, commune aux nettoyages : refuse une racine de disque ou le dossier du profil (variable d'environnement
 * détournée), et ne touche à aucun fichier atteint à travers un lien (jonction, lien symbolique) qui pourrait mener ailleurs.
 */
export const SAFE_DELETE = String.raw`function Remove-FilesSafely([string]$Dir, [datetime]$OlderThan) {
  if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { return }
  $full = (Resolve-Path -LiteralPath $Dir).ProviderPath.TrimEnd('\')
  if ($full -match '^[A-Za-z]:$' -or $full -ieq $env:USERPROFILE.TrimEnd('\') -or $full -ieq $env:windir.TrimEnd('\')) { return }
  $links = @(Get-ChildItem -LiteralPath $full -Directory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object { $_.FullName.TrimEnd('\') + '\' })
  Get-ChildItem -LiteralPath $full -Recurse -Force -File | Where-Object {
    $path = $_.FullName
    $_.LastWriteTime -lt $OlderThan -and -not ($links | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })
  } | Remove-Item -Force -ErrorAction SilentlyContinue
}`;

/**
 * Lance un script de nettoyage qui termine par « FREED:<octets> » (taille mesurée avant puis après) : l'effet réel est annoncé au client,
 * pas une estimation. Sans cette ligne (ou en dessous de 1 Mo), on ne prétend rien.
 */
export async function runFreed(runner: CommandRunner, script: string, timeoutMs: number): Promise<ActionResult> {
  const res = await runScript(runner, script, timeoutMs);
  if (!res.ok) return res;
  const match = /FREED:(\d+)/.exec(res.message);
  if (!match) return res;
  const bytes = Number(match[1]);
  if (bytes < MB) return { ok: true, message: 'Il n\'y avait presque rien de plus à supprimer' };
  const effect = `${formatBytes(bytes)} libérés`;
  return { ok: true, message: effect, effect };
}

const cleanTempAction = (bytes: number): Action => ({
  id: 'clean_temp',
  title: 'Supprimer les fichiers temporaires',
  explanation: `Je supprime les fichiers temporaires de Windows et des programmes (environ ${formatBytes(bytes)}), seulement ceux de plus d'un jour. Ce sont des copies de travail sans valeur : vos documents, photos et courriers ne sont pas touchés. Les fichiers en cours d'utilisation sont ignorés.`,
  requiresAdmin: false,
  verified: true,
  run: (runner) =>
    runFreed(
      runner,
      guarded(String.raw`$ErrorActionPreference = 'SilentlyContinue'
${SAFE_DELETE}
${GET_SIZE}
$dirs = @($env:TEMP, (Join-Path $env:windir 'Temp'))
$before = 0
foreach ($dir in $dirs) { $before += Get-FolderSize $dir }
$limit = (Get-Date).AddDays(-1)
foreach ($dir in $dirs) {
  Remove-FilesSafely -Dir $dir -OlderThan $limit
}
$after = 0
foreach ($dir in $dirs) { $after += Get-FolderSize $dir }
Write-Output ('FREED:' + [int64][math]::Max(0, $before - $after))`),
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
    runFreed(
      runner,
      guarded(String.raw`$ErrorActionPreference = 'SilentlyContinue'
${SAFE_DELETE}
${GET_SIZE}
$dirs = @('Google\Chrome\User Data\Default\Cache', 'Microsoft\Edge\User Data\Default\Cache', 'BraveSoftware\Brave-Browser\User Data\Default\Cache') | ForEach-Object { Join-Path $env:LOCALAPPDATA $_ }
$before = 0
foreach ($dir in $dirs) { $before += Get-FolderSize $dir }
foreach ($dir in $dirs) { Remove-FilesSafely -Dir $dir -OlderThan ([datetime]::MaxValue) }
$after = 0
foreach ($dir in $dirs) { $after += Get-FolderSize $dir }
Write-Output ('FREED:' + [int64][math]::Max(0, $before - $after))`),
      5 * 60_000,
    ),
});

const emptyRecycleAction = (bytes: number): Action => ({
  id: 'empty_recycle_bin',
  title: 'Vider la corbeille',
  explanation: `La corbeille contient environ ${formatBytes(bytes)} de fichiers supprimés. Je la vide : ces fichiers ne pourront PLUS être récupérés. Vérifiez qu'il n'y manque rien d'important, sinon refusez.`,
  requiresAdmin: false,
  verified: true,
  run: (runner) =>
    runFreed(
      runner,
      guarded(`$size = 0
try { foreach ($i in (New-Object -ComObject Shell.Application).NameSpace(0xA).Items()) { $size += [double]$i.Size } } catch { }
Clear-RecycleBin -Force -ErrorAction Stop
Write-Output ('FREED:' + [int64]$size)`),
      5 * 60_000,
    ),
});

const systemCachesAction = (bytes: number): Action => ({
  id: 'clean_system_caches',
  title: 'Vider les caches de Windows',
  explanation: `Je vide les caches de Windows (environ ${formatBytes(bytes)}) : mises à jour déjà téléchargées, rapports d'erreurs, copies de partage de mises à jour. Windows les recrée tout seul si besoin ; rien de ce qui est installé n'est touché. Les services de mise à jour sont arrêtés quelques instants puis relancés ; si une mise à jour était en cours de téléchargement, elle reprendra.`,
  requiresAdmin: true,
  verified: true,
  run: (runner) =>
    runFreed(
      runner,
      guarded(String.raw`$ErrorActionPreference = 'SilentlyContinue'
${SAFE_DELETE}
${GET_SIZE}
$dirs = ${SYSTEM_CACHE_DIRS}
$before = 0
foreach ($dir in $dirs) { $before += Get-FolderSize $dir }
$stopped = @()
foreach ($name in @('wuauserv', 'bits', 'dosvc')) {
  $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue; $stopped += $name }
}
try {
  foreach ($dir in $dirs) { Remove-FilesSafely -Dir $dir -OlderThan ([datetime]::MaxValue) }
} finally {
  foreach ($name in $stopped) { Start-Service -Name $name -ErrorAction SilentlyContinue }
}
$after = 0
foreach ($dir in $dirs) { $after += Get-FolderSize $dir }
Write-Output ('FREED:' + [int64][math]::Max(0, $before - $after))`),
      15 * 60_000,
    ),
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
  const systemCache = facts.systemCacheBytes ?? 0;
  const reclaimable = temp + facts.browserCacheBytes + facts.recycleBytes + systemCache;
  const freeRatio = facts.freeBytes !== null && facts.totalBytes ? facts.freeBytes / facts.totalBytes : null;
  const low = freeRatio !== null && freeRatio < 0.15;

  if (temp >= 100 * MB) actions.push(cleanTempAction(temp));
  if (facts.browserCacheBytes >= 100 * MB) actions.push(browserCacheAction(facts.browserCacheBytes));
  if (facts.recycleBytes >= 100 * MB) actions.push(emptyRecycleAction(facts.recycleBytes));
  if (systemCache >= 100 * MB) actions.push(systemCachesAction(systemCache));
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
      : `On peut libérer environ ${formatBytes(reclaimable)} : fichiers temporaires ${formatBytes(temp)}, cache des navigateurs ${formatBytes(facts.browserCacheBytes)}, corbeille ${formatBytes(facts.recycleBytes)}${systemCache > 0 ? `, caches de Windows ${formatBytes(systemCache)}` : ''}.`,
    problems,
    actions,
    advice,
    healthy: healthy && !(low && facts.freeBytes !== null && freeRatio! < 0.05),
    needsHuman: false,
    metrics: { ...(facts.freeBytes !== null ? { freeBytes: facts.freeBytes } : {}), reclaimableBytes: reclaimable },
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

